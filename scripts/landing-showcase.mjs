#!/usr/bin/env node
// Render the landing page's showcase clips, upscale them to 4K, and encode
// the web versions the page actually serves.
//
// The list of clips — file names, prompts, render quality — is
// web/lib/landing.ts, the same file the page reads. This script renders
// whichever of them are missing from web/public/landing, so a re-run after
// one failure pays for one clip, not four. Each clip is text-to-video on
// Seedance 2.5 (no starting image: nothing on the list involves a person,
// and a described scene is what a visitor would type), upscaled to 4K on
// fal, then encoded by ffmpeg to a 1080p H.264 the page can stream and a
// JPEG poster. The 4K originals go in the run's output folder for the
// workflow to keep as an artifact; they are too large to commit.
//
// THIS SPENDS MONEY, and refuses to exceed a cap. Before each clip the
// provider cost is estimated from the same rate table the site sells on
// (restated below; see web/lib/config.ts), and a clip that would take the
// running total past MAX_SPEND_USD is skipped and said so. Refuses to run
// at all without SPEND_OK=yes.
//
// Env: SPEND_OK=yes, BYTEPLUS_API_KEY, FAL_KEY, MAX_SPEND_USD (5),
// SHOWCASE_OUT (out dir), FORCE=1 (re-render clips that already exist),
// ONLY=hero,city (limit to named files), FFMPEG_PATH, FFPROBE_PATH.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { SHOWCASE } from "../web/lib/landing.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "web", "public", "landing");
const OUT_DIR = process.env.SHOWCASE_OUT || join(ROOT, "showcase-out");

const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const MODEL_UPSTREAM = "dreamina-seedance-2-5-260628";
const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");
const MAX_SPEND_USD = Number(process.env.MAX_SPEND_USD || 5);
const FORCE = process.env.FORCE === "1";
const ONLY = (process.env.ONLY || "").split(/[,\s]+/).filter(Boolean);
const POLL_MS = 5000;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

// The rate table for Seedance 2.5, USD per million tokens, mirrored from
// web/lib/config.ts so the cap is enforced on the same numbers the site
// charges by. 1080p bills in the "hd" band, which carries a promotion until
// the date below; 720p bills in the "sd" band on more pixels than 480p.
const RATE_SD = 10.7;
const RATE_HD = 11.7;
const HD_DISCOUNT = { pct: 0.28, until: "2026-09-17T06:00:00Z" };
const FRAME = { "1080p": [1920, 1080], "720p": [1280, 720] };
const UPSCALE_4K_PER_SEC = 0.0288;
const FPS = 24;
const EXTRA_FRAMES = 1;
const TOKEN_SAFETY = 1.005;

function liveHdRate(now = Date.now()) {
  return Date.parse(HD_DISCOUNT.until) > now ? RATE_HD * (1 - HD_DISCOUNT.pct) : RATE_HD;
}
function estimateUsd(clip) {
  const [w, h] = FRAME[clip.quality];
  const tokens = ((clip.durationS * FPS + EXTRA_FRAMES) * w * h) / 1024;
  const rate = clip.quality === "1080p" ? liveHdRate() : RATE_SD;
  return (rate * tokens * TOKEN_SAFETY) / 1e6 + UPSCALE_4K_PER_SEC * clip.durationS;
}
function actualUsd(clip, tokens) {
  const rate = clip.quality === "1080p" ? liveHdRate() : RATE_SD;
  return (rate * tokens) / 1e6 + UPSCALE_4K_PER_SEC * clip.durationS;
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}
async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json, text };
}
const arkHeaders = () => ({ Authorization: `Bearer ${need("BYTEPLUS_API_KEY")}`, "Content-Type": "application/json" });
const falHeaders = () => ({ Authorization: `Key ${need("FAL_KEY")}`, "Content-Type": "application/json" });

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${path}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

function probe(path) {
  try {
    const j = JSON.parse(
      sh(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration,size", "-of", "json", path])
    );
    const s = j.streams?.[0] || {};
    return { width: s.width, height: s.height, durationS: Number(j.format?.duration || 0).toFixed(2), bytes: Number(j.format?.size || 0) };
  } catch {
    return {};
  }
}

async function arkPoll(id, label, timeoutMs = 25 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req(`${ARK}/contents/generations/tasks/${id}`, { headers: arkHeaders() });
    if (!r.ok) throw new Error(`${label}: poll ${r.status} ${r.text.slice(0, 200)}`);
    const s = r.json.status;
    if (["succeeded", "failed", "cancelled", "expired"].includes(s)) return r.json;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out in ${s}`);
    await sleep(POLL_MS);
  }
}

async function render(clip, seed) {
  const body = {
    model: MODEL_UPSTREAM,
    content: [{ type: "text", text: clip.prompt }],
    resolution: clip.quality,
    ratio: "16:9",
    duration: clip.durationS,
    generate_audio: false,
    watermark: false,
    seed,
  };
  const sub = await req(`${ARK}/contents/generations/tasks`, { method: "POST", headers: arkHeaders(), body: JSON.stringify(body) });
  if (!sub.ok) throw new Error(`${clip.file}: submit ${sub.status}: ${(sub.json?.error?.message || sub.text).slice(0, 300)}`);
  log(clip.file, "submitted", sub.json.id);
  const done = await arkPoll(sub.json.id, clip.file);
  if (done.status !== "succeeded") throw new Error(`${clip.file}: ${done.status}: ${JSON.stringify(done.error || {}).slice(0, 300)}`);
  return { videoUrl: done.content?.video_url, tokens: done.usage?.total_tokens ?? done.usage?.completion_tokens };
}

// Lowercase "4k" is the spelling the API accepts (web/lib/providers/fal.ts).
async function upscale4k(clip, videoUrl) {
  const t0 = Date.now();
  const sub = await req(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ video_url: videoUrl, target_resolution: "4k" }),
  });
  if (!sub.ok) throw new Error(`${clip.file}: upscale submit ${sub.status}: ${sub.text.slice(0, 200)}`);
  const reqId = sub.json.request_id;
  for (;;) {
    const st = await req(`https://queue.fal.run/${FAL_APP}/requests/${reqId}/status`, { headers: falHeaders() });
    if (!st.ok) throw new Error(`${clip.file}: fal poll ${st.status}`);
    if (st.json.status === "COMPLETED") break;
    if (["FAILED", "ERROR"].includes(st.json.status)) throw new Error(`${clip.file}: upscale failed ${JSON.stringify(st.json).slice(0, 200)}`);
    if (Date.now() - t0 > 30 * 60_000) throw new Error(`${clip.file}: upscale timed out`);
    await sleep(POLL_MS);
  }
  const res = await req(`https://queue.fal.run/${FAL_APP}/requests/${reqId}`, { headers: falHeaders() });
  const url = res.json?.video?.url;
  if (!url) throw new Error(`${clip.file}: no video url in ${JSON.stringify(res.json).slice(0, 200)}`);
  log(clip.file, `upscaled in ${Math.round((Date.now() - t0) / 1000)}s`);
  return url;
}

// What the page serves: 1080p H.264, no audio, moov up front so playback
// starts before the download finishes; and the first frame as the poster.
// Encoded from the 4K master, so the downscale is ours and clean.
function encodeWeb(clip, masterPath) {
  const mp4 = join(PUBLIC_DIR, `${clip.file}.mp4`);
  const jpg = join(PUBLIC_DIR, `${clip.file}.jpg`);
  sh(FFMPEG, [
    "-y", "-i", masterPath,
    "-vf", "scale=1920:-2",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an",
    mp4,
  ]);
  sh(FFMPEG, ["-y", "-i", masterPath, "-vf", "scale=1920:-2", "-frames:v", "1", "-q:v", "3", jpg]);
  return { mp4, jpg };
}

async function main() {
  if (process.env.SPEND_OK !== "yes") {
    console.error("Refusing to run: this spends real money. Set SPEND_OK=yes.");
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const wanted = SHOWCASE.filter((c) => !ONLY.length || ONLY.includes(c.file));
  const todo = wanted.filter((c) => FORCE || !existsSync(join(PUBLIC_DIR, `${c.file}.mp4`)));
  const summary = { startedAt: new Date().toISOString(), capUsd: MAX_SPEND_USD, clips: [], totals: {} };

  log(`cap $${MAX_SPEND_USD.toFixed(2)}; ${todo.length} of ${wanted.length} clips to render`);
  for (const c of wanted) {
    log(`  ${c.file.padEnd(8)} ${c.quality} -> 4K, ${c.durationS}s, est $${estimateUsd(c).toFixed(3)}${todo.includes(c) ? "" : "  (exists, skipped)"}`);
  }

  let committed = 0;
  let spent = 0;
  for (const clip of todo) {
    const est = estimateUsd(clip);
    const rec = { file: clip.file, quality: clip.quality, durationS: clip.durationS, estUsd: Number(est.toFixed(4)) };
    if (committed + est > MAX_SPEND_USD) {
      rec.status = "skipped-cap";
      rec.note = `would take the total to $${(committed + est).toFixed(2)}, over the $${MAX_SPEND_USD.toFixed(2)} cap`;
      log(clip.file, "SKIPPED:", rec.note);
      summary.clips.push(rec);
      continue;
    }
    committed += est;
    try {
      const seed = 4242 + SHOWCASE.indexOf(clip);
      const gen = await render(clip, seed);
      rec.tokens = gen.tokens;
      rec.usd = Number(actualUsd(clip, gen.tokens ?? 0).toFixed(4));
      spent += rec.usd;
      const srcPath = await download(gen.videoUrl, join(OUT_DIR, `${clip.file}--source-${clip.quality}.mp4`));
      rec.source = probe(srcPath);
      const upUrl = await upscale4k(clip, gen.videoUrl);
      const master = await download(upUrl, join(OUT_DIR, `${clip.file}--4k.mp4`));
      rec.master = probe(master);
      const web = encodeWeb(clip, master);
      rec.web = probe(web.mp4);
      rec.status = "ok";
      log(clip.file, `done: ${rec.tokens} tokens, $${rec.usd.toFixed(3)}; web ${rec.web.width}x${rec.web.height} ${rec.web.bytes} bytes`);
    } catch (e) {
      rec.status = "failed";
      rec.error = String(e).slice(0, 400);
      log(clip.file, "FAILED", rec.error);
    }
    summary.clips.push(rec);
  }
  summary.totals = {
    estimatedUsd: Number(committed.toFixed(4)),
    spentUsd: Number(spent.toFixed(4)),
    rendered: summary.clips.filter((r) => r.status === "ok").map((r) => r.file),
    failed: summary.clips.filter((r) => r.status === "failed").map((r) => r.file),
    skipped: summary.clips.filter((r) => r.status === "skipped-cap").map((r) => r.file),
  };
  writeFileSync(join(OUT_DIR, "showcase.json"), JSON.stringify(summary, null, 2));
  // The page shows the prompt under each clip; this keeps the record of
  // which prompt made which file next to the files.
  writeFileSync(
    join(PUBLIC_DIR, "README.txt"),
    [
      "Landing page showcase clips. Rendered by scripts/landing-showcase.mjs",
      "from the list in web/lib/landing.ts; 1080p web encodes of 4K masters.",
      "",
      ...SHOWCASE.map((c) => `${c.file}.mp4  ${c.quality} -> 4K, ${c.durationS}s\n  ${c.prompt}\n`),
    ].join("\n")
  );
  console.log(JSON.stringify(summary.totals, null, 2));
  if (summary.totals.failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
