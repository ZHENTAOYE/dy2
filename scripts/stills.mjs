// Usage: node scripts/stills.mjs <outDir> <frame> [frame...]
// Bundles once and renders the given global frames as PNG stills, then
// builds a contact sheet (sheet.jpg) for quick visual review.
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, ...frames] = process.argv.slice(2);
fs.mkdirSync(outDir, {recursive: true});
const shell = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browserExecutable = fs.existsSync(shell) ? shell : null;
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const composition = await selectComposition({serveUrl, id: 'OneSecond', browserExecutable});
const files = [];
for (const f of frames.map(Number)) {
	const output = path.join(outDir, `f${String(f).padStart(5, '0')}.png`);
	await renderStill({composition, serveUrl, frame: f, output, browserExecutable, imageFormat: 'png'});
	files.push(output);
	console.log('rendered', f);
}
const cols = Math.min(4, files.length);
const rows = Math.ceil(files.length / cols);
const args = [];
files.forEach((f) => args.push('-i', f));
const filter =
	files.map((_, i) => `[${i}:v]scale=360:640,drawtext=text='${frames[i]}':x=8:y=8:fontsize=28:fontcolor=yellow[v${i}]`).join(';') +
	';' +
	files.map((_, i) => `[v${i}]`).join('') +
	`xstack=inputs=${files.length}:layout=` +
	files.map((_, i) => `${(i % cols) * 360}_${Math.floor(i / cols) * 640}`).join('|') +
	`:fill=black[out]`;
if (files.length > 1) {
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, '-filter_complex', filter, '-map', '[out]', path.join(outDir, 'sheet.jpg')]);
} else {
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', files[0], '-vf', 'scale=540:960', path.join(outDir, 'sheet.jpg')]);
}
console.log('sheet', path.join(outDir, 'sheet.jpg'), rows, 'rows');
