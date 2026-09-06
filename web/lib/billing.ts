import Stripe from "stripe";
import { PLANS, PlanId, MIN_TOPUP_USD } from "./config";
import { addLedger, setMembership, User } from "./db";
import { usdToCredits } from "./pricing";

// Stripe wrapper with a mock mode: without STRIPE_SECRET_KEY, checkout calls
// return internal mock-payment URLs so the whole flow is testable locally.
// Real mode uses Checkout Sessions (payment for top-ups, subscription for
// membership) and the webhook route applies the results idempotently.

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function createTopupCheckout(
  user: User,
  usd: number,
  origin: string
): Promise<{ url: string }> {
  if (usd < MIN_TOPUP_USD) throw new Error(`Minimum top-up is $${MIN_TOPUP_USD}`);
  if (!stripeEnabled()) {
    return { url: `/account?mock=topup&usd=${usd}` };
  }
  const s = await stripeClient().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Credits top-up` },
          unit_amount: Math.round(usd * 100),
        },
        quantity: 1,
      },
    ],
    customer_email: user.email,
    metadata: { userId: user.id, kind: "topup", usd: String(usd) },
    success_url: `${origin}/account?topup=success`,
    cancel_url: `${origin}/account?topup=cancelled`,
  });
  return { url: s.url! };
}

export async function createMembershipCheckout(
  user: User,
  planId: PlanId,
  origin: string
): Promise<{ url: string }> {
  const plan = PLANS[planId];
  if (!stripeEnabled()) {
    return { url: `/account?mock=subscribe&plan=${planId}` };
  }
  const s = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Membership (${plan.label})` },
          unit_amount: Math.round(plan.priceUsd * 100),
          recurring: { interval: plan.interval },
        },
        quantity: 1,
      },
    ],
    customer_email: user.email,
    metadata: { userId: user.id, kind: "membership", plan: planId },
    success_url: `${origin}/account?membership=success`,
    cancel_url: `${origin}/account?membership=cancelled`,
  });
  return { url: s.url! };
}

export async function applyTopup(
  userId: string,
  usd: number,
  externalId: string
): Promise<boolean> {
  const entry = await addLedger(userId, usdToCredits(usd), "topup", {
    memo: `Top-up $${usd.toFixed(2)}`,
    externalId,
  });
  return entry !== null;
}

export async function applyMembership(userId: string, planId: PlanId) {
  const now = Date.now();
  const renewMs = planId === "annual" ? 365 * 24 * 3600e3 : 30 * 24 * 3600e3;
  await setMembership(userId, planId, now + renewMs);
}
