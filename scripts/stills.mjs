// Render a set of frames from one composition with a single bundle, then tile
// them into a contact sheet for quick review.
// usage: node scripts/stills.mjs <compositionId> <frame,frame,...> [outDir] [scale]
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , id, framesArg, outDir = 'out/stills', scaleArg = '1'] = process.argv;
const frames = framesArg.split(',').map(Number);
const LOCAL_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browserExecutable = fs.existsSync(LOCAL_SHELL) ? LOCAL_SHELL : null;

fs.mkdirSync(outDir, {recursive: true});
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const composition = await selectComposition({serveUrl, id, browserExecutable});
const files = [];
for (const frame of frames) {
  const output = path.join(outDir, `${id}-${String(frame).padStart(5, '0')}.png`);
  const t0 = Date.now();
  await renderStill({
    serveUrl,
    composition,
    frame,
    output,
    browserExecutable,
    scale: Number(scaleArg),
    chromiumOptions: {gl: 'swangle'},
  });
  console.log(`${output} ${Date.now() - t0}ms`);
  files.push(output);
}
if (files.length > 1) {
  const cols = Math.min(3, files.length);
  const sheet = path.join(outDir, `${id}-sheet.jpg`);
  const inputs = files.flatMap((f) => ['-i', f]);
  const filter =
    files.map((_, i) => `[${i}:v]scale=640:-1,drawtext=text='${frames[i]}':x=8:y=8:fontsize=22:fontcolor=yellow[v${i}]`).join(';') +
    ';' +
    files.map((_, i) => `[v${i}]`).join('') +
    `xstack=inputs=${files.length}:layout=${files
      .map((_, i) => `${(i % cols) === 0 ? '0' : Array.from({length: i % cols}, () => 'w0').join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({length: Math.floor(i / cols)}, () => 'h0').join('+')}`)
      .join('|')}:fill=black`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-q:v', '3', sheet]);
  console.log(`sheet ${sheet}`);
}
