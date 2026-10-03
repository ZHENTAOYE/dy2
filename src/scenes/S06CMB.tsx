import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Flash, Readout, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {SANS} from '../fonts';
import {Ctx, RGB, bloom2, chromatic, drawGlow, drawRing, font, getScratch, memo} from '../lib/canvas';
import {clamp, decay, easeInOutCubic, easeOutCubic, lerp, mix3, smooth, win} from '../lib/math';
import {makeNoise} from '../lib/noise';
import {hash2, mulberry32} from '../lib/rng';
import {drawCover, drawStars3, makeStars3, nebulaTexture} from '../lib/space';

const CLEAR = 12.0;

const CAPTIONS = [
  {from: 0.1, to: 4.35, text: '最初的38万年里，|宇宙是一锅炽热、浑浊的【等离子体】'},
  {from: 4.7, to: 7.75, text: '光子不断被自由电子散射，寸步难行'},
  {from: 8.3, to: 11.98, text: '直到宇宙冷却到约3000 K，|电子被原子核捕获——'},
  {from: 15.6, to: 20.18, text: '那一刻释放的光，穿越138亿年，|至今仍充满整个宇宙'},
  {from: 20.53, to: 25.66, text: '它就是【宇宙微波背景辐射】，|如今温度只有2.725 K'},
];

// ---------------------------------------------------------------------------
// Plasma particles
// ---------------------------------------------------------------------------
type Pair = {px: number; py: number; ex: number; ey: number; ph: number; join: number};

const pairs = () =>
  memo('cmb-pairs', () => {
    const r = mulberry32(111);
    return Array.from({length: 260}, (): Pair => ({
      px: r(),
      py: r(),
      ex: r(),
      ey: r(),
      ph: r() * Math.PI * 2,
      join: 9.0 + r() * 2.6,
    }));
  });

// Random walk of a photon: a new direction every `seg` seconds.
const walk = (i: number, t: number, seg: number, speed: number, out: number[][], keep: number) => {
  const n = Math.floor(t / seg);
  let x = hash2(i, 1);
  let y = hash2(i, 2);
  out.length = 0;
  const start = Math.max(0, n - 60);
  for (let s = 0; s < start; s++) {
    const a = hash2(i, s + 10) * Math.PI * 2;
    x += Math.cos(a) * speed * seg;
    y += Math.sin(a) * speed * seg;
  }
  for (let s = start; s <= n; s++) {
    const a = hash2(i, s + 10) * Math.PI * 2;
    const dt = s === n ? t - n * seg : seg;
    if (s >= n - keep) out.push([x, y]);
    x += Math.cos(a) * speed * dt;
    y += Math.sin(a) * speed * dt;
  }
  out.push([x, y]);
};

const wrap = (v: number) => ((v % 1) + 1) % 1;

// ---------------------------------------------------------------------------
// CMB sphere
// ---------------------------------------------------------------------------
const PLANCK: [number, RGB][] = [
  [0.0, [8, 24, 110]],
  [0.25, [40, 110, 215]],
  [0.45, [175, 215, 240]],
  [0.55, [252, 232, 175]],
  [0.75, [250, 140, 50]],
  [1.0, [170, 25, 20]],
];

const planck = (x: number): RGB => {
  const v = clamp(x);
  for (let i = 1; i < PLANCK.length; i++) {
    if (v <= PLANCK[i][0]) {
      const [a, ca] = PLANCK[i - 1];
      const [b, cb] = PLANCK[i];
      return mix3(ca, cb, (v - a) / (b - a));
    }
  }
  return PLANCK[PLANCK.length - 1][1];
};

const cmbMap = () =>
  memo('cmb-map', () => {
    const W = 512;
    const H = 256;
    const n = makeNoise(121);
    const data = new Uint8ClampedArray(W * H * 3);
    for (let y = 0; y < H; y++) {
      const lat = (y / (H - 1) - 0.5) * Math.PI;
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * Math.PI * 2;
        const vx = Math.cos(lat) * Math.cos(lon);
        const vy = Math.sin(lat);
        const vz = Math.cos(lat) * Math.sin(lon);
        const big = n.fbm3(vx * 2.2, vy * 2.2, vz * 2.2, 3);
        const small = n.fbm3(vx * 9 + 7, vy * 9, vz * 9, 4);
        const c = planck(0.5 + big * 0.85 + small * 0.75);
        const i = (y * W + x) * 3;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
    }
    return {W, H, data};
  });

const drawCMBSphere = (ctx: Ctx, cx: number, cy: number, R: number, rotY: number, alpha: number) => {
  if (alpha <= 0.003 || R < 2) return;
  const res = Math.max(32, Math.round(R * 1.3));
  const c = getScratch('cmb-sphere', res, res);
  const sc = c.getContext('2d')!;
  const img = sc.createImageData(res, res);
  const {W, H, data} = cmbMap();
  const tilt = 0.35;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cr = Math.cos(rotY);
  const sr = Math.sin(rotY);
  const half = res / 2;
  for (let y = 0; y < res; y++) {
    const ny = (y + 0.5 - half) / half;
    for (let x = 0; x < res; x++) {
      const nx = (x + 0.5 - half) / half;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      // Undo tilt (around X) then spin (around Y).
      const y1 = ny * ct + nz * st;
      const z1 = -ny * st + nz * ct;
      const x2 = nx * cr - z1 * sr;
      const z2 = nx * sr + z1 * cr;
      const lat = Math.asin(clamp(-y1, -1, 1));
      const lon = Math.atan2(z2, x2);
      const tx = Math.floor((((lon / (Math.PI * 2)) % 1) + 1) % 1 * W) % W;
      const ty = Math.min(H - 1, Math.floor((lat / Math.PI + 0.5) * (H - 1)));
      const si = (ty * W + tx) * 3;
      const shade = 0.55 + 0.45 * nz;
      const o = (y * res + x) * 4;
      img.data[o] = data[si] * shade;
      img.data[o + 1] = data[si + 1] * shade;
      img.data[o + 2] = data[si + 2] * shade;
      img.data[o + 3] = 255 * clamp((1 - d2) * 40);
    }
  }
  sc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, cx - R, cy - R, R * 2, R * 2);
  ctx.globalCompositeOperation = 'lighter';
  drawRing(ctx, cx, cy, R, R * 0.035, [255, 200, 150], 0.5);
  drawGlow(ctx, cx, cy, R * 1.5, [255, 150, 90], 0.18);
  ctx.restore();
};

export const SceneCMB: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const cool = smooth(8.6, 12.0, t);
  const cleared = smooth(CLEAR, CLEAR + 2.0, t);
  const sphereA = smooth(15.6, 17.4, t);
  const stretch = smooth(16.2, 19.8, t);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={0.6 * decay(t, CLEAR, 2.2) + 0.08 * (1 - cleared)}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cx = w / 2;
            const cy = h / 2;
            // ----- Fog (opaque plasma), drawn offscreen so the clearing can carve it -----
            if (t < CLEAR + 2.5) {
              const fogC = getScratch('cmb-fog', w, h);
              const f = fogC.getContext('2d')!;
              f.globalCompositeOperation = 'source-over';
              f.globalAlpha = 1;
              const base = mix3([255, 150, 70], [150, 40, 30], cool);
              f.fillStyle = `rgb(${base[0] * 0.32},${base[1] * 0.22},${base[2] * 0.2})`;
              f.fillRect(0, 0, w, h);
              const fog = nebulaTexture(131, 480, 270, {
                palette: [
                  [0, 0, 0],
                  [90, 24, 12],
                  [210, 90, 36],
                  [255, 170, 90],
                  [255, 230, 190],
                ],
                scale: 2.2,
                warp: 2.0,
                contrast: 2.0,
              });
              f.globalCompositeOperation = 'lighter';
              for (let i = 0; i < 2; i++) {
                const ph = ((t * 0.05 + i / 2) % 1 + 1) % 1;
                drawCover(f, fog, w, h, 1.5 * Math.pow(1.8, ph), i * 1.7 + t * 0.02, (0.42 - 0.18 * cool) * Math.sin(Math.PI * ph));
              }
              // Electrons, protons and, later, atoms.
              const P = pairs();
              for (let i = 0; i < P.length; i++) {
                const p = P[i];
                const jx = Math.sin(t * 1.3 + p.ph) * 0.004;
                const jy = Math.cos(t * 1.1 + p.ph * 2) * 0.004;
                const px = wrap(p.px + t * 0.004 + jx) * w;
                const py = wrap(p.py + jy) * h;
                const k = easeInOutCubic(smooth(p.join, p.join + 0.9, t));
                const ea = t * 6 + p.ph;
                const free = [
                  wrap(p.ex + Math.sin(t * 2.7 + p.ph * 3) * 0.02 + t * 0.006) * w,
                  wrap(p.ey + Math.cos(t * 2.3 + p.ph) * 0.02) * h,
                ];
                const bound = [px + Math.cos(ea) * 9 * u, py + Math.sin(ea) * 9 * u * 0.6];
                const ex = lerp(free[0], bound[0], k);
                const ey = lerp(free[1], bound[1], k);
                drawGlow(f, px, py, 12 * u, [255, 110, 90], 0.7);
                f.fillStyle = '#ffd0c0';
                f.fillRect(px - 2 * u, py - 2 * u, 4 * u, 4 * u);
                drawGlow(f, ex, ey, 8 * u, [110, 180, 255], 0.8);
                if (k > 0.98) {
                  f.strokeStyle = 'rgba(150,200,255,0.25)';
                  f.lineWidth = 1;
                  f.beginPath();
                  f.ellipse(px, py, 9 * u, 9 * u * 0.6, 0, 0, Math.PI * 2);
                  f.stroke();
                }
              }
              // Photons trapped in a random walk.
              const path: number[][] = [];
              for (let i = 0; i < 70; i++) {
                walk(i, t + i * 0.37, 0.18, 0.18, path, 6);
                f.lineCap = 'round';
                for (let s = 1; s < path.length; s++) {
                  const ax = wrap(path[s - 1][0]) * w;
                  const ay = wrap(path[s - 1][1]) * h;
                  const bx = ax + (path[s][0] - path[s - 1][0]) * w;
                  const by = ay + (path[s][1] - path[s - 1][1]) * h;
                  const a = (s / path.length) * 0.8;
                  f.strokeStyle = `rgba(255,250,210,${a})`;
                  f.lineWidth = 2 * u;
                  f.beginPath();
                  f.moveTo(ax, ay);
                  f.lineTo(bx, by);
                  f.stroke();
                }
                const last = path[path.length - 1];
                drawGlow(f, wrap(last[0]) * w, wrap(last[1]) * h, 14 * u, [255, 250, 220], 0.9);
              }
              // Hero photon near the centre, with a long trail.
              walk(999, t, 0.3, 0.06, path, 18);
              let mx = 0;
              let my = 0;
              for (const q of path) {
                mx += q[0] / path.length;
                my += q[1] / path.length;
              }
              const ox = cx - mx * w;
              const oy = cy - my * h;
              f.strokeStyle = 'rgba(255,255,235,1)';
              f.lineWidth = 4.5 * u;
              f.shadowColor = 'rgba(255,240,180,1)';
              f.shadowBlur = 22 * u;
              f.beginPath();
              for (let s = 0; s < path.length; s++) {
                const x = ox + path[s][0] * w;
                const y = oy + path[s][1] * h;
                if (s === 0) f.moveTo(x, y);
                else f.lineTo(x, y);
              }
              f.stroke();
              f.shadowBlur = 0;
              const hx = ox + path[path.length - 1][0] * w;
              const hy = oy + path[path.length - 1][1] * h;
              drawGlow(f, hx, hy, 60 * u, [255, 250, 220], 1);
              drawGlow(f, hx, hy, 16 * u, [255, 255, 255], 1);
              // Labels for the first seconds.
              const lab = win(t, 1.2, 8.4, 0.6, 0.6);
              if (lab > 0) {
                f.save();
                f.globalCompositeOperation = 'source-over';
                f.font = font(26 * u, 500);
                // Dark outline so photon trails and bright plasma don't scribble over the text.
                f.lineJoin = 'round';
                f.lineWidth = 6 * u;
                f.strokeStyle = `rgba(40,10,4,${0.7 * lab})`;
                const label = (s: string, x: number, y: number, rgb: string) => {
                  f.strokeText(s, x, y);
                  f.fillStyle = `rgba(${rgb},${lab})`;
                  f.fillText(s, x, y);
                };
                label('光子 γ', hx + 26 * u, hy - 18 * u, '255,250,230');
                // P[34] stays clear of the frame edges, the caption band and the hero photon in both layouts.
                const p0 = P[34];
                label('质子 p⁺', wrap(p0.px + t * 0.004) * w + 16 * u, wrap(p0.py) * h - 10 * u, '255,190,170');
                const p1 = P[7];
                label('电子 e⁻', wrap(p1.ex + t * 0.006) * w + 16 * u, wrap(p1.ey) * h + 26 * u, '160,205,255');
                f.restore();
              }
              // Carve the transparency wave.
              if (t > CLEAR - 0.05) {
                const R = easeOutCubic(clamp((t - CLEAR) / 1.8)) * Math.hypot(w, h) * 0.62;
                f.globalCompositeOperation = 'destination-out';
                const g = f.createRadialGradient(cx, cy, Math.max(0, R - S * 0.25), cx, cy, R + 1);
                g.addColorStop(0, 'rgba(0,0,0,1)');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                f.fillStyle = g;
                f.fillRect(0, 0, w, h);
              }
              f.globalCompositeOperation = 'source-over';
              ctx.drawImage(fogC, 0, 0);
              if (t > CLEAR - 0.05) {
                const R = easeOutCubic(clamp((t - CLEAR) / 1.8)) * Math.hypot(w, h) * 0.62;
                ctx.globalCompositeOperation = 'lighter';
                drawRing(ctx, cx, cy, R, S * 0.07, [255, 230, 190], 0.9 * (1 - cleared * 0.8));
                ctx.globalCompositeOperation = 'source-over';
              }
            }

            // ----- Released light: free-streaming photons rushing outward -----
            if (t > CLEAR - 0.1) {
              ctx.globalCompositeOperation = 'lighter';
              const k = t - CLEAR;
              const speed = 3.2 + 7 * decay(t, CLEAR, 0.6);
              const camZ = k * speed + 0.0;
              const prevZ = (k - 1 / fps) * (3.2 + 7 * decay(t - 1 / fps, CLEAR, 0.6));
              const col = mix3([255, 245, 210], [255, 70, 40], stretch);
              const lightA = smooth(CLEAR - 0.1, CLEAR + 0.4, t) * (1 - smooth(18.5, 21, t));
              drawStars3(ctx, w, h, memo('cmb-photons', () => makeStars3(133, 4200, 10, 10)), {
                camZ,
                prevCamZ: prevZ,
                depth: 10,
                focal: S * 0.8,
                alpha: lightA,
                tint: col,
                tintAmt: 1,
                sizeK: 1.8,
                streakAlpha: 1,
              });
              drawGlow(ctx, cx, cy, S * 0.5, col, decay(t, CLEAR, 1.2) * 0.8, 3);
              drawGlow(ctx, cx, cy, S * 0.9, col, lightA * 0.18 * (1 - sphereA), 2);
              ctx.globalCompositeOperation = 'source-over';
            }

            // ----- The CMB sphere -----
            if (sphereA > 0) {
              const R = S * lerp(0.2, 0.345, easeOutCubic(smooth(15.6, 19, t)));
              drawCMBSphere(ctx, cx, cy * 0.96, R, t * 0.22, sphereA);
            }
            bloom2(ctx, w, h, 0.5 + 0.9 * decay(t, CLEAR, 1.5) + 0.2 * sphereA);
            chromatic(ctx, w, h, 26 * decay(t, CLEAR, 2.5));
          }}
        />
      </Shake>
      <Readout
        backdrop
        label="温度"
        value={`${Math.round(lerp(3600, 3000, smooth(8.7, 11.6, t))).toLocaleString('en-US')} K`}
        x={0.06}
        y={0.27}
        size={60}
        color="#ffd7a8"
        opacity={win(t, 8.8, CLEAR + 1.0, 0.5, 0.6)}
      />
      <Readout
        backdrop
        label="宇宙诞生后"
        value="38 万年"
        x={0.94}
        y={0.27}
        align="right"
        size={60}
        opacity={win(t, 9.2, CLEAR + 1.0, 0.5, 0.6)}
      />
      <Readout
        backdrop
        label="光的波长被拉伸"
        value={`×${Math.round(lerp(1, 1100, Math.pow(stretch, 2.2))).toLocaleString('en-US')}`}
        x={0.94}
        y={0.27}
        align="right"
        size={64}
        color="#ff9f80"
        opacity={win(t, 16.3, 20.2, 0.5, 0.6)}
      />
      <Readout
        backdrop
        label="宇宙微波背景 · 平均温度"
        value="2.725 K"
        x={0.94}
        y={0.27}
        align="right"
        size={64}
        color="#9fd0ff"
        opacity={win(t, 20.6, dur, 0.6, 0.6)}
      />
      <div
        style={{
          position: 'absolute',
          left: '6%',
          top: '22%',
          fontFamily: SANS,
          fontWeight: 300,
          fontSize: 34 * u,
          lineHeight: 1.7,
          letterSpacing: '0.12em',
          color: 'rgba(230,236,255,0.92)',
          opacity: win(t, 21.2, dur, 0.6, 0.6),
          textShadow: '0 2px 10px rgba(0,0,0,0.9)',
        }}
      >
        温度起伏仅约
        <span style={{color: '#ffd27a', fontWeight: 500}}> 十万分之一</span>
        <br />
        <span style={{fontSize: 24 * u, color: 'rgba(200,215,255,0.75)'}}>（图中起伏已大幅放大，示意）</span>
      </div>
      <ChapterTag index="05" title="第一缕光" en="THE FIRST LIGHT" dur={dur} />
      <Statement from={CLEAR + 0.2} to={15.6} text="宇宙，第一次变得透明" theme="gold" size={120} serif slam />
      <Captions items={CAPTIONS} />
      <Flash amount={decay(t, CLEAR - 0.03, 4) * 0.9} color="#fff3dc" />
      <Fade amount={smooth(dur - 0.6, dur, t)} />
    </AbsoluteFill>
  );
};
