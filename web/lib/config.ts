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

// Generation models on offer, best first. Duration ceilings mirror each
// model's contract. Each model version carries its own concurrency quota at
// the provider, so offering more than one also widens the throughput we can
// draw on, not just the choice a member gets.
export const MODELS = {
  "seedance-2.5": { id: "seedance-2.5", label: "Seedance 2.5", maxDurationS: 30 },
  "seedance-2.0": { id: "seedance-2.0", label: "Seedance 2.0", maxDurationS: 15 },
  "seedance-2.0-fast": { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", maxDurationS: 15 },
} as const;

export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const DEFAULT_MODEL: ModelId = "seedance-2.5";

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
