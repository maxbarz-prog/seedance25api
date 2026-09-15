import { Suspense } from "react";
import SignedOutOnly from "@/components/SignedOutOnly";
import { redirect } from "next/navigation";
import BuiltinAuth from "@/components/auth/BuiltinAuth";
import { clerkEnabled } from "@/lib/auth";

export default function Page() {
  if (clerkEnabled()) redirect("/sign-in");
  return (
    <Suspense fallback={null}>
      <SignedOutOnly to="/create">
        <BuiltinAuth kind="login" />
      </SignedOutOnly>
    </Suspense>
  );
}
