import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { addLedger, balance, createJob, jobsFor, storageUsedBytes } from "@/lib/db";
import { quote } from "@/lib/pricing";
import {
  ASPECT_RATIOS,
  DEFAULT_MODEL,
  MAX_DURATION_S,
  MAX_PROMPT_CHARS,
  MIN_DURATION_S,
  MODEL_IDS,
  MODELS,
  PLANS,
} from "@/lib/config";
import { advanceJob } from "@/lib/pipeline";

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  model: z.enum(MODEL_IDS as [string, ...string[]]).default(DEFAULT_MODEL),
  durationS: z.number().int().min(MIN_DURATION_S).max(MAX_DURATION_S),
  aspect: z.enum(ASPECT_RATIOS),
  audio: z.boolean().default(false),
  mode: z.enum(["upscaled-1080p", "native-1080p"]).default("upscaled-1080p"),
  upscaleFactor: z.union([z.literal(2), z.literal(4)]).default(2),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ jobs: await jobsFor(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const active =
    user.membership !== "none" &&
    (user.membership_renews_at ?? 0) > Date.now();
  if (!active) {
    return NextResponse.json(
      { error: "membership_required", message: "An active membership is required to generate." },
      { status: 402 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid generation settings." }, { status: 400 });
  }
  const b = parsed.data;
  const model = b.model as keyof typeof MODELS;
  if (b.durationS > MODELS[model].maxDurationS) {
    return NextResponse.json(
      { error: `${MODELS[model].label} supports up to ${MODELS[model].maxDurationS}s.` },
      { status: 400 }
    );
  }

  const q = quote({ model, durationS: b.durationS, mode: b.mode, upscaleFactor: b.upscaleFactor });
  const bal = await balance(user.id);
  if (bal < q.credits) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: "Not enough credits for this video.",
        needed: q.credits,
        balance: bal,
      },
      { status: 402 }
    );
  }

  const plan = PLANS[user.membership as keyof typeof PLANS];
  const quotaBytes = plan.storageGb * 1e9;
  const projectedBytes = (await storageUsedBytes(user.id)) + b.durationS * 500_000;
  if (projectedBytes > quotaBytes) {
    return NextResponse.json(
      { error: "storage_full", message: "Storage quota reached. Delete some videos first." },
      { status: 409 }
    );
  }

  const job = await createJob({
    id: randomUUID(),
    user_id: user.id,
    prompt: b.prompt,
    model,
    duration_s: b.durationS,
    aspect: b.aspect,
    audio: b.audio ? 1 : 0,
    mode: b.mode,
    upscale_factor: b.upscaleFactor,
    status: "queued",
    quote_credits: q.credits,
    provider_task_id: null,
    video_url: null,
    size_bytes: null,
    error: null,
  });
  await addLedger(user.id, -q.credits, "charge", {
    jobId: job.id,
    memo: `Video ${b.durationS}s (${b.mode === "native-1080p" ? "native 1080p" : "1080p upscaled"})`,
  });

  // Kick the first pipeline step immediately so the job leaves "queued".
  await advanceJob(job.id);

  return NextResponse.json({ id: job.id }, { status: 201 });
}
