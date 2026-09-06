import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { applyMembership, applyTopup, stripeEnabled } from "@/lib/billing";

// Dev-only stand-in for the Stripe webhook: applies a "payment" instantly.
// Hard-disabled whenever real Stripe keys are configured; production builds
// additionally require the explicit MOCK_BILLING=1 opt-in (demo servers).

const Body = z.union([
  z.object({ kind: z.literal("topup"), usd: z.number().min(1).max(1000) }),
  z.object({ kind: z.literal("subscribe"), plan: z.enum(["monthly", "annual"]) }),
]);

export async function POST(req: NextRequest) {
  const allowed =
    !stripeEnabled() &&
    (process.env.NODE_ENV !== "production" || process.env.MOCK_BILLING === "1");
  if (!allowed) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  if (parsed.data.kind === "topup") {
    await applyTopup(user.id, parsed.data.usd, `mock_${randomUUID()}`);
  } else {
    await applyMembership(user.id, parsed.data.plan);
  }
  return NextResponse.json({ ok: true });
}
