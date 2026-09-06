import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { advanceJob } from "@/lib/pipeline";

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
  return NextResponse.json({ job });
}
