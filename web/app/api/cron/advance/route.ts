import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { advanceAll } from "@/lib/pipeline";
import { sweepPeriodGrants } from "@/lib/grants";

// Invoked every minute by the scheduler (sst.config.ts Cron) so jobs keep
// moving after the member closes the tab. Guarded by a shared secret,
// compared in constant time — the cost is nothing and the habit is right.

function secretMatches(got: string | null, expected: string | undefined): boolean {
  if (!got || !expected) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const result = await advanceAll();
  // Cheap after the first run of each month: a marker short-circuits it.
  const grants = await sweepPeriodGrants();
  return NextResponse.json({ ...result, grants });
}
