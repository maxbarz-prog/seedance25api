import { NextRequest, NextResponse } from "next/server";
import { advanceAll } from "@/lib/pipeline";
import { sweepPeriodGrants } from "@/lib/grants";

// Invoked every minute by the scheduler (sst.config.ts Cron) so jobs keep
// moving after the member closes the tab. Guarded by a shared secret.

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const result = await advanceAll();
  // Cheap after the first run of each month: a marker short-circuits it.
  const grants = await sweepPeriodGrants();
  return NextResponse.json({ ...result, grants });
}
