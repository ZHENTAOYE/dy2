import React from 'react';
import {AbsoluteFill, Html5Audio, Sequence, getStaticFiles, staticFile} from 'remotion';
import {Background} from './components/Background';
import {Ladder} from './components/Ladder';
import {Overlay, Shake} from './components/Overlay';
import {Transitions} from './components/Transitions';
import {C} from './theme';
import {SCENES, SceneId} from './timeline';
import {Hook} from './scenes/Hook';
import {Human} from './scenes/Human';
import {Eniac} from './scenes/Eniac';
import {Intel4004} from './scenes/Intel4004';
import {Cpu} from './scenes/Cpu';
import {Dilation} from './scenes/Dilation';
import {Gpu} from './scenes/Gpu';
import {Super} from './scenes/Super';
import {Finale} from './scenes/Finale';

const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
	hook: Hook,
	human: Human,
	eniac: Eniac,
	i4004: Intel4004,
	cpu: Cpu,
	dilation: Dilation,
	gpu: Gpu,
	super: Super,
	finale: Finale,
};

const hasSoundtrack = () => getStaticFiles().some((f) => f.name === 'soundtrack.wav');

export const OneSecond: React.FC = () => (
	<AbsoluteFill style={{background: C.bg}}>
		<Shake>
			<Background />
			{SCENES.map((s) => {
				const Comp = SCENE_COMPONENTS[s.id];
				return (
					<Sequence key={s.id} name={s.id} from={s.from} durationInFrames={s.duration}>
						<Comp />
					</Sequence>
				);
			})}
			<Ladder />
			<Transitions />
		</Shake>
		<Overlay />
		{hasSoundtrack() ? <Html5Audio src={staticFile('soundtrack.wav')} /> : null}
	</AbsoluteFill>
);
