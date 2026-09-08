import { NextResponse } from "next/server";
import { stripeEnabled } from "@/lib/billing";
import { storageEnabled } from "@/lib/storage";

// Public uptime probe. Deliberately says nothing about WHICH providers sit
// behind the service — provider identity never reaches users, and this
// endpoint is unauthenticated. The detailed picture (vendors, live
// reachability, deprecation) is admin-only, at /api/admin/status.

export const dynamic = "force-dynamic";

export async function GET() {
  // "ready" means the pieces needed to take money and deliver a video are
  // configured; it does not claim the providers are currently up.
  const ready =
    storageEnabled() &&
    stripeEnabled() &&
    !!process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.DB_BACKEND === "dynamo";
  return NextResponse.json({ ok: true, ready });
}
