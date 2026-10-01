// Downloads Google Fonts subset to exactly the glyphs used in src/ (via the `text=` API),
// so the video renders offline with tiny font files. Re-run after changing on-screen text.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "public/fonts");
mkdirSync(OUT, { recursive: true });

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let chars = new Set();
for (const f of walk(join(ROOT, "src"))) {
  if (!/\.(tsx?|json)$/.test(f)) continue;
  for (const ch of readFileSync(f, "utf8")) chars.add(ch);
}
for (let c = 32; c < 127; c++) chars.add(String.fromCharCode(c));
for (const ch of "，。、：；！？「」『』（）《》—…·×①②③④⑤⑥⑦⑧⑨⁰¹²³⁴⁵⁶⁷⁸⁹％㎡→←↑↓") chars.add(ch);
chars = [...chars].filter((ch) => ch.codePointAt(0) >= 32 && ch !== "\u007f").join("");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const fetchFace = async (family, weight, file) => {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(chars)}`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const m = css.match(/url\((https:[^)]+)\)/);
  if (!m) throw new Error(`No font url for ${family} ${weight}: ${css.slice(0, 300)}`);
  const buf = Buffer.from(await (await fetch(m[1], { headers: { "User-Agent": UA } })).arrayBuffer());
  writeFileSync(join(OUT, file), buf);
  console.log(`${file}  ${(buf.length / 1024).toFixed(1)} KB`);
};

console.log(`${chars.length} unique glyphs`);
await fetchFace("Noto Sans SC", 400, "NotoSansSC-400.woff2");
await fetchFace("Noto Sans SC", 700, "NotoSansSC-700.woff2");
await fetchFace("Noto Sans SC", 900, "NotoSansSC-900.woff2");
await fetchFace("JetBrains Mono", 400, "JetBrainsMono-400.woff2");
await fetchFace("JetBrains Mono", 800, "JetBrainsMono-800.woff2");
