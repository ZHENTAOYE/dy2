import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Digits} from '../components/Digits';
import {EraTitle} from '../components/Era';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {C, FONT_CN, FONT_MONO, FONT_NUM} from '../theme';
import {clamp, easeIn, easeInOut, ep, expLerp, fmtInt, mulberry, prog} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const HZ_HIT = 120;
const RULER_HIT = 300;
const CORE_HIT = 430;

const fmtHz = (hz: number) => {
	if (hz < 1e3) return [hz.toFixed(0), 'Hz'];
	if (hz < 1e6) return [(hz / 1e3).toFixed(hz < 1e4 ? 1 : 0), 'kHz'];
	if (hz < 1e9) return [(hz / 1e6).toFixed(hz < 1e7 ? 1 : 0), 'MHz'];
	return [(hz / 1e9).toFixed(1), 'GHz'];
};

// ---------------------------------------------------------------- part A
const Clock: React.FC<{f: number}> = ({f}) => {
	// linger where individual ticks are still countable, then rush
	const t = Math.pow(prog(f, 26, HZ_HIT), 2.4);
	const hz = Math.pow(10, Math.log10(5e9) * t);
	const [num, unit] = fmtHz(hz);
	const vis = ep(f, 18, 32) * (1 - ep(f, 150, 166));
	const PX0 = 150;
	const PW = 780;
	const PY = 700;
	const PH = 300;
	const ref = useCanvas(
		(ctx) => {
			if (vis <= 0) return;
			// grid
			ctx.strokeStyle = 'rgba(43,228,255,0.12)';
			ctx.lineWidth = 1;
			for (let i = 0; i <= 10; i++) {
				ctx.beginPath();
				ctx.moveTo(PX0 + (PW / 10) * i, PY);
				ctx.lineTo(PX0 + (PW / 10) * i, PY + PH);
				ctx.stroke();
			}
			for (let j = 0; j <= 4; j++) {
				ctx.beginPath();
				ctx.moveTo(PX0, PY + (PH / 4) * j);
				ctx.lineTo(PX0 + PW, PY + (PH / 4) * j);
				ctx.stroke();
			}
			const hi = PY + 60;
			const lo = PY + PH - 60;
			const cycles = hz; // panel spans one second
			ctx.shadowColor = C.cyan;
			ctx.shadowBlur = 16;
			if (cycles < 160) {
				const phase = (f * 0.02 * Math.min(cycles, 4)) % 1;
				ctx.strokeStyle = '#d8fbff';
				ctx.lineWidth = 5;
				ctx.beginPath();
				const per = PW / cycles;
				let x = PX0 - phase * per;
				ctx.moveTo(PX0, lo);
				while (x < PX0 + PW) {
					const x1 = Math.max(PX0, x);
					const xm = Math.min(PX0 + PW, x + per / 2);
					const x2 = Math.min(PX0 + PW, x + per);
					ctx.lineTo(x1, lo);
					if (x + per / 2 > PX0) {
						ctx.lineTo(Math.max(PX0, x), hi);
						ctx.lineTo(xm, hi);
						ctx.lineTo(xm, lo);
					}
					ctx.lineTo(x2, lo);
					x += per;
				}
				ctx.stroke();
			}
			// dense band fades in as the wave becomes uncountable
			const band = clamp((Math.log10(cycles) - 1.6) / 1.2);
			if (band > 0) {
				const r = mulberry(f * 31 + 7);
				ctx.globalAlpha = band;
				const g = ctx.createLinearGradient(0, hi, 0, lo);
				g.addColorStop(0, 'rgba(220,252,255,0.95)');
				g.addColorStop(0.5, 'rgba(43,228,255,0.55)');
				g.addColorStop(1, 'rgba(220,252,255,0.95)');
				ctx.fillStyle = g;
				ctx.fillRect(PX0, hi - 3, PW, lo - hi + 6);
				ctx.fillStyle = 'rgba(255,255,255,0.8)';
				for (let i = 0; i < 160; i++) ctx.fillRect(PX0 + r() * PW, hi, 1.5, lo - hi);
				ctx.globalAlpha = 1;
			}
			ctx.shadowBlur = 0;
		},
		[f],
	);
	const slam = f >= HZ_HIT ? 1 + 0.4 * Math.exp(-(f - HZ_HIT) / 5) : 1;
	return (
		<AbsoluteFill style={{opacity: vis}}>
			<div
				style={{
					position: 'absolute',
					left: PX0 - 4,
					top: PY - 4,
					width: PW + 8,
					height: PH + 8,
					border: `2px solid ${C.cyan}66`,
					borderRadius: 6,
					background: 'rgba(2,12,20,0.7)',
					boxShadow: `0 0 30px ${C.cyan}33`,
				}}
			/>
			<canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />
			<div style={{position: 'absolute', left: PX0, top: PY + PH + 14, fontFamily: FONT_MONO, fontSize: 24, color: C.dim}}>
				← ———————— 1 秒 ———————— →
			</div>
			<div
				style={{
					position: 'absolute',
					top: 500,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 20,
					transform: `scale(${slam})`,
					color: '#fff',
					fontFamily: FONT_NUM,
					fontWeight: 900,
					textShadow: `0 0 20px ${C.cyan}, 0 0 60px ${C.cyan}`,
				}}
			>
				<span style={{fontSize: 140}}>{num}</span>
				<span style={{fontSize: 70, color: C.cyan}}>{unit}</span>
			</div>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- part B
const GX = 540;
const GY = 760;
const GR = 210;

const Globe: React.FC<{f: number; rot: number}> = ({f, rot}) => {
	const lats = [-60, -30, 0, 30, 60];
	const lons = Array.from({length: 12}, (_, i) => i * 15);
	return (
		<g>
			<circle cx={GX} cy={GY} r={GR} fill="url(#earthFill)" stroke={C.cyan} strokeWidth={3} />
			{lats.map((la) => {
				const y = GY - Math.sin((la * Math.PI) / 180) * GR;
				const rx = Math.cos((la * Math.PI) / 180) * GR;
				return <ellipse key={la} cx={GX} cy={y} rx={rx} ry={rx * 0.18} fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.45} />;
			})}
			{lons.map((lo) => {
				const a = ((lo + rot) * Math.PI) / 180;
				return <ellipse key={lo} cx={GX} cy={GY} rx={Math.abs(Math.cos(a)) * GR} ry={GR} fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.35} />;
			})}
			<circle cx={GX} cy={GY} r={GR + 14} fill="none" stroke={C.cyan} strokeWidth={10} opacity={0.12 + 0.05 * Math.sin(f / 8)} />
		</g>
	);
};

const ORX = 380;
const ORY = 120;
const TILT = -14;
const orbitPt = (phi: number) => {
	const x = Math.cos(phi) * ORX;
	const y = Math.sin(phi) * ORY;
	const a = (TILT * Math.PI) / 180;
	return {x: GX + x * Math.cos(a) - y * Math.sin(a), y: GY + x * Math.sin(a) + y * Math.cos(a), front: Math.sin(phi) > 0};
};

const Light: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 160, 176) * (1 - ep(f, 296, 306));
	const lapT = prog(f, 192, 252);
	const frozen = f >= 264;
	const phi = 7.5 * 2 * Math.PI * lapT - Math.PI / 2;
	const laps = 7.5 * lapT;
	const freeze = ep(f, 262, 276);
	const head = orbitPt(phi);
	const trail = (front: boolean) => {
		const segs = [];
		const len = frozen ? 0.3 : 2.8;
		for (let i = 0; i < 60; i++) {
			const p0 = orbitPt(phi - (i / 60) * len);
			const p1 = orbitPt(phi - ((i + 1) / 60) * len);
			if (p0.front !== front) continue;
			const k = 1 - i / 60;
			segs.push(
				<line key={i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={i < 6 ? '#fff' : '#9ff3ff'} strokeWidth={4 + 14 * k} strokeLinecap="round" opacity={k} />,
			);
		}
		return segs;
	};
	const orbitPath = (front: boolean) => {
		const pts = [];
		for (let i = 0; i <= 90; i++) {
			const p = orbitPt((i / 90) * Math.PI * 2);
			if (p.front === front) pts.push(`${p.x},${p.y}`);
		}
		return pts.join(' ');
	};
	return (
		<AbsoluteFill style={{opacity: vis, filter: freeze > 0 ? `saturate(${1 - freeze * 0.8})` : undefined}}>
			<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
				<defs>
					<radialGradient id="earthFill" cx="0.4" cy="0.35">
						<stop offset="0" stopColor="#0c4a6e" />
						<stop offset="1" stopColor="#020c18" />
					</radialGradient>
				</defs>
				<polyline points={orbitPath(false)} fill="none" stroke={C.cyan} strokeWidth={2} opacity={0.25} strokeDasharray="6 8" />
				<g style={{filter: `drop-shadow(0 0 10px ${C.cyan})`}}>{trail(false)}</g>
				<Globe f={f} rot={f * 1.2} />
				<polyline points={orbitPath(true)} fill="none" stroke={C.cyan} strokeWidth={2} opacity={0.35} strokeDasharray="6 8" />
				<g style={{filter: `drop-shadow(0 0 10px ${C.cyan})`}}>{trail(true)}</g>
			</svg>
			{f >= 192 ? (
				<>
					<Glow x={head.x} y={head.y} r={110 + (frozen ? 30 * Math.sin(f / 3) : 0)} color="#bff6ff" opacity={head.front || frozen ? 1 : 0.4} />
					<div
						style={{
							position: 'absolute',
							left: head.x - 14,
							top: head.y - 14,
							width: 28,
							height: 28,
							borderRadius: '50%',
							background: '#fff',
							boxShadow: `0 0 30px 12px ${C.cyan}`,
							opacity: head.front || frozen ? 1 : 0.4,
						}}
					/>
				</>
			) : null}
			<div
				style={{
					position: 'absolute',
					top: 1040,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 14,
					opacity: ep(f, 192, 200),
					fontFamily: FONT_NUM,
					fontWeight: 900,
					color: '#fff',
					textShadow: `0 0 20px ${C.cyan}`,
				}}
			>
				<span style={{fontSize: 60, color: C.cyan}}>×</span>
				<span style={{fontSize: 120}}>{laps.toFixed(1)}</span>
				<span style={{fontSize: 56, fontFamily: FONT_CN, color: C.cyan}}>圈</span>
			</div>
			{frozen ? (
				<div
					style={{
						position: 'absolute',
						top: 470,
						left: 0,
						right: 0,
						textAlign: 'center',
						fontFamily: FONT_MONO,
						fontWeight: 700,
						fontSize: 46,
						color: C.cyan,
						opacity: freeze,
						letterSpacing: '0.1em',
					}}
				>
					⏸ 时间暂停 · 0.2 纳秒
				</div>
			) : null}
		</AbsoluteFill>
	);
};

const Ruler: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, RULER_HIT - 4, RULER_HIT + 2) * (1 - ep(f, 340, 354));
	const CM = 120;
	const X0 = 180;
	const Y = 900;
	const travel = ep(f, RULER_HIT, RULER_HIT + 18, easeInOut);
	const hx = X0 + travel * 6 * CM;
	const slam = f >= RULER_HIT ? 1 + 0.5 * Math.exp(-(f - RULER_HIT) / 5) : 1;
	const ticks = [];
	for (let mm = 0; mm <= 60; mm++) {
		const major = mm % 10 === 0;
		const half = mm % 5 === 0;
		ticks.push(
			<line key={mm} x1={X0 + mm * (CM / 10)} x2={X0 + mm * (CM / 10)} y1={Y + 40} y2={Y + 40 + (major ? 54 : half ? 36 : 22)} stroke="#cfefff" strokeWidth={major ? 4 : 2} />,
		);
		if (major)
			ticks.push(
				<text key={`t${mm}`} x={X0 + mm * (CM / 10)} y={Y + 136} textAnchor="middle" fontFamily="Orbitron" fontWeight={700} fontSize={36} fill="#cfefff">
					{mm / 10}
				</text>,
			);
	}
	return (
		<AbsoluteFill style={{opacity: vis}}>
			<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
				<rect x={X0 - 40} y={Y + 30} width={6 * CM + 80} height={140} rx={10} fill="rgba(20,40,60,0.6)" stroke="#5ab8d8" strokeWidth={2} />
				{ticks}
				<text x={X0 + 6 * CM + 20} y={Y + 136} fontFamily="Noto Sans SC" fontWeight={700} fontSize={28} fill="#8fb8cc">
					cm
				</text>
				<line x1={X0} y1={Y} x2={hx} y2={Y} stroke="#fff" strokeWidth={14} strokeLinecap="round" style={{filter: `drop-shadow(0 0 16px ${C.cyan}) drop-shadow(0 0 30px ${C.cyan})`}} />
			</svg>
			<Glow x={hx} y={Y} r={120} color="#e6fdff" />
			<div
				style={{
					position: 'absolute',
					top: 560,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 16,
					transform: `scale(${slam})`,
					color: '#fff',
					textShadow: `0 0 24px ${C.cyan}, 0 0 70px ${C.cyan}`,
				}}
			>
				<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 250, lineHeight: 1}}>6</span>
				<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 120}}>厘米</span>
			</div>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- part C
const CORE = 172;
const GAP = 16;
const DX = 540 - (4 * CORE + 3 * GAP) / 2;
const DY = 420;
const LANES = 4;
const BLOCKS = (() => {
	const r = mulberry(16);
	return Array.from({length: 16 * LANES * 7}, () => ({o: r(), w: 10 + r() * 22, c: r()}));
})();
const coreOn = (i: number) => 356 + ((i * 7) % 16) * 2.2;

const Cores: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 350, 362);
	const dim = 1 - 0.82 * ep(f, CORE_HIT - 16, CORE_HIT);
	// instruction flow accelerates; cubic ramp keeps it a pure function of frame
	const travel = (f - 350) * 0.006 + 0.05 * Math.pow(prog(f, 360, CORE_HIT + 80), 3) * 60;
	const ref = useCanvas(
		(ctx) => {
			if (vis <= 0) return;
			for (let i = 0; i < 16; i++) {
				const on = clamp((f - coreOn(i)) / 6);
				if (on <= 0) continue;
				const cx = DX + (i % 4) * (CORE + GAP);
				const cy = DY + Math.floor(i / 4) * (CORE + GAP);
				for (let l = 0; l < LANES; l++) {
					const ly = cy + 40 + l * 30;
					ctx.fillStyle = 'rgba(43,228,255,0.12)';
					ctx.fillRect(cx + 14, ly, CORE - 28, 18);
					for (let b = 0; b < 7; b++) {
						const bl = BLOCKS[(i * LANES + l) * 7 + b];
						const pos = (bl.o + travel * (1 + l * 0.15)) % 1;
						const x = cx + 14 + pos * (CORE - 28 - bl.w);
						ctx.fillStyle = bl.c > 0.75 ? `rgba(255,255,255,${on})` : `rgba(43,228,255,${0.9 * on})`;
						ctx.fillRect(x, ly + 2, bl.w, 14);
					}
				}
			}
		},
		[f],
	);
	const count = expLerp(92000, 3e11, ep(f, CORE_HIT - 14, CORE_HIT, easeIn));
	const slam = f >= CORE_HIT ? 1 + 0.35 * Math.exp(-(f - CORE_HIT) / 5) : 1;
	return (
		<AbsoluteFill style={{opacity: vis}}>
			<div style={{position: 'absolute', inset: 0, opacity: dim}}>
				<div
					style={{
						position: 'absolute',
						left: DX - 24,
						top: DY - 24,
						width: 4 * CORE + 3 * GAP + 48,
						height: 4 * CORE + 3 * GAP + 48,
						border: `3px solid ${C.cyan}`,
						borderRadius: 12,
						background: 'linear-gradient(135deg, rgba(10,40,60,0.85), rgba(4,12,24,0.9))',
						boxShadow: `0 0 50px ${C.cyan}44`,
					}}
				/>
				{Array.from({length: 16}, (_, i) => {
					const on = clamp((f - coreOn(i)) / 6);
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: DX + (i % 4) * (CORE + GAP),
								top: DY + Math.floor(i / 4) * (CORE + GAP),
								width: CORE,
								height: CORE,
								borderRadius: 6,
								border: `2px solid ${on > 0 ? C.cyan : '#1d3a4a'}`,
								background: `rgba(43,228,255,${0.05 + 0.08 * on})`,
								boxShadow: on > 0 ? `0 0 ${18 * on}px ${C.cyan}88, inset 0 0 20px ${C.cyan}33` : undefined,
							}}
						>
							<div style={{position: 'absolute', left: 12, top: 8, fontFamily: FONT_MONO, fontSize: 18, color: on > 0 ? C.cyan : '#2d4d5d'}}>
								CORE {String(i).padStart(2, '0')}
							</div>
						</div>
					);
				})}
				<canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />
			</div>
			{f >= CORE_HIT - 14 ? (
				<div style={{position: 'absolute', top: 640, left: 0, right: 0, transform: `scale(${slam})`, opacity: ep(f, CORE_HIT - 14, CORE_HIT - 8)}}>
					<div style={{position: 'absolute', left: -60, right: -60, top: -110, height: 400, background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(2,6,14,0.9), transparent)'}} />
					<div style={{position: 'relative', textAlign: 'center', fontFamily: FONT_CN, fontWeight: 900, fontSize: 48, color: '#bdefff', marginBottom: 24}}>每秒约</div>
					<Digits value={fmtInt(count)} size={68} color="#fff" glow={C.cyan} style={{position: 'relative'}} />
					<div
						style={{
							position: 'relative',
							textAlign: 'center',
							marginTop: 24,
							fontFamily: FONT_CN,
							fontWeight: 900,
							fontSize: 56,
							color: C.cyan,
							textShadow: `0 0 16px ${C.cyan}`,
						}}
					>
						条指令
					</div>
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const Cpu: React.FC = () => {
	const f = useCurrentFrame();
	const out = ep(f, 498, 510);
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<EraTitle year="NOW" name="现代 CPU" sub="一颗普通的电脑处理器" color={C.cyan} end={150} nameFont={FONT_CN} />
			<Glow x={540} y={800} r={600} color="#0a5a8a" opacity={0.35} />
			<Clock f={f} />
			<Shockwave x={540} y={850} at={HZ_HIT} color={C.cyan} radius={900} />
			<Light f={f} />
			<Ruler f={f} />
			<Shockwave x={900} y={900} at={RULER_HIT + 18} color="#fff" radius={500} duration={20} width={16} />
			<Flash at={RULER_HIT} color={C.cyan} peak={0.4} decay={7} />
			<Cores f={f} />
			{f >= CORE_HIT ? <Rays x={540} y={700} color={C.cyan} count={30} rotate={f * 0.5} opacity={0.35 * (1 - ep(f, 470, 505))} /> : null}
			<Shockwave x={540} y={700} at={CORE_HIT} color={C.cyan} radius={1100} />
			<Flash at={CORE_HIT} color={C.cyan} peak={0.4} decay={8} />

			<Caption text="今天，一颗普通的电脑 CPU" start={6} end={56} />
			<Caption text="它的心跳，叫“时钟频率”" start={58} end={116} />
			<Caption text="每秒跳动 [50 亿] 次" start={122} end={160} />
			<Caption text="光速：每秒 30 万公里" start={166} end={212} />
			<Caption text="1 秒能绕地球 [7.5] 圈" start={214} end={262} />
			<Caption text="可在 CPU 的 1 个时钟周期里——" start={264} end={300} size={54} />
			<Caption text="光只能前进 [6 厘米]" start={302} end={348} />
			<Caption text="还不到一根手指长" start={312} end={348} y={1430} size={40} weight={700} color={C.dim} />
			<Caption text="而它有 [16] 个核心同时开工" start={356} end={400} />
			<Caption text="每个周期，还能执行好几条指令" start={402} end={428} size={52} />
			<Caption text="每秒 [数千亿] 条指令" start={434} end={504} />
		</AbsoluteFill>
	);
};
