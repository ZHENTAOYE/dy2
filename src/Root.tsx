import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { FPS, TOTAL } from "./timeline";
import { H, W } from "./lib/theme";
import { loadFonts } from "./lib/fonts";

loadFonts();

export const RemotionRoot: React.FC = () => {
  return (
    <Composition id="Main" component={Video} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
  );
};
