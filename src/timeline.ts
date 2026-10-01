import data from "./timeline.json";

export type SceneId = (typeof data.scenes)[number]["id"];

export const FPS = data.fps;
export const SCENES = data.scenes;
export const TOTAL = SCENES.reduce((a, s) => a + s.duration, 0);

/** Scene-relative frame of a named cue (also read by the soundtrack generator). */
export const cue = (scene: string, name: string): number => {
  const s = SCENES.find((x) => x.id === scene);
  const v = s ? (s.cues as unknown as Record<string, number>)[name] : undefined;
  if (v === undefined) throw new Error(`Unknown cue ${scene}.${name}`);
  return v;
};

/**
 * Scene-relative frames of a rhythmic event series (e.g. digits slamming in, tokens being generated),
 * from the optional `"ticks": { "<name>": [frames…] }` of a scene. The soundtrack puts a sound on each one.
 */
export const ticks = (scene: string, name: string): number[] => {
  const s = SCENES.find((x) => x.id === scene) as { ticks?: Record<string, number[]> } | undefined;
  const v = s?.ticks?.[name];
  if (!v) throw new Error(`Unknown ticks ${scene}.${name}`);
  return v;
};

export const sceneDuration = (scene: string) => {
  const s = SCENES.find((x) => x.id === scene);
  if (!s) throw new Error(`Unknown scene ${scene}`);
  return s.duration;
};
