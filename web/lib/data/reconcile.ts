import { Job, LedgerEntry } from "./types";

// Reconciliation: money we took and did not spend.
//
// The pipeline refunds a failed generation itself, so in the ordinary case
// this finds nothing. It exists for the cases where that did not happen — a
// crash between marking the job failed and writing the refund, a job that
// never reached a provider at all, a row left behind by a deploy mid-flight.
// The provider does not bill for failed generations, so every one of these is
// money a member paid us that we never spent.

export interface MoneyIssue {
  jobId: string;
  userId: string;
  // Credits still owed back: what was charged, less anything already refunded.
  credits: number;
  status: string;
  reason: string;
  createdAt: number;
}

// A job in flight longer than this cannot still be running; the pipeline's
// own stale sweep uses the same budget.
const STALE_MS = 45 * 60 * 1000;

export function findMoneyIssues(
  jobs: Job[],
  ledger: LedgerEntry[],
  now = Date.now()
): MoneyIssue[] {
  // Net movement per job: charges are negative, refunds positive, so a
  // negative net means the member is still out of pocket for it.
  const net = new Map<string, number>();
  for (const e of ledger) {
    if (!e.job_id) continue;
    net.set(e.job_id, (net.get(e.job_id) ?? 0) + e.delta_credits);
  }

  const issues: MoneyIssue[] = [];
  for (const j of jobs) {
    const owed = -(net.get(j.id) ?? 0);
    if (owed <= 0) continue; // never charged, or already refunded

    if (j.status === "failed") {
      issues.push({
        jobId: j.id,
        userId: j.user_id,
        credits: owed,
        status: j.status,
        reason: "generation failed and was never refunded",
        createdAt: j.created_at,
      });
      continue;
    }
    // Stuck in flight, and never handed to a provider: nothing was spent.
    const stuck = j.status !== "ready" && now - j.created_at > STALE_MS;
    if (stuck && !j.provider_task_id) {
      issues.push({
        jobId: j.id,
        userId: j.user_id,
        credits: owed,
        status: j.status,
        reason: "charged but never submitted to a provider",
        createdAt: j.created_at,
      });
      continue;
    }
    if (stuck) {
      issues.push({
        jobId: j.id,
        userId: j.user_id,
        credits: owed,
        status: j.status,
        reason: "stuck in flight well past the pipeline time budget",
        createdAt: j.created_at,
      });
    }
  }
  return issues.sort((a, b) => b.createdAt - a.createdAt);
}
