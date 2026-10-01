// Small, dependency-free helpers for deterministic, frame-driven animation.

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
/** 0..1 progress of `frame` between `start` and `end` (clamped). */
export const prog = (frame: number, start: number, end: number) => invLerp(start, end, frame);
export const mapRange = (v: number, a: number, b: number, c: number, d: number) =>
  lerp(c, d, invLerp(a, b, v));

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/** Fade in over [a, a+fin] and out over [b-fout, b]. */
export const fadeInOut = (frame: number, a: number, b: number, fin = 12, fout = 12) =>
  Math.min(prog(frame, a, a + fin), 1 - prog(frame, b - fout, b));

/** Deterministic PRNG (mulberry32). */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stateless hash -> [0,1). */
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
export const hash2 = (x: number, y: number) => hash(x * 157.31 + y * 913.17);

/** Smooth 1D value noise in [0,1). */
export const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u);
};

/** Camera shake offset that decays after `start`. */
export const shake = (frame: number, start: number, intensity: number, duration = 20) => {
  const t = frame - start;
  if (t < 0 || t > duration) return { x: 0, y: 0, r: 0 };
  const k = intensity * Math.pow(1 - t / duration, 2);
  return {
    x: (noise1(t * 0.9 + 3.1) - 0.5) * 2 * k,
    y: (noise1(t * 0.9 + 17.7) - 0.5) * 2 * k,
    r: (noise1(t * 0.7 + 41.3) - 0.5) * 0.02 * k,
  };
};

export const sumShake = (...s: { x: number; y: number; r: number }[]) =>
  s.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, r: a.r + b.r }), { x: 0, y: 0, r: 0 });

/** Format with thousands separators. */
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Chinese large-number formatting (万 / 亿 / 万亿 / 亿亿). */
export const fmtCN = (n: number) => {
  if (n >= 1e16) return `${(n / 1e16).toFixed(n >= 1e17 ? 0 : 1)}亿亿`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(n >= 1e13 ? 0 : 1)}万亿`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`;
  return fmt(n);
};

export const TAU = Math.PI * 2;
