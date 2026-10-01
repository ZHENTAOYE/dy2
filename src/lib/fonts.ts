import { continueRender, delayRender, staticFile } from "remotion";

// Fonts are subset to exactly the glyphs this video uses (see scripts/fetch-fonts.mjs),
// so they are tiny and rendering never depends on the network.
const faces: [string, string, string][] = [
  ["Noto Sans SC", "fonts/NotoSansSC-400.woff2", "400"],
  ["Noto Sans SC", "fonts/NotoSansSC-700.woff2", "700"],
  ["Noto Sans SC", "fonts/NotoSansSC-900.woff2", "900"],
  ["JetBrains Mono", "fonts/JetBrainsMono-400.woff2", "400"],
  ["JetBrains Mono", "fonts/JetBrainsMono-800.woff2", "800"],
];

let started = false;
export const loadFonts = () => {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading fonts");
  Promise.all(
    faces.map(([family, file, weight]) =>
      new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight })
        .load()
        .then((f) => {
          (document.fonts as unknown as { add: (f: FontFace) => void }).add(f);
        })
        .catch((e) => console.warn("font failed", file, e)),
    ),
  ).then(() => continueRender(handle));
};
