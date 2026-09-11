// Central product configuration. Brand + plans are placeholders the owner can
// rename in one place; money values are in USD, credits are $0.001 each.

export const SITE_NAME = "Remerged";
export const SITE_TAGLINE = "AI video, priced at cost";
// The registered domain. Used for the support address on the legal pages and
// for links in outbound email, so it must match the deployed prod domain and
// the SES identity (both remerged.click).
export const SITE_DOMAIN = "remerged.click";

export const CREDIT_USD = 0.01; // 1 credit = 1 cent

export const MIN_TOPUP_USD = 10;
export const TOPUP_PRESETS_USD = [10, 20, 50];

// Membership tiers. Credit allocations deliberately match Runway's, so a
// member can compare like for like — the difference is that generation here
// is billed at cost, so the same credits go several times further.
//
// Everything a tier grants or withholds is declared here, not scattered
// through the code: the monthly credit allocation, how much of it survives a
// renewal, storage, whether credits can be bought at all, and where the
// member sits in the queue.
//
// Credits granted with a membership EXPIRE. Credits bought with money never
// do. That distinction is load-bearing — see `granted_credits` on the user
// row — because otherwise a year of allocations could be banked and spent at
// once, which is exactly what the margin cannot absorb.
export const ANNUAL_DISCOUNT = 0.25;

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    monthlyUsd: 0,
    // One grant on signup, never renewed.
    credits: 125,
    recurring: false,
    storageGb: 5,
    // Free members upscale like everyone else: a 480p clip is not a fair
    // sample of what the service does.
    canUpscale: true,
    // No card on file, so no top-ups. The allocation is the whole offer.
    canBuyCredits: false,
    // Months of unspent allocation that survive a renewal. Free never
    // renews, so this is moot.
    rolloverMonths: 0,
    priority: 0,
  },
  standard: {
    id: "standard",
    label: "Standard",
    monthlyUsd: 15,
    credits: 625,
    recurring: true,
    storageGb: 20,
    canUpscale: true,
    canBuyCredits: true,
    rolloverMonths: 0,
    priority: 1,
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyUsd: 35,
    credits: 2250,
    recurring: true,
    storageGb: 100,
    canUpscale: true,
    canBuyCredits: true,
    rolloverMonths: 0,
    priority: 2,
  },
  max: {
    id: "max",
    label: "Max",
    monthlyUsd: 95,
    credits: 7000,
    recurring: true,
    storageGb: 500,
    canUpscale: true,
    canBuyCredits: true,
    // One month of unspent allocation carries over.
    rolloverMonths: 1,
    priority: 3,
  },
} as const;

export type PlanId = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const PAID_PLAN_IDS = PLAN_IDS.filter((p) => PLANS[p].monthlyUsd > 0);
export const DEFAULT_PLAN: PlanId = "free";

export type BillingInterval = "month" | "year";

// A year costs twelve months less the annual discount. Credits are still
// granted monthly on an annual plan — paying up front buys a cheaper month,
// not a year of allocation to spend on day one.
export function planPriceUsd(plan: PlanId, interval: BillingInterval): number {
  const m = PLANS[plan].monthlyUsd;
  return interval === "year"
    ? Math.round(m * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100
    : m;
}

// What the member effectively pays per month on an annual plan.
export function effectiveMonthlyUsd(plan: PlanId, interval: BillingInterval): number {
  return interval === "year" ? planPriceUsd(plan, "year") / 12 : PLANS[plan].monthlyUsd;
}

// Every video model this account can call, newest first.
//
// Rates are the provider's own, in USD per MILLION TOKENS, taken from the
// ModelArk pricing page (docs.byteplus.com/en/docs/ModelArk/1544106). The
// provider bills tokens, not seconds:
//     tokens = (input video duration + output duration)
//              x width x height x frame rate / 1024
// so cost per second is arithmetic once the rate is known. Every rate below
// reproduces the provider's own worked price examples exactly.
//
// `sd` covers 480p and 720p output, `hd` is 1080p. A null `hd` means the
// model cannot render 1080p at all (2.0 Fast and 2.0 Mini) and the native
// path is hidden for it. `withVideo` is the lower rate charged when a
// reference video rides along, i.e. an extension — its seconds are billed
// as input.
//
// `audio` is a separate rate table for models that price by whether the
// output carries sound (Seedance 1.5 Pro: $1.20 silent, $2.40 with audio).
// Omitted where sound makes no difference to the bill.
//
// `discount` is a time-limited provider promotion. It applies only while
// now < until, so the rate reverts to list by itself the moment the
// promotion lapses — nobody has to remember. Selling at a discounted rate
// that has quietly expired is exactly how we ended up below cost before.
//
// A model with `perMillion: null` is defined here and deliberately NOT
// offered: we sell at cost and must not price what we cannot cost.
//
// `activated: false` means the provider lists and prices the model but this
// account may not call it — a submit answers 404 ModelNotOpen. Appearing in
// the /models catalogue does NOT mean it is callable; all nine of these are
// in that catalogue and only four work. Offering one a member cannot use
// gives them a failed generation, so these are excluded from MODEL_IDS too.
// Verified by .github/workflows/model-activation.yml, which is free to run:
// activate a model in the Ark Console, re-run it, and flip the flag.
//
// Each model version also carries its own concurrency quota at the provider,
// so offering several widens total throughput, not just member choice.

export interface RateTable {
  sd: number;
  hd: number | null;
  sdWithVideo: number;
  hdWithVideo: number | null;
}

export interface Discount {
  // Fraction off the list rate, e.g. 0.28 for "28% off".
  pct: number;
  // ISO instant the promotion ends. Provider states these in UTC+8.
  until: string;
  // Which rate tiers the promotion covers.
  applies: ("sd" | "hd")[];
}

export const MODELS = {
  "seedance-2.5": {
    id: "seedance-2.5",
    label: "Seedance 2.5",
    upstream: "dreamina-seedance-2-5-260628",
    maxDurationS: 30,
    accepts: ["text", "image"],
    perMillion: { sd: 10.7, hd: 11.7, sdWithVideo: 6.4, hdWithVideo: 7.0 },
    frameSize: { sd: [854, 480], hd: [1920, 1080] },
    // 28% off 1080p only, to 2026-09-17 14:00 UTC+8.
    discount: { pct: 0.28, until: "2026-09-17T06:00:00Z", applies: ["hd"] },
  },
  "seedance-2.0": {
    id: "seedance-2.0",
    label: "Seedance 2.0",
    upstream: "dreamina-seedance-2-0-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    perMillion: { sd: 7.0, hd: 7.7, sdWithVideo: 4.3, hdWithVideo: 4.7 },
    frameSize: { sd: [864, 496], hd: [1920, 1080] },
  },
  "seedance-2.0-fast": {
    id: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    upstream: "dreamina-seedance-2-0-fast-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    // 480p/720p only — the provider does not offer 1080p or 4K here.
    perMillion: { sd: 5.6, hd: null, sdWithVideo: 3.3, hdWithVideo: null },
    frameSize: { sd: [864, 496], hd: null },
    // 25% off, to 2026-10-07 14:00 UTC+8.
    discount: { pct: 0.25, until: "2026-10-07T06:00:00Z", applies: ["sd"] },
  },
  "seedance-2.0-mini": {
    id: "seedance-2.0-mini",
    label: "Seedance 2.0 Mini",
    upstream: "dreamina-seedance-2-0-mini-260615",
    maxDurationS: 15,
    accepts: ["text", "image"],
    perMillion: { sd: 3.5, hd: null, sdWithVideo: 2.1, hdWithVideo: null },
    frameSize: { sd: [864, 496], hd: null },
    // 60% off, to 2026-10-07 14:00 UTC+8.
    discount: { pct: 0.6, until: "2026-10-07T06:00:00Z", applies: ["sd"] },
  },
  "seedance-1.5-pro": {
    id: "seedance-1.5-pro",
    label: "Seedance 1.5 Pro",
    upstream: "seedance-1-5-pro-251215",
    maxDurationS: 10,
    accepts: ["text", "image"],
    // Priced by soundtrack, not resolution.
    perMillion: { sd: 1.2, hd: 1.2, sdWithVideo: 1.2, hdWithVideo: 1.2 },
    frameSize: { sd: [864, 480], hd: [1920, 1088] },
    audio: { sd: 2.4, hd: 2.4, sdWithVideo: 2.4, hdWithVideo: 2.4 },
    activated: false,
  },
  "seedance-1.0-pro": {
    id: "seedance-1.0-pro",
    label: "Seedance 1.0 Pro",
    upstream: "seedance-1-0-pro-250528",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: { sd: 2.5, hd: 2.5, sdWithVideo: 2.5, hdWithVideo: 2.5 },
    frameSize: { sd: [864, 480], hd: [1920, 1088] },
    activated: false,
  },
  "seedance-1.0-pro-fast": {
    id: "seedance-1.0-pro-fast",
    label: "Seedance 1.0 Pro Fast",
    upstream: "seedance-1-0-pro-fast-251015",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: { sd: 1.0, hd: 1.0, sdWithVideo: 1.0, hdWithVideo: 1.0 },
    frameSize: { sd: [864, 480], hd: [1920, 1088] },
    activated: false,
  },
  // The lite pair is split by input type — the model id says so — so each
  // only accepts one kind of prompt. Neither appears on the provider's
  // pricing page, so neither can be costed and neither is offered.
  "seedance-1.0-lite-t2v": {
    id: "seedance-1.0-lite-t2v",
    label: "Seedance 1.0 Lite (text)",
    upstream: "seedance-1-0-lite-t2v-250428",
    maxDurationS: 10,
    accepts: ["text"],
    perMillion: null,
    frameSize: { sd: [864, 480], hd: [1920, 1088] },
    activated: false,
  },
  "seedance-1.0-lite-i2v": {
    id: "seedance-1.0-lite-i2v",
    label: "Seedance 1.0 Lite (image)",
    upstream: "seedance-1-0-lite-i2v-250428",
    maxDurationS: 10,
    accepts: ["image"],
    perMillion: null,
    frameSize: { sd: [864, 480], hd: [1920, 1088] },
    activated: false,
  },
} as const;

export type ModelId = keyof typeof MODELS;

// Sold only if we can cost it AND this account can actually call it.
// Everything else stays defined but inert.
export const MODEL_IDS = (Object.keys(MODELS) as ModelId[]).filter(
  (id) =>
    MODELS[id].perMillion !== null &&
    (MODELS[id] as { activated?: boolean }).activated !== false
);
export const ALL_MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const DEFAULT_MODEL: ModelId = "seedance-2.5";

// Models that can render 1080p directly. The rest reach 1080p only through
// the upscaler, which is the cheaper path anyway.
export const NATIVE_1080P_MODEL_IDS = MODEL_IDS.filter(
  (id) => MODELS[id].perMillion?.hd != null
);

// How the provider counts what it bills:
//
//     tokens = frames x width x height / 1024
//
// Two details that a plain duration x fps gets wrong, both measured against
// real invoiced token counts in the 2026-09-09 bake-off:
//
//   1. A render carries ONE MORE FRAME than duration x fps. A 5 s clip at
//      24 fps comes back 5.04 s long and bills 121 frames, not 120 — worth
//      0.83%, and in the direction that costs us money.
//   2. "480p" is not one frame size. Seedance 2.5 emits 854x480; the 2.0
//      family emits 864x496 — a 4.5% difference. Each model carries its own
//      in `frameSize` above, rather than one global guess.
//
// Together these reproduce every measured token count exactly:
//   2.0 family 5 s 480p -> 50,639 predicted, 50,638 billed
//   2.5        5 s 480p -> 48,438 predicted, 48,437 billed
//   2.5        4 s 1080p-> 196,425 predicted, 196,425 billed
export const FPS = 24;
export const EXTRA_FRAMES = 1;
// A quote must never come in under what the provider charges, so the estimate
// carries a deliberate half-percent. That keeps it inside the +1% tolerance
// while leaving no room to land below cost on a render that runs a frame
// long.
export const TOKEN_SAFETY = 1.005;

export function framesFor(seconds: number): number {
  return Math.round(seconds * FPS) + EXTRA_FRAMES;
}

// Estimated billed tokens for one render.
export function tokensFor(model: ModelId, tier: "sd" | "hd", seconds: number): number | null {
  const size = MODELS[model].frameSize[tier];
  if (!size) return null;
  return (framesFor(seconds) * size[0] * size[1] * TOKEN_SAFETY) / 1024;
}

// How a finished video is produced. Three routes to a deliverable, and the
// member picks; nothing here is hidden from them.
//
// The default is 480p upscaled to 4K. It is not a compromise: measured
// 2026-09-10, the upscaler turns a 480p render into a true 3840x2160 for
// $0.0288 per source second, while a native 1080p render of the same clip
// costs 4-5x as much in provider tokens and comes back at a lower
// resolution. The generation dominates the bill either way, so buying more
// pixels at the upscaler is the cheapest quality available.
//
// `upscaleFactor` is what the upscaler is asked for; `native` means the model
// renders the final resolution itself and the upscaler is not used at all.
export const OUTPUT_MODES = {
  "upscaled-4k": {
    id: "upscaled-4k",
    label: "4K",
    resolution: "3840x2160",
    renderedAt: "480p",
    upscaleFactor: 4 as const,
    native: false,
    blurb:
      "Rendered at 480p, then AI-upscaled to 4K. Sharpest result and, because the render is cheap, far less than a native 1080p pass.",
  },
  "upscaled-1080p": {
    id: "upscaled-1080p",
    label: "1080p",
    resolution: "1920x1080",
    renderedAt: "480p",
    upscaleFactor: 2 as const,
    native: false,
    blurb: "Rendered at 480p, then AI-upscaled to 1080p. The cheapest way to a full-HD clip.",
  },
  "native-1080p": {
    id: "native-1080p",
    label: "1080p native",
    resolution: "1920x1080",
    renderedAt: "1080p",
    upscaleFactor: 2 as const,
    native: true,
    blurb:
      "Rendered at 1080p by the model itself, with no upscaler involved. No interpolated frames, but several times the price. Not offered on every model.",
  },
} as const;

export type OutputMode = keyof typeof OUTPUT_MODES;
export const OUTPUT_MODE_IDS = Object.keys(OUTPUT_MODES) as OutputMode[];
export const DEFAULT_MODE: OutputMode = "upscaled-4k";

export const MIN_DURATION_S = 4;
export const MAX_DURATION_S = 30; // absolute ceiling (Seedance 2.5)
export const DEFAULT_DURATION_S = 5;
export const MAX_PROMPT_CHARS = 4000;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] as const;
export const MAX_VARIATIONS = 4;
export const MAX_IMAGES = 4;
export const MAX_REF_VIDEOS = 2;
export const MAX_REF_AUDIOS = 1;
export const IMAGE_ROLES = ["reference", "first_frame", "last_frame"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];
// All input roles a job can carry (images plus reference video/audio).
export const INPUT_ROLES = [...IMAGE_ROLES, "reference_video", "reference_audio"] as const;
export type InputRole = (typeof INPUT_ROLES)[number];
// Extending an existing clip: how much can be added per step.
export const EXTEND_MIN_S = 4;
export const EXTEND_MAX_S = 15;
// Seconds of the source clip sent to the provider as the reference video for
// an extension. The provider bills the whole reference clip as input tokens,
// so only the tail goes up (trimmed server-side); it also fixes the price of
// an extension regardless of how long the source is.
export const EXTEND_CONTEXT_S = 5;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
