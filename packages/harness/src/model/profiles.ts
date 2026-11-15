import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../schema/capability-profile.schema.json" with { type: "json" };
import { OpenAICompatibleAdapter } from "./http.ts";
import { AnthropicAdapter, GoogleAdapter, OpenAIAdapter } from "./sdk.ts";
import type { CapabilityProfile, ModelAdapter } from "./types.ts";

const validate = new Ajv2020({ allErrors: true }).compile<CapabilityProfile>(schema);

export function parseProfile(value: unknown, source = "profile"): CapabilityProfile {
  if (!validate(value)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`${source}: invalid capability profile: ${msg}`);
  }
  return value;
}

export function loadProfiles(dir: string): Map<string, CapabilityProfile> {
  const out = new Map<string, CapabilityProfile>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const p = parseProfile(JSON.parse(readFileSync(join(dir, f), "utf8")), f);
    if (`${p.id}.json` !== f) throw new Error(`${f}: id '${p.id}' must match file name`);
    out.set(p.id, p);
  }
  return out;
}

export function createAdapter(profile: CapabilityProfile, env = process.env): ModelAdapter {
  switch (profile.adapter) {
    case "openai-compatible":
      return new OpenAICompatibleAdapter(profile, env);
    case "anthropic":
      return new AnthropicAdapter(profile, { env });
    case "openai":
      return new OpenAIAdapter(profile, { env });
    case "google":
      return new GoogleAdapter(profile, { env });
    case "scripted":
      throw new Error("scripted profiles need a cassette; construct ScriptedAdapter directly");
  }
}
