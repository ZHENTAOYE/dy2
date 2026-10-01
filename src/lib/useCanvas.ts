import {useLayoutEffect, useRef} from 'react';

/**
 * Returns a ref for a <canvas>. `draw` runs synchronously on every render
 * (i.e. every frame), so the canvas is always in sync with the frame being
 * captured.
 */
export const useCanvas = (
	draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
	deps: unknown[],
) => {
	const ref = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		draw(ctx, canvas.width, canvas.height);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	return ref;
};
