import { PAID_PLAN_IDS, PlanId, BillingInterval, PLANS } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createMembershipCheckout, DiscountKind } from "@/lib/billing";
import { checkInvite, consumeReward, redeemInvite, rewardsFor } from "@/lib/referrals";

const Body = z.object({
  plan: z.enum(PAID_PLAN_IDS as [string, ...string[]]),
  interval: z.enum(["month", "year"]).default("month"),
  // An admin invite, typed in by the member. Optional: without one, a queued
  // referral reward is spent instead, if they have any.
  invite: z.string().trim().max(32).optional(),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }
  const plan = parsed.data.plan as PlanId;
  const interval = parsed.data.interval as BillingInterval;

  // An invite beats a referral reward: it is worth more, it was given for a
  // reason, and it cannot be saved for later.
  let discount: DiscountKind | undefined;
  if (parsed.data.invite) {
    const check = await checkInvite(parsed.data.invite);
    if (!check.ok) {
      const why = {
        unknown: "That invite code does not exist.",
        expired: "That invite code has expired.",
        used: "That invite code has already been used.",
      }[check.reason];
      return NextResponse.json({ error: why }, { status: 400 });
    }
    if (check.invite.plan !== plan || interval !== "month") {
      return NextResponse.json(
        {
          error: `That invite is for ${PLANS[check.invite.plan].label}, billed monthly. Pick that plan to use it.`,
        },
        { status: 400 }
      );
    }
    discount = "invite";
  } else if ((await rewardsFor(user.id)).pending > 0) {
    discount = "referral";
  }

  const { url } = await createMembershipCheckout(user, plan, interval, req.nextUrl.origin, discount);

  // Spent at checkout, not on payment. A code still redeemable after the
  // hosted page has been opened could fund an unlimited number of discounted
  // sessions; an abandoned checkout costs the member a code, which is a far
  // smaller problem than that.
  if (discount === "invite" && parsed.data.invite) await redeemInvite(parsed.data.invite, user.id);
  if (discount === "referral") await consumeReward(user.id);

  return NextResponse.json({ url });
}
