import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicAdapter,
  createAdapter,
  OpenAIAdapter,
  OpenAICompatibleAdapter,
  parseProfile,
} from "../src/index.ts";
import { profile, profiles } from "./helpers.ts";

// IHDR width/height live at bytes 16..24; that is all the token estimate reads.
const png = Buffer.alloc(33);
png.writeUInt32BE(1000, 16);
png.writeUInt32BE(1000, 20);

function fetchReturning(body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  );
}

function sentBody(fetch: ReturnType<typeof fetchReturning>) {
  const [url, init] = fetch.mock.calls[0] ?? [];
  return {
    url: String(url),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
  };
}

const anthropicMessage = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "{}" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 2 },
  ...over,
});

const openaiCompletion = (finish: string) => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model: "gpt",
  choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: finish }],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
});

const openaiProfile = parseProfile({
  ...profile("claude-opus-5-5"),
  id: "openai-test",
  adapter: "openai",
  model: "gpt-test",
  apiKeyEnv: "OPENAI_API_KEY",
});

afterEach(() => vi.unstubAllGlobals());

describe("capability profiles", () => {
  it("every config/models/*.json is valid and named after its id", () => {
    expect(profiles.size).toBeGreaterThan(0);
  });

  it("rejects unknown fields", () => {
    expect(() => parseProfile({ ...profile("scripted"), extra: 1 })).toThrow(
      /invalid capability profile/,
    );
  });

  it("requires a cassette for scripted profiles", () => {
    expect(() => createAdapter(profile("scripted"))).toThrow(/cassette/);
  });

  it("builds SDK adapters for providers that have one", () => {
    expect(createAdapter(profile("claude-opus-5-5"), { ANTHROPIC_API_KEY: "k" })).toBeInstanceOf(
      AnthropicAdapter,
    );
    expect(createAdapter(openaiProfile, { OPENAI_API_KEY: "k" })).toBeInstanceOf(OpenAIAdapter);
    expect(createAdapter(profile("local-ollama"), {})).toBeInstanceOf(OpenAICompatibleAdapter);
  });
});

describe("AnthropicAdapter (SDK)", () => {
  it("sends images before text through the Messages API and maps usage", async () => {
    const fetch = fetchReturning(anthropicMessage());
    const a = new AnthropicAdapter(profile("claude-opus-5-5"), {
      env: { ANTHROPIC_API_KEY: "k" },
      fetch,
    });
    const res = await a.complete({ system: "s", prompt: "p", images: [{ label: "full", png }] });
    const sent = sentBody(fetch);
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers.get("authorization")).toBe("Bearer k");
    expect(sent.body.model).toBe("claude-opus-5-5");
    expect(sent.body.system).toBe("s");
    expect(sent.body.messages[0].content.map((c: { type: string }) => c.type)).toEqual([
      "image",
      "text",
    ]);
    expect(sent.body).not.toHaveProperty("temperature");
    expect(res).toEqual({
      text: "{}",
      stopReason: "end",
      usage: { inputTokens: 10, outputTokens: 2, imageTokens: 1334 },
    });
  });

  it.each([
    ["max_tokens", "max_tokens"],
    ["model_context_window_exceeded", "max_tokens"],
    ["refusal", "refusal"],
  ])("maps stop_reason %s to %s", async (stop, expected) => {
    const fetch = fetchReturning(anthropicMessage({ stop_reason: stop }));
    const a = new AnthropicAdapter(profile("claude-opus-5-5"), {
      env: { ANTHROPIC_API_KEY: "k" },
      fetch,
    });
    expect((await a.complete({ system: "", prompt: "" })).stopReason).toBe(expected);
  });

  it("fails fast when the API key env var is missing", () => {
    expect(() => new AnthropicAdapter(profile("claude-opus-5-5"), { env: {} })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe("OpenAIAdapter (SDK)", () => {
  it("sends text then images through chat completions and maps usage", async () => {
    const fetch = fetchReturning(openaiCompletion("stop"));
    const a = new OpenAIAdapter(openaiProfile, { env: { OPENAI_API_KEY: "k" }, fetch });
    const res = await a.complete({ system: "s", prompt: "p", images: [{ label: "full", png }] });
    const sent = sentBody(fetch);
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.headers.get("authorization")).toBe("Bearer k");
    expect(sent.body.messages[0]).toEqual({ role: "system", content: "s" });
    expect(sent.body.messages[1].content.map((c: { type: string }) => c.type)).toEqual([
      "text",
      "image_url",
    ]);
    expect(res).toEqual({
      text: "{}",
      stopReason: "end",
      usage: { inputTokens: 5, outputTokens: 1, imageTokens: 1334 },
    });
  });

  it.each([
    ["length", "max_tokens"],
    ["content_filter", "refusal"],
  ])("maps finish_reason %s to %s", async (finish, expected) => {
    const fetch = fetchReturning(openaiCompletion(finish));
    const a = new OpenAIAdapter(openaiProfile, { env: { OPENAI_API_KEY: "k" }, fetch });
    expect((await a.complete({ system: "", prompt: "" })).stopReason).toBe(expected);
  });
});

describe("OpenAICompatibleAdapter (HTTP, servers without an SDK)", () => {
  it("talks to the configured base URL without auth for local servers", async () => {
    const fetch = fetchReturning(openaiCompletion("stop"));
    vi.stubGlobal("fetch", fetch);
    const res = await new OpenAICompatibleAdapter(profile("local-ollama"), {}).complete({
      system: "s",
      prompt: "p",
    });
    const sent = sentBody(fetch);
    expect(sent.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(sent.headers.has("authorization")).toBe(false);
    expect(res).toEqual({
      text: "{}",
      stopReason: "end",
      usage: { inputTokens: 5, outputTokens: 1, imageTokens: 0 },
    });
  });

  it("maps finish_reason length to max_tokens", async () => {
    vi.stubGlobal("fetch", fetchReturning(openaiCompletion("length")));
    const res = await new OpenAICompatibleAdapter(profile("local-ollama"), {}).complete({
      system: "",
      prompt: "",
    });
    expect(res.stopReason).toBe("max_tokens");
  });
});
