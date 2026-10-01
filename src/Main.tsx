import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {FilmOverlay} from './components/Chrome';
import {clamp} from './lib/math';
import {SCENE_COMPONENTS} from './scenes';
import {FPS, SCENES, SceneId} from './timeline';

// Crossfades into a scene (seconds). The previous scene keeps running underneath
// while this one fades in on top, so slots and audio cue times stay unchanged.
const XFADE_IN: Partial<Record<SceneId, number>> = {
  cmb: 0.6, // density fluctuations dissolve into the primordial plasma
};

export const SceneById: React.FC<{id: SceneId; dur: number}> = ({id, dur}) => {
  const C = SCENE_COMPONENTS[id];
  if (!C) return <AbsoluteFill style={{background: '#000'}} />;
  return <C dur={dur} />;
};

const FadeIn: React.FC<{frames: number; children: React.ReactNode}> = ({frames, children}) => {
  const frame = useCurrentFrame();
  if (frames <= 0 || frame >= frames) return <>{children}</>;
  return <AbsoluteFill style={{opacity: clamp(frame / frames)}}>{children}</AbsoluteFill>;
};

export const Main: React.FC<{withAudio?: boolean; grain?: number}> = ({withAudio = true, grain}) => (
  <AbsoluteFill style={{background: '#000'}}>
    {SCENES.map((s, i) => {
      const next = SCENES[i + 1];
      const tail = next ? Math.round((XFADE_IN[next.id] ?? 0) * FPS) : 0;
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames + tail} name={s.id}>
          <FadeIn frames={Math.round((XFADE_IN[s.id] ?? 0) * FPS)}>
            <SceneById id={s.id} dur={s.durationInFrames / FPS} />
          </FadeIn>
        </Sequence>
      );
    })}
    <FilmOverlay grain={grain} />
    {withAudio ? <Audio src={staticFile('audio/soundtrack.mp3')} /> : null}
  </AbsoluteFill>
);

// Single scene with the global overlay, for previews and stills.
export const ScenePreview: React.FC<{id: SceneId}> = ({id}) => {
  const slot = SCENES.find((s) => s.id === id)!;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <SceneById id={id} dur={slot.durationInFrames / FPS} />
      <FilmOverlay />
    </AbsoluteFill>
  );
};
