import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractJson, type Layer, type Painting, validatePainting } from "@gaka/dsl";
import { renderPainting } from "@gaka/renderer/node";
import { type Critique, parseCritique } from "./critique.ts";
import {
  addUsage,
  type ModelAdapter,
  type ModelRequest,
  type Usage,
  ZERO_USAGE,
} from "./model/types.ts";
import { type ObservationCondition, observe } from "./observe.ts";
import {
  CRITIC_SYSTEM,
  criticPrompt,
  PAINTER_SYSTEM,
  painterFirstPrompt,
  painterRevisePrompt,
  retryPrompt,
} from "./prompts.ts";

export interface SessionConfig {
  brief: string;
  canvas: Painting["canvas"];
  painter: ModelAdapter;
  critic: ModelAdapter;
  maxIterations: number;
  /** Re-asks allowed per model call when the reply is not valid JSON for the schema. */
  maxRetries: number;
  observation: ObservationCondition;
  /** Image-token budget per critic call (concept section 10). */
  imageTokenBudget: number;
  /** When set, every iteration's DSL, render and critique is written here for rewind/inspection. */
  outDir?: string;
}

export type SessionStatus = "done" | "max_iterations" | "invalid_output";

export interface IterationRecord {
  index: number;
  painting: Painting;
  painterAttempts: number;
  criticAttempts: number;
  rejected: string[][];
  pixelHash: string;
  metrics: Record<string, unknown>;
  imagesShown: string[];
  imagesDropped: string[];
  critique: Critique;
}

export interface SessionRecord {
  brief: string;
  observation: ObservationCondition;
  status: SessionStatus;
  iterations: IterationRecord[];
  usage: { painter: Usage; critic: Usage };
  finalPainting?: Painting;
  finalScore?: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Calls a model, re-asking with the validation errors until the reply parses or retries run out. */
async function callWithRetry<T>(
  model: ModelAdapter,
  req: ModelRequest,
  parse: (text: string) => Parsed<T>,
  maxRetries: number,
  onUsage: (u: Usage) => void,
): Promise<{ value?: T; attempts: number; rejected: string[][] }> {
  const rejected: string[][] = [];
  let prompt = req.prompt;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const res = await model.complete({ ...req, prompt });
    onUsage(res.usage);
    const parsed = parse(res.text);
    if (parsed.ok) return { value: parsed.value, attempts: attempt, rejected };
    rejected.push(parsed.errors);
    prompt = retryPrompt(req.prompt, parsed.errors);
  }
  return { attempts: maxRetries + 1, rejected };
}

function parseFullPainting(canvas: Painting["canvas"]) {
  return (text: string): Parsed<Painting> => {
    const json = extractJson(text);
    if (!json.ok) return { ok: false, errors: [json.error] };
    const r = validatePainting(json.value);
    if (!r.ok) return { ok: false, errors: r.errors };
    // The harness owns the canvas (size + seed) so runs stay reproducible and comparable.
    return { ok: true, value: { ...r.painting, canvas } };
  };
}

/** Layer-level full replacement (concept 7.1): more robust across models than diff patches. */
export function replaceLayer(painting: Painting, layer: Layer): Painting {
  const idx = painting.layers.findIndex((l) => l.id === layer.id);
  const layers = [...painting.layers];
  if (idx >= 0) layers[idx] = layer;
  else layers.push(layer);
  return { ...painting, layers: layers as Painting["layers"] };
}

function parseLayerReplacement(current: Painting) {
  return (text: string): Parsed<Painting> => {
    const json = extractJson(text);
    if (!json.ok) return { ok: false, errors: [json.error] };
    const layer = (json.value as { layer?: unknown } | null)?.layer;
    if (typeof layer !== "object" || layer === null) {
      return { ok: false, errors: ['(root): expected {"layer": {...}}'] };
    }
    const r = validatePainting(replaceLayer(current, layer as Layer));
    return r.ok ? { ok: true, value: r.painting } : { ok: false, errors: r.errors };
  };
}

function parseCritiqueResult(text: string): Parsed<Critique> {
  const r = parseCritique(text);
  return r.ok ? { ok: true, value: r.critique } : r;
}

export async function runSession(cfg: SessionConfig): Promise<SessionRecord> {
  const record: SessionRecord = {
    brief: cfg.brief,
    observation: cfg.critic.profile.vision ? cfg.observation : "numeric",
    status: "max_iterations",
    iterations: [],
    usage: { painter: ZERO_USAGE, critic: ZERO_USAGE },
  };
  if (cfg.outDir) mkdirSync(cfg.outDir, { recursive: true });

  let painting: Painting | undefined;
  let previousPng: Buffer | undefined;
  let lastCritique: Critique | undefined;

  for (let i = 1; i <= cfg.maxIterations; i++) {
    const painterReq: ModelRequest = {
      system: PAINTER_SYSTEM,
      prompt:
        painting === undefined || lastCritique === undefined
          ? painterFirstPrompt(cfg.brief, cfg.canvas)
          : painterRevisePrompt(cfg.brief, painting, lastCritique.fixes),
    };
    const painted = await callWithRetry(
      cfg.painter,
      painterReq,
      painting === undefined ? parseFullPainting(cfg.canvas) : parseLayerReplacement(painting),
      cfg.maxRetries,
      (u) => {
        record.usage.painter = addUsage(record.usage.painter, u);
      },
    );
    if (painted.value === undefined) {
      record.status = "invalid_output";
      break;
    }
    painting = painted.value;

    const rendered = renderPainting(painting);
    const obs = observe({
      png: rendered.png,
      previousPng,
      focus: lastCritique?.focus,
      condition: record.observation,
      criticProfile: cfg.critic.profile,
      imageTokenBudget: cfg.imageTokenBudget,
    });

    const criticReq: ModelRequest = {
      system: CRITIC_SYSTEM,
      prompt: criticPrompt({
        brief: cfg.brief,
        painting,
        metrics: obs.metrics,
        imageLabels: obs.images.map((im) => im.label),
        iteration: i,
        maxIterations: cfg.maxIterations,
      }),
      images: obs.images,
    };
    const critiqued = await callWithRetry(
      cfg.critic,
      criticReq,
      parseCritiqueResult,
      cfg.maxRetries,
      (u) => {
        record.usage.critic = addUsage(record.usage.critic, u);
      },
    );
    if (critiqued.value === undefined) {
      record.status = "invalid_output";
      break;
    }

    const iteration: IterationRecord = {
      index: i,
      painting,
      painterAttempts: painted.attempts,
      criticAttempts: critiqued.attempts,
      rejected: [...painted.rejected, ...critiqued.rejected],
      pixelHash: rendered.pixelHash,
      metrics: obs.metrics,
      imagesShown: obs.images.map((im) => im.label),
      imagesDropped: obs.dropped,
      critique: critiqued.value,
    };
    record.iterations.push(iteration);
    if (cfg.outDir) {
      const stem = join(cfg.outDir, `iter-${String(i).padStart(2, "0")}`);
      writeFileSync(`${stem}.png`, rendered.png);
      writeFileSync(`${stem}.json`, `${JSON.stringify(iteration, null, 2)}\n`);
    }

    previousPng = rendered.png;
    lastCritique = critiqued.value;
    if (lastCritique.done) {
      record.status = "done";
      break;
    }
  }

  if (painting !== undefined) record.finalPainting = painting;
  const last = record.iterations.at(-1);
  if (last) record.finalScore = last.critique.score;
  if (cfg.outDir)
    writeFileSync(join(cfg.outDir, "session.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
