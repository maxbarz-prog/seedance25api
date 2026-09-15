import { Suspense } from "react";
import SignedOutOnly from "@/components/SignedOutOnly";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";
import ClerkSignIn from "@/components/auth/ClerkSignIn";

// `next` decides where signing in lands, so it is validated here as well as
// in the form: a member who is already signed in should be sent to the same
// place the form would have sent them, not to a second destination.
//
// A path on this site means one leading slash and nothing slash-like after
// it. A backslash counts: URL parsing treats it as a slash for http and
// https, so "/\evil.com" would resolve to another origin.
function safeNext(next: string | string[] | undefined): string {
  const v = Array.isArray(next) ? next[0] : next;
  return v && v.startsWith("/") && !/^\/[/\\]/.test(v) ? v : "/create";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (!clerkEnabled()) redirect("/login");
  const { next } = await searchParams;
  return (
    <Suspense fallback={null}>
      <SignedOutOnly to={safeNext(next)}>
        <ClerkSignIn />
      </SignedOutOnly>
    </Suspense>
  );
}
