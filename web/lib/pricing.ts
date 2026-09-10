import { CREDIT_USD, MODELS, ModelId, RateTable, tokensFor } from "./config";

// The pricing model. Every number here is a COST INPUT: provider rates per
// model, a delivery allocation for storage/egress, an operations overhead
// covering the fixed costs of running the service (hosting base, admin,
// support), and a payment-processing recovery factor. The public pricing
// page renders the same formula this module computes with.
//
// Generation cost is DERIVED, not tabulated. The provider bills tokens:
//     tokens = (input duration + output duration) x w x h x fps / 1024
// and charges a published price per million of them, so cost per second is
// arithmetic. The per-model rates live in config.ts next to the model
// definition, which is the only place a new model has to be described.
//
// Provider rates live in config.ts and are NOT env-overridable per model:
// an override pins one number and silently ignores promotions, the
// audio/video-input tiers and the model's own frame size, which is how a
// stale value quietly sold below cost before. Correct config.ts instead.
// The delivery, overhead and processing terms remain tunable from SSM.

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type UpscaleFactor = 2 | 4;

// A provider promotion counts only while it is actually running. Reading the
// clock here — rather than baking a discounted number into the registry — is
// what makes the rate revert to list by itself when the promotion lapses.
function discountFor(model: ModelId, tier: "sd" | "hd", now: number): number {
  const d = (MODELS[model] as { discount?: { pct: number; until: string; applies: readonly string[] } })
    .discount;
  if (!d || !d.applies.includes(tier)) return 0;
  const until = Date.parse(d.until);
  if (!Number.isFinite(until) || now >= until) return 0;
  return d.pct;
}

export interface GenRates {
  // USD per million tokens, net of any live promotion. Cost per render is
  // this times the tokens that render will actually bill, which depends on
  // the model's own frame size — so there is no single per-second figure.
  sd: number;
  hd: number | null;
  sdWithVideo: number;
  hdWithVideo: number | null;
}

export interface RateOptions {
  // Seedance 1.5 Pro bills more for a video with a soundtrack.
  audio?: boolean;
  now?: number;
}

function genRates(model: ModelId, opts: RateOptions = {}): GenRates | null {
  const entry = MODELS[model] as { perMillion: RateTable | null; audio?: RateTable };
  // No confirmed token rate means the model is not sellable: we sell at cost
  // and cannot cost what we do not know.
  if (!entry.perMillion) return null;
  const table = opts.audio && entry.audio ? entry.audio : entry.perMillion;
  const now = opts.now ?? Date.now();
  const sdOff = 1 - discountFor(model, "sd", now);
  const hdOff = 1 - discountFor(model, "hd", now);
  return {
    sd: table.sd * sdOff,
    hd: table.hd === null ? null : table.hd * hdOff,
    sdWithVideo: table.sdWithVideo * sdOff,
    hdWithVideo: table.hdWithVideo === null ? null : table.hdWithVideo * hdOff,
  };
}

// Per-second cost, for the pricing page and anything that wants a headline
// figure. Derived from the model's own frame size, so it differs per model.
export function perSecondUsd(
  model: ModelId,
  tier: "sd" | "hd",
  opts: RateOptions = {}
): number | null {
  const g = genRates(model, opts);
  const tokens = tokensFor(model, tier, 1);
  const rate = tier === "sd" ? g?.sd : g?.hd;
  if (!g || tokens === null || rate == null) return null;
  return (rate * tokens) / 1e6;
}

export function rates(opts: RateOptions = {}) {
  const gen = {} as Record<ModelId, GenRates | null>;
  for (const id of Object.keys(MODELS) as ModelId[]) gen[id] = genRates(id, opts);
  return {
    gen,
    // Provider: upscaler, per source second. ByteDance Video Upscaler via fal,
    // published 30fps rates: $0.0072/s to 1080p, $0.0288/s to 4K.
    upscale2xPerSec: envNum("COST_UPSCALE_2X_PER_SEC", 0.0072),
    upscale4xPerSec: envNum("COST_UPSCALE_4X_PER_SEC", 0.0288),
    // Storage + CDN delivery allocation, per video.
    deliveryPerVideo: envNum("COST_DELIVERY_PER_VIDEO", 0.01),
    // Operations overhead: hosting base, admin, support — as a fraction of
    // the direct cost.
    overheadPct: envNum("COST_OVERHEAD_PCT", 0.1),
    // Payment processing recovery, as a fraction of the charged price.
    processingPct: envNum("COST_PROCESSING_PCT", 0.035),
  };
}

export interface QuoteInput {
  model: ModelId;
  durationS: number;
  mode: "upscaled-1080p" | "native-1080p";
  upscaleFactor?: UpscaleFactor;
  // Extensions only: seconds of reference video sent with the request. The
  // provider bills those as input, at the with-video rate for the whole
  // request; the upscaler only ever sees the new output seconds.
  contextS?: number;
  audio?: boolean;
  now?: number;
}

export interface Quote {
  credits: number;
  usd: number;
  perSecUsd: number;
}

// price = (provider + delivery) x (1 + overhead) / (1 - processing), rounded
// up to a whole credit. Processing divides (not multiplies) because the fee
// is charged on the final price.
export function quote(input: QuoteInput): Quote {
  const r = rates({ audio: input.audio, now: input.now });
  const d = input.durationS;
  const ctx = input.contextS ?? 0;
  const gen = r.gen[input.model];
  if (!gen) throw new Error(`no confirmed provider rate for ${input.model}`);
  const native = input.mode === "native-1080p";
  const tier = native ? "hd" : "sd";
  // The provider bills the reference clip's seconds as input, so an extension
  // is one render covering both.
  const tokens = tokensFor(input.model, tier, d + ctx);
  const rate = ctx > 0
    ? native ? gen.hdWithVideo : gen.sdWithVideo
    : native ? gen.hd : gen.sd;
  if (tokens === null || rate == null) {
    throw new Error(`${input.model} cannot render 1080p natively`);
  }
  let providerUsd = (rate * tokens) / 1e6;
  if (!native) {
    // The upscaler only ever sees the new output seconds.
    providerUsd += (input.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec) * d;
  }
  const usd =
    ((providerUsd + r.deliveryPerVideo) * (1 + r.overheadPct)) / (1 - r.processingPct);
  const credits = Math.ceil(usd / CREDIT_USD);
  return {
    credits,
    usd: credits * CREDIT_USD,
    perSecUsd: (credits * CREDIT_USD) / d,
  };
}

export function usdToCredits(usd: number): number {
  return Math.round(usd / CREDIT_USD);
}

export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD;
}

export function fmtUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
