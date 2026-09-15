"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/me-client";
import { track } from "@/lib/track-client";
import { showLoader } from "@/lib/ui-events";

// The landing page is the first step of the funnel; this reports it. It
// is also for people without an account: a member who lands here is sent
// on to the composer. The page is one cached document for everyone, so the
// decision is made in the browser.
export default function LandingTrack() {
  const router = useRouter();
  useEffect(() => {
    fetchMe().then(({ user }) => {
      if (user) {
        showLoader();
        router.replace("/create");
        return;
      }
      track("landing_viewed");
    });
  }, [router]);
  return null;
}
