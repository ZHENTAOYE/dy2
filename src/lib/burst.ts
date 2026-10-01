import {HDRBuffer} from './hdr';
import {rng} from './math';

type RGB = [number, number, number];
const cache = new Map<string, {a: Float32Array; v: Float32Array; h: Float32Array}>();
const table = (seed: number, n: number) => {
  const k = `${seed}:${n}`;
  let t = cache.get(k);
  if (!t) {
    const r = rng(seed);
    t = {a: new Float32Array(n), v: new Float32Array(n), h: new Float32Array(n)};
    for (let i = 0; i < n; i++) {
      t.a[i] = r() * Math.PI * 2;
      t.v[i] = 0.08 + Math.pow(r(), 2.2) * 0.92;
      t.h[i] = r();
    }
    cache.set(k, t);
  }
  return t;
};

/** Radial explosion debris as motion-blurred streaks. */
export const burstPoints = (
  hdr: HDRBuffer,
  cx: number,
  cy: number,
  t: number,
  o: {seed: number; n: number; reach: number; tau?: number; life?: number; hot: RGB; cool: RGB; gain?: number; squash?: number},
) => {
  if (t < 0) return;
  const {a, v, h} = table(o.seed, o.n);
  const tau = o.tau ?? 16;
  const life = Math.exp(-t / (o.life ?? 70));
  const gain = (o.gain ?? 1.4) * life;
  const sq = o.squash ?? 1;
  const e1 = 1 - Math.exp(-t / tau);
  const e0 = 1 - Math.exp(-Math.max(0, t - 1.5) / tau);
  const cool = Math.min(1, t / ((o.life ?? 70) * 1.2));
  for (let i = 0; i < o.n; i++) {
    const s = v[i] * o.reach;
    const ca = Math.cos(a[i]);
    const sa = Math.sin(a[i]) * sq;
    const k = (0.5 + h[i]) * gain;
    const m = Math.min(1, cool * (0.6 + h[i] * 0.6));
    const r = (o.hot[0] + (o.cool[0] - o.hot[0]) * m) * k;
    const g = (o.hot[1] + (o.cool[1] - o.hot[1]) * m) * k;
    const b = (o.hot[2] + (o.cool[2] - o.hot[2]) * m) * k;
    hdr.line(cx + ca * s * e0, cy + sa * s * e0, cx + ca * s * e1, cy + sa * s * e1, r, g, b);
  }
};

/** Soft expanding shock ring. */
export const ring = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, w: number, rgb: string, a: number) => {
  if (a <= 0.003 || R <= 1) return;
  const g = ctx.createRadialGradient(cx, cy, Math.max(0, R - w), cx, cy, R + w * 0.3);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.75, `rgba(${rgb},${Math.min(1, a)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R + w * 0.3, 0, Math.PI * 2);
  ctx.fill();
};
