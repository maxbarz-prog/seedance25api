import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { balance, createJob, jobById, storageUsedBytes } from "@/lib/db";
import { chargeCredits } from "@/lib/grants";
import { quote } from "@/lib/pricing";
import {
  DEFAULT_MODE,
  DEFAULT_MODEL,
  EXTEND_CONTEXT_S,
  EXTEND_MAX_S,
  EXTEND_MIN_S,
  MAX_PROMPT_CHARS,
  MODEL_IDS,
  ModelId,
  OUTPUT_MODES,
  OUTPUT_MODE_IDS,
  resolveMode,
} from "@/lib/config";
import {
  canBuyCredits,
  effectivePlan,
  freeRouteRefusal,
  isDeactivated,
  storageQuotaBytes,
} from "@/lib/plan";
import { advanceJob } from "@/lib/pipeline";
import { clientIp, userAgent } from "@/lib/request";
import { record } from "@/lib/events";
import {
  accountFrozen,
  currentHalt,
  freeTierBudgetLeft,
  freeTierSpentToday,
  FROZEN_RESPONSE,
  recordFreeTierSpend,
} from "@/lib/money";

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
  // Every plan can extend; credits and storage are what gate it.

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

  const { id } = await params;
  const source = await jobById(id);
  if (!source || source.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (source.status !== "ready" || !source.video_url) {
    return NextResponse.json({ error: "Only finished videos can be extended." }, { status: 409 });
  }

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
  // A disputed or fraud-flagged payment freezes the account until a human
  // has looked: no more renders on money that may be taken back.
  if (await accountFrozen(user.id)) return NextResponse.json(FROZEN_RESPONSE, { status: 403 });


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
  const resolved = resolveMode(source.mode);
  const sourceMode =
    resolved && (OUTPUT_MODE_IDS as string[]).includes(resolved) ? resolved : DEFAULT_MODE;
  const q = quote({
    model,
    durationS: b.durationS,
    // An extension keeps the source's output path, so the two halves match.
    // resolveMode covers a source written before quality and upscale became
    // separate choices; a route we no longer offer falls back.
    mode: sourceMode,
    audio: !!source.audio,
    // The pipeline sends only the last EXTEND_CONTEXT_S of the source.
    contextS: Math.min(source.duration_s, EXTEND_CONTEXT_S),
  });
  const bal = await balance(user.id);
  if (bal < q.credits) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: "Not enough credits.",
        needed: q.credits,
        balance: bal,
        canBuyCredits: canBuyCredits(user),
      },
      { status: 402 }
    );
  }
  const onFree = effectivePlan(user) === "free";
  if (onFree) {
    const refusal = freeRouteRefusal({
      model,
      quality: OUTPUT_MODES[sourceMode].quality,
      upscales: OUTPUT_MODES[sourceMode].upscale !== "none",
      durationS: b.durationS,
    });
    if (refusal) {
      return NextResponse.json({ error: "plan_required", message: refusal }, { status: 402 });
    }
  }
  if (onFree && freeTierBudgetLeft(await freeTierSpentToday()) < q.credits) {
    return NextResponse.json(
      {
        error: "free_budget",
        message:
          "The free tier has used its shared daily budget. Try again tomorrow, or join a plan to generate now.",
      },
      { status: 429 }
    );
  }
  // The delivered file is the source plus the new seconds, so size the quota
  // check against the whole thing rather than only what was added.
  if (
    (await storageUsedBytes(user.id)) + (source.duration_s + b.durationS) * 500_000 >
    storageQuotaBytes(user)
  ) {
    return NextResponse.json(
      { error: "storage_full", message: "Storage quota reached. Delete some videos first." },
      { status: 409 }
    );
  }

  const jobId = randomUUID();
  // Charged before the row exists, under the store's balance guard: the
  // check above is advisory, this is atomic. See app/api/jobs/route.ts.
  const charged = await chargeCredits(user.id, q.credits, {
    jobId,
    memo: `Extend video +${b.durationS}s`,
  });
  if (!charged) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: "Not enough credits.",
        needed: q.credits,
        balance: await balance(user.id),
        canBuyCredits: canBuyCredits(user),
      },
      { status: 402 }
    );
  }
  const job = await createJob({
    id: jobId,
    user_id: user.id,
    prompt: b.prompt?.trim() || source.prompt,
    model,
    duration_s: b.durationS,
    aspect: source.aspect,
    audio: source.audio,
    mode: sourceMode,
    upscale_factor: OUTPUT_MODES[sourceMode].upscaleFactor,
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
    created_ip: clientIp(req),
    created_ua: userAgent(req),
  });
  if (onFree) await recordFreeTierSpend(q.credits);
  await record("job_created", user.id, {
    kind: "extend",
    model,
    mode: sourceMode,
    credits: q.credits,
    plan: effectivePlan(user),
  });
  await advanceJob(job.id);
  return NextResponse.json({ id: job.id }, { status: 201 });
}
