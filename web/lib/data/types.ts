// Entity types and the storage interface. Two implementations exist:
// sqlite.ts (local dev, zero services) and dynamo.ts (AWS). lib/db.ts picks
// one by env and re-exports an async facade, so routes never know which
// backend they are on.

// A plan id. Two older values survive on rows written before tiers existed
// and are mapped on read (lib/plan.ts): "none" was an unsubscribed account,
// "monthly"/"annual" the single paid plan that preceded these.
export type Membership = "free" | "standard" | "pro" | "max" | "none" | "monthly" | "annual";
export type BillingInterval = "month" | "year";
export type JobStatus = "queued" | "generating" | "upscaling" | "ready" | "failed";
export type JobMode = "upscaled-4k" | "upscaled-1080p" | "native-1080p";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  membership: Membership;
  membership_renews_at: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id?: string | null;
  reset_token_hash?: string | null;
  reset_expires_at?: number | null;
  // Running credit balance, kept in step with the ledger by the store rather
  // than recomputed from it. Optional because rows written before this
  // existed have no value yet; readers fall back to summing the ledger.
  balance_credits?: number;
  // Of that balance, how much came from a membership allocation rather than
  // being bought. Granted credits expire at renewal (beyond the plan's
  // rollover); bought ones never do, so spending takes the granted ones
  // first. Absent on rows written before tiers existed, which is treated as
  // zero — those balances were all bought.
  granted_credits?: number;
  // Whether the subscription is billed monthly or yearly. Null for free.
  billing_interval?: BillingInterval | null;
  created_at: number;
}

export interface Job {
  id: string;
  user_id: string;
  prompt: string;
  model: string;
  duration_s: number;
  aspect: string;
  audio: number;
  mode: JobMode;
  upscale_factor: number;
  status: JobStatus;
  quote_credits: number;
  provider_task_id: string | null;
  // "queued" while the provider is holding the task, "running" once it starts.
  provider_phase?: string | null;
  video_url: string | null; // storage key (see lib/storage); resolved to a URL on read
  image_keys?: string | null; // JSON array of {key, role} for all inputs (images, ref video/audio)
  kind?: "generate" | "extend" | null;
  source_job_id?: string | null; // for kind=extend: the clip being continued
  seed?: number | null;
  camera_fixed?: number | null;
  size_bytes: number | null;
  error: string | null;
  // Provider timing, for the per-model speed stats on the admin page. Three
  // points, so a slow render can be told apart from a long wait for a slot:
  // when we handed the task over, when they actually started it, when it
  // came back.
  provider_submitted_at?: number | null;
  provider_started_at?: number | null;
  provider_done_at?: number | null;
  created_at: number;
  updated_at: number;
}

// How long one model takes, per second of video it produces. The figure that
// matters to a member is seconds of waiting per second of output.
export interface ModelTiming {
  model: string;
  mode: string;
  samples: number;
  // Wall time from handing the task over to getting it back, divided by the
  // output length. Median, because a single stuck job should not move it.
  medianSecPerOutputSec: number;
  p90SecPerOutputSec: number;
  // Share of that wall time spent waiting for a slot rather than rendering.
  // High means the provider is busy — which a rate-limit increase fixes.
  queueSharePct: number | null;
  medianTotalS: number;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  delta_credits: number;
  kind: string;
  job_id: string | null;
  memo: string | null;
  external_id: string | null;
  // How much of this movement was membership allocation rather than bought
  // credit (see AddLedgerOpts.grantedDelta). Recorded so a refund can put
  // back exactly what the charge took from the expiring half. Null on rows
  // written before tiers, and on movements that are purely bought credit.
  granted_delta?: number | null;
  created_at: number;
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

// One row per (plan, billing interval) with active paid members in it. The
// revenue estimate is computed from this rather than from a monthly/annual
// headcount, which cannot price four tiers.
export interface MemberCount {
  plan: string;
  interval: BillingInterval;
  count: number;
}

export interface AdminData {
  userCount: number;
  members: MemberCount[];
  creditsPurchased: number;
  creditsSpent: number;
  creditsRefunded: number;
  jobsReady: number;
  jobsFailed: number;
  jobsInFlight: number;
  users: AdminUserRow[];
  jobs: AdminJobRow[];
  modelTiming: ModelTiming[];
}

export interface AddLedgerOpts {
  jobId?: string;
  memo?: string;
  externalId?: string;
  // How much of this movement is membership allocation rather than bought
  // credit. Positive on a grant, negative when allocation is spent or expires.
  // Keeps `granted_credits` in step with the balance so the expiring and
  // permanent halves stay distinguishable — which is what decides how much
  // may be forfeited at a renewal. See lib/grants.ts.
  grantedDelta?: number;
}

import { MoneyIssue } from "./reconcile";

export interface DataStore {
  createUser(email: string, passwordHash: string): Promise<User>;
  userByEmail(email: string): Promise<User | undefined>;
  userById(id: string): Promise<User | undefined>;
  setMembership(
    userId: string,
    membership: Membership,
    renewsAt: number | null,
    interval?: BillingInterval | null
  ): Promise<void>;
  setStripeIds(userId: string, customerId: string | null, subscriptionId: string | null): Promise<void>;
  userByStripeCustomer(customerId: string): Promise<User | undefined>;
  setResetToken(userId: string, tokenHash: string | null, expiresAt: number | null): Promise<void>;
  userByResetToken(tokenHash: string): Promise<User | undefined>;
  setPassword(userId: string, passwordHash: string): Promise<void>;

  balance(userId: string): Promise<number>;
  addLedger(
    userId: string,
    deltaCredits: number,
    kind: string,
    opts?: AddLedgerOpts
  ): Promise<LedgerEntry | null>;
  ledgerFor(userId: string, limit?: number): Promise<LedgerEntry[]>;

  createJob(j: Omit<Job, "created_at" | "updated_at">): Promise<Job>;
  jobById(id: string): Promise<Job | undefined>;
  jobsFor(userId: string, limit?: number): Promise<Job[]>;
  updateJob(id: string, fields: Partial<Job>): Promise<void>;
  // Atomically move a job from one status to another; false if someone else
  // already did (guards double-submission between user polls and the cron).
  claimJob(id: string, from: JobStatus, to: JobStatus): Promise<boolean>;
  jobsInFlight(limit?: number): Promise<Job[]>;
  deleteJob(id: string): Promise<void>;
  storageUsedBytes(userId: string): Promise<number>;

  adminData(): Promise<AdminData>;

  // Every account, for the monthly credit-grant sweep (lib/grants.ts). Run
  // once a period, not per request.
  allUsers(limit?: number): Promise<User[]>;

  // Small global key-value store for operational state that is not tied to a
  // user or a job — currently the money-safety halt (lib/money.ts).
  getSystem(key: string): Promise<string | undefined>;
  setSystem(key: string, value: string | null): Promise<void>;

  // Charges with no matching spend — see lib/data/reconcile.ts.
  moneyIssues(): Promise<MoneyIssue[]>;
}
