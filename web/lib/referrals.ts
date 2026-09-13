import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { PlanId, REFERRAL_REWARD_USD } from "./config";
import { getSystem, listSystem, setSystem, setSystemIfAbsent, userById } from "./db";

// Invites and referrals.
//
// Two instruments, deliberately different.
//
// An INVITE is minted by an admin, used once, and gives a first month free on
// one named plan. It is the thing to paste into a DM. Its cost to us is the
// plan's whole allocation — $6.03 on Standard — so it is capped to one plan and
// one use, and it expires.
//
// A REFERRAL is every member's own link. Both sides get a FIXED discount, not a
// percentage: $3 is 20% of Standard monthly, reads the same in marketing, and
// cannot go negative on a plan where 20% would. Twenty per cent off Pro annual
// is -$0.10 of margin; $3 off it is +$2.31.
//
// Rewards are DISCOUNTS ON FUTURE MONTHS, never credits. A credit is spent
// immediately and cannot be clawed back, so a chargeback leaves us holding both
// the reversal and the rendered video. A discount that has not been applied yet
// can simply be withdrawn — which is what revokeReferral does.
//
// Rewards never stack: one per billing period, applied in turn. That is not a
// UX nicety, it is the margin. At $15/month with the whole 625-credit
// allocation spent, one $3 discount leaves $5.55; two leave $2.65; on Pro, two
// leave -$1.45. Sequential application keeps every discounted month profitable
// however many referrals someone brings, which is why there is no cap on
// earning — only on fraud.

// Crockford-ish: no I, L, O, U, 0 or 1, so a code read aloud or retyped from a
// DM cannot land on a different one.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(bytes: Buffer, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  return out;
}

export interface Invite {
  code: string;
  plan: PlanId;
  createdAt: number;
  createdBy: string;
  expiresAt: number;
  redeemedBy?: string;
  redeemedAt?: string | number;
}

export interface Referral {
  refereeId: string;
  referrerId: string;
  code: string;
  createdAt: number;
  // Set when the referee's first invoice is actually paid. Until then the
  // referrer has earned nothing, which is the whole defence against signup
  // farming.
  vestedAt?: number;
  revokedAt?: number;
  reason?: string;
}

export interface Rewards {
  // Earned and waiting for a billing period to land on.
  pending: number;
  // Already taken off an invoice.
  applied: number;
}

const inviteKey = (code: string) => `invite#${code.toUpperCase()}`;
const inviteClaimKey = (code: string) => `invite-used#${code.toUpperCase()}`;
const vestKey = (refereeId: string) => `vested#${refereeId}`;
const refcodeKey = (code: string) => `refcode#${code.toUpperCase()}`;
const referralKey = (refereeId: string) => `referral#${refereeId}`;
const rewardsKey = (userId: string) => `rewards#${userId}`;

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getSystem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── a member's own code ─────────────────────────────────────────────────────

// Derived from the user id, so it is stable for the life of the account and
// needs no column: the same member always gets the same link. The reverse
// lookup is written the first time the code is asked for, because a hash
// cannot be reversed.
export function referralCode(userId: string): string {
  const secret = process.env.SESSION_SECRET || "dev";
  return encode(createHmac("sha256", secret).update(`referral:${userId}`).digest(), 6);
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const code = referralCode(userId);
  const existing = await readJson<{ userId: string }>(refcodeKey(code));
  if (existing?.userId === userId) return code;
  await setSystem(refcodeKey(code), JSON.stringify({ userId }));
  return code;
}

export async function userIdForReferralCode(code: string): Promise<string | null> {
  if (!code) return null;
  const rec = await readJson<{ userId: string }>(refcodeKey(code));
  return rec?.userId ?? null;
}

// ── invites ────────────────────────────────────────────────────────────────

export async function mintInvite(opts: {
  plan: PlanId;
  createdBy: string;
  days: number;
}): Promise<Invite> {
  // Random, not derived: an invite is a bearer token, and anything derivable
  // from a known input could be minted by whoever knows the input.
  const code = encode(randomBytes(32), 8);
  const invite: Invite = {
    code,
    plan: opts.plan,
    createdAt: Date.now(),
    createdBy: opts.createdBy,
    expiresAt: Date.now() + opts.days * 86_400_000,
  };
  await setSystem(inviteKey(code), JSON.stringify(invite));
  return invite;
}

export async function inviteByCode(code: string): Promise<Invite | null> {
  if (!code) return null;
  return readJson<Invite>(inviteKey(code));
}

export type InviteCheck =
  | { ok: true; invite: Invite }
  | { ok: false; reason: "unknown" | "expired" | "used" };

export async function checkInvite(code: string): Promise<InviteCheck> {
  const invite = await inviteByCode(code);
  if (!invite) return { ok: false, reason: "unknown" };
  if (invite.redeemedBy) return { ok: false, reason: "used" };
  if (invite.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, invite };
}

// Marked used when the checkout is OPENED, not when it is paid: a code still
// redeemable after the hosted page exists could open any number of discounted
// sessions. The claim is a single insert-if-absent, so two checkouts racing
// for one code get exactly one winner; the invite record is then updated for
// the listing. An abandoned checkout hands the code back — see unredeemInvite.
export async function redeemInvite(code: string, userId: string): Promise<boolean> {
  const check = await checkInvite(code);
  if (!check.ok) return false;
  if (!(await setSystemIfAbsent(inviteClaimKey(code), userId))) return false;
  await setSystem(
    inviteKey(code),
    JSON.stringify({ ...check.invite, redeemedBy: userId, redeemedAt: Date.now() })
  );
  return true;
}

// The checkout that spent this code expired unpaid. Only the member who
// claimed it can hand it back, and only while it is still theirs.
export async function unredeemInvite(code: string, userId: string): Promise<boolean> {
  const invite = await inviteByCode(code);
  if (!invite || invite.redeemedBy !== userId) return false;
  const { redeemedBy, redeemedAt, ...rest } = invite;
  void redeemedBy;
  void redeemedAt;
  await setSystem(inviteKey(code), JSON.stringify(rest));
  await setSystem(inviteClaimKey(code), null);
  return true;
}

export async function listInvites(): Promise<Invite[]> {
  const rows = await listSystem("invite#");
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.value) as Invite;
      } catch {
        return null;
      }
    })
    .filter((i): i is Invite => !!i)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ── referrals ──────────────────────────────────────────────────────────────

export type ReferralRecord =
  | { ok: true; referral: Referral }
  | { ok: false; reason: "unknown-code" | "self" | "already-referred" };

export async function recordReferral(refereeId: string, code: string): Promise<ReferralRecord> {
  const referrerId = await userIdForReferralCode(code);
  if (!referrerId) return { ok: false, reason: "unknown-code" };
  if (referrerId === refereeId) return { ok: false, reason: "self" };
  const existing = await referralFor(refereeId);
  // One referral per account, for life. Re-running a link after the fact must
  // not move the credit to someone else.
  if (existing) return { ok: false, reason: "already-referred" };
  const referral: Referral = {
    refereeId,
    referrerId,
    code: code.toUpperCase(),
    createdAt: Date.now(),
  };
  await setSystem(referralKey(refereeId), JSON.stringify(referral));
  return { ok: true, referral };
}

export async function referralFor(refereeId: string): Promise<Referral | null> {
  return readJson<Referral>(referralKey(refereeId));
}

// The referee's first invoice has been PAID. Only now has the referrer earned
// anything.
//
// Two webhooks can say so at once (checkout completion and the first
// invoice, which Stripe does not order), so the vesting itself is an
// insert-if-absent: whichever arrives second finds the marker and pays out
// nothing.
export async function vestReferral(refereeId: string): Promise<Referral | null> {
  const referral = await referralFor(refereeId);
  if (!referral || referral.vestedAt || referral.revokedAt) return null;
  if (!(await setSystemIfAbsent(vestKey(refereeId), String(Date.now())))) return null;
  const vested = { ...referral, vestedAt: Date.now() };
  await setSystem(referralKey(refereeId), JSON.stringify(vested));
  await earnReward(referral.referrerId);
  return vested;
}

// The referee's payment came back — refunded or disputed. Withdraw the
// referrer's reward if it has not been spent on an invoice yet. This is the
// reason rewards are discounts and not credits: at this point a credit would
// already be gone.
export async function revokeReferral(refereeId: string, reason: string): Promise<Referral | null> {
  const referral = await referralFor(refereeId);
  if (!referral || referral.revokedAt) return null;
  const revoked = { ...referral, revokedAt: Date.now(), reason };
  await setSystem(referralKey(refereeId), JSON.stringify(revoked));
  if (referral.vestedAt) await withdrawReward(referral.referrerId);
  return revoked;
}

// ── the reward queue ───────────────────────────────────────────────────────

export async function rewardsFor(userId: string): Promise<Rewards> {
  return (await readJson<Rewards>(rewardsKey(userId))) ?? { pending: 0, applied: 0 };
}

async function writeRewards(userId: string, r: Rewards): Promise<void> {
  await setSystem(rewardsKey(userId), JSON.stringify(r));
}

export async function earnReward(userId: string): Promise<Rewards> {
  const r = await rewardsFor(userId);
  const next = { ...r, pending: r.pending + 1 };
  await writeRewards(userId, next);
  return next;
}

// Only ever takes from the pending side. A discount already applied to an
// invoice is not something we can reach into and undo.
async function withdrawReward(userId: string): Promise<Rewards> {
  const r = await rewardsFor(userId);
  const next = { ...r, pending: Math.max(0, r.pending - 1) };
  await writeRewards(userId, next);
  return next;
}

// Called when a discount has actually been attached to an invoice or checkout.
export async function consumeReward(userId: string): Promise<boolean> {
  const r = await rewardsFor(userId);
  if (r.pending < 1) return false;
  await writeRewards(userId, { pending: r.pending - 1, applied: r.applied + 1 });
  return true;
}

// The checkout a reward was spent on expired unpaid: the reward goes back in
// the queue.
export async function restoreReward(userId: string): Promise<Rewards> {
  const r = await rewardsFor(userId);
  const next = { pending: r.pending + 1, applied: Math.max(0, r.applied - 1) };
  await writeRewards(userId, next);
  return next;
}

// ── claiming a link ────────────────────────────────────────────────────────

// Turn the cookie /r/<code> left behind into a referral, the first time the
// new member's account exists. Called from the places that run right after
// signup — their account page and their first checkout — because account rows
// are created lazily on first authenticated use, so there is no single
// "user created" moment to hook.
//
// Only a NEW account can be referred. An established member who clicks a
// friend's link later is not a referral, and without this an existing
// subscriber could cancel, "get referred", and resubscribe to hand a friend
// $3 a month.
const REFERRAL_CLAIM_WINDOW_MS = 7 * 86_400_000;

export async function claimReferralCookie(userId: string): Promise<Referral | null> {
  const jar = await cookies();
  const code = jar.get("remerged_ref")?.value;
  if (!code) return null;
  const user = await userById(userId);
  const isNew = !!user && Date.now() - user.created_at < REFERRAL_CLAIM_WINDOW_MS;
  const result = isNew
    ? await recordReferral(userId, code)
    : ({ ok: false, reason: "already-referred" } as const);
  // Cleared either way: a code that cannot be claimed should not keep being
  // retried on every page load.
  try {
    jar.delete("remerged_ref");
  } catch {
    // Read-only cookie store (a server component render). The next write-
    // capable call clears it.
  }
  return result.ok ? result.referral : null;
}

export function rewardLabel(): string {
  return `$${REFERRAL_REWARD_USD} off a month`;
}
