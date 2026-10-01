import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {ShaderCanvas} from '../components/ShaderCanvas';
import {bloom, drawGlow} from '../lib/canvas';
import {EN, MONO, SERIF, ZH} from '../lib/fonts';
import {DWARF_FS} from '../lib/glsl';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {clamp, easeIn, easeInOut, easeOut, lerp, rng, smoothstep, windowed} from '../lib/math';

const CX = 960;
const CY = 520;
const SQ = 0.42;
const B_IN = 318; // black dwarf close-up
const DECAY = 472; // proton decay begins
const DONE = 650;
const SPX = 0.58 * 1920;
const SPY = 540;
const SPR = 0.3 * 1080;

type Rem = {r: number; a0: number; kind: number; b: number; eject: number; fall: number; dir: number; ph: number; spin: number};
const rems: Rem[] = (() => {
  const r = rng(2024);
  const out: Rem[] = [];
  for (let i = 0; i < 1100; i++) {
    const u = r();
    const kind = u < 0.7 ? 0 : u < 0.706 ? 1 : 2; // white dwarf, pulsar, brown dwarf
    const ev = r();
    out.push({
      r: 70 + Math.pow(r(), 0.8) * 950,
      a0: r() * Math.PI * 2,
      kind,
      b: kind === 1 ? 1.5 : kind === 0 ? 1.0 + r() * 1.8 : 0.3 + r() * 0.3,
      eject: ev < 0.18 ? 120 + r() * 200 : 1e9,
      fall: ev > 0.85 ? 110 + r() * 210 : 1e9,
      dir: r() < 0.5 ? -1 : 1,
      ph: r() * 6.28,
      spin: 0.06 + r() * 0.12,
    });
  }
  return out;
})();

const orbit = (m: Rem, t: number): [number, number, number] => {
  let r = m.r;
  let a = m.a0;
  const w = 26 / Math.pow(r, 1.5);
  if (t > m.fall) {
    const k = easeIn(clamp((t - m.fall) / 70));
    const rr = lerp(m.r, 14, k);
    // integrate angle approximately with growing angular speed
    a += w * m.fall + (26 / Math.pow(Math.max(rr, 14), 1.5)) * (t - m.fall) * 1.4;
    r = rr;
  } else a += w * t;
  let x = CX + Math.cos(a) * r;
  let y = CY + Math.sin(a) * r * SQ;
  let ex = 0;
  if (t > m.eject) {
    const k = t - m.eject;
    const tx = -Math.sin(a) * m.dir;
    const ty = Math.cos(a) * SQ * m.dir;
    const rx = Math.cos(a);
    const ry = Math.sin(a) * SQ;
    const d = 0.06 * k * k + k * 1.5;
    x += (tx * 0.7 + rx * 0.7) * d;
    y += (ty * 0.7 + ry * 0.7) * d;
    ex = k;
  }
  return [x, y, ex];
};

const coolColor = (m: Rem, t: number): [number, number, number] => {
  if (m.kind === 2) return [0.9, 0.3, 0.15];
  if (m.kind === 1) return [0.6, 0.8, 1];
  const c = smoothstep(0, 330, t) * (0.5 + 0.5 * Math.sin(m.ph));
  return [lerp(0.7, 1, c), lerp(0.82, 0.35, c), lerp(1, 0.2, c)];
};

const drawField = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080);
  const cool = 1 - 0.65 * smoothstep(0, 330, t);
  const flashes: [number, number, number][] = [];
  for (const m of rems) {
    const [x, y, ex] = orbit(m, t);
    if (t > m.fall + 70) {
      if (t < m.fall + 80) flashes.push([CX, CY, 1 - (t - m.fall - 70) / 10]);
      continue;
    }
    const col = coolColor(m, t);
    const b = m.b * (m.kind === 0 ? cool : 1) * 1.6;
    if (ex > 0) {
      const [px, py] = orbit(m, t - 3);
      hdr.line(px, py, x, y, col[0] * b * 6, col[1] * b * 6, col[2] * b * 6);
      if (ex < 8) flashes.push([x, y, 1 - ex / 8]);
    } else if (t > m.fall) {
      const [px, py] = orbit(m, t - 2);
      hdr.line(px, py, x, y, col[0] * b * 2.5, col[1] * b * 1.5, col[2] * b * 1.5);
    } else {
      hdr.disc(x, y, 1.4, col[0] * b * 3, col[1] * b * 3, col[2] * b * 3);
    }
  }
  hdr.flush(ctx, 1.2);
  ctx.globalCompositeOperation = 'lighter';
  // pulsar beams
  for (const m of rems) {
    if (m.kind !== 1 || t > m.fall || t > m.eject + 30) continue;
    const [x, y] = orbit(m, t);
    const ang = m.ph + t * m.spin;
    drawGlow(ctx, x, y, 26, [0.6, 0.8, 1], 0.9, 0.2);
    for (const s of [0, Math.PI]) {
      const a = ang + s;
      const len = 120;
      const flash = Math.pow(Math.max(0, Math.cos(a - 1.2)), 30);
      const g = ctx.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.addColorStop(0, `rgba(170,210,255,${0.3 + flash * 0.5})`);
      g.addColorStop(1, 'rgba(170,210,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a - 0.035) * len, y + Math.sin(a - 0.035) * len);
      ctx.lineTo(x + Math.cos(a + 0.035) * len, y + Math.sin(a + 0.035) * len);
      ctx.closePath();
      ctx.fill();
      if (flash > 0.02) drawGlow(ctx, x, y, 90, [0.7, 0.85, 1], flash, 0.1);
    }
  }
  for (const [x, y, k] of flashes) drawGlow(ctx, x, y, 60 + k * 50, [1, 0.85, 0.7], k, 0.1);
  // central black hole: dark disc with a thin photon ring
  drawGlow(ctx, CX, CY, 160, [1, 0.55, 0.25], 0.35, 0.05);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(CX, CY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,130,0.85)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#ffb070';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(CX, CY, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  bloom(ctx, 0.8, 1.4);
};

const decayParts = (() => {
  const r = rng(616);
  const n = 3200;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const ts = new Float32Array(n);
  const sp = new Float32Array(n);
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const rr = Math.sqrt(r()) * SPR;
    const a = r() * Math.PI * 2;
    x[i] = SPX + Math.cos(a) * rr;
    y[i] = SPY + Math.sin(a) * rr;
    ts[i] = DECAY + Math.pow(r(), 0.9) * (DONE - DECAY - 10);
    sp[i] = 2 + r() * 9;
    const k = r();
    kind[i] = k < 0.55 ? 0 : k < 0.85 ? 1 : 2; // photon, positron, neutrino
  }
  return {n, x, y, ts, sp, kind};
})();

const KC: [number, number, number][] = [
  [0.35, 0.85, 1],
  [1, 0.3, 0.8],
  [0.85, 0.85, 0.85],
];

const drawDecay = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080, 'decay');
  const P = decayParts;
  for (let i = 0; i < P.n; i++) {
    const age = t - P.ts[i];
    if (age < 0) continue;
    const dx = P.x[i] - SPX;
    const dy = P.y[i] - SPY;
    const dl = Math.hypot(dx, dy) + 30;
    const ux = dx / dl + Math.sin(i) * 0.4;
    const uy = dy / dl + Math.cos(i * 1.7) * 0.4;
    const d1 = P.sp[i] * age;
    const d0 = P.sp[i] * Math.max(0, age - 5);
    const e = 12 * Math.exp(-age / 80) * (P.kind[i] === 2 ? 0.5 : 1);
    const c = KC[P.kind[i]];
    hdr.line(P.x[i] + ux * d0, P.y[i] + uy * d0, P.x[i] + ux * d1, P.y[i] + uy * d1, c[0] * e, c[1] * e, c[2] * e);
  }
  // the proton diagram
  const px = 360;
  const py = 430;
  const pa = windowed(t, B_IN + 30, 600, 25, 30);
  hdr.flush(ctx, 1.2);
  if (pa > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const k = t - DECAY;
    if (k < 0) {
      drawGlow(ctx, px, py, 220, [1, 0.6, 0.35], pa * 0.6, 0.1);
      const qc: [number, number, number][] = [
        [1, 0.3, 0.25],
        [0.3, 1, 0.4],
        [0.35, 0.5, 1],
      ];
      for (let q = 0; q < 3; q++) {
        const a = t * 0.08 + (q * Math.PI * 2) / 3;
        drawGlow(ctx, px + Math.cos(a) * 34, py + Math.sin(a) * 34, 46, qc[q], pa, 0.25);
      }
    } else {
      drawGlow(ctx, px, py, 500 * Math.exp(-k / 10), [1, 0.9, 0.8], pa * Math.exp(-k / 12), 0.1);
      // e+ flies off, two gamma rays out in opposite directions
      const d = easeOut(clamp(k / 80)) * 260;
      drawGlow(ctx, px - d * 0.6, py - d * 0.8, 50, KC[1], pa, 0.25);
      for (const s of [1, -1]) {
        ctx.strokeStyle = `rgba(110,220,255,${pa * 0.9})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let u = 0; u <= 1; u += 0.02) {
          const along = d * 1.2 * u;
          const wv = Math.sin(u * 40 - k * 0.8) * 7;
          const x = px + s * along * 0.95 + wv * 0.3;
          const y = py + s * along * 0.3 + wv;
          if (u === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        drawGlow(ctx, px + s * d * 1.14, py + s * d * 0.36, 40, KC[0], pa, 0.25);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  bloom(ctx, 0.9, 1.4);
};

const Callout: React.FC<{x: number; y: number; dx: number; dy: number; zh: string; en: string; a: number; color: string}> = ({
  x,
  y,
  dx,
  dy,
  zh,
  en,
  a,
  color,
}) => {
  if (a <= 0) return null;
  const draw = easeOut(a);
  const ex = x + dx * draw;
  const ey = y + dy * draw;
  return (
    <>
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0, opacity: a}}>
        <circle cx={x} cy={y} r={14} stroke={color} fill="none" strokeWidth={1.2} />
        <path d={`M ${x + (dx > 0 ? 10 : -10)} ${y + (dy > 0 ? 10 : -10)} L ${ex} ${ey} L ${ex + (dx > 0 ? 90 : -90)} ${ey}`} stroke={color} fill="none" strokeWidth={1.2} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: dx > 0 ? ex + 8 : undefined,
          right: dx > 0 ? undefined : 1920 - ex + 8,
          top: ey - 40,
          opacity: a,
          textAlign: dx > 0 ? 'left' : 'right',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 24, letterSpacing: '0.2em', color, textShadow: `0 0 14px ${color}`}}>{zh}</div>
        <div style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.35em', color: 'rgba(255,255,255,0.55)', marginTop: 4}}>{en}</div>
      </div>
    </>
  );
};

export const Degenerate: React.FC = () => {
  const t = useCurrentFrame();
  const fieldA = 1 - smoothstep(B_IN, B_IN + 30, t);
  const dwA = smoothstep(B_IN, B_IN + 35, t);
  const dissolve = easeInOut(clamp((t - DECAY) / (DONE - DECAY)));
  const wd = rems.findIndex((m) => m.kind === 0 && m.r > 380 && m.r < 520 && m.eject > 1e8 && m.fall > 1e8 && Math.cos(m.a0 + (26 / Math.pow(m.r, 1.5)) * 100) > 0.5);
  const ns = rems.findIndex((m) => m.kind === 1 && m.r > 250 && m.r < 700 && m.eject > 1e8 && m.fall > 1e8);
  const [wx, wy] = orbit(rems[Math.max(0, wd)], t);
  const [nx, ny] = orbit(rems[Math.max(0, ns)], t);
  const formula = windowed(t, B_IN + 40, 640, 25, 30);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {fieldA > 0 ? (
        <AbsoluteFill style={{opacity: fieldA}}>
          <Canvas2D draw={(ctx, fr) => drawField(ctx, fr)} />
          <Callout x={CX} y={CY} dx={-150} dy={-170} zh={L.blackHole} en="BLACK HOLE" a={windowed(t, 30, 150, 20, 20)} color="#ffb070" />
          <Callout x={wx} y={wy} dx={wx > CX ? 110 : -110} dy={-110} zh={L.whiteDwarf} en="WHITE DWARF" a={windowed(t, 50, 170, 20, 20)} color="#cfe2ff" />
          <Callout x={nx} y={ny} dx={nx > CX ? 110 : -110} dy={110} zh={L.neutron} en="NEUTRON STAR · PULSAR" a={windowed(t, 70, 190, 20, 20)} color="#9fd8ff" />
        </AbsoluteFill>
      ) : null}
      {dwA > 0 ? (
        <AbsoluteFill style={{opacity: dwA}}>
          <ShaderCanvas
            fs={DWARF_FS}
            scale={0.5}
            uniforms={{uC: [0.58, 0.5], uR: 0.3 * (1 + (t - B_IN) * 0.0003), uDissolve: dissolve, uRim: 1.1, uI: 1.2}}
          />
          <Canvas2D draw={(ctx, fr) => drawDecay(ctx, fr)} style={{mixBlendMode: 'screen'}} />
          <Callout x={SPX + 200} y={SPY - 240} dx={140} dy={-60} zh={L.blackDwarf} en="BLACK DWARF · COLD STELLAR CORPSE" a={windowed(t, B_IN + 30, DECAY + 10, 20, 15)} color="#a9bde0" />
          {formula > 0 ? (
            <div style={{position: 'absolute', left: 360, top: 560, transform: 'translateX(-50%)', textAlign: 'center', opacity: formula, whiteSpace: 'nowrap'}}>
              <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 26, letterSpacing: '0.3em', color: '#ffc7e8', textShadow: '0 0 16px #ff4fb0'}}>{L.protonDecay}</div>
              <div style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.4em', color: 'rgba(255,255,255,0.55)', marginTop: 4}}>PROTON DECAY</div>
              <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 34, color: '#fff', marginTop: 18, textShadow: '0 0 18px rgba(150,220,255,0.8)'}}>
                p⁺ → e⁺ + π⁰
              </div>
              <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 28, color: 'rgba(200,235,255,0.9)', marginTop: 8}}>π⁰ → γ + γ</div>
              <div style={{fontFamily: MONO, fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 14, letterSpacing: '0.1em'}}>τ(p) &gt; 2.4 × 10³⁴ yr</div>
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
