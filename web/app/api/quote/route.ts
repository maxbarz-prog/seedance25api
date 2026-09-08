import { NextRequest, NextResponse } from "next/server";
import { quote } from "@/lib/pricing";
import { DEFAULT_MODEL, EXTEND_CONTEXT_S, MIN_DURATION_S, MODELS, ModelId } from "@/lib/config";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const modelParam = p.get("model") ?? DEFAULT_MODEL;
  if (!(modelParam in MODELS)) {
    return NextResponse.json({ error: "Unknown model." }, { status: 400 });
  }
  const model = modelParam as ModelId;
  const durationS = Number(p.get("duration") || 5);
  const mode = p.get("mode") === "native-1080p" ? "native-1080p" : "upscaled-1080p";
  const factor = p.get("factor") === "4" ? 4 : 2;
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
  return NextResponse.json(quote({ model, durationS, mode, upscaleFactor: factor, contextS }));
}
