import React from 'react';
import {random, useCurrentFrame} from 'remotion';

/**
 * RGB-split + slice-displacement glitch. `render(color?)` must draw the
 * content, using `color` (when given) instead of its normal colours so the
 * channel copies come out red/cyan.
 */
export const Glitch: React.FC<{
	render: (color?: string) => React.ReactNode;
	amount: number;
	seed?: string;
	style?: React.CSSProperties;
}> = ({render, amount, seed = 'g', style}) => {
	const frame = useCurrentFrame();
	const a = Math.max(0, amount);
	const r = (k: string) => random(`${seed}-${frame}-${k}`) * 2 - 1;
	const dx = a * 24 * r('dx');
	const dy = a * 6 * r('dy');
	const slices =
		a > 0.15
			? [0, 1, 2].map((i) => {
					const top = Math.abs(r(`t${i}`)) * 90;
					const h = 3 + Math.abs(r(`h${i}`)) * 14;
					return {top, bottom: Math.max(0, 100 - top - h), shift: r(`s${i}`) * 70 * a};
				})
			: [];
	return (
		<div style={{position: 'relative', ...style}}>
			{a > 0.02 ? (
				<>
					<div
						style={{
							position: 'absolute',
							inset: 0,
							transform: `translate(${-dx}px, ${dy}px)`,
							mixBlendMode: 'screen',
							opacity: 0.9,
						}}
					>
						{render('#ff2350')}
					</div>
					<div
						style={{
							position: 'absolute',
							inset: 0,
							transform: `translate(${dx}px, ${-dy}px)`,
							mixBlendMode: 'screen',
							opacity: 0.9,
						}}
					>
						{render('#19e6ff')}
					</div>
				</>
			) : null}
			<div style={{position: 'relative'}}>{render()}</div>
			{slices.map((s, i) => (
				<div
					key={i}
					style={{
						position: 'absolute',
						inset: 0,
						clipPath: `inset(${s.top}% 0 ${s.bottom}% 0)`,
						transform: `translateX(${s.shift}px)`,
					}}
				>
					{render()}
				</div>
			))}
		</div>
	);
};

/** Glitch intensity envelope: spikes at the given frames and decays. */
export const glitchAt = (frame: number, hits: number[], decay = 6) => {
	let v = 0;
	for (const h of hits) {
		const d = frame - h;
		if (d >= 0) v = Math.max(v, Math.exp(-d / decay));
	}
	return v;
};
