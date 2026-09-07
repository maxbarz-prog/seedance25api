import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk's middleware only runs when Clerk is configured; otherwise requests
// pass straight through to the built-in cookie auth. Route protection is
// enforced in the API handlers via currentUser(), not here.
const passthrough = () => NextResponse.next();

export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware()
  : (_req: NextRequest) => passthrough();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
