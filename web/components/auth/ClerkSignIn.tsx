"use client";

import { hideLoader, showLoader } from "@/lib/ui-events";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSignIn } from "@clerk/nextjs/legacy";
import { fetchMe } from "@/lib/me-client";
import AuthShell, { Field, GoogleMark, isEmail, Or, Primary, Secondary, Title } from "./AuthShell";

// Sign-in on Clerk, drawn by us. Email, then password; or Google. A
// forgotten password turns into a code Clerk emails and a new password on
// the same screen. Lands on the composer, or wherever `next` says.

type Step = "email" | "password" | "reset";
const STEPS: Step[] = ["email", "password"];

function clerkMessage(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? "Something went wrong. Try again.";
}

export default function ClerkSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // On the way out to Google: the loading screen is up and nothing on this
  // form should look pressable.
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);

  // Only a path on this site: a `next` that pointed elsewhere would make
  // sign-in an open redirect. One leading slash and nothing slash-like after
  // it — a backslash counts, because URL parsing treats it as a slash for
  // http and https, so "/\evil.com" resolves to another origin entirely.
  const next = params.get("next");
  const done = next && next.startsWith("/") && !/^\/[/\\]/.test(next) ? next : "/create";

  // Google is a round trip to Clerk before the browser goes anywhere, so the
  // loading screen goes up on the click itself and comes down only if the
  // call fails. A press before clerk-js has loaded is remembered by
  // `leaving` and started by the effect below, rather than being dropped and
  // leaving the person to press again.
  async function google() {
    if (started.current) return;
    setError(null);
    setLeaving(true);
    showLoader();
    if (!isLoaded) return;
    started.current = true;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: done,
      });
    } catch (e) {
      started.current = false;
      hideLoader();
      setLeaving(false);
      setError(clerkMessage(e));
    }
  }

  useEffect(() => {
    if (leaving && isLoaded) void google();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, isLoaded]);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setStep("password");
  }

  async function finish(r: { status: string | null; createdSessionId: string | null }) {
    if (!isLoaded) return false;
    if (r.status === "complete" && r.createdSessionId) {
      showLoader();
      await setActive({ session: r.createdSessionId });
      // A client-side navigation, not a document load. Loading the document
      // again means the browser blanks between the two, so the wait reads as
      // spinner, white, spinner. Priming /api/me first means the composer and
      // the header already know who arrived.
      await fetchMe(true).catch(() => null);
      router.replace(done);
      return true;
    }
    if (r.status === "needs_second_factor") {
      setError("This account has two-factor sign-in turned on, which this form does not support yet. Use Continue with Google, or contact support.");
      return true;
    }
    return false;
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signIn.create({ identifier: email.trim(), password });
      if (!(await finish(r))) setError("Could not sign you in. Check the password and try again.");
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
      setPassword("");
      setStep("reset");
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password,
      });
      if (!(await finish(r))) setError("That code did not work. Check the email and try again.");
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const index = step === "reset" ? 1 : STEPS.indexOf(step);
  return (
    <AuthShell
      steps={STEPS.length}
      step={index}
      onBack={step === "email" ? undefined : () => { setError(null); setStep("email"); }}
    >
      {step === "email" && (
        <form onSubmit={submitEmail} className="space-y-3">
          <Title>Welcome back</Title>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" disabled={leaving}>Continue</Primary>
          <Or />
          <Secondary type="button" onClick={google} busy={leaving}>
            <GoogleMark /> Continue with Google
          </Secondary>
          <p className="pt-4 text-center text-sm text-muted">
            New here?{" "}
            <Link href="/sign-up" className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={submitPassword} className="space-y-3">
          <Title sub={email}>Enter your password</Title>
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" busy={busy}>Sign in</Primary>
          <button
            type="button"
            disabled={busy}
            onClick={forgot}
            className="w-full py-1 text-center text-sm text-muted hover:text-ink"
          >
            Forgot password?
          </button>
        </form>
      )}
      {step === "reset" && (
        <form onSubmit={submitReset} className="space-y-3">
          <Title sub={<>We sent a code to <span className="text-ink">{email}</span>. Enter it with a new password.</>}>
            Reset your password
          </Title>
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" busy={busy}>Set password and sign in</Primary>
        </form>
      )}
    </AuthShell>
  );
}
