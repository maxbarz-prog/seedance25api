"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Job {
  id: string;
  prompt: string;
  duration_s: number;
  status: string;
  video_url: string | null;
  created_at: number;
}

export default function LibraryPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [unauthed, setUnauthed] = useState(false);

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

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold">Library</h1>
      {jobs.length === 0 ? (
        <p className="mt-4 text-muted">
          Nothing here yet.{" "}
          <Link href="/" className="underline">
            Make your first video
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <Link
              key={j.id}
              href={`/jobs/${j.id}`}
              className="group overflow-hidden rounded-2xl border border-line bg-surface hover:border-accent"
            >
              {j.status === "ready" && j.video_url ? (
                <video src={j.video_url} muted loop playsInline className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-bg text-sm text-muted">
                  {j.status === "failed" ? "Failed (refunded)" : "Processing…"}
                </div>
              )}
              <div className="p-3">
                <p className="truncate text-sm">{j.prompt}</p>
                <p className="mt-1 text-xs text-muted">
                  {j.duration_s}s · {new Date(j.created_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
