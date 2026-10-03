import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Readout, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {ignitionTimes} from '../lib/beats';
import {bloom2, chromatic, drawFlare, drawGalaxy, drawGlow, drawRing, galaxySprite, memo} from '../lib/canvas';
import {clamp, decay, easeInCubic, easeInOutCubic, easeOutCubic, lerp, smooth} from '../lib/math';
import {LookCam, V3, projectLook, renderCloud, toCloud} from '../lib/points';
import {gauss, mulberry32} from '../lib/rng';
import {drawCover, makeCosmicWeb, nebulaTexture} from '../lib/space';

const CAPTIONS = [
  {from: 0.1, to: 3.05, text: '随后，宇宙陷入了漫长的【黑暗时代】'},
  {from: 3.9, to: 8.37, text: '约1亿到2亿年后，|引力把气体聚拢——【第一代恒星】点燃了'},
  {from: 8.72, to: 12.25, text: '恒星聚成星系，星系又汇成星系团'},
  {from: 12.6, to: 16.71, text: '它们沿着暗物质的骨架，|编织出一张横跨宇宙的巨网'},
  {from: 19.9, to: 22.88, text: '而这张网的“网眼”，|至今仍在不断被拉大'},
];

const WEB_IN = 9.4;
const FLY = 16.3;

// Keep-out boxes in screen fractions (50-100px margin): caption band, ChapterTag, Readout. Tested unzoomed and
// at the 1.12x the ignitions build up to (corner stars drift outward between the two); the caption band runs
// to the bottom edge so no star rises through it on the zoom-out. Both layouts still reach all 44 points.
const KEEP_OUT: Record<'land' | 'port', [number, number, number, number][]> = {
  land: [[0.15, 0.79, 0.85, 1], [0, 0, 0.41, 0.2], [0.72, 0.16, 1, 0.38]],
  port: [[0, 0.72, 1, 1], [0, 0, 0.7, 0.16], [0.58, 0.215, 1, 0.325]],
};

// Positions only: ignition k keeps ignitionTimes()[k] (and its soundtrack ping) in both layouts.
const attractors = (portrait: boolean) =>
  memo(`web-attractors-${portrait ? 'p' : 'l'}`, () => {
    const r = mulberry32(141);
    const keep = KEEP_OUT[portrait ? 'port' : 'land'];
    const pts: [number, number][] = [];
    let guard = 0;
    while (pts.length < 44 && guard++ < 5000) {
      const x = 0.08 + r() * 0.84;
      const y = 0.12 + r() * 0.76;
      const blocked = [1, 1.12].some((z) => {
        const X = 0.5 + (x - 0.5) * z;
        const Y = 0.5 + (y - 0.5) * z;
        return keep.some(([a, b, c, d]) => X >= a && X <= c && Y >= b && Y <= d);
      });
      if (blocked) continue;
      if (pts.every(([a, b]) => Math.hypot((a - x) * 1.78, b - y) > 0.12)) pts.push([x, y]);
    }
    // Ignite roughly from the centre outwards.
    return pts.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5));
  });

const gas = (portrait: boolean) =>
  memo(`web-gas-${portrait ? 'p' : 'l'}`, () => {
    const r = mulberry32(143);
    const A = attractors(portrait);
    return Array.from({length: 4200}, () => {
      const x = r();
      const y = r();
      let best = 0;
      let bd = 9;
      A.forEach(([ax, ay], i) => {
        const d = Math.hypot((ax - x) * 1.78, ay - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return {x, y, k: best, ox: gauss(r) * 0.018, oy: gauss(r) * 0.018, b: 0.3 + 0.7 * r()};
    });
  });

const web = () =>
  memo('web-data', () => {
    const W = makeCosmicWeb(151, 150, 16, 300, 330);
    const cloud = toCloud('web', W.points);
    const gal: {p: V3; rot: number; seed: number; tilt: number}[] = [];
    const r = mulberry32(152);
    W.points.forEach((p, i) => {
      if (i % 37 === 0) gal.push({p: [p.x, p.y, p.z], rot: r() * Math.PI, seed: 160 + (i % 12), tilt: 0.3 + r() * 0.7});
    });
    return {cloud, gal};
  });

const webCam = (t: number, S: number): LookCam => {
  const yaw = -0.4 + 0.075 * (t - WEB_IN);
  let D: number;
  if (t < FLY) D = lerp(30, 17, easeInOutCubic(smooth(WEB_IN, FLY, t)));
  else D = 17 - 13 * easeInCubic(smooth(FLY, 24.6, t)) - (t - FLY) * 0.25;
  const pos: V3 = [Math.sin(yaw) * D, D * 0.16, -Math.cos(yaw) * D];
  const fwd: V3 = [-Math.sin(yaw), -0.16, Math.cos(yaw)];
  return {pos, target: [pos[0] + fwd[0], pos[1] + fwd[1], pos[2] + fwd[2]], focal: S * 0.95, roll: Math.sin(t * 0.3) * 0.08};
};

export const SceneWeb: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const igns = memo('web-ign', () => ignitionTimes());
  let flashSum = 0;
  for (const ti of igns) flashSum += decay(t, ti, 6);
  const webA = smooth(WEB_IN, WEB_IN + 2.2, t);
  const starsA = 1 - smooth(WEB_IN + 0.4, WEB_IN + 2.4, t);
  const flySpeed = smooth(FLY, 24, t);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={Math.min(0.25, flashSum * 0.05) + flySpeed * 0.12 + 0.3 * decay(t, 12, 3)}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            // ---------------- Dark ages & first stars (2D) ----------------
            if (starsA > 0.003) {
              ctx.save();
              const zoomIn = 1 + 0.12 * smooth(0, 9, t);
              const zoomOut = lerp(1, 0.35, easeInOutCubic(smooth(WEB_IN - 0.4, WEB_IN + 2.4, t)));
              const Z = zoomIn * zoomOut;
              ctx.translate(w / 2, h / 2);
              ctx.scale(Z, Z);
              ctx.translate(-w / 2, -h / 2);
              ctx.globalAlpha = starsA;
              const dark = nebulaTexture(161, 384, 216, {
                palette: [
                  [0, 0, 0],
                  [30, 10, 14],
                  [70, 26, 30],
                  [110, 50, 60],
                ],
                scale: 1.6,
                contrast: 2.0,
                mask: 0.5,
              });
              // Undo the pull-back for the backdrop so its rotated edges never come into frame.
              drawCover(ctx, dark, w, h, 1.1 / zoomOut, t * 0.01, 0.8);
              ctx.globalCompositeOperation = 'lighter';
              const portrait = h > w;
              const A = attractors(portrait);
              const collapse = easeInOutCubic(smooth(1.0, 7.0, t));
              for (const g of gas(portrait)) {
                const [ax, ay] = A[g.k];
                const x = lerp(g.x, ax + g.ox, collapse * 0.9) * w;
                const y = lerp(g.y, ay + g.oy, collapse * 0.9) * h;
                const lit = smooth(igns[g.k], igns[g.k] + 0.8, t);
                const r = lerp(140, 120, lit);
                const gg = lerp(60, 170, lit);
                const b = lerp(55, 255, lit);
                ctx.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${(0.18 + 0.5 * lit) * g.b})`;
                ctx.fillRect(x, y, 1.6, 1.6);
              }
              A.forEach(([ax, ay], k) => {
                const ti = igns[k];
                if (t < ti - 0.02) {
                  // Pre-ignition: a faint warm clump.
                  drawGlow(ctx, ax * w, ay * h, 26 * u, [170, 70, 60], 0.25 * collapse);
                  return;
                }
                const e = t - ti;
                const x = ax * w;
                const y = ay * h;
                const big = k < 16 ? 1 : 0.6;
                const fl = Math.exp(-e * 2.6);
                // Ionised bubble.
                const br = S * (0.015 + 0.09 * (1 - Math.exp(-e * 0.7))) * big;
                drawGlow(ctx, x, y, br, [90, 150, 255], 0.35);
                drawRing(ctx, x, y, S * 0.25 * easeOutCubic(clamp(e / 1.2)) * big, 3 * u, [170, 210, 255], (1 - clamp(e / 1.2)) * 0.6);
                const gk = smooth(WEB_IN - 1.2, WEB_IN + 0.4, t);
                drawFlare(ctx, x, y, (60 + 260 * fl) * u * big * (1 - 0.6 * gk), [170, 205, 255], 0.9 * (1 - gk * 0.7), 0.3);
                drawGlow(ctx, x, y, (8 + 40 * fl) * u, [255, 255, 255], 1);
                if (gk > 0) drawGalaxy(ctx, galaxySprite(170 + (k % 10), 'spiral', 160, 3000), x, y, 110 * u * gk * big, k, 0.6, gk);
              });
              ctx.restore();
            }

            // ---------------- The cosmic web (3D) ----------------
            if (webA > 0.003) {
              const {cloud, gal} = web();
              const cam = webCam(t, S);
              const a = 1 + 0.28 * easeInOutCubic(smooth(19.6, 24, t));
              const basis = renderCloud(ctx, w, h, cloud, cam, {
                near: 0.25,
                far: 52,
                alpha: webA * 2.6,
                gain: 1.05,
                scale: a,
                falloff: 0.012,
              });
              ctx.save();
              ctx.globalCompositeOperation = 'lighter';
              const P = [0, 0, 0];
              for (const g of gal) {
                if (!projectLook(cam, basis, w, h, [g.p[0] * a, g.p[1] * a, g.p[2] * a], P)) continue;
                if (P[2] > 9) continue;
                const size = (0.45 / P[2]) * cam.focal;
                if (size < 5) continue;
                const fog = clamp((9 - P[2]) / 3) * clamp((P[2] - 0.25) / 0.6) * webA;
                drawGalaxy(ctx, galaxySprite(g.seed, 'spiral', 192, 3600), P[0], P[1], size, g.rot, g.tilt, fog);
              }
              ctx.restore();
            }
            bloom2(ctx, w, h, 0.65 + Math.min(0.8, flashSum * 0.15) + webA * 0.75);
            chromatic(ctx, w, h, flySpeed * 10 + Math.min(10, flashSum * 3));
          }}
        />
      </Shake>
      <Readout
        backdrop
        label="宇宙诞生后"
        value={t < 4.3 ? '约 50 万 – 1 亿年' : t < WEB_IN ? '约 1 – 2 亿年' : '约 10 亿年 →'}
        x={0.94}
        y={0.27}
        align="right"
        size={46}
        opacity={smooth(0.8, 1.6, t) * (1 - smooth(14, 15, t))}
      />
      <ChapterTag index="06" title="星辰点亮" en="FIRST STARS · COSMIC WEB" dur={dur} />
      <Statement from={FLY} to={20.0} text="宇宙网" sub="THE COSMIC WEB" theme="violet" size={170} serif slam />
      <Captions items={CAPTIONS} />
      <Fade amount={1 - smooth(0, 0.6, t) + smooth(dur - 0.5, dur, t)} />
    </AbsoluteFill>
  );
};
