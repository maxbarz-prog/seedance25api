import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userByEmail } from "@/lib/db";
import { session, verifyPassword } from "@/lib/auth";

const Body = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
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
