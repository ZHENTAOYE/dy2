import React from 'react';
import {useCurrentFrame} from 'remotion';
import {noise1} from '../lib/math';
import {impactAt} from '../lib/timeline';

/** Applies camera shake + chromatic aberration driven by the global impact list. */
export const ShakeLayer: React.FC<{children: React.ReactNode}> = ({children}) => {
  const f = useCurrentFrame();
  const {shake} = impactAt(f);
  const amp = shake * 26;
  const x = (noise1(f * 0.83 + 11) - 0.5) * 2 * amp;
  const y = (noise1(f * 0.91 + 47) - 0.5) * 2 * amp;
  const rot = (noise1(f * 0.6 + 91) - 0.5) * shake * 0.9;
  const ca = shake * 14;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${1 + shake * 0.035})`,
        filter: ca > 0.6 ? 'url(#rgbsplit)' : undefined,
      }}
    >
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <filter id="rgbsplit" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx={ca} dy={0} result="r2" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="b" dx={-ca} dy={0} result="b2" />
          <feBlend in="r2" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b2" mode="screen" />
        </filter>
      </svg>
      {children}
    </div>
  );
};

export const Flash: React.FC = () => {
  const f = useCurrentFrame();
  const {flash} = impactAt(f);
  if (flash < 0.004) return null;
  return <div style={{position: 'absolute', inset: 0, background: '#fff', opacity: flash * 0.85, mixBlendMode: 'screen'}} />;
};

export const Vignette: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.85) 100%)',
      pointerEvents: 'none',
    }}
  />
);
