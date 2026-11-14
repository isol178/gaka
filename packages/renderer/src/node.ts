import { createHash } from "node:crypto";
import type { Painting } from "@gaka/dsl";
import { createCanvas } from "@napi-rs/canvas";
import { type Ctx2D, render } from "./render.ts";

/** Renderer identity recorded with every eval result (the concept pins one renderer for evals). */
export const RENDERER_ID = "napi-rs-canvas";

export interface RenderOutput {
  png: Buffer;
  rgba: Uint8ClampedArray;
  /** sha256 of raw RGBA pixels: stable across PNG encoder settings. */
  pixelHash: string;
}

export function renderPainting(p: Painting): RenderOutput {
  const canvas = createCanvas(p.canvas.width, p.canvas.height);
  const ctx = canvas.getContext("2d");
  render(ctx as unknown as Ctx2D, p);
  const rgba = ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data;
  return {
    png: canvas.toBuffer("image/png"),
    rgba,
    pixelHash: createHash("sha256").update(rgba).digest("hex"),
  };
}
