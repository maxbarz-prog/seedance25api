import Stripe from "stripe";
import { PLANS, PlanId, MIN_TOPUP_USD } from "./config";
import {
  addLedger,
  setMembership,
  setStripeIds,
  User,
  userByStripeCustomer,
} from "./db";
import { usdToCredits } from "./pricing";

// Stripe wrapper with a mock mode: without STRIPE_SECRET_KEY, checkout calls
// return internal mock-payment URLs so the whole flow is testable locally.
// Real mode uses Checkout Sessions (payment for top-ups, subscription for
// membership); the webhook route applies results idempotently and keeps
// membership in sync with the Stripe subscription over its lifetime.

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
    ...(user.stripe_customer_id
      ? { customer: user.stripe_customer_id }
      : { customer_email: user.email }),
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
    ...(user.stripe_customer_id
      ? { customer: user.stripe_customer_id }
      : { customer_email: user.email }),
    metadata: { userId: user.id, kind: "membership", plan: planId },
    subscription_data: { metadata: { userId: user.id, plan: planId } },
    success_url: `${origin}/account?membership=success`,
    cancel_url: `${origin}/account?membership=cancelled`,
  });
  return { url: s.url! };
}

// Stripe-hosted portal for updating cards, switching plans, cancelling.
export async function createPortalSession(user: User, origin: string): Promise<{ url: string } | null> {
  if (!stripeEnabled() || !user.stripe_customer_id) return null;
  const s = await stripeClient().billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}/account`,
  });
  return { url: s.url };
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

// Used by the dev mock and by the initial checkout completion; renewals and
// lapses are handled by syncSubscription from webhook events.
export async function applyMembership(userId: string, planId: PlanId, renewsAt?: number) {
  const now = Date.now();
  const renewMs = planId === "annual" ? 365 * 24 * 3600e3 : 30 * 24 * 3600e3;
  await setMembership(userId, planId, renewsAt ?? now + renewMs);
}

// Mirror a Stripe subscription's state onto the member: active/trialing ->
// membership with the period end as renewal date; anything else -> lapsed
// at the period end (they keep access they've paid for).
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = await userByStripeCustomer(customerId);
  if (!user) return;
  const plan: PlanId = sub.metadata?.plan === "annual" ? "annual" : "monthly";
  const periodEnd = (sub.items.data[0]?.current_period_end ?? 0) * 1000;
  const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  if (active && !sub.cancel_at_period_end) {
    await setMembership(user.id, plan, periodEnd);
    await setStripeIds(user.id, customerId, sub.id);
  } else if (active && sub.cancel_at_period_end) {
    // Access continues until period end, then lapses naturally.
    await setMembership(user.id, plan, periodEnd);
  } else {
    await setMembership(user.id, "none", null);
  }
}
