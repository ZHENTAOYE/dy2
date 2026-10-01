import React from 'react';
import {Composition} from 'remotion';
import './fonts';
import {OneSecond} from './OneSecond';
import {FPS, HEIGHT, TOTAL_FRAMES, WIDTH} from './timeline';

export const RemotionRoot: React.FC = () => (
	<Composition
		id="OneSecond"
		component={OneSecond}
		durationInFrames={TOTAL_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
	/>
);
