"use client";

import { showLoader } from "@/lib/ui-events";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ANNUAL_DISCOUNT,
  BillingInterval,
  DEFAULT_MODEL,
  MODELS,
  PAID_PLAN_IDS,
  PLANS,
  PlanId,
  planPriceUsd,
  effectiveMonthlyUsd,
} from "@/lib/config";
import { SEEDANCE_ALSO_POWERS } from "@/lib/landing";
import { fetchMe } from "@/lib/me-client";
import { track } from "@/lib/track-client";

// The plan modal. One place to upgrade from wherever the question comes up:
// the header's Upgrade button, the composer refusing a locked option, the
// offer after the welcome flow. Dark on the light site so it reads as its
// own moment; a banner across the top that says the one true promotional
// thing there is to say; a plan to pick on the left, yearly or monthly on
// the right, one button.
//
// Signed out, the button goes to sign-up with the plan carried along.
// Signed in, it opens the same Stripe checkout the account page does.

const PLAN_BLURB: Record<string, string> = {
  standard: "Every model, full HD, 4K upscaling, and credits every month.",
  pro: "Every model, no waiting, 4K — the plan for people who make video every week.",
  max: "The most credits, the most storage, and a month of rollover.",
};

function features(id: PlanId): string[] {
  const p = PLANS[id];
  const out = [
    `${p.credits.toLocaleString()} credits every month, reset monthly`,
    `Every Seedance model, including ${MODELS[DEFAULT_MODEL].label}`,
    "Native 1080p renders and AI upscaling to 4K",
    "Buy more credits any time — bought credits never expire",
    `${p.storageGb} GB of storage`,
  ];
  if (p.priority >= 2) out.push("Skip the queue — priority generation");
  if (p.rolloverMonths > 0) out.push(`Unused credits carry over for ${p.rolloverMonths} month`);
  return out;
}

// The banner. A provider promotion that our prices pass straight through
// is the one thing worth a banner; when none is running it says what the
// plans are instead of inventing an offer.
function bannerText(now = Date.now()): string {
  const d = (MODELS[DEFAULT_MODEL] as { discount?: { pct: number; until: string } }).discount;
  if (d && Date.parse(d.until) > now) {
    const until = new Date(d.until).toLocaleDateString(undefined, { day: "numeric", month: "long" });
    return `${Math.round(d.pct * 100)}% off ${MODELS[DEFAULT_MODEL].label} 1080p renders until ${until} — passed straight through to your price.`;
  }
  return "Every model, 4K upscaling, and credits every month. Priced at cost.";
}

export default function PlanModal({ from, onClose }: { from: string; onClose: () => void }) {
  const [plan, setPlan] = useState<PlanId>("pro");
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const banner = useMemo(() => bannerText(), []);

  useEffect(() => {
    track("plans_opened", { from });
    fetchMe().then(({ user }) => {
      setSignedIn(!!user);
      setCurrent(user?.plan ?? null);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    track("plans_checkout", { plan, interval, signed_in: !!signedIn });
    if (!signedIn) {
      showLoader();
        window.location.assign(`/signup?plan=${plan}&interval=${interval}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return;
      }
      if (typeof data.url === "string" && data.url.startsWith("/account?mock=")) {
        // Local mock billing: apply the plan directly, as the account page does.
        await fetch("/api/billing/mock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "subscribe", plan, interval }),
        });
        showLoader();
        window.location.assign("/account");
        return;
      }
      showLoader();
        window.location.assign(data.url);
    } finally {
      setBusy(false);
    }
  }

  const p = PLANS[plan];
  const yearlyPerMonth = effectiveMonthlyUsd(plan, "year");
  const yearlyTotal = planPriceUsd(plan, "year");
  const saved = Math.round(p.monthlyUsd * 12 - yearlyTotal);
  const isCurrent = current === plan;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Centred in the viewport when it fits, scrollable when it does not:
          the flex box is at least the viewport tall, so a short modal sits
          in the middle and a tall one starts at the top and scrolls. */}
      <div className="flex min-h-full items-center justify-center p-4">
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-[#111318] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top right of the card, where a close button belongs. It sits over
            the banner, which is light, so it is drawn dark. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-2 z-10 rounded-full p-1.5 text-[#111318]/50 hover:bg-black/10 hover:text-[#111318]"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
        <div className="bg-gradient-to-r from-emerald-200/80 via-lime-100 to-sky-200/80 px-12 py-2.5 text-center text-sm font-medium text-[#111318]">
          {banner}
        </div>
        <div className="border-b border-white/10 px-6 py-4 text-center">
          <p className="text-xs text-white/60">Built on Seedance, the video model that also powers</p>
          <p className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm font-semibold text-white/70">
            {SEEDANCE_ALSO_POWERS.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </p>
        </div>

        <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="flex items-center gap-1 rounded-full border border-white/15 p-1 text-xs">
              {PAID_PLAN_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPlan(id)}
                  className={`rounded-full px-3 py-1 ${plan === id ? "bg-white text-[#111318]" : "text-white/70 hover:text-white"}`}
                >
                  {PLANS[id].label}
                </button>
              ))}
            </div>
            <span className="mt-5 inline-block rounded-full bg-accent/25 px-2.5 py-1 text-xs font-medium text-indigo-200">
              Everything unlocked
            </span>
            <h2 id="plan-modal-title" className="mt-2 text-3xl font-semibold tracking-tight">
              Upgrade to {p.label}
            </h2>
            <p className="mt-2 text-white/70">{PLAN_BLURB[plan]}</p>
            <ul className="mt-5 space-y-2.5 text-sm text-white/85">
              {features(plan).map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-0.5 text-emerald-300" aria-hidden>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="self-center">
            <div className="space-y-3">
              <label
                className={`relative block cursor-pointer rounded-xl border p-4 ${
                  interval === "year" ? "border-white bg-white/5" : "border-white/15 hover:border-white/40"
                }`}
              >
                <input
                  type="radio"
                  name="interval"
                  className="sr-only"
                  checked={interval === "year"}
                  onChange={() => setInterval("year")}
                />
                <span className="absolute -top-3 right-4 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#111318]">
                  SAVE ${saved}
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">Yearly</span>
                  <span>
                    <s className="mr-1 text-sm text-white/50">${p.monthlyUsd}</s>
                    <span className="text-xl font-semibold">
                      ${Number.isInteger(yearlyPerMonth) ? yearlyPerMonth : yearlyPerMonth.toFixed(2)}
                    </span>
                    <span className="text-sm text-white/60">/month</span>
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-xs text-white/60">
                  <span>Billed yearly as ${yearlyTotal}</span>
                  <span>save {Math.round(ANNUAL_DISCOUNT * 100)}%</span>
                </div>
              </label>
              <label
                className={`block cursor-pointer rounded-xl border p-4 ${
                  interval === "month" ? "border-white bg-white/5" : "border-white/15 hover:border-white/40"
                }`}
              >
                <input
                  type="radio"
                  name="interval"
                  className="sr-only"
                  checked={interval === "month"}
                  onChange={() => setInterval("month")}
                />
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">Monthly</span>
                  <span>
                    <span className="text-xl font-semibold">${p.monthlyUsd}</span>
                    <span className="text-sm text-white/60">/month</span>
                  </span>
                </div>
                <div className="mt-1 text-right text-xs text-white/60">Cancel anytime</div>
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
            <button
              type="button"
              onClick={start}
              disabled={busy || isCurrent}
              className="mt-4 w-full rounded-xl bg-accent py-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            >
              {isCurrent ? `You are on ${p.label}` : busy ? "Opening checkout…" : `Start creating on ${p.label}`}
            </button>
            <p className="mt-3 text-center text-xs text-white/60">
              Cancel anytime · Secure checkout ·{" "}
              <Link href="/pricing" onClick={onClose} className="underline underline-offset-2 hover:text-white">
                Compare all plans
              </Link>
            </p>
            <p className="mt-2 text-center text-xs text-white/50">
              Credits are still granted monthly on a yearly plan — a cheaper month, not a year up front.
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
