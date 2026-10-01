import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {ShaderCanvas} from '../components/ShaderCanvas';
import {burstPoints, ring} from '../lib/burst';
import {bloom, drawGlow} from '../lib/canvas';
import {EN, ZH} from '../lib/fonts';
import {GalaxyView, galaxyOverlay, galaxyPoints, makeGalaxy} from '../lib/galaxy';
import {NEBULA_FS, STAR_FS} from '../lib/glsl';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {clamp, easeIn, easeInOut, easeOutExpo, lerp, noise1, smoothstep, windowed} from '../lib/math';
import {starfieldPoints, starfieldSprites} from '../lib/starfield';

const SN_IN = 118; // cut to the supergiant
const SN = 205; // core collapse → explosion
const SN_OUT = 335;
const RD_IN = 470; // last red dwarf
const RD_DIE = 572;

const viewAt = (t: number): GalaxyView => {
  const k = easeInOut(clamp((t - SN_OUT) / 200));
  return {
    cx: 960,
    cy: 520,
    scale: lerp(600, 520, k),
    dist: 2.2 + t * 0.0015,
    incl: lerp(0.95, 0.8, k),
    yaw: 0.2 + t * 0.0025,
    t: 6 + t * 0.012,
  };
};

const deathAt = (t: number) => {
  if (t < SN_OUT) return 0.16 * smoothstep(0, 130, t);
  if (t < RD_IN) return lerp(0.16, 0.9, easeIn(clamp((t - SN_OUT) / 135)) * 0.4 + clamp((t - SN_OUT) / 135) * 0.6);
  return lerp(0.9, 0.995, clamp((t - RD_IN) / 60));
};

const drawGalaxy = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080);
  const g = makeGalaxy(31, 70000);
  const v = viewAt(t);
  const fade = t < RD_IN ? 1 : 1 - smoothstep(RD_IN, RD_IN + 40, t);
  const age = smoothstep(SN_OUT - 20, RD_IN, t);
  const view: GalaxyView = {
    ...v,
    young: 1 - smoothstep(0, 110, t),
    hii: 1 - smoothstep(0, 90, t),
    age,
    death: deathAt(t),
    bright: fade * lerp(1, 0.75, age),
    dust: 1 - age,
    core: lerp(1, 0.35, age),
  };
  const bright = starfieldPoints(hdr, {seed: 41, n: 1500, f: t, alpha: 0.35 * (1 - age)});
  const flashes = galaxyPoints(hdr, g, view);
  hdr.flush(ctx, 1.25);
  starfieldSprites(ctx, bright, false);
  galaxyOverlay(ctx, g, view, flashes);
  bloom(ctx, 0.85, 1.4);
};

const drawSupernova = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080, 'sn');
  const k = t - SN;
  const bright = starfieldPoints(hdr, {seed: 57, n: 2200, f: t, zoom: 1 + (t - SN_IN) * 0.0015, alpha: 0.6});
  burstPoints(hdr, 960, 540, k, {seed: 3, n: 5200, reach: 1500, tau: 22, life: 60, hot: [1, 0.95, 0.9], cool: [0.3, 0.75, 1], gain: 1.8});
  burstPoints(hdr, 960, 540, k - 3, {seed: 4, n: 2500, reach: 900, tau: 30, life: 80, hot: [1, 0.7, 0.4], cool: [1, 0.25, 0.1], gain: 1.4});
  hdr.flush(ctx, 1.1);
  starfieldSprites(ctx, bright, true);
  ctx.globalCompositeOperation = 'lighter';
  if (k >= 0) {
    const e = easeOutExpo(k / 50);
    ring(ctx, 960, 540, 1500 * e + 5, 140, '170,220,255', 0.95 * Math.exp(-k / 18));
    ring(ctx, 960, 540, 1380 * e, 60, '255,255,255', 0.8 * Math.exp(-k / 14));
    ring(ctx, 960, 540, 700 * easeOutExpo(Math.max(0, k - 6) / 70), 120, '255,140,80', 0.5 * Math.exp(-k / 30));
    drawGlow(ctx, 960, 540, 1100 * Math.exp(-k / 20) + 120, [0.75, 0.88, 1], Math.exp(-k / 30), 0.06);
    ctx.save();
    ctx.translate(960, 540);
    ctx.scale(1, 0.016);
    drawGlow(ctx, 0, 0, 4200, [0.45, 0.65, 1], Math.exp(-k / 26), 0.03);
    ctx.restore();
  } else {
    // collapse: the core flickers and gets sucked inward
    const c = easeIn((t - (SN - 14)) / 14);
    drawGlow(ctx, 960, 540, 260 * (1 - c) + 40, [0.7, 0.85, 1], 0.4 + c * 0.6, 0.12);
  }
  ctx.globalCompositeOperation = 'source-over';
  bloom(ctx, 0.9, 1.4);
};

const Tag: React.FC<{x: number; y: number; zh: string; en: string; a: number; color: string}> = ({x, y, zh, en, a, color}) => (
  <div style={{position: 'absolute', left: x, top: y, opacity: a, whiteSpace: 'nowrap'}}>
    <div style={{width: 46, height: 1, background: color, marginBottom: 12, boxShadow: `0 0 10px ${color}`}} />
    <div style={{fontFamily: ZH, fontWeight: 700, fontSize: 30, letterSpacing: '0.25em', color, textShadow: `0 0 20px ${color}`}}>{zh}</div>
    <div style={{fontFamily: EN, fontWeight: 500, fontSize: 13, letterSpacing: '0.4em', color: 'rgba(255,255,255,0.55)', marginTop: 6}}>{en}</div>
  </div>
);

export const Collapse: React.FC = () => {
  const t = useCurrentFrame();
  const snA = windowed(t, SN_IN, SN_OUT, 18, 25);
  const rdA = windowed(t, RD_IN, 680, 30, 10);
  const k = t - SN;
  // supergiant: swelling, pulsing, then collapsing
  const pre = clamp((t - SN_IN) / (SN - SN_IN));
  const pulse = Math.sin(t * (0.25 + pre * 0.9)) * 0.012 * pre;
  const collapse = easeIn(clamp((t - (SN - 12)) / 12));
  const sgR = (0.19 + pre * 0.05 + pulse) * (1 - collapse * 0.97);
  // red dwarf flicker & death
  const rk = clamp((t - RD_IN - 20) / (RD_DIE - RD_IN - 20));
  const flick = 1 - 0.35 * Math.pow(rk, 2) * (noise1(t * 0.9) > 0.55 ? 1 : 0);
  const rdI = (1 - easeIn(rk)) * flick * (t > RD_DIE ? Math.max(0, 1 - (t - RD_DIE) / 6) : 1);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{opacity: Math.max(0, 1 - snA) * (t < RD_IN + 40 ? 1 : 0)}}>
        <Canvas2D draw={(ctx, fr) => drawGalaxy(ctx, fr)} />
      </AbsoluteFill>
      {snA > 0 ? (
        <AbsoluteFill style={{opacity: snA}}>
          {k > -2 ? (
            <ShaderCanvas
              fs={NEBULA_FS}
              scale={0.5}
              uniforms={{
                uC: [0.5, 0.5],
                uR: 0.03 + 0.5 * easeOutExpo(k / 120) + Math.max(0, k) * 0.0005,
                uW: 0.26,
                uI: 1.9 * smoothstep(-2, 8, k),
                uColA: [0.2, 0.75, 1.0],
                uColB: [1.0, 0.22, 0.12],
                uSeed: 9,
                uCore: 3 * Math.exp(-Math.max(0, k) / 30),
                uFill: 0.5,
              }}
            />
          ) : (
            <ShaderCanvas
              fs={STAR_FS}
              scale={0.5}
              uniforms={{
                uC: [0.5, 0.5],
                uR: Math.max(0.004, sgR),
                uCol: [0.45, 0.62, 1.0],
                uI: 0.7 + pre * 0.4 + collapse * 2,
                uCorona: 1.4,
                uSeed: 12,
                uTurb: 1 + pre * 1.5,
              }}
            />
          )}
          <Canvas2D draw={(ctx, fr) => drawSupernova(ctx, fr)} style={{mixBlendMode: 'screen'}} />
        </AbsoluteFill>
      ) : null}
      {rdA > 0 ? (
        <AbsoluteFill style={{opacity: rdA}}>
          <ShaderCanvas
            fs={STAR_FS}
            scale={0.5}
            uniforms={{
              uC: [0.5, 0.52],
              uR: 0.12 + (t - RD_IN) * 0.0002,
              uCol: [1.0, 0.22, 0.06],
              uI: 0.75 * rdI,
              uCorona: 1.2,
              uSeed: 21,
              uTurb: 0.7,
            }}
          />
        </AbsoluteFill>
      ) : null}
      <Tag x={1290} y={300} zh={L.supernova} en="SUPERNOVA" a={windowed(t, SN + 30, SN_OUT, 20, 20)} color="#9fd8ff" />
      <Tag x={1240} y={360} zh={L.redDwarf} en="RED DWARF · THE LAST STAR" a={windowed(t, RD_IN + 30, RD_DIE + 6, 20, 10)} color="#ff7a4a" />
    </AbsoluteFill>
  );
};
