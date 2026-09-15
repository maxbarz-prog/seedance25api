import { Suspense } from "react";
import SignedOutOnly from "@/components/SignedOutOnly";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";
import ClerkSignUp from "@/components/auth/ClerkSignUp";

export default function Page() {
  if (!clerkEnabled()) redirect("/signup");
  return (
    <Suspense fallback={null}>
      <SignedOutOnly to="/create">
        <ClerkSignUp />
      </SignedOutOnly>
    </Suspense>
  );
}
