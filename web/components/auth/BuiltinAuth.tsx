"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import AuthShell, { Field, isEmail, Primary, Title } from "./AuthShell";
import { flushEvents, track } from "@/lib/track-client";

// The built-in email-and-password auth, for local development without
// Clerk. Same screens as the Clerk flows so the product looks the same
// whichever is behind it: email, then password (and its confirmation on
// sign-up).

type Step = "email" | "password";

export default function BuiltinAuth({ kind }: { kind: "login" | "signup" }) {
  const params = useSearchParams();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind === "signup") track("signup_viewed", { auth: "builtin" });
  }, [kind]);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    if (kind === "signup") track("signup_step_done", { step: "email" });
    setStep("password");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (kind === "signup" && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      if (kind === "signup") {
        track("signup_step_done", { step: "password" });
        flushEvents();
        // A plan picked on the pricing page rides along to the welcome flow.
        const q = new URLSearchParams();
        for (const k of ["plan", "interval"]) {
          const v = params.get(k);
          if (v) q.set(k, v);
        }
        const s = q.toString();
        window.location.assign(`/welcome${s ? `?${s}` : ""}`);
      } else {
        const next = params.get("next");
        window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/create");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      steps={2}
      step={step === "email" ? 0 : 1}
      onBack={step === "email" ? undefined : () => { setError(null); setStep("email"); }}
    >
      {step === "email" ? (
        <form onSubmit={submitEmail} className="space-y-3">
          <Title>{kind === "signup" ? "Enter your email" : "Welcome back"}</Title>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder={kind === "signup" ? "Enter your email to get started" : "Enter your email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit">Continue</Primary>
          <p className="pt-4 text-center text-sm text-muted">
            {kind === "signup" ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/signup" className="font-medium text-accent hover:underline">Create an account</Link>
              </>
            )}
          </p>
        </form>
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <Title sub={email}>{kind === "signup" ? "Set a password" : "Enter your password"}</Title>
          <Field
            label="Password"
            type="password"
            autoComplete={kind === "signup" ? "new-password" : "current-password"}
            autoFocus
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {kind === "signup" && (
            <Field
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" busy={busy}>{kind === "signup" ? "Create account" : "Sign in"}</Primary>
          {kind === "signup" ? (
            <p className="pt-2 text-center text-xs text-muted">
              By continuing you agree to the <Link href="/terms" className="underline">Terms</Link> and
              acknowledge the <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          ) : (
            <Link href="/forgot" className="block py-1 text-center text-sm text-muted hover:text-ink">
              Forgot password?
            </Link>
          )}
        </form>
      )}
    </AuthShell>
  );
}
