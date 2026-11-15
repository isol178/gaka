import type { ModelAdapter, Usage } from "@gaka/harness";

/**
 * Independent final-image judge for live evals. It is deliberately separate from the in-loop
 * Critic: a critic grading its own loop tends to be lenient (concept section 14).
 */
const JUDGE_SYSTEM = `You are judging a finished painting against its brief for a benchmark.
Score 0-10 using this rubric, then average:
- brief: does it depict what the brief asks for?
- composition: clear structure, balance, depth.
- color: coherent palette and light.
- finish: looks intentional and complete, no obvious artifacts.
Reply with JSON only: {"brief": n, "composition": n, "color": n, "finish": n, "score": n}`;

export interface JudgeScore {
  brief: number;
  composition: number;
  color: number;
  finish: number;
  score: number;
}

/** The judge replied but without a usable score; `usage` is what that reply cost. */
export class JudgeError extends Error {
  constructor(
    message: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = "JudgeError";
  }
}

export async function judge(
  model: ModelAdapter,
  brief: string,
  png: Buffer,
): Promise<{ score: JudgeScore; usage: Usage }> {
  const res = await model.complete({
    system: JUDGE_SYSTEM,
    prompt: `Brief: ${brief}`,
    images: [{ label: "final", png }],
  });
  // Take the outermost {...} so prose around the JSON is tolerated (indexOf, not a regex: untrusted input).
  const start = res.text.indexOf("{");
  const end = res.text.lastIndexOf("}");
  let parsed: Partial<JudgeScore> = {};
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(res.text.slice(start, end + 1)) as Partial<JudgeScore>;
    } catch {
      parsed = {};
    }
  }
  if (typeof parsed.score !== "number")
    throw new JudgeError(`judge returned no score: ${res.text.slice(0, 200)}`, res.usage);
  return { score: parsed as JudgeScore, usage: res.usage };
}
