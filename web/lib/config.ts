// Central product configuration. Brand + plans are placeholders the owner can
// rename in one place; money values are in USD, credits are $0.001 each.

export const SITE_NAME = "Remerged";
export const SITE_TAGLINE = "AI video, priced at cost";
export const SITE_DOMAIN = "remerged.app";

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

// Generation models on offer. Duration ceilings mirror each model's contract.
export const MODELS = {
  "seedance-2.5": { id: "seedance-2.5", label: "Seedance 2.5", maxDurationS: 30 },
  "seedance-2.0": { id: "seedance-2.0", label: "Seedance 2.0", maxDurationS: 15 },
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
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
