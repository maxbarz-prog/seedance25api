import { NextRequest, NextResponse } from "next/server";
import { siteOrigin } from "@/lib/request";
import { clerkEnabled } from "@/lib/auth";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { setResetToken, userByEmail } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { SITE_NAME } from "@/lib/config";

const Body = z.object({ email: z.string().email() });
const TTL_MS = 60 * 60 * 1000;

// Always responds success so the endpoint can't be used to probe for
// accounts. Only the token's hash is stored.
export async function POST(req: NextRequest) {
  // Clerk owns sign-up, sign-in and resets on every deployed stage. Left
  // reachable, this route would be an unguarded second door: no bot check, no
  // email verification, no rate limit — and, on signup, free credits per
  // call. It exists for the local built-in auth only.
  if (clerkEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const user = await userByEmail(parsed.data.email);
  if (user) {
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    await setResetToken(user.id, hash, Date.now() + TTL_MS);
    const link = `${siteOrigin(req)}/reset?token=${token}`;
    await sendEmail(
      user.email,
      `Reset your ${SITE_NAME} password`,
      `Use this link within the next hour to choose a new password:\n\n${link}\n\nIf you didn't ask for this, you can ignore it.`
    ).catch((e) => console.error("reset email failed:", e));
  }
  return NextResponse.json({ ok: true });
}
