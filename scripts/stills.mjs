// Render individual frames for quick visual review.
// Usage: node scripts/stills.mjs <outDir> <scene>:<frame>[,<frame>...] ...   (frames are scene-relative)
//        node scripts/stills.mjs <outDir> @<absoluteFrame> ...                (frame of the full film)
// Scene frames are rendered from that scene's own composition (`scene-<id>`), so they do not depend
// on the durations of the other scenes. SCALE=1 for full resolution (default 0.5).
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition, ensureBrowser } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || !specs.length) {
  console.error("usage: node scripts/stills.mjs <outDir> <scene>:<f>[,<f>...] | @<absFrame> ...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const jobs = [];
for (const spec of specs) {
  if (spec.startsWith("@")) jobs.push({ name: `abs_${spec.slice(1)}`, comp: "Main", frame: Number(spec.slice(1)) });
  else {
    const [scene, frames] = spec.split(":");
    for (const f of frames.split(",")) jobs.push({ name: `${scene}_${f}`, comp: `scene-${scene}`, frame: Number(f) });
  }
}
const browserExecutable = process.env.REMOTION_CHROME || null;
if (!browserExecutable) await ensureBrowser();
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts") });
const scale = Number(process.env.SCALE || 0.5);
const comps = {};
for (const j of jobs) {
  comps[j.comp] ??= await selectComposition({ serveUrl, id: j.comp, browserExecutable });
  const composition = comps[j.comp];
  if (j.frame < 0 || j.frame >= composition.durationInFrames) {
    console.warn(`skip ${j.name}: frame outside 0..${composition.durationInFrames - 1}`);
    continue;
  }
  const t0 = Date.now();
  await renderStill({
    serveUrl,
    composition,
    frame: j.frame,
    output: join(outDir, `${j.name}.jpg`),
    imageFormat: "jpeg",
    jpegQuality: 85,
    scale,
    browserExecutable,
  });
  console.log(`${j.name} (${Date.now() - t0}ms)`);
}
