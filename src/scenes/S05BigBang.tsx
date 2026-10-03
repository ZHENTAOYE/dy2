import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {CanvasLayer} from '../components/CanvasLayer';
import {Captions} from '../components/Captions';
import {ChapterTag, Flash, Pow10, Readout, Shake} from '../components/Chrome';
import {Statement} from '../components/Statement';
import {SANS} from '../fonts';
import {
  Ctx,
  bloom2,
  chromatic,
  drawGlow,
  drawGodRays,
  drawRing,
  drawStreak,
  font,
  heatColor,
  memo,
} from '../lib/canvas';
import {clamp, decay, easeInOutCubic, easeOutCubic, easeOutExpo, smooth, sup, win} from '../lib/math';
import {makeNoise} from '../lib/noise';
import {mulberry32, sphereDir} from '../lib/rng';
import {drawCover, nebulaTexture} from '../lib/space';

const BANG = 4.0;
const INF_END = 17.7;

const CAPTIONS = [
  {from: 5.6, to: 8.22, text: '宇宙从一个极热、极密的状态中诞生'},
  {from: 9.6, to: 13.68, text: '诞生后约10^{-36}秒，|宇宙经历了一场疯狂的【暴胀】'},
  {from: 14.03, to: 18.86, text: '在不到10^{-32}秒内，|尺度暴涨了至少【10^{26}倍】'},
  {from: 19.21, to: 22.42, text: '相当于一个质子，|瞬间被拉伸到【日地距离】那么大'},
  {from: 22.77, to: 26.82, text: '微小的量子涨落也被急速放大，|成为日后【星系的种子】'},
];

type P = {d: [number, number, number]; v: number; s: number; heat: number};

const particles = () =>
  memo('bang-particles', () => {
    const r = mulberry32(91);
    const out: P[] = [];
    for (let i = 0; i < 5200; i++) out.push({d: sphereDir(r), v: 0.3 + Math.pow(r(), 0.6) * 1.4, s: 0.6 + r() * 2.2, heat: r()});
    return out;
  });

// Cumulative zoom (in "doublings") for the plasma tunnel; accelerates during inflation.
const zoomTrack = (fps: number, frames: number) =>
  memo(`bang-zoom-${fps}-${frames}`, () => {
    const z = new Float64Array(frames + 2);
    for (let i = 1; i < z.length; i++) {
      const t = (i - 1) / fps;
      let v = 0.25;
      if (t > BANG) v = 0.25 + 1.6 * decay(t, BANG, 0.8);
      if (t > 10) v += 3.6 * Math.pow(smooth(10, 17.4, t), 2.2);
      if (t > INF_END) v = 0.12 + 2.5 * decay(t, INF_END, 3);
      z[i] = z[i - 1] + v / fps;
    }
    return z;
  });

// Infinite zoom of a texture: three layers cycling through octaves.
const drawTunnel = (ctx: Ctx, tex: HTMLCanvasElement, w: number, h: number, zoom: number, alpha: number, rot = 0) => {
  for (let i = 0; i < 3; i++) {
    const ph = (((zoom + i / 3) % 1) + 1) % 1;
    const scale = 1.25 * Math.pow(4, ph);
    drawCover(ctx, tex, w, h, scale, rot + i * 2.09, alpha * Math.sin(Math.PI * ph));
  }
};

// Seamless decade grid: the metric of space, zooming by powers of ten.
const drawDecadeGrid = (ctx: Ctx, w: number, h: number, n: number, alpha: number, u: number) => {
  if (alpha <= 0.003) return;
  const f = ((n % 1) + 1) % 1;
  const base = Math.min(w, h) * 0.05;
  const cx = w / 2;
  const cy = h / 2;
  for (const [mult, a] of [
    [Math.pow(10, f), 1 - f],
    [Math.pow(10, f) * 10, 1],
    [Math.pow(10, f) / 10, f * f],
  ] as const) {
    const sp = base * mult;
    if (sp < 4 || a < 0.01) continue;
    const kx = Math.ceil(w / 2 / sp) + 1;
    const ky = Math.ceil(h / 2 / sp) + 1;
    ctx.strokeStyle = `rgba(150,220,255,${clamp(alpha * a * 0.5)})`;
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    for (let i = -kx; i <= kx; i++) {
      ctx.moveTo(cx + i * sp, 0);
      ctx.lineTo(cx + i * sp, h);
    }
    for (let j = -ky; j <= ky; j++) {
      ctx.moveTo(0, cy + j * sp);
      ctx.lineTo(w, cy + j * sp);
    }
    ctx.stroke();
  }
};

// Proton (×10^26) → Sun–Earth distance comparison.
const drawComparison = (ctx: Ctx, w: number, h: number, t: number, alpha: number, u: number) => {
  if (alpha <= 0.003) return;
  const S = Math.min(w, h);
  const cx = w / 2;
  // Landscape sits higher so the distance label clears the caption line.
  const cy = h * (h > w ? 0.46 : 0.43);
  const orbitR = S * 0.33;
  const k = easeInOutCubic(smooth(18.6, 21.0, t));
  // Exponential growth of the proton's radius from a dot to the orbit.
  const pr = 3 * u * Math.pow(orbitR / (3 * u), k);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  // Earth orbit.
  ctx.strokeStyle = 'rgba(140,200,255,0.55)';
  ctx.setLineDash([6 * u, 8 * u]);
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Sun.
  drawGlow(ctx, cx, cy, 70 * u, [255, 200, 90], 0.9);
  drawGlow(ctx, cx, cy, 22 * u, [255, 250, 220], 1);
  // Earth.
  const ea = -0.6 + t * 0.15;
  const ex = cx + Math.cos(ea) * orbitR;
  const ey = cy + Math.sin(ea) * orbitR;
  drawGlow(ctx, ex, ey, 26 * u, [90, 160, 255], 0.9);
  ctx.fillStyle = '#5aa0ff';
  ctx.beginPath();
  ctx.arc(ex, ey, 7 * u, 0, Math.PI * 2);
  ctx.fill();
  // The growing proton sphere.
  const g = ctx.createRadialGradient(cx, cy, pr * 0.2, cx, cy, pr);
  g.addColorStop(0, 'rgba(255,90,140,0.02)');
  g.addColorStop(0.85, 'rgba(255,90,140,0.12)');
  g.addColorStop(1, 'rgba(255,130,170,0.6)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.fill();
  drawRing(ctx, cx, cy, pr, 3 * u + pr * 0.01, [255, 140, 180], 0.9);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font(28 * u, 500);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb3cf';
  ctx.fillText(k < 0.02 ? '质子 ≈ 10⁻¹⁵ 米' : `质子 ×10${sup(Math.round(26 * k))}`, cx, cy - Math.max(40 * u, pr + 18 * u));
  ctx.fillStyle = 'rgba(170,215,255,0.95)';
  ctx.fillText('地球', ex + 50 * u, ey + 8 * u);
  ctx.fillText('太阳', cx, cy + 62 * u);
  ctx.fillStyle = 'rgba(200,225,255,0.8)';
  ctx.font = font(24 * u, 300);
  ctx.fillText('日地距离 ≈ 1.5×10¹¹ 米', cx, cy + orbitR + 50 * u);
  ctx.restore();
};

// Density fluctuations: a living noise field that is stretched and seeds stars.
// Texture follows the frame aspect; noise is normalised by the short side so blobs stay round.
const fluctTexture = (frame: number, portrait: boolean) => {
  const W = portrait ? 108 : 192;
  const H = portrait ? 192 : 108;
  const N = Math.min(W, H);
  const c = memo(`bang-fluct-canvas-${W}x${H}`, () => {
    const el = document.createElement('canvas');
    el.width = W;
    el.height = H;
    return el;
  });
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const n = makeNoise(5);
  const tt = frame / 30;
  const zoom = Math.pow(1.6, -Math.max(0, tt - 22) * 0.45);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x - W / 2) / N) * 9 * zoom;
      const v = ((y - H / 2) / N) * 9 * zoom;
      const val = n.fbm3(u, v, tt * 0.15, 4);
      const k = clamp(val * 1.5 + 0.5);
      const i = (y * W + x) * 4;
      // Diverging map: under-dense blue, over-dense amber, mean dark.
      let r: number, g: number, b: number;
      if (k < 0.5) {
        const m = k * 2;
        r = 30 + (18 - 30) * m;
        g = 70 + (14 - 70) * m;
        b = 170 + (30 - 170) * m;
      } else {
        const m = (k - 0.5) * 2;
        r = 18 + (240 - 18) * m;
        g = 14 + (120 - 14) * m;
        b = 30 + (40 - 30) * m;
      }
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

const seeds = () =>
  memo('bang-seeds', () => {
    const r = mulberry32(93);
    return Array.from({length: 180}, () => ({x: r(), y: r(), t: 23.5 + r() * 3.5, s: 0.5 + r()}));
  });

export const SceneBigBang: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const pre = t < BANG;
  const k = t - BANG;
  const inflation = smooth(10, 17.4, t) * (t < INF_END ? 1 : 0);
  const decadeN = 26 * clamp((t - 13.2) / (17.5 - 13.2));
  const compA = win(t, 17.9, 22.6, 0.5, 0.6);
  const fluctA = smooth(21.9, 23.0, t);
  const shake =
    (pre ? 0.03 * smooth(2.5, 4, t) : 0) +
    1.2 * decay(t, BANG, 1.6) +
    inflation * 0.35 +
    0.8 * decay(t, INF_END, 3);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Shake amount={shake} zoom={inflation * 0.02}>
        <CanvasLayer
          opaque
          draw={(ctx, w, h) => {
            const S = Math.min(w, h);
            const cx = w / 2;
            const cy = h / 2;
            ctx.globalCompositeOperation = 'lighter';
            if (pre) {
              // A single, impossibly dense point.
              const pulse = 0.6 + 0.4 * Math.sin(t * 5.5) * Math.sin(t * 2.1);
              const grow = smooth(2.5, 4.0, t);
              drawGlow(ctx, cx, cy, (10 + 40 * grow) * u * (0.8 + 0.4 * pulse), [255, 240, 220], 0.7 + 0.3 * grow);
              drawGlow(ctx, cx, cy, (3 + 6 * grow) * u, [255, 255, 255], 1);
              drawStreak(ctx, cx, cy, (40 + 600 * grow * grow) * u, (2 + 4 * grow) * u, [180, 210, 255], 0.3 + 0.6 * grow);
              ctx.globalCompositeOperation = 'source-over';
              bloom2(ctx, w, h, 0.6 + grow);
              return;
            }

            const zt = zoomTrack(fps, Math.round(dur * fps) + 2);
            const zoom = zt[frame + 1];
            // Hot plasma everywhere, cooling slowly.
            const cool = smooth(BANG, 26, t);
            const plasma = nebulaTexture(101, 480, 270, {
              palette: [
                [0, 0, 0],
                [50, 6, 12],
                [160, 36, 14],
                [255, 120, 40],
                [255, 225, 170],
              ],
              scale: 2.6,
              warp: 2.4,
              contrast: 2.3,
              blur: 0.8,
            });
            const fire = easeOutExpo(clamp(k / 2.2));
            const fireR = S * 2.0 * fire;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(1, fireR), 0, Math.PI * 2);
            ctx.clip();
            drawTunnel(ctx, plasma, w, h, zoom, (0.62 - 0.22 * cool) * (1 - fluctA * 0.8) * (1 - 0.55 * compA), zoom * 0.05);
            ctx.restore();
            if (fire < 0.999) drawRing(ctx, cx, cy, fireR, S * 0.06, [255, 230, 190], 1 - fire);

            // Inflation: decade grid + speed lines.
            const gridA = smooth(12.6, 13.6, t) * (1 - smooth(INF_END - 0.1, INF_END + 0.6, t));
            drawDecadeGrid(ctx, w, h, zoom * 0.55, gridA, u);
            if (inflation > 0.01) {
              const r = mulberry32(frame);
              ctx.lineCap = 'round';
              const lines = Math.floor(80 + 260 * inflation);
              for (let i = 0; i < lines; i++) {
                const a = r() * Math.PI * 2;
                const r0 = S * (0.05 + r() * 0.6);
                const L = S * (0.1 + 0.9 * inflation) * (0.3 + r());
                ctx.strokeStyle = `rgba(255,${200 + 55 * r()},${170 + 85 * r()},${0.08 + 0.35 * inflation})`;
                ctx.lineWidth = (0.8 + 2 * r()) * u;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
                ctx.lineTo(cx + Math.cos(a) * (r0 + L), cy + Math.sin(a) * (r0 + L));
                ctx.stroke();
              }
              drawGlow(ctx, cx, cy, S * (0.06 + 0.16 * inflation), [255, 240, 220], 0.3 + 0.4 * inflation, 3);
            }

            // The explosion itself.
            if (k < 7) {
              const P = particles();
              const kk = Math.max(0, k);
              for (const p of P) {
                const travel = (1 - Math.exp(-kk * 1.6)) * p.v * 2.4 + kk * 0.05;
                const prev = (1 - Math.exp(-Math.max(0, kk - 0.05) * 1.6)) * p.v * 2.4 + Math.max(0, kk - 0.05) * 0.05;
                const zz = 1.25 - p.d[2] * 0.9 * Math.min(1, travel);
                if (zz <= 0.05) continue;
                const x1 = cx + ((p.d[0] * travel) / zz) * S * 0.6;
                const y1 = cy + ((p.d[1] * travel) / zz) * S * 0.6;
                const x0 = cx + ((p.d[0] * prev) / zz) * S * 0.6;
                const y0 = cy + ((p.d[1] * prev) / zz) * S * 0.6;
                const a = clamp(1 - kk / 6.5) * clamp(kk * 8);
                if (a <= 0.01) continue;
                const c = heatColor(clamp(1 - kk * 0.12 - p.heat * 0.35));
                ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
                ctx.lineWidth = (p.s / zz) * u;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
              }
              const rays = decay(t, BANG, 0.45);
              drawGodRays(ctx, cx, cy, S * 1.3, 64, k * 0.05, rays * 0.5, [255, 240, 220], 3);
              for (const [delay, speed, col] of [
                [0, 1.6, [255, 255, 255]],
                [0.15, 1.1, [255, 210, 150]],
                [0.4, 0.75, [180, 210, 255]],
              ] as const) {
                const rk = easeOutCubic(clamp((k - delay) / speed));
                if (k > delay) drawRing(ctx, cx, cy, rk * S * 1.4, S * 0.03 * (1 - rk) + 3, col as unknown as [number, number, number], (1 - rk) * 0.9);
              }
              const core = decay(t, BANG, 1.4);
              drawGlow(ctx, cx, cy, S * (0.06 + 0.25 * core), [255, 250, 240], core, 3.5);
              drawStreak(ctx, cx, cy, w * (0.3 + 0.7 * core), S * 0.015 + 2, [170, 210, 255], core);
            }

            // Inflation ends: a flash and a ring of light.
            if (t > INF_END - 0.05 && t < INF_END + 2.5) {
              const e = t - INF_END;
              const rk = easeOutCubic(clamp(e / 1.4));
              drawRing(ctx, cx, cy, rk * S * 1.2, S * 0.04 * (1 - rk) + 3, [255, 240, 220], (1 - rk) * 0.9);
              drawGlow(ctx, cx, cy, S * 0.35, [255, 230, 200], decay(t, INF_END, 3) * 0.5);
            }

            // Fluctuations map takes over, stretched; seeds light up.
            if (fluctA > 0) {
              ctx.globalCompositeOperation = 'source-over';
              ctx.save();
              ctx.globalAlpha = fluctA * 0.9;
              ctx.imageSmoothingEnabled = true;
              const tex = fluctTexture(frame, h > w);
              const sc = 1.05 + (t - 22) * 0.04;
              // Blur in proportion to the upscaled texel to hide bilinear stair-steps.
              ctx.filter = `blur(${((w * sc) / tex.width) * 0.6}px)`;
              ctx.drawImage(tex, cx - (w * sc) / 2, cy - (h * sc) / 2, w * sc, h * sc);
              ctx.filter = 'none';
              ctx.restore();
              // Soft dark band behind the caption so it reads over bright amber blobs.
              const sa = 0.55 * fluctA * (1 - smooth(dur - 0.6, dur, t));
              const bc = h > w ? h * 0.84 - 75 * u : h * 0.9 - 34.5 * u;
              const bh = (h > w ? 230 : 150) * u;
              const sg = ctx.createLinearGradient(0, bc - bh, 0, bc + bh);
              for (const [o, m] of [[0, 0], [0.25, 0.7], [0.5, 1], [0.75, 0.7], [1, 0]]) sg.addColorStop(o, `rgba(2,4,12,${m * sa})`);
              ctx.fillStyle = sg;
              ctx.fillRect(0, bc - bh, w, 2 * bh);
              ctx.globalCompositeOperation = 'lighter';
              for (const sd of seeds()) {
                const a = smooth(sd.t, sd.t + 0.4, t);
                if (a <= 0) continue;
                const fl = decay(t, sd.t, 3);
                const x = cx + (sd.x - 0.5) * w * (1.05 + (t - 22) * 0.04);
                const y = cy + (sd.y - 0.5) * h * (1.05 + (t - 22) * 0.04);
                drawGlow(ctx, x, y, (10 + 30 * fl) * u * sd.s, [255, 240, 210], a * 0.8 * fluctA);
              }
            }
            ctx.globalCompositeOperation = 'source-over';
            bloom2(ctx, w, h, 0.45 + 0.6 * decay(t, BANG, 1.5) + inflation * 0.3 + decay(t, INF_END, 2) * 0.4);
            chromatic(ctx, w, h, 40 * decay(t, BANG, 1.5) + inflation * 12 + 22 * decay(t, INF_END, 3));
          }}
        />
        {/* Unmounted when hidden: a transparent canvas that is only cleared can show its last
            drawing in a full render (seen as the ring flickering back during t≈22.7–27). */}
        {compA > 0.003 ? (
          <CanvasLayer
            draw={(ctx, w, h) => {
              drawComparison(ctx, w, h, t, compA, u);
            }}
          />
        ) : null}
      </Shake>

      <Statement from={0.6} to={3.3} text="138亿年前" theme="white" size={96} serif y={0.3} />
      {/* Inflation HUD */}
      <Readout
        backdrop
        label="宇宙诞生后"
        value={<Pow10 exp={t < 13.2 ? -36 : -36 + Math.round(4 * clamp((t - 13.2) / 4.3))} suffix=" 秒" />}
        x={0.06}
        y={0.27}
        size={60}
        opacity={win(t, 10.2, INF_END + 0.6, 0.5, 0.4)}
      />
      <Readout
        backdrop
        label="空间尺度"
        value={<Pow10 prefix="×" exp={Math.floor(decadeN)} />}
        x={0.94}
        y={0.27}
        align="right"
        size={84}
        color="#ffd27a"
        opacity={win(t, 13.0, INF_END + 1.2, 0.4, 0.5)}
      />
      {fluctA > 0 ? (
        <div
          style={{
            position: 'absolute',
            // Plate padding grows outward; the text keeps its old anchor (6% / 24%).
            right: width * 0.06 - 14 * u,
            top: height * 0.24 - 12 * u,
            padding: `${12 * u}px ${14 * u}px ${12 * u}px ${18 * u}px`,
            borderRadius: 8 * u,
            background: 'rgba(4,8,22,0.6)',
            fontFamily: SANS,
            fontWeight: 300,
            fontSize: 26 * u,
            color: 'rgba(235,240,255,0.95)',
            letterSpacing: '0.2em',
            opacity: smooth(22.6, 23.4, t) * (1 - smooth(dur - 0.6, dur, t)),
            textShadow: `0 ${2 * u}px ${8 * u}px rgba(0,0,0,0.9)`,
            textAlign: 'right',
          }}
        >
          原初密度涨落（示意）
          <div style={{fontSize: 22 * u, marginTop: 8 * u, color: 'rgba(225,232,250,0.9)'}}>
            <span style={{color: 'rgb(245,140,60)'}}>■</span> 稍密　<span style={{color: 'rgb(80,130,255)'}}>■</span> 稍疏
          </div>
        </div>
      ) : null}
      <ChapterTag index="04" title="大爆炸与暴胀" en="THE BIG BANG & INFLATION" dur={dur} />
      <Captions items={CAPTIONS} />
      <Flash amount={decay(t, BANG - 0.03, 5) * 1.1 + decay(t, INF_END - 0.03, 6) * 0.7} />
      {/* No fade-out: Main crossfades this scene into the CMB plasma (XFADE_IN.cmb). */}
    </AbsoluteFill>
  );
};
