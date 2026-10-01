import React, {useLayoutEffect, useRef} from 'react';
import {useVideoConfig} from 'remotion';
import {Ctx, clearCtx} from '../lib/canvas';

// A full-frame canvas redrawn synchronously on every frame.
export const CanvasLayer: React.FC<{
  draw: (ctx: Ctx, w: number, h: number) => void;
  style?: React.CSSProperties;
  opaque?: boolean;
}> = ({draw, style, opaque}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const {width, height} = useVideoConfig();
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d', {alpha: !opaque})!;
    clearCtx(ctx, width, height, opaque ? '#000' : undefined);
    draw(ctx, width, height);
  });
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{position: 'absolute', left: 0, top: 0, width, height, ...style}}
    />
  );
};
