import type { NextRequest } from "next/server";

// Who is on the other end of a request, for the delivery record.
//
// CloudFront puts the viewer's address in cloudfront-viewer-address as
// "ip:port"; behind anything else, the first hop of x-forwarded-for is the
// client. Kept short and honest: this is evidence for a dispute, not
// analytics, so it is written once per job and once per download.
export function clientIp(req: NextRequest): string | null {
  const cf = req.headers.get("cloudfront-viewer-address");
  if (cf) return cf.replace(/:\d+$/, "");
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return null;
}

export function userAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent")?.slice(0, 200) ?? null;
}

// The site's own origin, for links we hand to Stripe and put in email. From
// configuration, not from the request: a Host header is whatever the client
// sent, and a redirect or reset link built from it is an open door.
export function siteOrigin(req: NextRequest): string {
  return (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
}
