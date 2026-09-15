"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import PlanModal from "./PlanModal";
import { fetchMe } from "@/lib/me-client";
import { track } from "@/lib/track-client";
import { showLoader } from "@/lib/ui-events";

// Two things the composer page needs to know about the person, both from
// /api/me: whether they still owe the welcome flow (sent there first), and
// whether the one-time upgrade offer is due — the plan modal, shown here
// over the composer on the visit straight after the flow. Closing it, by
// the button or a click outside, leaves the composer. Also reports the page
// view: the composer is the funnel's second step.
export default function CreateGate() {
  const router = useRouter();
  const params = useSearchParams();
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    const fromWelcome = !!params.get("welcome");
    track("create_viewed", { from: fromWelcome ? "welcome" : "direct" });
    // Arriving from the welcome flow, the answer cached for this page load
    // (if any) predates the account: ask again.
    fetchMe(fromWelcome).then(({ user }) => {
      if (!user) return;
      if (user.needsOnboarding) {
        showLoader();
        router.replace("/welcome");
        return;
      }
      // Once, ever: the row remembers it was shown. Only after the flow —
      // an old account that predates the flow has no onboardedAt and never
      // sees it.
      if (user.onboardedAt && !user.upgradePromptedAt) {
        setOffer(true);
        track("upgrade_modal_shown");
        fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "upgrade_seen" }),
        }).catch(() => {});
      }
    });
  }, [router, params]);

  if (!offer) return null;
  return (
    <PlanModal
      from="welcome-offer"
      onClose={() => {
        track("upgrade_modal_dismissed");
        setOffer(false);
      }}
    />
  );
}
