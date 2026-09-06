import { VideoGenerator, VideoUpscaler } from "./types";
import { MockGenerator, MockUpscaler } from "./mock";
import { BytePlusGenerator } from "./byteplus";
import { ReapiUpscaler } from "./reapi";

// Provider selection: real clients activate only when PROVIDER_MODE=live and
// keys exist; everything else runs on mocks so the product is demoable with
// zero external dependencies.

const live = process.env.PROVIDER_MODE === "live";

export function generator(): VideoGenerator {
  if (live && process.env.BYTEPLUS_API_KEY) return new BytePlusGenerator();
  return new MockGenerator();
}

export function upscaler(): VideoUpscaler {
  if (live && process.env.REAPI_API_KEY) return new ReapiUpscaler();
  return new MockUpscaler();
}
