import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, FONT_CN, FONT_MONO, FONT_NUM} from '../theme';
import {LADDER, sceneStart} from '../timeline';
import {clamp, easeOut, lerp} from '../lib/util';
import {sup} from './Digits';

const X = 66;
const Y0 = 1236;
const Y18 = 318;
export const ladderY = (e: number) => Y0 - (e / 18) * (Y0 - Y18);

const MILESTONE_COLORS = [C.human, C.amber, C.green, C.cyan, C.magenta, C.red];

/** Current exponent shown on the ladder at a global frame. */
export const ladderExp = (f: number) => {
	let e = 0;
	for (let i = 0; i < LADDER.length; i++) {
		const m = LADDER[i];
		const prev = i === 0 ? 0 : LADDER[i - 1].exp;
		const t = clamp((f - (m.at - 14)) / 34);
		if (f >= m.at - 14) e = lerp(prev, m.exp, easeOut(t));
	}
	return e;
};

const colorFor = (e: number) => {
	let c = MILESTONE_COLORS[0];
	LADDER.forEach((m, i) => {
		if (e >= m.exp - 0.6) c = MILESTONE_COLORS[i];
	});
	return c;
};

/**
 * Persistent log-scale "operations per second" ladder on the left edge.
 * It climbs with every era and is the film's running sense of escalation.
 */
export const Ladder: React.FC = () => {
	const frame = useCurrentFrame();
	const appear = sceneStart('human') + 90;
	if (frame < appear) return null;
	const grow = easeOut(clamp((frame - appear) / 40));
	const e = ladderExp(frame);
	const y = ladderY(Math.min(e, 18.4));
	const col = colorFor(e);
	const fin = sceneStart('finale');
	// Every milestone blazes at the final "1 秒" slam.
	const blaze = clamp(1 - Math.abs(frame - (fin + 706)) / 40);
	const dim =
		frame < fin + 300
			? 1
			: frame < fin + 600
				? 0.35
				: frame < fin + 700
					? 0.35 * (1 - clamp((frame - fin - 600) / 12))
					: clamp((frame - fin - 700) / 3);

	const ticks = [];
	for (let i = 0; i <= 18; i++) {
		const ty = ladderY(i);
		const major = i % 3 === 0;
		const lit = e >= i;
		ticks.push(
			<React.Fragment key={i}>
				<div
					style={{
						position: 'absolute',
						left: X - (major ? 12 : 6),
						top: ty - 1,
						width: major ? 24 : 12,
						height: 2,
						background: lit ? col : '#41506e',
						boxShadow: lit ? `0 0 8px ${col}` : undefined,
					}}
				/>
				{major ? (
					<div
						style={{
							position: 'absolute',
							left: 0,
							width: X - 16,
							top: ty - 13,
							textAlign: 'right',
							fontFamily: FONT_MONO,
							fontSize: 19,
							color: lit ? col : '#5b6886',
							textShadow: lit ? `0 0 8px ${col}` : undefined,
						}}
					>
						10{sup(i)}
					</div>
				) : null}
			</React.Fragment>,
		);
	}

	return (
		<div style={{position: 'absolute', inset: 0, opacity: grow * dim, pointerEvents: 'none'}}>
			{/* caption on top */}
			<div
				style={{
					position: 'absolute',
					left: 18,
					top: Y18 - 92,
					fontFamily: FONT_CN,
					fontWeight: 700,
					fontSize: 20,
					lineHeight: 1.3,
					color: '#9fb0d0',
					letterSpacing: '0.06em',
				}}
			>
				每秒
				<br />
				运算次数
			</div>
			{/* rail */}
			<div
				style={{
					position: 'absolute',
					left: X - 1.5,
					top: lerp(Y0, Y18 - 20, grow),
					height: (Y0 - Y18 + 20) * grow,
					width: 3,
					background: 'linear-gradient(to top, #2a3550, #1a2236)',
				}}
			/>
			{ticks}
			{/* mercury fill */}
			<div
				style={{
					position: 'absolute',
					left: X - 4,
					top: y,
					height: Y0 - y,
					width: 8,
					borderRadius: 4,
					background: `linear-gradient(to top, ${C.human}, ${C.amber} 20%, ${C.green} 30%, ${C.cyan} 62%, ${C.magenta} 82%, ${C.red} 100%)`,
					backgroundSize: `8px ${Y0 - Y18}px`,
					backgroundPosition: 'bottom',
					boxShadow: `0 0 16px ${col}, 0 0 4px ${col}`,
				}}
			/>
			{/* marker */}
			<div
				style={{
					position: 'absolute',
					left: X - 13,
					top: y - 13,
					width: 26,
					height: 26,
					borderRadius: '50%',
					background: '#fff',
					boxShadow: `0 0 18px 6px ${col}, 0 0 50px 10px ${col}88`,
				}}
			/>
			{/* milestone labels */}
			{LADDER.map((m, i) => {
				const p = easeOut(clamp((frame - m.at) / 16));
				if (p <= 0) return null;
				const c = MILESTONE_COLORS[i];
				const hot = clamp(1 - (frame - m.at) / 45) + blaze;
				return (
					<div
						key={m.label}
						style={{
							position: 'absolute',
							left: X + 22,
							top: ladderY(Math.min(m.exp, 18.2)) - 14,
							opacity: p,
							transform: `translateX(${(1 - p) * -20}px) scale(${1 + hot * 0.25})`,
							transformOrigin: 'left center',
							display: 'flex',
							alignItems: 'baseline',
							gap: 6,
							whiteSpace: 'nowrap',
						}}
					>
						<span
							style={{
								fontFamily: m.label.match(/[A-Z0-9]/) && !m.label.match(/[一-龥]/) ? FONT_NUM : FONT_CN,
								fontWeight: 700,
								fontSize: 22,
								color: c,
								textShadow: `0 0 ${8 + hot * 16}px ${c}`,
								background: 'rgba(2,3,8,0.55)',
								padding: '1px 5px',
								borderRadius: 3,
							}}
						>
							{m.label}
						</span>
					</div>
				);
			})}
		</div>
	);
};
