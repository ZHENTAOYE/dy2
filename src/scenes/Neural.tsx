import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, hash2, lerp, noise1, prog, rng, shake, TAU } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash, YearStamp } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

// ---------------------------------------------------------------------------------------------
// Timing
const DUR = sceneDuration("neural");
const PERC = cue("neural", "perceptron");
const FREEZE = cue("neural", "freeze");
const FLOOD = cue("neural", "flood");
const SHATTER = cue("neural", "shatter");
const IMNET = cue("neural", "imagenet");
const FIRES = ticks("neural", "fire");

const LV = "#b69cff"; // light violet (readable accent)
const ICE = "#dcefff";
const ICE_GREY = "#8ea4ba";
const HOT = "#d24dff"; // re-warmed violet-magenta
const W = 1920;
const H = 1080;

/** 0 = normal, 1 = frozen (AI winter). */
const coldAt = (f: number) =>
  ease.inOutCubic(prog(f, FREEZE, FREEZE + 70)) * (1 - ease.outCubic(prog(f, FLOOD + 4, SHATTER + 24)));
/** 0 = normal, 1 = re-warmed by the data flood. */
const warmAt = (f: number) => ease.outCubic(prog(f, FLOOD + 6, SHATTER + 40));
/** ImageNet mosaic presence. */
const imAt = (f: number) => ease.inOutCubic(prog(f, IMNET, IMNET + 30));

// ---------------------------------------------------------------------------------------------
// The perceptron (local coordinates, Σ at the origin)
const HOME = { x: 900, y: 480 };
const IN_X = -500;
const IN_Y = [-180, -60, 60, 180];
const WTS = [1.0, 0.36, 0.7, 0.16];
const R_IN = 36;
const R_SUM = 92;
const STEP_X = 290;
const STEP_W = 150;
const STEP_H = 116;
const OUT_X = 532;
const R_OUT = 46;
const ARROW_END = 700;

/** Where the perceptron sits: centre stage, then it rises to the horizon above the ImageNet plane. */
const viewAt = (f: number) => {
  const k = ease.inOutCubic(prog(f, IMNET + 2, IMNET + 46));
  return { ox: lerp(HOME.x, 935, k), oy: lerp(HOME.y, 214, k), sc: lerp(1, 0.3, k) };
};

const L_OF = FIRES.map((t, k) => (k === 0 ? 30 : clamp(0.85 * (t - FIRES[k - 1]), 8, 30)));
const RESUME = FIRES.findIndex((t) => t > FREEZE); // the cycle that freezes mid-flight and fires after the thaw
const FROZEN_START = FREEZE + 2;
const FROZEN_L = 30;
const THAW = SHATTER + 2;
/** Progress of the cycle caught by the freeze: it slows down and stops. */
const frozenP = (f: number) => {
  let s = 0;
  const end = Math.min(f, THAW);
  for (let x = FROZEN_START; x < end; x++) s += Math.pow(1 - prog(x, FROZEN_START, FROZEN_START + 40), 2);
  return s / FROZEN_L;
};
const P_FROZEN = frozenP(THAW);

/** The signal cycle in flight at frame f: p runs 0..1 and the output fires at p = 1. */
const pulseAt = (f: number): { p: number; k: number } | null => {
  for (let k = 0; k < FIRES.length; k++) {
    const t = FIRES[k];
    if (t < f) continue;
    if (k === RESUME) {
      if (f < FROZEN_START) return null;
      if (f < THAW) return { p: frozenP(f), k };
      return { p: lerp(P_FROZEN, 1, ease.inQuad(prog(f, THAW, t))), k };
    }
    const s = t - L_OF[k];
    if (f < s) return null;
    return { p: (f - s) / L_OF[k], k };
  }
  return null;
};
const sinceFire = (f: number) => {
  let last = -1e9;
  for (const t of FIRES) if (t <= f) last = t;
  return f - last;
};
const actOf = (k: number, i: number) => 0.5 + 0.5 * hash(k * 7.31 + i * 2.17 + 0.4);

const lineEnds = (i: number) => {
  const dx = -IN_X;
  const dy = -IN_Y[i];
  const l = Math.hypot(dx, dy);
  const ux = dx / l;
  const uy = dy / l;
  return { x0: IN_X + ux * R_IN, y0: IN_Y[i] + uy * R_IN, x1: -ux * R_SUM, y1: -uy * R_SUM };
};

/** Step curve inside the threshold box, param t in 0..1. */
const stepPt = (t: number) => {
  const a = -STEP_W / 2 + 18;
  const b = STEP_W / 2 - 18;
  const lo = 28;
  const hi = -28;
  // polyline: (a,lo) -> (STEP_X,lo) -> (STEP_X,hi) -> (b,hi); lengths
  const l1 = -a;
  const l2 = lo - hi;
  const l3 = b;
  const L = l1 + l2 + l3;
  let d = t * L;
  if (d < l1) return { x: STEP_X + a + d, y: lo };
  d -= l1;
  if (d < l2) return { x: STEP_X, y: lo - d };
  d -= l2;
  return { x: STEP_X + d, y: hi };
};

const sphere = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, lit: number, gI: number) => {
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, x, y, r * (2.3 + 1.6 * lit), col, (0.18 + 0.45 * lit) * gI);
  ctx.globalCompositeOperation = "source-over";
  const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.08, x, y, r);
  g.addColorStop(0, mix(col, "#ffffff", 0.45 + 0.45 * lit));
  g.addColorStop(0.55, mix(col, "#05020c", 0.45 - 0.25 * lit));
  g.addColorStop(1, mix(col, "#05020c", 0.82));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.5), 0.85);
  ctx.lineWidth = 2.5;
  ctx.stroke();
};

/** Ice needles growing on a node rim. */
const needles = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, seed: number, cold: number) => {
  if (cold <= 0.02) return;
  ctx.strokeStyle = withAlpha(ICE, 0.6 * cold);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = hash(seed * 31.7 + i * 3.3) * TAU;
    const len = (5 + 16 * hash(seed * 7.9 + i * 1.1)) * cold;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.moveTo(x + ca * r, y + sa * r);
    ctx.lineTo(x + ca * (r + len), y + sa * (r + len));
    // side barbs at 60 degrees
    const bx = x + ca * (r + len * 0.55);
    const by = y + sa * (r + len * 0.55);
    for (const s of [-1, 1]) {
      const b = a + s * (Math.PI / 3);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(b) * len * 0.35, by + Math.sin(b) * len * 0.35);
    }
  }
  ctx.stroke();
};

const drawPerceptron = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < PERC - 2) return;
  const cold = coldAt(f);
  const warm = warmAt(f);
  const v = viewAt(f);
  const base = mix(mix(C.violet, ICE_GREY, cold), HOT, warm);
  const light = mix(mix(LV, "#d8e6f2", cold), "#ffb6f6", warm);
  const gI = (1 - 0.62 * cold) * (1 + 0.85 * warm);
  const P = pulseAt(f);
  const since = sinceFire(f);
  const fireE = Math.exp(-since / 7);
  const flow = warm * ease.outCubic(prog(f, FIRES[FIRES.length - 1] + 4, FIRES[FIRES.length - 1] + 24));

  const bIn = (i: number) => ease.outBack(clamp((f - PERC - i * 5) / 14));
  const bLine = (i: number) => ease.outCubic(clamp((f - PERC - 12 - i * 4) / 22));
  const bSum = ease.outBack(clamp((f - PERC - 20) / 18));
  const bL1 = ease.outCubic(clamp((f - PERC - 34) / 14));
  const bStep = ease.outBack(clamp((f - PERC - 40) / 16));
  const bL2 = ease.outCubic(clamp((f - PERC - 50) / 12));
  const bOut = ease.outBack(clamp((f - PERC - 56) / 14));
  const bArrow = ease.outCubic(clamp((f - PERC - 64) / 12));

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.sc, v.sc);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // warm halo behind everything once the data arrives
  if (warm > 0) {
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, 60, 0, 900, HOT, 0.16 * warm + 0.1 * fireE * warm, 0.02);
    glow(ctx, 0, 0, 420, C.magenta, 0.2 * warm, 0.05);
    ctx.globalCompositeOperation = "source-over";
  }

  // weighted connections: width = weight
  for (let i = 0; i < 4; i++) {
    const t = bLine(i);
    if (t <= 0) continue;
    const { x0, y0, x1, y1 } = lineEnds(i);
    const xe = lerp(x0, x1, t);
    const ye = lerp(y0, y1, t);
    const wv = WTS[i];
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(base, 0.13 * gI);
    ctx.lineWidth = 6 + 22 * wv;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(xe, ye);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = mix(base, "#0a0614", 0.45);
    ctx.lineWidth = 2 + 11 * wv;
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(light, 0.75 + 0.2 * warm);
    ctx.lineWidth = 1 + 3 * wv;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  // links Σ -> step -> output -> arrow
  const link = (xa: number, xb: number, t: number, wd: number) => {
    if (t <= 0) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(base, 0.15 * gI);
    ctx.lineWidth = wd * 5;
    ctx.beginPath();
    ctx.moveTo(xa, 0);
    ctx.lineTo(lerp(xa, xb, t), 0);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(light, 0.85);
    ctx.lineWidth = wd;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  };
  link(R_SUM, STEP_X - STEP_W / 2, bL1, 4);
  link(STEP_X + STEP_W / 2, OUT_X - R_OUT, bL2, 4);
  if (bArrow > 0) {
    link(OUT_X + R_OUT + 6, ARROW_END, bArrow, 4);
    const ax = lerp(OUT_X + R_OUT + 6, ARROW_END, bArrow);
    ctx.fillStyle = withAlpha(light, 0.95);
    ctx.beginPath();
    ctx.moveTo(ax + 6, 0);
    ctx.lineTo(ax - 16, -12);
    ctx.lineTo(ax - 16, 12);
    ctx.closePath();
    ctx.fill();
  }

  // continuous "learning" flow once the data is in
  if (flow > 0) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const { x0, y0, x1, y1 } = lineEnds(i);
      for (let j = 0; j < 4; j++) {
        const q = (f * 0.045 * (1 + 0.3 * i) + j / 4 + i * 0.13) % 1;
        glow(ctx, lerp(x0, x1, q), lerp(y0, y1, q), 16 + 22 * WTS[i], light, 0.7 * flow * Math.sin(Math.PI * q));
      }
    }
    for (let j = 0; j < 5; j++) {
      const q = (f * 0.05 + j / 5) % 1;
      glow(ctx, lerp(R_SUM, ARROW_END, q), 0, 20, light, 0.6 * flow * Math.sin(Math.PI * q));
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // input nodes
  for (let i = 0; i < 4; i++) {
    const t = bIn(i);
    if (t <= 0) continue;
    let lit = 0.25;
    if (P) lit = Math.max(lit, actOf(P.k, i) * (1 - prog(P.p, 0.15, 0.6) * 0.6));
    lit = Math.max(lit, flow * 0.8);
    sphere(ctx, IN_X, IN_Y[i], R_IN * t, base, lit, gI);
    needles(ctx, IN_X, IN_Y[i], R_IN, 12, i + 1, cold);
  }

  // pulses travelling along the weighted lines
  if (P) {
    const q = clamp(P.p / 0.6);
    if (P.p < 0.66) {
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const { x0, y0, x1, y1 } = lineEnds(i);
        const a = actOf(P.k, i) * (1 - prog(P.p, 0.58, 0.66));
        const x = lerp(x0, x1, q);
        const y = lerp(y0, y1, q);
        const qt = Math.max(0, q - 0.16);
        const trail = ctx.createLinearGradient(lerp(x0, x1, qt), lerp(y0, y1, qt), x, y);
        trail.addColorStop(0, withAlpha(light, 0));
        trail.addColorStop(1, withAlpha(light, 0.85 * a));
        ctx.strokeStyle = trail;
        ctx.lineWidth = 3 + 7 * WTS[i];
        ctx.beginPath();
        ctx.moveTo(lerp(x0, x1, qt), lerp(y0, y1, qt));
        ctx.lineTo(x, y);
        ctx.stroke();
        glow(ctx, x, y, (50 + 50 * WTS[i]) * (0.6 + 0.4 * a), base, 0.35 * a * gI);
        glow(ctx, x, y, (18 + 30 * WTS[i]) * (0.6 + 0.4 * a), light, a * (0.55 + 0.45 * gI));
        glow(ctx, x, y, 6 + 6 * WTS[i], "#ffffff", a * (0.6 + 0.4 * (1 - cold)));
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // Σ node
  if (bSum > 0) {
    const acc = P ? ease.outCubic(prog(P.p, 0.5, 0.62)) * (1 - prog(P.p, 0.74, 0.92)) : 0;
    const lit = Math.max(0.2 + 0.7 * acc, 0.85 * flow, 0.35 * fireE * warm);
    sphere(ctx, 0, 0, R_SUM * bSum, base, lit, gI);
    needles(ctx, 0, 0, R_SUM, 22, 9, cold);
    // Σ glyph
    const s = bSum;
    ctx.save();
    ctx.scale(s, s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const sigma = () => {
      ctx.beginPath();
      ctx.moveTo(26, -32);
      ctx.lineTo(-24, -32);
      ctx.lineTo(4, 0);
      ctx.lineTo(-24, 32);
      ctx.lineTo(26, 32);
    };
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(light, 0.25 + 0.3 * lit);
    ctx.lineWidth = 16;
    sigma();
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = mix(light, "#ffffff", 0.4 + 0.5 * lit);
    ctx.lineWidth = 7;
    sigma();
    ctx.stroke();
    ctx.restore();
  }

  // pulse Σ -> step
  if (P && P.p > 0.58 && P.p < 0.8) {
    const q = prog(P.p, 0.6, 0.78);
    ctx.globalCompositeOperation = "lighter";
    const x = lerp(R_SUM, STEP_X - STEP_W / 2, q);
    glow(ctx, x, 0, 34, light, 0.9 * gI);
    glow(ctx, x, 0, 10, "#ffffff", 0.9);
    ctx.globalCompositeOperation = "source-over";
  }

  // threshold box
  if (bStep > 0) {
    ctx.save();
    ctx.translate(STEP_X, 0);
    ctx.scale(bStep, bStep);
    ctx.translate(-STEP_X, 0);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, STEP_X, 0, 170, base, (0.16 + 0.35 * fireE) * gI, 0.05);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(10,6,22,0.92)";
    ctx.strokeStyle = withAlpha(light, 0.8);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(STEP_X - STEP_W / 2, -STEP_H / 2, STEP_W, STEP_H, 16);
    ctx.fill();
    ctx.stroke();
    // axes
    ctx.strokeStyle = withAlpha(light, 0.3);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(STEP_X - STEP_W / 2 + 14, 40);
    ctx.lineTo(STEP_X + STEP_W / 2 - 14, 40);
    ctx.moveTo(STEP_X, -44);
    ctx.lineTo(STEP_X, 44);
    ctx.stroke();
    // the step
    ctx.globalCompositeOperation = "lighter";
    for (const [wd, al] of [
      [12, 0.18],
      [4, 0.95],
    ] as const) {
      ctx.strokeStyle = withAlpha(light, al);
      ctx.lineWidth = wd;
      ctx.beginPath();
      for (let k = 0; k <= 30; k++) {
        const p = stepPt(k / 30);
        if (k) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    }
    if (P && P.p >= 0.78) {
      const p = stepPt(ease.inOutCubic(prog(P.p, 0.78, 1)));
      glow(ctx, p.x, p.y, 30, light, 1);
      glow(ctx, p.x, p.y, 9, "#ffffff", 1);
    } else if (since < 14) {
      const p = stepPt(1);
      glow(ctx, p.x, p.y, 30, light, 1 - since / 14);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  // output node + fire
  if (bOut > 0) {
    const lit = Math.max(0.2, fireE, flow * 0.9);
    sphere(ctx, OUT_X, 0, R_OUT * bOut, base, lit, gI);
    needles(ctx, OUT_X, 0, R_OUT, 14, 17, cold);
    if (since >= 0 && since < 40) {
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, OUT_X, 0, 60 + 260 * fireE, light, 0.8 * fireE * gI, 0.08);
      glow(ctx, OUT_X, 0, 30 + 40 * fireE, "#ffffff", fireE);
      for (let r = 0; r < 2; r++) {
        const tt = since - r * 4;
        if (tt < 0) continue;
        const ra = Math.exp(-tt / 8);
        ctx.strokeStyle = withAlpha(light, 0.85 * ra);
        ctx.lineWidth = 1.5 + 6 * ra;
        ctx.beginPath();
        ctx.arc(OUT_X, 0, R_OUT + tt * (11 - r * 3), 0, TAU);
        ctx.stroke();
      }
      const fk = FIRES.findIndex((t) => t === f - since);
      for (let s = 0; s < 22; s++) {
        const a = hash(fk * 13.1 + s * 2.7) * TAU;
        const d = since * (5 + 9 * hash(fk * 3.3 + s * 5.1)) * (1 - since / 80);
        glow(ctx, OUT_X + Math.cos(a) * (R_OUT + d), Math.sin(a) * (R_OUT + d), 7, light, Math.exp(-since / 10));
      }
      // the output signal leaves along the arrow
      const ax = lerp(OUT_X + R_OUT + 6, ARROW_END, clamp(since / 9));
      glow(ctx, ax, 0, 36, light, clamp(1 - since / 16));
      glow(ctx, ax, 0, 10, "#ffffff", clamp(1 - since / 16));
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.restore();
};

// ---------------------------------------------------------------------------------------------
// The dormant silhouette behind the chapter card
const SIL = [4, 6, 8, 8, 6, 3];
const SIL_X = [330, 580, 830, 1090, 1340, 1590];
const silY = (l: number, n: number) => 480 + (n - (SIL[l] - 1) / 2) * 84;

const drawSilhouette = (ctx: CanvasRenderingContext2D, f: number) => {
  const a = ease.outCubic(prog(f, 2, 34)) * (1 - ease.inOutCubic(prog(f, PERC - 14, PERC + 30)));
  if (a <= 0) return;
  const breathe = 0.75 + 0.25 * Math.sin(f * 0.07);
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(C.violet, 0.07 * a * breathe);
  ctx.beginPath();
  for (let l = 0; l < SIL.length - 1; l++)
    for (let i = 0; i < SIL[l]; i++)
      for (let j = 0; j < SIL[l + 1]; j++) {
        ctx.moveTo(SIL_X[l], silY(l, i));
        ctx.lineTo(SIL_X[l + 1], silY(l + 1, j));
      }
  ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  for (let l = 0; l < SIL.length; l++)
    for (let i = 0; i < SIL[l]; i++) {
      const x = SIL_X[l];
      const y = silY(l, i);
      const tw = 0.5 + 0.5 * noise1(f * 0.05 + l * 3.1 + i * 1.7);
      glow(ctx, x, y, 26, C.violet, 0.22 * a * tw);
      ctx.strokeStyle = withAlpha(LV, 0.28 * a * (0.6 + 0.4 * tw));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, TAU);
      ctx.stroke();
    }
  // a few faint "dream" sparks drifting through the sleeping net
  for (let s = 0; s < 6; s++) {
    const t = (f * 0.011 + hash(s * 3.7)) % 1;
    const seg = t * (SIL.length - 1);
    const l = Math.floor(seg);
    const u = ease.inOutSine(seg - l);
    const i = Math.floor(hash(s * 5.1 + l) * SIL[l]);
    const j = Math.floor(hash(s * 5.1 + l + 1) * SIL[l + 1]);
    const x = lerp(SIL_X[l], SIL_X[l + 1], u);
    const y = lerp(silY(l, i), silY(l + 1, j), u);
    glow(ctx, x, y, 16, LV, 0.45 * a * Math.sin(Math.PI * t));
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// Frost (deterministic dendrites growing in from the edges)
type Seg = { x0: number; y0: number; x1: number; y1: number; b: number };
let FROST: Seg[][] | null = null;
const frostSegs = () => {
  if (FROST) return FROST;
  const R = rng(1958);
  const out: Seg[][] = [[], [], []];
  const grow = (x0: number, y0: number, ang0: number, len: number, depth: number, b0: number) => {
    let x = x0;
    let y = y0;
    let ang = ang0;
    const step = depth === 0 ? 11 : depth === 1 ? 8 : 6;
    const n = Math.max(1, Math.round(len / step));
    let side = R() < 0.5 ? 1 : -1;
    for (let s = 0; s < n; s++) {
      ang += (R() - 0.5) * (depth === 0 ? 0.16 : 0.1);
      const nx = x + Math.cos(ang) * step;
      const ny = y + Math.sin(ang) * step;
      const b = b0 + s * step;
      out[depth].push({ x0: x, y0: y, x1: nx, y1: ny, b });
      if (depth < 2 && s >= 1 && s < n - 1 && R() < (depth === 0 ? 0.62 : 0.42)) {
        const rem = (n - s) * step;
        const pair = R() < 0.3;
        for (const sd of pair ? [1, -1] : [side]) {
          const sl = rem * (depth === 0 ? 0.3 + 0.32 * R() : 0.32 + 0.3 * R());
          if (sl > 12) grow(nx, ny, ang + sd * (Math.PI / 3 + (R() - 0.5) * 0.14), sl, depth + 1, b + step);
        }
        side = -side;
      }
      x = nx;
      y = ny;
    }
  };
  const seed = (x: number, y: number, nx: number, ny: number, reach: number) => {
    const tcx = 960 - x;
    const tcy = 540 - y;
    const tl = Math.hypot(tcx, tcy);
    const ang = Math.atan2(ny + (0.5 * tcy) / tl, nx + (0.5 * tcx) / tl) + (R() - 0.5) * 0.55;
    grow(x - nx * 14, y - ny * 14, ang, reach, 0, R() * 110);
  };
  const NS = 46;
  for (let k = 0; k < NS; k++) {
    const t = (k + 0.15 + 0.7 * R()) / NS;
    let d = t * 2 * (W + H);
    let x: number;
    let y: number;
    let nx: number;
    let ny: number;
    if (d < W) {
      x = d;
      y = 0;
      nx = 0;
      ny = 1;
    } else if ((d -= W) < H) {
      x = W;
      y = d;
      nx = -1;
      ny = 0;
    } else if ((d -= H) < W) {
      x = W - d;
      y = H;
      nx = 0;
      ny = -1;
    } else {
      d -= W;
      x = 0;
      y = H - d;
      nx = 1;
      ny = 0;
    }
    const dc = Math.min(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
    const c = 1 - clamp(dc / 640);
    let reach = lerp(150, 520, Math.pow(c, 1.3)) * (0.75 + 0.5 * R());
    if (ny === -1 && x > 300 && x < 1620) continue; // keep the caption band calm
    if (ny === 1 && x > 600 && x < 1320) reach *= 0.6; // and the label at the top
    seed(x, y, nx, ny, reach);
  }
  // the four corners get the biggest ferns
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    const nx = x === 0 ? 1 : -1;
    const ny = y === 0 ? 1 : -1;
    // bottom corners grow mostly upward, away from the captions
    seed(x, y, nx * (y === 0 ? 0.7 : 0.35), ny * 0.7, (y === 0 ? 560 : 470) + 120 * R());
  }
  // hoarfrost: tiny three-armed crystals crowding the edges
  for (let k = 0; k < 1800; k++) {
    const e = 260 * Math.pow(R(), 2.2);
    const t = R();
    let d = t * 2 * (W + H);
    let x: number;
    let y: number;
    if (d < W) {
      x = d;
      y = e;
    } else if ((d -= W) < H) {
      x = W - e;
      y = d;
    } else if ((d -= H) < W) {
      x = W - d;
      y = H - e * 0.6;
    } else {
      d -= W;
      x = e;
      y = H - d;
    }
    if (y > 800 && x > 300 && x < 1620) continue;
    const a0 = R() * TAU;
    const len = 2 + 5 * R();
    for (let arm = 0; arm < 3; arm++) {
      const a = a0 + (arm * TAU) / 3;
      out[2].push({ x0: x, y0: y, x1: x + Math.cos(a) * len, y1: y + Math.sin(a) * len, b: e * 1.6 + R() * 60 });
    }
  }
  let bmax = 1;
  for (const d of out) for (const s of d) bmax = Math.max(bmax, s.b);
  for (const d of out) {
    for (const s of d) s.b /= bmax;
    d.sort((p, q) => p.b - q.b);
  }
  FROST = out;
  return out;
};

const FROST_STYLE: [number, number, number, number][] = [
  // depth: glow width, glow alpha, core width, core alpha
  [6, 0.07, 1.7, 0.6],
  [4, 0.06, 1.15, 0.5],
  [2.5, 0.05, 0.8, 0.45],
];

const strokeFrost = (ctx: CanvasRenderingContext2D, g: number) => {
  const segs = frostSegs();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++)
    for (let d = 0; d < 3; d++) {
      const st = FROST_STYLE[d];
      ctx.beginPath();
      for (const s of segs[d]) {
        if (s.b > g) break;
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
      }
      ctx.lineWidth = pass === 0 ? st[0] : st[2];
      ctx.strokeStyle = pass === 0 ? withAlpha("#9cc8ff", st[1]) : withAlpha(ICE, st[3]);
      ctx.stroke();
    }
  ctx.globalCompositeOperation = "source-over";
};

let FROST_FULL: HTMLCanvasElement | null = null;
const frostFull = () => {
  if (FROST_FULL) return FROST_FULL;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  strokeFrost(c.getContext("2d")!, 1);
  FROST_FULL = c;
  return c;
};

const GROW_A = FREEZE + 6;
const GROW_B = FLOOD - 10;
const frostG = (f: number) => ease.inOutSine(prog(f, GROW_A, GROW_B));

const drawFrost = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < GROW_A || f >= SHATTER) return;
  const g = frostG(f);
  // icy haze creeping in from the edges
  const hz = ctx.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 1150);
  hz.addColorStop(0, "rgba(160,200,235,0)");
  hz.addColorStop(0.6, withAlpha("#a8cdec", 0.05 * g));
  hz.addColorStop(1, withAlpha("#cfe6fb", 0.26 * g));
  ctx.fillStyle = hz;
  ctx.fillRect(0, 0, W, H);
  if (f >= GROW_B) {
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(frostFull(), 0, 0);
    ctx.globalCompositeOperation = "source-over";
  } else strokeFrost(ctx, g);
  // glints at the growing tips
  if (g < 1) {
    const segs = frostSegs();
    ctx.globalCompositeOperation = "lighter";
    for (let d = 0; d < 2; d++)
      for (const s of segs[d]) {
        if (s.b > g) break;
        if (s.b > g - 0.012) glow(ctx, s.x1, s.y1, d === 0 ? 9 : 6, ICE, 0.7);
      }
    ctx.globalCompositeOperation = "source-over";
  }
};

// ---------------------------------------------------------------------------------------------
// Cracks + shards (the dam breaks)
type Shard = { pts: number[]; cx: number; cy: number; bx: number; by: number; bw: number; bh: number; id: number };
type Crack = { pts: number[]; tc: number };
let SHARDS: Shard[] | null = null;
let CRACKS: Crack[] = [];
/** The re-warmed neuron's shockwave: radius RING_R0 + RING_V * (f - FLOOD). */
const RING_R0 = 110;
const RING_V = 84;
const buildShards = () => {
  if (SHARDS) return SHARDS;
  const R = rng(371);
  const GX = 13;
  const GY = 8;
  const P: [number, number][][] = [];
  for (let a = 0; a <= GX; a++) {
    P[a] = [];
    for (let b = 0; b <= GY; b++) {
      let x = (a / GX) * W;
      let y = (b / GY) * H;
      if (a > 0 && a < GX) x += (R() - 0.5) * 0.7 * (W / GX);
      else x += a === 0 ? -14 : 14;
      if (b > 0 && b < GY) y += (R() - 0.5) * 0.7 * (H / GY);
      else y += b === 0 ? -14 : 14;
      P[a][b] = [x, y];
    }
  }
  const tris: [number, number][][] = [];
  for (let a = 0; a < GX; a++)
    for (let b = 0; b < GY; b++) {
      const p00 = P[a][b];
      const p10 = P[a + 1][b];
      const p01 = P[a][b + 1];
      const p11 = P[a + 1][b + 1];
      if (R() < 0.5) tris.push([p00, p10, p11], [p00, p11, p01]);
      else tris.push([p00, p10, p01], [p10, p11, p01]);
    }
  // frost density per triangle
  const segs = frostSegs();
  const inTri = (t: [number, number][], x: number, y: number) => {
    const [a, b, c] = t;
    const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
    const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
    const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  const dens = tris.map(() => 0);
  const bbs = tris.map((t) => {
    const xs = t.map((p) => p[0]);
    const ys = t.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  for (let d = 0; d < 2; d++)
    for (let si = 0; si < segs[d].length; si += 2) {
      const s = segs[d][si];
      const mx = (s.x0 + s.x1) / 2;
      const my = (s.y0 + s.y1) / 2;
      for (let k = 0; k < tris.length; k++) {
        const bb = bbs[k];
        if (mx < bb[0] || mx > bb[2] || my < bb[1] || my > bb[3]) continue;
        if (inTri(tris[k], mx, my)) {
          dens[k]++;
          break;
        }
      }
    }
  const out: Shard[] = [];
  const edgeMap = new Map<string, { a: [number, number]; b: [number, number] }>();
  tris.forEach((t, k) => {
    if (dens[k] < 6) return;
    const bb = bbs[k];
    const bx = Math.max(0, Math.floor(bb[0]));
    const by = Math.max(0, Math.floor(bb[1]));
    const bw = Math.min(W, Math.ceil(bb[2])) - bx;
    const bh = Math.min(H, Math.ceil(bb[3])) - by;
    out.push({
      pts: [t[0][0], t[0][1], t[1][0], t[1][1], t[2][0], t[2][1]],
      cx: (t[0][0] + t[1][0] + t[2][0]) / 3,
      cy: (t[0][1] + t[1][1] + t[2][1]) / 3,
      bx,
      by,
      bw,
      bh,
      id: k,
    });
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      const key = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`;
      edgeMap.set(key, { a, b });
    }
  });
  CRACKS = [];
  for (const { a, b } of edgeMap.values()) {
    // skip edges lying on the frame border
    const onBorder = (p: [number, number]) => p[0] <= 0 || p[0] >= W || p[1] <= 0 || p[1] >= H;
    if (onBorder(a) && onBorder(b)) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    // start the crack at the end closer to the neuron (the shockwave comes from there)
    const [s, e] = Math.hypot(a[0] - HOME.x, a[1] - HOME.y) < Math.hypot(b[0] - HOME.x, b[1] - HOME.y) ? [a, b] : [b, a];
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    const px = -(e[1] - s[1]) / len;
    const py = (e[0] - s[0]) / len;
    const pts: number[] = [s[0], s[1]];
    for (let k = 1; k < 5; k++) {
      const j = (R() - 0.5) * 0.14 * len;
      pts.push(lerp(s[0], e[0], k / 5) + px * j, lerp(s[1], e[1], k / 5) + py * j);
    }
    pts.push(e[0], e[1]);
    // the neuron's warm shockwave cracks the ice as it passes
    const dh = Math.hypot(mx - HOME.x, my - HOME.y);
    CRACKS.push({ pts, tc: FLOOD + Math.max(0, (dh - RING_R0) / RING_V) + 1.5 * hash(mx * 0.13 + my * 0.07) });
  }
  SHARDS = out;
  return out;
};

const drawCracks = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < FLOOD || f >= SHATTER + 2) return;
  buildShards();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (const c of CRACKS) {
      const t = clamp((f - c.tc) / 5);
      if (t <= 0) continue;
      const n = c.pts.length / 2 - 1;
      const upto = t * n;
      ctx.moveTo(c.pts[0], c.pts[1]);
      for (let k = 1; k <= Math.ceil(upto); k++) {
        const u = Math.min(1, upto - (k - 1));
        ctx.lineTo(lerp(c.pts[2 * k - 2], c.pts[2 * k], u), lerp(c.pts[2 * k - 1], c.pts[2 * k + 1], u));
      }
    }
    ctx.lineWidth = pass === 0 ? 9 : 1.8;
    ctx.strokeStyle = pass === 0 ? withAlpha(C.magenta, 0.22) : "rgba(255,250,255,0.95)";
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
};

/** Point-in-triangle for a flat [ax, ay, bx, by, cx, cy] array. */
const inTri6 = (p: number[], x: number, y: number) => {
  const d1 = (x - p[2]) * (p[1] - p[3]) - (p[0] - p[2]) * (y - p[3]);
  const d2 = (x - p[4]) * (p[3] - p[5]) - (p[2] - p[4]) * (y - p[5]);
  const d3 = (x - p[0]) * (p[5] - p[1]) - (p[4] - p[0]) * (y - p[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
/** Each shard's piece of the frost, cut once into its own small (pre-masked) sprite. */
let SHARD_SPR: HTMLCanvasElement[] | null = null;
const shardSprites = () => {
  if (SHARD_SPR) return SHARD_SPR;
  const shards = buildShards();
  const src = frostFull().getContext("2d")!.getImageData(0, 0, W, H).data;
  SHARD_SPR = shards.map((s) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, s.bw);
    c.height = Math.max(1, s.bh);
    const g = c.getContext("2d")!;
    const img = g.createImageData(c.width, c.height);
    for (let y = 0; y < s.bh; y++)
      for (let x = 0; x < s.bw; x++) {
        if (!inTri6(s.pts, s.bx + x + 0.5, s.by + y + 0.5)) continue;
        const si = ((s.by + y) * W + s.bx + x) * 4;
        const di = (y * c.width + x) * 4;
        img.data[di] = src[si];
        img.data[di + 1] = src[si + 1];
        img.data[di + 2] = src[si + 2];
        img.data[di + 3] = src[si + 3];
      }
    g.putImageData(img, 0, 0);
    return c;
  });
  return SHARD_SPR;
};

const drawShards = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < SHATTER || f > SHATTER + 34) return;
  const shards = buildShards();
  const spr = shardSprites();
  for (let si = 0; si < shards.length; si++) {
    const s = shards[si];
    const h1 = hash(s.id * 1.37);
    const h2 = hash(s.id * 2.71 + 3);
    const h3 = hash(s.id * 4.13 + 7);
    const ts = Math.max(0, f - SHATTER - 2 * h1);
    const al = 1 - ease.inQuad(clamp(ts / 20));
    if (al <= 0) continue;
    // blown outward, toward the camera
    let dx = s.cx - HOME.x;
    let dy = s.cy - HOME.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const jx = -dy * (h2 - 0.5) * 0.7;
    const jy = dx * (h2 - 0.5) * 0.7;
    const d = (7 + 10 * h3) * ts + 0.7 * (0.8 + h1) * ts * ts;
    const sc = 1 + 0.07 * ts * (0.6 + h2);
    const rot = (h3 - 0.5) * 0.12 * ts;
    ctx.save();
    ctx.globalAlpha = al;
    ctx.translate(s.cx + (dx + jx) * d, s.cy + (dy + jy) * d);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.translate(-s.cx, -s.cy);
    ctx.beginPath();
    ctx.moveTo(s.pts[0], s.pts[1]);
    ctx.lineTo(s.pts[2], s.pts[3]);
    ctx.lineTo(s.pts[4], s.pts[5]);
    ctx.closePath();
    ctx.globalCompositeOperation = "lighter";
    if (s.bw > 0 && s.bh > 0) ctx.drawImage(spr[si], s.bx, s.by);
    ctx.strokeStyle = `rgba(235,245,255,${0.35 * (1 - clamp(ts / 10)) + 0.12})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// Snow motes (winter)
const drawSnow = (ctx: CanvasRenderingContext2D, f: number) => {
  const a = ease.outCubic(prog(f, FREEZE + 10, FREEZE + 60)) * (1 - prog(f, SHATTER, SHATTER + 14));
  if (a <= 0) return;
  ctx.globalCompositeOperation = "lighter";
  const pull = ease.inQuad(prog(f, SHATTER, SHATTER + 14));
  for (let k = 0; k < 170; k++) {
    const depth = 0.4 + 0.9 * hash(k * 5.1);
    const sp = (0.25 + 0.55 * hash(k * 3.3)) * depth;
    let x = hash(k * 1.7) * W + Math.sin(f * 0.013 * (1 + hash(k)) + k) * 36 * depth;
    let y = ((hash(k * 2.9) * 1180 + (f - FREEZE) * sp) % 1180) - 50;
    x = lerp(x, HOME.x, pull * 0.6);
    y = lerp(y, HOME.y, pull * 0.6);
    glow(ctx, x, y, 3 + 7 * depth, ICE, (0.2 + 0.4 * hash(k * 7.7)) * a);
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// Thumbnails: an atlas of tiny procedural "photos"
const TW_PX = 64;
const TH_PX = 48;
const N_IMG = 64;
let ATLAS: HTMLCanvasElement | null = null;
let AVG: string[] = [];
const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;

const drawThumb = (g: CanvasRenderingContext2D, type: number, n: number) => {
  const r = (k: number) => hash(n * 17.3 + k * 3.7);
  const vgrad = (y0: number, y1: number, c0: string, c1: string) => {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    return gr;
  };
  const disk = (x: number, y: number, rr: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fill();
  };
  const hz = 26 + 10 * r(1);
  switch (type) {
    case 0: {
      // sunset
      g.fillStyle = vgrad(0, hz, hsl(250 + 40 * r(2), 50, 22), hsl(18 + 22 * r(3), 92, 62));
      g.fillRect(0, 0, 64, 48);
      disk(14 + 36 * r(4), hz - 2, 6 + 4 * r(5), hsl(46, 100, 78));
      g.fillStyle = hsl(265, 30, 12);
      g.beginPath();
      g.moveTo(0, 48);
      for (let x = 0; x <= 64; x += 8) g.lineTo(x, hz - 4 * hash(n + x) - 2);
      g.lineTo(64, 48);
      g.fill();
      break;
    }
    case 1: {
      // meadow + tree
      g.fillStyle = vgrad(0, hz, hsl(200 + 15 * r(2), 70, 62), hsl(200, 60, 86));
      g.fillRect(0, 0, 64, 48);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.ellipse(14 + 30 * r(3), 10 + 6 * r(4), 10, 4, 0, 0, TAU);
      g.fill();
      g.fillStyle = hsl(95 + 35 * r(5), 50, 36);
      g.fillRect(0, hz, 64, 48 - hz);
      const tx = 18 + 28 * r(6);
      g.fillStyle = hsl(25, 40, 25);
      g.fillRect(tx - 2, hz - 10, 4, 12);
      disk(tx, hz - 14, 8 + 3 * r(7), hsl(120 + 20 * r(8), 45, 28));
      break;
    }
    case 2: {
      // sea
      g.fillStyle = vgrad(0, hz, hsl(195, 60, 72), hsl(32, 70, 82));
      g.fillRect(0, 0, 64, 48);
      g.fillStyle = vgrad(hz, 48, hsl(205, 70, 40), hsl(215, 70, 22));
      g.fillRect(0, hz, 64, 48 - hz);
      const sx = 16 + 32 * r(3);
      disk(sx, hz - 6, 5, hsl(48, 100, 85));
      g.fillStyle = "rgba(255,240,200,0.7)";
      for (let y = hz + 3; y < 48; y += 4) g.fillRect(sx - 3 - (y - hz) * 0.15, y, 6 + (y - hz) * 0.3, 1.5);
      break;
    }
    case 3: {
      // night + moon
      g.fillStyle = vgrad(0, 48, hsl(232, 50, 10), hsl(262, 40, 24));
      g.fillRect(0, 0, 64, 48);
      g.fillStyle = "rgba(255,255,255,0.85)";
      for (let s = 0; s < 12; s++) g.fillRect(hash(n * 3 + s) * 64, hash(n * 7 + s) * 34, 1.3, 1.3);
      const mx = 14 + 36 * r(2);
      disk(mx, 14, 7, "#f4f1e0");
      disk(mx + 3.5, 12, 6.2, hsl(240, 45, 14));
      g.fillStyle = hsl(250, 30, 8);
      g.fillRect(0, 40, 64, 8);
      break;
    }
    case 4: {
      // an "animal": blob with ears and eyes
      const hue = 360 * r(2);
      g.fillStyle = vgrad(0, 48, hsl(hue, 35, 74), hsl(hue, 30, 58));
      g.fillRect(0, 0, 64, 48);
      const fur = hsl(20 + 30 * r(3), 45, 30 + 30 * r(4));
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.beginPath();
      g.ellipse(32, 42, 18, 4, 0, 0, TAU);
      g.fill();
      g.fillStyle = fur;
      g.beginPath();
      g.ellipse(32, 28, 15, 12, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(20, 22);
      g.lineTo(23, 9);
      g.lineTo(29, 18);
      g.moveTo(44, 22);
      g.lineTo(41, 9);
      g.lineTo(35, 18);
      g.fill();
      disk(27, 26, 2, "#111");
      disk(37, 26, 2, "#111");
      break;
    }
    case 5: {
      // flower
      g.fillStyle = vgrad(0, 48, hsl(105, 40, 34), hsl(85, 45, 48));
      g.fillRect(0, 0, 64, 48);
      g.strokeStyle = hsl(110, 50, 22);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(32, 24);
      g.lineTo(31, 48);
      g.stroke();
      const pc = hsl(320 + 70 * r(2), 80, 66);
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * TAU + r(3);
        disk(32 + Math.cos(a) * 7, 20 + Math.sin(a) * 7, 5.5, pc);
      }
      disk(32, 20, 4.5, hsl(48, 95, 58));
      break;
    }
    case 6: {
      // car
      g.fillStyle = vgrad(0, 34, hsl(210, 45, 76), hsl(210, 30, 88));
      g.fillRect(0, 0, 64, 48);
      g.fillStyle = hsl(0, 0, 30);
      g.fillRect(0, 34, 64, 14);
      g.fillStyle = "rgba(255,255,255,0.6)";
      g.fillRect(4, 42, 12, 1.5);
      g.fillRect(28, 42, 12, 1.5);
      g.fillStyle = hsl(360 * r(2), 70, 48);
      g.beginPath();
      g.roundRect(10, 23, 44, 12, 4);
      g.fill();
      g.beginPath();
      g.roundRect(19, 15, 24, 10, 4);
      g.fill();
      g.fillStyle = hsl(200, 60, 82);
      g.fillRect(22, 17, 8, 6);
      g.fillRect(32, 17, 8, 6);
      disk(20, 35, 4.5, "#151515");
      disk(44, 35, 4.5, "#151515");
      break;
    }
    default: {
      // mountains + lake
      g.fillStyle = vgrad(0, hz, hsl(205, 65, 55), hsl(200, 55, 85));
      g.fillRect(0, 0, 64, 48);
      const px = 18 + 28 * r(2);
      g.fillStyle = hsl(220, 15, 38);
      g.beginPath();
      g.moveTo(px - 30, hz);
      g.lineTo(px, hz - 20);
      g.lineTo(px + 30, hz);
      g.fill();
      g.fillStyle = "#f2f6fa";
      g.beginPath();
      g.moveTo(px - 7, hz - 15);
      g.lineTo(px, hz - 20);
      g.lineTo(px + 7, hz - 15);
      g.fill();
      g.fillStyle = vgrad(hz, 48, hsl(200, 55, 50), hsl(210, 60, 30));
      g.fillRect(0, hz, 64, 48 - hz);
    }
  }
};

const atlas = () => {
  if (ATLAS) return ATLAS;
  const c = document.createElement("canvas");
  c.width = TW_PX * 8;
  c.height = TH_PX * 8;
  const g = c.getContext("2d")!;
  for (let n = 0; n < N_IMG; n++) {
    const ox = (n % 8) * TW_PX;
    const oy = Math.floor(n / 8) * TH_PX;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, TW_PX, TH_PX);
    g.clip();
    drawThumb(g, n % 8, n);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, TW_PX - 2, TH_PX - 2);
    g.restore();
  }
  const d = g.getImageData(0, 0, c.width, c.height).data;
  AVG = [];
  for (let n = 0; n < N_IMG; n++) {
    const ox = (n % 8) * TW_PX;
    const oy = Math.floor(n / 8) * TH_PX;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    let cnt = 0;
    for (let y = 2; y < TH_PX; y += 3)
      for (let x = 2; x < TW_PX; x += 3) {
        const i = ((oy + y) * c.width + ox + x) * 4;
        rr += d[i];
        gg += d[i + 1];
        bb += d[i + 2];
        cnt++;
      }
    AVG.push(`rgb(${Math.round(rr / cnt)},${Math.round(gg / cnt)},${Math.round(bb / cnt)})`);
  }
  ATLAS = c;
  return c;
};
const drawThumbAt = (ctx: CanvasRenderingContext2D, img: number, x: number, y: number, w: number, h: number) => {
  const at = atlas();
  if (w < 9) {
    ctx.fillStyle = AVG[img];
    ctx.fillRect(x, y, w, h);
  } else ctx.drawImage(at, (img % 8) * TW_PX, Math.floor(img / 8) * TH_PX, TW_PX, TH_PX, x, y, w, h);
};

// ---------------------------------------------------------------------------------------------
// The data flood
const WORDS = ["猫", "狗", "汽车", "苹果", "花", "山", "鸟", "树", "海", "天空", "cat", "dog", "car", "tree", "sky", "bird", "apple", "flower", "house", "boat"];
const NP = 2200;
const NWD = 260;
const NF = NP + NWD;
const F_TH = new Float32Array(NF);
const F_DZ = new Float32Array(NF);
const F_DL = new Float32Array(NF);
const F_DU = new Float32Array(NF);
const F_SW = new Float32Array(NF);
const F_R0 = new Float32Array(NF);
const F_IMG = new Uint8Array(NF);
const rectExit = (cx: number, cy: number, a: number, pad: number) => {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const tx = dx > 1e-6 ? (W + pad - cx) / dx : dx < -1e-6 ? (-pad - cx) / dx : 1e9;
  const ty = dy > 1e-6 ? (H + pad - cy) / dy : dy < -1e-6 ? (-pad - cy) / dy : 1e9;
  return Math.min(tx, ty);
};
for (let k = 0; k < NF; k++) {
  F_TH[k] = hash(k * 1.13 + 0.2) * TAU;
  F_DZ[k] = 0.45 + 1.1 * Math.pow(hash(k * 2.71 + 0.5), 1.6);
  F_DL[k] = hash(k * 9.1 + 0.3) < 0.28 ? 8 * hash(k * 4.4 + 0.1) : 8 + 236 * Math.pow(hash(k * 3.3 + 1), 0.75);
  F_DU[k] = 52 + 40 * hash(k * 5.1 + 0.7);
  F_SW[k] = 0.35 + 0.7 * hash(k * 7.7 + 0.9);
  F_R0[k] = rectExit(HOME.x, HOME.y, F_TH[k], 70);
  F_IMG[k] = Math.floor(hash(k * 6.3 + 0.8) * N_IMG);
}
/** Flood clock: accelerating. */
const floodT = (f: number) => {
  const t = Math.max(0, f - SHATTER);
  return 1.5 * t + 0.012 * t * t;
};
const floodPos = (k: number, T: number) => {
  const u = (T - F_DL[k]) / F_DU[k];
  const a = F_TH[k] + F_SW[k] * u * u;
  const r = F_R0[k] * Math.pow(1 - clamp(u), 1.15);
  return { x: HOME.x + Math.cos(a) * r, y: HOME.y + Math.sin(a) * r, u };
};
const floodSize = (k: number, u: number) => 50 * F_DZ[k] * (0.3 + 0.7 * Math.pow(1 - clamp(u), 0.8));
/** Keep the caption band clear: particles dissolve below y = 780. */
const bandFade = (y: number) => clamp((850 - y) / 80);

// ---------------------------------------------------------------------------------------------
// The ImageNet plane
const PU = 84;
const PV = 66;
const TW = 72;
const TH = 54;
const HC = 300;
const HORIZON = 330;
const PITCH = Math.atan((540 - HORIZON) / 900);
const Z0 = 470;
const NJ = 112;
const camZ = (f: number) => (f - IMNET) * 3.4;
const camAt = (f: number) => camera({ z: camZ(f), pitch: PITCH, f: 900 });
const T_IM = floodT(IMNET);
const MASK_Y = 700;

type Slot = { i: number; j: number; k: number; t0: number };
const SLOTS = new Map<number, Slot>();
const PART_SLOT = new Map<number, Slot>();
const slotKey = (i: number, j: number) => j * 1000 + i + 500;
{
  // the flood settles into the nearest tiles: match visible particles to slots, both ordered left -> right
  const cam = camAt(IMNET + 30);
  const slots: { i: number; j: number; x: number; y: number }[] = [];
  for (let j = 0; j < 22; j++)
    for (let i = -18; i <= 18; i++) {
      const p = project(cam, i * PU, HC, Z0 + j * PV);
      if (!p || p.x < 50 || p.x > W - 50 || p.y < HORIZON + 30 || p.y > MASK_Y + 30) continue;
      slots.push({ i, j, x: p.x, y: p.y });
    }
  const cands: { k: number; x: number }[] = [];
  for (let k = 0; k < NP; k++) {
    const p = floodPos(k, T_IM);
    if (p.u >= 0.03 && p.u <= 0.85) cands.push({ k, x: p.x });
  }
  const n = Math.min(slots.length, cands.length);
  slots.sort((a, b) => a.j - b.j || Math.abs(a.i) - Math.abs(b.i));
  const use = slots.slice(0, n).sort((a, b) => a.x - b.x);
  const stride = cands.length / n;
  const pick: { k: number; x: number }[] = [];
  for (let m = 0; m < n; m++) pick.push(cands[Math.floor(m * stride)]);
  pick.sort((a, b) => a.x - b.x);
  for (let m = 0; m < n; m++) {
    const s: Slot = { i: use[m].i, j: use[m].j, k: pick[m].k, t0: IMNET + 1 + 16 * hash(pick[m].k * 1.9) };
    SLOTS.set(slotKey(s.i, s.j), s);
    PART_SLOT.set(s.k, s);
  }
}
const FLIGHT = 28;
const COUNT_A = IMNET + 22; // counter rolls up ...
const COUNT_B = IMNET + 84; // ... and locks in here
const SCAN = COUNT_B;
const imgOf = (i: number, j: number) => {
  const s = SLOTS.get(slotKey(i, j));
  return s ? F_IMG[s.k] : Math.floor(hash2(i * 1.31 + 0.5, j * 0.71 + 0.3) * N_IMG);
};
const TAG_COLS = [C.magenta, C.cyan, C.gold, C.green, LV];

const tileAppear = (f: number, i: number, j: number) => {
  const zn = clamp((j * PV) / (NJ * PV * 0.92));
  return clamp((f - (IMNET + 10 + 66 * Math.pow(zn, 0.85) + 6 * hash2(i * 0.37, j * 0.91))) / 9);
};

const drawPlane = (ctx: CanvasRenderingContext2D, f: number) => {
  const im = imAt(f);
  if (im <= 0) return;
  const cam = camAt(f);
  const cz = camZ(f);
  ctx.globalAlpha = 1;
  for (let j = NJ - 1; j >= 0; j--) {
    const Z = Z0 + j * PV;
    const zr = Z - cz;
    if (zr < 380) continue;
    const pc = project(cam, 0, HC, Z);
    const pf = project(cam, 0, HC, Z + TH / 2);
    const pn = project(cam, 0, HC, Z - TH / 2);
    if (!pc || !pf || !pn) continue;
    if (pf.y > MASK_Y + 120) continue;
    const s = pc.s;
    const tw = TW * s;
    const th = Math.max(1, pn.y - pf.y);
    const fog = Math.pow(clamp((NJ * PV * 0.98 - (Z - Z0)) / 3400), 1.3);
    const imax = Math.ceil((960 / s + TW) / PU);
    for (let i = -imax; i <= imax; i++) {
      const x = pc.x + i * PU * s;
      if (x + tw / 2 < 0 || x - tw / 2 > W) continue;
      const slot = SLOTS.get(slotKey(i, j));
      if (slot && f < slot.t0 + FLIGHT) continue;
      const app = slot ? 1 : tileAppear(f, i, j);
      if (app <= 0) continue;
      const pop = slot ? 1 : 0.55 + 0.45 * ease.outBack(app);
      const a = fog * clamp(app * 1.6);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      const img = imgOf(i, j);
      const w2 = tw * pop;
      const h2 = th * pop;
      drawThumbAt(ctx, img, x - w2 / 2, pf.y + (th - h2) / 2, w2, h2);
      if (app < 1) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (1 - app) * 0.8 * fog;
        ctx.fillStyle = LV;
        ctx.fillRect(x - w2 / 2, pf.y + (th - h2) / 2, w2, h2);
        ctx.globalCompositeOperation = "source-over";
      }
      // annotation: tag bar under the tile, and a box on some
      if (tw > 30) {
        const cat = Math.floor(hash2(i * 5.1 + 0.2, j * 2.3 + 0.1) * TAG_COLS.length);
        const gap = Math.max(2, th * 0.12);
        ctx.globalAlpha = a;
        ctx.fillStyle = TAG_COLS[cat];
        ctx.fillRect(x - tw / 2, pn.y + gap * 0.5, tw * (0.25 + 0.2 * hash2(i, j)), gap * 0.9);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(x - tw / 2 + tw * 0.5, pn.y + gap * 0.75, tw * 0.35, Math.max(1, gap * 0.35));
        if (hash2(i * 3.3 + 1, j * 7.7 + 2) > 0.55) {
          const bx = x - tw / 2 + tw * (0.12 + 0.2 * hash2(i, j * 3));
          const by = pf.y + th * (0.12 + 0.2 * hash2(i * 2, j));
          ctx.strokeStyle = TAG_COLS[cat];
          ctx.lineWidth = Math.max(1, tw / 40);
          ctx.strokeRect(bx, by, tw * 0.5, th * 0.6);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  // when the counter locks in, a scan sweeps from the viewer to the horizon
  const st = f - SCAN;
  if (st >= 0 && st < 40) {
    const zr = 460 + st * st * 3.6;
    const p = project(cam, 0, HC, cz + zr);
    if (p && p.y < MASK_Y + 40) {
      const hh = Math.max(3, 70 * p.s);
      const sa = 0.5 * (1 - st / 40);
      const g = ctx.createLinearGradient(0, p.y - hh, 0, p.y + hh);
      g.addColorStop(0, withAlpha(LV, 0));
      g.addColorStop(0.5, withAlpha("#f0e2ff", sa));
      g.addColorStop(1, withAlpha(LV, 0));
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(0, p.y - hh, W, 2 * hh);
      ctx.globalCompositeOperation = "source-over";
    }
  }
};

/** Particles that land in their slots (flood -> plane). */
const drawLanding = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < IMNET || f > IMNET + 20 + FLIGHT) return;
  const cam = camAt(f);
  const x0 = IMNET;
  const Teff = T_IM + 18 * (1 - Math.exp(-(f - x0) / 6));
  for (const s of SLOTS.values()) {
    if (f >= s.t0 + FLIGHT) continue;
    const e = ease.inOutCubic(clamp((f - s.t0) / FLIGHT));
    const fp = floodPos(s.k, Teff);
    const u = Math.min(fp.u, 0.9);
    const fs = floodSize(s.k, u);
    const Z = Z0 + s.j * PV;
    const pc = project(cam, s.i * PU, HC, Z);
    const pf = project(cam, s.i * PU, HC, Z + TH / 2);
    const pn = project(cam, s.i * PU, HC, Z - TH / 2);
    if (!pc || !pf || !pn) continue;
    const tw = TW * pc.s;
    const th = pn.y - pf.y;
    const w = lerp(fs, tw, e);
    const h = lerp(fs * 0.75, th, e);
    const x = lerp(fp.x, pc.x, e);
    const y = lerp(fp.y, (pf.y + pn.y) / 2, e);
    ctx.globalAlpha = bandFade(y);
    drawThumbAt(ctx, F_IMG[s.k], x - w / 2, y - h / 2, w, h);
  }
};

const drawFlood = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < SHATTER - 1 || f > IMNET + 22) return;
  const T = floodT(f);
  const spd = 1 + 0.016 * Math.max(0, f - SHATTER);
  const fade = 1 - prog(f, IMNET, IMNET + 18);
  const fin = ease.outCubic(prog(f, SHATTER - 1, SHATTER + 6));
  // speed lines converging on the neuron
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  for (let k = 0; k < 120; k++) {
    const a = hash(k * 4.7) * TAU;
    const ph = (T * 0.009 * (0.7 + 0.6 * hash(k * 2.2)) + hash(k * 8.1)) % 1;
    const r1 = 1250 * (1 - ph);
    const r2 = Math.max(90, r1 - 80 - 220 * ph * spd * 0.5);
    ctx.strokeStyle = withAlpha(k % 3 ? LV : C.magenta, 0.16 * (1 - ph) * fade * fin);
    ctx.beginPath();
    ctx.moveTo(HOME.x + Math.cos(a) * r1, HOME.y + Math.sin(a) * r1);
    ctx.lineTo(HOME.x + Math.cos(a) * r2, HOME.y + Math.sin(a) * r2);
    ctx.stroke();
  }
  // motion trails (one batched path per colour)
  const trail = 4 + 3 * spd;
  for (const [col, al] of [
    [LV, 0.22],
    [C.magenta, 0.16],
  ] as const) {
    ctx.strokeStyle = withAlpha(col, al * fade * fin);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = col === LV ? 0 : 1; k < NF; k += 2) {
      if (f >= IMNET && PART_SLOT.has(k)) continue;
      const p = floodPos(k, T);
      if (p.u < 0 || p.u > 0.95) continue;
      const q = floodPos(k, T - trail);
      ctx.moveTo(q.u < 0 ? HOME.x + Math.cos(F_TH[k]) * F_R0[k] : q.x, q.u < 0 ? HOME.y + Math.sin(F_TH[k]) * F_R0[k] : q.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  // thumbnails
  for (let k = 0; k < NP; k++) {
    if (f >= IMNET && PART_SLOT.has(k)) continue;
    const p = floodPos(k, T);
    if (p.u < 0 || p.u > 1) continue;
    const a = clamp((1 - p.u) / 0.16) * fade * fin * bandFade(p.y);
    if (a <= 0.01) continue;
    const s = floodSize(k, p.u);
    ctx.globalAlpha = a;
    drawThumbAt(ctx, F_IMG[k], p.x - s / 2, p.y - s * 0.375, s, s * 0.75);
  }
  ctx.globalAlpha = 1;
  // word tokens
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [lo, hi, px] of [
    [0, 0.8, 22],
    [0.8, 1.15, 30],
    [1.15, 9, 36],
  ] as const) {
    let set = false;
    for (let k = NP; k < NF; k++) {
      if (F_DZ[k] < lo || F_DZ[k] >= hi) continue;
      const p = floodPos(k, T);
      if (p.u < 0 || p.u > 1) continue;
      const a = clamp((1 - p.u) / 0.2) * fade * fin * bandFade(p.y);
      if (a <= 0.01) continue;
      if (!set) {
        ctx.font = `700 ${px}px ${FONT_CN}`;
        set = true;
      }
      const sc = 0.45 + 0.55 * Math.pow(1 - p.u, 0.7);
      const word = WORDS[k % WORDS.length];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      const tw = ctx.measureText(word).width + px * 0.7;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = "rgba(20,8,40,0.75)";
      ctx.strokeStyle = withAlpha(k % 3 ? LV : C.magenta, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-tw / 2, -px * 0.72, tw, px * 1.44, px * 0.35);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#f4ecff";
      ctx.fillText(word, 0, 1);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  // the vortex core: everything is swallowed by the neuron
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, HOME.x, HOME.y, 260 + 120 * Math.min(1, (spd - 1) / 2), HOT, 0.35 * fade * fin, 0.04);
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// Beams: tiles feeding the neuron on the horizon
const drawBeams = (ctx: CanvasRenderingContext2D, f: number) => {
  const a = ease.outCubic(prog(f, IMNET + 30, IMNET + 55));
  if (a <= 0) return;
  const cam = camAt(f);
  const v = viewAt(f);
  const tx = v.ox + IN_X * v.sc;
  ctx.globalCompositeOperation = "lighter";
  for (let b = 0; b < 44; b++) {
    const per = 30;
    const ph = f - IMNET + hash(b * 3.7) * per;
    const cyc = Math.floor(ph / per);
    const t = (ph % per) / per;
    const i = Math.round((hash(b * 3.1 + cyc * 1.7) - 0.5) * 30);
    const j = 3 + Math.floor(hash(b * 5.3 + cyc * 2.9) * 40);
    const p = project(cam, i * PU, HC, Z0 + j * PV);
    if (!p || p.y > MASK_Y) continue;
    const ty = v.oy + IN_Y[b % 4] * v.sc;
    const al = a * Math.sin(Math.PI * t);
    const g = ctx.createLinearGradient(p.x, p.y, tx, ty);
    g.addColorStop(0, withAlpha(LV, 0.35 * al));
    g.addColorStop(1, withAlpha(HOT, 0.05 * al));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo((p.x + tx) / 2, Math.min(p.y, ty) - 60, tx, ty);
    ctx.stroke();
    const e = ease.inQuad(t);
    const mx = (p.x + tx) / 2;
    const my = Math.min(p.y, ty) - 60;
    const bx = (1 - e) * (1 - e) * p.x + 2 * (1 - e) * e * mx + e * e * tx;
    const by = (1 - e) * (1 - e) * p.y + 2 * (1 - e) * e * my + e * e * ty;
    glow(ctx, bx, by, 12, LV, al);
    glow(ctx, p.x, p.y, 26, LV, 0.5 * al * (1 - t));
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
let DOTS: HTMLCanvasElement | null = null;
const dotGrid = () => {
  if (DOTS) return DOTS;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  for (let y = 20; y < H; y += 40) for (let x = 20; x < W; x += 40) g.fillRect(x - 1, y - 1, 2, 2);
  DOTS = c;
  return c;
};

const drawBackground = (ctx: CanvasRenderingContext2D, f: number) => {
  const cold = coldAt(f);
  const warm = warmAt(f);
  const im = imAt(f);
  const inner = mix(mix("#170c30", "#0d1620", cold), "#2e0c44", warm * (1 - im));
  const outer = mix(mix("#030208", "#020407", cold), "#07020e", warm);
  const g = ctx.createRadialGradient(HOME.x, HOME.y, 0, HOME.x, HOME.y, 1150);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // blueprint dot grid
  const ga = (0.07 + 0.03 * cold) * ease.outCubic(prog(f, PERC - 20, PERC + 30)) * (1 - prog(f, SHATTER, SHATTER + 20));
  if (ga > 0) {
    ctx.globalAlpha = ga;
    ctx.drawImage(dotGrid(), 0, 0);
    ctx.globalAlpha = 1;
  }
  if (im > 0) {
    // night sky over the plane
    ctx.globalAlpha = im;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#03020b");
    sky.addColorStop((HORIZON - 40) / H, "#140829");
    sky.addColorStop(HORIZON / H, "#2a1048");
    sky.addColorStop((HORIZON + 60) / H, "#0b0518");
    sky.addColorStop(1, "#040209");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (let s = 0; s < 90; s++) {
      const x = hash(s * 2.3) * W;
      const y = hash(s * 5.9) * (HORIZON - 40);
      glow(ctx, x, y, 2 + 3 * hash(s * 1.1), "#e8dcff", im * (0.25 + 0.35 * noise1(f * 0.08 + s)));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
};

/** Haze + horizon glow + bottom mask over the plane. */
const drawAtmosphere = (ctx: CanvasRenderingContext2D, f: number) => {
  const im = imAt(f);
  if (im <= 0) return;
  ctx.globalAlpha = im;
  const hz = ctx.createLinearGradient(0, HORIZON - 4, 0, HORIZON + 170);
  hz.addColorStop(0, "rgba(36,14,64,0.95)");
  hz.addColorStop(0.35, "rgba(30,12,54,0.55)");
  hz.addColorStop(1, "rgba(20,8,40,0)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, HORIZON - 4, W, 174);
  ctx.globalCompositeOperation = "lighter";
  ctx.save();
  ctx.translate(960, HORIZON);
  ctx.scale(5, 1);
  glow(ctx, 0, 0, 220, HOT, 0.45, 0.05);
  ctx.restore();
  const line = ctx.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, withAlpha(LV, 0));
  line.addColorStop(0.5, withAlpha("#ffe6ff", 0.8));
  line.addColorStop(1, withAlpha(LV, 0));
  ctx.fillStyle = line;
  ctx.fillRect(0, HORIZON - 1.5, W, 3);
  ctx.globalCompositeOperation = "source-over";
  // the caption band stays clean whenever the plane exists
  ctx.globalAlpha = 1;
  const m = ctx.createLinearGradient(0, MASK_Y - 90, 0, 815);
  m.addColorStop(0, "rgba(4,2,9,0)");
  m.addColorStop(1, "rgba(4,2,9,1)");
  ctx.fillStyle = m;
  ctx.fillRect(0, MASK_Y - 90, W, 815 - (MASK_Y - 90));
  ctx.fillStyle = "#040209";
  ctx.fillRect(0, 814, W, H - 814);
  ctx.globalAlpha = 1;
};

/** Pressure before the break: light leaking in at the edges. */
const drawPressure = (ctx: CanvasRenderingContext2D, f: number) => {
  const a = ease.inQuad(prog(f, FLOOD - 4, SHATTER)) * (1 - prog(f, SHATTER, SHATTER + 6));
  if (a <= 0 && (f < FLOOD || f > FLOOD + 18)) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1100);
  g.addColorStop(0, "rgba(255,62,200,0)");
  g.addColorStop(1, withAlpha(C.magenta, 0.28 * a));
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // heartbeat: the neuron re-warms and its shockwave cracks the ice
  const t = f - FLOOD;
  if (t >= 0 && t < 18) {
    const k = 1 - t / 18;
    glow(ctx, HOME.x, HOME.y, 160 + 260 * (1 - k), HOT, 0.7 * k * k, 0.05);
    for (let r = 0; r < 2; r++) {
      const tt = t - r * 2.5;
      if (tt < 0) continue;
      const rad = RING_R0 + RING_V * tt;
      const ra = Math.pow(1 - clamp(tt / 16), 1.5);
      ctx.strokeStyle = withAlpha(HOT, 0.2 * ra);
      ctx.lineWidth = 40 * ra + 6;
      ctx.beginPath();
      ctx.arc(HOME.x, HOME.y, rad, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#ffd6fb", 0.75 * ra);
      ctx.lineWidth = 2 + 4 * ra;
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
};

const Stage: React.FC = () => (
  <Canvas
    draw={(ctx, _w, _h, f) => {
      drawBackground(ctx, f);
      drawSilhouette(ctx, f);
      drawPlane(ctx, f);
      drawAtmosphere(ctx, f);
      drawBeams(ctx, f);
      drawFlood(ctx, f);
      drawLanding(ctx, f);
      drawPerceptron(ctx, f);
      drawPressure(ctx, f);
      drawFrost(ctx, f);
      drawSnow(ctx, f);
      drawCracks(ctx, f);
      drawShards(ctx, f);
    }}
  />
);

// ---------------------------------------------------------------------------------------------
// HUD
const TopLabel: React.FC<{ cn: string; en: string; a: number; col: string; spread?: number }> = ({ cn, en, a, col, spread = 0 }) =>
  a <= 0 ? null : (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 104,
        display: "flex",
        justifyContent: "center",
        alignItems: "baseline",
        gap: 22,
        opacity: a,
        transform: `translateY(${(1 - a) * -10}px)`,
      }}
    >
      <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 50, color: "#fff", letterSpacing: `${0.08 + spread}em`, textShadow: `0 0 22px ${col}, 0 2px 8px #000, 0 0 30px #000` }}>{cn}</span>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 26, color: col, opacity: 0.8 }}>·</span>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 26, color: col, letterSpacing: `${0.3 + spread}em`, textShadow: `0 0 12px ${col}, 0 0 20px #000` }}>{en}</span>
    </div>
  );

const PartLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, PERC + 62, PERC + 82)) * (1 - prog(frame, FREEZE + 4, FREEZE + 24));
  if (a <= 0) return null;
  const items: [number, string, string][] = [
    [HOME.x + IN_X, "输入", "INPUT"],
    [HOME.x + IN_X / 2, "权重 = 线宽", "WEIGHTS"],
    [HOME.x, "加权求和", "SUM"],
    [HOME.x + STEP_X, "阈值", "THRESHOLD"],
    [HOME.x + OUT_X, "输出", "OUTPUT"],
  ];
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {items.map(([x, cn, en], i) => (
        <div key={en} style={{ position: "absolute", left: x - 150, width: 300, top: 734, textAlign: "center", opacity: ease.outCubic(prog(frame, PERC + 62 + i * 4, PERC + 80 + i * 4)) }}>
          <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 26, color: "rgba(255,255,255,0.9)", textShadow: "0 2px 6px #000" }}>{cn}</div>
          <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 15, letterSpacing: "0.3em", color: LV, marginTop: 2 }}>{en}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, IMNET + 20, IMNET + 38));
  if (a <= 0) return null;
  const p = ease.inOutCubic(prog(frame, COUNT_A, COUNT_B));
  const n = 14_000_000 * p;
  const done = prog(frame, COUNT_B, COUNT_B + 12);
  // a small "lock-in" pop when the counter lands on its final value
  const pop = frame >= COUNT_B ? Math.exp(-(frame - COUNT_B) / 7) : 0;
  return (
    <div style={{ position: "absolute", left: 110, top: 86, opacity: a, transform: `translateX(${(1 - a) * -30}px)` }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 26, letterSpacing: "0.34em", color: LV, textShadow: `0 0 14px ${C.violet}` }}>IMAGENET</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 2, transform: `scale(${1 + 0.07 * pop})`, transformOrigin: "left center" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 112,
            lineHeight: 1.05,
            color: "#fff",
            textShadow: `0 0 ${24 + 30 * (1 - done) * p + 40 * pop}px ${C.violet}, 0 0 ${4 + 10 * pop}px ${HOT}, 0 4px 18px #000`,
          }}
        >
          {Math.round(n / 1e4)}
        </span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 80, color: "#fff", marginLeft: 8, textShadow: `0 0 24px ${C.violet}, 0 4px 18px #000` }}>万</span>
      </div>
      <div style={{ height: 3, width: 430, background: "rgba(255,255,255,0.12)", marginTop: 6 }}>
        <div style={{ height: 3, width: `${p * 100}%`, background: `linear-gradient(90deg, ${C.violet}, ${C.magenta})`, boxShadow: `0 0 12px ${C.magenta}` }} />
      </div>
      <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "rgba(255,255,255,0.88)", marginTop: 12, letterSpacing: "0.12em", textShadow: "0 2px 8px #000" }}>
        人工标注的图片
      </div>
    </div>
  );
};

const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  const pa = ease.outCubic(prog(frame, PERC + 26, PERC + 46)) * (1 - prog(frame, FREEZE + 2, FREEZE + 16));
  const wa = ease.outCubic(prog(frame, FREEZE + 18, FREEZE + 40)) * (1 - prog(frame, FLOOD + 2, FLOOD + 12));
  return (
    <AbsoluteFill>
      <TopLabel cn="感知机" en="PERCEPTRON" a={pa} col={LV} />
      <TopLabel cn="AI 寒冬" en="AI WINTER" a={wa} col={"#a9d6ff"} spread={0.06 * prog(frame, FREEZE + 18, FLOOD)} />
      <PartLabels />
      <Counter />
    </AbsoluteFill>
  );
};

export const Neural: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = prog(frame, 0, 14);
  const out = prog(frame, DUR - 18, DUR);
  const sh = shake(frame, SHATTER, 24, 26);
  // a slight push-in while shaking, so the rotated frame never shows its edges
  const zoom = frame >= SHATTER ? 1 + 0.06 * Math.pow(1 - clamp((frame - SHATTER) / 30), 2) : 1;
  const tremble = frame >= FLOOD && frame < SHATTER ? (noise1(frame * 1.3) - 0.5) * 7 * prog(frame, FLOOD, SHATTER) : 0;
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x + tremble}px, ${sh.y}px) rotate(${sh.r * 0.25}rad) scale(${zoom})` }}>
        <Stage />
        <Hud />
      </AbsoluteFill>
      <Flash at={SHATTER} dur={9} color={"#e8dcff"} peak={0.5} />
      <ChapterCard index={6} title="沉睡的大脑" en="THE SLEEPING BRAIN" color={C.violet} dur={85} />
      <YearStamp year="1958" label="美国 · 弗兰克·罗森布拉特" from={PERC + 2} to={FREEZE - 2} color={C.violet} />
      <Captions
        accent={LV}
        items={[
          { from: 95, to: 225, text: "神经网络的想法很老——1958年就有了第一台{{感知机}}。" },
          { from: 235, to: 350, text: "但它沉睡了几十年：{{算力不够，数据也不够}}。" },
          { from: 365, to: 460, text: "直到互联网带来了{{海量数据}}——" },
          { from: 470, to: 595, text: "仅 ImageNet 一个数据集就有{{1400万张}}人工标注的图片。" },
        ]}
      />
    </AbsoluteFill>
  );
};
