import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicAdapter,
  createAdapter,
  OpenAICompatibleAdapter,
  parseProfile,
} from "../src/index.ts";
import { profile, profiles } from "./helpers.ts";

// 1x1 PNG header is enough for size parsing: IHDR width/height at bytes 16..24.
const png = Buffer.alloc(33);
png.writeUInt32BE(1000, 16);
png.writeUInt32BE(1000, 20);

function mockFetch(body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

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
});

describe("AnthropicAdapter", () => {
  it("sends images before text and maps usage", async () => {
    const fetch = mockFetch({
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const a = new AnthropicAdapter(profile("claude-opus-5-5"), { ANTHROPIC_API_KEY: "k" });
    const res = await a.complete({ system: "s", prompt: "p", images: [{ label: "full", png }] });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content.map((c: { type: string }) => c.type)).toEqual([
      "image",
      "text",
    ]);
    expect(body).not.toHaveProperty("temperature");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 2, imageTokens: 1334 });
  });

  it("fails fast when the API key env var is missing", async () => {
    await expect(
      new AnthropicAdapter(profile("claude-opus-5-5"), {}).complete({ system: "", prompt: "" }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("OpenAICompatibleAdapter", () => {
  it("talks to the configured base URL without auth for local servers", async () => {
    const fetch = mockFetch({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });
    const res = await new OpenAICompatibleAdapter(profile("local-ollama"), {}).complete({
      system: "s",
      prompt: "p",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(res).toEqual({ text: "{}", usage: { inputTokens: 5, outputTokens: 1, imageTokens: 0 } });
  });
});
