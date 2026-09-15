"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="mt-4 text-sm text-muted">
          If an account exists for {email}, a reset link is on its way. Check
          your inbox (and spam) — the link works for one hour.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface p-3 outline-none focus:border-accent"
          />
          <button className="w-full rounded-xl bg-accent py-3 font-medium text-accent-ink hover:opacity-90">
            Send reset link
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        <Link className="underline" href="/login">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
