import {
  BillingInterval,
  PAID_PLAN_IDS,
  PLANS,
  PlanId,
  planPriceUsd,
  CREDIT_USD,
} from "./config";
import { pricingConstants, PricingConstants } from "./pricing";

// What a plan earns if the member spends every credit it grants.
//
// This is the number that decides whether a plan is viable, and it is derived
// rather than typed in — so if the overhead or processing constants move in
// SSM, the answer moves with them instead of quietly becoming a lie.
//
// The arithmetic falls out of the price formula:
//
//     price = (provider + delivery) x (1 + overhead) / (1 - processing)
//
// Rearranged, a credit spent costs us
//
//     provider + delivery + its share of overhead = price x (1 - processing)
//
// because the processing term inside a generation price recovers a card fee
// that is never charged on a GRANTED credit — the fee was paid once, on the
// subscription. So both sides of the margin carry the same (1 - processing)
// factor and it cancels:
//
//     margin = (1 - processing) x (revenue - credits x $0.01)
//
// Overhead is counted as a cost, not as margin. It is the allocated share of
// hosting, admin and support, and a plan that only covers its third-party
// bills is not actually earning anything.

export interface PlanMargin {
  plan: PlanId;
  interval: BillingInterval;
  // Subscription revenue apportioned to one month.
  monthlyRevenueUsd: number;
  // Card fees on that revenue.
  processingUsd: number;
  // Provider, delivery and overhead, if every granted credit is spent.
  fullUseCostUsd: number;
  // What is left. The figure a plan is set by.
  marginUsd: number;
}

export function planMargin(
  plan: PlanId,
  interval: BillingInterval,
  c: PricingConstants = pricingConstants()
): PlanMargin {
  const monthlyRevenueUsd =
    interval === "year" ? planPriceUsd(plan, "year") / 12 : PLANS[plan].monthlyUsd;
  const processingUsd = monthlyRevenueUsd * c.processingPct;
  const fullUseCostUsd = PLANS[plan].credits * CREDIT_USD * (1 - c.processingPct);
  return {
    plan,
    interval,
    monthlyRevenueUsd,
    processingUsd,
    fullUseCostUsd,
    marginUsd: monthlyRevenueUsd - processingUsd - fullUseCostUsd,
  };
}

// Every paid plan on both intervals, worst first. Annual is always the worse
// of the two — it is the same allocation for less money — so it is the one a
// plan has to be set by.
export function planMargins(c: PricingConstants = pricingConstants()): PlanMargin[] {
  return PAID_PLAN_IDS.flatMap((p) =>
    (["year", "month"] as BillingInterval[]).map((i) => planMargin(p, i, c))
  ).sort((a, b) => a.marginUsd - b.marginUsd);
}

// The allocation that hits a target margin on the given interval — the
// inverse of the formula above. Used to set a plan's credits rather than
// guess at them.
//
//     margin = revenue - revenue x processing - credits x $0.01 x (1 - processing)
//  => credits = (revenue x (1 - processing) - margin) / ($0.01 x (1 - processing))
export function creditsForMargin(
  plan: PlanId,
  interval: BillingInterval,
  targetUsd: number,
  c: PricingConstants = pricingConstants()
): number {
  const revenue =
    interval === "year" ? planPriceUsd(plan, "year") / 12 : PLANS[plan].monthlyUsd;
  const net = revenue * (1 - c.processingPct);
  return Math.floor((net - targetUsd) / (CREDIT_USD * (1 - c.processingPct)));
}
