import {Config} from '@remotion/cli/config';
import fs from 'node:fs';

// Use a locally installed headless Chromium when one is available
// (cloud containers ship Playwright's build); otherwise Remotion downloads its own.
const LOCAL_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (fs.existsSync(LOCAL_SHELL)) {
  Config.setBrowserExecutable(LOCAL_SHELL);
}

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setChromiumOpenGlRenderer('swangle');
Config.setConcurrency(4);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
