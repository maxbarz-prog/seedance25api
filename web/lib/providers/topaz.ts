import { ProviderTaskResult, VideoUpscaler } from "./types";

// Topaz Labs direct video API client (developer.topazlabs.com).
// Async flow: create a request describing the source and desired output,
// deliver the source video, then poll status until the enhanced render is
// ready. Exact request/response field names will be verified against a live
// key during the validation run; this client is env-gated until then.

const BASE = process.env.TOPAZ_API_BASE || "https://api.topazlabs.com";

function headers() {
  const key = process.env.TOPAZ_API_KEY;
  if (!key) throw new Error("TOPAZ_API_KEY not configured");
  return {
    "X-API-Key": key,
    "Content-Type": "application/json",
  };
}

export class TopazUpscaler implements VideoUpscaler {
  async submitUpscale(videoUrl: string, factor: 2 | 4): Promise<string> {
    const res = await fetch(`${BASE}/video/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        source: { url: videoUrl },
        output: {
          resolution: factor === 4 ? "4k" : "1080p",
          frameRate: "source",
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`upstream upscale submit failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { request_id?: string; id?: string };
    const id = data.request_id ?? data.id;
    if (!id) throw new Error("upstream upscale submit returned no request id");
    return id;
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const res = await fetch(`${BASE}/video/${taskId}/status`, { headers: headers() });
    if (!res.ok) {
      throw new Error(`upstream poll failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      download_url?: string;
      output?: { url?: string };
      error?: { message?: string };
    };
    const s = (data.status || "").toLowerCase();
    if (s === "complete" || s === "completed" || s === "succeeded") {
      return { status: "succeeded", videoUrl: data.download_url ?? data.output?.url };
    }
    if (s === "failed" || s === "error" || s === "cancelled") {
      return { status: "failed", error: data.error?.message || "upscale failed" };
    }
    return { status: "running" };
  }
}
