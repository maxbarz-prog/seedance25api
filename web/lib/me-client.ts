"use client";

export interface Me {
  email: string;
  balanceCredits: number;
  planLabel: string;
  canBuyCredits: boolean;
}

// Who is signed in, asked once per page load and shared.
//
// Two components want this — the header, for the balance, and the composer, so
// that clicking Generate while signed out can go straight to signup instead of
// posting a job to find out it is not allowed. Without the shared promise they
// each fetch it, which is two Lambda round trips for one answer.
//
// The homepage is prerendered and served from the CDN, so the server cannot
// tell us this in the HTML: nobody's identity may be baked into a document
// every visitor receives. One client call is the price of that, and it happens
// while the page is being read rather than when a button is pressed.
let inflight: Promise<{ user: Me | null }> | null = null;

export function fetchMe(force = false): Promise<{ user: Me | null }> {
  if (force || !inflight) {
    inflight = fetch("/api/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .catch(() => ({ user: null }));
  }
  return inflight;
}
