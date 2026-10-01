import React from 'react';
import {Composition, Folder} from 'remotion';
import {loadFonts} from './fonts';
import {Main, ScenePreview} from './Main';
import {FPS, SCENES, TOTAL_FRAMES} from './timeline';

loadFonts();

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="CosmicExpansion"
      component={Main}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{withAudio: true}}
    />
    <Composition
      id="CosmicExpansionVertical"
      component={Main}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{withAudio: true}}
    />
    <Folder name="Scenes">
      {SCENES.map((s) => (
        <Composition
          key={s.id}
          id={`Scene-${s.id}`}
          component={ScenePreview}
          durationInFrames={s.durationInFrames}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{id: s.id}}
        />
      ))}
    </Folder>
  </>
);
