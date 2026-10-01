import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Canvas2D} from '../components/Canvas2D';
import {ShaderCanvas} from '../components/ShaderCanvas';
import {bloom, drawGlow, drawSpikes} from '../lib/canvas';
import {EN, SERIF} from '../lib/fonts';
import {NEBULA_FS} from '../lib/glsl';
import {getHDR} from '../lib/hdr';
import {L} from '../lib/labels';
import {clamp, easeIn, easeOut, easeOutExpo, rng, smoothstep} from '../lib/math';
import {starfieldPoints, starfieldSprites} from '../lib/starfield';

const BANG = 360;
const CX = 960;
const CY = 540;

const debris = (() => {
  const r = rng(99);
  const n = 4200;
  const a = new Float32Array(n);
  const v = new Float32Array(n);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = r() * Math.PI * 2;
    v[i] = 120 + Math.pow(r(), 2.2) * 1500;
    h[i] = r();
  }
  return {n, a, v, h};
})();

const zoomAt = (f: number) => {
  if (f < 300) return 1 + f * 0.0006;
  const z0 = 1 + 300 * 0.0006;
  if (f < BANG) return z0 * (1 - 0.92 * easeIn((f - 300) / 60));
  const t = f - BANG;
  return 0.08 + 1.3 * easeOutExpo(t / 50) + Math.max(0, t - 50) * 0.0012;
};

const ring = (ctx: CanvasRenderingContext2D, R: number, w: number, rgb: string, a: number) => {
  if (a <= 0.003 || R <= 1) return;
  const g = ctx.createRadialGradient(CX, CY, Math.max(0, R - w), CX, CY, R + w * 0.3);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.75, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(CX, CY, R + w * 0.3, 0, Math.PI * 2);
  ctx.fill();
};

const draw = (ctx: CanvasRenderingContext2D, f: number) => {
  const hdr = getHDR(1920, 1080);
  const starAlpha = smoothstep(0, 110, f) * (f < BANG ? 1 + 0.8 * easeIn((f - 300) / 60) : 1);
  const bright = starfieldPoints(hdr, {seed: 11, n: 3200, f, zoom: zoomAt(f), prevZoom: zoomAt(f - 1), alpha: starAlpha});

  const t = f - BANG;
  if (t >= 0) {
    // debris
    const tau = 16;
    const life = Math.exp(-t / 75);
    const heat = clamp(t / 90);
    for (let i = 0; i < debris.n; i++) {
      const s = debris.v[i];
      const d1 = s * (1 - Math.exp(-t / tau));
      const d0 = s * (1 - Math.exp(-Math.max(0, t - 1.4) / tau));
      const ca = Math.cos(debris.a[i]);
      const sa = Math.sin(debris.a[i]);
      const k = (0.5 + debris.h[i]) * life * 1.4;
      const hot = 1 - heat * (0.5 + debris.h[i] * 0.5);
      const r = 1;
      const g = 0.35 + 0.6 * hot;
      const b = 0.12 + 0.85 * hot * hot;
      hdr.line(CX + ca * d0, CY + sa * d0 * 0.92, CX + ca * d1, CY + sa * d1 * 0.92, r * k, g * k, b * k);
    }
  }
  hdr.flush(ctx, 1.1);
  starfieldSprites(ctx, bright);

  ctx.globalCompositeOperation = 'lighter';
  if (f < BANG + 2) {
    const a = smoothstep(8, 70, f);
    const g = easeIn((f - 290) / 70);
    const pulse = 1 + 0.06 * Math.sin(f * 0.25) + 0.03 * Math.sin(f * 0.91);
    const s = (30 + 460 * g) * pulse;
    drawGlow(ctx, CX, CY, s * 4, [1, 0.62, 0.32], a * (0.35 + 0.65 * g), 0.05);
    drawGlow(ctx, CX, CY, s, [1, 0.9, 0.75], a, 0.2);
    drawSpikes(ctx, CX, CY, (90 + 1100 * g) * pulse, [1, 0.85, 0.7], a * 0.9, 0.12 + f * 0.0004, 1.5 + g * 3);
    // anamorphic streak
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(1, 0.02 + 0.01 * g);
    drawGlow(ctx, 0, 0, 600 + 2400 * g, [0.55, 0.7, 1], a * (0.4 + 0.6 * g), 0.04);
    ctx.restore();
  }
  if (t >= 0) {
    const e = easeOutExpo(t / 60);
    ring(ctx, 1500 * e + 6, 120, '255,170,90', 0.9 * Math.exp(-t / 22));
    ring(ctx, 1480 * e, 70, '120,200,255', 0.8 * Math.exp(-t / 20));
    const e2 = easeOutExpo(Math.max(0, t - 5) / 90);
    ring(ctx, 900 * e2, 160, '255,120,60', 0.45 * Math.exp(-t / 35));
    drawGlow(ctx, CX, CY, 900 * Math.exp(-t / 30) + 160, [1, 0.75, 0.45], Math.exp(-t / 40), 0.08);
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(1, 0.018);
    drawGlow(ctx, 0, 0, 3800, [0.5, 0.7, 1], 0.9 * Math.exp(-t / 28), 0.03);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  bloom(ctx, 0.9, 1.5);
};

const Title: React.FC<{f: number}> = ({f}) => {
  const t = f - BANG;
  if (t < 0) return null;
  const e = easeOutExpo(t / 26);
  const split = (1 - easeOut(t / 30)) * 34;
  const out = clamp((f - 440) / 40);
  const scale = (1.5 - 0.5 * e) * (1 + t * 0.0006) * (1 + easeIn(out) * 0.4);
  const blur = (1 - e) * 22 + out * 14;
  const sub = easeOut((t - 22) / 30);
  const line = easeOut((t - 14) / 40);
  const textStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 330,
    textAlign: 'center',
    fontFamily: SERIF,
    fontWeight: 900,
    fontSize: 230,
    letterSpacing: `${0.18 + (1 - e) * 0.5}em`,
    paddingLeft: `${0.18 + (1 - e) * 0.5}em`,
    whiteSpace: 'nowrap',
  };
  return (
    <AbsoluteFill style={{opacity: (1 - out) * clamp(t / 3), transform: `scale(${scale})`, filter: `blur(${blur}px)`}}>
      <div style={{...textStyle, color: '#ff3a1a', opacity: 0.8 * (split / 34), transform: `translateX(${split}px)`, mixBlendMode: 'screen'}}>{L.title}</div>
      <div style={{...textStyle, color: '#1ad5ff', opacity: 0.8 * (split / 34), transform: `translateX(${-split}px)`, mixBlendMode: 'screen'}}>{L.title}</div>
      <div
        style={{
          ...textStyle,
          backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #fff1dc 45%, #f2b178 78%, #b8642e 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 0 30px rgba(255,160,80,0.55)) drop-shadow(0 0 80px rgba(255,120,40,0.35))',
        }}
      >
        {L.title}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 960 - 360 * line,
          width: 720 * line,
          top: 640,
          height: 1,
          background: 'linear-gradient(90deg, rgba(255,200,150,0), rgba(255,220,180,0.9), rgba(255,200,150,0))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 668,
          textAlign: 'center',
          fontFamily: EN,
          fontWeight: 300,
          fontSize: 28,
          letterSpacing: `${0.9 - sub * 0.25}em`,
          paddingLeft: '0.65em',
          color: 'rgba(255,236,214,0.85)',
          opacity: sub,
        }}
      >
        THE HEAT DEATH OF THE UNIVERSE
      </div>
    </AbsoluteFill>
  );
};

export const Open: React.FC = () => {
  const f = useCurrentFrame();
  const t = f - BANG;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {t > -1 ? (
        <ShaderCanvas
          fs={NEBULA_FS}
          scale={0.5}
          uniforms={{
            uC: [0.5, 0.5],
            uR: 0.06 + 0.5 * easeOutExpo(t / 140) + t * 0.0004,
            uW: 0.3,
            uI: 1.6 * smoothstep(-1, 12, t) * (1 - 0.45 * clamp(t / 120)),
            uColA: [0.15, 0.55, 1.0],
            uColB: [1.0, 0.3, 0.08],
            uSeed: 3,
            uCore: 2.5 * Math.exp(-t / 25),
            uFill: 0.7,
          }}
        />
      ) : null}
      <Canvas2D draw={(ctx, fr) => draw(ctx, fr)} style={{mixBlendMode: 'screen'}} />
      <Title f={f} />
    </AbsoluteFill>
  );
};
