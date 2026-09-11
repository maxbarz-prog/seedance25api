"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EXTEND_CONTEXT_S,
  EXTEND_MAX_S,
  EXTEND_MIN_S,
  MODELS,
  ModelId,
  modeInfo,
} from "@/lib/config";
import CreditsDialog, { CreditsBlock } from "@/components/CreditsDialog";
import { BALANCE_EVENT } from "@/components/Header";

interface Job {
  id: string;
  prompt: string;
  model?: string;
  duration_s: number;
  aspect: string;
  mode: string;
  status: "queued" | "generating" | "upscaling" | "ready" | "failed";
  provider_phase?: string | null;
  quote_credits: number;
  video_url: string | null;
  error: string | null;
  kind?: string | null;
  source_job_id?: string | null;
}

const STEPS = ["queued", "generating", "upscaling", "ready"] as const;
const LABELS: Record<string, string> = {
  queued: "Queued",
  generating: "Generating",
  upscaling: "Upscaling to 1080p",
  ready: "Ready",
};

// A submitted job sits in the provider's queue until a rendering slot frees
// up. Showing "Generating" for that whole time makes a working queue look
// like a stall, so the wait keeps its own name until work actually starts.
function phaseOf(job: Job): string {
  return job.status === "generating" && job.provider_phase === "queued" ? "queued" : job.status;
}

export default function JobView({ id }: { id: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extendS, setExtendS] = useState(5);
  const [extendQuote, setExtendQuote] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [block, setBlock] = useState<CreditsBlock | null>(null);

  useEffect(() => {
    if (!job || !extendOpen) return;
    const ctl = new AbortController();
    const context = Math.min(job.duration_s, EXTEND_CONTEXT_S);
    fetch(`/api/quote?model=${job.model ?? "seedance-2.5"}&duration=${extendS}&mode=${job.mode}&context=${context}`, {
      signal: ctl.signal,
    })
      .then((r) => r.json())
      .then((q) => setExtendQuote(q.usd ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, [job, extendOpen, extendS]);

  async function extend() {
    setExtending(true);
    setExtendError(null);
    try {
      const res = await fetch(`/api/jobs/${id}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: extendPrompt, durationS: extendS }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setBlock({
          reason:
            data.error === "membership_required" || data.error === "plan_required"
              ? "plan_required"
              : "insufficient_credits",
          needed: data.needed,
          balance: data.balance,
          canBuyCredits: data.canBuyCredits,
          message: data.message,
        });
        return;
      }
      if (!res.ok) {
        setExtendError(data.message || data.error || "Something went wrong.");
        return;
      }
      window.dispatchEvent(new Event(BALANCE_EVENT));
      router.push(`/jobs/${data.id}`);
    } finally {
      setExtending(false);
    }
  }

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/jobs/${id}`);
      if (res.status === 404 || res.status === 401) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      if (stop) return;
      setJob(data.job);
      if (data.job.status !== "ready" && data.job.status !== "failed") {
        setTimeout(poll, 2000);
      }
    }
    poll();
    return () => {
      stop = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="py-16 text-center text-muted">
        Video not found.{" "}
        <Link href="/" className="underline">
          Back to the composer
        </Link>
      </div>
    );
  }
  if (!job) return <div className="py-16 text-center text-muted">Loading…</div>;

  const phase = phaseOf(job);
  const stepIdx =
    modeInfo(job.mode).upscale === "none" && phase === "generating"
      ? 1
      : STEPS.indexOf(phase as (typeof STEPS)[number]);

  return (
    <div className="py-10">
      <CreditsDialog block={block} onClose={() => setBlock(null)} />
      <p className="text-sm text-muted">
        “{job.prompt.slice(0, 140)}
        {job.prompt.length > 140 ? "…" : ""}”
        {" · "}
        {job.model && job.model in MODELS
          ? MODELS[job.model as ModelId].label
          : job.model}{" "}
        · {job.duration_s}s · {job.aspect} ·{" "}
        {`${modeInfo(job.mode).label} (${
          modeInfo(job.mode).resolution
        })`}{" "}
        · ${(job.quote_credits * 0.01).toFixed(2)}
      </p>

      {job.status === "failed" ? (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-bad">{job.error}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink"
          >
            Try again
          </Link>
        </div>
      ) : job.status === "ready" && job.video_url ? (
        <div className="mt-8">
          <video
            src={job.video_url}
            controls
            autoPlay
            loop
            className="w-full rounded-2xl border border-line bg-black"
          />
          <p className="mt-2 text-xs text-muted">
            AI-generated video.
            {job.kind === "extend" && job.source_job_id && (
              <>
                {" "}Continues{" "}
                <Link href={`/jobs/${job.source_job_id}`} className="underline">
                  this clip
                </Link>
                .
              </>
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => setExtendOpen((v) => !v)}
              className="rounded-full border border-accent px-6 py-2 text-sm hover:opacity-90"
            >
              Extend
            </button>
            <a
              href={job.video_url}
              download
              className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink"
            >
              Download
            </a>
            <Link
              href="/"
              className="rounded-full border border-line px-6 py-2 text-sm hover:border-accent"
            >
              Make another
            </Link>
            <Link
              href="/library"
              className="rounded-full border border-line px-6 py-2 text-sm hover:border-accent"
            >
              Library
            </Link>
          </div>
          {extendOpen && (
            <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm font-medium">Continue this clip</p>
              <textarea
                value={extendPrompt}
                onChange={(e) => setExtendPrompt(e.target.value)}
                placeholder="What happens next? (optional — defaults to the original prompt)"
                rows={2}
                className="mt-2 w-full rounded-xl border border-line bg-bg p-3 text-sm outline-none focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-muted">Add</span>
                  <input
                    type="range"
                    min={EXTEND_MIN_S}
                    max={EXTEND_MAX_S}
                    value={extendS}
                    onChange={(e) => setExtendS(Number(e.target.value))}
                    className="accent-[var(--accent)]"
                  />
                  <span className="w-8 font-medium">{extendS}s</span>
                </label>
                <span className="text-muted">
                  {extendQuote !== null ? `$${extendQuote.toFixed(2)}` : "…"}
                </span>
                <button
                  onClick={extend}
                  disabled={extending}
                  className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
                >
                  {extending ? "Starting…" : "Extend"}
                </button>
              </div>
              {extendError && <p className="mt-2 text-sm text-bad">{extendError}</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-8">
          <ol className="space-y-4">
            {STEPS.slice(0, 3).map((s, i) => {
              // Nothing to show for a step this route never takes.
              if (modeInfo(job.mode).upscale === "none" && s === "upscaling")
                return null;
              const state = i < stepIdx ? "done" : i === stepIdx ? "now" : "todo";
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      state === "done"
                        ? "bg-good"
                        : state === "now"
                          ? "animate-pulse bg-accent"
                          : "bg-line"
                    }`}
                  />
                  <span className={state === "todo" ? "text-muted" : ""}>
                    {LABELS[s]}
                    {state === "now" && "…"}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 text-xs text-muted">
            Usually 1–3 minutes. You can close this page — the video will be in
            your library.
          </p>
        </div>
      )}
    </div>
  );
}
