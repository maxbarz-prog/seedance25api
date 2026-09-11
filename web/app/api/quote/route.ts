import { NextRequest, NextResponse } from "next/server";
import { quote } from "@/lib/pricing";
import {
  DEFAULT_MODE,
  DEFAULT_MODEL,
  EXTEND_CONTEXT_S,
  MIN_DURATION_S,
  MODEL_IDS,
  MODELS,
  ModelId,
  OUTPUT_MODES,
  OUTPUT_MODE_IDS,
  resolveMode,
  supportsQuality,
} from "@/lib/config";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const modelParam = p.get("model") ?? DEFAULT_MODEL;
  // MODEL_IDS, not MODELS: a model defined without a confirmed provider rate
  // cannot be quoted at all, and asking for one is a bad request, not a 500.
  if (!(MODEL_IDS as string[]).includes(modelParam)) {
    return NextResponse.json({ error: "Unknown model." }, { status: 400 });
  }
  const model = modelParam as ModelId;
  const durationS = Number(p.get("duration") || 5);
  const modeParam = p.get("mode") || DEFAULT_MODE;
  // resolveMode accepts the three pre-split ids so an old job's re-quote (the
  // extend panel) keeps working.
  const mode = resolveMode(modeParam);
  if (!mode || !(OUTPUT_MODE_IDS as string[]).includes(mode)) {
    return NextResponse.json({ error: "Unknown output mode." }, { status: 400 });
  }
  // 2.0 Fast and 2.0 Mini have no 1080p output at the provider at all; they
  // reach 1080p only through the upscaler.
  const quality = OUTPUT_MODES[mode].quality;
  if (!supportsQuality(model, quality)) {
    return NextResponse.json(
      { error: `${MODELS[model].label} does not render at ${quality}.` },
      { status: 400 }
    );
  }
  const audio = p.get("audio") === "1";
  if (
    !Number.isInteger(durationS) ||
    durationS < MIN_DURATION_S ||
    durationS > MODELS[model].maxDurationS
  ) {
    return NextResponse.json({ error: "Invalid duration." }, { status: 400 });
  }
  // Extensions send `context` = seconds of the source clip that will ride
  // along as the reference video (capped server-side to EXTEND_CONTEXT_S).
  const contextRaw = Number(p.get("context") || 0);
  const contextS = Number.isFinite(contextRaw) && contextRaw > 0 ? Math.min(contextRaw, EXTEND_CONTEXT_S) : 0;
  return NextResponse.json(quote({ model, durationS, mode, contextS, audio }));
}
