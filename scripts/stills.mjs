// Render a handful of stills from one bundle: node scripts/stills.mjs 100 360 400 ...
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition, openBrowser} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const frames = process.argv.slice(2).map(Number);
const outDir = process.env.STILL_DIR || 'out/stills';
fs.mkdirSync(outDir, {recursive: true});
const shell = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const serveUrl = process.env.BUNDLE || (await bundle({entryPoint: path.resolve('src/index.ts')}));
const browser = await openBrowser('chrome', {
  browserExecutable: fs.existsSync(shell) ? shell : null,
  chromiumOptions: {gl: 'swangle'},
});
const inputProps = {audio: false};
const composition = await selectComposition({serveUrl, id: 'HeatDeath', inputProps, puppeteerInstance: browser});
for (const frame of frames) {
  const t0 = Date.now();
  await renderStill({
    composition,
    serveUrl,
    frame,
    inputProps,
    output: path.join(outDir, `f${String(frame).padStart(4, '0')}.jpg`),
    imageFormat: 'jpeg',
    jpegQuality: 85,
    puppeteerInstance: browser,
    chromiumOptions: {gl: 'swangle'},
  });
  console.log(`frame ${frame}: ${Date.now() - t0}ms`);
}
await browser.close({silent: true});
