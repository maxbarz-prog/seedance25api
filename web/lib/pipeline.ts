import { addLedger, claimJob, Job, jobById, jobsInFlight, updateJob, userById } from "./db";
import { generator, upscaler } from "./providers";
import { readUrl, storeVideoFromUrl } from "./storage";
import { sendEmail } from "./email";
import { SITE_DOMAIN, SITE_NAME } from "./config";

// Job pipeline: queued -> generating -> [upscaling ->] ready | failed.
//
// advanceJob() is safe to call from two places at once — user polls and the
// minute cron (lib/pipeline.ts:advanceAll) — because every transition that
// spends money first claims the job with an atomic status swap. Whoever
// loses the claim simply returns the current row.

// Upstream failure text must never reach users (it can name vendors).
const GENERIC_FAILURE =
  "Generation failed and your credits were refunded. Please try again.";

// Jobs stuck in flight past this are failed and refunded.
const STALE_MS = 45 * 60 * 1000;

export async function advanceJob(id: string): Promise<Job | undefined> {
  const job = await jobById(id);
  if (!job) return undefined;
  if (job.status === "ready" || job.status === "failed") return job;

  try {
    if (Date.now() - job.created_at > STALE_MS) {
      await fail(job, "stale: exceeded pipeline time budget");
      return jobById(id);
    }

    if (job.status === "queued") {
      if (!(await claimJob(id, "queued", "generating"))) return jobById(id);
      type Role = "reference" | "first_frame" | "last_frame" | "reference_video" | "reference_audio";
      const declared: { key: string; role: Role }[] = job.image_keys ? JSON.parse(job.image_keys) : [];
      const inputs = (
        await Promise.all(
          declared.map(async (i) => {
            const url = await readUrl(i.key);
            return url ? { url, role: i.role } : null;
          })
        )
      ).filter((i): i is { url: string; role: Role } => !!i);
      let sourceVideoUrl: string | undefined;
      if (job.kind === "extend" && job.source_job_id) {
        const source = await jobById(job.source_job_id);
        sourceVideoUrl = (await readUrl(source?.video_url)) ?? undefined;
        if (!sourceVideoUrl) throw new Error("extend: source video unavailable");
      }
      const taskId = await generator().submitGeneration({
        prompt: job.prompt,
        model: job.model,
        durationS: job.duration_s,
        aspect: job.aspect,
        audio: !!job.audio,
        resolution: job.mode === "native-1080p" ? "1080p" : "480p",
        inputs,
        sourceVideoUrl,
        seed: job.seed ?? undefined,
        cameraFixed: !!job.camera_fixed,
      });
      await updateJob(id, { provider_task_id: taskId });
    } else if (job.status === "generating") {
      if (!job.provider_task_id) return job; // claimed by someone mid-submit
      const result = await generator().pollTask(job.provider_task_id);
      if (result.status === "succeeded") {
        if (job.mode === "native-1080p") {
          if (!(await claimJob(id, "generating", "ready"))) return jobById(id);
          await finalize(job, result.videoUrl!);
        } else {
          if (!(await claimJob(id, "generating", "upscaling"))) return jobById(id);
          const upTask = await upscaler().submitUpscale(
            result.videoUrl!,
            job.upscale_factor === 4 ? 4 : 2
          );
          await updateJob(id, { provider_task_id: upTask });
        }
      } else if (result.status === "failed") {
        await fail(job, result.error);
      }
    } else if (job.status === "upscaling") {
      if (!job.provider_task_id) return job;
      const result = await upscaler().pollTask(job.provider_task_id);
      if (result.status === "succeeded") {
        if (!(await claimJob(id, "upscaling", "ready"))) return jobById(id);
        await finalize(job, result.videoUrl!);
      } else if (result.status === "failed") {
        await fail(job, result.error);
      }
    }
  } catch (err) {
    console.error(`pipeline error for job ${id}:`, err);
    const now = await jobById(id);
    if (now && now.status !== "failed") {
      await fail(now, String(err));
    }
  }

  return jobById(id);
}

// Cron entry point: push every in-flight job one step.
export async function advanceAll(): Promise<{ scanned: number }> {
  const jobs = await jobsInFlight();
  for (const j of jobs) {
    await advanceJob(j.id);
  }
  return { scanned: jobs.length };
}

// Status is already "ready" (claimed) by the time we get here; copying the
// output into our own storage is the last step before the row is complete.
async function finalize(job: Job, providerUrl: string) {
  try {
    const stored = await storeVideoFromUrl(job.user_id, job.id, providerUrl);
    await updateJob(job.id, {
      video_url: stored.key,
      size_bytes: stored.bytes || job.duration_s * 500_000,
      provider_task_id: null,
      error: null,
    });
  } catch (err) {
    console.error(`storing output for job ${job.id} failed:`, err);
    await updateJob(job.id, { status: "failed" });
    await fail({ ...job, status: "failed" }, String(err));
    return;
  }
  const user = await userById(job.user_id);
  if (user) {
    await sendEmail(
      user.email,
      `Your ${SITE_NAME} video is ready`,
      `Your ${job.duration_s}s video is ready:\nhttps://${SITE_DOMAIN}/jobs/${job.id}\n\n“${job.prompt.slice(0, 200)}”`
    ).catch((e) => console.error("ready email failed:", e));
  }
}

async function fail(job: Job, internalError?: string) {
  if (internalError) console.error(`job ${job.id} failed upstream:`, internalError);
  await updateJob(job.id, { status: "failed", error: GENERIC_FAILURE, provider_task_id: null });
  await addLedger(job.user_id, job.quote_credits, "refund", {
    jobId: job.id,
    memo: "Automatic refund: generation failed",
  });
}
