import React from 'react';
import {useCurrentFrame} from 'remotion';
import {clamp, easeOut} from '../lib/util';

/** Expanding glowing ring. */
export const Shockwave: React.FC<{
	x: number;
	y: number;
	at: number;
	color?: string;
	radius?: number;
	duration?: number;
	width?: number;
}> = ({x, y, at, color = '#fff', radius = 900, duration = 28, width = 26}) => {
	const frame = useCurrentFrame();
	const t = (frame - at) / duration;
	if (t < 0 || t > 1) return null;
	const e = easeOut(t);
	const r = e * radius;
	return (
		<div
			style={{
				position: 'absolute',
				left: x - r,
				top: y - r,
				width: r * 2,
				height: r * 2,
				borderRadius: '50%',
				border: `${Math.max(1, width * (1 - t))}px solid ${color}`,
				opacity: (1 - t) * 0.9,
				boxShadow: `0 0 40px ${color}, inset 0 0 40px ${color}`,
				pointerEvents: 'none',
			}}
		/>
	);
};

/** Full-screen colour flash. */
export const Flash: React.FC<{at: number; color?: string; peak?: number; decay?: number}> = ({
	at,
	color = '#fff',
	peak = 0.85,
	decay = 10,
}) => {
	const frame = useCurrentFrame();
	const t = frame - at;
	if (t < -2 || t > decay * 4) return null;
	const o = t < 0 ? peak * (1 + t / 2) * 0.6 : peak * Math.exp(-t / decay);
	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				background: color,
				opacity: clamp(o),
				mixBlendMode: 'screen',
				pointerEvents: 'none',
			}}
		/>
	);
};

/** Radial light rays (god rays) burst. */
export const Rays: React.FC<{
	x: number;
	y: number;
	color: string;
	count?: number;
	opacity?: number;
	rotate?: number;
	length?: number;
}> = ({x, y, color, count = 24, opacity = 1, rotate = 0, length = 1400}) => {
	const stops: string[] = [];
	for (let i = 0; i < count; i++) {
		const a = (360 / count) * i;
		const w = 360 / count / 5;
		stops.push(`transparent ${a}deg`, `${color} ${a + w}deg`, `transparent ${a + w * 2}deg`);
	}
	return (
		<div
			style={{
				position: 'absolute',
				left: x - length,
				top: y - length,
				width: length * 2,
				height: length * 2,
				borderRadius: '50%',
				background: `conic-gradient(from ${rotate}deg, ${stops.join(',')})`,
				WebkitMaskImage: 'radial-gradient(circle, black 0%, rgba(0,0,0,0.5) 30%, transparent 70%)',
				maskImage: 'radial-gradient(circle, black 0%, rgba(0,0,0,0.5) 30%, transparent 70%)',
				opacity,
				mixBlendMode: 'screen',
				pointerEvents: 'none',
			}}
		/>
	);
};

/** Big punch-in scale for impact moments: returns transform scale. */
export const punch = (frame: number, at: number, amount = 0.25, dur = 14) => {
	const t = clamp((frame - at) / dur);
	if (frame < at) return 1 + amount;
	return 1 + amount * (1 - easeOut(t));
};

/** Soft radial glow blob. */
export const Glow: React.FC<{
	x: number;
	y: number;
	r: number;
	color: string;
	opacity?: number;
}> = ({x, y, r, color, opacity = 1}) => (
	<div
		style={{
			position: 'absolute',
			left: x - r,
			top: y - r,
			width: r * 2,
			height: r * 2,
			borderRadius: '50%',
			background: `radial-gradient(circle, ${color} 0%, ${color}55 30%, transparent 70%)`,
			opacity,
			mixBlendMode: 'screen',
			pointerEvents: 'none',
		}}
	/>
);
