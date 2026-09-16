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
// A render quality and an upscale target, as one id: "480p-4k", "720p",
// "1080p". The three values written before those were separate choices
// ("upscaled-4k", "upscaled-1080p", "native-1080p") still exist on old rows
// and are mapped on read by resolveMode() in lib/config.ts — which is why
// this is a string rather than a closed union.
export type JobMode = string;

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
  // Set when the member deactivates. The account and its videos survive and
  // the member can still sign in — to reactivate, or to delete for good — but
  // nothing generates and nothing is billed. Deliberately reversible, which
  // is the whole difference between this and deletion.
  deactivated_at?: number | null;
  // Set when the member cancels: the plan runs to membership_renews_at and
  // then stops. Without it the account page cannot tell "paid up until the
  // 10th" from "cancelled, ends on the 10th", and a member who cancels sees
  // no evidence it worked.
  cancel_at_period_end?: boolean;
  // The welcome flow, one field per step so a half-finished run resumes at
  // the right place rather than from the top. All absent on accounts made
  // before the flow existed; those are never sent through it.
  terms_accepted_at?: number | null;
  referral_answered_at?: number | null;
  survey_role?: string | null;
  survey_goal?: string | null;
  survey_source?: string | null;
  onboarded_at?: number | null;
  // When the one-time upgrade offer was shown after the welcome flow. Shown
  // once, ever — a second showing is nagging.
  upgrade_prompted_at?: number | null;
  created_at: number;
}

// What the welcome flow may write on a user. Everything else on the row is
// owned by billing or auth and has its own setter.
export type OnboardingFields = Partial<
  Pick<
    User,
    | "terms_accepted_at"
    | "referral_answered_at"
    | "survey_role"
    | "survey_goal"
    | "survey_source"
    | "onboarded_at"
    | "upgrade_prompted_at"
  >
>;

// One thing that happened, for the growth report. Written by the browser
// (a page seen, a step completed, a modal dismissed) through /api/events and
// by the server where the truth lives (an account created, a job started, a
// plan paid for). Read only in aggregate, by day, on the admin page.
//
// `actor` is the person as best we know them: the user id once signed in,
// otherwise the visitor id the browser minted. An `identify` event carries
// both, which is how a funnel that starts anonymous and ends paid is stitched
// into one line.
export interface Event {
  id: string;
  // UTC calendar day, "2026-09-14". The partition the report reads by.
  day: string;
  name: string;
  actor: string;
  // The browser's visitor id, when the event came from a browser. Present
  // alongside `actor` on signed-in events so the two can be linked.
  visitor?: string | null;
  // Small, flat, and bounded (see lib/events.ts). Never free text from the
  // page — a survey answer is one of a fixed set, a referral code is at most
  // twelve characters.
  props?: Record<string, string | number | boolean | null> | null;
  // Where this person first came from: referral code, utm_*, landing path,
  // referrer host. Captured once by the browser and repeated on every event
  // so an answer never depends on joining back to a first visit.
  attr?: Record<string, string> | null;
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
  // A JPEG of one frame, so the library can be a page of images rather than a
  // page of videos each downloading itself to show a still. Absent on rows
  // written before posters existed, and on any job whose extraction failed —
  // both fall back to the video with preload off.
  poster_key?: string | null;
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
  // The delivery record, for when a member says they never got what they
  // paid for. Where the request came from when the job was made; when the
  // finished video was first opened; how often and when it was downloaded.
  // Written once per event, read only from the admin evidence endpoint.
  created_ip?: string | null;
  created_ua?: string | null;
  viewed_at?: number | null;
  download_count?: number | null;
  last_download_at?: number | null;
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
  // A spend that must not overdraw. The store checks the balance and applies
  // the movement in ONE atomic step, and returns null instead of an entry when
  // the funds are not there. Anything less — read the balance, then charge —
  // lets two requests that both saw enough credit both go through.
  requireFunds?: boolean;
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
  setDeactivated(userId: string, at: number | null): Promise<void>;
  setCancelAtPeriodEnd(userId: string, value: boolean): Promise<void>;
  // Erase the member: their jobs, their ledger and the row itself. The stored
  // VIDEO FILES are not this layer's to remove — the caller deletes those
  // first, because only it knows about object storage.
  deleteUser(userId: string): Promise<void>;

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
  // Write only if the key is not there; true when this call was the one that
  // wrote it. The one-shot claims (an invite, a referral vesting) hang on it:
  // two requests racing for the same claim get one true and one false.
  setSystemIfAbsent(key: string, value: string): Promise<boolean>;
  // Atomic add on a numeric system key; returns the new total. For the
  // running tallies that gate spend (the free tier's daily budget, content
  // strikes) — a read-modify-write there would let a burst slip past.
  addSystemCounter(key: string, delta: number): Promise<number>;
  // Every key under a prefix, for the few cases that need the set rather than
  // one entry — listing the invite codes an admin has issued, for instance.
  listSystem(prefix: string): Promise<{ key: string; value: string }[]>;

  // Charges with no matching spend — see lib/data/reconcile.ts.
  moneyIssues(): Promise<MoneyIssue[]>;

  setOnboarding(userId: string, fields: OnboardingFields): Promise<void>;

  // Growth events (lib/events.ts). Written in small batches and read back a
  // day at a time: the report wants everything in a window, and a day is
  // the natural unit to page by.
  addEvents(events: Event[]): Promise<void>;
  eventsForDay(day: string, limit?: number): Promise<Event[]>;

  // The audit diary (lib/audit.ts). Append-only, one partition per calendar
  // month. Deliberately no read-by-subject: see the note on AuditEntry.
  addAudit(entries: AuditEntry[]): Promise<void>;
  auditForMonth(bucket: string, limit?: number): Promise<AuditEntry[]>;
}

// One line in the diary: something that happened, when, to which account.
//
// This is a RECORD, not state. Nothing the product does may read it, branch
// on it, or look an address up in it — an account deleted and remade with the
// same email must behave exactly as it did the first time. The only reader is
// the admin timeline, and it reads a month at a time rather than by subject,
// which is why there is no index to look one up with.
//
// It holds no content and no network identifiers: no prompts, no videos, no
// IP addresses, no user agents. Amounts, counts, dates, ids and fixed codes
// only, which is everything a chargeback, an audit or a fraud question needs
// and nothing a person could be profiled with.
export interface AuditEntry {
  id: string;
  // UTC calendar month, "2026-09". The partition a timeline reads by.
  bucket: string;
  at: number;
  // One of lib/audit.ts's AuditKind. A fixed code, never free text.
  kind: string;
  // A keyed hash of the email address, not the address. Stable across
  // accounts that share one, so a timeline survives deletion and re-signup,
  // and useless to anyone who lifts the table without the key.
  subject: string;
  // The user row's id at the time. Meaningless once that row is gone, which
  // is the point: it groups a run of entries without naming anybody.
  account?: string | null;
  // Flat, bounded, and drawn from the same rules as the growth events:
  // amounts, plan ids, provider ids, reason codes.
  props?: Record<string, string | number | boolean | null> | null;
  // Unix SECONDS after which this line stops being kept, set by lib/audit.ts
  // from the kind — money outlives abuse, abuse outlives lifecycle. It rides
  // on the entry because how long to keep something is the diary's decision,
  // not the store's; the store only has to honour it.
  expires: number;
}
