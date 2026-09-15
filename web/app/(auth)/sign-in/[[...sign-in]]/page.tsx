import { Suspense } from "react";
import SignedOutOnly from "@/components/SignedOutOnly";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";
import ClerkSignIn from "@/components/auth/ClerkSignIn";

export default function Page() {
  if (!clerkEnabled()) redirect("/login");
  return (
    <Suspense fallback={null}>
      <SignedOutOnly to="/create">
        <ClerkSignIn />
      </SignedOutOnly>
    </Suspense>
  );
}
