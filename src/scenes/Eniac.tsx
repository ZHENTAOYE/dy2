import React from 'react';
import {AbsoluteFill, random, useCurrentFrame} from 'remotion';
import {Caption, Tag} from '../components/Caption';
import {Digits} from '../components/Digits';
import {EraTitle} from '../components/Era';
import {Flash, Glow, Shockwave} from '../components/Fx';
import {C, FONT_CN} from '../theme';
import {clamp, easeInOut, ep, fmtInt, mulberry} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const COLS = 12;
const ROWS = 5;
const WX = 190;
const WY = 590;
const PX = 700 / COLS;
const PY = 82;
const HIT = 196;

type Tube = {x: number; y: number; on: number};
const TUBES: Tube[] = [];
for (let r = 0; r < ROWS; r++) {
	for (let c = 0; c < COLS; c++) {
		TUBES.push({
			x: WX + PX * (c + 0.5),
			y: WY + PY * r + 40,
			on: 14 + random(`tube-${r}-${c}`) * 70,
		});
	}
}

const N = 5000;
const PARTS = (() => {
	const r = mulberry(1946);
	return Array.from({length: N}, (_, i) => {
		const t = TUBES[Math.floor(r() * TUBES.length)];
		const col = i % 100;
		const row = Math.floor(i / 100);
		return {
			sx: t.x + (r() - 0.5) * 20,
			sy: t.y + (r() - 0.5) * 30,
			tx: WX + col * 7 + 3.5,
			ty: 600 + row * 7 + 3.5,
			start: 168 + r() * 22,
			arc: 80 + r() * 260,
			tw: r() * 100,
		};
	});
})();

const TubeSvg: React.FC<{t: Tube; frame: number; dim: number}> = ({t, frame, dim}) => {
	const since = frame - t.on;
	const flick = since >= 0 && since < 8 ? (random(`fl-${t.x}-${t.y}-${frame}`) > 0.45 ? 1 : 0.15) : since >= 8 ? 1 : 0;
	const hum = 0.85 + 0.15 * Math.sin(frame / 3 + t.x);
	const b = flick * hum * dim;
	return (
		<g transform={`translate(${t.x},${t.y})`}>
			<circle r={34} fill="url(#tubeGlow)" opacity={b} />
			<path
				d="M -16 30 L -16 -14 Q -16 -36 0 -38 Q 16 -36 16 -14 L 16 30 Z"
				fill={`rgba(255,180,90,${0.06 + 0.1 * b})`}
				stroke={b > 0.1 ? '#ffd9a0' : '#5a4a3a'}
				strokeWidth={2}
				opacity={0.9}
			/>
			<rect x={-9} y={-12} width={18} height={30} fill="none" stroke="#7a6a5a" strokeWidth={1.5} opacity={0.8} />
			<line x1={0} y1={-20} x2={0} y2={22} stroke={C.amber} strokeWidth={3} opacity={b} style={{filter: `drop-shadow(0 0 4px ${C.amberHot})`}} />
			<rect x={-19} y={30} width={38} height={12} rx={2} fill="#2b2622" stroke="#4a4038" />
		</g>
	);
};

export const Eniac: React.FC = () => {
	const f = useCurrentFrame();
	const dim = 1 - 0.88 * ep(f, 176, 206);
	const out = ep(f, 316, 330);
	const arrivals = clamp((f - 176) / 20);

	const canvasRef = useCanvas(
		(ctx) => {
			if (f < 166) return;
			ctx.globalCompositeOperation = 'lighter';
			for (const p of PARTS) {
				const t = clamp((f - p.start) / 20);
				if (t <= 0) continue;
				const e = easeInOut(t);
				const x = p.sx + (p.tx - p.sx) * e;
				const y = p.sy + (p.ty - p.sy) * e - Math.sin(e * Math.PI) * p.arc;
				const settled = t >= 1;
				const tw = settled ? 0.65 + 0.35 * Math.sin(f / 4 + p.tw) : 1;
				ctx.fillStyle = settled ? `rgba(255,176,58,${0.85 * tw})` : 'rgba(255,220,150,0.95)';
				ctx.fillRect(x - 2.6, y - 2.6, 5.2, 5.2);
				if (!settled) {
					ctx.fillStyle = 'rgba(255,122,26,0.25)';
					ctx.fillRect(x - 7, y - 7, 14, 14);
				}
			}
		},
		[f],
	);

	const facts = [
		['17,468', '根电子管'],
		['27', '吨重'],
		['167', '平方米'],
		['150', '千瓦功耗'],
	];

	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<EraTitle year="1946" name="ENIAC" sub="第一台通用电子计算机" color={C.amber} end={176} />
			<Glow x={540} y={790} r={520} color={C.amberHot} opacity={0.25 * clamp((f - 20) / 40) * dim} />

			{/* machine */}
			<div style={{position: 'absolute', inset: 0, opacity: ep(f, 4, 20)}}>
				<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
					<defs>
						<radialGradient id="tubeGlow">
							<stop offset="0" stopColor="#ffb03a" stopOpacity="0.9" />
							<stop offset="0.5" stopColor="#ff7a1a" stopOpacity="0.25" />
							<stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
						</radialGradient>
					</defs>
					<rect x={WX - 26} y={WY - 50} width={752} height={ROWS * PY + 90} rx={10} fill="#120d09" stroke="#4d3b2a" strokeWidth={4} opacity={0.92} />
					{/* neon register lights */}
					{Array.from({length: 40}, (_, i) => {
						const lit = random(`neon-${i}-${Math.floor(f / 3)}`) > 0.55 && f > 30;
						return (
							<circle
								key={i}
								cx={WX + 6 + i * 17.5}
								cy={WY - 26}
								r={5}
								fill={lit ? '#ff5a2a' : '#3a2418'}
								opacity={dim}
								style={lit ? {filter: 'drop-shadow(0 0 4px #ff5a2a)'} : undefined}
							/>
						);
					})}
					{TUBES.map((t, i) => (
						<TubeSvg key={i} t={t} frame={f} dim={dim} />
					))}
				</svg>
			</div>

			{/* facts */}
			<div
				style={{
					position: 'absolute',
					top: 1060,
					left: 150,
					right: 150,
					display: 'flex',
					flexWrap: 'wrap',
					gap: 18,
					justifyContent: 'center',
					opacity: 1 - ep(f, 160, 172),
				}}
			>
				{facts.map(([n, u], i) => {
					const p = ep(f, 60 + i * 9, 74 + i * 9);
					return (
						<div key={n} style={{opacity: p, transform: `translateY(${(1 - p) * 20}px)`}}>
							<Tag color={C.amber}>
								<span style={{fontFamily: '"Orbitron"', fontWeight: 900}}>{n}</span>
								<span>{u}</span>
							</Tag>
						</div>
					);
				})}
			</div>

			<canvas ref={canvasRef} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />

			{/* counter */}
			{f >= 172 ? (
				<div
					style={{
						position: 'absolute',
						top: 1010,
						left: 0,
						right: 0,
						transform: `scale(${f < HIT ? 1 : 1 + 0.35 * Math.exp(-(f - HIT) / 5)})`,
					}}
				>
					<Digits value={fmtInt(N * arrivals)} size={170} color="#fff" glow={C.amber} />
					<div
						style={{
							textAlign: 'center',
							marginTop: 10,
							fontFamily: FONT_CN,
							fontWeight: 900,
							fontSize: 54,
							color: C.amber,
							textShadow: `0 0 16px ${C.amberHot}`,
						}}
					>
						次加法 / 秒
					</div>
				</div>
			) : null}
			<Shockwave x={540} y={780} at={HIT} color={C.amber} radius={1000} />
			<Flash at={HIT} color={C.amber} peak={0.35} decay={8} />

			<Caption text="1946 年，ENIAC 诞生" start={8} end={64} accent={C.amber} />
			<Caption text="重 [27] 吨，塞满一整个房间" start={66} end={126} accent={C.amber} />
			<Caption text="它每秒能算——" start={130} end={192} accent={C.amber} />
			<Caption text="比心算快 [5,000] 倍" start={204} end={264} accent={C.amber} />
			<Caption text="在当时，这就是奇迹" start={266} end={322} accent={C.amber} />
		</AbsoluteFill>
	);
};
