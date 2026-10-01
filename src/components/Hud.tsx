import React from 'react';
import {useCurrentFrame} from 'remotion';
import {EN, MONO, SERIF, ZH} from '../lib/fonts';
import {L} from '../lib/labels';
import {clamp, windowed} from '../lib/math';
import {TL, logTimeAt} from '../lib/timeline';

const X0 = 200;
const X1 = 1720;
const EMAX = 110;
const xOf = (e: number) => X0 + (clamp(e, 0, EMAX) / EMAX) * (X1 - X0);

const ERAS: {from: number; to: number; zh: string; en: string; color: string}[] = [
  {from: 0, to: 6, zh: L.eras[0], en: 'PRIMORDIAL ERA', color: '#8a9bb5'},
  {from: 6, to: 14, zh: L.eras[1], en: 'STELLIFEROUS ERA', color: '#ffc56b'},
  {from: 14, to: 40, zh: L.eras[2], en: 'DEGENERATE ERA', color: '#7fd6ff'},
  {from: 40, to: 100, zh: L.eras[3], en: 'BLACK HOLE ERA', color: '#b48cff'},
  {from: 100, to: EMAX, zh: L.eras[4], en: 'DARK ERA', color: '#6b7280'},
];

export const eraOf = (e: number) => ERAS.find((er) => e < er.to) ?? ERAS[ERAS.length - 1];

const Sup: React.FC<{children: React.ReactNode; size: number}> = ({children, size}) => (
  <span style={{fontSize: size, verticalAlign: 'super', lineHeight: 0, marginLeft: 2}}>{children}</span>
);

export const Hud: React.FC = () => {
  const f = useCurrentFrame();
  const h = TL.hud;
  const vis = Math.max(windowed(f, h.in, h.out, 30, 45), windowed(f, h.epilogueIn, h.epilogueOut, 12, 40));
  if (vis <= 0) return null;
  const e = logTimeAt(f);
  const prev = logTimeAt(f - 1);
  const speed = Math.abs(e - prev);
  const era = eraOf(e);
  let mant = Math.pow(10, e - Math.floor(e));
  let exp = Math.floor(e);
  if (mant >= 9.95) {
    mant = 1;
    exp += 1;
  }
  const mx = xOf(e);
  const jitter = speed > 0.05 ? (Math.sin(f * 12.9) * 0.5 + 0.5) * Math.min(1, speed * 3) : 0;

  return (
    <div style={{position: 'absolute', inset: 0, opacity: vis, pointerEvents: 'none'}}>
      {/* readout */}
      <div style={{position: 'absolute', left: 84, top: 62}}>
        <div style={{fontFamily: ZH, fontSize: 17, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.55)'}}>
          {L.age}
          <span style={{fontFamily: EN, fontSize: 12, letterSpacing: '0.32em', marginLeft: 14, color: 'rgba(255,255,255,0.38)'}}>
            AGE OF THE UNIVERSE
          </span>
        </div>
        <div
          style={{
            fontFamily: EN,
            fontWeight: 200,
            fontSize: 64,
            color: '#fff',
            marginTop: 6,
            letterSpacing: '0.02em',
            textShadow: `0 0 ${18 + jitter * 30}px ${era.color}88`,
            transform: `translateX(${jitter * 2}px)`,
          }}
        >
          {e >= 139.5 ? (
            <span>∞</span>
          ) : (
            <>
              <span style={{fontFamily: MONO, fontWeight: 400, fontSize: 52}}>{mant.toFixed(1)}</span>
              <span style={{margin: '0 12px', opacity: 0.6}}>×</span>
              10
              <Sup size={34}>
                <span style={{fontFamily: MONO, fontWeight: 700}}>{exp}</span>
              </Sup>
            </>
          )}
          <span style={{fontFamily: ZH, fontWeight: 300, fontSize: 30, marginLeft: 16, opacity: 0.8}}>{L.year}</span>
        </div>
      </div>
      {/* era badge */}
      <div style={{position: 'absolute', right: 84, top: 66, textAlign: 'right'}}>
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: '0.2em',
            color: era.color,
            textShadow: `0 0 24px ${era.color}aa`,
          }}
        >
          {era.zh}
        </div>
        <div style={{fontFamily: EN, fontWeight: 500, fontSize: 13, letterSpacing: '0.4em', color: 'rgba(255,255,255,0.5)', marginTop: 6}}>
          {era.en}
        </div>
      </div>
      {/* axis */}
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <defs>
          <filter id="hudglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <line x1={X0} x2={X1 + 30} y1={1010} y2={1010} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        <path d={`M ${X1 + 30} 1005 L ${X1 + 40} 1010 L ${X1 + 30} 1015`} stroke="rgba(255,255,255,0.35)" fill="none" />
        {ERAS.map((er) => {
          const active = er === era;
          return (
            <g key={er.en}>
              <rect
                x={xOf(er.from) + 1}
                y={1004}
                width={xOf(er.to) - xOf(er.from) - 2}
                height={active ? 4 : 2}
                fill={er.color}
                opacity={active ? 0.95 : 0.35}
              />
              {xOf(er.to) - xOf(er.from) > 60 ? (
                <text
                  x={(xOf(er.from) + xOf(er.to)) / 2}
                  y={992}
                  textAnchor="middle"
                  fontFamily={ZH}
                  fontSize={14}
                  letterSpacing="0.2em"
                  fill={er.color}
                  opacity={active ? 0.95 : 0.4}
                >
                  {er.zh}
                </text>
              ) : null}
            </g>
          );
        })}
        {Array.from({length: 11}, (_, i) => i * 10).map((k) => (
          <g key={k}>
            <line x1={xOf(k)} x2={xOf(k)} y1={1010} y2={1018} stroke="rgba(255,255,255,0.4)" />
            <text x={xOf(k)} y={1040} textAnchor="middle" fontFamily={MONO} fontSize={13} fill="rgba(255,255,255,0.45)">
              10
              <tspan dy={-6} fontSize={10}>
                {k}
              </tspan>
            </text>
          </g>
        ))}
        {Array.from({length: 101}, (_, i) => i).filter((k) => k % 10 !== 0).map((k) => (
          <line key={k} x1={xOf(k)} x2={xOf(k)} y1={1010} y2={1013} stroke="rgba(255,255,255,0.18)" />
        ))}
        {/* marker */}
        <line x1={xOf(0)} x2={mx} y1={1010} y2={1010} stroke={era.color} strokeWidth={1.5} opacity={0.6} />
        <circle cx={mx} cy={1010} r={10 + jitter * 6} fill={era.color} opacity={0.5} filter="url(#hudglow)" />
        <circle cx={mx} cy={1010} r={4} fill="#fff" />
        <line x1={mx} x2={mx} y1={968} y2={1002} stroke="#fff" strokeOpacity={0.5} />
        {Math.abs(e - 10.14) < 0.02 ? (
          <text x={mx} y={958} textAnchor="middle" fontFamily={ZH} fontSize={16} fill="#fff" letterSpacing="0.2em">
            {L.now}
          </text>
        ) : null}
      </svg>
    </div>
  );
};
