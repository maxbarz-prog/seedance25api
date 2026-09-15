import { Suspense } from "react";
import { redirect } from "next/navigation";
import BuiltinAuth from "@/components/auth/BuiltinAuth";
import { clerkEnabled } from "@/lib/auth";

export default function Page() {
  if (clerkEnabled()) redirect("/sign-in");
  return (
    <Suspense fallback={null}>
      <BuiltinAuth kind="login" />
    </Suspense>
  );
}
