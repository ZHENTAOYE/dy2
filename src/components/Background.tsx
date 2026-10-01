import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C} from '../theme';
import {IMPACTS, SCENES, TOTAL_FRAMES, sceneStart} from '../timeline';
import {clamp, lerp, mulberry} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

// Base warp speed and tint of each scene; escalates through the film.
const SCENE_LOOK: Record<string, {speed: number; tint: string; neb: string}> = {
	hook: {speed: 0.12, tint: '#bfe9ff', neb: '#0b2a4a'},
	human: {speed: 0.22, tint: '#dfe9ff', neb: '#13213f'},
	eniac: {speed: 0.32, tint: '#ffd7a0', neb: '#3a1c05'},
	i4004: {speed: 0.45, tint: '#b5ffd2', neb: '#06301a'},
	cpu: {speed: 0.65, tint: '#aef3ff', neb: '#05304a'},
	dilation: {speed: 0.9, tint: '#cbbcff', neb: '#1e0f4a'},
	gpu: {speed: 1.2, tint: '#ffb8f7', neb: '#3e0842'},
	super: {speed: 1.6, tint: '#ffc2a8', neb: '#4a0e05'},
	finale: {speed: 0.25, tint: '#fff1cf', neb: '#0a1636'},
};

const hexToRgb = (h: string) => {
	const n = parseInt(h.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixHex = (a: string, b: string, t: number) => {
	const A = hexToRgb(a);
	const B = hexToRgb(b);
	return `#${A.map((v, i) =>
		Math.round(lerp(v, B[i], t))
			.toString(16)
			.padStart(2, '0'),
	).join('')}`;
};

/** Scene look at a global frame, cross-fading over 30 frames at boundaries. */
export const lookAt = (f: number) => {
	let i = 0;
	for (let k = 0; k < SCENES.length; k++) if (f >= SCENES[k].from) i = k;
	const cur = SCENE_LOOK[SCENES[i].id];
	const prev = i > 0 ? SCENE_LOOK[SCENES[i - 1].id] : cur;
	const t = clamp((f - SCENES[i].from) / 30);
	return {
		speed: lerp(prev.speed, cur.speed, t),
		tint: mixHex(prev.tint, cur.tint, t),
		neb: mixHex(prev.neb, cur.neb, t),
	};
};

const finaleSpeed = (f: number, base: number) => {
	const s = sceneStart('finale');
	const l = f - s;
	if (l < 0) return base;
	// cosmic pull-back warp, then near standstill for the final second
	if (l >= 330 && l < 600) {
		const t = (l - 330) / 270;
		return lerp(0.4, 9, t * t);
	}
	if (l >= 600 && l < 700) return lerp(9, 0.02, clamp((l - 600) / 12));
	if (l >= 700 && l < 760) return lerp(6, 0.3, clamp((l - 702) / 40));
	return base;
};

const speedAt = (f: number) => {
	let s = finaleSpeed(f, lookAt(f).speed);
	for (const im of IMPACTS) {
		const d = f - im.at;
		if (d >= 0 && d < 40) s += im.power * 4 * Math.exp(-d / 8);
	}
	return s;
};

// Precomputed travelled distance per frame (deterministic, frame-pure).
const DIST: number[] = (() => {
	const arr = new Array(TOTAL_FRAMES + 2).fill(0);
	for (let f = 1; f < arr.length; f++) arr[f] = arr[f - 1] + speedAt(f);
	return arr;
})();

const N = 1100;
const STARS = (() => {
	const r = mulberry(42);
	return Array.from({length: N}, () => ({
		x: (r() * 2 - 1) * 1.6,
		y: (r() * 2 - 1) * 2.4,
		z: r(),
		b: 0.35 + r() * 0.65,
		s: 0.6 + r() * 1.6,
	}));
})();

export const Background: React.FC = () => {
	const frame = useCurrentFrame();
	const look = lookAt(frame);
	const speed = speedAt(frame);
	const ref = useCanvas(
		(ctx, w, h) => {
			const cx = w / 2;
			const cy = h * 0.43;
			const fl = 520;
			const d = DIST[Math.min(frame, DIST.length - 1)] * 0.0042;
			const dPrev = DIST[Math.max(0, Math.min(frame - 1, DIST.length - 1))] * 0.0042;
			ctx.globalCompositeOperation = 'lighter';
			ctx.lineCap = 'round';
			for (const st of STARS) {
				const z = ((((st.z - d) % 1) + 1) % 1) + 0.02;
				const zp = Math.min(1.02, z + (d - dPrev) * 1.0);
				const sx = cx + (st.x / z) * fl;
				const sy = cy + (st.y / z) * fl;
				if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
				const px = cx + (st.x / zp) * fl;
				const py = cy + (st.y / zp) * fl;
				const near = 1 - z;
				const a = clamp(st.b * (0.25 + near * 1.1) * clamp(z * 8));
				ctx.strokeStyle = look.tint;
				ctx.globalAlpha = a;
				ctx.lineWidth = st.s * (0.6 + near * 2.2);
				ctx.beginPath();
				ctx.moveTo(px, py);
				ctx.lineTo(sx + 0.01, sy + 0.01);
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		},
		[frame],
	);
	const drift = Math.sin(frame / 90) * 60;
	return (
		<div style={{position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden'}}>
			<div
				style={{
					position: 'absolute',
					inset: -200,
					background: `radial-gradient(ellipse 60% 40% at ${50 + drift / 20}% 42%, ${look.neb} 0%, transparent 70%), radial-gradient(ellipse 50% 30% at 20% 80%, ${look.neb}aa 0%, transparent 70%)`,
					opacity: 0.9,
				}}
			/>
			<canvas
				ref={ref}
				width={1080}
				height={1920}
				style={{position: 'absolute', inset: 0, opacity: clamp(0.55 + speed * 0.1)}}
			/>
		</div>
	);
};
