import {
  GenerationRequest,
  ProviderTaskResult,
  VideoGenerator,
} from "./types";

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
// Still to confirm on a live key (see docs/NEXT.md): whether `camera_fixed`
// is honoured as a top-level field, whether extension `duration` means the
// added length or the total, and whether ModelArk accepts 1080p on the 2.5
// model id. Seedance 2.5 launched with a 720p ceiling but gained native
// 1080p on partner platforms in late August 2026, so 1080p is sent as-is.

const BASE =
  process.env.BYTEPLUS_API_BASE ||
  "https://ark.ap-southeast.bytepluses.com/api/v3";

// Product model id -> ModelArk model id (env-overridable).
function upstreamModel(productModel: string): string {
  if (productModel === "seedance-2.0") {
    return process.env.BYTEPLUS_SEEDANCE_20_MODEL || "dreamina-seedance-2-0-260128";
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
    const res = await fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildGenerationBody(req)),
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
      content?: { video_url?: string; last_frame_url?: string };
      usage?: { completion_tokens?: number; total_tokens?: number };
      error?: { code?: string; message?: string };
    };
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
    return { status: "running" };
  }
}
