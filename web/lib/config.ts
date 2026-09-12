// Central product configuration. Brand + plans are placeholders the owner can
// rename in one place; money values are in USD, credits are $0.001 each.

export const SITE_NAME = "Remerged";
export const SITE_TAGLINE = "AI video, priced at cost";
// The registered domain: what members see, and what links in outbound email
// point at. DNS for it lives at Cloudflare (see sst.config.ts).
export const SITE_DOMAIN = "remerged.ai";

// Where support mail is received. Its SES identity, DKIM, MX, SPF and DMARC
// are created by .github/workflows/mail-domain.yml, and the receipt rule in
// sst.config.ts accepts support@ on this domain alone. Only change this to a
// domain SES has actually verified — an unverified one silently receives
// nothing.
export const MAIL_DOMAIN = "remerged.ai";

export const CREDIT_USD = 0.01; // 1 credit = 1 cent

export const MIN_TOPUP_USD = 10;
export const TOPUP_PRESETS_USD = [10, 20, 50];

// Membership tiers. Credit allocations match Runway's wherever the margin
// allows it, so a member can compare like for like — the difference is that
// generation here is billed at cost, so the same credits go several times
// further. Max is the exception: at Runway's number it earns almost nothing
// on the annual price, so it is set from the margin instead. See
// lib/economics.ts, which derives both directions of that calculation.
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
// Paying yearly buys a cheaper month. Kept at 20% rather than 25% because a
// plan's credit allocation is a fixed dollar claim on the fee: the whole
// discount comes straight out of margin, and at 25% Pro annual was left with
// $3.62 a month. See lib/economics.ts.
export const ANNUAL_DISCOUNT = 0.2;

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
    // Set from the margin, not from Runway's figure.
    //
    // A granted credit spent costs us (1 - processing) x $0.01 in provider,
    // delivery and overhead, so an allocation is a direct claim on the plan
    // fee. Annual is the binding case — the same allocation for 25% less
    // money — and at $855/year, or $71.25 a month, this allocation leaves
    // about $12 a month if the member spends every credit.
    //
    // Runway's equivalent is 9,500. Matching it here would leave roughly
    // nothing on annual, and lose money the moment a cost moves against us.
    // creditsForMargin("max", "year", 12) recomputes this if the overhead or
    // processing constants change; the admin page shows the live figure and
    // the status page fails if any plan's margin goes negative.
    credits: 5875,
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

// The cheapest plan that can buy credits — derived, so the copy telling a
// free member what they need never names a tier that has stopped being the
// answer. Undefined only if no plan allows top-ups at all.
export const MIN_TOPUP_PLAN: PlanId | undefined = PLAN_IDS.find(
  (p) => PLANS[p].canBuyCredits
);

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
// `sd` covers 480p and 720p output, `hd` is 1080p — the rate tier is a
// PRICE band, not a frame size, and 720p is billed at the 480p rate on far
// more pixels (see QUALITIES). A null `hd` means the model cannot render
// 1080p at all (2.0 Fast and 2.0 Mini) and that quality is hidden for it. `withVideo` is the lower rate charged when a
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
    frameSize: { "480p": [854, 480], "720p": [1280, 720], "1080p": [1920, 1080] },
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
    frameSize: { "480p": [864, 496], "720p": [1280, 720], "1080p": [1920, 1080] },
  },
  "seedance-2.0-fast": {
    id: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    upstream: "dreamina-seedance-2-0-fast-260128",
    maxDurationS: 15,
    accepts: ["text", "image"],
    // 480p/720p only — the provider does not offer 1080p or 4K here.
    perMillion: { sd: 5.6, hd: null, sdWithVideo: 3.3, hdWithVideo: null },
    frameSize: { "480p": [864, 496], "720p": [1280, 720], "1080p": null },
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
    frameSize: { "480p": [864, 496], "720p": [1280, 720], "1080p": null },
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
    frameSize: { "480p": [864, 480], "720p": [1280, 720], "1080p": [1920, 1088] },
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
    frameSize: { "480p": [864, 480], "720p": [1280, 720], "1080p": [1920, 1088] },
    activated: false,
  },
  "seedance-1.0-pro-fast": {
    id: "seedance-1.0-pro-fast",
    label: "Seedance 1.0 Pro Fast",
    upstream: "seedance-1-0-pro-fast-251015",
    maxDurationS: 10,
    accepts: ["text", "image"],
    perMillion: { sd: 1.0, hd: 1.0, sdWithVideo: 1.0, hdWithVideo: 1.0 },
    frameSize: { "480p": [864, 480], "720p": [1280, 720], "1080p": [1920, 1088] },
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
    frameSize: { "480p": [864, 480], "720p": [1280, 720], "1080p": [1920, 1088] },
    activated: false,
  },
  "seedance-1.0-lite-i2v": {
    id: "seedance-1.0-lite-i2v",
    label: "Seedance 1.0 Lite (image)",
    upstream: "seedance-1-0-lite-i2v-250428",
    maxDurationS: 10,
    accepts: ["image"],
    perMillion: null,
    frameSize: { "480p": [864, 480], "720p": [1280, 720], "1080p": [1920, 1088] },
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
//      in `frameSize` above, rather than one global guess. (720p, measured
//      separately, happens to be 1280x720 on all four — but that had to be
//      checked, not assumed.)
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

// Estimated billed tokens for one render, at the quality the model was asked
// for. The frame size is per model AND per quality, because the provider does
// not emit one canonical size for a named resolution.
export function tokensFor(model: ModelId, quality: Quality, seconds: number): number | null {
  const size = MODELS[model].frameSize[quality];
  if (!size) return null;
  return (framesFor(seconds) * size[0] * size[1] * TOKEN_SAFETY) / 1024;
}

// How a finished video is produced: a RENDER QUALITY the model is asked for,
// and an UPSCALE target applied to it. Two independent choices, which is how
// the member sees them.
//
// The default is 480p rendered, upscaled to 4K. It is not a compromise:
// measured 2026-09-10, the upscaler turns a 480p render into a true
// 3840x2160 for $0.0288 per source second, while a native 1080p render of
// the same clip costs 4-5x as much in provider tokens and comes back at a
// lower resolution. The render dominates the bill either way, so buying
// pixels at the upscaler is the cheapest quality available.

export const QUALITIES = {
  "480p": {
    id: "480p",
    label: "480p",
    // Which band of the provider's rate table this quality is billed in.
    // NOT the frame size: 720p is billed at the same rate per token as 480p,
    // on 2.2x as many pixels, so it costs about 2.2x as much to render.
    rateTier: "sd" as const,
    note: "Cheapest render. With an upscaler on top this is the best value on the site.",
  },
  "720p": {
    id: "720p",
    label: "720p",
    rateTier: "sd" as const,
    note: "More real detail before upscaling, at a little over twice the render cost of 480p.",
  },
  "1080p": {
    id: "1080p",
    label: "1080p",
    rateTier: "hd" as const,
    note: "The model renders full HD itself. Several times the price, and not offered on every model.",
  },
} as const;

export type Quality = keyof typeof QUALITIES;
export const QUALITY_IDS = Object.keys(QUALITIES) as Quality[];
export const DEFAULT_QUALITY: Quality = "480p";

// Quality tiers whose frame size has been MEASURED against a real billed
// generation, per model. An unverified tier is not offered: a frame size
// guessed low sells below cost and one guessed high overcharges, and
// estimates are held to 0..+1% of the invoice.
//
// All three are measured. 720p was added 2026-09-11 by
// .github/workflows/model-frame-size.yml: one 4s clip per model, billed
// token count read back and inverted through tokens = frames x w x h / 1024,
// cross-checked against the delivered file with ffprobe. Every model billed
// 87,300 tokens over 97 frames — 921,600 px, exactly 1280x720 — and the
// billed figure agreed with the delivered frame in all four cases.
//
// Worth noting it did NOT have to come out that way: at 480p this family
// emits two different frame sizes (854x480 and 864x496, a 4.5% spread),
// which is precisely why the measurement is not optional.
export const VERIFIED_QUALITIES: readonly Quality[] = ["480p", "720p", "1080p"];

export const UPSCALES = {
  "4k": {
    id: "4k",
    label: "4K",
    resolution: "3840x2160",
    // What the upscaler is asked for; also picks which of its two published
    // rates applies.
    target: "4k" as const,
    factor: 4 as const,
  },
  "1080p": {
    id: "1080p",
    label: "1080p",
    resolution: "1920x1080",
    target: "1080p" as const,
    factor: 2 as const,
  },
  none: {
    id: "none",
    label: "No upscale",
    resolution: null,
    target: null,
    factor: 0 as const,
  },
} as const;

export type Upscale = keyof typeof UPSCALES;
export const UPSCALE_IDS = Object.keys(UPSCALES) as Upscale[];
export const DEFAULT_UPSCALE: Upscale = "4k";

// The combinations that mean something. Upscaling 1080p to 1080p is a no-op,
// so it is not a route.
const MODE_PAIRS: [Quality, Upscale][] = [
  ["480p", "4k"],
  ["480p", "1080p"],
  ["480p", "none"],
  ["720p", "4k"],
  ["720p", "1080p"],
  ["720p", "none"],
  ["1080p", "4k"],
  ["1080p", "none"],
];

export interface OutputModeInfo {
  id: string;
  quality: Quality;
  upscale: Upscale;
  // What the member ends up with.
  label: string;
  resolution: string;
  renderedAt: string;
  // No upscaler involved: the model renders the deliverable itself.
  native: boolean;
  upscaleFactor: 0 | 2 | 4;
  blurb: string;
}

function modeId(quality: Quality, upscale: Upscale): string {
  return upscale === "none" ? quality : `${quality}-${upscale}`;
}

function describe(quality: Quality, upscale: Upscale): OutputModeInfo {
  const u = UPSCALES[upscale];
  const native = upscale === "none";
  return {
    id: modeId(quality, upscale),
    quality,
    upscale,
    label: native ? `${QUALITIES[quality].label} as rendered` : `${quality} → ${u.label}`,
    resolution: u.resolution ?? QUALITIES[quality].label,
    renderedAt: QUALITIES[quality].label,
    native,
    upscaleFactor: u.factor,
    blurb: native
      ? `Rendered at ${QUALITIES[quality].label} and delivered as-is, with no upscaler. ${QUALITIES[quality].note}`
      : `Rendered at ${QUALITIES[quality].label}, then AI-upscaled to ${u.label} (${u.resolution}). ${QUALITIES[quality].note}`,
  };
}

export const OUTPUT_MODES: Record<string, OutputModeInfo> = Object.fromEntries(
  MODE_PAIRS.map(([q, u]) => [modeId(q, u), describe(q, u)])
);

export type OutputMode = string;
// Only routes whose render quality has a measured frame size are offered.
export const OUTPUT_MODE_IDS: OutputMode[] = MODE_PAIRS.filter(([q]) =>
  VERIFIED_QUALITIES.includes(q)
).map(([q, u]) => modeId(q, u));
export const DEFAULT_MODE: OutputMode = modeId(DEFAULT_QUALITY, DEFAULT_UPSCALE);

// Job rows written before quality and upscale were separate choices carry the
// old three ids. Mapped here rather than migrated, so an old job still
// displays and still re-quotes correctly.
const LEGACY_MODES: Record<string, OutputMode> = {
  "upscaled-4k": "480p-4k",
  "upscaled-1080p": "480p-1080p",
  "native-1080p": "1080p",
};

// Strict: a legacy id maps to its current one, a current id passes through,
// and anything else is null. Null means "reject this request" — an API must
// not silently price a typo as the default.
export function resolveMode(mode: string | null | undefined): OutputMode | null {
  if (!mode) return null;
  if (mode in LEGACY_MODES) return LEGACY_MODES[mode];
  return mode in OUTPUT_MODES ? mode : null;
}

// Forgiving, for reading a job that already exists: a row carrying a mode we
// no longer recognise still has to display and still has to finish, so it
// falls back rather than throwing halfway through a paid generation.
export function modeInfo(mode: string | null | undefined): OutputModeInfo {
  return OUTPUT_MODES[resolveMode(mode) ?? DEFAULT_MODE];
}

// Which routes a given model can actually take: it must be able to render the
// quality asked for.
export function modesForModel(model: ModelId): OutputMode[] {
  return OUTPUT_MODE_IDS.filter((id) => supportsQuality(model, OUTPUT_MODES[id].quality));
}

export function supportsQuality(model: ModelId, quality: Quality): boolean {
  const entry = MODELS[model];
  if (!entry.frameSize[quality]) return false;
  // A quality with no rate in its band cannot be costed, so it is not sold.
  const tier = QUALITIES[quality].rateTier;
  return entry.perMillion?.[tier] != null;
}

export function qualitiesForModel(model: ModelId): Quality[] {
  return QUALITY_IDS.filter(
    (q) => VERIFIED_QUALITIES.includes(q) && supportsQuality(model, q)
  );
}

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
