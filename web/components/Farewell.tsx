"use client";

import { useSearchParams } from "next/navigation";

// Deactivating and deleting both end the session, so the member lands on the
// homepage signed out. Saying what just happened is the difference between a
// completed action and an unexplained logout.
//
// A client component on purpose. Reading searchParams on the server would make
// the homepage dynamic, and a dynamic homepage cannot be cached at the CDN —
// every visitor would wait for us-east-1 to render the same HTML. This banner
// is for the one visitor in a thousand who just left.
export default function Farewell() {
  const sp = useSearchParams();
  const message = sp.get("deleted")
    ? "Your account and everything in it has been deleted. Nothing further is billed."
    : sp.get("deactivated")
      ? "Your account is deactivated and billing has stopped. Sign in whenever you want it back — your videos are waiting."
      : null;
  if (!message) return null;
  return (
    <p className="mb-8 rounded-2xl border border-line bg-surface px-5 py-4 text-center text-sm">
      {message}
    </p>
  );
}
