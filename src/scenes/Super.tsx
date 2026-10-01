import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption, Tag} from '../components/Caption';
import {Digits} from '../components/Digits';
import {Flash, Glow, Rays, Shockwave} from '../components/Fx';
import {C, FONT_CN} from '../theme';
import {clamp, easeInOut, ep, fmtInt, lerp, mulberry, noise1, prog} from '../lib/util';
import {useCanvas} from '../lib/useCanvas';

const HIT = 300;
const STEPS = [
	{at: 196, v: 1.7e3, cn: '1700'},
	{at: 212, v: 1.7e6, cn: '170 万'},
	{at: 228, v: 1.7e9, cn: '17 亿'},
	{at: 244, v: 1.7e12, cn: '1.7 万亿'},
	{at: 260, v: 1.7e15, cn: '1700 万亿'},
	{at: HIT, v: 1.7e18, cn: '170 亿亿'},
];

// ---------------------------------------------------------------- data hall
const AISLES = 11;
const PER_SIDE = 44;
const RACK_W = 0.62; // along z
const RACK_D = 1.0; // along x
const RACK_H = 2.1;
type Rack = {x0: number; x1: number; face: number; z0: number; seed: number};
const RACKS: Rack[] = (() => {
	const out: Rack[] = [];
	for (let m = -(AISLES >> 1); m <= AISLES >> 1; m++) {
		const ax = m * 3.4;
		for (let k = 0; k < PER_SIDE; k++) {
			const z0 = k * (RACK_W + 0.04);
			out.push({x0: ax - 0.8 - RACK_D, x1: ax - 0.8, face: ax - 0.8, z0, seed: out.length});
			out.push({x0: ax + 0.8, x1: ax + 0.8 + RACK_D, face: ax + 0.8, z0, seed: out.length});
		}
	}
	return out;
})();
const LED_COLORS = ['255,59,47', '255,138,31', '255,214,107', '255,255,255', '255,90,60'];
const LEDS = (() => {
	const r = mulberry(1018);
	return RACKS.map(() =>
		Array.from({length: 18}, (_, i) => ({
			u: 0.15 + (i % 3) * 0.35,
			v: 0.08 + Math.floor(i / 3) * 0.15,
			c: LED_COLORS[Math.floor(r() * LED_COLORS.length)],
			ph: r() * 100,
			rate: 0.2 + r() * 1.2,
		})),
	);
})();

// glide into the aisle, then rise and pull back to reveal the whole hall
const camAt = (f: number) => {
	const fly = ep(f, 0, 70, easeInOut);
	const rise = ep(f, 60, 180, easeInOut);
	const b = prog(f, 180, 480);
	return {
		x: 0,
		y: lerp(0.9, 7.5, rise) + b * 2.5,
		z: lerp(-2.5, 1.2, fly) - 10.2 * rise - b * 3,
		pitch: lerp(0.03, 0.42, rise) + b * 0.08,
		yaw: Math.sin(f / 90) * 0.04 * rise,
	};
};

const DataHall: React.FC<{f: number}> = ({f}) => {
	const flare = f >= HIT ? Math.exp(-(f - HIT) / 25) : 0;
	const charge = ep(f, 262, HIT);
	const ref = useCanvas(
		(ctx, w, h) => {
			const cam = camAt(f);
			const F = 900;
			const cp = Math.cos(cam.pitch);
			const sp = Math.sin(cam.pitch);
			const cyw = Math.cos(cam.yaw);
			const syw = Math.sin(cam.yaw);
			const proj = (X: number, Y: number, Z: number) => {
				let x = X - cam.x;
				const y = Y - cam.y;
				let z = Z - cam.z;
				const xr = x * cyw - z * syw;
				z = x * syw + z * cyw;
				x = xr;
				const zc = -y * sp + z * cp;
				const yc = y * cp + z * sp;
				return {x: w / 2 + (x / zc) * F, y: h * 0.42 - (yc / zc) * F, z: zc};
			};
			// floor grid
			ctx.lineWidth = 1.5;
			for (let gx = -20; gx <= 20; gx += 1.7) {
				const a = proj(gx, 0, cam.z + 0.5);
				const b = proj(gx, 0, 40);
				if (a.z <= 0.1) continue;
				ctx.strokeStyle = 'rgba(255,59,47,0.18)';
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
			// data pulses running along each aisle floor
			ctx.globalCompositeOperation = 'lighter';
			for (let m = -(AISLES >> 1); m <= AISLES >> 1; m++) {
				for (let k = 0; k < 3; k++) {
					const zz = ((f * (0.25 + 0.6 * charge + 0.6 * flare) + k * 10 + m * 3.3) % 30) + cam.z * 0;
					const a = proj(m * 3.4, 0.01, zz);
					const b = proj(m * 3.4, 0.01, zz + 2.2);
					if (a.z <= 0.15 || b.z <= 0.15) continue;
					const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
					g.addColorStop(0, 'rgba(255,140,40,0)');
					g.addColorStop(1, 'rgba(255,220,160,0.9)');
					ctx.strokeStyle = g;
					ctx.lineWidth = Math.max(2, 30 / b.z);
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.stroke();
				}
			}
			ctx.globalCompositeOperation = 'source-over';
			// racks, far to near
			const order = RACKS.map((r, i) => {
				const dx = (r.x0 + r.x1) / 2 - cam.x;
				const dz = r.z0 + RACK_W / 2 - cam.z;
				return {i, d: dx * dx + dz * dz};
			}).sort((a, b) => b.d - a.d);
			const ledBoost = 0.6 + 0.4 * charge + flare;
			for (const {i} of order) {
				const r = RACKS[i];
				const z0 = r.z0;
				const z1 = r.z0 + RACK_W;
				const p00 = proj(r.face, 0, z0);
				const p01 = proj(r.face, RACK_H, z0);
				const p10 = proj(r.face, 0, z1);
				const p11 = proj(r.face, RACK_H, z1);
				if (p00.z < 0.2 || p10.z < 0.2) continue;
				if (Math.max(p00.x, p10.x) < -50 || Math.min(p00.x, p10.x) > w + 50) continue;
				const back = r.face === r.x1 ? r.x0 : r.x1;
				// top face
				const t0 = proj(back, RACK_H, z0);
				const t1 = proj(back, RACK_H, z1);
				ctx.fillStyle = '#1a0a0c';
				ctx.strokeStyle = 'rgba(255,90,60,0.35)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(p01.x, p01.y);
				ctx.lineTo(p11.x, p11.y);
				ctx.lineTo(t1.x, t1.y);
				ctx.lineTo(t0.x, t0.y);
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
				// front face
				ctx.fillStyle = '#0d0405';
				ctx.strokeStyle = 'rgba(255,80,50,0.5)';
				ctx.beginPath();
				ctx.moveTo(p00.x, p00.y);
				ctx.lineTo(p10.x, p10.y);
				ctx.lineTo(p11.x, p11.y);
				ctx.lineTo(p01.x, p01.y);
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
				// LEDs
				const sz = Math.max(1.2, 26 / p00.z);
				for (const L of LEDS[i]) {
					const on = Math.sin(f * L.rate + L.ph) > -0.2 ? 1 : 0.15;
					const a = clamp(on * ledBoost);
					if (a < 0.05) continue;
					const zz = z0 + L.u * RACK_W;
					const yy = RACK_H * (1 - L.v);
					const p = proj(r.face, yy, zz);
					ctx.fillStyle = `rgba(${L.c},${a})`;
					ctx.fillRect(p.x - sz / 2, p.y - sz / 4, sz, sz / 2);
				}
			}
			// cheap bloom
			ctx.globalCompositeOperation = 'lighter';
			ctx.filter = 'blur(10px)';
			ctx.globalAlpha = 0.7 + 0.6 * flare;
			ctx.drawImage(ctx.canvas, 0, 0);
			ctx.filter = 'none';
			ctx.globalAlpha = 1;
		},
		[f],
	);
	return <canvas ref={ref} width={1080} height={1920} style={{position: 'absolute', inset: 0}} />;
};

const fitSize = (s: string, max: number, width = 800) => {
	let units = 0;
	for (const ch of s) units += ch === ',' ? 0.38 : 0.86;
	return Math.min(max, width / units);
};

export const Super: React.FC = () => {
	const f = useCurrentFrame();
	const hallIn = ep(f, 0, 20);
	const dim = Math.min(1, 1 - 0.4 * ep(f, 180, 196) + (f >= HIT ? 0.5 * Math.exp(-(f - HIT) / 30) : 0));
	let step = -1;
	STEPS.forEach((s, i) => {
		if (f >= s.at) step = i;
	});
	const cur = step >= 0 ? STEPS[step] : null;
	const str = cur ? fmtInt(cur.v) : '';
	const size = fitSize(str, 150);
	const sinceStep = cur ? f - cur.at : 0;
	const isFinal = step === STEPS.length - 1;
	const slam = cur ? 1 + (isFinal ? 0.28 : 0.18) * Math.exp(-sinceStep / 5) : 1;
	// tension tremble before the final hit
	const trem = f > 262 && f < HIT ? (f - 262) / 38 : 0;
	const tx = trem * 8 * noise1(f * 2.1, 5);
	const ty = trem * 8 * noise1(f * 2.1, 9);
	const tagP = ep(f, 150, 164);
	const finalP = ep(f, HIT, HIT + 10);
	return (
		<AbsoluteFill style={{opacity: 1 - ep(f, 468, 480)}}>
			<AbsoluteFill style={{opacity: hallIn * dim}}>
				<DataHall f={f} />
			</AbsoluteFill>
			<AbsoluteFill style={{background: 'linear-gradient(to bottom, rgba(2,3,8,0.7) 0%, transparent 25%, transparent 70%, rgba(2,3,8,0.85) 100%)'}} />
			<Glow x={540} y={760} r={640} color="#a0200a" opacity={0.35 + 0.4 * ep(f, 262, HIT) * (1 - ep(f, 340, 420))} />

			<div style={{position: 'absolute', top: 300, left: 0, right: 0, textAlign: 'center', opacity: tagP * (1 - ep(f, 456, 470)), transform: `translateY(${(1 - tagP) * -20}px)`}}>
				<Tag color={C.orange} style={{fontSize: 40, padding: '12px 28px'}}>
					顶级超级计算机 · E 级
				</Tag>
			</div>

			{cur ? (
				<div style={{position: 'absolute', top: 640, left: 0, right: 0, transform: `translate(${tx}px, ${ty}px) scale(${slam})`}}>
					<div style={{position: 'absolute', left: 0, right: 0, top: -120, height: 400, background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(12,2,2,0.9), transparent)'}} />
					<div style={{position: 'relative', height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
						<Digits value={str} size={size} color="#fff" glow={isFinal ? C.red : C.orange} />
					</div>
					<div
						style={{
							position: 'relative',
							textAlign: 'center',
							marginTop: isFinal ? 30 : 16,
							fontFamily: FONT_CN,
							fontWeight: 900,
							fontSize: isFinal ? 130 : 72,
							lineHeight: 1.1,
							color: isFinal ? '#fff3e0' : C.orange,
							textShadow: isFinal ? `0 0 30px ${C.red}, 0 0 80px ${C.orange}` : `0 0 20px ${C.red}`,
						}}
					>
						{cur.cn}
						<span style={{fontSize: isFinal ? 56 : 44, color: '#ffb8a0'}}> 次 / 秒</span>
					</div>
					<div
						style={{
							position: 'relative',
							textAlign: 'center',
							marginTop: 18,
							fontFamily: '"Orbitron"',
							fontWeight: 700,
							fontSize: 54,
							color: C.gold,
							opacity: finalP,
							textShadow: `0 0 20px ${C.orange}`,
						}}
					>
						1.7 × 10¹⁸
					</div>
				</div>
			) : null}
			{STEPS.slice(0, -1).map((s) => (
				<Shockwave key={s.at} x={540} y={720} at={s.at} color={C.orange} radius={500} duration={18} width={12} />
			))}
			{f >= HIT ? <Rays x={540} y={720} color={C.red} count={40} rotate={f * 0.7} opacity={0.5 * (1 - ep(f, 360, 470))} /> : null}
			<Shockwave x={540} y={720} at={HIT} color={C.gold} radius={1400} duration={34} width={40} />
			<Shockwave x={540} y={720} at={HIT + 6} color={C.red} radius={1200} duration={34} width={24} />
			<Flash at={HIT} color="#ffd8b0" peak={0.9} decay={9} />

			<Caption text="把 [4 万多块] 这样的芯片连在一起——" start={10} end={84} accent={C.orange} size={54} />
			<Caption text="就是超级计算机" start={86} end={150} accent={C.orange} />
			<Caption text="它每秒能算多少次？" start={156} end={196} accent={C.orange} />
			<Caption text="每秒超过 [170 亿亿] 次浮点运算" start={306} end={392} accent={C.red} size={54} />
			<Caption text="这个数字，到底有多大？" start={396} end={474} accent={C.gold} />
		</AbsoluteFill>
	);
};
