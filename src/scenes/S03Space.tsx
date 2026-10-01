import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {Ctx, bloom2, chromatic, drawGalaxy, drawGlow, drawRing, font, galaxySprite, memo} from '../lib/canvas';
import {clamp, decay, easeInOutCubic, lerp, mix3, smooth, win} from '../lib/math';
import {mulberry32} from '../lib/rng';
import {drawCover, nebulaTexture, starDustTexture} from '../lib/space';

const CAPTIONS = [
  {from: 0.5, to: 4.0, text: '但这并不是一场发生在空间【之中】的爆炸'},
  {from: 8.4, to: 12.2, text: '星系就像嵌在一张不断拉伸的网格上，彼此越离越远'},
  {from: 12.6, to: 16.3, text: '无论站在哪个星系上看，其他星系都在【远离你】'},
  {from: 16.9, to: 20.0, text: '就像气球表面的点：没有哪一个，是真正的中心'},
  {from: 20.3, to: 23.6, text: '那么，如果让时间【倒流】呢？'},
];

const N = 12;

type PlaneCam = {x: number; y: number; z: number; p: number; F: number; W: number; H: number};

const proj = (c: PlaneCam, x: number, z: number, out: number[]) => {
  const rx = x - c.x;
  const ry = -c.y;
  const rz = z - c.z;
  const sp = Math.sin(c.p);
  const cp = Math.cos(c.p);
  const depth = -ry * sp + rz * cp;
  const up = ry * cp + rz * sp;
  out[0] = c.W / 2 + (rx / depth) * c.F;
  out[1] = c.H / 2 - (up / depth) * c.F;
  out[2] = depth;
};

const planeGalaxies = () =>
  memo('space-plane-gal', () => {
    const r = mulberry32(17);
    const out: {i: number; j: number; seed: number; rot: number; kind: 'spiral' | 'barred' | 'elliptical'}[] = [];
    for (let i = -N; i <= N; i++)
      for (let j = -N; j <= N; j++) {
        if ((i === 0 && j === 0) || (i === 3 && j === 2) || r() < 0.3) {
          out.push({i, j, seed: 500 + ((i * 31 + j * 17) & 15), rot: r() * Math.PI, kind: r() < 0.2 ? 'elliptical' : r() < 0.5 ? 'barred' : 'spiral'});
        }
      }
    return out;
  });

const sphereGalaxies = () =>
  memo('space-sphere-gal', () => {
    const r = mulberry32(19);
    const n = 150;
    const out: {v: [number, number, number]; seed: number; rot: number}[] = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * 2.399963 + r() * 0.3;
      out.push({v: [Math.cos(th) * rad, y, Math.sin(th) * rad], seed: 520 + (i % 12), rot: r() * Math.PI});
    }
    return out;
  });

// Expansion factor across the plane phases, and the comoving observer.
const scaleA = (t: number) => {
  if (t < 8.4) return Math.exp(0.07 * t);
  if (t < 12.4) return Math.exp(0.07 * 8.4) * Math.exp(0.09 * (t - 8.4));
  if (t < 13.2) return Math.exp(0.07 * 8.4) * Math.exp(0.09 * 4);
  return Math.exp(0.07 * 8.4) * Math.exp(0.09 * 4) * Math.exp(0.08 * (t - 13.2));
};

const drawPlane = (ctx: Ctx, w: number, h: number, t: number, alpha: number) => {
  const S = Math.min(w, h);
  const u = S / 1080;
  const swoop = easeInOutCubic(smooth(7.6, 9.4, t));
  const p = lerp(0.6, 1.5, swoop);
  const camH = lerp(5.5, 11, swoop);
  const c: PlaneCam = {x: 0, y: camH, z: -camH / Math.tan(p) - lerp(0.0, 0, swoop), p, F: S * 0.95, W: w, H: h};
  const a = scaleA(t);
  const swap = easeInOutCubic(smooth(12.4, 13.4, t));
  const ox = 3 * swap;
  const oz = 2 * swap;
  const P = [0, 0, 0];
  const Q = [0, 0, 0];
  const near = 0.3;
  // Light pulses rippling out from the observer.
  const pulseR = ((t * 6) % 14) * 1.0;
  const pulse2 = decay(t, 4.3, 0.9);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const segs = 24;
  for (let dir = 0; dir < 2; dir++) {
    for (let k = -N; k <= N; k++) {
      for (let s = 0; s < segs; s++) {
        const c0 = -N + (2 * N * s) / segs;
        const c1 = -N + (2 * N * (s + 1)) / segs;
        const xa = dir === 0 ? k : c0;
        const za = dir === 0 ? c0 : k;
        const xb = dir === 0 ? k : c1;
        const zb = dir === 0 ? c1 : k;
        proj(c, a * (xa - ox), a * (za - oz), P);
        proj(c, a * (xb - ox), a * (zb - oz), Q);
        if (P[2] < near || Q[2] < near) continue;
        const mx = (xa + xb) / 2 - ox;
        const mz = (za + zb) / 2 - oz;
        const dist = Math.hypot(mx, mz) * a;
        const fog = clamp(1.4 - dist / (N * a * 0.85));
        const ring = Math.exp(-Math.pow((dist - pulseR * a * 0.5) / 1.2, 2)) * 0.35;
        const big = pulse2 * Math.exp(-Math.pow((dist - (t - 4.3) * 9) / 2.2, 2)) * 1.4;
        const al = (0.16 + ring + big) * fog;
        if (al < 0.01) continue;
        const col = mix3([70, 150, 255], [170, 240, 255], clamp(ring + big));
        ctx.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${clamp(al)})`;
        ctx.lineWidth = Math.max(0.8, (2.2 * u * 6) / P[2]);
        ctx.beginPath();
        ctx.moveTo(P[0], P[1]);
        ctx.lineTo(Q[0], Q[1]);
        ctx.stroke();
      }
    }
  }
  // Galaxies stay the same size: gravity holds them together.
  const tilt = Math.sin(p);
  const G = planeGalaxies();
  for (const g of G) {
    proj(c, a * (g.i - ox), a * (g.j - oz), P);
    if (P[2] < near) continue;
    const size = (0.55 / P[2]) * c.F;
    const dist = Math.hypot(g.i - ox, g.j - oz) * a;
    const fog = clamp(1.4 - dist / (N * a * 0.85));
    drawGalaxy(ctx, galaxySprite(g.seed, g.kind, 160, 3200), P[0], P[1], size, g.rot, tilt, fog);
  }
  // Observer marker + distance lines (phase B).
  const lines = win(t, 9.0, 16.4, 0.8, 0.5);
  if (lines > 0) {
    const obs = [
      [0, 0],
      [3, 2],
    ];
    const oi = t < 12.9 ? 0 : 1;
    const [oxI, ozI] = obs[oi];
    const swapFade = 1 - win(t, 12.3, 13.5, 0.2, 0.2);
    proj(c, a * (oxI - ox), a * (ozI - oz), P);
    const k = lines * swapFade;
    drawGlow(ctx, P[0], P[1], 80 * u, [90, 220, 255], 0.9 * k);
    drawRing(ctx, P[0], P[1], 46 * u, 3 * u, [140, 230, 255], k);
    const neigh = G.filter((g) => g.i !== oxI || g.j !== ozI)
      .map((g) => ({g, d: Math.hypot(g.i - oxI, g.j - ozI)}))
      .sort((x, y) => x.d - y.d)
      .slice(0, 7);
    const a0 = oi === 0 ? scaleA(9.0) : scaleA(13.2);
    for (const {g} of neigh) {
      proj(c, a * (g.i - ox), a * (g.j - oz), Q);
      const dx = Q[0] - P[0];
      const dy = Q[1] - P[1];
      const L = Math.hypot(dx, dy);
      ctx.setLineDash([10 * u, 8 * u]);
      ctx.strokeStyle = `rgba(255,210,140,${0.75 * k})`;
      ctx.lineWidth = 2.2 * u;
      ctx.beginPath();
      ctx.moveTo(P[0] + (dx / L) * 50 * u, P[1] + (dy / L) * 50 * u);
      ctx.lineTo(Q[0] - (dx / L) * 30 * u, Q[1] - (dy / L) * 30 * u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = font(22 * u, 500, '"Montserrat"');
      ctx.fillStyle = `rgba(255,225,170,${k})`;
      ctx.textAlign = 'center';
      ctx.fillText(`×${(a / a0).toFixed(2)}`, (P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2 - 8 * u);
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = font(28 * u, 500);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(150,230,255,${k})`;
    ctx.fillText(oi === 0 ? '我们' : '另一个星系上的观测者', P[0], P[1] + 86 * u);
    ctx.restore();
  }
  ctx.restore();
};

const drawBalloon = (ctx: Ctx, w: number, h: number, t: number, alpha: number) => {
  if (alpha <= 0.003) return;
  const S = Math.min(w, h);
  const u = S / 1080;
  const tt = t - 16.3;
  const grow = Math.exp(0.16 * Math.min(tt, 4.3));
  const rewind = smooth(20.6, 23.8, t);
  const R = S * 0.2 * grow * (1 - 0.75 * Math.pow(rewind, 1.5));
  const cx = w / 2;
  const cy = h * 0.47;
  const rotY = tt * 0.25 - rewind * 1.8;
  const tiltX = 0.38;
  const hot = rewind;
  const base: [number, number, number] = mix3([90, 170, 255], [255, 150, 60], hot);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Volume shading.
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
  g.addColorStop(0, `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},0.10)`);
  g.addColorStop(0.85, `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},0.05)`);
  g.addColorStop(0.97, `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},0.35)`);
  g.addColorStop(1, `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const rot = (v: [number, number, number]): [number, number, number] => {
    const c1 = Math.cos(rotY);
    const s1 = Math.sin(rotY);
    const x = v[0] * c1 + v[2] * s1;
    const z0 = -v[0] * s1 + v[2] * c1;
    const c2 = Math.cos(tiltX);
    const s2 = Math.sin(tiltX);
    const y = v[1] * c2 - z0 * s2;
    const z = v[1] * s2 + z0 * c2;
    return [x, y, z];
  };
  // Meridians and parallels.
  ctx.lineWidth = 1.4 * u;
  const curve = (fn: (k: number) => [number, number, number]) => {
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= 64; i++) {
      const p = rot(fn(i / 64));
      if (prev) {
        const front = (p[2] + prev[2]) / 2;
        const al = front < 0 ? 0.55 : 0.12;
        ctx.strokeStyle = `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},${al})`;
        ctx.beginPath();
        ctx.moveTo(cx + prev[0] * R, cy + prev[1] * R);
        ctx.lineTo(cx + p[0] * R, cy + p[1] * R);
        ctx.stroke();
      }
      prev = p;
    }
  };
  for (let m = 0; m < 12; m++) {
    const ph = (m / 12) * Math.PI * 2;
    curve((k) => {
      const th = k * Math.PI;
      return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    });
  }
  for (let q = 1; q < 9; q++) {
    const th = (q / 9) * Math.PI;
    curve((k) => {
      const ph = k * Math.PI * 2;
      return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    });
  }
  for (const gx of sphereGalaxies()) {
    const p = rot(gx.v);
    const front = p[2] < 0;
    const al = front ? 1 : 0.18;
    const col: [number, number, number] = mix3([255, 255, 255], [255, 170, 90], hot);
    drawGalaxy(ctx, galaxySprite(gx.seed, 'spiral', 128, 2200), cx + p[0] * R, cy + p[1] * R, 34 * u, gx.rot, 0.6 + 0.4 * Math.abs(p[2]), al);
    drawGlow(ctx, cx + p[0] * R, cy + p[1] * R, 10 * u, col, al * 0.5);
  }
  ctx.restore();
};

export const SceneSpace: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const planeA = win(t, 0, 16.6, 0.8, 0.5);
  const balloonA = smooth(16.2, 17.0, t);
  const rewind = smooth(20.6, 23.8, t);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={0.35 * decay(t, 4.3, 2.5) + 0.3 * decay(t, 16.6, 2.5) + 0.25 * rewind}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const neb = nebulaTexture(41, 384, 216, {
              palette: [
                [0, 0, 0],
                [6, 16, 40],
                [20, 50, 100],
                [60, 40, 120],
              ],
              scale: 1.5,
              contrast: 2.2,
              mask: 0.5,
            });
            drawCover(ctx, neb, w, h, 1.1 + t * 0.008, 0, 0.6);
            drawCover(ctx, starDustTexture(14, 1920, 1080, 3200), w, h, 1.0 + t * 0.003, 0, 0.7);
            drawPlane(ctx, w, h, t, planeA);
            drawBalloon(ctx, w, h, t, balloonA);
            bloom2(ctx, w, h, 0.7 + 0.6 * decay(t, 4.3, 1.5) + rewind * 0.6);
            chromatic(ctx, w, h, rewind * 14 + 10 * decay(t, 16.6, 3));
          }}
        />
      </Shake>
      <ChapterTag index="02" title="空间本身在膨胀" en="SPACE ITSELF STRETCHES" dur={dur} />
      <Statement from={4.3} to={8.0} text="而是空间本身，在膨胀" theme="cyan" size={120} serif />
      <Statement from={16.6} to={20.0} text="宇宙没有中心" theme="white" size={120} y={0.17} serif slam />
      <Captions items={CAPTIONS} />
      <Fade amount={1 - smooth(0, 0.6, t)} />
    </AbsoluteFill>
  );
};
