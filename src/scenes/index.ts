import type React from "react";
import { ColdOpen } from "./ColdOpen";
import { Title } from "./Title";
import { Tube } from "./Tube";
import { Eniac } from "./Eniac";
import { Transistor } from "./Transistor";
import { Litho } from "./Litho";
import { Moore } from "./Moore";
import { Curve } from "./Curve";
import { Nano } from "./Nano";
import { Wall } from "./Wall";
import { Gpu } from "./Gpu";
import { Neural } from "./Neural";
import { AlexNet } from "./AlexNet";
import { Converge } from "./Converge";
import { TransformerScene } from "./Transformer";
import { ZoomOut } from "./ZoomOut";
import { Compare } from "./Compare";
import { Finale } from "./Finale";

/** Scene id (as in timeline.json) -> component. */
export const SCENE_COMPONENTS: Record<string, React.FC> = {
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
