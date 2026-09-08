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

// Server-side clip trimming with the ffmpeg-static binary. Used to send only
// the tail of a source clip as the reference video for an extension: the
// provider bills the whole reference clip as input tokens, so a 30 s source
// would otherwise cost more than the seconds being added.
//
// Every failure mode (no binary, wrong architecture, ffmpeg error) returns
// null so the caller can fall back to the full clip instead of failing the
// job.

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

// Last `seconds` of an MP4, re-encoded so the cut is frame-accurate.
export async function trimTail(input: Buffer, seconds: number): Promise<Buffer | null> {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) return null;
  const dir = mkdtempSync(join(tmpdir(), "trim-"));
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.mp4");
  try {
    writeFileSync(inPath, input);
    const args = [
      "-y", "-v", "error",
      "-sseof", `-${seconds}`,
      "-i", inPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", reject);
      p.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`))
      );
    });
    return readFileSync(outPath);
  } catch (err) {
    console.warn("ffmpeg trim failed:", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
