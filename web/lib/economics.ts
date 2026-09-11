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

// What a member can be refunded for credits they bought.
//
// Policy: subscription fees are never refunded — cancelling buys access to
// the end of the period already paid for instead. Credits ARE refundable,
// less the costs already incurred on them, which are two:
//
//   1. Credits already SPENT are gone. We paid a provider to render that
//      video the moment it was made; there is nothing left to return.
//   2. The card fee on the original purchase is not returned to us when we
//      refund, so it comes out of the refund rather than out of the margin
//      on an at-cost service.
//
// Plan credits are outside this entirely: they were granted, not bought, so
// there is no money behind them to return. Only the bought half is eligible.
export interface CreditRefund {
  // Bought credits still held — the only ones with money behind them.
  refundableCredits: number;
  grossUsd: number;
  // The card fee already paid on that amount, which a refund does not recover.
  processingUsd: number;
  netUsd: number;
}

export function creditRefund(
  balanceCredits: number,
  grantedCredits: number,
  c: PricingConstants = pricingConstants()
): CreditRefund {
  // Spending takes plan credits first, so whatever is left above the granted
  // portion is what was bought and never used.
  const refundableCredits = Math.max(0, balanceCredits - Math.max(0, grantedCredits));
  const grossUsd = refundableCredits * CREDIT_USD;
  const processingUsd = grossUsd * c.processingPct;
  return {
    refundableCredits,
    grossUsd,
    processingUsd,
    netUsd: Math.max(0, grossUsd - processingUsd),
  };
}
