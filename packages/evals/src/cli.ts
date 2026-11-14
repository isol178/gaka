// Usage:
//   pnpm eval run --tier deterministic --tier replay        (CI gate, no network)
//   pnpm eval run --tier live --max-cost-usd 5              (real models, costs money)
//   pnpm eval run --suite evals/suites/replay.json
//   pnpm eval run --tier live --update-baseline             (accept current live means)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadProfiles, MODEL_PROFILES_DIR, REPO_ROOT } from "@gaka/harness";
import { compareToBaseline, writeBaseline } from "./baseline.ts";
import { summarize, toMarkdown } from "./report.ts";
import { type CaseResult, type RunContext, runCase } from "./run-case.ts";
import { loadSuite, SUITES_DIR, type Suite, type Tier } from "./suite.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tier: { type: "string", multiple: true },
    suite: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    out: { type: "string" },
    "max-cost-usd": { type: "string", default: "5" },
    "update-baseline": { type: "boolean", default: false },
  },
});

if (positionals[0] !== "run") {
  console.error(
    "usage: eval run [--tier deterministic|replay|live]... [--suite path]... [--case id]... [--out dir]",
  );
  process.exit(2);
}

const suites: Suite[] = values.suite?.length
  ? values.suite.map(loadSuite)
  : readdirSync(SUITES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => loadSuite(join(SUITES_DIR, f)));
const tiers = (values.tier ?? ["deterministic", "replay"]) as Tier[];
const selected = suites.filter((s) => tiers.includes(s.tier));
if (selected.length === 0) {
  console.error(`no suites for tiers ${tiers.join(", ")}`);
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = values.out ?? join(REPO_ROOT, "evals/results", runId);
mkdirSync(outDir, { recursive: true });

const profiles = loadProfiles(MODEL_PROFILES_DIR);
const results: CaseResult[] = [];
let spentUsd = 0;
for (const suite of selected) {
  const ctx: RunContext = {
    suite: suite.id,
    profiles,
    env: process.env,
    spentUsd,
    maxCostUsd: Number(values["max-cost-usd"]),
  };
  for (const c of suite.cases) {
    if (values.case?.length && !values.case.includes(c.id)) continue;
    const rs = await runCase(c, ctx);
    for (const r of rs) {
      const mark = r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL";
      console.error(
        `${mark} ${suite.id}/${r.caseId}${r.variant ? ` [${r.variant}]` : ""} ${r.errors.join("; ")}`,
      );
    }
    results.push(...rs);
  }
  spentUsd = ctx.spentUsd;
}

const summary = summarize(runId, tiers, results);
const deltas = selected
  .filter((s) => s.tier === "live")
  .flatMap((s) => compareToBaseline(s.id, summary));
if (values["update-baseline"]) {
  for (const s of selected.filter((s) => s.tier === "live")) writeBaseline(s.id, summary);
}

writeFileSync(
  join(outDir, "results.jsonl"),
  `${results.map((r) => JSON.stringify(r)).join("\n")}\n`,
);
writeFileSync(
  join(outDir, "summary.json"),
  `${JSON.stringify({ ...summary, spentUsd }, null, 2)}\n`,
);
const md = toMarkdown(summary, results, deltas);
writeFileSync(join(outDir, "report.md"), md);
console.log(md);
console.error(`results: ${outDir}`);

// Deterministic and replay tiers gate: any failure fails the run. Live results never gate.
const gating = results.filter((r) => !r.skipped && !r.variant);
process.exit(gating.some((r) => !r.pass) ? 1 : 0);
