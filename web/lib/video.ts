import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Server-side clip surgery with the ffmpeg-static binary, used for two things
// in the extension flow:
//
//   trimTail  send only the last seconds of a source clip as the reference
//             video — the provider bills every second of it as input.
//   concat    join the source and the returned continuation into the single
//             video the member actually asked for. The model returns only the
//             new seconds (as Kling, Runway and Luma's models all do); every
//             one of those products stitches before the user sees it.
//
// Every failure mode (no binary, wrong architecture, ffmpeg error) returns
// null so the caller can fall back rather than fail a paid job.

let bin: string | null | undefined;

function ffmpegBin(): string | null {
  if (bin !== undefined) return bin;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packaged = require("ffmpeg-static") as string | null;
    if (!packaged || !existsSync(packaged)) {
      bin = null;
      return bin;
    }
    // Lambda bundles can drop the exec bit; run from a writable copy.
    const copy = join(tmpdir(), "ffmpeg");
    if (!existsSync(copy)) {
      copyFileSync(packaged, copy);
      chmodSync(copy, 0o755);
    }
    bin = copy;
  } catch (err) {
    console.warn("ffmpeg unavailable:", err);
    bin = null;
  }
  return bin;
}

export function ffmpegAvailable(): boolean {
  return ffmpegBin() !== null;
}

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) return Promise.resolve({ code: -1, stderr: "ffmpeg unavailable" });
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "vid-"));
}

// ffmpeg prints "Duration: HH:MM:SS.ss" to stderr when asked to describe an
// input; ffprobe is not bundled, so this is how we measure a clip.
function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function durationOf(input: Buffer): Promise<number | null> {
  if (!ffmpegAvailable()) return null;
  const dir = scratch();
  const path = join(dir, "in.mp4");
  try {
    writeFileSync(path, input);
    // No output: ffmpeg reports the input's metadata and exits non-zero.
    const { stderr } = await run(["-hide_banner", "-i", path]);
    return parseDuration(stderr);
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Last `seconds` of an MP4, re-encoded so the cut is frame-accurate.
export async function trimTail(input: Buffer, seconds: number): Promise<Buffer | null> {
  if (!ffmpegAvailable()) return null;
  const dir = scratch();
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.mp4");
  try {
    writeFileSync(inPath, input);
    const { code, stderr } = await run([
      "-y", "-v", "error",
      "-sseof", `-${seconds}`,
      "-i", inPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`);
    return readFileSync(outPath);
  } catch (err) {
    console.warn("ffmpeg trim failed:", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Join clips end to end. Both come from the same model at the same settings,
// so the concat demuxer with a stream copy almost always works and is nearly
// instant; re-encoding is the fallback for when the streams do not line up.
// Re-encoding a long 1080p pair is the slow path, hence copy first.
export async function concat(parts: Buffer[]): Promise<Buffer | null> {
  if (!ffmpegAvailable() || parts.length < 2) return null;
  const dir = scratch();
  try {
    const paths = parts.map((buf, i) => {
      const p = join(dir, `part${i}.mp4`);
      writeFileSync(p, buf);
      return p;
    });
    const listPath = join(dir, "list.txt");
    writeFileSync(listPath, paths.map((p) => `file '${p}'`).join("\n"));
    const outPath = join(dir, "out.mp4");

    const copy = await run([
      "-y", "-v", "error",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart",
      outPath,
    ]);
    if (copy.code === 0 && existsSync(outPath)) return readFileSync(outPath);
    console.warn("concat stream-copy failed, re-encoding:", copy.stderr.slice(0, 200));

    const inputs = paths.flatMap((p) => ["-i", p]);
    const filter =
      paths.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("") + `concat=n=${paths.length}:v=1:a=1[v][a]`;
    const reencode = await run([
      "-y", "-v", "error",
      ...inputs,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ]);
    if (reencode.code === 0 && existsSync(outPath)) return readFileSync(outPath);

    // Some clips carry no audio track, which breaks the [i:a:0] mapping above.
    const videoOnly =
      paths.map((_, i) => `[${i}:v:0]`).join("") + `concat=n=${paths.length}:v=1:a=0[v]`;
    const silent = await run([
      "-y", "-v", "error",
      ...inputs,
      "-filter_complex", videoOnly,
      "-map", "[v]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ]);
    if (silent.code === 0 && existsSync(outPath)) return readFileSync(outPath);
    throw new Error(`concat failed: ${silent.stderr.slice(0, 300)}`);
  } catch (err) {
    console.warn("ffmpeg concat failed:", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
