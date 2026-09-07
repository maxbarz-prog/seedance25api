// Entity types and the storage interface. Two implementations exist:
// sqlite.ts (local dev, zero services) and dynamo.ts (AWS). lib/db.ts picks
// one by env and re-exports an async facade, so routes never know which
// backend they are on.

export type Membership = "none" | "monthly" | "annual";
export type JobStatus = "queued" | "generating" | "upscaling" | "ready" | "failed";
export type JobMode = "upscaled-1080p" | "native-1080p";

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
  video_url: string | null; // storage key (see lib/storage); resolved to a URL on read
  image_keys?: string | null; // JSON array of {key, role} for input images
  seed?: number | null;
  camera_fixed?: number | null;
  size_bytes: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  delta_credits: number;
  kind: string;
  job_id: string | null;
  memo: string | null;
  external_id: string | null;
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

export interface AdminData {
  userCount: number;
  monthlyMembers: number;
  annualMembers: number;
  creditsPurchased: number;
  creditsSpent: number;
  creditsRefunded: number;
  jobsReady: number;
  jobsFailed: number;
  jobsInFlight: number;
  users: AdminUserRow[];
  jobs: AdminJobRow[];
}

export interface AddLedgerOpts {
  jobId?: string;
  memo?: string;
  externalId?: string;
}

export interface DataStore {
  createUser(email: string, passwordHash: string): Promise<User>;
  userByEmail(email: string): Promise<User | undefined>;
  userById(id: string): Promise<User | undefined>;
  setMembership(userId: string, membership: Membership, renewsAt: number | null): Promise<void>;
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
}
