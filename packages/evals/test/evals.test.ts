import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadProfiles, MODEL_PROFILES_DIR } from "@gaka/harness";
import { describe, expect, it } from "vitest";
import {
  type Case,
  loadSuite,
  type RunContext,
  runCase,
  SUITES_DIR,
  summarize,
} from "../src/index.ts";

const ctx = (env: NodeJS.ProcessEnv = {}): RunContext => ({
  suite: "test",
  profiles: loadProfiles(MODEL_PROFILES_DIR),
  env,
  spentUsd: 0,
  maxCostUsd: 1,
});

describe("suites", () => {
  it.each(readdirSync(SUITES_DIR))("%s is a valid suite", (f) => {
    expect(() => loadSuite(join(SUITES_DIR, f))).not.toThrow();
  });
});

describe("runCase", () => {
  const replay = (expect: Extract<Case, { kind: "replay-session" }>["expect"]): Case => ({
    id: "r",
    kind: "replay-session",
    brief: "b",
    cassette: "evals/cassettes/landscape-retry.json",
    condition: "B",
    expect,
  });

  it("fails a replay case whose expectation is not met (the gate can actually fail)", async () => {
    const [r] = await runCase(replay({ iterations: 3 }), ctx());
    expect(r?.pass).toBe(false);
    expect(r?.errors[0]).toMatch(/iterations 2 != 3/);
  });

  it("reports a missing cassette as a failure instead of throwing", async () => {
    const [r] = await runCase(
      { ...replay({}), cassette: "evals/cassettes/nope.json" } as Case,
      ctx(),
    );
    expect(r?.pass).toBe(false);
  });

  it("skips live cells when API keys are absent", async () => {
    const rs = await runCase(
      {
        id: "live",
        kind: "live-session",
        brief: "b",
        pairs: [{ painter: "claude-haiku-5-5", critic: "claude-opus-5-5" }],
        conditions: ["A", "B"],
      },
      ctx({}),
    );
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.skipped?.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  it("stops launching live runs once the cost guard is hit", async () => {
    const c = { ...ctx({ ANTHROPIC_API_KEY: "x" }), spentUsd: 2 };
    const rs = await runCase(
      {
        id: "live",
        kind: "live-session",
        brief: "b",
        pairs: [{ painter: "claude-haiku-5-5", critic: "claude-haiku-5-5" }],
        conditions: ["A"],
      },
      c,
    );
    expect(rs[0]?.skipped).toMatch(/cost guard/);
  });
});

describe("summarize", () => {
  it("averages live cells per suite/case/pair/condition and excludes skipped runs", () => {
    const base = { suite: "s", caseId: "c", errors: [], durationMs: 1 };
    const s = summarize(
      "id",
      ["live"],
      [
        { ...base, variant: "p/q/A#1", pass: true, metrics: { judgeScore: 6, costUsd: 0.1 } },
        { ...base, variant: "p/q/A#2", pass: false, metrics: { judgeScore: 8, costUsd: 0.3 } },
        { ...base, variant: "p/q/B#1", pass: false, skipped: "x", metrics: {} },
      ],
    );
    expect(s.cells["s/c:p/q/A"]).toMatchObject({
      runs: 2,
      judgeScore: 7,
      costUsd: 0.2,
      invalidRate: 0.5,
    });
    expect(s.cells["s/c:p/q/B"]).toBeUndefined();
    expect(s.skipped).toBe(1);
  });
});
