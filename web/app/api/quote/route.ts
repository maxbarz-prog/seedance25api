import { NextRequest, NextResponse } from "next/server";
import { quote } from "@/lib/pricing";
import { DEFAULT_MODEL, MIN_DURATION_S, MODELS, ModelId } from "@/lib/config";

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
  return NextResponse.json(quote({ model, durationS, mode, upscaleFactor: factor }));
}
