import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Digits} from '../components/Digits';
import {EraTitle} from '../components/Era';
import {Flash, Glow, Shockwave} from '../components/Fx';
import {C, FONT_CN, FONT_MONO} from '../theme';
import {clamp, easeIn, ep, fmtInt, mulberry} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const GC = 384;
const GR = 240; // 384 × 240 = 92,160 ≈ 92,000 instructions
const SCALE = 2;
const GX = 540 - (GC * SCALE) / 2;
const GY = 480;
const HIT = 182;
const FILL_START = 160;

// procedural circuit traces for the die close-up
const TRACES = (() => {
	const r = mulberry(4004);
	const paths: {pts: [number, number][]; delay: number; len: number}[] = [];
	for (let i = 0; i < 170; i++) {
		let x = Math.floor(r() * 40);
		let y = Math.floor(r() * 40);
		const pts: [number, number][] = [[x, y]];
		let len = 0;
		let horiz = r() > 0.5;
		const segs = 2 + Math.floor(r() * 5);
		for (let s = 0; s < segs; s++) {
			const d = (1 + Math.floor(r() * 9)) * (r() > 0.5 ? 1 : -1);
			if (horiz) x = Math.max(0, Math.min(40, x + d));
			else y = Math.max(0, Math.min(40, y + d));
			len += Math.abs(d);
			pts.push([x, y]);
			horiz = !horiz;
		}
		paths.push({pts, delay: r() * 30, len});
	}
	return paths;
})();

const CELL_NOISE = (() => {
	const r = mulberry(92000);
	return Float32Array.from({length: GC * GR}, () => r());
})();

const Dip: React.FC<{f: number}> = ({f}) => {
	const pins = Array.from({length: 8}, (_, i) => -224 + i * 64);
	return (
		<svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
			<defs>
				<linearGradient id="dipBody" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#262b28" />
					<stop offset="1" stopColor="#0c0f0d" />
				</linearGradient>
				<linearGradient id="pin" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stopColor="#7f8b84" />
					<stop offset="0.5" stopColor="#e9f2ec" />
					<stop offset="1" stopColor="#7f8b84" />
				</linearGradient>
			</defs>
			<g transform="translate(540,790)">
				{pins.map((x) => (
					<React.Fragment key={x}>
						<rect x={x} y={-150} width={30} height={50} rx={3} fill="url(#pin)" />
						<rect x={x} y={100} width={30} height={50} rx={3} fill="url(#pin)" />
					</React.Fragment>
				))}
				<rect x={-290} y={-108} width={580} height={216} rx={10} fill="url(#dipBody)" stroke={C.green} strokeWidth={2} style={{filter: `drop-shadow(0 0 18px ${C.green}88)`}} />
				<path d="M -290 -26 A 26 26 0 0 1 -290 26" fill="#050605" stroke="#3a4a3e" strokeWidth={2} />
				<rect x={-60} y={-44} width={120} height={88} rx={4} fill="#0a0f0b" stroke={C.green} strokeWidth={2} opacity={0.4 + 0.6 * Math.abs(Math.sin(f / 10))} />
				<text x={-200} y={78} fontFamily="JetBrains Mono" fontSize={30} fill="#9fb3a7" opacity={0.85}>
					INTEL C4004
				</text>
			</g>
		</svg>
	);
};

export const Intel4004: React.FC = () => {
	const f = useCurrentFrame();
	const zoom = ep(f, 64, 108, easeIn);
	const dipOpacity = ep(f, 4, 22) * (1 - ep(f, 96, 110));
	const dieIn = ep(f, 96, 116) * (1 - ep(f, 146, 160));
	const traceP = clamp((f - 100) / 46);
	const out = ep(f, 288, 300);

	const dieRef = useCanvas(
		(ctx) => {
			if (dieIn <= 0) return;
			const S = 15;
			const ox = 540 - 20 * S;
			const oy = 790 - 20 * S;
			ctx.strokeStyle = C.green;
			ctx.lineCap = 'square';
			ctx.shadowColor = C.green;
			ctx.shadowBlur = 8;
			for (const p of TRACES) {
				const reveal = clamp(traceP * 1.6 - p.delay / 60) * p.len;
				if (reveal <= 0) continue;
				ctx.lineWidth = 3;
				ctx.globalAlpha = 0.85;
				ctx.beginPath();
				ctx.moveTo(ox + p.pts[0][0] * S, oy + p.pts[0][1] * S);
				let left = reveal;
				for (let i = 1; i < p.pts.length && left > 0; i++) {
					const [x0, y0] = p.pts[i - 1];
					const [x1, y1] = p.pts[i];
					const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
					const t = Math.min(1, left / seg);
					ctx.lineTo(ox + (x0 + (x1 - x0) * t) * S, oy + (y0 + (y1 - y0) * t) * S);
					left -= seg;
				}
				ctx.stroke();
				if (left > 0) {
					const [ex, ey] = p.pts[p.pts.length - 1];
					ctx.fillStyle = '#b8ffd6';
					ctx.fillRect(ox + ex * S - 5, oy + ey * S - 5, 10, 10);
				}
			}
			ctx.shadowBlur = 0;
			ctx.globalAlpha = 1;
		},
		[f],
	);

	// 92,000-cell instruction grid
	const fillP = clamp((f - FILL_START) / (HIT - FILL_START));
	const eniacP = ep(f, 148, 158);
	const gridOn = ep(f, 146, 156) * (1 - out);
	const gridRef = useCanvas(
		(ctx) => {
			if (gridOn <= 0) return;
			const img = ctx.createImageData(GC, GR);
			const filled = Math.floor(fillP * GC * GR);
			const frontRow = Math.floor(filled / GC);
			for (let i = 0; i < GC * GR; i++) {
				const row = Math.floor(i / GC);
				const col = i % GC;
				const n = CELL_NOISE[i];
				const isEniac = col < 100 && row < 50;
				let r = 10,
					g = 26,
					b = 16,
					a = 255;
				if (isEniac && eniacP > 0) {
					const k = (0.7 + 0.3 * Math.sin(f / 4 + n * 20)) * eniacP;
					r = 255 * k;
					g = 176 * k;
					b = 58 * k;
				} else if (i < filled) {
					const near = Math.max(0, 1 - (frontRow - row) / 10);
					// travelling diagonal "data" waves + sparkles = activity
					const wave = Math.pow(0.5 + 0.5 * Math.sin((col + row * 0.6) / 9 - f * 0.9), 6);
					const wave2 = Math.pow(0.5 + 0.5 * Math.sin((col * 0.4 - row) / 13 + f * 0.6), 8);
					const spark = n > 0.985 && Math.sin(f * 1.3 + n * 999) > 0.3 ? 1 : 0;
					const k = Math.min(1, 0.32 + 0.5 * wave + 0.4 * wave2 + spark + near);
					r = 20 + 200 * Math.max(near, spark, wave2 * 0.5);
					g = 60 + 195 * k;
					b = 40 + 140 * Math.max(near, spark * 0.8, wave * 0.4);
				} else {
					a = 120;
				}
				const o = i * 4;
				img.data[o] = r;
				img.data[o + 1] = g;
				img.data[o + 2] = b;
				img.data[o + 3] = a;
			}
			ctx.putImageData(img, 0, 0);
		},
		[f],
	);

	const count = f < FILL_START ? 5000 : 5000 + (92000 - 5000) * fillP;
	const hitScale = f < HIT ? 1 : 1 + 0.35 * Math.exp(-(f - HIT) / 5);

	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<EraTitle year="1971" name="Intel 4004" sub="第一颗商用微处理器" color={C.green} end={140} />
			<Glow x={540} y={790} r={560} color="#0b7a3a" opacity={0.4 * ep(f, 0, 30)} />
			<AbsoluteFill
				style={{
					opacity: dipOpacity,
					transform: `scale(${(0.85 + 0.15 * ep(f, 4, 26)) * (1 + zoom * 7)})`,
					transformOrigin: '540px 790px',
				}}
			>
				<Dip f={f} />
			</AbsoluteFill>
			<AbsoluteFill style={{opacity: dieIn, transform: `scale(${1.6 - 0.6 * ep(f, 96, 120)})`, transformOrigin: '540px 790px'}}>
				<div
					style={{
						position: 'absolute',
						left: 540 - 330,
						top: 790 - 330,
						width: 660,
						height: 660,
						border: `3px solid ${C.green}`,
						background: 'rgba(4,20,10,0.75)',
						boxShadow: `0 0 40px ${C.green}55, inset 0 0 60px ${C.green}22`,
					}}
				/>
				<canvas ref={dieRef} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />
			</AbsoluteFill>

			{/* instruction grid */}
			<div style={{position: 'absolute', left: GX - 6, top: GY - 6, opacity: gridOn}}>
				<div
					style={{
						position: 'absolute',
						inset: 0,
						width: GC * SCALE + 12,
						height: GR * SCALE + 12,
						border: `2px solid ${C.green}88`,
						boxShadow: `0 0 ${20 + 60 * (f >= HIT ? Math.exp(-(f - HIT) / 10) : 0)}px ${C.green}`,
					}}
				/>
				<canvas
					ref={gridRef}
					width={GC}
					height={GR}
					style={{
						position: 'absolute',
						left: 6,
						top: 6,
						width: GC * SCALE,
						height: GR * SCALE,
						imageRendering: 'pixelated',
					}}
				/>
				{/* scan beam */}
				{fillP > 0 && fillP < 1 ? (
					<div
						style={{
							position: 'absolute',
							left: 0,
							width: GC * SCALE + 12,
							top: 6 + Math.floor(fillP * GR) * SCALE - 6,
							height: 12,
							background: '#eafff2',
							boxShadow: `0 0 30px 10px ${C.green}`,
						}}
					/>
				) : null}
				<div
					style={{
						position: 'absolute',
						left: 6 + 100 * SCALE + 16,
						top: 6 + 25 * SCALE - 22,
						fontFamily: FONT_MONO,
						fontWeight: 700,
						fontSize: 30,
						color: C.amber,
						opacity: eniacP,
						textShadow: '0 0 10px #000, 0 0 4px #000',
						whiteSpace: 'nowrap',
					}}
				>
					← ENIAC 5,000
				</div>
			</div>

			{f >= 146 ? (
				<div style={{position: 'absolute', top: 1010, left: 0, right: 0, opacity: gridOn, transform: `scale(${hitScale})`}}>
					<Digits value={fmtInt(count)} size={160} color="#fff" glow={C.green} />
					<div
						style={{
							textAlign: 'center',
							marginTop: 12,
							fontFamily: FONT_CN,
							fontWeight: 900,
							fontSize: 54,
							color: C.green,
							textShadow: `0 0 16px ${C.green}`,
						}}
					>
						条指令 / 秒
					</div>
				</div>
			) : null}
			<Shockwave x={540} y={720} at={HIT} color={C.green} radius={1000} />
			<Flash at={HIT} color={C.green} peak={0.3} decay={8} />

			<Caption text="1971 年，芯片时代来了" start={10} end={60} accent={C.green} />
			<Caption text="把 [2,300] 个晶体管塞进一颗芯片" start={64} end={126} accent={C.green} size={52} />
			<Caption text="它每秒能执行——" start={130} end={180} accent={C.green} />
			<Caption text="比 ENIAC 快了 [18] 倍" start={190} end={242} accent={C.green} />
			<Caption text="从此，计算机越来越小，也越来越快" start={244} end={296} accent={C.green} size={54} />
		</AbsoluteFill>
	);
};
