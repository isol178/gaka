/**
 * The only contract Gaka requires from a model: text (+ optional images) in, text out.
 * No vendor tool-calling or structured-output features are assumed (concept section 7.1).
 */
export interface ImageInput {
  /** Why this image is shown, e.g. "thumbnail" or "crop:sky". Used for budgeting and logs. */
  label: string;
  png: Buffer;
}

export interface ModelRequest {
  system: string;
  prompt: string;
  images?: ImageInput[];
  maxOutputTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Harness-side estimate from the capability profile; providers rarely report it separately. */
  imageTokens: number;
}

export interface ModelResponse {
  text: string;
  usage: Usage;
  /** Normalized reason the model stopped. "max_tokens" means the reply was cut off. */
  stopReason?: "end" | "max_tokens" | "refusal" | "other";
}

export interface ModelAdapter {
  readonly profile: CapabilityProfile;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** Capability profile (concept section 7.2), loaded from config/models/*.json. */
export interface CapabilityProfile {
  id: string;
  adapter: "scripted" | "openai-compatible" | "anthropic";
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  vision: boolean;
  /** Image input cost scales with pixel count; the observer budgets per image size with this. */
  imageTokensPerMegapixel: number;
  contextTokens: number;
  pricing: { inputPerMTok: number; outputPerMTok: number };
}

/** Reads width/height from a PNG IHDR chunk (bytes 16..24). */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function estimateImageTokens(profile: CapabilityProfile, png: Buffer): number {
  const { width, height } = pngSize(png);
  return Math.ceil(((width * height) / 1_000_000) * profile.imageTokensPerMegapixel);
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    imageTokens: a.imageTokens + b.imageTokens,
  };
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, imageTokens: 0 };

export function costUsd(profile: CapabilityProfile, u: Usage): number {
  return (
    (u.inputTokens * profile.pricing.inputPerMTok +
      u.outputTokens * profile.pricing.outputPerMTok) /
    1_000_000
  );
}
