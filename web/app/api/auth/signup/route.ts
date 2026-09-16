import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { z } from "zod";
import { createUser, userByEmail } from "@/lib/db";
import { hashPassword, session } from "@/lib/auth";
import { grantSignupCredits } from "@/lib/grants";
import { record } from "@/lib/events";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_CHARS } from "@/lib/config";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_CHARS).max(200),
});

export async function POST(req: NextRequest) {
  // Clerk owns sign-up, sign-in and resets on every deployed stage. Left
  // reachable, this route would be an unguarded second door: no bot check, no
  // email verification, no rate limit — and, on signup, free credits per
  // call. It exists for the local built-in auth only.
  if (clerkEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Enter a valid email and a password of at least ${MIN_PASSWORD_CHARS} characters.` },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;
  if (await userByEmail(email)) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }
  const user = await createUser(email, await hashPassword(password));
  await record("account_created", user.id, { auth: "builtin" });
  await audit("account_created", { email, account: user.id, props: { auth: "builtin" } });
  // The free allocation, so a new account can make something immediately.
  await grantSignupCredits(user.id);
  const s = await session();
  s.userId = user.id;
  await s.save();
  return NextResponse.json({ ok: true });
}
