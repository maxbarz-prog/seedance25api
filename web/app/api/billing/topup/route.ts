import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { applyTopup, chargeSavedCard, createTopupCheckout } from "@/lib/billing";
import { MIN_TOPUP_USD } from "@/lib/config";
import { canBuyCredits } from "@/lib/plan";

const Body = z.object({ usd: z.number().min(MIN_TOPUP_USD).max(1000) });

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Top-ups need a plan that allows them: Free has no card on file, and its
  // allocation is the whole offer.
  if (!canBuyCredits(user)) {
    return NextResponse.json(
      {
        error: "membership_required",
        message: "Buying credits needs a paid plan — pick one on your account page.",
      },
      { status: 402 }
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Top-ups are $${MIN_TOPUP_USD}–$1000.` },
      { status: 400 }
    );
  }
  const usd = parsed.data.usd;

  // The card that paid for their plan is already on file, so use it. Returning
  // a URL for someone to re-enter a card they have already given us is the
  // friction this removes; Stripe only needs to be involved again when the
  // card is gone or the bank wants the member present.
  const charge = await chargeSavedCard(user, usd);
  if (charge.outcome === "charged") {
    // Granted here rather than waiting for payment_intent.succeeded so the
    // balance has moved by the time the page re-reads it. The webhook applies
    // the same top-up under the same id, and addLedger is idempotent on that
    // id, so whichever arrives second changes nothing.
    await applyTopup(user.id, usd, charge.paymentIntentId);
    return NextResponse.json({ charged: true, usd });
  }

  const { url } = await createTopupCheckout(user, usd, req.nextUrl.origin);
  return NextResponse.json({
    url,
    // Why they are being sent to Stripe, so the button can say something true.
    reason: charge.outcome === "needs_auth" ? "needs_auth" : "needs_card",
  });
}
