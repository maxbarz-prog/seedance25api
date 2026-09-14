import {
  BillingInterval,
  DEFAULT_PLAN,
  MODELS,
  FREE_MAX_DURATION_S,
  FREE_MODEL,
  FREE_QUALITY,
  PLANS,
  PlanId,
  planPriceUsd,
} from "./config";
import { User } from "./db";

// One place that answers "what may this member do?".
//
// Two older membership values are still on rows in the database: "none" from
// before every account had a plan, and "monthly"/"annual" from the single
// paid tier that preceded these. Mapping them here rather than migrating
// keeps the mapping visible and reversible.
export function planOf(user: Pick<User, "membership"> | null | undefined): PlanId {
  if (!user) return DEFAULT_PLAN;
  const m = user.membership as string;
  if (m in PLANS) return m as PlanId;
  // The old single paid tier was closest to Standard; nobody is downgraded
  // by the rename.
  if (m === "monthly" || m === "annual") return "standard";
  return DEFAULT_PLAN;
}

export function intervalOf(user: Pick<User, "membership" | "billing_interval">): BillingInterval {
  if (user.billing_interval) return user.billing_interval;
  // Grandfathered: the old "annual" membership was a yearly subscription.
  return (user.membership as string) === "annual" ? "year" : "month";
}

// A paid plan lapses; free never does. Anyone whose subscription has run out
// falls back to free rather than losing access altogether — they keep their
// library and any credits they bought.
export function effectivePlan(
  user: Pick<User, "membership" | "membership_renews_at"> | null | undefined,
  now = Date.now()
): PlanId {
  if (!user) return DEFAULT_PLAN;
  const plan = planOf(user);
  if (PLANS[plan].monthlyUsd === 0) return plan;
  return (user.membership_renews_at ?? 0) > now ? plan : DEFAULT_PLAN;
}

// A deactivated account keeps everything but does nothing: no generating, no
// billing. Reversible by design — see app/api/account/route.ts.
export function isDeactivated(user: Pick<User, "deactivated_at"> | null | undefined): boolean {
  return !!user?.deactivated_at;
}

export function storageQuotaBytes(
  user: Pick<User, "membership" | "membership_renews_at">
): number {
  return PLANS[effectivePlan(user)].storageGb * 1e9;
}

export function canBuyCredits(
  user: Pick<User, "membership" | "membership_renews_at">
): boolean {
  return PLANS[effectivePlan(user)].canBuyCredits;
}

export function canUpscale(
  user: Pick<User, "membership" | "membership_renews_at">
): boolean {
  return PLANS[effectivePlan(user)].canUpscale;
}

// Higher runs first when the queue is contended. Not yet wired into the
// pipeline — recorded on the job so it is available when it is.
export function queuePriority(
  user: Pick<User, "membership" | "membership_renews_at">
): number {
  return PLANS[effectivePlan(user)].priority;
}

// How much of a balance is membership allocation rather than bought credit.
//
// `granted_credits` is maintained by the store: grants add to it, expiries and
// charges take from it (charges spend the granted half first — see
// lib/grants.ts). The clamp against the balance is a safety net, not the
// mechanism: it keeps the figure sane if the two ever drift.
export function grantedBalance(
  user: Pick<User, "granted_credits">,
  balanceCredits: number
): number {
  return Math.max(0, Math.min(balanceCredits, user.granted_credits ?? 0));
}

// What survives a renewal: a plan's allocation times its rollover months.
// Anything above that is forfeited when the next allocation lands.
export function rolloverCeiling(plan: PlanId): number {
  return PLANS[plan].credits * PLANS[plan].rolloverMonths;
}

export function priceOf(plan: PlanId, interval: BillingInterval): number {
  return planPriceUsd(plan, interval);
}

// What a Free account is allowed to render, checked server-side.
//
// The allocation buys exactly one cheapest-route video, so those are the only
// settings it can use. Returning the reason rather than a boolean lets the
// API say which part was refused — "Free renders at 480p" is actionable,
// "not allowed" is not.
export function freeRouteRefusal(opts: {
  model: string;
  quality: string;
  upscales: boolean;
  durationS: number;
}): string | null {
  if (opts.model !== FREE_MODEL) {
    const label = MODELS[FREE_MODEL as keyof typeof MODELS]?.label ?? FREE_MODEL;
    return `The Free plan generates with ${label}. Pick a plan to use the other models.`;
  }
  if (opts.quality !== FREE_QUALITY) {
    return `The Free plan renders at ${FREE_QUALITY}. Pick a plan for higher quality.`;
  }
  if (opts.upscales) {
    return "Upscaling needs a paid plan.";
  }
  if (opts.durationS > FREE_MAX_DURATION_S) {
    return `The Free plan makes ${FREE_MAX_DURATION_S}-second videos. Pick a plan for longer ones.`;
  }
  return null;
}
