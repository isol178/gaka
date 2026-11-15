import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CapabilityProfile, estimateImageTokens, type ImageInput } from "./model/types.ts";
import { OBSERVER_DIR } from "./paths.ts";

/**
 * Observation conditions from the concept's MVP comparison (section 13):
 *   A: full image every time (baseline)
 *   B: thumbnail + numeric metrics
 *   C: B + changed-region crop + critic-requested focus crop
 *   numeric: metrics only (used automatically when the critic cannot see images)
 */
export type ObservationCondition = "A" | "B" | "C" | "numeric";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Observation {
  metrics: Record<string, unknown>;
  images: ImageInput[];
  /** Images that were prepared but dropped to stay within the image-token budget. */
  dropped: string[];
  imageTokens: number;
}

function observerCli(args: string[]): unknown {
  const r = spawnSync(
    "uv",
    ["run", "--quiet", "--project", OBSERVER_DIR, "gaka-observe", ...args],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `gaka-observe ${args[0]} failed (${r.status}): ${r.stderr || r.error?.message}`,
    );
  }
  return JSON.parse(r.stdout);
}

export interface ObserveInput {
  png: Buffer;
  previousPng?: Buffer | undefined;
  focus?: Box | undefined;
  condition: ObservationCondition;
  criticProfile: CapabilityProfile;
  imageTokenBudget: number;
}

interface ObserverResult {
  metrics: Record<string, unknown>;
  thumbnail?: string;
  focus?: string;
  changed_region?: Box | null;
  changed?: string;
}

export function observe(input: ObserveInput): Observation {
  const dir = mkdtempSync(join(tmpdir(), "gaka-observe-"));
  try {
    const cur = join(dir, "current.png");
    writeFileSync(cur, input.png);
    const args = ["observe", cur, join(dir, "views")];
    const c = input.condition;
    if (c === "B" || c === "C") args.push("--thumbnail", "--max-side", "256");
    if (c === "C" && input.focus) {
      const { x, y, w, h } = input.focus;
      args.push("--focus", ...[x, y, w, h].map(String));
    }
    if (c === "C" && input.previousPng) {
      const prev = join(dir, "previous.png");
      writeFileSync(prev, input.previousPng);
      args.push("--previous", prev);
    }
    // One process per observation: uv and the numpy/Pillow import dominate each spawn's cost.
    const r = observerCli(args) as ObserverResult;
    const metrics = r.metrics;
    if (r.changed_region !== undefined) metrics.changed_region = r.changed_region;

    // Candidate images in priority order; the budget decides how many are actually shown.
    const candidates: ImageInput[] = [];
    if (c === "A") candidates.push({ label: "full", png: input.png });
    if (r.thumbnail) candidates.push({ label: "thumbnail", png: readFileSync(r.thumbnail) });
    if (r.focus) candidates.push({ label: "focus", png: readFileSync(r.focus) });
    if (r.changed) candidates.push({ label: "changed", png: readFileSync(r.changed) });

    const images: ImageInput[] = [];
    const dropped: string[] = [];
    let spent = 0;
    for (const img of candidates) {
      const cost = estimateImageTokens(input.criticProfile, img.png);
      if (spent + cost <= input.imageTokenBudget) {
        images.push(img);
        spent += cost;
      } else {
        dropped.push(img.label);
      }
    }
    return { metrics, images, dropped, imageTokens: spent };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
