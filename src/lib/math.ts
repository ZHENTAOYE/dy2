export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t: number) => Math.pow(clamp(t), 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * clamp(t) - 10));

/** Window: rises over [a, a+fi], holds, falls over [b-fo, b]. */
export const windowed = (x: number, a: number, b: number, fi: number, fo: number) =>
  Math.min(invLerp(a, a + fi, x), 1 - invLerp(b - fo, b, x));

/** Deterministic PRNG (mulberry32). */
export const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const gauss = (r: () => number) => {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Hash of an integer to [0,1). */
export const hash1 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);

/** Smooth 1D value noise. */
export const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
};

/** Fold a coordinate into [0, L] as a bouncing ball would (triangle wave). */
export const bounce = (x: number, L: number) => {
  const m = ((x % (2 * L)) + 2 * L) % (2 * L);
  return m > L ? 2 * L - m : m;
};

/** Blackbody-ish color for a normalized temperature 0 (deep red) .. 1 (blue-white). */
export const tempColor = (t: number): [number, number, number] => {
  const stops: [number, [number, number, number]][] = [
    [0.0, [0.55, 0.06, 0.02]],
    [0.2, [1.0, 0.28, 0.06]],
    [0.4, [1.0, 0.62, 0.25]],
    [0.6, [1.0, 0.9, 0.72]],
    [0.8, [0.85, 0.92, 1.0]],
    [1.0, [0.6, 0.75, 1.0]],
  ];
  const x = clamp(t);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (x - a) / (b - a);
      return [lerp(ca[0], cb[0], k), lerp(ca[1], cb[1], k), lerp(ca[2], cb[2], k)];
    }
  }
  return stops[stops.length - 1][1];
};
