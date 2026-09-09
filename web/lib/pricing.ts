import { CREDIT_USD, MODELS, ModelId, RateTable, TOKENS_PER_SEC } from "./config";

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
// Every derived rate is still env-overridable so production can track an
// upstream price change without a deploy (COST_<MODEL>_480P_PER_SEC and
// COST_<MODEL>_1080P_PER_SEC, where <MODEL> is the model id shortened the
// way envKey() below does it: seedance-2.0-fast -> SD20_FAST). An override
// is a blunt instrument — it pins one number and ignores discounts and the
// audio/video-input tiers — so prefer correcting config.ts.

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// seedance-2.5 -> SD25, seedance-2.0-fast -> SD20_FAST,
// seedance-1.0-lite-t2v -> SD10_LITE_T2V. Keeps any COST_SD25_* / COST_SD20_*
// names already set in SSM working unchanged.
function envKey(model: ModelId): string {
  const [version, ...rest] = model.replace(/^seedance-/, "").split("-");
  return ["SD" + version.replace(".", ""), ...rest.map((s) => s.toUpperCase())].join("_");
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
  // USD per second of output, at each resolution tier, already net of any
  // live promotion.
  p480: number;
  p1080: number | null;
  // The same, for a request that carries a reference video (an extension).
  p480WithVideo: number;
  p1080WithVideo: number | null;
}

export interface RateOptions {
  // Seedance 1.5 Pro bills more for a video with a soundtrack.
  audio?: boolean;
  now?: number;
}

// Per-second provider cost for one model, from its token rate.
function genRates(model: ModelId, opts: RateOptions = {}): GenRates | null {
  const entry = MODELS[model] as {
    perMillion: RateTable | null;
    audio?: RateTable;
  };
  // No confirmed token rate means the model is not sellable: we sell at cost
  // and cannot cost what we do not know.
  if (!entry.perMillion) return null;
  const table = opts.audio && entry.audio ? entry.audio : entry.perMillion;
  const now = opts.now ?? Date.now();
  const sdOff = 1 - discountFor(model, "sd", now);
  const hdOff = 1 - discountFor(model, "hd", now);
  const k = envKey(model);
  const perSec = (rate: number, tier: "sd" | "hd") =>
    (rate * (tier === "sd" ? sdOff : hdOff) *
      (tier === "sd" ? TOKENS_PER_SEC.p480 : TOKENS_PER_SEC.p1080)) /
    1e6;
  return {
    p480: envNum(`COST_${k}_480P_PER_SEC`, perSec(table.sd, "sd")),
    // A null hd rate means the provider cannot render 1080p on this model at
    // all, so there is nothing to override.
    p1080: table.hd === null ? null : envNum(`COST_${k}_1080P_PER_SEC`, perSec(table.hd, "hd")),
    p480WithVideo: perSec(table.sdWithVideo, "sd"),
    p1080WithVideo: table.hdWithVideo === null ? null : perSec(table.hdWithVideo, "hd"),
  };
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
  const genSeconds = d + ctx;
  let providerUsd: number;
  if (input.mode === "native-1080p") {
    const rate = ctx > 0 ? gen.p1080WithVideo : gen.p1080;
    if (rate === null) {
      throw new Error(`${input.model} cannot render 1080p natively`);
    }
    providerUsd = rate * genSeconds;
  } else {
    const up = input.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec;
    providerUsd = (ctx > 0 ? gen.p480WithVideo : gen.p480) * genSeconds + up * d;
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
