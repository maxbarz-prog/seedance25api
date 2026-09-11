import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { balance, createJob, jobsFor, storageUsedBytes } from "@/lib/db";
import { chargeCredits } from "@/lib/grants";
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
  DEFAULT_MODE,
  MODEL_IDS,
  MODELS,
  OUTPUT_MODES,
  resolveMode,
  supportsQuality,
  OUTPUT_MODE_IDS,
} from "@/lib/config";
import { canBuyCredits, canUpscale, isDeactivated, storageQuotaBytes } from "@/lib/plan";
import { advanceJob } from "@/lib/pipeline";
import { currentHalt } from "@/lib/money";
import { presentJob } from "@/lib/present";

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  model: z.enum(MODEL_IDS as [string, ...string[]]).default(DEFAULT_MODEL),
  durationS: z.number().int().min(MIN_DURATION_S).max(MAX_DURATION_S),
  aspect: z.enum(ASPECT_RATIOS),
  audio: z.boolean().default(false),
  // Validated by resolveMode below rather than by an enum here, so a draft
  // or client still holding one of the three pre-split mode ids keeps working
  // instead of failing schema validation.
  mode: z.string().default(DEFAULT_MODE),
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

  // No membership gate: every plan, Free included, can generate. What decides
  // it is credits — checked below, once there is a price to check against.

  // A deactivated account does nothing until the member brings it back.
  if (isDeactivated(user)) {
    return NextResponse.json(
      {
        error: "deactivated",
        message: "Your account is deactivated. Reactivate it from your account page to generate again.",
      },
      { status: 403 }
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

  const outputMode = resolveMode(b.mode);
  if (!outputMode || !(OUTPUT_MODE_IDS as string[]).includes(outputMode)) {
    return NextResponse.json({ error: "Unknown output mode." }, { status: 400 });
  }
  const quality = OUTPUT_MODES[outputMode].quality;
  // A model that cannot render the quality asked for: 2.0 Fast and Mini have
  // no 1080p output at the provider at all.
  if (!supportsQuality(model, quality)) {
    return NextResponse.json(
      {
        error: `${MODELS[model].label} does not render at ${quality} — pick another quality or another model.`,
      },
      { status: 400 }
    );
  }
  // Upscaling is a plan allowance. Every current plan has it, so this is
  // dormant — but it is the plan that decides, not the code.
  if (OUTPUT_MODES[outputMode].upscale !== "none" && !canUpscale(user)) {
    return NextResponse.json(
      {
        error: "plan_required",
        message:
          "Upscaling is not included on your plan — deliver the render as-is, or upgrade.",
      },
      { status: 402 }
    );
  }
  const q = quote({ model, durationS: b.durationS, mode: outputMode, audio: b.audio });
  const total = q.credits * b.variations;
  const bal = await balance(user.id);
  if (bal < total) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: "Not enough credits for this request.",
        needed: total,
        balance: bal,
        // Whether the way out is a top-up or an upgrade — the dialog needs to
        // offer the one this member can actually do.
        canBuyCredits: canBuyCredits(user),
      },
      { status: 402 }
    );
  }

  const quotaBytes = storageQuotaBytes(user);
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
      mode: outputMode,
      // Kept in step with the mode so the pipeline never has to re-derive it.
      upscale_factor: OUTPUT_MODES[outputMode].upscaleFactor,
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
    // Spends the expiring half of the balance first — see lib/grants.ts.
    await chargeCredits(user.id, q.credits, {
      jobId: job.id,
      memo:
        `Video ${b.durationS}s (${OUTPUT_MODES[outputMode].label})` +
        (b.variations > 1 ? ` · variation ${i + 1}/${b.variations}` : ""),
    });
    ids.push(job.id);
  }

  // Kick the first pipeline step immediately so jobs leave "queued".
  await Promise.all(ids.map((id) => advanceJob(id)));

  return NextResponse.json({ id: ids[0], ids }, { status: 201 });
}
