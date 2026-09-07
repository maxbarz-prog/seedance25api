import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { advanceJob } from "@/lib/pipeline";
import { deleteJob, jobById } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { presentJob } from "@/lib/present";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const job = await advanceJob(id);
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ job: await presentJob(job) });
}

// Delete a finished video (frees storage quota). In-flight jobs can't be
// deleted — they resolve to ready/failed first.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const job = await jobById(id);
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (job.status !== "ready" && job.status !== "failed") {
    return NextResponse.json({ error: "Still processing." }, { status: 409 });
  }
  await deleteObject(job.video_url);
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
