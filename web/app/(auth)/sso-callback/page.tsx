import { redirect } from "next/navigation";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Where Google sends people back. Clerk finishes the sign-in or sign-up it
// started, then goes where the form asked (redirectUrlComplete). A Google
// account that has no Remerged account yet arrives through sign-in and is
// turned into a sign-up here, which is why both destinations are given.
//
// Rendered per request: the callback only makes sense with Clerk configured,
// and a build without keys must not try to prerender it.
export const dynamic = "force-dynamic";

export default function Page() {
  if (!clerkEnabled()) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted">
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/create"
        signUpFallbackRedirectUrl="/welcome"
      />
      Signing you in…
    </div>
  );
}
