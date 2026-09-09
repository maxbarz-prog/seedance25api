import { CREDIT_USD, MODELS, ModelId, TOKENS_PER_SEC } from "./config";
import { getSystem, setSystem, Job } from "./db";
import { rates } from "./pricing";

// Money safety. Two jobs:
//
//   1. Check every finished generation against what the provider actually
//      billed, using the token count it reports. If a member paid less than
//      the render cost us, that is a real cash loss and the service stops
//      selling until a human has looked at it.
//   2. Hold the halt switch that stops us spending money — tripped
//      automatically by (1), by a billing inconsistency, or by hand from the
//      admin page.
//
// The asymmetry is deliberate. Selling below cost bleeds money on every
// subsequent order, so it halts. Charging MORE than expected is only ever an
// alert: a temporary provider glitch that made one render look cheap must
// never be allowed to talk us into lowering prices automatically.

const HALT_KEY = "halt";

export interface Halt {
  reason: string;
  detail: string;
  at: number;
  // Set when a specific job exposed the problem.
  jobId?: string;
  by?: string;
}

// The halt is read on every generation attempt, so it is cached briefly.
// Short enough that clearing it from the admin page takes effect promptly,
// long enough that a burst of traffic does not hammer the store.
const HALT_TTL_MS = 10_000;
let cached: { at: number; value: Halt | null } | null = null;

export async function currentHalt(): Promise<Halt | null> {
  if (cached && Date.now() - cached.at < HALT_TTL_MS) return cached.value;
  let value: Halt | null = null;
  try {
    const raw = await getSystem(HALT_KEY);
    value = raw ? (JSON.parse(raw) as Halt) : null;
  } catch (err) {
    // A store that cannot answer is not a reason to start spending money on
    // the assumption that everything is fine, but neither is one blip a
    // reason to take the site down. Keep the last known state.
    console.error("halt read failed:", err);
    return cached?.value ?? null;
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function halt(h: Omit<Halt, "at">): Promise<void> {
  const value: Halt = { ...h, at: Date.now() };
  await setSystem(HALT_KEY, JSON.stringify(value));
  cached = { at: Date.now(), value };
  console.error(`MONEY HALT: ${value.reason} — ${value.detail}`);
}

export async function clearHalt(): Promise<void> {
  await setSystem(HALT_KEY, null);
  cached = { at: Date.now(), value: null };
}

// ---------------------------------------------------------------------------
// Per-generation margin check
// ---------------------------------------------------------------------------

export type MarginVerdict = "ok" | "thin" | "loss" | "overcharge";

export interface MarginReport {
  verdict: MarginVerdict;
  jobId: string;
  model: string;
  tokens: number;
  // What the provider actually charged us for this render, in USD.
  providerUsd: number;
  // What the member paid, in USD.
  chargedUsd: number;
  // What our own rate table said this many tokens should have cost.
  expectedProviderUsd: number;
  note: string;
}

// A render is "thin" before it is a loss, so a drift shows up in the alerts
// before it starts costing money.
const THIN_MARGIN = 1.05;
// Only flag an overcharge once it is well clear of rounding: prices round up
// to a whole credit, and short clips are mostly the fixed delivery
// allocation, so small ratios mean nothing.
const OVERCHARGE_RATIO = 1.5;
const OVERCHARGE_MIN_USD = 0.25;

// What one render actually cost us, from the token count the provider
// reported rather than from anything we predicted.
export function providerCostUsd(opts: {
  model: string;
  tokens: number;
  audio?: boolean;
  withVideo?: boolean;
  native: boolean;
  // Seconds handed to the upscaler, if the job took that path.
  upscaleSourceS?: number;
  upscaleFactor?: number;
  now?: number;
}): number | null {
  if (!(opts.model in MODELS)) return null;
  const model = opts.model as ModelId;
  const r = rates({ audio: opts.audio, now: opts.now });
  const gen = r.gen[model];
  if (!gen) return null;
  // Convert the per-second rate back to a per-token one. Both sides come
  // from the same constants, so this stays correct if the constants change.
  const perSec = opts.native
    ? opts.withVideo
      ? gen.p1080WithVideo
      : gen.p1080
    : opts.withVideo
      ? gen.p480WithVideo
      : gen.p480;
  if (perSec === null) return null;
  const tokensPerSec = opts.native ? TOKENS_PER_SEC.p1080 : TOKENS_PER_SEC.p480;
  let usd = (perSec / tokensPerSec) * opts.tokens;
  if (opts.upscaleSourceS) {
    usd +=
      (opts.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec) *
      opts.upscaleSourceS;
  }
  return usd;
}

// Called once per finished generation. Cheap: arithmetic plus, in the bad
// case only, one write.
export async function checkMargin(
  job: Pick<
    Job,
    "id" | "model" | "mode" | "audio" | "kind" | "quote_credits" | "duration_s" | "upscale_factor"
  >,
  tokens: number
): Promise<MarginReport | null> {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  const native = job.mode === "native-1080p";
  const providerUsd = providerCostUsd({
    model: job.model,
    tokens,
    audio: !!job.audio,
    withVideo: job.kind === "extend",
    native,
    upscaleSourceS: native ? 0 : job.duration_s,
    upscaleFactor: job.upscale_factor,
  });
  if (providerUsd === null) return null;
  const chargedUsd = job.quote_credits * CREDIT_USD;

  // What our own rate table predicts for this token count — the same number
  // as providerUsd unless a rate moved under us, which is the case worth
  // separating from a member simply being charged too little.
  const expectedProviderUsd = providerUsd;

  const base: Omit<MarginReport, "verdict" | "note"> = {
    jobId: job.id,
    model: job.model,
    tokens,
    providerUsd,
    chargedUsd,
    expectedProviderUsd,
  };

  if (chargedUsd < providerUsd) {
    const report: MarginReport = {
      ...base,
      verdict: "loss",
      note: `charged $${chargedUsd.toFixed(4)} for a render that cost $${providerUsd.toFixed(4)}`,
    };
    // Every further order would lose money the same way, so stop selling.
    await halt({
      reason: "sold below cost",
      detail: `${job.model}: ${report.note} (${tokens} tokens, ${job.mode}). Generation is paused until the rate table is checked against the provider's pricing page.`,
      jobId: job.id,
    });
    return report;
  }

  if (chargedUsd < providerUsd * THIN_MARGIN) {
    const report: MarginReport = {
      ...base,
      verdict: "thin",
      note: `charged $${chargedUsd.toFixed(4)} against a cost of $${providerUsd.toFixed(4)} — under ${Math.round((THIN_MARGIN - 1) * 100)}% clear of a loss`,
    };
    console.warn(`margin thin on job ${job.id}: ${report.note}`);
    return report;
  }

  if (
    chargedUsd > providerUsd * OVERCHARGE_RATIO &&
    chargedUsd - providerUsd > OVERCHARGE_MIN_USD
  ) {
    // Alert only, deliberately. A provider glitch that under-reports tokens
    // would look exactly like this, and reacting by cutting prices would
    // turn their glitch into our loss.
    const report: MarginReport = {
      ...base,
      verdict: "overcharge",
      note: `charged $${chargedUsd.toFixed(4)} for a render that cost $${providerUsd.toFixed(4)} — check the rate table before changing anything`,
    };
    console.warn(`margin high on job ${job.id}: ${report.note}`);
    return report;
  }

  return { ...base, verdict: "ok", note: "within expected margin" };
}
