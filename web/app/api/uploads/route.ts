import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { presignUpload, storageEnabled, uploadLimitBytes, UPLOAD_TYPES } from "@/lib/storage";

// Presigned PUT for an input file (image, reference video or audio). The
// browser uploads straight to S3; only the key comes back with the job. The
// file's size is part of the signature, so the per-type limit holds at the
// bucket and not only in the browser.

const Body = z.object({
  contentType: z.enum(UPLOAD_TYPES as [string, ...string[]]),
  bytes: z.number().int().positive(),
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
  const { contentType, bytes } = parsed.data;
  const maxBytes = uploadLimitBytes(contentType) ?? 0;
  if (bytes > maxBytes) {
    return NextResponse.json(
      { error: `That file is too large (limit ${Math.round(maxBytes / 1e6)} MB).` },
      { status: 413 }
    );
  }
  const presigned = await presignUpload(user.id, contentType, bytes);
  if (!presigned) return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  return NextResponse.json(presigned);
}

export async function GET() {
  return NextResponse.json({ enabled: storageEnabled() });
}
