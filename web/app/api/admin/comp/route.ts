import { PAID_PLAN_IDS, PlanId, BillingInterval } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { userByEmail } from "@/lib/db";
import { applyMembership } from "@/lib/billing";

// Comp a membership (support recovery, partnerships, testing).

const Body = z.object({
  email: z.string().email(),
  plan: z.enum(PAID_PLAN_IDS as [string, ...string[]]),
  interval: z.enum(["month", "year"]).default("month"),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const target = await userByEmail(parsed.data.email);
  if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
  await applyMembership(target.id, parsed.data.plan as PlanId, parsed.data.interval as BillingInterval);
  return NextResponse.json({ ok: true });
}
