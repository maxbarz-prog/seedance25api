"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BillingInterval,
  PAID_PLAN_IDS,
  PLANS,
  PlanId,
  TOPUP_PRESETS_USD,
} from "@/lib/config";
import IntervalToggle from "./IntervalToggle";
import PlanPrice from "./PlanPrice";

interface LedgerEntry {
  id: string;
  delta_credits: number;
  kind: string;
  memo: string | null;
  created_at: number;
}

interface Me {
  email: string;
  plan: PlanId;
  planLabel: string;
  billingInterval: BillingInterval;
  membershipActive: boolean;
  membershipRenewsAt: number | null;
  balanceCredits: number;
  grantedCredits: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  canBuyCredits: boolean;
  canUpscale: boolean;
  ledger: LedgerEntry[];
}

export default function AccountPanel() {
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [authMode, setAuthMode] = useState<"clerk" | "builtin">("builtin");
  const [busy, setBusy] = useState<string | null>(null);
  // Yearly by default: it is the better deal, and the member who wants to
  // pay monthly can say so in one click. Switching shows the undiscounted
  // price rather than hiding it. A period chosen on the pricing page arrives
  // as a query param and wins over the default.
  const [interval, setInterval] = useState<BillingInterval>(
    params.get("interval") === "month" ? "month" : "year"
  );
  // Likewise the tier, which is highlighted rather than bought: they have
  // just made an account, and being dropped straight onto a card form is not
  // what picking a plan on the pricing page asked for.
  const pickedPlan = PAID_PLAN_IDS.find((p) => p === params.get("plan"));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setMe(d.user);
        if (d.auth) setAuthMode(d.auth);
      })
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

  async function subscribe(plan: PlanId, billingInterval: BillingInterval) {
    const key = `sub-${plan}-${billingInterval}`;
    const data = await post(
      "/api/billing/subscribe",
      { plan, interval: billingInterval },
      key
    );
    if (!data) return;
    if (data.url.startsWith("/account?mock=")) {
      await post(
        "/api/billing/mock",
        { kind: "subscribe", plan, interval: billingInterval },
        key
      );
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

  async function portal() {
    const data = await post("/api/billing/portal", {}, "portal");
    if (data?.url) window.location.href = data.url;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    if (authMode === "clerk") {
      const { default: SignOut } = await import("@/components/ClerkSignOut");
      await SignOut();
    }
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
  const topupNudge = params.get("topup") === "1" && me.canBuyCredits;
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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Membership</h2>
          {/* Yearly is a plan-wide choice, not a separate plan, so it sits
              above the tiers rather than doubling their number. */}
          {!me.membershipActive && (
            <IntervalToggle value={interval} onChange={setInterval} />
          )}
        </div>

        {me.membershipActive ? (
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-good">Active</span> —{" "}
            {me.planLabel} plan, {me.billingInterval === "year" ? "billed yearly" : "billed monthly"}, renews{" "}
            {new Date(me.membershipRenewsAt!).toLocaleDateString()}. Storage
            included: {quotaGb.toFixed(0)} GB.{" "}
            <button onClick={portal} className="underline hover:text-ink">
              Manage subscription
            </button>{" "}
            — change or cancel your plan there.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              {pickedPlan
                ? `You picked ${PLANS[pickedPlan].label}. Confirm it below, or choose another.`
                : joinNudge
                ? "One step before your video: pick a plan."
                : `You are on the ${me.planLabel} plan: ${PLANS[me.plan].credits.toLocaleString()} credits, ${PLANS[me.plan].storageGb} GB storage, upscaling included. Credit top-ups need a paid plan.`}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {PAID_PLAN_IDS.map((id) => {
                const p = PLANS[id];
                return (
                  <button
                    key={id}
                    onClick={() => subscribe(id, interval)}
                    disabled={busy !== null}
                    className={`rounded-xl border px-5 py-3 text-left text-sm disabled:opacity-50 ${
                      id === (pickedPlan ?? "pro")
                        ? "border-accent ring-1 ring-accent"
                        : "border-line hover:border-accent"
                    }`}
                  >
                    <span className="block font-semibold">{p.label}</span>
                    <PlanPrice plan={id} interval={interval} />
                    <span className="mt-2 block text-muted">
                      {p.credits.toLocaleString()} credits a month
                    </span>
                    <span className="block text-muted">{p.storageGb} GB storage</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Credits */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Credits</h2>
        <p className="mt-2 text-3xl font-semibold">
          ${(me.balanceCredits * 0.01).toFixed(2)}
          <span className="ml-2 text-sm font-normal text-muted">
            {me.balanceCredits.toLocaleString()} credits
          </span>
        </p>
        {/* Granted credits expire with the plan period; bought ones do not,
            so the split is worth showing rather than one opaque total. */}
        {me.grantedCredits > 0 && (
          <p className="mt-1 text-xs text-muted">
            {me.grantedCredits.toLocaleString()} from your plan
            {PLANS[me.plan].rolloverMonths > 0
              ? ` (carries over for ${PLANS[me.plan].rolloverMonths} month)`
              : " (expires when the plan renews)"}
            {me.balanceCredits > me.grantedCredits &&
              ` · ${(me.balanceCredits - me.grantedCredits).toLocaleString()} bought, never expires`}
          </p>
        )}
        {topupNudge && (
          <p className="mt-1 text-sm text-bad">Add credits to run your video.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {TOPUP_PRESETS_USD.map((usd) => (
            <button
              key={usd}
              onClick={() => topup(usd)}
              disabled={busy !== null || !me.canBuyCredits}
              className="rounded-xl border border-line px-5 py-2 text-sm hover:border-accent disabled:opacity-50"
            >
              +${usd}
            </button>
          ))}
        </div>
        {!me.canBuyCredits && (
          <p className="mt-2 text-xs text-muted">
            Top-ups need a paid plan — pick one above. Your {me.planLabel} credits
            still work as they are.
          </p>
        )}
      </section>

      {/* Storage */}
      <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-medium">Storage</h2>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, (usedGb / Math.max(quotaGb, 0.01)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {usedGb.toFixed(2)} GB of {quotaGb.toFixed(0)} GB used on{" "}
            {me.planLabel}
          </p>
      </section>

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
                    {(e.delta_credits * 0.01).toFixed(2)}
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
