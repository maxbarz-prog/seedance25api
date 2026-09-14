"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

// Clerk draws the sign-up form, so the page opening is the last thing the
// browser can report before the account exists. The server reports that.
export default function SignupTrack() {
  useEffect(() => {
    track("signup_viewed", { auth: "clerk" });
  }, []);
  return null;
}
