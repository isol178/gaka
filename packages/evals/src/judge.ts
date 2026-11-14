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
  const match = /\{[\s\S]*\}/.exec(res.text);
  const parsed = match ? (JSON.parse(match[0]) as Partial<JudgeScore>) : {};
  if (typeof parsed.score !== "number")
    throw new Error(`judge returned no score: ${res.text.slice(0, 200)}`);
  return { score: parsed as JudgeScore, usage: res.usage };
}
