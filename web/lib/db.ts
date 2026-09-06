import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

// SQLite is the MVP store so the whole product runs anywhere with zero
// services. Every query goes through the repository functions below, so the
// storage engine can be swapped (DynamoDB/Postgres) without touching routes.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(path.join(DATA_DIR, "app.db"));
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
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
      mode TEXT NOT NULL DEFAULT 'upscaled-1080p',
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
  `);
}

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
  created_at: number;
}

export interface Job {
  id: string;
  user_id: string;
  prompt: string;
  duration_s: number;
  aspect: string;
  audio: number;
  mode: JobMode;
  upscale_factor: number;
  status: JobStatus;
  quote_credits: number;
  provider_task_id: string | null;
  video_url: string | null;
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

// --- users ---

export function createUser(email: string, passwordHash: string): User {
  const u: User = {
    id: randomUUID(),
    email: email.toLowerCase().trim(),
    password_hash: passwordHash,
    membership: "none",
    membership_renews_at: null,
    stripe_customer_id: null,
    created_at: Date.now(),
  };
  db()
    .prepare(
      `INSERT INTO users (id, email, password_hash, membership, membership_renews_at, stripe_customer_id, created_at)
       VALUES (@id, @email, @password_hash, @membership, @membership_renews_at, @stripe_customer_id, @created_at)`
    )
    .run(u);
  return u;
}

export function userByEmail(email: string): User | undefined {
  return db()
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim()) as User | undefined;
}

export function userById(id: string): User | undefined {
  return db().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function setMembership(userId: string, membership: Membership, renewsAt: number | null) {
  db()
    .prepare(`UPDATE users SET membership = ?, membership_renews_at = ? WHERE id = ?`)
    .run(membership, renewsAt, userId);
}

export function setStripeCustomer(userId: string, customerId: string) {
  db().prepare(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`).run(customerId, userId);
}

// --- ledger ---

export function balance(userId: string): number {
  const row = db()
    .prepare(`SELECT COALESCE(SUM(delta_credits), 0) AS bal FROM ledger WHERE user_id = ?`)
    .get(userId) as { bal: number };
  return row.bal;
}

export function addLedger(
  userId: string,
  deltaCredits: number,
  kind: string,
  opts: { jobId?: string; memo?: string; externalId?: string } = {}
): LedgerEntry | null {
  const e: LedgerEntry = {
    id: randomUUID(),
    user_id: userId,
    delta_credits: Math.round(deltaCredits),
    kind,
    job_id: opts.jobId ?? null,
    memo: opts.memo ?? null,
    external_id: opts.externalId ?? null,
    created_at: Date.now(),
  };
  try {
    db()
      .prepare(
        `INSERT INTO ledger (id, user_id, delta_credits, kind, job_id, memo, external_id, created_at)
         VALUES (@id, @user_id, @delta_credits, @kind, @job_id, @memo, @external_id, @created_at)`
      )
      .run(e);
  } catch (err: unknown) {
    // Unique external_id makes webhook credit grants idempotent.
    if (String(err).includes("UNIQUE constraint failed: ledger.external_id")) return null;
    throw err;
  }
  return e;
}

export function ledgerFor(userId: string, limit = 50): LedgerEntry[] {
  return db()
    .prepare(`SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as LedgerEntry[];
}

// --- jobs ---

export function createJob(j: Omit<Job, "created_at" | "updated_at">): Job {
  const now = Date.now();
  const job: Job = { ...j, created_at: now, updated_at: now };
  db()
    .prepare(
      `INSERT INTO jobs (id, user_id, prompt, duration_s, aspect, audio, mode, upscale_factor, status,
                         quote_credits, provider_task_id, video_url, size_bytes, error, created_at, updated_at)
       VALUES (@id, @user_id, @prompt, @duration_s, @aspect, @audio, @mode, @upscale_factor, @status,
               @quote_credits, @provider_task_id, @video_url, @size_bytes, @error, @created_at, @updated_at)`
    )
    .run(job);
  return job;
}

export function jobById(id: string): Job | undefined {
  return db().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job | undefined;
}

export function jobsFor(userId: string, limit = 100): Job[] {
  return db()
    .prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as Job[];
}

export function updateJob(id: string, fields: Partial<Job>) {
  const keys = Object.keys(fields).filter((k) => k !== "id");
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  db()
    .prepare(`UPDATE jobs SET ${sets}, updated_at = @__now WHERE id = @id`)
    .run({ ...fields, id, __now: Date.now() });
}

export function storageUsedBytes(userId: string): number {
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS used FROM jobs WHERE user_id = ? AND status = 'ready'`
    )
    .get(userId) as { used: number };
  return row.used;
}
