"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Overview {
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
  modelTiming?: ModelTiming[];
  users: {
    id: string;
    email: string;
    membership: string;
    membership_renews_at: number | null;
    created_at: number;
    balance_credits: number;
    jobs_count: number;
    storage_bytes: number;
  }[];
  jobs: {
    id: string;
    email: string;
    prompt: string;
    duration_s: number;
    mode: string;
    status: string;
    quote_credits: number;
    created_at: number;
  }[];
}

type Level = "good" | "warn" | "bad" | "unknown";
type Group = "config" | "internal" | "dependency" | "vendor" | "deprecation";

interface Check {
  key: string;
  group: Group;
  label: string;
  value: string;
  level: Level;
  note: string;
  ms?: number;
  blame?: "us" | "them" | "unclear";
  link?: string;
}

interface Status {
  checkedAt: number;
  stage: string;
  overall: Level;
  checks: Check[];
}

const DOT: Record<Level, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  unknown: "bg-muted",
};

// Ordered so the panel reads the way you diagnose: how is this stage set up,
// are our own pieces working, can we reach each vendor, is the vendor saying
// anything, and is anything we depend on going away.
const GROUPS: { key: Group; title: string; blurb: string }[] = [
  { key: "config", title: "Configuration", blurb: "how this stage is wired" },
  { key: "internal", title: "Our systems", blurb: "database, storage and the job pipeline" },
  { key: "dependency", title: "Vendor access", blurb: "can we reach them right now, with our keys" },
  { key: "vendor", title: "Vendor incidents", blurb: "what they are telling the world" },
  { key: "deprecation", title: "Deprecation", blurb: "are the models we pin still offered" },
];

const BLAME: Record<string, string> = {
  us: "our side",
  them: "their side",
  unclear: "unclear",
};

function usd(credits: number) {
  return `$${(credits * 0.01).toFixed(2)}`;
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
    </div>
  );
}

interface ModelTiming {
  model: string;
  mode: string;
  samples: number;
  medianSecPerOutputSec: number;
  p90SecPerOutputSec: number;
  queueSharePct: number | null;
  medianTotalS: number;
}

interface MoneyIssue {
  jobId: string;
  userId: string;
  email?: string;
  credits: number;
  status: string;
  reason: string;
  createdAt: number;
}

interface Money {
  halt: { reason: string; detail: string; at: number; jobId?: string; by?: string } | null;
  issues: MoneyIssue[];
  owedCredits: number;
}

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", usd: "", memo: "" });
  const [money, setMoney] = useState<Money | null>(null);
  const [moneyBusy, setMoneyBusy] = useState(false);

  const loadMoney = useCallback(() => {
    fetch("/api/admin/money")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMoney)
      .catch(() => setMoney(null));
  }, []);

  async function moneyAction(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setMoneyBusy(true);
    try {
      const res = await fetch("/api/admin/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setMsg(
        res.ok
          ? d.refunded !== undefined
            ? `Refunded ${d.refunded} job(s), ${usd(d.credits)}.`
            : "Done."
          : d.error || "Failed."
      );
      loadMoney();
    } finally {
      setMoneyBusy(false);
    }
  }

  const loadStatus = useCallback((force: boolean) => {
    setStatusBusy(true);
    fetch(`/api/admin/status${force ? "?force=1" : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusBusy(false));
  }, []);

  const refresh = useCallback(() => {
    fetch("/api/admin/overview").then(async (r) => {
      if (!r.ok) {
        setDenied(true);
        return;
      }
      setData(await r.json());
    });
    loadStatus(false);
    loadMoney();
  }, [loadStatus, loadMoney]);
  useEffect(refresh, [refresh]);

  async function submitGrant(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/admin/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: grant.email,
        usd: Number(grant.usd),
        memo: grant.memo,
      }),
    });
    const d = await res.json();
    setMsg(res.ok ? "Credits adjusted." : d.error || "Failed.");
    if (res.ok) {
      setGrant({ email: "", usd: "", memo: "" });
      refresh();
    }
  }

  async function comp(email: string) {
    const res = await fetch("/api/admin/comp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, plan: "monthly" }),
    });
    setMsg(res.ok ? `Comped 1 month for ${email}.` : "Failed.");
    if (res.ok) refresh();
  }

  if (denied) {
    return (
      <div className="py-16 text-center text-muted">
        Nothing here.{" "}
        <Link href="/" className="underline">
          Home
        </Link>
      </div>
    );
  }
  if (!data) return <div className="py-16 text-center text-muted">Loading…</div>;

  const t = data.totals;
  const failPct =
    t.jobsReady + t.jobsFailed > 0
      ? ((t.jobsFailed / (t.jobsReady + t.jobsFailed)) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-8 py-10">
      <h1 className="text-2xl font-semibold">Admin</h1>

      {/* Money desk. The halt switch is the first thing on the page because
          when it is on, nothing else here matters. */}
      <section
        className={`rounded-2xl border p-5 ${
          money?.halt ? "border-red-500 bg-red-500/5" : "border-line bg-surface"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {money?.halt ? "⛔ Generation halted" : "Money"}
          </h2>
          {money?.halt ? (
            <button
              onClick={() =>
                moneyAction(
                  { action: "resume" },
                  "Resume selling? Only do this once you know why it halted."
                )
              }
              disabled={moneyBusy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              Resume generation
            </button>
          ) : (
            <button
              onClick={() =>
                moneyAction(
                  { action: "halt", reason: "manual" },
                  "Stop all generation now? Members will be told we are checking a billing issue and nobody will be charged."
                )
              }
              disabled={moneyBusy}
              className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-red-500 hover:text-red-500 disabled:opacity-50"
            >
              Halt generation
            </button>
          )}
        </div>

        {money?.halt && (
          <p className="mt-2 text-sm">
            <span className="font-medium">{money.halt.reason}</span> — {money.halt.detail}
            <span className="text-muted">
              {" "}
              ({new Date(money.halt.at).toLocaleString()}
              {money.halt.by ? ` · ${money.halt.by}` : ""})
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted">
            {money === null
              ? "Checking…"
              : money.issues.length === 0
                ? "Charged and unspent: nothing outstanding."
                : `${money.issues.length} charge(s) with no matching spend — ${usd(money.owedCredits)} owed back.`}
          </p>
          {!!money?.issues.length && (
            <button
              onClick={() =>
                moneyAction(
                  { action: "refund-all" },
                  `Refund ${usd(money.owedCredits)} across ${money.issues.length} job(s)?`
                )
              }
              disabled={moneyBusy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              Refund all
            </button>
          )}
        </div>

        {!!money?.issues.length && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 font-normal">Member</th>
                  <th className="py-2 font-normal">Owed</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 font-normal">Why</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {money.issues.slice(0, 50).map((i) => (
                  <tr key={i.jobId} className="border-b border-line last:border-0">
                    <td className="py-2">{i.email}</td>
                    <td className="py-2 tabular-nums">{usd(i.credits)}</td>
                    <td className="py-2 text-muted">{i.status}</td>
                    <td className="py-2 text-muted">{i.reason}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => moneyAction({ action: "refund", jobId: i.jobId })}
                        disabled={moneyBusy}
                        className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent disabled:opacity-50"
                      >
                        Refund
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-medium">
            {status && (
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${DOT[status.overall]}`} />
            )}
            System status
          </h2>
          <span className="flex items-center gap-3 text-xs text-muted">
            {status && (
              <>
                <span>
                  {status.overall === "good"
                    ? "Everything we can check is healthy"
                    : status.overall === "warn"
                      ? "Running, with something worth a look"
                      : "Something is broken"}
                </span>
                <span>· checked {new Date(status.checkedAt).toLocaleTimeString()}</span>
              </>
            )}
            <button
              onClick={() => loadStatus(true)}
              disabled={statusBusy}
              className="underline hover:text-ink disabled:opacity-50"
            >
              {statusBusy ? "Checking…" : "Re-check"}
            </button>
          </span>
        </div>

        {!status ? (
          <p className="mt-3 text-sm text-muted">
            {statusBusy ? "Running checks…" : "Status unavailable."}
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {GROUPS.map((g) => {
              const rows = status.checks.filter((c) => c.group === g.key);
              if (!rows.length) return null;
              return (
                <div key={g.key}>
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {g.title} <span className="normal-case tracking-normal">— {g.blurb}</span>
                  </p>
                  <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((c) => (
                      <li key={c.key} className="flex items-start gap-2.5 text-sm">
                        <span
                          aria-hidden
                          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.level]}`}
                        />
                        <span className="min-w-0">
                          <span className="text-muted">{c.label}: </span>
                          {c.link ? (
                            <a
                              href={c.link}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline decoration-line underline-offset-2"
                            >
                              {c.value}
                            </a>
                          ) : (
                            <span className="font-medium">{c.value}</span>
                          )}
                          {c.blame && (
                            <span className="ml-1 rounded bg-bg px-1.5 py-0.5 text-xs text-muted">
                              {BLAME[c.blame]}
                            </span>
                          )}
                          {c.ms !== undefined && (
                            <span className="ml-1 text-xs text-muted tabular-nums">{c.ms}ms</span>
                          )}
                          <span className="sr-only"> — {c.level}</span>
                          <span className="block text-xs text-muted">{c.note}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {!!data?.modelTiming?.length && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-medium">Generation speed</h2>
          <p className="mt-1 text-sm text-muted">
            Seconds of waiting per second of finished video, from real jobs.
            Median, so one stuck job cannot move it. A high queue share is the
            provider being busy rather than the model being slow — that is what
            a rate-limit increase buys back.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 font-normal">Model</th>
                  <th className="py-2 font-normal">Output</th>
                  <th className="py-2 font-normal">s per output s</th>
                  <th className="py-2 font-normal">p90</th>
                  <th className="py-2 font-normal">Typical job</th>
                  <th className="py-2 font-normal">Queued</th>
                  <th className="py-2 font-normal">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {data.modelTiming!.map((t) => (
                  <tr key={`${t.model}-${t.mode}`} className="border-b border-line last:border-0">
                    <td className="py-2">{t.model}</td>
                    <td className="py-2 text-muted">
                      {t.mode === "native-1080p" ? "1080p native" : "1080p upscaled"}
                    </td>
                    <td className="py-2 font-medium tabular-nums">
                      {t.medianSecPerOutputSec.toFixed(1)}x
                    </td>
                    <td className="py-2 tabular-nums text-muted">
                      {t.p90SecPerOutputSec.toFixed(1)}x
                    </td>
                    <td className="py-2 tabular-nums text-muted">{t.medianTotalS}s</td>
                    <td className="py-2 tabular-nums">
                      {t.queueSharePct === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className={t.queueSharePct >= 50 ? "text-amber-500" : "text-muted"}>
                          {t.queueSharePct}%
                        </span>
                      )}
                    </td>
                    <td className="py-2 tabular-nums text-muted">{t.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Users" value={String(t.users)} />
        <Tile
          label="Active members"
          value={String(t.activeMembers)}
          detail={`${t.monthlyMembers} monthly · ${t.annualMembers} annual`}
        />
        <Tile
          label="Est. membership rev / mo"
          value={`$${t.estMonthlyMembershipUsd.toFixed(0)}`}
          detail="memberships"
        />
        <Tile
          label="Credits purchased"
          value={usd(t.creditsPurchased)}
          detail={`spent ${usd(t.creditsSpent)} · refunded ${usd(t.creditsRefunded)}`}
        />
        <Tile
          label="Videos delivered"
          value={String(t.jobsReady)}
          detail={`${t.jobsInFlight} in flight`}
        />
        <Tile label="Failure rate" value={`${failPct}%`} detail={`${t.jobsFailed} failed`} />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Adjust credits</h2>
        <form onSubmit={submitGrant} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input
            required
            type="email"
            placeholder="user email"
            value={grant.email}
            onChange={(e) => setGrant({ ...grant, email: e.target.value })}
            className="w-56 rounded-lg border border-line bg-bg px-3 py-2"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="± USD"
            value={grant.usd}
            onChange={(e) => setGrant({ ...grant, usd: e.target.value })}
            className="w-28 rounded-lg border border-line bg-bg px-3 py-2"
          />
          <input
            required
            placeholder="memo (visible to the user)"
            value={grant.memo}
            onChange={(e) => setGrant({ ...grant, memo: e.target.value })}
            className="w-72 rounded-lg border border-line bg-bg px-3 py-2"
          />
          <button className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink">
            Apply
          </button>
          {msg && <span className="text-muted">{msg}</span>}
        </form>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Users</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 pr-4 font-normal">Email</th>
                <th className="pb-2 pr-4 font-normal">Membership</th>
                <th className="pb-2 pr-4 font-normal">Balance</th>
                <th className="pb-2 pr-4 font-normal">Videos</th>
                <th className="pb-2 pr-4 font-normal">Storage</th>
                <th className="pb-2 pr-4 font-normal">Joined</th>
                <th className="pb-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const active =
                  u.membership !== "none" && (u.membership_renews_at ?? 0) > Date.now();
                return (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-2 pr-4">{u.email}</td>
                    <td className="py-2 pr-4">
                      {active ? `✓ ${u.membership}` : "— none"}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{usd(u.balance_credits)}</td>
                    <td className="py-2 pr-4 tabular-nums">{u.jobs_count}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {(u.storage_bytes / 1e9).toFixed(2)} GB
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      {!active && (
                        <button
                          onClick={() => comp(u.email)}
                          className="rounded-lg border border-line px-2 py-1 text-xs hover:border-accent"
                        >
                          Comp 1 mo
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Recent jobs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 pr-4 font-normal">When</th>
                <th className="pb-2 pr-4 font-normal">User</th>
                <th className="pb-2 pr-4 font-normal">Prompt</th>
                <th className="pb-2 pr-4 font-normal">Spec</th>
                <th className="pb-2 pr-4 font-normal">Price</th>
                <th className="pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id} className="border-t border-line">
                  <td className="py-2 pr-4 text-muted">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{j.email}</td>
                  <td className="max-w-64 truncate py-2 pr-4">{j.prompt}</td>
                  <td className="py-2 pr-4 text-muted">
                    {j.duration_s}s · {j.mode === "native-1080p" ? "native" : "upscaled"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{usd(j.quote_credits)}</td>
                  <td className="py-2">
                    {j.status === "failed"
                      ? "✕ failed"
                      : j.status === "ready"
                        ? "✓ ready"
                        : `… ${j.status}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
