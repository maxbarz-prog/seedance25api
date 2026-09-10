#!/usr/bin/env node
// Upscale one existing clip to 4K, on its own, into its own output folder.
//
// Deliberately separate from the bake-off: that produces a dozen files and
// the point here is to look at one thing. Takes a local mp4, puts it
// somewhere the upscaler can fetch, asks for 4K, and writes the result plus
// a short note on what changed.
//
// SPENDS MONEY (about $0.03 per source second at the 4K rate, against
// $0.0072 to 1080p). Refuses to run without SPEND_OK=yes.

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");
const SRC = process.env.SOURCE_FILE;
const OUT_DIR = process.env.OUT_DIR || "4k";
// fal names this target in the request; the exact spelling is not documented
// anywhere we can see, so try the plausible ones and let the API tell us.
const TARGETS = (process.env.TARGETS || "4k,4K,2160p,3840x2160").split(",");
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function need(n) {
  const v = process.env[n];
  if (!v) throw new Error(`${n} not set`);
  return v;
}
const falHeaders = () => ({ Authorization: `Key ${need("FAL_KEY")}`, "Content-Type": "application/json" });

async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, ok: res.ok, json, text };
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function mediaBucket() {
  if (process.env.VIDEO_BUCKET) return process.env.VIDEO_BUCKET;
  const out = sh("aws", ["s3api", "list-buckets", "--query", "Buckets[].Name", "--output", "text"]);
  const found = out.split(/\s+/).find((b) => /remerged/i.test(b) && /media/i.test(b));
  if (!found) throw new Error("could not find the media bucket");
  return found;
}

function probe(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const j = JSON.parse(
      sh(FFPROBE, ["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate:format=duration,size",
        "-of", "json", path])
    );
    const s = j.streams?.[0] || {};
    return {
      width: s.width, height: s.height, fps: s.r_frame_rate,
      durationS: Number(j.format?.duration || 0).toFixed(2),
      bytes: Number(j.format?.size || 0),
    };
  } catch { return {}; }
}

async function main() {
  if (process.env.SPEND_OK !== "yes") {
    console.error("Refusing to run: this spends real money. Set SPEND_OK=yes.");
    process.exit(2);
  }
  if (!SRC || !existsSync(SRC)) throw new Error(`SOURCE_FILE not found: ${SRC}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const before = probe(SRC);
  log(`source ${basename(SRC)}: ${before.width}x${before.height} ${before.fps}, ${before.bytes} bytes`);

  // The upscaler fetches by URL, so the clip goes to our own bucket behind a
  // short-lived signed link.
  const bucket = mediaBucket();
  const key = `tmp/4k/${Date.now()}-${basename(SRC)}`;
  sh("aws", ["s3", "cp", SRC, `s3://${bucket}/${key}`, "--content-type", "video/mp4"]);
  const srcUrl = sh("aws", ["s3", "presign", `s3://${bucket}/${key}`, "--expires-in", "43200"]);
  log(`source uploaded to ${bucket}/${key}`);

  // Find the spelling this API wants before committing to a job.
  let accepted = null;
  const refusals = [];
  for (const target of TARGETS) {
    const sub = await req(`https://queue.fal.run/${FAL_MODEL}`, {
      method: "POST",
      headers: falHeaders(),
      body: JSON.stringify({ video_url: srcUrl, target_resolution: target }),
    });
    if (sub.ok) {
      accepted = { target, requestId: sub.json.request_id };
      log(`target_resolution "${target}" accepted, request ${accepted.requestId}`);
      break;
    }
    refusals.push(`${target} -> ${sub.status} ${(sub.text || "").slice(0, 160)}`);
    log(`target_resolution "${target}" refused: ${sub.status}`);
  }
  if (!accepted) throw new Error(`no accepted 4K target spelling. Tried:\n  ${refusals.join("\n  ")}`);

  const t0 = Date.now();
  for (;;) {
    const st = await req(`https://queue.fal.run/${FAL_APP}/requests/${accepted.requestId}/status`, {
      headers: falHeaders(),
    });
    if (!st.ok) throw new Error(`poll ${st.status} ${st.text.slice(0, 200)}`);
    if (st.json.status === "COMPLETED") break;
    if (["FAILED", "ERROR"].includes(st.json.status)) {
      throw new Error(`upscale failed: ${JSON.stringify(st.json).slice(0, 300)}`);
    }
    if (Date.now() - t0 > 30 * 60_000) throw new Error("upscale timed out");
    await sleep(5000);
  }
  const res = await req(`https://queue.fal.run/${FAL_APP}/requests/${accepted.requestId}`, {
    headers: falHeaders(),
  });
  const url = res.json?.video?.url;
  if (!url) throw new Error(`no video url in ${JSON.stringify(res.json).slice(0, 300)}`);

  const outPath = join(OUT_DIR, "seedance-2.5--UPSCALED-4K.mp4");
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));
  const after = probe(outPath);
  const elapsedS = Math.round((Date.now() - t0) / 1000);

  const srcSeconds = Number(before.durationS || 0);
  const costUsd = srcSeconds * Number(process.env.COST_UPSCALE_4X_PER_SEC || 0.0288);

  const note = [
    "4K upscale sample",
    "",
    `Source : ${basename(SRC)} — ${before.width}x${before.height} @ ${before.fps}, ${(before.bytes / 1e6).toFixed(1)} MB`,
    `Output : ${basename(outPath)} — ${after.width}x${after.height} @ ${after.fps}, ${(after.bytes / 1e6).toFixed(1)} MB`,
    "",
    `target_resolution accepted by the API: "${accepted.target}"`,
    `Upscale took ${elapsedS}s and cost about $${costUsd.toFixed(3)}.`,
    "",
    "The same 480p render already exists upscaled to 1080p in the bake-off",
    "artifact, if you want the three side by side.",
  ].join("\n");
  writeFileSync(join(OUT_DIR, "README.txt"), note);

  console.log("\n" + note + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + note + "\n```\n");
  }
}

main().catch((e) => {
  console.error("fatal:", e.message || e);
  process.exitCode = 1;
});
