import { balance, deleteUser, jobsFor, ledgerFor, setMembership, setSystem, User } from "./db";
import { cancelSubscription, stripeEnabled, stripeClient } from "./billing";
import { deleteObject } from "./storage";
import { effectivePlan } from "./plan";
import { PLANS } from "./config";
import { clerkEnabled } from "./auth";
import { audit } from "./audit";

// Erasing an account, all the way down. Two doors lead here — the member
// pressing Delete on their account page, and Clerk telling us the identity
// was deleted on its side — and both must end in the same place: the
// subscription cancelled, the videos gone from storage, the rows erased,
// and the Clerk user removed so signing in again does not quietly hand the
// old account back. What stays is one line in the audit diary, in case
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

  // A chargeback can follow a deletion by months, so the numbers that would
  // answer one outlive the account: how many videos were made, how many were
  // opened and downloaded, what was bought and spent.
  //
  // This used to be a snapshot keyed by the email address, holding the whole
  // ledger and, for every job, the prompt, the IP address and the user agent,
  // with no expiry. That is a profile of a person kept forever under their own
  // address, which is not what answering a dispute needs. What goes in now is
  // counts and totals in the diary, under a hash, with a date it expires — and
  // nothing on any sign-up path can see it, so deleting and remaking an
  // account behaves exactly as it did the first time.
  const ledger = await ledgerFor(user.id, 1000);
  const sum = (kind: string) =>
    ledger.filter((e) => e.kind === kind).reduce((a, e) => a + e.delta_credits, 0);
  await audit("account_deleted", {
    email: user.email,
    account: user.id,
    props: {
      createdAt: user.created_at,
      membership: user.membership,
      stripeCustomerId: user.stripe_customer_id ?? null,
      jobs: jobs.length,
      delivered: jobs.filter((j) => j.status === "ready").length,
      downloads: jobs.reduce((a, j) => a + (j.download_count ?? 0), 0),
      creditsBought: sum("topup"),
      creditsGranted: sum("grant"),
      creditsSpent: -sum("charge"),
      balanceAtDeletion: remaining,
    },
  });
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
