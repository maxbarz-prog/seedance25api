import { NextResponse } from "next/server";
import { clerkEnabled, currentUser } from "@/lib/auth";
import { balance, ledgerFor, storageUsedBytes } from "@/lib/db";
import { PLANS } from "@/lib/config";
import { creditRefund } from "@/lib/economics";
import {
  canBuyCredits,
  canUpscale,
  effectivePlan,
  grantedBalance,
  isDeactivated,
  intervalOf,
  storageQuotaBytes,
} from "@/lib/plan";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, auth: clerkEnabled() ? "clerk" : "builtin" });
  // The plan the member is actually on right now: a lapsed paid plan reads as
  // free, so every allowance below comes from one decision.
  const planId = effectivePlan(user);
  const plan = PLANS[planId];
  const [bal, used, ledger] = await Promise.all([
    balance(user.id),
    storageUsedBytes(user.id),
    ledgerFor(user.id, 25),
  ]);
  return NextResponse.json({
    auth: clerkEnabled() ? "clerk" : "builtin",
    user: {
      email: user.email,
      plan: planId,
      planLabel: plan.label,
      billingInterval: intervalOf(user),
      // "Active" means a paid subscription is running. Free is a plan, not a
      // subscription, so it is deliberately not active.
      membershipActive: plan.monthlyUsd > 0,
      membershipRenewsAt: user.membership_renews_at ?? null,
      balanceCredits: bal,
      // Of the balance, how much came with the plan and so can expire. The
      // rest was bought and never does. Spending takes the granted half
      // first, which is what grantedBalance encodes.
      grantedCredits: grantedBalance(user, bal),
      storageUsedBytes: used,
      storageQuotaBytes: storageQuotaBytes(user),
      // What a refund of unused BOUGHT credits would actually return, after
      // the card fee that is not recovered. Shown where credits are at
      // stake, so the policy is a number rather than a paragraph.
      creditRefundUsd: creditRefund(bal, grantedBalance(user, bal)).netUsd,
      canBuyCredits: canBuyCredits(user),
      canUpscale: canUpscale(user),
      // True once cancelled: the plan runs to membershipRenewsAt and stops.
      cancelAtPeriodEnd: !!user.cancel_at_period_end,
      deactivated: isDeactivated(user),
      deactivatedAt: user.deactivated_at ?? null,
      ledger,
    },
  });
}
