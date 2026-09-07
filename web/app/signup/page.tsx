import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { clerkEnabled } from "@/lib/auth";

export default function Page() {
  if (clerkEnabled()) redirect("/sign-up");
  return (
    <Suspense>
      <AuthForm kind="signup" />
    </Suspense>
  );
}
