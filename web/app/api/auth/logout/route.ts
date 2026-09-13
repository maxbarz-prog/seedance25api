import { NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { session } from "@/lib/auth";

export async function POST() {
  // Clerk owns sign-up, sign-in and resets on every deployed stage. Left
  // reachable, this route would be an unguarded second door: no bot check, no
  // email verification, no rate limit — and, on signup, free credits per
  // call. It exists for the local built-in auth only.
  if (clerkEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await session();
  s.destroy();
  return NextResponse.json({ ok: true });
}
