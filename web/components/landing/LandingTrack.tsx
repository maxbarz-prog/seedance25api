"use client";

import { useEffect } from "react";
import SignedOutOnly from "@/components/SignedOutOnly";
import { track } from "@/lib/track-client";

// The landing page is the first step of the funnel; this reports it. It is
// also for people without an account: a member who lands here is sent on to
// the composer, and because that decision comes from the session the browser
// already holds, it happens before there is time to click anything.
//
// The view is reported inside the gate, so "landing_viewed" counts visitors
// rather than members passing through.
function Seen() {
  useEffect(() => {
    track("landing_viewed");
  }, []);
  return null;
}

export default function LandingTrack() {
  return (
    <SignedOutOnly to="/create">
      <Seen />
    </SignedOutOnly>
  );
}
