import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePainting, validatePainting } from "../src/index.ts";

const fixtures = (kind: "valid" | "invalid") => {
  const dir = new URL(`./fixtures/${kind}/`, import.meta.url);
  return readdirSync(dir).map((f) => [f, readFileSync(new URL(f, dir), "utf8")] as const);
};

describe("validatePainting", () => {
  it.each(fixtures("valid"))("accepts %s", (_name, text) => {
    const r = parsePainting(text);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it.each(fixtures("invalid"))("rejects %s with a located error", (_name, text) => {
    const r = parsePainting(text);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.every((e) => e.startsWith("/") || e.startsWith("(root)"))).toBe(true);
  });

  it("rejects duplicate layer ids", () => {
    const r = validatePainting({
      version: "0.1",
      canvas: { width: 64, height: 64, seed: 0 },
      layers: [
        { id: "a", ops: [] },
        { id: "a", ops: [] },
      ],
    });
    expect(r).toMatchObject({ ok: false, errors: [expect.stringContaining("duplicate layer id")] });
  });
});

describe("parsePainting", () => {
  const minimal =
    '{"version":"0.1","canvas":{"width":64,"height":64,"seed":0},"layers":[{"id":"a","ops":[]}]}';

  it("accepts JSON wrapped in a fenced block", () => {
    expect(parsePainting(`Here you go:\n\`\`\`json\n${minimal}\n\`\`\``).ok).toBe(true);
  });

  it("accepts a bare fence without a language tag", () => {
    expect(parsePainting(`\`\`\`\n${minimal}\n\`\`\``).ok).toBe(true);
  });

  it("stays linear on adversarial fenced input (CodeQL js/polynomial-redos)", () => {
    const evil = `\`\`\`\n${"\n ".repeat(200_000)}`;
    const started = performance.now();
    expect(parsePainting(evil).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("reports malformed JSON instead of throwing", () => {
    const r = parsePainting("{ not json");
    expect(r).toMatchObject({ ok: false, errors: [expect.stringMatching(/^invalid JSON/)] });
  });
});
