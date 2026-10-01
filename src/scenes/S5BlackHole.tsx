import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {ShaderCanvas} from '../components/ShaderCanvas';
import {burstPoints, ring} from '../lib/burst';
import {bloom, drawGlow, drawSpikes} from '../lib/canvas';
import {EN, MONO, ZH} from '../lib/fonts';
import {BLACKHOLE_FS, NEBULA_FS} from '../lib/glsl';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {clamp, easeIn, easeInOut, easeOut, easeOutExpo, lerp, noise1, rng, smoothstep, tempColor, windowed} from '../lib/math';

const DISK_OFF = 330;
const EVAP = 460;
const BOOM = 920;
const FOCAL = 1.55;

const tauAt = (t: number) => clamp((t - EVAP) / (BOOM - EVAP));
const massAt = (t: number) => Math.max(0.0035, Math.pow(1 - tauAt(t), 1 / 3));
const camAt = (t: number) => lerp(38, 19, easeOut(clamp(t / 330))) - 2 * easeInOut(clamp((t - 330) / 200)) - 5 * easeInOut(clamp((t - EVAP) / 460));
const hawkCol = (t: number) => {
  const T = 1 / massAt(t);
  return tempColor(clamp(Math.log10(T) / 1.4));
};
const hawkI = (t: number) => (t < EVAP ? 0 : Math.min(40, 0.22 * Math.pow(1 / massAt(t), 1.25)) * smoothstep(EVAP, EVAP + 40, t));
const shadowPx = (t: number) => ((2.6 * massAt(t)) / camAt(t)) * FOCAL * 1080;

const sparks = (() => {
  const r = rng(4242);
  const n = 3000;
  const b = new Float32Array(n);
  const a = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = EVAP + 40 + (BOOM - EVAP - 40) * Math.pow(r(), 0.4);
    a[i] = r() * Math.PI * 2;
    v[i] = 3 + r() * 9;
  }
  return {n, b, a, v};
})();

const drawOverlay = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080, 'bh');
  const k = t - BOOM;
  if (t >= EVAP && t < BOOM + 2) {
    const S = sparks;
    for (let i = 0; i < S.n; i++) {
      const age = t - S.b[i];
      if (age < 0 || age > 90) continue;
      const r0 = shadowPx(S.b[i]) * 0.95;
      const sp = S.v[i] * (0.6 + 1.8 * tauAt(S.b[i]));
      const d1 = r0 + sp * age;
      const d0 = r0 + sp * Math.max(0, age - 2.5);
      const c = hawkCol(S.b[i]);
      const e = (0.8 + 2.4 * tauAt(S.b[i])) * Math.exp(-age / 35);
      const ca = Math.cos(S.a[i]);
      const sa = Math.sin(S.a[i]);
      hdr.line(960 + ca * d0, 540 + sa * d0, 960 + ca * d1, 540 + sa * d1, c[0] * e, c[1] * e, c[2] * e);
    }
  }
  if (k >= 0) {
    burstPoints(hdr, 960, 540, k, {seed: 77, n: 7000, reach: 1900, tau: 30, life: 85, hot: [1, 1, 1], cool: [0.55, 0.45, 1], gain: 2.4});
    burstPoints(hdr, 960, 540, k - 2, {seed: 78, n: 3500, reach: 1100, tau: 40, life: 110, hot: [0.8, 0.9, 1], cool: [0.9, 0.3, 0.7], gain: 1.4});
  }
  hdr.flush(ctx, 1.1);
  ctx.globalCompositeOperation = 'lighter';
  if (t >= EVAP && t < BOOM + 1) {
    const c = hawkCol(t);
    const I = hawkI(t);
    const g = clamp(I / 40);
    drawGlow(ctx, 960, 540, 200 + 1600 * Math.pow(g, 0.7), c, 0.25 + 0.75 * g, 0.06);
    drawGlow(ctx, 960, 540, 60 + 400 * g, [1, 1, 1], g, 0.2);
    if (g > 0.08) {
      drawSpikes(ctx, 960, 540, 300 + 1700 * g, c, Math.min(1, g * 1.4), 0.3 + t * 0.002, 2 + g * 5);
      ctx.save();
      ctx.translate(960, 540);
      ctx.scale(1, 0.02);
      drawGlow(ctx, 0, 0, 1500 + 4000 * g, [0.55, 0.65, 1], g, 0.03);
      ctx.restore();
    }
  }
  if (k >= 0) {
    const e = easeOutExpo(k / 70);
    ring(ctx, 960, 540, 2000 * e + 10, 220, '200,180,255', Math.exp(-k / 26));
    ring(ctx, 960, 540, 1800 * e, 80, '255,255,255', 0.9 * Math.exp(-k / 18));
    ring(ctx, 960, 540, 1000 * easeOutExpo(Math.max(0, k - 8) / 90), 200, '255,120,200', 0.5 * Math.exp(-k / 35));
    drawGlow(ctx, 960, 540, 1800 * Math.exp(-k / 25) + 100, [0.85, 0.85, 1], Math.exp(-k / 35), 0.05);
    ctx.save();
    ctx.translate(960, 540);
    ctx.scale(1, 0.014);
    drawGlow(ctx, 0, 0, 5200, [0.5, 0.6, 1], Math.exp(-k / 30), 0.03);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  bloom(ctx, 0.9, 1.4);
};

const Callout: React.FC<{x: number; y: number; ex: number; ey: number; zh: string; en: string; a: number; color: string}> = ({
  x,
  y,
  ex,
  ey,
  zh,
  en,
  a,
  color,
}) => {
  if (a <= 0) return null;
  const p = easeOut(a);
  const mx = lerp(x, ex, p);
  const my = lerp(y, ey, p);
  const right = ex > x;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: a}}>
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <circle cx={x} cy={y} r={5} fill={color} />
        <circle cx={x} cy={y} r={14} stroke={color} fill="none" strokeWidth={1} />
        <path d={`M ${x} ${y} L ${mx} ${my} L ${mx + (right ? 120 : -120) * p} ${my}`} stroke={color} strokeWidth={1.2} fill="none" />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: right ? mx + 10 : undefined,
          right: right ? undefined : 1920 - mx + 10,
          top: my - 44,
          textAlign: right ? 'left' : 'right',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 26, letterSpacing: '0.2em', color, textShadow: `0 0 16px ${color}, 0 0 4px #000`}}>{zh}</div>
        <div style={{fontFamily: EN, fontSize: 12, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.6)', marginTop: 5}}>{en}</div>
      </div>
    </div>
  );
};

const fmtSci = (log10v: number) => {
  let e = Math.floor(log10v);
  let m = Math.pow(10, log10v - e);
  if (m >= 9.95) {
    m = 1;
    e += 1;
  }
  return (
    <>
      {m.toFixed(1)} × 10<sup style={{fontSize: '0.6em'}}>{e}</sup>
    </>
  );
};

const Panel: React.FC<{t: number}> = ({t}) => {
  const a = windowed(t, EVAP + 10, BOOM, 30, 2);
  if (a <= 0) return null;
  const M = massAt(t);
  // supermassive black hole of 10^11 solar masses: T_H ≈ 6.2e-8 K / (M/M_sun)
  const logT = Math.log10(6.2e-19) - Math.log10(M) + 28 * Math.pow(tauAt(t), 6);
  const c = hawkCol(t);
  const col = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  const tremble = Math.pow(tauAt(t), 6) * 4;
  return (
    <div
      style={{
        position: 'absolute',
        right: 110,
        top: 300,
        width: 380,
        opacity: a,
        transform: `translate(${(noise1(t * 1.3) - 0.5) * tremble * 2}px, ${(noise1(t * 1.7 + 9) - 0.5) * tremble * 2}px)`,
      }}
    >
      <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 30, letterSpacing: '0.25em', color: col, textShadow: `0 0 18px ${col}`}}>{L.hawking}</div>
      <div style={{fontFamily: EN, fontSize: 12, letterSpacing: '0.4em', color: 'rgba(255,255,255,0.55)', marginTop: 6}}>HAWKING RADIATION</div>
      <div style={{marginTop: 28, fontFamily: ZH, fontSize: 18, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.7)'}}>
        {L.mass} <span style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.3em', opacity: 0.6}}>MASS</span>
      </div>
      <div style={{marginTop: 8, height: 8, width: 380, border: '1px solid rgba(255,255,255,0.35)', borderRadius: 4}}>
        <div style={{height: 6, width: 378 * M, background: '#fff', borderRadius: 3, boxShadow: '0 0 12px #fff'}} />
      </div>
      <div style={{fontFamily: MONO, fontSize: 18, color: '#fff', marginTop: 6}}>{(M * 100).toFixed(1)}%</div>
      <div style={{marginTop: 22, fontFamily: ZH, fontSize: 18, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.7)'}}>
        {L.temp} <span style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.3em', opacity: 0.6}}>TEMPERATURE</span>
      </div>
      <div style={{fontFamily: MONO, fontWeight: 700, fontSize: 40, color: col, textShadow: `0 0 20px ${col}`, marginTop: 6}}>
        {fmtSci(logT)} K
      </div>
    </div>
  );
};

export const BlackHole: React.FC = () => {
  const t = useCurrentFrame();
  const M = massAt(t);
  const cam = camAt(t);
  const disk = 1 - smoothstep(DISK_OFF, DISK_OFF + 120, t);
  const hc = hawkCol(t);
  const tr = Math.pow(tauAt(t), 5) * 10;
  const shake = t < BOOM ? tr : 0;
  const white = t >= BOOM ? 1 - smoothstep(BOOM + 12, BOOM + 55, t) : 0;
  const sh = shadowPx(t);
  const bhA = t < BOOM + 2 ? 1 : 0;
  const reveal = easeOutExpo(clamp(t / 40));
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill
        style={{
          transform: `translate(${(noise1(t * 1.1) - 0.5) * shake}px, ${(noise1(t * 1.3 + 5) - 0.5) * shake}px) scale(${1.15 - 0.15 * reveal})`,
          opacity: bhA,
        }}
      >
        {bhA > 0 ? (
          <ShaderCanvas
            fs={BLACKHOLE_FS}
            scale={0.6}
            bloom={0.75}
            bloomBlur={4}
            uniforms={{
              uRs: M,
              uDisk: disk * (0.4 + 0.6 * reveal),
              uHawk: hawkI(t),
              uHawkCol: hc,
              uCamDist: cam,
              uTilt: 0.13 - 0.03 * clamp(t / 400),
              uYaw: t * 0.0015,
              uBg: lerp(0.45, 0.12, smoothstep(EVAP, BOOM, t)),
              uFlash: 0,
              uRoll: -0.12,
            }}
          />
        ) : null}
      </AbsoluteFill>
      {t >= BOOM ? (
        <ShaderCanvas
          fs={NEBULA_FS}
          scale={0.5}
          uniforms={{
            uC: [0.5, 0.5],
            uR: 0.08 + 0.75 * easeOutExpo((t - BOOM) / 110),
            uW: 0.35,
            uI: 2.2 * Math.exp(-(t - BOOM) / 70),
            uColA: [0.45, 0.4, 1.0],
            uColB: [1.0, 0.35, 0.75],
            uSeed: 17,
            uCore: 2 * Math.exp(-(t - BOOM) / 25),
            uFill: 0.4,
          }}
          style={{mixBlendMode: 'screen'}}
        />
      ) : null}
      <Canvas2D draw={(ctx, fr) => drawOverlay(ctx, fr)} style={{mixBlendMode: 'screen'}} />
      <Callout x={960 + sh * 0.7} y={540 + sh * 0.72} ex={1300} ey={820} zh={L.eventHorizon} en="EVENT HORIZON" a={windowed(t, 70, 300, 25, 25)} color="#ffd2a0" />
      <Callout x={420} y={640} ex={300} ey={780} zh={L.disk} en="ACCRETION DISK" a={windowed(t, 110, 320, 25, 25)} color="#ffb070" />
      <Callout x={960 - sh * 0.4} y={540 - sh * 1.25} ex={620} ey={200} zh={L.lensing} en="GRAVITATIONAL LENSING" a={windowed(t, 150, 330, 25, 25)} color="#bcd4ff" />
      <Panel t={t} />
      {white > 0 ? <AbsoluteFill style={{background: '#fff', opacity: white}} /> : null}
    </AbsoluteFill>
  );
};
