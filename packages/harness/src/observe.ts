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

export function observe(input: ObserveInput): Observation {
  const dir = mkdtempSync(join(tmpdir(), "gaka-observe-"));
  try {
    const cur = join(dir, "current.png");
    writeFileSync(cur, input.png);
    const metrics = observerCli(["metrics", cur]) as Record<string, unknown>;

    // Candidate images in priority order; the budget decides how many are actually shown.
    const candidates: ImageInput[] = [];
    const cropTo = (label: string, box: Box) => {
      const out = join(dir, `${label.replace(/\W/g, "_")}.png`);
      observerCli([
        "crop",
        cur,
        out,
        ...Object.entries(box).flatMap(([k, v]) => [`--${k}`, String(v)]),
      ]);
      candidates.push({ label, png: readFileSync(out) });
    };

    if (input.condition === "A") {
      candidates.push({ label: "full", png: input.png });
    } else if (input.condition === "B" || input.condition === "C") {
      const thumb = join(dir, "thumb.png");
      observerCli(["thumbnail", cur, thumb, "--max-side", "256"]);
      candidates.push({ label: "thumbnail", png: readFileSync(thumb) });
    }
    if (input.condition === "C") {
      if (input.focus) cropTo("focus", input.focus);
      if (input.previousPng) {
        const prev = join(dir, "previous.png");
        writeFileSync(prev, input.previousPng);
        const diff = observerCli(["diff", prev, cur]) as { changed: boolean; box: Box | null };
        metrics.changed_region = diff.box;
        if (diff.box) cropTo("changed", diff.box);
      }
    }

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
