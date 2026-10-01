import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, rgbOf, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, TAU } from "../lib/math";
import type { Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import {
  camOf,
  camSpeed,
  CLIMB,
  climbK,
  curveAt,
  END,
  FLASH,
  H0,
  H_HERE,
  HERE,
  IGNITE,
  MARK,
  MILESTONES,
  PASS,
  PASS_1947,
  poseAt,
  revealK,
  ribR,
  rushAt,
  settleK,
  S_END,
  S_HERE,
  SMP,
  sOfU,
  U_HERE,
  WAVE,
  yearAt,
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
      : u < 2013
        ? C.cyan
        : u < 2020
          ? mix(C.cyan, C.magenta, (u - 2013) / 7)
          : u < U_HERE
            ? mix(C.magenta, "#fff4fb", ((u - 2020) / (U_HERE - 2020)) * 0.9)
            : mix("#ffe2f4", "#fff1d6", clamp((u - U_HERE) / 4));
const LUT0 = 1940;
const LUT1 = 2032;
const LUT = Array.from({ length: 93 }, (_, i) => colAt(lerp(LUT0, LUT1, i / 92)));
const palAt = (u: number) => LUT[Math.round(clamp((u - LUT0) / (LUT1 - LUT0)) * 92)];
const S_COL = SMP.map((c) => colAt(c.u));
const S_HOT = S_COL.map((c) => mix(c, "#ffffff", 0.7));
const S_INT = SMP.map((c) => lerp(0.6, 1, ease.inOutQuad(clamp((c.u - 1990) / 26))));
const S_R = SMP.map((c) => ribR(c.h));
const I_WALL = SMP.findIndex((c) => c.u >= 2001);
const I_TOP = SMP.findIndex((c) => c.h >= H_HERE * 2.4);
/** Past the marker the curve dissolves into the unknown. */
const beyondA = (h: number, len: number) => (h <= H_HERE ? 1 : Math.exp(-(h - H_HERE) / len));

// =============================================================================================
// Timing.
const IGN_LEN = 112; // the ignition front races from 1946 to the top of the curve, accelerating
const litS = (f: number) => (f < IGNITE ? -1e9 : 1.5 + S_END * ease.inCubic(prog(f, IGNITE, IGNITE + IGN_LEN)));
const frameLit = (s: number) => IGNITE + IGN_LEN * Math.cbrt(clamp(s / S_END));
const W_END = S_HERE + 150;
const waveS = (f: number) => (f < WAVE ? -1e9 : lerp(-6, W_END, ease.inCubic(prog(f, WAVE, FLASH))));
const frameWave = (s: number) => WAVE + (FLASH - WAVE) * Math.cbrt(clamp((s + 6) / (W_END + 6)));
const WAVE_HIT = frameWave(S_HERE);

const CAPS = [
  { from: 90, to: 200, text: "所以，计算机并不是“突然”变强的。" },
  { from: 205, to: 320, text: "它是在80年里，一次又一次地翻倍。" },
  { from: 330, to: 480, text: "指数曲线的前半段平淡得让人忽略，后半段陡峭得让人震撼" },
  { from: 490, to: 605, text: "而我们，正站在这条曲线{{最陡峭的地方}}。" },
];
/** 0..1 while a caption is on screen: the world sinks into black under the caption band. */
const capA = (f: number) => Math.max(0, ...CAPS.map((c) => Math.min(clamp((f - c.from + 8) / 12), clamp((c.to + 8 - f) / 12))));

// =============================================================================================
// Projection with near-plane clipping.
type View = { cam: Cam; cyw: number; syw: number; cp: number; sp: number };
type Pt = { x: number; y: number; s: number; z: number };
const NEAR = 0.25;
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
// Scenery: pylons on the flat road, gates on the wall, dust, stars.
const PYL_TOP = 2.9;
const PYLONS = [
  { m: 0, x: -4.4 },
  { m: 1, x: 5.0 },
  { m: 2, x: -4.4 },
  { m: 3, x: 5.4 },
  { m: 4, x: -4.6 },
].map((d) => {
  const ms = MILESTONES[d.m];
  const s = sOfU(ms.year);
  const pass = d.m === 1 ? PASS_1947 : PASS[ms.year as keyof typeof PASS];
  return { ...ms, x: d.x, z: zOf(ms.year), rise: frameLit(Math.max(0, s)) + 3 + (d.m === 1 ? 3 : 0), pass };
});
const GATE_R = 6.2;
const GATES = [5, 6].map((m) => {
  const ms = MILESTONES[m];
  const s = sOfU(ms.year);
  return { ...ms, c: curveAt(s), rise: frameLit(s), pass: PASS[ms.year as keyof typeof PASS] };
});
const BEADS = Array.from({ length: 40 }, (_, k) => {
  const u = 1946 + 2 * k;
  const s = sOfU(u);
  return { u, s, c: curveAt(s), at: frameLit(s) };
});
const MOTES = Array.from({ length: 460 }, (_, i) => ({
  x: (hash(i * 5.31 + 2) - 0.5) * 34,
  y: -(0.12 + Math.pow(hash(i * 7.77 + 3), 1.7) * 7),
  z: -34 + hash(i * 3.17 + 1) * 168,
  r: hash(i * 1.9 + 5),
  tw: hash(i * 2.7 + 6) * 50,
}));
const S_SP0 = sOfU(2003);
const SPARKS = Array.from({ length: 1800 }, (_, i) => {
  const s = S_SP0 + hash(i * 3.71 + 11) * (S_HERE + 90 - S_SP0);
  const c = curveAt(s);
  const x = (hash(i * 5.13 + 12) - 0.5) * 32;
  const n = -1.5 + Math.pow(hash(i * 7.29 + 13), 1.25) * 17;
  return { x, y: Math.min(-0.2, -c.h - n * c.tz), z: c.z - n * c.th, u: c.u, r: hash(i * 1.3 + 14), tw: hash(i * 2.1 + 15) * 50 };
});
const STARS = Array.from({ length: 640 }, (_, i) => {
  const az = hash(i * 4.1 + 11) * TAU;
  const el = Math.asin(0.02 + 0.98 * hash(i * 6.3 + 12));
  return { d: [Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)] as V3, b: Math.pow(hash(i * 8.9 + 13), 3), tw: hash(i * 3.3 + 14) * 40 };
});
const STRANDS = Array.from({ length: 26 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const k = (i >> 1) + 1;
  return { x: side * (k * 0.92 + (hash(i * 3.3 + 90) - 0.5) * 0.3), a: 0.35 + 0.65 * hash(i * 5.1 + 91) };
});
const SHEET = 12.5;
const RUNG_STEP = 3.4;

// Sky grade by altitude.
const HOR: [number, string][] = [
  [0, "#2e1807"],
  [0.06, "#1b1631"],
  [0.3, "#0e1d46"],
  [0.65, "#240c44"],
  [1, "#2c0a36"],
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

// Reveal labels: screen offsets from each milestone node (staggered so nothing collides).
const REV_LBL: { dx: number; dy: number; align: CanvasTextAlign }[] = [
  { dx: 0, dy: -64, align: "center" },
  { dx: 0, dy: -150, align: "center" },
  { dx: 0, dy: -64, align: "center" },
  { dx: 0, dy: -64, align: "center" },
  { dx: -36, dy: -150, align: "right" },
  { dx: 44, dy: 26, align: "left" },
  { dx: 44, dy: 26, align: "left" },
];

// =============================================================================================
const drawWorld = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  const pose = poseAt(f);
  const cam = camOf(pose);
  const v = mkView(cam);
  const rush = rushAt(f);
  const kc = climbK(f);
  const rk = revealK(f);
  const ks = settleK(f) * (1 - rk);
  const bLen = lerp(22, 85, rk);
  const bA = (hh: number) => beyondA(hh, bLen);
  const prev = mkView(camOf(poseAt(f - 1.2 - 1.6 * rush)));
  const grade = clamp(-cam.y / H_HERE);
  const lit = litS(f);
  const wS = waveS(f);
  const labels: Lbl[] = [];
  const preA = prog(f, WAVE_HIT - 10, FLASH); // the build into the flash
  const dist = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.y, z - cam.z);
  // fog: near things crisp, the far wall hazy (but always present); none in the wide reveal
  const fog = (d: number) => lerp(Math.exp(-Math.max(0, d - 26) / 170), 1, rk);

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
    ctx.fillRect(-400, horizon, w + 800, Math.max(0, h + 400 - horizon));
  }
  // stars
  const starA = 1 - 0.65 * grade;
  for (const st of STARS) {
    const c = toCam(v, cam.x + st.d[0], cam.y + st.d[1], cam.z + st.d[2]);
    if (c[2] <= 0.05) continue;
    const q = scr(v, c);
    if (q.x < -60 || q.x > w + 60 || q.y < -60 || q.y > Math.min(h + 60, horizon - 4)) continue;
    const tw = 0.6 + 0.4 * Math.sin(f * 0.08 + st.tw);
    const a = (0.2 + 0.8 * st.b) * tw * clamp(-st.d[1] * 8) * starA;
    const r = 0.9 + st.b * 1.8;
    ctx.fillStyle = `rgba(225,232,255,${(a * 0.85).toFixed(3)})`;
    ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r);
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
  // the light of the future, high above the top of the curve
  {
    const p = proj(v, 0, -H_HERE * 2.3, Z_HERE + 8, 0.5);
    const a = 0.18 + 0.75 * ease.inQuad(grade) * (1 - 0.35 * rk) + 0.25 * rk + 1.2 * preA;
    if (p) {
      glow(ctx, p.x, p.y, 1300 + 700 * grade, C.magenta, 0.2 * a, 0.02);
      glow(ctx, p.x, p.y, 640 + 420 * grade, "#ffe6f6", 0.28 * a, 0.03);
    }
  }

  // high up, light pours down from where the curve is heading
  {
    const la = ease.inQuad(clamp((grade - 0.5) / 0.5)) * (1 - rk) + 0.5 * preA;
    if (la > 0.01) {
      const p = proj(v, 0, -H_HERE - 90, Z_HERE + 2, 0.5);
      const gx = p ? clamp(p.x, -200, w + 200) : w / 2;
      const gy = p ? clamp(p.y, -320, h) : -320;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 1300);
      g.addColorStop(0, withAlpha("#fff0fa", 0.7 * la));
      g.addColorStop(0.28, withAlpha("#ff9ae0", 0.3 * la));
      g.addColorStop(0.62, withAlpha(C.magenta, 0.07 * la));
      g.addColorStop(1, withAlpha(C.magenta, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-400, -400, w + 800, h + 800);
    }
  }

  // --- ground grid --------------------------------------------------------------------------------
  const gridPass = (step: number, ext: number, ahead: number, near: number, far: number, base: number, col: string) => {
    if (base <= 0.005) return;
    const buckets: Pt[][][] = [[], [], [], [], [], []];
    const x0 = Math.floor((cam.x - ext) / step) * step;
    const z0 = Math.floor((cam.z - ext * 0.3) / step) * step;
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
    gridPass(2, 48, 120, 4, 70, 0.3 * (1 - kc) * (1 - rk) + 0.12 * rk, gcol);
    gridPass(20, 520, 640, 30, 600, 0.2 * clamp(grade * 3 + rk + 0.4), gcol);
  }

  // --- the ribbon's reflection and light pools on the ground ----------------------------------------
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
  const LAYERS = [
    { m: 5.2, a: 0.03, lo: 7, hi: 230, hot: false },
    { m: 3.1, a: 0.045, lo: 5, hi: 160, hot: false },
    { m: 1.75, a: 0.09, lo: 3, hi: 104, hot: false },
    { m: 1.0, a: 0.3, lo: 1.8 + 3 * rk, hi: 70, hot: false },
    { m: 0.36, a: 0.95, lo: 0.9 + 1.3 * rk, hi: 24, hot: true },
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
    const calm = c.u > 2018 ? 1 - 0.6 * ks : 1; // at rest, the marker outshines the ribbon
    return S_INT[i] * fog(d) * beyond * front * waveBoost(c.s) * calm * (1 + 0.6 * preA);
  };
  const tubeCol = (i: number, hot: boolean) => {
    const c = SMP[i];
    if (wS > c.s && wS - c.s < 26) return "#ffffff";
    return hot ? S_HOT[i] : S_COL[i];
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
    // mirror image in the glossy ground
    drawTube(hg, tubePts(true, Math.min(sLit, sOfU(2008)), 1.2), (i, d) => tubeAlpha(i, d) * 0.4 * (1 - rk) * Math.exp(-SMP[i].h / 2.5), tubeCol, [1, 2, 3], 1);
  }

  // --- the area under the curve: a curtain of light falling to the ground --------------------------------
  if (lit > 0) {
    const K = 6;
    for (let i0 = 0; i0 < SMP.length - 1; i0 += K) {
      const i1 = Math.min(SMP.length - 1, i0 + K);
      const cm = SMP[(i0 + i1) >> 1];
      if (cm.s > sLit) break;
      if (cm.h > H_HERE * 2.4) break;
      const d = dist(0, -cm.h, cm.z);
      const a = 0.16 * S_INT[i0] * fog(d) * bA(cm.h) * clamp((sLit - cm.s) / 6) * waveBoost(cm.s) * (1 + 1.6 * rk);
      if (a < 0.006) continue;
      const top: V3[] = [];
      const bot: V3[] = [];
      let nearest = 1e9;
      for (let i = i0; i <= i1; i++) {
        top.push(toCam(v, 0, -SMP[i].h, SMP[i].z));
        bot.push(toCam(v, 0, 0, SMP[i].z));
        nearest = Math.min(nearest, top[top.length - 1][2], bot[bot.length - 1][2]);
      }
      if (nearest < 3) continue;
      const pt = proj(v, 0, -cm.h, cm.z, 0.6);
      const pb = proj(v, 0, 0, cm.z, 0.6);
      let style: string | CanvasGradient = withAlpha(S_COL[i0], a * 0.3);
      if (pt && pb && Math.hypot(pt.x - pb.x, pt.y - pb.y) > 1) {
        const g = ctx.createLinearGradient(pt.x, pt.y, pb.x, pb.y);
        g.addColorStop(0, withAlpha(S_COL[i0], a));
        g.addColorStop(0.3, withAlpha(S_COL[i0], a * 0.4));
        g.addColorStop(1, withAlpha(S_COL[i0], a * 0.06));
        style = g;
      }
      fillPoly(ctx, v, [...top, ...bot.reverse()], style);
    }
  }

  // --- the wall of light: the steep curve extruded sideways into a sheet -----------------------------------
  const wallA = (0.55 + 0.45 * ease.inOutQuad(prog(f, CLIMB - 40, CLIMB + 20))) * (1 - 0.7 * rk) * (1 + 0.8 * preA);
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
      const a = 0.04 * wallA * rise * bA(cm.h) * fog(dist(0, -cm.h, cm.z)) * (1 - 0.55 * ks);
      if (a < 0.004) continue;
      const L: V3[] = [];
      const R: V3[] = [];
      for (let i = i0; i <= i1; i++) {
        L.push(toCam(v, -SHEET, -SMP[i].h, SMP[i].z));
        R.push(toCam(v, SHEET, -SMP[i].h, SMP[i].z));
      }
      fillPoly(ctx, v, [...L, ...R.reverse()], withAlpha(S_COL[i0], a));
    }
    // strands
    for (const st of STRANDS) {
      const fall = Math.exp(-Math.abs(st.x) / 6) * st.a * wallA;
      for (let i0 = I_WALL; i0 < I_TOP; i0 += SK * 3) {
        const i1 = Math.min(I_TOP, i0 + SK * 3);
        const cm = SMP[(i0 + i1) >> 1];
        if (cm.s > sheetEnd) break;
        const d = dist(st.x, -cm.h, cm.z);
        const a = fall * clamp((cm.u - 2001) / 7) * bA(cm.h) * fog(d) * clamp(d / 2);
        if (a < 0.01) continue;
        const cs: V3[] = [];
        for (let i = i0; i <= i1; i += 3) cs.push(toCam(v, st.x, -SMP[i].h, SMP[i].z));
        cs.push(toCam(v, st.x, -SMP[i1].h, SMP[i1].z));
        const rs = runs(v, cs);
        if (!rs.length) continue;
        const sc = cam.f / Math.max(1, d);
        pathRuns(ctx, rs);
        ctx.strokeStyle = withAlpha(S_COL[i0], 0.18 * a);
        ctx.lineWidth = clamp(0.4 * sc, 2, 34);
        ctx.stroke();
        ctx.strokeStyle = withAlpha(S_HOT[i0], 0.75 * a);
        ctx.lineWidth = clamp(0.045 * sc, 1, 4);
        ctx.stroke();
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
      g.addColorStop(0.5, withAlpha(mix(col, "#ffffff", 0.3), a));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = clamp((0.07 * cam.f) / Math.max(1, d), 1, 6);
      pathRuns(ctx, rs);
      ctx.stroke();
    }
  }

  // --- pylons --------------------------------------------------------------------------------------------
  for (const py of PYLONS) {
    if (f <= py.rise) continue;
    const r = ease.outBack(clamp((f - py.rise) / 24));
    const top = PYL_TOP * r;
    const d = dist(py.x, -top / 2, py.z);
    const fa = fog(d) * (1 - 0.85 * rk);
    if (fa <= 0.01) continue;
    const pass = f - py.pass;
    const kick = pass >= 0 ? Math.exp(-pass / 9) : 0;
    const wv = f >= frameWave(sOfU(py.year)) ? Math.exp(-(f - frameWave(sOfU(py.year))) / 8) : 0;
    const boost = 1 + 1.4 * kick + 2 * wv;
    const tpc = toCam(v, py.x, -top, py.z);
    const tp = tpc[2] > NEAR ? scr(v, tpc) : null;
    // beam into the sky
    const sky = runs(v, [tpc, toCam(v, py.x, -top - 34, py.z)]);
    if (sky.length && tp) {
      const end = sky[0][sky[0].length - 1];
      const g = ctx.createLinearGradient(tp.x, tp.y, end.x, end.y);
      g.addColorStop(0, withAlpha(py.col, 0.3 * fa * Math.min(2, boost)));
      g.addColorStop(1, withAlpha(py.col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = clamp(0.22 * tp.s, 1.5, 22);
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
      ctx.strokeStyle = withAlpha(mix(py.col, "#ffffff", 0.55), 0.9 * fa * Math.min(1.5, boost));
      ctx.lineWidth = clamp(0.07 * sc, 1.4, 8);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    // ground ring + shockwave when it rises + pulse when the camera passes
    const ring = (R: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i <= 40; i++) out.push(toCam(v, py.x + Math.cos((i / 40) * TAU) * R, 0, py.z + Math.sin((i / 40) * TAU) * R));
      return out;
    };
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(py.col, 0.7 * fa);
    pathRuns(ctx, runs(v, ring(0.9)));
    ctx.stroke();
    const rt = f - py.rise;
    if (rt < 40) {
      ctx.strokeStyle = withAlpha(py.col, 0.8 * fa * (1 - rt / 40));
      ctx.lineWidth = 3;
      pathRuns(ctx, runs(v, ring(0.9 + rt * 0.22)));
      ctx.stroke();
    }
    const base = proj(v, py.x, 0, py.z, 0.6);
    if (base) {
      const sq = clamp(Math.abs(cam.y) / d + 0.06);
      const rp = 2.2 * base.s;
      ctx.globalAlpha = Math.min(1, 0.4 * fa * boost);
      ctx.drawImage(soft(py.col), base.x - rp, base.y - rp * sq, rp * 2, rp * 2 * sq);
      ctx.globalAlpha = 1;
    }
    if (tp) {
      glow(ctx, tp.x, tp.y, clamp(1.1 * tp.s, 8, 140) * (1 + 0.5 * kick + wv), py.col, 0.85 * fa * Math.min(1.6, boost));
      glow(ctx, tp.x, tp.y, clamp(0.3 * tp.s, 3, 30), "#ffffff", 0.9 * fa);
      const la = fa * ease.outCubic(prog(f, py.rise + 8, py.rise + 26)) * clamp((tp.s - 22) / 12);
      if (la > 0.02) {
        const size = clamp(0.66 * tp.s, 34, 66);
        labels.push({ x: tp.x, y: tp.y - clamp(0.5 * tp.s, 18, 46), size, year: String(py.year), text: py.label, col: py.col, a: la, align: "center" });
      }
    }
  }

  // --- the ribbon ------------------------------------------------------------------------------------------
  if (lit > 0) {
    const pts = tubePts(false, sLit, 1.0);
    drawTube(hg, pts, tubeAlpha, tubeCol, [0, 1, 2], 1.5);
    drawTube(ctx, pts, tubeAlpha, tubeCol, [3, 4], 1);
  }
  // doublings: a bead every two years
  for (const b of BEADS) {
    if (b.s > sLit) break;
    const p = proj(v, 0, -b.c.h, b.c.z, 0.8);
    if (!p || p.x < -100 || p.x > w + 100 || p.y < -100 || p.y > h + 100) continue;
    const d = p.z;
    const pop = Math.exp(-Math.max(0, f - b.at) / 10);
    const ii = SMP.findIndex((c) => c.s >= b.s);
    const a = S_INT[Math.max(0, ii)] * fog(d) * waveBoost(b.s) * (b.u > 2016 ? 0.45 * (1 - ks) : 1);
    const R = clamp(ribR(b.c.h) * 2.4 * p.s, 3, b.u > 2016 ? 40 : 90);
    glow(ctx, p.x, p.y, R * (1 + 1.5 * pop), palAt(b.u), 0.55 * a + 0.5 * pop);
    glow(ctx, p.x, p.y, R * 0.35, "#ffffff", 0.6 * a);
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
        ctx.strokeStyle = withAlpha(C.amber, 0.9 * Math.exp(-t / 14));
        ctx.lineWidth = 3;
        pathRuns(ctx, runs(v, rs));
        ctx.stroke();
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
      const a = lerp(0.6, 1, clamp((c.u - 1990) / 25)) * fog(head.z) * bA(c.h);
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
    if (c.s > sLit || f <= gt.rise) continue;
    const app = ease.outBack(clamp((f - gt.rise) / 22));
    const pass = f - gt.pass;
    const gone = 1 - clamp((pass - 14) / 16);
    const keep = Math.max(gone, 0) * (1 - rk);
    if (app <= 0 || keep <= 0.01) continue;
    const d = dist(0, -c.h, c.z);
    const fa = fog(d) * keep;
    const kick = pass >= 0 ? Math.exp(-pass / 8) : 0;
    const R = GATE_R * app;
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
    ctx.strokeStyle = withAlpha(gt.col, 0.16 * fa * (1 + kick));
    ctx.lineWidth = clamp(0.9 * sc, 3, 120);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(gt.col, 0.42 * fa * (1 + kick));
    ctx.lineWidth = clamp(0.25 * sc, 2, 40);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(mix(gt.col, "#ffffff", 0.55), Math.min(1, fa * (1 + kick)));
    ctx.lineWidth = clamp(0.06 * sc, 1.2, 10);
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
    if (pass >= 0 && pass < 30) {
      // the gate flares and its echo expands past the lens
      pathRuns(ctx, runs(v, ringPts(R + pass * 0.5)));
      ctx.strokeStyle = withAlpha("#ffffff", 0.7 * Math.exp(-pass / 7));
      ctx.lineWidth = clamp(0.15 * sc, 2, 30);
      ctx.stroke();
    }
    const lp = proj(v, R + 1.2, -c.h, c.z);
    if (lp && pass < 0) {
      const la = fa * clamp(app) * ease.outCubic(prog(f, gt.rise + 10, gt.rise + 28)) * clamp(-pass / 6) * clamp((lp.s - 16) / 10);
      if (la > 0.02) labels.push({ x: lp.x + 10, y: lp.y + 22, size: clamp(0.6 * lp.s, 36, 72), year: String(gt.year), text: gt.label, col: gt.col, a: la, align: "left" });
    }
  }

  // --- dust: motes over the flat road, sparks streaming past the wall -----------------------------------------
  const streak = (x: number, y: number, z: number, col: string, al: number, lwK: number) => {
    const a1 = toCam(v, x, y, z);
    if (a1[2] <= 0.4) return;
    const q1 = scr(v, a1);
    if (q1.x < -200 || q1.x > w + 200 || q1.y < -200 || q1.y > h + 200) return;
    const d = a1[2];
    const lw = clamp((lwK * cam.f) / d, 0.8, 4);
    const a0 = toCam(prev, x, y, z);
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
      streak(p.x, p.y, p.z, p.r > 0.7 ? "#ffe9c4" : C.gold, al, 0.035);
    }
  }
  if (lit > S_SP0) {
    const sa = (0.3 + 0.7 * ease.inOutQuad(prog(f, CLIMB - 30, CLIMB + 10))) * (1 - 0.75 * rk) * (1 + 0.6 * rush);
    for (const p of SPARKS) {
      const d = dist(p.x, p.y, p.z);
      const tw = 0.55 + 0.45 * Math.sin(f * 0.09 + p.tw);
      const al = (0.2 + 0.65 * p.r) * tw * fog(d) * sa * bA(-p.y) * clamp(d / 1.5) * clamp((95 - d) / 45);
      if (al < 0.02) continue;
      streak(p.x, p.y, p.z, mix(palAt(p.u), "#ffffff", 0.35), al, 0.04);
    }
  }

  // --- hyperspace: speed lines bursting out of the vanishing point while we race up the wall --------------
  if (rush > 0.02) {
    const col = palAt(yearAt(f));
    ctx.lineCap = "round";
    for (let i = 0; i < 110; i++) {
      const ang = hash(i * 3.1 + 200) * TAU;
      const sp = 0.6 + hash(i * 5.7 + 201) * 0.9;
      const ph = (hash(i * 7.3 + 202) + f * 0.03 * sp) % 1;
      const r0 = 70 + ph * ph * 1300;
      const len = (30 + 520 * ph * ph) * (0.4 + 0.6 * rush);
      const a = rush * 0.42 * Math.sin(ph * Math.PI) * (0.4 + 0.6 * hash(i * 9.1 + 203));
      if (a < 0.01) continue;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.5), a);
      ctx.lineWidth = 1 + 2.4 * ph;
      ctx.beginPath();
      ctx.moveTo(cam.cx + dx * r0, cam.cy + dy * r0);
      ctx.lineTo(cam.cx + dx * (r0 + len), cam.cy + dy * (r0 + len));
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    glow(ctx, cam.cx, cam.cy, 700, mix(col, "#ffffff", 0.4), 0.22 * rush, 0.03);
  }

  // --- the doubling wave ----------------------------------------------------------------------------------
  if (wS > -5) {
    for (let k = 0; k < 14; k++) {
      const s = wS - k * 3;
      if (s < 0 || s > S_END) continue;
      const c = curveAt(s);
      const p = proj(v, 0, -c.h, c.z, 0.8);
      if (!p) continue;
      const fall = Math.exp(-k / 4);
      glow(ctx, p.x, p.y, clamp(5 * p.s, 40, 380) * (0.5 + 0.5 * fall), k < 2 ? "#ffffff" : palAt(c.u), 0.85 * fall * bA(c.h) + 0.15 * fall);
    }
  }

  // --- reveal: the whole history on the curve ------------------------------------------------------------------
  if (rk > 0.02) {
    const la = ease.outCubic(prog(rk, 0.7, 0.97));
    MILESTONES.forEach((ms, k) => {
      const s = sOfU(ms.year);
      const c = curveAt(s);
      const p = proj(v, 0, -c.h, c.z, 0.8);
      if (!p) return;
      const fw = frameWave(s);
      const wv = f >= fw ? Math.exp(-(f - fw) / 10) : 0;
      glow(ctx, p.x, p.y, 20 + 46 * wv, ms.col, 0.95 * rk);
      glow(ctx, p.x, p.y, 6 + 10 * wv, "#ffffff", rk);
      if (la <= 0.01) return;
      const L = REV_LBL[k];
      const ex = p.x + L.dx;
      const ey = p.y + L.dy;
      ctx.strokeStyle = withAlpha(ms.col, 0.8 * la);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (L.align === "center") {
        ctx.moveTo(p.x, p.y - 12);
        ctx.lineTo(p.x, ey + 8);
      } else {
        ctx.moveTo(p.x + Math.sign(L.dx) * 12, p.y);
        ctx.lineTo(ex, ey - 12);
      }
      ctx.stroke();
      labels.push({ x: ex, y: ey, size: 32, year: String(ms.year), text: ms.label, col: ms.col, a: la, align: L.align, fixed: true });
    });
  }

  // --- you are here -----------------------------------------------------------------------------------------
  if (f > HERE - 16 && f < FLASH) {
    const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
    if (p) {
      const a = ease.outCubic(prog(f, HERE - 14, HERE + 6));
      const pulse = 0.8 + 0.2 * Math.sin((f - HERE) * 0.2);
      const hit = f >= WAVE_HIT ? f - WAVE_HIT : -1;
      const R = clamp(2.2 * p.s, 46, 150);
      glow(ctx, p.x, p.y, R * 2.4 * pulse * (1 + (hit >= 0 ? hit * 0.5 : 0)), C.gold, 0.5 * a, 0.1);
      glow(ctx, p.x, p.y, R * 0.75 * pulse, C.gold, 0.85 * a);
      glow(ctx, p.x, p.y, R * 0.2, "#ffffff", a);
      for (let k = 0; k < 3; k++) {
        const tt = f - HERE + k * 18;
        if (tt < 0) continue;
        const t = (tt % 54) / 54;
        ctx.strokeStyle = withAlpha(C.gold, 0.95 * (1 - t) * a);
        ctx.lineWidth = 5 * (1 - t) + 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R * 0.4 + t * R * 1.8, 0, TAU);
        ctx.stroke();
      }
      // target brackets
      const br = R * 0.85 * (1 + 0.6 * (1 - ease.outExpo(prog(f, HERE - 10, HERE + 14))));
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
    }
  }
  // pre-flash: light pours out of the top of the curve
  if (preA > 0) {
    const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
    const x = p ? p.x : w / 2;
    const y = p ? p.y : 0;
    glow(ctx, x, y, 260 + 2600 * ease.inQuad(preA), "#ffffff", 0.95 * preA, 0.18);
    glow(ctx, x, y, 200 + 1500 * preA, C.gold, 0.6 * preA, 0.05);
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

  bloom(ctx, w, h, lerp(0.6, 0.95, grade) * (1 - 0.25 * rk) * (1 - 0.3 * ks) + 0.25 * rush + 0.8 * preA);

  // --- labels (after bloom, crisp) -------------------------------------------------------------------------
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(pose.roll);
  ctx.translate(-w / 2, -h / 2);
  ctx.globalCompositeOperation = "source-over";
  labels.sort((a, b) => b.size - a.size);
  const placed: [number, number, number, number][] = [];
  for (const L of labels) {
    const wEst = L.size * Math.max(2.5, L.text.length * 0.8);
    const bx0 = L.align === "center" ? L.x - wEst / 2 : L.align === "right" ? L.x - wEst : L.x;
    const box: [number, number, number, number] = [bx0 - 10, L.y - L.size * 1.95 - 6, bx0 + wEst + 10, L.y + 10];
    if (!L.fixed) {
      if (placed.some((q) => q[0] < box[2] && box[0] < q[2] && q[1] < box[3] && box[1] < q[3])) continue;
      placed.push(box);
    }
    const xl = L.align === "center" ? L.x - wEst / 2 : L.align === "right" ? L.x - wEst : L.x;
    const safe = clamp((xl - 64) / 60) * clamp((w - 64 - (xl + wEst)) / 60) * clamp((L.y - L.size * 1.9 - 64) / 50) * clamp((780 - L.y) / 40);
    const a = L.a * safe * (1 - clamp(preA * 1.6));
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    ctx.textAlign = L.align;
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 14;
    ctx.font = `800 ${Math.round(L.size)}px ${FONT_MONO}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(L.year, L.x, L.y - L.size * 0.92);
    ctx.font = `700 ${Math.round(L.size * 0.78)}px ${FONT_CN}`;
    const [lr, lg, lb] = rgbOf(L.col);
    ctx.fillStyle = mix(L.col, "#ffffff", 0.2126 * lr + 0.7152 * lg + 0.0722 * lb < 150 ? 0.5 : 0.25); // dark hues lifted for legibility
    ctx.fillText(L.text, L.x, L.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // keep the caption band calm
  const ca = capA(f);
  if (ca > 0) {
    const g = ctx.createLinearGradient(0, 740, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, `rgba(0,0,0,${0.84 * ca})`);
    g.addColorStop(1, `rgba(0,0,0,${0.96 * ca})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 740, w, h - 740);
  }
};

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
/** "我们在这里 · YOU ARE HERE" tag pinned to the marker. */
const HereTag: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < HERE - 6 || frame >= FLASH) return null;
  const pose = poseAt(frame);
  const v = mkView(camOf(pose));
  const p = proj(v, MARK[0], MARK[1], MARK[2], 0.8);
  if (!p) return null;
  const edge = clamp((p.y - 120) / 50) * clamp((1300 - p.x) / 80);
  const a = ease.outCubic(prog(frame, HERE - 2, HERE + 14)) * (1 - prog(frame, WAVE_HIT - 12, WAVE_HIT - 3)) * edge;
  if (a <= 0) return null;
  const line = ease.outExpo(prog(frame, HERE, HERE + 18));
  const c = Math.cos(pose.roll);
  const s = Math.sin(pose.roll);
  const rx = 960 + (p.x - 960) * c - (p.y - 540) * s;
  const ry = 540 + (p.x - 960) * s + (p.y - 540) * c;
  const R = clamp(2.2 * p.s, 46, 150) * 0.55;
  const dx = R + 70;
  const dy = ry < 230 ? 34 : -34;
  const tIn = ease.outCubic(prog(frame, HERE + 6, HERE + 22));
  const lx = rx + R * 0.7;
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <polyline
          points={`${lx},${ry + (dy > 0 ? 6 : -6)} ${lx + (dx - R * 0.7) * line},${ry + dy * line} ${rx + dx + 470 * line},${ry + dy}`}
          stroke={C.gold}
          strokeWidth={2.5}
          fill="none"
          style={{ filter: `drop-shadow(0 0 6px ${C.gold})` }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: rx + dx + 8,
          top: dy > 0 ? ry + dy + 10 : ry + dy - 70,
          whiteSpace: "nowrap",
          opacity: tIn,
          transform: `translateX(${(1 - tIn) * -18}px)`,
          display: "flex",
          alignItems: "baseline",
          gap: 16,
        }}
      >
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 50, color: "#fff", textShadow: `0 0 24px ${C.gold}, 0 2px 10px #000, 0 0 30px #000` }}>我们在这里</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: C.gold, letterSpacing: "0.2em", textShadow: "0 2px 8px #000, 0 0 18px #000" }}>· YOU ARE HERE</span>
      </div>
    </AbsoluteFill>
  );
};

/** Year readout while flying (interpolates between the milestone years). */
const YearHud: React.FC = () => {
  const frame = useCurrentFrame();
  const year = Math.floor(clamp(yearAt(frame), 1946, 2022));
  const a = ease.outCubic(prog(frame, PASS[1946] - 22, PASS[1946] - 4)) * (1 - prog(frame, PASS[2022] + 4, PASS[2022] + 20));
  if (a <= 0) return null;
  const v = camSpeed(frame);
  return (
    <div style={{ position: "absolute", right: 104, top: 76, textAlign: "right", opacity: a, fontFamily: FONT_MONO }}>
      <div style={{ fontSize: 20, letterSpacing: "0.42em", color: withAlpha(C.gold, 0.85), textShadow: "0 0 10px #000" }}>YEAR</div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1.05,
          textShadow: `0 0 ${16 + 20 * clamp(v - 0.6)}px ${palAt(year)}, 0 2px 8px #000`,
        }}
      >
        {year}
      </div>
      <div style={{ marginTop: 8, marginLeft: "auto", height: 3, width: 180, background: "rgba(255,255,255,0.12)" }}>
        <div style={{ height: "100%", width: `${((year - 1946) / (2022 - 1946)) * 100}%`, marginLeft: "auto", background: `linear-gradient(90deg, ${C.amber}, ${palAt(year)})`, boxShadow: `0 0 10px ${palAt(year)}` }} />
      </div>
    </div>
  );
};

// =============================================================================================
// Final title.
const EMBERS = Array.from({ length: 460 }, (_, i) => ({
  x: hash(i * 2.13 + 70),
  y: hash(i * 4.71 + 71),
  sp: 0.25 + hash(i * 6.2 + 72) * 0.9,
  r: 1 + Math.pow(hash(i * 8.3 + 73), 3) * 4.5,
  c: [C.gold, C.cyan, C.magenta, C.amber, "#ffffff"][i % 5],
  tw: hash(i * 9.9 + 74) * 30,
  drift: hash(i * 1.37 + 75) - 0.5,
}));
const SPARKS2 = Array.from({ length: 700 }, (_, i) => ({
  a: hash(i * 2.9 + 80) * TAU,
  v: 8 + hash(i * 4.1 + 81) * 44,
  drag: 0.035 + hash(i * 6.7 + 82) * 0.03,
  life: 26 + hash(i * 8.8 + 83) * 70,
  c: [C.gold, C.cyan, C.magenta, "#ffffff"][i % 4],
  r: hash(i * 1.1 + 84),
}));
/** Faint exponential behind the title: low along the bottom, shooting up at the far right. */
const expPt = (t: number, w: number, h: number): [number, number] => [lerp(-30, w * 0.95, t), h * 0.9 - ((Math.exp(t * 9) - 1) / (Math.exp(9) - 1)) * (h * 1.05)];
const FCX = 960;
const FCY = 440;

const FinalField: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const t = f - FLASH;
      if (t < 0) return;
      const bg = ctx.createRadialGradient(FCX, FCY, 0, FCX, FCY, w * 0.8);
      bg.addColorStop(0, "#0d0714");
      bg.addColorStop(1, "#010103");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const settle = Math.exp(-t / 36);
      glow(ctx, FCX, FCY, 1000 + 600 * settle, C.amber, 0.1 + 0.4 * settle, 0.02);
      glow(ctx, FCX, FCY, 620, C.magenta, 0.07 + 0.25 * settle, 0.02);
      // god rays out of the flash
      ctx.save();
      ctx.translate(FCX, FCY);
      ctx.rotate(t * 0.0016);
      const rayA = 0.16 * Math.exp(-t / 34) + 0.028;
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * TAU + hash(i * 3.3) * 0.12;
        const wd = 0.008 + hash(i * 7.1) * 0.024;
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 1400, Math.sin(a) * 1400);
        const col = mix(C.gold, C.magenta, hash(i * 2.9));
        g.addColorStop(0, withAlpha(col, rayA));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 1400, a - wd, a + wd);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // shockwaves
      for (let k = 0; k < 4; k++) {
        const tt = t - 2 - k * 3;
        if (tt < 0) continue;
        const r = 80 + tt * (96 - k * 12) * Math.exp(-tt / 70);
        const a = Math.exp(-tt / (7 + k * 2.5));
        if (a < 0.01) continue;
        ctx.strokeStyle = withAlpha([C.gold, C.cyan, C.magenta, "#ffffff"][k], 0.85 * a);
        ctx.lineWidth = 2 + 14 * a;
        ctx.beginPath();
        ctx.ellipse(FCX, FCY, r, r * 0.56, 0, 0, TAU);
        ctx.stroke();
      }
      // spark burst
      if (t < 100) {
        for (const p of SPARKS2) {
          const life = Math.exp(-t / p.life);
          if (life < 0.03) continue;
          const d = (p.v / p.drag) * (1 - Math.exp(-p.drag * t));
          const x = FCX + Math.cos(p.a) * d * 1.35;
          const y = FCY + Math.sin(p.a) * d * 0.8 + t * t * 0.003 * p.r;
          glow(ctx, x, y, 2 + 6 * p.r * life + 1.5, p.c, life);
        }
      }
      // the curve, echoed
      const draw = ease.inOutCubic(prog(f, FLASH + 26, FLASH + 104));
      if (draw > 0) {
        const n = 140;
        ctx.lineCap = "round";
        for (const [lw, al] of [
          [12, 0.04],
          [4.5, 0.1],
          [1.6, 0.36],
        ] as const) {
          ctx.lineWidth = lw;
          for (let i = 0; i < n * draw; i++) {
            const [x0, y0] = expPt(i / n, w, h);
            const [x1, y1] = expPt(Math.min(draw, (i + 1) / n), w, h);
            ctx.strokeStyle = withAlpha(palAt(lerp(1990, 2026, i / n)), al);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
        const [hx, hy] = expPt(draw, w, h);
        if (hy > -40 && draw < 1) {
          glow(ctx, hx, hy, 70, C.gold, 0.55);
          glow(ctx, hx, hy, 16, "#ffffff", 0.9);
        }
      }
      // drifting particle field
      for (const e of EMBERS) {
        const span = h + 100;
        const y = ((((e.y * span - t * e.sp) % span) + span) % span) - 50;
        const x = e.x * w + Math.sin(t * 0.012 + e.tw) * 26 * e.drift;
        const burst = Math.exp(-t / 16);
        const bx = FCX + (x - FCX) * (1 - 0.45 * burst);
        const by = FCY + (y - FCY) * (1 - 0.45 * burst);
        const a = (0.22 + 0.4 * Math.sin(t * 0.06 + e.tw) ** 2) * clamp((t - 4) / 14);
        glow(ctx, bx, by, e.r * 2.3, e.c, a);
      }
      // anamorphic streak left by the flash
      const sa = Math.exp(-t / 20);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, withAlpha(C.cyan, 0));
      g.addColorStop(0.5, withAlpha("#ffffff", 0.75 * sa));
      g.addColorStop(1, withAlpha(C.cyan, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, FCY - 2 - 9 * sa, w, 4 + 18 * sa);
      ctx.globalCompositeOperation = "source-over";
    }}
  />
);

const FinalTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - FLASH;
  if (t < 0) return null;
  const e = ease.outExpo(clamp(t / 34));
  const sc = 1.32 - 0.32 * e + 0.035 * prog(frame, FLASH, END);
  const ab = 30 * Math.exp(-t / 11);
  const blur = 10 * (1 - ease.outCubic(clamp(t / 22)));
  const sub = ease.outCubic(prog(frame, FLASH + 44, FLASH + 76));
  const lineT = ease.inOutCubic(prog(frame, FLASH + 30, FLASH + 74));
  const sweep = prog(frame, FLASH + 82, FLASH + 122);
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
        <div style={{ ...base, color: C.red, transform: `translateX(${-ab}px)`, mixBlendMode: "screen", opacity: 0.8 * clamp(ab / 5) }}>{words}</div>
        <div style={{ ...base, color: C.cyan, transform: `translateX(${ab}px)`, mixBlendMode: "screen", opacity: 0.8 * clamp(ab / 5) }}>{words}</div>
        <div style={{ ...base, color: "#fff", textShadow: `0 0 30px ${C.amber}, 0 0 80px rgba(255,120,40,0.55), 0 4px 18px rgba(0,0,0,0.6)` }}>
          从真空管到
          <span
            style={{
              fontFamily: FONT_MONO,
              letterSpacing: 0,
              background: `linear-gradient(100deg, ${C.gold}, ${C.magenta} 50%, ${C.cyan})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "none",
              filter: `drop-shadow(0 0 18px ${withAlpha(C.magenta, 0.85)}) drop-shadow(0 0 4px rgba(0,0,0,0.6))`,
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

/** The biggest flash of the film: a short ramp, an 8-frame whiteout, then a long decay. */
const WhiteOut: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - FLASH;
  let a = 0;
  if (t < 0) a = 0.9 * ease.inCubic(clamp((t + 5) / 5));
  else if (t < 8) a = 1;
  else a = Math.exp(-(t - 8) / 7.5);
  if (a <= 0.003) return null;
  return <AbsoluteFill style={{ background: "#fff", opacity: a }} />;
};

export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = ease.inOutQuad(prog(frame, 0, 14));
  const dim = 0.5 * (1 - ease.inOutQuad(prog(frame, 50, 92)));
  const sh = shake(frame, FLASH, 40, 36);
  const shK = Math.max(0, 1 - (frame - FLASH) / 36);
  const shC = shake(frame, CLIMB, 12, 22);
  const rush = rushAt(frame);
  const rum = (noise1(frame * 0.9 + 3) - 0.5) * 7 * rush;
  const rum2 = (noise1(frame * 0.9 + 19) - 0.5) * 7 * rush;
  const pre = frame >= WAVE_HIT - 10 && frame < FLASH ? (noise1(frame * 1.3) - 0.5) * 18 * prog(frame, WAVE_HIT - 10, FLASH) : 0;
  const endFade = ease.inOutQuad(prog(frame, END - 40, END - 3));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {frame < FLASH ? (
        <AbsoluteFill style={{ opacity: inA, transform: `translate(${pre + shC.x + rum}px, ${pre * 0.6 + shC.y + rum2}px)` }}>
          <World />
          <AbsoluteFill style={{ background: "#000", opacity: dim }} />
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
      <ChapterCard index={8} title="指数的真相" en="THE EXPONENTIAL TRUTH" color={C.gold} dur={85} />
      <Captions accent={C.gold} items={CAPS} />
      <WhiteOut />
      <AbsoluteFill style={{ background: "#000", opacity: endFade }} />
    </AbsoluteFill>
  );
};
