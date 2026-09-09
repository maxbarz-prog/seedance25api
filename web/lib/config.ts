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

export const PLANS = {
  monthly: {
    id: "monthly",
    label: "Monthly",
    priceUsd: 19.99,
    interval: "month" as const,
    storageGb: 20,
  },
  annual: {
    id: "annual",
    label: "Annual",
    priceUsd: 199,
    interval: "year" as const,
    storageGb: 50,
  },
};

export type PlanId = keyof typeof PLANS;

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
  },
  "seedance-2.0-fast": {
    id: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    upstream: "dreamina-seedance-2-0-fast-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    // 480p/720p only — the provider does not offer 1080p or 4K here.
    perMillion: { sd: 5.6, hd: null, sdWithVideo: 3.3, hdWithVideo: null },
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
    activated: false,
  },
  "seedance-1.0-pro-fast": {
    id: "seedance-1.0-pro-fast",
    label: "Seedance 1.0 Pro Fast",
    upstream: "seedance-1-0-pro-fast-251015",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: { sd: 1.0, hd: 1.0, sdWithVideo: 1.0, hdWithVideo: 1.0 },
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
    activated: false,
  },
  "seedance-1.0-lite-i2v": {
    id: "seedance-1.0-lite-i2v",
    label: "Seedance 1.0 Lite (image)",
    upstream: "seedance-1-0-lite-i2v-250428",
    maxDurationS: 10,
    accepts: ["image"],
    perMillion: null,
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

// Billing units per second of output. Frame sizes are the LARGER of the
// variants these models actually emit — 480p comes back as 864x496 on the
// 2.0 series (measured) and 1080p as 1920x1088 on the 1.0 Pro pair (the
// provider's own token table) — so a quote errs a little high rather than
// selling a render for less than it costs.
export const TOKENS_PER_SEC = {
  p480: (864 * 496 * 24) / 1024,
  p1080: (1920 * 1088 * 24) / 1024,
} as const;

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
