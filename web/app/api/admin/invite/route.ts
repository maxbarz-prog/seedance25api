import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { INVITE_EXPIRY_DAYS, INVITE_PLAN, PAID_PLAN_IDS, PLANS, PlanId } from "@/lib/config";
import { planMargin } from "@/lib/economics";
import { listInvites, mintInvite } from "@/lib/referrals";
import { userById } from "@/lib/db";

// Minting the one-time invite codes that go out in DMs: first month free, one
// use, one plan, and an expiry.
//
// Each code is a real liability, not a marketing token. A month free costs us
// the plan's whole allocation if the member spends it, so the response says
// what the code is worth in downside and the list shows how much is
// outstanding — which is the number that matters when you are handing them out
// one at a time.

const Body = z.object({
  plan: z.enum(PAID_PLAN_IDS as [string, ...string[]]).default(INVITE_PLAN),
  count: z.number().int().min(1).max(25).default(1),
  days: z.number().int().min(1).max(365).default(INVITE_EXPIRY_DAYS),
  memo: z.string().max(120).optional(),
});

// What one free month on a plan costs us, worst case: the allocation, spent.
function exposureUsd(plan: PlanId): number {
  return -planMargin(plan, "month").fullUseCostUsd;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Need a paid plan, a count of 1-25, and an expiry of 1-365 days." },
      { status: 400 }
    );
  }
  const plan = parsed.data.plan as PlanId;
  const invites = [];
  for (let i = 0; i < parsed.data.count; i++) {
    invites.push(await mintInvite({ plan, createdBy: admin.email, days: parsed.data.days }));
  }
  return NextResponse.json({
    invites: invites.map((i) => ({ code: i.code, plan: i.plan, expiresAt: i.expiresAt })),
    plan: PLANS[plan].label,
    // Per code, and for the batch. Worst case is the member spending the whole
    // allocation before deciding not to stay.
    exposureUsdEach: Number(exposureUsd(plan).toFixed(2)),
    exposureUsdTotal: Number((exposureUsd(plan) * invites.length).toFixed(2)),
  });
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const invites = await listInvites();
  const now = Date.now();

  const rows = await Promise.all(
    invites.map(async (i) => ({
      code: i.code,
      plan: i.plan,
      createdAt: i.createdAt,
      createdBy: i.createdBy,
      expiresAt: i.expiresAt,
      state: i.redeemedBy ? "used" : i.expiresAt < now ? "expired" : "live",
      // Who used it, by email rather than id — the id is no use when you are
      // trying to remember which DM this was.
      redeemedBy: i.redeemedBy ? (await userById(i.redeemedBy))?.email ?? i.redeemedBy : null,
    }))
  );

  const live = rows.filter((r) => r.state === "live");
  return NextResponse.json({
    invites: rows,
    counts: {
      live: live.length,
      used: rows.filter((r) => r.state === "used").length,
      expired: rows.filter((r) => r.state === "expired").length,
    },
    // What the codes still out there could cost if every one of them is
    // redeemed and spent to the last credit.
    outstandingUsd: Number(
      live.reduce((sum, r) => sum + exposureUsd(r.plan as PlanId), 0).toFixed(2)
    ),
  });
}
