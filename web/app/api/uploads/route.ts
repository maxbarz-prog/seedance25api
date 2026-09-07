import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { presignImageUpload, storageEnabled } from "@/lib/storage";

// Presigned PUT for a reference image. The browser uploads straight to S3;
// only the key comes back to us with the job.

const Body = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!storageEnabled()) {
    return NextResponse.json({ error: "Uploads unavailable in this environment." }, { status: 501 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Use a JPEG, PNG or WebP image." }, { status: 400 });
  }
  const presigned = await presignImageUpload(user.id, parsed.data.contentType);
  return NextResponse.json(presigned);
}

export async function GET() {
  return NextResponse.json({ enabled: storageEnabled() });
}
