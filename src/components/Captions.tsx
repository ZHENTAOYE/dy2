import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {SANS} from '../fonts';
import {clamp, easeOutCubic, smooth} from '../lib/math';
import {glyphStyle, parseRich, unbreakableRuns} from './RichText';

export type Caption = {from: number; to: number; text: string};

const ACCENT = '#ffd27a';

// Documentary-style subtitles: glyphs rise in one by one, the line exhales out.
export const Captions: React.FC<{items: Caption[]; bottom?: number; accent?: string}> = ({
  items,
  bottom = 0.1,
  accent = ACCENT,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const active = items.filter((c) => t >= c.from - 0.05 && t <= c.to + 0.6);
  return (
    <>
      {active.map((c) => {
        // '|' marks a phrase break used only in portrait, where most lines need two rows.
        const glyphs = parseRich(c.text.replace(/\|/g, portrait ? '\n' : ''));
        const out = smooth(c.to, c.to + 0.45, t);
        return (
          <div
            key={c.from}
            style={{
              position: 'absolute',
              left: '50%',
              bottom: height * (portrait ? 0.16 : bottom),
              transform: `translate(-50%, ${-out * 14 * u}px)`,
              width: width * (portrait ? 0.86 : 0.8),
              textAlign: 'center',
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: (portrait ? 50 : 46) * u,
              lineHeight: 1.5,
              letterSpacing: '0.08em',
              color: '#f4f6ff',
              opacity: 1 - out,
              filter: out > 0.01 ? `blur(${out * 8 * u}px)` : undefined,
              textShadow: `0 0 ${18 * u}px rgba(120,170,255,0.35), 0 ${2 * u}px ${6 * u}px rgba(0,0,0,0.9)`,
              // Two-line captions (mostly portrait) split evenly instead of leaving one glyph behind.
              textWrap: 'balance',
            }}
          >
            {unbreakableRuns(glyphs).map((run) => {
              if (glyphs[run[0]].br) return <br key={run[0]} />;
              return (
                <span key={run[0]} style={{display: 'inline-block', whiteSpace: 'nowrap'}}>
                  {run.map((i) => {
                    const g = glyphs[i];
                    const st = c.from + i * 0.032;
                    const k = easeOutCubic(clamp((t - st) / 0.32));
                    return (
                      <span
                        key={i}
                        style={{
                          display: 'inline-block',
                          whiteSpace: 'pre',
                          opacity: k,
                          transform: `translateY(${(1 - k) * 16 * u}px)`,
                          filter: k < 0.99 ? `blur(${(1 - k) * 6 * u}px)` : undefined,
                          color: g.accent ? accent : undefined,
                          textShadow: g.accent
                            ? `0 0 ${20 * u}px rgba(255,190,90,0.6), 0 ${2 * u}px ${6 * u}px rgba(0,0,0,0.9)`
                            : undefined,
                          ...glyphStyle(g),
                        }}
                      >
                        {g.text}
                      </span>
                    );
                  })}
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
};
