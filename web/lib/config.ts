// Central product configuration. Brand + plans are placeholders the owner can
// rename in one place; money values are in USD, credits are $0.001 each.

export const SITE_NAME = "Parcut";
export const SITE_TAGLINE = "AI video at cost. Really.";

export const CREDIT_USD = 0.001; // 1 credit = $0.001

export const MIN_TOPUP_USD = 10;
export const TOPUP_PRESETS_USD = [10, 20, 50];

export const PLANS = {
  monthly: {
    id: "monthly",
    label: "Monthly",
    priceUsd: 8,
    interval: "month" as const,
    storageGb: 20,
  },
  annual: {
    id: "annual",
    label: "Annual",
    priceUsd: 69,
    interval: "year" as const,
    storageGb: 50,
  },
};

export type PlanId = keyof typeof PLANS;

// Generation limits mirror the upstream model contract (4-15s clips).
export const MIN_DURATION_S = 4;
export const MAX_DURATION_S = 15;
export const DEFAULT_DURATION_S = 5;
export const MAX_PROMPT_CHARS = 4000;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "21:9", "4:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
