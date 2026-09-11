"use client";

import Link from "next/link";
import { useState } from "react";
import { BillingInterval, PLANS, PLAN_IDS } from "@/lib/config";
import IntervalToggle from "./IntervalToggle";
import PlanPrice from "./PlanPrice";

// The plan cards, with the same billing toggle and the same price rendering
// the signup picker uses. Shared rather than restated: a pricing page showing
// $15 while the signup shows $12 is the kind of contradiction people notice
// at exactly the wrong moment.
export default function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("year");

  return (
    <>
      <div className="mt-6 flex items-center gap-3">
        <IntervalToggle value={interval} onChange={setInterval} />
        {interval === "year" && (
          <span className="text-xs text-muted">
            Credits are still granted monthly — a yearly plan buys a cheaper
            month, not a year of credits up front.
          </span>
        )}
      </div>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          return (
            <div
              key={id}
              className={`rounded-2xl border bg-surface p-6 ${
                id === "pro" ? "border-accent" : "border-line"
              }`}
            >
              <h2 className="font-medium">{p.label}</h2>
              <div className="mt-2">
                <PlanPrice plan={id} interval={interval} />
              </div>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                {/* "free" because they come WITH the plan rather than being
                    bought on top of it — the distinction the next line, about
                    buying more, turns on. */}
                <li className="text-ink">
                  {p.credits.toLocaleString()} free credits
                  {p.recurring ? " a month" : ", once"}
                </li>
                <li>{p.storageGb} GB storage</li>
                <li>{p.canUpscale ? "Upscaling to 4K included" : "No upscaling"}</li>
                <li>
                  {p.canBuyCredits
                    ? "Buy more credits any time — bought credits never expire"
                    : "No credit top-ups on this plan"}
                </li>
                {p.rolloverMonths > 0 && (
                  <li>
                    Unused credits carry over for {p.rolloverMonths} month
                    {p.rolloverMonths > 1 ? "s" : ""}
                  </li>
                )}
                {p.priority > 0 && <li>Priority {p.priority} in the queue</li>}
              </ul>
              <Link
                href={p.monthlyUsd === 0 ? "/signup" : `/signup?plan=${id}&interval=${interval}`}
                className={`mt-4 block rounded-full px-4 py-2 text-center text-sm font-medium ${
                  id === "pro"
                    ? "bg-accent text-accent-ink hover:opacity-90"
                    : "border border-line hover:border-accent"
                }`}
              >
                {p.monthlyUsd === 0 ? "Start free" : `Choose ${p.label}`}
              </Link>
            </div>
          );
        })}
      </section>
    </>
  );
}
