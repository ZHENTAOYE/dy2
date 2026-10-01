import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {ShaderCanvas} from '../components/ShaderCanvas';
import {bloom, drawGlow} from '../lib/canvas';
import {EN, ZH} from '../lib/fonts';
import {GalaxyView, galaxyOverlay, galaxyPoints, makeGalaxy, projectGalaxyPoint} from '../lib/galaxy';
import {drawGalaxySprite} from '../lib/galaxySprites';
import {STAR_FS} from '../lib/glsl';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {clamp, easeInOut, easeOut, gauss, lerp, rng, smoothstep, windowed} from '../lib/math';
import {starfieldPoints, starfieldSprites} from '../lib/starfield';

const STAR_IN = 178;
const STAR_OUT = 338;
const FIELD = 455;
const EXPAND = 505;

export const viewAt = (t: number): GalaxyView => {
  const fly = easeOut(clamp(t / 150));
  const back = easeInOut(clamp((t - STAR_OUT) / 140));
  const shrink = easeInOut(clamp((t - FIELD) / 70));
  return {
    cx: 960,
    cy: 520,
    scale: lerp(680, 520, back) * lerp(1, 0.07, shrink),
    dist: lerp(0.1, 2.3, fly) + back * 0.8,
    incl: lerp(0.15, 1.08, fly) - back * 0.35,
    yaw: -0.6 + t * 0.0022 + (1 - fly) * 1.4,
    t: t * 0.012,
    bright: lerp(2.2, 1, fly),
  };
};

const SUN_R = 0.56;
const SUN_TH = 10.85;

// ---- galaxy field (cosmic web) ----
const field = (() => {
  const r = rng(404);
  const out: {x: number; y: number; s: number; rot: number; sq: number; v: number; local: boolean}[] = [];
  const centers: [number, number][] = [];
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2;
    const d = 0.18 + Math.sqrt(r()) * 1.25;
    centers.push([Math.cos(a) * d * 1.5, Math.sin(a) * d]);
  }
  for (let k = 0; k < 700; k++) {
    let x: number, y: number;
    if (r() < 0.55) {
      const [cx, cy] = centers[Math.floor(r() * centers.length)];
      x = cx + gauss(r) * 0.07;
      y = cy + gauss(r) * 0.05;
    } else {
      const [ax, ay] = centers[Math.floor(r() * centers.length)];
      const [bx, by] = centers[Math.floor(r() * centers.length)];
      const u = r();
      x = lerp(ax, bx, u) + gauss(r) * 0.03;
      y = lerp(ay, by, u) + gauss(r) * 0.03;
    }
    if (Math.hypot(x, y) < 0.12) continue;
    out.push({x, y, s: 22 + Math.pow(r(), 3) * 90, rot: r() * 6.28, sq: 0.35 + r() * 0.65, v: Math.floor(r() * 8), local: false});
  }
  out.push({x: 0.045, y: -0.03, s: 70, rot: 0.8, sq: 0.4, v: 1, local: true});
  out.push({x: -0.03, y: 0.04, s: 34, rot: 2.1, sq: 0.6, v: 5, local: true});
  out.push({x: 0.02, y: 0.055, s: 20, rot: 0.3, sq: 0.8, v: 3, local: true});
  return out;
})();

const HZ = 470; // horizon radius px

const drawField = (ctx: CanvasRenderingContext2D, t: number) => {
  const a = smoothstep(FIELD + 10, FIELD + 60, t);
  if (a <= 0) return;
  const u = clamp((t - EXPAND) / 290);
  const scaleF = Math.exp(u * u * 2.7);
  const unit = 600;
  ctx.globalCompositeOperation = 'lighter';
  for (const g of field) {
    const k = g.local ? 1 : scaleF;
    const x = 960 + g.x * unit * k;
    const y = 520 + g.y * unit * k;
    const d = Math.hypot(x - 960, y - 520) / HZ;
    const red = g.local ? 0 : clamp((scaleF - 1) * 0.35 + d * 0.35 - 0.2);
    const fade = g.local ? 1 : 1 - smoothstep(0.82, 1.02, d);
    const size = g.s / Math.pow(k, 0.35);
    const al = a * fade * 1.6;
    if (al < 0.01) continue;
    drawGalaxySprite(ctx, g.v, 'old', x, y, size, g.rot, g.sq, al * (1 - red));
    drawGalaxySprite(ctx, g.v, 'red', x, y, size, g.rot, g.sq, al * red * 0.9);
  }
  // horizon
  ctx.globalCompositeOperation = 'source-over';
  const ha = a * smoothstep(EXPAND - 30, EXPAND + 20, t);
  if (ha > 0) {
    ctx.save();
    ctx.globalAlpha = ha * 0.8;
    ctx.strokeStyle = 'rgba(160,200,255,0.8)';
    ctx.setLineDash([3, 9]);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#7fb6ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(960, 520, HZ, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const grd = ctx.createRadialGradient(960, 520, HZ, 960, 520, HZ + 260);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.3, 'rgba(0,0,0,0.75)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalAlpha = ha;
    ctx.shadowBlur = 0;
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.restore();
  }
};

const draw = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080);
  const g = makeGalaxy(31, 70000);
  const v = viewAt(t);
  const vp = viewAt(t - 1);
  const gal = 1 - smoothstep(FIELD + 40, FIELD + 75, t);
  // faint foreground/background stars
  const bgA = 0.55 * (1 - smoothstep(FIELD, FIELD + 50, t));
  const bright = starfieldPoints(hdr, {seed: 41, n: 1800, f: t, zoom: 1 + t * 0.0008, alpha: bgA});
  let flashes: [number, number, number][] = [];
  if (gal > 0) {
    flashes = galaxyPoints(hdr, g, {...v, bright: (v.bright ?? 1) * gal * 1.1, prevDist: t < 150 ? vp.dist : undefined});
  }
  hdr.flush(ctx, 1.25);
  starfieldSprites(ctx, bright, false);
  if (gal > 0) galaxyOverlay(ctx, g, {...v, bright: gal}, flashes);
  if (t > FIELD - 10) {
    const a = smoothstep(FIELD + 30, FIELD + 70, t);
    // our galaxy becomes a sprite at the center
    ctx.globalCompositeOperation = 'lighter';
    drawGalaxySprite(ctx, 0, 'young', 960, 520, 120, -0.6, 0.55, a * 1.5);
    ctx.globalCompositeOperation = 'source-over';
    drawField(ctx, t);
  }
  // sun marker glow
  const sm = windowed(t, 60, 172, 25, 20);
  if (sm > 0) {
    const p = projectGalaxyPoint(v, SUN_R, SUN_TH);
    if (p) {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, p[0], p[1], 40 + 8 * Math.sin(t * 0.3), [1, 0.85, 0.5], sm, 0.2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  bloom(ctx, 0.85, 1.45);
};

/** Photons pouring out of the star in every direction: ordered fuel → disordered light. */
const drawPhotons = (ctx: CanvasRenderingContext2D, t: number) => {
  const hdr = getHDR(1920, 1080, 'ph');
  const k = t - STAR_IN;
  const R = (0.33 + k * 0.0004) * 1080;
  const r = rng(808);
  for (let i = 0; i < 1400; i++) {
    const a = r() * Math.PI * 2;
    const birth = r() * 200 - 40;
    const sp = 6 + r() * 10;
    const age = k - birth;
    if (age < 0) continue;
    const d = R * 0.98 + age * sp;
    if (d > 1400) continue;
    const wob = Math.sin(age * 0.2 + i) * 0.04;
    const x = 960 + Math.cos(a + wob) * d;
    const y = 540 + Math.sin(a + wob) * d;
    const x0 = 960 + Math.cos(a + wob) * (d - sp * 2.2);
    const y0 = 540 + Math.sin(a + wob) * (d - sp * 2.2);
    const c = r();
    const col: [number, number, number] = c < 0.5 ? [1, 0.85, 0.55] : c < 0.8 ? [1, 0.55, 0.25] : [0.7, 0.8, 1];
    const e = 5 * Math.exp(-age / 90);
    hdr.line(x0, y0, x, y, col[0] * e, col[1] * e, col[2] * e);
  }
  hdr.flush(ctx, 1.4);
};

export const Stars: React.FC = () => {
  const t = useCurrentFrame();
  const starA = windowed(t, STAR_IN, STAR_OUT + 10, 22, 26);
  const k = t - STAR_IN;
  const sm = windowed(t, 60, 172, 25, 20);
  const v = viewAt(t);
  const sp = projectGalaxyPoint(v, SUN_R, SUN_TH);
  const fieldA = windowed(t, EXPAND - 20, 800, 40, 30);
  const lgA = windowed(t, 690, 800, 30, 30);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{opacity: 1 - starA}}>
        <Canvas2D draw={(ctx, fr) => draw(ctx, fr)} />
      </AbsoluteFill>
      {starA > 0 ? (
        <AbsoluteFill style={{opacity: starA}}>
          <ShaderCanvas
            fs={STAR_FS}
            scale={0.5}
            uniforms={{
              uC: [0.5, 0.5],
              uR: 0.33 + k * 0.0004,
              uCol: [1.0, 0.5, 0.16],
              uI: 0.62,
              uCorona: 1.3,
              uSeed: 4,
              uTurb: 1,
            }}
          />
          <Canvas2D draw={(ctx, fr) => drawPhotons(ctx, fr)} style={{mixBlendMode: 'screen'}} />
        </AbsoluteFill>
      ) : null}
      {sm > 0 && sp ? (
        <div style={{position: 'absolute', left: sp[0], top: sp[1], opacity: sm}}>
          <svg width={260} height={140} style={{position: 'absolute', left: 0, top: -140}}>
            <path d="M 10 130 L 70 40 L 250 40" stroke="rgba(255,226,170,0.85)" strokeWidth={1.5} fill="none" />
            <circle cx={6} cy={134} r={5} stroke="#ffe2aa" fill="none" />
          </svg>
          <div style={{position: 'absolute', left: 78, top: -142, whiteSpace: 'nowrap'}}>
            <div style={{fontFamily: ZH, fontSize: 24, fontWeight: 700, letterSpacing: '0.15em', color: '#ffe2aa', textShadow: '0 0 14px #000'}}>{L.sun}</div>
            <div style={{fontFamily: EN, fontSize: 12, letterSpacing: '0.35em', color: 'rgba(255,255,255,0.6)', marginTop: 4}}>
              SOLAR SYSTEM · YOU ARE HERE
            </div>
          </div>
        </div>
      ) : null}
      {fieldA > 0 ? (
        <div style={{position: 'absolute', left: 960, top: 520 - HZ - 52, transform: 'translateX(-50%)', textAlign: 'center', opacity: fieldA}}>
          <div style={{fontFamily: ZH, fontSize: 20, letterSpacing: '0.3em', color: '#a9cbff'}}>{L.horizon}</div>
          <div style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.4em', color: 'rgba(169,203,255,0.6)', marginTop: 3}}>OBSERVABLE UNIVERSE · HORIZON</div>
        </div>
      ) : null}
      {lgA > 0 ? (
        <div style={{position: 'absolute', left: 1040, top: 470, opacity: lgA}}>
          <div style={{fontFamily: ZH, fontSize: 20, letterSpacing: '0.25em', color: '#ffe2aa'}}>{L.localGroup}</div>
          <div style={{fontFamily: EN, fontSize: 11, letterSpacing: '0.35em', color: 'rgba(255,226,170,0.6)', marginTop: 3}}>LOCAL GROUP</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
