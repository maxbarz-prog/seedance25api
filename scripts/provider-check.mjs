#!/usr/bin/env node
// Live provider validation, run by .github/workflows/provider-check.yml on a
// GitHub runner (which, unlike Claude's sandbox, can reach the providers).
// Keys arrive as env vars loaded from SSM by the workflow and are never
// printed. Node 22, no dependencies; ffprobe/ffmpeg from the runner image.
//
// MODE=keys      Stripe + Clerk key checks (and the webhook step) only; no
//                video tasks, so it is free to run.
// MODE=validate  one minimal call per provider (Stripe, Clerk, ModelArk, fal).
// MODE=full      validate + the three-way cost test from docs/NEXT.md
//                (Seedance 2.5 at 480p, native 1080p, 480p->1080p via fal),
//                a Seedance 2.0 480p task for its token rate, the
//                camera_fixed probe, and an extension task to settle whether
//                `duration` is the added or the total length.
// WEBHOOK=create|recreate  create the Stripe webhook endpoint for
//                WEBHOOK_URL and store its signing secret in SSM under
//                WEBHOOK_PARAM (SecureString) via the AWS CLI.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODE = process.env.MODE || "validate";
const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
// Queue status/result endpoints use the app id (first two path segments).
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");
const SD25 = process.env.BYTEPLUS_SEEDANCE_25_MODEL || "dreamina-seedance-2-5-260628";
const SD20 = process.env.BYTEPLUS_SEEDANCE_20_MODEL || "dreamina-seedance-2-0-260128";

// Published ModelArk list prices, USD per million tokens (cross-checked
// 2026-09-08 against third-party price trackers; the Ark billing console is
// the authority). Used only to turn measured tokens into a per-second cost.
const PRICE_PER_M = {
  [SD25]: { noVideo: 10.7, withVideo: 6.4 },
  [SD20]: { noVideo: 4.3, withVideo: 4.3 },
};

const PROMPT =
  "A red vintage bicycle leaning against a sunlit stone wall, leaves drifting past, gentle camera push-in";
const SEED = 12345;
const DURATION_S = 4;
const EXTEND_S = 6;

const summary = { mode: MODE, startedAt: new Date().toISOString(), checks: {}, tasks: {}, notes: [] };
const tmp = mkdtempSync(join(tmpdir(), "pc-"));

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json, text };
}

// ---------- Stripe ----------
async function checkStripe() {
  const key = need("STRIPE_SECRET_KEY");
  const r = await req("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const out = { status: r.status, keyMode: key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : "unknown" };
  if (r.ok) {
    out.livemode = r.json.livemode;
    out.available = r.json.available?.map((a) => `${a.amount / 100} ${a.currency}`);
  } else out.error = r.json?.error?.message || r.text.slice(0, 200);
  summary.checks.stripe = out;
  log("stripe", JSON.stringify(out));
  return out;
}

// ---------- Clerk ----------
async function checkClerk() {
  const key = need("CLERK_SECRET_KEY");
  const r = await req("https://api.clerk.com/v1/users?limit=1", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const out = { status: r.status, keyMode: key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : "unknown" };
  if (r.ok) out.sampleUsers = Array.isArray(r.json) ? r.json.length : "?";
  else out.error = r.json?.errors?.[0]?.message || r.text.slice(0, 200);
  // Production instances only serve their configured domain, and need the
  // CNAMEs below to exist in DNS before the frontend can load at all.
  const d = await req("https://api.clerk.com/v1/domains", { headers: { Authorization: `Bearer ${key}` } });
  if (d.ok) {
    out.domains = (d.json?.data || []).map((x) => ({
      name: x.name,
      isSatellite: x.is_satellite,
      frontendApiUrl: x.frontend_api_url,
      accountsPortalUrl: x.accounts_portal_url,
      cnameTargets: (x.cname_targets || []).map((c) => `${c.host} -> ${c.value}${c.required === false ? " (optional)" : ""}`),
    }));
  } else out.domainsError = d.text.slice(0, 200);
  const inst = await req("https://api.clerk.com/v1/instance", { headers: { Authorization: `Bearer ${key}` } });
  if (inst.ok) out.instance = { environmentType: inst.json?.environment_type, allowedOrigins: inst.json?.allowed_origins };
  // The publishable key encodes the frontend API host; it must belong to the
  // same instance as the secret key.
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  if (pk) {
    try {
      out.publishableKeyHost = Buffer.from(pk.replace(/^pk_(live|test)_/, ""), "base64").toString().replace(/\$$/, "");
      out.publishableKeyMode = pk.startsWith("pk_test_") ? "test" : pk.startsWith("pk_live_") ? "live" : "unknown";
    } catch {
      out.publishableKeyHost = "undecodable";
    }
  }
  // Does this instance serve the stage's site? A production instance serves
  // exactly its configured domain; a development instance serves any origin.
  const site = process.env.SITE_DOMAIN;
  if (site && out.domains) {
    const match = out.domains.find((d) => d.name === site);
    if (out.instance?.environmentType === "development") {
      out.siteCheck = "development instance: any origin allowed, no DNS needed";
    } else if (!match) {
      out.siteCheck = `MISMATCH: this Clerk instance serves ${out.domains.map((d) => d.name).join(", ") || "no domain"}, not ${site}. Sign-in cannot work on this stage. Create a Clerk application for ${site} (production instance) and store its sk_live_/pk_live_ keys, or use a development instance's sk_test_/pk_test_ keys for dev.`;
      out.error = out.siteCheck;
    } else {
      out.siteCheck = `ok: instance serves ${site}`;
      // Make sure the instance's CNAMEs exist in our hosted zone (idempotent).
      if (process.env.CLERK_DNS === "upsert") out.dns = clerkDns(site, match);
    }
  }
  summary.checks.clerk = out;
  log("clerk", JSON.stringify(out));
  return out;
}

// Upsert a Clerk domain's CNAME targets into the Route 53 zone for `site`
// (the deploy role has the permission; records are idempotent).
function clerkDns(site, domain) {
  const region = process.env.AWS_REGION || "us-east-1";
  const zones = spawnSync("aws", [
    "route53", "list-hosted-zones", "--query", `HostedZones[?Name=='${site}.'].Id`, "--output", "text", "--region", region,
  ], { encoding: "utf8" });
  const zoneId = (zones.stdout || "").trim();
  if (!zoneId) return { error: `no hosted zone for ${site}` };
  const changes = (domain.cnameTargets || []).map((t) => {
    const [host, value] = t.replace(/ \(optional\)$/, "").split(" -> ");
    return { Action: "UPSERT", ResourceRecordSet: { Name: host, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: value }] } };
  });
  if (!changes.length) return { result: "no CNAME targets" };
  const r = spawnSync("aws", [
    "route53", "change-resource-record-sets", "--hosted-zone-id", zoneId,
    "--change-batch", JSON.stringify({ Changes: changes }), "--region", region,
  ], { encoding: "utf8" });
  return r.status === 0 ? { result: `upserted ${changes.length} records in ${zoneId}` } : { error: r.stderr.slice(0, 300) };
}

// ---------- ModelArk ----------
function arkHeaders() {
  return { Authorization: `Bearer ${need("BYTEPLUS_API_KEY")}`, "Content-Type": "application/json" };
}
async function arkCreate(body) {
  const r = await req(`${ARK}/contents/generations/tasks`, {
    method: "POST",
    headers: arkHeaders(),
    body: JSON.stringify(body),
  });
  return r;
}
async function arkPoll(id, label, timeoutMs = 25 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req(`${ARK}/contents/generations/tasks/${id}`, { headers: arkHeaders() });
    if (!r.ok) throw new Error(`${label}: poll ${r.status} ${r.text.slice(0, 200)}`);
    const s = r.json.status;
    if (["succeeded", "failed", "cancelled", "expired"].includes(s)) {
      return { ...r.json, elapsedS: Math.round((Date.now() - t0) / 1000) };
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out in status ${s}`);
    await sleep(10_000);
  }
}

function baseBody(model, resolution, extra = {}) {
  return {
    model,
    content: [{ type: "text", text: PROMPT }],
    resolution,
    ratio: "16:9",
    duration: DURATION_S,
    generate_audio: false,
    watermark: false,
    return_last_frame: true,
    seed: SEED,
    ...extra,
  };
}

// Submit; if the request is rejected because of a field in `probeFields`,
// retry without it and record the rejection.
async function submitWithProbe(label, body, probeFields = []) {
  const rec = { label, model: body.model, resolution: body.resolution, duration: body.duration };
  let r = await arkCreate(body);
  for (const f of probeFields) {
    if (!r.ok && (r.text.includes(f) || r.status === 400)) {
      rec[`${f}_submit`] = `rejected ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 200)}`;
      const { [f]: _omit, ...rest } = body;
      void _omit;
      r = await arkCreate(rest);
    } else if (r.ok) {
      rec[`${f}_submit`] = "accepted";
    }
  }
  if (!r.ok) {
    rec.submit = `failed ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 300)}`;
    rec.errorCode = r.json?.error?.code;
    summary.tasks[label] = rec;
    log(label, "submit failed", rec.submit);
    return null;
  }
  rec.id = r.json.id;
  summary.tasks[label] = rec;
  log(label, "submitted", r.json.id);
  return rec;
}

async function finish(rec, label) {
  if (!rec) return null;
  const t = await arkPoll(rec.id, label);
  rec.status = t.status;
  rec.elapsedS = t.elapsedS;
  if (t.status === "succeeded") {
    rec.videoUrl = t.content?.video_url;
    rec.lastFrameUrl = t.content?.last_frame_url ? "present" : "absent";
    rec.usage = t.usage;
    const probe = await ffprobe(rec.videoUrl, label);
    Object.assign(rec, probe);
    const price = PRICE_PER_M[rec.model];
    const tokens = t.usage?.total_tokens ?? t.usage?.completion_tokens;
    if (price && tokens && probe.durationS) {
      const perM = rec.withVideoInput ? price.withVideo : price.noVideo;
      rec.listCostUsd = +((tokens / 1e6) * perM).toFixed(4);
      rec.listCostPerOutputSec = +(rec.listCostUsd / probe.durationS).toFixed(4);
      rec.tokensPerOutputSec = Math.round(tokens / probe.durationS);
    }
  } else {
    rec.error = `${t.error?.code ?? ""}: ${t.error?.message ?? ""}`.trim();
  }
  log(label, JSON.stringify({ ...rec, videoUrl: rec.videoUrl ? "(url)" : undefined }));
  return rec;
}

// ---------- fal ----------
function falHeaders() {
  return { Authorization: `Key ${need("FAL_KEY")}`, "Content-Type": "application/json" };
}
async function falUpscale(videoUrl, target = "1080p") {
  const rec = { label: "fal_upscale", target };
  const t0 = Date.now();
  const sub = await req(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ video_url: videoUrl, target_resolution: target }),
  });
  if (!sub.ok) {
    rec.submit = `failed ${sub.status}: ${sub.text.slice(0, 300)}`;
    summary.tasks.fal_upscale = rec;
    log("fal submit failed", rec.submit);
    return rec;
  }
  rec.requestId = sub.json.request_id;
  log("fal submitted", rec.requestId);
  for (;;) {
    const st = await req(`https://queue.fal.run/${FAL_APP}/requests/${rec.requestId}/status`, {
      headers: falHeaders(),
    });
    if (!st.ok) throw new Error(`fal poll ${st.status} ${st.text.slice(0, 200)}`);
    if (st.json.status === "COMPLETED") break;
    if (st.json.status === "FAILED" || st.json.status === "ERROR") {
      rec.status = "failed";
      rec.error = JSON.stringify(st.json).slice(0, 300);
      summary.tasks.fal_upscale = rec;
      return rec;
    }
    if (Date.now() - t0 > 20 * 60_000) throw new Error("fal timed out");
    await sleep(5_000);
  }
  const res = await req(`https://queue.fal.run/${FAL_APP}/requests/${rec.requestId}`, { headers: falHeaders() });
  rec.status = "succeeded";
  rec.elapsedS = Math.round((Date.now() - t0) / 1000);
  rec.videoUrl = res.json?.video?.url;
  rec.responseKeys = Object.keys(res.json || {});
  Object.assign(rec, await ffprobe(rec.videoUrl, "fal_upscale"));
  summary.tasks.fal_upscale = rec;
  log("fal", JSON.stringify({ ...rec, videoUrl: "(url)" }));
  return rec;
}

// ---------- media probes ----------
async function download(url, name) {
  const p = join(tmp, name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name}: ${res.status}`);
  writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}
async function ffprobe(url, label) {
  if (!url) return {};
  try {
    const p = await download(url, `${label}.mp4`);
    const r = spawnSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration,size",
      "-of", "json", p,
    ], { encoding: "utf8" });
    if (r.error || r.status !== 0) throw new Error(`ffprobe: ${r.error?.message || r.stderr}`);
    const j = JSON.parse(r.stdout || "{}");
    const s = j.streams?.[0] || {};
    const [n, d] = String(s.r_frame_rate || "0/1").split("/").map(Number);
    return {
      file: p,
      width: s.width,
      height: s.height,
      fps: d ? +(n / d).toFixed(2) : undefined,
      durationS: j.format?.duration ? +Number(j.format.duration).toFixed(2) : undefined,
      sizeBytes: j.format?.size ? Number(j.format.size) : undefined,
    };
  } catch (e) {
    return { probeError: String(e).slice(0, 200) };
  }
}
// Extract a single frame (first or last) to PNG.
function frame(file, which, out) {
  const args = which === "last"
    ? ["-y", "-v", "error", "-sseof", "-0.2", "-i", file, "-frames:v", "1", "-update", "1", out]
    : ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-update", "1", out];
  spawnSync("ffmpeg", args, { encoding: "utf8" });
  return out;
}
// Mean SSIM between two images (scaled to a common size).
function ssim(a, b) {
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-i", a, "-i", b,
    "-filter_complex", "[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]ssim=stats_file=-",
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const m = /All:([0-9.]+)/.exec(r.stdout + r.stderr);
  return m ? +m[1] : undefined;
}

// ---------- Stripe webhook ----------
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];
async function stripeWebhook(action) {
  const key = need("STRIPE_SECRET_KEY");
  const url = need("WEBHOOK_URL");
  const param = need("WEBHOOK_PARAM");
  const region = process.env.AWS_REGION || "us-east-1";
  const out = { action, url, param };
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const list = await req("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers: H });
  if (!list.ok) throw new Error(`webhook list ${list.status} ${list.text.slice(0, 200)}`);
  const existing = (list.json.data || []).filter((e) => e.url === url);
  out.existing = existing.map((e) => `${e.id} (${e.status})`);
  if (existing.length && action !== "recreate") {
    out.result = "exists; signing secret is only shown at creation, re-run with WEBHOOK=recreate to rotate";
    summary.checks.webhook = out;
    log("webhook", JSON.stringify(out));
    return out;
  }
  for (const e of existing) {
    const d = await req(`https://api.stripe.com/v1/webhook_endpoints/${e.id}`, { method: "DELETE", headers: H });
    if (!d.ok) throw new Error(`webhook delete ${e.id}: ${d.status}`);
    log("webhook deleted", e.id);
  }
  const form = new URLSearchParams();
  form.set("url", url);
  form.set("description", "Remerged billing (managed by provider-check workflow)");
  WEBHOOK_EVENTS.forEach((ev, i) => form.set(`enabled_events[${i}]`, ev));
  const c = await req("https://api.stripe.com/v1/webhook_endpoints", { method: "POST", headers: H, body: form });
  if (!c.ok) throw new Error(`webhook create ${c.status} ${c.text.slice(0, 300)}`);
  const secret = c.json.secret;
  console.log(`::add-mask::${secret}`);
  const put = spawnSync("aws", [
    "ssm", "put-parameter", "--name", param, "--type", "SecureString", "--overwrite",
    "--region", region, "--value", secret,
  ], { encoding: "utf8" });
  if (put.status !== 0) throw new Error(`ssm put-parameter failed: ${put.stderr.slice(0, 300)}`);
  out.created = c.json.id;
  out.enabledEvents = c.json.enabled_events;
  out.apiVersion = c.json.api_version;
  out.result = `created ${c.json.id}; secret stored in ${param}`;
  summary.checks.webhook = out;
  log("webhook", JSON.stringify(out));
  return out;
}

// ---------- main ----------
async function main() {
  await Promise.all([checkStripe().catch(e => (summary.checks.stripe = { error: String(e) })),
                     checkClerk().catch(e => (summary.checks.clerk = { error: String(e) }))]);

  if (process.env.WEBHOOK && process.env.WEBHOOK !== "none") {
    if (summary.checks.stripe?.keyMode !== "test" && process.env.STAGE !== "prod") {
      summary.checks.webhook = { skipped: "STRIPE_SECRET_KEY is not a test key on a non-prod stage" };
    } else {
      await stripeWebhook(process.env.WEBHOOK);
    }
  }

  if (MODE === "keys") return report();

  // ModelArk + fal. Validate mode: one 4s 480p task on 2.5 with the
  // camera_fixed probe, then one fal upscale of it.
  const sd25_480 = await submitWithProbe("sd25_480p", baseBody(SD25, "480p", { camera_fixed: true }), ["camera_fixed"]);
  let sd25_1080 = null, sd20_480 = null, sd20_1080 = null;
  if (MODE === "full") {
    sd25_1080 = await submitWithProbe("sd25_1080p", baseBody(SD25, "1080p"));
    sd20_480 = await submitWithProbe("sd20_480p", baseBody(SD20, "480p"));
    sd20_1080 = await submitWithProbe("sd20_1080p", baseBody(SD20, "1080p"));
  }
  const [a] = await Promise.all([
    finish(sd25_480, "sd25_480p"),
    finish(sd25_1080, "sd25_1080p"),
    finish(sd20_480, "sd20_480p"),
    finish(sd20_1080, "sd20_1080p"),
  ]);

  if (a?.videoUrl) {
    const jobs = [falUpscale(a.videoUrl, "1080p").catch(e => (summary.tasks.fal_upscale = { error: String(e) }))];
    if (MODE === "full") {
      // Extension: source 4s clip as reference_video, ask for EXTEND_S. The
      // output length and its first frame tell us what `duration` means.
      const ext = await submitWithProbe("sd25_extend", {
        model: SD25,
        content: [
          { type: "text", text: `Extend the video, continuing seamlessly from its final frame. ${PROMPT}` },
          { type: "video_url", video_url: { url: a.videoUrl }, role: "reference_video" },
        ],
        resolution: "480p",
        ratio: "adaptive",
        duration: EXTEND_S,
        generate_audio: false,
        watermark: false,
        return_last_frame: true,
        seed: SEED,
      });
      if (ext) ext.withVideoInput = true;
      jobs.push(finish(ext, "sd25_extend"));
    }
    const [, extDone] = await Promise.all(jobs);
    if (extDone?.file && a.file) {
      const srcFirst = frame(a.file, "first", join(tmp, "src_first.png"));
      const srcLast = frame(a.file, "last", join(tmp, "src_last.png"));
      const outFirst = frame(extDone.file, "first", join(tmp, "out_first.png"));
      extDone.ssimOutFirstVsSrcFirst = ssim(outFirst, srcFirst);
      extDone.ssimOutFirstVsSrcLast = ssim(outFirst, srcLast);
      const total = extDone.durationS, src = a.durationS;
      extDone.durationVerdict =
        total !== undefined && src !== undefined
          ? Math.abs(total - EXTEND_S) < 0.75
            ? "duration = output length (continuation only, source not included)"
            : Math.abs(total - (EXTEND_S + src)) < 0.75
              ? "duration = added length (output includes the source clip)"
              : `unclear: requested ${EXTEND_S}s, source ${src}s, got ${total}s`
          : "no probe";
    }
  }

  // Three-way comparison table.
  const t = summary.tasks;
  if (t.sd25_480p?.listCostPerOutputSec !== undefined) {
    const up = t.fal_upscale?.status === "succeeded" ? 0.0072 : undefined; // fal list, per source second at 30fps
    summary.threeWay = {
      "sd25 480p": { perSec: t.sd25_480p.listCostPerOutputSec, tokens: t.sd25_480p.usage?.total_tokens, out: `${t.sd25_480p.width}x${t.sd25_480p.height}@${t.sd25_480p.fps}` },
      "sd25 native 1080p": t.sd25_1080p?.listCostPerOutputSec !== undefined
        ? { perSec: t.sd25_1080p.listCostPerOutputSec, tokens: t.sd25_1080p.usage?.total_tokens, out: `${t.sd25_1080p.width}x${t.sd25_1080p.height}@${t.sd25_1080p.fps}` }
        : { status: t.sd25_1080p?.status ?? t.sd25_1080p?.submit, error: t.sd25_1080p?.error },
      "sd25 480p -> fal 1080p": up !== undefined
        ? { perSec: +(t.sd25_480p.listCostPerOutputSec + up).toFixed(4), upscalePerSec: up, out: `${t.fal_upscale.width}x${t.fal_upscale.height}@${t.fal_upscale.fps}`, upscaleElapsedS: t.fal_upscale.elapsedS }
        : { status: t.fal_upscale?.status ?? t.fal_upscale?.submit, error: t.fal_upscale?.error },
      "sd20 480p": t.sd20_480p?.listCostPerOutputSec !== undefined
        ? { perSec: t.sd20_480p.listCostPerOutputSec, tokens: t.sd20_480p.usage?.total_tokens, out: `${t.sd20_480p.width}x${t.sd20_480p.height}@${t.sd20_480p.fps}` }
        : undefined,
      "sd20 native 1080p": t.sd20_1080p?.listCostPerOutputSec !== undefined
        ? { perSec: t.sd20_1080p.listCostPerOutputSec, tokens: t.sd20_1080p.usage?.total_tokens, out: `${t.sd20_1080p.width}x${t.sd20_1080p.height}@${t.sd20_1080p.fps}` }
        : undefined,
    };
  }
  report();
}

function report() {
  summary.finishedAt = new Date().toISOString();
  const clean = JSON.parse(JSON.stringify(summary, (k, v) => (k === "videoUrl" || k === "file" ? undefined : v)));
  console.log("\n===== SUMMARY =====\n" + JSON.stringify(clean, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```json\n" + JSON.stringify(clean, null, 2) + "\n```\n");
  }
  const failed = Object.values(summary.checks).some((c) => c?.error) ||
    Object.values(summary.tasks).some((x) => x?.submit?.startsWith("failed") || x?.status === "failed" || x?.error);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
