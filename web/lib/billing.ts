import Stripe from "stripe";
import {
  BillingInterval,
  MIN_TOPUP_USD,
  PAID_PLAN_IDS,
  PLANS,
  PlanId,
  planPriceUsd,
  REFERRAL_REWARD_USD,
} from "./config";
import {
  addLedger,
  setCancelAtPeriodEnd,
  setMembership,
  setStripeIds,
  User,
  userByStripeCustomer,
} from "./db";
import { usdToCredits } from "./pricing";
import { grantPeriodCredits } from "./grants";
import { intervalOf, planOf } from "./plan";

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

// The two discounts this product issues, as Stripe coupons.
//
// Created on demand under fixed ids rather than kept in a dashboard: the code
// that relies on a coupon is the code that guarantees it exists, so a fresh
// Stripe account (or a switch from test to live keys) needs no manual setup.
//
// Both are `duration: "once"` — they come off ONE invoice. That is what makes
// the reward queue work: rewards are attached one at a time, in turn, and a
// member with twenty referrals gets twenty discounted months rather than one
// free year, which is the difference between a profitable month and a loss.
export type DiscountKind = "invite" | "referral";

const COUPON_IDS: Record<DiscountKind, string> = {
  invite: "remerged-invite-first-month-free",
  referral: `remerged-referral-${REFERRAL_REWARD_USD}usd`,
};

export async function ensureCoupon(kind: DiscountKind): Promise<string> {
  const id = COUPON_IDS[kind];
  const stripe = stripeClient();
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch {
    // Not there yet (or a different account). Create it under the same id.
  }
  await stripe.coupons.create(
    kind === "invite"
      ? { id, percent_off: 100, duration: "once", name: "First month free" }
      : {
          id,
          amount_off: Math.round(REFERRAL_REWARD_USD * 100),
          currency: "usd",
          duration: "once",
          name: `Referral: $${REFERRAL_REWARD_USD} off`,
        }
  );
  return id;
}

// Attach a one-off discount to an existing subscription, so it comes off the
// NEXT invoice. Refuses when a discount is already attached: Stripe would
// replace it, and two rewards on one month is exactly what the queue exists to
// prevent. Returns whether it went on.
export async function attachDiscount(user: User, kind: DiscountKind): Promise<boolean> {
  if (!stripeEnabled() || !user.stripe_subscription_id) return false;
  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if ((sub.discounts ?? []).length > 0) return false;
  const coupon = await ensureCoupon(kind);
  await stripe.subscriptions.update(user.stripe_subscription_id, { discounts: [{ coupon }] });
  return true;
}

export async function createMembershipCheckout(
  user: User,
  planId: PlanId,
  interval: BillingInterval,
  origin: string,
  discount?: DiscountKind
): Promise<{ url: string }> {
  const plan = PLANS[planId];
  if (!stripeEnabled()) {
    const d = discount ? `&discount=${discount}` : "";
    return { url: `/account?mock=subscribe&plan=${planId}&interval=${interval}${d}` };
  }
  const s = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${plan.label} membership${interval === "year" ? ", billed yearly" : ""}`,
          },
          unit_amount: Math.round(planPriceUsd(planId, interval) * 100),
          recurring: { interval },
        },
        quantity: 1,
      },
    ],
    ...(user.stripe_customer_id
      ? { customer: user.stripe_customer_id }
      : { customer_email: user.email }),
    ...(discount ? { discounts: [{ coupon: await ensureCoupon(discount) }] } : {}),
    metadata: { userId: user.id, kind: "membership", plan: planId, interval, ...(discount ? { discount } : {}) },
    subscription_data: { metadata: { userId: user.id, plan: planId, interval } },
    success_url: `${origin}/account?membership=success`,
    cancel_url: `${origin}/account?membership=cancelled`,
  });
  return { url: s.url! };
}

// Cancel at period end — never immediately. They have paid for the period
// they are in, so they keep it; the plan lapses to free when it runs out,
// which syncSubscription already handles on the resulting webhook.
//
// Returns the moment access ends, so the member can be told a date rather
// than left guessing.
export async function cancelSubscription(user: User): Promise<{ endsAt: number | null }> {
  if (stripeEnabled() && user.stripe_subscription_id) {
    const sub = await stripeClient().subscriptions.update(user.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    const endsAt = (sub.items.data[0]?.current_period_end ?? 0) * 1000 || null;
    // Mirror it immediately rather than waiting for the webhook, so the page
    // they are looking at tells the truth on the next render.
    await setMembership(user.id, planOf(user), endsAt, intervalOf(user));
    await setCancelAtPeriodEnd(user.id, true);
    return { endsAt };
  }
  // No Stripe (dev, or a comped membership): the renewal date is the whole
  // record of the subscription, so leaving it in place and not renewing IS
  // the cancellation. It lapses to free by itself — but the flag still has to
  // be set, or the account page cannot show that it happened.
  await setCancelAtPeriodEnd(user.id, true);
  return { endsAt: user.membership_renews_at ?? null };
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
// Start or renew a membership, and hand over the period's credits.
//
// An annual subscriber is billed once but granted monthly: paying up front
// buys a cheaper month, not a year of allocation to spend on day one. The
// renewal date is when the SUBSCRIPTION lapses; `grantPeriodCredits` runs
// once a month regardless.
export async function applyMembership(
  userId: string,
  planId: PlanId,
  interval: BillingInterval = "month",
  renewsAt?: number
) {
  const now = Date.now();
  const renewMs = interval === "year" ? 365 * 24 * 3600e3 : 30 * 24 * 3600e3;
  await setMembership(userId, planId, renewsAt ?? now + renewMs, interval);
  // Subscribing again undoes a previous cancellation.
  await setCancelAtPeriodEnd(userId, false);
  await grantPeriodCredits(userId, planId);
}

// Mirror a Stripe subscription's state onto the member: active/trialing ->
// membership with the period end as renewal date; anything else -> lapsed
// at the period end (they keep access they've paid for).
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = await userByStripeCustomer(customerId);
  if (!user) return;
  // The plan rides on the subscription metadata we set at checkout.
  // Anything unrecognised falls back to the cheapest paid tier rather than
  // granting more than was paid for.
  const plan: PlanId = (PAID_PLAN_IDS as string[]).includes(sub.metadata?.plan ?? "")
    ? (sub.metadata!.plan as PlanId)
    : "standard";
  const interval: BillingInterval =
    sub.items.data[0]?.price?.recurring?.interval === "year" ? "year" : "month";
  const periodEnd = (sub.items.data[0]?.current_period_end ?? 0) * 1000;
  const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  if (active && !sub.cancel_at_period_end) {
    await setMembership(user.id, plan, periodEnd, interval);
    await setCancelAtPeriodEnd(user.id, false);
    await setStripeIds(user.id, customerId, sub.id);
  } else if (active && sub.cancel_at_period_end) {
    // Access continues until period end, then lapses naturally.
    await setMembership(user.id, plan, periodEnd, interval);
    await setCancelAtPeriodEnd(user.id, true);
  } else {
    // A lapsed subscriber drops to free rather than losing the account:
    // they keep their library and any credits they bought.
    await setMembership(user.id, "free", null, null);
    await setCancelAtPeriodEnd(user.id, false);
  }
}
