import { createHmac } from "crypto";
import { randomUUID } from "crypto";
import { addAudit, auditForMonth } from "./db";
import type { AuditEntry } from "./data/types";

// The diary: a dated list of things that happened, kept so a timeline can be
// reconstructed later. A chargeback arrives months after the payment, a fraud
// pattern only shows up across several accounts, and an auditor asks what
// happened and when. None of those can be answered from live tables, because
// live tables hold what is true NOW and a deletion takes their history with
// it.
//
// Three rules make this a record rather than a second copy of the product's
// state. They are worth stating because breaking any of them turns an audit
// log into a liability.
//
//   1. NOTHING READS IT. No sign-up check, no grant, no rate limit, no plan
//      decision. An account deleted and remade with the same address behaves
//      exactly as it did the first time, because nothing on that path knows
//      the diary exists. The only reader is the admin timeline.
//   2. NO CONTENT. No prompts, no videos, no IP addresses, no user agents.
//      Amounts, counts, dates, provider ids and fixed reason codes. That is
//      everything a dispute or an audit actually needs; the rest is only a
//      profile of somebody waiting to leak.
//   3. IT EXPIRES. Every line carries the date it stops being needed, and the
//      store deletes it then. Money lines outlive abuse lines because the law
//      asks them to.
//
// On the subject: the address is not stored. What is stored is an HMAC of it
// under a key that lives only in the environment. That keeps a timeline
// joinable across a deletion and a fresh sign-up — deliberately, by an admin
// who types the address — while a copy of the table lifted on its own is a
// list of hashes of an enumerable space with no key to enumerate it.

export const AUDIT_KINDS = [
  // Lifecycle.
  "account_created",
  "account_deleted",
  // Money in and out. These are the ones an accountant and a card scheme ask
  // about, and the ones kept longest.
  "payment",
  "membership_started",
  "membership_cancelled",
  "refund",
  "dispute",
  "clawback",
  // Abuse and moderation outcomes, as codes.
  "content_strike",
  "account_frozen",
  "account_unfrozen",
  // Something an administrator did by hand.
  "admin_action",
] as const;

export type AuditKind = (typeof AUDIT_KINDS)[number];

const YEAR_DAYS = 365;
// Seven years covers the six that UK company law asks for, plus the tail of a
// dispute raised at the end of the sixth.
const FINANCIAL_DAYS = 7 * YEAR_DAYS;
// Long enough to see a pattern repeat, short enough that a mistake ages out.
const ABUSE_DAYS = 2 * YEAR_DAYS;
const LIFECYCLE_DAYS = 2 * YEAR_DAYS;

export const RETENTION_DAYS: Record<AuditKind, number> = {
  account_created: LIFECYCLE_DAYS,
  account_deleted: LIFECYCLE_DAYS,
  payment: FINANCIAL_DAYS,
  membership_started: FINANCIAL_DAYS,
  membership_cancelled: FINANCIAL_DAYS,
  refund: FINANCIAL_DAYS,
  dispute: FINANCIAL_DAYS,
  clawback: FINANCIAL_DAYS,
  content_strike: ABUSE_DAYS,
  account_frozen: ABUSE_DAYS,
  account_unfrozen: ABUSE_DAYS,
  admin_action: FINANCIAL_DAYS,
};

// "2026-09". One partition per month: a timeline is read a month at a time,
// and a month of a small service is a few hundred rows.
export function bucketOf(at = Date.now()): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The months a window of days touches, newest first.
export function bucketsBack(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  const d = new Date(now);
  d.setUTCDate(1);
  const first = bucketOf(now - days * 86_400_000);
  for (;;) {
    const b = bucketOf(d.getTime());
    out.push(b);
    if (b <= first) break;
    d.setUTCMonth(d.getUTCMonth() - 1);
    if (out.length > 120) break;
  }
  return out;
}

// The key. Its own secret, so the diary can be handed to someone who should
// be able to read a timeline without being handed the session secret too.
// Falls back to the session secret rather than to a constant: a predictable
// key would make every hash in the table reversible by anyone with a list of
// email addresses.
function key(): string {
  const k = process.env.AUDIT_SALT || process.env.SESSION_SECRET;
  if (!k) throw new Error("audit: no AUDIT_SALT or SESSION_SECRET set");
  return k;
}

// The pseudonym for an address. Exported because the admin timeline has to
// compute it to find anything — that is the deliberate, typed-in-by-a-human
// path. It is not for any other caller: see rule 1 above.
export function subjectOf(email: string): string {
  return createHmac("sha256", key())
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

// An entry with no person attached (a system-wide action, say).
export const NO_SUBJECT = "-";

/**
 * Write one line. Never throws and never blocks anything: a diary that can
 * fail a payment is worse than a gap in a diary.
 */
export async function audit(
  kind: AuditKind,
  opts: {
    email?: string | null;
    subject?: string;
    account?: string | null;
    props?: Record<string, string | number | boolean | null>;
    at?: number;
  } = {}
): Promise<void> {
  try {
    const at = opts.at ?? Date.now();
    const subject = opts.subject ?? (opts.email ? subjectOf(opts.email) : NO_SUBJECT);
    const entry: AuditEntry = {
      id: randomUUID(),
      bucket: bucketOf(at),
      at,
      kind,
      subject,
      account: opts.account ?? null,
      props: opts.props ?? null,
      expires: expiresAt(kind, at),
    };
    await addAudit([entry]);
  } catch (e) {
    console.error(`audit(${kind}) failed:`, e);
  }
}

/**
 * The same, for something that happened to an account rather than to an
 * address: looks the address up so the line joins the rest of that person's
 * timeline.
 *
 * When the row has already been erased there is no address to hash, and the
 * line is filed under the account id alone. That still joins up, because the
 * account_deleted line written at erasure carries both.
 */
export async function auditUser(
  kind: AuditKind,
  userId: string,
  props?: Record<string, string | number | boolean | null>
): Promise<void> {
  let email: string | null = null;
  try {
    const { userById } = await import("./db");
    email = (await userById(userId))?.email ?? null;
  } catch {}
  await audit(kind, { email, account: userId, props });
}

/**
 * A month of the diary, oldest first. The admin timeline's only way in.
 */
export async function auditMonth(bucket: string, limit = 5000): Promise<AuditEntry[]> {
  const rows = await auditForMonth(bucket, limit);
  return rows.sort((a, b) => a.at - b.at);
}

/**
 * The last `days` of the diary, optionally narrowed to one address.
 *
 * The narrowing happens here, in memory, against the hash — there is no index
 * on subject, on purpose. Looking somebody up has to be a deliberate act by an
 * administrator who already knows the address, not something a code path can
 * do by accident.
 */
export async function auditTimeline(
  opts: { days?: number; email?: string | null; limit?: number } = {}
): Promise<AuditEntry[]> {
  const days = Math.min(3650, Math.max(1, opts.days ?? 90));
  const want = opts.email ? subjectOf(opts.email) : null;
  const since = Date.now() - days * 86_400_000;
  const out: AuditEntry[] = [];
  for (const bucket of bucketsBack(days)) {
    const rows = await auditForMonth(bucket, opts.limit ?? 5000);
    for (const r of rows) {
      if (r.at < since) continue;
      if (want && r.subject !== want) continue;
      out.push(r);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The date a line of this kind stops being kept, as a unix second — what the
// store hands to its own expiry mechanism.
export function expiresAt(kind: AuditKind, at: number): number {
  const days = RETENTION_DAYS[kind] ?? LIFECYCLE_DAYS;
  return Math.floor(at / 1000) + days * 86_400;
}
