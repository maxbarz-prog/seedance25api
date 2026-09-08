import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { systemStatus } from "@/lib/status";

// Admin-only: this names the providers we use, which the product deliberately
// never reveals to users. `?force=1` skips the 60-second cache.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(await systemStatus(req.nextUrl.searchParams.get("force") === "1"));
}
