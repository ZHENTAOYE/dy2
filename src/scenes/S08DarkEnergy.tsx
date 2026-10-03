import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Flash, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {LATIN, SANS} from '../fonts';
import {
  Ctx,
  bloom2,
  chromatic,
  drawFlare,
  drawGalaxy,
  drawGlow,
  drawRing,
  drawStreak,
  font,
  galaxySprite,
  memo,
} from '../lib/canvas';
import {clamp, decay, easeInOutCubic, easeOutBack, easeOutCubic, lerp, smooth, win} from '../lib/math';
import {mulberry32} from '../lib/rng';
import {drawCover, drawStars3, makeStars3, nebulaTexture, starDustTexture} from '../lib/space';

const SN = 1.5;
const ACCEL = 8.5;

const CAPTIONS = [
  {from: 0.1, to: 4.21, text: '1998年，两个天文团队|观测遥远的【Ia型超新星】'},
  {from: 4.56, to: 7.77, text: '人们原以为，|引力会让宇宙的膨胀逐渐【减速】'},
  {from: 11.7, to: 14.27, text: '推动加速的神秘力量，被称为【暗能量】'},
  {from: 15.7, to: 20.02, text: '暗能量约占宇宙的68%，|暗物质约占27%'},
  {from: 20.37, to: 23.67, text: '而我们熟悉的一切普通物质，|只占约【5%】'},
];

// Scale factor: ΛCDM (accelerating) vs a matter-only universe matched early on.
const K = 1.18;
const aL = (x: number) => Math.pow(Math.sinh(K * x), 2 / 3) / Math.pow(Math.sinh(K), 2 / 3);
const aM = (x: number) => (Math.pow(K, 2 / 3) / Math.pow(Math.sinh(K), 2 / 3)) * Math.pow(x, 2 / 3);
const XMAX = 1.5;

const supernovae = () =>
  memo('de-sn', () => {
    const r = mulberry32(181);
    return Array.from({length: 11}, (_, i) => {
      const x = 0.42 + (0.55 * (i + r() * 0.6)) / 11;
      return {x, y: aL(x) * (1 + (r() - 0.5) * 0.05), at: 9.0 + i * 0.12};
    });
  });

const surveyGalaxies = () =>
  memo('de-survey', () => {
    const r = mulberry32(183);
    return Array.from({length: 7}, (_, i) => ({
      x: 0.12 + r() * 0.76,
      y: 0.15 + r() * 0.6,
      s: 0.35 + r() * 0.4,
      rot: r() * Math.PI,
      tilt: 0.3 + r() * 0.6,
      at: 2.6 + i * 0.22,
      seed: 190 + i,
    }));
  });

const drawGraph = (ctx: Ctx, w: number, h: number, t: number, alpha: number, u: number, portrait: boolean) => {
  if (alpha <= 0.003) return;
  const G = portrait
    ? {x: w * 0.12, y: h * 0.2, w: w * 0.78, h: h * 0.32}
    : {x: w * 0.12, y: h * 0.21, w: w * 0.56, h: h * 0.52};
  const X = (x: number) => G.x + (x / XMAX) * G.w;
  const Y = (y: number) => G.y + G.h - (y / 1.75) * G.h;
  ctx.save();
  ctx.globalAlpha = alpha;
  const axis = easeOutCubic(clamp((t - 4.4) / 0.8));
  ctx.strokeStyle = 'rgba(190,215,255,0.8)';
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(G.x, G.y + G.h - G.h * axis);
  ctx.lineTo(G.x, G.y + G.h);
  ctx.lineTo(G.x + G.w * axis, G.y + G.h);
  ctx.stroke();
  ctx.font = font(24 * u, 300);
  ctx.fillStyle = 'rgba(210,225,255,0.9)';
  ctx.fillText('宇宙尺度 ↑', G.x - 10 * u, G.y - 20 * u);
  ctx.textAlign = 'right';
  ctx.fillText('时间 →', G.x + G.w, G.y + G.h + 40 * u);
  ctx.textAlign = 'left';
  // "Today" marker.
  ctx.setLineDash([6 * u, 8 * u]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(X(1), G.y + G.h);
  ctx.lineTo(X(1), G.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('今天', X(1), G.y + G.h + 40 * u);
  ctx.textAlign = 'left';
  // Expected: decelerating.
  const dk = easeInOutCubic(clamp((t - 5.0) / 2.6));
  if (dk > 0) {
    ctx.strokeStyle = 'rgba(140,190,255,0.85)';
    ctx.lineWidth = 4 * u;
    ctx.setLineDash([14 * u, 10 * u]);
    ctx.beginPath();
    for (let x = 0; x <= XMAX * dk; x += 0.01) {
      const px = X(x);
      const py = Y(aM(x));
      if (x === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(28 * u, 500);
    ctx.fillStyle = `rgba(150,200,255,${smooth(6.8, 7.6, t)})`;
    // Anchored under the curve at the label's left end, where the rising curve is lowest.
    ctx.fillText('预期：减速膨胀', X(1.08), Y(aM(1.08)) + 44 * u);
  }
  // Observed: accelerating.
  const ak = easeInOutCubic(clamp((t - ACCEL) / 2.0));
  if (ak > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(X(0), 0, X(XMAX), 0);
    grad.addColorStop(0, 'rgba(255,220,150,1)');
    grad.addColorStop(0.6, 'rgba(255,120,80,1)');
    grad.addColorStop(1, 'rgba(255,60,120,1)');
    for (const [lw, a] of [
      [16, 0.15],
      [8, 0.35],
      [4, 1],
    ] as const) {
      ctx.strokeStyle = grad;
      ctx.globalAlpha = alpha * a;
      ctx.lineWidth = lw * u;
      ctx.beginPath();
      for (let x = 0; x <= XMAX * ak; x += 0.01) {
        const px = X(x);
        const py = Y(aL(x));
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    const hx = X(XMAX * ak);
    const hy = Y(aL(XMAX * ak));
    drawGlow(ctx, hx, hy, 50 * u, [255, 140, 100], 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = font(30 * u, 500);
    ctx.fillStyle = `rgba(255,150,110,${smooth(9.6, 10.4, t)})`;
    ctx.fillText('观测：加速膨胀', X(1.02) - 250 * u, Y(aL(1.4)) - 12 * u);
  }
  // Supernova data points sit on the accelerating curve.
  ctx.globalCompositeOperation = 'lighter';
  for (const sn of supernovae()) {
    const p = easeOutBack(clamp((t - sn.at) / 0.4));
    if (p <= 0) continue;
    drawGlow(ctx, X(sn.x), Y(sn.y), 20 * u * p, [255, 240, 200], 0.9);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(sn.x), Y(sn.y), 4 * u * clamp(p), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawDonut = (ctx: Ctx, w: number, h: number, t: number, alpha: number, u: number, portrait: boolean) => {
  if (alpha <= 0.003) return;
  const S = Math.min(w, h);
  const cx = portrait ? w / 2 : w * 0.36;
  const cy = portrait ? h * 0.34 : h * 0.47;
  const R = S * 0.27;
  const lw = S * 0.075;
  const sweep = easeInOutCubic(clamp((t - 16.0) / 2.2));
  const focus5 = smooth(20.1, 20.8, t);
  const parts: [number, [number, number, number], number][] = [
    [0.68, [150, 90, 255], 1 - 0.55 * focus5],
    [0.27, [70, 140, 255], 1 - 0.55 * focus5],
    [0.05, [255, 200, 90], 1],
  ];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  let a0 = -Math.PI / 2;
  for (const [frac, col, k] of parts) {
    const span = frac * Math.PI * 2 * sweep;
    const gap = 0.012;
    const pop = frac === 0.05 ? 1 + 0.12 * focus5 * (0.6 + 0.4 * Math.sin(t * 6)) : 1;
    for (const [mul, a] of [
      [1.5, 0.07],
      [1.18, 0.16],
      [1, 0.72],
    ] as const) {
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a * k})`;
      ctx.lineWidth = lw * mul * pop;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (frac === 0.05 ? 1 + 0.04 * focus5 : 1), a0 + gap, a0 + Math.max(gap, span - gap));
      ctx.stroke();
    }
    a0 += span;
  }
  drawGlow(ctx, cx, cy, R * 0.8, [120, 90, 255], 0.15);
  ctx.restore();
};

export const SceneDarkEnergy: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const graphA = win(t, 4.3, 12.3, 0.6, 0.6);
  const energy = win(t, 11.8, dur, 0.8, 0.4);
  const donutA = smooth(15.9, 16.6, t);
  const accel = smooth(ACCEL, 15, t);
  const sweep = clamp((t - 16.0) / 2.2);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={0.45 * decay(t, SN, 2.5) + 0.7 * decay(t, ACCEL, 2.2) + 0.25 * decay(t, 12.1, 2) + accel * 0.08 * (1 - donutA)}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cx = w / 2;
            const cy = h / 2;
            drawCover(ctx, starDustTexture(18, 1920, 1080, 3000), w, h, 1 + t * 0.01, 0, 0.7);
            // Background galaxies recede — faster and faster after ACCEL.
            ctx.globalCompositeOperation = 'lighter';
            const camZ = 0.25 * t + 9 * Math.pow(Math.max(0, t - ACCEL), 2) * 0.12;
            const prevT = t - 1 / fps;
            const prevZ = 0.25 * prevT + 9 * Math.pow(Math.max(0, prevT - ACCEL), 2) * 0.12;
            drawStars3(ctx, w, h, memo('de-stars', () => makeStars3(185, 2200, 10, 10)), {
              camZ: -camZ,
              prevCamZ: -prevZ,
              depth: 10,
              focal: S * 0.85,
              alpha: 0.85,
              time: t,
              tint: [255, 90, 70],
              tintAmt: 0.4 * accel,
              streakAlpha: 0.9,
            });

            // ---- Phase A: a type Ia supernova outshines its galaxy ----
            const phaseA = 1 - smooth(4.0, 5.0, t);
            if (phaseA > 0) {
              const gx = portrait ? w * 0.5 : w * 0.5;
              const gy = h * 0.46;
              const push = 1 + t * 0.03;
              drawGalaxy(ctx, galaxySprite(187, 'spiral', 640, 42000), gx, gy, S * 0.95 * push, 0.4 + t * 0.02, 0.55, phaseA);
              const sx = gx + S * 0.2 * push;
              const sy = gy - S * 0.07 * push;
              if (t > SN - 0.05) {
                const e = t - SN;
                const fl = Math.exp(-e * 0.9);
                drawFlare(ctx, sx, sy, (120 + 380 * Math.exp(-e * 3)) * u * (0.5 + 0.5 * fl), [200, 220, 255], phaseA, 0.2);
                drawGlow(ctx, sx, sy, S * (0.05 + 0.25 * Math.exp(-e * 2.5)), [255, 255, 255], phaseA);
                drawRing(ctx, sx, sy, easeOutCubic(clamp(e / 1.4)) * S * 0.6, S * 0.015, [190, 215, 255], (1 - clamp(e / 1.4)) * phaseA);
                drawStreak(ctx, sx, sy, w * 0.45 * fl, 6 * u, [170, 200, 255], 0.7 * fl * phaseA);
              }
              for (const sg of surveyGalaxies()) {
                const a = smooth(sg.at, sg.at + 0.4, t) * phaseA;
                if (a <= 0) continue;
                const x = sg.x * w;
                const y = sg.y * h;
                drawGalaxy(ctx, galaxySprite(sg.seed, 'spiral', 160, 2800), x, y, 70 * u * sg.s * 2, sg.rot, sg.tilt, a * 0.8);
                const e = t - sg.at - 0.3;
                if (e > 0) drawFlare(ctx, x + 14 * u, y - 6 * u, (30 + 90 * Math.exp(-e * 3)) * u, [200, 220, 255], a * Math.exp(-e * 0.6));
              }
            }

            // ---- Phase C: dark energy pressure waves ----
            if (energy > 0) {
              const neb = nebulaTexture(189, 384, 216, {
                palette: [
                  [0, 0, 0],
                  [30, 10, 60],
                  [90, 40, 170],
                  [170, 110, 255],
                ],
                scale: 1.8,
                contrast: 2.0,
                mask: 0.4,
              });
              for (let i = 0; i < 3; i++) {
                const ph = ((t * 0.12 + i / 3) % 1 + 1) % 1;
                drawCover(ctx, neb, w, h, 1.4 * Math.pow(2.2, ph), i * 2 + t * 0.03, energy * 0.55 * Math.sin(Math.PI * ph) * (1 - 0.5 * donutA));
              }
              for (let i = 0; i < 6; i++) {
                const ph = ((t * 0.45 + i / 6) % 1 + 1) % 1;
                drawRing(ctx, cx, cy, Math.pow(ph, 1.6) * S * 1.1, S * 0.03, [170, 120, 255], (1 - ph) * 0.35 * energy * (1 - 0.6 * donutA));
              }
            }
            ctx.globalCompositeOperation = 'source-over';
            drawGraph(ctx, w, h, t, graphA, u, portrait);
            drawDonut(ctx, w, h, t, donutA, u, portrait);
            bloom2(ctx, w, h, 0.6 + 0.9 * decay(t, SN, 1.2) + 0.6 * decay(t, ACCEL, 2) + energy * 0.3 - donutA * 0.25);
            chromatic(ctx, w, h, 18 * decay(t, SN, 2.5) + 24 * decay(t, ACCEL, 2.5) + accel * 6 * (1 - donutA));
          }}
        />
      </Shake>

      {/* Supernova label */}
      <div
        style={{
          position: 'absolute',
          left: '62%',
          top: '22%',
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: 30 * u,
          letterSpacing: '0.14em',
          color: '#dfe8ff',
          opacity: win(t, SN + 0.4, 4.4, 0.4, 0.5),
          textShadow: '0 0 16px rgba(140,180,255,0.8), 0 2px 8px rgba(0,0,0,0.9)',
        }}
      >
        Ia型超新星
        <div style={{fontWeight: 300, fontSize: 22 * u, color: 'rgba(200,215,255,0.85)', marginTop: 6 * u}}>
          亮度几乎恒定的“标准烛光”
        </div>
      </div>

      {/* Donut legend */}
      {donutA > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: portrait ? '12%' : '60%',
            top: portrait ? '54%' : '28%',
            fontFamily: SANS,
            opacity: donutA,
          }}
        >
          {(
            [
              ['暗能量', 68, '#b18cff', 0],
              ['暗物质', 27, '#6fa8ff', 0.5],
              ['普通物质', 5, '#ffd27a', 1.0],
            ] as const
          ).map(([name, pct, color, delay], i) => {
            const k = easeOutCubic(clamp((t - 16.4 - delay) / 0.8));
            const dim = i < 2 ? 1 - 0.5 * smooth(20.1, 20.8, t) : 1;
            const pop = i === 2 ? 1 + 0.12 * smooth(20.1, 20.6, t) : 1;
            return (
              <div
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 24 * u,
                  marginBottom: (portrait ? 16 : 26) * u,
                  opacity: k * dim,
                  transform: `translateX(${(1 - k) * 40 * u}px) scale(${pop})`,
                  transformOrigin: 'left center',
                }}
              >
                <div
                  style={{
                    fontFamily: LATIN,
                    fontWeight: 700,
                    fontSize: (portrait ? 74 : 92) * u,
                    color,
                    minWidth: (portrait ? 180 : 220) * u,
                    textAlign: 'right',
                    textShadow: `0 0 ${26 * u}px ${color}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.round(pct * clamp(sweep * 1.05))}%
                </div>
                <div style={{fontWeight: 500, fontSize: 40 * u, color: '#f0f3ff', letterSpacing: '0.2em'}}>{name}</div>
              </div>
            );
          })}
          <div
            style={{
              fontWeight: 300,
              fontSize: 26 * u,
              color: 'rgba(255,225,170,0.95)',
              letterSpacing: '0.12em',
              marginTop: 10 * u,
              opacity: smooth(20.6, 21.4, t),
            }}
          >
            恒星、行星、你和我 —— 都在这 5% 里
          </div>
        </div>
      ) : null}

      <ChapterTag index="07" title="加速膨胀" en="ACCELERATING EXPANSION" dur={dur} />
      <Statement from={ACCEL} to={11.0} text="膨胀，正在加速！" theme="red" size={110} serif slam y={0.86} />
      <Statement from={12.1} to={15.6} text="暗能量" sub="DARK ENERGY" theme="violet" size={180} serif y={0.44} />
      <Captions items={CAPTIONS} />
      <Flash amount={decay(t, SN - 0.03, 5) * 0.7 + decay(t, ACCEL - 0.03, 6) * 0.6} />
      <Fade amount={1 - smooth(0, 0.5, t) + smooth(dur - 0.5, dur, t)} />
    </AbsoluteFill>
  );
};
