import { extractJson } from "@gaka/dsl";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schema/critique.schema.json" with { type: "json" };
import type { Box } from "./observe.ts";

export interface Critique {
  score: number;
  done: boolean;
  fixes: { layer: string; instruction: string }[];
  focus?: Box;
}

const validate = new Ajv2020({ allErrors: true }).compile<Critique>(schema);

export function parseCritique(
  text: string,
): { ok: true; critique: Critique } | { ok: false; errors: string[] } {
  const json = extractJson(text);
  if (!json.ok) return { ok: false, errors: [json.error] };
  if (!validate(json.value)) {
    return {
      ok: false,
      errors: (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"}: ${e.message}`),
    };
  }
  return { ok: true, critique: json.value };
}
