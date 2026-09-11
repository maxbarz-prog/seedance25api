import { NextResponse } from "next/server";
import { clerkEnabled, currentUser } from "@/lib/auth";
import { balance, ledgerFor, storageUsedBytes } from "@/lib/db";
import { PLANS } from "@/lib/config";
import {
  canBuyCredits,
  canUpscale,
  effectivePlan,
  grantedBalance,
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
      canBuyCredits: canBuyCredits(user),
      canUpscale: canUpscale(user),
      ledger,
    },
  });
}
