"use client";

import Link from "next/link";
import { SEEDANCE_ALSO_POWERS, } from "@/lib/landing";
import { SITE_NAME } from "@/lib/config";
import ShowcaseReel from "./ShowcaseReel";

// The sign-in and sign-up screen: footage on the left, a white panel on the
// right with one question at a time and a row of dots saying how many are
// left. The footage is the product making its own case while the form is
// filled in; the white is the same ground as the landing page.

export default function AuthShell({
  steps,
  step,
  onBack,
  children,
}: {
  steps: number;
  step: number;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-1/2 lg:block">
        <div className="sticky top-0 h-screen">
          <ShowcaseReel />
        </div>
      </aside>
      <section className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center justify-between p-6">
          {onBack ? (
            <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink">
              ← Back
            </button>
          ) : (
            <Link href="/" className="text-lg font-semibold tracking-tight">
              {SITE_NAME}
            </Link>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-sm">
            <ol className="mb-6 flex items-center justify-center gap-1.5" aria-label="Progress">
              {Array.from({ length: steps }, (_, i) => (
                <li
                  key={i}
                  aria-current={i === step ? "step" : undefined}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? "w-6 bg-accent" : i < step ? "w-1.5 bg-accent/60" : "w-1.5 bg-line"
                  }`}
                />
              ))}
            </ol>
            {children}
          </div>
        </div>
        <div className="px-6 pb-8">
          <p className="text-xs text-muted">Built on Seedance, the video model that also powers</p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-ink/50">
            {SEEDANCE_ALSO_POWERS.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </p>
        </div>
      </section>
    </div>
  );
}

// The form atoms, shared by every step so the three flows look like one.
export function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        {...rest}
        className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-accent disabled:opacity-60"
      />
    </label>
  );
}

export function Primary({ children, busy, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className="w-full rounded-full bg-ink py-3 font-medium text-surface hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "…" : children}
    </button>
  );
}

export function Secondary({
  children,
  busy,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-line py-3 font-medium hover:border-accent disabled:opacity-50"
    >
      {busy ? <span className="spinner spinner-sm" aria-hidden /> : children}
    </button>
  );
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function Or() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1C3.2 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.5-1.5-.5-3.1 0-4.6V6.6H1.2c-1.6 3.3-1.6 7.5 0 10.8l4.1-3.1z" />
      <path fill="#EA4335" d="M12 4.7c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.1 0 12 0 7.3 0 3.2 2.7 1.2 6.6l4.1 3.1c.9-2.9 3.6-5 6.7-5z" />
    </svg>
  );
}

export function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
