import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { REFERRAL_REWARD_USD, SITE_DOMAIN } from "@/lib/config";
import {
  claimReferralCookie,
  ensureReferralCode,
  referralFor,
  rewardsFor,
} from "@/lib/referrals";

// A member's own referral standing: their link, what they have earned, and
// whether someone referred them.
//
// This is also where a referral link gets claimed. Account rows are created
// lazily on first authenticated use, so there is no "user created" hook to
// attach it to — the first time a new member's account page loads, the cookie
// /r/<code> left behind becomes a referral record.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await claimReferralCookie(user.id);
  const [code, rewards, referredBy] = await Promise.all([
    ensureReferralCode(user.id),
    rewardsFor(user.id),
    referralFor(user.id),
  ]);

  return NextResponse.json({
    code,
    link: `https://${SITE_DOMAIN}/r/${code}`,
    rewardUsd: REFERRAL_REWARD_USD,
    rewards,
    // Whether this member arrived on someone else's link, and whether that has
    // paid out yet. Shown so the discount on their first month is explained
    // rather than mysterious.
    referred: referredBy
      ? {
          at: referredBy.createdAt,
          vested: !!referredBy.vestedAt,
          revoked: !!referredBy.revokedAt,
        }
      : null,
  });
}
