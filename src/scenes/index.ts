import React from 'react';
import {SceneId} from '../timeline';
import {SceneHook} from './S01Hook';
import {SceneHubble} from './S02Hubble';
import {SceneSpace} from './S03Space';
import {SceneRewind} from './S04Rewind';
import {SceneBigBang} from './S05BigBang';

export type SceneComponent = React.FC<{dur: number}>;

export const SCENE_COMPONENTS: Partial<Record<SceneId, SceneComponent>> = {
  hook: SceneHook,
  hubble: SceneHubble,
  space: SceneSpace,
  rewind: SceneRewind,
  bigbang: SceneBigBang,
};
