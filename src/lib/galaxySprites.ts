import {gauss, rng} from './math';

type Tint = 'young' | 'old' | 'red';
const TINTS: Record<Tint, [number, number, number][]> = {
  young: [
    [150, 190, 255],
    [255, 235, 210],
  ],
  old: [
    [255, 215, 160],
    [255, 240, 220],
  ],
  red: [
    [255, 90, 40],
    [255, 150, 90],
  ],
};

const cache = new Map<string, HTMLCanvasElement>();

/** Small pre-rendered galaxy image (spiral or elliptical) used in wide cosmic views. */
export const galaxySprite = (variant: number, tint: Tint) => {
  const key = `${variant}:${tint}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 160;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const r = rng(1000 + variant * 17);
  const [arm, core] = TINTS[tint];
  const elliptical = variant % 4 === 3;
  const pitch = 0.2 + r() * 0.25;
  const n = elliptical ? 1600 : 2200;
  for (let i = 0; i < n; i++) {
    let x: number, y: number, col: [number, number, number], a: number;
    if (elliptical) {
      const rr = Math.abs(gauss(r)) * 0.28;
      const th = r() * Math.PI * 2;
      x = Math.cos(th) * rr;
      y = Math.sin(th) * rr * 0.7;
      col = core;
      a = 0.32;
    } else if (r() < 0.25) {
      const rr = Math.abs(gauss(r)) * 0.08;
      const th = r() * Math.PI * 2;
      x = Math.cos(th) * rr;
      y = Math.sin(th) * rr;
      col = core;
      a = 0.4;
    } else {
      const rr = Math.min(0.48, -Math.log(1 - r() * 0.98) * 0.13 + 0.02);
      const th = Math.floor(r() * 2) * Math.PI + Math.log(rr / 0.02) / Math.tan(pitch) + gauss(r) * 0.3;
      x = Math.cos(th) * rr;
      y = Math.sin(th) * rr;
      col = r() < 0.6 ? arm : core;
      a = 0.3;
    }
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
    const s = r() < 0.05 ? 2 : 1.2;
    ctx.fillRect(S / 2 + x * S - s / 2, S / 2 + y * S - s / 2, s, s);
  }
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * (elliptical ? 0.3 : 0.16));
  g.addColorStop(0, `rgba(${core[0]},${core[1]},${core[2]},0.9)`);
  g.addColorStop(1, `rgba(${core[0]},${core[1]},${core[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  cache.set(key, c);
  return c;
};

export const drawGalaxySprite = (
  ctx: CanvasRenderingContext2D,
  variant: number,
  tint: Tint,
  x: number,
  y: number,
  size: number,
  rot: number,
  squash: number,
  alpha: number,
) => {
  if (alpha <= 0.004 || size < 1) return;
  const img = galaxySprite(variant, tint);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, squash);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
};
