import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { addLedger, userByEmail } from "@/lib/db";
import { usdToCredits } from "@/lib/pricing";

// Manual credit adjustment (support refunds, goodwill, corrections).
// Negative amounts claw back credits. Every grant lands in the user's own
// ledger with the memo, so it is visible to them too.

const Body = z.object({
  email: z.string().email(),
  usd: z.number().min(-1000).max(1000).refine((v) => v !== 0),
  memo: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Need email, a non-zero usd amount (±$1000), and a memo." },
      { status: 400 }
    );
  }
  const target = userByEmail(parsed.data.email);
  if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
  addLedger(target.id, usdToCredits(parsed.data.usd), "adjustment", {
    memo: parsed.data.memo,
  });
  return NextResponse.json({ ok: true });
}
