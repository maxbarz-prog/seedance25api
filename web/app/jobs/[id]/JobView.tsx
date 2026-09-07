"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Job {
  id: string;
  prompt: string;
  model?: string;
  duration_s: number;
  aspect: string;
  mode: string;
  status: "queued" | "generating" | "upscaling" | "ready" | "failed";
  quote_credits: number;
  video_url: string | null;
  error: string | null;
}

const STEPS = ["queued", "generating", "upscaling", "ready"] as const;
const LABELS: Record<string, string> = {
  queued: "Queued",
  generating: "Generating",
  upscaling: "Upscaling to 1080p",
  ready: "Ready",
};

export default function JobView({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);

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

  const stepIdx =
    job.mode === "native-1080p" && job.status === "generating"
      ? 1
      : STEPS.indexOf(job.status as (typeof STEPS)[number]);

  return (
    <div className="py-10">
      <p className="text-sm text-muted">
        “{job.prompt.slice(0, 140)}
        {job.prompt.length > 140 ? "…" : ""}”
        {job.model === "seedance-2.0" ? " · Seedance 2.0" : " · Seedance 2.5"} ·{" "}
        {job.duration_s}s · {job.aspect} · ${(job.quote_credits * 0.01).toFixed(2)}
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
          <p className="mt-2 text-xs text-muted">AI-generated video.</p>
          <div className="mt-4 flex gap-3">
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
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-8">
          <ol className="space-y-4">
            {STEPS.slice(0, 3).map((s, i) => {
              if (job.mode === "native-1080p" && s === "upscaling") return null;
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
