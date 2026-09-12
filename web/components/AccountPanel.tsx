"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BillingInterval,
  PAID_PLAN_IDS,
  PLANS,
  PlanId,
  TOPUP_PRESETS_USD,
} from "@/lib/config";
import { MIN_TOPUP_PLAN } from "@/lib/config";
import IntervalToggle from "./IntervalToggle";
import PlanPrice from "./PlanPrice";
import ReferralCard from "./ReferralCard";

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
  creditRefundUsd: number;
  canBuyCredits: boolean;
  canUpscale: boolean;
  cancelAtPeriodEnd: boolean;
  deactivated: boolean;
  deactivatedAt: number | null;
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
  // Set when a free member reaches for something their plan does not include.
  // Points them at the plans rather than leaving a button that does nothing.
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  const plansRef = useRef<HTMLElement | null>(null);
  // Which of the three leaving options is open. Only one at a time, and none
  // by default: these should take a deliberate act to reach.
  const [leaving, setLeaving] = useState<"unsubscribe" | "deactivate" | "delete" | null>(null);
  // An invite code, if they were given one. Empty for almost everyone, so it
  // sits under the plans rather than above them.
  const [invite, setInvite] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
      { plan, interval: billingInterval, ...(invite.trim() ? { invite: invite.trim() } : {}) },
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
    // A plan that cannot buy credits must not leave a dead button. Say what
    // is needed, and move them to where they can do it.
    if (me && !me.canBuyCredits) {
      setUpgradeReason(
        MIN_TOPUP_PLAN
          ? `Buying credits needs ${PLANS[MIN_TOPUP_PLAN].label} or above — the ${me.planLabel} plan has no card on file. Pick a plan here and top-ups unlock straight away.`
          : "Buying credits is not available on your plan."
      );
      plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const data = await post("/api/billing/topup", { usd }, `top-${usd}`);
    if (!data) return;
    if (data.url.startsWith("/account?mock=")) {
      await post("/api/billing/mock", { kind: "topup", usd }, `top-${usd}`);
      refresh();
    } else {
      window.location.href = data.url;
    }
  }

  async function account(action: string, extra: Record<string, unknown> = {}) {
    const data = await post("/api/account", { action, ...extra }, `acct-${action}`);
    if (!data) return;
    setNotice(data.message ?? null);
    setLeaving(null);
    setConfirmEmail("");
    // Deactivation and deletion both end the session server-side, so there is
    // nothing left to show here.
    if (action === "deactivate" || action === "delete") {
      window.location.href = action === "delete" ? "/?deleted=1" : "/?deactivated=1";
      return;
    }
    refresh();
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
      {notice && (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {me.deactivated && (
        <section className="rounded-2xl border border-accent bg-accent/10 p-5">
          <h2 className="font-medium">This account is deactivated</h2>
          <p className="mt-1 text-sm text-muted">
            Deactivated{" "}
            {me.deactivatedAt ? new Date(me.deactivatedAt).toLocaleDateString() : ""}. Nothing
            is being billed and nothing will generate. Your videos are untouched.
          </p>
          <button
            onClick={() => account("reactivate")}
            disabled={busy !== null}
            className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            Reactivate account
          </button>
        </section>
      )}

      {/* Membership */}
      <section
        ref={plansRef}
        className={`rounded-2xl border bg-surface p-5 ${
          upgradeReason ? "border-accent" : "border-line"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Membership</h2>
          {/* Yearly is a plan-wide choice, not a separate plan, so it sits
              above the tiers rather than doubling their number. */}
          {!me.membershipActive && (
            <IntervalToggle value={interval} onChange={setInterval} />
          )}
        </div>

        {upgradeReason && (
          <p className="mt-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
            {upgradeReason}
          </p>
        )}

        {me.membershipActive ? (
          <p className="mt-2 text-sm text-muted">
            <span className={`font-medium ${me.cancelAtPeriodEnd ? "text-bad" : "text-good"}`}>
              {me.cancelAtPeriodEnd ? "Cancelled" : "Active"}
            </span>{" "}
            — {me.planLabel} plan,{" "}
            {me.billingInterval === "year" ? "billed yearly" : "billed monthly"},{" "}
            {me.cancelAtPeriodEnd ? "ends" : "renews"}{" "}
            {new Date(me.membershipRenewsAt!).toLocaleDateString()}
            {me.cancelAtPeriodEnd && " and will not renew"}. Storage included:{" "}
            {quotaGb.toFixed(0)} GB.{" "}
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
                      {/* "free" because they come WITH the plan rather than
                          being bought on top of it — the distinction the
                          top-up buttons below are about. */}
                      {p.credits.toLocaleString()} free credits a month
                    </span>
                    <span className="block text-muted">{p.storageGb} GB storage</span>
                  </button>
                );
              })}
            </div>
            <label className="mt-4 block text-sm">
              <span className="text-muted">Have an invite code?</span>
              <input
                id="invite-code"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
                placeholder="First month free"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full max-w-xs rounded-lg border border-line bg-bg px-3 py-2 font-mono tracking-wider uppercase placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
              />
              <span className="mt-1 block text-xs text-muted">
                Enter it, then pick the plan it is for. Invites are for Standard, billed monthly.
              </span>
            </label>
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
              disabled={busy !== null}
              className="rounded-xl border border-line px-5 py-2 text-sm hover:border-accent disabled:opacity-50"
            >
              +${usd}
            </button>
          ))}
        </div>
        {!me.canBuyCredits && (
          <p className="mt-2 text-xs text-muted">
            Top-ups need{" "}
            {MIN_TOPUP_PLAN ? `${PLANS[MIN_TOPUP_PLAN].label} or above` : "a paid plan"} —{" "}
            <button onClick={() => topup(0)} className="underline hover:text-ink">
              see plans
            </button>
            . Your {me.planLabel} credits still work as they are.
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

      <ReferralCard />

      {/* Leaving */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Leaving</h2>
        <p className="mt-1 text-sm text-muted">
          Three different things, and only the last one cannot be undone.
        </p>

        <div className="mt-4 divide-y divide-line">
          {/* Unsubscribe — only means anything on a paid plan. */}
          {me.membershipActive && !me.cancelAtPeriodEnd && (
            <div className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Cancel your plan</p>
                  <p className="text-sm text-muted">
                    Stops the billing. You keep this account, your library and
                    any credits you bought, and your {me.planLabel} plan runs to{" "}
                    {me.membershipRenewsAt
                      ? new Date(me.membershipRenewsAt).toLocaleDateString()
                      : "the end of the period"}{" "}
                    before moving to Free.
                  </p>
                </div>
                <button
                  onClick={() => setLeaving(leaving === "unsubscribe" ? null : "unsubscribe")}
                  className="shrink-0 rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent"
                >
                  Cancel plan
                </button>
              </div>
              {leaving === "unsubscribe" && (
                <div className="mt-3 space-y-3 rounded-xl border border-line p-4 text-sm">
                  <p className="text-muted">
                    Cancel the {me.planLabel} plan? Plan fees are not refunded —
                    what you get is the rest of the period you have already paid
                    for. Your plan keeps working until{" "}
                    <span className="font-medium text-ink">
                      {me.membershipRenewsAt
                        ? new Date(me.membershipRenewsAt).toLocaleDateString()
                        : "the end of the period"}
                    </span>
                    , so there is nothing to gain by cancelling early.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => account("unsubscribe")}
                    disabled={busy !== null}
                    className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                  >
                    Yes, cancel
                  </button>
                  <button onClick={() => setLeaving(null)} className="text-muted underline">
                    Keep it
                  </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {me.membershipActive && me.cancelAtPeriodEnd && (
            <div className="py-4">
              <p className="font-medium">Your plan is cancelled</p>
              <p className="text-sm text-muted">
                {me.planLabel} runs until{" "}
                {me.membershipRenewsAt
                  ? new Date(me.membershipRenewsAt).toLocaleDateString()
                  : "the end of the period"}{" "}
                and will not renew, then this account moves to Free. Your
                library and any credits you bought stay put. To carry on, pick
                a plan above.
              </p>
            </div>
          )}

          {/* Deactivate. */}
          <div className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">Deactivate account</p>
                <p className="text-sm text-muted">
                  Puts everything on hold. Billing stops, nothing generates, and
                  your videos stay where they are. Sign back in whenever you
                  like and it all comes back.
                </p>
              </div>
              <button
                onClick={() => setLeaving(leaving === "deactivate" ? null : "deactivate")}
                className="shrink-0 rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent"
              >
                Deactivate
              </button>
            </div>
            {leaving === "deactivate" && (
              <div className="mt-3 space-y-3 rounded-xl border border-line p-4 text-sm">
                <p className="text-muted">
                  You will be signed out.
                  {me.membershipActive && (
                    <>
                      {" "}
                      Your plan is cancelled at the same time. Plan fees are not
                      refunded, so the period you have paid for runs to{" "}
                      <span className="font-medium text-ink">
                        {me.membershipRenewsAt
                          ? new Date(me.membershipRenewsAt).toLocaleDateString()
                          : "the end of the period"}
                      </span>{" "}
                      either way — reactivate before then and the remaining time
                      is still yours.
                    </>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => account("deactivate")}
                  disabled={busy !== null}
                  className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                >
                  Deactivate
                </button>
                <button onClick={() => setLeaving(null)} className="text-muted underline">
                  Never mind
                </button>
                </div>
              </div>
            )}
          </div>

          {/* Delete — the only irreversible one, and it says so. */}
          <div className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-bad">Delete account</p>
                <p className="text-sm text-muted">
                  Permanent. Every video is removed from storage and your
                  account, history and credits are erased. There is no undo and
                  we cannot recover it for you.
                </p>
              </div>
              <button
                onClick={() => setLeaving(leaving === "delete" ? null : "delete")}
                className="shrink-0 rounded-full border border-bad px-4 py-1.5 text-sm text-bad hover:bg-bad/10"
              >
                Delete
              </button>
            </div>
            {leaving === "delete" && (
              <div className="mt-3 space-y-3 rounded-xl border border-bad p-4 text-sm">
                <p>
                  This deletes <span className="font-medium">{me.email}</span>,
                  {" "}
                  <span className="font-medium">{me.ledger.length > 0 ? "your history" : "your account"}</span>
                  {" "}and every video you have made.
                </p>
                {me.balanceCredits > 0 && (
                  <p className="text-bad">
                    You still hold {me.balanceCredits.toLocaleString()} credits
                    (${(me.balanceCredits * 0.01).toFixed(2)}), and deleting
                    forfeits every one of them.
                    {me.creditRefundUsd > 0 ? (
                      <>
                        {" "}
                        Of those, the credits you bought would refund{" "}
                        <span className="font-medium">
                          ${me.creditRefundUsd.toFixed(2)}
                        </span>{" "}
                        after card fees — ask for that{" "}
                        <Link href="/help/plans-billing-credits/refunds" className="underline">
                          before deleting
                        </Link>
                        , because once the account is gone there is nothing to
                        refund against.
                      </>
                    ) : (
                      <>
                        {" "}
                        They all came with your plan rather than being bought, so
                        none of them is refundable —{" "}
                        <Link href="/help/plans-billing-credits/refunds" className="underline">
                          why
                        </Link>
                        .
                      </>
                    )}
                  </p>
                )}
                <label className="block">
                  <span className="text-muted">Type {me.email} to confirm</span>
                  <input
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    placeholder={me.email}
                    className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-bad"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => account("delete", { confirm: confirmEmail })}
                    disabled={
                      busy !== null ||
                      confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()
                    }
                    className="rounded-full bg-bad px-4 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    Delete my account
                  </button>
                  <button onClick={() => setLeaving(null)} className="text-muted underline">
                    Keep my account
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
