"use client";

import Link from "next/link";
import { CREDIT_USD } from "@/lib/config";

// Shown instead of silently bouncing the member to /account when a generation
// is refused for money reasons. Two causes, one dialog: no active membership,
// or not enough credits — the second tells them exactly how short they are.
export interface CreditsBlock {
  reason: "membership_required" | "insufficient_credits";
  needed?: number;
  balance?: number;
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
  const membership = block.reason === "membership_required";
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
          {membership ? "Membership required" : "Not enough credits"}
        </h2>

        {membership ? (
          <p className="mt-2 text-sm text-muted">
            Generating needs an active membership. Join and your draft is kept.
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
                Add at least <span className="font-medium text-ink">{usd(short)}</span> to
                continue.
              </p>
            )}
          </>
        )}

        <div className="mt-5 flex items-center justify-end gap-3 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-1.5 text-muted hover:border-accent hover:text-ink"
          >
            Not now
          </button>
          <Link
            href={membership ? "/account?join=1" : "/account?topup=1"}
            className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90"
          >
            {membership ? "Join" : "Add credits"}
          </Link>
        </div>
      </div>
    </div>
  );
}
