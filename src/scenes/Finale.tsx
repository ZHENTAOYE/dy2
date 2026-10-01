import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Digits, sup} from '../components/Digits';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {C, FONT_CN, FONT_MONO, FONT_NUM} from '../theme';
import {TOTAL_FRAMES, FPS} from '../timeline';
import {clamp, easeIn, easeInOut, easeOut, ep, mulberry, prog} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const HUMANITY_HIT = 250;
const COSMIC_START = 400;
const COSMIC_HIT = 560;
const SWEEP_START = 640;
const ONE_SEC = 702;
const FINAL_HIT = 820;

const OPS = 1.7e18;
const YEAR = 365.25 * 86400;
const HUMANITY_YEARS = OPS / 8e9 / YEAR; // ≈ 6.7
const ALONE_YEARS = OPS / YEAR; // ≈ 5.4e10
const VIDEO_SECONDS = TOTAL_FRAMES / FPS;

/** 2 significant digits, padded with zeros and comma-grouped (no float noise). */
const bigDigits = (n: number) => {
	const e = Math.floor(Math.log10(n));
	const lead = Math.round(n / Math.pow(10, e - 1));
	const raw = String(lead) + '0'.repeat(e - 1);
	return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

// ---------------------------------------------------------------- Earth
const GX = 540;
const GY = 720;
const GR = 300;
const PEOPLE = (() => {
	const r = mulberry(8e9 % 100000);
	const centers = Array.from({length: 46}, () => {
		const u = r() * 2 - 1;
		const th = r() * Math.PI * 2;
		return [Math.sqrt(1 - u * u) * Math.cos(th), u * 0.85, Math.sqrt(1 - u * u) * Math.sin(th)];
	});
	return Array.from({length: 3200}, (_, i) => {
		const c = centers[i % centers.length];
		const s = 0.05 + r() * 0.22;
		let x = c[0] + (r() - 0.5) * s;
		let y = c[1] + (r() - 0.5) * s;
		let z = c[2] + (r() - 0.5) * s;
		const l = Math.sqrt(x * x + y * y + z * z);
		x /= l;
		y /= l;
		z /= l;
		return {x, y, z, ph: r() * 100, born: r()};
	});
})();

const Earth: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 0, 30) * (1 - ep(f, 336, 380));
	const shrink = ep(f, 336, 392, easeIn);
	const pop = ep(f, 70, 150, easeInOut);
	const ref = useCanvas(
		(ctx) => {
			if (vis <= 0) return;
			const rot = f * 0.006;
			const cr = Math.cos(rot);
			const sr = Math.sin(rot);
			const tilt = 0.35;
			const ct = Math.cos(tilt);
			const st = Math.sin(tilt);
			ctx.globalCompositeOperation = 'lighter';
			const computing = f > 160 && f < 340;
			for (const p of PEOPLE) {
				if (p.born > pop) continue;
				const x = p.x * cr + p.z * sr;
				const z0 = -p.x * sr + p.z * cr;
				const y = p.y * ct - z0 * st;
				const z = p.y * st + z0 * ct;
				if (z < 0) continue;
				const tw = computing ? 0.5 + 0.5 * Math.sin(f * 0.9 + p.ph) : 0.8;
				const a = (0.25 + 0.75 * z) * tw;
				ctx.fillStyle = `rgba(255,214,140,${a})`;
				const s = 2 + 2 * z;
				ctx.fillRect(GX + x * GR - s / 2, GY - y * GR - s / 2, s, s);
			}
		},
		[f],
	);
	return (
		<AbsoluteFill style={{opacity: vis, transform: `scale(${1 - shrink * 0.97})`, transformOrigin: `${GX}px ${GY}px`}}>
			<div
				style={{
					position: 'absolute',
					left: GX - GR - 60,
					top: GY - GR - 60,
					width: (GR + 60) * 2,
					height: (GR + 60) * 2,
					borderRadius: '50%',
					background: 'radial-gradient(circle, transparent 58%, rgba(80,160,255,0.35) 62%, rgba(80,160,255,0.08) 70%, transparent 76%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: GX - GR,
					top: GY - GR,
					width: GR * 2,
					height: GR * 2,
					borderRadius: '50%',
					background: 'radial-gradient(circle at 38% 32%, #12305a 0%, #071630 45%, #02060f 80%)',
					boxShadow: 'inset -40px -30px 80px rgba(0,0,0,0.8), 0 0 60px rgba(60,140,255,0.35)',
				}}
			/>
			<canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- cosmic counter
const fmtYears = (y: number): [string, string] => {
	if (y < 1e4) return [Math.max(1, Math.round(y)).toLocaleString('en-US'), '年'];
	if (y < 1e8) {
		const v = y / 1e4;
		return [v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'), '万年'];
	}
	const v = y / 1e8;
	return [v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'), '亿年'];
};

const MILESTONES = [
	{y: 2200, label: '秦朝至今'},
	{y: 5000, label: '人类文明史'},
	{y: 3e5, label: '智人出现至今'},
	{y: 6.6e7, label: '恐龙灭绝至今'},
	{y: 4.6e9, label: '地球的年龄'},
	{y: 1.38e10, label: '宇宙的年龄'},
];
const LOG_END = Math.log10(ALONE_YEARS);
// log10(years) keyframes: each milestone gets its own beat on screen
const YEAR_KEYS: [number, number][] = [
	[COSMIC_START, 0],
	[430, Math.log10(2200)],
	[444, Math.log10(5000)],
	[462, Math.log10(3e5)],
	[482, Math.log10(6.6e7)],
	[502, Math.log10(4.6e9)],
	[522, Math.log10(1.38e10)],
	[COSMIC_HIT, LOG_END],
];
const yearsAt = (f: number) => {
	if (f <= YEAR_KEYS[0][0]) return 1;
	for (let i = 1; i < YEAR_KEYS.length; i++) {
		const [f1, l1] = YEAR_KEYS[i];
		if (f <= f1) {
			const [f0, l0] = YEAR_KEYS[i - 1];
			return Math.pow(10, l0 + ((l1 - l0) * (f - f0)) / (f1 - f0));
		}
	}
	return ALONE_YEARS;
};
const frameForYears = (y: number) => {
	// invert yearsAt numerically
	let lo = COSMIC_START;
	let hi = COSMIC_HIT;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		if (yearsAt(mid) < y) lo = mid;
		else hi = mid;
	}
	return hi;
};

const Galaxy: React.FC<{x: number; y: number; size: number; f: number; seed: number; opacity: number}> = ({x, y, size, f, seed, opacity}) => {
	const ref = useCanvas(
		(ctx, w, h) => {
			const r = mulberry(seed);
			const cx = w / 2;
			const cy = h / 2;
			ctx.globalCompositeOperation = 'lighter';
			const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.22);
			g.addColorStop(0, 'rgba(255,240,210,0.95)');
			g.addColorStop(1, 'rgba(255,200,120,0)');
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
			for (let i = 0; i < 700; i++) {
				const arm = i % 2;
				const t = r();
				const ang = t * 7 + arm * Math.PI + f * 0.01 + (r() - 0.5) * 0.5;
				const rad = t * w * 0.46 + (r() - 0.5) * 8;
				const px = cx + Math.cos(ang) * rad;
				const py = cy + Math.sin(ang) * rad * 0.55;
				ctx.fillStyle = r() > 0.6 ? 'rgba(160,190,255,0.8)' : 'rgba(255,220,180,0.7)';
				ctx.fillRect(px, py, 1.6, 1.6);
			}
		},
		[f],
	);
	return <canvas ref={ref} width={size} height={size} style={{position: 'absolute', left: x - size / 2, top: y - size / 2, opacity}} />;
};

const Cosmic: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 380, 396) * (1 - ep(f, 600, 616));
	const years = yearsAt(f);
	// final reading rounded to 2 significant digits (≈ 540 亿年)
	const [num, unit] = fmtYears(f >= COSMIC_HIT ? Math.round(ALONE_YEARS / 1e9) * 1e9 : Math.min(years, ALONE_YEARS));
	const slam = f >= COSMIC_HIT ? 1 + 0.45 * Math.exp(-(f - COSMIC_HIT) / 5) : 1;
	const passedUniverse = f >= frameForYears(1.38e10);
	const hot = passedUniverse ? 1 : 0;
	const latest = MILESTONES.filter((m) => years >= m.y);
	const galaxiesP = ep(f, COSMIC_HIT + 4, COSMIC_HIT + 24);
	return (
		<AbsoluteFill style={{opacity: vis}}>
			{/* the lone human */}
			<Glow x={540} y={420} r={60} color={C.cyan} opacity={1 - ep(f, 540, 560)} />
			<div
				style={{
					position: 'absolute',
					left: 540 - 8,
					top: 420 - 8,
					width: 16,
					height: 16,
					borderRadius: '50%',
					background: '#fff',
					boxShadow: `0 0 20px 6px ${C.cyan}`,
					opacity: 1 - ep(f, 540, 560),
				}}
			/>
			<div style={{position: 'absolute', top: 460, left: 0, right: 0, textAlign: 'center', fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: C.dim, opacity: 1 - ep(f, 540, 560)}}>
				你，每秒算 1 道题
			</div>
			<div
				style={{
					position: 'absolute',
					top: 600,
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'baseline',
					gap: 18,
					opacity: ep(f, COSMIC_START - 4, COSMIC_START + 4),
					transform: `scale(${slam})`,
					color: '#fff',
					textShadow: `0 0 30px ${hot ? C.gold : C.blue}, 0 0 80px ${hot ? C.orange : C.blue}`,
				}}
			>
				<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: num.length > 5 ? 170 : 210, lineHeight: 1}}>{num}</span>
				<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 110, color: hot ? C.gold : '#9fc4ff'}}>{unit}</span>
			</div>
			{/* milestone stack */}
			<div style={{position: 'absolute', top: 860, left: 0, right: 0, height: 300, opacity: 1 - galaxiesP}}>
				{latest.map((m, i) => {
					const age = latest.length - 1 - i;
					const born = frameForYears(m.y);
					const p = ep(f, born, born + 8);
					const isUni = m.y === 1.38e10;
					return (
						<div
							key={m.label}
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								top: age * 56,
								textAlign: 'center',
								opacity: p * Math.max(0, 1 - age * 0.28),
								transform: `scale(${(1 - age * 0.1) * (1 + 0.3 * (1 - p))})`,
								fontFamily: FONT_CN,
								fontWeight: 900,
								fontSize: 44,
								color: isUni ? C.gold : '#cfe0ff',
								textShadow: isUni ? `0 0 20px ${C.orange}` : '0 0 12px #000',
							}}
						>
							✓ 超过{m.label}
						</div>
					);
				})}
			</div>
			{/* four universes */}
			{f >= COSMIC_HIT
				? [0, 1, 2, 3].map((i) => {
						const p = ep(f, COSMIC_HIT + 4 + i * 5, COSMIC_HIT + 18 + i * 5);
						return (
							<React.Fragment key={i}>
								<Galaxy x={210 + i * 220} y={1010} size={200} f={f} seed={77 + i} opacity={p} />
								<div style={{position: 'absolute', left: 210 + i * 220 - 100, width: 200, top: 1120, textAlign: 'center', fontFamily: FONT_MONO, fontWeight: 700, fontSize: 24, color: C.gold, opacity: p}}>
									138 亿年
								</div>
							</React.Fragment>
						);
					})
				: null}
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- climax burst
const BURST_COLORS = ['255,255,255', '43,228,255', '255,176,58', '61,255,143', '255,46,230', '255,59,47', '255,214,107', '139,108,255'];
const BURST = (() => {
	const r = mulberry(702);
	return Array.from({length: 2600}, () => ({
		a: r() * Math.PI * 2,
		v: 6 + Math.pow(r(), 2) * 60,
		c: BURST_COLORS[Math.floor(r() * BURST_COLORS.length)],
		s: 1.5 + r() * 3.5,
		life: 60 + r() * 100,
	}));
})();

const Burst: React.FC<{f: number}> = ({f}) => {
	const t = f - ONE_SEC;
	const ref = useCanvas(
		(ctx) => {
			if (t < 0 || t > 170) return;
			ctx.globalCompositeOperation = 'lighter';
			for (const p of BURST) {
				if (t > p.life) continue;
				const k = 1 - Math.exp(-t / 22);
				const k0 = 1 - Math.exp(-Math.max(0, t - 2) / 22);
				const r = p.v * 22 * k;
				const r0 = p.v * 22 * k0;
				const x = 540 + Math.cos(p.a) * r;
				const y = 760 + Math.sin(p.a) * r;
				const x0 = 540 + Math.cos(p.a) * r0;
				const y0 = 760 + Math.sin(p.a) * r0;
				const a = 1 - t / p.life;
				ctx.strokeStyle = `rgba(${p.c},${a})`;
				ctx.lineWidth = p.s;
				ctx.beginPath();
				ctx.moveTo(x0, y0);
				ctx.lineTo(x + 0.1, y + 0.1);
				ctx.stroke();
			}
		},
		[f],
	);
	return <canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />;
};

// ---------------------------------------------------------------- scene
export const Finale: React.FC = () => {
	const f = useCurrentFrame();

	// humanity counter
	const hp = ep(f, 172, HUMANITY_HIT, easeIn);
	const hYears = HUMANITY_YEARS * hp;
	const hSlam = f >= HUMANITY_HIT ? 1 + 0.4 * Math.exp(-(f - HUMANITY_HIT) / 5) : 1;
	const hVis = ep(f, 168, 176) * (1 - ep(f, 330, 342));

	// blackout & the final second
	const black = ep(f, 596, 616);
	const R = 250;
	const sweep = prog(f, SWEEP_START, SWEEP_START + 30);
	const theta = sweep * Math.PI * 2;
	const ringVis = ep(f, 620, 632) * (1 - ep(f, ONE_SEC - 2, ONE_SEC));
	const arc =
		sweep <= 0
			? ''
			: sweep >= 1
				? `M 540 ${760 - R} A ${R} ${R} 0 1 1 539.99 ${760 - R}`
				: `M 540 ${760 - R} A ${R} ${R} 0 ${sweep > 0.5 ? 1 : 0} 1 ${540 + Math.sin(theta) * R} ${760 - Math.cos(theta) * R}`;

	const oneP = ep(f, ONE_SEC, ONE_SEC + 10);
	const oneScale = f < ONE_SEC ? 0 : 3.2 - 2.2 * easeOut(clamp((f - ONE_SEC) / 12));
	const moveUp = ep(f, 770, 800, easeInOut);
	const finalCount = OPS * VIDEO_SECONDS;
	const exp = Math.floor(Math.log10(finalCount));
	const mant = (finalCount / Math.pow(10, exp)).toFixed(1);
	const fcP = ep(f, FINAL_HIT - 4, FINAL_HIT + 6);
	const fcSlam = f >= FINAL_HIT ? 1 + 0.35 * Math.exp(-(f - FINAL_HIT) / 5) : 1;

	return (
		<AbsoluteFill>
			<Earth f={f} />
			<div
				style={{
					position: 'absolute',
					top: 1090,
					left: 0,
					right: 0,
					opacity: hVis,
					transform: `scale(${hSlam})`,
				}}
			>
				<div style={{position: 'absolute', left: 0, right: 0, top: -40, height: 260, background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(2,3,8,0.85), transparent)'}} />
				<div style={{position: 'relative', textAlign: 'center', fontFamily: FONT_CN, fontWeight: 700, fontSize: 34, color: '#ffd9a0'}}>全人类连续计算</div>
				<div
					style={{
						position: 'relative',
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'baseline',
						gap: 14,
						color: '#fff',
						textShadow: `0 0 26px ${C.gold}`,
					}}
				>
					<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 150}}>{hYears.toFixed(1)}</span>
					<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 80, color: C.gold}}>年</span>
				</div>
			</div>
			<Shockwave x={540} y={1180} at={HUMANITY_HIT} color={C.gold} radius={900} />

			<Cosmic f={f} />
			{f >= COSMIC_HIT && f < 620 ? <Rays x={540} y={680} color={C.gold} count={32} rotate={f * 0.5} opacity={0.35 * (1 - ep(f, 590, 616))} /> : null}
			<Shockwave x={540} y={680} at={COSMIC_HIT} color={C.gold} radius={1200} />
			<Shockwave x={540} y={680} at={522} color={C.orange} radius={700} duration={20} width={14} />
			<Flash at={522} color={C.orange} peak={0.25} decay={6} />
			<Flash at={COSMIC_HIT} color={C.gold} peak={0.45} decay={8} />

			{/* silence */}
			<AbsoluteFill style={{background: '#000', opacity: black * (1 - ep(f, ONE_SEC, ONE_SEC + 40) * 0.6)}} />
			<AbsoluteFill style={{opacity: ringVis}}>
				<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
					<circle cx={540} cy={760} r={R} fill="none" stroke="#1a2236" strokeWidth={4} />
					{arc ? <path d={arc} fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" style={{filter: 'drop-shadow(0 0 12px #fff)'}} /> : null}
				</svg>
				<div
					style={{
						position: 'absolute',
						top: 700,
						left: 0,
						right: 0,
						textAlign: 'center',
						fontFamily: FONT_MONO,
						fontWeight: 700,
						fontSize: 96,
						color: '#fff',
					}}
				>
					{sweep.toFixed(3)}
					<span style={{fontSize: 44, color: C.dim}}> s</span>
				</div>
			</AbsoluteFill>

			{/* the climax */}
			{f >= ONE_SEC ? (
				<>
					<Rays x={540} y={760} color="#ffffff" count={48} rotate={f * 0.4} opacity={0.5 * (1 - ep(f, 760, 840))} length={1600} />
					<Glow x={540} y={760} r={900} color={C.gold} opacity={0.6 * (1 - ep(f, 720, 800)) + 0.15} />
					<Burst f={f} />
					<div
						style={{
							position: 'absolute',
							top: 560 - moveUp * 190,
							left: 0,
							right: 0,
							display: 'flex',
							justifyContent: 'center',
							alignItems: 'baseline',
							transform: `scale(${oneScale * (1 - moveUp * 0.4)})`,
							opacity: oneP,
							color: '#fff',
							textShadow: `0 0 40px #fff, 0 0 100px ${C.gold}, 0 0 200px ${C.orange}`,
						}}
					>
						<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 330, lineHeight: 1}}>1</span>
						<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 210, marginLeft: 40}}>秒</span>
					</div>
				</>
			) : null}
			<Shockwave x={540} y={760} at={ONE_SEC} color="#fff" radius={1500} duration={36} width={50} />
			<Shockwave x={540} y={760} at={ONE_SEC + 5} color={C.gold} radius={1300} duration={36} width={30} />
			<Shockwave x={540} y={760} at={ONE_SEC + 10} color={C.cyan} radius={1100} duration={36} width={20} />
			<Flash at={ONE_SEC} color="#fff" peak={1} decay={12} />

			{/* final tally */}
			{f >= FINAL_HIT - 4 ? (
				<div style={{position: 'absolute', top: 780, left: 0, right: 0, opacity: fcP, transform: `scale(${fcSlam})`}}>
					<div style={{textAlign: 'center', fontFamily: FONT_CN, fontWeight: 700, fontSize: 40, color: '#e8e0c8', marginBottom: 18}}>它已经算了大约</div>
					<Digits value={bigDigits(finalCount)} size={40} color="#fff" glow={C.gold} />
					<div
						style={{
							marginTop: 22,
							display: 'flex',
							justifyContent: 'center',
							alignItems: 'baseline',
							gap: 16,
							color: '#fff',
							textShadow: `0 0 30px ${C.gold}, 0 0 80px ${C.orange}`,
						}}
					>
						<span style={{fontFamily: FONT_NUM, fontWeight: 900, fontSize: 120}}>
							{mant} × 10{sup(exp)}
						</span>
						<span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: 80, color: C.gold}}>次</span>
					</div>
				</div>
			) : null}
			<Flash at={FINAL_HIT} color={C.gold} peak={0.35} decay={8} />

			<Caption text="如果交给全人类来算——" start={6} end={80} accent={C.gold} />
			<Caption text="全世界 [80 亿] 人，每人每秒算一道题" start={84} end={162} accent={C.gold} size={54} />
			<Caption text="不吃、不睡、一刻不停——" start={164} end={246} accent={C.gold} />
			<Caption text="全人类要算 [6 年多]" start={254} end={330} accent={C.gold} />
			<Caption text="才能追上超算的 1 秒" start={266} end={330} y={1430} size={40} weight={700} color="#e8e0c8" />
			<Caption text="如果，只有你一个人呢？" start={336} end={398} accent={C.cyan} />
			<Caption text="要算大约 [540 亿年]" start={564} end={598} accent={C.gold} />
			<Caption text="是宇宙年龄的近 [4] 倍" start={570} end={598} y={1430} size={44} accent={C.gold} />
			<Caption text="而计算机，只需要——" start={616} end={696} y={1180} accent="#fff" />
			<Caption text="你看这段视频的 2 分多钟里" start={776} end={900} y={1330} accent={C.gold} size={52} />
			<Caption text="这，就是计算机的 [1 秒]" start={850} end={905} y={1430} accent={C.gold} size={48} />
		</AbsoluteFill>
	);
};
