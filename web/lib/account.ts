import { balance, deleteUser, jobsFor, ledgerFor, setMembership, setSystem, User } from "./db";
import { cancelSubscription, stripeEnabled, stripeClient } from "./billing";
import { deleteObject } from "./storage";
import { evidencePack } from "@/app/api/admin/evidence/route";
import { effectivePlan } from "./plan";
import { PLANS } from "./config";
import { clerkEnabled } from "./auth";

// Erasing an account, all the way down. Two doors lead here — the member
// pressing Delete on their account page, and Clerk telling us the identity
// was deleted on its side — and both must end in the same place: the
// subscription cancelled, the videos gone from storage, the rows erased,
// and the Clerk user removed so signing in again does not quietly hand the
// old account back. What stays is the evidence pack, keyed by email, in case
// a chargeback follows months later.
//
// The mapping from a Clerk user id to our row lives in the system store as
// clerk#<id>, written the first time the identity is seen (lib/auth.ts).
// Clerk's user.deleted webhook carries only the id, so without it nothing
// could say whose row to erase.

export function clerkMapKey(clerkId: string): string {
  return `clerk#${clerkId}`;
}

export async function eraseAccount(
  user: User,
  opts: { clerkId?: string | null; deleteClerkUser?: boolean } = {}
): Promise<{ deletedVideos: number; forfeitedCredits: number }> {
  const paid = PLANS[effectivePlan(user)].monthlyUsd > 0;
  // Cancel before erasing: once the user row is gone the webhook that would
  // normally reconcile the subscription has nothing to attach to.
  if (paid) await cancelSubscription(user).catch(() => {});
  if (stripeEnabled() && user.stripe_subscription_id) {
    await stripeClient()
      .subscriptions.cancel(user.stripe_subscription_id)
      .catch(() => {});
  }
  await setMembership(user.id, "free", null, null);

  // Videos first — the store's deleteUser removes the job rows, and once
  // those are gone nothing remembers which objects to remove.
  const jobs = await jobsFor(user.id, 10000);
  for (const j of jobs) {
    await deleteObject(j.video_url).catch(() => {});
    await deleteObject(j.poster_key).catch(() => {});
  }

  const remaining = await balance(user.id);
  // A chargeback can follow a deletion by months. Keep what would answer it —
  // the delivery record and the ledger, no videos — under the email, since
  // that is all a dispute will name. Nothing personal beyond what the dispute
  // itself carries.
  await setSystem(
    `evidence#${user.email.toLowerCase()}`,
    JSON.stringify({ deletedAt: Date.now(), ...evidencePack(user, jobs, await ledgerFor(user.id, 1000), null) })
  ).catch((e) => console.error("evidence snapshot failed:", e));
  await deleteUser(user.id);

  if (opts.clerkId) {
    await setSystem(clerkMapKey(opts.clerkId), null).catch(() => {});
    // The identity too, when we are the ones deleting. Left in place, the
    // next sign-in would create a fresh row for the same person as if they
    // were new — and hand them the free allocation again.
    if (opts.deleteClerkUser && clerkEnabled()) {
      try {
        const { clerkClient } = await import("@clerk/nextjs/server");
        await (await clerkClient()).users.deleteUser(opts.clerkId);
      } catch (e) {
        console.error(`clerk user ${opts.clerkId} not deleted:`, e);
      }
    }
  }
  return { deletedVideos: jobs.length, forfeitedCredits: remaining };
}
