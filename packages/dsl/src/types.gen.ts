/* Generated from schema/gaka-dsl.schema.json by scripts/gen-types.ts. Do not edit by hand; run `pnpm gen`. */

/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Ratio".
 */
export type Ratio = number;
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Identifier".
 */
export type Identifier = string;
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Op".
 */
export type Op = FillOp | StrokeOp | GlazeOp | NoiseOp;
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Color".
 */
export type Color = string;
/**
 * Name of a region declared in `regions`. Omit to target the whole canvas.
 *
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "RegionRef".
 */
export type RegionRef = string;

/**
 * Gaka brush-stroke DSL (MVP subset: stroke / fill / glaze / noise). Coordinates and sizes are ratios in [0, 1].
 */
export interface Painting {
  version: "0.1";
  canvas: Canvas;
  regions?: {
    [k: string]: Region;
  };
  /**
   * @minItems 1
   * @maxItems 8
   */
  layers: [Layer, ...Layer[]];
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Canvas".
 */
export interface Canvas {
  width: number;
  height: number;
  seed: number;
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Region".
 */
export interface Region {
  x: Ratio;
  y: Ratio;
  w: Ratio;
  h: Ratio;
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "Layer".
 */
export interface Layer {
  id: Identifier;
  /**
   * @maxItems 64
   */
  ops: Op[];
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "FillOp".
 */
export interface FillOp {
  op: "fill";
  /**
   * Name of a region declared in `regions`. Omit to target the whole canvas.
   */
  region?: string;
  color: Color;
  /**
   * Optional second color for a vertical gradient.
   */
  colorTo?: string;
  opacity?: number;
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "StrokeOp".
 */
export interface StrokeOp {
  op: "stroke";
  /**
   * Name of a region declared in `regions`. Omit to target the whole canvas.
   */
  region?: string;
  dir?: "horizontal" | "vertical" | "diagonal" | "random";
  length?: "short" | "medium" | "long";
  width?: "fine" | "medium" | "broad";
  density?: "low" | "medium" | "high";
  /**
   * @minItems 1
   * @maxItems 8
   */
  palette: [Color, ...Color[]];
  jitter?: number;
  opacity?: number;
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "GlazeOp".
 */
export interface GlazeOp {
  op: "glaze";
  /**
   * Name of a region declared in `regions`. Omit to target the whole canvas.
   */
  region?: string;
  color: Color;
  opacity: Ratio;
}
/**
 * This interface was referenced by `Painting`'s JSON-Schema
 * via the `definition` "NoiseOp".
 */
export interface NoiseOp {
  op: "noise";
  /**
   * Name of a region declared in `regions`. Omit to target the whole canvas.
   */
  region?: string;
  strength: number;
}
