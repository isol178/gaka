import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfiles, MODEL_PROFILES_DIR, REPO_ROOT, type ScriptedTurn } from "../src/index.ts";

export const profiles = loadProfiles(MODEL_PROFILES_DIR);

export function profile(id: string) {
  const p = profiles.get(id);
  if (!p) throw new Error(`missing profile ${id}`);
  return p;
}

export function cassette(name: string): { painter: ScriptedTurn[]; critic: ScriptedTurn[] } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "evals/cassettes", `${name}.json`), "utf8"));
}

export const CANVAS = { width: 256, height: 192, seed: 42 };
