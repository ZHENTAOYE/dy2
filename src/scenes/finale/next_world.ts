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

// Soundtrack hits (timeline.json ticks): pylon = the frame each pylon erupts out of the ground (1946, 1947,
// 1958, 1971, 2005), ring = the frame each gate flares (2012, 2022), double = each doubling marker firing.
export const PYLON_T = ticks("finale", "pylon");
export const RING_T = ticks("finale", "ring");
export const DOUBLE_T = ticks("finale", "double");

// ---------------------------------------------------------------------------------------------
// Smooth, overshoot-free interpolation through keyframes (monotone cubic Hermite).
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
    if (x <= xs[0]) return ys[0];
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
const track = (keys: [number, number][]) =>
  monotone(
    keys.map((k) => k[0]),
    keys.map((k) => k[1]),
  );

// ---------------------------------------------------------------------------------------------
// Camera speed (arc-length units per frame), integrated into the anchor position camS(f).
// Flat road: a glide, a cruise past the early pylons, a surge towards the wall. Climb: it keeps
// accelerating (in step with the curve) until BRAKE, then stops hard just below the marker.
export const BRAKE = 440;
export const STOP = 472;
const V0 = 0.86;
const vFlat = track([
  [0, 0.16],
  [IGNITE, 0.3],
  [125, 0.58],
  [150, 0.55],
  [238, 0.55],
  [292, 0.92],
  [CLIMB, V0],
]);
const vAt = (f: number, vp: number) =>
  f < CLIMB ? vFlat(f) : f < BRAKE ? V0 + (vp - V0) * ease.inQuad((f - CLIMB) / (BRAKE - CLIMB)) : f < STOP ? vp * Math.pow(1 - (f - BRAKE) / (STOP - BRAKE), 2) : 0;
const S0 = -50;
const DT = 0.25;
const integrate = (vp: number) => {
  const out = new Float64Array(Math.ceil(DUR / DT) + 2);
  let s = S0;
  out[0] = s;
  for (let i = 1; i < out.length; i++) {
    const f = (i - 0.5) * DT;
    s += vAt(f, vp) * DT;
    out[i] = s;
  }
  return out;
};
export const S_STOP = S_HERE - 12;
/** Peak climb speed, solved so that the camera comes to rest exactly at S_STOP. */
export const V_PEAK = (() => {
  const a = integrate(0);
  const b = integrate(1);
  const i = Math.round(STOP / DT);
  return (S_STOP - a[i]) / (b[i] - a[i]);
})();
const S_TAB = integrate(V_PEAK);
export const camS = (f: number) => {
  const x = clamp(f, 0, DUR) / DT;
  const i = Math.min(S_TAB.length - 2, Math.floor(x));
  return lerp(S_TAB[i], S_TAB[i + 1], x - i);
};
export const camSpeed = (f: number) => camS(f + 0.5) - camS(f - 0.5);
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

// ---------------------------------------------------------------------------------------------
// Doublings: a marker every two years. On the road they are arches over the ribbon, on the wall rungs
// across the sheet. Each fires when the camera reaches it (FIRE_AHEAD units before it draws level).
export const FIRE_AHEAD = 3.2;
export const DOUBLES = Array.from({ length: 39 }, (_, k) => {
  const u = 1948 + 2 * k;
  const s = sOfU(u);
  return { k, u, s, c: curveAt(s), wall: u > 2004, ideal: frameAtS(s - (u > 2004 ? 9 : FIRE_AHEAD)) };
});
/** The frame doubling k fires (the timeline tick when there is one, so the soundtrack stays in sync). */
export const fireAt = (k: number) => (k < DOUBLE_T.length ? DOUBLE_T[k] : DOUBLES[k].ideal);

// ---------------------------------------------------------------------------------------------
// The camera rig: one set of keyframed tracks for the whole ride. The camera sits `off` units along the
// curve's normal (above the road, then in front of the wall), `X` units to the side, and looks at the
// curve `look` units ahead, `tl` units along the normal and `tx` units to the side.
const T_OFF = track([
  [0, 1.1],
  [140, 1.0],
  [186, 2.3],
  [214, 5.6],
  [246, 2.2],
  [288, 0.8],
  [318, 0.9],
  [342, 2.6],
  [372, 5.2],
  [430, 4.2],
  [STOP, 4.6],
]);
const T_X = track([
  [0, 2.0],
  [150, 2.3],
  [190, 2.4],
  [240, -2.7],
  [300, -1.8],
  [340, -1.4],
  [400, -1.9],
  [STOP, -2.4],
]);
const T_LOOK = track([
  [0, 13],
  [186, 12],
  [214, 8.5],
  [246, 12],
  [300, 15],
  [330, 18],
  [372, 24],
  [STOP, 26],
]);
const T_TL = track([
  [0, 0.15],
  [186, 0.15],
  [214, -0.4],
  [246, 0.15],
  [318, 0.3],
  [345, -6],
  [372, -26],
  [430, -30],
  [STOP, -32],
]);
const T_FL = track([
  [0, 860],
  [200, 860],
  [262, 1060],
  [300, 800],
  [330, 760],
  [372, 720],
  [436, 600],
  [STOP, 680],
]);
const T_CY = track([
  [0, 455],
  [318, 455],
  [360, 540],
]);
const T_ROLL = track([
  [0, 0],
  [186, 0],
  [216, 0.14],
  [250, 0],
  [345, 0],
  [380, -0.12],
  [436, -0.28],
  [STOP, -0.14],
  [500, 0],
]);

export type Pose = { p: V3; yaw: number; pitch: number; fl: number; cy: number; roll: number };
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const look = (p: V3, t: V3) => {
  const dx = t[0] - p[0];
  const dy = t[1] - p[1];
  const dz = t[2] - p[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};
/** Camera pose looking from p at t. */
export const lookPose = (p: V3, t: V3, fl: number, cy: number, roll = 0): Pose => ({ p, ...look(p, t), fl, cy, roll });

/** 0..1: the road rig bends into the climb. */
export const climbK = (f: number) => ease.inOutCubic(prog(f, CLIMB - 14, CLIMB + 40));
/** 0..1: the camera brakes and swings out into the hero shot of the marker. */
export const settleK = (f: number) => ease.inOutCubic(prog(f, BRAKE - 2, HERE + 6));
/** 0..1: speed rush during the climb (drives lens, streaks, shake). */
export const rushAt = (f: number) => (f > CLIMB - 10 && f < STOP + 10 ? clamp((camSpeed(f) - 0.75) / (V_PEAK - 0.75)) : 0);

const nrm = (c: Smp): V3 => [0, -c.tz, -c.th];
const ride = (f: number): Pose => {
  const s = camS(f);
  const c = curveAt(s);
  const n = nrm(c);
  const off = T_OFF(f);
  const X = T_X(f) + (noise1(f * 0.035 + 7) - 0.5) * 0.18;
  const p: V3 = [X, -c.h + n[1] * off + (noise1(f * 0.04 + 3) - 0.5) * 0.1, c.z + n[2] * off];
  const c2 = curveAt(s + T_LOOK(f));
  const n2 = nrm(c2);
  const tl = T_TL(f);
  const t: V3 = [0.38 * X * (1 - climbK(f)) + 0.2 * X * climbK(f), -c2.h + n2[1] * tl, c2.z + n2[2] * tl];
  return lookPose(p, t, T_FL(f), T_CY(f), T_ROLL(f) + 0.012 * Math.sin(f * 0.023));
};

// The hero shot: a 3/4 low angle on the marker, the wall plunging away below, the dashes rising above.
export const HERO: Pose = lookPose([30, -H_HERE + 24, Z_HERE - 42], [0, -H_HERE - 14, Z_HERE + 2], 980, 540);
// Wide reveal: the whole 80-year curve from the side, the knee right of centre, the marker high.
export const REVEAL: Pose = lookPose([150, -40, -60], [-6, -60, 100], 1000, 540);
export const REV0 = HERE + 10;
export const REV1 = 572;
export const revealK = (f: number) => ease.inOutCubic(prog(f, REV0, REV1));

const blend = (a: Pose, b: Pose, k: number): Pose => ({
  p: lerp3(a.p, b.p, k),
  yaw: lerp(a.yaw, b.yaw, k),
  pitch: lerp(a.pitch, b.pitch, k),
  fl: lerp(a.fl, b.fl, k),
  cy: lerp(a.cy, b.cy, k),
  roll: lerp(a.roll, b.roll, k),
});

export const poseAt = (f: number): Pose => {
  const r = ride(Math.min(f, STOP));
  const ks = settleK(f);
  if (ks <= 0) return r;
  // hero hold: a slow orbit so the frame never freezes
  const drift = (f - HERE) * 0.0016;
  const hero: Pose = { ...HERO, yaw: HERO.yaw + drift, p: [HERO.p[0] - (f - HERE) * 0.04, HERO.p[1], HERO.p[2] + (f - HERE) * 0.03] };
  const a = blend(r, hero, ks);
  const k = revealK(f);
  if (k <= 0) return a;
  // pull back on an arc so the marker stays in frame the whole way
  const b = blend(a, REVEAL, k);
  b.p[1] -= Math.sin(Math.PI * k) * 26;
  return b;
};

export const camOf = (pose: Pose): Cam =>
  camera({ x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: pose.pitch, f: pose.fl, cy: pose.cy });

/** Camera year (the HUD counter). */
export const yearAt = (f: number) => curveAt(camS(Math.min(f, STOP))).u;
