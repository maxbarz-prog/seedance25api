"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SURVEY as SURVEY_TYPE } from "@/lib/onboarding";
import { flushEvents, track } from "@/lib/track-client";

// The welcome flow, three steps, one screen each. Which step to draw comes
// from the server so a refresh or a second device resumes rather than
// restarts; every step reports itself so the growth page can see where
// people stop.

type Step = "finalize" | "referral" | "survey" | "done";
type Survey = typeof SURVEY_TYPE;

interface State {
  email: string;
  step: Step;
  required: boolean;
  refCode: string | null;
  referred: boolean;
  survey: Survey;
}

const STEPS: Step[] = ["finalize", "referral", "survey"];

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export default function Welcome() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<Step>>(new Set());

  // Where to go when done. The composer, with the draft prompt still in
  // localStorage — unless a plan was chosen on the pricing page before
  // signing up, in which case the join step is what they were on their way
  // to and the offer would only be in the way.
  const destination = useCallback(() => {
    const plan = params.get("plan");
    if (plan) {
      const q = new URLSearchParams({ join: "1", plan });
      const interval = params.get("interval");
      if (interval) q.set("interval", interval);
      return `/account?${q}`;
    }
    return "/create?welcome=1";
  }, [params]);

  // Once per page load. The search-params object is a new identity on
  // every render, so listing `destination` here would refetch on each one.
  useEffect(() => {
    fetch("/api/onboarding")
      .then(async (r) => {
        if (r.status === 401) {
          router.replace("/sign-up");
          return;
        }
        const d = (await r.json()) as State;
        if (d.step === "done") {
          window.location.assign(destination());
          return;
        }
        setState(d);
        setStep(d.step);
      })
      .catch(() => setError("Could not load your account. Refresh to try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!step || step === "done" || seen.current.has(step)) return;
    seen.current.add(step);
    track("welcome_viewed", { step });
  }, [step]);

  async function finalize(agree: boolean) {
    if (!agree) {
      setError("Tick the box to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await post({ step: "finalize", agree: true });
      if (status !== 200) {
        setError("Something went wrong. Try again.");
        return;
      }
      track("welcome_step_done", { step: "finalize" });
      setStep(data.step);
    } finally {
      setBusy(false);
    }
  }

  async function referral(code: string, skip: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await post({ step: "referral", code, skip });
      if (status !== 200) {
        setError("Something went wrong. Try again.");
        return;
      }
      if (skip || !code.trim()) track("referral_skipped");
      else track("referral_entered", { result: data.result });
      if (!data.ok) {
        setError(
          data.result === "self"
            ? "That is your own code — it cannot refer you."
            : "That code is not one we know. Check it, or skip for now."
        );
        return;
      }
      track("welcome_step_done", { step: "referral" });
      setStep(data.step);
    } finally {
      setBusy(false);
    }
  }

  async function survey(role: string, goal: string) {
    setBusy(true);
    setError(null);
    try {
      const { status } = await post({ step: "survey", role, goal });
      if (status !== 200) {
        setError("Something went wrong. Try again.");
        return;
      }
      track("survey_answered", { question: "role", answer: role });
      track("survey_answered", { question: "goal", answer: goal });
      track("welcome_step_done", { step: "survey" });
      track("welcome_completed");
      flushEvents();
      // A full load, not a client transition: the composer's shared "who am
      // I" answer was cached before the account existed, and a fresh
      // document is the one sure way to make every part of the page ask
      // again.
      window.location.assign(destination());
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) return <p className="py-16 text-center text-muted">{error}</p>;
  if (!state || !step || step === "done") {
    return <p className="py-16 text-center text-muted">One moment…</p>;
  }
  const index = STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-lg py-12">
      <ol className="mb-8 flex items-center justify-center gap-2 text-xs text-muted" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                i <= index ? "border-accent bg-accent text-accent-ink" : "border-line"
              }`}
              aria-current={i === index ? "step" : undefined}
            >
              {i + 1}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-8 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        {step === "finalize" && (
          <FinalizeStep email={state.email} busy={busy} error={error} onContinue={finalize} />
        )}
        {step === "referral" && (
          <ReferralStep
            initial={state.refCode ?? ""}
            referred={state.referred}
            busy={busy}
            error={error}
            onSubmit={referral}
          />
        )}
        {step === "survey" && (
          <SurveyStep survey={state.survey} busy={busy} error={error} onSubmit={survey} />
        )}
      </div>
    </div>
  );
}

function FinalizeStep({
  email,
  busy,
  error,
  onContinue,
}: {
  email: string;
  busy: boolean;
  error: string | null;
  onContinue: (agree: boolean) => void;
}) {
  const [agree, setAgree] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onContinue(agree);
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Finalize your account</h1>
      <p className="mt-2 text-sm text-muted">
        You are signing in as <span className="font-medium text-ink">{email}</span>.
      </p>
      {/* What is actually true of us, and nothing more. We do not scan
          faces, capture voices or build biometric profiles; the provider we
          render on refuses photographs of real people outright. So the
          consent asked for here is to the two documents, not to a data
          practice we do not have. */}
      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 text-sm hover:border-accent">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="underline underline-offset-2">
            Terms of Service
          </Link>{" "}
          and have read the{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <button
        disabled={busy}
        className="mt-6 w-full rounded-full bg-accent py-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "…" : "Continue"}
      </button>
    </form>
  );
}

function ReferralStep({
  initial,
  referred,
  busy,
  error,
  onSubmit,
}: {
  initial: string;
  referred: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string, skip: boolean) => void;
}) {
  const [code, setCode] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code, false);
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Have a referral code?</h1>
      <p className="mt-2 text-sm text-muted">
        {referred
          ? "A friend's link brought you here — their code is already applied."
          : "If a member sent you, their code gives you both a discount on a paid month. No code? Skip this."}
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
        placeholder="e.g. 7XK2M9QT"
        autoComplete="off"
        spellCheck={false}
        disabled={referred}
        className="mt-6 w-full rounded-xl border border-line bg-bg p-3 font-mono text-lg tracking-widest outline-none focus:border-accent disabled:opacity-60"
        aria-label="Referral code"
      />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <button
        disabled={busy}
        className="mt-6 w-full rounded-full bg-accent py-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "…" : "Continue"}
      </button>
      {!referred && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit("", true)}
          className="mt-3 w-full py-1 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Skip
        </button>
      )}
    </form>
  );
}

function SurveyStep({
  survey,
  busy,
  error,
  onSubmit,
}: {
  survey: Survey;
  busy: boolean;
  error: string | null;
  onSubmit: (role: string, goal: string) => void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (role && goal) onSubmit(role, goal);
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Two quick questions</h1>
      <p className="mt-2 text-sm text-muted">So the product gets built for the people using it.</p>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">{survey.role.question}</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {survey.role.options.map((o) => (
            <Panel key={o.key} selected={role === o.key} onClick={() => setRole(o.key)} label={o.label} blurb={o.blurb} />
          ))}
        </div>
      </fieldset>

      <fieldset className={`mt-6 transition-opacity ${role ? "opacity-100" : "opacity-40"}`}>
        <legend className="text-sm font-medium">{survey.goal.question}</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {survey.goal.options.map((o) => (
            <Panel
              key={o.key}
              selected={goal === o.key}
              onClick={() => role && setGoal(o.key)}
              label={o.label}
              blurb={o.blurb}
            />
          ))}
        </div>
      </fieldset>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <button
        disabled={busy || !role || !goal}
        className="mt-6 w-full rounded-full bg-accent py-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "…" : "Finish"}
      </button>
    </form>
  );
}

function Panel({
  selected,
  onClick,
  label,
  blurb,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-line hover:border-accent"
      }`}
    >
      <span className="block font-medium">{label}</span>
      <span className="mt-0.5 block text-xs text-muted">{blurb}</span>
    </button>
  );
}
