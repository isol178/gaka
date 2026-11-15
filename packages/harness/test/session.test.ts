import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ObservationCondition,
  replaceLayer,
  runSession,
  ScriptedAdapter,
  SessionError,
} from "../src/index.ts";
import { CANVAS, cassette, profile } from "./helpers.ts";

async function run(condition: ObservationCondition, criticProfile = "scripted", canvas = CANVAS) {
  const c = cassette("landscape-retry");
  const painter = new ScriptedAdapter(profile("scripted"), c.painter);
  const critic = new ScriptedAdapter(profile(criticProfile), c.critic);
  const record = await runSession({
    brief: "A quiet mountain lake at dawn",
    canvas,
    painter,
    critic,
    maxIterations: 4,
    maxRetries: 2,
    observation: condition,
    imageTokenBudget: 10_000,
  });
  return { record, painter, critic };
}

describe("runSession (scripted)", () => {
  it("retries malformed JSON, applies a layer replacement and stops when the critic is done", async () => {
    const { record, painter, critic } = await run("C");
    expect(record.status).toBe("done");
    expect(record.iterations).toHaveLength(2);
    expect(record.iterations[0]?.painterAttempts).toBe(2);
    expect(record.iterations[0]?.rejected[0]?.[0]).toMatch(/^invalid JSON/);
    // The retry prompt must carry the validation error back to the model.
    expect(painter.requests[1]?.prompt).toContain("Your previous reply was rejected");
    const mid = record.finalPainting?.layers.find((l) => l.id === "midground");
    expect(mid?.ops).toHaveLength(2);
    expect(record.finalScore).toBe(7.5);
    expect(painter.remaining).toBe(0);
    expect(critic.remaining).toBe(0);
  });

  it("keeps the harness-owned canvas even if the model changes it", async () => {
    const { record } = await run("B");
    expect(record.finalPainting?.canvas).toEqual(CANVAS);
  });

  it("shows the critic changed-region and focus crops only under condition C", async () => {
    const { record } = await run("C");
    expect(record.iterations[0]?.imagesShown).toEqual(["thumbnail"]);
    expect(record.iterations[1]?.imagesShown).toEqual(["thumbnail", "focus", "changed"]);
  });

  it("spends fewer image tokens with thumbnails (B) than full images (A)", async () => {
    // Use a realistic canvas: at 256px the thumbnail is the full image.
    const big = { width: 1024, height: 768, seed: 42 };
    const a = await run("A", "scripted", big);
    const b = await run("B", "scripted", big);
    expect(b.record.usage.critic.imageTokens).toBeLessThan(a.record.usage.critic.imageTokens);
  });

  it("falls back to numeric-only observation for a critic without vision", async () => {
    const { record, critic } = await run("A", "scripted-blind");
    expect(record.observation).toBe("numeric");
    expect(critic.requests.every((r) => (r.images ?? []).length === 0)).toBe(true);
    expect(critic.requests[0]?.prompt).toContain("luminance_mean");
  });

  it("drops images that exceed the image-token budget", async () => {
    const c = cassette("landscape-retry");
    const record = await runSession({
      brief: "x",
      canvas: CANVAS,
      painter: new ScriptedAdapter(profile("scripted"), c.painter),
      critic: new ScriptedAdapter(profile("scripted"), c.critic),
      maxIterations: 4,
      maxRetries: 2,
      observation: "A",
      imageTokenBudget: 10,
    });
    expect(record.iterations[0]?.imagesShown).toEqual([]);
    expect(record.iterations[0]?.imagesDropped).toEqual(["full"]);
  });

  it("gives up with invalid_output when retries are exhausted", async () => {
    const bad = { text: "not json" };
    const record = await runSession({
      brief: "x",
      canvas: CANVAS,
      painter: new ScriptedAdapter(profile("scripted"), [bad, bad]),
      critic: new ScriptedAdapter(profile("scripted"), []),
      maxIterations: 3,
      maxRetries: 1,
      observation: "B",
      imageTokenBudget: 0,
    });
    expect(record.status).toBe("invalid_output");
    expect(record.iterations).toHaveLength(0);
  });
});

describe("replaceLayer", () => {
  it("replaces by id and appends unknown ids", () => {
    const p = {
      version: "0.1" as const,
      canvas: CANVAS,
      layers: [{ id: "a", ops: [] }] as [{ id: string; ops: [] }],
    };
    expect(
      replaceLayer(p, { id: "a", ops: [{ op: "noise", strength: 0.1 }] }).layers[0]?.ops,
    ).toHaveLength(1);
    expect(replaceLayer(p, { id: "b", ops: [] }).layers.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("runSession stop reasons", () => {
  it("re-asks with a truncation hint when a reply hits the output limit", async () => {
    const c = cassette("landscape-retry");
    const painter = new ScriptedAdapter(profile("scripted"), c.painter.slice(1));
    const truncating = {
      profile: painter.profile,
      calls: 0,
      async complete(req: Parameters<ScriptedAdapter["complete"]>[0]) {
        this.calls++;
        if (this.calls === 1)
          return {
            text: "{",
            usage: { inputTokens: 1, outputTokens: 1, imageTokens: 0 },
            stopReason: "max_tokens" as const,
          };
        return painter.complete(req);
      },
    };
    const record = await runSession({
      brief: "x",
      canvas: CANVAS,
      painter: truncating,
      critic: new ScriptedAdapter(profile("scripted"), c.critic),
      maxIterations: 1,
      maxRetries: 1,
      observation: "B",
      imageTokenBudget: 0,
    });
    expect(record.iterations[0]?.rejected[0]?.[0]).toMatch(/cut off/);
    expect(painter.requests[0]?.prompt).toContain("cut off");
  });
});

describe("runSession failures keep the partial record", () => {
  const c = cassette("landscape-retry");
  const refusingCritic = {
    profile: profile("scripted"),
    async complete() {
      return {
        text: "",
        usage: { inputTokens: 5, outputTokens: 1, imageTokens: 0 },
        stopReason: "refusal" as const,
      };
    },
  };

  it("ends with status refused and still writes session.json", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "gaka-session-"));
    try {
      const record = await runSession({
        brief: "x",
        canvas: CANVAS,
        painter: new ScriptedAdapter(profile("scripted"), c.painter),
        critic: refusingCritic,
        maxIterations: 3,
        maxRetries: 2,
        observation: "B",
        imageTokenBudget: 0,
        outDir,
      });
      expect(record.status).toBe("refused");
      expect(record.usage.critic.inputTokens).toBe(5);
      expect(record.usage.painter.inputTokens).toBeGreaterThan(0);
      const saved = JSON.parse(readFileSync(join(outDir, "session.json"), "utf8"));
      expect(saved.status).toBe("refused");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("throws a SessionError carrying the usage spent before an unexpected error", async () => {
    const failingCritic = {
      profile: profile("scripted"),
      async complete(): Promise<never> {
        throw new Error("HTTP 529 overloaded");
      },
    };
    const err = await runSession({
      brief: "x",
      canvas: CANVAS,
      painter: new ScriptedAdapter(profile("scripted"), c.painter),
      critic: failingCritic,
      maxIterations: 3,
      maxRetries: 2,
      observation: "B",
      imageTokenBudget: 0,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    const { record, message } = err as SessionError;
    expect(message).toMatch(/529/);
    expect(record.status).toBe("error");
    expect(record.usage.painter.inputTokens).toBeGreaterThan(0);
  });
});
