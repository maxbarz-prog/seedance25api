import { NextResponse } from "next/server";
import { MODEL_IDS, MODELS, NATIVE_1080P_MODEL_IDS } from "@/lib/config";

// The models actually on sale, with what each one can do. Public and cheap:
// it reads the registry, nothing else.
//
// Having this as an endpoint means anything checking the deployed site — the
// stage smoke check, a future client — asks the site what it offers instead
// of carrying its own copy of the list, which drifts the moment a model is
// added or withdrawn.
export async function GET() {
  return NextResponse.json({
    models: MODEL_IDS.map((id) => ({
      id,
      label: MODELS[id].label,
      maxDurationS: MODELS[id].maxDurationS,
      accepts: MODELS[id].accepts,
      native1080p: (NATIVE_1080P_MODEL_IDS as readonly string[]).includes(id),
      // Only some models price by soundtrack; the quote endpoint takes an
      // audio flag for those.
      audioPriced: "audio" in MODELS[id],
    })),
  });
}
