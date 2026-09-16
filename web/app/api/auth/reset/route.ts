import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { createHash } from "crypto";
import { z } from "zod";
import { setPassword, setResetToken, userByResetToken } from "@/lib/db";
import { MIN_PASSWORD_CHARS } from "@/lib/config";
import { hashPassword, session } from "@/lib/auth";

const Body = z.object({ token: z.string().min(32), password: z.string().min(MIN_PASSWORD_CHARS).max(200) });

export async function POST(req: NextRequest) {
  // Clerk owns sign-up, sign-in and resets on every deployed stage. Left
  // reachable, this route would be an unguarded second door: no bot check, no
  // email verification, no rate limit — and, on signup, free credits per
  // call. It exists for the local built-in auth only.
  if (clerkEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_CHARS} characters.` }, { status: 400 });
  }
  const hash = createHash("sha256").update(parsed.data.token).digest("hex");
  const user = await userByResetToken(hash);
  if (!user || (user.reset_expires_at ?? 0) < Date.now()) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }
  await setPassword(user.id, await hashPassword(parsed.data.password));
  await setResetToken(user.id, null, null);
  const s = await session();
  s.userId = user.id;
  await s.save();
  return NextResponse.json({ ok: true });
}
