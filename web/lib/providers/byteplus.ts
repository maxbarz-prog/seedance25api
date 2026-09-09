import { MODELS, ModelId } from "../config";
import {
  GenerationRequest,
  ProviderBusyError,
  ProviderTaskResult,
  VideoGenerator,
} from "./types";

// 429 is the documented answer when we exceed tasks-created-per-minute; 5xx
// is a wobble at their end. Neither means this job is bad.
function busy(status: number): boolean {
  return status === 429 || status >= 500;
}

// BytePlus ModelArk async video generation client (official Seedance source).
// Endpoint shape: POST /contents/generations/tasks to create, then GET
// /contents/generations/tasks/{id} to poll.
//
// Request shape confirmed against the ModelArk schema as used by the
// open-source seedance-cli (paperfoot/seedance-cli, exercised daily against
// the live API):
//   - generation controls (resolution, ratio, duration, seed, generate_audio,
//     watermark, return_last_frame) are TOP-LEVEL body fields, not prompt
//     text flags;
//   - `content` items carry `type` + `image_url`/`video_url`/`audio_url`
//     ({ url }) + `role`; image roles are first_frame | last_frame |
//     reference_image; video role is reference_video; audio role is
//     reference_audio. Reference videos must be fetchable URLs.
//   - There is no dedicated "extend" role. Seedance 2.5 classifies a request
//     as a video-extension task from a reference_video plus extend/continue
//     intent in the prompt, and that task type requires ratio=adaptive
//     (violations fail asynchronously with InvalidParameter.TaskTypeConstraint).
//   - Terminal statuses: succeeded | failed | cancelled | expired. A finished
//     task carries content.video_url, content.last_frame_url (when
//     return_last_frame was set) and usage.total_tokens (billing basis).
//
// Confirmed on the live key 2026-09-08 (scripts/provider-check.mjs):
//   - ModelArk accepts resolution "1080p" on dreamina-seedance-2-5-260628
//     (the launch-time 720p ceiling is gone), so 1080p is sent as-is;
//   - `camera_fixed` is rejected at submit for Seedance 2.5 text-to-video
//     ("not supported for model dreamina-seedance-2-5 in t2v, must be
//     empty"), so submitGeneration drops it and resubmits once on that
//     specific 400 instead of failing the job;
//   - extension `duration` semantics: see docs/NEXT.md.

const BASE =
  process.env.BYTEPLUS_API_BASE ||
  "https://ark.ap-southeast.bytepluses.com/api/v3";

// Product model id -> ModelArk model id. The mapping lives in the model
// registry (lib/config.ts) so adding a model is a single edit there; each id
// stays individually env-overridable for the day the provider bumps a version
// suffix, e.g. BYTEPLUS_SEEDANCE_2_0_FAST_MODEL.
function upstreamModel(productModel: string): string {
  const envName =
    "BYTEPLUS_" + productModel.toUpperCase().replace(/[-.]/g, "_") + "_MODEL";
  const override = process.env[envName];
  if (override) return override;
  const entry = MODELS[productModel as ModelId];
  if (!entry) throw new Error(`unknown model ${productModel}`);
  return entry.upstream;
}

function headers() {
  const key = process.env.BYTEPLUS_API_KEY;
  if (!key) throw new Error("BYTEPLUS_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

const IMAGE_ROLE: Record<string, string> = {
  reference: "reference_image",
  first_frame: "first_frame",
  last_frame: "last_frame",
};

export function buildGenerationBody(req: GenerationRequest): Record<string, unknown> {
  const extending = !!req.sourceVideoUrl;
  const prompt = extending
    ? `Extend the video, continuing seamlessly from its final frame. ${req.prompt}`.trim()
    : req.prompt;
  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  // Continuation: the source clip goes in as a reference video; the
  // extend intent in the prompt selects the extension task type.
  if (req.sourceVideoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: req.sourceVideoUrl },
      role: "reference_video",
    });
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
        role: IMAGE_ROLE[input.role] ?? "reference_image",
      });
    }
  }
  return {
    model: upstreamModel(req.model),
    content,
    resolution: req.resolution,
    // Extension tasks must run at the source clip's own ratio.
    ratio: extending ? "adaptive" : req.aspect,
    duration: req.durationS,
    generate_audio: req.audio,
    watermark: false,
    // Last frame of the output (full-res, unwatermarked) is the official
    // chaining primitive; kept as a fallback for continuation.
    return_last_frame: true,
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
    ...(req.cameraFixed ? { camera_fixed: true } : {}),
  };
}

export class BytePlusGenerator implements VideoGenerator {
  async submitGeneration(req: GenerationRequest): Promise<string> {
    const body = buildGenerationBody(req);
    let res = await this.post(body);
    if (!res.ok) {
      if (busy(res.status)) {
        throw new ProviderBusyError(`generation submit deferred: ${res.status}`);
      }
      const text = await res.text();
      // Some model/task combinations refuse camera_fixed outright (Seedance
      // 2.5 text-to-video does). Drop the flag and retry once rather than
      // failing the job; the flag is a preference, not a requirement.
      if (res.status === 400 && "camera_fixed" in body && text.includes("camera_fixed")) {
        delete body.camera_fixed;
        res = await this.post(body);
        if (!res.ok) {
          throw new Error(`upstream generation submit failed: ${res.status} ${await res.text()}`);
        }
      } else {
        throw new Error(`upstream generation submit failed: ${res.status} ${text}`);
      }
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  private post(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
  }

  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const res = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, {
      headers: headers(),
    });
    if (!res.ok) {
      if (busy(res.status)) throw new ProviderBusyError(`poll deferred: ${res.status}`);
      throw new Error(`upstream poll failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      content?: { video_url?: string; last_frame_url?: string };
      usage?: { completion_tokens?: number; total_tokens?: number };
      error?: { code?: string; message?: string };
    };
    if (data.status === "queued") return { status: "running", phase: "queued" };
    if (data.status === "succeeded") {
      return {
        status: "succeeded",
        videoUrl: data.content?.video_url,
        lastFrameUrl: data.content?.last_frame_url,
        tokens: data.usage?.total_tokens ?? data.usage?.completion_tokens,
      };
    }
    if (data.status === "failed" || data.status === "cancelled" || data.status === "expired") {
      const msg = [data.error?.code, data.error?.message].filter(Boolean).join(": ");
      return { status: "failed", error: msg || `generation ${data.status}` };
    }
    return { status: "running", phase: "running" };
  }
}
