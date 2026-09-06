import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { applyMembership, applyTopup, stripeClient, stripeEnabled } from "@/lib/billing";

// Stripe webhook. Credits and membership activate ONLY here (or via the dev
// mock), i.e. only after funds actually clear. Signature-verified; top-up
// grants are idempotent via the checkout session id.

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

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.metadata?.userId;
    if (userId && s.metadata?.kind === "topup") {
      await applyTopup(userId, Number(s.metadata.usd), s.id);
    } else if (userId && s.metadata?.kind === "membership") {
      await applyMembership(userId, s.metadata.plan === "annual" ? "annual" : "monthly");
    }
  }
  // TODO(prod): handle invoice.paid / customer.subscription.deleted to renew
  // and lapse memberships over time.

  return NextResponse.json({ received: true });
}
