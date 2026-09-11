"use client";

import Link from "next/link";
import { CREDIT_USD, MIN_TOPUP_PLAN, PLANS } from "@/lib/config";

// Shown instead of silently bouncing the member to /account when a generation
// is refused for money reasons. Three causes, one dialog: the plan does not
// include what was asked for, or there are not enough credits — the second
// tells them exactly how short they are, and whether the fix is a top-up or
// an upgrade (a free member cannot buy credits).
export interface CreditsBlock {
  reason: "membership_required" | "plan_required" | "insufficient_credits";
  needed?: number;
  balance?: number;
  canBuyCredits?: boolean;
  message?: string;
}

function usd(credits: number) {
  return (credits * CREDIT_USD).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export default function CreditsDialog({
  block,
  onClose,
}: {
  block: CreditsBlock | null;
  onClose: () => void;
}) {
  if (!block) return null;
  const membership =
    block.reason === "membership_required" || block.reason === "plan_required";
  // Short of credits on a plan that cannot buy them: the only way forward is
  // a paid plan, so offer that instead of a purchase that would be refused.
  const upgrade = membership || block.canBuyCredits === false;
  const short =
    block.needed !== undefined && block.balance !== undefined
      ? Math.max(0, block.needed - block.balance)
      : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="credits-dialog-title" className="text-lg font-semibold">
          {membership ? "Your plan does not include this" : "Not enough credits"}
        </h2>

        {membership ? (
          <p className="mt-2 text-sm text-muted">
            {block.message ?? "Pick a plan that includes it — your draft is kept."}
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              This generation costs{" "}
              <span className="font-medium text-ink">{usd(block.needed ?? 0)}</span> and
              your balance is{" "}
              <span className="font-medium text-ink">{usd(block.balance ?? 0)}</span>.
            </p>
            {short !== undefined && short > 0 && (
              <p className="mt-1 text-sm text-muted">
                {upgrade ? (
                  <>
                    You are {usd(short)} short, and your plan cannot buy credits.{" "}
                    {MIN_TOPUP_PLAN
                      ? `${PLANS[MIN_TOPUP_PLAN].label} ($${PLANS[MIN_TOPUP_PLAN].monthlyUsd}/month) is the cheapest plan that can, and it includes ${PLANS[MIN_TOPUP_PLAN].credits.toLocaleString()} credits a month.`
                      : "A paid plan adds credits every month."}
                  </>
                ) : (
                  <>
                    Add at least <span className="font-medium text-ink">{usd(short)}</span>{" "}
                    to continue.
                  </>
                )}
              </p>
            )}
          </>
        )}

        <div className="mt-5 flex items-center justify-end gap-3 text-sm">
          <Link
            href={
              membership
                ? "/help/plans-billing-credits/plans"
                : "/help/troubleshooting/not-enough-credits"
            }
            className="mr-auto text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Why?
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-1.5 text-muted hover:border-accent hover:text-ink"
          >
            Not now
          </button>
          <Link
            href={upgrade ? "/account?join=1" : "/account?topup=1"}
            className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90"
          >
            {upgrade ? "See plans" : "Add credits"}
          </Link>
        </div>
      </div>
    </div>
  );
}
