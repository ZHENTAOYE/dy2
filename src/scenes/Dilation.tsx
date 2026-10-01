import React from 'react';
import {AbsoluteFill, random, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Eye} from '../components/Eye';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {C, FONT_CN, FONT_MONO, FONT_NUM} from '../theme';
import {clamp, easeIn, easeInOut, ep, lerp, prog} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

type Ev = {
	start: number;
	end: number;
	hit: number;
	title: string;
	real: string;
	value: number;
	unit: string;
	color: string;
	icon: 'ram' | 'ssd' | 'eye' | 'clock';
	speed: number;
};

const EVENTS: Ev[] = [
	{start: 100, end: 200, hit: 130, title: '从内存读一次数据', real: '约 100 纳秒', value: 8, unit: '分钟', color: C.violet, icon: 'ram', speed: 1.4},
	{start: 200, end: 295, hit: 225, title: '从固态硬盘读一次数据', real: '约 0.1 毫秒', value: 6, unit: '天', color: '#b46cff', icon: 'ssd', speed: 2.4},
	{start: 295, end: 420, hit: 330, title: '你眨一下眼', real: '约 0.3 秒', value: 47, unit: '年', color: C.pink, icon: 'eye', speed: 4.5},
	{start: 420, end: 540, hit: 450, title: '而真实的 1 秒', real: '1 秒', value: 158, unit: '年', color: '#ff5fa8', icon: 'clock', speed: 7.5},
];

const tunnelSpeed = (f: number) => {
	let s = lerp(0.4, 0.9, prog(f, 0, 100));
	for (const e of EVENTS) {
		if (f >= e.hit - 10) s = lerp(s, e.speed, clamp((f - (e.hit - 10)) / 16));
	}
	for (const e of EVENTS) {
		const d = f - e.hit;
		if (d >= 0 && d < 30) s += e.speed * 2.5 * Math.exp(-d / 6);
	}
	return s * (1 - ep(f, 524, 540));
};
const DIST: number[] = (() => {
	const a = [0];
	for (let f = 1; f <= 560; f++) a.push(a[f - 1] + tunnelSpeed(f));
	return a;
})();

const Tunnel: React.FC<{f: number}> = ({f}) => {
	const ref = useCanvas(
		(ctx, w, h) => {
			const cx = w / 2;
			const cy = 780;
			const d = DIST[Math.min(f, DIST.length - 1)] * 0.012;
			const N = 26;
			ctx.globalCompositeOperation = 'lighter';
			for (let i = 0; i < N; i++) {
				const z = ((((i / N - d) % 1) + 1) % 1) * 3 + 0.08;
				const r = 260 / z;
				if (r > 2200) continue;
				const a = clamp((3.08 - z) / 1.2) * clamp(z * 2);
				const hue = i % 3 === 0 ? '255,79,216' : '139,108,255';
				ctx.strokeStyle = `rgba(${hue},${0.55 * a})`;
				ctx.lineWidth = Math.max(1, 5 / z);
				ctx.setLineDash([(2 * Math.PI * r) / 120, (2 * Math.PI * r) / 120]);
				ctx.lineDashOffset = f * 2 + i * 7;
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.stroke();
				// clock-face major ticks
				ctx.setLineDash([]);
				ctx.lineWidth = Math.max(1.5, 8 / z);
				for (let k = 0; k < 12; k++) {
					const ang = (k / 12) * Math.PI * 2 + i * 0.13;
					ctx.beginPath();
					ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
					ctx.lineTo(cx + Math.cos(ang) * r * 0.93, cy + Math.sin(ang) * r * 0.93);
					ctx.stroke();
				}
			}
			// hyperspace streaks scale with speed
			const sp = tunnelSpeed(f);
			const streaks = Math.floor(clamp(sp / 8) * 220);
			for (let i = 0; i < streaks; i++) {
				const ang = random(`st-${i}`) * Math.PI * 2;
				const ph = (random(`sp-${i}`) + f * 0.02 * (0.5 + random(`sv-${i}`))) % 1;
				const r0 = 80 + ph * ph * 1400;
				const len = 30 + sp * 18 * ph;
				ctx.strokeStyle = `rgba(255,220,250,${0.5 * ph})`;
				ctx.lineWidth = 1 + ph * 3;
				ctx.beginPath();
				ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
				ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
				ctx.stroke();
			}
		},
		[f],
	);
	return <canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />;
};

const Icon: React.FC<{kind: Ev['icon']; color: string; f: number; local: number}> = ({kind, color, f, local}) => {
	const common = {fill: 'none', stroke: color, strokeWidth: 5, style: {filter: `drop-shadow(0 0 10px ${color})`}};
	if (kind === 'eye') {
		const blink = local < 16 ? 1 : local < 20 ? 1 - (local - 16) / 4 : local < 24 ? 0 : clamp((local - 24) / 5);
		return <Eye open={blink} x={540} y={400} opacity={1} color={color} id="dilEye" />;
	}
	return (
		<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
			<g transform="translate(540,400)">
				{kind === 'ram' ? (
					<>
						<rect x={-190} y={-60} width={380} height={110} rx={8} {...common} />
						{[0, 1, 2, 3].map((i) => (
							<rect key={i} x={-165 + i * 88} y={-38} width={64} height={52} rx={4} fill={`${color}55`} stroke={color} strokeWidth={3} />
						))}
						{Array.from({length: 22}, (_, i) => (
							<rect key={`p${i}`} x={-180 + i * 16.5} y={54} width={9} height={16} fill={color} opacity={0.8} />
						))}
					</>
				) : null}
				{kind === 'ssd' ? (
					<>
						<rect x={-220} y={-42} width={440} height={84} rx={10} {...common} />
						<rect x={-150} y={-26} width={120} height={52} rx={4} fill={`${color}55`} stroke={color} strokeWidth={3} />
						<rect x={0} y={-26} width={120} height={52} rx={4} fill={`${color}55`} stroke={color} strokeWidth={3} />
						<circle cx={190} cy={0} r={12} {...common} />
						{Array.from({length: 10}, (_, i) => (
							<rect key={i} x={-246} y={-36 + i * 7.5} width={20} height={4} fill={color} />
						))}
					</>
				) : null}
				{kind === 'clock' ? (
					<>
						<circle r={92} {...common} />
						<line x1={0} y1={0} x2={Math.sin(f * 0.4) * 70} y2={-Math.cos(f * 0.4) * 70} stroke="#fff" strokeWidth={6} strokeLinecap="round" />
						<line x1={0} y1={0} x2={Math.sin(f * 0.04) * 46} y2={-Math.cos(f * 0.04) * 46} stroke={color} strokeWidth={8} strokeLinecap="round" />
						{Array.from({length: 12}, (_, i) => {
							const a = (i / 12) * Math.PI * 2;
							return <line key={i} x1={Math.sin(a) * 78} y1={-Math.cos(a) * 78} x2={Math.sin(a) * 90} y2={-Math.cos(a) * 90} stroke={color} strokeWidth={4} />;
						})}
					</>
				) : null}
			</g>
		</svg>
	);
};

/** Year labels rushing past the camera like stars while years accumulate. */
const FlyingYears: React.FC<{f: number; from: number; to: number; count: number; color: string; base: number}> = ({f, from, to, count, color, base}) => {
	const items = [];
	for (let i = 0; i < count; i++) {
		const spawn = lerp(from, to, i / count);
		const t = (f - spawn) / 22;
		if (t < 0 || t > 1) continue;
		const ang = random(`fy-${base}-${i}`) * Math.PI * 2;
		const e = easeIn(t);
		const r = 40 + e * 900;
		items.push(
			<div
				key={i}
				style={{
					position: 'absolute',
					left: 540 + Math.cos(ang) * r,
					top: 780 + Math.sin(ang) * r * 1.3,
					transform: `translate(-50%,-50%) scale(${0.4 + e * 2.2})`,
					fontFamily: FONT_NUM,
					fontWeight: 700,
					fontSize: 34,
					color,
					opacity: Math.sin(t * Math.PI) * 0.8,
					textShadow: `0 0 12px ${color}`,
				}}
			>
				{base + i + 1}
			</div>,
		);
	}
	return <>{items}</>;
};

const EventCard: React.FC<{e: Ev; f: number}> = ({e, f}) => {
	if (f < e.start - 2 || f > e.end + 2) return null;
	const local = f - e.start;
	const inP = ep(f, e.start, e.start + 14);
	const out = ep(f, e.end - 14, e.end, easeIn);
	const count = Math.round(e.value * ep(f, e.hit - 22, e.hit, easeInOut));
	const slam = f >= e.hit ? 1 + 0.45 * Math.exp(-(f - e.hit) / 5) : 1;
	const numIn = ep(f, e.hit - 24, e.hit - 18);
	return (
		<AbsoluteFill
			style={{
				opacity: inP * (1 - out),
				transform: `scale(${(0.7 + 0.3 * inP) * (1 + out * 2.5)})`,
				transformOrigin: '540px 780px',
				filter: out > 0 ? `blur(${out * 14}px)` : undefined,
			}}
		>
			<Icon kind={e.icon} color={e.color} f={f} local={local} />
			<div
				style={{
					position: 'absolute',
					top: 520,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontFamily: FONT_CN,
					fontWeight: 900,
					fontSize: 70,
					color: '#fff',
					textShadow: `0 0 20px ${e.color}, 0 4px 20px #000`,
				}}
			>
				{e.title}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 622,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontFamily: FONT_MONO,
					fontWeight: 700,
					fontSize: 38,
					color: '#c9c2e8',
				}}
			>
				真实：{e.real}
				<span style={{color: e.color}}> → </span>
				CPU 感觉：
			</div>
			<div
				style={{
					position: 'absolute',
					top: 720,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 18,
					opacity: numIn,
					transform: `scale(${slam})`,
					color: '#fff',
					textShadow: `0 0 30px ${e.color}, 0 0 90px ${e.color}`,
				}}
			>
				<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 260, lineHeight: 1}}>{count}</span>
				<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 130, color: e.color}}>{e.unit}</span>
			</div>
		</AbsoluteFill>
	);
};

export const Dilation: React.FC = () => {
	const f = useCurrentFrame();
	// intro: 0.2 ns bar stretched into 1 second
	const stretch = ep(f, 52, 86, easeInOut);
	const introOut = ep(f, 92, 104, easeIn);
	const barW = lerp(6, 760, stretch);
	return (
		<AbsoluteFill>
			<AbsoluteFill style={{opacity: ep(f, 0, 20)}}>
				<Tunnel f={f} />
			</AbsoluteFill>
			<Glow x={540} y={780} r={500} color="#4a1a8a" opacity={0.5} />

			{/* intro */}
			<AbsoluteFill style={{opacity: ep(f, 4, 16) * (1 - introOut), transform: `scale(${1 + introOut * 2})`, transformOrigin: '540px 780px'}}>
				<div
					style={{
						position: 'absolute',
						left: 540 - barW / 2,
						top: 760,
						width: barW,
						height: 40,
						borderRadius: 20,
						background: `linear-gradient(90deg, ${C.violet}, ${C.pink})`,
						boxShadow: `0 0 30px ${C.pink}, 0 0 80px ${C.violet}`,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						top: 620,
						left: 0,
						right: 0,
						textAlign: 'center',
						fontFamily: FONT_MONO,
						fontWeight: 700,
						fontSize: 44,
						color: '#c9c2e8',
						opacity: 1 - stretch,
					}}
				>
					1 个时钟周期 = 0.2 纳秒
				</div>
				<div
					style={{
						position: 'absolute',
						top: 850,
						left: 0,
						right: 0,
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'baseline',
						gap: 14,
						opacity: stretch,
						transform: `scale(${0.6 + 0.4 * stretch})`,
						color: '#fff',
						textShadow: `0 0 30px ${C.pink}`,
					}}
				>
					<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 180}}>1</span>
					<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 100}}>秒</span>
				</div>
			</AbsoluteFill>

			{EVENTS.map((e) => (
				<React.Fragment key={e.title}>
					<EventCard e={e} f={f} />
					<Shockwave x={540} y={850} at={e.hit} color={e.color} radius={1100} />
				</React.Fragment>
			))}
			<FlyingYears f={f} from={308} to={330} count={47} color={C.pink} base={2026} />
			<FlyingYears f={f} from={428} to={450} count={60} color="#ffb0d8" base={2026} />
			{f >= 330 && f < 420 ? <Rays x={540} y={850} color={C.pink} count={26} rotate={f * 0.7} opacity={0.3 * (1 - prog(f, 380, 420))} /> : null}
			{f >= 450 ? <Rays x={540} y={850} color="#ff5fa8" count={34} rotate={-f * 0.8} opacity={0.4 * (1 - prog(f, 500, 540))} /> : null}
			<Flash at={330} color={C.pink} peak={0.45} decay={8} />
			<Flash at={450} color="#ff5fa8" peak={0.5} decay={8} />

			<Caption text="如果把 CPU 的 1 个时钟周期" start={6} end={52} accent={C.pink} />
			<Caption text="放大成 [1 秒]……" start={54} end={100} accent={C.pink} />
			<Caption text="CPU 要干等 [8 分钟]" start={132} end={198} accent={C.violet} />
			<Caption text="要等上整整 [6 天]" start={228} end={292} accent="#b46cff" />
			<Caption text="CPU 已经度过了 [47 年]" start={334} end={416} accent={C.pink} />
			<Caption text="差不多是一个人的大半辈子" start={350} end={416} y={1430} size={40} weight={700} color="#c9c2e8" />
			<Caption text="相当于 [158 年]" start={454} end={500} accent="#ff5fa8" />
			<Caption text="比两辈子还长" start={500} end={538} accent="#ff5fa8" />
		</AbsoluteFill>
	);
};
