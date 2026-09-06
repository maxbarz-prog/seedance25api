"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function AuthForm({ kind }: { kind: "login" | "signup" }) {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      const next = params.get("next");
      // New members go to the join step; the composer draft is waiting after.
      window.location.href = kind === "signup" ? "/account?join=1" : next || "/";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-semibold">
        {kind === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {kind === "signup"
          ? "Your prompt is saved — it'll be waiting after you join."
          : "Sign in to keep generating."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface p-3 outline-none focus:border-accent"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder={kind === "signup" ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface p-3 outline-none focus:border-accent"
        />
        {error && <p className="text-sm text-bad">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : kind === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {kind === "signup" ? (
          <>
            Already a member?{" "}
            <Link className="underline" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="underline" href="/signup">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
