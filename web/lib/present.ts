import { Job } from "./db";
import { readUrl } from "./storage";

// Shape a job for API responses: storage keys and provider task ids never
// leave the server; a fetchable video URL is resolved at read time.
export async function presentJob(job: Job) {
  const { video_url, image_keys, provider_task_id, ...rest } = job;
  void image_keys;
  void provider_task_id;
  return { ...rest, video_url: job.status === "ready" ? await readUrl(video_url) : null };
}
