import React from 'react';
import {AbsoluteFill, Audio, staticFile} from 'remotion';
import {Captions} from './components/Captions';
import {Flash, ShakeLayer, Vignette} from './components/Effects';
import {Hud} from './components/Hud';
import {Scene} from './components/Scene';
import {useFonts} from './lib/fonts';
import {Open} from './scenes/S0Open';
import {Entropy} from './scenes/S1Entropy';
import {Stars} from './scenes/S2Stars';
import {Collapse} from './scenes/S3Collapse';
import {Degenerate} from './scenes/S4Degenerate';
import {BlackHole} from './scenes/S5BlackHole';

export const HeatDeath: React.FC<{audio?: boolean}> = ({audio = true}) => {
  useFonts();
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ShakeLayer>
        <Scene name="open" fadeIn={0} fadeOut={20}>
          <Open />
        </Scene>
        <Scene name="entropy" fadeIn={15} fadeOut={15}>
          <Entropy />
        </Scene>
        <Scene name="stars" fadeIn={10} fadeOut={20}>
          <Stars />
        </Scene>
        <Scene name="collapse" fadeIn={20} fadeOut={10}>
          <Collapse />
        </Scene>
        <Scene name="degenerate" fadeIn={20} fadeOut={20}>
          <Degenerate />
        </Scene>
        <Scene name="blackhole" fadeIn={2} fadeOut={20}>
          <BlackHole />
        </Scene>
      </ShakeLayer>
      <Vignette />
      <Hud />
      <Captions />
      <Flash />
      {audio ? <Audio src={staticFile('soundtrack.wav')} /> : null}
    </AbsoluteFill>
  );
};
