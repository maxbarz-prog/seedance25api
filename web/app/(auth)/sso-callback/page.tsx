import { redirect } from "next/navigation";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Where Google sends people back. Clerk finishes the sign-in or sign-up it
// started, then goes where the form asked (redirectUrlComplete). A Google
// account that has no Remerged account yet arrives through sign-in and is
// turned into a sign-up here, which is why both destinations are given.
//
// Every other outcome needs a destination too, and that is what the rest of
// these are for. When a flow cannot finish in one hop — the sign-up is short
// a field, the address still needs verifying, the password has to be reset,
// a second factor is due — Clerk sends the person to whichever URL covers
// that case. Left unset, those default to Clerk's own hosted Account Portal
// on accounts.dev, which is not this site, does not know our session, and
// on a development instance hands off to the instance's development origin —
// localhost, out of the box. That is the dead link. Naming our own pages
// here keeps every path on this domain.
//
// Rendered per request: the callback only makes sense with Clerk configured,
// and a build without keys must not try to prerender it.
export const dynamic = "force-dynamic";

export default function Page() {
  if (!clerkEnabled()) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-muted">
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/create"
        signUpFallbackRedirectUrl="/welcome"
        continueSignUpUrl="/sign-up"
        verifyEmailAddressUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in"
        resetPasswordUrl="/sign-in"
      />
      <span className="spinner" aria-hidden />
      Signing you in…
    </div>
  );
}
