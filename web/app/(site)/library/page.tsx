"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/me-client";
import { openPlans } from "@/lib/ui-events";
import { PLANS } from "@/lib/config";

interface Job {
  id: string;
  prompt: string;
  duration_s: number;
  status: string;
  provider_phase?: string | null;
  video_url: string | null;
  poster_url?: string | null;
  created_at: number;
}

function gb(bytes: number): string {
  const g = bytes / 1e9;
  return g >= 10 ? g.toFixed(0) : g >= 1 ? g.toFixed(1) : g >= 0.01 ? g.toFixed(2) : "0";
}

export default function LibraryPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [unauthed, setUnauthed] = useState(false);
  const [me, setMe] = useState<{
    plan: string;
    storageUsedBytes: number;
    storageQuotaBytes: number;
  } | null>(null);

  useEffect(() => {
    fetchMe().then(({ user }) => {
      const u = user as (typeof user & { storageUsedBytes?: number; storageQuotaBytes?: number }) | null;
      if (u && typeof u.storageUsedBytes === "number" && typeof u.storageQuotaBytes === "number") {
        setMe({ plan: u.plan, storageUsedBytes: u.storageUsedBytes, storageQuotaBytes: u.storageQuotaBytes });
      }
    });
  }, []);

  useEffect(() => {
    fetch("/api/jobs")
      .then(async (r) => {
        if (r.status === 401) {
          setUnauthed(true);
          return { jobs: [] };
        }
        return r.json();
      })
      .then((d) => setJobs(d.jobs))
      .catch(() => setJobs([]));
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this video? This frees its storage and can't be undone.")) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (res.ok) setJobs((prev) => (prev ?? []).filter((j) => j.id !== id));
  }

  if (unauthed) {
    return (
      <div className="py-16 text-center text-muted">
        <Link href="/login?next=/library" className="underline">
          Sign in
        </Link>{" "}
        to see your videos.
      </div>
    );
  }
  if (!jobs) return <div className="py-16 text-center text-muted">Loading…</div>;

  const usedPct = me ? Math.min(100, (me.storageUsedBytes / Math.max(1, me.storageQuotaBytes)) * 100) : 0;
  const paid = me ? PLANS[me.plan as keyof typeof PLANS]?.monthlyUsd > 0 : false;

  return (
    <div className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Library</h1>
        {me && (
          // How much of the plan's storage the videos take, and the way to
          // more of it. Every plan up adds storage and monthly credits, so
          // the button says both.
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="min-w-[14rem]">
              <div className="flex justify-between text-xs text-muted">
                <span>Storage</span>
                <span className="tabular-nums">
                  {gb(me.storageUsedBytes)} of {gb(me.storageQuotaBytes)} GB
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={`h-full ${usedPct >= 90 ? "bg-bad" : usedPct >= 70 ? "bg-warn" : "bg-accent"}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>
            {!paid || usedPct >= 70 ? (
              <button
                type="button"
                onClick={() => openPlans("library")}
                className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-ink hover:opacity-90"
              >
                {paid ? "More storage" : "Upgrade for more storage and monthly credits"}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="mt-4 text-muted">
          Nothing here yet.{" "}
          <Link href="/create" className="underline">
            Make your first video
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <div
              key={j.id}
              className="group relative overflow-hidden rounded-2xl border border-line bg-surface hover:border-accent"
            >
            {(j.status === "ready" || j.status === "failed") && (
              <button
                onClick={() => remove(j.id)}
                className="absolute right-2 top-2 z-10 rounded-full bg-surface/90 px-2 py-1 text-xs text-muted opacity-0 shadow group-hover:opacity-100 hover:text-bad"
              >
                Delete
              </button>
            )}
            <Link href={`/jobs/${j.id}`} className="block">
              {j.status === "ready" && j.video_url ? (
                // A 40KB image, not a video. Rendering a <video> here made the
                // browser download every clip in the grid — tens of megabytes
                // each, in parallel — to paint a still frame. Jobs from before
                // posters existed have none, so those keep the video, with
                // preload off so it fetches nothing until asked.
                j.poster_url ? (
                  // Deliberately not next/image: these are already small,
                  // already resized JPEGs behind a presigned URL, and routing
                  // them through the optimizer would add a Lambda hop and a
                  // per-image cost to save nothing.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={j.poster_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  // No poster: a job from before posters existed. The video
                  // is asked for its first frame only (metadata plus the
                  // fragment) so the card shows a still rather than a
                  // black box, without fetching the whole clip.
                  <video
                    src={`${j.video_url}#t=0.1`}
                    preload="metadata"
                    muted
                    loop
                    playsInline
                    className="aspect-video w-full object-cover"
                  />
                )
              ) : (
                <div className="flex aspect-video items-center justify-center bg-bg text-sm text-muted">
                  {j.status === "failed"
                    ? "Failed (refunded)"
                    : j.status === "upscaling"
                      ? "Upscaling…"
                      : j.status === "queued" || j.provider_phase === "queued"
                        ? "Queued…"
                        : "Generating…"}
                </div>
              )}
              <div className="p-3">
                <p className="truncate text-sm">{j.prompt}</p>
                <p className="mt-1 text-xs text-muted">
                  {j.duration_s}s · {new Date(j.created_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
