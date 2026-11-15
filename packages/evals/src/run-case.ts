import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePainting } from "@gaka/dsl";
import {
  type CapabilityProfile,
  costUsd,
  createAdapter,
  type ModelAdapter,
  observe,
  runSession,
  ScriptedAdapter,
  type ScriptedTurn,
  SessionError,
  type SessionRecord,
} from "@gaka/harness";
import { renderPainting } from "@gaka/renderer/node";
import { JudgeError, judge } from "./judge.ts";
import { type Case, repoPath } from "./suite.ts";

export interface CaseResult {
  suite: string;
  caseId: string;
  /** Distinguishes matrix cells of one case, e.g. "painter/critic/B#1". */
  variant?: string;
  pass: boolean;
  skipped?: string;
  errors: string[];
  metrics: Record<string, number | string | boolean | null>;
  durationMs: number;
}

export interface RunContext {
  suite: string;
  profiles: Map<string, CapabilityProfile>;
  env: NodeJS.ProcessEnv;
  /** Running total for the live-tier cost guard. */
  spentUsd: number;
  maxCostUsd: number;
}

function profileOf(ctx: RunContext, id: string): CapabilityProfile {
  const p = ctx.profiles.get(id);
  if (!p) throw new Error(`unknown model profile '${id}'`);
  return p;
}

function loadPainting(path: string) {
  const r = parsePainting(readFileSync(repoPath(path), "utf8"));
  if (!r.ok) throw new Error(`${path}: ${r.errors.join("; ")}`);
  return r.painting;
}

/** Env vars the profiles need that are not set. Checked up front so a missing key is a skip, not a failure. */
function missingEnv(ctx: RunContext, ...profiles: CapabilityProfile[]): string[] {
  return profiles.map((p) => p.apiKeyEnv).filter((k): k is string => !!k && !ctx.env[k]);
}

function sessionMetrics(record: SessionRecord): CaseResult["metrics"] {
  const iters = record.iterations;
  return {
    status: record.status,
    iterations: iters.length,
    finalScore: record.finalScore ?? null,
    retries: iters.reduce((n, it) => n + it.painterAttempts - 1 + it.criticAttempts - 1, 0),
    inputTokens: record.usage.painter.inputTokens + record.usage.critic.inputTokens,
    outputTokens: record.usage.painter.outputTokens + record.usage.critic.outputTokens,
    imageTokens: record.usage.critic.imageTokens,
  };
}

async function runOne(
  c: Case,
  ctx: RunContext,
): Promise<Omit<CaseResult, "suite" | "caseId" | "durationMs">[]> {
  switch (c.kind) {
    case "schema": {
      const dir = repoPath(c.dir);
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      const errors = files.flatMap((f) => {
        const r = parsePainting(readFileSync(join(dir, f), "utf8"));
        if (c.expect === "valid" && !r.ok) return [`${f}: ${r.errors.join("; ")}`];
        if (c.expect === "invalid" && r.ok) return [`${f}: unexpectedly valid`];
        return [];
      });
      return [
        { pass: files.length > 0 && errors.length === 0, errors, metrics: { files: files.length } },
      ];
    }
    case "render-determinism": {
      const p = loadPainting(c.painting);
      const a = renderPainting(p).pixelHash;
      const b = renderPainting(p).pixelHash;
      return [
        { pass: a === b, errors: a === b ? [] : [`hash ${a} != ${b}`], metrics: { pixelHash: a } },
      ];
    }
    case "metrics": {
      const png = renderPainting(loadPainting(c.painting)).png;
      const profile = profileOf(ctx, "scripted");
      const m = observe({
        png,
        condition: "numeric",
        criticProfile: profile,
        imageTokenBudget: 0,
      }).metrics;
      const errors: string[] = [];
      const metrics: CaseResult["metrics"] = {};
      for (const [key, [lo, hi]] of Object.entries(c.expect)) {
        const v = m[key];
        metrics[key] = typeof v === "number" ? v : null;
        if (typeof v !== "number" || v < lo || v > hi)
          errors.push(`${key}=${String(v)} not in [${lo}, ${hi}]`);
      }
      return [{ pass: errors.length === 0, errors, metrics }];
    }
    case "replay-session": {
      const cassette = JSON.parse(readFileSync(repoPath(c.cassette), "utf8")) as {
        painter: ScriptedTurn[];
        critic: ScriptedTurn[];
      };
      const record = await runSession({
        brief: c.brief,
        canvas: c.canvas ?? { width: 256, height: 192, seed: 42 },
        painter: new ScriptedAdapter(profileOf(ctx, "scripted"), cassette.painter),
        critic: new ScriptedAdapter(profileOf(ctx, c.critic ?? "scripted"), cassette.critic),
        maxIterations: c.maxIterations ?? 5,
        maxRetries: c.maxRetries ?? 2,
        observation: c.condition,
        imageTokenBudget: c.imageTokenBudget ?? 4000,
      });
      const metrics = sessionMetrics(record);
      const e = c.expect;
      const errors: string[] = [];
      const check = (ok: boolean, msg: string) => {
        if (!ok) errors.push(msg);
      };
      if (e.status) check(record.status === e.status, `status ${record.status} != ${e.status}`);
      if (e.iterations !== undefined)
        check(
          metrics.iterations === e.iterations,
          `iterations ${metrics.iterations} != ${e.iterations}`,
        );
      if (e.maxRetries !== undefined)
        check(
          Number(metrics.retries) <= e.maxRetries,
          `retries ${metrics.retries} > ${e.maxRetries}`,
        );
      if (e.minFinalScore !== undefined)
        check(
          (record.finalScore ?? -1) >= e.minFinalScore,
          `finalScore ${record.finalScore} < ${e.minFinalScore}`,
        );
      if (e.maxImageTokens !== undefined)
        check(
          Number(metrics.imageTokens) <= e.maxImageTokens,
          `imageTokens ${metrics.imageTokens} > ${e.maxImageTokens}`,
        );
      if (e.imagesShownLast) {
        const shown = record.iterations.at(-1)?.imagesShown ?? [];
        check(
          JSON.stringify(shown) === JSON.stringify(e.imagesShownLast),
          `imagesShown ${JSON.stringify(shown)} != ${JSON.stringify(e.imagesShownLast)}`,
        );
      }
      return [{ pass: errors.length === 0, errors, metrics }];
    }
    case "live-session": {
      const out: Omit<CaseResult, "suite" | "caseId" | "durationMs">[] = [];
      // A missing judge key must not fail the case: live results are recorded per variant and never
      // gate. Without the key the sessions still run and only the judge score is left out.
      const judgeProfile = c.judge ? profileOf(ctx, c.judge) : undefined;
      const judgeMissing = judgeProfile ? missingEnv(ctx, judgeProfile) : [];
      const judgeModel: ModelAdapter | undefined =
        judgeProfile && judgeMissing.length === 0
          ? createAdapter(judgeProfile, ctx.env)
          : undefined;
      for (const pair of c.pairs) {
        for (const condition of c.conditions) {
          for (let rep = 1; rep <= (c.repeats ?? 1); rep++) {
            const variant = `${pair.painter}/${pair.critic}/${condition}#${rep}`;
            if (ctx.spentUsd >= ctx.maxCostUsd) {
              out.push({
                variant,
                pass: false,
                skipped: `cost guard: $${ctx.spentUsd.toFixed(2)} spent`,
                errors: [],
                metrics: {},
              });
              continue;
            }
            const pp = profileOf(ctx, pair.painter);
            const cp = profileOf(ctx, pair.critic);
            const missing = missingEnv(ctx, pp, cp);
            if (missing.length > 0) {
              out.push({
                variant,
                pass: false,
                skipped: `missing env ${missing.join(", ")}`,
                errors: [],
                metrics: {},
              });
              continue;
            }
            let record: SessionRecord;
            const errors: string[] = [];
            try {
              record = await runSession({
                brief: c.brief,
                canvas: c.canvas ?? { width: 1024, height: 768, seed: 42 },
                painter: createAdapter(pp, ctx.env),
                critic: createAdapter(cp, ctx.env),
                maxIterations: c.maxIterations ?? 5,
                maxRetries: c.maxRetries ?? 2,
                observation: condition,
                imageTokenBudget: c.imageTokenBudget ?? 4000,
              });
            } catch (err) {
              if (!(err instanceof SessionError)) {
                out.push({ variant, pass: false, errors: [(err as Error).message], metrics: {} });
                continue;
              }
              // The calls made before the failure were billed: count them toward the guard.
              record = err.record;
              errors.push(err.message);
            }
            const metrics = sessionMetrics(record);
            const cost = costUsd(pp, record.usage.painter) + costUsd(cp, record.usage.critic);
            metrics.costUsd = Number(cost.toFixed(4));
            ctx.spentUsd += cost;
            const ok =
              errors.length === 0 &&
              record.status !== "invalid_output" &&
              record.status !== "refused";
            if (ok && judgeMissing.length > 0) {
              metrics.judgeSkipped = `missing env ${judgeMissing.join(", ")}`;
            } else if (ok && judgeModel && record.finalPainting) {
              // A judge failure is the judge's problem: keep the session's own result and metrics.
              try {
                const j = await judge(
                  judgeModel,
                  c.brief,
                  renderPainting(record.finalPainting).png,
                );
                metrics.judgeScore = j.score.score;
                // Judge spend counts toward the cost guard but not the run's efficiency metrics.
                ctx.spentUsd += costUsd(judgeModel.profile, j.usage);
              } catch (err) {
                metrics.judgeError = (err as Error).message;
                if (err instanceof JudgeError)
                  ctx.spentUsd += costUsd(judgeModel.profile, err.usage);
              }
            }
            out.push({ variant, pass: ok, errors, metrics });
          }
        }
      }
      return out;
    }
  }
}

export async function runCase(c: Case, ctx: RunContext): Promise<CaseResult[]> {
  const started = performance.now();
  try {
    const results = await runOne(c, ctx);
    const durationMs = Math.round(performance.now() - started);
    return results.map((r) => ({ suite: ctx.suite, caseId: c.id, durationMs, ...r }));
  } catch (err) {
    return [
      {
        suite: ctx.suite,
        caseId: c.id,
        pass: false,
        errors: [(err as Error).message],
        metrics: {},
        durationMs: Math.round(performance.now() - started),
      },
    ];
  }
}
