import {
  type CapabilityProfile,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  requestImageTokens,
} from "./types.ts";

export interface ScriptedTurn {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Replays canned responses in order. Used by unit tests and replay evals so the full loop
 * (retries, budgeting, layer replacement) is exercised in CI without network or secrets.
 */
export class ScriptedAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  private cursor = 0;

  constructor(
    readonly profile: CapabilityProfile,
    private readonly turns: ScriptedTurn[],
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    const turn = this.turns[this.cursor++];
    if (turn === undefined) {
      throw new Error(`scripted adapter '${this.profile.id}' ran out of turns at #${this.cursor}`);
    }
    const imageTokens = requestImageTokens(this.profile, req);
    return {
      text: turn.text,
      usage: {
        inputTokens:
          turn.usage?.inputTokens ??
          Math.ceil((req.system.length + req.prompt.length) / 4) + imageTokens,
        outputTokens: turn.usage?.outputTokens ?? Math.ceil(turn.text.length / 4),
        imageTokens,
      },
    };
  }

  get remaining(): number {
    return this.turns.length - this.cursor;
  }
}
