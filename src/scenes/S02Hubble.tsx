import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Fade, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {LATIN, SANS} from '../fonts';
import {
  Ctx,
  bloom2,
  drawArrow,
  drawGalaxy,
  drawGlow,
  drawSpectrum,
  font,
  galaxySprite,
  memo,
  wavelengthRGB,
} from '../lib/canvas';
import {clamp, decay, easeInOutCubic, easeOutBack, easeOutCubic, lerp, smooth, win} from '../lib/math';
import {gauss, mulberry32} from '../lib/rng';
import {drawCover, nebulaTexture, starDustTexture} from '../lib/space';

const CAPTIONS = [
  {from: 0.6, to: 4.4, text: '1929年，天文学家【哈勃】发现了一个奇怪的现象'},
  {from: 4.8, to: 8.6, text: '几乎所有遥远星系的光，都在向【红色】一端偏移'},
  {from: 9.0, to: 13.0, text: '光源远离我们时，光波被拉长、颜色变红——这就是【红移】'},
  {from: 13.5, to: 17.4, text: '更惊人的是：星系越远，远离我们的速度就越快'},
  {from: 17.8, to: 21.6, text: '距离每增加326万光年，退行速度就增加约【70公里/秒】'},
];

type FieldGal = {ang: number; d: number; v: number; seed: number; size: number; rot: number; kind: 'spiral' | 'barred' | 'elliptical'};

const fieldGalaxies = () =>
  memo('hubble-field', () => {
    const r = mulberry32(42);
    const out: FieldGal[] = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const d = 0.16 + (0.84 * (i + r() * 0.8)) / n;
      out.push({
        ang: (i * 2.399963 + r() * 0.5) % (Math.PI * 2),
        d,
        v: d * (1 + gauss(r) * 0.09),
        seed: 300 + i,
        size: 0.8 + r() * 0.5,
        rot: r() * Math.PI,
        kind: r() < 0.2 ? 'elliptical' : r() < 0.5 ? 'barred' : 'spiral',
      });
    }
    return out.sort((a, b) => a.d - b.d);
  });

const swarm = () =>
  memo('hubble-swarm', () => {
    const r = mulberry32(43);
    return Array.from({length: 420}, () => ({
      ang: r() * Math.PI * 2,
      d: 0.2 + Math.pow(r(), 0.7) * 2.6,
      size: 0.4 + r() * 0.6,
      rot: r() * Math.PI,
      seed: 340 + Math.floor(r() * 10),
    }));
  });

// Colour for a recession speed: near → white/yellow, far → deep red.
const redshiftColor = (k: number): [number, number, number] => [255, lerp(240, 70, clamp(k)), lerp(200, 50, clamp(k))];

const drawScope = (ctx: Ctx, cx: number, cy: number, R: number, t: number, z: number, alpha: number) => {
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#020309';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  const dust = starDustTexture(8, 1024, 1024, 2500);
  ctx.drawImage(dust, cx - R, cy - R, R * 2, R * 2);
  ctx.globalCompositeOperation = 'lighter';
  const g = galaxySprite(901, 'spiral', 640, 46000);
  const zoom = 1 + t * 0.012;
  drawGalaxy(ctx, g, cx, cy, R * 1.55 * zoom, 0.5 + t * 0.025, 0.62, 1);
  drawGlow(ctx, cx, cy, R * 0.3, [255, 230, 190], 0.35);
  // Redshift tint: suppress blue/green inside the eyepiece.
  if (z > 0) {
    ctx.globalCompositeOperation = 'multiply';
    const k = clamp(z / 0.06);
    ctx.fillStyle = `rgb(255,${Math.round(255 - 120 * k)},${Math.round(255 - 170 * k)})`;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.restore();
  // Eyepiece ring + reticle.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(160,210,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,210,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + t * 0.02;
    const l = i % 6 === 0 ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 1.06, cy + Math.sin(a) * R * 1.06);
    ctx.lineTo(cx + Math.cos(a) * (R * 1.06 + l), cy + Math.sin(a) * (R * 1.06 + l));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(160,210,255,0.4)';
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * R * 0.15, cy + dy * R * 0.15);
    ctx.lineTo(cx + dx * R * 0.95, cy + dy * R * 0.95);
    ctx.stroke();
  }
  ctx.restore();
};

const drawWave = (
  ctx: Ctx,
  x0: number,
  x1: number,
  y: number,
  amp: number,
  lambdaPx: number,
  phase: number,
  rgb: [number, number, number],
  alpha: number,
) => {
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  for (const [lw, a] of [
    [14, 0.12],
    [6, 0.3],
    [2.5, 1],
  ] as const) {
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 3) {
      const env = clamp((x - x0) / 60) * clamp((x1 - x) / 60);
      const yy = y + Math.sin(((x - x0) / lambdaPx) * Math.PI * 2 - phase) * amp * env;
      if (x === x0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
};

export const SceneHubble: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const aA = win(t, 0, 9.3, 0.8, 0.6);
  const aB = win(t, 9.0, 13.7, 0.6, 0.6);
  const aG = win(t, 13.3, 22.2, 0.7, 0.6);
  const z = 0.06 * smooth(4.6, 8.0, t);
  const finale = smooth(21.6, 25.5, t);

  // Graph placement (shared by canvas + DOM labels).
  const G = portrait
    ? {x: 0.12 * width, y: 0.17 * height, w: 0.78 * width, h: 0.26 * height}
    : {x: 0.08 * width, y: 0.2 * height, w: 0.36 * width, h: 0.5 * height};

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={0.5 * decay(t, 22.0, 2.5)}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const neb = nebulaTexture(31, 384, 216, {
              palette: [
                [0, 0, 0],
                [10, 14, 40],
                [30, 40, 90],
                [80, 50, 120],
              ],
              scale: 1.4,
              contrast: 2.4,
              mask: 0.6,
            });
            drawCover(ctx, neb, w, h, 1.1 + t * 0.01, 0, 0.55);
            drawCover(ctx, starDustTexture(12, 1920, 1080, 3000), w, h, 1.0 + t * 0.004, 0, 0.75);

            // ---------- Phase A: eyepiece + spectra ----------
            if (aA > 0) {
              const R = portrait ? w * 0.36 : h * 0.3;
              const sx = portrait ? w / 2 : w * 0.31;
              const sy = portrait ? h * 0.32 : h * 0.45;
              const push = 1 + 0.05 * smooth(0, 9, t);
              drawScope(ctx, sx, sy, R * push, t, z, aA);

              const bx = portrait ? w * 0.08 : w * 0.56;
              const bw = portrait ? w * 0.84 : w * 0.38;
              const bh = 72 * u;
              const by1 = portrait ? h * 0.55 : h * 0.29;
              const by2 = portrait ? h * 0.67 : h * 0.52;
              const panelIn = easeOutCubic(clamp((t - 1.2) / 1.2));
              ctx.save();
              ctx.globalAlpha = aA * panelIn;
              ctx.font = font(30 * u, 300);
              ctx.fillStyle = 'rgba(210,225,255,0.9)';
              ctx.fillText('实验室中的光谱（静止光源）', bx, by1 - 16 * u);
              ctx.fillText('遥远星系的光谱', bx, by2 - 16 * u);
              ctx.restore();
              drawSpectrum(ctx, bx, by1, bw * panelIn, bh, 0, aA);
              const obsIn = easeOutCubic(clamp((t - 2.4) / 1.2));
              drawSpectrum(ctx, bx, by2, bw * obsIn, bh, z, aA);
              // Shift arrows under the observed strip.
              const shiftK = smooth(5.2, 6.4, t) * aA;
              if (shiftK > 0) {
                ctx.save();
                ctx.globalAlpha = shiftK;
                for (const l of [486.1, 589.0, 656.3]) {
                  const p0 = bx + ((l - 380) / 340) * bw;
                  const p1 = bx + ((l * (1 + z) - 380) / 340) * bw;
                  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                  ctx.setLineDash([4, 6]);
                  ctx.beginPath();
                  ctx.moveTo(p0, by1 + bh);
                  ctx.lineTo(p0, by2 + bh + 18 * u);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  drawArrow(ctx, p0, by2 + bh + 18 * u, Math.max(p0 + 4, p1), by2 + bh + 18 * u, 'rgba(255,120,100,0.95)', 3 * u, 11 * u);
                }
                ctx.font = font(30 * u, 500);
                ctx.fillStyle = '#ff8a7a';
                ctx.fillText('→ 向红端偏移', bx + bw * 0.62, by2 + bh + 62 * u);
                ctx.font = font(18 * u, 300);
                ctx.fillStyle = 'rgba(200,215,255,0.7)';
                ctx.fillText('波长 / 纳米（偏移量为示意）', bx, by2 + bh + 62 * u);
                ctx.restore();
              }
              ctx.save();
              ctx.globalAlpha = aA * panelIn * 0.8;
              ctx.font = font(18 * u, 400, '"Montserrat"');
              ctx.fillStyle = 'rgba(200,215,255,0.8)';
              ctx.fillText('400', bx + ((400 - 380) / 340) * bw - 14 * u, by1 + bh + 26 * u);
              ctx.fillText('700 nm', bx + ((700 - 380) / 340) * bw - 14 * u, by1 + bh + 26 * u);
              ctx.restore();
            }

            // ---------- Phase B: stretched light waves ----------
            if (aB > 0) {
              const k = smooth(9.6, 12.4, t);
              const y1 = h * (portrait ? 0.36 : 0.34);
              const y2 = h * (portrait ? 0.56 : 0.6);
              const x0 = w * 0.16;
              const x1 = w * 0.92;
              const nm2 = lerp(470, 680, k);
              const phase = t * 7;
              // Sources.
              const srcX2 = x0 - k * w * 0.08;
              ctx.save();
              ctx.globalCompositeOperation = 'lighter';
              const gs = galaxySprite(320, 'spiral', 256, 7000);
              drawGalaxy(ctx, gs, x0 - 40 * u, y1, 150 * u, t * 0.1, 0.7, aB);
              drawGalaxy(ctx, gs, srcX2 - 40 * u, y2, 150 * u * (1 - 0.25 * k), t * 0.1, 0.7, aB);
              ctx.restore();
              drawWave(ctx, x0 + 30 * u, x1, y1, 42 * u, 470 * 0.24 * u, phase, wavelengthRGB(470), aB);
              drawWave(ctx, srcX2 + 30 * u, x1, y2, 42 * u, nm2 * 0.24 * u * (1 + k * 0.9), phase, wavelengthRGB(nm2), aB);
              // Observer.
              ctx.save();
              ctx.globalAlpha = aB;
              ctx.globalCompositeOperation = 'lighter';
              drawGlow(ctx, x1 + 30 * u, (y1 + y2) / 2, 60 * u, [120, 200, 255], 0.8);
              ctx.restore();
              ctx.save();
              ctx.globalAlpha = aB;
              ctx.font = font(26 * u, 300);
              ctx.fillStyle = 'rgba(220,230,255,0.9)';
              ctx.fillText('静止的光源', x0 - 20 * u, y1 - 90 * u);
              ctx.fillText('远离中的光源', x0 - 20 * u, y2 - 90 * u);
              ctx.font = font(32 * u, 500);
              const c2 = wavelengthRGB(nm2);
              ctx.fillStyle = `rgb(${c2[0]},${c2[1]},${c2[2]})`;
              ctx.fillText(`波长被拉长 ×${((nm2 * (1 + k * 0.9)) / 470).toFixed(1)}`, w * 0.62, y2 + 100 * u);
              ctx.fillStyle = 'rgba(160,200,255,0.95)';
              ctx.font = font(24 * u, 300);
              ctx.fillText('观测者', x1 - 10 * u, (y1 + y2) / 2 + 80 * u);
              ctx.restore();
              drawArrow(ctx, srcX2 - 70 * u, y2 + 70 * u, srcX2 - 70 * u - 120 * u * k - 20 * u, y2 + 70 * u, `rgba(255,140,120,${aB})`, 3 * u, 12 * u);
            }

            // ---------- Phase C/D: Hubble diagram + receding field ----------
            const fieldA = smooth(13.3, 14.3, t);
            if (fieldA > 0) {
              const fx = lerp(portrait ? w / 2 : w * 0.72, w / 2, easeInOutCubic(finale));
              const fy = lerp(portrait ? h * 0.67 : h * 0.47, h * 0.5, easeInOutCubic(finale));
              const scaleR = lerp(portrait ? w * 0.42 : h * 0.4, S * 0.55, finale);
              const tilt = lerp(0.55, 0.85, finale);
              // Expansion factor: gentle, then runaway at the finale.
              const a = 1 + 0.12 * smooth(14, 21, t) + 2.8 * Math.pow(finale, 2.2);
              ctx.save();
              ctx.globalCompositeOperation = 'lighter';
              // Milky Way marker at the centre.
              drawGlow(ctx, fx, fy, 40 * u, [120, 210, 255], fieldA);
              ctx.strokeStyle = `rgba(120,210,255,${0.8 * fieldA})`;
              ctx.lineWidth = 2 * u;
              ctx.beginPath();
              ctx.ellipse(fx, fy, 26 * u, 26 * u * tilt, 0, 0, Math.PI * 2);
              ctx.stroke();
              // Background swarm, revealed at the finale.
              if (finale > 0) {
                for (const g of swarm()) {
                  const rr = g.d * a * scaleR;
                  const px = fx + Math.cos(g.ang) * rr;
                  const py = fy + Math.sin(g.ang) * rr * tilt;
                  if (px < -50 || px > w + 50 || py < -50 || py > h + 50) continue;
                  const vk = clamp(g.d / 2.2);
                  const col = redshiftColor(vk);
                  const trail = 0.12 * g.d * scaleR * finale;
                  ctx.strokeStyle = `rgba(${col[0]},${col[1] | 0},${col[2] | 0},${0.5 * finale})`;
                  ctx.lineWidth = 1.5 * u;
                  ctx.beginPath();
                  ctx.moveTo(px - Math.cos(g.ang) * trail, py - Math.sin(g.ang) * trail * tilt);
                  ctx.lineTo(px, py);
                  ctx.stroke();
                  drawGalaxy(ctx, galaxySprite(g.seed, 'spiral', 128, 1800), px, py, 44 * u * g.size, g.rot, tilt, finale);
                }
              }
              const F = fieldGalaxies();
              F.forEach((g, i) => {
                const pop = easeOutBack(clamp((t - (14.0 + i * 0.22)) / 0.5));
                if (pop <= 0) return;
                const rr = g.d * a * scaleR;
                const px = fx + Math.cos(g.ang) * rr;
                const py = fy + Math.sin(g.ang) * rr * tilt;
                const col = redshiftColor(g.d);
                const al = fieldA * clamp(pop);
                drawGalaxy(ctx, galaxySprite(g.seed, g.kind, 192, 4500), px, py, 92 * u * g.size * pop, g.rot, tilt + 0.2, al);
                const flash = decay(t, 14.0 + i * 0.22, 3);
                drawGlow(ctx, px, py, 50 * u, col, flash * 0.9);
                const arrowK = smooth(15.2, 16.6, t) * al;
                if (arrowK > 0) {
                  const L = g.v * scaleR * 0.55 * (1 + 1.5 * finale);
                  drawArrow(
                    ctx,
                    px + Math.cos(g.ang) * 28 * u,
                    py + Math.sin(g.ang) * 28 * u * tilt,
                    px + Math.cos(g.ang) * (28 * u + L * arrowK),
                    py + Math.sin(g.ang) * (28 * u + L * arrowK) * tilt,
                    `rgba(${col[0]},${col[1] | 0},${col[2] | 0},${0.9 * arrowK})`,
                    3 * u,
                    12 * u,
                  );
                }
              });
              ctx.restore();
              ctx.save();
              ctx.globalAlpha = fieldA * (1 - finale);
              ctx.font = font(22 * u, 500);
              ctx.fillStyle = 'rgba(150,215,255,0.95)';
              ctx.textAlign = 'center';
              ctx.fillText('银河系（我们）', fx, fy + 52 * u);
              ctx.restore();
            }

            if (aG > 0) {
              ctx.save();
              ctx.globalAlpha = aG;
              const axisK = easeOutCubic(clamp((t - 13.4) / 0.9));
              ctx.strokeStyle = 'rgba(190,215,255,0.8)';
              ctx.lineWidth = 2 * u;
              ctx.beginPath();
              ctx.moveTo(G.x, G.y + G.h - G.h * axisK);
              ctx.lineTo(G.x, G.y + G.h);
              ctx.lineTo(G.x + G.w * axisK, G.y + G.h);
              ctx.stroke();
              ctx.strokeStyle = 'rgba(190,215,255,0.1)';
              ctx.lineWidth = 1;
              for (let i = 1; i <= 4; i++) {
                ctx.beginPath();
                ctx.moveTo(G.x, G.y + G.h - (G.h * i) / 4.4);
                ctx.lineTo(G.x + G.w * axisK, G.y + G.h - (G.h * i) / 4.4);
                ctx.stroke();
              }
              ctx.globalCompositeOperation = 'lighter';
              const F = fieldGalaxies();
              F.forEach((g, i) => {
                const pop = easeOutBack(clamp((t - (14.0 + i * 0.22)) / 0.4));
                if (pop <= 0) return;
                const px = G.x + g.d * G.w * 0.95;
                const py = G.y + G.h - g.v * G.h * 0.88;
                const col = redshiftColor(g.d);
                drawGlow(ctx, px, py, 22 * u * pop, col, 0.9);
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(px, py, 4.5 * u * clamp(pop), 0, Math.PI * 2);
                ctx.fill();
              });
              // Fit line.
              const lineK = easeInOutCubic(clamp((t - 17.3) / 1.4));
              if (lineK > 0) {
                const x0 = G.x;
                const y0 = G.y + G.h;
                const x1 = G.x + G.w * 0.98 * lineK;
                const y1 = G.y + G.h - G.h * 0.9 * 1.03 * lineK;
                const grad = ctx.createLinearGradient(x0, y0, G.x + G.w, G.y);
                grad.addColorStop(0, 'rgba(255,230,160,0.95)');
                grad.addColorStop(1, 'rgba(255,90,70,0.95)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 4 * u;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
                drawGlow(ctx, x1, y1, 40 * u, [255, 180, 120], 0.8 * (1 - lineK * 0.5));
              }
              ctx.restore();
            }

            bloom2(ctx, w, h, 0.55 + finale * 0.5 + decay(t, 22, 2) * 0.6);
          }}
        />
      </Shake>

      {/* Graph labels (DOM for crisp type). */}
      <div style={{position: 'absolute', inset: 0, opacity: aG}}>
        <div
          style={{
            position: 'absolute',
            left: G.x,
            top: G.y - 50 * u,
            fontFamily: SANS,
            fontWeight: 300,
            fontSize: 24 * u,
            color: 'rgba(210,225,255,0.9)',
            letterSpacing: '0.1em',
          }}
        >
          退行速度（公里/秒）↑
        </div>
        <div
          style={{
            position: 'absolute',
            left: G.x + G.w,
            top: G.y + G.h + 14 * u,
            transform: 'translateX(-100%)',
            fontFamily: SANS,
            fontWeight: 300,
            fontSize: 24 * u,
            color: 'rgba(210,225,255,0.9)',
            letterSpacing: '0.1em',
          }}
        >
          距离（百万光年）→
        </div>
        <div
          style={{
            position: 'absolute',
            left: G.x + G.w * 0.1,
            top: G.y + G.h * 0.08,
            fontFamily: LATIN,
            fontWeight: 700,
            fontSize: 54 * u,
            color: '#ffe2a8',
            letterSpacing: '0.04em',
            opacity: smooth(18.2, 18.9, frame / fps),
            textShadow: `0 0 ${24 * u}px rgba(255,170,80,0.8)`,
            transform: `scale(${1 + 0.15 * (1 - easeOutCubic(clamp((frame / fps - 18.2) / 0.6)))})`,
            transformOrigin: 'left center',
          }}
        >
          v = H<sub style={{fontSize: '0.55em'}}>0</sub> × d
          <div style={{fontFamily: SANS, fontWeight: 300, fontSize: 22 * u, color: 'rgba(255,230,190,0.85)', letterSpacing: '0.12em', marginTop: 6 * u}}>
            哈勃定律 · H<sub>0</sub> ≈ 70 km/s/Mpc
          </div>
        </div>
      </div>

      <ChapterTag index="01" title="红移" en="REDSHIFT" dur={dur} />
      <Statement from={22.0} to={dur - 0.9} text="宇宙，正在膨胀" theme="red" size={150} slam serif />
      <Captions items={CAPTIONS} />
      <Fade amount={1 - smooth(0, 0.6, t) + smooth(dur - 0.5, dur, t)} />
    </AbsoluteFill>
  );
};
