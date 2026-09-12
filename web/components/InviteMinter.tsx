"use client";

import { useCallback, useEffect, useState } from "react";

interface InviteRow {
  code: string;
  plan: string;
  createdAt: number;
  createdBy: string;
  expiresAt: number;
  state: "live" | "used" | "expired";
  redeemedBy: string | null;
}

interface Listing {
  invites: InviteRow[];
  counts: { live: number; used: number; expired: number };
  outstandingUsd: number;
}

const when = (ms: number) => new Date(ms).toLocaleDateString();

// Minting the codes that go out in DMs, and seeing what is still outstanding.
//
// The outstanding figure is the point of this panel. Each live code is a
// promise of one month's allocation, so twenty codes in the wild is a real
// number on the downside — not a marketing statistic.
export default function InviteMinter() {
  const [list, setList] = useState<Listing | null>(null);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/invite")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setList(d))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Could not mint those.");
      } else {
        setMinted(d.invites.map((i: { code: string }) => i.code));
        load();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-medium">Invite codes</h2>
      <p className="mt-2 text-sm text-muted">
        One use each, first month free on Standard monthly, expiring in 30 days. Each live code is
        worth up to <strong className="text-ink">$6.03</strong> of allocation if it is redeemed and
        spent to the last credit.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-muted">How many</span>
          <input
            id="invite-count"
            type="number"
            min={1}
            max={25}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            className="mt-1 w-24 rounded-lg border border-line bg-bg px-3 py-2 tabular-nums"
          />
        </label>
        <button
          onClick={mint}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Minting…" : `Mint ${count}`}
        </button>
        {list && (
          <span className="text-sm text-muted">
            {list.counts.live} live · {list.counts.used} used · {list.counts.expired} expired ·{" "}
            <strong className="text-ink">${list.outstandingUsd.toFixed(2)}</strong> outstanding
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-fail">{error}</p>}

      {minted.length > 0 && (
        <div className="mt-4 rounded-xl border border-accent bg-accent/10 p-3">
          <p className="text-sm font-medium">Fresh codes — copy them now</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {minted.map((c) => (
              <code key={c} className="rounded-lg bg-surface px-2 py-1 font-mono tracking-wider">
                {c}
              </code>
            ))}
          </div>
        </div>
      )}

      {list && list.invites.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-4 font-normal">Code</th>
                <th className="py-1 pr-4 font-normal">State</th>
                <th className="py-1 pr-4 font-normal">Used by</th>
                <th className="py-1 pr-4 font-normal">Expires</th>
              </tr>
            </thead>
            <tbody>
              {list.invites.slice(0, 30).map((i) => (
                <tr key={i.code} className="border-t border-line">
                  <td className="py-1 pr-4 font-mono tracking-wider">{i.code}</td>
                  <td className="py-1 pr-4">
                    <span
                      className={
                        i.state === "live"
                          ? "text-accent"
                          : i.state === "used"
                            ? "text-muted"
                            : "text-muted line-through"
                      }
                    >
                      {i.state}
                    </span>
                  </td>
                  <td className="py-1 pr-4 text-muted">{i.redeemedBy ?? "—"}</td>
                  <td className="py-1 pr-4 tabular-nums text-muted">{when(i.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
