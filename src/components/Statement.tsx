import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {LATIN, SANS, SERIF} from '../fonts';
import {clamp, easeOutCubic, easeOutExpo, smooth} from '../lib/math';
import {glyphStyle, parseRich} from './RichText';

const THEMES = {
  white: {fill: 'linear-gradient(180deg,#ffffff 0%,#dfe8ff 100%)', glow: 'rgba(150,190,255,0.75)'},
  gold: {fill: 'linear-gradient(180deg,#fff8e6 0%,#ffd27a 55%,#ff9a3c 100%)', glow: 'rgba(255,170,70,0.8)'},
  cyan: {fill: 'linear-gradient(180deg,#f0fdff 0%,#8ee8ff 60%,#4aa8ff 100%)', glow: 'rgba(80,190,255,0.85)'},
  red: {fill: 'linear-gradient(180deg,#fff0ee 0%,#ff8a7a 55%,#ff3b3b 100%)', glow: 'rgba(255,70,60,0.8)'},
  violet: {fill: 'linear-gradient(180deg,#fbf5ff 0%,#c9a6ff 55%,#8a5cff 100%)', glow: 'rgba(150,100,255,0.85)'},
};

export type StatementTheme = keyof typeof THEMES;

// Big centred line for key ideas: glyphs slam in from scale + blur.
export const Statement: React.FC<{
  from: number;
  to: number;
  text: string;
  sub?: string;
  size?: number;
  theme?: StatementTheme;
  y?: number;
  serif?: boolean;
  slam?: boolean;
  stagger?: number;
}> = ({from, to, text, sub, size = 110, theme = 'white', y = 0.5, serif = false, slam = false, stagger = 0.06}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  if (t < from - 0.1 || t > to + 0.8) return null;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const th = THEMES[theme];
  const glyphs = parseRich(text);
  const out = smooth(to, to + 0.7, t);
  const life = clamp((t - from) / Math.max(0.1, to - from));
  const drift = 1 + life * 0.04;
  // Shrink to fit the frame width (portrait) instead of wrapping: estimate each
  // line in em (CJK 1, Latin/digits 0.6, superscripts 0.35, plus letter-spacing)
  // and leave room for the drift scale.
  const lineEm = [0];
  for (const g of glyphs) {
    if (g.br) lineEm.push(0);
    else lineEm[lineEm.length - 1] += (g.sup ? 0.35 : /^[\x20-\x7e]$/.test(g.text) ? 0.6 : 1) + 0.12;
  }
  const fitFs = (width - 80 * u) / (Math.max(...lineEm) * 1.04);
  const fs = Math.min(size * u * (portrait ? 0.82 : 1), fitFs);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: height * y,
        transform: `translateY(-50%) scale(${drift + out * 0.08})`,
        textAlign: 'center',
        opacity: 1 - out,
        filter: out > 0.01 ? `blur(${out * 14 * u}px)` : undefined,
        padding: `0 ${40 * u}px`,
      }}
    >
      <div
        style={{
          fontFamily: serif ? SERIF : SANS,
          fontWeight: 900,
          fontSize: fs,
          lineHeight: 1.25,
          // Portrait is width-bound: a smaller exit spread keeps the outer glyphs in frame.
          letterSpacing: `${0.12 + out * (portrait ? 0.1 : 0.3)}em`,
          // Never re-wrap while the exit letter-spacing grows; overflow stays centred.
          whiteSpace: 'nowrap',
          margin: `0 ${-width / 2}px`,
        }}
      >
        {glyphs.map((g, i) => {
          if (g.br) return <br key={i} />;
          const st = from + i * stagger;
          const raw = clamp((t - st) / (slam ? 0.28 : 0.6));
          const k = slam ? easeOutExpo(raw) : easeOutCubic(raw);
          const sc = slam ? 1 + (1 - k) * 1.6 : 1 + (1 - k) * 0.35;
          const glow = `drop-shadow(0 0 ${18 * u}px ${th.glow}) drop-shadow(0 0 ${54 * u}px ${th.glow})`;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                opacity: clamp(raw * 2.2),
                transform: `scale(${sc})`,
                filter: k < 0.995 ? `blur(${(1 - k) * 18 * u}px) ${glow}` : glow,
                backgroundImage: th.fill,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                ...glyphStyle(g),
              }}
            >
              {g.text}
            </span>
          );
        })}
      </div>
      {sub ? (
        <div
          style={{
            marginTop: 22 * u,
            fontFamily: LATIN,
            fontWeight: 200,
            fontSize: 30 * u * (portrait ? 0.85 : 1),
            letterSpacing: '0.55em',
            color: 'rgba(230,238,255,0.85)',
            opacity: smooth(from + 0.5, from + 1.3, t),
            textShadow: `0 ${2 * u}px ${8 * u}px rgba(0,0,0,0.85), 0 0 ${16 * u}px rgba(140,180,255,0.6)`,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};
