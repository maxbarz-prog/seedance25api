// Tiny client-side helper so AccountPanel can sign out of Clerk without
// importing Clerk into the built-in auth path's bundle.
//
// The redirect is given rather than left to Clerk. Its default is the
// instance's own after-sign-out URL, which lives on the hosted account
// portal and, on a development instance, hands off to the instance's home
// origin — somewhere that is not this site.
export default async function signOut(redirectUrl = "/signed-out") {
  const mod = await import("@clerk/nextjs");
  // Clerk exposes the sign-out on the global Clerk instance loaded by ClerkProvider.
  const clerk = (
    globalThis as unknown as {
      Clerk?: { signOut: (opts?: { redirectUrl?: string }) => Promise<void> };
    }
  ).Clerk;
  void mod;
  if (clerk) await clerk.signOut({ redirectUrl });
}
