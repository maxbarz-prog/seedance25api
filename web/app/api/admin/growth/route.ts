import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { growthReport } from "@/lib/events";

// The growth report: funnel, welcome flow, survey, referrals, the upgrade
// offer, attribution. ?days=7|30|90.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const res = NextResponse.json(await growthReport(Number.isFinite(days) ? days : 30));
  res.headers.set("cache-control", "private, no-store");
  return res;
}
