import React from 'react';
import {useCurrentFrame} from 'remotion';
import {IMPACTS} from '../timeline';
import {mulberry, noise1} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

/** Film grain + vignette + scanlines + impact flashes, on top of everything. */
export const Overlay: React.FC = () => {
	const frame = useCurrentFrame();
	const ref = useCanvas(
		(ctx, w, h) => {
			const img = ctx.createImageData(w, h);
			const r = mulberry(frame * 7919 + 13);
			for (let i = 0; i < img.data.length; i += 4) {
				const v = r() * 255;
				img.data[i] = v;
				img.data[i + 1] = v;
				img.data[i + 2] = v;
				img.data[i + 3] = 255;
			}
			ctx.putImageData(img, 0, 0);
		},
		[frame],
	);
	let flash = 0;
	for (const im of IMPACTS) {
		const d = frame - im.at;
		if (d >= 0 && d < 30) flash = Math.max(flash, im.power * 0.32 * Math.exp(-d / 5));
	}
	return (
		<div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
			<canvas
				ref={ref}
				width={270}
				height={480}
				style={{
					position: 'absolute',
					inset: 0,
					width: '100%',
					height: '100%',
					opacity: 0.075,
					mixBlendMode: 'overlay',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background:
						'repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 4px)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: 'radial-gradient(ellipse 75% 60% at 50% 45%, transparent 55%, rgba(0,0,0,0.75) 100%)',
				}}
			/>
			{flash > 0.001 ? (
				<div style={{position: 'absolute', inset: 0, background: '#fff', opacity: flash, mixBlendMode: 'screen'}} />
			) : null}
		</div>
	);
};

/** Shake offset for the global camera based on the impact list. */
export const useShake = () => {
	const frame = useCurrentFrame();
	let amp = 0;
	for (const im of IMPACTS) {
		const d = frame - im.at;
		if (d >= 0 && d < 30) amp += im.power * 34 * Math.exp(-d / 5.5);
	}
	if (amp < 0.05) return {x: 0, y: 0, r: 0, s: 1};
	return {
		x: amp * noise1(frame * 1.7, 11),
		y: amp * noise1(frame * 1.7, 23),
		r: amp * 0.025 * noise1(frame * 1.3, 37),
		s: 1 + amp * 0.0012,
	};
};

export const Shake: React.FC<{children: React.ReactNode}> = ({children}) => {
	const s = useShake();
	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(${s.s})`,
			}}
		>
			{children}
		</div>
	);
};
