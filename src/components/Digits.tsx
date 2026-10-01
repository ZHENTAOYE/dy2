import React from 'react';
import {FONT_NUM} from '../theme';

/**
 * Renders a string of digits with fixed-width cells so counting numbers
 * never jitter horizontally. Commas/dots get narrower cells.
 */
export const Digits: React.FC<{
	value: string;
	size: number;
	color: string;
	glow?: string;
	weight?: number;
	cell?: number;
	style?: React.CSSProperties;
	charStyle?: (i: number, ch: string) => React.CSSProperties | undefined;
}> = ({value, size, color, glow, weight = 900, cell = 0.86, style, charStyle}) => {
	const g = glow ?? color;
	return (
		<div
			style={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'baseline',
				fontFamily: FONT_NUM,
				fontWeight: weight,
				fontSize: size,
				color,
				lineHeight: 1,
				textShadow: `0 0 ${size * 0.12}px ${g}, 0 0 ${size * 0.4}px ${g}99`,
				...style,
			}}
		>
			{Array.from(value).map((ch, i) => {
				const narrow = ch === ',' || ch === '.' || ch === ' ';
				return (
					<span
						key={i}
						style={{
							display: 'inline-block',
							width: narrow ? `${cell * 0.38}em` : /[0-9]/.test(ch) ? `${cell}em` : undefined,
							textAlign: 'center',
							...charStyle?.(i, ch),
						}}
					>
						{ch}
					</span>
				);
			})}
		</div>
	);
};

const SUP: Record<string, string> = {
	'0': '⁰',
	'1': '¹',
	'2': '²',
	'3': '³',
	'4': '⁴',
	'5': '⁵',
	'6': '⁶',
	'7': '⁷',
	'8': '⁸',
	'9': '⁹',
	'-': '⁻',
	'.': '·',
};

export const sup = (n: number | string) =>
	String(n)
		.split('')
		.map((c) => SUP[c] ?? c)
		.join('');
