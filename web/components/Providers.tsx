import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";

// Wraps the app in ClerkProvider only when Clerk is configured, so the
// built-in auth path never loads Clerk's client bundle.
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled()) return <>{children}</>;
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/account?join=1"
    >
      {children}
    </ClerkProvider>
  );
}
