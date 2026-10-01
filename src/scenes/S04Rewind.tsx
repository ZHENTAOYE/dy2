import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Pow10, Readout, Shake} from '../components/Chrome';
import {SANS} from '../fonts';
import {heartbeatTimes} from '../lib/beats';
import {bloom2, chromatic, drawGalaxy, drawGlow, drawRing, galaxySprite, heatColor, memo} from '../lib/canvas';
import {clamp, decay, easeInCubic, lerp, monotone, ramp, smooth} from '../lib/math';
import {mulberry32} from '../lib/rng';
import {drawCover, drawStars3, makeStars3, nebulaTexture} from '../lib/space';

const CAPTIONS = [
  {from: 0.4, to: 3.4, text: '让时间倒流……'},
  {from: 3.7, to: 7.2, text: '星系彼此靠近，|宇宙越来越小、越来越密'},
  {from: 7.5, to: 10.8, text: '温度飙升至数十亿度，|原子被撕碎成基本粒子'},
  {from: 11.0, to: 13.4, text: '直到一切，回到最初的那一刻'},
];

const END = 13.8;
const progress = (t: number) => Math.pow(ramp(t, 0.5, END), 1.7);
// log10 of the scale factor vs. scene time, keyed to the captions:
// galaxies converge (→ first stars), then it heats to billions of K, then the end.
const LOG_A = monotone([
  [0.5, 0],
  [4.0, -0.3],
  [7.2, -1.25],
  [9.0, -4.2],
  [10.8, -9.6],
  [12.4, -19],
  [13.6, -32],
]);
const logA = (t: number) => LOG_A(t);

const ageYears = (la: number) => {
  const a = Math.pow(10, la);
  const aEq = 3e-4;
  if (a > aEq) return 13.8e9 * Math.pow(a, 1.5);
  return 13.8e9 * Math.pow(aEq, 1.5) * Math.pow(a / aEq, 2);
};

const MILESTONES: [number, string][] = [
  [2e8, '第一代恒星诞生'],
  [3.8e5, '宇宙第一次变得透明'],
  [180 / 3.156e7, '原子核形成'],
  [1e-6 / 3.156e7, '质子与中子形成'],
  [1e-32 / 3.156e7, '暴胀结束'],
];

const fmtAge = (yr: number): React.ReactNode => {
  if (yr >= 1e8) return `${(yr / 1e8).toFixed(yr > 1.3e10 ? 0 : 1)} 亿年`;
  if (yr >= 1e4) return `${(yr / 1e4).toFixed(1)} 万年`;
  if (yr >= 1) return `${Math.round(yr)} 年`;
  const s = yr * 3.156e7;
  if (s >= 86400) return `${Math.round(s / 86400)} 天`;
  if (s >= 60) return `${(s / 60).toFixed(1)} 分钟`;
  if (s >= 1) return `${s.toFixed(1)} 秒`;
  return <Pow10 exp={Math.max(-43, Math.floor(Math.log10(s)))} suffix=" 秒" />;
};

const fmtTemp = (la: number): React.ReactNode => {
  const T = 2.725 / Math.pow(10, la);
  if (T < 1e5) return `${T < 10 ? T.toFixed(1) : Math.round(T).toLocaleString('en-US')} K`;
  return <Pow10 exp={Math.floor(Math.log10(T))} suffix=" K" />;
};

const galaxies = () =>
  memo('rewind-gal', () => {
    const r = mulberry32(61);
    return Array.from({length: 40}, (_, i) => ({
      x: (r() * 2 - 1) * 7,
      y: (r() * 2 - 1) * 4.5,
      z: r() * 10,
      size: 0.35 + r() * 0.4,
      rot: r() * Math.PI,
      tilt: 0.3 + r() * 0.7,
      seed: 700 + (i % 10),
    }));
  });

const camTrack = (fps: number, frames: number) =>
  memo(`rewind-cam-${fps}-${frames}`, () => {
    const z = new Float64Array(frames + 2);
    for (let i = 1; i < z.length; i++) {
      const t = (i - 1) / fps;
      const v = -(0.3 + 9 * Math.pow(progress(t), 1.2));
      z[i] = z[i - 1] + v / fps;
    }
    return z;
  });

export const SceneRewind: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const p = progress(t);
  const la = logA(t);
  const heat = Math.pow(clamp(-la / 32), 0.55);
  const age = ageYears(la);
  const collapse = easeInCubic(smooth(12.9, END, t));
  const dark = t > END ? 1 : 0;
  const beats = memo('rewind-beats', () => heartbeatTimes(13.6));
  let beat = 0;
  for (const b of beats) if (t >= b) beat = Math.max(beat, decay(t, b, 7));
  const milestone = MILESTONES.filter(([yr]) => age <= yr).pop();
  const msIdx = milestone ? MILESTONES.indexOf(milestone) : -1;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={dark ? 0 : 0.08 + p * 0.55 + beat * 0.15 * p} zoom={beat * 0.012}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cx = w / 2;
            const cy = h / 2;
            if (dark) {
              // The whole universe is now a single point.
              const k = 1 - smooth(END + 0.1, dur, t);
              drawGlow(ctx, cx, cy, 10 + 30 * decay(t, END, 6), [255, 255, 255], k);
              return;
            }
            const bg = heatColor(heat * 0.8);
            ctx.fillStyle = `rgb(${bg[0] * 0.35},${bg[1] * 0.3},${bg[2] * 0.3 + 6 * (1 - heat)})`;
            ctx.fillRect(0, 0, w, h);

            ctx.save();
            // Collapse: everything shrinks into the centre.
            const sc = 1 - collapse * 0.985;
            ctx.translate(cx, cy);
            ctx.scale(sc, sc);
            ctx.rotate(-p * 0.6);
            ctx.translate(-cx, -cy);

            // Fiery plasma takes over as it heats up; an endless zoom-out
            // makes the gas appear to rush inward.
            const plasma = nebulaTexture(71, 480, 270, {
              palette: [
                [0, 0, 0],
                [70, 6, 18],
                [190, 50, 16],
                [255, 150, 60],
                [255, 235, 200],
              ],
              scale: 3.0,
              warp: 2.6,
              contrast: 1.9,
              blur: 0.8,
            });
            ctx.globalCompositeOperation = 'lighter';
            const plasmaA = smooth(0.12, 0.55, heat) * (0.55 - 0.2 * heat);
            for (let i = 0; i < 3; i++) {
              const ph = (t * (0.18 + 0.5 * p) + i / 3) % 1;
              const scale = 1.6 * Math.pow(2.2, 1 - ph);
              drawCover(ctx, plasma, w, h, scale, i * 2.1 - p * 1.5, plasmaA * Math.sin(Math.PI * ph));
            }

            const cam = camTrack(fps, Math.round(dur * fps) + 2);
            const camZ = cam[frame + 1];
            const prevZ = cam[frame];
            const focal = S * 0.85;
            const galA = 1 - smooth(6.6, 8.2, t);
            for (const g of galaxies()) {
              let zr = (g.z - camZ) % 10;
              if (zr < 0) zr += 10;
              if (zr < 0.3) continue;
              const px = cx + (g.x / zr) * focal;
              const py = cy + (g.y / zr) * focal;
              const size = (g.size / zr) * focal;
              const a = clamp((10 - zr) / 2.5) * clamp(zr / 0.8) * galA;
              drawGalaxy(ctx, galaxySprite(g.seed, 'spiral', 192, 3500), px, py, size, g.rot, g.tilt, a);
            }
            const stars = memo('rewind-stars', () => makeStars3(63, 3600, 10, 10));
            drawStars3(ctx, w, h, stars, {
              camZ,
              prevCamZ: prevZ,
              depth: 10,
              focal,
              time: t,
              sizeK: 1 + p,
              tint: [255, 200, 120],
              tintAmt: heat * 0.8,
              streakAlpha: 1,
            });

            // Heartbeat rings collapsing inward.
            for (const b of beats) {
              const k = (t - b) / 0.8;
              if (k < 0 || k > 1) continue;
              const r = lerp(S * 0.9, S * 0.05, Math.pow(k, 0.7));
              drawRing(ctx, cx, cy, r, S * 0.012, heat > 0.5 ? [255, 210, 150] : [150, 200, 255], (1 - k) * (0.25 + 0.5 * p));
            }

            // Core gets brighter as everything converges.
            const coreCol = heatColor(0.6 + 0.4 * heat);
            drawGlow(ctx, cx, cy, S * (0.06 + 0.22 * heat), coreCol, 0.25 + 0.5 * heat, 2.6);
            drawGlow(ctx, cx, cy, S * (0.02 + 0.05 * heat), [255, 255, 245], 0.4 + 0.6 * heat, 3);
            ctx.restore();

            bloom2(ctx, w, h, 0.5 + heat * 0.3 + collapse * 1.5 + beat * 0.2);
            chromatic(ctx, w, h, 4 + p * 18 + beat * 10 * p);
          }}
        />
      </Shake>
      {!dark ? (
        <>
          <Readout backdrop label="宇宙诞生后" value={fmtAge(age)} x={0.06} y={0.27} size={64} opacity={smooth(0.6, 1.4, t) * (1 - collapse)} />
          <Readout
            backdrop
            label="温度"
            value={fmtTemp(la)}
            x={0.94}
            y={0.27}
            align="right"
            size={64}
            color={p > 0.35 ? '#ffd9a0' : '#ffffff'}
            opacity={smooth(0.9, 1.7, t) * (1 - collapse)}
          />
          {milestone ? (
            <div
              key={msIdx}
              style={{
                position: 'absolute',
                left: '6%',
                top: '34%',
                fontFamily: SANS,
                fontWeight: 500,
                fontSize: 28,
                letterSpacing: '0.2em',
                color: '#ffcf7a',
                opacity: (1 - collapse) * 0.95,
                // Dark halo so it stays legible on the white-hot plasma; padding/margin keep the text in place.
                padding: '12px 44px',
                margin: '-12px -44px',
                background: 'radial-gradient(closest-side, rgba(20,6,0,0.6), rgba(20,6,0,0.3) 55%, rgba(20,6,0,0.08) 85%, rgba(20,6,0,0))',
                textShadow: '0 0 4px rgba(0,0,0,0.9), 0 2px 10px rgba(0,0,0,0.85), 0 0 16px rgba(255,170,80,0.35)',
              }}
            >
              ◂ {milestone[1]}
            </div>
          ) : null}
        </>
      ) : null}
      <ChapterTag index="03" title="时光倒流" en="REWIND" dur={END} />
      <Captions items={CAPTIONS} />
      <Fade amount={1 - smooth(0, 0.5, t)} />
    </AbsoluteFill>
  );
};
