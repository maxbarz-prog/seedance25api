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
// `perMillion` is the provider's own token rate, in USD per million tokens,
// which is how it actually bills:
//     tokens = duration x width x height x fps / 1024
// That formula reproduces our measured usage to within 0.04%, so a model's
// cost per second is arithmetic rather than something to guess — but only
// once its rate is known. A model with `perMillion: null` is defined here
// and deliberately NOT offered, because we sell at cost and must not price
// what we cannot cost. Fill in the rate from the provider console
// (Activation Management shows per-model pricing) and it appears by itself.
//
// `sd` covers renders up to 720p, `hd` is 1080p, and `withVideo` is the
// lower rate charged when a reference video rides along (an extension).
//
// Each model version also carries its own concurrency quota at the provider,
// so offering several widens total throughput, not just member choice.
export const MODELS = {
  "seedance-2.5": {
    id: "seedance-2.5",
    label: "Seedance 2.5",
    upstream: "dreamina-seedance-2-5-260628",
    maxDurationS: 30,
    accepts: ["text", "image"],
    perMillion: { sd: 10.7, hd: 10.7, withVideo: 6.4 },
  },
  "seedance-2.0": {
    id: "seedance-2.0",
    label: "Seedance 2.0",
    upstream: "dreamina-seedance-2-0-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    perMillion: { sd: 7.0, hd: 7.7, withVideo: 4.3 },
  },
  "seedance-2.0-fast": {
    id: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    upstream: "dreamina-seedance-2-0-fast-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    perMillion: { sd: 5.6, hd: 5.6, withVideo: 3.3 },
  },
  // --- available on the account, awaiting a confirmed token rate ---
  "seedance-2.0-mini": {
    id: "seedance-2.0-mini",
    label: "Seedance 2.0 Mini",
    upstream: "dreamina-seedance-2-0-mini-260615",
    maxDurationS: 15,
    accepts: ["text", "image"],
    perMillion: null,
  },
  "seedance-1.5-pro": {
    id: "seedance-1.5-pro",
    label: "Seedance 1.5 Pro",
    upstream: "seedance-1-5-pro-251215",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: null,
  },
  "seedance-1.0-pro": {
    id: "seedance-1.0-pro",
    label: "Seedance 1.0 Pro",
    upstream: "seedance-1-0-pro-250528",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: null,
  },
  "seedance-1.0-pro-fast": {
    id: "seedance-1.0-pro-fast",
    label: "Seedance 1.0 Pro Fast",
    upstream: "seedance-1-0-pro-fast-251015",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: null,
  },
  // The lite pair is split by input type — the model id says so — so each
  // only accepts one kind of prompt.
  "seedance-1.0-lite-t2v": {
    id: "seedance-1.0-lite-t2v",
    label: "Seedance 1.0 Lite (text)",
    upstream: "seedance-1-0-lite-t2v-250428",
    maxDurationS: 10,
    accepts: ["text"],
    perMillion: null,
  },
  "seedance-1.0-lite-i2v": {
    id: "seedance-1.0-lite-i2v",
    label: "Seedance 1.0 Lite (image)",
    upstream: "seedance-1-0-lite-i2v-250428",
    maxDurationS: 10,
    accepts: ["image"],
    perMillion: null,
  },
} as const;

export type ModelId = keyof typeof MODELS;

// Only models we can cost are sold. Everything else stays defined but inert.
export const MODEL_IDS = (Object.keys(MODELS) as ModelId[]).filter(
  (id) => MODELS[id].perMillion !== null
);
export const ALL_MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const DEFAULT_MODEL: ModelId = "seedance-2.5";

// Billing units per second of output, from the provider's token formula.
export const TOKENS_PER_SEC = {
  p480: (854 * 480 * 24) / 1024,
  p1080: (1920 * 1080 * 24) / 1024,
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
