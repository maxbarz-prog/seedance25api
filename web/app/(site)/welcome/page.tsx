import { Suspense } from "react";
import Welcome from "./Welcome";

// A shell: the page is the same for everyone, the member's state comes from
// /api/onboarding in the browser. Public in the middleware for that reason.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Welcome />
    </Suspense>
  );
}
