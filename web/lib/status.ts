import { jobsInFlight, userById } from "./db";
import { storageEnabled, storageReachable } from "./storage";
import { ffmpegAvailable } from "./video";
import { clerkEnabled } from "./auth";
import { stripeEnabled } from "./billing";

// System status for the admin page.
//
// Four questions, in order, because that is the order you ask them when
// something looks wrong:
//   config      is this stage wired the way production should be?
//   internal    are OUR pieces (database, bucket, pipeline, ffmpeg) working?
//   dependency  can WE reach each vendor right now, with our credentials?
//   vendor      is the vendor telling the world they have an incident?
//
// The dependency checks are what separate "it's us" from "it's them": they
// use our real keys against the real endpoints, but only read — no
// generation, so running this page costs nothing. A 401/403 means our
// credentials; a timeout or 5xx means theirs, and the vendor row usually
// confirms it.
//
// Endpoint choices were verified against the live services on 2026-09-08
// (scripts/status-probe.mjs, provider-check.yml mode=status). Stripe, fal
// and BytePlus publish no machine-readable public status page, so for those
// our direct probe is the only signal — which is the more useful one anyway,
// since it tests the path we actually depend on.

export type Level = "good" | "warn" | "bad" | "unknown";
export type Group = "config" | "internal" | "dependency" | "vendor" | "deprecation";
export type Blame = "us" | "them" | "unclear";

export interface Check {
  key: string;
  group: Group;
  label: string;
  value: string;
  level: Level;
  note: string;
  ms?: number;
  blame?: Blame;
  link?: string;
}

export interface Status {
  checkedAt: number;
  stage: string;
  overall: Level;
  checks: Check[];
}

const PROBE_TIMEOUT_MS = 6000;
const CACHE_MS = 60_000;

const ARK_BASE = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");
const SD25 = process.env.BYTEPLUS_SEEDANCE_25_MODEL || "dreamina-seedance-2-5-260628";
const SD20 = process.env.BYTEPLUS_SEEDANCE_20_MODEL || "dreamina-seedance-2-0-260128";

let cache: { at: number; value: Status } | null = null;

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; ms: number; status?: number }> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    return { ok: true, value: await fn(ctl.signal), ms: Date.now() - t0 };
  } catch (e) {
    const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    return {
      ok: false,
      error: err?.name === "AbortError" ? "timed out" : String(err?.message ?? e).slice(0, 200),
      status: err?.$metadata?.httpStatusCode,
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- config ----------

function configChecks(): Check[] {
  const live = process.env.PROVIDER_MODE === "live";
  const generator = live && process.env.BYTEPLUS_API_KEY ? "byteplus" : "mock";
  const upscaler = live && process.env.FAL_KEY ? "fal" : live && process.env.TOPAZ_API_KEY ? "topaz" : "mock";
  const db = process.env.DB_BACKEND === "dynamo";
  return [
    {
      key: "config.db", group: "config", label: "Database", value: db ? "DynamoDB" : "SQLite",
      level: db ? "good" : "warn",
      note: db ? "durable, shared across Lambda instances" : "local file — data is lost when the instance recycles",
    },
    {
      key: "config.storage", group: "config", label: "Video storage", value: storageEnabled() ? "S3 bucket" : "none",
      level: storageEnabled() ? "good" : "bad",
      note: storageEnabled() ? "outputs copied to our bucket, served by presigned URL" : "provider URLs would reach users directly",
    },
    {
      key: "config.ffmpeg", group: "config", label: "ffmpeg", value: ffmpegAvailable() ? "available" : "missing",
      level: ffmpegAvailable() ? "good" : "warn",
      note: ffmpegAvailable()
        ? "extensions send only the last seconds of the source"
        : "extensions would send the whole source clip, costing more per extension",
    },
    {
      key: "config.mode", group: "config", label: "Provider mode", value: live ? "live" : "mock",
      level: live ? "good" : "warn",
      note: live ? "real generations, real cost" : "sample clips, nothing billed",
    },
    {
      key: "config.generator", group: "config", label: "Generator", value: generator,
      level: generator === "mock" ? "warn" : "good",
      note: generator === "mock" ? "no real generation" : "BytePlus ModelArk",
    },
    {
      key: "config.upscaler", group: "config", label: "Upscaler", value: upscaler,
      level: upscaler === "mock" ? "warn" : "good",
      note: upscaler === "mock" ? "no upscale step" : upscaler === "fal" ? "ByteDance upscaler via fal" : "Topaz",
    },
    {
      key: "config.auth", group: "config", label: "Auth", value: clerkEnabled() ? "Clerk" : "built-in",
      level: "good",
      note: clerkEnabled() ? "Clerk sign-in" : "email and password",
    },
    {
      key: "config.billing", group: "config", label: "Billing", value: stripeEnabled() ? "Stripe" : "mock",
      level: stripeEnabled() ? "good" : "bad",
      note: stripeEnabled() ? "Stripe key configured" : "no Stripe key — payments cannot be taken",
    },
    {
      key: "config.webhook", group: "config", label: "Webhook secret", value: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "missing",
      level: process.env.STRIPE_WEBHOOK_SECRET ? "good" : "bad",
      note: process.env.STRIPE_WEBHOOK_SECRET ? "payments can be confirmed" : "payments would never credit an account",
    },
  ];
}

// ---------- our systems ----------

async function internalChecks(): Promise<Check[]> {
  const out: Check[] = [];

  // A read of a key that cannot exist: proves the table, the IAM role and the
  // region are all right, without writing anything.
  const db = await timed(() => userById("00000000-0000-0000-0000-000000000000"));
  out.push({
    key: "internal.db", group: "internal", label: "Database read", ms: db.ms,
    value: db.ok ? "ok" : "failed",
    level: db.ok ? "good" : "bad",
    note: db.ok ? "users table reachable from the app" : `cannot read the users table: ${db.error}`,
  });

  if (storageEnabled()) {
    const s3 = await timed(() => storageReachable());
    out.push({
      key: "internal.storage", group: "internal", label: "Bucket access", ms: s3.ms,
      value: s3.ok ? "ok" : "failed",
      level: s3.ok ? "good" : "bad",
      note: s3.ok ? "media bucket reachable" : `cannot reach the media bucket: ${s3.error}`,
    });
  }

  // If jobs sit in flight for a long time the minute cron has stopped
  // advancing them, which is invisible from the outside until users complain.
  const jobs = await timed(() => jobsInFlight());
  if (jobs.ok) {
    const now = Date.now();
    const oldestMin = jobs.value.length
      ? Math.round(Math.max(...jobs.value.map((j) => now - j.created_at)) / 60_000)
      : 0;
    const stale = oldestMin >= 15;
    out.push({
      key: "internal.pipeline", group: "internal", label: "Pipeline", ms: jobs.ms,
      value: jobs.value.length ? `${jobs.value.length} in flight` : "idle",
      level: stale ? "warn" : "good",
      note: !jobs.value.length
        ? "no jobs waiting"
        : stale
          ? `oldest has been running ${oldestMin} min — the cron may not be advancing jobs`
          : `oldest running ${oldestMin} min`,
    });
  } else {
    out.push({
      key: "internal.pipeline", group: "internal", label: "Pipeline", ms: jobs.ms,
      value: "unknown", level: "unknown", note: `could not read in-flight jobs: ${jobs.error}`,
    });
  }

  return out;
}

// ---------- dependencies: can we reach them, with our keys ----------

// Classify a failed probe. 401/403 is our credentials; anything else that
// reaches us as a server error or timeout is more likely theirs.
function blameFor(status: number | undefined, failed: boolean): Blame | undefined {
  if (!failed) return undefined;
  if (status === 401 || status === 403) return "us";
  if (status === undefined || status >= 500) return "them";
  return "unclear";
}

async function json(url: string, init: RequestInit, signal: AbortSignal) {
  const res = await fetch(url, { ...init, signal });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

async function dependencyChecks(): Promise<Check[]> {
  const out: Check[] = [];

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    const r = await timed((signal) =>
      json("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${stripeKey}` } }, signal)
    );
    const status = r.ok ? r.value.status : undefined;
    const good = r.ok && status === 200;
    out.push({
      key: "dep.stripe", group: "dependency", label: "Stripe API", ms: r.ms,
      value: good ? "reachable" : `error ${status ?? ""}`.trim(),
      level: good ? "good" : "bad",
      blame: blameFor(status, !good),
      note: good ? "our key authenticates and payments can be created" : r.ok ? `HTTP ${status}` : r.error,
    });
  }

  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (clerkKey) {
    const r = await timed((signal) =>
      json("https://api.clerk.com/v1/users?limit=1", { headers: { Authorization: `Bearer ${clerkKey}` } }, signal)
    );
    const status = r.ok ? r.value.status : undefined;
    const good = r.ok && status === 200;
    out.push({
      key: "dep.clerk", group: "dependency", label: "Clerk API", ms: r.ms,
      value: good ? "reachable" : `error ${status ?? ""}`.trim(),
      level: good ? "good" : "bad",
      blame: blameFor(status, !good),
      note: good ? "our key authenticates and users can sign in" : r.ok ? `HTTP ${status}` : r.error,
    });
  }

  const arkKey = process.env.BYTEPLUS_API_KEY;
  if (arkKey) {
    // Listing tasks is a read: it proves the key works and the service is up
    // without submitting anything billable.
    const r = await timed((signal) =>
      json(`${ARK_BASE}/contents/generations/tasks?page_size=1`, { headers: { Authorization: `Bearer ${arkKey}` } }, signal)
    );
    const status = r.ok ? r.value.status : undefined;
    const good = r.ok && status === 200;
    out.push({
      key: "dep.ark", group: "dependency", label: "Generation API", ms: r.ms,
      value: good ? "reachable" : `error ${status ?? ""}`.trim(),
      level: good ? "good" : "bad",
      blame: blameFor(status, !good),
      note: good ? "ModelArk answers and our key authenticates" : r.ok ? `HTTP ${status}` : r.error,
    });
  }

  const falKey = process.env.FAL_KEY;
  if (falKey) {
    // A request id that cannot exist: 404 NOT_FOUND is the healthy answer.
    const r = await timed((signal) =>
      json(
        `https://queue.fal.run/${FAL_APP}/requests/00000000-0000-0000-0000-000000000000/status`,
        { headers: { Authorization: `Key ${falKey}` } },
        signal
      )
    );
    const status = r.ok ? r.value.status : undefined;
    const good = r.ok && (status === 404 || status === 200);
    out.push({
      key: "dep.fal", group: "dependency", label: "Upscaler API", ms: r.ms,
      value: good ? "reachable" : `error ${status ?? ""}`.trim(),
      level: good ? "good" : "bad",
      blame: blameFor(status, !good),
      note: good ? "fal answers and our key authenticates" : r.ok ? `HTTP ${status}` : r.error,
    });
  }

  return out;
}

// ---------- deprecation ----------

async function deprecationChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const arkKey = process.env.BYTEPLUS_API_KEY;
  if (!arkKey) return out;

  const r = await timed((signal) =>
    json(`${ARK_BASE}/models`, { headers: { Authorization: `Bearer ${arkKey}` } }, signal)
  );
  if (!r.ok || r.value.status !== 200) {
    out.push({
      key: "dep.models", group: "deprecation", label: "Model catalogue", ms: r.ms,
      value: "unavailable", level: "unknown",
      note: "could not read the provider's model list, so deprecation cannot be checked",
    });
    return out;
  }
  const data = (r.value.body as { data?: { id?: string }[] })?.data ?? [];
  const ids = new Set(data.map((m) => m.id).filter(Boolean) as string[]);
  for (const [label, id] of [["Seedance 2.5", SD25], ["Seedance 2.0", SD20]] as const) {
    // An empty catalogue means the endpoint changed shape, not that our models
    // vanished — say so rather than crying wolf.
    const listed = ids.has(id);
    out.push({
      key: `dep.model.${id}`, group: "deprecation", label: `${label} model`, ms: r.ms,
      value: listed ? "listed" : ids.size ? "not listed" : "catalogue empty",
      level: listed ? "good" : ids.size ? "warn" : "unknown",
      note: listed
        ? `${id} is still offered`
        : ids.size
          ? `${id} is no longer in the provider's catalogue — it may be deprecated`
          : "the catalogue returned no ids; the endpoint may have changed",
    });
  }
  return out;
}

// ---------- vendor incident feeds ----------

type Vendor = { key: string; label: string; url: string; link: string; why: string };

// Atlassian Statuspage feeds: { status: { indicator, description } }.
const STATUSPAGE: Vendor[] = [
  { key: "clerk", label: "Clerk", url: "https://status.clerk.com/api/v2/status.json", link: "https://status.clerk.com", why: "sign-in" },
  { key: "cloudflare", label: "Cloudflare", url: "https://www.cloudflarestatus.com/api/v2/status.json", link: "https://www.cloudflarestatus.com", why: "fronts Clerk and several providers" },
  { key: "github", label: "GitHub", url: "https://www.githubstatus.com/api/v2/status.json", link: "https://www.githubstatus.com", why: "deploys" },
];

function levelForIndicator(indicator: string): Level {
  if (indicator === "none") return "good";
  if (indicator === "critical" || indicator === "major") return "bad";
  return "warn"; // minor, maintenance, anything unrecognised
}

async function statuspageCheck(v: Vendor): Promise<Check> {
  const r = await timed((signal) => json(v.url, {}, signal));
  if (!r.ok || r.value.status !== 200) {
    return {
      key: `vendor.${v.key}`, group: "vendor", label: v.label, value: "unreachable",
      level: "unknown", ms: r.ms, link: v.link,
      note: `${v.why} — could not read their status page`,
    };
  }
  const body = r.value.body as { status?: { indicator?: string; description?: string } };
  const indicator = body?.status?.indicator ?? "unknown";
  const description = body?.status?.description ?? indicator;
  return {
    key: `vendor.${v.key}`, group: "vendor", label: v.label, value: description,
    level: levelForIndicator(indicator), ms: r.ms, link: v.link,
    note: v.why,
  };
}

// Google publishes an array of incidents; an incident without an `end` is open.
async function googleCheck(): Promise<Check> {
  const r = await timed((signal) => json("https://www.google.com/appsstatus/dashboard/incidents.json", {}, signal));
  const link = "https://www.google.com/appsstatus/dashboard/";
  if (!r.ok || r.value.status !== 200 || !Array.isArray(r.value.body)) {
    return {
      key: "vendor.google", group: "vendor", label: "Google", value: "unreachable",
      level: "unknown", ms: r.ms, link, note: "Google sign-in — could not read their status page",
    };
  }
  const open = (r.value.body as { end?: string }[]).filter((i) => !i.end);
  return {
    key: "vendor.google", group: "vendor", label: "Google", value: open.length ? `${open.length} open incident(s)` : "no open incidents",
    level: open.length ? "warn" : "good", ms: r.ms, link,
    note: "Google sign-in",
  };
}

// AWS serves its public event feed as UTF-16, which JSON.parse cannot take
// directly. Only events in our region matter to us.
async function awsCheck(): Promise<Check> {
  const region = process.env.AWS_REGION || "us-east-1";
  const link = "https://health.aws.amazon.com/health/status";
  const r = await timed(async (signal) => {
    const res = await fetch("https://health.aws.amazon.com/public/currentevents", { signal });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-16le").decode(buf).replace(/^﻿/, "");
    return { status: res.status, body: JSON.parse(text) as { arn?: string }[] };
  });
  if (!r.ok || r.value.status !== 200 || !Array.isArray(r.value.body)) {
    return {
      key: "vendor.aws", group: "vendor", label: "AWS", value: "unreachable",
      level: "unknown", ms: r.ms, link, note: "hosting, database and storage — could not read their status page",
    };
  }
  const ours = r.value.body.filter((e) => typeof e.arn === "string" && e.arn.includes(`:${region}:`));
  return {
    key: "vendor.aws", group: "vendor", label: "AWS", value: ours.length ? `${ours.length} event(s) in ${region}` : `no events in ${region}`,
    level: ours.length ? "warn" : "good", ms: r.ms, link,
    note: "hosting, database and storage",
  };
}

// Vendors with no machine-readable public status page. Our own probe above is
// the signal for these; the row exists so the absence is explicit rather than
// looking like an oversight.
const NO_FEED: { key: string; label: string; link: string; why: string }[] = [
  { key: "stripe", label: "Stripe", link: "https://status.stripe.com", why: "payments" },
  { key: "fal", label: "fal", link: "https://status.fal.ai", why: "upscaling" },
  { key: "byteplus", label: "BytePlus", link: "https://docs.byteplus.com/en/docs/ModelArk", why: "generation" },
];

async function vendorChecks(): Promise<Check[]> {
  const [pages, google, aws] = await Promise.all([
    Promise.all(STATUSPAGE.map(statuspageCheck)),
    googleCheck(),
    awsCheck(),
  ]);
  const noFeed: Check[] = NO_FEED.map((v) => ({
    key: `vendor.${v.key}`, group: "vendor", label: v.label, value: "no public feed",
    level: "unknown", link: v.link,
    note: `${v.why} — no machine-readable status page; see the direct check above`,
  }));
  return [...pages, google, aws, ...noFeed];
}

// ---------- assembly ----------

// "unknown" never drags the headline down: not knowing whether a vendor has
// an incident is not the same as being broken.
function overallOf(checks: Check[]): Level {
  if (checks.some((c) => c.level === "bad")) return "bad";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "good";
}

export async function systemStatus(force = false): Promise<Status> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const [internal, dependency, deprecation, vendor] = await Promise.all([
    internalChecks(),
    dependencyChecks(),
    deprecationChecks(),
    vendorChecks(),
  ]);
  const checks = [...configChecks(), ...internal, ...dependency, ...deprecation, ...vendor];
  const value: Status = {
    checkedAt: Date.now(),
    stage: process.env.SST_STAGE || process.env.STAGE || "unknown",
    overall: overallOf(checks),
    checks,
  };
  cache = { at: Date.now(), value };
  return value;
}
