import { ProviderTaskResult, VideoUpscaler } from "./types";

// reAPI Topaz Video Upscaler client. Request shape per reAPI docs:
// POST /api/v1/videos/generations with model topaz-video-upscaler, then
// GET /api/v1/tasks/:id until completed.

const BASE = process.env.REAPI_API_BASE || "https://reapi.ai/api/v1";

function headers() {
  const key = process.env.REAPI_API_KEY;
  if (!key) throw new Error("REAPI_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export class ReapiUpscaler implements VideoUpscaler {
  async submitUpscale(videoUrl: string, factor: 2 | 4): Promise<string> {
    const res = await fetch(`${BASE}/videos/generations`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: "topaz-video-upscaler",
        video_url: videoUrl,
        upscale_factor: String(factor),
      }),
    });
    if (!res.ok) {
      throw new Error(`upstream upscale submit failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: headers() });
    if (!res.ok) {
      throw new Error(`upstream poll failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      output?: { video_urls?: string[] };
      error?: { message?: string };
    };
    if (data.status === "completed") {
      return { status: "succeeded", videoUrl: data.output?.video_urls?.[0] };
    }
    if (data.status === "failed") {
      return { status: "failed", error: data.error?.message || "upscale failed" };
    }
    return { status: "running" };
  }
}
