import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, FONT_CN, FONT_NUM} from '../theme';
import {clamp, easeOut} from '../lib/util';

type Token = {t: string; hl: boolean};

const parse = (s: string): Token[] => {
	const out: Token[] = [];
	const re = /\[([^\]]+)\]/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		if (m.index > last) out.push({t: s.slice(last, m.index), hl: false});
		out.push({t: m[1], hl: true});
		last = m.index + m[0].length;
	}
	if (last < s.length) out.push({t: s.slice(last), hl: false});
	return out;
};

const isNumChar = (ch: string) => /[0-9.,×%+\-^]/.test(ch);

/**
 * A caption line. Text in [brackets] is highlighted with the accent colour.
 * Characters reveal one by one; the whole line fades out at `end`.
 */
export const Caption: React.FC<{
	text: string;
	start: number;
	end: number;
	y?: number;
	size?: number;
	accent?: string;
	color?: string;
	weight?: number;
	stagger?: number;
	hlScale?: number;
	style?: React.CSSProperties;
}> = ({
	text,
	start,
	end,
	y = 1330,
	size = 58,
	accent = C.cyan,
	color = C.white,
	weight = 900,
	stagger = 1.2,
	hlScale = 1.18,
	style,
}) => {
	const frame = useCurrentFrame();
	if (frame < start - 1 || frame > end + 1) return null;
	const tokens = parse(text);
	const out = clamp((frame - (end - 10)) / 10);
	let idx = 0;
	return (
		<div
			style={{
				position: 'absolute',
				left: 60,
				right: 60,
				top: y,
				textAlign: 'center',
				fontFamily: FONT_CN,
				fontWeight: weight,
				fontSize: size,
				lineHeight: 1.35,
				color,
				opacity: 1 - out,
				transform: `translateY(${-out * 30}px)`,
				filter: out > 0 ? `blur(${out * 8}px)` : undefined,
				textShadow: '0 4px 24px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)',
				letterSpacing: '0.02em',
				...style,
			}}
		>
			{tokens.map((tok, ti) => (
				<span key={ti}>
					{Array.from(tok.t).map((ch, ci) => {
						const i = idx++;
						const p = easeOut(clamp((frame - start - i * stagger) / 12));
						const isNum = tok.hl && isNumChar(ch);
						return (
							<span
								key={ci}
								style={{
									display: 'inline-block',
									whiteSpace: 'pre',
									opacity: p,
									transform: `translateY(${(1 - p) * 40}px) scale(${0.6 + 0.4 * p})`,
									filter: p < 1 ? `blur(${(1 - p) * 10}px)` : undefined,
									color: tok.hl ? accent : undefined,
									fontFamily: isNum ? FONT_NUM : undefined,
									fontSize: tok.hl ? `${hlScale}em` : undefined,
									textShadow: tok.hl
										? `0 0 18px ${accent}, 0 0 42px ${accent}88, 0 4px 20px rgba(0,0,0,0.9)`
										: undefined,
								}}
							>
								{ch}
							</span>
						);
					})}
				</span>
			))}
		</div>
	);
};

/** Small uppercase-ish technical label, e.g. "1946 · ENIAC". */
export const Tag: React.FC<{
	children: React.ReactNode;
	color?: string;
	style?: React.CSSProperties;
}> = ({children, color = C.cyan, style}) => (
	<div
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			gap: 12,
			padding: '10px 22px',
			border: `2px solid ${color}`,
			borderRadius: 6,
			color,
			fontFamily: FONT_CN,
			fontWeight: 700,
			fontSize: 30,
			letterSpacing: '0.08em',
			background: 'rgba(2,3,8,0.6)',
			boxShadow: `0 0 18px ${color}66, inset 0 0 14px ${color}33`,
			textShadow: `0 0 10px ${color}`,
			...style,
		}}
	>
		{children}
	</div>
);
