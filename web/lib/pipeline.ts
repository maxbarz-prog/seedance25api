import { addLedger, Job, jobById, updateJob } from "./db";
import { generator, upscaler } from "./providers";

// Job pipeline: queued -> generating -> [upscaling ->] ready | failed.
// Advancement is lazy — advanceJob() is called whenever a job is read — so
// dev needs no worker process. In production this same logic maps 1:1 onto a
// Step Functions state machine and this module becomes its shim.

const BYTES_PER_OUTPUT_SECOND = 500_000; // 1080p H.264 estimate for quota math

// Upstream failure text must never reach users (it can name vendors).
const GENERIC_FAILURE =
  "Generation failed and your credits were refunded. Please try again.";

export async function advanceJob(id: string): Promise<Job | undefined> {
  let job = await jobById(id);
  if (!job) return undefined;

  try {
    if (job.status === "queued") {
      const taskId = await generator().submitGeneration({
        prompt: job.prompt,
        model: job.model,
        durationS: job.duration_s,
        aspect: job.aspect,
        audio: !!job.audio,
        resolution: job.mode === "native-1080p" ? "1080p" : "480p",
      });
      await updateJob(id, { status: "generating", provider_task_id: taskId });
    } else if (job.status === "generating") {
      const result = await generator().pollTask(job.provider_task_id!);
      if (result.status === "succeeded") {
        if (job.mode === "native-1080p") {
          await finalize(id, job, result.videoUrl!);
        } else {
          const upTask = await upscaler().submitUpscale(
            result.videoUrl!,
            job.upscale_factor === 4 ? 4 : 2
          );
          await updateJob(id, { status: "upscaling", provider_task_id: upTask });
        }
      } else if (result.status === "failed") {
        await fail(id, job, result.error);
      }
    } else if (job.status === "upscaling") {
      const result = await upscaler().pollTask(job.provider_task_id!);
      if (result.status === "succeeded") {
        await finalize(id, job, result.videoUrl!);
      } else if (result.status === "failed") {
        await fail(id, job, result.error);
      }
    }
  } catch (err) {
    console.error(`pipeline error for job ${id}:`, err);
    job = await jobById(id);
    if (job && job.status !== "failed" && job.status !== "ready") {
      await fail(id, job, String(err));
    }
  }

  return jobById(id);
}

async function finalize(id: string, job: Job, videoUrl: string) {
  // Production copies the output into our own S3 before exposing a URL; in
  // mock mode the provider URL is already safe to show.
  await updateJob(id, {
    status: "ready",
    video_url: videoUrl,
    size_bytes: job.duration_s * BYTES_PER_OUTPUT_SECOND,
    provider_task_id: null,
  });
}

async function fail(id: string, job: Job, internalError?: string) {
  if (internalError) console.error(`job ${id} failed upstream:`, internalError);
  await updateJob(id, { status: "failed", error: GENERIC_FAILURE, provider_task_id: null });
  await addLedger(job.user_id, job.quote_credits, "refund", {
    jobId: id,
    memo: "Automatic refund: generation failed",
  });
}
