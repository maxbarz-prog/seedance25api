import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";

export default function Page() {
  if (!clerkEnabled()) redirect("/signup");
  return (
    <div className="flex justify-center py-16">
      <SignUp />
    </div>
  );
}
