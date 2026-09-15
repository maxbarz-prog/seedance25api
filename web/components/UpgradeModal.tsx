"use client";

import { useEffect } from "react";
import { FREE_MODEL, FREE_QUALITY, FREE_MAX_DURATION_S, MODELS, PLANS } from "@/lib/config";
import { track } from "@/lib/track-client";
import { openPlans } from "@/lib/ui-events";

// The one-time offer after the welcome flow. Full screen, in our own
// styling: this is the moment a new member learns what the free account is
// and what a plan adds, said once and plainly. Whether it was shown is
// recorded on the user row, so it is never shown twice.

export default function UpgradeModal({ onClose }: { onClose: () => void }) {
  const std = PLANS.standard;
  useEffect(() => {
    track("upgrade_modal_shown");
    fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "upgrade_seen" }),
    }).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    track("upgrade_modal_dismissed");
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 px-4 py-10 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-3xl">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-muted">
          You are in
        </p>
        <h2 id="upgrade-title" className="mt-2 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Your first video is on us.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted">
          Free accounts come with {PLANS.free.credits} credits: one {FREE_MAX_DURATION_S}-second clip on{" "}
          {MODELS[FREE_MODEL].label} at {FREE_QUALITY}. A plan opens every model, full HD and 4K.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h3 className="font-medium">Free</h3>
            <p className="mt-1 text-2xl font-semibold">$0</p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>{PLANS.free.credits} credits, once</li>
              <li>{MODELS[FREE_MODEL].label} at {FREE_QUALITY}, up to {FREE_MAX_DURATION_S}s</li>
              <li>No upscaling</li>
              <li>{PLANS.free.storageGb} GB of storage</li>
            </ul>
          </div>
          <div className="rounded-2xl border-2 border-accent bg-surface p-6">
            <h3 className="font-medium">{std.label}</h3>
            <p className="mt-1 text-2xl font-semibold">
              ${std.monthlyUsd}
              <span className="text-base font-normal text-muted">/month</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>{std.credits.toLocaleString()} credits every month</li>
              <li>Every model, including Seedance 2.5</li>
              <li>Full HD renders and 4K upscaling</li>
              <li>{std.storageGb} GB of storage, top-ups any time</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => {
              track("upgrade_modal_clicked", { plan: "standard" });
              onClose();
              openPlans("welcome-offer");
            }}
            className="w-full rounded-full bg-accent px-8 py-3 text-center font-medium text-accent-ink hover:opacity-90 sm:w-auto"
          >
            See plans
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-full border border-line px-8 py-3 text-center font-medium text-muted hover:border-accent hover:text-ink sm:w-auto"
          >
            Start with the free video
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Prices in credits everywhere. A credit is a cent.
        </p>
      </div>
    </div>
  );
}
