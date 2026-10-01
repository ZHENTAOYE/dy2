import React from 'react';
import {C} from '../theme';

export const Eye: React.FC<{open: number; x: number; y: number; opacity: number; color?: string; id?: string}> = ({
	open,
	x,
	y,
	opacity,
	color = C.cyan,
	id = 'eyeclip',
}) => {
	const k = 62 * open;
	const d = `M -110 0 Q 0 ${-k * 1.6} 110 0 Q 0 ${k * 1.6} -110 0 Z`;
	return (
		<svg
			width={300}
			height={200}
			viewBox="-150 -100 300 200"
			style={{position: 'absolute', left: x - 150, top: y - 100, opacity, overflow: 'visible'}}
		>
			<defs>
				<clipPath id={id}>
					<path d={d} />
				</clipPath>
			</defs>
			<g clipPath={`url(#${id})`}>
				<circle r={44} fill="none" stroke={color} strokeWidth={6} />
				<circle r={20} fill={color} />
				<circle r={7} cx={-10} cy={-10} fill="#fff" />
			</g>
			<path d={d} fill="none" stroke={C.white} strokeWidth={6} style={{filter: `drop-shadow(0 0 8px ${color})`}} />
			{open < 0.2 ? <line x1={-110} x2={110} y1={0} y2={0} stroke={C.white} strokeWidth={6} /> : null}
		</svg>
	);
};

