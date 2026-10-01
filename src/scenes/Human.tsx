import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Glow, Shockwave} from '../components/Fx';
import {ladderY} from '../components/Ladder';
import {C, FONT_CN, FONT_NUM} from '../theme';
import {clamp, easeInOut, ep, lerp} from '../lib/util';

const HEAD = {x: 540, y: 690, r: 118};

export const Human: React.FC = () => {
	const f = useCurrentFrame();
	const draw = ep(f, 0, 34, easeInOut);
	const inP = ep(f, 0, 16);
	const out = ep(f, 196, 210);

	// equation typed in, answer pops after one "thinking" second
	const eq = '7 × 8 = ';
	const typed = Math.floor(clamp((f - 28) / 12) * eq.length);
	const think = clamp((f - 42) / 30);
	const answered = f >= 74;
	const ansP = ep(f, 74, 84);

	// the single operation flies to the ladder at 10^0
	const fly = ep(f, 104, 124, easeInOut);
	const dotX = lerp(HEAD.x, 66, fly);
	const dotY = lerp(HEAD.y, ladderY(0), fly) - Math.sin(fly * Math.PI) * 180;

	const shoulders = 'M 290 1060 C 300 900 400 860 540 860 C 680 860 780 900 790 1060';
	const pulse = 0.5 + 0.5 * Math.sin(f / 5);

	return (
		<AbsoluteFill style={{opacity: 1 - out, transform: `scale(${1 + out * 0.15})`}}>
			<Glow x={HEAD.x} y={HEAD.y} r={420} color="#2a4cff" opacity={0.25 * inP} />
			<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
				<circle
					cx={HEAD.x}
					cy={HEAD.y}
					r={HEAD.r}
					fill="rgba(120,160,255,0.06)"
					stroke={C.human}
					strokeWidth={8}
					strokeDasharray={2 * Math.PI * HEAD.r}
					strokeDashoffset={(1 - draw) * 2 * Math.PI * HEAD.r}
					style={{filter: `drop-shadow(0 0 12px ${C.blue})`}}
				/>
				<path
					d={shoulders}
					fill="none"
					stroke={C.human}
					strokeWidth={8}
					strokeLinecap="round"
					pathLength={1}
					strokeDasharray={1}
					strokeDashoffset={1 - draw}
					style={{filter: `drop-shadow(0 0 12px ${C.blue})`}}
				/>
				{/* thinking ring */}
				{f > 42 && !answered ? (
					<circle
						cx={HEAD.x}
						cy={HEAD.y}
						r={HEAD.r + 26}
						fill="none"
						stroke={C.cyan}
						strokeWidth={6}
						strokeLinecap="round"
						pathLength={1}
						strokeDasharray={`${think} 1`}
						transform={`rotate(-90 ${HEAD.x} ${HEAD.y})`}
						opacity={0.9}
					/>
				) : null}
			</svg>
			{/* brain spark */}
			<Glow x={HEAD.x} y={HEAD.y} r={60 + pulse * 20} color={C.cyan} opacity={f > 42 && f < 104 ? 0.6 + pulse * 0.4 : 0} />

			{/* equation */}
			<div
				style={{
					position: 'absolute',
					top: 380,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontFamily: FONT_NUM,
					fontWeight: 700,
					fontSize: 96,
					color: C.white,
					textShadow: `0 0 20px ${C.blue}`,
				}}
			>
				{eq.slice(0, typed)}
				{answered ? (
					<span style={{display: 'inline-block', color: C.cyan, transform: `scale(${1.6 - 0.6 * ansP})`, textShadow: `0 0 30px ${C.cyan}`}}>
						56
					</span>
				) : typed >= eq.length ? (
					<span style={{color: C.dim, opacity: 0.4 + 0.6 * pulse}}>?</span>
				) : null}
			</div>

			{/* 1 op/s readout */}
			<div
				style={{
					position: 'absolute',
					top: 1100,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 18,
					opacity: ep(f, 120, 132),
					transform: `scale(${1.4 - 0.4 * ep(f, 120, 132)})`,
				}}
			>
				<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 150, color: C.white, textShadow: `0 0 30px ${C.blue}`}}>1</span>
				<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 64, color: C.human}}>次 / 秒</span>
			</div>

			{/* the flying operation */}
			{f >= 100 && f < 140 ? (
				<>
					<Glow x={dotX} y={dotY} r={70} color={C.cyan} opacity={1 - ep(f, 124, 140)} />
					<div
						style={{
							position: 'absolute',
							left: dotX - 12,
							top: dotY - 12,
							width: 24,
							height: 24,
							borderRadius: '50%',
							background: '#fff',
							boxShadow: `0 0 24px 8px ${C.cyan}`,
							opacity: 1 - ep(f, 124, 140),
						}}
					/>
				</>
			) : null}
			<Shockwave x={66} y={ladderY(0)} at={122} color={C.cyan} radius={260} duration={22} width={10} />

			<Caption text="先看看我们自己" start={4} end={40} />
			<Caption text="心算一道题，大约要 [1] 秒" start={42} end={104} />
			<Caption text="这就是起点：每秒 [1] 次" start={110} end={200} accent={C.human} />
		</AbsoluteFill>
	);
};
