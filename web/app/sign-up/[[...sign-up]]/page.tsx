import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";
import SignupTrack from "@/components/SignupTrack";

export default function Page() {
  if (!clerkEnabled()) redirect("/signup");
  return (
    <div className="flex justify-center py-16">
      <SignupTrack />
      <SignUp />
    </div>
  );
}
