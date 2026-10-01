// Finale world: the 80-year exponential laid out in 3D, and the camera that flies it.
// Pure math only (no DOM) so it can be checked from Node. World: Y points down, ground is y = 0.
import { clamp, ease, lerp, noise1, prog } from "../../lib/math";
import { camera, type Cam } from "../../lib/three";
import { cue, sceneDuration, ticks } from "../../timeline";

export const DUR = sceneDuration("finale");
export const IGNITE = cue("finale", "ignite");
export const CLIMB = cue("finale", "climb");
export const HERE = cue("finale", "here");
export const WAVE = cue("finale", "wave");
export const FLASH = cue("finale", "flash");
export const END = cue("finale", "end");

// ---------------------------------------------------------------------------------------------
// The curve. z = years since 1946 (ZS units per year); height grows as e^(t / TY).
export const U0 = 1946;
export const ZS = 2;
export const TY = 5;
export const H0 = 0.6;
export const U_HERE = 2024; // "you are here" (never labelled with a year)
export const H_HERE = 150;
const H_MAX = 560;
const AMP = (H_HERE - H0) / (Math.exp((U_HERE - U0) / TY) - 1);
export const hOf = (u: number) => (u <= U0 ? H0 : H0 + AMP * (Math.exp((u - U0) / TY) - 1));
const dhOf = (u: number) => (u <= U0 ? 0 : (AMP / TY) * Math.exp((u - U0) / TY));
export const zOf = (u: number) => (u - U0) * ZS;
/** Tube radius (world units): the ribbon swells as it climbs. */
export const ribR = (h: number) => 0.3 + 0.3 * clamp(h / H_HERE);

export type Smp = { u: number; z: number; h: number; s: number; tz: number; th: number };
export const SMP: Smp[] = (() => {
  const out: Smp[] = [];
  let u = U0;
  let s = 0;
  for (;;) {
    const d = dhOf(u);
    const len = Math.hypot(ZS, d);
    const h = hOf(u);
    out.push({ u, z: zOf(u), h, s, tz: ZS / len, th: d / len });
    if (h > H_MAX) break;
    const ds = h > 220 ? 1.6 : 0.5;
    const du = ds / len;
    s += Math.hypot(ZS * du, hOf(u + du) - h);
    u += du;
  }
  return out;
})();
export const S_END = SMP[SMP.length - 1].s;

const lerpSmp = (a: Smp, b: Smp, t: number): Smp => ({
  u: lerp(a.u, b.u, t),
  z: lerp(a.z, b.z, t),
  h: lerp(a.h, b.h, t),
  s: lerp(a.s, b.s, t),
  tz: lerp(a.tz, b.tz, t),
  th: lerp(a.th, b.th, t),
});

/** Curve point at arc length s (s = 0 at 1946; negative = the empty road before it). */
export const curveAt = (s: number): Smp => {
  if (s <= 0) return { u: U0 + s / ZS, z: s, h: H0, s, tz: 1, th: 0 };
  let lo = 0;
  let hi = SMP.length - 1;
  if (s >= SMP[hi].s) return SMP[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (SMP[m].s <= s) lo = m;
    else hi = m;
  }
  return lerpSmp(SMP[lo], SMP[hi], (s - SMP[lo].s) / (SMP[hi].s - SMP[lo].s));
};
export const sOfU = (u: number) => {
  if (u <= U0) return (u - U0) * ZS;
  let lo = 0;
  let hi = SMP.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (SMP[m].u <= u) lo = m;
    else hi = m;
  }
  return lerp(SMP[lo].s, SMP[hi].s, clamp((u - SMP[lo].u) / (SMP[hi].u - SMP[lo].u)));
};
export const S_HERE = sOfU(U_HERE);
export const Z_HERE = zOf(U_HERE);
export type V3 = [number, number, number];
export const MARK: V3 = [0, -H_HERE, Z_HERE];

// ---------------------------------------------------------------------------------------------
// Milestones (colours as in Title.tsx). Pylons line the flat road; gates ring the wall.
export const MILESTONES = [
  { year: 1946, label: "真空管", col: "#ffa63d" },
  { year: 1947, label: "晶体管", col: "#38d6ff" },
  { year: 1958, label: "集成电路", col: "#38d6ff" },
  { year: 1971, label: "微处理器", col: "#3dffa8" },
  { year: 2005, label: "多核", col: "#3a7bff" },
  { year: 2012, label: "深度学习", col: "#8a5cff" },
  { year: 2022, label: "大模型", col: "#ff3ec8" },
];

// The camera passes each milestone on these frames (timeline.json ticks, so the soundtrack hits them):
// pylon = 1946, 1947, 1958, 1971, 2005 · ring = 2012, 2022.
const PYLON_T = ticks("finale", "pylon");
const RING_T = ticks("finale", "ring");
export const PASS = { 1946: PYLON_T[0], 1958: PYLON_T[2], 1971: PYLON_T[3], 2005: PYLON_T[4], 2012: RING_T[0], 2022: RING_T[1] } as const;

// ---------------------------------------------------------------------------------------------
// Camera: anchor arc length through keyframes (monotone cubic => smooth speed), plus a rig.
const monotone = (xs: number[], ys: number[]) => {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
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
    const q = a * a + b * b;
    if (q > 9) {
      const t = 3 / Math.sqrt(q);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
};

export const S_STOP = S_HERE - 16;
export const STOP = HERE + 10;
const KEYS: [number, number][] = [
  [0, -50],
  [IGNITE, -34],
  [PASS[1946], 0],
  [PASS[1958], sOfU(1958)],
  [PASS[1971], sOfU(1971)],
  [PASS[2005], sOfU(2005)],
  [PASS[2012], sOfU(2012)],
  [PASS[2022], sOfU(2022)],
  [HERE - 14, S_STOP - 3],
  [STOP, S_STOP],
  [DUR, S_STOP],
];
export const camS = monotone(
  KEYS.map((k) => k[0]),
  KEYS.map((k) => k[1]),
);
/** Frame at which the camera anchor reaches arc length s. */
export const frameAtS = (s: number) => {
  let lo = 0;
  let hi = STOP;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (camS(m) < s) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
/** The camera draws level with the 1947 pylon (checked against ticks.pylon[1]). */
export const PASS_1947 = PYLON_T[1];
export const PASS_1947_CAM = frameAtS(sOfU(1947));
export const camSpeed = (f: number) => camS(f + 0.5) - camS(f - 0.5);
export const V_PEAK = (() => {
  let v = 0;
  for (let f = CLIMB; f < STOP; f++) v = Math.max(v, camSpeed(f));
  return v;
})();

export type Pose = { p: V3; t: V3; fl: number; cy: number; roll: number };
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 0..1: the flat flight blends into the climb rig. */
export const climbK = (f: number) => ease.inOutCubic(prog(f, CLIMB - 18, CLIMB + 46));
/** 0..1: the climb rig settles in front of the marker. */
export const settleK = (f: number) => ease.inOutCubic(prog(f, HERE - 46, STOP + 4));
/** 0..1: speed rush during the climb (drives lens, streaks, shake). */
export const rushAt = (f: number) => (f > CLIMB - 10 && f < STOP + 10 ? clamp((camSpeed(f) - 0.7) / (V_PEAK - 0.7)) : 0);

// Where the camera comes to rest: level with the marker, a little in front of the wall.
const SETTLE_P: V3 = [13, -H_HERE + 8, Z_HERE - 19];
const SETTLE_T: V3 = [0, -H_HERE + 8, Z_HERE + 1];

const chase = (f: number): Pose => {
  const s = camS(f);
  const c = curveAt(s);
  const kc = climbK(f);
  const ks = settleK(f);
  const rush = rushAt(f);
  const X = lerp(2.3, 3.0, kc);
  const nOff = lerp(0.85, 3.2, kc);
  const bob = (noise1(f * 0.04 + 7) - 0.5) * 0.14 * (1 - kc);
  const pc: V3 = [X + bob, -c.h - nOff * c.tz + bob * 0.5, c.z - nOff * c.th];
  const L = lerp(13, 26, kc);
  const c2 = curveAt(s + L);
  const lift = lerp(0.15, 1.4, kc);
  const tc: V3 = [lerp(0.9, 0.6, kc), -c2.h - lift * c2.tz, c2.z - lift * c2.th];
  return {
    p: lerp3(pc, SETTLE_P, ks),
    t: lerp3(tc, SETTLE_T, ks),
    fl: lerp(lerp(860, 860 - 260 * rush, kc), 900, ks),
    cy: lerp(lerp(455, 540, kc), 780, ks),
    roll: 0.1 * Math.sin(Math.PI * ease.inOutSine(prog(f, CLIMB - 20, STOP))) + 0.01 * Math.sin(f * 0.023) * (1 - kc),
  };
};

// Wide reveal: the whole 80-year curve, seen from the side (lens shifted so verticals stay vertical).
export const REV0 = STOP + 18;
export const REV1 = WAVE - 4;
export const REVEAL: Pose = { p: [60, -2, -20], t: [-24, -2, 120], fl: 690, cy: 742, roll: 0 };
export const revealK = (f: number) => ease.inOutCubic(prog(f, REV0, REV1));

export const poseAt = (f: number): Pose => {
  const ch = chase(Math.min(f, STOP + 30));
  if (f <= REV0) return ch;
  const k = revealK(f);
  // pull back and down on an arc, lens kept level so the marker stays in frame the whole way
  const p = lerp3(ch.p, REVEAL.p, k);
  p[1] -= Math.sin(Math.PI * k) * 30;
  const kk = ease.inOutQuad(k);
  const t: V3 = [lerp(ch.t[0], REVEAL.t[0], kk), p[1], lerp(ch.t[2], REVEAL.t[2], kk)];
  return { p, t, fl: lerp(ch.fl, REVEAL.fl, k), cy: lerp(ch.cy, REVEAL.cy, k), roll: lerp(ch.roll, 0, k) };
};

export const camOf = (pose: Pose): Cam => {
  const [px, py, pz] = pose.p;
  const dx = pose.t[0] - px;
  const dy = pose.t[1] - py;
  const dz = pose.t[2] - pz;
  return camera({ x: px, y: py, z: pz, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), f: pose.fl, cy: pose.cy });
};

/** Camera year (the HUD counter). */
export const yearAt = (f: number) => curveAt(camS(Math.min(f, STOP))).u;
