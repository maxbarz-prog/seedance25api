import Link from "next/link";
import { SITE_NAME } from "@/lib/config";

// Where signing out ends. Signing out is several steps that change nothing
// on screen while they happen, so landing back on the marketing page leaves
// the question of whether it worked. This answers it, and offers the only
// two things anyone wants next.

export default function Page() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You are signed out</h1>
      <p className="mt-2 text-muted">Your videos are still here when you come back.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/sign-in"
          className="rounded-full bg-accent px-6 py-2.5 font-medium text-accent-ink hover:opacity-90"
        >
          Sign back in
        </Link>
        <Link
          href="/"
          className="rounded-full border border-line px-6 py-2.5 font-medium hover:border-accent"
        >
          {SITE_NAME} home
        </Link>
      </div>
    </div>
  );
}
