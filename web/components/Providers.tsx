import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Wraps the app in ClerkProvider only when Clerk is configured, so the
// built-in auth path never loads Clerk's client bundle.
//
// Both redirects land on "/", the page that generates video. A new member
// already holds 125 credits and has no reason to meet a price list before
// they have seen the product work once — Runway does the same, and their
// free tier is the one ours is priced against. The plans find people when
// the credits run out: from the header, and from the dialog the composer
// raises when a generation costs more than the balance holds. The composer
// keeps the draft prompt in localStorage across the signup detour, so
// somebody who typed a prompt, was sent to sign up, and came back finds it
// still there and one click from running.
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled()) return <>{children}</>;
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
