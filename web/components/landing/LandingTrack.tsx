"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

// The landing page is the first step of the funnel; this reports it.
export default function LandingTrack() {
  useEffect(() => {
    track("landing_viewed");
  }, []);
  return null;
}
