import { ProviderTaskResult, VideoUpscaler } from "./types";

// ByteDance Video Upscaler (vCube) hosted on fal.ai — ByteDance's own
// production super-resolution model, pay-per-use, commercially licensed via
// fal. Queue API: submit -> poll status -> fetch result.
// TODO(validate): confirm input field names (upscale_factor / target
// resolution) against the live endpoint during the validation run.

const MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const QUEUE = "https://queue.fal.run";

function headers() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not configured");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

export class FalUpscaler implements VideoUpscaler {
  async submitUpscale(videoUrl: string, factor: 2 | 4): Promise<string> {
    const res = await fetch(`${QUEUE}/${MODEL}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        video_url: videoUrl,
        upscale_factor: factor,
        target_resolution: factor === 4 ? "4k" : "1080p",
      }),
    });
    if (!res.ok) {
      throw new Error(`upstream upscale submit failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { request_id: string };
    return data.request_id;
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const status = await fetch(`${QUEUE}/${MODEL}/requests/${taskId}/status`, {
      headers: headers(),
    });
    if (!status.ok) throw new Error(`upstream poll failed: ${status.status}`);
    const s = (await status.json()) as { status: string; error?: string };
    if (s.status === "COMPLETED") {
      const result = await fetch(`${QUEUE}/${MODEL}/requests/${taskId}`, { headers: headers() });
      if (!result.ok) throw new Error(`upstream result fetch failed: ${result.status}`);
      const data = (await result.json()) as { video?: { url?: string } };
      return { status: "succeeded", videoUrl: data.video?.url };
    }
    if (s.status === "FAILED" || s.status === "ERROR") {
      return { status: "failed", error: s.error || "upscale failed" };
    }
    return { status: "running" };
  }
}
