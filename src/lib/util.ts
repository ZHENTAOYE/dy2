import {Easing, interpolate, random} from 'remotion';

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Linear 0→1 progress of `frame` between `start` and `end` (clamped). */
export const prog = (frame: number, start: number, end: number) =>
	clamp((frame - start) / (end - start));

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeIn = Easing.bezier(0.7, 0, 0.84, 0);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const backOut = Easing.bezier(0.34, 1.56, 0.64, 1);

/** Eased progress helper. */
export const ep = (
	frame: number,
	start: number,
	end: number,
	ease: (t: number) => number = easeOut,
) => ease(prog(frame, start, end));

/** Opacity for an element that fades in at `start` and out at `end`. */
export const fadeWindow = (frame: number, start: number, end: number, fadeIn = 8, fadeOut = 8) =>
	Math.min(
		interpolate(frame, [start, start + fadeIn], [0, 1], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		}),
		interpolate(frame, [end - fadeOut, end], [1, 0], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		}),
	);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic pseudo random in [0,1). */
export const rnd = (seed: string | number) => random(seed);

/** Simple smooth 1D value noise, deterministic. */
export const noise1 = (x: number, seed = 0) => {
	const i = Math.floor(x);
	const f = x - i;
	const a = random(`n${seed}-${i}`) * 2 - 1;
	const b = random(`n${seed}-${i + 1}`) * 2 - 1;
	const u = f * f * (3 - 2 * f);
	return a + (b - a) * u;
};

/** Mulberry32 PRNG for fast bulk deterministic randomness. */
export const mulberry = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Exponential interpolation between two positive numbers. */
export const expLerp = (a: number, b: number, t: number) => {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
};
