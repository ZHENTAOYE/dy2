// Procedurally synthesises the soundtrack (public/soundtrack.wav) so that
// every hit, tick and riser lands exactly on the frames defined in
// src/timeline.json. No samples, no external assets.
//
//   node scripts/synth-audio.mjs
import fs from 'node:fs';
import path from 'node:path';

const timeline = JSON.parse(fs.readFileSync(path.resolve('src/timeline.json'), 'utf8'));
const FPS = timeline.fps;
const SR = 48000;

const starts = {};
let acc = 0;
for (const s of timeline.scenes) {
	starts[s.id] = acc;
	acc += s.duration;
}
const TOTAL_FRAMES = acc;
const DUR = TOTAL_FRAMES / FPS + 0.5;
const N = Math.ceil(DUR * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

/** Global time (s) of a scene-local frame. */
const T = (scene, frame) => (starts[scene] + frame) / FPS;
const idx = (t) => Math.max(0, Math.min(N - 1, Math.round(t * SR)));

// ---------------------------------------------------------------- utils
let seed = 1234567;
const rand = () => {
	seed = (seed + 0x6d2b79f5) >>> 0;
	let t = seed;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const TAB = 4096;
const SIN = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) SIN[i] = Math.sin((i / TAB) * Math.PI * 2);
const fsin = (ph) => {
	const x = (ph - Math.floor(ph)) * TAB;
	const i = x | 0;
	return SIN[i] + (SIN[i + 1] - SIN[i]) * (x - i);
};
const add = (i, v, pan = 0) => {
	if (i < 0 || i >= N) return;
	L[i] += v * Math.min(1, 1 - pan);
	R[i] += v * Math.min(1, 1 + pan);
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
	const c = clamp01(x);
	return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------- primitives
/** Sine with arbitrary frequency/amp functions of local time. */
const tone = (t0, dur, freqFn, ampFn, pan = 0) => {
	let ph = 0;
	const i0 = idx(t0);
	const n = Math.floor(dur * SR);
	for (let k = 0; k < n; k++) {
		const lt = k / SR;
		ph += freqFn(lt) / SR;
		add(i0 + k, fsin(ph) * ampFn(lt), pan);
	}
};

/** Filtered noise (state-variable filter) with time-varying cutoff. */
const noise = (t0, dur, ampFn, cutFn, mode = 'lp', q = 0.7, pan = 0, width = 0.3) => {
	let low = 0;
	let band = 0;
	let lowR = 0;
	let bandR = 0;
	const i0 = idx(t0);
	const n = Math.floor(dur * SR);
	for (let k = 0; k < n; k++) {
		const lt = k / SR;
		const fc = Math.min(SR / 6, Math.max(20, cutFn(lt)));
		const F = 2 * Math.sin((Math.PI * fc) / SR);
		const a = ampFn(lt);
		const inL = rand() * 2 - 1;
		const inR = inL * (1 - width) + (rand() * 2 - 1) * width;
		low += F * band;
		const highL = inL - low - q * band;
		band += F * highL;
		lowR += F * bandR;
		const highR = inR - lowR - q * bandR;
		bandR += F * highR;
		const outL = mode === 'lp' ? low : mode === 'hp' ? highL : band;
		const outR = mode === 'lp' ? lowR : mode === 'hp' ? highR : bandR;
		const i = i0 + k;
		if (i >= 0 && i < N) {
			L[i] += outL * a * Math.min(1, 1 - pan);
			R[i] += outR * a * Math.min(1, 1 + pan);
		}
	}
};

const kick = (t, amp = 0.5) => {
	tone(t, 0.45, (lt) => 45 + 110 * Math.exp(-lt * 28), (lt) => amp * Math.exp(-lt * 7) * clamp01(lt * 800));
	noise(t, 0.03, (lt) => amp * 0.25 * Math.exp(-lt * 120), () => 3000, 'lp');
};
const hat = (t, amp = 0.08, pan = 0) => noise(t, 0.06, (lt) => amp * Math.exp(-lt * 70), () => 9000, 'hp', 0.7, pan);
const tick = (t, amp = 0.35) => {
	tone(t, 0.05, () => 2600, (lt) => amp * Math.exp(-lt * 140));
	tone(t, 0.08, () => 1300, (lt) => amp * 0.6 * Math.exp(-lt * 90));
	noise(t, 0.02, (lt) => amp * 0.6 * Math.exp(-lt * 300), () => 6000, 'hp');
};
const blip = (t, f, amp = 0.05, pan = 0) => tone(t, 0.05, () => f, (lt) => amp * Math.exp(-lt * 70) * clamp01(lt * 2000), pan);

const boom = (t, p) => {
	// pre-swell
	if (p >= 0.5) {
		const pre = 0.35 + p * 0.35;
		noise(t - pre, pre, (lt) => 0.22 * p * Math.pow(lt / pre, 3), (lt) => 400 + 6000 * Math.pow(lt / pre, 2), 'bp', 0.5);
	}
	tone(t, 2.2, (lt) => 30 + 90 * Math.exp(-lt * 9), (lt) => 0.9 * p * Math.exp(-lt * 2.2) * clamp01(lt * 400));
	tone(t, 1.2, (lt) => 62 + 60 * Math.exp(-lt * 12), (lt) => 0.35 * p * Math.exp(-lt * 4), 0.2);
	noise(t, 1.6, (lt) => 0.55 * p * Math.exp(-lt * 3.2), (lt) => 300 + 5000 * Math.exp(-lt * 5), 'lp', 0.6);
	noise(t, 0.5, (lt) => 0.12 * p * Math.exp(-lt * 9), () => 7000, 'hp', 0.7, 0, 0.8);
};

const whoosh = (t, amp = 0.16, up = true, dur = 0.9) =>
	noise(
		t - dur * 0.6,
		dur,
		(lt) => amp * Math.sin(Math.PI * clamp01(lt / dur)) ** 2,
		(lt) => (up ? 300 + 5000 * (lt / dur) ** 2 : 5000 - 4600 * (lt / dur)),
		'bp',
		0.4,
		0,
		0.7,
	);

const shing = (t, amp = 0.05) => {
	tone(t, 0.9, (lt) => 900 + 2600 * smooth(lt / 0.8), (lt) => amp * Math.sin(Math.PI * clamp01(lt / 0.9)), -0.3);
	tone(t, 0.9, (lt) => 1350 + 3900 * smooth(lt / 0.8), (lt) => amp * 0.5 * Math.sin(Math.PI * clamp01(lt / 0.9)), 0.3);
};

// ---------------------------------------------------------------- drone bed
// Root note rises a semitone each era; brightness and level rise too.
const ERA = {
	hook: {root: 55.0, cut: 260, lvl: 0.1},
	human: {root: 55.0, cut: 300, lvl: 0.11},
	eniac: {root: 58.27, cut: 420, lvl: 0.12},
	i4004: {root: 61.74, cut: 560, lvl: 0.13},
	cpu: {root: 65.41, cut: 760, lvl: 0.14},
	dilation: {root: 69.3, cut: 1000, lvl: 0.15},
	gpu: {root: 73.42, cut: 1300, lvl: 0.16},
	super: {root: 77.78, cut: 1700, lvl: 0.17},
	finale: {root: 55.0, cut: 380, lvl: 0.13},
};
const eraAt = (t) => {
	const f = t * FPS;
	let cur = 'hook';
	let prev = 'hook';
	let since = 0;
	for (const s of timeline.scenes) {
		if (f >= starts[s.id]) {
			prev = cur;
			cur = s.id;
			since = (f - starts[s.id]) / FPS;
		}
	}
	const k = smooth(since / 1.2);
	const a = ERA[prev];
	const b = ERA[cur];
	return {root: a.root + (b.root - a.root) * k, cut: a.cut + (b.cut - a.cut) * k, lvl: a.lvl + (b.lvl - a.lvl) * k};
};
const droneGain = (t) => {
	let g = smooth(t / 2.5);
	const fin = starts.finale / FPS;
	const ft = (t - fin) * FPS; // finale local frame
	if (ft >= 330 && ft < 596) g *= 1 + 1.2 * smooth((ft - 330) / 266); // swell into the cosmic hit
	if (ft >= 590) g *= 1 - smooth((ft - 590) / 14); // silence
	return g;
};
{
	const notes = [1, 1.5, 2, 3];
	const weights = [1, 0.45, 0.35, 0.12];
	const phases = notes.map(() => [rand(), rand()].map(() => new Float64Array(10)));
	for (let i = 0; i < N; i++) {
		const t = i / SR;
		const g = droneGain(t);
		if (g <= 0.0001) continue;
		const e = eraAt(t);
		const fin = starts.finale / FPS;
		let cut = e.cut;
		const ft = (t - fin) * FPS;
		if (ft >= 330) cut *= 1 + 5 * smooth((ft - 330) / 266);
		const lfo = 0.8 + 0.2 * Math.sin(t * 0.7);
		let sl = 0;
		let sr = 0;
		for (let nI = 0; nI < notes.length; nI++) {
			for (let v = 0; v < 2; v++) {
				const f0 = e.root * notes[nI] * (v === 0 ? 0.997 : 1.003);
				const ph = phases[nI][v];
				let s = 0;
				for (let h = 1; h <= 10; h++) {
					const fh = f0 * h;
					if (fh > 9000) break;
					ph[h - 1] += fh / SR;
					s += (fsin(ph[h - 1]) / h) * Math.exp(-fh / cut);
				}
				s *= weights[nI];
				if (v === 0) sl += s;
				else sr += s;
			}
		}
		L[i] += sl * e.lvl * g * lfo;
		R[i] += sr * e.lvl * g * lfo;
	}
}

// ---------------------------------------------------------------- tempo bed
// The pulse gets faster every era: the soundtrack literally accelerates.
const BPM = {eniac: 70, i4004: 84, cpu: 100, dilation: 116, gpu: 132, super: 150};
for (const [scene, bpm] of Object.entries(BPM)) {
	const s = timeline.scenes.find((x) => x.id === scene);
	const t0 = starts[scene] / FPS + 0.4;
	const t1 = (starts[scene] + s.duration) / FPS - 0.2;
	const beat = 60 / bpm;
	let n = 0;
	for (let t = t0; t < t1; t += beat / 2, n++) {
		const level = 0.22 + 0.04 * Object.keys(BPM).indexOf(scene);
		if (n % 2 === 0) kick(t, level);
		if (scene === 'gpu' || scene === 'super' || scene === 'dilation') hat(t + (n % 2 === 0 ? beat / 4 : 0), 0.05, n % 4 < 2 ? -0.4 : 0.4);
		if (scene === 'super' && n % 2 === 1) hat(t + beat / 8, 0.035, 0.2);
	}
}

// ---------------------------------------------------------------- impacts
for (const im of timeline.impacts) boom(T(im.scene, im.frame), im.power);

// scene-boundary whooshes
for (const s of timeline.scenes) {
	if (s.id === 'hook') continue;
	whoosh(starts[s.id] / FPS, 0.12 + 0.02 * Object.keys(ERA).indexOf(s.id) * 0.5, true);
}

// ladder climbs
for (const l of timeline.ladder) shing(T(l.scene, l.frame - 14), 0.045);

// ---------------------------------------------------------------- hook
tick(T('hook', 14), 0.4);
tick(T('hook', 44), 0.45);
whoosh(T('hook', 262), 0.25, true, 1.0);

// ---------------------------------------------------------------- human
for (let k = 0; k < 6; k++) blip(T('human', 28 + k * 2), 1800 + k * 60, 0.05);
for (let k = 0; k < 4; k++) tone(T('human', 74) + k * 0.0, 1.2, () => [1318.5, 1975.5, 2637][k % 3], (lt) => 0.06 * Math.exp(-lt * 4) * clamp01(lt * 400));

// ---------------------------------------------------------------- eniac: relays + particle rush
for (let k = 0; k < 40; k++) {
	const t = T('eniac', 14 + rand() * 70);
	noise(t, 0.04, (lt) => 0.12 * Math.exp(-lt * 90), () => 1800, 'bp', 0.3, rand() * 1.2 - 0.6);
}
for (let k = 0; k < 120; k++) blip(T('eniac', 168 + rand() * 28), 600 + rand() * 900, 0.03, rand() * 1.6 - 0.8);

// ---------------------------------------------------------------- 4004: scanline fill chatter
for (let k = 0; k < 180; k++) blip(T('i4004', 158 + (k / 180) * 24), 1200 + (k / 180) * 2400, 0.03, Math.sin(k) * 0.6);

// ---------------------------------------------------------------- cpu: hear the clock speed up
{
	const t0 = T('cpu', 26);
	const t1 = T('cpu', 120);
	const dur = t1 - t0;
	// displayed frequency grows as 10^(9.7 * x^2.4); audible rendition caps at ~3.5 kHz
	const hzAt = (lt) => Math.pow(10, Math.log10(5e9) * Math.pow(clamp01(lt / dur), 2.4));
	let lastTick = -1;
	for (let lt = 0; lt < dur; lt += 1 / 2000) {
		const hz = hzAt(lt);
		if (hz < 25) {
			const n = Math.floor(lt * hz * 2);
			if (n !== lastTick) {
				tick(t0 + lt, 0.18);
				lastTick = n;
			}
		}
	}
	let ph = 0;
	const i0 = idx(t0);
	const n = Math.floor(dur * SR);
	for (let k = 0; k < n; k++) {
		const lt = k / SR;
		const hz = hzAt(lt);
		const audible = Math.min(3500, hz);
		ph += audible / SR;
		const sq = fsin(ph) > 0 ? 1 : -1;
		const a = 0.045 * smooth((Math.log10(hz) - 1.2) / 1.2);
		add(i0 + k, sq * a * (0.7 + 0.3 * fsin(ph * 0.5)));
	}
	// light orbit hum + freeze
	tone(T('cpu', 192), 2.1, (lt) => 220 + 440 * (lt / 2.1), (lt) => 0.05 * Math.sin(Math.PI * clamp01(lt / 2.1)));
	tone(T('cpu', 264), 1.2, (lt) => 880 * Math.exp(-lt * 1.5), (lt) => 0.06 * Math.exp(-lt * 2));
	// ruler: light pulse zip
	tone(T('cpu', 300), 0.6, (lt) => 400 + 3200 * Math.min(1, lt / 0.6), (lt) => 0.08 * Math.exp(-lt * 3), 0.3);
	// cores booting
	for (let k = 0; k < 16; k++) blip(T('cpu', 356 + ((k * 7) % 16) * 2.2), 700 + k * 90, 0.06, (k % 4) / 2 - 0.75);
	for (let k = 0; k < 140; k++) blip(T('cpu', 414 + (k / 140) * 16), 900 + rand() * 3000, 0.025, rand() * 1.6 - 0.8);
}

// ---------------------------------------------------------------- dilation: time tunnel
{
	noise(T('dilation', 52), 1.4, (lt) => 0.1 * Math.sin(Math.PI * clamp01(lt / 1.4)), (lt) => 200 + 2400 * lt, 'bp', 0.3);
	const hits = [130, 225, 330, 450];
	for (const h of hits) {
		// clock-like ticking accelerating into each reveal
		for (let k = 0; k < 10; k++) tick(T('dilation', h - 22) + (22 / FPS) * (1 - Math.pow(1 - k / 10, 2)), 0.08);
	}
	// years flying past
	for (let k = 0; k < 47; k++) blip(T('dilation', 308 + (k / 47) * 22), 1500 + k * 30, 0.025, rand() * 1.6 - 0.8);
	for (let k = 0; k < 60; k++) blip(T('dilation', 428 + (k / 60) * 22), 1800 + k * 35, 0.025, rand() * 1.6 - 0.8);
}

// ---------------------------------------------------------------- gpu
{
	// glitch stutter on "这还只是 CPU"
	for (let k = 0; k < 6; k++) noise(T('gpu', 8 + k * 3), 0.05, (lt) => 0.12 * Math.exp(-lt * 60), () => 2500 + k * 800, 'bp', 0.2);
	// core grid shimmer
	for (let k = 0; k < 160; k++) blip(T('gpu', 50 + rand() * 150), 2000 + rand() * 3000, 0.012, rand() * 1.8 - 0.9);
	// mandelbrot render scan
	noise(T('gpu', 202), 1.2, (lt) => 0.06 * Math.sin(Math.PI * clamp01(lt / 1.2)), (lt) => 1000 + 4000 * lt, 'bp', 0.2);
	for (let k = 0; k < 200; k++) blip(T('gpu', 404 + (k / 200) * 26), 800 + (k / 200) * 3200, 0.022, rand() * 1.6 - 0.8);
}

// ---------------------------------------------------------------- super
{
	const steps = [196, 212, 228, 244, 260];
	steps.forEach((s, k) => {
		boom(T('super', s), 0.32 + k * 0.05);
		tone(T('super', s), 0.5, () => 220 * Math.pow(2, k / 4), (lt) => 0.08 * Math.exp(-lt * 6));
	});
	// riser into 10^18
	const r0 = T('super', 262);
	const r1 = T('super', 300);
	const d = r1 - r0;
	noise(r0, d, (lt) => 0.3 * Math.pow(lt / d, 2.5), (lt) => 300 + 9000 * Math.pow(lt / d, 2), 'bp', 0.35);
	tone(r0, d, (lt) => 110 * Math.pow(2, 3 * (lt / d)), (lt) => 0.1 * Math.pow(lt / d, 2));
	tone(r0, d, (lt) => 165 * Math.pow(2, 3 * (lt / d)), (lt) => 0.06 * Math.pow(lt / d, 2), 0.4);
}

// ---------------------------------------------------------------- finale
{
	// humanity counter
	for (let k = 0; k < 80; k++) blip(T('finale', 172 + (k / 80) * 78), 900 + rand() * 600, 0.02, rand() * 1.6 - 0.8);
	// cosmic counter: accelerating ticks + Shepard-like ascent
	for (let k = 0; k < 160; k++) {
		const x = k / 160;
		blip(T('finale', 400 + 160 * x), 600 + x * 3000, 0.02 + x * 0.02, rand() * 1.6 - 0.8);
	}
	const c0 = T('finale', 400);
	const cd = (560 - 400) / FPS;
	for (let v = 0; v < 3; v++) {
		tone(c0, cd, (lt) => 110 * Math.pow(2, v + 2 * (lt / cd)), (lt) => 0.05 * Math.sin(Math.PI * clamp01(lt / cd)) * (v === 1 ? 1 : 0.6), v - 1);
	}
	noise(c0, cd, (lt) => 0.18 * Math.pow(lt / cd, 3), (lt) => 300 + 8000 * Math.pow(lt / cd, 2), 'bp', 0.4);
	// milestone pings (frames match YEAR_KEYS in src/scenes/Finale.tsx)
	[430, 444, 462, 482, 502].forEach((fr, k) => tone(T('finale', fr), 1.0, () => 1046.5 * Math.pow(2, k / 6), (lt) => 0.06 * Math.exp(-lt * 5)));
	boom(T('finale', 522), 0.4);
	tone(T('finale', 522), 1.6, () => 2093, (lt) => 0.07 * Math.exp(-lt * 3));

	// silence ... then the one second
	tick(T('finale', 640), 0.5);
	tick(T('finale', 670), 0.55);
	// reverse swell into the final slam
	noise(T('finale', 680), 22 / FPS, (lt) => 0.35 * Math.pow(lt / (22 / FPS), 3), (lt) => 500 + 9000 * (lt / (22 / FPS)), 'bp', 0.4);

	// the final chord (A major, bright) blooming from the slam
	const t = T('finale', 702);
	const chord = [110, 164.81, 220, 277.18, 329.63, 440, 554.37, 659.25];
	chord.forEach((f0, k) => {
		for (let h = 1; h <= 6; h++) {
			tone(
				t,
				7.2,
				(lt) => f0 * h * (1 + 0.002 * Math.sin(lt * 3 + k)),
				(lt) => ((0.1 / h) * Math.exp(-lt * 0.32) * clamp01(lt * 30) * (k < 2 ? 1.2 : 1)) / (1 + k * 0.08),
				(k % 3) - 1,
			);
		}
	});
	// shimmer
	for (let k = 0; k < 90; k++) blip(t + rand() * 4.5, 2000 + rand() * 4000, 0.02 * (1 - k / 90), rand() * 1.8 - 0.9);
}

// ---------------------------------------------------------------- master
// gentle stereo "room": short cross-feed delays
{
	const d1 = Math.floor(0.023 * SR);
	const d2 = Math.floor(0.037 * SR);
	for (let i = N - 1; i >= d2; i--) {
		L[i] += 0.18 * R[i - d1] + 0.1 * L[i - d2];
		R[i] += 0.18 * L[i - d1] + 0.1 * R[i - d2];
	}
}
let peak = 0;
for (let i = 0; i < N; i++) {
	L[i] = Math.tanh(L[i] * 1.2);
	R[i] = Math.tanh(R[i] * 1.2);
	peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;
const fadeOut = Math.floor(0.4 * SR);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
	const g = i > N - fadeOut ? (N - i) / fadeOut : 1;
	buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm * g)) * 32767), 44 + i * 4);
	buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm * g)) * 32767), 46 + i * 4);
}
fs.mkdirSync('public', {recursive: true});
fs.writeFileSync('public/soundtrack.wav', buf);
console.log(`wrote public/soundtrack.wav (${DUR.toFixed(1)}s, peak ${peak.toFixed(2)} → normalised)`);
