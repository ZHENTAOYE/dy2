import React from 'react';
import {useCurrentFrame} from 'remotion';
import {FONT_CN, FONT_NUM} from '../theme';
import {ep} from '../lib/util';

/** Big outlined year in the background + era title block. */
export const EraTitle: React.FC<{
	year: string;
	name: string;
	sub: string;
	color: string;
	start?: number;
	end: number;
	nameFont?: string;
}> = ({year, name, sub, color, start = 0, end, nameFont = FONT_NUM}) => {
	const f = useCurrentFrame();
	const p = ep(f, start, start + 18);
	const out = ep(f, end - 12, end);
	return (
		<div style={{position: 'absolute', inset: 0, opacity: 1 - out, pointerEvents: 'none'}}>
			<div
				style={{
					position: 'absolute',
					top: 150,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontFamily: FONT_NUM,
					fontWeight: 900,
					fontSize: 330,
					color: 'transparent',
					WebkitTextStroke: `3px ${color}`,
					opacity: 0.22 * p,
					transform: `translateX(${(1 - p) * 300 - (f - start) * 0.6}px)`,
					letterSpacing: '0.04em',
				}}
			>
				{year}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 268,
					left: 0,
					right: 0,
					textAlign: 'center',
					opacity: p,
					transform: `translateY(${(1 - p) * -30}px)`,
				}}
			>
				<div
					style={{
						fontFamily: nameFont,
						fontWeight: 900,
						fontSize: 104,
						color: '#fff',
						textShadow: `0 0 24px ${color}, 0 0 60px ${color}`,
						letterSpacing: '0.06em',
						lineHeight: 1.1,
					}}
				>
					{name}
				</div>
				<div
					style={{
						marginTop: 14,
						fontFamily: FONT_CN,
						fontWeight: 700,
						fontSize: 38,
						color,
						letterSpacing: '0.2em',
						textShadow: `0 0 12px ${color}`,
					}}
				>
					{sub}
				</div>
			</div>
		</div>
	);
};
