import { readFileSync } from "node:fs";
import { type Layer, type Painting, parsePainting } from "@gaka/dsl";
import { describe, expect, it } from "vitest";
import { renderPainting } from "../src/node.ts";

function load(): Painting {
  const text = readFileSync(
    new URL("../../dsl/test/fixtures/valid/mountain-morning.json", import.meta.url),
    "utf8",
  );
  const r = parsePainting(text);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.painting;
}

describe("renderPainting", () => {
  it("is deterministic for the same DSL and seed", () => {
    const p = load();
    expect(renderPainting(p).pixelHash).toBe(renderPainting(p).pixelHash);
  });

  it("changes output when the seed changes", () => {
    const p = load();
    const q = { ...p, canvas: { ...p.canvas, seed: p.canvas.seed + 1 } };
    expect(renderPainting(p).pixelHash).not.toBe(renderPainting(q).pixelHash);
  });

  it("isolates RNG streams per layer (prepending a layer does not move later strokes)", () => {
    const p = load();
    // An invisible stroke layer consumes randomness. With one shared RNG this would shift every
    // later stroke; with per-(layer, op) derived streams the image must be pixel-identical.
    const invisible: Layer = {
      id: "probe",
      ops: [{ op: "stroke", palette: ["#000000"], density: "high", opacity: 0 }],
    };
    const withProbe: Painting = { ...p, layers: [invisible, ...p.layers] };
    expect(renderPainting(withProbe).pixelHash).toBe(renderPainting(p).pixelHash);
  });

  it("emits a PNG of the declared size", () => {
    const p = load();
    const { png, rgba } = renderPainting(p);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(rgba.length).toBe(p.canvas.width * p.canvas.height * 4);
  });
});
