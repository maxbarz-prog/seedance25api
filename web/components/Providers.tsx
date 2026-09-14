import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Wraps the app in ClerkProvider only when Clerk is configured, so the
// built-in auth path never loads Clerk's client bundle.
//
// Signing in lands on the composer. Signing up lands on the welcome flow
// (/welcome: finalize, referral, survey), which ends at the composer with
// the one-time upgrade offer over it. The composer keeps the draft prompt
// in localStorage across the whole detour, so somebody who typed a prompt,
// was sent to sign up, and came back finds it still there and one click
// from running.
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled()) return <>{children}</>;
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/create"
      signUpFallbackRedirectUrl="/welcome"
    >
      {children}
    </ClerkProvider>
  );
}
