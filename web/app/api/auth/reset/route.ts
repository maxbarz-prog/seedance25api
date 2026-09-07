import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { setPassword, setResetToken, userByResetToken } from "@/lib/db";
import { hashPassword, session } from "@/lib/auth";

const Body = z.object({ token: z.string().min(32), password: z.string().min(8).max(200) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
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
