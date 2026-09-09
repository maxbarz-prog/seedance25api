"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CREDIT_USD, SITE_NAME } from "@/lib/config";

interface Me {
  email: string;
  balanceCredits: number;
  membershipActive: boolean;
}

// Anything that spends or adds credits fires this so the header re-reads the
// balance without a full navigation.
export const BALANCE_EVENT = "remerged:balance";

export default function Header() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener(BALANCE_EVENT, load);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(BALANCE_EVENT, load);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const balance = me
    ? (me.balanceCredits * CREDIT_USD).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      })
    : null;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {SITE_NAME}
        </Link>
        <nav className="flex items-center gap-3 text-sm sm:gap-5">
          <Link href="/pricing" className="hidden text-muted hover:text-ink sm:inline">
            Pricing
          </Link>
          {!loaded ? null : me ? (
            <>
              <Link href="/library" className="text-muted hover:text-ink">
                Library
              </Link>
              {/* Balance is always on screen: it is what decides whether the
                  next generation can run. */}
              <span
                className="flex items-center overflow-hidden rounded-full border border-line"
                title={`${me.balanceCredits} credits`}
              >
                <Link
                  href="/account"
                  className="px-3 py-1 font-medium tabular-nums hover:bg-bg"
                  aria-label={`Credit balance ${balance}`}
                >
                  {balance}
                </Link>
                <Link
                  href="/account?topup=1"
                  className="border-l border-line bg-accent px-3 py-1 font-medium text-accent-ink hover:opacity-90"
                >
                  + Add credits
                </Link>
              </span>
              <Link
                href="/account"
                className="hidden max-w-[14ch] truncate text-muted hover:text-ink sm:inline"
              >
                {me.email}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-ink">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90"
              >
                Join
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
