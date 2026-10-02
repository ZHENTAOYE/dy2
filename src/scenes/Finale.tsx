import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, sumShake, TAU } from "../lib/math";
import type { Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import {
  camOf,
  camSpeed,
  CLIMB,
  climbK,
  CREST,
  curveAt,
  DOUBLE_T,
  DOUBLINGS,
  END,
  FIRE_AHEAD,
  FLASH,
  frameAtS,
  GATE_R,
  H0,
  H_HERE,
  HERE,
  heroK,
  IGNITE,
  MARK,
  MILESTONES,
  poseAt,
  PYL_TOP,
  PYLON_T,
  PYLON_X,
  revealK,
  ribR,
  RING_T,
  rushAt,
  S_END,
  S_HERE,
  SMP,
  T_DOUBLE as T_DBL,
  sOfU,
  U_HERE,
  WAVE,
  yearAt,
  ysqAt,
  Z_HERE,
  zOf,
  type V3,
} from "./finale/world";

// =============================================================================================
// Colour along the curve: dim amber past -> cyan -> magenta -> white-hot present.
const colAt = (u: number) =>
  u < 1996
    ? C.amber
    : u < 2006
      ? mix(C.amber, C.cyan, (u - 1996) / 10)
      : u < 2014.5
        ? C.cyan
        : u < 2019
          ? mix(C.cyan, C.magenta, (u - 2014.5) / 4.5)
          : u < 2023.5
            ? mix(C.magenta, "#fff4fb", ((u - 2019) / 4.5) * 0.92)
            : mix("#ffe8f6", "#fff1d6", clamp((u - 2023.5) / 4));
const LUT0 = 1940;
const LUT1 = 2032;
const LUT = Array.from({ length: 185 }, (_, i) => colAt(lerp(LUT0, LUT1, i / 184)));
const palAt = (u: number) => LUT[Math.round(clamp((u - LUT0) / (LUT1 - LUT0)) * 184)];
const S_COL = SMP.map((c) => colAt(c.u));
/** Body/halo colour: the white-hot present keeps a pink glow around its core. */
const S_BODY = SMP.map((c) => (c.u > 2019 ? mix(colAt(c.u), "#ff6fd6", 0.55 * clamp((c.u - 2019) / 3)) : colAt(c.u)));
const S_HOT = SMP.map((c) => mix(colAt(c.u), "#ffffff", lerp(0.32, 0.72, clamp((c.u - 1995) / 18))));
/** Intensity: the flat past is dim, the steep present blazes. */
const S_INT = SMP.map((c) => lerp(0.34, 1, ease.inOutQuad(clamp((c.u - 1995) / 21))));
const S_R = SMP.map((c) => ribR(c.h));
const I_WALL = SMP.findIndex((c) => c.u >= 2001);
const I_TOP = SMP.findIndex((c) => c.h >= H_HERE * 2.4);
const iOfS = (s: number) => {
  let lo = 0;
  let hi = SMP.length - 1;
  if (s <= 0) return 0;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (SMP[m].s <= s) lo = m;
    else hi = m;
  }
  return lo;
};
/** Past the marker the curve dissolves into the unknown. */
const beyondA = (h: number, len: number) => (h <= H_HERE ? 1 : Math.exp(-(h - H_HERE) / len));

// =============================================================================================
// Timing.
const IGN_LEN = 112; // the ignition front races from 1946 to the top of the curve, accelerating
const litS = (f: number) => (f < IGNITE ? -1e9 : 1.5 + S_END * ease.inCubic(prog(f, IGNITE, IGNITE + IGN_LEN)));
/** The last doubling wave races up the whole curve and hits the marker at WAVE_HIT; the flash follows. */
const WAVE_HIT = FLASH - 9;
const waveS = (f: number) => (f < WAVE ? -1e9 : lerp(-6, S_HERE, ease.inCubic(prog(f, WAVE, WAVE_HIT))) + Math.max(0, f - WAVE_HIT) * 6);
const frameWave = (s: number) => WAVE + (WAVE_HIT - WAVE) * Math.cbrt(clamp((s + 6) / (S_HERE + 6)));
/** Everything but the hot point is gone before the white build (labels, tag). */
const LBL_OUT = WAVE_HIT - 12;
/** The final title's clock starts when the whiteout lets go. */
const T0 = FLASH + 5;

const CAPS = [
  { from: 90, to: 200, text: "所以，计算机并不是“突然”变强的。" },
  { from: 205, to: 320, text: "它是在80年里，一次又一次地翻倍。" },
  { from: 330, to: 480, text: "指数曲线的前半段平淡得让人忽略，后半段陡峭得让人震撼" },
  { from: 490, to: 605, text: "而我们，正站在这条曲线{{最陡峭的地方}}。" },
];
/** 0..1 while a caption is on screen: the world sinks into black under the caption band. */
const capA = (f: number) => Math.max(0, ...CAPS.map((c) => Math.min(clamp((f - c.from + 10) / 12), clamp((c.to + 10 - f) / 12))));

// =============================================================================================
// Projection with near-plane clipping (world heights scaled by `q` during the pull-back).
type View = { cam: Cam; cyw: number; syw: number; cp: number; sp: number; q: number };
type Pt = { x: number; y: number; s: number; z: number };
const NEAR = 0.25;
const mkView = (cam: Cam, q: number): View => ({ cam, cyw: Math.cos(cam.yaw), syw: Math.sin(cam.yaw), cp: Math.cos(cam.pitch), sp: Math.sin(cam.pitch), q });
const toCam = (v: View, X: number, Y: number, Z: number): V3 => {
  const x = X - v.cam.x;
  const y = Y * v.q - v.cam.y;
  const z = Z - v.cam.z;
  const x1 = x * v.cyw - z * v.syw;
  const z1 = x * v.syw + z * v.cyw;
  return [x1, y * v.cp - z1 * v.sp, y * v.sp + z1 * v.cp];
};
const scr = (v: View, c: V3): Pt => {
  const s = v.cam.f / c[2];
  return { x: v.cam.cx + c[0] * s, y: v.cam.cy + c[1] * s, s, z: c[2] };
};
const proj = (v: View, X: number, Y: number, Z: number, near = NEAR): Pt | null => {
  const c = toCam(v, X, Y, Z);
  return c[2] > near ? scr(v, c) : null;
};
const cut = (a: V3, b: V3, near = NEAR): V3 => {
  const t = (near - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near + 1e-4];
};
const runs = (v: View, cs: V3[], near = NEAR): Pt[][] => {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c[2] > near) {
      if (!cur.length && i > 0) cur.push(scr(v, cut(cs[i - 1], c, near)));
      cur.push(scr(v, c));
    } else if (cur.length) {
      cur.push(scr(v, cut(cs[i - 1], c, near)));
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
};
const pathRuns = (ctx: CanvasRenderingContext2D, rs: Pt[][]) => {
  ctx.beginPath();
  for (const r of rs) r.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
};
const fillPoly = (ctx: CanvasRenderingContext2D, v: View, cs: V3[], style: string | CanvasGradient) => {
  const c: V3[] = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    if (a[2] > NEAR) c.push(a);
    if (a[2] > NEAR !== b[2] > NEAR) c.push(cut(a, b));
  }
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
/** Glowing polyline: a wide soft pass and a thin hot core. */
const glowRuns = (ctx: CanvasRenderingContext2D, rs: Pt[][], col: string, core: number, a: number, wide = 5) => {
  if (!rs.length || a <= 0.004) return;
  pathRuns(ctx, rs);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(col, 0.16 * a);
  ctx.lineWidth = core * wide;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.6), Math.min(1, a));
  ctx.lineWidth = core;
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
};

// =============================================================================================
// Sprites.
const softCache = new Map<string, HTMLCanvasElement>();
/** Soft disc without a white core (flattened ground light pools). */
const soft = (col: string) => {
  const hit = softCache.get(col);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, withAlpha(col, 0.9));
  grad.addColorStop(0.3, withAlpha(col, 0.4));
  grad.addColorStop(1, withAlpha(col, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softCache.set(col, c);
  return c;
};

// =============================================================================================
// Scenery.
const PYLONS = PYLON_X.map((x, m) => {
  const ms = MILESTONES[m];
  const pass = PYLON_T[m];
  // each pylon erupts out of the ground ~1.5 s before it whips past
  return { ...ms, x, z: zOf(ms.year), rise: Math.max(IGNITE + 2 + 6 * m, pass - 44), pass };
});
const GATES = [5, 6].map((m, k) => {
  const ms = MILESTONES[m];
  const s = sOfU(ms.year);
  return { ...ms, s, c: curveAt(s), pass: RING_T[k], R: GATE_R[k] };
});
/** Doubling markers: arches over the road, rungs across the wall. */
const HOOPS = DOUBLINGS.filter((d) => d.u < U_HERE - 1).map((d, k) => ({
  ...d,
  c: curveAt(d.s),
  wall: d.u > 2008,
  fire: k < DOUBLE_T.length ? DOUBLE_T[k] : Math.round(frameAtS(d.s - (d.u > 2008 ? 4 : FIRE_AHEAD))),
}));
const ARCH_R = 1.45;
const MOTES = Array.from({ length: 460 }, (_, i) => ({
  x: (hash(i * 5.31 + 2) - 0.5) * 34,
  y: -(0.12 + Math.pow(hash(i * 7.77 + 3), 1.7) * 7),
  z: -34 + hash(i * 3.17 + 1) * 168,
  r: hash(i * 1.9 + 5),
  tw: hash(i * 2.7 + 6) * 50,
}));
const S_SP0 = sOfU(2003);
const SP_SPAN = S_HERE + 110 - S_SP0;
const SPARKS = Array.from({ length: 1800 }, (_, i) => ({
  s0: hash(i * 3.71 + 11) * SP_SPAN,
  v: 0.12 + 0.5 * hash(i * 9.41 + 16),
  x: (hash(i * 5.13 + 12) - 0.5) * 32,
  n: -1.5 + Math.pow(hash(i * 7.29 + 13), 1.25) * 17,
  r: hash(i * 1.3 + 14),
  tw: hash(i * 2.1 + 15) * 50,
}));
const STARS = Array.from({ length: 640 }, (_, i) => {
  const az = hash(i * 4.1 + 11) * TAU;
  const el = Math.asin(0.02 + 0.98 * hash(i * 6.3 + 12));
  return { d: [Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)] as V3, b: Math.pow(hash(i * 8.9 + 13), 3), tw: hash(i * 3.3 + 14) * 40 };
});
const STRANDS = Array.from({ length: 26 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const k = (i >> 1) + 1;
  return { x: side * (k * 0.92 + (hash(i * 3.3 + 90) - 0.5) * 0.3), a: 0.35 + 0.65 * hash(i * 5.1 + 91), ph: hash(i * 7.7 + 92), v: 0.8 + hash(i * 2.3 + 93) * 1.4 };
});
/** Light pools scattered over the plain: the past, lit up as the ignition front passes. */
const POOLS = Array.from({ length: 420 }, (_, i) => {
  const side = hash(i * 6.1 + 300) < 0.5 ? -1 : 1;
  const x = side * (3.2 + Math.pow(hash(i * 2.9 + 301), 1.4) * 60);
  const z = -30 + hash(i * 4.3 + 302) * 200;
  const u = 1946 + z / 2;
  return { x, z, u, r: 0.35 + Math.pow(hash(i * 8.1 + 303), 3) * 1.6, tw: hash(i * 5.5 + 304) * 40, k: hash(i * 3.7 + 305) };
});
/** Distant mountains ringing the plain (they sink below the horizon as the camera climbs). */
const RIDGE_C: V3 = [0, 0, 90];
const RIDGE = Array.from({ length: 181 }, (_, i) => {
  const a = (i / 180) * TAU;
  const R = 760 + 120 * noise1(i * 0.21 + 40);
  const hh = 14 + 46 * Math.pow(noise1(i * 0.37 + 9), 1.6) + 18 * noise1(i * 1.3 + 2);
  return { x: RIDGE_C[0] + Math.sin(a) * R, z: RIDGE_C[2] + Math.cos(a) * R, h: hh };
});
const SHEET = 12.5;
const RUNG_STEP = 3.4;
/** Spark burst when the marker lands (3D, with drag). */
const BURST = Array.from({ length: 360 }, (_, i) => {
  const th = hash(i * 3.9 + 500) * TAU;
  const ph = Math.acos(2 * hash(i * 6.7 + 501) - 1);
  const sp = 0.6 + Math.pow(hash(i * 2.1 + 502), 2) * 2.6;
  return {
    d: [Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp] as V3,
    life: 18 + hash(i * 4.4 + 503) * 40,
    col: [C.gold, "#ffffff", C.magenta, C.amber, C.cyan][i % 5],
  };
});

// Sky grade by altitude.
const HOR: [number, string][] = [
  [0, "#2e1807"],
  [0.06, "#1b1631"],
  [0.3, "#0e1d46"],
  [0.65, "#1d0a3a"],
  [1, "#1a0826"],
];
const ZEN: [number, string][] = [
  [0, "#020208"],
  [0.5, "#080518"],
  [1, "#090312"],
];
const grad = (stops: [number, string][], g: number) => {
  for (let i = 1; i < stops.length; i++) if (g <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (g - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
};

type Lbl = { x: number; y: number; size: number; year: string; text: string; col: string; a: number; align: CanvasTextAlign; fixed?: boolean };

// Reveal labels: screen offsets from each milestone node (1946 to the left, 1947 to the right).
const REV_LBL: { dx: number; dy: number; align: CanvasTextAlign }[] = [
  { dx: -16, dy: -58, align: "right" },
  { dx: 18, dy: -58, align: "left" },
  { dx: 0, dy: -58, align: "center" },
  { dx: 0, dy: -58, align: "center" },
  { dx: -34, dy: -64, align: "right" },
  { dx: 40, dy: 34, align: "left" },
  { dx: 40, dy: 34, align: "left" },
];
/** Region of the YEAR readout (labels there are culled). */
const HUD_BOX = [1510, 80, 1810, 250];

// =============================================================================================
const drawWorld = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  const pose = poseAt(f);
  const cam = camOf(pose);
  const q = ysqAt(f);
  const v = mkView(cam, q);
  const rush = rushAt(f);
  const kc = climbK(f);
  const rk = revealK(f);
  const kh = heroK(f) * (1 - rk);
  const bLen = lerp(22, 85, rk);
  const bA = (hh: number) => beyondA(hh, bLen);
  const prevF = f - 1.2 - 1.6 * rush;
  const prev = mkView(camOf(poseAt(prevF)), ysqAt(prevF));
  const grade = clamp(-cam.y / (H_HERE * q));
  const lit = litS(f);
  const wS = waveS(f);
  const labels: Lbl[] = [];
  const preA = prog(f, WAVE_HIT - 2, FLASH); // the hot point builds into the flash
  const lblOut = 1 - prog(f, LBL_OUT - 8, LBL_OUT);
  const tHit = f - HERE; // the marker lands
  const impact = tHit >= 0 ? Math.exp(-tHit / 14) : 0;
  const dist = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y * q - cam.y, z - cam.z);
  // fog: near things crisp, the far wall hazy (but always present); none in the wide shots
  const fog = (d: number) => lerp(Math.exp(-Math.max(0, d - 26) / 170), 1, Math.max(rk, kh));
  /** Near geometry fades before it turns into big flat panels. */
  const nearK = (d: number) => clamp((d - 3) / 8);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(pose.roll);
  ctx.translate(-w / 2, -h / 2);

  // --- sky ------------------------------------------------------------------------------------
  const horizon = cam.cy - cam.f * Math.tan(cam.pitch);
  const sg = Math.max(grade, 0.42 * rk);
  const hor = grad(HOR, sg);
  const zen = grad(ZEN, sg);
  {
    const top = horizon - cam.f * 2.6;
    const g = ctx.createLinearGradient(0, top, 0, horizon);
    g.addColorStop(0, zen);
    g.addColorStop(0.62, mix(zen, hor, 0.35));
    g.addColorStop(1, hor);
    ctx.fillStyle = g;
    ctx.fillRect(-400, -400, w + 800, h + 800);
  }
  // ground plane
  if (horizon < h + 400) {
    const g = ctx.createLinearGradient(0, horizon, 0, horizon + 460);
    g.addColorStop(0, mix("#030308", hor, 0.55));
    g.addColorStop(0.18, mix("#020205", hor, 0.18));
    g.addColorStop(1, "#010103");
    ctx.fillStyle = g;
    ctx.fillRect(-400, Math.max(-400, horizon), w + 800, Math.max(0, h + 400 - Math.max(-400, horizon)));
  }
  // stars
  const starA = 1 - 0.55 * grade;
  for (const st of STARS) {
    const c = toCam(v, cam.x + st.d[0], cam.y / q + st.d[1] / q, cam.z + st.d[2]);
    if (c[2] <= 0.05) continue;
    const p = scr(v, c);
    if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > Math.min(h + 60, horizon - 4)) continue;
    const tw = 0.6 + 0.4 * Math.sin(f * 0.08 + st.tw);
    const a = (0.2 + 0.8 * st.b) * tw * clamp(-st.d[1] * 8) * starA;
    const r = 0.9 + st.b * 1.8;
    ctx.fillStyle = `rgba(225,232,255,${(a * 0.85).toFixed(3)})`;
    ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
  }

  ctx.globalCompositeOperation = "lighter";
  // horizon haze
  if (horizon > -300 && horizon < h + 300) {
    const hz = ctx.createLinearGradient(0, horizon - 260, 0, horizon + 70);
    const hc = mix(sg < 0.1 ? C.amber : hor, hor, clamp(sg * 6));
    hz.addColorStop(0, withAlpha(hc, 0));
    hz.addColorStop(0.78, withAlpha(hc, 0.16 + 0.08 * (1 - sg)));
    hz.addColorStop(1, withAlpha(hc, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(-400, horizon - 260, w + 800, 330);
  }
  // distant mountains: dark silhouettes against the haze, rim-lit
  ctx.globalCompositeOperation = "source-over";
  {
    const top: (Pt | null)[] = RIDGE.map((r) => proj(v, r.x, -r.h, r.z, 1));
    const bot: (Pt | null)[] = RIDGE.map((r) => proj(v, r.x, 0, r.z, 1));
    const fill = mix("#020206", hor, 0.22);
    ctx.fillStyle = fill;
    ctx.strokeStyle = withAlpha(mix(hor, "#ffffff", 0.25), 0.35);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < RIDGE.length - 1; i++) {
      const a = top[i];
      const b = top[i + 1];
      const c = bot[i + 1];
      const d = bot[i];
      if (!a || !b || !c || !d) continue;
      if (Math.max(a.x, b.x) < -50 || Math.min(a.x, b.x) > w + 50 || Math.abs(a.x - b.x) > w) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y + 1);
      ctx.lineTo(d.x, d.y + 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "lighter";
  // the light of the future, high above the top of the curve
  {
    const p = proj(v, 0, -H_HERE * 2.3, Z_HERE + 8, 0.5);
    const a = 0.18 + 0.45 * ease.inQuad(grade) * (1 - 0.35 * rk) + 0.25 * rk;
    if (p) {
      glow(ctx, p.x, p.y, 1300 + 700 * grade, C.magenta, 0.2 * a, 0.02);
      glow(ctx, p.x, p.y, 640 + 420 * grade, "#ffe6f6", 0.28 * a, 0.03);
    }
  }
  // high up, light pours down from where the curve is heading
  {
    const la = ease.inQuad(clamp((grade - 0.5) / 0.5)) * (1 - rk) * (1 - 0.6 * kh);
    if (la > 0.01) {
      const p = proj(v, 0, -H_HERE - 90, Z_HERE + 2, 0.5);
      const gx = p ? clamp(p.x, -200, w + 200) : w / 2;
      const gy = p ? clamp(p.y, -320, h) : -320;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 1300);
      g.addColorStop(0, withAlpha("#fff0fa", 0.32 * la));
      g.addColorStop(0.28, withAlpha("#ff9ae0", 0.14 * la));
      g.addColorStop(0.62, withAlpha(C.magenta, 0.06 * la));
      g.addColorStop(1, withAlpha(C.magenta, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-400, -400, w + 800, h + 800);
    }
  }

  // --- ground grid --------------------------------------------------------------------------------
  const gridPass = (step: number, ext: number, ahead: number, near: number, far: number, base: number, col: string, behind = 0.3) => {
    if (base <= 0.005) return;
    const buckets: Pt[][][] = [[], [], [], [], [], []];
    const x0 = Math.floor((cam.x - ext) / step) * step;
    const z0 = Math.floor((cam.z - ext * behind) / step) * step;
    const z1 = cam.z + ahead;
    const add = (ax: number, az: number, bx: number, bz: number) => {
      const d = Math.hypot((ax + bx) / 2 - cam.x, (az + bz) / 2 - cam.z, cam.y);
      const a = clamp(1 - (d - near) / (far - near));
      if (a <= 0.02) return;
      const rs = runs(v, [toCam(v, ax, 0, az), toCam(v, bx, 0, bz)]);
      if (rs.length) buckets[Math.min(5, Math.floor(a * 6))].push(...rs);
    };
    const seg = step * 3;
    for (let x = x0; x <= cam.x + ext; x += step) for (let z = z0; z < z1; z += seg) add(x, z, x, z + seg);
    for (let z = z0; z <= z1; z += step) for (let x = x0; x < cam.x + ext; x += seg) add(x, z, x + seg, z);
    ctx.lineWidth = 1.3;
    buckets.forEach((b, i) => {
      if (!b.length) return;
      ctx.strokeStyle = withAlpha(col, base * ((i + 0.5) / 6));
      pathRuns(ctx, b);
      ctx.stroke();
    });
  };
  if (horizon < h + 200) {
    const gcol = mix("#4a6bff", hor, 0.25);
    gridPass(2, 48, 120, 4, 70, 0.3 * (1 - kc) * (1 - rk), gcol);
    gridPass(10, 260, 300, 30, 360, 0.36 * clamp(kh * 1.5) * (1 - rk) + 0.2 * rk, gcol, 1);
    gridPass(20, 520, 640, 30, 600, 0.2 * clamp(grade * 3 + rk + 0.4), gcol);
  }

  // --- light pools on the plain ------------------------------------------------------------------------
  {
    const pa = (1 - 0.5 * rk) * (0.7 + 1.3 * kh);
    for (const pl of POOLS) {
      const ls = sOfU(pl.u);
      if (ls > lit) continue;
      const p = proj(v, pl.x, 0, pl.z, 0.6);
      if (!p || p.x < -120 || p.x > w + 120 || p.y < -120 || p.y > h + 60) continue;
      const d = p.z;
      const r = pl.r * p.s;
      if (r < 0.6) continue;
      const tw = 0.65 + 0.35 * Math.sin(f * 0.06 + pl.tw);
      const on = clamp((lit - ls) / 8);
      const squash = clamp(Math.abs(cam.y) / Math.max(1, d) + 0.05);
      const col = palAt(Math.min(pl.u, 2014));
      const a = (0.16 + 0.3 * pl.k) * tw * on * fog(d) * pa * lerp(0.6, 1, clamp((pl.u - 1990) / 30));
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(soft(col), p.x - r, p.y - r * squash, r * 2, r * 2 * squash);
      if (r > 1.2) {
        const cr = clamp(r * 0.12, 0.8, 2.2);
        ctx.globalAlpha = Math.min(1, a * 1.6);
        ctx.fillStyle = mix(col, "#ffffff", 0.5);
        ctx.fillRect(p.x - cr, p.y - cr * 0.6, cr * 2, cr * 1.2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- the ribbon's light pools on the ground ----------------------------------------------------
  const sLit = Math.min(lit, S_END);
  for (let i = 0; i < SMP.length; i += 6) {
    const c = SMP[i];
    if (c.s > sLit || c.h > 4) break;
    const p = proj(v, 0, 0, c.z, 0.6);
    if (!p || p.x < -400 || p.x > w + 400) continue;
    const d = dist(0, 0, c.z);
    const r = 3 * p.s;
    if (r < 3) continue;
    const squash = clamp(Math.abs(cam.y) / d + 0.06);
    ctx.globalAlpha = 0.22 * S_INT[i] * fog(d) * (1 - 0.6 * rk);
    ctx.drawImage(soft(S_COL[i]), p.x - r, p.y - r * squash, r * 2, r * 2 * squash);
  }
  ctx.globalAlpha = 1;

  // --- tube renderer (used for the ribbon and its mirror image) ------------------------------------------
  type TP = { x: number; y: number; s: number; d: number; i: number };
  const tubePts = (mirror: boolean, sEnd: number, near: number) => {
    const out: (TP | null)[] = [];
    for (let i = 0; i < SMP.length; i++) {
      const c = SMP[i];
      if (c.s > sEnd) break;
      const cc = toCam(v, 0, mirror ? c.h : -c.h, c.z);
      if (cc[2] <= near) {
        out.push(null);
        continue;
      }
      const sc = v.cam.f / cc[2];
      out.push({ x: v.cam.cx + cc[0] * sc, y: v.cam.cy + cc[1] * sc, s: sc, d: cc[2], i });
    }
    return out;
  };
  const wide = Math.max(rk, 0.6 * kh);
  const LAYERS = [
    { m: 5.2, a: 0.03, lo: 7 + 33 * wide, hi: 230, hot: false },
    { m: 3.1, a: 0.045, lo: 5 + 25 * wide, hi: 160, hot: false },
    { m: 1.75, a: 0.09, lo: 3 + 17 * wide, hi: 104, hot: false },
    { m: 1.0, a: 0.3, lo: 1.8 + 8.2 * wide, hi: lerp(40, 70, wide), hot: false },
    { m: 0.36, a: 0.95, lo: 0.9 + 3.1 * wide, hi: lerp(11, 24, wide), hot: true },
  ];
  const drawTube = (g: CanvasRenderingContext2D, pts: (TP | null)[], alphaOf: (i: number, d: number) => number, colOf: (i: number, hot: boolean) => string, layerIdx: number[], mul: number) => {
    let a0 = 0;
    while (a0 < pts.length) {
      while (a0 < pts.length && !pts[a0]) a0++;
      let a1 = a0;
      while (a1 < pts.length && pts[a1]) a1++;
      const run = pts.slice(a0, a1) as TP[];
      a0 = a1;
      const n = run.length;
      if (n < 2) continue;
      const nx = new Float32Array(n);
      const ny = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const pa = run[Math.max(0, j - 1)];
        const pb = run[Math.min(n - 1, j + 1)];
        const tx = pb.x - pa.x;
        const ty = pb.y - pa.y;
        const l = Math.hypot(tx, ty) || 1;
        nx[j] = -ty / l;
        ny[j] = tx / l;
      }
      const K = 5;
      for (let j0 = 0; j0 < n - 1; j0 += K) {
        const j1 = Math.min(n - 1, j0 + K);
        const mid = run[(j0 + j1) >> 1];
        const al = alphaOf(mid.i, mid.d) * mul;
        if (al < 0.004) continue;
        let minX = 1e9;
        let maxX = -1e9;
        let minY = 1e9;
        let maxY = -1e9;
        for (let j = j0; j <= j1; j++) {
          minX = Math.min(minX, run[j].x);
          maxX = Math.max(maxX, run[j].x);
          minY = Math.min(minY, run[j].y);
          maxY = Math.max(maxY, run[j].y);
        }
        if (maxX < -340 || minX > w + 340 || maxY < -340 || minY > h + 340) continue;
        for (const li of layerIdx) {
          const L = LAYERS[li];
          g.beginPath();
          for (let j = j0; j <= j1; j++) {
            const p = run[j];
            const r = clamp(S_R[p.i] * L.m * p.s, L.lo, L.hi);
            if (j === j0) g.moveTo(p.x + nx[j] * r, p.y + ny[j] * r);
            else g.lineTo(p.x + nx[j] * r, p.y + ny[j] * r);
          }
          for (let j = j1; j >= j0; j--) {
            const p = run[j];
            const r = clamp(S_R[p.i] * L.m * p.s, L.lo, L.hi);
            g.lineTo(p.x - nx[j] * r, p.y - ny[j] * r);
          }
          g.closePath();
          g.fillStyle = withAlpha(colOf(mid.i, L.hot), Math.min(1, L.a * al));
          g.fill();
        }
      }
    }
  };
  const waveBoost = (s: number) => (wS > s ? 1 + 2.4 * Math.exp(-(wS - s) / 34) : 1);
  const tubeAlpha = (i: number, d: number) => {
    const c = SMP[i];
    const front = clamp((sLit - c.s) / 4 + 0.15);
    // past the marker the curve breaks into dashes that drift upward and fade into the unknown
    const beyond = c.u > U_HERE ? bA(c.h) * lerp(0.12, 1, ease.inOutQuad(0.5 + 0.5 * Math.sin(c.s * 0.75 - f * 0.22))) : 1;
    const flat = c.u < 2000 ? lerp(1, 1.6, Math.max(rk, kh)) : 1; // the far past stays visible in the wide shots
    return S_INT[i] * fog(d) * beyond * front * waveBoost(c.s) * flat * (1 + 0.6 * preA) * (1 + 0.3 * impact * (c.u > 2016 ? 1 : 0));
  };
  const tubeCol = (i: number, hot: boolean) => {
    const c = SMP[i];
    if (wS > c.s && wS - c.s < 26) return "#ffffff";
    return hot ? S_HOT[i] : S_BODY[i];
  };
  // soft glow buffer (quarter res, blurred on the way back): outer halos and the mirror image
  const hb = haloBuffers();
  const hg = hb.a.getContext("2d")!;
  hg.setTransform(1, 0, 0, 1, 0, 0);
  hg.globalCompositeOperation = "source-over";
  hg.clearRect(0, 0, HB_W, HB_H);
  hg.setTransform(HB_W / w, 0, 0, HB_H / h, 0, 0);
  hg.translate(w / 2, h / 2);
  hg.rotate(pose.roll);
  hg.translate(-w / 2, -h / 2);
  hg.globalCompositeOperation = "lighter";
  if (lit > 0) {
    // mirror image in the glossy ground (strong in the wide reveal)
    const mk = (1 - kh) * (1 - rk) + 1.6 * rk;
    drawTube(hg, tubePts(true, Math.min(sLit, rk > 0 ? S_HERE : sOfU(2008)), 1.2), (i, d) => tubeAlpha(i, d) * 0.4 * mk * Math.exp(-SMP[i].h / lerp(2.5, 60, rk)), tubeCol, [1, 2, 3], 1);
  }

  // --- reveal: the doubling ladder (each rung twice the height of the one below) and drifting dust ------------
  if (rk > 0.05) {
    const la = ease.inOutQuad(prog(rk, 0.4, 1)) * lblOut;
    for (let k = 1; k <= 4; k++) {
      const hh = H_HERE / 2 ** k;
      const s = sOfU(U_HERE - k * T_DBL);
      const c = curveAt(s);
      const a = proj(v, 0, -hh, -8, 0.5);
      const b = proj(v, 0, -hh, c.z, 0.5);
      if (!a || !b) continue;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      const col = palAt(c.u);
      g.addColorStop(0, withAlpha(col, 0));
      g.addColorStop(0.75, withAlpha(col, 0.1 * la));
      g.addColorStop(1, withAlpha(mix(col, "#ffffff", 0.4), 0.42 * la));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 9]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      glow(ctx, b.x, b.y, 18, col, 0.8 * la);
    }
    for (let i = 0; i < 240; i++) {
      const x = ((hash(i * 2.7 + 700) * (w + 200) + f * (0.3 + hash(i * 4.9 + 701) * 0.9)) % (w + 200)) - 100;
      const y = ((((hash(i * 6.1 + 702) * (h + 100) - f * (0.2 + hash(i * 8.3 + 703) * 0.6)) % (h + 100)) + h + 100) % (h + 100)) - 50;
      const tw = 0.5 + 0.5 * Math.sin(f * 0.07 + i);
      glow(ctx, x, y, 2 + 4 * hash(i * 9.7 + 704), CHAPTER_COLS[i % 7], 0.35 * tw * rk);
    }
  }

  // --- the area under the curve: a curtain of light falling to the ground --------------------------------
  if (lit > 0) {
    const K = 6;
    const cur = 0.16 * (1 + 2.6 * rk + 1.2 * kh);
    for (let i0 = 0; i0 < SMP.length - 1; i0 += K) {
      const i1 = Math.min(SMP.length - 1, i0 + K);
      const cm = SMP[(i0 + i1) >> 1];
      if (cm.s > sLit) break;
      if (cm.h > H_HERE * (rk > 0.01 ? 1 : 2.4)) break;
      const d = dist(0, -cm.h, cm.z);
      const a = cur * S_INT[i0] * fog(d) * bA(cm.h) * clamp((sLit - cm.s) / 6) * waveBoost(cm.s) * nearK(d) * (cm.u < 2000 ? 1 + rk : 1);
      if (a < 0.006) continue;
      const top: V3[] = [];
      const bot: V3[] = [];
      for (let i = i0; i <= i1; i++) {
        top.push(toCam(v, 0, -SMP[i].h, SMP[i].z));
        bot.push(toCam(v, 0, 0, SMP[i].z));
      }
      const pt = proj(v, 0, -cm.h, cm.z, 0.6);
      const pb = proj(v, 0, 0, cm.z, 0.6);
      const col = rk > 0.01 ? mix(S_COL[i0], palAt(cm.u), 0.5) : S_COL[i0];
      let style: string | CanvasGradient = withAlpha(col, a * 0.3);
      if (pt && pb && Math.hypot(pt.x - pb.x, pt.y - pb.y) > 1) {
        const g = ctx.createLinearGradient(pt.x, pt.y, pb.x, pb.y);
        g.addColorStop(0, withAlpha(col, Math.min(1, a)));
        g.addColorStop(0.3, withAlpha(col, a * lerp(0.4, 0.6, rk)));
        g.addColorStop(1, withAlpha(col, a * lerp(0.06, 0.25, rk)));
        style = g;
      }
      fillPoly(ctx, v, [...top, ...bot.reverse()], style);
    }
  }

  // --- the wall of light: the steep curve extruded sideways into a sheet -----------------------------------
  const wallA = (0.55 + 0.45 * ease.inOutQuad(prog(f, CLIMB - 40, CLIMB + 20))) * (1 - 0.7 * rk) * (1 + 0.8 * preA) * (1 + 0.7 * impact);
  // seen from the flat road, the wall far ahead glows like a beacon
  {
    const ba = (1 - climbK(f)) * clamp((sLit - S_SP0) / 60);
    if (ba > 0.01)
      for (const [hh, rr, col] of [
        [8, 9, C.cyan],
        [30, 18, C.magenta],
        [80, 30, "#ffd6f2"],
      ] as const) {
        const s = sOfU(2005) + (hh / H_HERE) * (S_HERE - sOfU(2005));
        const c = curveAt(s);
        const p = proj(v, 0, -c.h, c.z, 1);
        if (p) glow(ctx, p.x, p.y, rr * p.s * 3, col, 0.22 * ba, 0.02);
      }
  }
  if (lit > S_SP0 && wallA > 0.01) {
    const SK = 6;
    const sheetEnd = Math.min(sLit, SMP[I_TOP].s);
    // translucent sheet
    for (let i0 = I_WALL; i0 < I_TOP; i0 += SK) {
      const i1 = Math.min(I_TOP, i0 + SK);
      const cm = SMP[(i0 + i1) >> 1];
      if (cm.s > sheetEnd) break;
      const rise = clamp((cm.u - 2001) / 7);
      const d = dist(0, -cm.h, cm.z);
      const a = 0.04 * wallA * rise * bA(cm.h) * fog(d) * nearK(d - 4);
      if (a < 0.004) continue;
      const L: V3[] = [];
      const R: V3[] = [];
      for (let i = i0; i <= i1; i++) {
        L.push(toCam(v, -SHEET, -SMP[i].h, SMP[i].z));
        R.push(toCam(v, SHEET, -SMP[i].h, SMP[i].z));
      }
      fillPoly(ctx, v, [...L, ...R.reverse()], withAlpha(S_COL[i0], a));
    }
    // strands (wide halos go into the blurred buffer, crisp cores here) with light streaming up them
    for (const st of STRANDS) {
      const fall = Math.exp(-Math.abs(st.x) / 6) * st.a * wallA;
      for (let i0 = I_WALL; i0 < I_TOP; i0 += SK * 3) {
        const i1 = Math.min(I_TOP, i0 + SK * 3);
        const cm = SMP[(i0 + i1) >> 1];
        if (cm.s > sheetEnd) break;
        const d = dist(st.x, -cm.h, cm.z);
        const a = fall * clamp((cm.u - 2001) / 7) * bA(cm.h) * fog(d) * nearK(d);
        if (a < 0.01) continue;
        const cs: V3[] = [];
        for (let i = i0; i <= i1; i += 3) cs.push(toCam(v, st.x, -SMP[i].h, SMP[i].z));
        cs.push(toCam(v, st.x, -SMP[i1].h, SMP[i1].z));
        const rs = runs(v, cs);
        if (!rs.length) continue;
        const sc = cam.f / Math.max(1, d);
        pathRuns(hg, rs);
        hg.strokeStyle = withAlpha(S_COL[i0], 0.3 * a);
        hg.lineWidth = clamp(0.4 * sc, 2, 34);
        hg.stroke();
        pathRuns(ctx, rs);
        ctx.strokeStyle = withAlpha(S_HOT[i0], 0.75 * a);
        ctx.lineWidth = clamp(0.045 * sc, 1, 4);
        ctx.stroke();
      }
      // pulses of light racing up the strand
      for (let k = 0; k < 2; k++) {
        const span = S_HERE + 60 - sOfU(2008);
        const s = sOfU(2008) + ((((st.ph + k * 0.5) * span + f * st.v * (1 + 1.5 * rush)) % span) + span) % span;
        const c = curveAt(s);
        const c0 = curveAt(s - 6);
        const d = dist(st.x, -c.h, c.z);
        const a = fall * fog(d) * nearK(d) * bA(c.h) * clamp((sLit - s) / 4);
        if (a < 0.02) continue;
        const rs = runs(v, [toCam(v, st.x, -c0.h, c0.z), toCam(v, st.x, -c.h, c.z)]);
        if (!rs.length) continue;
        const sc = cam.f / Math.max(1, d);
        glowRuns(ctx, rs, palAt(c.u), clamp(0.08 * sc, 1.2, 6), 0.9 * a, 4);
      }
    }
    // rungs across the sheet: they rush past during the climb
    const r0 = Math.ceil(S_SP0 / RUNG_STEP);
    const r1 = Math.floor(Math.min(sheetEnd, S_HERE + 60) / RUNG_STEP);
    for (let k = r0; k <= r1; k++) {
      const s = k * RUNG_STEP;
      const c = curveAt(s);
      const d = dist(0, -c.h, c.z);
      const a = 0.55 * wallA * clamp((c.u - 2002) / 6) * bA(c.h) * fog(d) * clamp(d / 3);
      if (a < 0.01) continue;
      const rs = runs(v, [toCam(v, -SHEET, -c.h, c.z), toCam(v, 0, -c.h, c.z), toCam(v, SHEET, -c.h, c.z)]);
      if (!rs.length || rs[0].length < 2) continue;
      const pa = rs[0][0];
      const pb = rs[rs.length - 1][rs[rs.length - 1].length - 1];
      const g = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
      const col = palAt(c.u);
      g.addColorStop(0, withAlpha(col, 0));
      g.addColorStop(0.5, withAlpha(mix(col, "#ffffff", 0.3), Math.min(1, a)));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = clamp((0.07 * cam.f) / Math.max(1, d), 1, 6);
      pathRuns(ctx, rs);
      ctx.stroke();
    }
    // shock ring travelling across the sheet when the marker lands
    if (tHit >= 0 && tHit < 50) {
      for (let k = 0; k < 2; k++) {
        const t = tHit - k * 7;
        if (t < 0) continue;
        const R = 1.5 + 34 * (1 - Math.exp(-t / 16));
        const a = Math.exp(-t / 13) * (1 - rk);
        const pts: V3[] = [];
        for (let i = 0; i <= 72; i++) {
          const an = (i / 72) * TAU;
          const yy = Math.sin(an) * R;
          const c = curveAt(S_HERE + yy);
          pts.push(toCam(v, Math.cos(an) * R, -c.h, c.z));
        }
        const rs = runs(v, pts);
        glowRuns(ctx, rs, k ? C.magenta : C.gold, clamp(0.25 * (cam.f / Math.max(1, dist(0, -H_HERE, Z_HERE))), 2, 7), a, 6);
      }
    }
  }

  // --- pylons --------------------------------------------------------------------------------------------
  for (const py of PYLONS) {
    if (f <= py.rise) continue;
    const rt = f - py.rise;
    const r = ease.outBack(clamp(rt / 22));
    const top = PYL_TOP * r;
    const d = dist(py.x, -top / 2, py.z);
    const fa = fog(d) * (1 - 0.85 * rk) * (1 - 0.6 * kh);
    if (fa <= 0.01) continue;
    // the pylon flares as it whips past (kick peaks a few frames before it leaves the frame)
    const kp = f - (py.pass - 7);
    const kick = kp < 0 ? 0 : kp < 4 ? kp / 4 : Math.exp(-(kp - 4) / 8);
    const wv = f >= frameWave(sOfU(py.year)) ? Math.exp(-(f - frameWave(sOfU(py.year))) / 8) : 0;
    const birth = Math.exp(-rt / 10);
    const boost = 1 + 1.6 * kick + 2 * wv + 1.5 * birth;
    const tpc = toCam(v, py.x, -top, py.z);
    const tp = tpc[2] > NEAR ? scr(v, tpc) : null;
    // beam into the sky: shoots up when the pylon erupts
    const beamL = 34 * ease.outCubic(clamp(rt / 12));
    const sky = runs(v, [tpc, toCam(v, py.x, -top - beamL, py.z)]);
    if (sky.length && tp && beamL > 0.5) {
      const end = sky[0][sky[0].length - 1];
      const g = ctx.createLinearGradient(tp.x, tp.y, end.x, end.y);
      g.addColorStop(0, withAlpha(py.col, 0.3 * fa * Math.min(2.4, boost)));
      g.addColorStop(1, withAlpha(py.col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = clamp(0.22 * tp.s, 1.5, 22) * (1 + birth);
      pathRuns(ctx, sky);
      ctx.stroke();
    }
    // shaft
    const shaft = runs(v, [toCam(v, py.x, 0, py.z), tpc]);
    if (shaft.length) {
      const sc = cam.f / Math.max(1, d);
      ctx.lineCap = "round";
      pathRuns(ctx, shaft);
      ctx.strokeStyle = withAlpha(py.col, 0.14 * fa * boost);
      ctx.lineWidth = clamp(0.55 * sc, 3, 70);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(mix(py.col, "#ffffff", 0.55), Math.min(1, 0.9 * fa * Math.min(1.5, boost)));
      ctx.lineWidth = clamp(0.07 * sc, 1.4, 8);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    // ground ring + eruption shockwave
    const ring = (R: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i <= 40; i++) out.push(toCam(v, py.x + Math.cos((i / 40) * TAU) * R, 0, py.z + Math.sin((i / 40) * TAU) * R));
      return out;
    };
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(py.col, 0.7 * fa);
    pathRuns(ctx, runs(v, ring(0.9)));
    ctx.stroke();
    if (rt < 44) {
      const sw = runs(v, ring(0.9 + 9 * (1 - Math.exp(-rt / 12))));
      glowRuns(ctx, sw, py.col, 2.5, 0.9 * fa * (1 - rt / 44), 5);
    }
    const base = proj(v, py.x, 0, py.z, 0.6);
    if (base) {
      const sq = clamp(Math.abs(cam.y) / d + 0.06);
      const rp = 2.2 * base.s * (1 + 1.5 * birth);
      ctx.globalAlpha = Math.min(1, 0.4 * fa * boost);
      ctx.drawImage(soft(py.col), base.x - rp, base.y - rp * sq, rp * 2, rp * 2 * sq);
      ctx.globalAlpha = 1;
    }
    if (tp) {
      glow(ctx, tp.x, tp.y, clamp(1.1 * tp.s, 8, 140) * (1 + 0.6 * kick + wv + birth), py.col, 0.85 * fa * Math.min(1.8, boost));
      glow(ctx, tp.x, tp.y, clamp(0.3 * tp.s, 3, 30), "#ffffff", 0.9 * fa);
      // label beside the beam, once the pylon is near enough to read
      const la = fa * ease.outCubic(prog(f, py.rise + 6, py.rise + 14)) * clamp((tp.s - 38) / 6) * (1 - rk);
      if (la > 0.02) {
        // beside the beam just above the glowing top (never on it), on the side facing the frame centre
        const size = clamp(0.5 * tp.s, 32, 48);
        const right = tp.x > w * 0.62;
        labels.push({ x: tp.x + (right ? -22 : 22), y: tp.y - 10, size, year: String(py.year), text: py.label, col: py.col, a: la, align: right ? "right" : "left" });
      }
    }
  }

  // --- the ribbon ------------------------------------------------------------------------------------------
  if (lit > 0) {
    const pts = tubePts(false, sLit, 1.0);
    drawTube(hg, pts, tubeAlpha, tubeCol, [0, 1, 2], 1.5);
    drawTube(ctx, pts, tubeAlpha, tubeCol, [3, 4], 1);
  }

  // --- doublings: arches over the road, bright rungs on the wall; each fires on its tick ---------------------
  for (const hp of HOOPS) {
    if (hp.s > sLit) continue;
    const c = hp.c;
    const t = f - hp.fire;
    const fireK = t >= 0 ? Math.exp(-t / 9) : 0;
    const col = palAt(hp.u);
    const d = dist(0, -c.h, c.z);
    const base = S_INT[iOfS(hp.s)] * fog(d) * (1 - 0.6 * rk) * (1 - 0.5 * kh) * clamp((sLit - hp.s) / 4);
    if (!hp.wall) {
      const arch = (R: number): V3[] => {
        const out: V3[] = [];
        for (let i = 0; i <= 28; i++) {
          const an = (i / 28) * Math.PI;
          out.push(toCam(v, Math.cos(an) * R, -Math.sin(an) * R, c.z));
        }
        return out;
      };
      const sc = cam.f / Math.max(0.5, d);
      const a = base * (0.32 + (t >= 0 ? 0.25 : 0) + 2.2 * fireK) * nearK(d + 2);
      glowRuns(ctx, runs(v, arch(ARCH_R)), col, clamp(0.05 * sc, 1, 5), a, 5);
      if (t >= 0 && t < 34) {
        // echo arch expanding outward + ground shockwave
        const ea = Math.exp(-t / 8) * base;
        glowRuns(ctx, runs(v, arch(ARCH_R + t * 0.22)), mix(col, "#ffffff", 0.4), clamp(0.05 * sc, 1, 4), ea, 4);
        const gr: V3[] = [];
        const R = 0.6 + 12 * (1 - Math.exp(-t / 10));
        for (let i = 0; i <= 48; i++) gr.push(toCam(v, Math.cos((i / 48) * TAU) * R, 0, c.z + Math.sin((i / 48) * TAU) * R));
        glowRuns(ctx, runs(v, gr), col, 2, 0.7 * Math.exp(-t / 11) * base * 1.8, 5);
      }
      // the node itself
      const p = proj(v, 0, -c.h, c.z, 0.6);
      if (p && p.x > -100 && p.x < w + 100 && p.y > -100 && p.y < h + 100) {
        const R = clamp(ribR(c.h) * 2.4 * p.s, 3, 90);
        glow(ctx, p.x, p.y, R * (1 + 2 * fireK), col, Math.min(1, 0.5 * base + 0.8 * fireK));
        glow(ctx, p.x, p.y, R * 0.35, "#ffffff", 0.6 * base);
        if (fireK > 0.05) {
          // anamorphic glint
          const sw = R * 9 * fireK;
          const g = ctx.createLinearGradient(p.x - sw, 0, p.x + sw, 0);
          g.addColorStop(0, withAlpha(col, 0));
          g.addColorStop(0.5, withAlpha("#ffffff", 0.7 * fireK * base));
          g.addColorStop(1, withAlpha(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(p.x - sw, p.y - 1.5 - 2 * fireK, sw * 2, 3 + 4 * fireK);
        }
      }
      // a pulse races ahead along the ribbon towards the wall
      if (t >= 0 && t < 26) {
        const s = hp.s + t * 3.2 + t * t * 0.06;
        const cc = curveAt(s);
        const c0 = curveAt(Math.max(0, s - 7));
        const rs = runs(v, [toCam(v, 0, -c0.h, c0.z), toCam(v, 0, -curveAt(s - 3.5).h, c0.z + (cc.z - c0.z) / 2), toCam(v, 0, -cc.h, cc.z)], 0.8);
        if (rs.length) {
          const head = rs[rs.length - 1][rs[rs.length - 1].length - 1];
          const pa = (1 - t / 26) * fog(head.z);
          glowRuns(ctx, rs, col, clamp(ribR(cc.h) * 0.5 * head.s, 1.2, 10), pa, 4);
          glow(ctx, head.x, head.y, clamp(ribR(cc.h) * 3 * head.s, 6, 80), col, 0.8 * pa);
        }
      }
    } else {
      // wall rung: a bright band across the sheet that flares as the camera climbs past it
      const rs = runs(v, [toCam(v, -SHEET, -c.h, c.z), toCam(v, 0, -c.h, c.z), toCam(v, SHEET, -c.h, c.z)]);
      if (rs.length && rs[0].length >= 2) {
        const sc = cam.f / Math.max(1, d);
        const a = base * wallA * (0.55 + 2.2 * fireK) * clamp(d / 2);
        glowRuns(ctx, rs, col, clamp(0.12 * sc, 1.5, 9), a, 6);
      }
    }
  }
  // origin node (1946)
  {
    const p = proj(v, 0, -H0, 0, 0.8);
    const ia = ease.outCubic(prog(f, IGNITE - 4, IGNITE + 6));
    if (p && ia > 0) {
      const t = Math.max(0, f - IGNITE);
      const pop = Math.exp(-t / 10);
      glow(ctx, p.x, p.y, clamp(1.6 * p.s, 14, 260) * (1 + 3 * pop) + 260 * pop, C.amber, ia * (0.7 + 0.3 * pop));
      glow(ctx, p.x, p.y, clamp(0.4 * p.s, 5, 70) * (1 + pop) + 40 * pop, "#ffffff", ia);
      if (pop > 0.02) {
        const sw = 900 * (0.4 + 0.6 * pop);
        const g = ctx.createLinearGradient(p.x - sw, 0, p.x + sw, 0);
        g.addColorStop(0, withAlpha(C.amber, 0));
        g.addColorStop(0.5, withAlpha("#fff0d8", 0.85 * pop * ia));
        g.addColorStop(1, withAlpha(C.amber, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - sw, p.y - 2 - 5 * pop, sw * 2, 4 + 10 * pop);
      }
      if (t < 50) {
        // ignition shockwave on the ground
        const rs: V3[] = [];
        const R = 0.5 + t * 0.6;
        for (let i = 0; i <= 48; i++) rs.push(toCam(v, Math.cos((i / 48) * TAU) * R, 0, Math.sin((i / 48) * TAU) * R));
        glowRuns(ctx, runs(v, rs), C.amber, 3, 0.9 * Math.exp(-t / 14), 5);
      }
    }
  }
  // ignition front
  if (f >= IGNITE && lit < S_END) {
    const c = curveAt(lit);
    const p = proj(v, 0, -c.h, c.z, 0.8);
    if (p) {
      const fa = fog(p.z);
      glow(ctx, p.x, p.y, clamp(3 * p.s, 24, 420), palAt(c.u), 0.9 * fa);
      glow(ctx, p.x, p.y, clamp(0.8 * p.s, 8, 110), "#ffffff", fa);
    }
  }
  // energy pulses racing ahead along the ribbon
  {
    const LOOP = S_HERE + 40;
    for (let k = 0; k < 18; k++) {
      const s = ((k / 18) * LOOP + f * 2.3) % LOOP;
      if (s > sLit - 2 || s < 1) continue;
      const c = curveAt(s);
      const c0 = curveAt(Math.max(0, s - 5));
      const rs = runs(v, [toCam(v, 0, -c0.h, c0.z), toCam(v, 0, -c.h, c.z)], 0.8);
      if (!rs.length) continue;
      const head = rs[rs.length - 1][rs[rs.length - 1].length - 1];
      const a = lerp(0.45, 1, clamp((c.u - 1990) / 25)) * fog(head.z) * bA(c.h);
      ctx.lineCap = "round";
      ctx.strokeStyle = withAlpha("#ffffff", 0.75 * a);
      ctx.lineWidth = clamp(ribR(c.h) * 0.6 * head.s, 1.2, 18);
      pathRuns(ctx, rs);
      ctx.stroke();
      ctx.lineCap = "butt";
      glow(ctx, head.x, head.y, clamp(ribR(c.h) * 2.4 * head.s, 6, 120), palAt(c.u), 0.8 * a);
    }
  }

  // --- gates around the wall: 2012, 2022 ----------------------------------------------------------------------
  for (const gt of GATES) {
    const c = gt.c;
    const rise = gt.pass - 70;
    if (c.s > sLit || f <= rise) continue;
    const app = ease.outBack(clamp((f - rise) / 22));
    const pass = f - gt.pass;
    const gone = 1 - clamp((pass - 10) / 14);
    const keep = Math.max(gone, 0) * (1 - rk);
    if (app <= 0 || keep <= 0.01) continue;
    const d = dist(0, -c.h, c.z);
    const fa = fog(d) * keep;
    // ignites ~6 frames before it fills the frame
    const kp = f - (gt.pass - 6);
    const kick = kp < 0 ? 0 : kp < 3 ? kp / 3 : Math.exp(-(kp - 3) / 8);
    const R = gt.R * app;
    const ringPts = (rr: number, n = 64): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU + f * 0.004;
        const x = Math.cos(a) * rr;
        const nn = Math.sin(a) * rr;
        out.push(toCam(v, x, -c.h - nn * c.tz, c.z - nn * c.th));
      }
      return out;
    };
    const sc = cam.f / Math.max(1, d);
    const rs = runs(v, ringPts(R));
    pathRuns(ctx, rs);
    ctx.strokeStyle = withAlpha(gt.col, Math.min(1, 0.16 * fa * (1 + 2 * kick)));
    ctx.lineWidth = clamp(0.9 * sc, 3, 120);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(gt.col, Math.min(1, 0.42 * fa * (1 + 1.5 * kick)));
    ctx.lineWidth = clamp(0.25 * sc, 2, 40);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(mix(gt.col, "#ffffff", 0.55 + 0.4 * kick), Math.min(1, fa * (1 + kick)));
    ctx.lineWidth = clamp(0.06 * sc, 1.2, 10) * (1 + kick);
    ctx.stroke();
    // tick marks around the rim
    ctx.strokeStyle = withAlpha(mix(gt.col, "#ffffff", 0.3), 0.7 * fa);
    ctx.lineWidth = clamp(0.04 * sc, 1, 6);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU - f * 0.006;
      const l = i % 3 === 0 ? 1.1 : 0.5;
      const p0 = toCam(v, Math.cos(a) * (R + 0.35), -c.h - Math.sin(a) * (R + 0.35) * c.tz, c.z - Math.sin(a) * (R + 0.35) * c.th);
      const p1 = toCam(v, Math.cos(a) * (R + 0.35 + l), -c.h - Math.sin(a) * (R + 0.35 + l) * c.tz, c.z - Math.sin(a) * (R + 0.35 + l) * c.th);
      const tr = runs(v, [p0, p1]);
      if (!tr.length) continue;
      pathRuns(ctx, tr);
      ctx.stroke();
    }
    if (kp >= 0 && kp < 30) {
      // the gate's echo races outward past the lens
      glowRuns(ctx, runs(v, ringPts(R + kp * 0.45)), mix(gt.col, "#ffffff", 0.5), clamp(0.12 * sc, 2, 24), Math.exp(-kp / 8), 4);
      const p = proj(v, 0, -c.h, c.z, 0.5);
      if (p) glow(ctx, p.x, p.y, clamp(gt.R * p.s * 1.4, 200, 1600), gt.col, 0.35 * kick, 0.02);
    }
    const lp = proj(v, R + 1.2, -c.h, c.z);
    if (lp && kp < 0) {
      const la = fa * clamp(app) * ease.outCubic(prog(f, rise + 10, rise + 18)) * clamp(-kp / 6) * clamp((lp.s - 26) / 5);
      if (la > 0.02) labels.push({ x: lp.x + 10, y: lp.y + 22, size: clamp(0.6 * lp.s, 34, 56), year: String(gt.year), text: gt.label, col: gt.col, a: la, align: "left" });
    }
  }

  // --- dust: motes over the flat road, sparks streaming up the wall -----------------------------------------
  const streak = (x: number, y: number, z: number, px: number, py: number, pz: number, col: string, al: number, lwK: number) => {
    const a1 = toCam(v, x, y, z);
    if (a1[2] <= 0.4) return;
    const q1 = scr(v, a1);
    if (q1.x < -200 || q1.x > w + 200 || q1.y < -200 || q1.y > h + 200) return;
    const dd = a1[2];
    const lw = clamp((lwK * cam.f) / dd, 0.8, 4);
    const a0 = toCam(prev, px, py, pz);
    if (a0[2] > 0.4) {
      const q0 = scr(prev, a0);
      const len = Math.hypot(q1.x - q0.x, q1.y - q0.y);
      if (len > 3 && len < 900) {
        ctx.strokeStyle = withAlpha(col, al * clamp(30 / len + 0.35));
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(q0.x, q0.y);
        ctx.lineTo(q1.x, q1.y);
        ctx.stroke();
        return;
      }
    }
    ctx.fillStyle = withAlpha(col, al);
    ctx.fillRect(q1.x - lw / 2, q1.y - lw / 2, lw, lw);
  };
  if (cam.y > -40 && rk < 0.5) {
    const ma = (1 - kc) * ease.outCubic(prog(f, 20, 70));
    for (const p of MOTES) {
      const d = dist(p.x, p.y, p.z);
      const tw = 0.55 + 0.45 * Math.sin(f * 0.07 + p.tw);
      const al = (0.25 + 0.6 * p.r) * tw * fog(d) * ma * clamp(d / 2);
      if (al < 0.02) continue;
      streak(p.x, p.y, p.z, p.x, p.y, p.z, p.r > 0.7 ? "#ffe9c4" : C.gold, al, 0.035);
    }
  }
  if (lit > S_SP0) {
    const sa = (0.3 + 0.7 * ease.inOutQuad(prog(f, CLIMB - 30, CLIMB + 10))) * (1 - 0.6 * rk) * (1 + 0.6 * rush) * (1 + 0.6 * kh);
    const dtp = f - prevF;
    for (const p of SPARKS) {
      const s = S_SP0 + ((p.s0 + f * p.v) % SP_SPAN);
      const sP = s - dtp * p.v;
      const c = curveAt(s);
      const cP = curveAt(sP);
      const y = Math.min(-0.2, -c.h - p.n * c.tz);
      const z = c.z - p.n * c.th;
      const d = dist(p.x, y, z);
      const tw = 0.55 + 0.45 * Math.sin(f * 0.09 + p.tw);
      const wrap = clamp((s - S_SP0) / 8) * clamp((S_SP0 + SP_SPAN - s) / 8);
      const al = (0.2 + 0.65 * p.r) * tw * fog(d) * sa * bA(c.h) * clamp(d / 1.5) * clamp((140 - d) / 60) * wrap;
      if (al < 0.02) continue;
      streak(p.x, y, z, p.x, Math.min(-0.2, -cP.h - p.n * cP.tz), cP.z - p.n * cP.th, mix(palAt(c.u), "#ffffff", 0.35), al, 0.04);
    }
  }

  // --- the marker lands: a radial burst of sparks --------------------------------------------------------------
  if (tHit >= 0 && tHit < 70 && rk < 0.9) {
    for (const b of BURST) {
      const life = Math.exp(-tHit / b.life);
      if (life < 0.04) continue;
      const k = (1 - Math.exp(-tHit / 9)) * 9;
      const k0 = (1 - Math.exp(-Math.max(0, tHit - 1.5) / 9)) * 9;
      const x = MARK[0] + b.d[0] * k;
      const y = MARK[1] / 1 + b.d[1] * k + tHit * tHit * 0.002;
      const z = MARK[2] + b.d[2] * k;
      const p1 = proj(v, x, y, z, 0.5);
      const p0 = proj(v, MARK[0] + b.d[0] * k0, MARK[1] + b.d[1] * k0, MARK[2] + b.d[2] * k0, 0.5);
      if (!p1 || !p0) continue;
      ctx.strokeStyle = withAlpha(b.col, life * (1 - rk));
      ctx.lineWidth = 1.2 + 2.2 * life;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x + (p1.x - p0.x) * 0.01, p1.y + (p1.y - p0.y) * 0.01 + 0.5);
      ctx.stroke();
    }
  }

  // --- hyperspace: speed lines streaming away from the direction of travel -------------------------------------
  if (rush > 0.02) {
    const col = palAt(yearAt(f));
    // focus of expansion = the projected direction of motion
    const p1 = poseAt(f + 1).p;
    const p0 = poseAt(f - 1).p;
    const dv = toCam(v, cam.x + (p1[0] - p0[0]) * 100, (cam.y + (p1[1] - p0[1]) * 100) / q, cam.z + (p1[2] - p0[2]) * 100);
    const fx = dv[2] > 1 ? clamp(cam.cx + (dv[0] * cam.f) / dv[2], -1800, w + 1800) : cam.cx;
    const fy = dv[2] > 1 ? clamp(cam.cy + (dv[1] * cam.f) / dv[2], -1800, h + 1800) : cam.cy;
    ctx.lineCap = "round";
    for (let i = 0; i < 130; i++) {
      const bx = hash(i * 3.1 + 200) * (w + 200) - 100;
      const by = hash(i * 5.7 + 201) * (h + 200) - 100;
      let dx = bx - fx;
      let dy = by - fy;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const sp = 0.6 + hash(i * 7.3 + 202) * 0.9;
      const ph = (hash(i * 9.1 + 203) + f * 0.045 * sp) % 1;
      const travel = (ph - 0.5) * 900;
      const len = (60 + 380 * ph) * (0.4 + 0.6 * rush) * clamp(dl / 500 + 0.3);
      const a = rush * 0.4 * Math.sin(ph * Math.PI) * (0.4 + 0.6 * hash(i * 11.3 + 204));
      if (a < 0.01) continue;
      const sx = bx + dx * travel;
      const sy = by + dy * travel;
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.5), a);
      ctx.lineWidth = 1 + 2.2 * ph;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dx * len, sy + dy * len);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    glow(ctx, clamp(fx, -200, w + 200), clamp(fy, -200, h + 200), 700, mix(col, "#ffffff", 0.4), 0.2 * rush, 0.03);
  }

  // --- the doubling wave ----------------------------------------------------------------------------------
  if (wS > -5) {
    for (let k = 0; k < 14; k++) {
      const s = Math.min(wS, S_HERE) - k * 3;
      if (s < 0 || s > S_END) continue;
      const c = curveAt(s);
      const p = proj(v, 0, -c.h, c.z, 0.8);
      if (!p) continue;
      const fall = Math.exp(-k / 4);
      glow(ctx, p.x, p.y, clamp(5 * p.s, 34, 260) * (0.5 + 0.5 * fall), k < 2 ? "#ffffff" : palAt(c.u), 0.85 * fall + 0.1);
    }
  }

  // --- reveal: the whole history on the curve ------------------------------------------------------------------
  if (rk > 0.02) {
    const la = ease.outCubic(prog(rk, 0.72, 0.98)) * lblOut;
    MILESTONES.forEach((ms, k) => {
      const s = sOfU(ms.year);
      const c = curveAt(s);
      const p = proj(v, 0, -c.h, c.z, 0.8);
      if (!p) return;
      const fw = frameWave(s);
      const wv = f >= fw ? Math.exp(-(f - fw) / 10) : 0;
      glow(ctx, p.x, p.y, 26 + 56 * wv, ms.col, 0.95 * rk);
      glow(ctx, p.x, p.y, 8 + 12 * wv, "#ffffff", rk);
      if (la <= 0.01) return;
      const L = REV_LBL[k];
      const ex = p.x + L.dx;
      const ey = p.y + L.dy;
      ctx.strokeStyle = withAlpha(ms.col, 0.85 * la);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (L.dy < 0) {
        ctx.moveTo(p.x, p.y - 14);
        ctx.lineTo(p.x, ey + 8);
        if (L.align !== "center") ctx.lineTo(ex, ey + 8);
      } else {
        ctx.moveTo(p.x + 14, p.y);
        ctx.lineTo(ex - 6, ey - 34);
      }
      ctx.stroke();
      labels.push({ x: ex, y: ey, size: 40, year: String(ms.year), text: ms.label, col: ms.col, a: la, align: L.align, fixed: true });
    });
  }

  // --- you are here -----------------------------------------------------------------------------------------
  if (f > HERE - 12 && f < FLASH) {
    const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
    if (p) {
      const a = ease.outCubic(prog(f, HERE - 10, HERE + 2));
      const pulse = 0.85 + 0.15 * Math.sin((f - HERE) * 0.2);
      const R = markR(p.s);
      glow(ctx, p.x, p.y, R * 2.4 * pulse * (1 + 1.0 * impact), C.gold, (0.5 + 0.35 * impact) * a, 0.1);
      glow(ctx, p.x, p.y, R * 0.75 * pulse, C.gold, 0.85 * a);
      glow(ctx, p.x, p.y, R * 0.2 * (1 + impact), "#ffffff", a);
      // pulse rings stay clear of the tag
      for (let k = 0; k < 3; k++) {
        const tt = f - HERE + k * 18;
        if (tt < 0) continue;
        const t = (tt % 54) / 54;
        ctx.strokeStyle = withAlpha(C.gold, 0.9 * (1 - t) * a);
        ctx.lineWidth = 4 * (1 - t) + 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R * 0.4 + t * R * 1.2, 0, TAU);
        ctx.stroke();
      }
      // target brackets
      const br = R * 0.85 * (1 + 0.8 * (1 - ease.outExpo(prog(f, HERE - 8, HERE + 12))));
      ctx.strokeStyle = withAlpha(C.gold, 0.9 * a);
      ctx.lineWidth = 2.5;
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * TAU + Math.PI / 4 + (f - HERE) * 0.01;
        const cx = p.x + Math.cos(ang) * br;
        const cy = p.y + Math.sin(ang) * br;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang + Math.PI * 0.75) * 16, cy + Math.sin(ang + Math.PI * 0.75) * 16);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang - Math.PI * 0.75) * 16, cy + Math.sin(ang - Math.PI * 0.75) * 16);
        ctx.stroke();
      }
      // impact: anamorphic flare + a ring of light on the lens
      if (impact > 0.01) {
        const fl = Math.exp(-tHit / 6); // the anamorphic flare is gone before the tag writes on
        const sw = 1500 * (0.5 + 0.5 * fl);
        const g = ctx.createLinearGradient(p.x - sw, 0, p.x + sw, 0);
        g.addColorStop(0, withAlpha(C.gold, 0));
        g.addColorStop(0.5, withAlpha("#fff6e0", 0.9 * fl));
        g.addColorStop(1, withAlpha(C.gold, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - sw, p.y - 2 - 8 * fl, sw * 2, 4 + 16 * fl);
        glow(ctx, p.x, p.y, 240 * impact + 60, "#fff1cf", 0.42 * impact, 0.04);
        // a ring of light races out across the lens (gone before the tag writes on)
        const lr = Math.exp(-tHit / 5);
        if (lr > 0.02) {
          ctx.strokeStyle = withAlpha(C.gold, 0.85 * lr);
          ctx.lineWidth = 2 + 7 * lr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, R * 0.5 + (1 - lr) * 700, 0, TAU);
          ctx.stroke();
        }
      }
    }
  }
  // pre-flash: a hot point at the marker, a growing anamorphic streak and rays; everything else drops away
  if (preA > 0) {
    const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
    const x = p ? p.x : w / 2;
    const y = p ? p.y : 0;
    const k = ease.inQuad(preA);
    glow(ctx, x, y, 26 + 130 * k, "#ffffff", 0.7 + 0.3 * preA, 0.3);
    glow(ctx, x, y, 70 + 300 * k, C.gold, 0.55 * preA, 0.06);
    const sw = 300 + 2200 * k;
    const g = ctx.createLinearGradient(x - sw, 0, x + sw, 0);
    g.addColorStop(0, withAlpha(C.cyan, 0));
    g.addColorStop(0.5, withAlpha("#ffffff", Math.min(1, 0.4 + 0.6 * preA)));
    g.addColorStop(1, withAlpha(C.cyan, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - sw, y - 2 - 10 * k, sw * 2, 4 + 20 * k);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(f * 0.01);
    for (let i = 0; i < 24; i++) {
      const an = (i / 24) * TAU + hash(i * 3.7 + 600) * 0.2;
      const L = (200 + 1400 * k) * (0.5 + 0.5 * hash(i * 5.3 + 601));
      const wd = 0.01 + 0.012 * hash(i * 7.1 + 602);
      const rg = ctx.createLinearGradient(0, 0, Math.cos(an) * L, Math.sin(an) * L);
      rg.addColorStop(0, withAlpha("#fff4dc", 0.5 * preA));
      rg.addColorStop(1, withAlpha(C.gold, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, L, an - wd, an + wd);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
  {
    const b = hb.b.getContext("2d")!;
    b.globalCompositeOperation = "source-over";
    b.clearRect(0, 0, HB_W, HB_H);
    b.filter = "blur(5px)";
    b.drawImage(hb.a, 0, 0);
    b.filter = "none";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(hb.b, 0, 0, w, h);
    ctx.restore();
  }

  bloom(ctx, w, h, lerp(0.32, 0.78, clamp(grade * 1.6)) * (1 - 0.3 * rk) + 0.18 * rush + 0.1 * impact + 0.6 * preA - 0.15 * kh);

  // --- labels (after bloom, crisp) -------------------------------------------------------------------------
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(pose.roll);
  ctx.translate(-w / 2, -h / 2);
  ctx.globalCompositeOperation = "source-over";
  labels.sort((a, b) => b.size - a.size);
  const placed: [number, number, number, number][] = [];
  for (const L of labels) {
    ctx.font = `800 ${Math.round(L.size)}px ${FONT_MONO}`;
    const wy = ctx.measureText(L.year).width;
    ctx.font = `700 ${Math.round(L.size * 0.75)}px ${FONT_CN}`;
    const wt = ctx.measureText(L.text).width;
    const wEst = Math.max(wy, wt);
    const bx0 = L.align === "center" ? L.x - wEst / 2 : L.align === "right" ? L.x - wEst : L.x;
    const box: [number, number, number, number] = [bx0 - 12, L.y - L.size * 1.95, bx0 + wEst + 12, L.y + L.size * 0.32];
    if (!L.fixed) {
      if (placed.some((qq) => qq[0] < box[2] && box[0] < qq[2] && qq[1] < box[3] && box[1] < qq[3])) continue;
      placed.push(box);
    }
    const hud = f < CREST && box[2] > HUD_BOX[0] && box[1] < HUD_BOX[3] ? 0 : 1;
    // text stays >= 60 px from the frame edges (the backing pill may come a little closer)
    const safe = clamp((box[0] - 36) / 30) * clamp((w - 36 - box[2]) / 30) * clamp((box[1] - 40) / 30) * clamp((770 - box[3]) / 30);
    const a = L.a * safe * hud * lblOut;
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    // soft dark backing so the label reads over the glow
    const bg = ctx.createLinearGradient(0, box[1], 0, box[3]);
    bg.addColorStop(0, "rgba(2,3,10,0.5)");
    bg.addColorStop(1, "rgba(2,3,10,0.62)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(box[0], box[1], box[2] - box[0], box[3] - box[1], 10);
    ctx.fill();
    ctx.textAlign = L.align;
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 10;
    ctx.font = `800 ${Math.round(L.size)}px ${FONT_MONO}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(L.year, L.x, L.y - L.size * 0.9);
    ctx.font = `700 ${Math.round(L.size * 0.75)}px ${FONT_CN}`;
    ctx.fillStyle = mix(L.col, "#ffffff", 0.6);
    ctx.fillText(L.text, L.x, L.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // the build into the flash: everything but the hot point and the curve sinks into black
  // (drawn as part of the world so the white punch starts from darkness)
  // keep the caption band calm
  const ca = capA(f);
  if (ca > 0) {
    const g = ctx.createLinearGradient(0, 748, 0, 846);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.62, `rgba(0,0,0,${0.86 * ca})`);
    g.addColorStop(1, `rgba(0,0,0,${0.97 * ca})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 748, w, 98);
    ctx.fillStyle = `rgba(0,0,0,${0.97 * ca})`;
    ctx.fillRect(0, 846, w, h - 846);
  }
};

/** Marker radius on screen for a given projection scale. */
const markR = (s: number) => clamp(2.2 * s, 40, 120);

const HB_W = 480;
const HB_H = 270;
let haloA: HTMLCanvasElement | null = null;
let haloB: HTMLCanvasElement | null = null;
const haloBuffers = () => {
  if (!haloA || !haloB) {
    haloA = document.createElement("canvas");
    haloA.width = HB_W;
    haloA.height = HB_H;
    haloB = document.createElement("canvas");
    haloB.width = HB_W;
    haloB.height = HB_H;
  }
  return { a: haloA, b: haloB };
};

let bloomA: HTMLCanvasElement | null = null;
let bloomB: HTMLCanvasElement | null = null;
/** Two-level bloom: blur quarter- and eighth-size copies, square them (soft threshold), add them back. */
const bloom = (ctx: CanvasRenderingContext2D, w: number, h: number, k: number) => {
  if (k <= 0.01) return;
  if (!bloomA || !bloomB) {
    bloomA = document.createElement("canvas");
    bloomA.width = 480;
    bloomA.height = 270;
    bloomB = document.createElement("canvas");
    bloomB.width = 240;
    bloomB.height = 135;
  }
  const a = bloomA.getContext("2d")!;
  a.globalCompositeOperation = "source-over";
  a.globalAlpha = 1;
  a.clearRect(0, 0, 480, 270);
  a.filter = "blur(4px)";
  a.drawImage(ctx.canvas, 0, 0, 480, 270);
  a.filter = "none";
  a.globalCompositeOperation = "multiply";
  a.drawImage(bloomA, 0, 0);
  const b = bloomB.getContext("2d")!;
  b.globalCompositeOperation = "source-over";
  b.clearRect(0, 0, 240, 135);
  b.filter = "blur(7px)";
  b.drawImage(bloomA, 0, 0, 240, 135);
  b.filter = "none";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.min(1, k);
  ctx.drawImage(bloomA, 0, 0, w, h);
  ctx.globalAlpha = Math.min(1, k * 0.9);
  ctx.drawImage(bloomB, 0, 0, w, h);
  ctx.restore();
};

const World: React.FC = () => <Canvas draw={drawWorld} />;

// =============================================================================================
/** "我们在这里 · YOU ARE HERE" tag: always to the left of the marker, the text sitting on its underline. */
const TAG_W = 560;
const HereTag: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < HERE - 4 || frame >= FLASH) return null;
  const pose = poseAt(frame);
  const v = mkView(camOf(pose), ysqAt(frame));
  const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
  if (!p) return null;
  const c = Math.cos(pose.roll);
  const s = Math.sin(pose.roll);
  const rx = 960 + (p.x - 960) * c - (p.y - 540) * s;
  const ry = 540 + (p.x - 960) * s + (p.y - 540) * c;
  const R = markR(p.s);
  const dx = R * 1.75 + 40; // clear of the pulse rings (max radius 1.6R)
  const ex = rx - dx; // elbow (right end of the underline)
  const ey = ry + 34;
  const edge = clamp((ex - TAG_W - 60) / 40) * clamp((ry - 90) / 40) * clamp((1860 - rx) / 60);
  const a = ease.outCubic(prog(frame, HERE + 2, HERE + 14)) * (1 - prog(frame, LBL_OUT - 10, LBL_OUT)) * edge;
  if (a <= 0) return null;
  const line = ease.outExpo(prog(frame, HERE + 2, HERE + 20));
  const tIn = ease.outCubic(prog(frame, HERE + 12, HERE + 28));
  const sx = rx - R * 0.62;
  const sy = ry + R * 0.32;
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <polyline
          points={`${sx},${sy} ${lerp(sx, ex, line)},${lerp(sy, ey, line)} ${ex - TAG_W * line},${ey}`}
          stroke={C.gold}
          strokeWidth={2.5}
          fill="none"
          style={{ filter: `drop-shadow(0 0 6px ${C.gold})` }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: ex - TAG_W,
          width: TAG_W,
          top: ey - 74,
          whiteSpace: "nowrap",
          opacity: tIn,
          transform: `translateX(${(1 - tIn) * 18}px)`,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "baseline",
          gap: 14,
        }}
      >
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 50, color: "#fff", textShadow: `0 0 24px ${C.gold}, 0 2px 10px #000, 0 0 30px #000` }}>我们在这里</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 22, color: C.gold, letterSpacing: "0.18em", textShadow: "0 2px 8px #000, 0 0 18px #000" }}>· YOU ARE HERE</span>
      </div>
    </AbsoluteFill>
  );
};

/** Year readout while flying (interpolates between the milestone years). */
const YearHud: React.FC = () => {
  const frame = useCurrentFrame();
  const year = Math.floor(clamp(yearAt(frame), 1946, 2022));
  const a = ease.outCubic(prog(frame, 100, 118)) * (1 - prog(frame, RING_T[1] + 6, RING_T[1] + 20));
  if (a <= 0) return null;
  const v = camSpeed(frame);
  const col = palAt(year);
  return (
    <div style={{ position: "absolute", right: 170, top: 104, textAlign: "right", opacity: a, fontFamily: FONT_MONO }}>
      <div style={{ position: "absolute", inset: "-26px -40px -22px -60px", background: "radial-gradient(ellipse at 70% 50%, rgba(0,0,0,0.55), rgba(0,0,0,0) 72%)" }} />
      <div style={{ position: "relative", fontSize: 20, letterSpacing: "0.42em", color: C.gold, textShadow: "0 0 10px #000" }}>YEAR</div>
      <div
        style={{
          position: "relative",
          fontSize: 68,
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1.05,
          textShadow: `0 0 ${18 + 22 * clamp(v - 0.6)}px ${col}, 0 0 4px ${col}, 0 2px 8px #000`,
        }}
      >
        {year}
      </div>
      <div style={{ position: "relative", marginTop: 8, marginLeft: "auto", height: 3, width: 190, background: "rgba(255,255,255,0.18)" }}>
        <div style={{ height: "100%", width: `${((year - 1946) / (2022 - 1946)) * 100}%`, marginLeft: "auto", background: `linear-gradient(90deg, ${C.amber}, ${col})`, boxShadow: `0 0 10px ${col}` }} />
      </div>
    </div>
  );
};

// =============================================================================================
// Final title.
const CHAPTER_COLS = [C.amber, C.cyan, C.green, C.blue, C.violet, C.magenta, C.gold, "#ffffff"];
const EMBERS = Array.from({ length: 520 }, (_, i) => ({
  x: hash(i * 2.13 + 70),
  y: hash(i * 4.71 + 71),
  sp: 0.25 + hash(i * 6.2 + 72) * 0.9,
  r: 1 + Math.pow(hash(i * 8.3 + 73), 3) * 4.5,
  c: CHAPTER_COLS[i % CHAPTER_COLS.length],
  tw: hash(i * 9.9 + 74) * 30,
  drift: hash(i * 1.37 + 75) - 0.5,
}));
const SPARKS2 = Array.from({ length: 1500 }, (_, i) => ({
  a: hash(i * 2.9 + 80) * TAU,
  v: 8 + Math.pow(hash(i * 4.1 + 81), 0.8) * 52,
  drag: 0.035 + hash(i * 6.7 + 82) * 0.03,
  life: 24 + hash(i * 8.8 + 83) * 76,
  c: CHAPTER_COLS[i % CHAPTER_COLS.length],
  r: hash(i * 1.1 + 84),
}));
/** The exponential, echoed behind the title: low along the bottom, shooting up right through "AI". */
const expPt = (t: number): [number, number] => [lerp(-40, 1520, t), 930 - ((Math.exp(t * 9) - 1) / (Math.exp(9) - 1)) * 1100];
const ECHO0 = T0 + 4;
const ECHO1 = T0 + 46;
const echoT = (f: number) => ease.inQuad(prog(f, ECHO0, ECHO1));
/** When the echo's head crosses the title line (behind "AI"), the word ignites. */
const AI_T = (() => {
  let t = 0;
  while (expPt(t)[1] > 450 && t < 1) t += 0.001;
  return t;
})();
const F_AI = ECHO0 + (ECHO1 - ECHO0) * Math.sqrt(AI_T);
const FCX = 960;
const FCY = 440;

const FinalField: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      if (f < FLASH) return;
      const t = f - T0;
      const bg = ctx.createRadialGradient(FCX, FCY, 0, FCX, FCY, w * 0.8);
      bg.addColorStop(0, "#0d0714");
      bg.addColorStop(1, "#010103");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const settle = Math.exp(-Math.max(0, t) / 36);
      glow(ctx, FCX, FCY, 1000 + 600 * settle, C.amber, 0.1 + 0.4 * settle, 0.02);
      glow(ctx, FCX, FCY, 620, C.magenta, 0.07 + 0.25 * settle, 0.02);
      // god rays out of the flash
      ctx.save();
      ctx.translate(FCX, FCY);
      ctx.rotate(f * 0.0016);
      const rayA = 0.2 * Math.exp(-Math.max(0, t) / 30) + 0.03;
      for (let i = 0; i < 56; i++) {
        const a = (i / 56) * TAU + hash(i * 3.3) * 0.1;
        const wd = 0.008 + hash(i * 7.1) * 0.024;
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 1400, Math.sin(a) * 1400);
        const col = CHAPTER_COLS[i % 6];
        g.addColorStop(0, withAlpha(mix(col, "#ffffff", 0.3), rayA));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 1400, a - wd, a + wd);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      if (t < 0) return;
      // shockwaves: born outside the title box, glowing (wide soft pass + hot core)
      for (let k = 0; k < 5; k++) {
        const tt = t - 2 - k * 3;
        if (tt < 0) continue;
        const r = 560 + tt * (70 - k * 8) * Math.exp(-tt / 60);
        const a = Math.exp(-tt / (9 + k * 3));
        if (a < 0.01) continue;
        const col = [C.gold, C.cyan, C.magenta, C.violet, "#ffffff"][k];
        ctx.strokeStyle = withAlpha(col, 0.14 * a);
        ctx.lineWidth = 34 * a + 8;
        ctx.beginPath();
        ctx.ellipse(FCX, FCY, r, r * 0.56, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.5), 0.9 * a);
        ctx.lineWidth = 2 + 4 * a;
        ctx.stroke();
      }
      // spark burst in the colours of every chapter
      if (t < 110) {
        for (const p of SPARKS2) {
          const life = Math.exp(-t / p.life);
          if (life < 0.03) continue;
          const d = (p.v / p.drag) * (1 - Math.exp(-p.drag * t));
          const x = FCX + Math.cos(p.a) * (d * 1.35 + 60);
          const y = FCY + Math.sin(p.a) * (d * 0.8 + 30) + t * t * 0.003 * p.r;
          glow(ctx, x, y, 2 + 6 * p.r * life + 1.5, p.c, life);
        }
      }
      // the curve, echoed: races along the bottom and shoots up through "AI"
      const draw = echoT(f);
      if (draw > 0) {
        const n = 160;
        const fadeEcho = 1 - 0.55 * prog(f, F_AI + 20, F_AI + 70);
        ctx.lineCap = "round";
        for (const [lw, al] of [
          [16, 0.06],
          [6, 0.16],
          [2.2, 0.75],
        ] as const) {
          ctx.lineWidth = lw;
          for (let i = 0; i < n * draw; i++) {
            const [x0, y0] = expPt(i / n);
            const [x1, y1] = expPt(Math.min(draw, (i + 1) / n));
            ctx.strokeStyle = withAlpha(palAt(lerp(1990, 2025, i / n)), al * fadeEcho);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
        // milestone nodes along the echo
        MILESTONES.forEach((ms, k) => {
          const tt = (ms.year - 1946) / (2024 - 1946);
          if (tt > draw) return;
          const [x, y] = expPt(tt);
          glow(ctx, x, y, 16, ms.col, 0.9 * fadeEcho * (k === 0 ? 0.8 : 1));
        });
        const [hx, hy] = expPt(draw);
        if (hy > -60 && draw < 1) {
          glow(ctx, hx, hy, 110, C.gold, 0.7);
          glow(ctx, hx, hy, 26, "#ffffff", 1);
        }
      }
      // "AI" ignites as the echo shoots through it
      const ig = f >= F_AI ? Math.exp(-(f - F_AI) / 16) : 0;
      if (ig > 0.01) {
        glow(ctx, 1405, FCY, 260 + 300 * (1 - ig), C.magenta, 0.7 * ig, 0.05);
        glow(ctx, 1405, FCY, 140, "#ffffff", 0.6 * ig, 0.1);
      }
      // drifting particle field
      for (const e of EMBERS) {
        const span = h + 100;
        const y = ((((e.y * span - t * e.sp) % span) + span) % span) - 50;
        const x = e.x * w + Math.sin(t * 0.012 + e.tw) * 26 * e.drift;
        const burst = Math.exp(-t / 16);
        const bx = FCX + (x - FCX) * (1 - 0.45 * burst);
        const by = FCY + (y - FCY) * (1 - 0.45 * burst);
        const a = (0.22 + 0.4 * Math.sin(t * 0.06 + e.tw) ** 2) * clamp((t - 2) / 14);
        glow(ctx, bx, by, e.r * 2.3, e.c, a);
      }
      // anamorphic streak left by the flash
      const sa = Math.exp(-t / 18);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, withAlpha(C.cyan, 0));
      g.addColorStop(0.5, withAlpha("#ffffff", 0.8 * sa));
      g.addColorStop(1, withAlpha(C.cyan, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, FCY - 2 - 10 * sa, w, 4 + 20 * sa);
      ctx.globalCompositeOperation = "source-over";
    }}
  />
);

const FinalTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - T0;
  if (frame < FLASH) return null;
  const e = ease.outExpo(clamp(t / 22));
  const sc = (t < 0 ? 1.5 : 1.5 - 0.5 * e) + 0.035 * prog(frame, T0, END);
  const ab = 40 * Math.exp(-Math.max(0, t) / 9);
  const blur = 12 * (1 - ease.outCubic(clamp(t / 12)));
  const sub = ease.outCubic(prog(frame, T0 + 40, T0 + 72));
  const lineT = ease.inOutCubic(prog(frame, T0 + 26, T0 + 70));
  const sweep = prog(frame, T0 + 80, T0 + 120);
  const ig = frame >= F_AI ? Math.exp(-(frame - F_AI) / 16) : 0;
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
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${FCY - 540}px) scale(${sc})`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}>
        <div style={{ ...base, color: C.red, transform: `translateX(${-ab}px)`, mixBlendMode: "screen", opacity: 0.85 * clamp(ab / 5) }}>{words}</div>
        <div style={{ ...base, color: C.cyan, transform: `translateX(${ab}px)`, mixBlendMode: "screen", opacity: 0.85 * clamp(ab / 5) }}>{words}</div>
        <div style={{ ...base, color: "#fff", textShadow: `0 0 30px ${C.amber}, 0 0 80px rgba(255,120,40,0.55), 0 4px 18px rgba(0,0,0,0.6)` }}>
          从真空管到
          <span
            style={{
              fontFamily: FONT_MONO,
              letterSpacing: 0,
              background: `linear-gradient(100deg, ${mix(C.gold, "#ffffff", 0.6 * ig)}, ${mix(C.magenta, "#ffffff", 0.5 * ig)} 50%, ${mix(C.cyan, "#ffffff", 0.5 * ig)})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "none",
              filter: `drop-shadow(0 0 ${18 + 30 * ig}px ${withAlpha(C.magenta, 0.85)}) drop-shadow(0 0 4px rgba(0,0,0,0.6))`,
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
          top: FCY + 128,
          height: 2,
          width: 920 * lineT,
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
          top: FCY + 160,
          textAlign: "center",
          fontFamily: FONT_CN,
          fontWeight: 700,
          fontSize: 60,
          letterSpacing: `${0.32 - 0.2 * sub}em`,
          color: "#fff",
          opacity: sub,
          filter: sub < 1 ? `blur(${(1 - sub) * 8}px)` : undefined,
          textShadow: "0 0 18px rgba(56,214,255,0.65), 0 2px 8px #000",
        }}
      >
        下一次<span style={{ color: C.gold, fontWeight: 900, textShadow: `0 0 24px ${C.gold}, 0 2px 8px #000` }}>翻倍</span>，会带来什么？
      </div>
    </AbsoluteFill>
  );
};

/** The biggest flash of the film: a 4-frame ramp, 5 frames of warm white, then a fast decay. */
const WhiteOut: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - FLASH;
  let a = 0;
  if (t < 0) a = 0.92 * ease.inCubic(clamp((t + 4) / 4));
  else if (t < 5) a = 1;
  else a = Math.exp(-(t - 4) / 3.6);
  if (a <= 0.003) return null;
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 42%, #ffffff 0%, #fff8ee 45%, #ffeedd 100%)" }} />
      <AbsoluteFill
        style={{
          background: "repeating-conic-gradient(from 3deg at 50% 41%, rgba(255,214,150,0.22) 0deg 1.6deg, rgba(255,255,255,0) 1.6deg 7.5deg)",
          opacity: t < 5 ? 1 : 0.5,
        }}
      />
    </AbsoluteFill>
  );
};

/** Darkness closing in around the hot point just before the flash. */
const PreDark: React.FC = () => {
  const frame = useCurrentFrame();
  const k = prog(frame, WAVE_HIT - 6, FLASH - 4) * (frame < FLASH ? 1 : 0);
  if (k <= 0) return null;
  const pose = poseAt(frame);
  const v = mkView(camOf(pose), ysqAt(frame));
  const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
  const x = p ? p.x : 960;
  const y = p ? p.y : 300;
  return <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}px ${y}px, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${120 + 300 * k}px, rgba(0,0,0,${0.7 * k}) ${500 + 400 * k}px)` }} />;
};

export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = ease.inOutQuad(prog(frame, 0, 14));
  const dim = 0.5 * (1 - ease.inOutQuad(prog(frame, 50, 92)));
  const sh = shake(frame, T0, 40, 34);
  const shK = Math.max(0, 1 - (frame - T0) / 34) * (frame >= T0 ? 1 : 0);
  const shW = sumShake(shake(frame, CLIMB, 12, 22), shake(frame, HERE, 22, 24), shake(frame, RING_T[0] - 4, 8, 14), shake(frame, RING_T[1] - 4, 10, 16));
  const rush = rushAt(frame);
  const rum = (noise1(frame * 0.9 + 3) - 0.5) * 9 * rush;
  const rum2 = (noise1(frame * 0.9 + 19) - 0.5) * 9 * rush;
  const pre = frame >= WAVE_HIT - 6 && frame < FLASH ? (noise1(frame * 1.3) - 0.5) * 16 * prog(frame, WAVE_HIT - 6, FLASH) : 0;
  const endFade = ease.inOutQuad(prog(frame, END - 40, END - 3));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {frame < FLASH ? (
        <AbsoluteFill style={{ opacity: inA, transform: `translate(${pre + shW.x + rum}px, ${pre * 0.6 + shW.y + rum2}px) rotate(${shW.r}rad)` }}>
          <World />
          <AbsoluteFill style={{ background: "#000", opacity: dim }} />
          <PreDark />
          <HereTag />
          <YearHud />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r * 0.12}rad) scale(${1 + 0.05 * shK * shK})` }}>
          <FinalField />
          <FinalTitle />
        </AbsoluteFill>
      )}
      <Flash at={CLIMB} dur={14} color={C.cyan} peak={0.22} />
      <Flash at={HERE} dur={10} color={C.gold} peak={0.2} />
      <ChapterCard index={8} title="指数的真相" en="THE EXPONENTIAL TRUTH" color={C.gold} dur={85} />
      <Captions accent={C.gold} items={CAPS} />
      <WhiteOut />
      <AbsoluteFill style={{ background: "#000", opacity: endFade }} />
    </AbsoluteFill>
  );
};
