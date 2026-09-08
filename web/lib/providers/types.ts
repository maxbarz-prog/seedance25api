// Provider abstraction. The pipeline only ever talks to these interfaces, so
// upstream vendors can be swapped or routed without touching product code.
// Provider identity must never leak to users: errors thrown from providers
// are logged server-side and rewritten before reaching any API response.

export interface GenerationRequest {
  prompt: string;
  model: string; // product model id, e.g. "seedance-2.5"
  durationS: number;
  aspect: string;
  audio: boolean;
  resolution: "480p" | "1080p";
  // Fetchable (~1h) input URLs: anchoring/reference images, reference
  // video(s) for motion/style, reference audio for sync.
  inputs?: {
    url: string;
    role: "reference" | "first_frame" | "last_frame" | "reference_video" | "reference_audio";
  }[];
  // When set, this is a continuation of an existing clip rather than a
  // fresh generation; durationS is the length to add.
  sourceVideoUrl?: string;
  seed?: number;
  cameraFixed?: boolean;
}

export type ProviderTaskStatus = "running" | "succeeded" | "failed";

export interface ProviderTaskResult {
  status: ProviderTaskStatus;
  videoUrl?: string;
  // Final frame of the output, when the provider can return it (chaining).
  lastFrameUrl?: string;
  // Provider-reported billing units for the task (ModelArk: tokens), used
  // to reconcile measured cost per second.
  tokens?: number;
  error?: string;
}

export interface VideoGenerator {
  submitGeneration(req: GenerationRequest): Promise<string>; // returns task id
  pollTask(taskId: string): Promise<ProviderTaskResult>;
}

export interface VideoUpscaler {
  submitUpscale(videoUrl: string, factor: 2 | 4): Promise<string>;
  pollTask(taskId: string): Promise<ProviderTaskResult>;
}
