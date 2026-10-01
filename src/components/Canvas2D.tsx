import React, {useLayoutEffect, useRef} from 'react';
import {useCurrentFrame} from 'remotion';
import {H, W} from '../lib/timeline';

export type DrawFn = (ctx: CanvasRenderingContext2D, frame: number, w: number, h: number) => void;

/** A full-frame 2D canvas redrawn from scratch on every frame (renders stay order-independent). */
export const Canvas2D: React.FC<{
  draw: DrawFn;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}> = ({draw, width = W, height = H, style}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d', {willReadFrequently: false})!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, width, height);
    draw(ctx, frame, width, height);
  });
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{position: 'absolute', inset: 0, width: '100%', height: '100%', ...style}}
    />
  );
};
