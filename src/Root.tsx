import React from 'react';
import {Composition} from 'remotion';
import {HeatDeath} from './HeatDeath';
import {TL} from './lib/timeline';

export const Root: React.FC = () => (
  <>
    <Composition
      id="HeatDeath"
      component={HeatDeath}
      durationInFrames={TL.durationInFrames}
      fps={TL.fps}
      width={TL.width}
      height={TL.height}
      defaultProps={{audio: true}}
    />
  </>
);
