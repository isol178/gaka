import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import schema from "../schema/gaka-dsl.schema.json" with { type: "json" };
import type { Painting } from "./types.gen.ts";

export type ValidationResult = { ok: true; painting: Painting } | { ok: false; errors: string[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<Painting>(schema);

export const DSL_SCHEMA = schema;

function formatAjvError(e: ErrorObject): string {
  const at = e.instancePath === "" ? "(root)" : e.instancePath;
  const extra =
    e.keyword === "additionalProperties"
      ? ` '${String((e.params as { additionalProperty: string }).additionalProperty)}'`
      : e.keyword === "enum"
        ? ` ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)}`
        : "";
  return `${at}: ${e.message ?? e.keyword}${extra}`;
}

/** Checks that cannot be expressed in JSON Schema (cross-references). */
function semanticErrors(p: Painting): string[] {
  const errors: string[] = [];
  const regions = new Set(Object.keys(p.regions ?? {}));
  const layerIds = new Set<string>();
  p.layers.forEach((layer, li) => {
    if (layerIds.has(layer.id)) errors.push(`/layers/${li}/id: duplicate layer id '${layer.id}'`);
    layerIds.add(layer.id);
    layer.ops.forEach((op, oi) => {
      if (op.region !== undefined && !regions.has(op.region)) {
        errors.push(`/layers/${li}/ops/${oi}/region: unknown region '${op.region}'`);
      }
    });
  });
  return errors;
}

/** Validates an already-parsed value against the DSL schema plus semantic rules. */
export function validatePainting(value: unknown): ValidationResult {
  if (!validateSchema(value)) {
    // oneOf failures produce one error per branch; keep the output short for model feedback.
    const errors = [...new Set((validateSchema.errors ?? []).map(formatAjvError))].slice(0, 20);
    return { ok: false, errors };
  }
  const errors = semanticErrors(value);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, painting: value };
}

/**
 * Body of the first ``` fenced block, or undefined. Uses indexOf instead of a regex: model output
 * is untrusted, and the natural regex backtracks polynomially on crafted input (ReDoS).
 */
function fencedBody(text: string): string | undefined {
  const open = text.indexOf("```");
  if (open < 0) return undefined;
  const bodyStart = text.indexOf("\n", open + 3);
  if (bodyStart < 0) return undefined;
  const info = text.slice(open + 3, bodyStart).trim();
  if (info !== "" && info !== "json") return undefined;
  const close = text.indexOf("\n```", bodyStart);
  return close < 0 ? undefined : text.slice(bodyStart + 1, close);
}

/**
 * Extracts a JSON value from raw model output. Accepts bare JSON or a single fenced block,
 * because the harness only assumes "the model returns text containing JSON".
 */
export function extractJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidate = (fencedBody(text) ?? text).trim();
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
}

export function parsePainting(text: string): ValidationResult {
  const json = extractJson(text);
  return json.ok ? validatePainting(json.value) : { ok: false, errors: [json.error] };
}
