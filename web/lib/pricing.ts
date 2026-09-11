import {
  CREDIT_USD,
  MODELS,
  ModelId,
  OUTPUT_MODES,
  OutputMode,
  QUALITIES,
  Quality,
  RateTable,
  resolveMode,
  tokensFor,
} from "./config";

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
// figure. Derived from the model's own frame size at that quality, so it
// differs per model and is not a simple multiple between qualities.
export function perSecondUsd(
  model: ModelId,
  quality: Quality,
  opts: RateOptions = {}
): number | null {
  const g = genRates(model, opts);
  const tokens = tokensFor(model, quality, 1);
  const tier = QUALITIES[quality].rateTier;
  const rate = tier === "sd" ? g?.sd : g?.hd;
  if (!g || tokens === null || rate == null) return null;
  return (rate * tokens) / 1e6;
}

// The parts of a price that come from the environment rather than from the
// model registry. Small enough to hand to the browser, which is the point:
// a quote is arithmetic, and making the member wait on a Lambda round trip
// to see a price change is indefensible.
export interface PricingConstants {
  upscale2xPerSec: number;
  upscale4xPerSec: number;
  deliveryPerVideo: number;
  overheadPct: number;
  processingPct: number;
}

export function pricingConstants(): PricingConstants {
  return {
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

export function rates(opts: RateOptions = {}) {
  const gen = {} as Record<ModelId, GenRates | null>;
  for (const id of Object.keys(MODELS) as ModelId[]) gen[id] = genRates(id, opts);
  return { gen, ...pricingConstants() };
}

export interface QuoteInput {
  model: ModelId;
  durationS: number;
  mode: OutputMode;
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
// The price, given the constants. Pure: no environment, no clock beyond what
// the caller passes, so the browser and the server compute the same number
// from the same inputs. The server is still the authority — the jobs route
// re-quotes before charging — but the member sees the answer instantly.
export function quoteWith(c: PricingConstants, input: QuoteInput): Quote {
  const d = input.durationS;
  const ctx = input.contextS ?? 0;
  const gen = genRates(input.model, { audio: input.audio, now: input.now });
  if (!gen) throw new Error(`no confirmed provider rate for ${input.model}`);
  const resolved = resolveMode(input.mode);
  if (!resolved) throw new Error(`unknown output mode ${input.mode}`);
  const out = OUTPUT_MODES[resolved];
  // What the model is asked to render decides both the frame size and which
  // band of the rate table applies. 720p sits in the same price band as 480p
  // but on twice the pixels, so its cost comes out of the token count, not
  // out of a different rate.
  const tier = QUALITIES[out.quality].rateTier;
  // The provider bills the reference clip's seconds as input, so an extension
  // is one render covering both.
  const tokens = tokensFor(input.model, out.quality, d + ctx);
  const rate = ctx > 0
    ? tier === "hd" ? gen.hdWithVideo : gen.sdWithVideo
    : tier === "hd" ? gen.hd : gen.sd;
  if (tokens === null || rate == null) {
    throw new Error(`${input.model} cannot render at ${out.quality}`);
  }
  let providerUsd = (rate * tokens) / 1e6;
  if (out.upscale !== "none") {
    // The upscaler only ever sees the new output seconds, and its rate is
    // per source second regardless of the target.
    providerUsd += (out.upscale === "4k" ? c.upscale4xPerSec : c.upscale2xPerSec) * d;
  }
  const usd = ((providerUsd + c.deliveryPerVideo) * (1 + c.overheadPct)) / (1 - c.processingPct);
  const credits = Math.ceil(usd / CREDIT_USD);
  // Credits are whole cents, so derive the dollar figure by dividing rather
  // than multiplying: 255 * 0.01 is 2.5500000000000003 in binary floating
  // point, and that lands in API responses.
  const charged = credits / 100;
  return { credits, usd: charged, perSecUsd: charged / d };
}

export function quote(input: QuoteInput): Quote {
  return quoteWith(pricingConstants(), input);
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
