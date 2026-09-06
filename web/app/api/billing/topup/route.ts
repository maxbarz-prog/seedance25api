import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createTopupCheckout } from "@/lib/billing";
import { MIN_TOPUP_USD } from "@/lib/config";

const Body = z.object({ usd: z.number().min(MIN_TOPUP_USD).max(1000) });

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const active =
    user.membership !== "none" && (user.membership_renews_at ?? 0) > Date.now();
  if (!active) {
    return NextResponse.json(
      { error: "membership_required", message: "Join first — membership is required before buying credits." },
      { status: 402 }
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Top-ups are $${MIN_TOPUP_USD}–$1000.` },
      { status: 400 }
    );
  }
  const origin = req.nextUrl.origin;
  const { url } = await createTopupCheckout(user, parsed.data.usd, origin);
  return NextResponse.json({ url });
}
