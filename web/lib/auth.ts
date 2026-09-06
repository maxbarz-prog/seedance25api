import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { User, userById } from "./db";

export interface SessionData {
  userId?: string;
}

const sessionOptions = {
  cookieName: "parcut_session",
  password:
    process.env.SESSION_SECRET ||
    "dev-only-session-secret-change-me-32chars!!",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export async function session(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function currentUser(): Promise<User | null> {
  const s = await session();
  if (!s.userId) return null;
  return userById(s.userId) ?? null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
