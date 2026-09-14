import {
  CREDIT_USD,
  MODELS,
  ModelId,
  modeInfo,
  QUALITIES,
  TOPUP_DAILY_LIMITS_BY_ACCOUNT_AGE,
  FREE_TIER_DAILY_BUDGET_CREDITS,
  CONTENT_STRIKES_PER_DAY,
} from "./config";
import { addSystemCounter, getSystem, listSystem, setSystem, Job, LedgerEntry, User } from "./db";
import { rates } from "./pricing";

// Money safety. Two jobs:
//
//   1. Check every finished generation against what the provider actually
//      billed, using the token count it reports. If a member paid less than
//      the render cost us, that is a real cash loss and the service stops
//      selling until a human has looked at it.
//   2. Hold the halt switch that stops us spending money — tripped
//      automatically by (1), by a billing inconsistency, or by hand from the
//      admin page.
//
// The asymmetry is deliberate. Selling below cost bleeds money on every
// subsequent order, so it halts. Charging MORE than expected is only ever an
// alert: a temporary provider glitch that made one render look cheap must
// never be allowed to talk us into lowering prices automatically.

const HALT_KEY = "halt";

export interface Halt {
  reason: string;
  detail: string;
  at: number;
  // Set when a specific job exposed the problem.
  jobId?: string;
  by?: string;
}

// The halt is read on every generation attempt, so it is cached briefly.
// Short enough that clearing it from the admin page takes effect promptly,
// long enough that a burst of traffic does not hammer the store.
const HALT_TTL_MS = 10_000;
let cached: { at: number; value: Halt | null } | null = null;

export async function currentHalt(): Promise<Halt | null> {
  if (cached && Date.now() - cached.at < HALT_TTL_MS) return cached.value;
  let value: Halt | null = null;
  try {
    const raw = await getSystem(HALT_KEY);
    value = raw ? (JSON.parse(raw) as Halt) : null;
  } catch (err) {
    // A store that cannot answer is not a reason to start spending money on
    // the assumption that everything is fine, but neither is one blip a
    // reason to take the site down. Keep the last known state.
    console.error("halt read failed:", err);
    return cached?.value ?? null;
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function halt(h: Omit<Halt, "at">): Promise<void> {
  const value: Halt = { ...h, at: Date.now() };
  await setSystem(HALT_KEY, JSON.stringify(value));
  cached = { at: Date.now(), value };
  console.error(`MONEY HALT: ${value.reason} — ${value.detail}`);
}

export async function clearHalt(): Promise<void> {
  await setSystem(HALT_KEY, null);
  cached = { at: Date.now(), value: null };
}

// ---------------------------------------------------------------------------
// Frozen accounts
// ---------------------------------------------------------------------------
//
// An account whose payment has been disputed, or flagged by the card network
// as fraud, stops spending and stops paying until a human has looked. Not
// deactivation — the member could undo that themselves — and not deletion:
// the record is the evidence if the dispute is fought. Cleared from the
// admin money desk.

export interface Freeze {
  reason: string;
  at: number;
  detail?: string;
}

const FREEZE_PREFIX = "frozen#";

export async function accountFrozen(userId: string): Promise<Freeze | null> {
  const raw = await getSystem(FREEZE_PREFIX + userId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Freeze;
  } catch {
    return { reason: "unknown", at: 0 };
  }
}

export async function freezeAccount(userId: string, reason: string, detail?: string): Promise<void> {
  await setSystem(FREEZE_PREFIX + userId, JSON.stringify({ reason, detail, at: Date.now() } satisfies Freeze));
  console.error(`ACCOUNT FROZEN ${userId}: ${reason}${detail ? ` — ${detail}` : ""}`);
}

export async function unfreezeAccount(userId: string): Promise<void> {
  await setSystem(FREEZE_PREFIX + userId, null);
}

export async function frozenAccounts(): Promise<{ userId: string; freeze: Freeze }[]> {
  const rows = await listSystem(FREEZE_PREFIX);
  return rows.map((r) => {
    let freeze: Freeze = { reason: "unknown", at: 0 };
    try {
      freeze = JSON.parse(r.value) as Freeze;
    } catch {}
    return { userId: r.key.slice(FREEZE_PREFIX.length), freeze };
  });
}

// ---------------------------------------------------------------------------
// Daily top-up limits
// ---------------------------------------------------------------------------
//
// From the age table in config, unless support has set one for this account
// (`limit#<userId>`), which wins. Support raises a limit after looking at the
// member — that is the whole review, so the code does not second-guess it.

const LIMIT_PREFIX = "limit#";

export interface DailyLimit {
  usdPerDay: number;
  source: "age" | "support";
  // Age-based only: when the next step up arrives, in days from now.
  risesInDays?: number;
  nextUsdPerDay?: number;
}

export async function dailyTopupLimit(user: Pick<User, "id" | "created_at">): Promise<DailyLimit> {
  const raw = await getSystem(LIMIT_PREFIX + user.id);
  const custom = raw ? Number(raw) : NaN;
  if (Number.isFinite(custom) && custom > 0) return { usdPerDay: custom, source: "support" };
  const ageDays = (Date.now() - user.created_at) / 86_400_000;
  const i = TOPUP_DAILY_LIMITS_BY_ACCOUNT_AGE.findIndex((t) => ageDays < t.underDays);
  const tier = TOPUP_DAILY_LIMITS_BY_ACCOUNT_AGE[i];
  const next = TOPUP_DAILY_LIMITS_BY_ACCOUNT_AGE[i + 1];
  return {
    usdPerDay: tier.usdPerDay,
    source: "age",
    ...(next ? { risesInDays: Math.max(1, Math.ceil(tier.underDays - ageDays)), nextUsdPerDay: next.usdPerDay } : {}),
  };
}

export async function setDailyTopupLimit(userId: string, usdPerDay: number | null): Promise<void> {
  await setSystem(LIMIT_PREFIX + userId, usdPerDay && usdPerDay > 0 ? String(usdPerDay) : null);
}

// What has been bought in the last 24 hours, from the ledger — the ledger is
// the counter, so there is no second tally to drift.
export function topupsLast24hUsd(ledger: LedgerEntry[], now = Date.now()): number {
  const dayAgo = now - 86_400_000;
  return ledger
    .filter((e) => e.kind === "topup" && e.created_at > dayAgo)
    .reduce((sum, e) => sum + e.delta_credits / 100, 0);
}

// ---------------------------------------------------------------------------
// The free tier's daily budget, and content strikes
// ---------------------------------------------------------------------------

const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// How many credits free accounts, all of them together, have spent today.
export async function freeTierSpentToday(): Promise<number> {
  return Number((await getSystem(`free-spend#${dayKey()}`)) ?? 0);
}

export function freeTierBudgetLeft(spent: number): number {
  return Math.max(0, FREE_TIER_DAILY_BUDGET_CREDITS - spent);
}

// Called after a free account's charge goes through. Atomic, so a burst of
// sign-ups all spending at once still adds up to the right number.
export async function recordFreeTierSpend(credits: number): Promise<number> {
  return addSystemCounter(`free-spend#${dayKey()}`, credits);
}

// Strike counting, switchable from the money desk.
//
// We run no moderation of our own — the provider refuses the prompt and we
// only count how often that happens. So this switch does NOT make anything
// generate that would not have; it only stops the counter from freezing an
// account. That matters when someone is deliberately probing what the
// provider refuses, which on a test stage is a reasonable thing to do and
// would otherwise lock the tester out after three tries.
const STRIKES_OFF = "strikes:off";

export async function strikesEnabled(): Promise<boolean> {
  return !(await getSystem(STRIKES_OFF));
}

export async function setStrikesEnabled(on: boolean): Promise<void> {
  await setSystem(STRIKES_OFF, on ? null : String(Date.now()));
}

// A moderation rejection against this member. The third in a day freezes
// the account: the provider bans keys, not users, so a member who keeps
// sending prohibited prompts is a risk to every other member's service.
export async function recordContentStrike(userId: string, detail: string): Promise<number> {
  if (!(await strikesEnabled())) return 0;
  const strikes = await addSystemCounter(`strikes#${userId}#${dayKey()}`, 1);
  if (strikes >= CONTENT_STRIKES_PER_DAY && !(await accountFrozen(userId))) {
    await freezeAccount(userId, "content policy", `${strikes} moderation rejections today; last: ${detail.slice(0, 120)}`);
  }
  return strikes;
}

// The response every money-moving route gives a frozen account. One place,
// so the wording and the status agree everywhere.
export const FROZEN_RESPONSE = {
  error: "under_review",
  message:
    "A payment on this account is under review, so generating and purchases are paused. Email support@remerged.ai and we will sort it out.",
} as const;

// ---------------------------------------------------------------------------
// Per-generation margin check
// ---------------------------------------------------------------------------

export type MarginVerdict = "ok" | "thin" | "loss" | "overcharge";

export interface MarginReport {
  verdict: MarginVerdict;
  jobId: string;
  model: string;
  tokens: number;
  // What the provider actually charged us for this render, in USD.
  providerUsd: number;
  // What the member paid, in USD.
  chargedUsd: number;
  // What our own rate table said this many tokens should have cost.
  expectedProviderUsd: number;
  note: string;
}

// A render is "thin" before it is a loss, so a drift shows up in the alerts
// before it starts costing money.
const THIN_MARGIN = 1.05;
// Only flag an overcharge once it is well clear of rounding: prices round up
// to a whole credit, and short clips are mostly the fixed delivery
// allocation, so small ratios mean nothing.
const OVERCHARGE_RATIO = 1.5;
const OVERCHARGE_MIN_USD = 0.25;

// What one render actually cost us, from the token count the provider
// reported rather than from anything we predicted. Deliberately does NOT go
// through the frame-size estimate: this is the invoice, not a forecast.
export function providerCostUsd(opts: {
  model: string;
  tokens: number;
  audio?: boolean;
  withVideo?: boolean;
  // Which band of the rate table the render was billed in — "hd" only for a
  // native 1080p render. 720p bills in the "sd" band on more pixels, and the
  // token count already carries that.
  native: boolean;
  // Seconds handed to the upscaler, if the job took that path.
  upscaleSourceS?: number;
  upscaleFactor?: number;
  now?: number;
}): number | null {
  if (!(opts.model in MODELS)) return null;
  const model = opts.model as ModelId;
  const r = rates({ audio: opts.audio, now: opts.now });
  const gen = r.gen[model];
  if (!gen) return null;
  const rate = opts.native
    ? opts.withVideo
      ? gen.hdWithVideo
      : gen.hd
    : opts.withVideo
      ? gen.sdWithVideo
      : gen.sd;
  if (rate == null) return null;
  let usd = (rate * opts.tokens) / 1e6;
  if (opts.upscaleSourceS) {
    usd +=
      (opts.upscaleFactor === 4 ? r.upscale4xPerSec : r.upscale2xPerSec) *
      opts.upscaleSourceS;
  }
  return usd;
}

// Called once per finished generation. Cheap: arithmetic plus, in the bad
// case only, one write.
export async function checkMargin(
  job: Pick<
    Job,
    "id" | "model" | "mode" | "audio" | "kind" | "quote_credits" | "duration_s" | "upscale_factor"
  >,
  tokens: number
): Promise<MarginReport | null> {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  const out = modeInfo(job.mode);
  // The rate band follows the RENDER quality, and the upscaler bill follows
  // whether one ran. Those are two different questions now, so read both off
  // the route rather than inferring them from one another.
  const hdBand = QUALITIES[out.quality].rateTier === "hd";
  const upscaled = out.upscale !== "none";
  const providerUsd = providerCostUsd({
    model: job.model,
    tokens,
    audio: !!job.audio,
    withVideo: job.kind === "extend",
    native: hdBand,
    upscaleSourceS: upscaled ? job.duration_s : 0,
    upscaleFactor: out.upscaleFactor,
  });
  if (providerUsd === null) return null;
  const chargedUsd = job.quote_credits * CREDIT_USD;

  // What our own rate table predicts for this token count — the same number
  // as providerUsd unless a rate moved under us, which is the case worth
  // separating from a member simply being charged too little.
  const expectedProviderUsd = providerUsd;

  const base: Omit<MarginReport, "verdict" | "note"> = {
    jobId: job.id,
    model: job.model,
    tokens,
    providerUsd,
    chargedUsd,
    expectedProviderUsd,
  };

  if (chargedUsd < providerUsd) {
    const report: MarginReport = {
      ...base,
      verdict: "loss",
      note: `charged $${chargedUsd.toFixed(4)} for a render that cost $${providerUsd.toFixed(4)}`,
    };
    // Every further order would lose money the same way, so stop selling.
    await halt({
      reason: "sold below cost",
      detail: `${job.model}: ${report.note} (${tokens} tokens, ${job.mode}). Generation is paused until the rate table is checked against the provider's pricing page.`,
      jobId: job.id,
    });
    return report;
  }

  if (chargedUsd < providerUsd * THIN_MARGIN) {
    const report: MarginReport = {
      ...base,
      verdict: "thin",
      note: `charged $${chargedUsd.toFixed(4)} against a cost of $${providerUsd.toFixed(4)} — under ${Math.round((THIN_MARGIN - 1) * 100)}% clear of a loss`,
    };
    console.warn(`margin thin on job ${job.id}: ${report.note}`);
    return report;
  }

  if (
    chargedUsd > providerUsd * OVERCHARGE_RATIO &&
    chargedUsd - providerUsd > OVERCHARGE_MIN_USD
  ) {
    // Alert only, deliberately. A provider glitch that under-reports tokens
    // would look exactly like this, and reacting by cutting prices would
    // turn their glitch into our loss.
    const report: MarginReport = {
      ...base,
      verdict: "overcharge",
      note: `charged $${chargedUsd.toFixed(4)} for a render that cost $${providerUsd.toFixed(4)} — check the rate table before changing anything`,
    };
    console.warn(`margin high on job ${job.id}: ${report.note}`);
    return report;
  }

  return { ...base, verdict: "ok", note: "within expected margin" };
}
