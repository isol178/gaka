import { DSL_SCHEMA, type Painting } from "@gaka/dsl";

// Plain instructions + the schema + one small example: no model-specific prompt tricks (7.1).
const EXAMPLE = {
  version: "0.1",
  canvas: { width: 512, height: 384, seed: 7 },
  regions: { sky: { x: 0, y: 0, w: 1, h: 0.6 } },
  layers: [
    {
      id: "background",
      ops: [
        { op: "fill", color: "#9db7d5", colorTo: "#f2d8b8" },
        {
          op: "stroke",
          region: "sky",
          dir: "horizontal",
          length: "short",
          palette: ["#c9d8e8"],
          opacity: 0.4,
        },
      ],
    },
  ],
};

export const PAINTER_SYSTEM = `You are the Painter in a painting harness. You paint by writing JSON in the Gaka DSL.
Reply with exactly one JSON value and nothing else.
Coordinates and sizes are ratios from 0 to 1. Colors are #rrggbb.

DSL JSON Schema:
${JSON.stringify(DSL_SCHEMA)}

Example painting:
${JSON.stringify(EXAMPLE)}`;

export function painterFirstPrompt(brief: string, canvas: Painting["canvas"]): string {
  return `Brief: ${brief}
Canvas: ${JSON.stringify(canvas)} (use exactly this canvas).
Plan up to 3 layers (background, midground, subject) and return the full painting JSON.`;
}

export function painterRevisePrompt(
  brief: string,
  painting: Painting,
  fixes: { layer: string; instruction: string }[],
): string {
  return `Brief: ${brief}
Current painting:
${JSON.stringify(painting)}

Critic's requested fixes:
${fixes.map((f, i) => `${i + 1}. [${f.layer}] ${f.instruction}`).join("\n")}

Rewrite ONE layer to address the most important fix. Reply with {"layer": <the complete new layer object>}.
The layer replaces the existing layer with the same id. Region names must exist in the painting.`;
}

export function retryPrompt(previousPrompt: string, errors: string[]): string {
  return `${previousPrompt}

Your previous reply was rejected:
${errors.map((e) => `- ${e}`).join("\n")}
Fix these problems and reply with JSON only.`;
}

export const CRITIC_SYSTEM = `You are the Critic in a painting harness. Judge how well the painting fulfils the brief.
Be strict: a score of 7 or more means a viewer would call it a finished, pleasing painting.
Reply with exactly one JSON object:
{"score": 0-10, "done": boolean, "fixes": [{"layer": "<layer id>", "instruction": "<concrete change>"}] (at most 3, most important first),
 "focus": {"x","y","w","h"} (optional: a region you want to inspect at high resolution next time)}`;

export function criticPrompt(input: {
  brief: string;
  painting: Painting;
  metrics: Record<string, unknown>;
  imageLabels: string[];
  iteration: number;
  maxIterations: number;
}): string {
  const layers = input.painting.layers.map((l) => `${l.id}: ${l.ops.map((o) => o.op).join(", ")}`);
  return `Brief: ${input.brief}
Iteration ${input.iteration} of ${input.maxIterations}.
Layers:
${layers.join("\n")}
Image metrics (luminance/saturation in 0..1, grid is 3x3 mean luminance):
${JSON.stringify(input.metrics)}
Images attached: ${input.imageLabels.length > 0 ? input.imageLabels.join(", ") : "none (judge from metrics and layer list)"}`;
}
