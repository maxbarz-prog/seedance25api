import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { z } from "zod";
import { userByEmail } from "@/lib/db";
import { session, verifyPassword } from "@/lib/auth";

const Body = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
  // Clerk owns sign-up, sign-in and resets on every deployed stage. Left
  // reachable, this route would be an unguarded second door: no bot check, no
  // email verification, no rate limit — and, on signup, free credits per
  // call. It exists for the local built-in auth only.
  if (clerkEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const user = await userByEmail(parsed.data.email);
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const s = await session();
  s.userId = user.id;
  await s.save();
  return NextResponse.json({ ok: true });
}
