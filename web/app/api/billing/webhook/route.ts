import { NextRequest, NextResponse } from "next/server";
import { BillingInterval, PAID_PLAN_IDS, PlanId } from "@/lib/config";
import Stripe from "stripe";
import {
  applyMembership,
  applyTopup,
  attachDiscount,
  clawbackTopup,
  refundCharge,
  stripeClient,
  stripeEnabled,
  syncSubscription,
} from "@/lib/billing";
import { setStripeIds, User, userById, userByStripeCustomer } from "@/lib/db";
import { forfeitGrantedCredits, grantPeriodCredits } from "@/lib/grants";
import { freezeAccount } from "@/lib/money";
import { effectivePlan } from "@/lib/plan";
import {
  consumeReward,
  restoreReward,
  revokeReferral,
  rewardsFor,
  unredeemInvite,
  vestReferral,
} from "@/lib/referrals";

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
    // "Completed" means the member finished the page, not that the money is
    // here. With a card they are the same moment; with a bank debit or any
    // other delayed method the session completes UNPAID and the funds arrive
    // days later as checkout.session.async_payment_succeeded — or never. So
    // both events run the same fulfilment, and it looks at payment_status,
    // not at which event it was. Idempotent on the session id, so a session
    // that is paid at completion and then reported again grants once.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.userId;
      if (!userId || !(await userById(userId))) break;
      const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
      if (s.payment_status === "unpaid") {
        console.warn(`checkout ${s.id} for ${userId} completed unpaid — waiting for the funds`);
        break;
      }
      if (s.metadata?.kind === "topup") {
        // The amount Stripe collected, not the one we wrote into metadata
        // when the session was opened: those should agree, and the money is
        // the one to believe if they do not.
        const usd = (s.amount_total ?? 0) / 100;
        if (usd > 0) await applyTopup(userId, usd, s.id);
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
        // The first invoice is paid by now. invoice.paid vests this too, but
        // it can arrive BEFORE this event — and then it cannot find the member
        // by customer id, because it is this event that records it. Vesting
        // is idempotent, so both may try. Only real money vests: a first month
        // that an invite made free has not shown the referee will pay.
        if (s.payment_status === "paid" && (s.amount_total ?? 0) > 0) await vestReferral(userId);
      }
      break;
    }
    // Opened with a discount, never paid. The code or reward it was holding
    // goes back to the member, who can try again.
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.userId;
      if (!userId) break;
      if (s.metadata?.discount === "invite" && s.metadata.invite) {
        await unredeemInvite(s.metadata.invite, userId);
      } else if (s.metadata?.discount === "referral") {
        await restoreReward(userId);
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
        if (inv.billing_reason === "subscription_create" && inv.amount_paid > 0) {
          await vestReferral(member.id);
        }

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
    // A saved-card top-up, confirmed off-session by /api/billing/topup. That
    // route grants the credits itself so the balance is right immediately; this
    // is the belt to its braces, for the case where the request died between
    // Stripe accepting the charge and us writing the ledger. Idempotent on the
    // payment intent id, so the second one to arrive does nothing.
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.kind !== "topup") break;
      // A hosted-checkout top-up is granted by checkout.session.completed
      // under the session id; granting it here as well, under the intent id,
      // would be the same money twice.
      if (pi.metadata.via === "checkout") break;
      const userId = pi.metadata.userId;
      if (!userId || !(await userById(userId))) break;
      // What was actually received, in case it and the metadata ever differ.
      const received = pi.amount_received / 100;
      if (received > 0) await applyTopup(userId, received, pi.id);
      break;
    }
    // Money came back.
    //
    // A refunded or disputed TOP-UP takes its credits back out of the balance.
    // A refunded or disputed FIRST SUBSCRIPTION PAYMENT withdraws the referral
    // reward it earned, if that has not been spent on an invoice yet — the
    // whole reason rewards are discounts rather than credits, which would
    // already be gone by now. A refund of some later month is neither.
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
      if (!charge) break;
      const disputed = event.type === "charge.dispute.created";
      const member = await memberForCharge(charge);

      // Any dispute freezes the account: whatever the bank decides, this
      // member does not spend more of our money until a human has looked.
      if (disputed && member) {
        await freezeAccount(member.id, "disputed", `charge ${charge.id}, $${(charge.amount / 100).toFixed(2)}`);
      }

      if (charge.metadata?.kind === "topup") {
        const userId = charge.metadata.userId;
        // Only a full reversal, so a partial goodwill refund from the
        // dashboard does not put a member into the red. Partial ones are
        // logged for a human to settle by hand.
        const whole = disputed || charge.amount_refunded >= charge.amount;
        if (userId && whole && (await userById(userId))) {
          await clawbackTopup(userId, charge.amount / 100, charge.id);
        } else if (userId) {
          console.warn(
            `partial refund on top-up ${charge.id} for ${userId}: ${charge.amount_refunded}/${charge.amount} — credits not adjusted`
          );
        }
        break;
      }

      if (!member) break;
      // Which invoice this paid for says whether it is the one a referral
      // vested on. A charge no longer names its invoice directly; the invoice
      // payment that links them does. A dispute revokes regardless: a member
      // who charges back is not one whose referrals we honour.
      let first = disputed;
      const piRef = charge.payment_intent;
      const paymentIntent = typeof piRef === "string" ? piRef : piRef?.id;
      if (!first && paymentIntent) {
        const payments = await stripeClient().invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: paymentIntent },
          expand: ["data.invoice"],
          limit: 1,
        });
        const inv = payments.data[0]?.invoice;
        first = typeof inv === "object" && !inv.deleted && inv.billing_reason === "subscription_create";
      }
      if (first) await revokeReferral(member.id, disputed ? "disputed" : "refunded");

      // A disputed subscription payment ends the subscription now, not at the
      // period end: the bank has taken the money back, so the month it paid
      // for is not paid for. The unspent allocation goes with it; anything
      // the member bought outright stays. Stripe does none of this by itself.
      if (disputed && member.stripe_subscription_id) {
        await stripeClient()
          .subscriptions.cancel(member.stripe_subscription_id)
          .catch((e) => console.error(`cancel after dispute failed for ${member.id}:`, e));
        await forfeitGrantedCredits(member.id, "Membership payment disputed");
      }
      break;
    }
    // The card network has told Stripe the cardholder reported this charge
    // as fraud — this arrives before the dispute does, sometimes weeks
    // before. Refunding now means the dispute is never filed: no $15 fee,
    // nothing against our dispute rate, and the refund itself flows through
    // charge.refunded above to take the credits back. The account is frozen
    // and any subscription ended, because a stolen card is not a customer.
    case "radar.early_fraud_warning.created": {
      const efw = event.data.object as Stripe.Radar.EarlyFraudWarning;
      if (!efw.actionable) break;
      const chargeId = typeof efw.charge === "string" ? efw.charge : efw.charge.id;
      const charge = await stripeClient().charges.retrieve(chargeId);
      const member = await memberForCharge(charge);
      await refundCharge(chargeId, `efw-${efw.id}`);
      if (member) {
        await freezeAccount(member.id, "fraud warning", `charge ${chargeId}, ${efw.fraud_type}`);
        if (member.stripe_subscription_id) {
          await stripeClient()
            .subscriptions.cancel(member.stripe_subscription_id)
            .catch((e) => console.error(`cancel after fraud warning failed for ${member.id}:`, e));
          await forfeitGrantedCredits(member.id, "Membership payment reported as fraud");
        }
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

// Whose charge this is: the metadata we set says so for top-ups; the customer
// id does for everything else.
async function memberForCharge(charge: Stripe.Charge): Promise<User | undefined> {
  const byMeta = charge.metadata?.userId ? await userById(charge.metadata.userId) : undefined;
  if (byMeta) return byMeta;
  const customer = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  return customer ? userByStripeCustomer(customer) : undefined;
}
