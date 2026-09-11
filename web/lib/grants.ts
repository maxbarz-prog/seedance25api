import { PLANS, PlanId } from "./config";
import {
  addLedger,
  allUsers,
  balance,
  getSystem,
  LedgerEntry,
  ledgerFor,
  setSystem,
  userById,
} from "./db";
import { effectivePlan, grantedBalance, rolloverCeiling } from "./plan";

// Handing over a plan's credits. Lives apart from billing.ts so that signing
// up — which grants the free allocation — does not drag the Stripe SDK into
// the bundle of every page that touches auth.
//
// Granted credits EXPIRE; bought ones never do. So before adding a new
// allocation, anything granted above the plan's rollover ceiling is
// forfeited — posted to the ledger as its own entry, so a member can see
// exactly what lapsed and when rather than watching a balance drop for no
// stated reason.
export async function grantPeriodCredits(userId: string, planId: PlanId) {
  const plan = PLANS[planId];
  if (plan.credits <= 0) return;
  const user = await userById(userId);
  if (!user) return;

  // Expiry belongs to a RENEWAL of the same plan, not to a plan change. The
  // previous grant's external id says which plan and period it was for, so
  // moving between tiers — or up from free — carries the leftovers across
  // instead of confiscating them for changing plan.
  const period = plan.recurring ? periodKey() : "once";
  const previous = (await ledgerFor(userId, 200)).find(
    (e) => e.kind === "grant" && (e.external_id ?? "").startsWith(`grant#${userId}#`)
  );
  const [, , lastPlan, lastPeriod] = (previous?.external_id ?? "").split("#");
  const renewal = lastPlan === planId && lastPeriod !== period;

  // Only allocation the member still HOLDS can expire: anything already
  // spent is not forfeited twice.
  const granted = grantedBalance(user, await balance(userId));
  const ceiling = rolloverCeiling(planId);
  const forfeit = renewal ? Math.max(0, granted - ceiling) : 0;
  if (forfeit > 0) {
    await addLedger(userId, -forfeit, "expiry", {
      memo: `Unused ${plan.label} allocation expired (${
        plan.rolloverMonths
          ? `${plan.rolloverMonths} month carried over`
          : "no rollover on this plan"
      })`,
      grantedDelta: -forfeit,
    });
  }
  await addLedger(userId, plan.credits, "grant", {
    memo: plan.recurring
      ? `${plan.label} credits for this period`
      : `${plan.label} credits on signup`,
    grantedDelta: plan.credits,
    // One grant per plan per period, so a replayed webhook or a double click
    // cannot hand out two allocations. A non-recurring plan (Free) uses a
    // fixed key instead of the month, so its single grant never repeats —
    // including if the member later lapses back to free.
    externalId: `grant#${userId}#${planId}#${period}`,
  });
}

// The free allocation, handed over once when the account is created.
export async function grantSignupCredits(userId: string) {
  await grantPeriodCredits(userId, "free");
}

// Year and month, so a grant is idempotent within the month it belongs to.
export function periodKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The monthly allocation sweep.
//
// Renewals arrive from Stripe as `invoice.paid`, which covers monthly plans.
// An ANNUAL subscriber pays once but is granted monthly, so there is no
// invoice to hang the other eleven grants on — hence a sweep.
//
// The cron calls this every minute; a marker in the system table means the
// scan itself runs at most once per period. Even so, every grant is
// idempotent on its own external id, so a double run cannot double-allocate.
const SWEEP_DONE = "grants:period";
const SWEEP_STARTED = "grants:started";
// How long a started sweep is assumed to still be running. Long enough that
// the once-a-minute cron does not pile up scans on top of each other, short
// enough that a crashed sweep is retried within the hour.
const SWEEP_LEASE_MS = 10 * 60e3;

export async function sweepPeriodGrants(): Promise<{
  period: string;
  swept: number;
  skipped?: "done" | "running";
}> {
  const period = periodKey();
  if ((await getSystem(SWEEP_DONE)) === period) return { period, swept: 0, skipped: "done" };
  // A lease rather than a claim: the completed marker is written only once
  // the sweep has actually finished, so a crash halfway through retries this
  // month's remaining members instead of losing them. A duplicate run is
  // harmless — every grant is idempotent on its own external id.
  const [startedPeriod, startedAt] = (await getSystem(SWEEP_STARTED))?.split("#") ?? [];
  if (startedPeriod === period && Date.now() - Number(startedAt) < SWEEP_LEASE_MS) {
    return { period, swept: 0, skipped: "running" };
  }
  await setSystem(SWEEP_STARTED, `${period}#${Date.now()}`);
  let swept = 0;
  for (const user of await allUsers()) {
    const plan = effectivePlan(user);
    // Free is granted once, at signup, so it is not part of the sweep.
    if (!PLANS[plan].recurring) continue;
    await grantPeriodCredits(user.id, plan);
    swept++;
  }
  await setSystem(SWEEP_DONE, period);
  return { period, swept };
}

// Spending, with the expiring half of the balance used first.
//
// A member holding 100 granted and 100 bought credits who spends 150 should
// be left with 50 bought and nothing granted — not 50 of each. Otherwise the
// next renewal would forfeit credits they actually paid for. The split is
// recorded on the entry so a refund can put back exactly what was taken.
export async function chargeCredits(
  userId: string,
  credits: number,
  opts: { jobId?: string; memo?: string } = {}
): Promise<LedgerEntry | null> {
  const user = await userById(userId);
  const granted = user ? grantedBalance(user, await balance(userId)) : 0;
  return addLedger(userId, -credits, "charge", {
    ...opts,
    grantedDelta: -Math.min(credits, granted),
  });
}

// Refunding a charge puts back what that charge took, on the same terms: the
// granted part returns as granted (still expiring), the bought part as
// bought. Without the original split a refund would silently convert
// expiring credit into permanent credit, or the reverse.
export async function refundCredits(
  userId: string,
  credits: number,
  opts: { jobId?: string; memo?: string; externalId?: string } = {}
): Promise<LedgerEntry | null> {
  let grantedDelta = 0;
  if (opts.jobId) {
    const charge = (await ledgerFor(userId, 200)).find(
      (e) => e.kind === "charge" && e.job_id === opts.jobId
    );
    // Never return more granted credit than the charge took, even if the
    // refund itself is partial.
    grantedDelta = Math.min(credits, Math.abs(charge?.granted_delta ?? 0));
  }
  return addLedger(userId, credits, "refund", { ...opts, grantedDelta });
}
