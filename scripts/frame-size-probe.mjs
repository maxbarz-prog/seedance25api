#!/usr/bin/env node
// What frame size does each model actually emit at a given resolution?
//
// Pricing is derived, not tabulated: cost = billed tokens x rate, and
//
//     tokens = frames x width x height / 1024,    frames = duration x 24 + 1
//
// so a quote is only as accurate as the frame size in web/lib/config.ts. That
// size is NOT predictable from the resolution name — measured 2026-09-09,
// "480p" is 854x480 on Seedance 2.5 and 864x496 on the 2.0 family, a 4.5%
// difference. Guessing it low sells below cost; guessing it high overcharges.
// Estimates are held to 0..+1% of the invoice, which leaves no room to guess
// at all.
//
// So this renders the SHORTEST allowed clip per model at the resolution under
// test, reads back the token count the provider billed, and inverts the
// formula to get the frame size they charged for. It also probes the returned
// file with ffprobe, so the billed size and the delivered size are both on
// the record — they have agreed so far, and a disagreement is itself worth
// knowing about.
//
// Output is the exact `frameSize` line to paste into web/lib/config.ts.
//
// THIS SPENDS MONEY. It refuses to run without SPEND_OK=yes, and prints the
// estimated cost before doing anything.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const RESOLUTION = process.env.PROBE_RESOLUTION || "720p";
// The shortest clip the models accept. Fewer frames, same frame size, less
// money: the answer we want does not depend on the length.
const DURATION_S = Number(process.env.PROBE_DURATION_S || 4);
const RATIO = process.env.PROBE_RATIO || "16:9";
const POLL_MS = 5000;
const OUT_DIR = process.env.PROBE_OUT || mkdtempSync(join(tmpdir(), "framesize-"));

// Mirrors web/lib/config.ts. Restated rather than imported because the whole
// point is to check that file against reality. `rate` is the USD per million
// tokens for the band this resolution bills in (480p and 720p share one), net
// of nothing — promotions only make the real bill smaller than the estimate
// printed here.
const MODELS = [
  { id: "seedance-2.5", upstream: "dreamina-seedance-2-5-260628", rate: 10.7 },
  { id: "seedance-2.0", upstream: "dreamina-seedance-2-0-260128", rate: 7.0 },
  { id: "seedance-2.0-fast", upstream: "dreamina-seedance-2-0-fast-260128", rate: 5.6 },
  { id: "seedance-2.0-mini", upstream: "dreamina-seedance-2-0-mini-260615", rate: 3.5 },
];
const ONLY = (process.env.PROBE_MODELS || "").split(/[,\s]+/).filter(Boolean);
const models = ONLY.length ? MODELS.filter((m) => ONLY.includes(m.id)) : MODELS;

const framesFor = (sec) => Math.round(sec * 24) + 1;
// The obvious guess, for comparison only. If the measurement matches it, say
// so; if it does not, the measurement wins.
const GUESS = { "480p": [854, 480], "720p": [1280, 720], "1080p": [1920, 1080] }[RESOLUTION];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}
const headers = () => ({
  Authorization: `Bearer ${need("BYTEPLUS_API_KEY")}`,
  "Content-Type": "application/json",
});
async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

function estimateUsd(m) {
  if (!GUESS) return null;
  return (framesFor(DURATION_S) * GUESS[0] * GUESS[1] * m.rate) / 1024 / 1e6;
}

async function poll(id, label, timeoutMs = 25 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await req(`${ARK}/contents/generations/tasks/${id}`, { headers: headers() });
    if (!r.ok) throw new Error(`${label}: poll ${r.status} ${r.text.slice(0, 200)}`);
    if (["succeeded", "failed", "cancelled", "expired"].includes(r.json.status)) return r.json;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out in ${r.json.status}`);
    await sleep(POLL_MS);
  }
}

// Dimensions of the delivered file, so the billed size can be checked against
// what was actually produced.
async function probeDimensions(url, label) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const path = join(OUT_DIR, `${label}.mp4`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    const { default: ffprobe } = await import("ffprobe-static");
    const out = execFileSync(
      ffprobe.path,
      ["-v", "error", "-select_streams", "v:0", "-show_entries",
       "stream=width,height,nb_frames", "-of", "json", path],
      { encoding: "utf8" }
    );
    const s = JSON.parse(out).streams?.[0];
    return s ? { width: s.width, height: s.height, frames: Number(s.nb_frames) || null } : null;
  } catch (e) {
    console.warn(`  (ffprobe failed for ${label}: ${e.message})`);
    return null;
  }
}

async function main() {
  const estimate = models.reduce((a, m) => a + (estimateUsd(m) ?? 0), 0);
  console.log(
    `Frame-size probe: ${RESOLUTION}, ${DURATION_S}s, ${models.length} model(s).\n` +
      `Estimated provider cost: $${estimate.toFixed(2)} (before any promotion).`
  );
  if (process.env.SPEND_OK !== "yes") {
    console.error("\nRefusing to spend. Set SPEND_OK=yes to run.");
    process.exit(2);
  }

  const rows = [];
  for (const m of models) {
    console.log(`\n[${m.id}] submitting ${DURATION_S}s at ${RESOLUTION}…`);
    const sub = await req(`${ARK}/contents/generations/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: m.upstream,
        content: [{ type: "text", text: "A slow pan across an empty grey concrete wall." }],
        resolution: RESOLUTION,
        ratio: RATIO,
        duration: DURATION_S,
        generate_audio: false,
        watermark: false,
      }),
    });
    if (!sub.ok) {
      const error = (sub.json?.error?.message || sub.text).slice(0, 300);
      console.log(`  SUBMIT FAILED: ${error}`);
      rows.push({ id: m.id, status: "submit-failed", error });
      continue;
    }
    const done = await poll(sub.json.id, m.id);
    if (done.status !== "succeeded") {
      const error = JSON.stringify(done.error || done).slice(0, 300);
      console.log(`  FAILED: ${error}`);
      rows.push({ id: m.id, status: done.status, error });
      continue;
    }
    const tokens = done.usage?.total_tokens ?? done.usage?.completion_tokens;
    const frames = framesFor(DURATION_S);
    // tokens = frames x w x h / 1024, so the billed pixel count follows.
    const pixels = (tokens * 1024) / frames;
    const actual = await probeDimensions(done.content?.video_url, `${m.id}-${RESOLUTION}`);
    const row = {
      id: m.id,
      status: "succeeded",
      tokens,
      frames,
      billedPixels: Math.round(pixels),
      delivered: actual,
      // What the delivered dimensions imply, which is the number to paste.
      frameSize: actual ? [actual.width, actual.height] : null,
      matchesGuess: actual && GUESS ? actual.width === GUESS[0] && actual.height === GUESS[1] : null,
      // Does the billed pixel count agree with the delivered frame? A gap
      // means they bill for a different size than they ship, which changes
      // what config.ts must contain.
      billedMatchesDelivered:
        actual && Math.abs(actual.width * actual.height - pixels) / pixels < 0.005,
      usd: done.usage ? null : null,
    };
    rows.push(row);
    console.log(
      `  ${tokens} tokens over ${frames} frames -> ${Math.round(pixels)} px/frame; ` +
        `delivered ${actual ? `${actual.width}x${actual.height}` : "unknown"}` +
        (row.matchesGuess === false ? "  <-- NOT the guessed size" : "")
    );
  }

  console.log(`\n--- paste into web/lib/config.ts ---`);
  for (const r of rows) {
    if (r.status !== "succeeded" || !r.frameSize) {
      console.log(`// ${r.id}: ${r.status}${r.error ? ` — ${r.error}` : ""}`);
      continue;
    }
    console.log(`// ${r.id}:  "${RESOLUTION}": [${r.frameSize[0]}, ${r.frameSize[1]}],`);
  }
  const ok = rows.filter((r) => r.status === "succeeded");
  if (ok.length && ok.every((r) => r.billedMatchesDelivered)) {
    console.log(
      `\nBilled pixel count agrees with the delivered frame on all ${ok.length} model(s).`
    );
  } else if (ok.length) {
    console.log(
      `\nWARNING: billed pixels and delivered frame disagree somewhere — price from the BILLED figure.`
    );
  }
  writeFileSync(join(OUT_DIR, "frame-sizes.json"), JSON.stringify({ resolution: RESOLUTION, durationS: DURATION_S, rows }, null, 2));
  console.log(`\nFull result: ${join(OUT_DIR, "frame-sizes.json")}`);
  if (ok.length !== rows.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
