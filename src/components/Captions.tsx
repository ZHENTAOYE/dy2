import React from 'react';
import {useCurrentFrame} from 'remotion';
import {EN, ZH} from '../lib/fonts';
import {clamp, easeOut} from '../lib/math';
import {TL} from '../lib/timeline';

type Cap = {in: number; out: number; zh: string; en: string; note?: string};

const Line: React.FC<{c: Cap; f: number}> = ({c, f}) => {
  const local = f - c.in;
  const outT = clamp((f - (c.out - 14)) / 14);
  const chars = Array.from(c.zh);
  const enIn = easeOut(clamp((local - 8) / 18));
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 150,
        textAlign: 'center',
        opacity: 1 - outT,
        filter: outT > 0 ? `blur(${outT * 10}px)` : undefined,
        transform: `translateY(${-outT * 12}px)`,
      }}
    >
      <div
        style={{
          fontFamily: ZH,
          fontWeight: 400,
          fontSize: 50,
          letterSpacing: '0.08em',
          color: '#f3f0ea',
          textShadow: '0 0 22px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9), 0 0 34px rgba(140,180,255,0.22)',
          whiteSpace: 'nowrap',
        }}
      >
        {chars.map((ch, i) => {
          const t = easeOut(clamp((local - i * 0.9) / 12));
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                opacity: t,
                filter: t < 1 ? `blur(${(1 - t) * 8}px)` : undefined,
                transform: `translateY(${(1 - t) * 14}px)`,
                minWidth: ch === ' ' ? '0.3em' : undefined,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 16,
          fontFamily: EN,
          fontWeight: 500,
          fontSize: 18,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'rgba(214,226,255,0.62)',
          opacity: enIn,
          textShadow: '0 0 12px rgba(0,0,0,0.9)',
        }}
      >
        {c.en}
      </div>
      {c.note ? (
        <div
          style={{
            marginTop: 12,
            fontFamily: ZH,
            fontWeight: 300,
            fontSize: 20,
            letterSpacing: '0.12em',
            color: 'rgba(255,236,210,0.55)',
            opacity: enIn,
          }}
        >
          {c.note}
        </div>
      ) : null}
    </div>
  );
};

export const Captions: React.FC = () => {
  const f = useCurrentFrame();
  const active = (TL.captions as Cap[]).filter((c) => f >= c.in && f < c.out);
  return (
    <>
      {active.map((c) => (
        <Line key={c.in} c={c} f={f} />
      ))}
    </>
  );
};
