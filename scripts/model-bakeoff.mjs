#!/usr/bin/env node
// Side-by-side comparison of every model we sell: the same 5-second shot from
// each, then each upscaled to 1080p, keeping both the 480p original and the
// 1080p result so the upscaler's contribution is visible too.
//
// The models are the only variable. Every render gets the same prompt, the
// same seed, and the same first-frame image, so differences in the output are
// the model rather than the setup. The key frame is generated once, up front,
// from a text-to-image model — or supplied with KEY_IMAGE_URL to reuse the
// frame from an earlier run and make two runs directly comparable.
//
// It doubles as a live test of the pricing and margin machinery: for each
// render it records the tokens the provider actually billed, works out what
// that cost, compares it to what we would have charged a member, and reports
// the verdict the margin guard would have reached. A "LOSS" row here is the
// same condition that halts selling in production.
//
// THIS SPENDS MONEY. It refuses to run without SPEND_OK=yes.

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");
const IMAGE_MODEL = process.env.BAKEOFF_IMAGE_MODEL || "seedream-4-0-250828";

const OUT_DIR = process.env.BAKEOFF_OUT || mkdtempSync(join(tmpdir(), "bakeoff-"));
const DURATION_S = Number(process.env.BAKEOFF_DURATION_S || 5);
const SEED = Number(process.env.BAKEOFF_SEED || 12345);
const RATIO = "16:9";

const PROMPT =
  process.env.BAKEOFF_PROMPT ||
  "A red vintage bicycle leaning against a sunlit stone wall, dry leaves drifting past on a light breeze, slow camera push-in, warm late-afternoon light, cinematic 35mm";
const IMAGE_PROMPT =
  process.env.BAKEOFF_IMAGE_PROMPT ||
  "A red vintage bicycle leaning against a sunlit stone wall, dry leaves on the ground, warm late-afternoon light, cinematic 35mm photograph, 16:9";

// The models we sell, with the rate the provider charges for 480p output
// without video input, in USD per million tokens, and any promotion in force.
// Mirrors web/lib/config.ts — the point of the run is to check that table
// against reality, so it is restated here rather than imported.
// Only models this account can actually call. Being on the price list is not
// enough: the other five Seedance models are listed and priced but answer 404
// ModelNotOpen. See .github/workflows/model-activation.yml, which is free.
// `perMillion` is the 480p/720p rate, `perMillionHd` the 1080p one (null
// where the model has no native 1080p at all). Frame sizes are what these
// models actually emit, measured — 480p is not one size across the range.
const MODELS = [
  { id: "seedance-2.5", label: "Seedance 2.5", upstream: "dreamina-seedance-2-5-260628",
    perMillion: 10.7, perMillionHd: 11.7,
    hdDiscount: { pct: 0.28, until: "2026-09-17T06:00:00Z" },
    frame: { sd: [854, 480], hd: [1920, 1080] } },
  { id: "seedance-2.0", label: "Seedance 2.0", upstream: "dreamina-seedance-2-0-260128",
    perMillion: 7.0, perMillionHd: 7.7,
    frame: { sd: [864, 496], hd: [1920, 1080] } },
  { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", upstream: "dreamina-seedance-2-0-fast-260128",
    perMillion: 5.6, perMillionHd: null,
    discount: { pct: 0.25, until: "2026-10-07T06:00:00Z" },
    frame: { sd: [864, 496], hd: null } },
  { id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", upstream: "dreamina-seedance-2-0-mini-260615",
    perMillion: 3.5, perMillionHd: null,
    discount: { pct: 0.6, until: "2026-10-07T06:00:00Z" },
    frame: { sd: [864, 496], hd: null } },
];

// NATIVE renders at 1080p with no upscaler; the default renders at 480p and
// upscales. Running both against the same key frame is the only way to see
// what the 4.7x price difference actually buys.
const NATIVE = process.env.BAKEOFF_NATIVE === "1";

// BAKEOFF_MODELS limits the run to named models, so a failure in one does not
// mean paying again for the ones that already succeeded.
const ONLY = (process.env.BAKEOFF_MODELS || "").split(/[,\s]+/).filter(Boolean);

const UPSCALE_PER_SEC = 0.0072;
// Our own price formula, from web/lib/pricing.ts.
const DELIVERY = 0.01, OVERHEAD = 0.1, PROCESSING = 0.035, CREDIT = 0.01;

const now = Date.now();
// The rate actually in force for the tier this run uses, net of a promotion
// that is still running.
function liveRate(m) {
  const list = NATIVE ? m.perMillionHd : m.perMillion;
  if (list === null || list === undefined) return null;
  const d = NATIVE ? m.hdDiscount : m.discount;
  return d && Date.parse(d.until) > now ? list * (1 - d.pct) : list;
}
// The provider bills frames, and a render carries one more than
// duration x fps: a 5 s clip at 24 fps comes back 5.04 s and bills 121.
const framesFor = (sec) => Math.round(sec * 24) + 1;
function estTokens(m, sec) {
  const size = NATIVE ? m.frame.hd : m.frame.sd;
  if (!size) return null;
  return (framesFor(sec) * size[0] * size[1]) / 1024;
}

// What we would charge a member for this render. Mirrors web/lib/pricing.ts,
// including the half-percent the estimate carries so a quote never lands
// under what the provider bills.
const TOKEN_SAFETY = 1.005;
function ourPriceUsd(m, durationS) {
  const rate = liveRate(m);
  const tokens = estTokens(m, durationS);
  if (rate === null || tokens === null) return null;
  let provider = (rate * tokens * TOKEN_SAFETY) / 1e6;
  if (!NATIVE) provider += UPSCALE_PER_SEC * durationS;
  const usd = ((provider + DELIVERY) * (1 + OVERHEAD)) / (1 - PROCESSING);
  return Math.ceil(usd / CREDIT) * CREDIT;
}

const summary = { startedAt: new Date().toISOString(), mode: NATIVE ? "native-1080p" : "upscaled-1080p", prompt: PROMPT, seed: SEED, durationS: DURATION_S, models: [], totals: {} };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}
async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, ok: res.ok, json, text };
}
const arkHeaders = () => ({ Authorization: `Bearer ${need("BYTEPLUS_API_KEY")}`, "Content-Type": "application/json" });
const falHeaders = () => ({ Authorization: `Key ${need("FAL_KEY")}`, "Content-Type": "application/json" });

async function arkPoll(id, label, timeoutMs = 25 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req(`${ARK}/contents/generations/tasks/${id}`, { headers: arkHeaders() });
    if (!r.ok) throw new Error(`${label}: poll ${r.status} ${r.text.slice(0, 200)}`);
    const s = r.json.status;
    if (["succeeded", "failed", "cancelled", "expired"].includes(s)) {
      return { ...r.json, elapsedS: Math.round((Date.now() - t0) / 1000) };
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out in ${s}`);
    await sleep(10_000);
  }
}

// One key frame, reused by every model, so the comparison is of the models
// rather than of seven different opening shots.
//
// No image-generation model is activated on this account, so the frame is
// made from a video model instead: the cheapest one renders a short clip,
// and its first frame becomes the shared starting point. That costs a few
// cents, uses only what we already have, and produces a photographic frame
// rather than a synthetic test card — which matters, because how a model
// handles real texture and light is most of what we are comparing.
//
// The frame has to be somewhere the provider can fetch, so it goes to our
// own media bucket behind a presigned URL that expires the same day.
//
// KEY_IMAGE_URL short-circuits all of this, which is how a later run is made
// directly comparable to an earlier one: pass back the frame it used.

// Cheapest model on the list, and the shortest clip it will take: this is a
// means to a still image, not something anyone will watch.
const SEED_MODEL = {
  id: "seedance-2.0-mini",
  upstream: "dreamina-seedance-2-0-mini-260615",
  perMillion: 3.5,
  discount: { pct: 0.6, until: "2026-10-07T06:00:00Z" },
};
const SEED_CLIP_S = 4;

// GitHub's runners no longer ship ffmpeg, so the binary is passed in rather
// than assumed to be on PATH. Production uses the same ffmpeg-static build.
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

// SST names the bucket for us, so find it rather than hard-coding a name
// that changes with every stack.
function mediaBucket() {
  if (process.env.VIDEO_BUCKET) return process.env.VIDEO_BUCKET;
  const out = sh("aws", [
    "s3api", "list-buckets",
    "--query", "Buckets[].Name", "--output", "text",
  ]);
  const found = out
    .split(/\s+/)
    .find((b) => /remerged/i.test(b) && /media/i.test(b));
  if (!found) throw new Error("could not find the media bucket");
  return found;
}

async function uploadFrame(localPath) {
  const bucket = mediaBucket();
  const key = `tmp/bakeoff/${Date.now()}-key-frame.png`;
  sh("aws", ["s3", "cp", localPath, `s3://${bucket}/${key}`, "--content-type", "image/png"]);
  const url = sh("aws", ["s3", "presign", `s3://${bucket}/${key}`, "--expires-in", "43200"]);
  log(`key frame uploaded to ${bucket}/${key}`);
  return url;
}

async function keyImage() {
  if (process.env.KEY_IMAGE_URL) {
    const url = process.env.KEY_IMAGE_URL.trim();
    // Check it is fetchable before spending anything on renders that would
    // all fail the same way.
    const probe = await fetch(url).catch((e) => ({ ok: false, status: String(e) }));
    if (!probe.ok) throw new Error(`KEY_IMAGE_URL is not fetchable: ${probe.status}`);
    log("key frame: reusing the supplied one");
    summary.keyImageUrl = url;
    summary.keyImageSource = "supplied";
    return url;
  }

  // A seed clip from an earlier run is money already spent — reuse it rather
  // than render the same frame twice.
  const existing = process.env.SEED_CLIP_PATH;
  if (existing && existsSync(existing)) {
    log("key frame: reusing the seed clip from an earlier run");
    const framePath = join(OUT_DIR, "key-frame.png");
    execFileSync(FFMPEG, ["-y", "-i", existing, "-vf", "select=eq(n\\,0)", "-vframes", "1", framePath]);
    const url = await uploadFrame(framePath);
    summary.keyImageUrl = url;
    summary.keyImageSource = "frame 0 of a seed clip from an earlier run (no new spend)";
    return url;
  }

  log(`key frame: rendering a ${SEED_CLIP_S}s seed clip with ${SEED_MODEL.id}`);
  const sub = await req(`${ARK}/contents/generations/tasks`, {
    method: "POST",
    headers: arkHeaders(),
    body: JSON.stringify({
      model: SEED_MODEL.upstream,
      content: [{ type: "text", text: IMAGE_PROMPT }],
      // 720p: comfortably sharper than the 480p renders it seeds, without
      // paying 1080p prices for a frame nobody watches.
      resolution: "720p",
      ratio: RATIO,
      duration: SEED_CLIP_S,
      generate_audio: false,
      watermark: false,
      seed: SEED,
    }),
  });
  if (!sub.ok) {
    throw new Error(`seed clip submit failed ${sub.status}: ${(sub.json?.error?.message || sub.text).slice(0, 300)}`);
  }
  const done = await arkPoll(sub.json.id, "seed-clip");
  if (done.status !== "succeeded") {
    throw new Error(`seed clip ${done.status}: ${JSON.stringify(done.error || {}).slice(0, 300)}`);
  }
  summary.seedClip = {
    model: SEED_MODEL.id,
    tokens: done.usage?.total_tokens,
    usd: ((done.usage?.total_tokens ?? 0) * liveRate(SEED_MODEL)) / 1e6,
  };
  log(`seed clip done: ${summary.seedClip.tokens} tokens, $${summary.seedClip.usd.toFixed(4)}`);

  const clip = await download(done.content?.video_url, "seed-clip.mp4");
  if (!clip) throw new Error("seed clip could not be downloaded");
  const framePath = join(OUT_DIR, "key-frame.png");
  // Frame 0 exactly — the same still every model starts from.
  execFileSync(FFMPEG, ["-y", "-i", clip, "-vf", "select=eq(n\\,0)", "-vframes", "1", framePath]);
  const url = await uploadFrame(framePath);
  summary.keyImageUrl = url;
  summary.keyImageSource = `frame 0 of a ${SEED_CLIP_S}s ${SEED_MODEL.id} clip`;
  return url;
}

async function generate(m, imageUrl) {
  const rec = { id: m.id, label: m.label, upstream: m.upstream };
  const body = {
    model: m.upstream,
    content: [
      { type: "text", text: PROMPT },
      ...(imageUrl
        ? [{ type: "image_url", image_url: { url: imageUrl }, role: "first_frame" }]
        : []),
    ],
    resolution: NATIVE ? "1080p" : "480p",
    // With a first-frame image the provider takes the ratio from that image
    // and rejects an explicit one. Same rule as production (byteplus.ts).
    ratio: imageUrl ? "adaptive" : RATIO,
    duration: DURATION_S,
    generate_audio: false,
    watermark: false,
    seed: SEED,
  };
  const t0 = Date.now();
  const sub = await req(`${ARK}/contents/generations/tasks`, {
    method: "POST", headers: arkHeaders(), body: JSON.stringify(body),
  });
  if (!sub.ok) {
    rec.status = "submit-failed";
    rec.error = (sub.json?.error?.message || sub.text).slice(0, 300);
    log(m.id, "SUBMIT FAILED", rec.error);
    return rec;
  }
  rec.taskId = sub.json.id;
  log(m.id, "submitted", rec.taskId);
  const done = await arkPoll(rec.taskId, m.id);
  rec.status = done.status;
  rec.genElapsedS = done.elapsedS;
  if (done.status !== "succeeded") {
    rec.error = JSON.stringify(done.error || done).slice(0, 300);
    log(m.id, "FAILED", rec.error);
    return rec;
  }
  rec.videoUrl = done.content?.video_url;
  rec.tokens = done.usage?.total_tokens ?? done.usage?.completion_tokens;
  rec.wallS = Math.round((Date.now() - t0) / 1000);
  log(m.id, `generated in ${rec.wallS}s, ${rec.tokens} tokens`);
  return rec;
}

async function upscale(rec) {
  const t0 = Date.now();
  const sub = await req(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST", headers: falHeaders(),
    body: JSON.stringify({ video_url: rec.videoUrl, target_resolution: "1080p" }),
  });
  if (!sub.ok) {
    rec.upscaleError = `submit ${sub.status}: ${sub.text.slice(0, 200)}`;
    log(rec.id, "UPSCALE SUBMIT FAILED", rec.upscaleError);
    return;
  }
  const reqId = sub.json.request_id;
  for (;;) {
    const st = await req(`https://queue.fal.run/${FAL_APP}/requests/${reqId}/status`, { headers: falHeaders() });
    if (!st.ok) throw new Error(`fal poll ${st.status}`);
    if (st.json.status === "COMPLETED") break;
    if (["FAILED", "ERROR"].includes(st.json.status)) {
      rec.upscaleError = JSON.stringify(st.json).slice(0, 200);
      log(rec.id, "UPSCALE FAILED", rec.upscaleError);
      return;
    }
    if (Date.now() - t0 > 20 * 60_000) throw new Error(`${rec.id}: upscale timed out`);
    await sleep(5_000);
  }
  const res = await req(`https://queue.fal.run/${FAL_APP}/requests/${reqId}`, { headers: falHeaders() });
  rec.upscaledUrl = res.json?.video?.url;
  rec.upscaleElapsedS = Math.round((Date.now() - t0) / 1000);
  log(rec.id, `upscaled in ${rec.upscaleElapsedS}s`);
}

async function download(url, name) {
  if (!url) return null;
  const p = join(OUT_DIR, name);
  const res = await fetch(url);
  if (!res.ok) { log("download failed", name, res.status); return null; }
  writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

function probe(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const out = execFileSync(FFPROBE, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate:format=duration,size",
      "-of", "json", path,
    ]).toString();
    const j = JSON.parse(out);
    const s = j.streams?.[0] || {};
    return {
      width: s.width, height: s.height,
      fps: s.r_frame_rate,
      durationS: Number(j.format?.duration || 0).toFixed(2),
      bytes: Number(j.format?.size || 0),
    };
  } catch { return {}; }
}

// The margin guard's own decision, applied to the tokens actually billed.
function verdictFor(m, rec) {
  if (!rec.tokens) return { verdict: "unknown" };
  const rate = liveRate(m);
  if (rate === null) return { verdict: "unknown" };
  let providerUsd = (rec.tokens * rate) / 1e6;
  if (!NATIVE) providerUsd += UPSCALE_PER_SEC * DURATION_S;
  const chargedUsd = ourPriceUsd(m, DURATION_S);
  // How far our token estimate sat from what was actually billed. Tolerance
  // is 0 to +1%: under is a loss on every order, over a percent is money
  // taken for nothing.
  const est = estTokens(m, DURATION_S);
  rec.estTokens = est === null ? null : Math.round(est * TOKEN_SAFETY);
  rec.estDriftPct =
    est === null ? null : Number((((est * TOKEN_SAFETY - rec.tokens) / rec.tokens) * 100).toFixed(2));
  let verdict = "ok";
  if (chargedUsd < providerUsd) verdict = "LOSS";
  else if (chargedUsd < providerUsd * 1.05) verdict = "thin";
  else if (chargedUsd > providerUsd * 1.5 && chargedUsd - providerUsd > 0.25) verdict = "overcharge";
  return { providerUsd, chargedUsd, verdict };
}

async function main() {
  if (process.env.SPEND_OK !== "yes") {
    console.error("Refusing to run: this spends real money. Set SPEND_OK=yes.");
    process.exit(2);
  }
  const imageUrl = await keyImage();

  for (const m of MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))) {
    const rec = await generate(m, imageUrl);
    if (rec.status === "succeeded") {
      if (NATIVE) {
        // Nothing to upscale: this IS the 1080p render.
        const p = await download(rec.videoUrl, `${m.id}-1080p-native.mp4`);
        rec.fileNative = p && p.split("/").pop();
        rec.probeNative = probe(p);
      } else {
        const p = await download(rec.videoUrl, `${m.id}-480p.mp4`);
        rec.file480 = p && p.split("/").pop();
        rec.probe480 = probe(p);
        await upscale(rec);
        const up = await download(rec.upscaledUrl, `${m.id}-1080p.mp4`);
        rec.file1080 = up && up.split("/").pop();
        rec.probe1080 = probe(up);
      }
    }
    Object.assign(rec, verdictFor(m, rec));
    summary.models.push(rec);
  }
  if (summary.keyImageUrl) await download(summary.keyImageUrl, "key-frame.png");

  const ok = summary.models.filter((r) => r.tokens);
  const seedUsd = summary.seedClip?.usd ?? 0;
  summary.totals = {
    seedClipUsd: Number(seedUsd.toFixed(4)),
    providerUsd: Number((ok.reduce((a, r) => a + (r.providerUsd || 0), 0) + seedUsd).toFixed(4)),
    chargedUsd: Number(ok.reduce((a, r) => a + (r.chargedUsd || 0), 0).toFixed(2)),
    losses: summary.models.filter((r) => r.verdict === "LOSS").map((r) => r.id),
  };
  writeFileSync(join(OUT_DIR, NATIVE ? "bakeoff-native.json" : "bakeoff.json"), JSON.stringify(summary, null, 2));

  const rows = [
    `| Model | Tokens | Est | Drift | Cost to us | We charge | Margin | ${NATIVE ? "1080p native" : "480p source | 1080p upscaled"} | Gen |`,
    NATIVE ? "|---|---|---|---|---|---|---|---|---|" : "|---|---|---|---|---|---|---|---|---|---|",
    ...summary.models.map((r) => {
      const p4 = r.probe480 || {}, p10 = r.probe1080 || {}, pn = r.probeNative || {};
      const dim = (p) => (p.width ? `${p.width}x${p.height}` : "—");
      const shape = NATIVE
        ? (pn.width ? dim(pn) : r.error ? "failed" : "—")
        : `${p4.width ? dim(p4) : r.error ? "failed" : "—"} | ${p10.width ? dim(p10) : r.upscaleError ? "failed" : "—"}`;
      return `| ${r.label} | ${r.tokens ?? "—"} | ${r.estTokens ?? "—"} | ${r.estDriftPct === null || r.estDriftPct === undefined ? "—" : r.estDriftPct + "%"} | ${r.providerUsd ? "$" + r.providerUsd.toFixed(4) : "—"} | ${r.chargedUsd ? "$" + r.chargedUsd.toFixed(2) : "—"} | ${r.verdict ?? "—"} | ${shape} | ${r.wallS ? r.wallS + "s" : "—"} |`;
    }),
    "",
    `Key frame: ${summary.keyImageSource}. Prompt seed ${SEED}, ${DURATION_S}s, ${NATIVE ? "rendered natively at 1080p (no upscaler)" : "rendered at 480p then upscaled to 1080p"}.`,
    "",
    `**Spent: $${summary.totals.providerUsd}** across ${ok.length} renders. Members would have paid $${summary.totals.chargedUsd}.`,
    summary.totals.losses.length
      ? `\n**${summary.totals.losses.length} render(s) sold below cost: ${summary.totals.losses.join(", ")}** — this is the condition that halts selling in production.`
      : "\nNo render was priced below cost.",
  ].join("\n");

  console.log("\n" + rows + "\n");
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows + "\n");
  }
  console.log("\nfiles in", OUT_DIR);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
