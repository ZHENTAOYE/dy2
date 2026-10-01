import {Config} from '@remotion/cli/config';
import fs from 'node:fs';

// Prefer a locally installed headless Chromium when present (cloud sandboxes
// ship one under /opt/pw-browsers); otherwise Remotion downloads its own.
const LOCAL_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (fs.existsSync(LOCAL_SHELL)) {
  Config.setBrowserExecutable(LOCAL_SHELL);
}

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setChromiumOpenGlRenderer('swangle');
Config.setOverwriteOutput(true);
