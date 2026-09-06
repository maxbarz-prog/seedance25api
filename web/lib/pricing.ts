import { CREDIT_USD } from "./config";

// The at-cost pricing model. Every number here is a COST INPUT, never a
// margin: provider rates for generation and upscaling, a delivery allocation
// for storage/egress, and a payment-processing recovery factor. The public
// pricing page renders the same formula this module computes with.
//
// Rates are env-overridable so production can track upstream price changes
// without a deploy. Defaults reflect verified provider pricing (Sep 2026).

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type UpscaleFactor = 2 | 4;

export function rates() {
  return {
    // Provider: 480p generation, per output second.
    gen480PerSec: envNum("COST_GEN_480P_PER_SEC", 0.1028),
    // Provider: native 1080p generation, per output second (premium tier).
    gen1080PerSec: envNum("COST_GEN_1080P_PER_SEC", 0.5686),
    // Provider: upscaler, per source second.
    upscale2xPerSec: envNum("COST_UPSCALE_2X_PER_SEC", 0.044),
    upscale4xPerSec: envNum("COST_UPSCALE_4X_PER_SEC", 0.077),
    // Storage + CDN delivery allocation, per video.
    deliveryPerVideo: envNum("COST_DELIVERY_PER_VIDEO", 0.01),
    // Payment processing recovery, as a fraction of the charged price.
    processingPct: envNum("COST_PROCESSING_PCT", 0.035),
  };
}

export interface QuoteInput {
  durationS: number;
  mode: "upscaled-1080p" | "native-1080p";
  upscaleFactor?: UpscaleFactor;
}

export interface Quote {
  credits: number;
  usd: number;
  perSecUsd: number;
}

// price = (provider costs + delivery) / (1 - processingPct), rounded up to a
// whole credit. Dividing (not multiplying) makes the processing recovery
// exact: fee is charged on the final price, not on the pre-fee cost.
export function quote(input: QuoteInput): Quote {
  const r = rates();
  const d = input.durationS;
  let providerUsd: number;
  if (input.mode === "native-1080p") {
    providerUsd = r.gen1080PerSec * d;
  } else {
    const up = input.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec;
    providerUsd = (r.gen480PerSec + up) * d;
  }
  const usd = (providerUsd + r.deliveryPerVideo) / (1 - r.processingPct);
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
