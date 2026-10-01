import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {bloom, drawGlow} from '../lib/canvas';
import {EN, MONO, SERIF, ZH} from '../lib/fonts';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {bounce, clamp, easeInOut, easeOut, easeOutExpo, gauss, lerp, rng, smoothstep, windowed} from '../lib/math';
import {starfieldPoints, starfieldSprites} from '../lib/starfield';

const BX0 = 410;
const BX1 = 1510;
const BY0 = 230;
const BY1 = 790;
const BW = BX1 - BX0;
const BH = BY1 - BY0;
const MID = (BX0 + BX1) / 2;
const CY = (BY0 + BY1) / 2;
const REL = 175;
const B0 = 430; // phase B start
const MIX = 520; // equilibration start
const K = 0.026;
const C0 = 705; // zoom out
const HD = 835; // heat death word

// ---- Phase A gas ----
const gas = (() => {
  const r = rng(5);
  const n = 1600;
  const x0 = new Float32Array(n);
  const y0 = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = i % 32;
    const row = Math.floor(i / 32);
    x0[i] = 22 + (c / 31) * 236;
    y0[i] = 22 + (row / 49) * (BH - 44);
    vx[i] = gauss(r) * 4.2;
    vy[i] = gauss(r) * 4.2;
    ph[i] = r() * 100;
  }
  return {n, x0, y0, vx, vy, ph};
})();

const gasPos = (i: number, t: number): [number, number] => {
  if (t <= REL) {
    const w = 0.9;
    return [BX0 + gas.x0[i] + Math.sin(t * 0.4 + gas.ph[i]) * w, BY0 + gas.y0[i] + Math.cos(t * 0.37 + gas.ph[i] * 1.3) * w];
  }
  const dt = t - REL;
  return [BX0 + bounce(gas.x0[i] + gas.vx[i] * dt, BW), BY0 + bounce(gas.y0[i] + gas.vy[i] * dt, BH)];
};

const entropyOf = (t: number) => {
  const gx = 22;
  const gy = 11;
  const cnt = new Float32Array(gx * gy);
  for (let i = 0; i < gas.n; i++) {
    const [x, y] = gasPos(i, t);
    const cx = Math.min(gx - 1, Math.floor(((x - BX0) / BW) * gx));
    const cy = Math.min(gy - 1, Math.floor(((y - BY0) / BH) * gy));
    cnt[cy * gx + cx]++;
  }
  let s = 0;
  for (let k = 0; k < cnt.length; k++) {
    if (cnt[k] > 0) {
      const p = cnt[k] / gas.n;
      s -= p * Math.log(p);
    }
  }
  return s / Math.log(gx * gy);
};
const S0 = entropyOf(0);

// ---- Phase B: two chambers ----
const dT = (t: number) => (t < MIX ? 1 : Math.exp(-K * (t - MIX)));
const speedInt = (() => {
  const hot = new Float32Array(1000);
  const cold = new Float32Array(1000);
  const ang = new Float32Array(1000);
  for (let t = 1; t < 1000; t++) {
    const d = dT(t);
    hot[t] = hot[t - 1] + (t >= B0 ? Math.sqrt((500 + 400 * d) / 500) : 0);
    cold[t] = cold[t - 1] + (t >= B0 ? Math.sqrt((500 - 400 * d) / 500) : 0);
    ang[t] = ang[t - 1] + (t >= B0 ? 0.22 * d * smoothstep(B0, B0 + 40, t) : 0);
  }
  return {hot, cold, ang};
})();
const cham = (() => {
  const r = rng(77);
  const n = 1400;
  const x0 = new Float32Array(n);
  const y0 = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x0[i] = r() * (BW / 2 - 8);
    y0[i] = r() * BH;
    vx[i] = gauss(r) * 4.5;
    vy[i] = gauss(r) * 4.5;
  }
  return {n, x0, y0, vx, vy};
})();
const chamPos = (i: number, t: number): [number, number] => {
  const hot = i < cham.n / 2;
  const tf = Math.min(999, Math.max(0, Math.floor(t)));
  const s = (hot ? speedInt.hot : speedInt.cold)[tf];
  const half = BW / 2 - 8;
  const x = bounce(cham.x0[i] + cham.vx[i] * s, half);
  const y = bounce(cham.y0[i] + cham.vy[i] * s, BH);
  return [hot ? BX0 + x : MID + 8 + x, BY0 + y];
};

const neutral: [number, number, number] = [0.6, 0.55, 0.72];
const hotC: [number, number, number] = [1, 0.28, 0.06];
const coldC: [number, number, number] = [0.2, 0.52, 1];
const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

const strokeBox = (ctx: CanvasRenderingContext2D, t: number, alpha: number, color: string) => {
  const p = easeInOut(clamp((t - 8) / 45));
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  const per = 2 * (BW + BH);
  let rem = per * p;
  const pts: [number, number][] = [
    [BX0, BY0],
    [BX1, BY0],
    [BX1, BY1],
    [BX0, BY1],
    [BX0, BY0],
  ];
  ctx.moveTo(BX0, BY0);
  for (let k = 1; k < pts.length && rem > 0; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const seg = Math.hypot(bx - ax, by - ay);
    const u = Math.min(1, rem / seg);
    ctx.lineTo(ax + (bx - ax) * u, ay + (by - ay) * u);
    rem -= seg;
  }
  ctx.stroke();
  // corner brackets
  ctx.lineWidth = 4;
  const c = 26;
  for (const [x, y, sx, sy] of [
    [BX0, BY0, 1, 1],
    [BX1, BY0, -1, 1],
    [BX1, BY1, -1, -1],
    [BX0, BY1, 1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x - sx * 12, y + sy * c);
    ctx.lineTo(x - sx * 12, y - sy * 12);
    ctx.lineTo(x + sx * c, y - sy * 12);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

const drawWheel = (ctx: CanvasRenderingContext2D, ang: number, glow: number, alpha: number) => {
  ctx.save();
  ctx.translate(MID, CY);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, 0, 0, 380, [1, 0.75, 0.45], glow * 0.55, 0.1);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = `rgba(255,${Math.round(200 + 55 * (1 - glow))},${Math.round(160 + 95 * (1 - glow))},0.95)`;
  ctx.shadowColor = 'rgba(255,180,120,0.9)';
  ctx.shadowBlur = 10 + glow * 20;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = ang + (k * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
    ctx.quadraticCurveTo(Math.cos(a + 0.35) * 50, Math.sin(a + 0.35) * 50, Math.cos(a + 0.2) * 72, Math.sin(a + 0.2) * 72);
    ctx.stroke();
  }
  ctx.restore();
};

const draw = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080);
  const zoomK = easeInOut(clamp((t - C0) / 95));
  const s = lerp(1, 0.012, zoomK);
  // universe around the box
  const uni = smoothstep(C0, C0 + 80, t);
  let bright: ReturnType<typeof starfieldPoints> = [];
  if (uni > 0) {
    const warp = easeOutExpo(clamp((t - 868) / 32));
    const z = 0.6 + 0.4 * uni + warp * 3;
    const zp = 0.6 + 0.4 * smoothstep(C0, C0 + 80, t - 1) + easeOutExpo(clamp((t - 869) / 32)) * 3;
    bright = starfieldPoints(hdr, {seed: 23, n: 3000, f: t, zoom: z, prevZoom: zp, alpha: uni});
  }
  const toS = (x: number, y: number): [number, number] => [960 + (x - 960) * s, CY + (y - CY) * s];

  // Phase A
  const aA = 1 - smoothstep(B0, B0 + 25, t);
  if (aA > 0) {
    const released = t > REL;
    const heat = released ? 1 : 1.25;
    for (let i = 0; i < gas.n; i++) {
      const [x, y] = gasPos(i, t);
      const [xp, yp] = gasPos(i, t - 1.6);
      const k = aA * heat;
      const col: [number, number, number] = [1, 0.72, 0.38];
      const [sx, sy] = toS(x, y);
      if (released && Math.hypot(x - xp, y - yp) < 30) {
        const [px, py] = toS(xp, yp);
        hdr.line(px, py, sx, sy, col[0] * k * 9, col[1] * k * 9, col[2] * k * 9);
      } else {
        hdr.disc(sx, sy, 1.8, col[0] * k * 6, col[1] * k * 6, col[2] * k * 6);
      }
    }
  }
  // Phase B
  const aB = smoothstep(B0 + 5, B0 + 35, t);
  const d = dT(t);
  if (aB > 0) {
    for (let i = 0; i < cham.n; i++) {
      const hot = i < cham.n / 2;
      const [x, y] = chamPos(i, t);
      const [xp, yp] = chamPos(i, t - 1.6);
      const col = mix3(neutral, hot ? hotC : coldC, d);
      const k = aB * 1.5;
      const [sx, sy] = toS(x, y);
      if (Math.hypot(x - xp, y - yp) < 30 && Math.hypot(x - xp, y - yp) > 0.5) {
        const [px, py] = toS(xp, yp);
        hdr.line(px, py, sx, sy, col[0] * k * 8, col[1] * k * 8, col[2] * k * 8);
      } else hdr.disc(sx, sy, 1.8, col[0] * k * 5, col[1] * k * 5, col[2] * k * 5);
    }
    // heat flow stream through the wheel
    const flow = aB * d * (1 - zoomK);
    if (flow > 0.01) {
      for (let k = 0; k < 220; k++) {
        const u = (k * 0.6180339 + t * 0.011) % 1;
        const x = lerp(MID - 330, MID + 330, u);
        const y = CY + Math.sin(u * 9 + k) * 50 * Math.sin(u * Math.PI) + Math.sin(k * 7.1) * 10;
        const col = mix3(hotC, coldC, u);
        const a = flow * Math.sin(u * Math.PI) * 14;
        hdr.disc(x, y, 2.6, col[0] * a, col[1] * a, col[2] * a);
      }
    }
  }
  hdr.flush(ctx, 1);
  if (bright.length) starfieldSprites(ctx, bright);

  // box + chrome, scaled for the zoom-out
  ctx.save();
  ctx.translate(960, CY);
  ctx.scale(s, s);
  ctx.translate(-960, -CY);
  const boxA = 1 - smoothstep(C0 + 40, C0 + 90, t);
  strokeBox(ctx, t, 0.85 * boxA, t < B0 ? '#9fd8ff' : '#c9c3ff');
  if (t < REL + 12) {
    const fl = t > REL ? 1 - (t - REL) / 12 : 1;
    const a = smoothstep(20, 60, t) * fl;
    ctx.globalAlpha = a;
    ctx.strokeStyle = t > REL ? '#ffffff' : '#ffd29a';
    ctx.shadowColor = '#ffb070';
    ctx.shadowBlur = t > REL ? 40 : 14;
    ctx.lineWidth = t > REL ? 6 : 2;
    ctx.beginPath();
    ctx.moveTo(BX0 + 280, BY0);
    ctx.lineTo(BX0 + 280, BY1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  if (aB > 0) {
    ctx.globalAlpha = aB * boxA;
    ctx.strokeStyle = '#c9c3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MID, BY0);
    ctx.lineTo(MID, CY - 95);
    ctx.moveTo(MID, CY + 95);
    ctx.lineTo(MID, BY1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawWheel(ctx, speedInt.ang[Math.min(999, Math.max(0, Math.floor(t)))], d * aB, aB * boxA);
  }
  ctx.restore();

  if (uni > 0 && t < 905) {
    // the box collapsing into a single point of light
    ctx.globalCompositeOperation = 'lighter';
    const p = smoothstep(C0 + 50, C0 + 95, t) * (1 - smoothstep(860, 900, t));
    drawGlow(ctx, 960, CY, 60, [0.7, 0.65, 0.9], p, 0.15);
    ctx.globalCompositeOperation = 'source-over';
  }
  bloom(ctx, 0.75, 1.5);
};

const Label: React.FC<{x: number; y: number; zh: string; en: string; a: number; color?: string; align?: 'left' | 'center' | 'right'}> = ({
  x,
  y,
  zh,
  en,
  a,
  color = '#ffd8a8',
  align = 'left',
}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      opacity: a,
      transform: `translateX(${align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0'})`,
      textAlign: align,
      whiteSpace: 'nowrap',
    }}
  >
    <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 30, letterSpacing: '0.2em', color, textShadow: `0 0 18px ${color}`}}>{zh}</div>
    <div style={{fontFamily: EN, fontWeight: 500, fontSize: 13, letterSpacing: '0.35em', color: 'rgba(255,255,255,0.55)', marginTop: 4}}>{en}</div>
  </div>
);

const Meter: React.FC<{t: number}> = ({t}) => {
  const a = windowed(t, 40, B0 + 10, 30, 25);
  if (a <= 0) return null;
  const s = entropyOf(t);
  const fill = clamp(0.08 + ((s - S0) / (1 - S0)) * 0.92);
  const H = 520;
  return (
    <div style={{position: 'absolute', left: 1585, top: 250, opacity: a}}>
      <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 40, color: '#fff', textShadow: '0 0 16px #9fd8ff'}}>
        {L.entropy} <span style={{fontFamily: EN, fontWeight: 300, fontStyle: 'italic'}}>S</span>
      </div>
      <div style={{position: 'relative', marginTop: 16, width: 18, height: H, border: '1px solid rgba(159,216,255,0.5)', borderRadius: 9}}>
        <div
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            bottom: 2,
            height: (H - 4) * fill,
            borderRadius: 7,
            background: 'linear-gradient(0deg, #3a7bff, #9fd8ff 60%, #ffffff)',
            boxShadow: '0 0 24px rgba(120,190,255,0.9)',
          }}
        />
      </div>
      <div style={{fontFamily: MONO, fontSize: 22, color: '#bfe4ff', marginTop: 12}}>{(fill * 100).toFixed(1)}%</div>
    </div>
  );
};

const Thermo: React.FC<{t: number}> = ({t}) => {
  const a = windowed(t, B0 + 10, C0 + 40, 30, 30);
  if (a <= 0) return null;
  const d = dT(t);
  const th = Math.round(500 + 400 * d);
  const tc = Math.round(500 - 400 * d);
  const eq = smoothstep(650, 680, t);
  const hc = `rgb(${Math.round(lerp(190, 255, d))},${Math.round(lerp(175, 110, d))},${Math.round(lerp(230, 60, d))})`;
  const cc = `rgb(${Math.round(lerp(190, 90, d))},${Math.round(lerp(175, 160, d))},${Math.round(lerp(230, 255, d))})`;
  const val = (v: number, c: string) => (
    <div style={{fontFamily: MONO, fontWeight: 700, fontSize: 46, color: c, textShadow: `0 0 20px ${c}`, marginTop: 4}}>
      {v}
      <span style={{fontSize: 24, marginLeft: 6}}>K</span>
    </div>
  );
  return (
    <div style={{position: 'absolute', inset: 0, opacity: a}}>
      <div style={{position: 'absolute', left: BX0, top: BY0 - 110}}>
        <div style={{fontFamily: ZH, fontSize: 24, letterSpacing: '0.2em', color: hc}}>
          {L.hot} <span style={{fontFamily: EN, fontSize: 13, letterSpacing: '0.3em', opacity: 0.7}}>HOT</span>
        </div>
        {val(th, hc)}
      </div>
      <div style={{position: 'absolute', left: BX1, top: BY0 - 110, transform: 'translateX(-100%)', textAlign: 'right'}}>
        <div style={{fontFamily: ZH, fontSize: 24, letterSpacing: '0.2em', color: cc}}>
          <span style={{fontFamily: EN, fontSize: 13, letterSpacing: '0.3em', opacity: 0.7}}>COLD</span> {L.cold}
        </div>
        {val(tc, cc)}
      </div>
      <div style={{position: 'absolute', left: MID, top: BY0 - 92, transform: 'translateX(-50%)', textAlign: 'center', opacity: 1 - eq}}>
        <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 28, letterSpacing: '0.3em', color: '#ffd29a', textShadow: '0 0 16px #ff9c50'}}>
          {L.work} <span style={{fontFamily: EN, fontStyle: 'italic', fontWeight: 300}}>W</span>
        </div>
        <div style={{fontFamily: MONO, fontSize: 20, color: '#ffd29a', marginTop: 6}}>Q → W</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: MID,
          top: BY0 - 96,
          transform: `translateX(-50%) scale(${1.3 - 0.3 * easeOut(eq)})`,
          textAlign: 'center',
          opacity: eq,
        }}
      >
        <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 30, letterSpacing: '0.3em', color: '#d9d4ff', textShadow: '0 0 18px #9a8cff'}}>
          {L.equilibrium}
        </div>
        <div style={{fontFamily: MONO, fontSize: 22, color: '#d9d4ff', marginTop: 6}}>ΔT = 0 · W = 0</div>
      </div>
    </div>
  );
};

const HeatDeathWord: React.FC<{t: number}> = ({t}) => {
  const k = t - HD;
  if (k < 0) return null;
  const e = easeOutExpo(k / 22);
  const out = smoothstep(42, 64, k);
  return (
    <AbsoluteFill style={{opacity: (1 - out) * clamp(k / 3), filter: `blur(${(1 - e) * 16 + out * 10}px)`}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 340,
          textAlign: 'center',
          fontFamily: SERIF,
          fontWeight: 900,
          fontSize: 210,
          letterSpacing: `${0.3 + (1 - e) * 0.4}em`,
          paddingLeft: `${0.3 + (1 - e) * 0.4}em`,
          color: '#e9f2ff',
          transform: `scale(${1.25 - 0.25 * e + k * 0.002})`,
          textShadow: '0 0 40px rgba(140,190,255,0.7), 0 0 100px rgba(80,140,255,0.45)',
        }}
      >
        {L.heatDeath}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 620,
          textAlign: 'center',
          fontFamily: EN,
          fontWeight: 300,
          fontSize: 26,
          letterSpacing: '0.8em',
          paddingLeft: '0.8em',
          color: 'rgba(220,235,255,0.85)',
          opacity: easeOut((k - 6) / 20),
        }}
      >
        HEAT DEATH
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 690,
          textAlign: 'center',
          fontFamily: ZH,
          fontWeight: 300,
          fontSize: 26,
          letterSpacing: '0.25em',
          color: 'rgba(200,220,255,0.7)',
          opacity: easeOut((k - 12) / 20),
        }}
      >
        {L.heatDeathDef}
      </div>
    </AbsoluteFill>
  );
};

export const Entropy: React.FC = () => {
  const t = useCurrentFrame();
  const law = windowed(t, 300, 428, 18, 18);
  const lowA = windowed(t, 50, REL + 10, 25, 12);
  const highA = windowed(t, 330, B0 + 5, 25, 20);
  const lawE = easeOutExpo(clamp((t - 300) / 25));
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Canvas2D draw={(ctx, fr) => draw(ctx, fr)} />
      <Label x={BX0 + 140} y={BY0 - 92} zh={L.lowS} en="LOW ENTROPY · ORDER" a={lowA} align="center" />
      <Label x={BX1} y={BY0 - 92} zh={L.highS} en="HIGH ENTROPY · DISORDER" a={highA} color="#bfe4ff" align="right" />
      <Meter t={t} />
      <Thermo t={t} />
      {law > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 60,
            textAlign: 'center',
            opacity: law,
            transform: `scale(${1.2 - 0.2 * lawE})`,
            filter: `blur(${(1 - lawE) * 10}px)`,
            fontFamily: SERIF,
            fontWeight: 900,
            fontSize: 110,
            color: '#fff',
            letterSpacing: '0.12em',
            textShadow: '0 0 30px rgba(255,190,120,0.8), 0 0 80px rgba(255,140,60,0.5)',
          }}
        >
          ΔS ≥ 0
        </div>
      ) : null}
      <HeatDeathWord t={t} />
    </AbsoluteFill>
  );
};
