import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, userByEmail } from "@/lib/db";
import { hashPassword, session } from "@/lib/auth";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;
  if (userByEmail(email)) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }
  const user = createUser(email, await hashPassword(password));
  const s = await session();
  s.userId = user.id;
  await s.save();
  return NextResponse.json({ ok: true });
}
