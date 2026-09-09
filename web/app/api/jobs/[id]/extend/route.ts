import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { addLedger, balance, createJob, jobById, storageUsedBytes } from "@/lib/db";
import { quote } from "@/lib/pricing";
import {
  DEFAULT_MODEL,
  EXTEND_CONTEXT_S,
  EXTEND_MAX_S,
  EXTEND_MIN_S,
  MAX_PROMPT_CHARS,
  MODEL_IDS,
  MODELS,
  ModelId,
  PLANS,
} from "@/lib/config";
import { advanceJob } from "@/lib/pipeline";

// Continue an existing (ready) clip by N more seconds. The result is a new
// job that carries the source clip forward; the source is untouched.

const Body = z.object({
  prompt: z.string().max(MAX_PROMPT_CHARS).optional(),
  durationS: z.number().int().min(EXTEND_MIN_S).max(EXTEND_MAX_S).default(5),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const active =
    user.membership !== "none" && (user.membership_renews_at ?? 0) > Date.now();
  if (!active) {
    return NextResponse.json(
      { error: "membership_required", message: "An active membership is required." },
      { status: 402 }
    );
  }

  const { id } = await params;
  const source = await jobById(id);
  if (!source || source.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (source.status !== "ready" || !source.video_url) {
    return NextResponse.json({ error: "Only finished videos can be extended." }, { status: 409 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Extend by ${EXTEND_MIN_S}–${EXTEND_MAX_S} seconds.` },
      { status: 400 }
    );
  }
  const b = parsed.data;
  // An extension is quoted like any other render, so the source's model has to
  // be one we can still price — fall back if it has since been withdrawn.
  const model = (
    (MODEL_IDS as string[]).includes(source.model) ? source.model : DEFAULT_MODEL
  ) as ModelId;
  const q = quote({
    model,
    durationS: b.durationS,
    mode: source.mode,
    upscaleFactor: source.upscale_factor === 4 ? 4 : 2,
    // The pipeline sends only the last EXTEND_CONTEXT_S of the source.
    contextS: Math.min(source.duration_s, EXTEND_CONTEXT_S),
  });
  const bal = await balance(user.id);
  if (bal < q.credits) {
    return NextResponse.json(
      { error: "insufficient_credits", message: "Not enough credits.", needed: q.credits, balance: bal },
      { status: 402 }
    );
  }
  const plan = PLANS[user.membership as keyof typeof PLANS];
  // The delivered file is the source plus the new seconds, so size the quota
  // check against the whole thing rather than only what was added.
  if (
    (await storageUsedBytes(user.id)) + (source.duration_s + b.durationS) * 500_000 >
    plan.storageGb * 1e9
  ) {
    return NextResponse.json(
      { error: "storage_full", message: "Storage quota reached. Delete some videos first." },
      { status: 409 }
    );
  }

  const job = await createJob({
    id: randomUUID(),
    user_id: user.id,
    prompt: b.prompt?.trim() || source.prompt,
    model,
    duration_s: b.durationS,
    aspect: source.aspect,
    audio: source.audio,
    mode: source.mode,
    upscale_factor: source.upscale_factor,
    status: "queued",
    quote_credits: q.credits,
    provider_task_id: null,
    video_url: null,
    image_keys: null,
    kind: "extend",
    source_job_id: source.id,
    seed: null,
    camera_fixed: source.camera_fixed ?? 0,
    size_bytes: null,
    error: null,
  });
  await addLedger(user.id, -q.credits, "charge", {
    jobId: job.id,
    memo: `Extend video +${b.durationS}s`,
  });
  await advanceJob(job.id);
  return NextResponse.json({ id: job.id }, { status: 201 });
}
