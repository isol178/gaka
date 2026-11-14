import type { CaseResult } from "./run-case.ts";

export interface Summary {
  runId: string;
  tiers: string[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Live tier: means per (painter, critic, condition) cell. */
  cells: Record<string, Record<string, number>>;
}

const NUMERIC_KEYS = [
  "judgeScore",
  "finalScore",
  "iterations",
  "retries",
  "inputTokens",
  "outputTokens",
  "imageTokens",
  "costUsd",
];

export function summarize(runId: string, tiers: string[], results: CaseResult[]): Summary {
  const cells: Summary["cells"] = {};
  const groups = new Map<string, CaseResult[]>();
  for (const r of results) {
    if (!r.variant || r.skipped) continue;
    const key = `${r.suite}/${r.caseId}:${r.variant.replace(/#\d+$/, "")}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rs] of groups) {
    const cell: Record<string, number> = {
      runs: rs.length,
      invalidRate: rs.filter((r) => !r.pass).length / rs.length,
    };
    for (const k of NUMERIC_KEYS) {
      const vals = rs.map((r) => r.metrics[k]).filter((v): v is number => typeof v === "number");
      if (vals.length > 0)
        cell[k] = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
    }
    cells[key] = cell;
  }
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.pass).length;
  return {
    runId,
    tiers,
    total: results.length,
    passed,
    failed: results.length - passed - skipped,
    skipped,
    cells,
  };
}

export function toMarkdown(summary: Summary, results: CaseResult[], deltas: string[] = []): string {
  const lines = [
    `## Gaka evals — ${summary.tiers.join(", ")}`,
    "",
    `**${summary.passed}/${summary.total - summary.skipped} passed**, ${summary.failed} failed, ${summary.skipped} skipped · run \`${summary.runId}\``,
    "",
    "| suite | case | variant | result | key metrics |",
    "|---|---|---|---|---|",
  ];
  for (const r of results) {
    const status = r.skipped
      ? `⏭ ${r.skipped}`
      : r.pass
        ? "✅"
        : `❌ ${r.errors.join("; ").slice(0, 200)}`;
    const m = Object.entries(r.metrics)
      .filter(([, v]) => v !== null)
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`| ${r.suite} | ${r.caseId} | ${r.variant ?? ""} | ${status} | ${m} |`);
  }
  if (Object.keys(summary.cells).length > 0) {
    lines.push(
      "",
      "### Live cells (means)",
      "",
      "| cell | judge | critic | iters | img tok | in tok | out tok | $ | invalid |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const [k, c] of Object.entries(summary.cells)) {
      lines.push(
        `| ${k} | ${c.judgeScore ?? ""} | ${c.finalScore ?? ""} | ${c.iterations ?? ""} | ${c.imageTokens ?? ""} | ${c.inputTokens ?? ""} | ${c.outputTokens ?? ""} | ${c.costUsd ?? ""} | ${c.invalidRate} |`,
      );
    }
  }
  if (deltas.length > 0)
    lines.push("", "### Change vs baseline", "", ...deltas.map((d) => `- ${d}`));
  return `${lines.join("\n")}\n`;
}
