import { CREDIT_USD, ModelId } from "./config";

// The pricing model. Every number here is a COST INPUT: provider rates per
// model, a delivery allocation for storage/egress, an operations overhead
// covering the fixed costs of running the service (hosting base, admin,
// support), and a payment-processing recovery factor. The public pricing
// page renders the same formula this module computes with.
//
// Rates are env-overridable so production can track upstream price changes
// without a deploy. Generation defaults are provisional until the validation
// run reads real provider billing; they err on the high side.

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type UpscaleFactor = 2 | 4;

export function rates() {
  return {
    // Provider: generation per output second, by model and resolution.
    gen: {
      "seedance-2.5": {
        p480: envNum("COST_SD25_480P_PER_SEC", 0.1028),
        p1080: envNum("COST_SD25_1080P_PER_SEC", 0.5202),
        // Requests that carry a reference video (extensions) are billed at a
        // lower per-token price, but the reference clip's seconds count as
        // input. Ratio of the with-video to the plain rate ($6.40 / $10.70).
        videoInputRatio: envNum("COST_SD25_VIDEO_INPUT_RATIO", 0.598),
      },
      "seedance-2.0": {
        p480: envNum("COST_SD20_480P_PER_SEC", 0.0432),
        p1080: envNum("COST_SD20_1080P_PER_SEC", 0.2091),
        videoInputRatio: envNum("COST_SD20_VIDEO_INPUT_RATIO", 1),
      },
      // NOT YET MEASURED. Defaults deliberately mirror Seedance 2.0 rather
      // than guessing lower: a fast variant is normally cheaper, so this errs
      // towards charging slightly too much rather than selling below cost.
      // Measure with provider-check before this model goes to production and
      // set COST_SD20_FAST_* in SSM.
      "seedance-2.0-fast": {
        p480: envNum("COST_SD20_FAST_480P_PER_SEC", 0.0432),
        p1080: envNum("COST_SD20_FAST_1080P_PER_SEC", 0.2091),
        videoInputRatio: envNum("COST_SD20_FAST_VIDEO_INPUT_RATIO", 1),
      },
    } satisfies Record<ModelId, { p480: number; p1080: number; videoInputRatio: number }>,
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
  const genSeconds = d + ctx;
  const ratio = ctx > 0 ? gen.videoInputRatio : 1;
  let providerUsd: number;
  if (input.mode === "native-1080p") {
    providerUsd = gen.p1080 * genSeconds * ratio;
  } else {
    const up = input.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec;
    providerUsd = gen.p480 * genSeconds * ratio + up * d;
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
