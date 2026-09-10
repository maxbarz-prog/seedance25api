import { addLedger, claimJob, Job, jobById, jobsInFlight, updateJob, userById } from "./db";
import { generator, upscaler } from "./providers";
import { ProviderBusyError } from "./providers/types";
import {
  deleteObject,
  readUrl,
  storageEnabled,
  storeBuffer,
  storeVideoBuffer,
  storeVideoFromUrl,
} from "./storage";
import { sendEmail } from "./email";
import { EXTEND_CONTEXT_S, SITE_DOMAIN, SITE_NAME } from "./config";
import { concat, durationOf, trimTail } from "./video";
import { checkMargin, currentHalt } from "./money";

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
      // A money halt stops new spend. Jobs already with a provider keep
      // polling below: that money is gone either way, and abandoning them
      // would mean paying for a video nobody receives.
      const stop = await currentHalt();
      if (stop) {
        console.warn(`job ${id}: held, money halt in force (${stop.reason})`);
        return job;
      }
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
        if (!sourceVideoUrl || !source) throw new Error("extend: source video unavailable");
        // Only the tail of the source goes up as the reference video: the
        // provider bills every second of it as input, and the quote assumed
        // EXTEND_CONTEXT_S. Any trimming problem falls back to the full clip.
        if (source.duration_s > EXTEND_CONTEXT_S && storageEnabled()) {
          try {
            const res = await fetch(sourceVideoUrl);
            if (!res.ok) throw new Error(`source fetch ${res.status}`);
            const tail = await trimTail(Buffer.from(await res.arrayBuffer()), EXTEND_CONTEXT_S);
            if (tail) {
              const key = extendContextKey(job);
              await storeBuffer(key, tail, "video/mp4");
              sourceVideoUrl = (await readUrl(key)) ?? sourceVideoUrl;
            } else {
              console.warn(`job ${id}: ffmpeg unavailable, sending the full ${source.duration_s}s source`);
            }
          } catch (err) {
            console.warn(`job ${id}: tail trim failed, sending the full source:`, err);
          }
        }
      }
      let taskId: string;
      try {
        taskId = await generator().submitGeneration({
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
      } catch (err) {
        // Rate-limited on task creation: put the job back in the queue so the
        // next tick retries it, rather than failing and refunding work the
        // member still wants.
        if (err instanceof ProviderBusyError) {
          await claimJob(id, "generating", "queued");
          console.warn(`job ${id}: generation deferred, provider busy: ${err.message}`);
          return jobById(id);
        }
        throw err;
      }
      // A freshly submitted task sits in the provider's queue until a slot
      // frees up, so start there rather than claiming to be rendering.
      await updateJob(id, {
        provider_task_id: taskId,
        provider_phase: "queued",
        // Start of the clock for the per-model speed stats.
        provider_submitted_at: Date.now(),
      });
    } else if (job.status === "generating") {
      if (!job.provider_task_id) return job; // claimed by someone mid-submit
      const result = await generator().pollTask(job.provider_task_id);
      // Only write when it changes: this runs every minute per in-flight job.
      if (result.phase && result.phase !== job.provider_phase) {
        await updateJob(id, {
          provider_phase: result.phase,
          // First sighting of "running" is when they picked the task up.
          // Everything before it was queueing, which is the provider being
          // busy rather than the model being slow.
          ...(result.phase === "running" && !job.provider_started_at
            ? { provider_started_at: Date.now() }
            : {}),
        });
      }
      if (result.status === "succeeded") {
        if (!job.provider_done_at) await updateJob(id, { provider_done_at: Date.now() });
        if (result.tokens !== undefined) {
          // Billing basis for the measured rates (see docs/NEXT.md), and the
          // input to the margin check: this is what the provider actually
          // charged, not what we predicted it would.
          console.log(
            `job ${id} generation usage: ${result.tokens} tokens for ${job.duration_s}s at ${job.mode}`
          );
          // Never let a margin problem fail a job the member has paid for and
          // the provider has already rendered.
          await checkMargin(job, result.tokens).catch((e) =>
            console.error(`margin check failed for job ${id}:`, e)
          );
        }
        if (job.mode === "native-1080p") {
          if (!(await claimJob(id, "generating", "ready"))) return jobById(id);
          await finalize(job, result.videoUrl!);
        } else {
          if (!(await claimJob(id, "generating", "upscaling"))) return jobById(id);
          let upTask: string;
          try {
            upTask = await upscaler().submitUpscale(
              result.videoUrl!,
              job.upscale_factor === 4 ? 4 : 2
            );
          } catch (err) {
            // Same deferral as generation, but back to "generating": the
            // provider task id still points at the finished source clip, so
            // the next tick re-reads it and retries the upscale submit.
            if (err instanceof ProviderBusyError) {
              await claimJob(id, "upscaling", "generating");
              console.warn(`job ${id}: upscale deferred, provider busy: ${err.message}`);
              return jobById(id);
            }
            throw err;
          }
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
    // A busy provider is not a bad job: leave it where it is and let the next
    // tick (or the stale sweep, eventually) deal with it.
    if (err instanceof ProviderBusyError) {
      console.warn(`job ${id}: provider busy, retrying next tick: ${err.message}`);
      return jobById(id);
    }
    console.error(`pipeline error for job ${id}:`, err);
    const now = await jobById(id);
    if (now && now.status !== "failed") {
      await fail(now, String(err));
    }
  }

  return jobById(id);
}

// How many jobs the cron advances at once. Jobs are independent and every
// transition that spends money claims atomically, so this is safe to raise;
// the ceiling that matters is the provider's, not ours. Both providers queue
// work beyond their concurrency limit and only rate-limit task *creation*,
// which is handled by deferring on ProviderBusyError above.
const CONCURRENCY = Math.max(1, Number(process.env.PIPELINE_CONCURRENCY || 12));

// Cron entry point: push every in-flight job one step. Serial advancement
// used to cap the whole system at a few dozen concurrent jobs, because one
// slow finalize (download the output, copy it to S3, stitch an extension)
// blocked every job behind it inside a single 120-second invocation.
export async function advanceAll(): Promise<{ scanned: number; concurrency: number }> {
  const jobs = await jobsInFlight();
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      // advanceJob already contains its own error handling; this guard is
      // just so one unexpected throw cannot take the whole batch down.
      await advanceJob(jobs[i].id).catch((err) =>
        console.error(`advanceAll: job ${jobs[i].id} threw:`, err)
      );
    }
  }
  const workers = Math.min(CONCURRENCY, jobs.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return { scanned: jobs.length, concurrency: workers };
}

// Join an extension's source clip to the continuation the provider returned.
// Returns null on any problem, so the job still delivers the continuation
// alone rather than failing after the member has been charged.
async function stitchWithSource(
  job: Job,
  providerUrl: string
): Promise<{ video: Buffer; durationS: number | null } | null> {
  if (!job.source_job_id || !storageEnabled()) return null;
  try {
    const source = await jobById(job.source_job_id);
    const sourceUrl = await readUrl(source?.video_url);
    if (!sourceUrl) {
      console.warn(`job ${job.id}: source video unavailable, delivering the continuation alone`);
      return null;
    }
    const [a, b] = await Promise.all([
      fetch(sourceUrl).then(async (r) => {
        if (!r.ok) throw new Error(`source fetch ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }),
      fetch(providerUrl).then(async (r) => {
        if (!r.ok) throw new Error(`continuation fetch ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    ]);
    const video = await concat([a, b]);
    if (!video) {
      console.warn(`job ${job.id}: concat unavailable, delivering the continuation alone`);
      return null;
    }
    return { video, durationS: await durationOf(video) };
  } catch (err) {
    console.warn(`job ${job.id}: stitching failed, delivering the continuation alone:`, err);
    return null;
  }
}

// Temporary trimmed reference clip for an extension job; removed once the
// job settles.
function extendContextKey(job: Job): string {
  return `tmp/${job.user_id}/${job.id}-context.mp4`;
}

async function cleanupContext(job: Job) {
  if (job.kind !== "extend") return;
  await deleteObject(extendContextKey(job)).catch((e) => console.warn("context cleanup failed:", e));
}

// Status is already "ready" (claimed) by the time we get here; copying the
// output into our own storage is the last step before the row is complete.
async function finalize(job: Job, providerUrl: string) {
  await cleanupContext(job);
  try {
    // An extension comes back as the continuation only. Members asked for a
    // longer video, so join it to the source before it lands in the library.
    const joined = job.kind === "extend" ? await stitchWithSource(job, providerUrl) : null;
    const stored = joined
      ? await storeVideoBuffer(job.user_id, job.id, joined.video)
      : await storeVideoFromUrl(job.user_id, job.id, providerUrl);
    await updateJob(job.id, {
      video_url: stored.key,
      size_bytes: stored.bytes || job.duration_s * 500_000,
      // The delivered clip is now source + continuation, so the row should
      // say how long the video actually is. The charge is unaffected: it was
      // quoted on the seconds added, which is what the provider billed us for.
      ...(joined?.durationS ? { duration_s: Math.round(joined.durationS) } : {}),
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
  await cleanupContext(job);
  await updateJob(job.id, { status: "failed", error: GENERIC_FAILURE, provider_task_id: null });
  await addLedger(job.user_id, job.quote_credits, "refund", {
    jobId: job.id,
    memo: "Automatic refund: generation failed",
  });
}
