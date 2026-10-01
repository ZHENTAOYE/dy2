import {Ctx, RGB, getScratch, memo} from './canvas';
import {clamp} from './math';

// Large point clouds rendered by additive splatting into a float buffer,
// then tone-mapped into an ImageData. Much faster than per-point fillRect.

export type V3 = [number, number, number];

export type Cloud = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  size: Uint8Array;
};

export const toCloud = (key: string, pts: {x: number; y: number; z: number; b: number; c: RGB; s: number}[]): Cloud =>
  memo(`cloud-${key}`, () => {
    const n = pts.length;
    const c: Cloud = {
      n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      z: new Float32Array(n),
      r: new Float32Array(n),
      g: new Float32Array(n),
      b: new Float32Array(n),
      size: new Uint8Array(n),
    };
    pts.forEach((p, i) => {
      c.x[i] = p.x;
      c.y[i] = p.y;
      c.z[i] = p.z;
      c.r[i] = (p.c[0] / 255) * p.b;
      c.g[i] = (p.c[1] / 255) * p.b;
      c.b[i] = (p.c[2] / 255) * p.b;
      c.size[i] = p.s;
    });
    return c;
  });

export type LookCam = {pos: V3; target: V3; up?: V3; focal: number; roll?: number};

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const camBasis = (cam: LookCam) => {
  const f = norm([cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]]);
  let r = norm(cross(cam.up ?? [0, 1, 0], f));
  let u = cross(f, r);
  if (cam.roll) {
    const c = Math.cos(cam.roll);
    const s = Math.sin(cam.roll);
    const r2: V3 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
    const u2: V3 = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s];
    r = r2;
    u = u2;
  }
  return {f, r, u};
};

export type CloudOpts = {
  near?: number;
  far?: number;
  alpha?: number;
  gain?: number;
  scale?: number; // expansion factor applied to positions
  falloff?: number; // brightness ~ 1/(1+z*falloff)
  res?: number; // render resolution factor (0.5 = half res)
};

export const renderCloud = (ctx: Ctx, w: number, h: number, cloud: Cloud, cam: LookCam, o: CloudOpts = {}) => {
  const res = o.res ?? 1;
  const W = Math.round(w * res);
  const H = Math.round(h * res);
  const acc = memo(`acc-${W}x${H}`, () => new Float32Array(W * H * 3));
  acc.fill(0);
  const {f, r, u} = camBasis(cam);
  const near = o.near ?? 0.2;
  const far = o.far ?? 100;
  const A = o.alpha ?? 1;
  const sc = o.scale ?? 1;
  const fall = o.falloff ?? 0.05;
  const focal = cam.focal * res;
  const cx = W / 2;
  const cy = H / 2;
  const [px, py, pz] = cam.pos;
  for (let i = 0; i < cloud.n; i++) {
    const dx = cloud.x[i] * sc - px;
    const dy = cloud.y[i] * sc - py;
    const dz = cloud.z[i] * sc - pz;
    const z = dx * f[0] + dy * f[1] + dz * f[2];
    if (z < near || z > far) continue;
    const x = dx * r[0] + dy * r[1] + dz * r[2];
    const y = dx * u[0] + dy * u[1] + dz * u[2];
    const sx = cx + (x / z) * focal;
    const sy = cy - (y / z) * focal;
    if (sx < 1 || sy < 1 || sx >= W - 2 || sy >= H - 2) continue;
    const fog = clamp((far - z) / (far * 0.35)) * clamp((z - near) / (near * 3 + 0.2));
    const k = (A * fog) / (1 + z * fall);
    if (k < 0.002) continue;
    const rr = cloud.r[i] * k;
    const gg = cloud.g[i] * k;
    const bb = cloud.b[i] * k;
    const ix = sx | 0;
    const iy = sy | 0;
    // Close points splat larger; size flag 2 marks bright knots.
    const big = cloud.size[i] > 1 || z < 2.5;
    let o2 = (iy * W + ix) * 3;
    acc[o2] += rr;
    acc[o2 + 1] += gg;
    acc[o2 + 2] += bb;
    if (big) {
      const q = 0.55;
      o2 += 3;
      acc[o2] += rr * q;
      acc[o2 + 1] += gg * q;
      acc[o2 + 2] += bb * q;
      o2 += W * 3;
      acc[o2] += rr * q;
      acc[o2 + 1] += gg * q;
      acc[o2 + 2] += bb * q;
      o2 -= 3;
      acc[o2] += rr * q;
      acc[o2 + 1] += gg * q;
      acc[o2 + 2] += bb * q;
    }
  }
  const canvas = getScratch(`cloud-out-${W}x${H}`, W, H);
  const cctx = canvas.getContext('2d')!;
  const img = memo(`img-${W}x${H}`, () => cctx.createImageData(W, H));
  const d = img.data;
  const gain = o.gain ?? 1.6;
  for (let p = 0, q = 0; p < W * H; p++, q += 3) {
    const o4 = p * 4;
    const R = acc[q];
    const G = acc[q + 1];
    const B = acc[q + 2];
    if (R + G + B < 0.001) {
      d[o4 + 3] = 0;
      continue;
    }
    d[o4] = 255 * (1 - Math.exp(-R * gain));
    d[o4 + 1] = 255 * (1 - Math.exp(-G * gain));
    d[o4 + 2] = 255 * (1 - Math.exp(-B * gain));
    d[o4 + 3] = 255;
  }
  cctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, w, h);
  ctx.restore();
  return {f, r, u};
};

// Project a single world point with the same camera (for sprites/labels).
export const projectLook = (
  cam: LookCam,
  basis: {f: V3; r: V3; u: V3},
  w: number,
  h: number,
  p: V3,
  out: number[],
) => {
  const dx = p[0] - cam.pos[0];
  const dy = p[1] - cam.pos[1];
  const dz = p[2] - cam.pos[2];
  const z = dx * basis.f[0] + dy * basis.f[1] + dz * basis.f[2];
  if (z <= 0.05) return false;
  const x = dx * basis.r[0] + dy * basis.r[1] + dz * basis.r[2];
  const y = dx * basis.u[0] + dy * basis.u[1] + dz * basis.u[2];
  out[0] = w / 2 + (x / z) * cam.focal;
  out[1] = h / 2 - (y / z) * cam.focal;
  out[2] = z;
  return true;
};
