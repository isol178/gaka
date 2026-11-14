import { describe, expect, it } from "vitest";
import { createRng, deriveSeed } from "../src/prng.ts";

describe("createRng", () => {
  it("produces a fixed sequence for a seed (golden; platform-independent integer math)", () => {
    const rng = createRng(42);
    const seq = Array.from({ length: 4 }, () => rng().toFixed(10));
    expect(seq).toMatchInlineSnapshot(`
      [
        "0.6011037519",
        "0.4482905590",
        "0.8524657935",
        "0.6697340414",
      ]
    `);
  });

  it("stays in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("deriveSeed", () => {
  it("separates streams by path", () => {
    expect(deriveSeed(1, "sky", 0)).not.toBe(deriveSeed(1, "sky", 1));
    expect(deriveSeed(1, "sky", 0)).toBe(deriveSeed(1, "sky", 0));
  });
});
