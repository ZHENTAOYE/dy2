import data from './timeline.json';

export type SceneId =
  | 'hook'
  | 'hubble'
  | 'space'
  | 'rewind'
  | 'bigbang'
  | 'cmb'
  | 'web'
  | 'darkenergy'
  | 'observable'
  | 'finale';

export const FPS: number = data.fps;

export type SceneSlot = {id: SceneId; from: number; durationInFrames: number};

export const SCENES: SceneSlot[] = (() => {
  let from = 0;
  return data.scenes.map((s) => {
    const durationInFrames = Math.round(s.duration * FPS);
    const slot = {id: s.id as SceneId, from, durationInFrames};
    from += durationInFrames;
    return slot;
  });
})();

export const TOTAL_FRAMES = SCENES.reduce((acc, s) => acc + s.durationInFrames, 0);

export const sceneDuration = (id: SceneId) =>
  SCENES.find((s) => s.id === id)!.durationInFrames;
