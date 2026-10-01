import data from '../timeline.json';
import {clamp, easeInOut} from './math';

export const TL = data;
export const FPS = data.fps;
export const W = data.width;
export const H = data.height;
export type SceneName = keyof typeof data.scenes;
export const scene = (name: SceneName) => data.scenes[name];

/** log10(age of universe in years) at a global frame, eased between keyframes. */
export const logTimeAt = (frame: number) => {
  const k = data.logTime as [number, number][];
  if (frame <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (frame <= k[i][0]) {
      const [f0, v0] = k[i - 1];
      const [f1, v1] = k[i];
      return v0 + (v1 - v0) * easeInOut(clamp((frame - f0) / Math.max(1, f1 - f0)));
    }
  }
  return k[k.length - 1][1];
};

/** Combined camera-shake / flash / chromatic-aberration intensity at a frame. */
export const impactAt = (frame: number) => {
  let shake = 0;
  let flash = 0;
  for (const im of data.impacts) {
    const d = frame - im.frame;
    if (d < 0 || d > 90) continue;
    shake += im.strength * Math.exp(-d / 9);
    flash += im.flash * Math.exp(-d / 4.5);
  }
  return {shake: clamp(shake, 0, 1.5), flash: clamp(flash, 0, 1)};
};
