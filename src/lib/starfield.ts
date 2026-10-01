import {drawGlow, drawSpikes} from './canvas';
import {HDRBuffer} from './hdr';
import {rng, tempColor} from './math';

type Field = {n: number; x: Float32Array; y: Float32Array; d: Float32Array; b: Float32Array; c: Float32Array; ph: Float32Array};
const cache = new Map<string, Field>();

export const getField = (seed: number, n: number): Field => {
  const key = `${seed}:${n}`;
  let fld = cache.get(key);
  if (fld) return fld;
  const r = rng(seed);
  fld = {
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    d: new Float32Array(n),
    b: new Float32Array(n),
    c: new Float32Array(n * 3),
    ph: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    fld.x[i] = (r() * 2 - 1) * 1.15;
    fld.y[i] = (r() * 2 - 1) * 0.68;
    fld.d[i] = 0.25 + 0.75 * r();
    fld.b[i] = 0.12 + Math.pow(r(), 9) * 5;
    const col = tempColor(0.45 + 0.55 * r());
    fld.c[i * 3] = col[0];
    fld.c[i * 3 + 1] = col[1];
    fld.c[i * 3 + 2] = col[2];
    fld.ph[i] = r() * 100;
  }
  cache.set(key, fld);
  return fld;
};

export type StarfieldOpts = {
  seed?: number;
  n?: number;
  f: number;
  zoom?: number; // radial scale (>1 = pushing in)
  prevZoom?: number; // for motion streaks
  cx?: number;
  cy?: number;
  alpha?: number;
  twinkle?: number;
  glow?: boolean;
  rot?: number;
};

/** Points into the HDR buffer; returns bright stars for a sprite pass. */
export const starfieldPoints = (hdr: HDRBuffer, o: StarfieldOpts) => {
  const {seed = 7, n = 2500, f, zoom = 1, cx = 960, cy = 540, alpha = 1, twinkle = 0.25, rot = 0} = o;
  const prevZoom = o.prevZoom ?? zoom;
  const fld = getField(seed, n);
  const bright: [number, number, number, number, number, number][] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const d = fld.d[i];
    const z = 1 + (zoom - 1) * d;
    const zp = 1 + (prevZoom - 1) * d;
    const bx = fld.x[i] * cr - fld.y[i] * sr;
    const by = fld.x[i] * sr + fld.y[i] * cr;
    const x = cx + bx * 960 * z;
    const y = cy + by * 960 * z;
    if (x < -50 || x > 1970 || y < -50 || y > 1130) continue;
    const tw = 1 + twinkle * Math.sin(f * 0.21 + fld.ph[i] * 3.1) * Math.sin(f * 0.077 + fld.ph[i]);
    const b = fld.b[i] * alpha * tw * (0.6 + 0.4 * d);
    const r = fld.c[i * 3] * b;
    const g = fld.c[i * 3 + 1] * b;
    const bl = fld.c[i * 3 + 2] * b;
    const dz = Math.abs(z - zp);
    if (dz > 0.002) {
      const xp = cx + bx * 960 * zp;
      const yp = cy + by * 960 * zp;
      hdr.line(xp, yp, x, y, r * 1.6, g * 1.6, bl * 1.6);
    } else {
      hdr.add(x, y, r, g, bl);
    }
    if (fld.b[i] > 1.4) bright.push([x, y, fld.b[i] * alpha * tw, fld.c[i * 3], fld.c[i * 3 + 1], fld.c[i * 3 + 2]]);
  }
  return bright;
};

export const starfieldSprites = (
  ctx: CanvasRenderingContext2D,
  bright: [number, number, number, number, number, number][],
  spikes = true,
) => {
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, b, r, g, bl] of bright) {
    drawGlow(ctx, x, y, 10 + b * 5, [r, g, bl], Math.min(1, b * 0.25));
    if (spikes && b > 3.2) drawSpikes(ctx, x, y, b * 9, [r, g, bl], Math.min(0.7, (b - 3.2) * 0.4), 0.2, 0.8);
  }
  ctx.globalCompositeOperation = 'source-over';
};
