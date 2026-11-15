// Bundles the browser gallery into dist/site. Also proves the renderer has no Node-only imports.
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const outdir = new URL("../dist/site/", import.meta.url);
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [new URL("./site/main.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: new URL("main.js", outdir).pathname,
  logLevel: "warning",
});

writeFileSync(
  new URL("index.html", outdir),
  `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gaka gallery</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f6f4ef; color: #1f2a37; }
  main { display: flex; flex-wrap: wrap; gap: 1.5rem; }
  canvas { max-width: 100%; height: auto; box-shadow: 0 2px 12px rgb(0 0 0 / 15%); }
  figcaption { margin-top: .5rem; font-size: .9rem; }
</style>
</head>
<body>
<h1>Gaka gallery</h1>
<p>Sample paintings drawn in your browser by the reference Canvas 2D renderer.</p>
<main></main>
<script type="module" src="./main.js"></script>
</body>
</html>
`,
);
console.log("built dist/site");
