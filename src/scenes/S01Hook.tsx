import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {Fade, Flash, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {bloom2, chromatic, drawGalaxy, drawGlow, drawRing, drawStreak, galaxySprite, memo} from '../lib/canvas';
import {clamp, decay, easeOutCubic, lerp, ramp, smooth} from '../lib/math';
import {mulberry32, sphereDir} from '../lib/rng';
import {drawCover, drawStars3, makeStars3, milkyWayTexture, nebulaTexture, starDustTexture} from '../lib/space';

const SLAM = 10.5;

const CAPTIONS = [
  {from: 0.8, to: 4.4, text: '仰望夜空，星辰仿佛亘古不变'},
  {from: 4.9, to: 8.25, text: '但事实上，|宇宙中的星系正在【彼此远离】'},
  {from: 8.7, to: 10.2, text: '而且，越来越快——'},
];

// Camera speed profile (world units / s): calm drift → expansion → warp → settle.
const speed = (t: number) => {
  if (t < SLAM) {
    const calm = 0.12;
    const expand = lerp(0, 0.9, smooth(4.5, 8.5, t));
    const warp = 34 * Math.pow(ramp(t, 8.5, 10.42), 3);
    return calm + expand + warp;
  }
  return 0.25 + 3 * decay(t, SLAM, 2.2);
};

const camTrack = (fps: number, frames: number) =>
  memo(`hook-cam-${fps}-${frames}`, () => {
    const z = new Float64Array(frames + 2);
    for (let i = 1; i < z.length; i++) z[i] = z[i - 1] + speed((i - 1) / fps) / fps;
    return z;
  });

type Burst = {d: [number, number, number]; v: number; c: [number, number, number]; s: number};

const burst = () =>
  memo('hook-burst', () => {
    const r = mulberry32(77);
    const out: Burst[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = r();
      out.push({
        d: sphereDir(r),
        v: 0.25 + Math.pow(r(), 0.5) * 1.1,
        c: u < 0.5 ? [180, 210, 255] : u < 0.8 ? [255, 255, 255] : [255, 200, 120],
        s: 0.6 + r() * 1.6,
      });
    }
    return out;
  });

const galaxies = () =>
  memo('hook-galaxies', () => {
    const r = mulberry32(5);
    return Array.from({length: 26}, (_, i) => ({
      x: (r() * 2 - 1) * 7,
      y: (r() * 2 - 1) * 4.5,
      z: r() * 10,
      size: 0.35 + r() * 0.5,
      rot: r() * Math.PI,
      tilt: 0.25 + r() * 0.75,
      sprite: galaxySprite(100 + i, r() < 0.25 ? 'elliptical' : r() < 0.5 ? 'barred' : 'spiral', 192, 3500),
    }));
  });

export const SceneHook: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const shake = 0.9 * decay(t, SLAM, 2.6) + 0.22 * smooth(9.0, 10.4, t) * (t < SLAM ? 1 : 0);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={shake}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cam = camTrack(fps, Math.max(durationInFrames, Math.round(dur * fps)));
            const camZ = cam[Math.min(frame + 1, cam.length - 1)];
            const prevZ = cam[frame];
            const warp = smooth(8.6, 10.4, t) * (t < SLAM ? 1 : 0);

            // Deep background: nebula + dust, slowly breathing.
            const neb = nebulaTexture(11, 384, 216, {
              palette: [
                [0, 0, 0],
                [16, 8, 40],
                [50, 24, 100],
                [24, 80, 130],
                [190, 110, 170],
              ],
              scale: 1.3,
              warp: 2.2,
              contrast: 2.6,
              alpha: 0.95,
              mask: 0.6,
              blur: 1.5,
            });
            const fadeIn = smooth(0, 1.6, t);
            drawCover(ctx, neb, w, h, 1.15 + t * 0.012 + warp * 0.6, t * 0.004, 0.8 * fadeIn * (1 - warp * 0.5));
            const dust = starDustTexture(3, 1920, 1080, 5200);
            drawCover(ctx, dust, w, h, 1.02 + t * 0.006 + warp * 0.3, 0, 0.9 * fadeIn * (1 - warp * 0.7));
            // The Milky Way band dominates the calm opening, then falls away.
            ctx.globalCompositeOperation = 'lighter';
            const mw = milkyWayTexture(21, 1920, 1080);
            const mwA = fadeIn * (1 - smooth(6.5, 10, t)) * (t < SLAM ? 1 : 0);
            drawCover(ctx, mw, w, h, 1.05 + t * 0.02 + Math.pow(smooth(4.5, 10.4, t), 2) * 2.2, -t * 0.003, mwA);
            ctx.globalCompositeOperation = 'source-over';

            ctx.globalCompositeOperation = 'lighter';
            // Galaxies drifting with the field.
            const focal = S * 0.85;
            for (const g of galaxies()) {
              let zr = (g.z - camZ) % 10;
              if (zr < 0) zr += 10;
              if (zr < 0.3) continue;
              const px = w / 2 + (g.x / zr) * focal;
              const py = h / 2 + (g.y / zr) * focal;
              const size = (g.size / zr) * focal;
              const a = clamp((10 - zr) / 2.5) * clamp(zr / 0.8) * fadeIn * (1 - warp * 0.8);
              drawGalaxy(ctx, g.sprite, px, py, size, g.rot + t * 0.02, g.tilt, a * 0.9);
            }

            const stars = memo('hook-stars', () => makeStars3(9, 3400, 10, 10));
            drawStars3(ctx, w, h, stars, {
              camZ,
              prevCamZ: prevZ,
              depth: 10,
              focal,
              alpha: fadeIn,
              time: t,
              sizeK: 1 + warp * 0.6,
              doppler: warp * 0.85,
              streakAlpha: 0.9,
            });

            // Tunnel glow at the vanishing point during warp.
            if (warp > 0.01) {
              drawGlow(ctx, w / 2, h / 2, S * (0.04 + warp * 0.16), [170, 200, 255], warp * 0.7);
            }

            // ----- Title slam -----
            if (t >= SLAM - 0.1) {
              const k = t - SLAM;
              const B = burst();
              for (const p of B) {
                const travel = (1 - Math.exp(-Math.max(0, k) * 2.2)) * p.v;
                const prevT = (1 - Math.exp(-Math.max(0, k - 1 / fps) * 2.2)) * p.v;
                const zz = 1.6 + p.d[2] * 0.6;
                const x1 = w / 2 + ((p.d[0] * travel) / zz) * S * 1.4;
                const y1 = h / 2 + ((p.d[1] * travel) / zz) * S * 1.4;
                const x0 = w / 2 + ((p.d[0] * prevT) / zz) * S * 1.4;
                const y0 = h / 2 + ((p.d[1] * prevT) / zz) * S * 1.4;
                const a = clamp(1 - k / 4.5) * (k < 0 ? 0 : 1);
                if (a <= 0) continue;
                ctx.strokeStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;
                ctx.lineWidth = p.s;
                ctx.beginPath();
                ctx.moveTo(x0 - (x1 - x0) * 1.5, y0 - (y1 - y0) * 1.5);
                ctx.lineTo(x1, y1);
                ctx.stroke();
              }
              const ringT = easeOutCubic(clamp(k / 1.6));
              drawRing(ctx, w / 2, h / 2, ringT * S * 1.3, S * 0.05 * (1 - ringT) + 4, [180, 210, 255], (1 - ringT) * 0.9);
              const ring2 = easeOutCubic(clamp((k - 0.12) / 2.4));
              drawRing(ctx, w / 2, h / 2, ring2 * S * 0.9, S * 0.02, [255, 210, 150], (1 - ring2) * 0.5);
              const core = decay(t, SLAM, 1.4);
              drawGlow(ctx, w / 2, h / 2, S * (0.05 + 0.12 * core), [255, 250, 240], core, 3.5);
              drawGlow(ctx, w / 2, h / 2, S * (0.3 + 0.5 * core), [160, 190, 255], core * 0.5, 4);
              drawStreak(ctx, w / 2, h / 2, w * (0.4 + 0.5 * core), S * 0.012 + 2, [150, 200, 255], 0.35 + core * 0.65);
            }

            ctx.globalCompositeOperation = 'source-over';
            bloom2(ctx, w, h, 0.65 + warp * 0.5 + decay(t, SLAM, 2) * 0.8);
            chromatic(ctx, w, h, 34 * decay(t, SLAM, 2.4) + 10 * warp);
          }}
        />
      </Shake>
      <Statement from={SLAM} to={dur - 1.0} text="宇宙膨胀" sub="THE EXPANDING UNIVERSE" size={200} serif slam stagger={0.07} />
      <Captions items={CAPTIONS} />
      <Flash amount={decay(t, SLAM - 0.08, 5) * 1.1 + smooth(10.15, 10.45, t) * (t < SLAM ? 0.5 : 0)} />
      <Fade amount={1 - smooth(0, 0.8, t) + smooth(dur - 0.7, dur, t)} />
    </AbsoluteFill>
  );
};
