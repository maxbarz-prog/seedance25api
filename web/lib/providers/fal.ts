import { ProviderBusyError, ProviderTaskResult, VideoUpscaler } from "./types";

// fal queues anything over our concurrency limit rather than rejecting it, so
// a 429 here is a request-rate limit and a 5xx is a wobble; both are worth
// retrying rather than failing a paid job.
function busy(status: number): boolean {
  return status === 429 || status >= 500;
}

// ByteDance Video Upscaler (vCube) hosted on fal.ai — ByteDance's own
// production super-resolution model, pay-per-use, commercially licensed via
// fal. Queue API: submit -> poll status -> fetch result.
//
// Input schema (fal model page, fal-ai/bytedance-upscaler/upscale/video):
// `video_url` (mp4/mov/webm/m4v/gif) and `target_resolution` in
// "1080p" | "2K" | "4K". Published price per source second at 30fps:
// 1080p $0.0072, 2K $0.0144, 4K $0.0288 (60fps doubles each).

const MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const QUEUE = "https://queue.fal.run";
// Submissions go to the full model path, but the queue's status and result
// endpoints are addressed by the app id (the first two path segments).
// Confirmed live 2026-09-08: polling under the full path answers 405.
const APP_ID = MODEL.split("/").slice(0, 2).join("/");

function headers() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not configured");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

export function targetResolution(factor: 2 | 4): "1080p" | "4K" {
  return factor === 4 ? "4K" : "1080p";
}

export class FalUpscaler implements VideoUpscaler {
  async submitUpscale(videoUrl: string, factor: 2 | 4): Promise<string> {
    const res = await fetch(`${QUEUE}/${MODEL}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        video_url: videoUrl,
        target_resolution: targetResolution(factor),
      }),
    });
    if (!res.ok) {
      if (busy(res.status)) {
        throw new ProviderBusyError(`upscale submit deferred: ${res.status}`);
      }
      throw new Error(`upstream upscale submit failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { request_id: string };
    return data.request_id;
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const status = await fetch(`${QUEUE}/${APP_ID}/requests/${taskId}/status`, {
      headers: headers(),
    });
    if (!status.ok) {
      if (busy(status.status)) throw new ProviderBusyError(`poll deferred: ${status.status}`);
      throw new Error(`upstream poll failed: ${status.status}`);
    }
    const s = (await status.json()) as { status: string; error?: string };
    if (s.status === "COMPLETED") {
      const result = await fetch(`${QUEUE}/${APP_ID}/requests/${taskId}`, { headers: headers() });
      if (!result.ok) {
        if (busy(result.status)) {
          throw new ProviderBusyError(`result fetch deferred: ${result.status}`);
        }
        throw new Error(`upstream result fetch failed: ${result.status}`);
      }
      const data = (await result.json()) as { video?: { url?: string } };
      return { status: "succeeded", videoUrl: data.video?.url };
    }
    if (s.status === "FAILED" || s.status === "ERROR") {
      return { status: "failed", error: s.error || "upscale failed" };
    }
    return { status: "running" };
  }
}
