import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminOverview } from "@/lib/admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(adminOverview());
}
