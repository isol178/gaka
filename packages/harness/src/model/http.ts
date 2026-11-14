import {
  type CapabilityProfile,
  estimateImageTokens,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
} from "./types.ts";

function apiKey(profile: CapabilityProfile, env: NodeJS.ProcessEnv): string | undefined {
  if (profile.apiKeyEnv === undefined) return undefined;
  const key = env[profile.apiKeyEnv];
  if (!key) throw new Error(`profile '${profile.id}' needs env ${profile.apiKeyEnv}`);
  return key;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

function imageTokens(profile: CapabilityProfile, req: ModelRequest): number {
  return (req.images ?? []).reduce((n, im) => n + estimateImageTokens(profile, im.png), 0);
}

/** Any server speaking the OpenAI chat-completions dialect: hosted APIs, Ollama, vLLM, llama.cpp. */
export class OpenAICompatibleAdapter implements ModelAdapter {
  constructor(
    readonly profile: CapabilityProfile,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const key = apiKey(this.profile, this.env);
    const content = [
      { type: "text", text: req.prompt },
      ...(req.images ?? []).map((img) => ({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img.png.toString("base64")}` },
      })),
    ];
    const body = {
      model: this.profile.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content },
      ],
      ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
    };
    const base = this.profile.baseUrl ?? "https://api.openai.com/v1";
    const json = (await postJson(
      `${base.replace(/\/$/, "")}/chat/completions`,
      key ? { authorization: `Bearer ${key}` } : {},
      body,
    )) as {
      choices: { message: { content: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices[0]?.message.content ?? "",
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        imageTokens: imageTokens(this.profile, req),
      },
    };
  }
}

/** Anthropic Messages API over plain HTTP (no SDK, to keep the adapter layer uniform). */
export class AnthropicAdapter implements ModelAdapter {
  constructor(
    readonly profile: CapabilityProfile,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const key = apiKey(this.profile, this.env) ?? "";
    const content = [
      ...(req.images ?? []).map((img) => ({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: img.png.toString("base64") },
      })),
      { type: "text", text: req.prompt },
    ];
    const base = this.profile.baseUrl ?? "https://api.anthropic.com";
    const json = (await postJson(
      `${base.replace(/\/$/, "")}/v1/messages`,
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      {
        model: this.profile.model,
        max_tokens: req.maxOutputTokens ?? 8192,
        system: req.system,
        messages: [{ role: "user", content }],
      },
    )) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: json.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join(""),
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        imageTokens: imageTokens(this.profile, req),
      },
    };
  }
}
