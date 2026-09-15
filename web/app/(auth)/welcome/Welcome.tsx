"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SURVEY as SURVEY_TYPE } from "@/lib/onboarding";
import AuthShell, { Field, Primary, Title } from "@/components/auth/AuthShell";
import { flushEvents, track } from "@/lib/track-client";
import { showLoader } from "@/lib/ui-events";

// The welcome flow. Two screens on the split-screen shell that sign-up
// used — finalize the account, a referral code — then the lights go down
// for three questions, one per screen, with a progress bar at the foot.
// Which screen to draw comes from the server so a refresh or a second
// device resumes rather than restarts; every screen reports itself so the
// growth page can see where people stop.

type Step = "finalize" | "referral" | "survey" | "done";
type Survey = typeof SURVEY_TYPE;
type Question = keyof Survey;
const QUESTIONS: Question[] = ["role", "goal", "source"];

interface State {
  email: string;
  step: Step;
  required: boolean;
  refCode: string | null;
  referred: boolean;
  survey: Survey;
}

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
  const seen = useRef<Set<string>>(new Set());

  // Where to go when done. The composer, with the offer over it and the
  // draft prompt still in localStorage — unless a plan was chosen on the
  // pricing page before signing up, in which case the join step is what
  // they were on their way to.
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
          showLoader();
          router.replace("/sign-up");
          return;
        }
        const d = (await r.json()) as State;
        if (d.step === "done") {
          showLoader();
          window.location.assign(destination());
          return;
        }
        setState(d);
        setStep(d.step);
      })
      .catch(() => setError("Could not load your account. Refresh to try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCallback((name: string) => {
    if (seen.current.has(name)) return;
    seen.current.add(name);
    track("welcome_viewed", { step: name });
  }, []);
  useEffect(() => {
    if (step && step !== "done" && step !== "survey") view(step);
  }, [step, view]);

  async function finalize() {
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

  async function survey(answers: Record<Question, string>) {
    setBusy(true);
    setError(null);
    try {
      const { status } = await post({ step: "survey", ...answers });
      if (status !== 200) {
        setError("Something went wrong. Try again.");
        return;
      }
      for (const q of QUESTIONS) track("survey_answered", { question: q, answer: answers[q] });
      track("welcome_step_done", { step: "survey" });
      track("welcome_completed");
      flushEvents();
      showLoader();
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
  if (!state || !step || step === "done") return null;

  if (step === "survey") {
    return (
      <SurveyScreens
        survey={state.survey}
        busy={busy}
        error={error}
        onView={(q) => view(`survey:${q}`)}
        onSubmit={survey}
      />
    );
  }

  return (
    <AuthShell steps={2} step={step === "finalize" ? 0 : 1}>
      {step === "finalize" && (
        <FinalizeStep email={state.email} busy={busy} error={error} onCreate={finalize} />
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
    </AuthShell>
  );
}

function FinalizeStep({
  email,
  busy,
  error,
  onCreate,
}: {
  email: string;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate();
      }}
    >
      <Title>Finalize your account</Title>
      <div className="border-t border-line pt-4">
        {/* What is actually true of us, and nothing more. We do not scan
            faces, capture voices or build biometric profiles; the provider
            we render on refuses photographs of real people outright. So the
            consent asked for here is to the two documents, not to a data
            practice we do not have. */}
        <p className="text-xs leading-relaxed text-muted">
          By clicking &ldquo;Create account&rdquo; you agree to our{" "}
          <Link href="/terms" target="_blank" className="text-accent hover:underline">
            Terms of Use
          </Link>{" "}
          and acknowledge that you have read and understand our{" "}
          <Link href="/privacy" target="_blank" className="text-accent hover:underline">
            Privacy Policy
          </Link>
          . Your account is <span className="text-ink">{email}</span>.
        </p>
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-5">
        <Primary type="submit" busy={busy}>Create account</Primary>
      </div>
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
      className="space-y-3"
    >
      <Title
        sub={
          referred
            ? "A friend's link brought you here — their code is already applied."
            : undefined
        }
      >
        Got a referral code?
      </Title>
      <Field
        label="Referral code (optional)"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        disabled={referred}
        className="font-mono tracking-widest"
      />
      {error && <p className="text-sm text-bad">{error}</p>}
      <Primary type="submit" busy={busy}>Continue</Primary>
      {!referred && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit("", true)}
          className="w-full py-1 text-center text-sm text-muted hover:text-ink"
        >
          Skip
        </button>
      )}
    </form>
  );
}

// Icons for the "what best describes you" cards: plain line drawings, one
// per option, drawn inline so nothing is fetched.
const ROLE_ICONS: Record<string, React.ReactNode> = {
  creator: <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm13 4 5-3v10l-5-3z" />,
  marketer: <path d="M3 10v4h3l7 4V6l-7 4H3zm13-1a3 3 0 0 1 0 6m2-9a6 6 0 0 1 0 12" />,
  filmmaker: <path d="M3 5h18v14H3zM3 9h18M7 5v14M17 5v14" />,
  developer: <path d="m8 8-5 4 5 4m8-8 5 4-5 4M14 4l-4 16" />,
  exploring: <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z" />,
  other: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
};

// Marks for the "how did you hear about us" cards. Simplified, one colour,
// drawn inline: enough to be recognised at a glance, which is all a survey
// card needs. Naming a platform as the answer to "where did you hear of us"
// is the ordinary use of its name.
const SOURCE_ICONS: Record<string, React.ReactNode> = {
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 10v7M8 7v.5M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" />
    </>
  ),
  reddit: (
    <>
      <ellipse cx="12" cy="14" rx="7" ry="5" />
      <circle cx="9.5" cy="13.5" r=".8" fill="currentColor" />
      <circle cx="14.5" cy="13.5" r=".8" fill="currentColor" />
      <path d="M12 9V5l4 1M9.5 16.5c1.5 1 3.5 1 5 0M19 11a1.5 1.5 0 1 0-2-2M5 11a1.5 1.5 0 1 1 2-2" />
    </>
  ),
  facebook: <path d="M14 8h2V5h-2a3 3 0 0 0-3 3v2H9v3h2v7h3v-7h2l1-3h-3V8z" />,
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" />
    </>
  ),
  ai_chat: <path d="M4 5h16v11H9l-5 4z" />,
  x: <path d="M5 4l14 16M19 4 5 20" />,
  word_of_mouth: (
    <>
      <path d="M3 5h10v7H7l-4 3z" />
      <path d="M13 9h8v7h-2l-3 3v-3h-3z" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="16.5" cy="7.5" r=".6" fill="currentColor" />
    </>
  ),
  news: <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H4zM17 14h3v5h-3z" />,
  tiktok: <path d="M13 4v10.5a3 3 0 1 1-3-3M13 4c0 2.5 2 4.5 4.5 4.5" />,
  google: <path d="M20 12h-8v3h4.5A5 5 0 1 1 15 8.5" />,
  other: <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z" />,
};

function SurveyScreens({
  survey,
  busy,
  error,
  onView,
  onSubmit,
}: {
  survey: Survey;
  busy: boolean;
  error: string | null;
  onView: (q: Question) => void;
  onSubmit: (answers: Record<Question, string>) => void;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<Question, string>>>({});
  const q = QUESTIONS[i];
  const def = survey[q];
  useEffect(() => onView(q), [q, onView]);

  function pick(key: string) {
    const next = { ...answers, [q]: key };
    setAnswers(next);
    if (i < QUESTIONS.length - 1) setI(i + 1);
    else onSubmit(next as Record<Question, string>);
  }

  const wide = q === "source";
  return (
    <div className="survey-dark flex min-h-screen flex-col items-center justify-center px-6 py-16 text-white">
      <div className="w-full max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{def.question}</h1>
        <p className="mt-2 text-sm text-white/60">
          {q === "source" ? "Select one that applies." : "This helps us build the product for the people using it."}
        </p>
        <div
          className={`mx-auto mt-8 grid gap-3 ${
            wide
              ? "grid-cols-2 sm:grid-cols-3"
              : def.options.length <= 2
                ? "max-w-xl sm:grid-cols-2"
                : "sm:grid-cols-3"
          }`}
        >
          {def.options.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              onClick={() => pick(o.key)}
              aria-pressed={answers[q] === o.key}
              className={`rounded-xl border bg-white/[0.03] p-4 text-left transition-colors hover:border-white/60 hover:bg-white/[0.06] disabled:opacity-50 ${
                answers[q] === o.key ? "border-white" : "border-white/15"
              } ${wide ? "flex items-center gap-3 py-4" : "min-h-[8.5rem] flex flex-col justify-between"}`}
            >
              {(q === "role" || q === "source") && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {q === "role" ? ROLE_ICONS[o.key] ?? ROLE_ICONS.other : SOURCE_ICONS[o.key] ?? SOURCE_ICONS.other}
                  </svg>
                </span>
              )}
              <span>
                <span className="block font-medium">{o.label}</span>
                {o.blurb && <span className="mt-0.5 block text-xs text-white/55">{o.blurb}</span>}
              </span>
            </button>
          ))}
        </div>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
      <div className="fixed inset-x-0 bottom-0 flex items-center justify-center px-6 py-6">
        {i > 0 && (
          <button
            type="button"
            onClick={() => setI(i - 1)}
            className="absolute left-6 text-sm text-white/60 hover:text-white sm:left-10"
          >
            ← Back
          </button>
        )}
        <ol className="flex items-center gap-1.5" aria-label="Progress">
          {QUESTIONS.map((k, n) => (
            <li
              key={k}
              aria-current={n === i ? "step" : undefined}
              className={`h-1 rounded-full transition-all ${
                n === i ? "w-6 bg-white" : n < i ? "w-1.5 bg-white/60" : "w-1.5 bg-white/25"
              }`}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
