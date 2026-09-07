// Tiny client-side helper so AccountPanel can sign out of Clerk without
// importing Clerk into the built-in auth path's bundle.
export default async function signOut() {
  const mod = await import("@clerk/nextjs");
  // Clerk exposes the sign-out on the global Clerk instance loaded by ClerkProvider.
  const clerk = (globalThis as unknown as { Clerk?: { signOut: () => Promise<void> } }).Clerk;
  void mod;
  if (clerk) await clerk.signOut();
}
