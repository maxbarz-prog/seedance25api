"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE_NAME } from "@/lib/config";

interface Me {
  email: string;
  balanceCredits: number;
  membershipActive: boolean;
}

export default function Header() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {SITE_NAME}
          <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-muted">
            at cost
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/pricing" className="text-muted hover:text-ink">
            Pricing
          </Link>
          {!loaded ? null : me ? (
            <>
              <Link href="/library" className="text-muted hover:text-ink">
                Library
              </Link>
              <Link
                href="/account"
                className="rounded-full border border-line px-3 py-1 hover:border-accent"
              >
                {(me.balanceCredits / 1000).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}{" "}
                · {me.email}
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
