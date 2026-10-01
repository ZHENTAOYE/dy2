import data from './timeline.json';

export type SceneId =
	| 'hook'
	| 'human'
	| 'eniac'
	| 'i4004'
	| 'cpu'
	| 'dilation'
	| 'gpu'
	| 'super'
	| 'finale';

export const FPS = data.fps;
export const WIDTH = data.width;
export const HEIGHT = data.height;

export const SCENES = (() => {
	let from = 0;
	return data.scenes.map((s) => {
		const out = {id: s.id as SceneId, from, duration: s.duration};
		from += s.duration;
		return out;
	});
})();

export const TOTAL_FRAMES = SCENES.reduce((a, s) => a + s.duration, 0);

export const sceneStart = (id: SceneId) => {
	const s = SCENES.find((x) => x.id === id);
	if (!s) throw new Error(`Unknown scene ${id}`);
	return s.from;
};

export const IMPACTS = data.impacts.map((i) => ({
	at: sceneStart(i.scene as SceneId) + i.frame,
	power: i.power,
}));

export const LADDER = data.ladder.map((l) => ({
	at: sceneStart(l.scene as SceneId) + l.frame,
	exp: l.exp,
	label: l.label,
}));

/** Index of the scene active at a global frame. */
export const sceneAt = (frame: number) => {
	for (let i = SCENES.length - 1; i >= 0; i--) {
		if (frame >= SCENES[i].from) return i;
	}
	return 0;
};
