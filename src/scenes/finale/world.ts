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

/** Pylons beside the flat road (milestones 0-4): side offset x; gates ring the wall (milestones 5, 6). */
export const PYLON_X = [-4.4, 5.0, -4.4, 5.4, -4.6];
export const PYL_TOP = 2.9;
/** Gate radii: 2012 rings the bend (the camera flies through it), 2022 rings the wall (the camera rises through it). */
export const GATE_R = [6.2, 10];
/** Doubling hoops fire when the camera is this many units short of them. */
export const FIRE_AHEAD = 6;

/** Doublings of the drawn curve: one every TY·ln2 years (the height doubles from marker to marker). */
export const T_DOUBLE = TY * Math.LN2;
export const DOUBLINGS = (() => {
  const out: { u: number; s: number }[] = [];
  for (let u = U_HERE; u > U0 + 1; u -= T_DOUBLE) out.unshift({ u, s: sOfU(u) });
  return out;
})();

// Soundtrack hits (timeline.json ticks), each checked against the geometry below (see `passes()`):
// pylon = the frame each pylon (1946, 1947, 1958, 1971, 2005) whips out of frame,
// ring = the frame each gate (2012, 2022) fills the frame, double = each doubling hoop firing on the road.
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
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
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
/** Like `track`, but flat outside the keys. */
const hold = (keys: [number, number][]) => {
  const t = track(keys);
  return (x: number) => t(clamp(x, keys[0][0], keys[keys.length - 1][0]));
};

// ---------------------------------------------------------------------------------------------
// The camera anchor: arc length along the curve through keyframes. Glide in, cruise past the early
// pylons, surge towards the wall, then keep accelerating up it; the crest blends into the hero shot.
export const CREST = 436; // the chase hands over to the hero rig from here
const KEYS: [number, number][] = [
  [0, -46],
  [IGNITE, -30],
  [131, 0],
  [182, sOfU(1958)],
  [232, sOfU(1971)],
  [300, sOfU(2005)],
  [CLIMB, sOfU(2009.5)],
  [345, sOfU(2012)],
  [372, sOfU(2016)],
  [396, sOfU(2019.4)],
  [418, sOfU(2022)],
  [CREST, S_HERE - 16],
  [CREST + 30, S_HERE - 4],
];
export const camS = (() => {
  const t = track(KEYS);
  return (f: number) => t(Math.min(f, CREST + 30));
})();
export const camSpeed = (f: number) => camS(f + 0.5) - camS(f - 0.5);
/** Frame at which the camera anchor reaches arc length s. */
export const frameAtS = (s: number) => {
  let lo = 0;
  let hi = CREST + 30;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (camS(m) < s) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
export const V_PEAK = (() => {
  let v = 0;
  for (let f = CLIMB; f < CREST; f++) v = Math.max(v, camSpeed(f));
  return v;
})();

// ---------------------------------------------------------------------------------------------
// The chase rig: the camera sits `off` units along the curve's normal (above the road, then in front
// of the wall), `X` to the side, and looks at the curve `look` units ahead, `tl` along its normal.
const T_OFF = hold([
  [0, 1.15],
  [150, 1.0],
  [190, 2.1],
  [212, 4.2],
  [240, 2.0],
  [282, 0.85],
  [318, 1.0],
  [337, 1.5],
  [360, 5],
  [385, 8],
  [440, 8.5],
]);
const T_X = hold([
  [0, 2.2],
  [150, 2.4],
  [196, 2.2],
  [236, -2.6],
  [292, -1.4],
  [322, 0.4],
  [350, 2.4],
  [400, 3.0],
  [440, 3.2],
]);
const T_LOOK = hold([
  [0, 13],
  [190, 12],
  [214, 9],
  [246, 12],
  [300, 15],
  [330, 17],
  [350, 16],
  [440, 16],
]);
const T_TL = hold([
  [0, 0.15],
  [190, 0.15],
  [214, -0.6],
  [246, 0.15],
  [318, 0.3],
  [337, 0.3],
  [360, -8],
  [386, -19],
  [440, -20],
]);
const T_FL = hold([
  [0, 860],
  [200, 860],
  [262, 980],
  [300, 820],
  [330, 760],
  [380, 700],
  [440, 640],
]);
const T_CY = hold([
  [0, 440],
  [330, 440],
  [358, 420],
  [392, 300],
  [440, 300],
]);
const T_ROLL = hold([
  [0, 0],
  [186, 0],
  [214, 0.12],
  [250, -0.05],
  [290, 0],
  [345, 0],
  [385, -0.08],
  [440, -0.14],
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
/** 0..1: speed rush during the climb (drives lens, streaks, shake). */
export const rushAt = (f: number) => (f > CLIMB - 10 && f < CREST + 30 ? clamp((camSpeed(f) - 0.9) / (V_PEAK - 0.9)) * (1 - heroK(f)) : 0);

const nrm = (c: Smp): V3 => [0, -c.tz, -c.th];
const chase = (f: number): Pose => {
  const s = camS(f);
  const c = curveAt(s);
  const n = nrm(c);
  const off = T_OFF(f);
  const X = T_X(f) + (noise1(f * 0.035 + 7) - 0.5) * 0.18;
  const p: V3 = [X, -c.h + n[1] * off + (noise1(f * 0.04 + 3) - 0.5) * 0.1, c.z + n[2] * off];
  const c2 = curveAt(s + T_LOOK(f));
  const n2 = nrm(c2);
  const tl = T_TL(f);
  const kc = climbK(f);
  const t: V3 = [0.38 * X * (1 - kc) + 0.3 * X * kc, -c2.h + n2[1] * tl, c2.z + n2[2] * tl];
  return lookPose(p, t, T_FL(f), T_CY(f), T_ROLL(f) + 0.012 * Math.sin(f * 0.023) * (1 - kc));
};

// The hero shot: high above and beside the marker, looking down the wall to the flat past far below.
export const HERO_P: V3 = [47.3, -221.2, 147];
export const HERO_T: V3 = [-44.7, -79, 128.2];
export const HERO: Pose = lookPose(HERO_P, HERO_T, 1100, 301);
/** 0..1: the chase swings over the crest into the hero shot. */
export const heroK = (f: number) => ease.inOutSine(prog(f, CREST, HERE - 5));
// Wide reveal: the whole 80-year curve, filling the frame. The pull-back also squashes the world's
// heights (YSQ) so the 80 flat years can span the frame while the marker stays in it.
export const YSQ = 0.45;
const REV_P: V3 = [84.4, -3.2, 53.1];
const REV_T: V3 = [-79.3, -39.4, 81.0];
export const REVEAL: Pose = lookPose(REV_P, REV_T, 787, 475);
export const REV0 = 499;
export const REV1 = 566;
export const revealK = (f: number) => ease.inOutCubic(prog(f, REV0, REV1));
/** Vertical scale applied to every world point (1 until the pull-back). */
export const ysqAt = (f: number) => lerp(1, YSQ, ease.inOutQuad(prog(f, REV0, REV1)));

const blend = (a: Pose, b: Pose, k: number): Pose => ({
  p: lerp3(a.p, b.p, k),
  yaw: lerp(a.yaw, b.yaw, k),
  pitch: lerp(a.pitch, b.pitch, k),
  fl: lerp(a.fl, b.fl, k),
  cy: lerp(a.cy, b.cy, k),
  roll: lerp(a.roll, b.roll, k),
});
const wrapYaw = (a: Pose, b: Pose): Pose => {
  let y = b.yaw;
  while (y - a.yaw > Math.PI) y -= 2 * Math.PI;
  while (y - a.yaw < -Math.PI) y += 2 * Math.PI;
  return { ...b, yaw: y };
};

/** Where the marker sits on screen when the crest begins. */
let mcCache: [number, number] | null = null;
const crestMark = () => (mcCache ??= scrOf(chase(CREST), MARK));

export const poseAt = (f: number): Pose => {
  const ch = chase(Math.min(f, CREST + 30));
  const kh = heroK(f);
  if (kh <= 0) return ch;
  // hero hold: a slow drift so the frame never freezes
  const dt = f - HERE;
  const hp: V3 = [HERO_P[0] - dt * 0.05, HERO_P[1] - dt * 0.03, HERO_P[2] + dt * 0.05];
  const hero = lookPose(hp, HERO_T, HERO.fl, HERO.cy);
  // crest: orbit up and out over the top, aimed at the marker the whole way
  const b0 = blend(ch, wrapYaw(ch, hero), kh);
  b0.p[1] -= Math.sin(Math.PI * kh) * 10;
  b0.p[0] += Math.sin(Math.PI * ease.outQuad(kh)) * 16;
  const mc = crestMark();
  const mh = scrOf(hero, MARK);
  const ka = ease.inOutQuad(kh);
  // the aim takes over gradually, so the hand-off from the chase is seamless
  const am = aim(b0, MARK, lerp(mc[0], mh[0], ka), lerp(mc[1], mh[1], ka));
  const wa = ease.inOutSine(clamp(kh / 0.35));
  const a = kh >= 1 ? hero : { ...b0, yaw: lerp(b0.yaw, am.yaw, wa), pitch: lerp(b0.pitch, am.pitch, wa) };
  const k = revealK(f);
  if (k <= 0) return a;
  // pull back on an arc; the aim is solved so the marker glides smoothly from its hero spot to its reveal spot
  const rd = f - REV1;
  const rp: V3 = [REV_P[0] - rd * 0.05, REV_P[1], REV_P[2] + rd * 0.035];
  const ysq = ysqAt(f);
  const p = lerp3(hp, rp, k);
  p[1] -= Math.sin(Math.PI * k) * 20;
  const tH: V3 = [HERO_T[0], HERO_T[1] * ysq, HERO_T[2]];
  const tR: V3 = [REV_T[0], REV_T[1] * (ysq / YSQ), REV_T[2]];
  const b = lookPose(p, lerp3(tH, tR, ease.inOutQuad(k)), lerp(HERO.fl, REVEAL.fl, k), lerp(HERO.cy, REVEAL.cy, k));
  const M: V3 = [MARK[0], MARK[1] * ysq, MARK[2]];
  const m0 = scrOf(lookPose(hp, tH, HERO.fl, HERO.cy), M);
  const m1 = scrOf(lookPose(rp, tR, REVEAL.fl, REVEAL.cy), M);
  return aim(b, M, lerp(m0[0], m1[0], k), lerp(m0[1], m1[1], k));
};

/** Screen position of world point M (already squashed) under a pose. */
const scrOf = (ps: Pose, M: V3): [number, number] => {
  const dx = M[0] - ps.p[0];
  const dy = M[1] - ps.p[1];
  const dz = M[2] - ps.p[2];
  const cyw = Math.cos(ps.yaw);
  const syw = Math.sin(ps.yaw);
  const x1 = dx * cyw - dz * syw;
  const z1 = dx * syw + dz * cyw;
  const cp = Math.cos(ps.pitch);
  const sp = Math.sin(ps.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = Math.max(1e-3, dy * sp + z1 * cp);
  return [960 + (ps.fl * x1) / z2, ps.cy + (ps.fl * y2) / z2];
};
/** Re-aim a pose (yaw/pitch, Newton steps) so that M lands on screen at (sx, sy). */
const aim = (ps: Pose, M: V3, sx: number, sy: number): Pose => {
  let q = ps;
  for (let it = 0; it < 6; it++) {
    const [x0, y0] = scrOf(q, M);
    const ex = x0 - sx;
    const ey = y0 - sy;
    if (Math.abs(ex) + Math.abs(ey) < 0.2) break;
    const e = 1e-4;
    const [x1, y1] = scrOf({ ...q, yaw: q.yaw + e }, M);
    const [x2, y2] = scrOf({ ...q, pitch: q.pitch + e }, M);
    const a = (x1 - x0) / e;
    const c = (y1 - y0) / e;
    const b = (x2 - x0) / e;
    const d = (y2 - y0) / e;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-6) break;
    const dy = clamp((d * ex - b * ey) / det, -0.25, 0.25);
    const dp = clamp((-c * ex + a * ey) / det, -0.25, 0.25);
    if (!Number.isFinite(dy) || !Number.isFinite(dp)) break;
    q = { ...q, yaw: q.yaw - dy, pitch: clamp(q.pitch - dp, -1.5, 1.5) };
  }
  return q;
};

export const camOf = (pose: Pose): Cam =>
  camera({ x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: pose.pitch, f: pose.fl, cy: pose.cy });

/** Camera year (the HUD counter). */
export const yearAt = (f: number) => curveAt(camS(Math.min(f, CREST))).u;
