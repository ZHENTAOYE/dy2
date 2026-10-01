import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Flash, Readout, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {SANS} from '../fonts';
import {
  Ctx,
  RGB,
  bloom2,
  chromatic,
  drawFlare,
  drawGalaxy,
  drawGlow,
  drawRing,
  font,
  galaxySprite,
  getScratch,
  memo,
  memoTexture,
  starColor,
} from '../lib/canvas';
import {clamp, decay, lerp, mix3, monotone, smooth} from '../lib/math';
import {makeNoise} from '../lib/noise';
import {LookCam, renderCloud, toCloud} from '../lib/points';
import {gauss, mulberry32} from '../lib/rng';
import {drawCover, makeCosmicWeb, starDustTexture} from '../lib/space';

const LY = 9.461e15;
const AU = 1.496e11;
const BANG = 24.3;

const CAPTIONS = [
  {from: 0.5, to: 3.8, text: '现在，让我们从地球出发，一路向外'},
  {from: 9.6, to: 13.3, text: '银河系：直径约10万光年，拥有数千亿颗恒星'},
  {from: 14.0, to: 17.6, text: '而它，只是可观测宇宙中数千亿个星系之一'},
  {from: 18.0, to: 21.4, text: '宇宙的年龄，只有138亿年'},
  {from: 21.7, to: 24.1, text: '但我们能看到的宇宙——'},
  {from: 28.3, to: 31.6, text: '因为在光赶路的同时，空间本身也在不断膨胀'},
];

// log10(view width in metres) over scene time.
const VIEW = monotone([
  [0, 7.42],
  [3.6, 7.55],
  [5.2, 9.2],
  [6.8, 13.0],
  [8.3, 17.0],
  [9.8, 21.05],
  [13.4, 21.3],
  [15.2, 23.05],
  [17.4, 24.75],
  [21.2, 26.3],
  [BANG, 27.32],
  [32, 27.42],
]);

// Layer visibility in log-space.
const band = (L: number, a: number, b: number, fade = 0.6) => smooth(a - fade, a, L) * (1 - smooth(b, b + fade, L));

// Key positions (metres, Sun at origin).
const GC: [number, number] = [-2.6e20, 0.35e20];
const M31: [number, number] = [GC[0] + 2.0e22, GC[1] - 1.3e22];
const M33: [number, number] = [M31[0] + 0.45e22, M31[1] + 0.5e22];
const LGC: [number, number] = [GC[0] + 0.45 * (M31[0] - GC[0]), GC[1] + 0.45 * (M31[1] - GC[1])];
const GA: [number, number] = [LGC[0] - 1.8e24, LGC[1] + 1.5e24];

const viewCenter = (L: number): [number, number] => {
  const k1 = smooth(19.3, 20.9, L);
  const k2 = smooth(22.0, 23.2, L);
  const k3 = smooth(23.9, 24.9, L);
  const k4 = smooth(25.4, 26.6, L);
  let x = lerp(0, GC[0], k1);
  let y = lerp(0, GC[1], k1);
  x = lerp(x, LGC[0], k2);
  y = lerp(y, LGC[1], k2);
  x = lerp(x, GA[0] * 0.55, k3);
  y = lerp(y, GA[1] * 0.55, k3);
  x = lerp(x, 0, k4);
  y = lerp(y, 0, k4);
  return [x, y];
};

const fmtDist = (m: number) => {
  const km = m / 1e3;
  if (km < 1e4) return `${km.toFixed(0)} 公里`;
  if (km < 1e8) return `${(km / 1e4).toFixed(km < 1e5 ? 1 : 0)} 万公里`;
  const ly = m / LY;
  if (ly < 0.1) return `${(km / 1e8).toFixed(km < 1e9 ? 1 : 0)} 亿公里`;
  if (ly < 1e4) return `${ly.toFixed(ly < 10 ? 1 : 0)} 光年`;
  if (ly < 1e8) return `${(ly / 1e4).toFixed(ly < 1e5 ? 1 : 0)} 万光年`;
  return `${(ly / 1e8).toFixed(ly < 1e9 ? 1 : 0)} 亿光年`;
};

const LABELS: [number, number, string, string][] = [
  [6.0, 9.4, '地球', '直径约 1.27 万公里'],
  [9.4, 11.2, '地月系统', '月球距离约 38 万公里'],
  [11.2, 15.5, '太阳系', '海王星轨道直径约 90 亿公里'],
  [15.5, 19.4, '太阳的邻居', '最近的恒星：比邻星，4.2 光年'],
  [19.4, 22.3, '银河系', '直径约 10 万光年'],
  [22.3, 24.0, '本星系群', '银河系、仙女座星系等 80 多个星系'],
  [24.0, 25.5, '拉尼亚凯亚超星系团', '直径约 5 亿光年，包含约 10 万个星系'],
  [25.5, 26.9, '宇宙网', '尺度达数十亿光年'],
  [26.9, 99, '可观测宇宙', '直径约 930 亿光年'],
];

// ---------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------
const earthTex = () =>
  memo('obs-earth-tex', () => {
    const W = 1024;
    const H = 512;
    const n = makeNoise(201);
    const col = new Float32Array(W * H * 3);
    const cloud = new Float32Array(W * H);
    const water = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat = (y / (H - 1) - 0.5) * Math.PI;
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * Math.PI * 2;
        const vx = Math.cos(lat) * Math.cos(lon);
        const vy = Math.sin(lat);
        const vz = Math.cos(lat) * Math.sin(lon);
        const land = n.fbm3(vx * 1.6, vy * 1.6, vz * 1.6, 6);
        const dry = n.fbm3(vx * 2.6 + 9, vy * 2.6, vz * 2.6, 4);
        const rough = n.fbm3(vx * 9 + 2, vy * 9, vz * 9, 3);
        const lm = smooth(0.04, 0.08, land);
        const ocean = mix3([4, 18, 62], [18, 76, 140], smooth(-0.25, 0.06, land));
        const green = mix3([34, 74, 38], [70, 96, 52], clamp(rough * 2 + 0.5));
        const desert = mix3([150, 120, 80], [196, 168, 120], clamp(rough * 2 + 0.5));
        let ground = mix3(green, desert, smooth(0.0, 0.25, dry + Math.abs(lat) * -0.15 + 0.05));
        ground = mix3(ground, [120, 110, 100], smooth(0.22, 0.4, land) * 0.6);
        let c = mix3(ocean, ground, lm);
        const ice = smooth(1.1, 1.28, Math.abs(lat) + 0.08 * dry);
        c = mix3(c, [232, 238, 248], ice);
        const i = (y * W + x) * 3;
        col[i] = c[0];
        col[i + 1] = c[1];
        col[i + 2] = c[2];
        water[y * W + x] = (1 - lm) * (1 - ice);
        const cv = n.fbm3(vx * 3.2 + 3, vy * 5.5, vz * 3.2, 6);
        cloud[y * W + x] = smooth(0.02, 0.32, cv) * 0.92;
      }
    }
    return {W, H, col, cloud, water};
  });

const drawEarth = (ctx: Ctx, cx: number, cy: number, R: number, rot: number, alpha: number) => {
  if (alpha <= 0.003 || R < 1) return;
  if (R < 6) {
    drawGlow(ctx, cx, cy, R * 4 + 4, [90, 160, 255], alpha);
    return;
  }
  const res = Math.min(720, Math.max(24, Math.round(R * 2)));
  const c = getScratch('obs-earth', res, res);
  const sc = c.getContext('2d')!;
  const img = sc.createImageData(res, res);
  const {W, H, col, cloud, water} = earthTex();
  const half = res / 2;
  const tilt = 0.41;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // Light from the upper left, slightly in front.
  let lx = -0.72;
  let ly = -0.3;
  let lz = 0.62;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll;
  ly /= ll;
  lz /= ll;
  let hx = lx;
  let hy = ly;
  let hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz);
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const cloudShift = rot * 0.15;
  for (let y = 0; y < res; y++) {
    const ny = (y + 0.5 - half) / half;
    for (let x = 0; x < res; x++) {
      const nx = (x + 0.5 - half) / half;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const y1 = ny * ct + nz * st;
      const z1 = -ny * st + nz * ct;
      const lat = Math.asin(clamp(-y1, -1, 1));
      const lon = Math.atan2(z1, nx) + rot;
      // Bilinear texture lookup.
      const fx = ((((lon / (Math.PI * 2)) % 1) + 1) % 1) * W;
      const fy = (lat / Math.PI + 0.5) * (H - 1);
      const x0 = Math.floor(fx) % W;
      const x1 = (x0 + 1) % W;
      const y0 = Math.min(H - 1, Math.floor(fy));
      const y1i = Math.min(H - 1, y0 + 1);
      const ax = fx - Math.floor(fx);
      const ay = fy - y0;
      const i00 = y0 * W + x0;
      const i10 = y0 * W + x1;
      const i01 = y1i * W + x0;
      const i11 = y1i * W + x1;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      let r = col[i00 * 3] * w00 + col[i10 * 3] * w10 + col[i01 * 3] * w01 + col[i11 * 3] * w11;
      let g = col[i00 * 3 + 1] * w00 + col[i10 * 3 + 1] * w10 + col[i01 * 3 + 1] * w01 + col[i11 * 3 + 1] * w11;
      let b = col[i00 * 3 + 2] * w00 + col[i10 * 3 + 2] * w10 + col[i01 * 3 + 2] * w01 + col[i11 * 3 + 2] * w11;
      const wat = water[i00] * w00 + water[i10] * w10 + water[i01] * w01 + water[i11] * w11;
      const cxs = (Math.floor(fx + cloudShift * W) % W + W) % W;
      const cl = cloud[y0 * W + cxs];
      r = r * (1 - cl) + 240 * cl;
      g = g * (1 - cl) + 244 * cl;
      b = b * (1 - cl) + 250 * cl;
      const diff = Math.max(0, nx * lx - ny * ly + nz * lz);
      const light = 0.03 + 0.97 * Math.pow(diff, 0.75);
      const spec = Math.pow(Math.max(0, nx * hx - ny * hy + nz * hz), 70) * wat * (1 - cl) * 1.4;
      const limb = Math.pow(1 - nz, 2.6);
      const o = (y * res + x) * 4;
      img.data[o] = (r * (1 - limb * 0.55) + 80 * limb) * light + 255 * spec;
      img.data[o + 1] = (g * (1 - limb * 0.55) + 150 * limb) * light + 240 * spec;
      img.data[o + 2] = (b * (1 - limb * 0.55) + 255 * limb) * light + 220 * spec;
      img.data[o + 3] = 255 * clamp((1 - d2) * res * 0.5);
    }
  }
  sc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, cx - R, cy - R, R * 2, R * 2);
  ctx.globalCompositeOperation = 'lighter';
  drawRing(ctx, cx, cy, R * 1.012, R * 0.028, [100, 165, 255], 0.6);
  drawGlow(ctx, cx - R * 0.35, cy - R * 0.15, R * 1.55, [70, 130, 255], 0.12);
  ctx.restore();
};

// ---------------------------------------------------------------------------
// Data for the outer layers
// ---------------------------------------------------------------------------
const neighbours = () =>
  memo('obs-neigh', () => {
    const r = mulberry32(203);
    const named: [string, number, number][] = [
      ['比邻星', 4.24, 2.2],
      ['天狼星', 8.6, 0.6],
      ['织女星', 25, 4.0],
      ['牛郎星', 16.7, 5.2],
    ];
    const stars = Array.from({length: 520}, () => {
      const d = Math.pow(r(), 0.5) * 80 * LY;
      const a = r() * Math.PI * 2;
      return {x: Math.cos(a) * d, y: Math.sin(a) * d * 0.9, c: starColor(r()), b: 0.3 + 0.7 * r(), s: 0.6 + Math.pow(r(), 4) * 2.5};
    });
    const labelled = named.map(([name, dly, a]) => ({name, x: Math.cos(a) * dly * LY, y: Math.sin(a) * dly * LY}));
    return {stars, labelled};
  });

const localGroup = () =>
  memo('obs-lg', () => {
    const r = mulberry32(205);
    const dwarfs = Array.from({length: 70}, (_, i) => {
      const host = i % 2 === 0 ? GC : M31;
      const d = (0.15 + Math.pow(r(), 0.7) * 1.0) * 1e22 * (i < 10 ? 0.25 : 1);
      const a = r() * Math.PI * 2;
      return {x: host[0] + Math.cos(a) * d, y: host[1] + Math.sin(a) * d, s: (0.4 + r()) * 1.6e20, b: 0.3 + 0.5 * r()};
    });
    return {dwarfs};
  });

const laniakea = () =>
  memo('obs-lan', () => {
    const r = mulberry32(207);
    const pts: {x: number; y: number; c: RGB; b: number}[] = [];
    const R = 2.5e24;
    for (let sIdx = 0; sIdx < 170; sIdx++) {
      const a = r() * Math.PI * 2;
      const d = R * (0.45 + 0.55 * Math.sqrt(r()));
      const sx = GA[0] + Math.cos(a) * d;
      const sy = GA[1] + Math.sin(a) * d * 0.8;
      const curl = (r() - 0.5) * 0.9;
      const per = 26 + Math.floor(r() * 26);
      for (let k = 0; k < per; k++) {
        const s = Math.pow(r(), 0.8);
        const px = sx + (GA[0] - sx) * s;
        const py = sy + (GA[1] - sy) * s;
        const nx = -(GA[1] - sy);
        const ny = GA[0] - sx;
        const bend = Math.sin(s * Math.PI) * curl * 0.35;
        pts.push({
          x: px + nx * bend + gauss(r) * 0.03 * R,
          y: py + ny * bend + gauss(r) * 0.03 * R,
          c: s > 0.8 ? [255, 220, 170] : r() < 0.5 ? [140, 160, 255] : [190, 140, 255],
          b: 0.35 + 0.65 * r(),
        });
      }
    }
    for (let k = 0; k < 500; k++) {
      const rad = Math.abs(gauss(r)) * R * 0.1;
      const a = r() * Math.PI * 2;
      pts.push({x: GA[0] + Math.cos(a) * rad, y: GA[1] + Math.sin(a) * rad, c: [255, 225, 180], b: 0.15 + 0.3 * r()});
    }
    // Our own neighbourhood on the outskirts.
    for (let k = 0; k < 600; k++) {
      pts.push({x: gauss(r) * 0.11 * R, y: gauss(r) * 0.11 * R, c: r() < 0.5 ? [170, 190, 255] : [255, 220, 190], b: 0.2 + 0.4 * r()});
    }
    return pts;
  });

const U = 1e25; // web units → metres
const R_OBS = 44; // observable-universe radius in web units (4.4e26 m)

const universeWeb = () =>
  memo('obs-web', () => {
    const W = makeCosmicWeb(209, 330, R_OBS, 120, 90, 0.03, 0.35);
    const inside = W.points.filter((p) => p.x * p.x + p.y * p.y + p.z * p.z < R_OBS * R_OBS);
    return toCloud('obs-web', inside);
  });

// A finer web for the intermediate scales (we are inside it).
const fineWeb = () =>
  memo('obs-web-fine', () => {
    const W = makeCosmicWeb(219, 170, 4, 170, 150, 0.035, 0.35);
    return toCloud('obs-web-fine', W.points);
  });

const cmbRing = () =>
  memoTexture('obs-cmb-ring', 1024, 1024, (ctx) => {
    const n = makeNoise(211);
    const img = ctx.createImageData(1024, 1024);
    const stops: [number, RGB][] = [
      [0.0, [8, 24, 110]],
      [0.3, [50, 120, 220]],
      [0.48, [190, 220, 240]],
      [0.56, [252, 230, 170]],
      [0.75, [250, 140, 50]],
      [1.0, [170, 25, 20]],
    ];
    const pal = (v: number): RGB => {
      for (let i = 1; i < stops.length; i++) {
        if (v <= stops[i][0]) return mix3(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
      }
      return stops[stops.length - 1][1];
    };
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const dx = (x - 512) / 512;
        const dy = (y - 512) / 512;
        const rr = Math.hypot(dx, dy);
        if (rr < 0.84 || rr > 1) continue;
        const a = Math.atan2(dy, dx);
        const v = 0.5 + n.fbm3(Math.cos(a) * 6, Math.sin(a) * 6, rr * 9, 4) * 1.1;
        const c = pal(clamp(v));
        const edge = smooth(0.84, 0.9, rr) * (1 - smooth(0.97, 1, rr));
        const o = (y * 1024 + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255 * edge;
      }
    }
    ctx.putImageData(img, 0, 0);
  });

export const SceneObservable: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const L = VIEW(t);
  const dL = VIEW(t + 1 / fps) - L;
  const zoomSpeed = clamp(dL * fps / 2.6);
  const label = LABELS.find(([a, b]) => L >= a && L < b);
  const labelK = label ? smooth(label[0], label[0] + 0.25, L) * (1 - smooth(label[1] - 0.25, label[1], L)) : 0;
  const finalK = smooth(26.9, 27.3, L);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={zoomSpeed * 0.18 + 1.0 * decay(t, BANG, 1.8)} zoom={0}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const pxPerM = w / Math.pow(10, L);
            const [vcx, vcy] = viewCenter(L);
            const sx = (x: number) => w / 2 + (x - vcx) * pxPerM;
            const sy = (y: number) => h / 2 + (y - vcy) * pxPerM;
            const P = (x: number, y: number) => [sx(x), sy(y)] as const;

            // Fixed far-away stars while we are still inside the solar system.
            drawCover(ctx, starDustTexture(22, 1920, 1080, 4200), w, h, 1.0, 0, 0.9 * (1 - smooth(15.5, 17.5, L)));
            ctx.globalCompositeOperation = 'lighter';

            // ---- Earth ----
            const aEarth = band(L, 0, 10.2, 0.8);
            if (aEarth > 0) {
              const R = 0.5 * 1.2742e7 * pxPerM;
              const [ex, ey] = P(0, 0);
              ctx.globalCompositeOperation = 'source-over';
              drawEarth(ctx, ex, ey, R, 1.2 + t * 0.12, aEarth);
              ctx.globalCompositeOperation = 'lighter';
            }
            // ---- Moon orbit ----
            const aMoon = band(L, 8.2, 11.0, 0.8);
            if (aMoon > 0) {
              const R = 3.84e8 * pxPerM;
              const [ex, ey] = P(0, 0);
              ctx.strokeStyle = `rgba(170,200,255,${0.4 * aMoon})`;
              ctx.lineWidth = 1.5 * u;
              ctx.beginPath();
              ctx.arc(ex, ey, R, 0, Math.PI * 2);
              ctx.stroke();
              const ma = 2.2 + t * 0.05;
              drawGlow(ctx, ex + Math.cos(ma) * R, ey + Math.sin(ma) * R, 10 * u, [220, 220, 230], aMoon);
            }
            // ---- Solar system ----
            const aSol = band(L, 10.6, 15.6, 0.8);
            if (aSol > 0) {
              const orbits = [0.39, 0.72, 1, 1.52, 5.2, 9.58, 19.2, 30.1];
              const cols: RGB[] = [
                [200, 190, 180],
                [255, 220, 160],
                [110, 170, 255],
                [255, 130, 90],
                [255, 200, 150],
                [240, 220, 170],
                [150, 230, 255],
                [110, 150, 255],
              ];
              // Earth sits at the origin; the Sun is 1 AU away.
              const sunX = -AU;
              const sunY = 0;
              const [cx0, cy0] = P(sunX, sunY);
              orbits.forEach((o, i) => {
                const R = o * AU * pxPerM;
                if (R < 2 || R > w * 3) return;
                ctx.strokeStyle = `rgba(160,190,255,${0.32 * aSol})`;
                ctx.lineWidth = 1.2 * u;
                ctx.beginPath();
                ctx.arc(cx0, cy0, R, 0, Math.PI * 2);
                ctx.stroke();
                const ang = i === 2 ? 0 : i * 1.7 + t * (0.3 / Math.sqrt(o * o * o));
                drawGlow(ctx, cx0 + Math.cos(ang) * R, cy0 + Math.sin(ang) * R, (5 + (i >= 4 ? 4 : 0)) * u, cols[i], aSol);
              });
              drawGlow(ctx, cx0, cy0, Math.max(14 * u, 6.96e8 * pxPerM * 6), [255, 220, 140], aSol);
              drawGlow(ctx, cx0, cy0, 6 * u, [255, 255, 240], aSol);
            }
            // ---- Stellar neighbourhood ----
            const aNb = band(L, 15.4, 19.8, 0.8);
            if (aNb > 0) {
              const {stars, labelled} = neighbours();
              for (const s of stars) {
                const [x, y] = P(s.x, s.y);
                if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
                drawGlow(ctx, x, y, (3 + 5 * s.s) * u, s.c, s.b * aNb);
              }
              const [x0, y0] = P(-AU, 0);
              drawFlare(ctx, x0, y0, 60 * u, [255, 230, 170], aNb);
              ctx.save();
              ctx.globalCompositeOperation = 'source-over';
              ctx.font = font(22 * u, 500);
              ctx.fillStyle = `rgba(255,230,180,${aNb})`;
              ctx.fillText('太阳', x0 + 18 * u, y0 - 14 * u);
              for (const lb of labelled) {
                const [x, y] = P(lb.x, lb.y);
                ctx.fillStyle = `rgba(200,220,255,${aNb * 0.9})`;
                ctx.fillText(lb.name, x + 14 * u, y - 10 * u);
              }
              ctx.restore();
              for (const lb of labelled) {
                const [x, y] = P(lb.x, lb.y);
                drawGlow(ctx, x, y, 14 * u, [210, 225, 255], aNb);
              }
            }
            // ---- Milky Way ----
            const aMW = band(L, 19.2, 23.4, 0.9);
            if (aMW > 0) {
              const D = 1.0e21 * pxPerM / 0.92;
              const [gx, gy] = P(GC[0], GC[1]);
              drawGalaxy(ctx, galaxySprite(213, 'barred', 1024, 150000), gx, gy, D, 0.3, 0.92, aMW);
              // "You are here".
              const here = aMW * (1 - smooth(21.6, 22.2, L));
              if (here > 0) {
                const [hx, hy] = P(0, 0);
                drawRing(ctx, hx, hy, 18 * u, 2.5 * u, [120, 230, 255], here);
                drawGlow(ctx, hx, hy, 12 * u, [150, 240, 255], here);
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.font = font(26 * u, 500);
                ctx.fillStyle = `rgba(150,235,255,${here})`;
                ctx.fillText('你在这里', hx + 28 * u, hy + 8 * u);
                ctx.restore();
              }
            }
            // ---- Local Group ----
            const aLG = band(L, 22.0, 24.6, 0.8);
            if (aLG > 0) {
              const [ax, ay] = P(M31[0], M31[1]);
              drawGalaxy(ctx, galaxySprite(215, 'spiral', 512, 40000), ax, ay, (5.5e21 * pxPerM) / 0.92, -0.6, 0.35, aLG);
              drawGlow(ctx, ax, ay, 6e21 * pxPerM, [200, 190, 255], 0.25 * aLG);
              const [tx, ty] = P(M33[0], M33[1]);
              drawGalaxy(ctx, galaxySprite(217, 'spiral', 256, 9000), tx, ty, (1.6e21 * pxPerM) / 0.92, 1.1, 0.6, aLG);
              for (const d of localGroup().dwarfs) {
                const [x, y] = P(d.x, d.y);
                drawGlow(ctx, x, y, Math.max(4 * u, d.s * 2.5 * pxPerM), [220, 210, 255], d.b * aLG);
              }
              ctx.save();
              ctx.globalCompositeOperation = 'source-over';
              ctx.font = font(24 * u, 500);
              const lk = aLG * (1 - smooth(23.6, 24.0, L));
              ctx.fillStyle = `rgba(220,230,255,${lk})`;
              ctx.fillText('仙女座星系', ax + 40 * u, ay - 30 * u);
              const [gx, gy] = P(GC[0], GC[1]);
              ctx.fillText('银河系', gx + 30 * u, gy + 40 * u);
              ctx.restore();
            }
            // ---- Laniakea ----
            const aLan = band(L, 23.8, 25.5, 0.7);
            if (aLan > 0) {
              for (const p of laniakea()) {
                const [x, y] = P(p.x, p.y);
                if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
                const gr = 0.5e21 * pxPerM;
                if (gr > 7 * u) {
                  drawGalaxy(ctx, galaxySprite(230 + (Math.abs(Math.floor(p.x / 1e21)) % 6), 'spiral', 128, 1800), x, y, gr * 2.2, p.x, 0.6, p.b * aLan);
                } else if (gr > 1.4 * u) {
                  drawGlow(ctx, x, y, gr * 1.8, p.c, p.b * aLan * 0.7);
                } else {
                  ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.b * aLan})`;
                  ctx.fillRect(x - 1, y - 1, 2.2 * u, 2.2 * u);
                }
              }
              const [gx, gy] = P(GA[0], GA[1]);
              drawGlow(ctx, gx, gy, 0.35e24 * pxPerM, [255, 210, 160], 0.22 * aLan);
              const [hx, hy] = P(0, 0);
              drawRing(ctx, hx, hy, 10 * u, 2 * u, [120, 230, 255], aLan);
              ctx.save();
              ctx.globalCompositeOperation = 'source-over';
              ctx.setLineDash([8 * u, 10 * u]);
              ctx.strokeStyle = `rgba(200,180,255,${0.45 * aLan})`;
              ctx.lineWidth = 1.5 * u;
              ctx.beginPath();
              for (let i = 0; i <= 96; i++) {
                const a = (i / 96) * Math.PI * 2;
                const rr = 2.6e24 * (1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7));
                const [x, y] = P(GA[0] + Math.cos(a) * rr, GA[1] + Math.sin(a) * rr * 0.85);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.font = font(22 * u, 500);
              ctx.fillStyle = `rgba(150,235,255,${aLan})`;
              ctx.fillText('银河系在这里', hx + 18 * u, hy + 8 * u);
              ctx.restore();
            }
            // ---- Cosmic web → observable universe ----
            const aWeb = smooth(24.8, 25.5, L);
            if (aWeb > 0) {
              const Wunits = Math.pow(10, L) / U;
              const focal = S * 0.95;
              const Dc = (Wunits * focal) / w;
              const yaw = 0.25 + t * 0.03;
              const cam: LookCam = {
                pos: [Math.sin(yaw) * Dc, Dc * 0.12, -Math.cos(yaw) * Dc],
                target: [0, 0, 0],
                focal,
              };
              const dim = 1 - 0.35 * smooth(BANG - 0.2, BANG + 0.6, t) * (1 - smooth(27.6, 28.4, t));
              const aFine = aWeb * (1 - smooth(25.9, 26.5, L));
              if (aFine > 0.003) {
                renderCloud(ctx, w, h, fineWeb(), cam, {near: 0.03, far: Dc + 8, alpha: aFine * 2.4, gain: 1.15, falloff: 0.0});
              }
              const aCoarse = aWeb * smooth(25.9, 26.5, L);
              if (aCoarse > 0.003) {
                renderCloud(ctx, w, h, universeWeb(), cam, {
                  near: 0.05,
                  far: Dc + R_OBS * 1.2,
                  alpha: aCoarse * lerp(4.0, 1.9, smooth(26.4, 27.2, L)) * dim,
                  gain: 1.1,
                  falloff: 0.0,
                });
              }
              // The boundary: light from the edge is the CMB.
              if (Dc > R_OBS * 1.05) {
                const rs = (focal * R_OBS) / Math.sqrt(Dc * Dc - R_OBS * R_OBS);
                const ringA = smooth(BANG - 0.5, BANG + 0.15, t);
                ctx.save();
                ctx.globalAlpha = ringA;
                ctx.globalCompositeOperation = 'source-over';
                ctx.translate(w / 2, h / 2);
                ctx.rotate(t * 0.02);
                const ring = cmbRing();
                ctx.drawImage(ring, -rs * 1.04, -rs * 1.04, rs * 2.08, rs * 2.08);
                ctx.restore();
                ctx.globalCompositeOperation = 'lighter';
                drawRing(ctx, w / 2, h / 2, rs * 1.04, rs * 0.04, [255, 200, 150], ringA * 0.6);
                drawGlow(ctx, w / 2, h / 2, rs * 1.5, [255, 170, 110], ringA * 0.12);
                drawGlow(ctx, w / 2, h / 2, 14 * u, [140, 230, 255], ringA);
                drawRing(ctx, w / 2, h / 2, 22 * u, 2.5 * u, [140, 230, 255], ringA);
              }
            }
            // Impact at the reveal.
            if (t > BANG - 0.05) {
              const e = t - BANG;
              const rk = clamp(e / 1.6);
              drawRing(ctx, w / 2, h / 2, (1 - Math.pow(1 - rk, 3)) * S * 1.2, S * 0.04 * (1 - rk) + 3, [255, 230, 200], (1 - rk) * 0.9);
            }
            ctx.globalCompositeOperation = 'source-over';
            bloom2(ctx, w, h, 0.6 + zoomSpeed * 0.3 + 0.8 * decay(t, BANG, 1.6));
            chromatic(ctx, w, h, zoomSpeed * 10 + 26 * decay(t, BANG, 2.2));
          }}
        />
      </Shake>

      {/* Object label */}
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: '6%',
            top: '22%',
            opacity: labelK * (1 - smooth(BANG - 0.3, BANG, t) * (1 - smooth(28, 28.8, t))),
            fontFamily: SANS,
            textShadow: '0 2px 10px rgba(0,0,0,0.9)',
          }}
        >
          <div style={{fontWeight: 900, fontSize: 52 * u, color: '#fff', letterSpacing: '0.12em'}}>{label[2]}</div>
          <div style={{fontWeight: 300, fontSize: 26 * u, color: 'rgba(210,225,255,0.9)', letterSpacing: '0.1em', marginTop: 8 * u}}>
            {label[3]}
          </div>
        </div>
      ) : null}
      <Readout
        backdrop
        label="视野宽度"
        value={fmtDist(Math.pow(10, L))}
        x={0.94}
        y={0.27}
        align="right"
        size={54}
        opacity={smooth(3.4, 4.2, t) * (1 - finalK * 0.4)}
      />
      {/* Ring caption */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '8%',
          transform: 'translateX(-50%)',
          fontFamily: SANS,
          fontWeight: 300,
          fontSize: 26 * u,
          letterSpacing: '0.2em',
          color: 'rgba(255,215,170,0.95)',
          opacity: smooth(28.4, 29.2, t),
          textShadow: '0 2px 10px rgba(0,0,0,0.9)',
          whiteSpace: 'nowrap',
        }}
      >
        外圈：宇宙微波背景 —— 我们能看到的最远的光
      </div>
      <ChapterTag index="08" title="可观测宇宙" en="THE OBSERVABLE UNIVERSE" dur={dur} />
      <Statement from={BANG} to={28.0} text="直径约930亿光年" sub="THE OBSERVABLE UNIVERSE" theme="gold" size={124} serif slam />
      <Captions items={CAPTIONS} />
      <Flash amount={decay(t, BANG - 0.03, 5) * 1.0} />
      <Fade amount={1 - smooth(0, 0.5, t) + smooth(dur - 0.5, dur, t)} />
    </AbsoluteFill>
  );
};
