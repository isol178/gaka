import type { FillOp, GlazeOp, NoiseOp, Op, Painting, StrokeOp } from "@gaka/dsl";
import { createRng, deriveSeed, type Rng } from "./prng.ts";

/**
 * The subset of CanvasRenderingContext2D the renderer relies on. Both the browser context and
 * @napi-rs/canvas satisfy it, which keeps one rendering code path for harness and distribution.
 */
export interface Ctx2D {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  save(): void;
  restore(): void;
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): {
    addColorStop(offset: number, color: string): void;
  };
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(data: { data: Uint8ClampedArray }, x: number, y: number): void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveRect(p: Painting, regionName: string | undefined): Rect {
  const { width, height } = p.canvas;
  const r = regionName === undefined ? undefined : p.regions?.[regionName];
  if (regionName !== undefined && r === undefined)
    throw new Error(`unknown region '${regionName}'`);
  const reg = r ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.round(reg.x * width);
  const y = Math.round(reg.y * height);
  return {
    x,
    y,
    w: Math.max(1, Math.min(width - x, Math.round(reg.w * width))),
    h: Math.max(1, Math.min(height - y, Math.round(reg.h * height))),
  };
}

function fill(ctx: Ctx2D, rect: Rect, op: FillOp): void {
  ctx.globalAlpha = op.opacity ?? 1;
  if (op.colorTo === undefined) {
    ctx.fillStyle = op.color;
  } else {
    const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    g.addColorStop(0, op.color);
    g.addColorStop(1, op.colorTo);
    ctx.fillStyle = g;
  }
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function glaze(ctx: Ctx2D, rect: Rect, op: GlazeOp): void {
  ctx.globalAlpha = op.opacity;
  ctx.fillStyle = op.color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

const LENGTH = { short: 0.02, medium: 0.06, long: 0.15 } as const;
const WIDTH = { fine: 0.003, medium: 0.008, broad: 0.02 } as const;
const DENSITY = { low: 0.4, medium: 1, high: 2.5 } as const;
const ANGLE = { horizontal: 0, vertical: Math.PI / 2, diagonal: -Math.PI / 4 } as const;

function strokes(ctx: Ctx2D, rect: Rect, op: StrokeOp, rng: Rng, unit: number): void {
  const len = LENGTH[op.length ?? "medium"] * unit;
  const lineWidth = Math.max(1, WIDTH[op.width ?? "medium"] * unit);
  // Stroke count scales with area so density means the same thing at any resolution.
  const count = Math.round(
    ((rect.w * rect.h) / (len * lineWidth)) * 0.6 * DENSITY[op.density ?? "medium"],
  );
  const jitter = op.jitter ?? 0.1;
  ctx.globalAlpha = op.opacity ?? 0.6;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const dir = op.dir ?? "horizontal";
    const base = dir === "random" ? rng() * Math.PI : ANGLE[dir];
    const angle = base + (rng() - 0.5) * jitter * Math.PI;
    const cx = rect.x + rng() * rect.w;
    const cy = rect.y + rng() * rect.h;
    const l = len * (0.6 + rng() * 0.8);
    const dx = (Math.cos(angle) * l) / 2;
    const dy = (Math.sin(angle) * l) / 2;
    ctx.strokeStyle = op.palette[Math.floor(rng() * op.palette.length)] ?? op.palette[0];
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }
}

function noise(ctx: Ctx2D, rect: Rect, op: NoiseOp, rng: Rng): void {
  const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  const d = img.data;
  const amp = op.strength * 255;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 2 * amp;
    d[i] = (d[i] ?? 0) + n;
    d[i + 1] = (d[i + 1] ?? 0) + n;
    d[i + 2] = (d[i + 2] ?? 0) + n;
  }
  ctx.putImageData(img, rect.x, rect.y);
}

function applyOp(ctx: Ctx2D, p: Painting, op: Op, rng: Rng): void {
  const rect = resolveRect(p, op.region);
  const unit = Math.min(p.canvas.width, p.canvas.height);
  ctx.save();
  switch (op.op) {
    case "fill":
      fill(ctx, rect, op);
      break;
    case "glaze":
      glaze(ctx, rect, op);
      break;
    case "stroke":
      strokes(ctx, rect, op, rng, unit);
      break;
    case "noise":
      noise(ctx, rect, op, rng);
      break;
  }
  ctx.restore();
}

/**
 * Renders a validated painting. Each op gets its own RNG stream derived from
 * (seed, layer id, op index), so editing one layer never changes the strokes of another.
 */
export function render(ctx: Ctx2D, p: Painting): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
  ctx.restore();
  for (const layer of p.layers) {
    layer.ops.forEach((op, i) => {
      applyOp(ctx, p, op, createRng(deriveSeed(p.canvas.seed, layer.id, i)));
    });
  }
}
