import {
  GenerationRequest,
  ProviderTaskResult,
  VideoGenerator,
  VideoUpscaler,
} from "./types";

// Simulated provider for local/dev: tasks "complete" after a fixed wall-clock
// delay, computed lazily on poll so no background process is needed. Task ids
// encode their own start time and duration.

const GEN_SECONDS = 18;
const UPSCALE_SECONDS = 10;

// CC0 sample clip (loads in the viewer's browser) standing in for real output.
const SAMPLE_VIDEO =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function makeTask(prefix: string, runSeconds: number): string {
  return `${prefix}:${Date.now()}:${runSeconds}`;
}

function pollEncoded(taskId: string): ProviderTaskResult {
  const [, startedAt, runSeconds] = taskId.split(":");
  const elapsed = (Date.now() - Number(startedAt)) / 1000;
  if (elapsed < Number(runSeconds)) return { status: "running" };
  return { status: "succeeded", videoUrl: SAMPLE_VIDEO };
}

export class MockGenerator implements VideoGenerator {
  async submitGeneration(_req: GenerationRequest): Promise<string> {
    return makeTask("mockgen", GEN_SECONDS);
  }
  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    return pollEncoded(taskId);
  }
}

export class MockUpscaler implements VideoUpscaler {
  async submitUpscale(_videoUrl: string, _factor: 2 | 4): Promise<string> {
    return makeTask("mockup", UPSCALE_SECONDS);
  }
  async pollTask(taskId: string): Promise<ProviderTaskResult> {
    return pollEncoded(taskId);
  }
}
