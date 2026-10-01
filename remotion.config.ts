import {Config} from '@remotion/cli/config';
import fs from 'node:fs';

// Prefer the pre-installed headless Chromium when present (e.g. in CI
// containers without network access to download Remotion's own browser).
const localShell =
	'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (fs.existsSync(localShell)) {
	Config.setBrowserExecutable(localShell);
}

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
Config.setEntryPoint('src/index.ts');
