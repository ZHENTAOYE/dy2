import React from "react";
import { Composition, Folder } from "remotion";
import { SceneOnly, Video } from "./Video";
import { FPS, SCENES, TOTAL } from "./timeline";
import { H, W } from "./lib/theme";
import { loadFonts } from "./lib/fonts";

loadFonts();

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Main" component={Video} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
      <Folder name="Scenes">
        {SCENES.map((s) => (
          <Composition
            key={s.id}
            id={`scene-${s.id}`}
            component={SceneOnly}
            defaultProps={{ id: s.id }}
            durationInFrames={s.duration}
            fps={FPS}
            width={W}
            height={H}
          />
        ))}
      </Folder>
    </>
  );
};
