import { NextRequest, NextResponse } from "next/server";
import { BillingInterval, PAID_PLAN_IDS, PlanId } from "@/lib/config";
import Stripe from "stripe";
import {
  applyMembership,
  applyTopup,
  stripeClient,
  stripeEnabled,
  syncSubscription,
} from "@/lib/billing";
import { setStripeIds, userById, userByStripeCustomer } from "@/lib/db";
import { grantPeriodCredits } from "@/lib/grants";
import { effectivePlan } from "@/lib/plan";
import { attachDiscount } from "@/lib/billing";
import { consumeReward, revokeReferral, rewardsFor, vestReferral } from "@/lib/referrals";

// Stripe webhook. Credits and membership activate ONLY here (or via the dev
// mock), i.e. only after funds actually clear. Signature-verified; top-up
// grants are idempotent via the checkout session id. Subscription events
// keep membership in step with renewals, cancellations and failed payments.

export async function POST(req: NextRequest) {
  if (!stripeEnabled()) return NextResponse.json({ error: "Not configured." }, { status: 404 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, sig!, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.userId;
      if (!userId || !(await userById(userId))) break;
      const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
      if (s.metadata?.kind === "topup") {
        await applyTopup(userId, Number(s.metadata.usd), s.id);
        if (customerId) await setStripeIds(userId, customerId, null);
      } else if (s.metadata?.kind === "membership") {
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
        // The plan and billing interval both ride on the session metadata we
        // set at checkout; anything unrecognised falls back to the cheapest
        // paid tier rather than granting more than was paid for.
        const plan = (PAID_PLAN_IDS as string[]).includes(s.metadata.plan ?? "")
          ? (s.metadata.plan as PlanId)
          : "standard";
        const interval: BillingInterval = s.metadata.interval === "year" ? "year" : "month";
        await applyMembership(userId, plan, interval);
        if (customerId) await setStripeIds(userId, customerId, subId);
        // Pull the authoritative period end straight away.
        if (subId) await syncSubscription(await stripeClient().subscriptions.retrieve(subId));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const subRef = inv.parent?.subscription_details?.subscription;
      const subId = typeof subRef === "string" ? subRef : subRef?.id;
      if (!subId) break;
      const sub = await stripeClient().subscriptions.retrieve(subId);
      await syncSubscription(sub);
      // A renewal's allocation, handed over as soon as the money clears
      // rather than waiting for the sweep. Idempotent per period, so this and
      // the sweep cannot both pay out.
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const member = await userByStripeCustomer(customerId);
      if (member) {
        await grantPeriodCredits(member.id, effectivePlan(member));

        // The referee has now actually paid, so whoever referred them has
        // earned their reward. Only on the FIRST invoice of a subscription:
        // billing_reason distinguishes that from every renewal after it, and a
        // referral pays out once.
        if (inv.billing_reason === "subscription_create") await vestReferral(member.id);

        // And this member's own turn, if they have rewards waiting: one per
        // billing period, attached now so it comes off the next invoice. Never
        // two at once — attachDiscount refuses when a discount is already on
        // the subscription, which is what keeps the queue sequential.
        if ((await rewardsFor(member.id)).pending > 0) {
          if (await attachDiscount(member, "referral")) await consumeReward(member.id);
        }
      }
      break;
    }
    // Money came back. Withdraw the referrer's reward if it has not been spent
    // on an invoice yet — the whole reason rewards are discounts rather than
    // credits, which would already be gone by now.
    case "charge.refunded":
    case "charge.dispute.created": {
      // A Charge carries the customer; a Dispute does not, so resolve it
      // through the charge it is against. Without this step disputes — the
      // case this exists for — would silently never revoke anything.
      const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
      let charge: Stripe.Charge | null = null;
      if (obj.object === "charge") {
        charge = obj;
      } else {
        const ref = obj.charge;
        const chargeId = typeof ref === "string" ? ref : ref?.id;
        if (chargeId) charge = await stripeClient().charges.retrieve(chargeId);
      }
      const chargeCustomer =
        typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id ?? null;
      if (!chargeCustomer) break;
      const member = await userByStripeCustomer(chargeCustomer);
      if (member) {
        await revokeReferral(member.id, event.type === "charge.refunded" ? "refunded" : "disputed");
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
