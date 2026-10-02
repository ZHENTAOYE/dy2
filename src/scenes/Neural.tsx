import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, hash2, lerp, noise1, prog, rng, shake, TAU } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, YearStamp } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

// ---------------------------------------------------------------------------------------------
// Timing
const DUR = sceneDuration("neural");
const PERC = cue("neural", "perceptron");
const FREEZE = cue("neural", "freeze");
const FLOOD = cue("neural", "flood");
const SHATTER = cue("neural", "shatter");
const IMNET = cue("neural", "imagenet");
const LOCK = cue("neural", "lockin"); // the counter lands on 1400万
const FIRES = ticks("neural", "fire");
/** The last fire of the flood: after it, the re-warmed neuron learns continuously. */
const FLOOD_LAST = Math.max(...FIRES.filter((t) => t < IMNET));
/** Fires after the lock-in: each one sends a wave of light across the mosaic. */
const WAVES = FIRES.filter((t) => t > LOCK);

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

/** 0..1: the perceptron's rise from centre stage to the horizon. */
const riseAt = (f: number) => ease.inOutCubic(prog(f, IMNET - 4, IMNET + 32));
/** Where the perceptron sits: centre stage, then it rises to the horizon above the ImageNet plane
 *  (right of centre, so the ImageNet counter on the left never meets it). */
const viewAt = (f: number) => {
  const k = riseAt(f);
  return { ox: lerp(HOME.x, 1150, k), oy: lerp(HOME.y, 214, k), sc: lerp(1, 0.3, k) };
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
  const flow = warm * ease.outCubic(prog(f, FLOOD_LAST + 4, FLOOD_LAST + 24));

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
    ctx.strokeStyle = withAlpha(base, 0.14 * gI);
    ctx.lineWidth = 6 + 34 * wv;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(xe, ye);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = mix(base, "#0a0614", 0.42);
    ctx.lineWidth = 2.5 + 17 * wv;
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(light, 0.75 + 0.2 * warm);
    ctx.lineWidth = 1 + 5 * wv;
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

const drawSilhouette = (main: CanvasRenderingContext2D, f: number) => {
  const a = ease.outCubic(prog(f, 2, 34)) * (1 - ease.inOutCubic(prog(f, PERC - 14, PERC + 30)));
  if (a <= 0) return;
  const ctx = layer(5);
  const breathe = 0.75 + 0.25 * Math.sin(f * 0.07);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = withAlpha(C.violet, 0.15 * a * breathe);
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
  // keep the chapter card's typography clean: the net thins out to nothing behind it
  const card = 1;
  {
    ctx.globalCompositeOperation = "destination-out";
    ctx.save();
    ctx.translate(960, 545);
    ctx.scale(1, 205 / 470);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 470);
    g.addColorStop(0, `rgba(0,0,0,${card})`);
    g.addColorStop(0.75, `rgba(0,0,0,${0.97 * card})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-470, -470, 940, 940);
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  main.globalCompositeOperation = "lighter";
  main.drawImage(ctx.canvas, 0, 0);
  main.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// Frost: feathered ice dendrites growing in from the frame edges (built once, deterministically)
type FSeg = { x0: number; y0: number; x1: number; y1: number; b: number };
/** [depth][brightness bucket] -> segments sorted by birth time. Depth: spines, barbs, sub-barbs. */
let FROST: FSeg[][][] | null = null;
let GLINTS: { x: number; y: number; b: number; s: number }[] = [];

const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Signed distance to a rounded rectangle (negative inside). */
const rrDist = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** 2D value noise in [0,1). */
const noise2 = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = x - xi;
  const v = y - yi;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, su), lerp(c, d, su), sv);
};
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
};
/** The perceptron as capsules in screen space: the frost keeps a halo round its actual shapes. */
const SKEL: [number, number, number, number, number][] = (() => {
  const o: [number, number, number, number, number][] = [];
  const X = HOME.x;
  const Y = HOME.y;
  for (let i = 0; i < 4; i++) {
    o.push([X + IN_X, Y + IN_Y[i], X + IN_X, Y + IN_Y[i], R_IN + 20]);
    const e = lineEnds(i);
    o.push([X + e.x0, Y + e.y0, X + e.x1, Y + e.y1, 14]);
  }
  o.push([X, Y, X, Y, R_SUM + 22]);
  o.push([X + R_SUM, Y, X + ARROW_END, Y, 16]);
  o.push([X + STEP_X - STEP_W / 2 + 24, Y, X + STEP_X + STEP_W / 2 - 24, Y, STEP_H / 2 + 26]);
  o.push([X + OUT_X, Y, X + OUT_X, Y, R_OUT + 20]);
  return o;
})();
const skelDist = (x: number, y: number) => {
  let d = 1e9;
  for (const s of SKEL) d = Math.min(d, segDist(x, y, s[0], s[1], s[2], s[3]) - s[4]);
  return d;
};
/** Organic halo width: big slow bulges (the ice reaches in here and there) with finer ripples on top. */
const halo = (x: number, y: number) =>
  Math.max(24, 92 + 110 * (2 * noise2(x / 320 + 3.3, y / 250 + 1.7) - 1) + 38 * (2 * noise2(x / 110 + 9.1, y / 110 + 4.3) - 1));
const wob = (x: number, y: number, amp: number) =>
  amp * (2 * noise2(x / 160 + 3.3, y / 160 + 1.7) - 1) + 0.45 * amp * (2 * noise2(x / 52 + 9.1, y / 52 + 4.3) - 1);
/** Warm zones the frost never enters: a halo round the perceptron, the top label and the caption text.
 *  `pad` lets each crystal stop at its own distance, so the inner edge is ragged, not a wall. */
const frostBlocked = (x: number, y: number, pad = 0) =>
  skelDist(x, y) < halo(x, y) + pad ||
  rrDist(x, y, 660, -200, 1260, 200, 60) < 18 + wob(x + 500, y, 26) ||
  rrDist(x, y, 300, 788, 1620, 1300, 90) < wob(x, y + 700, 36);

// depth styles: glow width, glow alpha, glow colour, core width, core colour, core alpha per brightness bucket
const FROST_STYLE: { gw: number; ga: number; gc: string; cw: number; cc: string; ca: number[] }[] = [
  { gw: 7, ga: 0.15, gc: "#9fd2ff", cw: 1.9, cc: "#f4fbff", ca: [0.5, 0.72, 0.95] },
  { gw: 4, ga: 0.055, gc: "#8cc6ff", cw: 1.1, cc: "#dcefff", ca: [0.34, 0.48, 0.64] },
  { gw: 0, ga: 0, gc: "#8cc6ff", cw: 0.8, cc: "#cfeaff", ca: [0.24, 0.34, 0.46] },
];

/** Frost density field (for the haze): it hugs the crystals instead of a hard-coded shape. */
const DCELL = 6;
const DGW = W / DCELL;
const DGH = H / DCELL;
let HZ_M: Float32Array | null = null; // haze amount
let HZ_B: Float32Array | null = null; // local birth time of the crystals

const boxBlur = (src: Float32Array, r: number) => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < DGH; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * DGW + clamp(x, 0, DGW - 1)];
    for (let x = 0; x < DGW; x++) {
      tmp[y * DGW + x] = acc / (2 * r + 1);
      acc += src[y * DGW + Math.min(DGW - 1, x + r + 1)] - src[y * DGW + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < DGW; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, DGH - 1) * DGW + x];
    for (let y = 0; y < DGH; y++) {
      out[y * DGW + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(DGH - 1, y + r + 1) * DGW + x] - tmp[Math.max(0, y - r) * DGW + x];
    }
  }
  return out;
};

const buildFrost = () => {
  if (FROST) return FROST;
  const R = rng(1958);
  const CELL = 5;
  const GW = Math.ceil(W / CELL);
  const GH = Math.ceil(H / CELL);
  const occ = new Int32Array(GW * GH); // which feather claimed the cell
  const own = new Int32Array(GW * GH); // which single line (spine or barb) claimed it
  const cellOf = (x: number, y: number) => {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    return cx < 0 || cy < 0 || cx >= GW || cy >= GH ? -1 : cy * GW + cx;
  };
  const claim = (x: number, y: number, fid: number, lid: number) => {
    const c = cellOf(x, y);
    if (c >= 0 && occ[c] === 0) {
      occ[c] = fid;
      own[c] = lid;
    }
  };
  /** Crystals stop where another feather already grew: they meet, they don't criss-cross. */
  const foreign = (x: number, y: number, fid: number) => {
    const c = cellOf(x, y);
    return c >= 0 && occ[c] !== 0 && occ[c] !== fid;
  };
  const otherLine = (x: number, y: number, lid: number) => {
    const c = cellOf(x, y);
    return c >= 0 && own[c] !== 0 && own[c] !== lid;
  };
  const segs: { s: FSeg; d: number; v: number }[] = [];
  const glints: { x: number; y: number; b: number; s: number }[] = [];
  type Seed = { x: number; y: number; a: number; len: number; b: number; fid: number; v: number; pad: number };
  const barbs: Seed[] = [];
  let nextLine = 1;

  // phase 1: spines (and their secondary spines)
  const spine = (x: number, y: number, ang: number, len: number, b0: number, gen: number, fid: number, v: number, pad: number) => {
    const lid = nextLine++;
    const step = 8;
    const n = Math.max(1, Math.round(len / step));
    const curl = (R() - 0.5) * 0.014;
    let px = x;
    let py = y;
    let a = ang;
    let side = R() < 0.5 ? 1 : -1;
    for (let s = 0; s < n; s++) {
      a += curl + (R() - 0.5) * 0.05;
      const nx = px + Math.cos(a) * step;
      const ny = py + Math.sin(a) * step;
      const mx = (px + nx) / 2;
      const my = (py + ny) / 2;
      if (frostBlocked(nx, ny, pad) || foreign(nx, ny, fid) || foreign(mx, my, fid)) break;
      const b = b0 + s * step;
      segs.push({ s: { x0: px, y0: py, x1: nx, y1: ny, b }, d: 0, v });
      claim(mx, my, fid, lid);
      claim(nx, ny, fid, lid);
      if (R() < 0.12) glints.push({ x: nx, y: ny, b, s: 0.6 + 0.8 * R() });
      // paired barbs, longest a third of the way up the spine: a feather / fern silhouette
      if (s >= 1 && s % 2 === 0) {
        const fr = s / n;
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + fr * 0.95)), 0.75);
        for (const sd of [1, -1]) {
          const bl = Math.min(len * 0.32, 115) * env * (0.6 + 0.6 * R());
          if (bl > 9) barbs.push({ x: nx, y: ny, a: a + sd * (0.98 + (R() - 0.5) * 0.2), len: bl, b: b + 3, fid, v, pad });
        }
      }
      // a secondary spine or two on the big ones
      if (gen === 0 && len > 240 && (s === Math.round(n * 0.3) || s === Math.round(n * 0.58)) && R() < 0.75) {
        spine(nx, ny, a + side * (0.62 + 0.3 * R()), (n - s) * step * (0.45 + 0.25 * R()), b + 4, 1, fid, v, pad);
        side = -side;
      }
      px = nx;
      py = ny;
    }
  };
  let nextFeather = 1;
  const feather = (x: number, y: number, ang: number, len: number, b0: number) => {
    const fid = nextFeather++;
    // its own brightness, and its own idea of where to stop
    const v = Math.floor(hash(fid * 7.13 + 0.4) * 3);
    const pad = 130 * Math.pow(hash(fid * 3.71 + 0.9), 2);
    spine(x, y, ang, len, b0, 0, fid, v, pad);
  };
  const toward = (x: number, y: number) => Math.atan2(HOME.y - y, HOME.x - x);
  // the four corners get the biggest ferns
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    const a0 = toward(x, y);
    feather(x, y, a0 + (R() - 0.5) * 0.2, 780, 0);
    feather(x, y, a0 + 0.45 + 0.2 * R(), 460, 30 + 40 * R());
    feather(x, y, a0 - 0.45 - 0.2 * R(), 460, 30 + 40 * R());
  }
  // edges: feathers every ~95 px, leaning toward the centre
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(L / 95);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5 + (R() - 0.5) * 0.7) / n;
      const x = lerp(x0, x1, t) - nx * 4;
      const y = lerp(y0, y1, t) - ny * 4;
      if (frostBlocked(x + nx * 24, y + ny * 24)) continue;
      const tc = toward(x, y);
      const na = Math.atan2(ny, nx);
      let da = tc - na;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      const a = na + da * 0.45 + (R() - 0.5) * 0.7;
      feather(x, y, a, 200 + 400 * Math.pow(R(), 0.8), 40 + 150 * R());
    }
  };
  edge(0, 0, W, 0, 0, 1);
  edge(W, 0, W, H, -1, 0);
  edge(W, H, 0, H, 0, -1);
  edge(0, H, 0, 0, 1, 0);

  // phase 2: barbs, first-born first, each stopping where it meets another crystal
  barbs.sort((p, q) => p.b - q.b);
  for (const sd of barbs) {
    const lid = nextLine++;
    const step = 6;
    const n = Math.max(1, Math.round(sd.len / step));
    const curl = (R() - 0.5) * 0.03;
    let px = sd.x;
    let py = sd.y;
    let a = sd.a;
    let side = R() < 0.5 ? 1 : -1;
    for (let s = 0; s < n; s++) {
      a += curl + (R() - 0.5) * 0.04;
      const nx = px + Math.cos(a) * step;
      const ny = py + Math.sin(a) * step;
      const mx = (px + nx) / 2;
      const my = (py + ny) / 2;
      if (frostBlocked(nx, ny, sd.pad) || foreign(nx, ny, sd.fid) || (s > 0 && otherLine(nx, ny, lid) && foreign(mx, my, sd.fid))) break;
      const b = sd.b + (s * step) / 0.5;
      segs.push({ s: { x0: px, y0: py, x1: nx, y1: ny, b }, d: 1, v: sd.v });
      claim(mx, my, sd.fid, lid);
      claim(nx, ny, sd.fid, lid);
      // sub-barbs: tiny single needles, alternating sides, only where there is room
      if (s >= 1 && s % 2 === 1 && R() < 0.8) {
        const rem = (n - s) * step;
        const sl = Math.min(13, rem * 0.5) * (0.6 + 0.6 * R());
        if (sl > 3) {
          const ba = a + side * (1.0 + (R() - 0.5) * 0.2);
          const ex = nx + Math.cos(ba) * sl;
          const ey = ny + Math.sin(ba) * sl;
          const hx = nx + Math.cos(ba) * sl * 0.6;
          const hy = ny + Math.sin(ba) * sl * 0.6;
          if (!frostBlocked(ex, ey, sd.pad) && !otherLine(ex, ey, lid) && !otherLine(hx, hy, lid))
            segs.push({ s: { x0: nx, y0: ny, x1: ex, y1: ey, b: b + sl / 0.5 }, d: 2, v: sd.v });
        }
        side = -side;
      }
      px = nx;
      py = ny;
    }
  }

  let bmax = 1;
  for (const s of segs) bmax = Math.max(bmax, s.s.b);
  const out: FSeg[][][] = [0, 1, 2].map(() => [[], [], []]);
  for (const s of segs) {
    s.s.b /= bmax;
    out[s.d][s.v].push(s.s);
  }
  for (const d of out) for (const v of d) v.sort((p, q) => p.b - q.b);
  for (const g of glints) g.b /= bmax;

  // haze: density of crystals, blurred, so the frosted glass follows the ice
  const dens = new Float32Array(DGW * DGH);
  const bsum = new Float32Array(DGW * DGH);
  const DW = [1, 0.55, 0.3];
  for (const s of segs) {
    const cx = Math.floor((s.s.x0 + s.s.x1) / 2 / DCELL);
    const cy = Math.floor((s.s.y0 + s.s.y1) / 2 / DCELL);
    if (cx < 0 || cy < 0 || cx >= DGW || cy >= DGH) continue;
    const w = Math.hypot(s.s.x1 - s.s.x0, s.s.y1 - s.s.y0) * DW[s.d];
    dens[cy * DGW + cx] += w;
    bsum[cy * DGW + cx] += w * s.s.b;
  }
  let dB = dens;
  let bB = bsum;
  for (let it = 0; it < 3; it++) {
    dB = boxBlur(dB, 7);
    bB = boxBlur(bB, 7);
  }
  const sorted = Array.from(dB).filter((v) => v > 1e-3).sort((p, q) => p - q);
  const d90 = sorted[Math.floor(sorted.length * 0.9)] || 1;
  HZ_M = new Float32Array(DGW * DGH);
  HZ_B = new Float32Array(DGW * DGH);
  for (let y = 0; y < DGH; y++)
    for (let x = 0; x < DGW; x++) {
      const i = y * DGW + x;
      const X = (x + 0.5) * DCELL;
      const Y = (y + 0.5) * DCELL;
      const m = Math.pow(clamp(dB[i] / d90), 0.85);
      const n = 0.55 * noise2(X / 110, Y / 110) + 0.3 * noise2(X / 46 + 7, Y / 46 + 3) + 0.15 * noise2(X / 20 + 1, Y / 20 + 9);
      HZ_M[i] = m * (0.25 + 0.75 * n);
      HZ_B[i] = dB[i] > 1e-4 ? bB[i] / dB[i] : 1;
    }

  GLINTS = glints;
  FROST = out;
  return out;
};

const strokeFrost = (ctx: CanvasRenderingContext2D, g: number) => {
  const segs = buildFrost();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  // soft cold glow under the spines and barbs
  for (let d = 0; d < 2; d++) {
    const st = FROST_STYLE[d];
    ctx.beginPath();
    for (const bucket of segs[d])
      for (const s of bucket) {
        if (s.b > g) break;
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
      }
    ctx.lineWidth = st.gw;
    ctx.strokeStyle = withAlpha(st.gc, st.ga);
    ctx.stroke();
  }
  // crisp cores, each feather with its own brightness
  for (let d = 0; d < 3; d++) {
    const st = FROST_STYLE[d];
    for (let v = 0; v < 3; v++) {
      ctx.beginPath();
      for (const s of segs[d][v]) {
        if (s.b > g) break;
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
      }
      ctx.lineWidth = st.cw;
      ctx.strokeStyle = withAlpha(st.cc, st.ca[v]);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
};

/** Frosted-glass haze, revealed as the crystals reach each spot. */
const HAZE_MAX = 0.36;
let HAZE_CV: HTMLCanvasElement | null = null;
let HAZE_IMG: ImageData | null = null;
let HAZE_FULL: HTMLCanvasElement | null = null;
const hazeCanvas = (g: number) => {
  buildFrost();
  if (g >= 1 && HAZE_FULL) return HAZE_FULL;
  const make = () => {
    const c = document.createElement("canvas");
    c.width = DGW;
    c.height = DGH;
    return c;
  };
  if (!HAZE_CV) HAZE_CV = make();
  const c = g >= 1 ? make() : HAZE_CV;
  const cg = c.getContext("2d")!;
  if (!HAZE_IMG) HAZE_IMG = cg.createImageData(DGW, DGH);
  const d = HAZE_IMG.data;
  const M = HZ_M!;
  const B = HZ_B!;
  for (let i = 0; i < DGW * DGH; i++) {
    const a = M[i] * smooth(B[i] - 0.08, B[i] + 0.1, g) * HAZE_MAX;
    d[i * 4] = 188;
    d[i * 4 + 1] = 220;
    d[i * 4 + 2] = 252;
    d[i * 4 + 3] = Math.round(255 * clamp(a));
  }
  cg.putImageData(HAZE_IMG, 0, 0);
  if (g >= 1) HAZE_FULL = c;
  return c;
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
const GROW_B = FLOOD - 8;
const frostG = (f: number) => ease.inOutSine(prog(f, GROW_A, GROW_B));

const drawHaze = (ctx: CanvasRenderingContext2D, g: number) => {
  if (g <= 0) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(hazeCanvas(g), 0, 0, W, H);
};

const drawGlints = (ctx: CanvasRenderingContext2D, f: number, g: number, a: number) => {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  for (let k = 0; k < GLINTS.length; k++) {
    const q = GLINTS[k];
    if (q.b > g) continue;
    const tw = Math.pow(noise1(f * 0.09 + k * 1.37), 3);
    const al = a * tw * clamp((g - q.b) * 30);
    if (al < 0.03) continue;
    const r = 10 * q.s * (0.5 + tw);
    glow(ctx, q.x, q.y, r, "#bfe4ff", 0.85 * al);
    ctx.globalAlpha = 0.75 * al;
    ctx.beginPath();
    ctx.moveTo(q.x - r * 1.7, q.y);
    ctx.lineTo(q.x + r * 1.7, q.y);
    ctx.moveTo(q.x, q.y - r * 1.7);
    ctx.lineTo(q.x, q.y + r * 1.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
};

/** The frozen pane: haze + dendrites, until the dam breaks. */
const drawFrost = (main: CanvasRenderingContext2D, f: number) => {
  if (f < GROW_A || f >= SHATTER) return;
  const ctx = layer(6);
  const g = frostG(f);
  drawHaze(ctx, g);
  if (f >= GROW_B) {
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(frostFull(), 0, 0);
    ctx.globalCompositeOperation = "source-over";
  } else strokeFrost(ctx, g);
  // bright crystallisation fronts at the growing tips
  if (g < 1) {
    const segs = buildFrost();
    ctx.globalCompositeOperation = "lighter";
    for (const bucket of segs[0])
      for (const s of bucket) {
        if (s.b > g) break;
        if (s.b > g - 0.01) glow(ctx, s.x1, s.y1, 12, ICE, 0.75);
      }
    ctx.globalCompositeOperation = "source-over";
  }
  drawGlints(ctx, f, g, 1 - prog(f, FLOOD, SHATTER));
  commit(main, ctx, "source-over", 0.7);
};

// ---------------------------------------------------------------------------------------------
// Offscreen effect layers, masked out of the caption band before they are composited
/** 1 inside the caption text box (x 290..1630), soft edged. */
const boxK = (x: number) => smooth(250, 330, x) * (1 - smooth(1590, 1670, x));
/** How strongly effects are kept out of the caption band: fully in the text box, `corner` beside it. */
const bandK = (x: number, y: number, corner = 0.7) => smooth(690, 845, y) * (corner + (1 - corner) * boxK(x));
const BANDS = new Map<number, HTMLCanvasElement>();
const bandMask = (corner: number) => {
  const hit = BANDS.get(corner);
  if (hit) return hit;
  const w = 240;
  const h = 135;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * bandK(((x + 0.5) * W) / w, ((y + 0.5) * H) / h, corner));
    }
  g.putImageData(img, 0, 0);
  BANDS.set(corner, c);
  return c;
};
const LAYERS: HTMLCanvasElement[] = [];
const layer = (k: number) => {
  if (!LAYERS[k]) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    LAYERS[k] = c;
  }
  const g = LAYERS[k].getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, W, H);
  return g;
};
/** Composite an effect layer, first clearing it out of the caption band (`corner` < 1 keeps some beside the text). */
const commit = (ctx: CanvasRenderingContext2D, g: CanvasRenderingContext2D, op: GlobalCompositeOperation, corner = 1) => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "destination-out";
  g.imageSmoothingEnabled = true;
  g.drawImage(bandMask(corner), 0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  ctx.globalCompositeOperation = op;
  ctx.drawImage(g.canvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// The dam breaks: the re-warmed neuron cracks the pane like a stone hitting glass
const NRAD = 22;
const RING_R = [58, 128, 214, 322, 456, 620, 820, 1060, 1360, 1720];
type Cell = { poly: number[]; cx: number; cy: number; dist: number; bx: number; by: number; bw: number; bh: number; id: number };
type Web = { rad: number[][]; radR: number[][]; radS: number[]; ring: number[][]; ringT: number[]; cells: Cell[]; nodes: number[] };
let WEB: Web | null = null;

/** Radius of the crack front: two heartbeats, the second one runs off the screen. */
const crackR = (f: number) => {
  const t = f - FLOOD;
  if (t < 0) return 0;
  return 380 * ease.outCubic(clamp(t / 6)) + 1500 * ease.outCubic(clamp((t - 7) / 6.5));
};
/** Every spoke runs at its own pace and sets off a little late or early: glass, not a wagon wheel. */
const SPOKE_K = Array.from({ length: NRAD }, (_, i) => 0.7 + 0.6 * hash(i * 5.17 + 0.3));
const SPOKE_D = Array.from({ length: NRAD }, (_, i) => 2 * hash(i * 2.93 + 0.7));
const spokeR = (i: number, f: number) => crackR(f - SPOKE_D[i]) * SPOKE_K[i];
const spokeTime = (i: number, r: number) => {
  for (let x = FLOOD; x <= SHATTER; x += 0.25) if (spokeR(i, x) >= r) return x;
  return SHATTER;
};

const buildWeb = () => {
  if (WEB) return WEB;
  const R = rng(374);
  const base = R() * TAU;
  const NJ = RING_R.length;
  const ang: number[] = [];
  for (let i = 0; i < NRAD; i++) ang.push(base + ((i + (R() - 0.5) * 0.5) * TAU) / NRAD);
  // vertices
  const P: [number, number][][] = [];
  for (let i = 0; i < NRAD; i++) {
    P[i] = [];
    for (let j = 0; j < NJ; j++) {
      const a = ang[i] + ((R() - 0.5) * 0.46 * TAU) / NRAD;
      const r = RING_R[j] * (1 + (R() - 0.5) * 0.3);
      P[i][j] = [HOME.x + Math.cos(a) * r, HOME.y + Math.sin(a) * r];
    }
  }
  const jag = (a: [number, number], b: [number, number], n: number, amp: number) => {
    const pts = [a[0], a[1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const px = -dy / l;
    const py = dx / l;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const j = (R() - 0.5) * 2 * amp * l;
      pts.push(a[0] + dx * t + px * j, a[1] + dy * t + py * j);
    }
    pts.push(b[0], b[1]);
    return pts;
  };
  // radial edges (inner -> outer) and ring edges (i -> i+1)
  const radE: number[][][] = [];
  const ringE: number[][][] = [];
  for (let i = 0; i < NRAD; i++) {
    radE[i] = [];
    ringE[i] = [];
    for (let j = 0; j < NJ; j++) {
      const inner: [number, number] = j === 0 ? [HOME.x, HOME.y] : P[i][j - 1];
      radE[i][j] = jag(inner, P[i][j], j < 2 ? 2 : 4, 0.04);
      const nb = P[(i + 1) % NRAD][j];
      // bow outward a little, so the rings read as arcs
      const mx = (P[i][j][0] + nb[0]) / 2 - HOME.x;
      const my = (P[i][j][1] + nb[1]) / 2 - HOME.y;
      const e = jag(P[i][j], nb, 3, 0.05);
      const ml = Math.hypot(mx, my) || 1;
      for (let k = 2; k < e.length - 2; k += 2) {
        e[k] += (mx / ml) * RING_R[j] * 0.035;
        e[k + 1] += (my / ml) * RING_R[j] * 0.035;
      }
      ringE[i][j] = e;
    }
  }
  const rad: number[][] = [];
  const radR: number[][] = [];
  const radS: number[] = [];
  const pushRad = (e: number[], spoke: number) => {
    rad.push(e);
    radS.push(spoke);
    const rr: number[] = [];
    for (let k = 0; k < e.length; k += 2) rr.push(Math.hypot(e[k] - HOME.x, e[k + 1] - HOME.y));
    radR.push(rr);
  };
  for (let i = 0; i < NRAD; i++) for (let j = 0; j < NJ; j++) pushRad(radE[i][j], i);
  // forks: a third of the spokes split once or twice on their way out
  for (let i = 0; i < NRAD; i++) {
    if (hash(i * 8.31 + 0.2) > 0.36) continue;
    const nf = hash(i * 4.4 + 0.6) < 0.4 ? 2 : 1;
    for (let q = 0; q < nf; q++) {
      const j0 = 2 + Math.floor(hash(i * 3.9 + q * 1.7) * 4);
      const from = P[i][j0];
      const a = Math.atan2(from[1] - HOME.y, from[0] - HOME.x) + (hash(i * 6.1 + q) < 0.5 ? -1 : 1) * (0.22 + 0.25 * hash(i * 2.2 + q * 5.5));
      const len = (RING_R[Math.min(NJ - 1, j0 + 2)] - RING_R[j0]) * (0.6 + 0.5 * hash(i * 9.7 + q));
      const to: [number, number] = [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
      pushRad(jag(from, to, 5, 0.06), i);
    }
  }
  const ring: number[][] = [];
  const ringT: number[] = [];
  for (let i = 0; i < NRAD; i++)
    for (let j = 0; j < NJ; j++) {
      // not every concentric crack forms before the break
      if (R() < 0.34 && j > 0) continue;
      ring.push(ringE[i][j]);
      const r = RING_R[j] * 1.05;
      ringT.push(Math.max(spokeTime(i, r), spokeTime((i + 1) % NRAD, r)) + 0.5 + 2 * R());
    }
  // shards: the cells between two radial cracks and two rings
  const cells: Cell[] = [];
  const rev = (e: number[]) => {
    const o: number[] = [];
    for (let k = e.length - 2; k >= 0; k -= 2) o.push(e[k], e[k + 1]);
    return o;
  };
  for (let i = 0; i < NRAD; i++) {
    const i2 = (i + 1) % NRAD;
    for (let j = 0; j < NJ; j++) {
      let poly: number[];
      if (j === 0) poly = [...radE[i][0], ...ringE[i][0].slice(2), ...rev(radE[i2][0]).slice(2, -2)];
      else poly = [...ringE[i][j - 1], ...radE[i2][j].slice(2), ...rev(ringE[i][j]).slice(2), ...rev(radE[i][j]).slice(2, -2)];
      let sx = 0;
      let sy = 0;
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      const np = poly.length / 2;
      for (let k = 0; k < poly.length; k += 2) {
        sx += poly[k];
        sy += poly[k + 1];
        x0 = Math.min(x0, poly[k]);
        y0 = Math.min(y0, poly[k + 1]);
        x1 = Math.max(x1, poly[k]);
        y1 = Math.max(y1, poly[k + 1]);
      }
      const bx = Math.max(0, Math.floor(x0));
      const by = Math.max(0, Math.floor(y0));
      const bw = Math.min(W, Math.ceil(x1)) - bx;
      const bh = Math.min(H, Math.ceil(y1)) - by;
      if (bw < 2 || bh < 2) continue;
      const cx = sx / np;
      const cy = sy / np;
      cells.push({ poly, cx, cy, dist: Math.hypot(cx - HOME.x, cy - HOME.y), bx, by, bw, bh, id: i * 31 + j });
    }
  }
  // junctions: x, y, time the crack reaches them
  const nodes: number[] = [];
  for (let i = 0; i < NRAD; i++) for (let j = 0; j < NJ - 2; j++) nodes.push(P[i][j][0], P[i][j][1], spokeTime(i, RING_R[j]));
  WEB = { rad, radR, radS, ring, ringT, cells, nodes };
  return WEB;
};

const drawCracks = (main: CanvasRenderingContext2D, f: number) => {
  if (f < FLOOD || f >= SHATTER) return;
  const web = buildWeb();
  const ctx = layer(0);
  const fronts = SPOKE_K.map((_, i) => spokeR(i, f));
  const path = () => {
    // radial cracks follow their spoke's front
    for (let e = 0; e < web.rad.length; e++) {
      const front = fronts[web.radS[e]];
      const pts = web.rad[e];
      const rr = web.radR[e];
      if (rr[0] >= front) continue;
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 1; k < rr.length; k++) {
        if (rr[k] <= front) ctx.lineTo(pts[2 * k], pts[2 * k + 1]);
        else {
          const u = clamp((front - rr[k - 1]) / (rr[k] - rr[k - 1]));
          ctx.lineTo(lerp(pts[2 * k - 2], pts[2 * k], u), lerp(pts[2 * k - 1], pts[2 * k + 1], u));
          break;
        }
      }
    }
    // concentric cracks snap across behind it
    for (let e = 0; e < web.ring.length; e++) {
      const t = clamp((f - web.ringT[e]) / 3);
      if (t <= 0) continue;
      const pts = web.ring[e];
      const n = pts.length / 2 - 1;
      const upto = t * n;
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 1; k <= Math.ceil(upto); k++) {
        const u = Math.min(1, upto - (k - 1));
        ctx.lineTo(lerp(pts[2 * k - 2], pts[2 * k], u), lerp(pts[2 * k - 1], pts[2 * k + 1], u));
      }
    }
  };
  const heat = prog(f, FLOOD, SHATTER);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [wd, col, al] of [
    [16, HOT, 0.1 + 0.12 * heat],
    [6, C.magenta, 0.28 + 0.2 * heat],
    [1.8, "#fff6ff", 0.95],
  ] as const) {
    ctx.beginPath();
    path();
    ctx.lineWidth = wd;
    ctx.strokeStyle = withAlpha(col, al);
    ctx.stroke();
  }
  // light bursting through the junctions
  for (let k = 0; k < web.nodes.length; k += 3) {
    const age = (f - web.nodes[k + 2]) / 6;
    if (age < 0) continue;
    glow(ctx, web.nodes[k], web.nodes[k + 1], 10 + 14 * Math.exp(-age), "#ffc8f4", 0.35 + 0.5 * Math.exp(-age));
  }
  commit(main, ctx, "lighter");
};

/** Each shard's piece of the frozen pane, cut once into its own small sprite. */
let SHARD_SPR: HTMLCanvasElement[] | null = null;
const shardSprites = () => {
  if (SHARD_SPR) return SHARD_SPR;
  const web = buildWeb();
  const sheet = document.createElement("canvas");
  sheet.width = W;
  sheet.height = H;
  const sg = sheet.getContext("2d")!;
  drawHaze(sg, 1);
  sg.globalCompositeOperation = "lighter";
  sg.drawImage(frostFull(), 0, 0);
  sg.globalCompositeOperation = "source-over";
  SHARD_SPR = web.cells.map((s) => {
    const c = document.createElement("canvas");
    c.width = s.bw;
    c.height = s.bh;
    const g = c.getContext("2d")!;
    g.translate(-s.bx, -s.by);
    g.beginPath();
    for (let k = 0; k < s.poly.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, s.poly[k], s.poly[k + 1]);
    g.closePath();
    g.clip();
    g.drawImage(sheet, s.bx, s.by, s.bw, s.bh, s.bx, s.by, s.bw, s.bh);
    return c;
  });
  return SHARD_SPR;
};

const SHARD_LIFE = 26;
/** A shard's transform at its own time t: blown outward and toward the camera, tumbling. */
const shardXf = (s: Cell, t: number): [number, number, number, number, number, number] => {
  const h1 = hash(s.id * 1.37 + 0.3);
  const h2 = hash(s.id * 2.71 + 3);
  const h3 = hash(s.id * 4.13 + 7);
  let dx = s.cx - HOME.x;
  let dy = s.cy - HOME.y;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const d = (11 + 24 * h1 + s.dist * 0.036) * t + (0.6 + 1.2 * h2) * t * t;
  const sc = 1 + (0.55 + 0.5 * h3) * (1 - Math.exp(-t / 7)) + 0.012 * t;
  const rot = (h2 - 0.5) * 0.2 * t;
  const flip = Math.cos(t * (0.04 + 0.12 * h1));
  const sy = sc * Math.sign(flip || 1) * Math.max(0.12, Math.abs(flip));
  const tx = s.cx + dx * d;
  const ty = s.cy + dy * d;
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const a = ca * sc;
  const b = sa * sc;
  const c = -sa * sy;
  const e = ca * sy;
  return [a, b, c, e, tx - a * s.cx - c * s.cy, ty - b * s.cx - e * s.cy];
};

const drawShards = (main: CanvasRenderingContext2D, f: number) => {
  if (f < SHATTER || f > SHATTER + SHARD_LIFE) return;
  const web = buildWeb();
  const spr = shardSprites();
  const ctx = layer(1);
  const add = layer(2);
  add.lineJoin = "round";
  add.lineCap = "round";
  const t0 = f - SHATTER;
  // the cracks' magenta glow carries over onto the shard edges for the first frames
  const heat = Math.pow(1 - clamp(t0 / 7), 1.5);
  for (let si = 0; si < web.cells.length; si++) {
    const s = web.cells[si];
    const h1 = hash(s.id * 1.37 + 0.3);
    const h3 = hash(s.id * 4.13 + 7);
    // +1: even on the first frame of the break every piece has already jumped
    const t = Math.max(0, t0 + 1.6 - 1.2 * clamp(s.dist / 1100) * (0.6 + 0.8 * h1));
    const life = 12 + 12 * h3;
    const al = 1 - ease.inQuad(clamp(t / life));
    if (al <= 0) continue;
    const m = shardXf(s, t);
    const sc = Math.hypot(m[0], m[1]);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = al;
    ctx.drawImage(spr[si], s.bx, s.by);
    // motion streaks from where its corners were a moment ago
    if (t > 0.5) {
      const p = shardXf(s, Math.max(0, t - 1.8));
      add.setTransform(1, 0, 0, 1, 0, 0);
      add.globalCompositeOperation = "lighter";
      add.beginPath();
      for (let k = 0; k < s.poly.length; k += 4) {
        const x = s.poly[k];
        const y = s.poly[k + 1];
        add.moveTo(p[0] * x + p[2] * y + p[4], p[1] * x + p[3] * y + p[5]);
        add.lineTo(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
      }
      add.strokeStyle = withAlpha(heat > 0.05 ? "#ff9cf0" : "#e6dcff", 0.32 * al * al);
      add.lineWidth = 1.6;
      add.stroke();
    }
    // the rim: hot crack glow first, then a cool glint that catches the light as it turns
    add.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    add.beginPath();
    for (let k = 0; k < s.poly.length; k += 2) (k ? add.lineTo : add.moveTo).call(add, s.poly[k], s.poly[k + 1]);
    add.closePath();
    add.globalCompositeOperation = "lighter";
    if (heat > 0.01) {
      add.strokeStyle = withAlpha(HOT, 0.24 * heat * al);
      add.lineWidth = 16 / sc;
      add.stroke();
      add.strokeStyle = withAlpha(C.magenta, 0.6 * heat * al);
      add.lineWidth = 6 / sc;
      add.stroke();
      add.strokeStyle = withAlpha("#fff6ff", 0.95 * heat);
      add.lineWidth = 2 / sc;
      add.stroke();
    }
    const spec = Math.pow(0.5 + 0.5 * Math.cos(t * 0.35 + h1 * 6.3), 4);
    add.fillStyle = withAlpha("#e9e2ff", (0.01 + 0.1 * spec) * al);
    add.fill();
    add.strokeStyle = withAlpha(mix("#ffc6f2", "#ffffff", spec), (0.3 + 0.6 * spec) * al * al);
    add.lineWidth = (1.2 + 1.4 * spec) / sc;
    add.stroke();
  }
  for (const g of [ctx, add]) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
  }
  commit(main, ctx, "source-over");
  // glittering ice dust from the fracture lines
  add.globalCompositeOperation = "lighter";
  for (let k = 0; k < 320; k++) {
    const n = Math.floor(hash(k * 3.17) * (web.nodes.length / 3)) * 3;
    const x0 = web.nodes[n] + (hash(k * 5.3) - 0.5) * 120;
    const y0 = web.nodes[n + 1] + (hash(k * 6.1) - 0.5) * 120;
    let dx = x0 - HOME.x;
    let dy = y0 - HOME.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const v = 12 + 34 * hash(k * 7.7);
    const tt = t0 + 1;
    const d = v * tt + 0.5 * tt * tt;
    const life = 12 + 16 * hash(k * 8.3);
    const a = 1 - clamp(tt / life);
    if (a <= 0) continue;
    glow(add, x0 + dx * d, y0 + dy * d, 3 + 5 * hash(k * 9.1), k % 3 ? ICE : "#ffd0f6", a * 0.9);
  }
  commit(main, add, "lighter");
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
    glow(ctx, x, y, 3 + 7 * depth, ICE, (0.2 + 0.4 * hash(k * 7.7)) * a * (1 - bandK(x, y, 0.7)));
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
const F_WD = new Uint8Array(NF);
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
  F_WD[k] = Math.floor(hash(k * 3.91 + 0.17) * WORDS.length);
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
/** Keep the caption text clear: particles dissolve between y = 745 and 815 under the text, and only
 *  partly beside it, so the deluge still pours in through the bottom corners. */
const bandFade = (x: number, y: number) => 1 - clamp((y - 745) / 70) * (0.5 + 0.5 * boxK(x));

/** A few big thumbnails right in front of the lens, streaking in: the flood has real depth. */
const HERO = (() => {
  const n = 16;
  const out: { a: number; t0: number; dur: number; s0: number; img: number; tilt: number; sw: number; r0: number }[] = [];
  // directions round the frame, skipping straight up out of the caption
  const lo = 2.45;
  const span = TAU - (2.45 - 0.62);
  for (let k = 0; k < n; k++) {
    let a = lo + ((k + 0.2 + 0.6 * hash(k * 3.3 + 0.1)) / n) * span;
    if (a > Math.PI) a -= TAU;
    out.push({
      a,
      t0: 1 + 30 * hash(k * 5.7 + 0.1),
      dur: 17 + 10 * hash(k * 2.1 + 0.4),
      s0: 120 + 70 * hash(k * 7.3 + 0.2),
      img: Math.floor(hash(k * 9.1 + 0.6) * N_IMG),
      tilt: (hash(k * 4.7 + 0.3) - 0.5) * 0.35,
      sw: (hash(k * 6.6 + 0.8) - 0.5) * 0.7,
      r0: rectExit(HOME.x, HOME.y, a, 150),
    });
  }
  return out;
})();
const drawHeroes = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < SHATTER || f > SHATTER + 64) return;
  const at = (h: (typeof HERO)[number], u: number) => {
    const a = h.a + h.sw * u * u;
    const r = h.r0 * Math.pow(1 - clamp(u), 1.1);
    return { x: HOME.x + Math.cos(a) * r, y: HOME.y + Math.sin(a) * r, s: h.s0 * (0.4 + 0.6 * Math.pow(1 - clamp(u), 1.3)) };
  };
  for (const h of HERO) {
    const u = (f - SHATTER - h.t0) / h.dur;
    if (u < 0 || u > 0.56) continue;
    const vis = clamp(u / 0.05) * (1 - smooth(0.3, 0.52, u));
    // motion ghosts first, then the tile itself
    for (let g = 3; g >= 0; g--) {
      const p = at(h, u - g * 0.028);
      const a = vis * bandFade(p.x, p.y) * (g ? 0.16 * (4 - g) / 3 : 0.92);
      if (a <= 0.01) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(h.tilt);
      ctx.globalAlpha = a;
      drawThumbAt(ctx, h.img, -p.s / 2, -p.s * 0.375, p.s, p.s * 0.75);
      if (!g) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = withAlpha("#efe6ff", 0.55);
        ctx.lineWidth = 2;
        ctx.strokeRect(-p.s / 2, -p.s * 0.375, p.s, p.s * 0.75);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
};

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
const TAG_IN = 8; // tag bars and boxes fade in after a tile settles
const COUNT_A = IMNET + 14; // the counter rolls up as it fades in ...
const COUNT_B = LOCK; // ... and locks in while the highlighted 1400万张 is still fresh
const imgOf = (i: number, j: number) => {
  const s = SLOTS.get(slotKey(i, j));
  return s ? F_IMG[s.k] : Math.floor(hash2(i * 1.31 + 0.5, j * 0.71 + 0.3) * N_IMG);
};
const TAG_COLS = [C.magenta, C.cyan, C.gold, C.green, LV];

const APPEAR = 9;
/** When a (non-flood) tile starts to appear: near rows first, receding to the horizon. */
const tileStart = (i: number, j: number) => {
  const zn = clamp((j * PV) / (NJ * PV * 0.92));
  return IMNET + 10 + 66 * Math.pow(zn, 0.85) + 6 * hash2(i * 0.37, j * 0.91);
};

/** Lock-in scan: a band of light runs from the viewer to the horizon, flashing every tag on its way. */
const SCAN_LEN = 46;
const scanZr = (st: number) => 900 + st * st * 4.2;
/** After the lock-in, each fire sends a ring of light rolling across the mosaic toward the viewer. */
const WAVE_X = 840;
const WAVE_Z = Z0 + 58 * PV;
const WAVE_LEN = 26;

const drawPlane = (ctx: CanvasRenderingContext2D, f: number) => {
  const im = imAt(f);
  if (im <= 0) return;
  const cam = camAt(f);
  const cz = camZ(f);
  const st = f - LOCK;
  const scanOn = st >= 0 && st < SCAN_LEN;
  const zs = scanZr(st);
  const sa = scanOn ? Math.pow(1 - st / SCAN_LEN, 0.6) : 0;
  const waves: { R: number; wd: number; a: number }[] = [];
  for (const w of WAVES) {
    const t = f - w;
    if (t < 0 || t >= WAVE_LEN) continue;
    const R = 280 * t;
    waves.push({ R, wd: 130 + 0.06 * R, a: Math.pow(1 - t / WAVE_LEN, 1.1) });
  }
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
    const sb = scanOn ? sa * Math.exp(-Math.pow((zr - zs) / (70 + 0.06 * zr), 2)) : 0;
    const dz2 = (Z - WAVE_Z) * (Z - WAVE_Z);
    for (let i = -imax; i <= imax; i++) {
      const x = pc.x + i * PU * s;
      if (x + tw / 2 < 0 || x - tw / 2 > W) continue;
      const slot = SLOTS.get(slotKey(i, j));
      if (slot && f < slot.t0 + FLIGHT) continue;
      let app = 1;
      let tagK = 1;
      if (slot) tagK = ease.outCubic(prog(f, slot.t0 + FLIGHT, slot.t0 + FLIGHT + TAG_IN));
      else {
        const t0 = tileStart(i, j);
        app = clamp((f - t0) / APPEAR);
        tagK = ease.outCubic(prog(f, t0 + APPEAR, t0 + APPEAR + TAG_IN));
      }
      if (app <= 0) continue;
      const pop = slot ? 1 : 0.55 + 0.45 * ease.outBack(app);
      const a = fog * clamp(app * 1.6);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      const img = imgOf(i, j);
      const w2 = tw * pop;
      const h2 = th * pop;
      const y2 = pf.y + (th - h2) / 2;
      drawThumbAt(ctx, img, x - w2 / 2, y2, w2, h2);
      const cat = Math.floor(hash2(i * 5.1 + 0.2, j * 2.3 + 0.1) * TAG_COLS.length);
      // light: the appear flash (brief), the lock-in scan, the waves
      let wv = 0;
      for (const w of waves) {
        const d = Math.sqrt((i * PU - WAVE_X) * (i * PU - WAVE_X) + dz2) - w.R;
        wv = Math.max(wv, w.a * Math.exp(-(d * d) / (w.wd * w.wd)));
      }
      const flash = 0.35 * (1 - app) * (1 - app);
      if (flash > 0.01 || sb > 0.02 || wv > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        if (flash > 0.01) {
          ctx.globalAlpha = flash * fog;
          ctx.fillStyle = LV;
          ctx.fillRect(x - w2 / 2, y2, w2, h2);
        }
        if (sb > 0.02) {
          ctx.globalAlpha = 0.26 * sb * fog;
          ctx.fillStyle = "#c9b2ff";
          ctx.fillRect(x - w2 / 2, y2, w2, h2);
        }
        if (wv > 0.02) {
          ctx.globalAlpha = Math.min(1, 1.05 * wv * fog);
          ctx.fillStyle = TAG_COLS[cat];
          ctx.fillRect(x - w2 / 2, y2, w2, h2);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // annotation: tag bar under the tile, and a box on some
      if (tw > 30 && tagK > 0) {
        const gap = Math.max(2, th * 0.12);
        const ta = a * tagK;
        ctx.globalAlpha = ta;
        ctx.fillStyle = TAG_COLS[cat];
        ctx.fillRect(x - tw / 2, pn.y + gap * 0.5, tw * (0.25 + 0.2 * hash2(i, j)), gap * 0.9);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(x - tw / 2 + tw * 0.5, pn.y + gap * 0.75, tw * 0.35, Math.max(1, gap * 0.35));
        const boxed = hash2(i * 3.3 + 1, j * 7.7 + 2) > 0.55;
        if (boxed) {
          const bx = x - tw / 2 + tw * (0.12 + 0.2 * hash2(i, j * 3));
          const by = pf.y + th * (0.12 + 0.2 * hash2(i * 2, j));
          ctx.strokeStyle = TAG_COLS[cat];
          ctx.lineWidth = Math.max(1, tw / 40);
          ctx.strokeRect(bx, by, tw * 0.5, th * 0.6);
          if (sb > 0.05) {
            // the scan makes every label flare
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = Math.min(1, ta * sb * 1.4);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = Math.max(1.5, tw / 26);
            ctx.strokeRect(bx, by, tw * 0.5, th * 0.6);
            ctx.globalCompositeOperation = "source-over";
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  // the wave fronts themselves: rings of light on the ground
  if (waves.length) {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (const w of waves) {
      ctx.beginPath();
      let pen = false;
      for (let q = 0; q <= 160; q++) {
        const th = (q / 160) * TAU;
        const Z = WAVE_Z + Math.sin(th) * w.R;
        const p = Z - cz > 300 ? project(cam, WAVE_X + Math.cos(th) * w.R, HC, Z) : null;
        if (!p || p.y > MASK_Y + 60) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      for (const [wd, col, al] of [
        [26, HOT, 0.14],
        [8, LV, 0.4],
        [2.2, "#fff4ff", 0.95],
      ] as const) {
        ctx.lineWidth = wd;
        ctx.strokeStyle = withAlpha(col, al * w.a);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // the scan line itself
  if (scanOn) {
    const p = project(cam, 0, HC, cz + zs);
    if (p && p.y < MASK_Y + 60) {
      const hh = Math.max(4, 70 * p.s);
      const g = ctx.createLinearGradient(0, p.y - hh, 0, p.y + hh);
      g.addColorStop(0, withAlpha(LV, 0));
      g.addColorStop(0.5, withAlpha("#e6d6ff", 0.5 * sa));
      g.addColorStop(1, withAlpha(LV, 0));
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(0, p.y - hh, W, 2 * hh);
      ctx.fillStyle = withAlpha("#ffffff", 0.8 * sa);
      ctx.fillRect(0, p.y - 1, W, 2);
      ctx.globalCompositeOperation = "source-over";
    }
  }
};

/** The atmosphere's two darkening gradients (horizon haze, bottom mask), shared with the landing tiles. */
const atmosGrads = (ctx: CanvasRenderingContext2D) => {
  const hz = ctx.createLinearGradient(0, HORIZON - 4, 0, HORIZON + 170);
  hz.addColorStop(0, "rgba(36,14,64,0.95)");
  hz.addColorStop(0.35, "rgba(30,12,54,0.55)");
  hz.addColorStop(1, "rgba(20,8,40,0)");
  const m = ctx.createLinearGradient(0, MASK_Y - 90, 0, 815);
  m.addColorStop(0, "rgba(4,2,9,0)");
  m.addColorStop(1, "rgba(4,2,9,1)");
  return { hz, m };
};
/** Darken one rect exactly as the atmosphere darkens the plane under it (k = how much). */
const shadeRect = (ctx: CanvasRenderingContext2D, gr: ReturnType<typeof atmosGrads>, im: number, x: number, y: number, w: number, h: number, k: number) => {
  if (k <= 0) return;
  const band = (y0: number, y1: number, style: CanvasGradient | string, a: number) => {
    const ya = Math.max(y, y0);
    const yb = Math.min(y + h, y1);
    if (yb <= ya || a <= 0) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = style;
    ctx.fillRect(x, ya, w, yb - ya);
  };
  band(HORIZON - 4, HORIZON + 170, gr.hz, im * k);
  band(MASK_Y - 90, 815, gr.m, k);
  band(814, H, "#040209", k);
  ctx.globalAlpha = 1;
};

/** Particles that land in their slots (flood -> plane). */
const drawLanding = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < IMNET || f > IMNET + 20 + FLIGHT) return;
  const cam = camAt(f);
  const im = imAt(f);
  const gr = atmosGrads(ctx);
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
    ctx.globalAlpha = lerp(bandFade(x, y), 1, e);
    drawThumbAt(ctx, F_IMG[s.k], x - w / 2, y - h / 2, w, h);
    // as it settles it sinks into the same atmosphere as the tiles around it: no pop at hand-over
    shadeRect(ctx, gr, im, x - w / 2, y - h / 2, w, h, e);
  }
  ctx.globalAlpha = 1;
};

/** Speed lines and motion trails of the flood, on a layer that keeps out of the caption text. */
const drawFloodLines = (main: CanvasRenderingContext2D, f: number, T: number, spd: number, fade: number, fin: number) => {
  const lc = layer(4);
  lc.globalCompositeOperation = "lighter";
  lc.lineCap = "round";
  lc.lineWidth = 2;
  for (let k = 0; k < 120; k++) {
    const a = hash(k * 4.7) * TAU;
    const ph = (T * 0.009 * (0.7 + 0.6 * hash(k * 2.2)) + hash(k * 8.1)) % 1;
    const r1 = 1250 * (1 - ph);
    const r2 = Math.max(90, r1 - 80 - 220 * ph * spd * 0.5);
    lc.strokeStyle = withAlpha(k % 3 ? LV : C.magenta, 0.16 * (1 - ph) * fade * fin);
    lc.beginPath();
    lc.moveTo(HOME.x + Math.cos(a) * r1, HOME.y + Math.sin(a) * r1);
    lc.lineTo(HOME.x + Math.cos(a) * r2, HOME.y + Math.sin(a) * r2);
    lc.stroke();
  }
  // motion trails (one batched path per colour)
  const trail = 4 + 3 * spd;
  for (const [col, al] of [
    [LV, 0.22],
    [C.magenta, 0.16],
  ] as const) {
    lc.strokeStyle = withAlpha(col, al * fade * fin);
    lc.lineWidth = 1.6;
    lc.beginPath();
    for (let k = col === LV ? 0 : 1; k < NF; k += 2) {
      if (f >= IMNET && PART_SLOT.has(k)) continue;
      const p = floodPos(k, T);
      if (p.u < 0 || p.u > 0.95) continue;
      const q = floodPos(k, T - trail);
      lc.moveTo(q.u < 0 ? HOME.x + Math.cos(F_TH[k]) * F_R0[k] : q.x, q.u < 0 ? HOME.y + Math.sin(F_TH[k]) * F_R0[k] : q.y);
      lc.lineTo(p.x, p.y);
    }
    lc.stroke();
  }
  commit(main, lc, "lighter", 0.3);
};

const drawFlood = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < SHATTER - 1 || f > IMNET + 22) return;
  const T = floodT(f);
  const spd = 1 + 0.016 * Math.max(0, f - SHATTER);
  const fade = 1 - prog(f, IMNET, IMNET + 18);
  const fin = ease.outCubic(prog(f, SHATTER - 1, SHATTER + 6));
  drawFloodLines(ctx, f, T, spd, fade, fin);
  // thumbnails
  for (let k = 0; k < NP; k++) {
    if (f >= IMNET && PART_SLOT.has(k)) continue;
    const p = floodPos(k, T);
    if (p.u < 0 || p.u > 1) continue;
    const a = clamp((1 - p.u) / 0.16) * fade * fin * bandFade(p.x, p.y);
    if (a <= 0.01) continue;
    const s = floodSize(k, p.u);
    ctx.globalAlpha = a;
    drawThumbAt(ctx, F_IMG[k], p.x - s / 2, p.y - s * 0.375, s, s * 0.75);
  }
  ctx.globalAlpha = 1;
  // word tokens: nearest first claim their space, a token that would land on another is dropped,
  // then they are drawn far to near
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // chip widths are measured fresh every frame (never cached across frames: fonts may still be loading)
  const widths = new Map<string, number>();
  const toks: { k: number; x: number; y: number; sc: number; a: number; px: number; hw: number; hh: number }[] = [];
  for (let k = NP; k < NF; k++) {
    const p = floodPos(k, T);
    if (p.u < 0 || p.u > 1) continue;
    const a = clamp((1 - p.u) / 0.2) * fade * fin * bandFade(p.x, p.y);
    if (a <= 0.01) continue;
    const px = F_DZ[k] < 0.8 ? 22 : F_DZ[k] < 1.15 ? 30 : 36;
    const word = WORDS[F_WD[k]];
    const key = `${px}|${word}`;
    let tw = widths.get(key);
    if (tw === undefined) {
      ctx.font = `700 ${px}px ${FONT_CN}`;
      tw = ctx.measureText(word).width + px * 0.7;
      widths.set(key, tw);
    }
    const sc = 0.45 + 0.55 * Math.pow(1 - p.u, 0.7);
    toks.push({ k, x: p.x, y: p.y, sc, a, px, hw: (tw * sc) / 2 + 8, hh: px * 0.72 * sc + 6 });
  }
  toks.sort((p, q) => F_DZ[q.k] - F_DZ[p.k] || p.k - q.k);
  const kept: typeof toks = [];
  for (const t of toks) {
    let hit = false;
    for (const o of kept)
      if (Math.abs(t.x - o.x) < t.hw + o.hw && Math.abs(t.y - o.y) < t.hh + o.hh) {
        hit = true;
        break;
      }
    if (!hit) kept.push(t);
  }
  let font = 0;
  for (let n = kept.length - 1; n >= 0; n--) {
    const t = kept[n];
    if (font !== t.px) {
      ctx.font = `700 ${t.px}px ${FONT_CN}`;
      font = t.px;
    }
    const word = WORDS[F_WD[t.k]];
    const tw = widths.get(`${t.px}|${word}`)!;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.sc, t.sc);
    ctx.globalAlpha = t.a * 0.85;
    ctx.fillStyle = "rgba(20,8,40,0.75)";
    ctx.strokeStyle = withAlpha(t.k % 3 ? LV : C.magenta, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -t.px * 0.72, tw, t.px * 1.44, t.px * 0.35);
    ctx.fill();
    ctx.stroke();
    // tiny far tokens keep their chip but lose the unreadable text
    const ta = t.a * smooth(0.55, 0.68, t.sc) * (1 - clamp((t.y - 745) / 70));
    if (ta > 0.01) {
      ctx.globalAlpha = ta;
      ctx.fillStyle = "#f4ecff";
      ctx.fillText(word, 0, 1);
    }
    ctx.restore();
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
  // after the lock-in the neuron drinks faster
  const boost = 1 + 0.6 * ease.outCubic(prog(f, LOCK, LOCK + 20));
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
    const al = Math.min(1, a * boost * Math.sin(Math.PI * t));
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

/** The lock-in hit at the neuron, and the pulses it sends down into the mosaic afterwards. */
const drawLockFx = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < LOCK) return;
  const v = viewAt(f);
  const cam = camAt(f);
  ctx.globalCompositeOperation = "lighter";
  const tl = f - LOCK;
  if (tl < 40) {
    const k = Math.exp(-tl / 8);
    glow(ctx, v.ox, v.oy, 140 + 420 * (1 - Math.exp(-tl / 5)), HOT, 0.7 * k, 0.05);
    glow(ctx, v.ox, v.oy, 80, "#ffffff", 0.85 * k);
    ctx.save();
    ctx.translate(v.ox, HORIZON);
    ctx.scale(8, 1);
    glow(ctx, 0, 0, 150, LV, 0.55 * k, 0.1);
    ctx.restore();
    for (let r = 0; r < 2; r++) {
      const tt = tl - r * 4;
      if (tt < 0) continue;
      const ra = Math.exp(-tt / 9);
      ctx.strokeStyle = withAlpha(r ? LV : "#f6ecff", 0.75 * ra);
      ctx.lineWidth = 1.5 + 5 * ra;
      ctx.beginPath();
      ctx.arc(v.ox, v.oy, 50 + tt * (19 - 5 * r), 0, TAU);
      ctx.stroke();
    }
  }
  const pc = project(cam, WAVE_X, HC, WAVE_Z);
  for (const w of WAVES) {
    const t = f - w;
    if (t < 0 || t >= WAVE_LEN || !pc) continue;
    const k = Math.exp(-t / 6);
    // a bolt from the neuron down into the data, and a bloom where it lands
    const g = ctx.createLinearGradient(0, v.oy, 0, pc.y);
    g.addColorStop(0, withAlpha("#ffffff", 0.9 * k));
    g.addColorStop(1, withAlpha(HOT, 0.5 * k));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(v.ox, v.oy + R_SUM * v.sc);
    ctx.lineTo(pc.x, pc.y);
    ctx.lineWidth = 18 + 14 * k;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5 + 3 * k;
    ctx.stroke();
    glow(ctx, v.ox, v.oy, 70 + 160 * (1 - k), LV, 0.6 * k, 0.08);
    ctx.save();
    ctx.translate(pc.x, pc.y);
    ctx.scale(4, 1);
    glow(ctx, 0, 0, 60 + 50 * (1 - k), HOT, 0.6 * k, 0.1);
    ctx.restore();
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

/** The instant of the break the world drops to near-black, so the shards and the bloom read hard. */
const voidAt = (f: number) => (f < SHATTER ? 0 : Math.exp(-(f - SHATTER) / 7));

const drawBackground = (ctx: CanvasRenderingContext2D, f: number) => {
  const cold = coldAt(f);
  const warm = warmAt(f);
  const im = imAt(f);
  const vd = 0.9 * voidAt(f);
  const inner = mix(mix(mix("#170c30", "#0d1620", cold), "#2e0c44", warm * (1 - im)), "#030108", vd);
  const outer = mix(mix(mix("#030208", "#020407", cold), "#07020e", warm), "#010004", vd);
  const g = ctx.createRadialGradient(HOME.x, HOME.y, 0, HOME.x, HOME.y, 1150);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // blueprint dot grid
  const ga = (0.07 + 0.03 * cold) * ease.outCubic(prog(f, PERC - 20, PERC + 30)) * (1 - prog(f, SHATTER - 2, SHATTER));
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
  const gr = atmosGrads(ctx);
  ctx.globalAlpha = im;
  ctx.fillStyle = gr.hz;
  ctx.fillRect(0, HORIZON - 4, W, 174);
  // the horizon only lights up once the neuron has risen clear of it
  const hl = im * smooth(0.62, 1, riseAt(f));
  if (hl > 0) {
    ctx.globalAlpha = hl;
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
  }
  // the caption band stays clean whenever the plane exists
  ctx.globalAlpha = 1;
  ctx.fillStyle = gr.m;
  ctx.fillRect(0, MASK_Y - 90, W, 815 - (MASK_Y - 90));
  ctx.fillStyle = "#040209";
  ctx.fillRect(0, 814, W, H - 814);
  ctx.globalAlpha = 1;
};

/** Pressure before the break: light leaking in at the edges; then the break itself. */
const drawPressure = (main: CanvasRenderingContext2D, f: number) => {
  if (f < FLOOD - 4 || f > SHATTER + 30) return;
  const ctx = layer(3);
  const a = ease.inQuad(prog(f, FLOOD - 4, SHATTER)) * (1 - prog(f, SHATTER, SHATTER + 6));
  ctx.globalCompositeOperation = "lighter";
  if (a > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1100);
    g.addColorStop(0, "rgba(255,62,200,0)");
    g.addColorStop(1, withAlpha(C.magenta, 0.2 * a));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // two heartbeats: the neuron re-warms, and each beat drives the cracks further
  for (const b0 of [FLOOD, FLOOD + 7]) {
    const t = f - b0;
    if (t < 0 || t >= 16) continue;
    const k = 1 - t / 16;
    glow(ctx, HOME.x, HOME.y, 150 + 300 * (1 - k), HOT, 0.75 * k * k, 0.05);
    glow(ctx, HOME.x, HOME.y, 90, "#ffffff", 0.5 * k * k);
    // a soft pressure wave (no crisp ring: the crack fronts are ragged)
    const rad = 100 + (b0 === FLOOD ? 46 : 110) * t;
    ctx.strokeStyle = withAlpha(HOT, 0.13 * k);
    ctx.lineWidth = 46 * k + 10;
    ctx.beginPath();
    ctx.arc(HOME.x, HOME.y, rad, 0, TAU);
    ctx.stroke();
  }
  // the break: a white-hot bloom from the neuron, then a shockwave rolls out over the screen
  const ts = f - SHATTER;
  if (ts >= 0 && ts < 6) {
    const k = Math.pow(1 - ts / 6, 1.6);
    glow(ctx, HOME.x, HOME.y, 230 + 260 * (ts / 6), "#ffffff", 0.95 * k, 0.26);
    glow(ctx, HOME.x, HOME.y, 900 + 300 * (ts / 6), HOT, 0.7 * k, 0.06);
  }
  if (ts >= 0 && ts < 30) {
    const k = 1 - ts / 30;
    glow(ctx, HOME.x, HOME.y, 260 + 500 * (1 - k), HOT, 0.8 * k * k, 0.04);
    for (let r = 0; r < 2; r++) {
      const tt = ts - r * 4;
      if (tt < 0) continue;
      const rad = 80 + tt * (95 - 25 * r) * Math.exp(-tt / 60);
      const ra = Math.pow(1 - clamp(tt / 24), 1.6);
      ctx.strokeStyle = withAlpha(r ? LV : HOT, 0.22 * ra);
      ctx.lineWidth = 60 * ra + 8;
      ctx.beginPath();
      ctx.arc(HOME.x, HOME.y, rad, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#fff0fd", 0.8 * ra);
      ctx.lineWidth = 2 + 5 * ra;
      ctx.stroke();
    }
  }
  commit(main, ctx, "lighter");
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
      drawLockFx(ctx, f);
      drawPerceptron(ctx, f);
      drawHeroes(ctx, f);
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
const TopLabel: React.FC<{ cn: string; en: string; a: number; col: string; spread?: number; dx?: number }> = ({ cn, en, a, col, spread = 0, dx = 0 }) =>
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
        transform: `translate(${dx}px, ${(1 - a) * -10}px)`,
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
  // fades in once the rising neuron is clear of it; the roll starts with the fade, so no "0" ever holds
  const a = ease.outCubic(prog(frame, COUNT_A, COUNT_A + 12));
  if (a <= 0) return null;
  const p = ease.outQuart(prog(frame, COUNT_A, COUNT_B));
  const n = 14_000_000 * p;
  // lock-in: scale pop, a bloom behind the number, the bar flashes
  const pop = frame >= COUNT_B ? Math.exp(-(frame - COUNT_B) / 6) : 0;
  const settled = ease.outCubic(prog(frame, COUNT_B, COUNT_B + 14));
  return (
    // top 88: the label's baseline sits ~20 px above the horizon line (y 330), never on it
    <div style={{ position: "absolute", left: 200, top: 88, opacity: a, transform: `translateX(${(1 - a) * -30}px)` }}>
      {/* soft dark backing so it stays crisp white over the sky */}
      {/* (closest-side gradients reach zero inside their boxes, so no box edge ever shows) */}
      <div style={{ position: "absolute", left: -190, top: -110, width: 860, height: 480, background: "radial-gradient(closest-side, rgba(3,1,10,0.62) 0%, rgba(3,1,10,0.42) 55%, rgba(3,1,10,0) 100%)" }} />
      <div
        style={{
          position: "absolute",
          left: -120,
          top: -40,
          width: 640,
          height: 300,
          background: `radial-gradient(closest-side, ${withAlpha(HOT, 0.55)} 0%, ${withAlpha(C.violet, 0.25)} 55%, rgba(0,0,0,0) 100%)`,
          opacity: 0.18 + 0.2 * settled + 0.8 * pop,
          mixBlendMode: "screen",
        }}
      />
      <div style={{ position: "relative", fontFamily: FONT_MONO, fontWeight: 800, fontSize: 28, letterSpacing: "0.34em", color: "#e4dbff", textShadow: `0 0 14px ${C.violet}, 0 2px 6px #000` }}>IMAGENET</div>
      <div style={{ position: "relative", display: "flex", alignItems: "baseline", marginTop: 2, transform: `scale(${1 + 0.15 * pop})`, transformOrigin: "left center" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 112,
            lineHeight: 1.05,
            color: "#fff",
            textShadow: `0 0 4px #fff, 0 0 ${26 + 20 * (1 - settled) + 50 * pop}px ${C.violet}, 0 0 ${12 + 24 * pop}px ${HOT}, 0 4px 18px #000`,
          }}
        >
          {Math.floor(n / 1e4 + 1e-6)}
        </span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 80, color: "#fff", marginLeft: 8, textShadow: `0 0 4px #fff, 0 0 ${24 + 40 * pop}px ${C.violet}, 0 4px 18px #000` }}>万</span>
      </div>
      <div style={{ position: "relative", height: 3, width: 430, background: "rgba(255,255,255,0.14)", marginTop: 6 }}>
        <div style={{ height: 3, width: `${p * 100}%`, background: pop > 0.05 ? `linear-gradient(90deg, ${mix(C.violet, "#ffffff", pop)}, ${mix(C.magenta, "#ffffff", pop)})` : `linear-gradient(90deg, ${C.violet}, ${C.magenta})`, boxShadow: `0 0 ${12 + 20 * pop}px ${C.magenta}` }} />
      </div>
      <div style={{ position: "relative", fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff", marginTop: 12, letterSpacing: "0.12em", textShadow: `0 0 12px ${C.violet}, 0 2px 8px #000` }}>
        人工标注的图片
      </div>
    </div>
  );
};

const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  const pa = ease.outCubic(prog(frame, PERC + 26, PERC + 46)) * (1 - prog(frame, FREEZE + 2, FREEZE + 16));
  // the first crack burst knocks the winter label out (a short glitch, gone before the cracks reach it)
  const knock = frame < FLOOD ? 1 : [0.9, 0.3, 0.7, 0.12, 0][Math.min(4, frame - FLOOD)];
  const wa = ease.outCubic(prog(frame, FREEZE + 18, FREEZE + 40)) * knock;
  const wx = frame >= FLOOD && frame < FLOOD + 5 ? (hash(frame * 3.7) - 0.5) * 34 : 0;
  return (
    <AbsoluteFill>
      <TopLabel cn="感知机" en="PERCEPTRON" a={pa} col={LV} />
      <TopLabel cn="AI 寒冬" en="AI WINTER" a={wa} col={"#a9d6ff"} spread={0.06 * prog(frame, FREEZE + 18, FLOOD)} dx={wx} />
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
  // ... and the same while the pane trembles before the break
  const tz = frame < SHATTER ? 1 + 0.01 * ease.inOutSine(prog(frame, FLOOD - 4, FLOOD + 3)) : 1;
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x + tremble}px, ${sh.y}px) rotate(${sh.r * 0.25}rad) scale(${zoom * tz})` }}>
        <Stage />
        <Hud />
      </AbsoluteFill>
      <ChapterCard index={6} title="沉睡的大脑" en="THE SLEEPING BRAIN" color={C.violet} dur={85} />
      <YearStamp year="1958" label="美国 · 弗兰克·罗森布拉特" from={PERC + 2} to={FREEZE - 2} color={C.violet} />
      <Captions
        accent={LV}
        items={[
          { from: 95, to: 225, text: "神经网络的想法很老——1958年就有了第一台{{感知机}}。" },
          { from: 235, to: 350, text: "但它沉睡了几十年：{{算力不够，数据也不够}}。" },
          { from: 365, to: 460, text: "直到互联网带来了{{海量数据}}——" },
          { from: IMNET - 4, to: DUR - 4, text: "仅 ImageNet 一个数据集就有{{1400万张}}人工标注的图片。" },
        ]}
      />
    </AbsoluteFill>
  );
};
