import { PAID_PLAN_IDS, PlanId, BillingInterval } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createMembershipCheckout } from "@/lib/billing";

const Body = z.object({
  plan: z.enum(PAID_PLAN_IDS as [string, ...string[]]),
  interval: z.enum(["month", "year"]).default("month"),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }
  const { url } = await createMembershipCheckout(
    user,
    parsed.data.plan as PlanId,
    parsed.data.interval as BillingInterval,
    req.nextUrl.origin
  );
  return NextResponse.json({ url });
}
