import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {Glitch, glitchAt} from '../components/Glitch';
import {Eye} from '../components/Eye';
import {C, FONT_CN, FONT_MONO, FONT_NUM} from '../theme';
import {clamp, easeIn, ep, prog} from '../lib/util';

const CX = 540;
const CY = 760;
const R = 290;
const SWEEP_START = 14;
const SWEEP_END = 44; // exactly 30 frames = 1 real second

export const Hook: React.FC = () => {
	const f = useCurrentFrame();

	// --- the one-second sweep -------------------------------------------
	const sweep = clamp((f - SWEEP_START) / (SWEEP_END - SWEEP_START));
	const theta = sweep * Math.PI * 2;
	const headX = CX + Math.sin(theta) * R;
	const headY = CY - Math.cos(theta) * R;
	const clockOut = ep(f, 150, 166, easeIn);
	const clockScale = 1 - 0.1 * ep(f, 100, 140) + clockOut * 2.5;
	const clockOpacity = clamp((f + 8) / 10) * (1 - clockOut);

	const arcPath = (() => {
		if (sweep <= 0) return '';
		if (sweep >= 1) return `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R}`;
		const large = sweep > 0.5 ? 1 : 0;
		return `M ${CX} ${CY - R} A ${R} ${R} 0 ${large} 1 ${headX} ${headY}`;
	})();

	const ticks = Array.from({length: 60}, (_, i) => {
		const a = (i / 60) * Math.PI * 2;
		const passed = sweep >= i / 60;
		const major = i % 5 === 0;
		const r1 = R + 26;
		const r2 = R + (major ? 58 : 40);
		return (
			<line
				key={i}
				x1={CX + Math.sin(a) * r1}
				y1={CY - Math.cos(a) * r1}
				x2={CX + Math.sin(a) * r2}
				y2={CY - Math.cos(a) * r2}
				stroke={passed ? C.cyan : '#4a5a7a'}
				strokeWidth={major ? 5 : 2.5}
				opacity={clamp((f + 6 - i * 0.1) / 10) * (passed ? 1 : 0.5)}
			/>
		);
	});

	const done = f >= SWEEP_END;
	const slam = ep(f, SWEEP_END, SWEEP_END + 12);
	const oneScale = done ? 2.4 - 1.4 * slam : 0;
	const timer = (sweep * 1).toFixed(3);

	// blink: eye closes at 122, reopens by 132
	const eyeIn = ep(f, 104, 116);
	const blink = f < 122 ? 1 : f < 126 ? 1 - (f - 122) / 4 : f < 130 ? 0 : clamp((f - 130) / 5);

	// --- title -------------------------------------------------------------
	const tOut = ep(f, 248, 270, easeIn);
	const titleScale = 1 + tOut * 3.2;
	const g1 = glitchAt(f, [156, 214, 236]);
	const g2 = glitchAt(f, [162, 220]);
	const g3 = glitchAt(f, [168, 228, 242]);
	const l1 = ep(f, 156, 168);
	const l2 = ep(f, 162, 174);
	const l3 = ep(f, 168, 178);

	return (
		<AbsoluteFill>
			{/* clock */}
			<AbsoluteFill
				style={{
					opacity: clockOpacity,
					transform: `scale(${clockScale})`,
					transformOrigin: `${CX}px ${CY}px`,
					filter: clockOut > 0 ? `blur(${clockOut * 20}px)` : undefined,
				}}
			>
				<Glow x={CX} y={CY} r={500 + slam * 200} color={C.cyan} opacity={0.18 + slam * 0.25 * (1 - prog(f, 60, 140))} />
				<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
					<defs>
						<linearGradient id="arcg" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0" stopColor="#1b6cff" />
							<stop offset="1" stopColor={C.cyan} />
						</linearGradient>
					</defs>
					<circle cx={CX} cy={CY} r={R} fill="none" stroke="#1a2a44" strokeWidth={4} opacity={clamp((f + 8) / 12)} />
					{ticks}
					{arcPath ? (
						<>
							<path d={arcPath} fill="none" stroke={C.cyan} strokeWidth={30} strokeLinecap="round" opacity={0.25} style={{filter: 'blur(12px)'}} />
							<path d={arcPath} fill="none" stroke="url(#arcg)" strokeWidth={10} strokeLinecap="round" />
						</>
					) : null}
				</svg>
				{!done ? (
					<>
						<Glow x={headX} y={headY} r={70} color={C.cyan} opacity={clamp(f / 15)} />
						<div
							style={{
								position: 'absolute',
								left: headX - 11,
								top: headY - 11,
								width: 22,
								height: 22,
								borderRadius: '50%',
								background: '#fff',
								boxShadow: `0 0 20px 6px ${C.cyan}`,
								opacity: clamp(f / 12),
							}}
						/>
						<div
							style={{
								position: 'absolute',
								top: CY - 60,
								left: 0,
								right: 0,
								textAlign: 'center',
								fontFamily: FONT_MONO,
								fontWeight: 700,
								fontSize: 110,
								color: C.white,
								opacity: clamp((f + 6) / 10),
								textShadow: `0 0 30px ${C.cyan}`,
							}}
						>
							{timer}
							<span style={{fontSize: 50, color: C.dim}}> s</span>
						</div>
					</>
				) : (
					<div
						style={{
							position: 'absolute',
							top: CY - 170,
							left: 0,
							right: 0,
							display: 'flex',
							justifyContent: 'center',
							alignItems: 'baseline',
							transform: `scale(${oneScale})`,
							filter: slam < 1 ? `blur(${(1 - slam) * 14}px)` : undefined,
							color: C.white,
							textShadow: `0 0 30px ${C.cyan}, 0 0 90px ${C.cyan}`,
						}}
					>
						<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 300, lineHeight: 1}}>1</span>
						<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 190, marginLeft: 36}}>秒</span>
					</div>
				)}
				<Eye open={blink} x={CX} y={1215} opacity={eyeIn * (1 - ep(f, 145, 152))} />
			</AbsoluteFill>
			<Shockwave x={CX} y={CY} at={SWEEP_END} color={C.cyan} radius={1100} />
			<Flash at={SWEEP_END} color={C.cyan} peak={0.5} decay={7} />

			<Caption text="看好了，这就是 [1 秒]" start={2} end={46} y={1300} size={58} />
			<Caption text="一秒钟，有多短？" start={58} end={102} y={1300} size={62} />
			<Caption text="眨一下眼，就要 [0.3] 秒" start={104} end={150} y={1330} size={62} />

			{/* title */}
			{f >= 150 ? (
				<AbsoluteFill
					style={{
						transform: `scale(${titleScale})`,
						transformOrigin: '540px 820px',
						opacity: 1 - tOut,
						filter: tOut > 0 ? `blur(${tOut * 16}px)` : undefined,
					}}
				>
					<Rays x={540} y={820} color={C.cyan} count={28} rotate={f * 0.6} opacity={0.22 * l3} />
					<Glow x={540} y={820} r={700} color="#1a5cff" opacity={0.45 * l1} />
					<div style={{position: 'absolute', top: 470, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
						<Glitch
							amount={g1 + (1 - l1)}
							seed="t1"
							style={{opacity: l1, transform: `scale(${1.6 - 0.6 * l1})`}}
							render={(c) => (
								<div
									style={{
										fontFamily: FONT_CN,
										fontWeight: 900,
										fontSize: 210,
										lineHeight: 1.1,
										color: c ?? C.white,
										textShadow: c ? undefined : `0 0 40px ${C.cyan}, 0 0 100px #1a5cff`,
										letterSpacing: '0.04em',
									}}
								>
									一秒钟
								</div>
							)}
						/>
						<Glitch
							amount={g2 + (1 - l2)}
							seed="t2"
							style={{opacity: l2, marginTop: 30, transform: `translateY(${(1 - l2) * 40}px)`}}
							render={(c) => (
								<div
									style={{
										fontFamily: FONT_CN,
										fontWeight: 900,
										fontSize: 104,
										lineHeight: 1.2,
										color: c ?? '#cfe6ff',
										letterSpacing: '0.12em',
									}}
								>
									计算机到底能做
								</div>
							)}
						/>
						<Glitch
							amount={g3 + (1 - l3)}
							seed="t3"
							style={{opacity: l3, marginTop: 20, transform: `scale(${2 - l3})`}}
							render={(c) => (
								<div
									style={{
										fontFamily: FONT_CN,
										fontWeight: 900,
										fontSize: 200,
										lineHeight: 1.15,
										color: c ?? C.cyan,
										textShadow: c ? undefined : `0 0 30px ${C.cyan}, 0 0 90px ${C.cyan}`,
									}}
								>
									多少事？
								</div>
							)}
						/>
					</div>
				</AbsoluteFill>
			) : null}
			<Flash at={168} color={C.cyan} peak={0.45} decay={6} />
		</AbsoluteFill>
	);
};
