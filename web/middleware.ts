import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk's middleware only runs when Clerk is configured; otherwise requests
// pass straight through to the built-in cookie auth. Route protection is
// enforced in the API handlers via currentUser(), not here.

// help.<domain> is an alias on the same CloudFront distribution, so the app
// sees those requests directly. It exists because "help.remerged.ai" is
// what people type and share — but the articles live at /help on the main
// site, so the alias redirects there rather than serving a second copy at a
// second URL. One canonical address per article, no duplicate content, and
// every link inside the help centre works on either host without rewriting.
//
// The target host is the alias with "help." removed, which is exactly right
// for both help.remerged.ai and help.dev.remerged.ai, and needs no
// configuration to keep in step with the stage.
function helpAliasRedirect(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host.startsWith("help.")) return null;
  const target = new URL(req.nextUrl);
  target.protocol = "https:";
  target.host = host.slice("help.".length);
  target.port = "";
  // "/" means the help home; anything else keeps its path under /help, so a
  // shared link like help.remerged.ai/creating still lands correctly.
  if (!target.pathname.startsWith("/help")) {
    target.pathname = target.pathname === "/" ? "/help" : `/help${target.pathname}`;
  }
  // Permanent: the canonical URL is the one on the main domain.
  return NextResponse.redirect(target, 308);
}

// Built on first use, not at module load: constructing it without Clerk keys
// configured is not something to do on a deployment that runs on the built-in
// auth.
let clerk: ((req: NextRequest, event: NextFetchEvent) => unknown) | null = null;

// Pages that are the same for everyone and hold nothing private. Clerk's
// middleware is skipped for these: it inspects and refreshes the session on
// every request it sees, which marks the response as belonging to one visitor
// and takes it out of the CDN. Nothing here reads the session — the header
// fetches the balance client-side from /api/me, which Clerk does see.
//
// Only marketing pages are on this list, and that is deliberate. Refreshing
// the session is not bookkeeping Clerk does for its own sake: a session token
// lives about a minute, and the middleware is what renews it as somebody
// moves around the site. Skip it on the pages members actually use and the
// only thing left to renew on is a background fetch, which cannot complete
// the redirect that renewal sometimes needs — so the browser goes on
// believing there is a session while the server stops seeing one. That is
// how a member ends up looking signed out to /api/me, being offered the
// sign-up form, and being told by Clerk that they are already signed in.
// The composer, the library, the account page and the welcome flow are all
// behind sign-in anyway, so nothing of value is lost from the CDN.
//
// Anchored at a path boundary: /helpers or /pricing-plans would otherwise
// match too, and skip Clerk on a page that was never meant to be public.
const PUBLIC = /^\/(?:$|(?:pricing|help|terms|privacy|refunds|signed-out)(?:\/|$))/;

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  // Runs for every path, including public ones: help.<domain>/anything has to
  // redirect whether or not the target needs auth.
  const redirect = helpAliasRedirect(req);
  if (redirect) return redirect;
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  if (PUBLIC.test(req.nextUrl.pathname)) return NextResponse.next();
  clerk ??= clerkMiddleware() as (req: NextRequest, event: NextFetchEvent) => unknown;
  return clerk(req, event) as ReturnType<typeof NextResponse.next>;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
