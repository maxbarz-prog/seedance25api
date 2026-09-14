import { randomUUID } from "crypto";
import { addEvents, allUsers, Event, eventsForDay, User } from "./db";
import { effectivePlan } from "./plan";
import { PLANS } from "./config";

// Growth events: what people do between arriving and paying, counted.
//
// Two sources write them. The browser reports what only it can see — a page
// opened, a welcome step finished, the upgrade offer dismissed — through
// /api/events. The server writes the events that must not be fakeable or
// skippable, at the moment they are true: an account row created, a job
// started, a plan paid for. The admin page reads them back in aggregate.
//
// Every name is listed here, and /api/events refuses anything else. A page
// cannot invent a step, and a report never has to guess what a name meant.

export const CLIENT_EVENTS = [
  // The front door.
  "landing_viewed",
  "cta_clicked",
  // The composer.
  "create_viewed",
  "generate_clicked",
  "locked_option_clicked",
  // Sign-up, as far as we can see it. Clerk draws the form itself, so the
  // page opening is the last thing the browser can report before the account
  // exists; the server reports that.
  "signup_viewed",
  // The welcome flow.
  "welcome_viewed",
  "welcome_step_done",
  "referral_entered",
  "referral_skipped",
  "survey_answered",
  "welcome_completed",
  // The one-time upgrade offer after it.
  "upgrade_modal_shown",
  "upgrade_modal_clicked",
  "upgrade_modal_dismissed",
] as const;

export const SERVER_EVENTS = [
  "account_created",
  "signup_grant",
  "referral_applied",
  "referral_vested",
  "job_created",
  "job_ready",
  "job_failed",
  "plan_started",
] as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[number];
export type ServerEventName = (typeof SERVER_EVENTS)[number];
export type EventName = ClientEventName | ServerEventName;

export type Props = Record<string, string | number | boolean | null>;
export type Attribution = Record<string, string>;

// What a browser may tell us about where a person came from. Fixed keys, so
// the report can group on them; short values, so nothing free-form lands in
// the table.
export const ATTR_KEYS = [
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "landing",
  "referrer",
] as const;

export const MAX_BATCH = 20;
const MAX_PROPS = 8;
const MAX_KEY = 32;
const MAX_VALUE = 64;
const MAX_ATTR_VALUE = 120;

// Visitor ids are minted in the browser: a prefix and twenty base-36
// characters. The prefix is what tells a visitor from a user id in the
// report, so it is checked here rather than assumed later.
export const VISITOR_RE = /^v_[a-z0-9]{20}$/;

export function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// Keep only what the shape allows; drop the rest silently. A malformed
// event is not worth a 400 that stops the good ones in the same batch.
export function cleanProps(input: unknown): Props | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Props = {};
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_PROPS) break;
    if (typeof k !== "string" || k.length > MAX_KEY || !/^[a-z][a-z0-9_]*$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_VALUE);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean" || v === null) out[k] = v;
    else continue;
    n++;
  }
  return n ? out : null;
}

export function cleanAttr(input: unknown): Attribution | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Attribution = {};
  for (const k of ATTR_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, MAX_ATTR_VALUE);
  }
  return Object.keys(out).length ? out : null;
}

// Record events the server itself vouches for. Never throws: a tally must
// not fail the request that produced the thing being tallied.
export async function record(
  name: ServerEventName,
  actor: string,
  props?: Props | null,
  opts: { visitor?: string | null; attr?: Attribution | null; at?: number } = {}
): Promise<void> {
  const at = opts.at ?? Date.now();
  try {
    await addEvents([
      {
        id: randomUUID(),
        day: dayOf(at),
        name,
        actor,
        visitor: opts.visitor ?? null,
        props: props ?? null,
        attr: opts.attr ?? null,
        created_at: at,
      },
    ]);
  } catch (e) {
    console.error(`event ${name} for ${actor} not recorded:`, e);
  }
}

// ── the report ─────────────────────────────────────────────────────────────

export interface FunnelStep {
  key: string;
  label: string;
  // Distinct people who reached this step in the window.
  people: number;
  // Of those who reached the step before, how many reached this one.
  ofPreviousPct: number | null;
  // Of those who reached the first step.
  ofFirstPct: number | null;
}

export interface Breakdown {
  answer: string;
  people: number;
  // How many of them have a paid plan right now, and how many paid inside
  // the window. "Now" is the honest one for a question asked at signup —
  // someone who answered in August and paid in September still counts.
  paidNow: number;
  paidInWindow: number;
}

export interface GrowthReport {
  days: number;
  from: string;
  to: string;
  events: number;
  funnel: FunnelStep[];
  // The welcome flow on its own, from the account existing to the offer
  // being answered, so a leak inside it is visible without the rest.
  welcome: FunnelStep[];
  survey: { role: Breakdown[]; goal: Breakdown[] };
  referrals: {
    entered: number;
    accepted: number;
    unknown: number;
    self: number;
    alreadyReferred: number;
    skipped: number;
    applied: number;
    vested: number;
    topCodes: { code: string; applied: number; vested: number }[];
  };
  upgrade: {
    shown: number;
    clicked: number;
    dismissed: number;
    // Paid after seeing it, within the window.
    convertedInWindow: number;
  };
  free: {
    // Accounts created in the window.
    accounts: number;
    // Of those, how many never started a job.
    neverGenerated: number;
    // …how many started at least one.
    generated: number;
    // …how many are on a paid plan now.
    paidNow: number;
  };
  locked: { option: string; clicks: number }[];
  attribution: {
    sources: { source: string; visitors: number; accounts: number }[];
    landings: { path: string; visitors: number; accounts: number }[];
  };
  daily: { day: string; landing: number; signups: number; jobs: number; paid: number }[];
}

const FUNNEL: { key: string; label: string; names: EventName[] }[] = [
  { key: "landing", label: "Saw the landing page", names: ["landing_viewed"] },
  { key: "create", label: "Opened the composer", names: ["create_viewed"] },
  { key: "generate", label: "Pressed Generate", names: ["generate_clicked"] },
  { key: "signup", label: "Reached sign-up", names: ["signup_viewed"] },
  { key: "account", label: "Account created", names: ["account_created"] },
  { key: "welcome", label: "Finished the welcome flow", names: ["welcome_completed"] },
  { key: "job", label: "Started a video", names: ["job_created"] },
  { key: "ready", label: "Got a finished video", names: ["job_ready"] },
  { key: "paid", label: "Paid for a plan", names: ["plan_started"] },
];

const WELCOME: { key: string; label: string; test: (e: Event) => boolean }[] = [
  { key: "account", label: "Account created", test: (e) => e.name === "account_created" },
  { key: "opened", label: "Opened /welcome", test: (e) => e.name === "welcome_viewed" },
  {
    key: "terms",
    label: "Step 1: account finalised",
    test: (e) => e.name === "welcome_step_done" && e.props?.step === "finalize",
  },
  {
    key: "referral",
    label: "Step 2: referral answered",
    test: (e) => e.name === "welcome_step_done" && e.props?.step === "referral",
  },
  {
    key: "survey",
    label: "Step 3: survey answered",
    test: (e) => e.name === "welcome_step_done" && e.props?.step === "survey",
  },
  { key: "offer", label: "Saw the upgrade offer", test: (e) => e.name === "upgrade_modal_shown" },
  {
    key: "answered",
    label: "Answered the offer",
    test: (e) => e.name === "upgrade_modal_clicked" || e.name === "upgrade_modal_dismissed",
  },
];

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function steps(
  defs: { key: string; label: string; test: (e: Event) => boolean }[],
  events: Event[],
  personOf: (e: Event) => string
): FunnelStep[] {
  const sets = defs.map(() => new Set<string>());
  for (const e of events) {
    defs.forEach((d, i) => {
      if (d.test(e)) sets[i].add(personOf(e));
    });
  }
  const first = sets[0]?.size ?? 0;
  return defs.map((d, i) => ({
    key: d.key,
    label: d.label,
    people: sets[i].size,
    ofPreviousPct: i === 0 ? null : pct(sets[i].size, sets[i - 1].size),
    ofFirstPct: i === 0 ? null : pct(sets[i].size, first),
  }));
}

function top<T extends string>(counts: Map<T, number>, n: number): { key: T; n: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, v]) => ({ key, n: v }));
}

export async function growthReport(days: number): Promise<GrowthReport> {
  const d = Math.max(1, Math.min(90, Math.floor(days)));
  const now = Date.now();
  const dayKeys = Array.from({ length: d }, (_, i) => dayOf(now - i * 86_400_000)).reverse();
  const [perDay, users] = await Promise.all([
    Promise.all(dayKeys.map((k) => eventsForDay(k))),
    allUsers(),
  ]);
  const events = perDay.flat().sort((a, b) => a.created_at - b.created_at);
  const userById = new Map<string, User>(users.map((u) => [u.id, u]));
  const paidNow = (id: string) => {
    const u = userById.get(id);
    return !!u && PLANS[effectivePlan(u)].monthlyUsd > 0;
  };

  // Stitch visitors to users: any event that carries both was written for a
  // signed-in browser, and says the two are one person.
  const visitorToUser = new Map<string, string>();
  for (const e of events) {
    if (e.visitor && !VISITOR_RE.test(e.actor)) visitorToUser.set(e.visitor, e.actor);
  }
  const personOf = (e: Event) => visitorToUser.get(e.actor) ?? e.actor;

  const funnel = steps(
    FUNNEL.map((f) => ({ ...f, test: (e: Event) => (f.names as string[]).includes(e.name) })),
    events,
    personOf
  );
  const welcome = steps(WELCOME, events, personOf);

  // Survey: the latest answer per person per question.
  const roleOf = new Map<string, string>();
  const goalOf = new Map<string, string>();
  const paidInWindow = new Set<string>();
  for (const e of events) {
    if (e.name === "plan_started") paidInWindow.add(personOf(e));
    if (e.name !== "survey_answered") continue;
    const q = String(e.props?.question ?? "");
    const a = String(e.props?.answer ?? "");
    if (!a) continue;
    if (q === "role") roleOf.set(personOf(e), a);
    if (q === "goal") goalOf.set(personOf(e), a);
  }
  const breakdown = (m: Map<string, string>): Breakdown[] => {
    const by = new Map<string, Breakdown>();
    for (const [person, answer] of m) {
      const b = by.get(answer) ?? { answer, people: 0, paidNow: 0, paidInWindow: 0 };
      b.people++;
      if (paidNow(person)) b.paidNow++;
      if (paidInWindow.has(person)) b.paidInWindow++;
      by.set(answer, b);
    }
    return [...by.values()].sort((a, b) => b.people - a.people);
  };

  // Referrals.
  const ref = { entered: 0, accepted: 0, unknown: 0, self: 0, alreadyReferred: 0, skipped: 0, applied: 0, vested: 0 };
  const codeApplied = new Map<string, number>();
  const codeVested = new Map<string, number>();
  for (const e of events) {
    if (e.name === "referral_entered") {
      ref.entered++;
      const r = String(e.props?.result ?? "");
      if (r === "ok") ref.accepted++;
      else if (r === "unknown-code") ref.unknown++;
      else if (r === "self") ref.self++;
      else if (r === "already-referred") ref.alreadyReferred++;
    } else if (e.name === "referral_skipped") ref.skipped++;
    else if (e.name === "referral_applied") {
      ref.applied++;
      const c = String(e.props?.code ?? "");
      if (c) codeApplied.set(c, (codeApplied.get(c) ?? 0) + 1);
    } else if (e.name === "referral_vested") {
      ref.vested++;
      const c = String(e.props?.code ?? "");
      if (c) codeVested.set(c, (codeVested.get(c) ?? 0) + 1);
    }
  }
  const topCodes = top(codeApplied, 10).map(({ key, n }) => ({
    code: key,
    applied: n,
    vested: codeVested.get(key) ?? 0,
  }));

  // The upgrade offer.
  const shownAt = new Map<string, number>();
  const up = { shown: 0, clicked: 0, dismissed: 0, convertedInWindow: 0 };
  for (const e of events) {
    const p = personOf(e);
    if (e.name === "upgrade_modal_shown") {
      up.shown++;
      if (!shownAt.has(p)) shownAt.set(p, e.created_at);
    } else if (e.name === "upgrade_modal_clicked") up.clicked++;
    else if (e.name === "upgrade_modal_dismissed") up.dismissed++;
    else if (e.name === "plan_started") {
      const s = shownAt.get(p);
      if (s !== undefined && e.created_at >= s) up.convertedInWindow++;
    }
  }

  // Free accounts made in the window, and what became of them.
  const created = new Set<string>();
  const generated = new Set<string>();
  for (const e of events) {
    if (e.name === "account_created") created.add(personOf(e));
    if (e.name === "job_created") generated.add(personOf(e));
  }
  const free = {
    accounts: created.size,
    generated: [...created].filter((p) => generated.has(p)).length,
    neverGenerated: [...created].filter((p) => !generated.has(p)).length,
    paidNow: [...created].filter(paidNow).length,
  };

  // Which locked options people click on. The answer to "what would they
  // pay for", straight from the composer.
  const lockedCounts = new Map<string, number>();
  for (const e of events) {
    if (e.name !== "locked_option_clicked") continue;
    const k = `${e.props?.kind ?? "?"}: ${e.props?.value ?? "?"}`;
    lockedCounts.set(k, (lockedCounts.get(k) ?? 0) + 1);
  }
  const locked = top(lockedCounts, 12).map(({ key, n }) => ({ option: key, clicks: n }));

  // Attribution: the first attr we saw for each person, then who among them
  // made an account.
  const attrOf = new Map<string, Attribution>();
  for (const e of events) {
    const p = personOf(e);
    if (e.attr && !attrOf.has(p)) attrOf.set(p, e.attr);
  }
  const sourceCounts = new Map<string, { visitors: number; accounts: number }>();
  const landingCounts = new Map<string, { visitors: number; accounts: number }>();
  for (const [p, a] of attrOf) {
    const source = a.ref
      ? `referral ${a.ref}`
      : a.utm_source
        ? `utm ${a.utm_source}${a.utm_medium ? ` / ${a.utm_medium}` : ""}`
        : a.referrer
          ? a.referrer
          : "direct";
    const s = sourceCounts.get(source) ?? { visitors: 0, accounts: 0 };
    s.visitors++;
    if (created.has(p)) s.accounts++;
    sourceCounts.set(source, s);
    const l = landingCounts.get(a.landing ?? "/") ?? { visitors: 0, accounts: 0 };
    l.visitors++;
    if (created.has(p)) l.accounts++;
    landingCounts.set(a.landing ?? "/", l);
  }
  const rank = (m: Map<string, { visitors: number; accounts: number }>) =>
    [...m.entries()].sort((a, b) => b[1].visitors - a[1].visitors).slice(0, 10);

  const daily = dayKeys.map((day, i) => {
    const es = perDay[i];
    const distinct = (name: string) => new Set(es.filter((e) => e.name === name).map(personOf)).size;
    return {
      day,
      landing: distinct("landing_viewed"),
      signups: distinct("account_created"),
      jobs: es.filter((e) => e.name === "job_created").length,
      paid: distinct("plan_started"),
    };
  });

  return {
    days: d,
    from: dayKeys[0],
    to: dayKeys[dayKeys.length - 1],
    events: events.length,
    funnel,
    welcome,
    survey: { role: breakdown(roleOf), goal: breakdown(goalOf) },
    referrals: { ...ref, topCodes },
    upgrade: up,
    free,
    locked,
    attribution: {
      sources: rank(sourceCounts).map(([source, v]) => ({ source, ...v })),
      landings: rank(landingCounts).map(([path, v]) => ({ path, ...v })),
    },
    daily,
  };
}
