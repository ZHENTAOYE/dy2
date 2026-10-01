import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {clamp} from '../lib/math';
import {SceneName, scene} from '../lib/timeline';

const Fader: React.FC<{dur: number; fadeIn: number; fadeOut: number; children: React.ReactNode}> = ({dur, fadeIn, fadeOut, children}) => {
  const f = useCurrentFrame();
  const a = Math.min(fadeIn > 0 ? clamp(f / fadeIn) : 1, fadeOut > 0 ? clamp((dur - f) / fadeOut) : 1);
  return <AbsoluteFill style={{opacity: a}}>{children}</AbsoluteFill>;
};

/** Places a scene at its storyboard slot with crossfade edges. */
export const Scene: React.FC<{name: SceneName; fadeIn?: number; fadeOut?: number; children: React.ReactNode}> = ({
  name,
  fadeIn = 15,
  fadeOut = 15,
  children,
}) => {
  const s = scene(name);
  return (
    <Sequence from={s.from} durationInFrames={s.duration} name={name}>
      <Fader dur={s.duration} fadeIn={fadeIn} fadeOut={fadeOut}>
        {children}
      </Fader>
    </Sequence>
  );
};
