import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { balance, ledgerFor, storageUsedBytes } from "@/lib/db";
import { PLANS } from "@/lib/config";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null });
  const plan = user.membership !== "none" ? PLANS[user.membership as keyof typeof PLANS] : null;
  const [bal, used, ledger] = await Promise.all([
    balance(user.id),
    storageUsedBytes(user.id),
    ledgerFor(user.id, 25),
  ]);
  return NextResponse.json({
    user: {
      email: user.email,
      membership: user.membership,
      membershipActive:
        user.membership !== "none" && (user.membership_renews_at ?? 0) > Date.now(),
      membershipRenewsAt: user.membership_renews_at,
      balanceCredits: bal,
      storageUsedBytes: used,
      storageQuotaBytes: plan ? plan.storageGb * 1e9 : 0,
      ledger,
    },
  });
}
