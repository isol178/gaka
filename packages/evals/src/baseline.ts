import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@gaka/harness";
import type { Summary } from "./report.ts";

/**
 * Live-tier baselines: per-cell means from an accepted run. Live results are noisy and never
 * gate CI; deltas are reported so a reviewer can judge them. Deterministic and replay tiers
 * need no baseline: every case must pass.
 *
 * Baseline files are only written via `--update-baseline` (the Claude Code hooks block
 * hand edits) so a regression cannot be "fixed" by editing the expectation.
 */
const BASELINE_DIR = join(REPO_ROOT, "evals/baselines");

export function baselinePath(suiteId: string): string {
  return join(BASELINE_DIR, `${suiteId}.json`);
}

export function compareToBaseline(suiteId: string, summary: Summary): string[] {
  const path = baselinePath(suiteId);
  if (!existsSync(path))
    return [`no baseline for ${suiteId} (run with --update-baseline to create one)`];
  const base = JSON.parse(readFileSync(path, "utf8")) as { cells: Summary["cells"] };
  const out: string[] = [];
  for (const [cell, now] of Object.entries(summary.cells)) {
    if (!cell.startsWith(`${suiteId}/`)) continue;
    const before = base.cells[cell];
    if (!before) {
      out.push(`${cell}: new cell`);
      continue;
    }
    const fmt = (k: string) => {
      const a = before[k];
      const b = now[k];
      if (a === undefined || b === undefined) return undefined;
      const d = b - a;
      return `${k} ${a}→${b} (${d >= 0 ? "+" : ""}${Number(d.toFixed(4))})`;
    };
    out.push(
      `${cell}: ${["judgeScore", "imageTokens", "costUsd", "invalidRate"].map(fmt).filter(Boolean).join(", ")}`,
    );
  }
  return out;
}

export function writeBaseline(suiteId: string, summary: Summary): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const cells = Object.fromEntries(
    Object.entries(summary.cells).filter(([k]) => k.startsWith(`${suiteId}/`)),
  );
  writeFileSync(
    baselinePath(suiteId),
    `${JSON.stringify({ suite: suiteId, runId: summary.runId, cells }, null, 2)}\n`,
  );
}
