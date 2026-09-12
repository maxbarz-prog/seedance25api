import { NextRequest, NextResponse } from "next/server";

// A referral link: /r/ABC123 remembers who sent it and sends the visitor on to
// sign up.
//
// The code goes in a cookie rather than riding the URL through signup, because
// signup leaves for Clerk and comes back, and anything on the query string is
// lost on the way. It is read once, when the new member's account first exists
// (claimReferralCookie in lib/referrals.ts), and then cleared.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const clean = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const to = new URL("/sign-up", req.nextUrl.origin);
  if (clean) to.searchParams.set("ref", clean);
  const res = NextResponse.redirect(to);
  if (clean) {
    res.cookies.set("remerged_ref", clean, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 30 * 86_400,
      path: "/",
    });
  }
  // Never cached: the response carries one referrer's code, and a CDN would
  // otherwise hand the next visitor somebody else's.
  res.headers.set("cache-control", "private, no-store");
  return res;
}
