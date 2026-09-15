"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { fetchMe } from "@/lib/me-client";
import { showLoader } from "@/lib/ui-events";

// Pages meant for people who have no account yet — the landing page, sign-in,
// sign-up — are one cached document served to everyone, so who is reading it
// can only be decided in the browser. This is that decision: a member is sent
// where they were actually going, and never sees the page underneath.
//
// Where the answer comes from matters. When Clerk is configured the browser
// already holds the session, so useAuth() answers with no round trip; asking
// /api/me instead means a Lambda call, and the second that takes is long
// enough to read the landing page and press "Continue with Google", which
// then fails with "You're already signed in". The built-in auth has no client
// half, so there /api/me is the only answer there is.
//
// The key is inlined at build time, so exactly one of the two branches below
// exists in any given build and the hooks never change shape.
const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Redirects, but only twice from any one page. If the browser thinks there is
// a session and the server does not — which a page can do nothing about from
// here — then bouncing on every arrival would trap somebody between two pages
// that each send them to the other. After two tries this gives up and lets the
// page draw, so there is always a way forward.
function useLeave(to: string, when: boolean): boolean {
  const router = useRouter();
  const path = usePathname();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!when) return;
    const key = `remerged_gate:${path}`;
    let n = 0;
    try {
      n = Number(sessionStorage.getItem(key) ?? "0") || 0;
      sessionStorage.setItem(key, String(n + 1));
    } catch {}
    if (n >= 2) {
      setStuck(true);
      return;
    }
    showLoader();
    router.replace(to);
  }, [when, to, router, path]);
  return stuck;
}

function ByClerk({ to, children }: { to: string; children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const member = isLoaded && !!isSignedIn;
  const stuck = useLeave(to, member);
  // While clerk-js is still loading, the form is drawn but its buttons are
  // disabled (they wait on the same isLoaded), so there is no window in which
  // a member can start a second sign-in.
  return member && !stuck ? null : <>{children}</>;
}

function ByApi({ to, children }: { to: string; children: React.ReactNode }) {
  const [member, setMember] = useState(false);
  useEffect(() => {
    fetchMe().then(({ user }) => setMember(!!user));
  }, []);
  const stuck = useLeave(to, member);
  return member && !stuck ? null : <>{children}</>;
}

export default function SignedOutOnly({
  to = "/create",
  children = null,
}: {
  to?: string;
  children?: React.ReactNode;
}) {
  const Gate = CLERK ? ByClerk : ByApi;
  return <Gate to={to}>{children}</Gate>;
}
