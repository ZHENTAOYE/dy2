import React from "react";
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { SCENES } from "./timeline";
import { C } from "./lib/theme";
import { FilmLook } from "./components/Hud";
import { SCENE_COMPONENTS } from "./scenes";

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Series>
        {SCENES.map((s) => {
          const Comp = SCENE_COMPONENTS[s.id];
          return (
            <Series.Sequence key={s.id} durationInFrames={s.duration} name={s.id}>
              <Comp />
            </Series.Sequence>
          );
        })}
      </Series>
      <FilmLook />
      <Audio src={staticFile("soundtrack.wav")} />
    </AbsoluteFill>
  );
};

/** One scene on its own (same film look, no audio) — for previews and stills. */
export const SceneOnly: React.FC<{ id: string }> = ({ id }) => {
  const Comp = SCENE_COMPONENTS[id];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Comp />
      <FilmLook />
    </AbsoluteFill>
  );
};
