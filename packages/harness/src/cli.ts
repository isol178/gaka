// Usage: pnpm gaka paint --brief "..." --painter <profile> --critic <profile> [options]
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createAdapter, loadProfiles } from "./model/profiles.ts";
import { costUsd } from "./model/types.ts";
import type { ObservationCondition } from "./observe.ts";
import { MODEL_PROFILES_DIR, REPO_ROOT } from "./paths.ts";
import { runSession, SessionError, type SessionRecord } from "./session.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: "string" },
    painter: { type: "string" },
    critic: { type: "string" },
    condition: { type: "string", default: "B" },
    iterations: { type: "string", default: "5" },
    retries: { type: "string", default: "2" },
    "image-budget": { type: "string", default: "4000" },
    width: { type: "string", default: "1024" },
    height: { type: "string", default: "768" },
    seed: { type: "string", default: "42" },
    out: { type: "string" },
  },
});

if (positionals[0] !== "paint" || !values.brief || !values.painter || !values.critic) {
  console.error(
    'usage: gaka paint --brief "<text>" --painter <profile-id> --critic <profile-id> ' +
      "[--condition A|B|C] [--iterations N] [--out dir]\n" +
      `profiles: ${[...loadProfiles(MODEL_PROFILES_DIR).keys()].join(", ")}`,
  );
  process.exit(2);
}

const profiles = loadProfiles(MODEL_PROFILES_DIR);
const get = (id: string) => {
  const p = profiles.get(id);
  if (!p) throw new Error(`unknown profile '${id}'`);
  return p;
};
const painterProfile = get(values.painter);
const criticProfile = get(values.critic);
const outDir =
  values.out ?? join(REPO_ROOT, "runs", new Date().toISOString().replace(/[:.]/g, "-"));

// Adapters are built first: a missing key or baseUrl fails here, before any call is billed, and
// configuration errors (which name env vars) never reach the session error printed below.
const painter = createAdapter(painterProfile);
const critic = createAdapter(criticProfile);

let record: SessionRecord;
let error: string | undefined;
try {
  record = await runSession({
    brief: values.brief,
    canvas: {
      width: Number(values.width),
      height: Number(values.height),
      seed: Number(values.seed),
    },
    painter,
    critic,
    maxIterations: Number(values.iterations),
    maxRetries: Number(values.retries),
    observation: values.condition as ObservationCondition,
    imageTokenBudget: Number(values["image-budget"]),
    outDir,
  });
} catch (err) {
  // runSession has already written session.json; still report what was spent before failing.
  if (!(err instanceof SessionError)) throw err;
  record = err.record;
  error = err.message;
}

const cost =
  costUsd(painterProfile, record.usage.painter) + costUsd(criticProfile, record.usage.critic);
console.log(
  JSON.stringify(
    {
      status: record.status,
      ...(error ? { error } : {}),
      iterations: record.iterations.length,
      finalScore: record.finalScore,
      usage: record.usage,
      costUsd: Number(cost.toFixed(4)),
      outDir,
    },
    null,
    2,
  ),
);
if (error) process.exitCode = 1;
