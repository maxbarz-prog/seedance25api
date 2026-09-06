import { NextRequest, NextResponse } from "next/server";
import { quote } from "@/lib/pricing";
import { MAX_DURATION_S, MIN_DURATION_S } from "@/lib/config";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const durationS = Number(p.get("duration") || 5);
  const mode = p.get("mode") === "native-1080p" ? "native-1080p" : "upscaled-1080p";
  const factor = p.get("factor") === "4" ? 4 : 2;
  if (
    !Number.isInteger(durationS) ||
    durationS < MIN_DURATION_S ||
    durationS > MAX_DURATION_S
  ) {
    return NextResponse.json({ error: "Invalid duration." }, { status: 400 });
  }
  return NextResponse.json(quote({ durationS, mode, upscaleFactor: factor }));
}
