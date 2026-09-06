"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PLANS, TOPUP_PRESETS_USD } from "@/lib/config";

interface LedgerEntry {
  id: string;
  delta_credits: number;
  kind: string;
  memo: string | null;
  created_at: number;
}

interface Me {
  email: string;
  membership: "none" | "monthly" | "annual";
  membershipActive: boolean;
  membershipRenewsAt: number | null;
  balanceCredits: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  ledger: LedgerEntry[];
}

export default function AccountPanel() {
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  async function post(url: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return null;
      }
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function subscribe(plan: "monthly" | "annual") {
    const data = await post("/api/billing/subscribe", { plan }, `sub-${plan}`);
    if (!data) return;
    if (data.url.startsWith("/account?mock=")) {
      await post("/api/billing/mock", { kind: "subscribe", plan }, `sub-${plan}`);
      refresh();
    } else {
      window.location.href = data.url;
    }
  }

  async function topup(usd: number) {
    const data = await post("/api/billing/topup", { usd }, `top-${usd}`);
    if (!data) return;
    if (data.url.startsWith("/account?mock=")) {
      await post("/api/billing/mock", { kind: "topup", usd }, `top-${usd}`);
      refresh();
    } else {
      window.location.href = data.url;
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (!me) {
    return (
      <div className="py-16 text-center text-muted">
        Loading… if nothing appears,{" "}
        <a className="underline" href="/login?next=/account">
          sign in
        </a>
        .
      </div>
    );
  }

  const joinNudge = params.get("join") === "1" && !me.membershipActive;
  const topupNudge = params.get("topup") === "1" && me.membershipActive;
  const usedGb = me.storageUsedBytes / 1e9;
  const quotaGb = me.storageQuotaBytes / 1e9;

  return (
    <div className="space-y-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Account</h1>
        <button onClick={logout} className="text-sm text-muted underline hover:text-ink">
          Sign out
        </button>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {/* Membership */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Membership</h2>
        {me.membershipActive ? (
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-good">Active</span> —{" "}
            {PLANS[me.membership as "monthly" | "annual"].label} plan, renews{" "}
            {new Date(me.membershipRenewsAt!).toLocaleDateString()}. Storage
            included: {quotaGb.toFixed(0)} GB.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              {joinNudge
                ? "One step before your video: membership is what funds us — everything you generate after this is at cost."
                : "Membership is required to buy credits and generate."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => subscribe("monthly")}
                disabled={busy !== null}
                className="rounded-xl border border-line px-5 py-3 text-sm hover:border-accent disabled:opacity-50"
              >
                <span className="block font-semibold">${PLANS.monthly.priceUsd}/month</span>
                <span className="text-muted">{PLANS.monthly.storageGb} GB storage</span>
              </button>
              <button
                onClick={() => subscribe("annual")}
                disabled={busy !== null}
                className="rounded-xl border border-accent px-5 py-3 text-sm hover:opacity-90 disabled:opacity-50"
              >
                <span className="block font-semibold">
                  ${PLANS.annual.priceUsd}/year{" "}
                  <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-ink">
                    2 months free
                  </span>
                </span>
                <span className="text-muted">{PLANS.annual.storageGb} GB storage</span>
              </button>
            </div>
          </>
        )}
      </section>

      {/* Credits */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Credits</h2>
        <p className="mt-2 text-3xl font-semibold">
          ${(me.balanceCredits / 1000).toFixed(2)}
          <span className="ml-2 text-sm font-normal text-muted">
            {me.balanceCredits.toLocaleString()} credits
          </span>
        </p>
        {topupNudge && (
          <p className="mt-1 text-sm text-bad">Add credits to run your video.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {TOPUP_PRESETS_USD.map((usd) => (
            <button
              key={usd}
              onClick={() => topup(usd)}
              disabled={busy !== null || !me.membershipActive}
              className="rounded-xl border border-line px-5 py-2 text-sm hover:border-accent disabled:opacity-50"
            >
              +${usd}
            </button>
          ))}
        </div>
        {!me.membershipActive && (
          <p className="mt-2 text-xs text-muted">Join above to enable top-ups.</p>
        )}
      </section>

      {/* Storage */}
      {me.membershipActive && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-medium">Storage</h2>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, (usedGb / Math.max(quotaGb, 0.01)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {usedGb.toFixed(2)} GB of {quotaGb.toFixed(0)} GB used
          </p>
        </section>
      )}

      {/* History */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">History</h2>
        {me.ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No activity yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {me.ledger.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-2 text-muted">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-2">{e.memo || e.kind}</td>
                  <td
                    className={`py-2 text-right font-medium ${
                      e.delta_credits >= 0 ? "text-good" : ""
                    }`}
                  >
                    {e.delta_credits >= 0 ? "+" : ""}
                    {(e.delta_credits / 1000).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
