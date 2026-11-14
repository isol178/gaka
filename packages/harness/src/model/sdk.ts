import Anthropic from "@anthropic-ai/sdk";
import { FinishReason, GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import {
  type CapabilityProfile,
  estimateImageTokens,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
} from "./types.ts";

/**
 * Adapters for providers with an official SDK. The SDK stays inside the adapter: the harness
 * still only sees "text (+ images) in, text out", so models remain interchangeable.
 */

function requireKey(profile: CapabilityProfile, env: NodeJS.ProcessEnv): string {
  const name = profile.apiKeyEnv;
  const key = name ? env[name] : undefined;
  if (!name || !key)
    throw new Error(`profile '${profile.id}' needs env ${name ?? "(apiKeyEnv unset)"}`);
  return key;
}

function imageTokens(profile: CapabilityProfile, req: ModelRequest): number {
  return (req.images ?? []).reduce((n, im) => n + estimateImageTokens(profile, im.png), 0);
}

export interface SdkOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; production uses the global fetch. */
  fetch?: typeof fetch;
}

export class AnthropicAdapter implements ModelAdapter {
  private readonly client: Anthropic;

  constructor(
    readonly profile: CapabilityProfile,
    opts: SdkOptions = {},
  ) {
    const env = opts.env ?? process.env;
    this.client = new Anthropic({
      apiKey: requireKey(profile, env),
      ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    // No server-side refusal fallback: in a benchmark harness a silent switch to another model
    // would mislabel results. A refusal is surfaced as stopReason "refusal" instead.
    const res = await this.client.messages.create({
      model: this.profile.model,
      max_tokens: req.maxOutputTokens ?? 16_000,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            ...(req.images ?? []).map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: img.png.toString("base64"),
              },
            })),
            { type: "text" as const, text: req.prompt },
          ],
        },
      ],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const stop = res.stop_reason;
    return {
      text,
      stopReason:
        stop === "max_tokens" || stop === "model_context_window_exceeded"
          ? "max_tokens"
          : stop === "refusal"
            ? "refusal"
            : stop === "end_turn"
              ? "end"
              : "other",
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        imageTokens: imageTokens(this.profile, req),
      },
    };
  }
}

export class OpenAIAdapter implements ModelAdapter {
  private readonly client: OpenAI;

  constructor(
    readonly profile: CapabilityProfile,
    opts: SdkOptions = {},
  ) {
    const env = opts.env ?? process.env;
    this.client = new OpenAI({
      apiKey: requireKey(profile, env),
      ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.chat.completions.create({
      model: this.profile.model,
      ...(req.maxOutputTokens ? { max_completion_tokens: req.maxOutputTokens } : {}),
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            ...(req.images ?? []).map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/png;base64,${img.png.toString("base64")}` },
            })),
          ],
        },
      ],
    });
    const choice = res.choices[0];
    const finish = choice?.finish_reason;
    return {
      text: choice?.message.content ?? "",
      stopReason:
        finish === "length"
          ? "max_tokens"
          : finish === "content_filter"
            ? "refusal"
            : finish === "stop"
              ? "end"
              : "other",
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        imageTokens: imageTokens(this.profile, req),
      },
    };
  }
}

const GOOGLE_REFUSALS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export class GoogleAdapter implements ModelAdapter {
  private readonly client: GoogleGenAI;

  constructor(
    readonly profile: CapabilityProfile,
    opts: SdkOptions = {},
  ) {
    const env = opts.env ?? process.env;
    this.client = new GoogleGenAI({
      apiKey: requireKey(profile, env),
      httpOptions: {
        ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      },
    });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.models.generateContent({
      model: this.profile.model,
      contents: [
        {
          role: "user",
          parts: [
            ...(req.images ?? []).map((img) => ({
              inlineData: { mimeType: "image/png", data: img.png.toString("base64") },
            })),
            { text: req.prompt },
          ],
        },
      ],
      config: {
        systemInstruction: req.system,
        ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      },
    });
    const finish = res.candidates?.[0]?.finishReason;
    const blocked = res.promptFeedback?.blockReason !== undefined;
    const u = res.usageMetadata;
    return {
      text: res.text ?? "",
      stopReason:
        blocked || (finish !== undefined && GOOGLE_REFUSALS.has(finish))
          ? "refusal"
          : finish === FinishReason.MAX_TOKENS
            ? "max_tokens"
            : finish === FinishReason.STOP
              ? "end"
              : "other",
      usage: {
        inputTokens: u?.promptTokenCount ?? 0,
        // Thinking tokens are billed as output.
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        imageTokens: imageTokens(this.profile, req),
      },
    };
  }
}
