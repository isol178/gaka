import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { REPO_ROOT } from "@gaka/harness";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../../evals/schema/suite.schema.json" with { type: "json" };

export type Tier = "deterministic" | "replay" | "live";
type Canvas = { width: number; height: number; seed: number };
type Condition = "A" | "B" | "C";

export type Case =
  | { id: string; kind: "schema"; dir: string; expect: "valid" | "invalid" }
  | { id: string; kind: "render-determinism"; painting: string }
  | { id: string; kind: "metrics"; painting: string; expect: Record<string, [number, number]> }
  | {
      id: string;
      kind: "replay-session";
      brief: string;
      cassette: string;
      condition: Condition;
      critic?: string;
      canvas?: Canvas;
      maxIterations?: number;
      maxRetries?: number;
      imageTokenBudget?: number;
      expect: {
        status?: "done" | "max_iterations" | "invalid_output";
        iterations?: number;
        maxRetries?: number;
        minFinalScore?: number;
        maxImageTokens?: number;
        imagesShownLast?: string[];
      };
    }
  | {
      id: string;
      kind: "live-session";
      brief: string;
      pairs: { painter: string; critic: string }[];
      judge?: string;
      conditions: Condition[];
      repeats?: number;
      canvas?: Canvas;
      maxIterations?: number;
      maxRetries?: number;
      imageTokenBudget?: number;
    };

export interface Suite {
  id: string;
  tier: Tier;
  description: string;
  cases: Case[];
}

const validate = new Ajv2020({ allErrors: true }).compile<Suite>(schema);

export const SUITES_DIR = join(REPO_ROOT, "evals/suites");

export function repoPath(p: string): string {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

export function loadSuite(path: string): Suite {
  const value: unknown = JSON.parse(readFileSync(repoPath(path), "utf8"));
  if (!validate(value)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`${path}: invalid suite: ${msg}`);
  }
  const ids = value.cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${path}: duplicate case id '${dup}'`);
  return value;
}
