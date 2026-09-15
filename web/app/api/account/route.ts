import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clerkEnabled, currentUser, session } from "@/lib/auth";
import { setDeactivated } from "@/lib/db";
import { cancelSubscription } from "@/lib/billing";
import { effectivePlan } from "@/lib/plan";
import { PLANS } from "@/lib/config";
import { eraseAccount } from "@/lib/account";

// Leaving. Three doors, deliberately separate, because they are not the same
// decision and a member should never discover afterwards that they picked a
// more final one than they meant to:
//
//   unsubscribe  stop paying. Keep the account, the library and any credits
//                bought. Access runs to the end of the period already paid
//                for, then the plan lapses to free.
//   deactivate   stop everything, reversibly. Cancels the subscription too,
//                and nothing generates, but the account and every video
//                survive and one click brings it all back.
//   delete       gone. Videos removed from storage, jobs and ledger erased,
//                the account row deleted. No undo, so it demands the email
//                typed out and says what is being forfeited first.

const Body = z.object({
  action: z.enum(["unsubscribe", "deactivate", "reactivate", "delete"]),
  // Delete only: the word "delete", typed. A confirmation that can be
  // clicked through without reading is not a confirmation.
  confirm: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { action, confirm } = parsed.data;
  const paid = PLANS[effectivePlan(user)].monthlyUsd > 0;

  if (action === "unsubscribe") {
    if (!paid) {
      return NextResponse.json(
        { error: "no_subscription", message: "You are not on a paid plan." },
        { status: 409 }
      );
    }
    const { endsAt } = await cancelSubscription(user);
    return NextResponse.json({
      ok: true,
      endsAt,
      message: endsAt
        ? `Cancelled. Your plan stays active until ${new Date(endsAt).toLocaleDateString()}, then moves to Free.`
        : "Cancelled. Your plan moves to Free at the end of the period.",
    });
  }

  if (action === "deactivate") {
    // Stop the money first. A deactivated account that quietly keeps billing
    // is the single worst outcome here.
    if (paid) await cancelSubscription(user);
    await setDeactivated(user.id, Date.now());
    const s = await session();
    s.destroy();
    await s.save();
    return NextResponse.json({
      ok: true,
      message: "Account deactivated. Sign in any time to bring it back.",
    });
  }

  if (action === "reactivate") {
    await setDeactivated(user.id, null);
    return NextResponse.json({ ok: true, message: "Welcome back." });
  }

  // delete. Confirmed by typing the word — the same for a password account
  // and one signed in with Google, which has no password to ask for.
  if ((confirm ?? "").trim().toLowerCase() !== "delete") {
    return NextResponse.json(
      {
        error: "confirm_mismatch",
        message: 'Type "delete" to confirm.',
      },
      { status: 400 }
    );
  }
  let clerkId: string | null = null;
  if (clerkEnabled()) {
    const { currentUser: clerkUser } = await import("@clerk/nextjs/server");
    clerkId = (await clerkUser())?.id ?? null;
  }
  const r = await eraseAccount(user, { clerkId, deleteClerkUser: true });
  const s = await session();
  s.destroy();
  await s.save();
  return NextResponse.json({
    ok: true,
    deletedVideos: r.deletedVideos,
    forfeitedCredits: r.forfeitedCredits,
    message: "Account deleted.",
  });
}
