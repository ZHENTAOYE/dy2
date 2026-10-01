export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ramp = (x: number, a: number, b: number) => clamp((x - a) / (b - a));
export const smooth = (a: number, b: number, x: number) => {
  const t = ramp(x, a, b);
  return t * t * (3 - 2 * t);
};
export const smoother = (a: number, b: number, x: number) => {
  const t = ramp(x, a, b);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t: number) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * clamp(t) - 10));
export const easeOutBack = (t: number, s = 1.7) => {
  const x = clamp(t) - 1;
  return x * x * ((s + 1) * x + s) + 1;
};

// Envelope: 0 before `a`, rises over `fadeIn`, holds, falls over `fadeOut` ending at `b`.
export const win = (x: number, a: number, b: number, fadeIn = 0.4, fadeOut = 0.4) =>
  smooth(a, a + fadeIn, x) * (1 - smooth(b - fadeOut, b, x));

// Exponentially decaying impulse after time `a`.
export const decay = (x: number, a: number, k = 4) => (x < a ? 0 : Math.exp(-(x - a) * k));

export const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const rgba = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

// Monotone cubic (Fritsch–Carlson) interpolation through keyframes [x, y].
export const monotone = (pts: [number, number][]) => {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
};

// Unicode superscript digits for canvas text (e.g. 10 + sup(26) → 10²⁶).
export const sup = (n: number | string) =>
  String(n).replace(/[0-9-]/g, (c) => (c === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]));
