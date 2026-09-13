import { NextRequest, NextResponse } from "next/server";
import { siteOrigin } from "@/lib/request";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { applyTopup, chargeSavedCard, createTopupCheckout } from "@/lib/billing";
import { MIN_TOPUP_USD } from "@/lib/config";
import { ledgerFor } from "@/lib/db";
import { accountFrozen, dailyTopupLimit, FROZEN_RESPONSE, topupsLast24hUsd } from "@/lib/money";
import { canBuyCredits, isDeactivated } from "@/lib/plan";

// How much may go on the saved card, silently, in a day. Above this the
// member is sent to the hosted page instead — same card, but Stripe's own
// fraud checks and the bank's 3-D Secure get their say. A stolen session
// cannot drain a card one silent request at a time; a member buying a lot
// merely sees the card page. The ledger is the counter, so there is no
// separate state to get out of step.
const SAVED_CARD_DAILY_USD = 300;

const Body = z.object({
  // Whole dollars: what the presets offer, and what keeps cents and credits
  // from ever disagreeing by a rounding error.
  usd: z.number().int().min(MIN_TOPUP_USD).max(1000),
  // Made by the browser for this one click; the same value on a retry means
  // the same charge, not a second one.
  attempt: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Deactivated means nothing is billed — that is the promise on the account
  // page, and it covers the card on file too.
  if (isDeactivated(user)) {
    return NextResponse.json(
      { error: "deactivated", message: "Reactivate your account before buying credits." },
      { status: 403 }
    );
  }
  if (await accountFrozen(user.id)) return NextResponse.json(FROZEN_RESPONSE, { status: 403 });
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
  // The daily limit: from the account's age, or the one support set for it.
  // Told plainly — the amount, what is left today, when it rises, and how to
  // ask for more — because a real customer who hits it should know exactly
  // what to do next, and a fraudster learns nothing they could not guess.
  const ledger = await ledgerFor(user.id, 200);
  const limit = await dailyTopupLimit(user);
  const todayUsd = topupsLast24hUsd(ledger);
  if (todayUsd + usd > limit.usdPerDay) {
    const room = Math.max(0, Math.floor(limit.usdPerDay - todayUsd));
    return NextResponse.json(
      {
        error: "topup_limit",
        message:
          `Your daily limit is $${limit.usdPerDay}` +
          (room > 0 ? ` and you have $${room} left today.` : " and you have used it for today.") +
          (limit.source === "age" && limit.nextUsdPerDay
            ? ` It rises to $${limit.nextUsdPerDay} in ${limit.risesInDays} day${limit.risesInDays === 1 ? "" : "s"}.`
            : "") +
          " To raise it, email support@remerged.ai.",
        limitUsd: limit.usdPerDay,
        remainingUsd: room,
      },
      { status: 429 }
    );
  }

  const charge =
    todayUsd + usd > SAVED_CARD_DAILY_USD
      ? ({ outcome: "needs_auth" } as const)
      : await chargeSavedCard(user, usd, parsed.data.attempt);
  if (charge.outcome === "charged") {
    // Granted here rather than waiting for payment_intent.succeeded so the
    // balance has moved by the time the page re-reads it. The webhook applies
    // the same top-up under the same id, and addLedger is idempotent on that
    // id, so whichever arrives second changes nothing.
    await applyTopup(user.id, usd, charge.paymentIntentId);
    return NextResponse.json({ charged: true, usd });
  }

  const { url } = await createTopupCheckout(user, usd, siteOrigin(req));
  return NextResponse.json({
    url,
    // Why they are being sent to Stripe, so the button can say something true.
    reason: charge.outcome === "needs_auth" ? "needs_auth" : "needs_card",
  });
}
