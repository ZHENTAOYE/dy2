import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Flash, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {LATIN, SANS, SERIF} from '../fonts';
import {
  Ctx,
  RGB,
  bloom2,
  chromatic,
  drawArrow,
  drawGalaxy,
  drawGlow,
  drawGodRays,
  drawRing,
  drawStreak,
  font,
  galaxySprite,
  heatColor,
  memo,
} from '../lib/canvas';
import {clamp, decay, easeOutCubic, lerp, mix3, smooth, win} from '../lib/math';
import {gauss, mulberry32, sphereDir} from '../lib/rng';
import {drawCover, drawStars3, makeStars3, milkyWayTexture, nebulaTexture, starDustTexture} from '../lib/space';

const BANG = 20.4;
const H = 0.11; // expansion rate of the toy de Sitter universe (1/s)

const CAPTIONS = [
  {from: 0.5, to: 4.3, text: '如今，最遥远的星系|正以【超光速】远离我们'},
  {from: 4.6, to: 8.2, text: '这并不违反相对论：不是星系|在空间中飞驰，而是空间本身在膨胀'},
  {from: 8.5, to: 12.0, text: '它们此刻发出的光，|将【永远】无法抵达地球'},
  {from: 12.3, to: 16.4, text: '千亿年后，本星系群之外的星系，|都将从夜空中消失'},
  {from: 16.7, to: 20.0, text: '但此刻，我们仍能看见|宇宙138亿年的过去'},
];

type Gal = {r: number; a: number; s: number; rot: number; seed: number; tilt: number};

const field = () =>
  memo('fin-field', () => {
    const rr = mulberry32(301);
    return Array.from({length: 260}, (): Gal => ({
      r: 0.08 + Math.pow(rr(), 0.6) * 1.6,
      a: rr() * Math.PI * 2,
      s: 0.5 + rr() * 0.7,
      rot: rr() * Math.PI,
      seed: 310 + Math.floor(rr() * 12),
      tilt: 0.35 + rr() * 0.6,
    }));
  });

type Burst = {d: [number, number, number]; v: number; s: number; hue: number};
const burst = () =>
  memo('fin-burst', () => {
    const r = mulberry32(303);
    return Array.from({length: 7000}, (): Burst => ({d: sphereDir(r), v: 0.3 + Math.pow(r(), 0.5) * 1.6, s: 0.6 + r() * 2.4, hue: r()}));
  });

const galaxies3 = () =>
  memo('fin-gal3', () => {
    const r = mulberry32(305);
    return Array.from({length: 160}, (_, i) => ({
      x: gauss(r) * 4,
      y: gauss(r) * 2.6,
      z: r() * 12,
      size: 0.25 + r() * 0.5,
      rot: r() * Math.PI,
      tilt: 0.3 + r() * 0.7,
      seed: 320 + (i % 14),
    }));
  });

// Toy universe: galaxies at comoving radius r recede as r·e^{H t}; the Hubble
// radius (where recession speed = c) stays fixed on screen.
const drawHorizon = (ctx: Ctx, w: number, h: number, t: number, alpha: number, u: number, fade: number) => {
  if (alpha <= 0.003) return;
  const S = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const RH = S * 0.3;
  const a = Math.exp(H * t);
  // Caption band (matches Captions' box): dim galaxies and arrows that would run through the subtitle.
  const portrait = h > w;
  const capBot = h * (portrait ? 0.84 : 0.9) + 10 * u;
  const capTop = capBot - (portrait ? 170 : 90) * u;
  const capHalf = w * (portrait ? 0.43 : 0.4);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  for (const g of field()) {
    const r = g.r * a * S * 0.55;
    const x = cx + Math.cos(g.a) * r;
    const y = cy + Math.sin(g.a) * r * 0.62;
    if (x < -80 || x > w + 80 || y < -80 || y > h + 80) continue;
    const rEll = Math.hypot(x - cx, (y - cy) / 0.62);
    const v = rEll / RH; // recession speed in units of c
    const red = clamp((v - 0.6) / 1.2);
    const gone = fade * clamp(0.3 + v * 0.5);
    const L = Math.min(80 * u, v * 30 * u);
    const ux = (x - cx) / Math.max(1, Math.hypot(x - cx, y - cy));
    const uy = (y - cy) / Math.max(1, Math.hypot(x - cx, y - cy));
    const tipY = y + uy * (20 * u + L);
    const gap = Math.max(capTop - Math.max(y, tipY), Math.min(y, tipY) - capBot, Math.abs(x - cx) - capHalf);
    const al = (1 - gone) * clamp(1.4 - v * 0.25) * lerp(0.2, 1, clamp(gap / (40 * u)));
    if (al <= 0.01) continue;
    drawGalaxy(ctx, galaxySprite(g.seed, 'spiral', 128, 2000), x, y, 34 * u * g.s, g.rot, g.tilt, al);
    const col: RGB = mix3([255, 240, 200], [255, 60, 50], red);
    if (v > 0.15) {
      drawArrow(ctx, x + ux * 20 * u, y + uy * 20 * u, x + ux * (20 * u + L), y + uy * (20 * u + L), `rgba(${col[0]},${col[1] | 0},${col[2] | 0},${0.75 * al})`, 2.2 * u, 9 * u);
    }
    if (fade > 0) drawGlow(ctx, x, y, 22 * u, [255, 50, 40], fade * al * 0.6);
  }
  // Hubble sphere.
  const ringA = win(t, 1.0, 12.4, 0.8, 0.6);
  ctx.setLineDash([12 * u, 10 * u]);
  ctx.strokeStyle = `rgba(140,220,255,${0.75 * ringA})`;
  ctx.lineWidth = 2.4 * u;
  ctx.beginPath();
  ctx.ellipse(cx, cy, RH, RH * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Two photons: one from inside the horizon reaches us, one from outside never does.
  const photon = (r0: number, ang: number, t0: number, col: RGB) => {
    if (t < t0) return;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 24; k++) {
      const tt = t0 + ((t - t0) * k) / 24;
      const r = Math.max(0, RH + (r0 - RH) * Math.exp(H * 1.0 * (tt - t0) * 3.2));
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.62]);
    }
    ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    const [hx, hy] = pts[pts.length - 1];
    drawGlow(ctx, hx, hy, 26 * u, col, 1);
    drawGlow(ctx, hx, hy, 8 * u, [255, 255, 255], 1);
  };
  const pa = win(t, 8.4, 12.3, 0.3, 0.6);
  if (pa > 0) {
    ctx.globalAlpha = alpha * pa;
    photon(RH * 1.12, -2.4, 8.5, [120, 255, 200]);
    photon(RH * 0.72, 0.5, 8.5, [255, 240, 140]);
  }
  ctx.restore();
  // Labels.
  ctx.save();
  ctx.globalAlpha = alpha * ringA;
  ctx.font = font(24 * u, 500);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(150,225,255,0.95)';
  ctx.fillText('哈勃半径：退行速度 = 光速', cx, cy - RH * 0.62 - 20 * u);
  ctx.font = font(22 * u, 300);
  ctx.fillStyle = 'rgba(255,235,190,0.9)';
  ctx.fillText('内：慢于光速', cx, cy + RH * 0.62 - 26 * u);
  ctx.fillStyle = 'rgba(255,120,100,0.95)';
  ctx.fillText('外：快于光速', cx, cy + RH * 0.62 + 40 * u);
  ctx.restore();
  // "Us" leaves before the lone merged galaxy fills the centre.
  const meA = alpha * (1 - smooth(12.6, 13.4, t));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, cx, cy, 30 * u, [120, 230, 255], meA);
  drawRing(ctx, cx, cy, 16 * u, 2.5 * u, [140, 230, 255], meA);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = meA;
  ctx.font = font(22 * u, 500);
  ctx.fillStyle = 'rgba(150,235,255,0.95)';
  ctx.fillText('我们', cx + 24 * u, cy + 8 * u);
  ctx.restore();
};

export const SceneFinale: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const horizonA = 1 - smooth(15.6, 16.6, t);
  const fade = smooth(12.4, 15.6, t);
  const lonely = win(t, 13.2, 17.4, 1.2, 0.8);
  const rush = smooth(16.8, BANG, t) * (t < BANG ? 1 : 0);
  const k = t - BANG;
  const post = t >= BANG;
  const calm = smooth(26.0, 27.5, t);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={rush * rush * 0.7 + 1.3 * decay(t, BANG, 1.3) + (post ? 0.15 * (1 - calm) : 0)} zoom={rush * 0.03}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cx = w / 2;
            const cy = h / 2;
            if (!post) {
              drawCover(ctx, starDustTexture(31, 1920, 1080, 2400), w, h, 1 + t * 0.004, 0, 0.55 * (1 - fade * 0.8));
              drawHorizon(ctx, w, h, t, horizonA, u, fade);
              // The far future: a lone merged galaxy.
              if (lonely > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                const sz = S * lerp(0.28, 0.4, smooth(13.2, 17.4, t));
                drawGalaxy(ctx, galaxySprite(333, 'elliptical', 512, 30000), cx, cy, sz, 0.4, 0.75, lonely);
                drawGlow(ctx, cx, cy, sz * 0.5, [255, 210, 160], lonely * 0.4);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = lonely * (1 - rush);
                ctx.font = font(24 * u, 300);
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,225,190,0.9)';
                ctx.fillText('银河系与仙女座星系合并后的“银河仙女星系”（想象图）', cx, cy + sz * 0.42 + 40 * u);
                ctx.restore();
              }
              // Flashback rush: the whole history streaks past.
              if (rush > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                const z = Math.pow(rush, 2) * 6;
                const texB = nebulaTexture(339, 384, 216, {
                  palette: [
                    [0, 0, 0],
                    [70, 10, 20],
                    [220, 90, 30],
                    [255, 220, 160],
                  ],
                  scale: 2.4,
                  contrast: 2.0,
                });
                // Back through time: first starlight, then the primordial fire.
                const fire = smooth(0.45, 0.95, rush);
                for (let i = 0; i < 3; i++) {
                  const ph = ((z + i / 3) % 1 + 1) % 1;
                  drawCover(ctx, texB, w, h, 1.3 * Math.pow(4, ph), i * 2.1 + z, 0.6 * fire * Math.sin(Math.PI * ph));
                }
                const camZ = 40 * Math.pow(rush, 3);
                const prevZ = 40 * Math.pow(smooth(16.8, BANG, t - 1 / fps), 3);
                drawStars3(ctx, w, h, memo('fin-rush', () => makeStars3(341, 3000, 10, 10)), {
                  camZ,
                  prevCamZ: prevZ,
                  depth: 10,
                  focal: S * 0.85,
                  alpha: Math.min(1, rush * 2),
                  tint: [255, 200, 140],
                  tintAmt: smooth(0.4, 0.9, rush),
                  sizeK: 1.4,
                  streakAlpha: 1,
                });
                drawGlow(ctx, cx, cy, S * (0.05 + 0.5 * Math.pow(rush, 3)), [255, 245, 225], Math.pow(rush, 1.5), 3);
                ctx.restore();
              }
            } else {
              // ---------------- The final expansion ----------------
              ctx.globalCompositeOperation = 'lighter';
              const neb = nebulaTexture(343, 480, 270, {
                palette: [
                  [0, 0, 0],
                  [40, 14, 70],
                  [150, 60, 120],
                  [255, 160, 90],
                  [255, 235, 200],
                ],
                scale: 2.0,
                warp: 2.2,
                contrast: 2.1,
                mask: 0.4,
              });
              for (let i = 0; i < 2; i++) {
                const ph = ((k * 0.08 + i / 2) % 1 + 1) % 1;
                drawCover(ctx, neb, w, h, 1.3 * Math.pow(2.5, ph), i * 2.4 + k * 0.02, (0.5 - 0.3 * calm) * Math.sin(Math.PI * ph) * smooth(0, 0.6, k));
              }
              // Galaxies stream past the camera.
              const camZ = 0.4 * k + 10 * (1 - Math.exp(-k * 0.9));
              for (const g of galaxies3()) {
                let zr = (g.z - camZ) % 12;
                if (zr < 0) zr += 12;
                if (zr < 0.25) continue;
                const px = cx + (g.x / zr) * S * 0.85;
                const py = cy + (g.y / zr) * S * 0.85;
                const size = (g.size / zr) * S * 0.85;
                const al = clamp((12 - zr) / 3) * clamp(zr / 0.6) * (1 - calm * 0.85);
                drawGalaxy(ctx, galaxySprite(g.seed, 'spiral', 192, 3500), px, py, size, g.rot + k * 0.05, g.tilt, al);
              }
              drawStars3(ctx, w, h, memo('fin-stars', () => makeStars3(345, 3200, 10, 10)), {
                camZ: camZ * 1.4,
                prevCamZ: (0.4 * (k - 1 / fps) + 10 * (1 - Math.exp(-(k - 1 / fps) * 0.9))) * 1.4,
                depth: 10,
                focal: S * 0.85,
                alpha: 1 - calm * 0.7,
                time: t,
                sizeK: 1.2,
                streakAlpha: 1,
              });
              // Explosion.
              if (k < 8) {
                for (const p of burst()) {
                  const travel = (1 - Math.exp(-k * 1.3)) * p.v * 2.6 + k * 0.04;
                  const prev = (1 - Math.exp(-Math.max(0, k - 0.05) * 1.3)) * p.v * 2.6 + Math.max(0, k - 0.05) * 0.04;
                  const zz = 1.25 - p.d[2] * 0.9 * Math.min(1, travel);
                  if (zz <= 0.05) continue;
                  const x1 = cx + ((p.d[0] * travel) / zz) * S * 0.6;
                  const y1 = cy + ((p.d[1] * travel) / zz) * S * 0.6;
                  const x0 = cx + ((p.d[0] * prev) / zz) * S * 0.6;
                  const y0 = cy + ((p.d[1] * prev) / zz) * S * 0.6;
                  const a = clamp(1 - k / 7.5) * clamp(k * 10);
                  if (a <= 0.01) continue;
                  const c = p.hue < 0.6 ? heatColor(clamp(1 - k * 0.1 - p.hue * 0.3)) : mix3([180, 200, 255], [255, 255, 255], p.hue);
                  ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
                  ctx.lineWidth = (p.s / zz) * u;
                  ctx.beginPath();
                  ctx.moveTo(x0, y0);
                  ctx.lineTo(x1, y1);
                  ctx.stroke();
                }
                drawGodRays(ctx, cx, cy, S * 1.4, 72, k * 0.04, decay(t, BANG, 0.35) * 0.55, [255, 235, 200], 7);
                for (const [delay, sp, col] of [
                  [0, 1.5, [255, 255, 255]],
                  [0.12, 1.1, [255, 210, 140]],
                  [0.3, 0.8, [190, 160, 255]],
                  [0.6, 2.4, [150, 220, 255]],
                ] as const) {
                  const rk = easeOutCubic(clamp((k - delay) / sp));
                  if (k > delay) drawRing(ctx, cx, cy, rk * S * 1.5, S * 0.035 * (1 - rk) + 3, col as unknown as RGB, (1 - rk) * 0.9);
                }
                const core = decay(t, BANG, 1.1);
                drawGlow(ctx, cx, cy, S * (0.06 + 0.3 * core), [255, 250, 240], core, 3.5);
                drawStreak(ctx, cx, cy, w * (0.3 + 0.7 * core), S * 0.016 + 2, [255, 210, 160], core);
              }
              // Coda: the night sky again (bookend of the opening).
              if (calm > 0) {
                drawCover(ctx, starDustTexture(3, 1920, 1080, 5200), w, h, 1.04 + (t - 26) * 0.01, 0, calm * 0.9);
                drawCover(ctx, milkyWayTexture(21, 1920, 1080), w, h, 1.1 + (t - 26) * 0.012, 0.02 - (t - 26) * 0.003, calm);
              }
            }
            ctx.globalCompositeOperation = 'source-over';
            bloom2(ctx, w, h, 0.6 + rush * 0.8 + 1.0 * decay(t, BANG, 1.2) - calm * 0.1);
            chromatic(ctx, w, h, rush * 16 + 40 * decay(t, BANG, 1.8));
          }}
        />
      </Shake>
      <ChapterTag index="09" title="未来" en="THE FUTURE" dur={16.4} />
      <Statement from={BANG + 0.05} to={25.8} text="宇宙仍在膨胀" sub="THE UNIVERSE IS STILL EXPANDING" theme="gold" size={190} serif slam stagger={0.08} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '40%',
          textAlign: 'center',
          opacity: win(t, 26.6, 31.2, 1.0, 0.9),
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 900,
            fontSize: (portrait ? 62 : 70) * u,
            lineHeight: portrait ? 1.4 : undefined,
            letterSpacing: '0.16em',
            color: '#f6f1e6',
            textShadow: `0 0 ${30 * u}px rgba(255,200,140,0.6), 0 ${2 * u}px ${12 * u}px rgba(0,0,0,0.9)`,
            transform: `scale(${1 + (t - 26.6) * 0.006})`,
          }}
        >
          而我们，{portrait ? <br /> : null}是宇宙认识自己的一种方式
        </div>
        <div
          style={{
            marginTop: 30 * u,
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: 30 * u,
            letterSpacing: '0.3em',
            color: 'rgba(240,235,225,0.92)',
            textShadow: `0 0 ${12 * u}px rgba(0,0,0,0.85), 0 ${2 * u}px ${10 * u}px rgba(0,0,0,0.95)`,
            opacity: smooth(27.6, 28.6, t),
          }}
        >
          —— 卡尔·萨根
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '7%',
          textAlign: 'center',
          fontFamily: LATIN,
          fontWeight: 200,
          fontSize: 20 * u,
          letterSpacing: '0.5em',
          color: 'rgba(220,225,240,0.7)',
          opacity: win(t, 28.6, 31.4, 0.8, 0.8),
        }}
      >
        ALL VISUALS PROCEDURALLY GENERATED · REMOTION
      </div>
      <Flash amount={decay(t, BANG - 0.03, 2.4) * 1.3 + rush * rush * rush * 0.5} />
      <Captions items={CAPTIONS} />
      <Fade amount={1 - smooth(0, 0.5, t) + smooth(dur - 1.4, dur - 0.1, t)} />
    </AbsoluteFill>
  );
};
