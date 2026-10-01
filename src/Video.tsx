import React from "react";
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { SCENES } from "./timeline";
import { C } from "./lib/theme";
import { FilmLook } from "./components/Hud";
import { ColdOpen } from "./scenes/ColdOpen";
import { Title } from "./scenes/Title";
import { Tube } from "./scenes/Tube";
import { Eniac } from "./scenes/Eniac";
import { Transistor } from "./scenes/Transistor";
import { Litho } from "./scenes/Litho";
import { Moore } from "./scenes/Moore";
import { Curve } from "./scenes/Curve";
import { Nano } from "./scenes/Nano";
import { Wall } from "./scenes/Wall";
import { Gpu } from "./scenes/Gpu";
import { Neural } from "./scenes/Neural";
import { AlexNet } from "./scenes/AlexNet";
import { Converge } from "./scenes/Converge";
import { TransformerScene } from "./scenes/Transformer";
import { ZoomOut } from "./scenes/ZoomOut";
import { Compare } from "./scenes/Compare";
import { Finale } from "./scenes/Finale";

const MAP: Record<string, React.FC> = {
  coldopen: ColdOpen,
  title: Title,
  tube: Tube,
  eniac: Eniac,
  transistor: Transistor,
  litho: Litho,
  moore: Moore,
  curve: Curve,
  nano: Nano,
  wall: Wall,
  gpu: Gpu,
  neural: Neural,
  alexnet: AlexNet,
  converge: Converge,
  transformer: TransformerScene,
  zoomout: ZoomOut,
  compare: Compare,
  finale: Finale,
};

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Series>
        {SCENES.map((s) => {
          const Comp = MAP[s.id];
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
