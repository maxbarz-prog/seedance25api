import { Suspense } from "react";
import AccountPanel from "@/components/AccountPanel";

export default function AccountPage() {
  return (
    <Suspense>
      <AccountPanel />
    </Suspense>
  );
}
