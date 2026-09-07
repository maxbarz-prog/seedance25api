import { VideoGenerator, VideoUpscaler } from "./types";
import { MockGenerator, MockUpscaler } from "./mock";
import { BytePlusGenerator } from "./byteplus";
import { FalUpscaler } from "./fal";
import { TopazUpscaler } from "./topaz";

// Provider selection: real clients activate only when PROVIDER_MODE=live and
// keys exist; everything else runs on mocks so the product is demoable with
// zero external dependencies.
//
// Generation: BytePlus ModelArk (official Seedance source).
// Upscaling: ByteDance Video Upscaler via fal (FAL_KEY). Topaz direct stays
// selectable (TOPAZ_API_KEY) and lib/providers/reapi.ts remains an unwired
// aggregator fallback for congestion.

const live = process.env.PROVIDER_MODE === "live";

export function generator(): VideoGenerator {
  if (live && process.env.BYTEPLUS_API_KEY) return new BytePlusGenerator();
  return new MockGenerator();
}

export function upscaler(): VideoUpscaler {
  if (live && process.env.FAL_KEY) return new FalUpscaler();
  if (live && process.env.TOPAZ_API_KEY) return new TopazUpscaler();
  return new MockUpscaler();
}
