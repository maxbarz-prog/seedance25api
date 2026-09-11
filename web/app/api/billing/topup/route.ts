import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createTopupCheckout } from "@/lib/billing";
import { MIN_TOPUP_USD } from "@/lib/config";
import { canBuyCredits } from "@/lib/plan";

const Body = z.object({ usd: z.number().min(MIN_TOPUP_USD).max(1000) });

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Top-ups need a plan that allows them: Free has no card on file, and its
  // allocation is the whole offer.
  if (!canBuyCredits(user)) {
    return NextResponse.json(
      {
        error: "membership_required",
        message: "Buying credits needs a paid plan — pick one on your account page.",
      },
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
