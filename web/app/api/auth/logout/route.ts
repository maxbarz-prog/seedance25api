import { NextResponse } from "next/server";
import { session } from "@/lib/auth";

export async function POST() {
  const s = await session();
  s.destroy();
  return NextResponse.json({ ok: true });
}
