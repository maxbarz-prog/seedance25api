import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { presignUpload, storageEnabled, UPLOAD_TYPES } from "@/lib/storage";

// Presigned PUT for an input file (image, reference video or audio). The
// browser uploads straight to S3; only the key comes back with the job.

const Body = z.object({
  contentType: z.enum(UPLOAD_TYPES as [string, ...string[]]),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!storageEnabled()) {
    return NextResponse.json({ error: "Uploads unavailable in this environment." }, { status: 501 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Use JPEG/PNG/WebP images, MP4/MOV video, or MP3/WAV audio." },
      { status: 400 }
    );
  }
  const presigned = await presignUpload(user.id, parsed.data.contentType);
  return NextResponse.json(presigned);
}

export async function GET() {
  return NextResponse.json({ enabled: storageEnabled() });
}
