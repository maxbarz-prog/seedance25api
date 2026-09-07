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
  images?: { url: string; role: "reference" | "first_frame" | "last_frame" }[]; // fetchable ~1h
  seed?: number;
  cameraFixed?: boolean;
}

export type ProviderTaskStatus = "running" | "succeeded" | "failed";

export interface ProviderTaskResult {
  status: ProviderTaskStatus;
  videoUrl?: string;
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
