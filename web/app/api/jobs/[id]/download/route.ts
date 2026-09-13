import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { jobById, updateJob } from "@/lib/db";
import { readUrl } from "@/lib/storage";

// Download a finished video.
//
// Same-origin on purpose. A link straight to the presigned S3 URL cannot
// download: <a download> is ignored cross-origin, so the browser navigates to
// the mp4 and plays it in the tab — which is what the Download button used to
// do. Redirecting through here lets us presign with
// Content-Disposition: attachment, which every browser honours, and lets us
// check who is asking first.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const job = await jobById(id);
  // Same shape as the other job routes: a job belonging to someone else is not
  // "forbidden", it does not exist.
  if (!job || job.user_id !== user.id || !job.video_url) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Named after the prompt, so a folder of these is navigable rather than a
  // pile of uuids.
  const slug =
    (job.prompt || "video")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "video";
  const url = await readUrl(job.video_url, { filename: `remerged-${slug}.mp4` });
  if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Part of the delivery record: a download is the strongest evidence there
  // is that the video reached the member. Best effort — a failed count must
  // never fail the download.
  await updateJob(id, {
    download_count: (job.download_count ?? 0) + 1,
    last_download_at: Date.now(),
  }).catch(() => {});

  const res = NextResponse.redirect(url);
  // The presign is short-lived and per-member; nothing about it may be cached
  // by a CDN or a shared proxy.
  res.headers.set("cache-control", "private, no-store");
  return res;
}
