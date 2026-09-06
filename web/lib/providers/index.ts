import { VideoGenerator, VideoUpscaler } from "./types";
import { MockGenerator, MockUpscaler } from "./mock";
import { BytePlusGenerator } from "./byteplus";
import { TopazUpscaler } from "./topaz";

// Provider selection: real clients activate only when PROVIDER_MODE=live and
// keys exist; everything else runs on mocks so the product is demoable with
// zero external dependencies.
//
// Generation: BytePlus ModelArk (official Seedance source).
// Upscaling: Topaz Labs direct. lib/providers/reapi.ts remains as an unwired
// fallback aggregator client should we ever hit congestion upstream.

const live = process.env.PROVIDER_MODE === "live";

export function generator(): VideoGenerator {
  if (live && process.env.BYTEPLUS_API_KEY) return new BytePlusGenerator();
  return new MockGenerator();
}

export function upscaler(): VideoUpscaler {
  if (live && process.env.TOPAZ_API_KEY) return new TopazUpscaler();
  return new MockUpscaler();
}
