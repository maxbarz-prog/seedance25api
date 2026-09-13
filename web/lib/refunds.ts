import { CREDIT_USD, REFUND_UNSPENT_SHARE } from "./config";
import { addLedger, balance, ledgerFor, setSystem, User } from "./db";
import { stripeClient, stripeEnabled } from "./billing";
import { grantedBalance } from "./plan";

// The standard refund, done from the admin desk rather than the Stripe
// dashboard, because it has three parts that must agree:
//
//   1. Only UNSPENT, BOUGHT credits are refunded — never plan allocation
//      (no money behind it) and never spent credits (the provider was paid).
//   2. They come back at REFUND_UNSPENT_SHARE of their value, in money, to the
//      cards the top-ups came from, newest first, each charge only up to what
//      it has left.
//   3. Every one of those credits leaves the balance in the same step, in one
//      ledger row that says what happened.
//
// A dashboard refund would do (2) without (1) or (3) — and its webhook would
// then claw back the WHOLE charge, spent credits included, which is exactly
// the over-refund this exists to avoid. So each charge touched here is marked
// (clawback-done#) and the webhook leaves it alone.

export interface UnspentRefund {
  credits: number;
  usd: number;
  refunds: { chargeId: string; usd: number }[];
  // Money we could not place on any charge — top-ups older than the ledger
  // window, or mock ones. Settle by hand if non-zero.
  unplacedUsd: number;
}

export async function refundUnspentCredits(user: User, by: string): Promise<UnspentRefund> {
  const bal = await balance(user.id);
  const credits = Math.max(0, bal - grantedBalance(user, bal));
  const usd = Math.floor(credits * CREDIT_USD * REFUND_UNSPENT_SHARE * 100) / 100;
  if (credits <= 0 || usd <= 0) return { credits: 0, usd: 0, refunds: [], unplacedUsd: 0 };

  const refunds: { chargeId: string; usd: number }[] = [];
  let remaining = usd;
  if (stripeEnabled()) {
    const stripe = stripeClient();
    const topups = (await ledgerFor(user.id, 500)).filter(
      (e) => e.kind === "topup" && e.external_id && !e.external_id.startsWith("mock_")
    );
    for (const t of topups) {
      if (remaining <= 0.005) break;
      const chargeId = await chargeForTopup(t.external_id!);
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId);
      const left = (charge.amount - charge.amount_refunded) / 100;
      if (left <= 0) continue;
      const amount = Math.min(left, remaining);
      // Marked before the refund is made, so the webhook that follows knows
      // the ledger has been handled here.
      await setSystem(`clawback-done#${chargeId}`, `admin-refund by ${by}`);
      await stripe.refunds.create(
        { charge: chargeId, amount: Math.round(amount * 100), reason: "requested_by_customer", metadata: { by } },
        { idempotencyKey: `unspent-${user.id}-${chargeId}-${credits}` }
      );
      refunds.push({ chargeId, usd: amount });
      remaining = Math.round((remaining - amount) * 100) / 100;
    }
  } else {
    remaining = 0;
  }

  const refundedUsd = Math.round((usd - remaining) * 100) / 100;
  // The credits leave whether or not every dollar found a charge: what could
  // not be placed is a support task, and leaving the credits would let them
  // be spent as well as refunded.
  await addLedger(user.id, -credits, "refund-out", {
    memo: `Refund of ${credits.toLocaleString()} unspent credits: $${refundedUsd.toFixed(2)} to card (${Math.round(
      REFUND_UNSPENT_SHARE * 100
    )}% of value)`,
    externalId: `refund-out#${user.id}#${Date.now()}`,
  });
  return { credits, usd: refundedUsd, refunds, unplacedUsd: remaining };
}

// The charge behind a top-up ledger row: saved-card top-ups carry the payment
// intent id, hosted ones the checkout session id.
async function chargeForTopup(externalId: string): Promise<string | null> {
  const stripe = stripeClient();
  try {
    if (externalId.startsWith("pi_")) {
      const pi = await stripe.paymentIntents.retrieve(externalId);
      return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    }
    if (externalId.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(externalId, { expand: ["payment_intent"] });
      const pi = session.payment_intent;
      if (!pi || typeof pi === "string") return null;
      return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    }
  } catch (err) {
    console.warn(`could not resolve charge for top-up ${externalId}:`, err);
  }
  return null;
}
