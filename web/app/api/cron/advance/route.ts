import { NextRequest, NextResponse } from "next/server";
import { advanceAll } from "@/lib/pipeline";

// Invoked every minute by the scheduler (sst.config.ts Cron) so jobs keep
// moving after the member closes the tab. Guarded by a shared secret.

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const result = await advanceAll();
  return NextResponse.json(result);
}
