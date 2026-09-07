import {
  GenerationRequest,
  ProviderTaskResult,
  VideoGenerator,
} from "./types";

// BytePlus ModelArk async video generation client (official Seedance source).
// Endpoint shape per ModelArk docs: create a generation task, then poll it.
// Exact model id / request fields will be confirmed against a live key during
// the validation run; this client is env-gated and unused until then.

const BASE =
  process.env.BYTEPLUS_API_BASE ||
  "https://ark.ap-southeast.bytepluses.com/api/v3";

// Product model id -> ModelArk model id (env-overridable; the 2.0 id is
// confirmed during the validation run).
function upstreamModel(productModel: string): string {
  if (productModel === "seedance-2.0") {
    return process.env.BYTEPLUS_SEEDANCE_20_MODEL || "seedance-2-0";
  }
  return process.env.BYTEPLUS_SEEDANCE_25_MODEL || "dreamina-seedance-2-5-260628";
}

function headers() {
  const key = process.env.BYTEPLUS_API_KEY;
  if (!key) throw new Error("BYTEPLUS_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export class BytePlusGenerator implements VideoGenerator {
  async submitGeneration(req: GenerationRequest): Promise<string> {
    // ModelArk takes generation controls as text flags appended to the
    // prompt; images carry a role (first/last frame anchoring, or free
    // reference).
    const flags = [
      `--resolution ${req.resolution}`,
      `--duration ${req.durationS}`,
      `--ratio ${req.aspect}`,
      `--watermark false`,
      ...(req.seed !== undefined ? [`--seed ${req.seed}`] : []),
      ...(req.cameraFixed ? ["--camerafixed true"] : []),
    ];
    const content: Record<string, unknown>[] = [
      { type: "text", text: `${req.prompt} ${flags.join(" ")}` },
    ];
    // Continuation: the source clip goes in as the video to extend.
    // TODO(validate): confirm the ModelArk role/field names for extend and
    // reference inputs against a live key during the validation run.
    if (req.sourceVideoUrl) {
      content.push({ type: "video_url", video_url: { url: req.sourceVideoUrl }, role: "extend" });
    }
    for (const input of req.inputs ?? []) {
      if (input.role === "reference_video") {
        content.push({ type: "video_url", video_url: { url: input.url }, role: "reference_video" });
      } else if (input.role === "reference_audio") {
        content.push({ type: "audio_url", audio_url: { url: input.url }, role: "reference_audio" });
      } else {
        content.push({
          type: "image_url",
          image_url: { url: input.url },
          role: input.role === "reference" ? "reference_image" : input.role,
        });
      }
    }
    const body = { model: upstreamModel(req.model), content };
    const res = await fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`upstream generation submit failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const res = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, {
      headers: headers(),
    });
    if (!res.ok) {
      throw new Error(`upstream poll failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      content?: { video_url?: string };
      error?: { message?: string };
    };
    if (data.status === "succeeded") {
      return { status: "succeeded", videoUrl: data.content?.video_url };
    }
    if (data.status === "failed" || data.status === "cancelled") {
      return { status: "failed", error: data.error?.message || "generation failed" };
    }
    return { status: "running" };
  }
}
