import {Ctx, RGB, drawGlow, memoTexture, starColor} from './canvas';
import {clamp} from './math';
import {gauss, mulberry32} from './rng';
import {makeNoise} from './noise';

// ---------------------------------------------------------------------------
// Nebula / gas textures (domain-warped fbm), built once per tab.
// ---------------------------------------------------------------------------

export type NebulaOpts = {
  scale?: number;
  warp?: number;
  contrast?: number;
  palette: RGB[];
  alpha?: number;
  octaves?: number;
  vignette?: number;
  // 0..1: how strongly a low-frequency mask carves the gas into clouds.
  mask?: number;
  blur?: number;
};

const samplePalette = (pal: RGB[], t: number): RGB => {
  const x = clamp(t) * (pal.length - 1);
  const i = Math.min(pal.length - 2, Math.floor(x));
  const k = x - i;
  const a = pal[i];
  const b = pal[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

export const nebulaTexture = (seed: number, w: number, h: number, o: NebulaOpts) =>
  memoTexture(`neb-${seed}-${w}x${h}-${JSON.stringify(o)}`, w, h, (ctx) => {
    const n = makeNoise(seed);
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const sc = o.scale ?? 2.2;
    const warp = o.warp ?? 1.6;
    const con = o.contrast ?? 1.6;
    const alpha = o.alpha ?? 1;
    const oct = o.octaves ?? 5;
    const vig = o.vignette ?? 0;
    const maskK = o.mask ?? 0;
    const aspect = w / h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * sc * aspect;
        const v = (y / h) * sc;
        const qx = n.fbm2(u + 1.7, v + 9.2, 4);
        const qy = n.fbm2(u + 8.3, v + 2.8, 4);
        const f = n.fbm2(u + warp * qx, v + warp * qy, oct);
        let val = clamp(Math.pow(clamp(f * 0.5 + 0.5), con) * 1.6);
        if (maskK > 0) {
          const m = n.fbm2(u * 0.35 + 40, v * 0.35 + 17, 3);
          const mk = clamp((m + 0.05) * 2.2);
          val *= 1 - maskK + maskK * mk * mk;
        }
        if (vig > 0) {
          const dx = x / w - 0.5;
          const dy = y / h - 0.5;
          val *= clamp(1 - (dx * dx + dy * dy) * 4 * vig);
        }
        const col = samplePalette(o.palette, clamp(val * 1.1 + 0.25 * qy));
        const i = (y * w + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255 * clamp(val * alpha);
      }
    }
    ctx.putImageData(img, 0, 0);
    const b = o.blur ?? 1.2;
    if (b > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const tc = tmp.getContext('2d')!;
      tc.drawImage(ctx.canvas, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.filter = `blur(${b}px)`;
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = 'none';
    }
  });

// Draw a texture centred, scaled and rotated, covering the frame.
export const drawCover = (
  ctx: Ctx,
  tex: HTMLCanvasElement,
  w: number,
  h: number,
  scale = 1,
  rot = 0,
  alpha = 1,
  ox = 0,
  oy = 0,
) => {
  if (alpha <= 0.003) return;
  const k = Math.max(w / tex.width, h / tex.height) * scale;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.translate(w / 2 + ox, h / 2 + oy);
  ctx.rotate(rot);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tex, (-tex.width * k) / 2, (-tex.height * k) / 2, tex.width * k, tex.height * k);
  ctx.restore();
};

// ---------------------------------------------------------------------------
// 3D starfield with forward camera motion and warp streaks.
// ---------------------------------------------------------------------------

export type Star3 = {x: number; y: number; z: number; s: number; b: number; c: RGB; tw: number};

export const makeStars3 = (seed: number, n: number, spread: number, depth: number): Star3[] => {
  const r = mulberry32(seed);
  const out: Star3[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: (r() * 2 - 1) * spread,
      y: (r() * 2 - 1) * spread,
      z: r() * depth,
      s: 0.4 + Math.pow(r(), 6) * 2.8,
      b: 0.5 + 0.5 * r(),
      c: starColor(r()),
      tw: r() * Math.PI * 2,
    });
  }
  return out;
};

export type StarDrawOpts = {
  camZ: number;
  prevCamZ?: number;
  depth: number;
  focal: number;
  cx?: number;
  cy?: number;
  rot?: number;
  alpha?: number;
  time?: number;
  sizeK?: number;
  // 0..1 tint mix towards `tint` (e.g. red-shift).
  tint?: RGB;
  tintAmt?: number;
  // Radial red/blue Doppler colouring for warp: outer stars redder.
  doppler?: number;
  streakAlpha?: number;
  maxStreak?: number;
};

export const drawStars3 = (ctx: Ctx, w: number, h: number, stars: Star3[], o: StarDrawOpts) => {
  const cx = o.cx ?? w / 2;
  const cy = o.cy ?? h / 2;
  const cos = Math.cos(o.rot ?? 0);
  const sin = Math.sin(o.rot ?? 0);
  const prev = o.prevCamZ ?? o.camZ;
  const dz = o.camZ - prev;
  const A = o.alpha ?? 1;
  const time = o.time ?? 0;
  const sizeK = o.sizeK ?? 1;
  const tintAmt = o.tintAmt ?? 0;
  const tint = o.tint ?? [255, 80, 60];
  const dop = o.doppler ?? 0;
  const streakA = o.streakAlpha ?? 1;
  const maxStreak = o.maxStreak ?? 4000;
  const near = 0.02;
  ctx.lineCap = 'round';
  for (const s of stars) {
    let zr = (s.z - o.camZ) % o.depth;
    if (zr < 0) zr += o.depth;
    if (zr < near) continue;
    const xr = s.x * cos - s.y * sin;
    const yr = s.x * sin + s.y * cos;
    const px = cx + (xr / zr) * o.focal;
    const py = cy + (yr / zr) * o.focal;
    if (px < -200 || px > w + 200 || py < -200 || py > h + 200) continue;
    const fade = clamp((o.depth - zr) / (o.depth * 0.25)) * clamp(zr / 0.15);
    const tw = 0.8 + 0.2 * Math.sin(time * 2.3 + s.tw * 7);
    const a = A * s.b * fade * tw;
    if (a < 0.01) continue;
    const size = Math.min(12, (s.s * sizeK * 1.6) / Math.sqrt(zr + 0.1));
    let c = s.c;
    if (tintAmt > 0) c = [c[0] + (tint[0] - c[0]) * tintAmt, c[1] + (tint[1] - c[1]) * tintAmt, c[2] + (tint[2] - c[2]) * tintAmt];
    if (dop > 0) {
      const rr = clamp(Math.hypot(px - cx, py - cy) / (Math.min(w, h) * 0.6));
      const k = dop * rr;
      c = [c[0] + (255 - c[0]) * k, c[1] * (1 - 0.6 * k), c[2] * (1 - 0.75 * k)];
    }
    const col = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
    if (Math.abs(dz) > 0.0001) {
      const zp = zr + dz;
      if (zp < o.depth && zp > near) {
        const qx = cx + (xr / zp) * o.focal;
        const qy = cy + (yr / zp) * o.focal;
        let lx = px - qx;
        let ly = py - qy;
        const len = Math.hypot(lx, ly);
        if (len > 1.5) {
          if (len > maxStreak) {
            lx *= maxStreak / len;
            ly *= maxStreak / len;
          }
          ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a * streakA)})`;
          ctx.lineWidth = Math.max(0.6, size * 0.7);
          ctx.beginPath();
          ctx.moveTo(px - lx, py - ly);
          ctx.lineTo(px, py);
          ctx.stroke();
          continue;
        }
      }
    }
    if (size > 2.2) {
      drawGlow(ctx, px, py, size * 2.2, c, a * 0.9);
      ctx.fillStyle = col;
      ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }
};

// Static 2D background star dust (very cheap), as a cached texture.
export const starDustTexture = (seed: number, w: number, h: number, count: number) =>
  memoTexture(`dust-${seed}-${w}-${h}-${count}`, w, h, (ctx) => {
    const r = mulberry32(seed);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const x = r() * w;
      const y = r() * h;
      const c = starColor(r());
      const b = Math.pow(r(), 2.2);
      const s = r() < 0.02 ? 1.8 : r() < 0.2 ? 1.2 : 0.8;
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + 0.85 * b})`;
      ctx.fillRect(x, y, s, s);
      if (b > 0.93) drawGlow(ctx, x, y, 4 + 6 * r(), c, 0.35);
    }
  });

// ---------------------------------------------------------------------------
// 3D projection helpers for particle clouds.
// ---------------------------------------------------------------------------

export type Cam = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll?: number;
  focal: number;
  cx: number;
  cy: number;
};

// Returns [sx, sy, depth] or null when behind camera.
export const project = (cam: Cam, x: number, y: number, z: number, out: number[]) => {
  let dx = x - cam.x;
  let dy = y - cam.y;
  let dz = z - cam.z;
  // yaw (around Y)
  const cyw = Math.cos(cam.yaw);
  const syw = Math.sin(cam.yaw);
  let tx = dx * cyw - dz * syw;
  let tz = dx * syw + dz * cyw;
  dx = tx;
  dz = tz;
  // pitch (around X)
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const ty = dy * cp - dz * sp;
  tz = dy * sp + dz * cp;
  dy = ty;
  dz = tz;
  if (cam.roll) {
    const cr = Math.cos(cam.roll);
    const sr = Math.sin(cam.roll);
    tx = dx * cr - dy * sr;
    dy = dx * sr + dy * cr;
    dx = tx;
  }
  if (dz <= 0.001) return false;
  out[0] = cam.cx + (dx / dz) * cam.focal;
  out[1] = cam.cy + (dy / dz) * cam.focal;
  out[2] = dz;
  return true;
};

// Cosmic web: nodes linked to nearest neighbours, particles scattered along
// the filaments and clumped in the nodes. Cached per seed.
export type WebPoint = {x: number; y: number; z: number; b: number; c: RGB; s: number};

export const makeCosmicWeb = (seed: number, nodes: number, box: number, perEdge: number, perNode: number) => {
  const r = mulberry32(seed);
  const N: [number, number, number, number][] = [];
  for (let i = 0; i < nodes; i++) {
    N.push([(r() * 2 - 1) * box, (r() * 2 - 1) * box, (r() * 2 - 1) * box, 0.4 + r() * 0.8]);
  }
  const pts: WebPoint[] = [];
  const edges = new Set<string>();
  for (let i = 0; i < nodes; i++) {
    const d = N.map((p, j) => [j, (p[0] - N[i][0]) ** 2 + (p[1] - N[i][1]) ** 2 + (p[2] - N[i][2]) ** 2] as [number, number])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    for (const [j] of d) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (edges.has(key)) continue;
      edges.add(key);
      const a = N[i];
      const b = N[j];
      const len = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
      const cnt = Math.round(perEdge * (0.5 + len / box));
      // A gently curved filament: offset the midpoint.
      const mx = (a[0] + b[0]) / 2 + gauss(r) * len * 0.12;
      const my = (a[1] + b[1]) / 2 + gauss(r) * len * 0.12;
      const mz = (a[2] + b[2]) / 2 + gauss(r) * len * 0.12;
      for (let k = 0; k < cnt; k++) {
        const t = r();
        const u = 1 - t;
        const x = u * u * a[0] + 2 * u * t * mx + t * t * b[0];
        const y = u * u * a[1] + 2 * u * t * my + t * t * b[1];
        const z = u * u * a[2] + 2 * u * t * mz + t * t * b[2];
        const thick = len * 0.025 * (0.6 + Math.sin(t * Math.PI) * 0.8);
        const hot = r();
        pts.push({
          x: x + gauss(r) * thick,
          y: y + gauss(r) * thick,
          z: z + gauss(r) * thick,
          b: 0.25 + 0.6 * r(),
          c: hot < 0.55 ? [140, 120, 255] : hot < 0.85 ? [90, 170, 255] : [255, 170, 230],
          s: r() < 0.04 ? 2 : 1,
        });
      }
    }
  }
  for (const nd of N) {
    const cnt = Math.round(perNode * nd[3]);
    for (let k = 0; k < cnt; k++) {
      const rad = Math.abs(gauss(r)) * box * 0.035 * nd[3];
      const dir = [gauss(r), gauss(r), gauss(r)];
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      pts.push({
        x: nd[0] + (dir[0] / l) * rad,
        y: nd[1] + (dir[1] / l) * rad,
        z: nd[2] + (dir[2] / l) * rad,
        b: 0.5 + 0.5 * r(),
        c: r() < 0.6 ? [255, 214, 160] : [255, 245, 230],
        s: r() < 0.15 ? 2 : 1,
      });
    }
  }
  return {nodes: N, points: pts};
};

// Night-sky Milky Way band: dense star cloud with glow and dark dust lanes.
export const milkyWayTexture = (seed: number, w: number, h: number, angle = -0.42) =>
  memoTexture(`milkyway-${seed}-${w}-${h}-${angle}`, w, h, (ctx) => {
    const r = mulberry32(seed);
    const n = makeNoise(seed + 1);
    const cx = w / 2;
    const cy = h / 2;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const L = Math.hypot(w, h) * 0.6;
    const width = h * 0.16;
    ctx.globalCompositeOperation = 'lighter';
    // Diffuse glow made of many soft blobs along the band.
    for (let i = 0; i < 900; i++) {
      const along = (r() * 2 - 1) * L;
      const across = gauss(r) * width * 0.8;
      const x = cx + along * ca - across * sa;
      const y = cy + along * sa + across * ca;
      const core = Math.exp(-((along / (L * 0.45)) ** 2));
      const k = 0.5 + 0.5 * n.fbm2(x / 260, y / 260, 3);
      const warm = core * 0.8;
      const col: RGB = [150 + 105 * warm, 150 + 70 * warm, 220 - 60 * warm];
      drawGlow(ctx, x, y, width * (0.5 + r() * 0.9), col, 0.05 * k * (0.5 + core));
    }
    // Star cloud.
    for (let i = 0; i < 42000; i++) {
      const along = (r() * 2 - 1) * L;
      const across = gauss(r) * width * (r() < 0.7 ? 0.55 : 1.4);
      const x = cx + along * ca - across * sa;
      const y = cy + along * sa + across * ca;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const c = starColor(r());
      const b = Math.pow(r(), 2.5);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.12 + 0.7 * b})`;
      const s = b > 0.9 ? 1.6 : 1;
      ctx.fillRect(x, y, s, s);
    }
    // Dark dust lanes carved through the middle of the band.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1400; i++) {
      const along = (r() * 2 - 1) * L;
      const across = gauss(r) * width * 0.22 + n.n2(along / 300, 3.3) * width * 0.35;
      const x = cx + along * ca - across * sa;
      const y = cy + along * sa + across * ca;
      const k = n.fbm2(x / 180, y / 180, 3);
      if (k < -0.05) continue;
      drawGlow(ctx, x, y, width * (0.12 + r() * 0.25), [0, 0, 0], 0.18 + 0.3 * k);
    }
  });
