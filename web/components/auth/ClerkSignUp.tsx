"use client";

import { showLoader } from "@/lib/ui-events";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSignUp } from "@clerk/nextjs/legacy";
import AuthShell, { Field, GoogleMark, isEmail, Or, Primary, Secondary, Title } from "./AuthShell";
import { flushEvents, track } from "@/lib/track-client";

// Sign-up on Clerk, drawn by us: one question per screen. Email, then a
// password, then the code Clerk emails to prove the address is theirs. Google
// skips all three. Ends on /welcome — with the plan carried along if one was
// picked on the pricing page — where the account is finalised.
//
// Clerk still does everything that matters: the account, the password
// rules, the verification, bot protection (the empty div below is where its
// challenge mounts). This is only the form.

type Step = "email" | "password" | "code" | "continue";
const STEPS: Step[] = ["email", "password", "code"];

function clerkMessage(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? "Something went wrong. Try again.";
}

export default function ClerkSignUp() {
  const params = useSearchParams();
  const { isLoaded, signUp, setActive } = useSignUp();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    track("signup_viewed", { auth: "clerk" });
  }, []);

  // An OAuth sign-up Clerk could not finish in one hop lands back here, sent
  // by the callback's continueSignUpUrl. The attempt is still on the client,
  // so pick it up where it stopped: asking for the email again would start a
  // second account. Only a password can be collected without inventing a
  // form for fields nobody enabled; anything else says so plainly rather
  // than looping.
  useEffect(() => {
    if (!isLoaded || !signUp || signUp.status !== "missing_requirements") return;
    if (signUp.emailAddress) setEmail(signUp.emailAddress);
    const fields = [...(signUp.missingFields ?? [])];
    if (!fields.includes("password") && (signUp.unverifiedFields ?? []).includes("email_address")) {
      signUp
        .prepareEmailAddressVerification({ strategy: "email_code" })
        .then(() => setStep("code"))
        .catch((e) => setError(clerkMessage(e)));
      return;
    }
    setMissing(fields);
    setStep("continue");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, signUp?.status]);

  // Every path that ends with an account: set the session, then leave.
  async function complete(r: { status: string | null; createdSessionId: string | null }) {
    if (!setActive || r.status !== "complete" || !r.createdSessionId) return false;
    await setActive({ session: r.createdSessionId });
    track("signup_step_done", { step: "code" });
    flushEvents();
    showLoader();
    window.location.assign(done());
    return true;
  }

  async function submitContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await signUp.update({ password });
      if (!(await complete(r))) {
        if ((r.unverifiedFields ?? []).includes("email_address")) {
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setStep("code");
        } else {
          setError("Could not finish creating the account. Try signing in instead.");
        }
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Where the account lands once it exists. The welcome flow, carrying a
  // plan chosen on the pricing page so the join step is still where they
  // were headed.
  function done(): string {
    const q = new URLSearchParams();
    for (const k of ["plan", "interval"]) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    const s = q.toString();
    return `/welcome${s ? `?${s}` : ""}`;
  }

  async function google() {
    if (!isLoaded) return;
    setError(null);
    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: done(),
      });
    } catch (e) {
      setError(clerkMessage(e));
    }
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    track("signup_step_done", { step: "email" });
    setStep("password");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      track("signup_step_done", { step: "password" });
      setStep("code");
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (await complete(r)) return;
      setError("That code did not work. Check the email and try again.");
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const index = step === "continue" ? STEPS.length - 1 : STEPS.indexOf(step);
  return (
    <AuthShell
      steps={STEPS.length}
      step={index}
      onBack={
        step === "email" || step === "continue"
          ? undefined
          : () => { setError(null); setStep(STEPS[index - 1]); }
      }
    >
      {step === "email" && (
        <form onSubmit={submitEmail} className="space-y-3">
          <Title>Enter your email</Title>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="Enter your email to get started"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" disabled={!isLoaded}>Continue</Primary>
          <Or />
          <Secondary type="button" onClick={google} disabled={!isLoaded}>
            <GoogleMark /> Continue with Google
          </Secondary>
          <p className="pt-4 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={submitPassword} className="space-y-3">
          <Title sub={email}>Set a password</Title>
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {/* Clerk's bot check mounts here when the instance asks for one. */}
          <div id="clerk-captcha" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" busy={busy}>Continue</Primary>
          <p className="pt-2 text-center text-xs text-muted">
            By continuing you agree to the{" "}
            <Link href="/terms" className="underline">Terms</Link> and acknowledge the{" "}
            <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-3">
          <Title sub={<>We sent a six-digit code to <span className="text-ink">{email}</span>.</>}>
            Check your email
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
          {error && <p className="text-sm text-bad">{error}</p>}
          <Primary type="submit" busy={busy}>Create account</Primary>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!isLoaded) return;
              setError(null);
              try {
                await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
              } catch (err) {
                setError(clerkMessage(err));
              }
            }}
            className="w-full py-1 text-center text-sm text-muted hover:text-ink"
          >
            Send the code again
          </button>
        </form>
      )}
      {step === "continue" && (
        missing.includes("password") ? (
          <form onSubmit={submitContinue} className="space-y-3">
            <Title sub={email || undefined}>Set a password</Title>
            <p className="text-sm text-muted">
              Your account is nearly there — this instance asks for a password as well.
            </p>
            <Field
              label="Password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Field
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && <p className="text-sm text-bad">{error}</p>}
            <Primary type="submit" busy={busy}>Create account</Primary>
          </form>
        ) : (
          <div className="space-y-3">
            <Title sub={email || undefined}>We could not finish that sign-up</Title>
            <p className="text-sm text-muted">
              Google signed you in, but the account still needs something this form cannot
              ask for{missing.length ? ` (${missing.join(", ")})` : ""}. Start again with an
              email address, or sign in if the account already exists.
            </p>
            {error && <p className="text-sm text-bad">{error}</p>}
            <Primary type="button" onClick={() => { setError(null); setMissing([]); setStep("email"); }}>
              Start again
            </Primary>
            <p className="pt-4 text-center text-sm text-muted">
              Already have an account?{" "}
              <Link href="/sign-in" className="font-medium text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        )
      )}
    </AuthShell>
  );
}
