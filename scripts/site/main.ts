// Browser gallery: draws sample paintings with the same render() the harness uses in Node.
import { type Painting, validatePainting } from "@gaka/dsl";
import { type Ctx2D, render } from "@gaka/renderer";
import mountain from "../../packages/dsl/test/fixtures/valid/mountain-morning.json" with {
  type: "json",
};

const samples: [string, unknown][] = [["mountain-morning", mountain]];

for (const [name, json] of samples) {
  const r = validatePainting(json);
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = name;
  if (r.ok) {
    const p: Painting = r.painting;
    const canvas = document.createElement("canvas");
    canvas.width = p.canvas.width;
    canvas.height = p.canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) render(ctx as unknown as Ctx2D, p);
    figure.append(canvas);
  } else {
    caption.textContent = `${name}: ${r.errors.join("; ")}`;
  }
  figure.append(caption);
  document.querySelector("main")?.append(figure);
}
