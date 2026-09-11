"use client";

import { ANNUAL_DISCOUNT, BillingInterval } from "@/lib/config";

// Yearly first, and selected by default wherever this appears: it is the
// better deal for the member and the one we would rather sell, so it should
// not be the option they have to go looking for.
export default function IntervalToggle({
  value,
  onChange,
  className = "",
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className={`inline-flex items-center gap-1 rounded-full border border-line p-1 text-xs ${className}`}
    >
      {(["year", "month"] as const).map((i) => (
        <button
          key={i}
          role="radio"
          aria-checked={value === i}
          onClick={() => onChange(i)}
          className={`rounded-full px-3 py-1 transition-colors ${
            value === i ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
          }`}
        >
          {i === "year" ? `Yearly · save ${Math.round(ANNUAL_DISCOUNT * 100)}%` : "Monthly"}
        </button>
      ))}
    </div>
  );
}
