import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {LATIN, MONO, SANS} from '../fonts';
import {clamp, easeOutCubic, smooth} from '../lib/math';
import {hash1} from '../lib/rng';
import {getScratch} from '../lib/canvas';
import {CanvasLayer} from './CanvasLayer';

// Chapter marker, top-left: number, Chinese title, English kicker.
export const ChapterTag: React.FC<{index: string; title: string; en: string; dur: number}> = ({
  index,
  title,
  en,
  dur,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const inK = easeOutCubic(clamp((t - 0.2) / 0.9));
  const dim = 1 - 0.45 * smooth(4.5, 6, t);
  const out = 1 - smooth(dur - 0.8, dur - 0.2, t);
  const line = easeOutCubic(clamp((t - 0.35) / 1.1));
  return (
    <div
      style={{
        position: 'absolute',
        left: (portrait ? 60 : 84) * u,
        top: (portrait ? 150 : 70) * u,
        opacity: inK * dim * out,
        transform: `translateX(${(1 - inK) * -30 * u}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 22 * u,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 200,
          fontSize: 60 * u,
          color: 'rgba(255,255,255,0.92)',
          textShadow: `0 0 ${18 * u}px rgba(120,180,255,0.7), 0 ${2 * u}px ${8 * u}px rgba(0,0,0,0.6)`,
          letterSpacing: '0.05em',
        }}
      >
        {index}
      </div>
      <div style={{width: 70 * u * line, height: 2 * u, background: 'linear-gradient(90deg,#9fd8ff,rgba(159,216,255,0))'}} />
      <div>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: 34 * u,
            color: '#fff',
            letterSpacing: '0.18em',
            textShadow: `0 0 ${14 * u}px rgba(120,180,255,0.6), 0 ${1 * u}px ${4 * u}px rgba(0,0,0,0.6)`,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: LATIN,
            fontWeight: 400,
            fontSize: 16 * u,
            color: 'rgba(190,215,255,0.8)',
            letterSpacing: '0.5em',
            marginTop: 6 * u,
            textShadow: `0 ${1 * u}px ${6 * u}px rgba(0,0,0,0.7)`,
          }}
        >
          {en}
        </div>
      </div>
    </div>
  );
};

// HUD readout (label + big value), used for counters.
export const Readout: React.FC<{
  label: string;
  value: React.ReactNode;
  x: number;
  y: number;
  align?: 'left' | 'right' | 'center';
  opacity?: number;
  size?: number;
  color?: string;
  backdrop?: boolean;
}> = ({label, value, x, y, align = 'left', opacity = 1, size = 64, color = '#ffffff', backdrop = false}) => {
  const {width, height} = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  if (opacity <= 0.005) return null;
  const tx = align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%';
  return (
    <div
      style={{
        position: 'absolute',
        left: x * width,
        top: y * height,
        transform: `translate(${tx}, -50%)`,
        textAlign: align,
        opacity,
        whiteSpace: 'nowrap',
        padding: backdrop ? `${18 * u}px ${30 * u}px` : undefined,
        background: backdrop ? 'radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0.25) 70%, rgba(0,0,0,0))' : undefined,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 300,
          fontSize: 24 * u,
          letterSpacing: '0.3em',
          color: 'rgba(200,220,255,0.85)',
          marginBottom: 6 * u,
          textShadow: `0 ${2 * u}px ${8 * u}px rgba(0,0,0,0.9)`,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontSize: size * u,
          color,
          letterSpacing: '0.04em',
          textShadow: `0 0 ${20 * u}px ${color === '#ffffff' ? 'rgba(140,190,255,0.8)' : color}, 0 ${2 * u}px ${12 * u}px rgba(0,0,0,0.85)`,
        }}
      >
        {value}
      </div>
    </div>
  );
};

// Exponent-friendly number: 10^n rendered with a real superscript.
export const Pow10: React.FC<{base?: string; exp: string | number; prefix?: string; suffix?: string}> = ({
  base = '10',
  exp,
  prefix = '',
  suffix = '',
}) => (
  <span>
    {prefix}
    {base}
    <sup style={{fontSize: '0.55em', verticalAlign: '0.85em', marginLeft: '0.04em'}}>{exp}</sup>
    {suffix}
  </span>
);

// Camera shake wrapper.
export const Shake: React.FC<{amount: number; children: React.ReactNode; zoom?: number}> = ({
  amount,
  children,
  zoom = 0,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  const a = amount * 26 * u;
  const x = (hash1(frame * 1.37) - 0.5) * 2 * a;
  const y = (hash1(frame * 2.11 + 9) - 0.5) * 2 * a;
  const r = (hash1(frame * 0.73 + 3) - 0.5) * amount * 0.8;
  // Overscale enough to cover the translation and rotation, so no black edge shows.
  const s = 1 + Math.abs(amount) * 0.065 + zoom;
  return (
    <AbsoluteFill style={{transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`}}>
      {children}
    </AbsoluteFill>
  );
};

// Full-screen colour flash.
export const Flash: React.FC<{amount: number; color?: string}> = ({amount, color = '#fff'}) =>
  amount > 0.003 ? (
    <AbsoluteFill style={{background: color, opacity: clamp(amount), mixBlendMode: 'screen'}} />
  ) : null;

export const Fade: React.FC<{amount: number; color?: string}> = ({amount, color = '#000'}) =>
  amount > 0.003 ? <AbsoluteFill style={{background: color, opacity: clamp(amount)}} /> : null;

// Film grain + vignette over everything.
const grainTile = () => {
  const c = getScratch('grain-tile', 256, 256);
  if ((c as HTMLCanvasElement & {_done?: boolean})._done) return c;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 8) & 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  (c as HTMLCanvasElement & {_done?: boolean})._done = true;
  return c;
};

export const FilmOverlay: React.FC<{grain?: number}> = ({grain = 0.06}) => {
  const frame = useCurrentFrame();
  return (
    <>
      <CanvasLayer
        style={{mixBlendMode: 'overlay', opacity: grain}}
        draw={(ctx, w, h) => {
          const tile = grainTile();
          const pat = ctx.createPattern(tile, 'repeat')!;
          const ox = Math.floor(hash1(frame * 3.1) * 256);
          const oy = Math.floor(hash1(frame * 7.7) * 256);
          ctx.translate(-ox, -oy);
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, w + 512, h + 512);
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </>
  );
};
