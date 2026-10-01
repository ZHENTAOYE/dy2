import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, TAU } from "../lib/math";
import { camera, type Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("finale");
const CLIMB = cue("finale", "climb");
const HERE = cue("finale", "here");
const FLASH = cue("finale", "flash");
const END = cue("finale", "end");

const IGNITE = cue("finale", "ignite"); // the ribbon lights up from 1946 onward as the chapter card clears
const STOP = HERE + 6; // the camera comes to rest beside the marker
const REVEAL0 = HERE + 16; // ...then pulls back to show the whole 80-year curve
const WAVE0 = cue("finale", "wave"); // the final doubling wave races along the whole curve
// The camera passes each pylon / ring on these frames (the soundtrack puts a hit on each one).
const PYLON_T = ticks("finale", "pylon");
const RING_T = ticks("finale", "ring");

// ---------------------------------------------------------------------------------------------
// The curve: a glowing exponential laid out in 3D. z = years since 1946, height grows as e^(t/5).
// World: Y points down, the ground is y = 0, so height h sits at y = -h.
const U0 = 1946;
const U_HERE = 2024; // "you are here" (never labelled with a year)
const TY = 5;
const H0 = 0.5;
const H_HERE = 100;
const H_MAX = 420;
const AMP = (H_HERE - H0) / (Math.exp((U_HERE - U0) / TY) - 1);
const hOf = (u: number) => (u <= U0 ? H0 : H0 + AMP * (Math.exp((u - U0) / TY) - 1));
const dhOf = (u: number) => (u <= U0 ? 0 : (AMP / TY) * Math.exp((u - U0) / TY));
/** Ribbon width (world x): widens into a wall as the curve climbs. */
const bandW = (h: number) => 1.4 + 1.2 * clamp(h / H_HERE);

type Smp = { u: number; z: number; h: number; s: number; tz: number; th: number };
const SMP: Smp[] = (() => {
  const out: Smp[] = [];
  let u = 1925;
  let s = u - U0;
  for (;;) {
    const d = dhOf(u);
    const len = Math.hypot(1, d);
    const h = hOf(u);
    out.push({ u, z: u - U0, h, s, tz: 1 / len, th: d / len });
    if (h > H_MAX) break;
    const ds = h > 160 ? 1.5 : 0.35;
    const du = ds / len;
    s += du * Math.hypot(1, dhOf(u + du / 2));
    u += du;
  }
  return out;
})();
const I_START = SMP.findIndex((p) => p.u >= U0);

const lerpSmp = (a: Smp, b: Smp, t: number): Smp => ({
  u: lerp(a.u, b.u, t),
  z: lerp(a.z, b.z, t),
  h: lerp(a.h, b.h, t),
  s: lerp(a.s, b.s, t),
  tz: lerp(a.tz, b.tz, t),
  th: lerp(a.th, b.th, t),
});

/** Curve point at arc length s (s = 0 at 1946; negative = before, flat). */
const curveAt = (s: number): Smp => {
  if (s <= SMP[0].s) return SMP[0];
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
const sOfU = (u: number) => {
  let lo = 0;
  let hi = SMP.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (SMP[m].u <= u) lo = m;
    else hi = m;
  }
  return lerp(SMP[lo].s, SMP[hi].s, clamp((u - SMP[lo].u) / (SMP[hi].u - SMP[lo].u)));
};
const S_HERE = sOfU(U_HERE);

// Colour along the curve: dim amber past -> cyan -> magenta -> white-hot present.
const colAt = (u: number) =>
  u < 1997
    ? C.amber
    : u < 2005
      ? mix(C.amber, C.cyan, (u - 1997) / 8)
      : u < 2010
        ? C.cyan
        : u < 2017
          ? mix(C.cyan, C.magenta, (u - 2010) / 7)
          : mix(C.magenta, "#ffffff", clamp((u - 2017) / 7) * 0.85);
const PAL_U0 = 1990;
const PAL_U1 = 2025;
const PAL = Array.from({ length: 48 }, (_, i) => colAt(lerp(PAL_U0, PAL_U1, i / 47)));
const palAt = (u: number) => PAL[Math.round(clamp((u - PAL_U0) / (PAL_U1 - PAL_U0)) * 47)];
/** Brightness along the curve: the flat past is dim. */
const intAt = (u: number) => lerp(0.45, 1, ease.inOutQuad(clamp((u - 1988) / 24)));
/** Sky grade by altitude: warm dusk -> deep blue -> violet -> magenta. */
const SKY: [number, string][] = [
  [0, "#2a1606"],
  [0.04, "#0a1c3c"],
  [0.22, "#08294f"],
  [0.5, "#2a1050"],
  [1, "#561248"],
];
const skyTint = (g: number) => {
  for (let i = 1; i < SKY.length; i++) if (g <= SKY[i][0]) return mix(SKY[i - 1][1], SKY[i][1], (g - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]));
  return SKY[SKY.length - 1][1];
};

// ---------------------------------------------------------------------------------------------
// Camera: a chase rig that rides the curve (anchor = arc length), speed integrated from a profile.
const VA = 0.12; // a gentle push while the chapter card plays
const V1 = 0.5; // speed at the start of the climb (units / frame)
const F_PEAK = HERE - 32;
const S_FLIGHT_END = sOfU(2005) + 3; // camera passes the 2005 pylon right as the climb starts
const L_END = 9; // look-ahead when settled: the camera looks straight at the marker
const S_TOP = S_HERE - L_END;

const speedAt = (f: number, v2: number) => {
  if (f < 85) return VA;
  if (f < CLIMB) return VA + (V1 - VA) * Math.pow((f - 85) / (CLIMB - 85), 0.9);
  if (f < F_PEAK) return V1 * Math.pow(v2 / V1, (f - CLIMB) / (F_PEAK - CLIMB));
  if (f < STOP) return v2 * 0.5 * (1 + Math.cos((Math.PI * (f - F_PEAK)) / (STOP - F_PEAK)));
  return 0;
};
const integrate = (v2: number, f0: number, f1: number) => {
  let acc = 0;
  for (let f = f0; f < f1; f += 0.25) acc += speedAt(f + 0.125, v2) * 0.25;
  return acc;
};
const V2 = (() => {
  const need = S_TOP - S_FLIGHT_END;
  let lo = V1;
  let hi = 6;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (integrate(m, CLIMB, STOP) < need) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
})();
const ANCHOR = (() => {
  const s0 = S_FLIGHT_END - integrate(V2, 0, CLIMB);
  const out: number[] = [];
  let s = s0;
  for (let f = 0; f <= DUR + 2; f++) {
    out.push(s);
    s += integrate(V2, f, f + 1);
  }
  return out;
})();
const anchorAt = (f: number) => {
  const i = clamp(Math.floor(f), 0, ANCHOR.length - 2);
  return lerp(ANCHOR[i], ANCHOR[i + 1], clamp(f - i, 0, 1));
};

type V3 = [number, number, number];
type Pose = { p: V3; t: V3; fl: number; cy: number; roll: number };
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Chase rig: horizontal offset R at angle phi (0 = straight behind, pi/2 = beside), height dy above the anchor. */
const chase = (f: number): Pose => {
  const sa = anchorAt(f);
  const c = curveAt(sa);
  const k = ease.inOutCubic(prog(f, CLIMB - 30, CLIMB + 90));
  const st = ease.inOutCubic(prog(f, F_PEAK - 24, STOP + 6));
  const R = lerp(3.85, 10, k);
  const phi = lerp(0.675, 0.98, k) + 0.08 * st;
  const dy = lerp(0.55, -4.5, k) + 11 * st;
  const bob = (noise1(f * 0.035 + 7) - 0.5) * 0.12 * (1 - k);
  const p: V3 = [R * Math.sin(phi) + bob, -(c.h + dy) + bob * 0.6, c.z - R * Math.cos(phi)];
  const c2 = curveAt(sa + lerp(11, L_END, k));
  const t: V3 = [lerp(0.4, 0, k), -c2.h - 0.2 * (1 - k), c2.z];
  const v = speedAt(f, V2);
  const rush = f > CLIMB ? clamp((v - V1) / (V2 - V1)) : 0;
  return {
    p,
    t,
    fl: lerp(900, 700, ease.inOutQuad(rush)),
    cy: lerp(492, 540, k),
    roll: -0.2 * Math.sin(Math.PI * ease.inOutSine(prog(f, CLIMB - 10, STOP + 4))) + 0.012 * Math.sin(f * 0.021) * (1 - k),
  };
};

const MARK: V3 = [0, -hOf(U_HERE), U_HERE - U0];
// Wide reveal: the whole 80-year curve from a low side angle (lens shifted up so verticals stay vertical).
const REVEAL: Pose = { p: [86, -10, 8], t: [0, -44, 58], fl: 640, cy: 410, roll: 0 };
const SETTLE = chase(STOP);
const revealK = (f: number) => ease.inOutCubic(prog(f, REVEAL0, WAVE0 - 2));

const poseAt = (f: number): Pose => {
  if (f <= STOP) return chase(f);
  const k = revealK(f);
  const p = lerp3(SETTLE.p, REVEAL.p, k);
  const t = lerp3(SETTLE.t, REVEAL.t, k);
  const p2 = p;
  const k2 = ease.outCubic(prog(f, REVEAL0, WAVE0 - 30));
  return { p: p2, t, fl: lerp(SETTLE.fl, REVEAL.fl, k), cy: lerp(SETTLE.cy, REVEAL.cy, k2), roll: lerp(SETTLE.roll, REVEAL.roll, k) };
};

const camOf = (pose: Pose): Cam => {
  const [px, py, pz] = pose.p;
  const dx = pose.t[0] - px;
  const dy = pose.t[1] - py;
  const dz = pose.t[2] - pz;
  return camera({ x: px, y: py, z: pz, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), f: pose.fl, cy: pose.cy });
};

// ---------------------------------------------------------------------------------------------
// Projection helpers with near-plane clipping.
type View = { cam: Cam; cyw: number; syw: number; cp: number; sp: number };
type Pt = { x: number; y: number; s: number; z: number };
const NEAR = 0.2;
const mkView = (cam: Cam): View => ({ cam, cyw: Math.cos(cam.yaw), syw: Math.sin(cam.yaw), cp: Math.cos(cam.pitch), sp: Math.sin(cam.pitch) });
const toCam = (v: View, X: number, Y: number, Z: number): V3 => {
  const x = X - v.cam.x;
  const y = Y - v.cam.y;
  const z = Z - v.cam.z;
  const x1 = x * v.cyw - z * v.syw;
  const z1 = x * v.syw + z * v.cyw;
  return [x1, y * v.cp - z1 * v.sp, y * v.sp + z1 * v.cp];
};
const scr = (v: View, c: V3): Pt => {
  const s = v.cam.f / c[2];
  return { x: v.cam.cx + c[0] * s, y: v.cam.cy + c[1] * s, s, z: c[2] };
};
const proj = (v: View, X: number, Y: number, Z: number): Pt | null => {
  const c = toCam(v, X, Y, Z);
  return c[2] > NEAR ? scr(v, c) : null;
};
const viewAt = (f: number) => mkView(camOf(poseAt(f)));
const cut = (a: V3, b: V3): V3 => {
  const t = (NEAR - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR + 1e-4];
};
const clipPoly = (cs: V3[]): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const ina = a[2] > NEAR;
    const inb = b[2] > NEAR;
    if (ina) out.push(a);
    if (ina !== inb) out.push(cut(a, b));
  }
  return out;
};
const fillPoly = (ctx: CanvasRenderingContext2D, v: View, cs: V3[], style: string | CanvasGradient) => {
  const c = clipPoly(cs);
  if (c.length < 3) return;
  ctx.beginPath();
  c.forEach((p, i) => {
    const q = scr(v, p);
    if (i) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
};
/** Clip a 3D polyline (camera space) into visible screen-space runs. */
const runs = (v: View, cs: V3[]): Pt[][] => {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c[2] > NEAR) {
      if (!cur.length && i > 0) cur.push(scr(v, cut(cs[i - 1], c)));
      cur.push(scr(v, c));
    } else if (cur.length) {
      cur.push(scr(v, cut(cs[i - 1], c)));
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
};
const strokeRuns = (ctx: CanvasRenderingContext2D, rs: Pt[][]) => {
  ctx.beginPath();
  for (const r of rs)
    r.forEach((p, i) => {
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
  ctx.stroke();
};

// ---------------------------------------------------------------------------------------------
// Milestones. Pylons line the flat road; rings circle the wall.
const MILESTONES = [
  { year: 1946, label: "真空管", col: C.amber },
  { year: 1947, label: "晶体管", col: C.cyan },
  { year: 1958, label: "集成电路", col: C.cyan },
  { year: 1971, label: "微处理器", col: C.green },
  { year: 2005, label: "多核", col: C.blue },
  { year: 2012, label: "深度学习", col: C.violet },
  { year: 2022, label: "大模型", col: C.magenta },
];
const PYLON_DEF = [
  { m: 0, x: -3.2, minRise: 96 },
  { m: 1, x: 6.0, minRise: 108 },
  { m: 2, x: -2.8, minRise: 150 },
  { m: 3, x: 8.4, minRise: 0 },
  { m: 4, x: -2.8, minRise: 0 },
];
const RING_DEF = [5, 6];
const camZAt = (f: number) => poseAt(f).p[2];
/** First frame at which fn(f) >= v (fn increasing). */
const firstFrame = (fn: (f: number) => number, v: number, from = 0) => {
  for (let f = from; f < DUR; f += 0.5) if (fn(f) >= v) return f;
  return DUR;
};
// pass = the frame the camera draws level with the pylon (= ticks.pylon)
const PYLONS = PYLON_DEF.map((d, i) => {
  const ms = MILESTONES[d.m];
  const z = ms.year - U0;
  return { ...ms, x: d.x, z, rise: Math.max(d.minRise, firstFrame(camZAt, z - 24)), pass: PYLON_T[i] };
});
// pass = the frame the ring sweeps down through the middle of the frame (= ticks.ring)
const RINGS = RING_DEF.map((m, i) => {
  const ms = MILESTONES[m];
  return { ...ms, c: curveAt(sOfU(ms.year)), pass: RING_T[i] };
});

// ---------------------------------------------------------------------------------------------
// Deterministic particle sets.
const DUST = Array.from({ length: 1500 }, (_, i) => {
  const climb = i % 5 !== 0; // most dust lives around the wall
  const s = climb ? sOfU(2003) + hash(i * 3.17 + 1) * (S_HERE + 30 - sOfU(2003)) : -32 + hash(i * 3.17 + 1) * 97;
  const c = curveAt(s);
  const lat = -8 + hash(i * 5.31 + 2) * (climb ? 24 : 18);
  const nrm = climb ? -2 + hash(i * 7.77 + 3) * 16 : 0.1 + Math.pow(hash(i * 7.77 + 3), 1.6) * 5;
  const along = (hash(i * 9.13 + 4) - 0.5) * 2;
  const y = -c.h - nrm * c.tz - along * c.th;
  const z = c.z - nrm * c.th + along * c.tz;
  return { x: lat, y: Math.min(-0.05, y), z, u: c.u, r: hash(i * 1.9 + 5), tw: hash(i * 2.7 + 6) * 50, flat: !climb };
});
const STARS = Array.from({ length: 520 }, (_, i) => {
  const az = hash(i * 4.1 + 11) * TAU;
  const el = Math.asin(0.03 + 0.97 * hash(i * 6.3 + 12));
  return { d: [Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)] as V3, b: Math.pow(hash(i * 8.9 + 13), 3), tw: hash(i * 3.3 + 14) * 40 };
});

// ---------------------------------------------------------------------------------------------
const lit = (f: number) => (f - IGNITE) * 2.4; // arc length reached by the ignition front
const S_WAVE_END = S_HERE + 300;
const waveS = (f: number) => (f < WAVE0 ? -1e9 : lerp(-2, S_WAVE_END, ease.inCubic(prog(f, WAVE0, FLASH + 2))));
/** Frame at which the wave reaches arc length s. */
const waveAt = (s: number) => firstFrame(waveS, s, WAVE0);
const WAVE_HIT = waveAt(S_HERE);
/** Overall energy grade: 0 in the flat past, 1 at the top. */
const gradeAt = (f: number) => clamp(curveAt(anchorAt(Math.min(f, STOP))).h / H_HERE);

const CAPS = [
  { from: 90, to: 200, text: "所以，计算机并不是“突然”变强的。" },
  { from: 205, to: 320, text: "它是在80年里，一次又一次地翻倍。" },
  { from: 330, to: 480, text: "指数曲线的前半段平淡得让人忽略，后半段陡峭得让人震撼" },
  { from: 490, to: 605, text: "而我们，正站在这条曲线{{最陡峭的地方}}。" },
];
/** 0..1: how much a caption is on screen (the world dims under the caption band). */
const capA = (f: number) => Math.max(0, ...CAPS.map((c) => Math.min(clamp((f - c.from + 6) / 12), clamp((c.to + 6 - f) / 12))));

// Strands: the steep part of the curve extruded sideways into a wall of light.
const STRANDS = Array.from({ length: 40 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const k = Math.floor(i / 2);
  return { x: side * (1.9 + k * 0.62 + hash(i * 3.3 + 90) * 0.4), a: 0.25 + 0.75 * hash(i * 5.1 + 91), sp: 0.7 + hash(i * 7.9 + 92) * 1.2, ph: hash(i * 9.7 + 93) };
});
const I_WALL = SMP.findIndex((p) => p.u >= 2003);

type Lbl = { x: number; y: number; size: number; year: string; text: string; col: string; a: number; align: CanvasTextAlign };

const drawWorld = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  const pose = poseAt(f);
  const cam = camOf(pose);
  const v = mkView(cam);
  const prev = viewAt(f - (f > CLIMB && f < STOP ? 2.6 : 1.6));
  const grade = gradeAt(f);
  const rk = revealK(f);
  const fogNear = lerp(20, 60, ease.inOutQuad(grade)) + 160 * rk;
  const fogFar = fogNear * 2.6;
  const fog = (d: number) => clamp(1 - (d - fogNear) / (fogFar - fogNear));
  const wS = waveS(f);
  const litS = lit(f);
  const dist = (x: number, y: number, z: number) => Math.hypot(x - v.cam.x, y - v.cam.y, z - v.cam.z);
  const labels: Lbl[] = [];

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(pose.roll);
  ctx.translate(-w / 2, -h / 2);

  // --- sky & ground ------------------------------------------------------------------------
  const horizon = cam.cy - cam.f * Math.tan(cam.pitch);
  const tint = skyTint(grade * (1 - 0.6 * rk));
  const skyTop = mix("#010208", tint, 0.18);
  const skyHor = mix("#05040a", tint, 0.7);
  const sky = ctx.createLinearGradient(0, horizon - 1300, 0, horizon);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.7, mix(skyTop, skyHor, 0.45));
  sky.addColorStop(1, skyHor);
  ctx.fillStyle = sky;
  ctx.fillRect(-300, -300, w + 600, h + 600);
  if (horizon < h + 300) {
    const gr = ctx.createLinearGradient(0, horizon, 0, horizon + 520);
    gr.addColorStop(0, mix("#05040a", tint, 0.42));
    gr.addColorStop(0.25, mix("#030206", tint, 0.12));
    gr.addColorStop(1, "#010102");
    ctx.fillStyle = gr;
    ctx.fillRect(-300, horizon, w + 600, h + 600 - horizon);
  }
  // stars (directions at infinity)
  for (const st of STARS) {
    const c = toCam(v, v.cam.x + st.d[0], v.cam.y + st.d[1], v.cam.z + st.d[2]);
    if (c[2] <= 0.05) continue;
    const q = scr(v, c);
    if (q.x < -50 || q.x > w + 50 || q.y < -50 || q.y > Math.min(h + 50, horizon)) continue;
    const tw = 0.6 + 0.4 * Math.sin(f * 0.08 + st.tw);
    const a = (0.25 + 0.75 * st.b) * tw * clamp(-st.d[1] * 6);
    ctx.fillStyle = `rgba(220,230,255,${a * 0.8})`;
    const r = 0.8 + st.b * 1.6;
    ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r);
  }

  ctx.globalCompositeOperation = "lighter";
  // horizon haze
  if (horizon > -200 && horizon < h + 200) {
    const hz = ctx.createLinearGradient(0, horizon - 200, 0, horizon + 90);
    hz.addColorStop(0, withAlpha(tint, 0));
    hz.addColorStop(0.69, withAlpha(tint, 0.2));
    hz.addColorStop(1, withAlpha(tint, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(-300, horizon - 200, w + 600, 290);
  }

  // light pouring down from above as we near the top
  {
    const la = ease.inQuad(clamp((grade - 0.3) / 0.7)) * (1 - rk) + 0.6 * prog(f, WAVE_HIT - 8, FLASH);
    if (la > 0.01) {
      const g = ctx.createLinearGradient(0, -300, 0, h * 0.7);
      g.addColorStop(0, withAlpha("#ffe6f8", 0.5 * la));
      g.addColorStop(0.4, withAlpha(C.magenta, 0.14 * la));
      g.addColorStop(1, withAlpha(C.magenta, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-300, -300, w + 600, h * 0.7 + 300);
    }
  }

  // --- ground grid ---------------------------------------------------------------------------
  const gridPass = (step: number, ext: number, near: number, far: number, base: number) => {
    const buckets: Pt[][][] = [[], [], [], [], [], []];
    const camX = v.cam.x;
    const camZ = v.cam.z;
    const x0 = Math.floor((camX - ext) / step) * step;
    const z0 = Math.floor((camZ - ext) / step) * step;
    const add = (ax: number, az: number, bx: number, bz: number) => {
      const d = Math.hypot((ax + bx) / 2 - camX, (az + bz) / 2 - camZ, v.cam.y);
      const a = clamp(1 - (d - near) / (far - near));
      if (a <= 0.02) return;
      const rs = runs(v, [toCam(v, ax, 0, az), toCam(v, bx, 0, bz)]);
      if (!rs.length) return;
      buckets[Math.min(5, Math.floor(a * 6))].push(...rs);
    };
    const seg = step * 2;
    for (let x = x0; x <= camX + ext; x += step) for (let z = z0; z < camZ + ext; z += seg) add(x, z, x, z + seg);
    for (let z = z0; z <= camZ + ext; z += step) for (let x = x0; x < camX + ext; x += seg) add(x, z, x + seg, z);
    ctx.lineWidth = 1.2;
    buckets.forEach((b, i) => {
      if (!b.length) return;
      ctx.strokeStyle = withAlpha(mix("#4f7dff", tint, 0.3), base * ((i + 0.5) / 6));
      strokeRuns(ctx, b);
    });
  };
  if (v.cam.y < 0 && horizon < h + 100) {
    gridPass(2, 46, 6, 46, 0.3 * (1 - rk));
    gridPass(10, 220, 20, 220, 0.25 * clamp(-v.cam.y / 15 + rk));
  }

  // --- glow pools on the ground under the flat ribbon -------------------------------------------
  for (let s = 0; s < Math.min(litS, sOfU(2010)); s += 2.5) {
    const c = curveAt(s);
    const p = proj(v, 0, 0, c.z);
    if (!p) continue;
    const d = dist(0, 0, c.z);
    const squash = clamp(Math.abs(v.cam.y) / d + 0.08);
    const r = 3.2 * p.s;
    if (r < 2) continue;
    const a = 0.16 * intAt(c.u) * fog(d);
    if (a < 0.01) continue;
    ctx.globalAlpha = a;
    ctx.drawImage(spriteFor(palAt(c.u)), p.x - r, p.y - r * squash, r * 2, r * 2 * squash);
    ctx.globalAlpha = 1;
  }

  // --- the future glow, high above -------------------------------------------------------------
  {
    const p = proj(v, 0, -hOf(U_HERE) * 2.4, U_HERE - U0 + 4);
    const a = 0.12 + 0.9 * ease.inQuad(grade) * (1 - 0.5 * rk) + 0.9 * prog(f, WAVE_HIT - 6, FLASH);
    if (p) {
      glow(ctx, p.x, p.y, 1100 + 900 * grade, C.magenta, 0.24 * a, 0.02);
      glow(ctx, p.x, p.y, 520 + 500 * grade, "#ffffff", 0.32 * a, 0.03);
    }
  }

  // --- pylons -----------------------------------------------------------------------------------
  for (const py of PYLONS) {
    const z = py.z;
    const r = ease.outCubic(prog(f, py.rise, py.rise + 26));
    if (r <= 0) continue;
    const top = Math.max(2.5, hOf(py.year) + 1.4) * r;
    const base = proj(v, py.x, 0, z);
    const tp = proj(v, py.x, -top, z);
    const d = dist(py.x, -top / 2, z);
    const fa = fog(d);
    if (fa <= 0.01) continue;
    const pass = f - py.pass;
    const kick = pass >= 0 ? Math.exp(-pass / 10) : 0;
    const wv = f >= waveAt(sOfU(py.year)) ? Math.exp(-(f - waveAt(sOfU(py.year))) / 8) : 0;
    const boost = 1 + 1.5 * kick + 2.5 * wv;
    // beam into the sky
    const sky = runs(v, [toCam(v, py.x, -top, z), toCam(v, py.x, -top - 40, z)]);
    if (sky.length && tp) {
      const end = sky[0][sky[0].length - 1];
      const g = ctx.createLinearGradient(tp.x, tp.y, end.x, end.y);
      g.addColorStop(0, withAlpha(py.col, 0.26 * fa * r * Math.min(2, boost)));
      g.addColorStop(1, withAlpha(py.col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = clamp(0.25 * tp.s, 1, 24);
      strokeRuns(ctx, sky);
    }
    const shaft = runs(v, [toCam(v, py.x, 0, z), toCam(v, py.x, -top, z)]);
    if (shaft.length) {
      const sc = (tp ?? base)?.s ?? 50;
      ctx.lineCap = "round";
      ctx.strokeStyle = withAlpha(py.col, 0.16 * fa * boost);
      ctx.lineWidth = clamp(0.5 * sc, 3, 60);
      strokeRuns(ctx, shaft);
      ctx.strokeStyle = withAlpha(mix(py.col, "#ffffff", 0.5), 0.9 * fa * Math.min(1.5, boost));
      ctx.lineWidth = clamp(0.06 * sc, 1.2, 7);
      strokeRuns(ctx, shaft);
      ctx.lineCap = "butt";
    }
    // ground ring (pulses outward as the camera passes)
    const ring: V3[] = [];
    const rr = 0.7 + (pass >= 0 ? 2 * (1 - Math.exp(-pass / 12)) : 0);
    for (let i = 0; i <= 32; i++) ring.push(toCam(v, py.x + Math.cos((i / 32) * TAU) * rr, 0, z + Math.sin((i / 32) * TAU) * rr));
    ctx.strokeStyle = withAlpha(py.col, 0.6 * fa * (pass >= 0 ? Math.exp(-pass / 25) * 0.8 + 0.2 : 1));
    ctx.lineWidth = 2;
    strokeRuns(ctx, runs(v, ring));
    if (base) {
      const sq = clamp(Math.abs(v.cam.y) / d + 0.06);
      const rp = 1.6 * base.s;
      ctx.globalAlpha = Math.min(1, 0.35 * fa * boost);
      ctx.drawImage(spriteFor(py.col), base.x - rp, base.y - rp * sq, rp * 2, rp * 2 * sq);
      ctx.globalAlpha = 1;
    }
    if (tp) {
      glow(ctx, tp.x, tp.y, clamp(0.9 * tp.s, 6, 120) * (1 + 0.6 * kick + wv), py.col, 0.9 * fa * Math.min(1.6, boost));
      const la = fa * (1 - clamp(rk * 3)) * ease.outCubic(prog(f, py.rise + 10, py.rise + 30)) * clamp((tp.x + 80) / 160) * clamp((w + 80 - tp.x) / 160);
      if (la > 0.02)
        labels.push({ x: tp.x, y: tp.y - clamp(0.55 * tp.s, 14, 70), size: clamp(0.5 * tp.s, 24, 56), year: String(py.year), text: py.label, col: py.col, a: la, align: "center" });
    }
  }

  // --- the ribbon and the light under it ----------------------------------------------------------
  const sEnd = Math.min(litS, SMP[SMP.length - 1].s);
  type RP = { c: Smp; m: V3; l: V3; r: V3; g: V3; a: number; col: string };
  const pts: RP[] = [];
  for (let i = I_START; i < SMP.length; i++) {
    const c = SMP[i];
    if (c.s > sEnd) break;
    const d = dist(0, -c.h, c.z);
    const beyond = c.u > U_HERE ? Math.exp(-(c.h - H_HERE) / (H_HERE * 0.45)) : 1;
    const energized = wS > c.s ? 1 + 1.6 * Math.exp(-(wS - c.s) / 50) : 1;
    const bw = bandW(c.h) / 2;
    pts.push({
      c,
      m: toCam(v, 0, -c.h, c.z),
      l: toCam(v, -bw, -c.h, c.z),
      r: toCam(v, bw, -c.h, c.z),
      g: toCam(v, 0, 0, c.z),
      a: intAt(c.u) * fog(d) * beyond * energized * clamp((sEnd - c.s) / 3 + 0.2),
      col: wS > c.s && wS - c.s < 30 ? "#ffffff" : palAt(c.u),
    });
  }
  const K = 5;
  for (let i0 = 0; i0 < pts.length - 1; i0 += K) {
    const i1 = Math.min(pts.length - 1, i0 + K);
    const mid = pts[(i0 + i1) >> 1];
    if (mid.a < 0.01) continue;
    const seg = pts.slice(i0, i1 + 1);
    const hot = 1 + 0.8 * clamp(mid.c.h / H_HERE);
    // curtain: the area under the curve, a wall of light fading toward the ground
    if (mid.c.h > 0.9) {
      const top = seg[0].m[2] > NEAR && seg[seg.length - 1].m[2] > NEAR ? scr(v, mid.m) : null;
      const bot = mid.g[2] > NEAR ? scr(v, mid.g) : null;
      const ca = 0.2 * mid.a * clamp((mid.c.h - 0.9) / 4);
      let style: string | CanvasGradient = withAlpha(mid.col, ca * 0.4);
      if (top && bot) {
        const g = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
        g.addColorStop(0, withAlpha(mid.col, ca));
        g.addColorStop(0.35, withAlpha(mid.col, ca * 0.35));
        g.addColorStop(1, withAlpha(mid.col, ca * 0.05));
        style = g;
      }
      fillPoly(ctx, v, [...seg.map((p) => p.m), ...seg.map((p) => p.g).reverse()], style);
    }
    // screen-space halo (tube-like bloom), only away from the near plane
    if (seg.every((p) => p.m[2] > 2.2)) {
      const sp = seg.map((p) => scr(v, p.m));
      const halo = (wWorld: number, minPx: number, maxPx: number, alpha: number) => {
        const L: [number, number][] = [];
        const R: [number, number][] = [];
        for (let j = 0; j < sp.length; j++) {
          const gi = i0 + j;
          const pa = pts[Math.max(0, gi - 1)];
          const pb = pts[Math.min(pts.length - 1, gi + 1)];
          if (pa.m[2] <= NEAR || pb.m[2] <= NEAR) return;
          const qa = scr(v, pa.m);
          const qb = scr(v, pb.m);
          let tx = qb.x - qa.x;
          let ty = qb.y - qa.y;
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const hw = clamp(wWorld * sp[j].s, minPx, maxPx) / 2;
          L.push([sp[j].x - ty * hw, sp[j].y + tx * hw]);
          R.push([sp[j].x + ty * hw, sp[j].y - tx * hw]);
        }
        ctx.beginPath();
        L.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        for (let j = R.length - 1; j >= 0; j--) ctx.lineTo(R[j][0], R[j][1]);
        ctx.closePath();
        ctx.fillStyle = withAlpha(mid.col, alpha);
        ctx.fill();
      };
      halo(bandW(mid.c.h) * 3.2, 14, 150, 0.06 * mid.a * hot);
      halo(bandW(mid.c.h) * 1.2, 6, 60, 0.11 * mid.a * hot);
    }
    // surface (world-space ribbon)
    fillPoly(ctx, v, [...seg.map((p) => p.l), ...seg.map((p) => p.r).reverse()], withAlpha(mid.col, (0.3 - 0.17 * clamp(mid.c.h / H_HERE)) * mid.a));
    // edges + core
    const sMid = mid.m[2] > NEAR ? v.cam.f / mid.m[2] : 400;
    ctx.lineJoin = "round";
    ctx.strokeStyle = withAlpha(mix(mid.col, "#ffffff", 0.35), Math.min(1, 1.1 * mid.a));
    ctx.lineWidth = clamp(0.045 * sMid, 1, 6);
    strokeRuns(ctx, runs(v, seg.map((p) => p.l)));
    strokeRuns(ctx, runs(v, seg.map((p) => p.r)));
    ctx.strokeStyle = withAlpha(mix(mid.col, "#ffffff", 0.7), Math.min(1, 0.6 * mid.a * hot));
    ctx.lineWidth = clamp(0.1 * sMid, 1.5, 12);
    strokeRuns(ctx, runs(v, seg.map((p) => p.m)));
  }
  // the strand wall: the steep curve extruded sideways into a sheet of light
  {
    const wallA = (0.25 + 0.75 * ease.inOutQuad(prog(f, CLIMB - 6, CLIMB + 30))) * ease.inOutQuad(prog(f, 240, 300)) * (1 - 0.65 * rk);
    const front = f < CLIMB - 4 ? sOfU(2009) + (f - 240) * 0.08 : sOfU(2009) + (f - CLIMB + 4) * 4.5;
    const wallEnd = Math.min(sEnd, front);
    if (wallA > 0.01) {
      const SK = 8;
      for (const st of STRANDS) {
        const fall = Math.exp(-Math.abs(st.x) / 7) * st.a * wallA;
        for (let i0 = I_WALL; i0 < SMP.length - 1; i0 += SK) {
          const i1 = Math.min(SMP.length - 1, i0 + SK);
          const cm = SMP[(i0 + i1) >> 1];
          if (cm.s > wallEnd) break;
          const rise = clamp((cm.u - 2004) / 8) * clamp((wallEnd - cm.s) / 12);
          const beyond = cm.u > U_HERE ? Math.exp(-(cm.h - H_HERE) / (H_HERE * 0.7)) : 1;
          const a = fall * rise * beyond * intAt(cm.u) * fog(dist(st.x, -cm.h, cm.z));
          if (a < 0.01) continue;
          const cs: V3[] = [];
          for (let i = i0; i <= i1; i++) cs.push(toCam(v, st.x, -SMP[i].h, SMP[i].z));
          const rs = runs(v, cs);
          if (!rs.length) continue;
          const sc = v.cam.f / Math.max(1, dist(st.x, -cm.h, cm.z));
          ctx.strokeStyle = withAlpha(palAt(cm.u), 0.16 * a);
          ctx.lineWidth = clamp(0.5 * sc, 2, 30);
          strokeRuns(ctx, rs);
          ctx.strokeStyle = withAlpha(mix(palAt(cm.u), "#ffffff", 0.3), 0.8 * a);
          ctx.lineWidth = clamp(0.05 * sc, 1, 4);
          strokeRuns(ctx, rs);
        }
        // light running up each strand
        for (let j = 0; j < 2; j++) {
          const span = S_HERE + 40 - sOfU(2004);
          const s = sOfU(2004) + ((st.ph + j * 0.5 + f * st.sp * 0.006) % 1) * span;
          if (s > wallEnd) continue;
          const c = curveAt(s);
          const c0 = curveAt(s - 4 - 3 * st.sp);
          const rs = runs(v, [toCam(v, st.x, -c0.h, c0.z), toCam(v, st.x, -c.h, c.z)]);
          if (!rs.length) continue;
          const d = dist(st.x, -c.h, c.z);
          const a = fall * clamp((c.u - 2004) / 8) * fog(d);
          ctx.strokeStyle = withAlpha(mix(palAt(c.u), "#ffffff", 0.6), 0.9 * a);
          ctx.lineWidth = clamp((0.12 * v.cam.f) / Math.max(1, d), 1.5, 8);
          strokeRuns(ctx, rs);
        }
      }
    }
  }
  // the wall ignites as the curve turns upward
  if (f >= CLIMB - 4 && f < CLIMB + 40) {
    const c = curveAt(sOfU(2009));
    const p = proj(v, 0, -c.h, c.z);
    const t = f - CLIMB + 4;
    if (p) {
      glow(ctx, p.x, p.y, 200 + t * 40, C.cyan, 0.8 * Math.exp(-t / 10), 0.04);
      glow(ctx, p.x, p.y, 60 + t * 10, "#ffffff", Math.exp(-t / 6));
    }
  }
  // rungs every two years ("doublings")
  for (let yr = 1946; yr <= 2030; yr += 2) {
    const s = sOfU(yr);
    if (s > sEnd) break;
    const c = curveAt(s);
    const d = dist(0, -c.h, c.z);
    const beyond = c.u > U_HERE ? Math.exp(-(c.h - H_HERE) / (H_HERE * 0.6)) : 1;
    const a = intAt(c.u) * fog(d) * beyond;
    if (a < 0.02) continue;
    const bw = bandW(c.h) * 0.75;
    const rs = runs(v, [toCam(v, -bw, -c.h, c.z), toCam(v, bw, -c.h, c.z)]);
    if (!rs.length) continue;
    ctx.strokeStyle = withAlpha(mix(palAt(c.u), "#ffffff", 0.4), 0.6 * a);
    ctx.lineWidth = clamp((0.06 * v.cam.f) / Math.max(0.5, d), 1, 5);
    strokeRuns(ctx, rs);
  }
  // origin node
  {
    const p = proj(v, 0, -H0, 0);
    const ia = ease.outCubic(prog(f, IGNITE - 6, IGNITE + 10));
    if (p && ia > 0) {
      glow(ctx, p.x, p.y, clamp(1.4 * p.s, 10, 220) * (1 + 2 * Math.exp(-Math.max(0, f - IGNITE) / 8)), C.amber, 0.9 * ia);
      glow(ctx, p.x, p.y, clamp(0.35 * p.s, 4, 60), "#ffffff", ia);
    }
  }
  // ignition front
  if (f > IGNITE && litS < S_HERE + 260) {
    const c = curveAt(litS);
    const p = proj(v, 0, -c.h, c.z);
    if (p) {
      const fa = fog(dist(0, -c.h, c.z));
      glow(ctx, p.x, p.y, clamp(2.4 * p.s, 20, 400), palAt(c.u), 0.9 * fa);
      glow(ctx, p.x, p.y, clamp(0.6 * p.s, 6, 90), "#ffffff", fa);
    }
  }
  // energy pulses riding the ribbon
  const LOOP = S_HERE + 30;
  for (let k = 0; k < 14; k++) {
    const s = ((k / 14) * LOOP + f * 0.9) % LOOP;
    if (s > sEnd) continue;
    const c = curveAt(s);
    const p = proj(v, 0, -c.h, c.z);
    if (!p) continue;
    const a = intAt(c.u) * fog(dist(0, -c.h, c.z));
    glow(ctx, p.x, p.y, clamp(1.1 * p.s, 4, 120), palAt(c.u), 0.7 * a);
    glow(ctx, p.x, p.y, clamp(0.25 * p.s, 2, 26), "#ffffff", 0.8 * a);
  }
  // flow particles (streaks racing along the ribbon)
  for (let i = 0; i < 300; i++) {
    const spd = 0.5 + hash(i * 2.3 + 40) * 0.9;
    const s = (hash(i * 7.1 + 41) * LOOP + f * spd) % LOOP;
    if (s > sEnd || s < 0) continue;
    const c = curveAt(s);
    const c0 = curveAt(s - spd * 2.2);
    const x = (hash(i * 3.9 + 42) - 0.5) * bandW(c.h) * 0.9;
    const lift = 0.05 + hash(i * 5.5 + 43) * 0.25;
    const rs = runs(v, [toCam(v, x, -c0.h - lift * c0.tz, c0.z + lift * c0.th), toCam(v, x, -c.h - lift * c.tz, c.z + lift * c.th)]);
    if (!rs.length) continue;
    const d = dist(x, -c.h, c.z);
    const a = intAt(c.u) * fog(d);
    if (a < 0.02) continue;
    ctx.strokeStyle = withAlpha(mix(palAt(c.u), "#ffffff", 0.5), 0.8 * a);
    ctx.lineWidth = clamp((0.05 * v.cam.f) / Math.max(0.5, d), 0.8, 4);
    strokeRuns(ctx, rs);
  }
  // the doubling wave: a white-hot head with a long trail
  if (wS > -1) {
    for (let k = 0; k < 16; k++) {
      const s = wS - k * 2.5;
      if (s < 0) continue;
      const c = curveAt(s);
      const p = proj(v, 0, -c.h, c.z);
      if (!p) continue;
      const fall = Math.exp(-k / 5);
      glow(ctx, p.x, p.y, clamp(6 * p.s, 50, 600) * (0.4 + 0.6 * fall), k < 2 ? "#ffffff" : palAt(c.u), 0.9 * fall);
    }
  }

  // --- rings on the wall: 2012, 2022 ---------------------------------------------------------------
  for (const rg of RINGS) {
    const c = rg.c;
    if (c.s > sEnd) continue;
    const pass = f - rg.pass;
    const app = ease.outBack(clamp((f - (rg.pass - 55)) / 22));
    const gone = 1 - ease.inQuad(prog(f, rg.pass + 4, rg.pass + 22)) * (1 - rk);
    if (app <= 0 || gone <= 0.01) continue;
    const d = dist(0, -c.h, c.z);
    const fa = fog(d) * gone;
    const kick = pass >= 0 ? Math.exp(-pass / 10) : 0;
    const ringPts = (R: number) => {
      const out: V3[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        const x = Math.cos(a) * R;
        const n = Math.sin(a) * R;
        out.push(toCam(v, x, -c.h - n * c.tz, c.z - n * c.th)); // N = (0, -tz, -th)
      }
      return out;
    };
    const R = (bandW(c.h) / 2 + 1.4) * app;
    const sc = v.cam.f / Math.max(1, d);
    for (const [wd, al] of [
      [0.5, 0.18],
      [0.18, 0.4],
      [0.05, 1],
    ] as const) {
      ctx.strokeStyle = withAlpha(al === 1 ? mix(rg.col, "#ffffff", 0.45) : rg.col, al * fa * (1 + 1.5 * kick));
      ctx.lineWidth = clamp(wd * sc, 1, 80);
      strokeRuns(ctx, runs(v, ringPts(R)));
    }
    if (pass >= 0 && pass < 40) {
      ctx.strokeStyle = withAlpha(rg.col, 0.8 * Math.exp(-pass / 10));
      ctx.lineWidth = clamp(0.12 * sc, 1, 20);
      strokeRuns(ctx, runs(v, ringPts(R + pass * 0.7)));
    }
    const lp = proj(v, R + 0.6, -c.h, c.z);
    if (lp) {
      const la = fa * (1 - clamp(rk * 4)) * clamp(app) * clamp((lp.y + 60) / 120) * clamp((720 - lp.y) / 100);
      if (la > 0.02) labels.push({ x: lp.x + 14, y: lp.y, size: clamp(0.38 * lp.s, 34, 60), year: String(rg.year), text: rg.label, col: rg.col, a: la, align: "left" });
    }
  }

  // --- dust & speed streaks -----------------------------------------------------------------------
  for (const p of DUST) {
    const a1 = toCam(v, p.x, p.y, p.z);
    if (a1[2] <= NEAR) continue;
    const q1 = scr(v, a1);
    if (q1.x < -200 || q1.x > w + 200 || q1.y < -200 || q1.y > h + 200) continue;
    const fa = fog(dist(p.x, p.y, p.z));
    if (fa < 0.02) continue;
    const d = a1[2];
    const tw = 0.55 + 0.45 * Math.sin(f * 0.09 + p.tw);
    const col = palAt(p.u);
    const al = (0.2 + 0.6 * p.r) * fa * tw * clamp(d / 1.2) * (1 - 0.7 * rk) * (p.flat ? 0.5 : 1);
    const lw = clamp((0.035 * v.cam.f) / d, 0.8, 3.5);
    const a0 = toCam(prev, p.x, p.y, p.z);
    if (a0[2] > NEAR) {
      const q0 = scr(prev, a0);
      const len = Math.hypot(q1.x - q0.x, q1.y - q0.y);
      if (len > 4) {
        ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.4), al * clamp(40 / len + 0.3));
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(q0.x, q0.y);
        ctx.lineTo(q1.x, q1.y);
        ctx.stroke();
        continue;
      }
    }
    ctx.fillStyle = withAlpha(mix(col, "#ffffff", 0.4), al);
    ctx.fillRect(q1.x - lw / 2, q1.y - lw / 2, lw, lw);
  }

  // --- reveal: the whole history as a chart --------------------------------------------------------
  if (rk > 0.02) {
    const la = ease.outCubic(prog(rk, 0.72, 0.95));
    const LEAD = [54, 118, 54, 86, 54];
    MILESTONES.forEach((ms, k) => {
      const c = curveAt(sOfU(ms.year));
      const p = proj(v, 0, -c.h, c.z);
      if (!p) return;
      const wv = f >= waveAt(c.s) ? Math.exp(-(f - waveAt(c.s)) / 10) : 0;
      glow(ctx, p.x, p.y, 16 + 30 * wv, ms.col, 0.9 * rk);
      glow(ctx, p.x, p.y, 5 + 6 * wv, "#ffffff", rk);
      if (la <= 0.01) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = withAlpha(ms.col, 0.75 * la);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (k < 5) {
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x, p.y - LEAD[k]);
        labels.push({ x: p.x, y: p.y - LEAD[k] - 8, size: 26, year: String(ms.year), text: ms.label, col: ms.col, a: la * clamp((800 - p.y) / 40), align: "center" });
      } else {
        ctx.moveTo(p.x + 10, p.y);
        ctx.lineTo(p.x + 44, p.y);
        labels.push({ x: p.x + 52, y: p.y + 30, size: 28, year: String(ms.year), text: ms.label, col: ms.col, a: la, align: "left" });
      }
      ctx.stroke();
      ctx.globalCompositeOperation = "lighter";
    });
  }

  // --- you are here ------------------------------------------------------------------------------
  if (f > HERE - 20) {
    const p = proj(v, MARK[0], MARK[1], MARK[2]);
    if (p) {
      const a = ease.outCubic(prog(f, HERE - 20, HERE + 5));
      const pulse = 0.75 + 0.25 * Math.sin((f - HERE) * 0.22);
      const hit = f >= WAVE_HIT ? f - WAVE_HIT : -1;
      glow(ctx, p.x, p.y, clamp(2 * p.s, 60, 170) * pulse * (1 + (hit >= 0 ? hit * 0.6 : 0)), C.gold, 0.75 * a);
      glow(ctx, p.x, p.y, clamp(0.45 * p.s, 14, 40) * (1 + (hit >= 0 ? hit * 0.3 : 0)), "#ffffff", a);
      for (let k = 0; k < 3; k++) {
        const tt = f - HERE + k * 20;
        if (tt < 0) continue;
        const t = (tt % 60) / 60;
        ctx.strokeStyle = withAlpha(C.gold, 0.8 * (1 - t) * a);
        ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 18 + t * 120, 0, TAU);
        ctx.stroke();
      }
    }
  }
  // pre-flash bloom: light pours down from the top of the curve
  if (f > WAVE_HIT - 4) {
    const p = proj(v, MARK[0], MARK[1], MARK[2]);
    const t = prog(f, WAVE_HIT - 4, FLASH);
    const x = p ? p.x : w / 2;
    const y = p ? p.y : 0;
    glow(ctx, x, y, 300 + 2600 * ease.inQuad(t), "#ffffff", 0.9 * t, 0.15);
    glow(ctx, x, y, 200 + 1600 * t, C.gold, 0.6 * t, 0.05);
  }

  ctx.restore();
  bloom(ctx, w, h, lerp(0.55, 0.9, grade) * (1 - 0.3 * rk) + 0.6 * prog(f, WAVE_HIT - 8, FLASH));
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(pose.roll);
  ctx.translate(-w / 2, -h / 2);
  ctx.globalCompositeOperation = "source-over";
  // --- labels ------------------------------------------------------------------------------------------
  for (const L of labels) {
    const wEst = L.size * 2.6;
    const xl = L.align === "center" ? L.x - wEst / 2 : L.x;
    const safe = clamp((xl - 70) / 70) * clamp((w - 70 - (xl + wEst)) / 70) * clamp((L.y - L.size * 1.9 - 60) / 50);
    if (L.a * safe <= 0.01) continue;
    ctx.globalAlpha = L.a * safe;
    ctx.textAlign = L.align;
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 12;
    ctx.font = `800 ${Math.round(L.size)}px ${FONT_MONO}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(L.year, L.x, L.y - L.size * 0.88);
    ctx.font = `700 ${Math.round(L.size * 0.8)}px ${FONT_CN}`;
    ctx.fillStyle = mix(L.col, "#ffffff", 0.3);
    ctx.fillText(L.text, L.x, L.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // keep the caption band calm: the world sinks into black under the subtitles
  const ca = capA(f);
  if (ca > 0) {
    const g = ctx.createLinearGradient(0, 740, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.4, `rgba(0,0,0,${0.72 * ca})`);
    g.addColorStop(1, `rgba(0,0,0,${0.94 * ca})`);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = g;
    ctx.fillRect(0, 740, w, h - 740);
    ctx.globalCompositeOperation = "source-over";
  }
};

let bloomBuf: HTMLCanvasElement | null = null;
/** Cheap bloom: blur a quarter-size copy, square it (soft threshold), add it back. */
const bloom = (ctx: CanvasRenderingContext2D, w: number, h: number, k: number) => {
  if (k <= 0.01) return;
  if (!bloomBuf) {
    bloomBuf = document.createElement("canvas");
    bloomBuf.width = 480;
    bloomBuf.height = 270;
  }
  const b = bloomBuf.getContext("2d")!;
  b.globalCompositeOperation = "source-over";
  b.globalAlpha = 1;
  b.clearRect(0, 0, 480, 270);
  b.filter = "blur(6px)";
  b.drawImage(ctx.canvas, 0, 0, 480, 270);
  b.filter = "none";
  b.globalCompositeOperation = "multiply";
  b.drawImage(bloomBuf, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.min(1, k);
  ctx.drawImage(bloomBuf, 0, 0, w, h);
  ctx.restore();
};

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Soft disc sprite (no white core) used for flattened ground light pools. */
const spriteFor = (col: string) => {
  const hit = spriteCache.get(col);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, withAlpha(col, 0.9));
  grad.addColorStop(0.35, withAlpha(col, 0.35));
  grad.addColorStop(1, withAlpha(col, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  spriteCache.set(col, c);
  return c;
};

const World: React.FC = () => <Canvas draw={drawWorld} />;

/** "我们在这里 · YOU ARE HERE" tag pinned to the marker. */
const HereTag: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < HERE - 10 || frame >= FLASH) return null;
  const pose = poseAt(frame);
  const v = mkView(camOf(pose));
  const p = proj(v, MARK[0], MARK[1], MARK[2]);
  if (!p) return null;
  const a = ease.outCubic(prog(frame, HERE - 6, HERE + 14)) * (1 - prog(frame, WAVE_HIT - 2, WAVE_HIT + 4));
  const line = ease.outExpo(prog(frame, HERE - 6, HERE + 16));
  // same roll as the canvas
  const c = Math.cos(pose.roll);
  const s = Math.sin(pose.roll);
  const rx = 960 + (p.x - 960) * c - (p.y - 540) * s;
  const ry = 540 + (p.x - 960) * s + (p.y - 540) * c;
  const dx = 130;
  const dy = lerp(-96, 70, clamp((330 - ry) / 140));
  const tIn = ease.outCubic(prog(frame, HERE + 2, HERE + 18));
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <polyline
          points={`${rx + 18 * Math.sign(dx)},${ry + 14 * Math.sign(dy)} ${rx + dx * line},${ry + dy * line} ${rx + dx + 250 * line},${ry + dy}`}
          stroke={C.gold}
          strokeWidth={2}
          fill="none"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: rx + dx + 6,
          top: ry + dy - 64,
          whiteSpace: "nowrap",
          opacity: tIn,
          transform: `translateY(${(1 - tIn) * 12}px)`,
        }}
      >
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 48, color: "#fff", textShadow: `0 0 22px ${C.gold}, 0 2px 8px #000` }}>我们在这里</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: C.gold, letterSpacing: "0.18em", marginLeft: 14, textShadow: "0 2px 8px #000" }}>
          · YOU ARE HERE
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Year readout while flying (interpolates between the milestone years). */
const yearAt = (f: number) => {
  const c = curveAt(anchorAt(Math.min(f, STOP)));
  return c.u - 3 * c.tz;
};
const Y2022 = firstFrame(yearAt, 2022);
const YearHud: React.FC = () => {
  const frame = useCurrentFrame();
  const year = Math.floor(clamp(yearAt(frame), 1946, 2022));
  const a = ease.outCubic(prog(frame, PYLONS[0].pass - 10, PYLONS[0].pass + 10)) * (1 - prog(frame, Math.min(Y2022, HERE - 30) + 4, Math.min(Y2022, HERE - 30) + 20));
  if (a <= 0) return null;
  return (
    <div style={{ position: "absolute", right: 96, top: 70, textAlign: "right", opacity: a, fontFamily: FONT_MONO }}>
      <div style={{ fontSize: 20, letterSpacing: "0.4em", color: withAlpha(C.gold, 0.85), textShadow: "0 0 10px #000" }}>YEAR</div>
      <div style={{ fontSize: 60, fontWeight: 800, color: "#fff", textShadow: `0 0 20px ${palAt(year)}, 0 2px 8px #000` }}>{year}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Final title.
const EMBERS = Array.from({ length: 420 }, (_, i) => ({
  x: hash(i * 2.13 + 70),
  y: hash(i * 4.71 + 71),
  sp: 0.4 + hash(i * 6.2 + 72) * 1.4,
  r: 1 + Math.pow(hash(i * 8.3 + 73), 3) * 5,
  c: [C.gold, C.cyan, C.magenta, C.amber, "#ffffff"][i % 5],
  tw: hash(i * 9.9 + 74) * 30,
  drift: hash(i * 1.37 + 75) - 0.5,
}));
/** Faint exponential behind the title: drawn left to right, its head shoots off the top. */
const expPt = (t: number, w: number, h: number): [number, number] => {
  const x = lerp(-40, w * 0.97, t);
  const y = h * 0.86 - ((Math.exp(t * 7) - 1) / (Math.exp(7) - 1)) * (h * 0.98);
  return [x, y];
};

const FinalField: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const t = f - FLASH;
      if (t < 0) return;
      ctx.fillStyle = "#020208";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const settle = Math.exp(-t / 40);
      glow(ctx, w / 2, h / 2 - 90, 900 + 500 * settle, C.amber, 0.12 + 0.4 * settle, 0.02);
      glow(ctx, w / 2, h / 2 - 90, 500, C.magenta, 0.08 + 0.3 * settle, 0.02);
      // rays
      ctx.save();
      ctx.translate(w / 2, h / 2 - 90);
      ctx.rotate(t * 0.0015);
      const rayA = 0.1 * Math.exp(-t / 60) + 0.035;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU + hash(i * 3.3) * 0.12;
        const wd = 0.01 + hash(i * 7.1) * 0.025;
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 1300, Math.sin(a) * 1300);
        const col = mix(C.amber, C.magenta, hash(i * 2.9));
        g.addColorStop(0, withAlpha(col, rayA));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 1300, a - wd, a + wd);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // shockwaves
      for (let k = 0; k < 4; k++) {
        const tt = t - 4 - k * 5;
        if (tt < 0) continue;
        const r = 40 + tt * (34 - k * 4) * Math.exp(-tt / 80);
        const a = Math.exp(-tt / (16 + k * 6));
        ctx.strokeStyle = withAlpha([C.gold, C.cyan, C.magenta, "#ffffff"][k], 0.8 * a);
        ctx.lineWidth = 2 + 12 * a;
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2 - 90, r, r * 0.58, 0, 0, TAU);
        ctx.stroke();
      }
      // the curve, echoed
      const draw = ease.inOutCubic(prog(f, FLASH + 14, FLASH + 96));
      if (draw > 0) {
        const n = 120;
        ctx.lineCap = "round";
        for (const [lw, al] of [
          [14, 0.05],
          [5, 0.12],
          [1.8, 0.4],
        ] as const) {
          ctx.lineWidth = lw;
          for (let i = 0; i < n * draw; i++) {
            const [x0, y0] = expPt(i / n, w, h);
            const [x1, y1] = expPt(Math.min(draw, (i + 1) / n), w, h);
            ctx.strokeStyle = withAlpha(palAt(lerp(1990, 2025, i / n)), al);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
        const [hx, hy] = expPt(draw, w, h);
        if (hy > -40) {
          glow(ctx, hx, hy, 60, C.gold, 0.6);
          glow(ctx, hx, hy, 14, "#ffffff", 0.9);
        }
      }
      for (const e of EMBERS) {
        const y = ((((e.y * (h + 100) - t * e.sp * 0.9) % (h + 100)) + h + 100) % (h + 100)) - 50;
        const x = e.x * w + Math.sin(t * 0.01 + e.tw) * 30 * e.drift;
        const burst = Math.exp(-t / 18);
        const bx = w / 2 + (x - w / 2) * (1 - 0.4 * burst);
        const by = h / 2 + (y - h / 2) * (1 - 0.4 * burst);
        const a = (0.25 + 0.4 * Math.sin(t * 0.07 + e.tw) ** 2) * clamp(t / 12);
        glow(ctx, bx, by, e.r * 2.2, e.c, a);
      }
      // anamorphic streak left by the flash
      const sa = Math.exp(-t / 22);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, withAlpha(C.cyan, 0));
      g.addColorStop(0.5, withAlpha("#ffffff", 0.7 * sa));
      g.addColorStop(1, withAlpha(C.cyan, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, h / 2 - 90 - 2 - 8 * sa, w, 4 + 16 * sa);
      ctx.globalCompositeOperation = "source-over";
    }}
  />
);

const FinalTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - FLASH;
  if (t < 0) return null;
  const e = ease.outExpo(clamp(t / 30));
  const sc = 1.25 - 0.25 * e + 0.04 * prog(frame, FLASH, END);
  const ab = 30 * Math.exp(-t / 10);
  const sub = ease.outCubic(prog(frame, FLASH + 40, FLASH + 72));
  const lineT = ease.inOutCubic(prog(frame, FLASH + 26, FLASH + 70));
  const sweep = prog(frame, FLASH + 80, FLASH + 120);
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: FONT_CN,
    fontWeight: 900,
    fontSize: 168,
    letterSpacing: "0.06em",
  };
  const words = (
    <>
      从真空管到<span style={{ fontFamily: FONT_MONO, letterSpacing: 0 }}>AI</span>
    </>
  );
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(-100px) scale(${sc})` }}>
        <div style={{ ...base, color: C.red, transform: `translateX(${-ab}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{words}</div>
        <div style={{ ...base, color: C.cyan, transform: `translateX(${ab}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{words}</div>
        <div style={{ ...base, color: "#fff", textShadow: `0 0 30px ${C.amber}, 0 0 80px rgba(255,120,40,0.6)` }}>
          从真空管到
          <span
            style={{
              fontFamily: FONT_MONO,
              letterSpacing: 0,
              background: `linear-gradient(100deg, ${C.gold}, ${C.magenta} 50%, ${C.cyan})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: `drop-shadow(0 0 22px ${C.magenta})`,
            }}
          >
            AI
          </span>
        </div>
        {sweep > 0 && sweep < 1 ? (
          <div
            style={{
              ...base,
              color: "transparent",
              background: `linear-gradient(105deg, transparent ${sweep * 140 - 30}%, rgba(255,255,255,0.85) ${sweep * 140 - 20}%, transparent ${sweep * 140 - 10}%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              mixBlendMode: "screen",
            }}
          >
            {words}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 580,
          height: 2,
          width: 900 * lineT,
          transform: "translateX(-50%)",
          background: `linear-gradient(90deg, transparent, ${C.amber} 15%, ${C.cyan} 45%, ${C.violet} 70%, ${C.magenta} 85%, transparent)`,
          boxShadow: `0 0 12px ${C.cyan}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 616,
          textAlign: "center",
          fontFamily: FONT_CN,
          fontWeight: 700,
          fontSize: 60,
          letterSpacing: `${0.32 - 0.2 * sub}em`,
          color: "#fff",
          opacity: sub,
          filter: sub < 1 ? `blur(${(1 - sub) * 8}px)` : undefined,
          textShadow: "0 0 18px rgba(56,214,255,0.7), 0 2px 8px #000",
        }}
      >
        下一次<span style={{ color: C.gold, fontWeight: 900, textShadow: `0 0 24px ${C.gold}, 0 2px 8px #000` }}>翻倍</span>，会带来什么？
      </div>
    </AbsoluteFill>
  );
};

/** The biggest flash of the film: a short ramp, an 8-frame whiteout, then a long decay. */
const WhiteOut: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - FLASH;
  let a = 0;
  if (t < 0) a = 0.85 * ease.inCubic(clamp((t + 4) / 4));
  else if (t < 8) a = 1;
  else a = Math.exp(-(t - 8) / 11);
  if (a <= 0.003) return null;
  return <AbsoluteFill style={{ background: "#fff", opacity: a }} />;
};

export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = prog(frame, 0, 14);
  const dim = 0.55 * (1 - ease.inOutQuad(prog(frame, 55, 95)));
  const sh = shake(frame, FLASH, 38, 34);
  const shC = shake(frame, CLIMB, 14, 22);
  const pre = frame >= WAVE_HIT - 10 && frame < FLASH ? (noise1(frame * 1.3) - 0.5) * 16 * prog(frame, WAVE_HIT - 10, FLASH) : 0;
  const endFade = ease.inOutQuad(prog(frame, END - 38, END - 4));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {frame < FLASH ? (
        <AbsoluteFill style={{ opacity: inA, transform: `translate(${pre + shC.x}px, ${pre * 0.6 + shC.y}px)` }}>
          <World />
          <AbsoluteFill style={{ background: "#000", opacity: dim }} />
          <HereTag />
          <YearHud />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}rad)` }}>
          <FinalField />
          <FinalTitle />
        </AbsoluteFill>
      )}
      <Flash at={CLIMB} dur={16} color={C.cyan} peak={0.28} />
      <ChapterCard index={8} title="指数的真相" en="THE EXPONENTIAL TRUTH" color={C.gold} dur={85} />
      <Captions accent={C.gold} items={CAPS} />
      <WhiteOut />
      <AbsoluteFill style={{ background: "#000", opacity: endFade }} />
    </AbsoluteFill>
  );
};
