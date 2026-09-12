import { Job } from "./db";
import { readUrl } from "./storage";

// Shape a job for API responses: storage keys and provider task ids never
// leave the server; fetchable URLs are resolved at read time.
export async function presentJob(job: Job) {
  const { video_url, poster_key, image_keys, provider_task_id, ...rest } = job;
  void image_keys;
  void provider_task_id;
  const ready = job.status === "ready";
  // Both resolved together — the poster is what a list renders and the video is
  // what a player loads, and a list that has to ask for each poster separately
  // is back to being slow for a different reason.
  const [video, poster] = await Promise.all([
    ready ? readUrl(video_url) : null,
    ready ? readUrl(poster_key) : null,
  ]);
  return { ...rest, video_url: video, poster_url: poster };
}
