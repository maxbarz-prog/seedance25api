import { CREDIT_USD, MODELS, ModelId, TOKENS_PER_SEC } from "./config";

// The pricing model. Every number here is a COST INPUT: provider rates per
// model, a delivery allocation for storage/egress, an operations overhead
// covering the fixed costs of running the service (hosting base, admin,
// support), and a payment-processing recovery factor. The public pricing
// page renders the same formula this module computes with.
//
// Generation cost is DERIVED, not tabulated. The provider bills tokens:
//     tokens = duration x width x height x fps / 1024
// and charges a published price per million of them, so cost per output
// second is that price times TOKENS_PER_SEC — arithmetic, not a guess. The
// per-model rates live in config.ts next to the model definition, which is
// the only place a new model has to be described.
//
// Every derived rate is still env-overridable so production can track an
// upstream price change without a deploy (COST_<MODEL>_480P_PER_SEC etc.,
// where <MODEL> is the model id shortened the way envKey() below does it:
// seedance-2.0-fast -> SD20_FAST).

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// seedance-2.5 -> SD25, seedance-2.0-fast -> SD20_FAST,
// seedance-1.0-lite-t2v -> SD10_LITE_T2V. Keeps the COST_SD25_* /
// COST_SD20_* names already set in SSM working unchanged.
function envKey(model: ModelId): string {
  const [version, ...rest] = model.replace(/^seedance-/, "").split("-");
  return ["SD" + version.replace(".", ""), ...rest.map((s) => s.toUpperCase())].join("_");
}

export type UpscaleFactor = 2 | 4;

export interface GenRates {
  p480: number;
  p1080: number;
  // Requests carrying a reference video (extensions) bill at a lower price
  // per token, but the reference clip's seconds count as input. These are the
  // with-video rate over the plain rate, per resolution.
  videoInputRatio480: number;
  videoInputRatio1080: number;
}

// Per-second provider cost for one model, from its token rate, with each
// number overridable from the environment.
function genRates(model: ModelId): GenRates | null {
  const per = MODELS[model].perMillion;
  // A model with no confirmed token rate is not sellable: we sell at cost and
  // cannot cost what we do not know.
  if (!per) return null;
  const k = envKey(model);
  return {
    p480: envNum(`COST_${k}_480P_PER_SEC`, (per.sd * TOKENS_PER_SEC.p480) / 1e6),
    p1080: envNum(`COST_${k}_1080P_PER_SEC`, (per.hd * TOKENS_PER_SEC.p1080) / 1e6),
    videoInputRatio480: envNum(`COST_${k}_VIDEO_INPUT_RATIO`, per.withVideo / per.sd),
    videoInputRatio1080: envNum(`COST_${k}_VIDEO_INPUT_RATIO_1080P`, per.withVideo / per.hd),
  };
}

export function rates() {
  const gen = {} as Record<ModelId, GenRates | null>;
  for (const id of Object.keys(MODELS) as ModelId[]) gen[id] = genRates(id);
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
  const r = rates();
  const d = input.durationS;
  const ctx = input.contextS ?? 0;
  const gen = r.gen[input.model];
  if (!gen) throw new Error(`no confirmed provider rate for ${input.model}`);
  const genSeconds = d + ctx;
  let providerUsd: number;
  if (input.mode === "native-1080p") {
    providerUsd = gen.p1080 * genSeconds * (ctx > 0 ? gen.videoInputRatio1080 : 1);
  } else {
    const up = input.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec;
    providerUsd = gen.p480 * genSeconds * (ctx > 0 ? gen.videoInputRatio480 : 1) + up * d;
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
