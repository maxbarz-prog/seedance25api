import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { findMoneyIssues, MoneyIssue } from "./reconcile";
import { modelTimings } from "./timing";
import fs from "fs";
import path from "path";
import {
  AddLedgerOpts,
  AdminData,
  AdminJobRow,
  AdminUserRow,
  DataStore,
  Job,
  JobStatus,
  LedgerEntry,
  Membership,
  User,
  BillingInterval,
} from "./types";

// Local-dev store: single SQLite file, zero services. The require() is lazy
// so the native module is never loaded when the Dynamo backend is selected
// (e.g. inside Lambda).

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

export class SqliteStore implements DataStore {
  private _db: Database.Database | null = null;

  private db(): Database.Database {
    if (this._db) return this._db;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3") as typeof Database;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this._db = new BetterSqlite3(path.join(DATA_DIR, "app.db"));
    this._db.pragma("journal_mode = WAL");
    this.migrate(this._db);
    return this._db;
  }

  private migrate(d: Database.Database) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        membership TEXT NOT NULL DEFAULT 'none',
        membership_renews_at INTEGER,
        stripe_customer_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        delta_credits INTEGER NOT NULL,
        kind TEXT NOT NULL,
        job_id TEXT,
        memo TEXT,
        external_id TEXT UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        prompt TEXT NOT NULL,
        duration_s INTEGER NOT NULL,
        aspect TEXT NOT NULL,
        audio INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT '480p-4k',
        upscale_factor INTEGER NOT NULL DEFAULT 2,
        status TEXT NOT NULL DEFAULT 'queued',
        quote_credits INTEGER NOT NULL,
        provider_task_id TEXT,
        video_url TEXT,
        size_bytes INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
      CREATE TABLE IF NOT EXISTS system (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
    // Additive migration for databases created before the model column.
    const adds = [
      `ALTER TABLE jobs ADD COLUMN model TEXT NOT NULL DEFAULT 'seedance-2.5'`,
      `ALTER TABLE jobs ADD COLUMN image_keys TEXT`,
      `ALTER TABLE jobs ADD COLUMN seed INTEGER`,
      `ALTER TABLE jobs ADD COLUMN kind TEXT`,
      `ALTER TABLE jobs ADD COLUMN source_job_id TEXT`,
      `ALTER TABLE jobs ADD COLUMN camera_fixed INTEGER`,
      `ALTER TABLE jobs ADD COLUMN provider_phase TEXT`,
      `ALTER TABLE jobs ADD COLUMN provider_submitted_at INTEGER`,
      `ALTER TABLE jobs ADD COLUMN provider_started_at INTEGER`,
      `ALTER TABLE jobs ADD COLUMN provider_done_at INTEGER`,
      `ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`,
      `ALTER TABLE users ADD COLUMN reset_token_hash TEXT`,
      `ALTER TABLE users ADD COLUMN reset_expires_at INTEGER`,
      `ALTER TABLE users ADD COLUMN granted_credits INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN billing_interval TEXT`,
      `ALTER TABLE ledger ADD COLUMN granted_delta INTEGER`,
      `ALTER TABLE users ADD COLUMN deactivated_at INTEGER`,
      `ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of adds) {
      try {
        d.exec(sql);
      } catch {
        // column already exists
      }
    }
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const u: User = {
      id: randomUUID(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      membership: "free",
      membership_renews_at: null,
      stripe_customer_id: null,
      granted_credits: 0,
      billing_interval: null,
      deactivated_at: null,
      cancel_at_period_end: false,
      created_at: Date.now(),
    };
    this.db()
      .prepare(
        `INSERT INTO users (id, email, password_hash, membership, membership_renews_at, stripe_customer_id,
                            granted_credits, billing_interval, deactivated_at,
                            cancel_at_period_end, created_at)
         VALUES (@id, @email, @password_hash, @membership, @membership_renews_at, @stripe_customer_id,
                 @granted_credits, @billing_interval, @deactivated_at,
                 @cancel_at_period_end, @created_at)`
      )
      .run({ ...u, cancel_at_period_end: u.cancel_at_period_end ? 1 : 0 });
    return u;
  }

  // SQLite has no boolean, so the 0/1 column is normalised here rather than
  // leaving every caller to remember that `0` is truthy in JavaScript when it
  // arrives as a number.
  private hydrate(row: unknown): User | undefined {
    if (!row) return undefined;
    const u = row as User & { cancel_at_period_end?: number | boolean };
    return { ...u, cancel_at_period_end: !!u.cancel_at_period_end };
  }

  async userByEmail(email: string): Promise<User | undefined> {
    return this.hydrate(
      this.db().prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim())
    );
  }

  async userById(id: string): Promise<User | undefined> {
    return this.hydrate(this.db().prepare(`SELECT * FROM users WHERE id = ?`).get(id));
  }

  async setMembership(
    userId: string,
    membership: Membership,
    renewsAt: number | null,
    interval?: BillingInterval | null
  ) {
    this.db()
      .prepare(
        `UPDATE users SET membership = ?, membership_renews_at = ?, billing_interval = ? WHERE id = ?`
      )
      .run(membership, renewsAt, interval ?? null, userId);
  }

  async setStripeIds(userId: string, customerId: string | null, subscriptionId: string | null) {
    this.db()
      .prepare(`UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`)
      .run(customerId, subscriptionId, userId);
  }

  async userByStripeCustomer(customerId: string): Promise<User | undefined> {
    return this.hydrate(
      this.db().prepare(`SELECT * FROM users WHERE stripe_customer_id = ?`).get(customerId)
    );
  }

  async setResetToken(userId: string, tokenHash: string | null, expiresAt: number | null) {
    this.db()
      .prepare(`UPDATE users SET reset_token_hash = ?, reset_expires_at = ? WHERE id = ?`)
      .run(tokenHash, expiresAt, userId);
  }

  async userByResetToken(tokenHash: string): Promise<User | undefined> {
    return this.hydrate(
      this.db().prepare(`SELECT * FROM users WHERE reset_token_hash = ?`).get(tokenHash)
    );
  }

  async setPassword(userId: string, passwordHash: string) {
    this.db().prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
  }

  async setDeactivated(userId: string, at: number | null) {
    this.db().prepare(`UPDATE users SET deactivated_at = ? WHERE id = ?`).run(at, userId);
  }

  async setCancelAtPeriodEnd(userId: string, value: boolean) {
    this.db()
      .prepare(`UPDATE users SET cancel_at_period_end = ? WHERE id = ?`)
      .run(value ? 1 : 0, userId);
  }

  async deleteUser(userId: string) {
    // One transaction: a half-deleted account — jobs gone, ledger left, or
    // the reverse — is worse than either outcome.
    const d = this.db();
    d.transaction(() => {
      d.prepare(`DELETE FROM jobs WHERE user_id = ?`).run(userId);
      d.prepare(`DELETE FROM ledger WHERE user_id = ?`).run(userId);
      d.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    })();
  }

  async balance(userId: string): Promise<number> {
    const row = this.db()
      .prepare(`SELECT COALESCE(SUM(delta_credits), 0) AS bal FROM ledger WHERE user_id = ?`)
      .get(userId) as { bal: number };
    return row.bal;
  }

  async addLedger(
    userId: string,
    deltaCredits: number,
    kind: string,
    opts: AddLedgerOpts = {}
  ): Promise<LedgerEntry | null> {
    const e: LedgerEntry = {
      id: randomUUID(),
      user_id: userId,
      delta_credits: Math.round(deltaCredits),
      kind,
      job_id: opts.jobId ?? null,
      memo: opts.memo ?? null,
      external_id: opts.externalId ?? null,
      granted_delta: opts.grantedDelta ? Math.round(opts.grantedDelta) : null,
      created_at: Date.now(),
    };
    try {
      this.db()
        .prepare(
          `INSERT INTO ledger (id, user_id, delta_credits, kind, job_id, memo, external_id, granted_delta, created_at)
           VALUES (@id, @user_id, @delta_credits, @kind, @job_id, @memo, @external_id, @granted_delta, @created_at)`
        )
        .run(e);
    } catch (err: unknown) {
      if (String(err).includes("UNIQUE constraint failed: ledger.external_id")) return null;
      throw err;
    }
    // Granted credits are tracked separately from the balance so the
    // expiring half can be told from the bought half. Clamped at zero and at
    // the balance: a spend takes granted credits first, and rounding must
    // never leave more "granted" than the member actually holds.
    if (e.granted_delta) {
      this.db()
        .prepare(
          `UPDATE users
              SET granted_credits = MAX(0, COALESCE(granted_credits, 0) + ?)
            WHERE id = ?`
        )
        .run(e.granted_delta, userId);
    }
    return e;
  }

  async ledgerFor(userId: string, limit = 50): Promise<LedgerEntry[]> {
    return this.db()
      .prepare(`SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, limit) as LedgerEntry[];
  }

  async createJob(j: Omit<Job, "created_at" | "updated_at">): Promise<Job> {
    const now = Date.now();
    const job: Job = { ...j, created_at: now, updated_at: now };
    this.db()
      .prepare(
        `INSERT INTO jobs (id, user_id, prompt, model, duration_s, aspect, audio, mode, upscale_factor, status,
                           quote_credits, provider_task_id, video_url, image_keys, kind, source_job_id, seed, camera_fixed, size_bytes, error, created_at, updated_at)
         VALUES (@id, @user_id, @prompt, @model, @duration_s, @aspect, @audio, @mode, @upscale_factor, @status,
                 @quote_credits, @provider_task_id, @video_url, @image_keys, @kind, @source_job_id, @seed, @camera_fixed, @size_bytes, @error, @created_at, @updated_at)`
      )
      .run({ image_keys: null, kind: "generate", source_job_id: null, seed: null, camera_fixed: null, ...job });
    return job;
  }

  async jobById(id: string): Promise<Job | undefined> {
    return this.db().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job | undefined;
  }

  async jobsFor(userId: string, limit = 100): Promise<Job[]> {
    return this.db()
      .prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, limit) as Job[];
  }

  async updateJob(id: string, fields: Partial<Job>) {
    const keys = Object.keys(fields).filter((k) => k !== "id");
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    this.db()
      .prepare(`UPDATE jobs SET ${sets}, updated_at = @__now WHERE id = @id`)
      .run({ ...fields, id, __now: Date.now() });
  }

  async claimJob(id: string, from: JobStatus, to: JobStatus): Promise<boolean> {
    const r = this.db()
      .prepare(`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(to, Date.now(), id, from);
    return r.changes === 1;
  }

  async jobsInFlight(limit = 200): Promise<Job[]> {
    return this.db()
      .prepare(
        `SELECT * FROM jobs WHERE status IN ('queued','generating','upscaling')
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as Job[];
  }

  async deleteJob(id: string) {
    this.db().prepare(`DELETE FROM jobs WHERE id = ?`).run(id);
  }

  async storageUsedBytes(userId: string): Promise<number> {
    const row = this.db()
      .prepare(
        `SELECT COALESCE(SUM(size_bytes), 0) AS used FROM jobs WHERE user_id = ? AND status = 'ready'`
      )
      .get(userId) as { used: number };
    return row.used;
  }

  async getSystem(key: string): Promise<string | undefined> {
    const r = this.db().prepare(`SELECT v FROM system WHERE k = ?`).get(key) as
      | { v: string }
      | undefined;
    return r?.v;
  }

  async setSystem(key: string, value: string | null): Promise<void> {
    if (value === null) {
      this.db().prepare(`DELETE FROM system WHERE k = ?`).run(key);
      return;
    }
    this.db()
      .prepare(`INSERT INTO system (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
      .run(key, value);
  }

  async moneyIssues(): Promise<MoneyIssue[]> {
    const jobs = this.db().prepare(`SELECT * FROM jobs`).all() as Job[];
    const ledger = this.db().prepare(`SELECT * FROM ledger`).all() as LedgerEntry[];
    return findMoneyIssues(jobs, ledger);
  }

  async allUsers(limit = 20000): Promise<User[]> {
    return this.db()
      .prepare(`SELECT * FROM users ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as User[];
  }

  async adminData(): Promise<AdminData> {
    const d = this.db();
    const now = Date.now();
    const count = (sql: string, ...args: unknown[]) =>
      (d.prepare(sql).get(...args) as { n: number }).n;
    const sum = (kind: string) =>
      (
        d
          .prepare(`SELECT COALESCE(SUM(ABS(delta_credits)), 0) AS s FROM ledger WHERE kind = ?`)
          .get(kind) as { s: number }
      ).s;

    const users = d
      .prepare(
        `SELECT u.id, u.email, u.membership, u.membership_renews_at, u.created_at,
                COALESCE((SELECT SUM(delta_credits) FROM ledger WHERE user_id = u.id), 0) AS balance_credits,
                (SELECT COUNT(*) FROM jobs WHERE user_id = u.id) AS jobs_count,
                COALESCE((SELECT SUM(size_bytes) FROM jobs WHERE user_id = u.id AND status = 'ready'), 0) AS storage_bytes
         FROM users u ORDER BY u.created_at DESC LIMIT 200`
      )
      .all() as AdminUserRow[];

    const jobs = d
      .prepare(
        `SELECT j.id, u.email, j.prompt, j.duration_s, j.mode, j.status, j.quote_credits, j.created_at
         FROM jobs j JOIN users u ON u.id = j.user_id
         ORDER BY j.created_at DESC LIMIT 100`
      )
      .all() as AdminJobRow[];

    // Paid members still inside their period, grouped by plan and interval.
    // The legacy "monthly"/"annual" values map onto standard, matching
    // lib/plan.ts; "free" and the pre-tier "none" are not memberships.
    const memberCounts = (
      d
        .prepare(
          `SELECT membership, billing_interval, COUNT(*) AS n
             FROM users
            WHERE membership_renews_at > ? AND membership NOT IN ('free', 'none')
            GROUP BY membership, billing_interval`
        )
        .all(now) as { membership: string; billing_interval: string | null; n: number }[]
    ).map((r) => ({
      plan:
        r.membership === "monthly" || r.membership === "annual" ? "standard" : r.membership,
      interval: (r.billing_interval ??
        (r.membership === "annual" ? "year" : "month")) as BillingInterval,
      count: r.n,
    }));

    return {
      userCount: count(`SELECT COUNT(*) AS n FROM users`),
      members: memberCounts,
      creditsPurchased: sum("topup") + sum("adjustment"),
      creditsSpent: sum("charge"),
      creditsRefunded: sum("refund"),
      jobsReady: count(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'ready'`),
      jobsFailed: count(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'`),
      jobsInFlight: count(
        `SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','generating','upscaling')`
      ),
      users,
      jobs,
      modelTiming: modelTimings(
        this.db().prepare(`SELECT * FROM jobs WHERE status = 'ready'`).all() as Job[]
      ),
    };
  }
}
