import {drawGlow} from './canvas';
import {HDRBuffer} from './hdr';
import {clamp, gauss, lerp, rng} from './math';

export type Galaxy = {
  n: number;
  r: Float32Array;
  th: Float32Array;
  z: Float32Array;
  c: Float32Array;
  b: Float32Array;
  kind: Uint8Array; // 0 bulge, 1 old disk, 2 young arm, 3 halo
  life: Float32Array; // death order 0..1 (0 = dies first)
  hii: {r: number; th: number; z: number; s: number}[];
  dust: {r: number; th: number; s: number}[];
};

const cache = new Map<string, Galaxy>();

export const makeGalaxy = (seed: number, n: number): Galaxy => {
  const key = `${seed}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const R = rng(seed);
  const g: Galaxy = {
    n,
    r: new Float32Array(n),
    th: new Float32Array(n),
    z: new Float32Array(n),
    c: new Float32Array(n * 3),
    b: new Float32Array(n),
    kind: new Uint8Array(n),
    life: new Float32Array(n),
    hii: [],
    dust: [],
  };
  const pitch = 0.24; // radians
  const arms = 2;
  const armAngle = (r: number) => Math.log(Math.max(r, 0.02) / 0.04) / Math.tan(pitch);
  for (let i = 0; i < n; i++) {
    const u = R();
    let r: number, th: number, z: number, col: [number, number, number], b: number, kind: number;
    if (u < 0.16) {
      kind = 0;
      r = Math.abs(gauss(R)) * 0.085;
      th = R() * Math.PI * 2;
      z = gauss(R) * 0.055;
      col = [1.0, 0.78 + R() * 0.1, 0.5 + R() * 0.15];
      b = 0.8 + R() * 0.9;
    } else if (u < 0.92) {
      const young = R() < 0.42;
      kind = young ? 2 : 1;
      r = Math.min(1.05, -Math.log(1 - R() * 0.985) * 0.27 + 0.03);
      const arm = Math.floor(R() * arms);
      const spread = young ? 0.22 : 0.65;
      th = arm * Math.PI + armAngle(r) + gauss(R) * spread * (0.5 + r * 0.7);
      // secondary spurs
      if (R() < 0.18) th += Math.PI / 2 + gauss(R) * 0.3;
      z = gauss(R) * (young ? 0.008 : 0.02);
      if (young) {
        const k = R();
        col = k < 0.7 ? [0.62, 0.76, 1.0] : [0.85, 0.9, 1.0];
        b = 0.8 + Math.pow(R(), 4) * 4.5;
      } else {
        const k = R();
        col = k < 0.5 ? [1.0, 0.86, 0.66] : k < 0.85 ? [1.0, 0.72, 0.45] : [0.95, 0.9, 0.85];
        b = 0.5 + Math.pow(R(), 3) * 1.4;
      }
    } else {
      kind = 3;
      r = 0.2 + R() * 1.4;
      th = R() * Math.PI * 2;
      z = gauss(R) * 0.35;
      col = [1.0, 0.8, 0.6];
      b = 0.2 + R() * 0.3;
    }
    g.r[i] = r;
    g.th[i] = th;
    g.z[i] = z;
    g.c[i * 3] = col[0];
    g.c[i * 3 + 1] = col[1];
    g.c[i * 3 + 2] = col[2];
    g.b[i] = b;
    g.kind[i] = kind;
    // massive (bright, young) stars die first; faint red dwarfs last
    g.life[i] = clamp(kind === 2 ? R() * 0.45 : 0.28 + R() * 0.72);
  }
  for (let k = 0; k < 220; k++) {
    const r = 0.12 + R() * 0.75;
    const arm = Math.floor(R() * arms);
    g.hii.push({r, th: arm * Math.PI + armAngle(r) + gauss(R) * 0.12, z: gauss(R) * 0.006, s: 0.01 + Math.pow(R(), 2) * 0.035});
  }
  for (let k = 0; k < 900; k++) {
    const r = 0.08 + R() * 0.85;
    const arm = Math.floor(R() * arms);
    g.dust.push({r, th: arm * Math.PI + armAngle(r) - 0.28 + gauss(R) * 0.1, s: 0.02 + R() * 0.05});
  }
  cache.set(key, g);
  return g;
};

export type GalaxyView = {
  cx: number;
  cy: number;
  scale: number; // px per galaxy radius at distance=dist
  dist: number; // camera distance in galaxy radii
  incl: number; // 0 = face on
  yaw: number; // rotation of the disk
  t: number; // time for differential rotation
  bright?: number;
  young?: number; // brightness multiplier of young arm stars
  age?: number; // 0..1 color drift to red
  death?: number; // 0..1 fraction of stars dead
  hii?: number;
  dust?: number;
  core?: number;
  prevDist?: number; // motion streaks during fly-throughs
};

const project = (v: GalaxyView, x: number, y: number, z: number, dist: number) => {
  const cy = Math.cos(v.yaw);
  const sy = Math.sin(v.yaw);
  const xr = x * cy - y * sy;
  const yr = x * sy + y * cy;
  const ci = Math.cos(v.incl);
  const si = Math.sin(v.incl);
  const yy = yr * ci - z * si;
  const zz = yr * si + z * ci;
  const depth = dist + zz;
  if (depth < 0.03) return null;
  const p = dist / depth;
  return [v.cx + xr * p * v.scale, v.cy + yy * p * v.scale, p] as const;
};

/** Points into HDR; then call galaxyOverlay on the context after flushing. */
export const galaxyPoints = (hdr: HDRBuffer, g: Galaxy, v: GalaxyView) => {
  const bright = v.bright ?? 1;
  const young = v.young ?? 1;
  const age = v.age ?? 0;
  const death = v.death ?? 0;
  const flashes: [number, number, number][] = [];
  for (let i = 0; i < g.n; i++) {
    const life = g.life[i];
    if (life < death - 0.012) continue;
    const r = g.r[i];
    const om = 0.9 / (r + 0.12);
    const th = g.th[i] + v.t * om;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th);
    const pr = project(v, x, y, g.z[i], v.dist);
    if (!pr) continue;
    const [sx, sy, p] = pr;
    if (sx < -20 || sx > 1940 || sy < -20 || sy > 1100) continue;
    let b = g.b[i] * bright * Math.min(4, p * p);
    const kind = g.kind[i];
    if (kind === 2) b *= young;
    // dying: brief flare then gone
    let flare = 0;
    if (life < death) {
      const k = (death - life) / 0.012;
      const sel = ((i * 2654435761) >>> 0) % 1000;
      const nova = kind === 2 && sel < 12;
      flare = nova ? (1 - k) * 8 : 0;
      b *= 1 - k;
      if (nova && k < 0.6) flashes.push([sx, sy, (1 - k) * Math.min(2, g.b[i])]);
    }
    let cr = g.c[i * 3];
    let cg = g.c[i * 3 + 1];
    let cb = g.c[i * 3 + 2];
    if (age > 0) {
      const a = clamp(age * (0.6 + 0.8 * (1 - life)));
      cr = lerp(cr, 1.0, a);
      cg = lerp(cg, 0.32, a);
      cb = lerp(cb, 0.12, a);
    }
    b += flare;
    if (v.prevDist !== undefined && Math.abs(v.prevDist - v.dist) > 1e-4) {
      const pp = project(v, x, y, g.z[i], v.prevDist);
      if (pp && Math.hypot(pp[0] - sx, pp[1] - sy) > 1.5) {
        hdr.line(pp[0], pp[1], sx, sy, cr * b * 2, cg * b * 2, cb * b * 2);
        continue;
      }
    }
    if (p > 1.6) hdr.disc(sx, sy, Math.min(5, p * 0.7), cr * b, cg * b, cb * b);
    else hdr.add(sx, sy, cr * b, cg * b, cb * b);
  }
  return flashes;
};

const darkSprite = (() => {
  let c: HTMLCanvasElement | null = null;
  return () => {
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(6,3,2,0.55)');
    grd.addColorStop(0.5, 'rgba(6,3,2,0.25)');
    grd.addColorStop(1, 'rgba(6,3,2,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 64, 64);
    return c;
  };
})();

/** Dust lanes, HII regions, core glow and supernova flashes — drawn after the HDR flush. */
export const galaxyOverlay = (
  ctx: CanvasRenderingContext2D,
  g: Galaxy,
  v: GalaxyView,
  flashes: [number, number, number][],
) => {
  const bright = v.bright ?? 1;
  const dust = (v.dust ?? 1) * Math.min(1, bright);
  if (dust > 0.01) {
    ctx.globalCompositeOperation = 'source-over';
    const ds = darkSprite();
    for (const d of g.dust) {
      const th = d.th + v.t * (0.9 / (d.r + 0.12));
      const pr = project(v, d.r * Math.cos(th), d.r * Math.sin(th), 0, v.dist);
      if (!pr) continue;
      const s = d.s * v.scale * pr[2] * 2;
      if (s < 2 || s > 900) continue;
      ctx.globalAlpha = dust * 0.8;
      ctx.drawImage(ds, pr[0] - s / 2, pr[1] - s / 2 * Math.max(0.35, Math.cos(v.incl)), s, s * Math.max(0.35, Math.cos(v.incl)));
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'lighter';
  const hii = (v.hii ?? 1) * bright;
  if (hii > 0.01) {
    for (const h of g.hii) {
      const th = h.th + v.t * (0.9 / (h.r + 0.12));
      const pr = project(v, h.r * Math.cos(th), h.r * Math.sin(th), h.z, v.dist);
      if (!pr) continue;
      const s = h.s * v.scale * pr[2] * 2.2;
      if (s < 1.5 || s > 1200) continue;
      drawGlow(ctx, pr[0], pr[1], s * 0.7, [1, 0.36, 0.6], hii * 0.3, 0.06);
    }
  }
  const core = (v.core ?? 1) * bright;
  const pc = project(v, 0, 0, 0, v.dist);
  if (pc && core > 0.01) {
    const s = v.scale * pc[2];
    const age = v.age ?? 0;
    drawGlow(ctx, pc[0], pc[1], s * 0.9, [1, lerp(0.75, 0.4, age), lerp(0.5, 0.2, age)], core * 0.5, 0.05);
    drawGlow(ctx, pc[0], pc[1], s * 0.3, [1, lerp(0.85, 0.5, age), lerp(0.65, 0.3, age)], core * 0.8, 0.1);
  }
  for (const [x, y, k] of flashes) {
    drawGlow(ctx, x, y, 20 + k * 30, [0.75, 0.85, 1], Math.min(0.8, k * 0.4), 0.08);
  }
  ctx.globalCompositeOperation = 'source-over';
};

export const projectGalaxyPoint = (v: GalaxyView, r: number, th0: number) => {
  const th = th0 + v.t * (0.9 / (r + 0.12));
  return project(v, r * Math.cos(th), r * Math.sin(th), 0, v.dist);
};
