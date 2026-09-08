import { NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { stripeEnabled } from "@/lib/billing";
import { storageEnabled } from "@/lib/storage";
import { ffmpegAvailable } from "@/lib/video";

// Readiness probe: booleans only, no secrets and no provider calls, so it is
// free to hit. It answers the questions that are easy to get wrong at deploy
// time — did the bundled ffmpeg binary actually ship, is the bucket wired, is
// this stage on live providers, is the webhook secret present — without
// spending anything on a generation to find out.

export const dynamic = "force-dynamic";

export async function GET() {
  const live = process.env.PROVIDER_MODE === "live";
  return NextResponse.json({
    ok: true,
    dbBackend: process.env.DB_BACKEND ?? "sqlite",
    storage: storageEnabled(),
    // Exercises the real resolution path (and the copy to /tmp), so a true
    // here means an extension can actually trim its source clip.
    ffmpeg: ffmpegAvailable(),
    providerMode: live ? "live" : "mock",
    generator: live && !!process.env.BYTEPLUS_API_KEY ? "byteplus" : "mock",
    upscaler: live && !!process.env.FAL_KEY ? "fal" : live && !!process.env.TOPAZ_API_KEY ? "topaz" : "mock",
    auth: clerkEnabled() ? "clerk" : "builtin",
    billing: stripeEnabled(),
    webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
