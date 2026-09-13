import { PAID_PLAN_IDS, PlanId, BillingInterval, PLANS } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createMembershipCheckout, DiscountKind } from "@/lib/billing";
import { effectivePlan } from "@/lib/plan";
import {
  checkInvite,
  consumeReward,
  redeemInvite,
  restoreReward,
  rewardsFor,
  unredeemInvite,
} from "@/lib/referrals";

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

  // One subscription per member. The page hides the plan buttons while one
  // is running, but the page is not the guard: a second checkout would open a
  // second Stripe subscription, bill twice, and overwrite the first one here.
  if (PLANS[effectivePlan(user)].monthlyUsd > 0 && user.stripe_subscription_id) {
    return NextResponse.json(
      {
        error: "already_subscribed",
        message: "You already have a plan. Change or cancel it from Manage subscription.",
      },
      { status: 409 }
    );
  }

  // An invite beats a referral reward: it is worth more, it was given for a
  // reason, and it cannot be saved for later.
  let discount: DiscountKind | undefined;
  const invite = parsed.data.invite?.toUpperCase();
  if (invite) {
    const check = await checkInvite(invite);
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

  // Claimed BEFORE the checkout exists, then spent on it. The claim is
  // atomic, so two requests with one code cannot both open a discounted
  // session; and a code or reward is never left attached to a checkout that
  // was never created. If the session expires unpaid, the webhook hands the
  // claim back (checkout.session.expired).
  if (discount === "invite" && invite && !(await redeemInvite(invite, user.id))) {
    return NextResponse.json({ error: "That invite code has already been used." }, { status: 400 });
  }
  if (discount === "referral" && !(await consumeReward(user.id))) discount = undefined;

  try {
    const { url } = await createMembershipCheckout(
      user,
      plan,
      interval,
      req.nextUrl.origin,
      discount ? { kind: discount, invite: discount === "invite" ? invite : undefined } : undefined
    );
    return NextResponse.json({ url });
  } catch (err) {
    if (discount === "invite" && invite) await unredeemInvite(invite, user.id);
    if (discount === "referral") await restoreReward(user.id);
    throw err;
  }
}
