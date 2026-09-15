import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { getSystem, userById } from "@/lib/db";
import { clerkMapKey, eraseAccount } from "@/lib/account";

// Clerk's webhook. One event matters: user.deleted, which means the identity
// is gone on Clerk's side — from the dashboard, or from a request we did
// not make — and our account must follow it, or the next sign-in with the
// same email would find the old row, credits and all.
//
// Signed by Clerk (svix) with CLERK_WEBHOOK_SIGNING_SECRET; anything that
// does not verify is refused before it is read. The endpoint is
// /api/auth/clerk, to be added in the Clerk dashboard under Webhooks with
// the user.deleted event subscribed.
export async function POST(req: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (e) {
    console.warn("clerk webhook refused:", e);
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }
  if (evt.type !== "user.deleted") return NextResponse.json({ ok: true, ignored: evt.type });
  const clerkId = evt.data.id;
  if (!clerkId) return NextResponse.json({ ok: true, ignored: "no id" });
  const userId = await getSystem(clerkMapKey(clerkId));
  const user = userId ? await userById(userId) : undefined;
  if (!user) {
    // An identity we never mapped — created before the mapping existed, or
    // never signed in here. Nothing to erase, and worth a line in the log.
    console.warn(`clerk user.deleted for ${clerkId}: no account mapped`);
    return NextResponse.json({ ok: true, erased: false });
  }
  const r = await eraseAccount(user, { clerkId, deleteClerkUser: false });
  console.log(`clerk user.deleted ${clerkId}: erased ${user.id} (${r.deletedVideos} videos, ${r.forfeitedCredits} credits)`);
  return NextResponse.json({ ok: true, erased: true });
}
