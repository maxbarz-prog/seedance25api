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

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", usd: "", memo: "" });

  const refresh = useCallback(() => {
    fetch("/api/admin/overview").then(async (r) => {
      if (!r.ok) {
        setDenied(true);
        return;
      }
      setData(await r.json());
    });
  }, []);
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
