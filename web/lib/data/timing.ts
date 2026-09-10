import { Job, ModelTiming } from "./types";

// Per-model generation speed, measured from finished jobs.
//
// The useful unit is seconds of waiting per second of video, not seconds per
// job: a 15 s clip legitimately takes longer than a 5 s one, and comparing
// raw durations across models hides that. Median rather than mean, because
// one job that sat in a queue overnight would otherwise dominate.

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function modelTimings(jobs: Job[]): ModelTiming[] {
  const buckets = new Map<string, { total: number[]; perSec: number[]; queueShare: number[] }>();
  for (const j of jobs) {
    if (j.status !== "ready") continue;
    const from = j.provider_submitted_at;
    const to = j.provider_done_at;
    if (!from || !to || to <= from || !j.duration_s) continue;
    const totalS = (to - from) / 1000;
    // A clip longer than an hour is a stuck row, not a measurement.
    if (totalS > 3600) continue;
    const key = `${j.model}|${j.mode}`;
    const b = buckets.get(key) ?? { total: [], perSec: [], queueShare: [] };
    b.total.push(totalS);
    b.perSec.push(totalS / j.duration_s);
    if (j.provider_started_at && j.provider_started_at >= from && j.provider_started_at <= to) {
      b.queueShare.push((j.provider_started_at - from) / (to - from));
    }
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .map(([key, b]) => {
      const [model, mode] = key.split("|");
      const perSec = [...b.perSec].sort((a, c) => a - c);
      const total = [...b.total].sort((a, c) => a - c);
      const share = [...b.queueShare].sort((a, c) => a - c);
      return {
        model,
        mode,
        samples: b.perSec.length,
        medianSecPerOutputSec: Number(quantile(perSec, 0.5).toFixed(1)),
        p90SecPerOutputSec: Number(quantile(perSec, 0.9).toFixed(1)),
        queueSharePct: share.length ? Number((quantile(share, 0.5) * 100).toFixed(0)) : null,
        medianTotalS: Math.round(quantile(total, 0.5)),
      };
    })
    .sort((a, b) => a.medianSecPerOutputSec - b.medianSecPerOutputSec);
}
