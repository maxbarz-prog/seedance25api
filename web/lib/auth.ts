import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { createUser, User, userByEmail, userById } from "./db";

// Two auth modes, chosen by configuration:
//   - Clerk (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set): Google + email sign-in,
//     password reset, sessions all handled by Clerk. Our users table is keyed
//     by email and rows are created on first sight of a Clerk identity.
//   - Built-in (default): email + password with an iron-session cookie.
// Everything downstream only ever calls currentUser().

export interface SessionData {
  userId?: string;
}

const sessionOptions = {
  cookieName: "remerged_session",
  password:
    process.env.SESSION_SECRET ||
    "dev-only-session-secret-change-me-32chars!!",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export function clerkEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

export async function session(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function currentUser(): Promise<User | null> {
  if (clerkEnabled()) {
    const { currentUser: clerkUser } = await import("@clerk/nextjs/server");
    const cu = await clerkUser();
    // The PRIMARY address, and only once Clerk has verified it. The account
    // row is keyed by email and admin rights are granted by email, so an
    // address someone merely typed must never become an identity here.
    const primary = cu?.primaryEmailAddress;
    const email =
      primary && primary.verification?.status === "verified" ? primary.emailAddress : undefined;
    if (!cu || !email) return null;
    const existing = await userByEmail(email);
    if (existing) {
      // Rows from before the mapping existed pick it up the first time
      // they are seen: an insert-if-absent, so it costs a read-check rather
      // than a write on every request.
      const { setSystemIfAbsent } = await import("./db");
      await setSystemIfAbsent(`clerk#${cu.id}`, existing.id).catch(() => {});
      return existing;
    }
    // No password for Clerk-managed identities; the built-in login refuses
    // to match this sentinel.
    const created = await createUser(email, "clerk");
    {
      const { setSystem } = await import("./db");
      await setSystem(`clerk#${cu.id}`, created.id).catch(() => {});
    }
    const { record } = await import("./events");
    await record("account_created", created.id, { auth: "clerk" });
    // Same free allocation the built-in signup hands over.
    const { grantSignupCredits } = await import("./grants");
    await grantSignupCredits(created.id);
    return created;
  }
  const s = await session();
  if (!s.userId) return null;
  return (await userById(s.userId)) ?? null;
}

// Admins are designated by email via the ADMIN_EMAILS env var
// (comma-separated) — no role column, no privilege escalation surface in-app.
export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

export async function requireAdmin(): Promise<User | null> {
  const user = await currentUser();
  return isAdmin(user) ? user : null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  if (hash === "clerk") return false;
  return bcrypt.compare(pw, hash);
}
