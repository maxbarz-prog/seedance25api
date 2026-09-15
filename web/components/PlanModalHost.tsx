"use client";

import { useEffect, useState } from "react";
import PlanModal from "./PlanModal";
import { PLANS_EVENT } from "@/lib/ui-events";

// Mounted once in the site layout; opened by openPlans() from anywhere.
export default function PlanModalHost() {
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setFrom((e as CustomEvent<{ from?: string }>).detail?.from ?? "unknown");
    window.addEventListener(PLANS_EVENT, onOpen);
    return () => window.removeEventListener(PLANS_EVENT, onOpen);
  }, []);
  if (from === null) return null;
  return <PlanModal from={from} onClose={() => setFrom(null)} />;
}
