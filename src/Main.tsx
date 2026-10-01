import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {FilmOverlay} from './components/Chrome';
import {SCENE_COMPONENTS} from './scenes';
import {FPS, SCENES, SceneId} from './timeline';

export const SceneById: React.FC<{id: SceneId; dur: number}> = ({id, dur}) => {
  const C = SCENE_COMPONENTS[id];
  if (!C) return <AbsoluteFill style={{background: '#000'}} />;
  return <C dur={dur} />;
};

export const Main: React.FC<{withAudio?: boolean}> = ({withAudio = true}) => (
  <AbsoluteFill style={{background: '#000'}}>
    {SCENES.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames} name={s.id}>
        <SceneById id={s.id} dur={s.durationInFrames / FPS} />
      </Sequence>
    ))}
    <FilmOverlay />
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
