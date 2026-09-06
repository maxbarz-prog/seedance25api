import { db } from "./db";
import { PLANS } from "./config";

// Read models for the admin dashboard. Aggregations live here rather than in
// routes so the eventual DynamoDB swap has one file to reimplement.

export interface AdminOverview {
  totals: {
    users: number;
    activeMembers: number;
    monthlyMembers: number;
    annualMembers: number;
    estMonthlyMembershipUsd: number;
    creditsPurchased: number;
    creditsSpent: number;
    creditsRefunded: number;
    jobsReady: number;
    jobsFailed: number;
    jobsInFlight: number;
  };
  users: AdminUserRow[];
  jobs: AdminJobRow[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  membership: string;
  membership_renews_at: number | null;
  created_at: number;
  balance_credits: number;
  jobs_count: number;
  storage_bytes: number;
}

export interface AdminJobRow {
  id: string;
  email: string;
  prompt: string;
  duration_s: number;
  mode: string;
  status: string;
  quote_credits: number;
  created_at: number;
}

export function adminOverview(): AdminOverview {
  const d = db();
  const now = Date.now();

  const users = d.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  const members = d
    .prepare(
      `SELECT membership, COUNT(*) AS n FROM users
       WHERE membership != 'none' AND membership_renews_at > ?
       GROUP BY membership`
    )
    .all(now) as { membership: string; n: number }[];
  const monthly = members.find((m) => m.membership === "monthly")?.n ?? 0;
  const annual = members.find((m) => m.membership === "annual")?.n ?? 0;

  const sums = (kind: string) =>
    (
      d
        .prepare(
          `SELECT COALESCE(SUM(ABS(delta_credits)), 0) AS s FROM ledger WHERE kind = ?`
        )
        .get(kind) as { s: number }
    ).s;

  const jobCount = (where: string) =>
    (
      d.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`).get() as { n: number }
    ).n;

  const userRows = d
    .prepare(
      `SELECT u.id, u.email, u.membership, u.membership_renews_at, u.created_at,
              COALESCE((SELECT SUM(delta_credits) FROM ledger WHERE user_id = u.id), 0) AS balance_credits,
              (SELECT COUNT(*) FROM jobs WHERE user_id = u.id) AS jobs_count,
              COALESCE((SELECT SUM(size_bytes) FROM jobs WHERE user_id = u.id AND status = 'ready'), 0) AS storage_bytes
       FROM users u ORDER BY u.created_at DESC LIMIT 200`
    )
    .all() as AdminUserRow[];

  const jobRows = d
    .prepare(
      `SELECT j.id, u.email, j.prompt, j.duration_s, j.mode, j.status, j.quote_credits, j.created_at
       FROM jobs j JOIN users u ON u.id = j.user_id
       ORDER BY j.created_at DESC LIMIT 100`
    )
    .all() as AdminJobRow[];

  return {
    totals: {
      users: users.n,
      activeMembers: monthly + annual,
      monthlyMembers: monthly,
      annualMembers: annual,
      estMonthlyMembershipUsd:
        monthly * PLANS.monthly.priceUsd + (annual * PLANS.annual.priceUsd) / 12,
      creditsPurchased: sums("topup") + sums("adjustment"),
      creditsSpent: sums("charge"),
      creditsRefunded: sums("refund"),
      jobsReady: jobCount(`status = 'ready'`),
      jobsFailed: jobCount(`status = 'failed'`),
      jobsInFlight: jobCount(`status IN ('queued','generating','upscaling')`),
    },
    users: userRows,
    jobs: jobRows,
  };
}
