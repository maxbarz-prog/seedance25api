"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CREDIT_USD, SITE_NAME } from "@/lib/config";
import { fetchMe } from "@/lib/me-client";

interface Me {
  email: string;
  balanceCredits: number;
  planLabel: string;
  canBuyCredits: boolean;
}

// Anything that spends or adds credits fires this so the header re-reads the
// balance without a full navigation.
export const BALANCE_EVENT = "remerged:balance";

export default function Header() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  // force: the shared answer is cached for the page load, and these events mean
  // it has changed — a purchase, a spend, or coming back to the tab.
  const load = useCallback((force = false) => {
    fetchMe(force)
      .then((d) => setMe(d.user))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    const refresh = () => load(true);
    window.addEventListener(BALANCE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(BALANCE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  // Credits, not dollars. Credits are the unit every price on the site is
  // quoted in, so a balance in dollars makes the member do the conversion
  // themselves at the one moment it matters — deciding whether they can
  // afford the thing in front of them. The dollar value stays on the tooltip.
  const credits = me ? me.balanceCredits.toLocaleString() : null;
  const usd = me
    ? (me.balanceCredits * CREDIT_USD).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      })
    : null;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {SITE_NAME}
        </Link>
        <nav className="flex items-center gap-2 text-sm sm:gap-5">
          {/* The wordmark goes to the front door; this goes to the work.
              Hidden on a phone alongside the others — the header has no
              room, and the button on the right leads to the same place. */}
          <Link href="/create" className="hidden text-muted hover:text-ink sm:inline">
            Create
          </Link>
          <Link href="/pricing" className="hidden text-muted hover:text-ink sm:inline">
            Pricing
          </Link>
          <Link href="/help" className="hidden text-muted hover:text-ink sm:inline">
            Help
          </Link>
          {!loaded ? null : me ? (
            <>
              <Link href="/library" className="text-muted hover:text-ink">
                Library
              </Link>
              {/* Balance is always on screen: it is what decides whether the
                  next generation can run. */}
              <span
                className="flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border border-line"
                title={`${credits} credits · worth ${usd} · ${me.planLabel} plan`}
              >
                <Link
                  href="/account"
                  className="px-2.5 py-1 font-medium hover:bg-bg sm:px-3"
                  aria-label={`Credit balance: ${credits} credits, worth ${usd}`}
                >
                  <span className="tabular-nums">{credits}</span>
                  {/* Naming the unit is the point, so it stays at every width
                      a real phone has. Under 360px the header cannot fit it
                      and the number alone has to do — the tooltip and the
                      aria-label still say credits. */}
                  <span className="ml-1 hidden font-normal text-muted xs:inline">credits</span>
                </Link>
                {/* A free member cannot top up, so the button sends them to
                    the plans instead of a purchase they cannot make. */}
                <Link
                  href={me.canBuyCredits ? "/account?topup=1" : "/account?join=1"}
                  className="border-l border-line bg-accent px-2.5 py-1 font-medium text-accent-ink hover:opacity-90 sm:px-3"
                >
                  {me.canBuyCredits ? (
                    <>
                      + Add<span className="hidden sm:inline"> credits</span>
                    </>
                  ) : (
                    "Upgrade"
                  )}
                </Link>
              </span>
              <Link
                href="/account"
                /* Held back to md: at the sm breakpoint every nav link appears
                   at once and the row is 8px too wide. The email is the least
                   useful thing in it — the balance pill already links to the
                   same page. */
                className="hidden max-w-[14ch] truncate text-muted hover:text-ink md:inline"
              >
                {me.email}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-ink">
                Sign in
              </Link>
              {/* Straight to the composer, not to a form: the prompt is
                  the first thing, signing up is what Generate leads to. */}
              <Link
                href="/create"
                className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90"
              >
                Try {SITE_NAME}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
