// Render individual frames for quick visual review.
// Usage: node scripts/stills.mjs <outDir> <scene>:<frame>[,<frame>...] ...   (frames are scene-relative)
//        node scripts/stills.mjs <outDir> @<absoluteFrame> ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition, ensureBrowser } from "@remotion/renderer";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const [outDir, ...specs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const timeline = JSON.parse(readFileSync(join(ROOT, "src/timeline.json"), "utf8"));
const starts = {};
let acc = 0;
for (const s of timeline.scenes) {
  starts[s.id] = acc;
  acc += s.duration;
}
const jobs = [];
for (const spec of specs) {
  if (spec.startsWith("@")) jobs.push({ name: `abs_${spec.slice(1)}`, frame: Number(spec.slice(1)) });
  else {
    const [scene, frames] = spec.split(":");
    for (const f of frames.split(",")) jobs.push({ name: `${scene}_${f}`, frame: starts[scene] + Number(f) });
  }
}
const browserExecutable = process.env.REMOTION_CHROME || null;
if (!browserExecutable) await ensureBrowser();
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "Main", browserExecutable });
const scale = Number(process.env.SCALE || 0.5);
for (const j of jobs) {
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
