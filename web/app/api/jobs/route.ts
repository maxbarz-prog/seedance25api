import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { addLedger, balance, createJob, jobsFor, storageUsedBytes } from "@/lib/db";
import { quote } from "@/lib/pricing";
import {
  ASPECT_RATIOS,
  DEFAULT_MODEL,
  INPUT_ROLES,
  MAX_DURATION_S,
  MAX_IMAGES,
  MAX_REF_AUDIOS,
  MAX_REF_VIDEOS,
  MAX_PROMPT_CHARS,
  MAX_VARIATIONS,
  MIN_DURATION_S,
  MODEL_IDS,
  MODELS,
  NATIVE_1080P_MODEL_IDS,
  PLANS,
} from "@/lib/config";
import { advanceJob } from "@/lib/pipeline";
import { currentHalt } from "@/lib/money";
import { presentJob } from "@/lib/present";

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  model: z.enum(MODEL_IDS as [string, ...string[]]).default(DEFAULT_MODEL),
  durationS: z.number().int().min(MIN_DURATION_S).max(MAX_DURATION_S),
  aspect: z.enum(ASPECT_RATIOS),
  audio: z.boolean().default(false),
  mode: z.enum(["upscaled-1080p", "native-1080p"]).default("upscaled-1080p"),
  upscaleFactor: z.union([z.literal(2), z.literal(4)]).default(2),
  images: z
    .array(
      z.object({
        key: z.string().regex(/^uploads\/[^/]+\/[^/]+$/),
        role: z.enum(INPUT_ROLES).default("reference"),
      })
    )
    .max(MAX_IMAGES + MAX_REF_VIDEOS + MAX_REF_AUDIOS)
    .default([]),
  seed: z.number().int().min(0).max(4294967295).optional(),
  cameraFixed: z.boolean().default(false),
  variations: z.number().int().min(1).max(MAX_VARIATIONS).default(1),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const jobs = await jobsFor(user.id);
  return NextResponse.json({ jobs: await Promise.all(jobs.map(presentJob)) });
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

  // Money safety: if anything is wrong with what we charge or pay, we take
  // no more money until a human has cleared it. Checked before the quote, so
  // nobody is debited for work that will not start.
  const stop = await currentHalt();
  if (stop) {
    return NextResponse.json(
      {
        error: "paused",
        message:
          "Generation is paused while we check a billing issue. Nothing has been charged — please try again shortly.",
      },
      { status: 503 }
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
  // Model input compatibility: the lite pair is split into a text-to-video
  // and an image-to-video build, so a request has to match what the chosen
  // model actually takes.
  const hasImage = b.images.some(
    (i) => i.role !== "reference_video" && i.role !== "reference_audio"
  );
  const accepts = MODELS[model].accepts as readonly string[];
  if (hasImage && !accepts.includes("image")) {
    return NextResponse.json(
      { error: `${MODELS[model].label} is text-to-video only — remove the image.` },
      { status: 400 }
    );
  }
  if (!hasImage && !accepts.includes("text")) {
    return NextResponse.json(
      { error: `${MODELS[model].label} needs a starting image.` },
      { status: 400 }
    );
  }
  if (b.images.some((i) => !i.key.startsWith(`uploads/${user.id}/`))) {
    return NextResponse.json({ error: "Invalid image reference." }, { status: 400 });
  }
  const count = (role: string) => b.images.filter((i) => i.role === role).length;
  const imageCount = b.images.filter(
    (i) => i.role !== "reference_video" && i.role !== "reference_audio"
  ).length;
  if (count("first_frame") > 1 || count("last_frame") > 1) {
    return NextResponse.json(
      { error: "Only one first-frame and one last-frame image are allowed." },
      { status: 400 }
    );
  }
  if (
    imageCount > MAX_IMAGES ||
    count("reference_video") > MAX_REF_VIDEOS ||
    count("reference_audio") > MAX_REF_AUDIOS
  ) {
    return NextResponse.json(
      {
        error: `Up to ${MAX_IMAGES} images, ${MAX_REF_VIDEOS} reference videos and ${MAX_REF_AUDIOS} audio track.`,
      },
      { status: 400 }
    );
  }
  // A fixed seed with several variations would produce identical clips.
  if (b.variations > 1 && b.seed !== undefined) {
    return NextResponse.json(
      { error: "Clear the seed to generate variations." },
      { status: 400 }
    );
  }

  if (b.mode === "native-1080p" && !(NATIVE_1080P_MODEL_IDS as string[]).includes(model)) {
    return NextResponse.json(
      {
        error: `${MODELS[model].label} does not render 1080p natively — use the upscaled option.`,
      },
      { status: 400 }
    );
  }
  const q = quote({
    model,
    durationS: b.durationS,
    mode: b.mode,
    upscaleFactor: b.upscaleFactor,
    audio: b.audio,
  });
  const total = q.credits * b.variations;
  const bal = await balance(user.id);
  if (bal < total) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: "Not enough credits for this request.",
        needed: total,
        balance: bal,
      },
      { status: 402 }
    );
  }

  const plan = PLANS[user.membership as keyof typeof PLANS];
  const quotaBytes = plan.storageGb * 1e9;
  const projectedBytes =
    (await storageUsedBytes(user.id)) + b.durationS * 500_000 * b.variations;
  if (projectedBytes > quotaBytes) {
    return NextResponse.json(
      { error: "storage_full", message: "Storage quota reached. Delete some videos first." },
      { status: 409 }
    );
  }

  const ids: string[] = [];
  for (let i = 0; i < b.variations; i++) {
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
      image_keys: b.images.length ? JSON.stringify(b.images) : null,
      kind: "generate",
      source_job_id: null,
      seed: b.seed ?? null,
      camera_fixed: b.cameraFixed ? 1 : 0,
      size_bytes: null,
      error: null,
    });
    await addLedger(user.id, -q.credits, "charge", {
      jobId: job.id,
      memo:
        `Video ${b.durationS}s (${b.mode === "native-1080p" ? "native 1080p" : "1080p upscaled"})` +
        (b.variations > 1 ? ` · variation ${i + 1}/${b.variations}` : ""),
    });
    ids.push(job.id);
  }

  // Kick the first pipeline step immediately so jobs leave "queued".
  await Promise.all(ids.map((id) => advanceJob(id)));

  return NextResponse.json({ id: ids[0], ids }, { status: 201 });
}
