// Regenerates src/types.gen.ts from the JSON Schema (the schema is the source of truth).
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const schemaUrl = new URL("../schema/gaka-dsl.schema.json", import.meta.url);
const outUrl = new URL("../src/types.gen.ts", import.meta.url);

const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
const ts = await compile(schema, "Painting", {
  bannerComment:
    "/* Generated from schema/gaka-dsl.schema.json by scripts/gen-types.ts. Do not edit by hand; run `pnpm gen`. */",
  additionalProperties: false,
  unreachableDefinitions: true,
  maxItems: -1,
  style: { printWidth: 100 },
});
await writeFile(outUrl, ts);
