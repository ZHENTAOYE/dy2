import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption} from '../components/Caption';
import {Digits} from '../components/Digits';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {Glitch, glitchAt} from '../components/Glitch';
import {C, FONT_CN, FONT_MONO} from '../theme';
import {clamp, easeIn, easeInOut, ep, expLerp, fmtInt, mulberry, prog} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const HIT = 430;
const COLS = 132;
const ROWS = 128; // 16,896 cores
const NOISE = (() => {
	const r = mulberry(16896);
	return Float32Array.from({length: COLS * ROWS}, () => r());
})();

const CoreGrid: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 36, 50) * (1 - ep(f, 196, 210));
	const zoom = ep(f, 52, 138, easeInOut);
	const s = expLerp(240, 5.4, zoom);
	const ref = useCanvas(
		(ctx, w, h) => {
			if (vis <= 0) return;
			const cx = 540;
			const cy = 790;
			const ox = cx - (COLS / 2) * s;
			const oy = cy - (ROWS / 2) * s;
			const c0 = Math.max(0, Math.floor((0 - ox) / s));
			const c1 = Math.min(COLS, Math.ceil((w - ox) / s));
			const r0 = Math.max(0, Math.floor((0 - oy) / s));
			const r1 = Math.min(ROWS, Math.ceil((h - oy) / s));
			const gap = Math.max(1, s * 0.16);
			const lit = clamp((f - 44) / 12);
			for (let r = r0; r < r1; r++) {
				for (let c = c0; c < c1; c++) {
					const n = NOISE[r * COLS + c];
					const dx = c - COLS / 2;
					const dy = r - ROWS / 2;
					const dist = Math.sqrt(dx * dx + dy * dy);
					const w1 = Math.pow(0.5 + 0.5 * Math.sin(dist * 0.32 - f * 0.45), 5);
					const w2 = Math.pow(0.5 + 0.5 * Math.sin((c - r) * 0.17 + f * 0.3), 8);
					const w3 = Math.pow(0.5 + 0.5 * Math.sin(c * 0.09 + r * 0.21 - f * 0.22), 10);
					const spark = n > 0.97 && Math.sin(f * 1.7 + n * 500) > 0.2 ? 1 : 0;
					const a = Math.min(1, 0.22 + 0.8 * w1 + 0.6 * w2 + spark) * lit;
					const R = Math.round(120 + 135 * Math.max(w1, spark));
					const G = Math.round(40 + 180 * Math.max(w3 * 0.8, spark * 0.9));
					const B = Math.round(200 + 55 * w2);
					ctx.fillStyle = `rgba(${R},${G},${B},${a})`;
					ctx.fillRect(ox + c * s + gap / 2, oy + r * s + gap / 2, s - gap, s - gap);
				}
			}
			if (s > 40) {
				// close-up detail: the single core in the middle
				const k = clamp((s - 40) / 120);
				ctx.strokeStyle = `rgba(255,255,255,${0.9 * k})`;
				ctx.lineWidth = 4;
				ctx.strokeRect(ox + (COLS / 2) * s + gap / 2, oy + (ROWS / 2) * s + gap / 2, s - gap, s - gap);
			}
		},
		[f],
	);
	const labelP = ep(f, 128, 142);
	return (
		<AbsoluteFill style={{opacity: vis}}>
			<canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />
			<div
				style={{
					position: 'absolute',
					top: 1180,
					left: 0,
					right: 0,
					textAlign: 'center',
					opacity: labelP,
					transform: `translateY(${(1 - labelP) * 20}px)`,
					fontFamily: FONT_CN,
					fontWeight: 900,
					fontSize: 56,
					color: '#fff',
					textShadow: `0 0 20px ${C.magenta}`,
				}}
			>
				<span style={{fontFamily: '"Orbitron"', color: C.magenta}}>16,896</span> 个计算核心
			</div>
			<div
				style={{
					position: 'absolute',
					top: 760,
					left: 0,
					right: 0,
					textAlign: 'center',
					fontFamily: FONT_MONO,
					fontWeight: 700,
					fontSize: 40,
					color: '#fff',
					opacity: 1 - ep(f, 60, 80),
					textShadow: '0 0 10px #000',
				}}
			>
				1 个核心
			</div>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- mandelbrot
const MW = 600;
const MH = 600;
const TX = -0.743643887037151;
const TY = 0.13182590420533;

// cyclic gradient: navy → violet → magenta → pink-white → cyan → blue → navy
const STOPS: [number, number, number, number][] = [
	[0, 8, 4, 36],
	[0.18, 110, 36, 220],
	[0.36, 255, 46, 230],
	[0.5, 255, 196, 250],
	[0.64, 43, 228, 255],
	[0.82, 40, 70, 210],
	[1, 8, 4, 36],
];
const palette = (t: number): [number, number, number] => {
	const x = t - Math.floor(t);
	for (let i = 1; i < STOPS.length; i++) {
		if (x <= STOPS[i][0]) {
			const a = STOPS[i - 1];
			const b = STOPS[i];
			const k = (x - a[0]) / (b[0] - a[0]);
			return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
		}
	}
	return [STOPS[0][1], STOPS[0][2], STOPS[0][3]];
};

const Mandel: React.FC<{f: number}> = ({f}) => {
	const vis = ep(f, 198, 212);
	const reveal = prog(f, 202, 238);
	// log-linear zoom: ×10 roughly every 45 frames, up to a million-fold
	const scale = 3.0 / Math.pow(10, 6 * prog(f, 236, 510));
	const cx = -0.6 + (TX + 0.6) * ep(f, 236, 290, easeInOut);
	const cy = 0 + TY * ep(f, 236, 290, easeInOut);
	const maxIter = Math.round(110 + 70 * Math.log10(3.0 / scale));
	const dimBg = 1 - 0.65 * ep(f, 380, 400);
	const ref = useCanvas(
		(ctx) => {
			if (vis <= 0) return;
			const img = ctx.createImageData(MW, MH);
			const rows = Math.floor(reveal * MH);
			const shift = f * 0.004;
			for (let y = 0; y < rows; y++) {
				const ci = cy + (y / MH - 0.5) * scale;
				for (let x = 0; x < MW; x++) {
					const cr = cx + (x / MW - 0.5) * scale;
					let zr = 0;
					let zi = 0;
					let n = 0;
					let zr2 = 0;
					let zi2 = 0;
					while (n < maxIter && zr2 + zi2 < 256) {
						zi = 2 * zr * zi + ci;
						zr = zr2 - zi2 + cr;
						zr2 = zr * zr;
						zi2 = zi * zi;
						n++;
					}
					const o = (y * MW + x) * 4;
					if (n >= maxIter) {
						img.data[o] = 4;
						img.data[o + 1] = 2;
						img.data[o + 2] = 12;
					} else {
						const mu = n + 1 - Math.log(Math.log(Math.sqrt(zr2 + zi2))) / Math.LN2;
						const [R, G, B] = palette(Math.sqrt(mu) * 0.26 + shift);
						img.data[o] = R;
						img.data[o + 1] = G;
						img.data[o + 2] = B;
					}
					img.data[o + 3] = 255;
				}
			}
			ctx.putImageData(img, 0, 0);
		},
		[f],
	);
	const D = 860;
	const left = 540 - D / 2;
	const top = 790 - D / 2;
	return (
		<AbsoluteFill style={{opacity: vis * dimBg}}>
			<div
				style={{
					position: 'absolute',
					left: left - 4,
					top: top - 4,
					width: D + 8,
					height: D + 8,
					border: `2px solid ${C.magenta}`,
					boxShadow: `0 0 60px ${C.magenta}66`,
					borderRadius: 4,
				}}
			/>
			<canvas ref={ref} width={MW} height={MH} style={{position: 'absolute', left, top, width: D, height: D}} />
			{reveal < 1 && reveal > 0 ? (
				<div
					style={{
						position: 'absolute',
						left: left - 10,
						width: D + 20,
						top: top + reveal * D - 4,
						height: 8,
						background: '#fff',
						boxShadow: `0 0 30px 10px ${C.magenta}`,
					}}
				/>
			) : null}
			<div
				style={{
					position: 'absolute',
					left,
					top: top + D + 16,
					width: D,
					display: 'flex',
					justifyContent: 'space-between',
					fontFamily: FONT_MONO,
					fontSize: 24,
					color: '#e8b8ff',
				}}
			>
				<span>迭代上限 {maxIter}</span>
				<span>放大 ×{fmtInt(3.0 / scale)}</span>
			</div>
		</AbsoluteFill>
	);
};

export const Gpu: React.FC = () => {
	const f = useCurrentFrame();
	const introOut = ep(f, 34, 44, easeIn);
	const g = glitchAt(f, [8, 20, 28], 5);
	const count = expLerp(3e11, 1e15, ep(f, HIT - 26, HIT, easeIn));
	const slam = f >= HIT ? 1 + 0.4 * Math.exp(-(f - HIT) / 5) : 1;
	const out = ep(f, 498, 510);
	return (
		<AbsoluteFill style={{opacity: 1 - out}}>
			<Glow x={540} y={790} r={650} color="#7a10a0" opacity={0.45 * ep(f, 30, 60)} />
			{/* "This is only the CPU." */}
			<AbsoluteFill style={{background: `rgba(0,0,0,${0.85 * (1 - introOut)})`}} />
			{f < 46 ? (
				<AbsoluteFill style={{opacity: 1 - introOut, transform: `scale(${1 + introOut * 1.5})`, justifyContent: 'center', alignItems: 'center'}}>
					<Glitch
						amount={g}
						seed="cpuonly"
						style={{transform: `scale(${f < 8 ? 1.5 : 1 + 0.12 * Math.exp(-(f - 8) / 5)})`}}
						render={(c) => (
							<div
								style={{
									fontFamily: FONT_CN,
									fontWeight: 900,
									fontSize: 104,
									color: c ?? '#fff',
									textAlign: 'center',
									lineHeight: 1.3,
									textShadow: c ? undefined : `0 0 30px ${C.magenta}`,
								}}
							>
								而这，
								<br />
								还只是 CPU。
							</div>
						)}
					/>
				</AbsoluteFill>
			) : null}
			<CoreGrid f={f} />
			<Mandel f={f} />

			{f >= HIT - 26 ? (
				<div style={{position: 'absolute', top: 640, left: 0, right: 0, transform: `scale(${slam})`, opacity: ep(f, HIT - 26, HIT - 20)}}>
					<div style={{position: 'absolute', left: 0, right: 0, top: -80, height: 360, background: 'radial-gradient(ellipse 55% 50% at 50% 50%, rgba(10,0,20,0.92), transparent)'}} />
					<div style={{position: 'relative', textAlign: 'center', fontFamily: FONT_CN, fontWeight: 900, fontSize: 52, color: '#f3c8ff', marginBottom: 26}}>每秒约</div>
					<Digits value={fmtInt(count)} size={60} color="#fff" glow={C.magenta} style={{position: 'relative'}} />
					<div
						style={{
							position: 'relative',
							textAlign: 'center',
							marginTop: 28,
							fontFamily: FONT_CN,
							fontWeight: 900,
							fontSize: 60,
							color: C.magenta,
							textShadow: `0 0 18px ${C.magenta}`,
						}}
					>
						次运算
					</div>
				</div>
			) : null}
			{f >= HIT ? <Rays x={540} y={760} color={C.magenta} count={36} rotate={f * 0.6} opacity={0.45 * (1 - ep(f, 470, 505))} /> : null}
			<Shockwave x={540} y={760} at={HIT} color={C.magenta} radius={1200} />
			<Flash at={HIT} color={C.magenta} peak={0.5} decay={9} />
			<Flash at={8} color={C.magenta} peak={0.35} decay={6} />

			<Caption text="一块顶级 AI 芯片" start={46} end={90} accent={C.magenta} />
			<Caption text="里面有 [上万个] 计算核心" start={92} end={140} accent={C.magenta} />
			<Caption text="它们，同时开工" start={144} end={198} accent={C.magenta} />
			<Caption text="画这样一幅图，每个像素都要迭代上百次" start={204} end={262} accent={C.magenta} size={48} />
			<Caption text="一整幅画面，就是 [几十亿] 次计算" start={264} end={318} accent={C.magenta} size={54} />
			<Caption text="而它，一眨眼就能画完 [上千幅]" start={320} end={380} accent={C.magenta} size={54} />
			<Caption text="一块芯片的算力——" start={386} end={428} accent={C.magenta} />
			<Caption text="每秒约 [1000 万亿] 次" start={434} end={505} accent={C.magenta} />
		</AbsoluteFill>
	);
};
