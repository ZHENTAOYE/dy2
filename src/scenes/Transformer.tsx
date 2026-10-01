import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, sumShake, TAU } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { Flash, YearStamp } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("transformer");
const ATTEND = cue("transformer", "attend");
const PARALLEL = cue("transformer", "parallel");
const GENERATE = cue("transformer", "generate");
const USERS = cue("transformer", "users");
/** ignite (every cell at once), ×8, ×64, ×512, tilt into the sea of GPUs */
const [IGNITE, X8, X64, X512, TILT] = ticks("transformer", "tile");
/** one frame per generated answer token */
const TOKEN = ticks("transformer", "token");
const LAND = USERS + 80; // the user counter lands on 1亿
const TILT_LEN = 14; // the 32×16 grid tips back into a floor
const SEA_END = GENERATE - 6; // the sea sinks away ...
const SEA_GONE = GENERATE + 10; // ... and is gone (the prompt row is already fading in)

// attend beat: heads draw in, one query at a time (accelerating), then every word at once
const HEAD_T = [ATTEND + 26, ATTEND + 44, ATTEND + 62];
const SW0 = ATTEND + 66; // query sweep start
const SW1 = ATTEND + 154; // query sweep reaches the last token
const ALL0 = ATTEND + 156; // every token at once — as {{所有词}} lands in caption 2
const ALL_PERIOD = 24;

// ---------------------------------------------------------------------------------------------
// tokens & deterministic "attention"
const QTOK = ["计", "算", "机", "为", "什", "么", "突", "然", "变", "得", "这", "么", "强", "？"];
const NQ = QTOK.length;
const ANS = ["因为", "算力", "、", "数据", "和", "算法", "，", "终于", "同时", "就位", "了", "。"];
const NA = ANS.length;
/** 算力 / 数据 / 算法 light up in the colours of the three streams of the Converge chapter */
const KEY_COL: Record<number, string> = { 1: C.cyan, 3: C.magenta, 5: C.gold };

/** heads: meaning (magenta), neighbours (cyan), the question (gold) */
const HEAD_COL = [C.magenta, C.cyan, C.gold];
const LINKS: [number, number, number][][] = [
  [[2, 12, 1], [0, 12, 0.75], [1, 12, 0.7], [6, 8, 0.9], [7, 8, 0.55], [8, 12, 0.85], [10, 12, 0.7], [3, 13, 0.55], [6, 12, 0.5], [9, 12, 0.45]],
  [[0, 1, 1], [1, 2, 0.95], [0, 2, 0.7], [3, 4, 0.7], [4, 5, 1], [3, 5, 0.65], [6, 7, 1], [8, 9, 1], [10, 11, 0.9], [11, 12, 0.6], [12, 13, 0.7], [5, 6, 0.3], [9, 10, 0.3], [2, 3, 0.3], [7, 8, 0.35]],
  [[3, 13, 0.95], [4, 13, 0.9], [5, 13, 0.85], [12, 13, 0.6], [0, 13, 0.5], [2, 13, 0.55], [8, 13, 0.45], [3, 4, 0.5], [3, 5, 0.5], [6, 13, 0.4]],
];
/** symmetric affinity per head (drives arc brightness / width) */
const AFF: number[][][] = LINKS.map((links, h) => {
  const m = Array.from({ length: NQ }, () => new Array<number>(NQ).fill(0));
  for (let i = 0; i < NQ; i++)
    for (let j = i + 1; j < NQ; j++) {
      const v = 0.03 + 0.15 * Math.pow(hash(h * 97.3 + i * 13.1 + j * 5.7), 2) + (h === 2 && j === 13 ? 0.2 : 0);
      m[i][j] = m[j][i] = v;
    }
  for (const [i, j, v] of links) m[i][j] = m[j][i] = v;
  return m;
});
/** row-normalised weights: how much query q attends to key k in head h */
const WQ: number[][][] = AFF.map((m) =>
  m.map((row, q) => {
    const mx = Math.max(...row.filter((_, k) => k !== q));
    return row.map((v, k) => (k === q ? 0.45 : v / mx));
  }),
);
/** heat map: all heads combined */
const HM: number[][] = [];
for (let q = 0; q < NQ; q++) {
  HM.push([]);
  for (let k = 0; k < NQ; k++) {
    let best = 0;
    let sum = 0;
    for (let h = 0; h < 3; h++) {
      best = Math.max(best, WQ[h][q][k]);
      sum += WQ[h][q][k];
    }
    HM[q].push(k === q ? 0.78 : clamp(Math.pow(0.75 * best + 0.12 * sum, 1.7) + 0.06 * hash(q * 31 + k * 7)));
  }
}
const NVAR = 6;
/** variant 0 is the real pattern; the other "sentences" are scrambled, re-weighted copies of it */
const heatVal = (v: number, q: number, k: number) =>
  v === 0 || q === k ? HM[q][k] : clamp(HM[(q + v * 5) % NQ][(k + v * 3) % NQ] * (0.5 + 0.8 * hash(v * 71.3 + q * 14.1 + k * 3.7)));

/** colour ramps for the heat maps: magenta (all heads), cyan, violet */
const RAMPS: string[][] = [
  ["#081226", "#3b1670", C.magenta, "#ffe0f6"],
  ["#06142a", "#11508f", C.cyan, "#effcff"],
  ["#0d0b26", "#3d2a9a", "#9a7bff", "#f1eaff"],
];
const rampOf = (v: number) => RAMPS[v === 0 ? 0 : v % 3];
const ramp = (r: string[], b: number) =>
  b < 0.3 ? mix(r[0], r[1], b / 0.3) : b < 0.78 ? mix(r[1], r[2], (b - 0.3) / 0.48) : mix(r[2], r[3], (b - 0.78) / 0.22);

// ---------------------------------------------------------------------------------------------
// a reusable full-frame offscreen layer, cleared before every use (no state survives between frames)
const OFF: { c: HTMLCanvasElement | null } = { c: null };
const layer = () => {
  if (!OFF.c) {
    OFF.c = document.createElement("canvas");
    OFF.c.width = 1920;
    OFF.c.height = 1080;
  }
  const g = OFF.c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, 1920, 1080);
  return g;
};
/** keep only the horizontal band [top, bottom] of the layer, feathered over `fe` px */
const bandMask = (g: CanvasRenderingContext2D, top: number, bottom: number, fe: number) => {
  const H = bottom - top + 2 * fe;
  const gr = g.createLinearGradient(0, top - fe, 0, bottom + fe);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(fe / H, "rgba(0,0,0,1)");
  gr.addColorStop(1 - fe / H, "rgba(0,0,0,1)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = gr;
  g.fillRect(0, 0, 1920, 1080);
  g.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// background: a perspective deck of network layers, signals flowing up through it
const NL = 12;
const GX = 20;
const GY = 11;
const LHW = 10.5;
const LHH = 5.9;
const LZ = (k: number) => 12.5 + 3.3 * k;
const LCX = (k: number) => -1.3 + 0.9 * k;
const LCY = (k: number) => 1.5 - 0.6 * k;
/** per-layer lattice offset (in cells), so the nodes of successive layers don't line up into perspective rays */
const LOX = (k: number) => (hash(k * 3.1 + 1) - 0.5) * 0.9;
const LOY = (k: number) => (hash(k * 5.7 + 2) - 0.5) * 0.9;
const NX = (ix: number, k: number) => LCX(k) + (-1 + (2 * (ix + 0.5 + LOX(k))) / GX) * LHW;
const NY = (iy: number, k: number) => LCY(k) + (-1 + (2 * (iy + 0.5 + LOY(k))) / GY) * LHH;

/** 0..1 while the sea of GPUs is up: the deck rises into the sky and its nearest panes step aside */
const seaHide = (f: number) =>
  ease.inOutCubic(prog(f, TILT + 3, TILT + TILT_LEN)) * (1 - ease.inOutCubic(prog(f, SEA_END, SEA_GONE)));

const camAt = (f: number) =>
  camera({
    x: 1.0 * Math.sin(f / 170),
    y: -0.2 + 0.45 * Math.sin(f / 230 + 2),
    z: -1.5 + f * 0.0045,
    yaw: 0.035 + 0.02 * Math.sin(f / 210 + 1),
    pitch: 0.04 + 0.13 * seaHide(f),
    f: 960,
  });

/** 0..1: the whole stack burning during the parallel beat */
const fullLit = (f: number, k: number) =>
  ease.outCubic(prog(f, IGNITE - 2 + k * 1.5, IGNITE + 14 + k * 1.5)) * (1 - ease.inOutCubic(prog(f, SEA_END, SEA_GONE + 2)));

/** forward passes: a pulse climbs the stack (opening, all-at-once, every generated token, the landing) */
const PULSES: [number, number][] = [[27, 0.9], [ALL0 + 10, 0.5], ...TOKEN.map((T): [number, number] => [T, 0.55]), [LAND + 4, 0.9]];
const stackPulse = (f: number, k: number) => {
  let s = 0;
  for (const [T, w] of PULSES) {
    const d = f - (T - 11 + k * 0.9);
    if (d > -7 && d < 9) s += w * Math.exp((-d * d) / 7);
  }
  return s;
};

/** brightness of layer k */
const layerLit = (f: number, k: number) => {
  const introK = 0.36 + 0.2 * (1 - ease.inOutSine(prog(f, 40, 90)));
  const intro = ease.outCubic(prog(f, (NL - 1 - k) * 0.55, 10 + (NL - 1 - k) * 0.55));
  const allAtOnce = 0.18 * ease.inOutSine(prog(f, ALL0, ALL0 + 16)) * (1 - prog(f, PARALLEL, PARALLEL + 16));
  const gen = 0.1 * prog(f, GENERATE - 4, GENERATE + 20);
  const lit = introK * intro + allAtOnce + gen + 0.95 * fullLit(f, k) + stackPulse(f, k);
  const sh = seaHide(f);
  return lit * (k <= 2 ? 1 - sh : 1 - 0.45 * sh);
};

/** signal clock: runs ~2.6× faster while the whole stack is lit */
const WARP: number[] = [0];
for (let f = 0; f <= DUR + 2; f++) WARP.push(WARP[f] + 1 + 1.6 * fullLit(f, 5));
const warpAt = (f: number) => WARP[clamp(Math.floor(f), 0, DUR + 2)];

const NODE_COL = [C.cyan, C.ice, C.blue, C.cyan, C.ice];
const NSIG = 300;
const sigNode = (s: number, k: number): [number, number] => {
  const bx = Math.floor(hash(s * 1.37) * GX);
  const by = Math.floor(hash(s * 2.91 + 4) * GY);
  const ix = clamp(Math.round(bx + (noise1(s * 3.1 + k * 0.6) - 0.5) * 8), 0, GX - 1);
  const iy = clamp(Math.round(by + (noise1(s * 5.3 + k * 0.7 + 40) - 0.5) * 5), 0, GY - 1);
  return [NX(ix, k), NY(iy, k)];
};

const drawStack = (ctx: CanvasRenderingContext2D, f: number) => {
  const cam = camAt(f);
  ctx.globalCompositeOperation = "lighter";
  for (let k = NL - 1; k >= 0; k--) {
    const lit = layerLit(f, k);
    if (lit <= 0.01) continue;
    const z = LZ(k);
    const cs = [
      project(cam, LCX(k) - LHW, LCY(k) - LHH, z),
      project(cam, LCX(k) + LHW, LCY(k) - LHH, z),
      project(cam, LCX(k) + LHW, LCY(k) + LHH, z),
      project(cam, LCX(k) - LHW, LCY(k) + LHH, z),
    ];
    if (cs.some((p) => !p)) continue;
    const P = cs as { x: number; y: number; s: number }[];
    const fog = 1 - 0.68 * clamp((k - 3) / 8);
    const near = k === 0 ? 0.42 : k === 1 ? 0.72 : 1; // the nearest panes are soft, out of focus
    const L = Math.min(1.5, lit) * fog;
    const full = fullLit(f, k);
    // the glass pane (the two nearest are out of focus: no flat fill, it would read as an overlay)
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (k >= 2) {
      ctx.fillStyle = withAlpha(C.blue, 0.01 + 0.028 * L + 0.03 * full);
      ctx.fill();
    }
    ctx.strokeStyle = withAlpha(C.ice, (0.03 + 0.12 * L) * near);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // corner brackets
    ctx.strokeStyle = withAlpha(C.ice, Math.min(0.85, (0.12 + 0.42 * L) * near));
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = P[i];
      const b = P[(i + 1) % 4];
      const c = P[(i + 3) % 4];
      ctx.moveTo(lerp(a.x, b.x, 0.07), lerp(a.y, b.y, 0.07));
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(lerp(a.x, c.x, 0.12), lerp(a.y, c.y, 0.12));
    }
    ctx.stroke();
    // lattice
    ctx.beginPath();
    for (let ix = 0; ix < GX; ix++) {
      const t = (ix + 0.5 + LOX(k)) / GX;
      ctx.moveTo(lerp(P[0].x, P[1].x, t), lerp(P[0].y, P[1].y, t));
      ctx.lineTo(lerp(P[3].x, P[2].x, t), lerp(P[3].y, P[2].y, t));
    }
    for (let iy = 0; iy < GY; iy++) {
      const t = (iy + 0.5 + LOY(k)) / GY;
      ctx.moveTo(lerp(P[0].x, P[3].x, t), lerp(P[0].y, P[3].y, t));
      ctx.lineTo(lerp(P[1].x, P[2].x, t), lerp(P[1].y, P[2].y, t));
    }
    ctx.strokeStyle = withAlpha(C.cyan, Math.min(0.16, (0.012 + 0.04 * L) * near));
    ctx.lineWidth = 1;
    ctx.stroke();
    // nodes
    for (let iy = 0; iy < GY; iy++)
      for (let ix = 0; ix < GX; ix++) {
        const p = project(cam, NX(ix, k), NY(iy, k), z);
        if (!p || p.x < -60 || p.x > 1980 || p.y < -60 || p.y > 1140) continue;
        const id = k * 400 + iy * 23 + ix;
        const tw = noise1(f * 0.05 + hash(id) * 60);
        const b = L * (0.22 + 0.78 * tw * tw);
        const r = p.s * (near < 1 ? 0.42 : 0.26) * (0.75 + 0.45 * Math.min(1, b));
        const col = full > 0.3 && hash(id * 1.7) < 0.12 ? C.magenta : NODE_COL[id % 5];
        glow(ctx, p.x, p.y, r, col, Math.min(0.9, 0.72 * b * near));
      }
    // bloom of a burning layer
    if (full > 0.02) {
      const c = project(cam, LCX(k), LCY(k), z);
      if (c) glow(ctx, c.x, c.y, LHW * c.s * 0.9, C.cyan, 0.035 * full * fog * (1 - 0.5 * seaHide(f)), 0.02);
    }
  }
  // signals flowing up through the layers
  const W = warpAt(f);
  const boost = fullLit(f, 5);
  for (let s = 0; s < NSIG; s++) {
    const extra = s >= 150;
    if (extra && boost < 0.02) continue;
    const sp = 0.028 + 0.03 * hash(s * 1.3);
    const span = NL + 2;
    const ph = ((W * sp + hash(s * 7.7) * span) % span) - 1;
    const k = Math.floor(ph);
    if (k < 0 || k >= NL - 1) continue;
    const u = ph - k;
    const t = ease.inOutSine(u);
    const t0 = ease.inOutSine(Math.max(0, u - 0.14));
    const [x0, y0] = sigNode(s, k);
    const [x1, y1] = sigNode(s, k + 1);
    const z0 = LZ(k);
    const z1 = LZ(k + 1);
    const pa = project(cam, lerp(x0, x1, t0), lerp(y0, y1, t0), lerp(z0, z1, t0));
    const pb = project(cam, lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t));
    if (!pa || !pb) continue;
    const lit = Math.min(1.4, (layerLit(f, k) + layerLit(f, k + 1)) / 2) * (extra ? boost : 1);
    const fade = clamp(Math.min(ph + 0.6, NL - 1 - ph) / 1.4);
    const col = s % 7 === 0 ? C.magenta : s % 3 === 0 ? C.cyan : C.ice;
    const near = k === 0 ? 0.5 : 1;
    ctx.strokeStyle = withAlpha(col, 0.28 * lit * fade * near);
    ctx.lineWidth = Math.max(1, pb.s * 0.035);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    glow(ctx, pb.x, pb.y, pb.s * 0.4, col, Math.min(1, 0.9 * lit * fade * near));
  }
  ctx.lineCap = "butt";
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// attention row
const TOK_Y = 575;
const TB = 92; // box
const TP = 110; // pitch
const tokX = (i: number) => 960 + (i - (NQ - 1) / 2) * TP;
const MAP_CY = 455; // centre of the heat-map tile and of the GPU grid
const PIN_Y = 520; // push-in centre of the attention beat

/** query position in tokens: starts slow, accelerates, runs off the end of the row */
const sweepPos = (f: number) => {
  const u = (f - SW0) / (SW1 - SW0);
  if (u <= 0) return -2;
  return u < 1 ? NQ * (0.5 * u + 0.5 * u * u) : NQ * (1 + 1.5 * (u - 1));
};
/** 0..1 while the sequential sweep runs (dims the arcs that don't belong to the current query) */
const sweepOn = (f: number) => ease.inOutSine(prog(f, SW0 - 10, SW0 + 4)) * (1 - prog(f, ALL0 - 1, ALL0 + 3));
const allOn = (f: number) => ease.outCubic(prog(f, ALL0 - 1, ALL0 + 4));
const flareOf = (f: number, i: number) => {
  const qf = sweepPos(f);
  const sweep = qf > -0.6 && qf < NQ + 1 ? clamp(1.5 - Math.abs(qf - i - 0.5) * 1.6) : 0;
  return Math.max(sweep, allOn(f));
};

const roundBox = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
};

const drawToken = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  px: number,
  a: number,
  hi: number,
  flash = 0,
  col = C.cyan,
) => {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  const g = Math.max(hi, flash);
  if (g > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x, y, w * (1.2 + 0.4 * flash), col, 0.42 * hi + 0.3 * flash, 0.02);
    ctx.globalCompositeOperation = "source-over";
  }
  roundBox(ctx, x, y, w, h, h * 0.16);
  ctx.fillStyle = mix(mix("#06111c", "#0e3550", hi), "#15567a", flash);
  ctx.globalAlpha = a * 0.92;
  ctx.fill();
  if (flash > 0.02) {
    // white-hot flash of the whole box
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = withAlpha("#ffffff", 0.5 * flash);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = a;
  ctx.strokeStyle = withAlpha(mix(col, "#ffffff", Math.min(1, hi * 0.6 + flash)), 0.5 + 0.5 * g);
  ctx.lineWidth = 2 + hi + 2 * flash;
  ctx.stroke();
  ctx.font = `900 ${px}px ${FONT_CN}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = withAlpha(col, 0.95);
  ctx.shadowBlur = 6 + 14 * g;
  ctx.fillText(text, x, y + px * 0.04);
  ctx.restore();
};

const arcGeom = (i: number, j: number, h: number) => {
  const off = (h - 1) * 9;
  const x0 = tokX(i) + off;
  const x1 = tokX(j) + off;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = (22 + rx * 0.4) * (1 - 0.1 * h);
  return { cx: (x0 + x1) / 2, rx, ry, by: TOK_Y - TB / 2 - 4 };
};

const drawAttention = (ctx: CanvasRenderingContext2D, f: number) => {
  // slow push-in across the whole beat
  const pin = 1 + 0.06 * ease.inOutSine(prog(f, ATTEND, PARALLEL));
  ctx.translate(960, PIN_Y);
  ctx.scale(pin, pin);
  ctx.translate(-960, -PIN_Y);
  const build = 0.7 + 0.3 * ease.inOutSine(prog(f, ATTEND + 40, ALL0));
  const dim = 1 - 0.65 * sweepOn(f);
  const allT = f - ALL0;
  // arcs
  ctx.globalCompositeOperation = "lighter";
  for (let h = 0; h < 3; h++) {
    const col = HEAD_COL[h];
    for (let i = 0; i < NQ; i++)
      for (let j = i + 1; j < NQ; j++) {
        const g = ease.outCubic(clamp((f - HEAD_T[h] - (j - i) * 1.1) / 18));
        if (g <= 0) continue;
        const w = AFF[h][i][j];
        const fl = Math.max(flareOf(f, i) * WQ[h][i][j], flareOf(f, j) * WQ[h][j][i]);
        const { cx, rx, ry, by } = arcGeom(i, j, h);
        const alpha = Math.min(1, ((0.05 + 0.45 * w) * dim + 0.85 * fl * fl) * build);
        const lw = (0.8 + 2.6 * w) * (1 + 0.7 * fl);
        const path = () => ctx.ellipse(cx, by, rx, ry, 0, Math.PI, Math.PI + Math.PI * g);
        if (fl > 0.3 && w > 0.25) glowStroke(ctx, path, col, lw * 0.8, alpha);
        else {
          ctx.strokeStyle = withAlpha(col, alpha * 0.85);
          ctx.lineWidth = lw;
          ctx.beginPath();
          path();
          ctx.stroke();
        }
      }
  }
  // messages travelling from keys to the current query
  const qf = sweepPos(f);
  if (qf >= 0 && qf < NQ) {
    const q = Math.floor(qf);
    const u = ease.inOutSine(qf - q);
    for (let h = 0; h < 3; h++)
      for (let j = 0; j < NQ; j++) {
        if (j === q) continue;
        const w = WQ[h][q][j];
        if (w < 0.3) continue;
        const { cx, rx, ry, by } = arcGeom(Math.min(q, j), Math.max(q, j), h);
        // angle π is the left end, 2π the right end
        const from = j < q ? Math.PI : TAU;
        const to = j < q ? TAU : Math.PI;
        const an = lerp(from, to, u);
        glow(ctx, cx + Math.cos(an) * rx, by + Math.sin(an) * ry, 8 + 14 * w, HEAD_COL[h], 0.9 * w * Math.sin(Math.PI * u));
      }
  }
  // every token at once: a pulse runs along every arc
  if (allT > 0) {
    const u = (allT % ALL_PERIOD) / ALL_PERIOD;
    const pa = Math.sin(Math.PI * u) * clamp(allT / 6);
    for (let h = 0; h < 3; h++)
      for (let i = 0; i < NQ; i++)
        for (let j = i + 1; j < NQ; j++) {
          const w = AFF[h][i][j];
          if (w < 0.5) continue;
          const { cx, rx, ry, by } = arcGeom(i, j, h);
          const an = lerp(Math.PI, TAU, (h + i) % 2 ? u : 1 - u);
          glow(ctx, cx + Math.cos(an) * rx, by + Math.sin(an) * ry, 7 + 9 * w, HEAD_COL[h], 0.85 * w * pa);
        }
  }
  // the all-at-once hit: rings off the row and an anamorphic streak
  if (allT >= 0 && allT < 28) {
    const x0 = tokX(0) - TB / 2;
    const x1 = tokX(NQ - 1) + TB / 2;
    for (let k = 0; k < 2; k++) {
      const tt = allT - k * 3;
      if (tt < 0) continue;
      const grow = 6 + 74 * ease.outCubic(clamp(tt / 24));
      const ra = Math.exp(-tt / 7);
      ctx.strokeStyle = withAlpha(k ? C.magenta : C.ice, 0.85 * ra);
      ctx.lineWidth = 2 + 6 * ra;
      ctx.beginPath();
      ctx.roundRect(x0 - grow * 1.4, TOK_Y - TB / 2 - grow, x1 - x0 + grow * 2.8, TB + 2 * grow, 18 + grow * 0.4);
      ctx.stroke();
    }
    const sa = Math.exp(-allT / 6);
    const sg = ctx.createLinearGradient(0, 0, 1920, 0);
    sg.addColorStop(0, withAlpha(C.cyan, 0));
    sg.addColorStop(0.5, withAlpha("#ffffff", 0.85 * sa));
    sg.addColorStop(1, withAlpha(C.cyan, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, TOK_Y - 2 - 5 * sa, 1920, 4 + 10 * sa);
  }
  ctx.globalCompositeOperation = "source-over";
  // tokens
  const allFlash = allT >= 0 ? Math.exp(-allT / 5) : 0;
  const allBeat = allT > 0 ? 0.5 + 0.5 * Math.cos((allT / ALL_PERIOD) * TAU) : 0;
  for (let i = 0; i < NQ; i++) {
    const t = clamp((f - ATTEND - i * 3) / 12);
    if (t <= 0) continue;
    const pop = ease.outBack(t);
    const hi = flareOf(f, i) * (allT > 0 ? 0.86 + 0.14 * allBeat : 1);
    const flash = Math.max(Math.exp(-(f - ATTEND - i * 3) / 4) * 0.7, allFlash);
    const y = TOK_Y - (1 - ease.outCubic(t)) * 40;
    drawToken(ctx, tokX(i), y, TB * pop, TB * pop, QTOK[i], 56 * pop, clamp(t * 2), hi, flash);
  }
  // attention-weight bars under the keys for the current query (or all queries at once)
  const barA = ease.outCubic(prog(f, SW0 - 12, SW0 + 4));
  if (barA > 0) {
    let sum = 0;
    const fls: number[] = [];
    for (let q = 0; q < NQ; q++) {
      const v = flareOf(f, q);
      fls.push(v);
      sum += v;
    }
    const base = TOK_Y + 118;
    ctx.globalAlpha = barA;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(tokX(0) - TB / 2, base + 2, tokX(NQ - 1) - tokX(0) + TB, 1.5);
    for (let j = 0; j < NQ; j++)
      for (let h = 0; h < 3; h++) {
        let v = 0;
        if (sum > 0.01) {
          for (let q = 0; q < NQ; q++) if (fls[q] > 0) v += fls[q] * WQ[h][q][j];
          v /= sum;
        }
        const bh = 4 + 50 * v;
        const x = tokX(j) + (h - 1) * 17 - 6;
        ctx.fillStyle = withAlpha(HEAD_COL[h], 0.35 + 0.6 * v);
        ctx.fillRect(x, base - bh, 12, bh);
      }
    ctx.font = `700 22px ${FONT_CN}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 6;
    ctx.fillText("注意力", tokX(0) - TB / 2 - 10, base - 34);
    ctx.fillText("权重", tokX(0) - TB / 2 - 10, base - 8);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
};

// ---------------------------------------------------------------------------------------------
// heat maps & GPU chips
/** Draw the 14×14 attention matrix. `inten` scales the weights, `white` flashes every cell at once. */
const drawHeat = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  v: number,
  inten: number,
  white: number,
  glowA = 1,
) => {
  const cs = s / NQ;
  const gap = Math.max(0.5, cs * 0.08);
  const R = rampOf(v);
  ctx.fillStyle = "rgba(3,8,18,0.96)";
  ctx.fillRect(x, y, s, s);
  for (let q = 0; q < NQ; q++)
    for (let k = 0; k < NQ; k++) {
      const b = heatVal(v, q, k) * inten;
      ctx.fillStyle = ramp(R, b);
      ctx.fillRect(x + k * cs + gap, y + q * cs + gap, cs - 2 * gap, cs - 2 * gap);
    }
  ctx.globalCompositeOperation = "lighter";
  if (glowA > 0)
    for (let q = 0; q < NQ; q++)
      for (let k = 0; k < NQ; k++) {
        const b = heatVal(v, q, k) * inten;
        if (b > 0.5) glow(ctx, x + (k + 0.5) * cs, y + (q + 0.5) * cs, cs * 1.3, R[2], (b - 0.42) * 0.5 * glowA);
      }
  if (white > 0.01) {
    ctx.fillStyle = withAlpha("#ffffff", white);
    for (let q = 0; q < NQ; q++)
      for (let k = 0; k < NQ; k++) ctx.fillRect(x + k * cs + gap, y + q * cs + gap, cs - 2 * gap, cs - 2 * gap);
  }
  ctx.globalCompositeOperation = "source-over";
};

/** the die (heat map) sits in the middle DIE fraction of a chip */
const DIE = 0.6;
const MIPS = [512, 256, 128, 64, 32, 16];
const mipIndex = (size: number) => {
  let i = 0;
  while (i < MIPS.length - 1 && MIPS[i + 1] >= size) i++;
  return i;
};
/** Build a mip chain by repeated halving, so small copies stay clean instead of shimmering. */
const mipChain = (paint: (g: CanvasRenderingContext2D, s: number) => void) => {
  const out: HTMLCanvasElement[] = [];
  const c0 = document.createElement("canvas");
  c0.width = c0.height = MIPS[0];
  paint(c0.getContext("2d")!, MIPS[0]);
  out.push(c0);
  for (let i = 1; i < MIPS.length; i++) {
    const c = document.createElement("canvas");
    c.width = c.height = MIPS[i];
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(out[i - 1], 0, 0, MIPS[i], MIPS[i]);
    out.push(c);
  }
  return out;
};

const paintPackage = (g: CanvasRenderingContext2D, S: number, withDie: boolean, v: number) => {
  const m = S * 0.07; // pin length
  const p0 = m;
  const ps = S - 2 * m;
  // pins
  g.fillStyle = withAlpha(C.ice, 0.75);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = p0 + ps * ((i + 0.5) / n) - S * 0.012;
    const pw = S * 0.024;
    g.fillRect(t, 0, pw, m + 2);
    g.fillRect(t, S - m - 2, pw, m + 2);
    g.fillRect(0, t, m + 2, pw);
    g.fillRect(S - m - 2, t, m + 2, pw);
  }
  // package
  g.beginPath();
  g.roundRect(p0, p0, ps, ps, S * 0.035);
  const pg = g.createLinearGradient(0, p0, 0, p0 + ps);
  pg.addColorStop(0, "#0d2134");
  pg.addColorStop(1, "#060f1c");
  g.fillStyle = pg;
  g.fill();
  g.strokeStyle = withAlpha(C.cyan, 0.95);
  g.lineWidth = Math.max(2, S * 0.014);
  g.stroke();
  // corner mark
  g.fillStyle = withAlpha(C.cyan, 0.8);
  g.beginPath();
  g.arc(p0 + ps * 0.08, p0 + ps * 0.08, S * 0.018, 0, TAU);
  g.fill();
  // die
  const d = S * DIE;
  const dx = (S - d) / 2;
  g.fillStyle = "#02060d";
  g.fillRect(dx - S * 0.012, dx - S * 0.012, d + S * 0.024, d + S * 0.024);
  if (withDie) drawHeat(g, dx, dx, d, v, 1, 0, 0.8);
};

const pkgCache: { m: HTMLCanvasElement[] | null } = { m: null };
const pkgImg = (size: number) => {
  if (!pkgCache.m) pkgCache.m = mipChain((g, S) => paintPackage(g, S, false, 0));
  return pkgCache.m[mipIndex(size)];
};
const chipCache: HTMLCanvasElement[][] = [];
const chipImg = (v: number, size: number) => {
  if (!chipCache[v]) chipCache[v] = mipChain((g, S) => paintPackage(g, S, true, v));
  return chipCache[v][mipIndex(size)];
};
const dieCache: HTMLCanvasElement[][] = [];
const dieImg = (v: number, size: number) => {
  if (!dieCache[v]) dieCache[v] = mipChain((g, S) => drawHeat(g, 0, 0, S, v, 1, 0, 0.8));
  return dieCache[v][mipIndex(size)];
};

// replication stages: 1 → 8 → 64 → 512
const HEAT_S = 440;
const STAGES = [
  { c: 1, r: 1, s: HEAT_S, p: 0, cy: MAP_CY },
  { c: 4, r: 2, s: 214, p: 232, cy: MAP_CY },
  { c: 8, r: 8, s: 62, p: 68, cy: MAP_CY + 6 },
  { c: 32, r: 16, s: 31, p: 34, cy: MAP_CY + 12 },
];
const ST_T = [IGNITE, X8, X64, X512];
const stagePos = (n: number, c: number, r: number) => {
  const S = STAGES[n];
  return { x: 960 + (c - (S.c - 1) / 2) * S.p, y: S.cy + (r - (S.r - 1) / 2) * S.p };
};
/**
 * Mitosis tables. Each parent keeps the cell of its new block nearest to where it was; the copies are born
 * in their own final cells, radially from the centre (DLY = birth delay in frames). TVAR = die variant.
 */
const ISPAR: boolean[][][] = [[[true]]];
const TVAR: number[][][] = [[[0]]];
const DLY: number[][][] = [[[0]]];
for (let n = 1; n < STAGES.length; n++) {
  const S = STAGES[n];
  const P = STAGES[n - 1];
  const rc = S.c / P.c;
  const rr = S.r / P.r;
  const isp = Array.from({ length: S.r }, () => new Array<boolean>(S.c).fill(false));
  for (let pr = 0; pr < P.r; pr++)
    for (let pc = 0; pc < P.c; pc++) {
      const o = stagePos(n - 1, pc, pr);
      let best: [number, number] = [pc * rc, pr * rr];
      let bd = Infinity;
      for (let dr = 0; dr < rr; dr++)
        for (let dc = 0; dc < rc; dc++) {
          const q = stagePos(n, pc * rc + dc, pr * rr + dr);
          const d = Math.hypot(q.x - o.x, q.y - o.y);
          if (d < bd - 0.01) {
            bd = d;
            best = [pc * rc + dc, pr * rr + dr];
          }
        }
      isp[best[1]][best[0]] = true;
    }
  ISPAR.push(isp);
  TVAR.push(
    isp.map((row, r) =>
      row.map((par, c) =>
        par ? TVAR[n - 1][Math.floor(r / rr)][Math.floor(c / rc)] : 1 + Math.floor(hash(n * 31.7 + c * 7.1 + r * 3.3) * (NVAR - 1)),
      ),
    ),
  );
  let dmax = 1;
  const dist = isp.map((row, r) =>
    row.map((_, c) => {
      const q = stagePos(n, c, r);
      const d = Math.hypot(q.x - 960, q.y - S.cy);
      dmax = Math.max(dmax, d);
      return d;
    }),
  );
  DLY.push(dist.map((row) => row.map((d) => 0.5 + 3 * (d / dmax))));
}
const COPY_LEN = 5; // frames for a copy to scale up in its cell

/** chip of size s at (x, y); pk 0..1 morphs the bare heat map into a packaged GPU */
const drawChip = (
  ctx: CanvasRenderingContext2D,
  v: number,
  x: number,
  y: number,
  s: number,
  pk: number,
  act: number,
  flash = 0,
) => {
  if (pk >= 0.99) {
    ctx.drawImage(chipImg(v, s), x - s / 2, y - s / 2, s, s);
  } else {
    if (pk > 0.01) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * pk;
      ctx.drawImage(pkgImg(s), x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = a;
    }
    const d = s * lerp(1, DIE, ease.outCubic(pk));
    ctx.drawImage(dieImg(v, d), x - d / 2, y - d / 2, d, d);
  }
  if (act > 0.01 || flash > 0.01) {
    const g = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    if (act > 0.01) {
      // the die computing: a soft additive shimmer
      const d = s * DIE;
      ctx.fillStyle = withAlpha(C.ice, 0.32 * act);
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }
    if (flash > 0.01) {
      // birth flash
      glow(ctx, x, y, s * 0.95, C.ice, 0.55 * flash, 0.1);
      ctx.fillStyle = withAlpha("#ffffff", 0.65 * flash);
      ctx.fillRect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.84);
    }
    ctx.globalCompositeOperation = g;
  }
};

const syncAt = (f: number, n: number) => (f >= ST_T[n] + 8 ? Math.exp(-(f - ST_T[n] - 8) / 5) : 0);

const drawStageTiles = (ctx: CanvasRenderingContext2D, f: number, n: number) => {
  const S = STAGES[n];
  const P = STAGES[n - 1];
  const rc = S.c / P.c;
  const rr = S.r / P.r;
  const T0 = ST_T[n];
  const sync = syncAt(f, n);
  const prevSync = n > 1 ? syncAt(f, n - 1) : 0;
  const waveOn = clamp((f - T0 - 10) / 6) * (n === 3 ? 1 - prog(f, TILT - 6, TILT) : 1);
  // halo behind the grid
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 960, S.cy, 520 + 200 * n, C.cyan, 0.12 + 0.25 * sync, 0.04);
  ctx.globalCompositeOperation = "source-over";
  // parents: slide into their own cell of the new grid
  const tm = ease.outExpo(clamp((f - T0) / 5));
  const pk = n === 1 ? ease.inOutCubic(clamp((f - T0) / 8)) : 1;
  for (let r = 0; r < S.r; r++)
    for (let c = 0; c < S.c; c++) {
      if (!ISPAR[n][r][c]) continue;
      const a = stagePos(n - 1, Math.floor(c / rc), Math.floor(r / rr));
      const b = stagePos(n, c, r);
      const s = lerp(P.s, S.s, tm);
      const wave = 0.5 + 0.5 * Math.sin(Math.hypot(b.x - 960, b.y - S.cy) * 0.018 - (f - T0) * 0.45);
      const act = 0.9 * Math.max(sync, prevSync) + 0.2 * wave * wave * waveOn;
      drawChip(ctx, TVAR[n][r][c], lerp(a.x, b.x, tm), lerp(a.y, b.y, tm), s, pk, act);
    }
  // copies: born in their final cells, radially from the centre, on top of everything
  for (let r = 0; r < S.r; r++)
    for (let c = 0; c < S.c; c++) {
      if (ISPAR[n][r][c]) continue;
      const lt = f - T0 - DLY[n][r][c];
      if (lt <= 0) continue;
      const u = clamp(lt / COPY_LEN);
      const b = stagePos(n, c, r);
      const s = S.s * lerp(0.3, 1, ease.outBack(u));
      const wave = 0.5 + 0.5 * Math.sin(Math.hypot(b.x - 960, b.y - S.cy) * 0.018 - (f - T0) * 0.45);
      const act = 0.9 * sync + 0.2 * wave * wave * waveOn;
      ctx.globalAlpha = clamp(u * 4);
      drawChip(ctx, TVAR[n][r][c], b.x, b.y, s, 1, act, Math.exp(-lt / 2));
    }
  ctx.globalAlpha = 1;
  // expanding frame at the moment every copy has landed (fades before it reaches the HUD or the captions)
  const rt = f - T0 - 8;
  if (rt >= 0 && rt < 20) {
    const hw = ((S.c - 1) * S.p + S.s) / 2;
    const hh = ((S.r - 1) * S.p + S.s) / 2;
    const gx = 8 + rt * 10;
    const gy = 3 + rt * 3.5;
    const top = S.cy - hh - gy;
    const bot = S.cy + hh + gy;
    const ra = Math.exp(-rt / 6) * clamp((top - 168) / 30) * clamp((790 - bot) / 30);
    if (ra > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = withAlpha(C.ice, 0.75 * ra);
      ctx.lineWidth = 1.5 + 5 * ra;
      ctx.strokeRect(960 - hw - gx, top, 2 * (hw + gx), bot - top);
      ctx.globalCompositeOperation = "source-over";
    }
  }
};

// ---------------------------------------------------------------------------------------------
// the sea of GPUs: the 32×16 grid tilts back into a floor that runs to the horizon
const SP = STAGES[3].p;
const SS = STAGES[3].s;
const SEA_CY = STAGES[3].cy;
const SEA_PIVOT = SEA_CY + 8 * SP; // bottom edge of the 32×16 grid
const SEA_D = 700;
const TH_END = 1.05;
const seaTheta = (f: number) =>
  TH_END * ease.inOutCubic(prog(f, TILT, TILT + TILT_LEN)) + 0.03 * ease.inOutSine(prog(f, TILT + TILT_LEN, SEA_GONE));
/** slow dolly: the floor slides toward us */
const seaDolly = (f: number) => SP * 2.6 * ease.inOutSine(prog(f, TILT + 6, SEA_GONE));
const SEA_COLS = [C.cyan, C.ice, C.magenta];
const NEAR_R = 22; // the floor extends this many rows toward the camera (fading out before the captions)
const N_GLINT = 150;
const N_DOT = 1600;
/** straight ripples of computation running out across the floor toward the horizon */
const seaWave = (row: number, t: number) => 0.5 + 0.5 * Math.sin(row * 0.33 + t * 0.5);

const drawSea = (ctx: CanvasRenderingContext2D, f: number, alpha: number, dy: number) => {
  if (alpha <= 0) return;
  const th = seaTheta(f);
  const tp = clamp(th / TH_END);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const D = SEA_D;
  const t = f - TILT;
  const pivot = SEA_PIVOT + dy;
  const dol = seaDolly(f);
  const proj = (v: number) => {
    const Z = D - v * sn;
    const sc = D / Z;
    return { Z, sc, y: pivot + v * cs * sc };
  };
  const rowV = (r: number) => (r - 15.5) * SP + dol;
  // how far (in rows / columns) the sea has spread beyond the 32×16 grid
  const spread = clamp(Math.min((tp - 0.45) / 0.5, (t - 4) / 24));
  const distVis = spread <= 0 ? 0 : 1 + 700 * Math.pow(spread, 2.6);
  const hy = sn > 0.05 ? pivot - (D * cs) / sn : -1e5;
  /** plane v where rows are `px` pixels apart on screen (closer rows alias into stripes) */
  const vAtPitch = (px: number) => {
    const sc = Math.sqrt(px / (SP * Math.max(cs, 0.02)));
    return sc >= 1 ? 0 : -(D / sc - D) / Math.max(sn, 0.02);
  };
  const vCut0 = vAtPitch(2.4);
  const vCut1 = vAtPitch(4.2);
  const sync = syncAt(f, 3);

  // 1. the dark floor under the visible part of the sea (hides the deck behind it)
  const baseA = alpha * ease.inOutSine(clamp((tp - 0.2) / 0.5));
  if (baseA > 0.01) {
    const vt = rowV(-distVis - 0.6);
    const vb = rowV(Math.min(NEAR_R, 15 + distVis) + 0.6);
    const pt = proj(Math.max(vt, -1e7));
    const pb = proj(vb);
    const yt = Math.max(pt.y, hy);
    const halfT = Math.min(2600, (16 + distVis + 0.6) * SP * pt.sc);
    const halfB = Math.min(2600, (16 + distVis + 0.6) * SP * pb.sc);
    const gr = ctx.createLinearGradient(0, yt - 36, 0, Math.max(yt + 1, 840));
    const H = Math.max(1, 840 - (yt - 36));
    gr.addColorStop(0, "rgba(2,6,13,0)");
    gr.addColorStop(clamp(46 / H), "rgba(2,6,13,0.92)");
    gr.addColorStop(clamp((770 - (yt - 36)) / H, 46 / H + 0.001, 1), "rgba(2,6,13,0.92)");
    gr.addColorStop(1, "rgba(2,6,13,0)");
    ctx.fillStyle = gr;
    for (let k = 0; k < 3; k++) {
      const e = k * 14; // feathered sides: three nested quads
      ctx.globalAlpha = baseA * 0.5;
      ctx.beginPath();
      ctx.moveTo(960 - halfT - e, yt - 36);
      ctx.lineTo(960 + halfT + e, yt - 36);
      ctx.lineTo(960 + halfB + e, pb.y);
      ctx.lineTo(960 - halfB - e, pb.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 2. far field: rows too dense to draw chip by chip (they would alias into stripes) become a luminous haze,
  //    a jittered field of die lights, and the crests of the computation ripples running out to the horizon
  const bandA = alpha * clamp((distVis - 30) / 40) * clamp((sn - 0.3) / 0.3);
  const y1 = proj(vCut1).y;
  const yc = proj(vCut0).y;
  ctx.globalCompositeOperation = "lighter";
  if (bandA > 0.01 && y1 > hy + 4) {
    const vOfY = (y: number) => {
      const Y = y - pivot;
      return (Y * D) / (cs * D + Y * sn);
    };
    const gr = ctx.createLinearGradient(0, hy, 0, y1);
    gr.addColorStop(0, withAlpha(C.ice, 0.34 * bandA));
    gr.addColorStop(0.12, withAlpha(C.cyan, 0.17 * bandA));
    gr.addColorStop(0.5, withAlpha("#5a6dff", 0.08 * bandA));
    gr.addColorStop(1, withAlpha(C.blue, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(0, hy, 1920, y1 - hy);
    const reveal = (w: number) => clamp((distVis - Math.max(0, -w)) / 2.5);
    // the columns of chips stay resolvable much further than the rows: a fan of lines into the horizon
    const K = (cs * D) / sn; // y - hy = K · scale
    const scEnd = 2.6 / SP;
    const scCut = (y1 - hy) / K;
    const yEnd = hy + K * scEnd;
    if (scCut > scEnd) {
      const cg = ctx.createLinearGradient(0, yEnd, 0, y1);
      cg.addColorStop(0, withAlpha(C.cyan, 0));
      cg.addColorStop(0.45, withAlpha(C.cyan, 0.16 * bandA));
      cg.addColorStop(0.85, withAlpha(C.ice, 0.22 * bandA));
      cg.addColorStop(1, withAlpha(C.ice, 0));
      ctx.strokeStyle = cg;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const cmax = Math.min(300, 16 + distVis);
      for (let c = Math.ceil(15.5 - cmax); c <= Math.floor(15.5 + cmax); c++) {
        const off = (c - 15.5) * SP;
        const xa = 960 + off * scEnd;
        const xb = 960 + off * scCut;
        if (Math.max(xa, xb) < -10 || Math.min(xa, xb) > 1930) continue;
        ctx.moveTo(xa, yEnd);
        ctx.lineTo(xb, y1);
      }
      ctx.stroke();
    }
    // crests
    const wCut = (vCut1 - dol) / SP + 15.5;
    for (let k = Math.ceil((0.33 * -2000 + 0.5 * t - Math.PI / 2) / TAU); ; k++) {
      const w = (Math.PI / 2 + TAU * k - 0.5 * t) / 0.33;
      if (w > wCut + 1) break;
      const v = (w - 15.5) * SP + dol;
      const p = proj(v);
      const rp = SP * cs * p.sc * p.sc; // row pitch on screen
      if (rp < 0.35) continue;
      const half = Math.min(1100, (16 + distVis) * SP * p.sc);
      const hh = Math.max(1.2, 2.2 * rp);
      const a = 0.5 * bandA * reveal(w) * clamp(rp / 1.5) * (1 - clamp((v - vCut0) / Math.max(1, vCut1 - vCut0)));
      if (a <= 0.01) continue;
      const lg = ctx.createLinearGradient(960 - half, 0, 960 + half, 0);
      lg.addColorStop(0, withAlpha(C.ice, 0));
      lg.addColorStop(0.2, withAlpha(C.ice, a));
      lg.addColorStop(0.8, withAlpha(C.ice, a));
      lg.addColorStop(1, withAlpha(C.ice, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(960 - half, p.y - hh / 2, 2 * half, hh);
    }
    // die lights
    for (let i = 0; i < N_DOT; i++) {
      const yy = lerp(hy + 1.5, yc + 8, Math.pow(hash(i * 3.17 + 0.5), 1.7));
      const v0 = vOfY(yy);
      const p0 = proj(v0);
      const v = v0 + dol;
      const p = proj(v);
      const fadeNear = 1 - clamp((p.y - (yc - 24)) / 32);
      if (fadeNear <= 0) continue;
      const w = (v0 - 0) / SP + 15.5; // row index (the dolly carries the dots with the floor)
      const lat = Math.round(((hash(i * 7.7) * 2 - 1) * 1150) / p0.sc / SP) * SP; // on a column of chips
      if (Math.abs(lat) / SP > 16 + distVis) continue;
      const x = 960 + lat * p.sc;
      const tw = noise1(f * 0.12 + i * 3.7);
      const wave = seaWave(w, t);
      const fog = clamp(1.3 - (p.Z - D) / 12000);
      const a = bandA * reveal(w) * fog * fadeNear * (0.35 + 0.65 * wave * wave) * (0.45 + 0.55 * tw);
      if (a <= 0.01) continue;
      const col = i % 5 === 0 ? C.magenta : i % 2 ? C.cyan : C.ice;
      glow(ctx, x, p.y, 1.5 + 4.5 * Math.pow(p.sc, 0.7) * (0.6 + 0.4 * tw), col, Math.min(1, 1.3 * a));
    }
    // glints
    for (let i = 0; i < N_GLINT; i++) {
      const yy = lerp(hy + 3, y1, Math.pow(hash(i * 3.17 + 0.5), 1.25));
      const Y = yy - pivot;
      const v0 = (Y * D) / (cs * D + Y * sn); // plane coordinate of that screen row (before the dolly)
      const p = proj(v0 + dol * 0.6);
      if (p.y > yc + 10) continue;
      const col = ((hash(i * 7.7) * 2 - 1) * 1060) / (SP * proj(v0).sc);
      const x = 960 + col * SP * p.sc;
      const tw = Math.pow(noise1(f * 0.14 + i * 3.7), 3);
      glow(ctx, x, p.y, 2 + 10 * tw * Math.sqrt(p.sc), SEA_COLS[i % 3], bandA * Math.min(1, 0.15 + 1.8 * tw));
    }
  }
  // halo of the grid while it is still facing us
  glow(ctx, 960, SEA_CY, 1120, C.cyan, (0.12 + 0.25 * sync) * (1 - tp), 0.04);
  ctx.globalCompositeOperation = "source-over";

  // 3. the chips
  const crests: number[] = [];
  for (let r = -140; r <= NEAR_R; r++) {
    const v = rowV(r);
    if (v < vCut0) continue;
    const { Z, sc } = proj(v);
    const yb = proj(v + SS / 2).y;
    const yt = proj(v - SS / 2).y;
    if (yb < 0 || yt > 840) continue;
    const pitchFade = clamp((v - vCut0) / Math.max(1, vCut1 - vCut0));
    const topFade = clamp((yt - 172) / 60);
    const botFade = clamp((812 - yb) / 55);
    const depthFade = clamp(1.2 - (Z - D) / 3000);
    const rowA = alpha * pitchFade * topFade * botFade * depthFade;
    if (rowA <= 0.01) continue;
    const w = SS * sc;
    const hgt = Math.max(0.6, yb - yt);
    const halfCols = Math.ceil(1000 / (SP * sc)) + 1;
    const wave = seaWave(r, t);
    const crest = clamp((wave - 0.72) / 0.28) * tp;
    for (let c = Math.floor(15.5 - halfCols); c <= Math.ceil(15.5 + halfCols); c++) {
      const inGrid = r >= 0 && r < 16 && c >= 0 && c < 32;
      let ea = 1;
      let front = 0; // the expanding edge of the sea flashes as new chips are born
      if (!inGrid) {
        const dc = c < 0 ? -c : c > 31 ? c - 31 : 0;
        const dr = r < 0 ? -r : r > 15 ? r - 15 : 0;
        const dist = Math.max(dc, dr);
        ea = clamp((distVis - dist) / 2.5);
        if (ea <= 0) continue;
        front = clamp(1 - Math.abs(distVis - dist - 3) / 3) * clamp((60 - distVis) / 20);
      }
      const x = 960 + (c - 15.5) * SP * sc;
      if (x + w < 0 || x - w > 1920) continue;
      const a = rowA * ea * (inGrid ? lerp(1, 0.86 + 0.14 * wave, tp) : 0.62 + 0.38 * wave * wave);
      if (a <= 0.01) continue;
      if (crest > 0 || front > 0) crests.push(x - w / 2, yt, w, hgt, Math.min(1, crest + 1.6 * front) * a);
      const vv = inGrid ? TVAR[3][r][c] : Math.floor(hash(c * 7.7 + r * 13.3) * NVAR);
      ctx.globalAlpha = a;
      ctx.drawImage(chipImg(vv, Math.max(w, hgt)), x - w / 2, yt, w, hgt);
      if (inGrid && sync > 0.01) {
        // the ×512 sync flash carries over from the flat grid
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = withAlpha(C.ice, 0.29 * sync);
        ctx.fillRect(x - w * 0.3, yt + hgt * 0.2, w * 0.6, hgt * 0.6);
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }
  // computation ripples: bright crests rolling outward across the sea
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = C.ice;
  for (let i = 0; i < crests.length; i += 5) {
    ctx.globalAlpha = crests[i + 4] * 0.55;
    ctx.fillRect(crests[i], crests[i + 1], crests[i + 2], crests[i + 3]);
  }
  ctx.globalAlpha = 1;
  // the sky's light pooled on the floor
  const bloomA = alpha * clamp((distVis - 20) / 40);
  if (bloomA > 0.01 && hy > -200) {
    ctx.save();
    ctx.translate(960, lerp(hy, pivot, 0.45));
    ctx.scale(1, 0.32);
    glow(ctx, 0, 0, 1000, C.cyan, 0.16 * bloomA, 0.03);
    ctx.restore();
  }
  // horizon glow
  const ha = alpha * alpha * clamp((distVis - 30) / 40) * clamp((sn - 0.3) / 0.3);
  if (ha > 0.01) {
    const g = ctx.createLinearGradient(0, hy - 120, 0, hy + 120);
    g.addColorStop(0, withAlpha(C.cyan, 0));
    g.addColorStop(0.42, withAlpha(C.cyan, 0.16 * ha));
    g.addColorStop(0.5, withAlpha(C.ice, 0.5 * ha));
    g.addColorStop(0.58, withAlpha(C.blue, 0.16 * ha));
    g.addColorStop(1, withAlpha(C.blue, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy - 120, 1920, 240);
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// the parallel beat: flip → heat map → ignition → replication → sea
const FLIP_MID = PARALLEL + 11;

const drawParallel = (ctx: CanvasRenderingContext2D, f: number) => {
  const w = 1920;
  // flip streak at the moment the card is edge-on
  const st = Math.exp(-Math.pow((f - FLIP_MID) / 4.5, 2));
  if (st > 0.01) {
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, withAlpha(C.cyan, 0));
    g.addColorStop(0.5, withAlpha("#ffffff", 0.95 * st));
    g.addColorStop(1, withAlpha(C.cyan, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, MAP_CY - 2 - 4 * st, w, 4 + 8 * st);
    glow(ctx, 960, MAP_CY, 360, C.cyan, 0.45 * st, 0.05);
    ctx.globalCompositeOperation = "source-over";
  }
  if (f >= FLIP_MID && f < X8) {
    // the back of the card: the attention pattern as a 14×14 matrix, charging up into the ignition
    const un = ease.outBack(prog(f, FLIP_MID, FLIP_MID + 10));
    const ig = f >= IGNITE;
    const it = f - IGNITE;
    const inten = ig ? 1 : 0.55 + 0.2 * ease.inCubic(prog(f, FLIP_MID, IGNITE)) + 0.03 * Math.sin(f * 0.3);
    const white = ig ? 0.92 * Math.exp(-it / 3.5) : 0;
    const S = HEAT_S;
    ctx.save();
    ctx.translate(0, MAP_CY);
    ctx.scale(1, Math.max(0.004, un));
    ctx.translate(0, -MAP_CY);
    ctx.globalCompositeOperation = "lighter";
    const charge = ease.inCubic(prog(f, FLIP_MID, IGNITE));
    glow(ctx, 960, MAP_CY, 520, ig ? C.magenta : C.cyan, 0.14 + 0.1 * charge + (ig ? 0.55 * Math.exp(-it / 9) : 0), 0.04);
    ctx.globalCompositeOperation = "source-over";
    drawHeat(ctx, 960 - S / 2, MAP_CY - S / 2, S, 0, inten, white, ig ? 1 + 1.2 * Math.exp(-it / 8) : 0.6 + 0.3 * charge);
    ctx.strokeStyle = withAlpha(C.cyan, 0.9);
    ctx.lineWidth = 2;
    ctx.strokeRect(960 - S / 2, MAP_CY - S / 2, S, S);
    // axis labels: the same sentence along both edges (dimmed while the sparks fly)
    const la = clamp(un) * (1 - prog(f, X8 - 5, X8)) * (ig ? 1 - 0.6 * clamp(1 - it / 12) : 1);
    if (la > 0) {
      ctx.globalAlpha = la;
      ctx.font = `700 21px ${FONT_CN}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      const cs = S / NQ;
      for (let i = 0; i < NQ; i++) {
        ctx.fillText(QTOK[i], 960 - S / 2 + (i + 0.5) * cs, MAP_CY - S / 2 - 18);
        ctx.fillText(QTOK[i], 960 - S / 2 - 20, MAP_CY - S / 2 + (i + 0.5) * cs);
      }
      ctx.font = `800 22px ${FONT_MONO}`;
      ctx.fillStyle = C.ice;
      ctx.textAlign = "left";
      ctx.fillText("KEY  →", 960 + S / 2 + 18, MAP_CY - S / 2 - 18);
      ctx.save();
      ctx.translate(960 - S / 2 - 52, MAP_CY - S / 2 + 6);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = "left";
      ctx.fillText("QUERY  →", 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // ignition: shock frames and sparks thrown off the matrix (faded out above the caption band)
    if (ig && it < 30) {
      const g = layer();
      g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 3; k++) {
        const tt = it - k * 2;
        if (tt < 0) continue;
        const grow = 10 + tt * (34 - k * 7) * Math.exp(-tt / 40);
        const ra = Math.exp(-tt / (3 + k * 1.2));
        g.strokeStyle = withAlpha(k === 1 ? C.magenta : C.ice, 0.85 * ra);
        g.lineWidth = 2 + 7 * ra;
        g.strokeRect(960 - S / 2 - grow, MAP_CY - S / 2 - grow, S + 2 * grow, S + 2 * grow);
      }
      for (let i = 0; i < 260; i++) {
        const side = i % 4;
        const u = hash(i * 3.7) - 0.5;
        const sx = side < 2 ? 960 + u * S : 960 + (side === 2 ? -1 : 1) * (S / 2);
        const sy = side < 2 ? MAP_CY + (side === 0 ? -1 : 1) * (S / 2) : MAP_CY + u * S;
        const an = Math.atan2(sy - MAP_CY, sx - 960) + (hash(i * 5.1) - 0.5) * 0.9;
        const v = 5 + hash(i * 2.3) * 22;
        const d = (v / 0.06) * (1 - Math.exp(-0.06 * it));
        const life = Math.exp(-it / (10 + 16 * hash(i * 8.1)));
        const col = i % 3 === 0 ? C.magenta : i % 3 === 1 ? C.ice : C.cyan;
        glow(g, sx + Math.cos(an) * d, sy + Math.sin(an) * d, 3 + 5 * hash(i * 1.9) * life + 1.5, col, life);
      }
      bandMask(g, -800, 768, 34);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(g.canvas, 0, 0);
      ctx.restore();
    }
  } else if (f >= X8 && f < TILT) {
    drawStageTiles(ctx, f, f >= X512 ? 3 : f >= X64 ? 2 : 1);
  } else if (f >= TILT && f < SEA_GONE) {
    const out = ease.inOutCubic(prog(f, SEA_END, SEA_GONE));
    drawSea(ctx, f, 1 - out, 70 * out);
  }
};

// ---------------------------------------------------------------------------------------------
// generation
const QY = 448;
const QB = 74;
const QP = 88;
const qX = (i: number) => 960 + (i - (NQ - 1) / 2) * QP;
const AY = 652;
const AH = 80;
const AFONT = 46;
const aW = (i: number) => ANS[i].length * AFONT + 30;
const AGAP = 12;
const A_TOTAL = ANS.reduce((s, _, i) => s + aW(i), 0) + AGAP * (NA - 1);
const AX: number[] = [];
{
  let x = 960 - A_TOTAL / 2;
  for (let i = 0; i < NA; i++) {
    AX.push(x + aW(i) / 2);
    x += aW(i) + AGAP;
  }
}
/** semantic boosts: answer token -> question tokens (q) and earlier answer tokens (a) */
const GEN_LINKS: Record<number, { q?: number[]; a?: number[] }> = {
  0: { q: [3, 4, 5] },
  1: { q: [0, 1, 2, 12] },
  3: { q: [12], a: [1] },
  5: { q: [0, 1, 2], a: [1, 3] },
  7: { q: [6, 7] },
  8: { q: [6, 7], a: [1, 3, 5] },
  9: { q: [8, 9, 12] },
  10: { a: [9] },
  11: { q: [13] },
};
const genW = (n: number, isQ: boolean, j: number) => {
  const L = GEN_LINKS[n];
  const strong = L && (isQ ? L.q : L.a)?.includes(j);
  return strong ? 0.85 + 0.15 * hash(n * 3.1 + j) : 0.06 + 0.32 * Math.pow(hash(n * 31.7 + j * 7.3 + (isQ ? 0 : 50)), 2);
};
const genHead = (n: number, j: number, isQ: boolean) => Math.floor(hash(n * 3.3 + j * 1.7 + (isQ ? 0 : 9)) * 3);

const GEN_IN = GENERATE - 2;
const qRowA = (f: number, i: number) => ease.outCubic(prog(f, GEN_IN + i * 0.8, GEN_IN + 14 + i * 0.8));
/** closing forward pass along the finished answer */
const FWD_A = LAND + 4;
const FWD_B = LAND + 22;
const fwdX = (f: number) =>
  lerp(AX[0] - aW(0) / 2 - 70, AX[NA - 1] + aW(NA - 1) / 2 + 70, ease.inOutSine(prog(f, FWD_A, FWD_B)));

const bezPt = (x0: number, y0: number, x1: number, y1: number, t: number) => {
  // vertical-tangent cubic between the rows
  const c0y = y0 - 80;
  const c1y = y1 + 80;
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t * t * t * x1,
    y: u * u * u * y0 + 3 * u * u * t * c0y + 3 * u * t * t * c1y + t * t * t * y1,
  };
};

const drawGenerate = (ctx: CanvasRenderingContext2D, f: number) => {
  // closing push-in on both rows
  const pin = 1 + 0.035 * ease.inOutSine(prog(f, TOKEN[NA - 1], DUR));
  ctx.save();
  ctx.translate(960, 540);
  ctx.scale(pin, pin);
  ctx.translate(-960, -540);
  // highlight earned by question / answer tokens from incoming arcs
  const qHi = new Array<number>(NQ).fill(0);
  const aHi = new Array<number>(NA).fill(0);
  ctx.globalCompositeOperation = "lighter";
  for (let n = 0; n < NA; n++) {
    const t = f - TOKEN[n];
    if (t < 0) continue;
    const g = ease.outCubic(clamp(t / 9));
    const fade = t < 9 ? 1 : Math.exp(-(t - 9) / 16);
    const x0 = AX[n];
    const y0 = AY - AH / 2 - 4;
    // to the question
    for (let j = 0; j < NQ; j++) {
      const w = genW(n, true, j);
      const a = Math.max(fade * (0.15 + 0.8 * w), w > 0.8 ? 0.1 : 0);
      if (a < 0.02) continue;
      const col = HEAD_COL[w > 0.8 ? 0 : genHead(n, j, true)];
      const x1 = qX(j);
      const y1 = QY + QB / 2 + 4;
      const steps = 18;
      const path = () => {
        for (let s = 0; s <= steps; s++) {
          const p = bezPt(x0, y0, x1, y1, (s / steps) * g);
          if (s) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
      };
      if (w > 0.8 && fade > 0.2) glowStroke(ctx, path, col, 2.2, a);
      else {
        ctx.strokeStyle = withAlpha(col, a * 0.8);
        ctx.lineWidth = 0.8 + 2 * w;
        ctx.beginPath();
        path();
        ctx.stroke();
      }
      if (g < 1) {
        const p = bezPt(x0, y0, x1, y1, g);
        glow(ctx, p.x, p.y, 6 + 10 * w, col, 0.9 * w + 0.2);
      }
      if (t > 6 && t < 40) qHi[j] += w * Math.exp(-(t - 9) / 10) * (t < 9 ? (t - 6) / 3 : 1);
    }
    // to earlier answer tokens
    for (let m = 0; m < n; m++) {
      const w = genW(n, false, m);
      const a = Math.max(fade * (0.15 + 0.8 * w), w > 0.8 ? 0.1 : 0);
      if (a < 0.02) continue;
      const col = HEAD_COL[w > 0.8 ? 0 : genHead(n, m, false)];
      const rx = (AX[n] - AX[m]) / 2;
      const ry = Math.min(100, 18 + rx * 0.3);
      const cx = (AX[n] + AX[m]) / 2;
      const path = () => ctx.ellipse(cx, y0, rx, ry, 0, TAU - Math.PI * g, TAU);
      if (w > 0.8 && fade > 0.2) glowStroke(ctx, path, col, 2.2, a);
      else {
        ctx.strokeStyle = withAlpha(col, a * 0.8);
        ctx.lineWidth = 0.8 + 2 * w;
        ctx.beginPath();
        path();
        ctx.stroke();
      }
      if (t > 6 && t < 40) aHi[m] += w * Math.exp(-(t - 9) / 10) * (t < 9 ? (t - 6) / 3 : 1);
    }
    // spark burst
    if (t < 18) {
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * TAU + hash(n * 9 + i) * 0.5;
        const d = 12 + t * (5 + 3 * hash(i + n * 2));
        glow(ctx, x0 + Math.cos(an) * d * 1.4, AY + Math.sin(an) * d * 0.8, 5, i % 2 ? C.ice : C.magenta, 1 - t / 18);
      }
    }
  }
  // the closing forward pass: a beam runs along the answer
  const fwdOn = f >= FWD_A - 2 && f <= FWD_B + 1 ? Math.sin(Math.PI * prog(f, FWD_A - 2, FWD_B + 1)) : 0;
  const fx = fwdX(f);
  if (fwdOn > 0.01) {
    ctx.save();
    ctx.translate(fx, AY);
    ctx.scale(0.45, 1);
    glow(ctx, 0, 0, 130, C.ice, 0.75 * fwdOn, 0.08);
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  // question row (compact)
  for (let i = 0; i < NQ; i++) {
    const a = qRowA(f, i);
    drawToken(ctx, qX(i), QY - (1 - a) * 36, QB, QB, QTOK[i], 44, a, Math.min(1, qHi[i] * 0.9));
  }
  // answer tokens
  let last = -1;
  for (let n = 0; n < NA; n++) {
    const t = f - TOKEN[n];
    if (t < 0) break;
    last = n;
    const pop = ease.outBack(clamp(t / 8));
    const s = 1 + 0.25 * (1 - pop);
    const passed = clamp((fx - AX[n] + 30) / 50) * (f >= FWD_A - 3 ? 1 : 0);
    const beam = fwdOn * Math.exp(-Math.pow((fx - AX[n]) / 55, 2));
    const key = KEY_COL[n];
    const kc = key ? passed : 0;
    const flash = Math.max(Math.exp(-t / 4), 0.8 * beam);
    const hi = Math.min(1, 0.22 + Math.exp(-t / 12) * 0.7 + aHi[n] * 0.8 + 0.6 * beam + 0.65 * kc);
    const base = n % 2 ? C.cyan : C.ice;
    drawToken(ctx, AX[n], AY, aW(n) * s, AH * s, ANS[n], AFONT * s, clamp(t / 2 + 0.65), hi, flash, key ? mix(base, key, kc) : base);
    // a ring bursting off the new token
    if (t < 9) {
      const k = t / 9;
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = withAlpha(C.ice, 0.7 * Math.pow(1 - k, 2));
      ctx.lineWidth = 1 + 3 * (1 - k);
      roundBox(ctx, AX[n], AY, aW(n) + 44 * ease.outCubic(k), AH + 34 * ease.outCubic(k), 14);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
  }
  // cursor
  const ca = ease.outCubic(prog(f, GEN_IN + 6, GEN_IN + 14));
  if (ca > 0) {
    const lastT = last >= 0 ? TOKEN[last] : GENERATE;
    const x = last >= 0 ? AX[last] + aW(last) / 2 + 18 : AX[0] - aW(0) / 2 + 8;
    const on = f - lastT < 10 && last >= 0 ? 1 : Math.floor(f / 9) % 2 ? 1 : 0.15;
    ctx.globalAlpha = ca * on;
    ctx.fillStyle = C.cyan;
    ctx.fillRect(x, AY - 30, 14, 60);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x + 7, AY, 40, C.cyan, 0.5 * on * ca);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  // row tags
  const ta = qRowA(f, 0);
  ctx.globalAlpha = ta * 0.9;
  ctx.font = `800 24px ${FONT_MONO}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.ice;
  ctx.fillText("PROMPT", qX(0) - QB / 2 - 22, QY);
  ctx.fillStyle = C.magenta;
  ctx.fillText("AI", AX[0] - aW(0) / 2 - 22, AY);
  ctx.globalAlpha = 1;
  ctx.restore();
};

// the 1亿 landing: shock rings and sparks thrown off the counter (top right)
const LAND_X = 1712;
const LAND_Y = 200;
const drawLanding = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - LAND;
  if (t < 0 || t > 44) return;
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, LAND_X, LAND_Y, 300 * Math.exp(-t / 10) + 80, C.magenta, 0.55 * Math.exp(-t / 8), 0.05);
  for (let k = 0; k < 3; k++) {
    const tt = t - k * 3;
    if (tt < 0) continue;
    const r = 50 + tt * (26 - k * 5) * Math.exp(-tt / 40);
    const a = Math.exp(-tt / (6 + k * 3));
    ctx.strokeStyle = withAlpha(k === 1 ? C.ice : C.magenta, 0.85 * a);
    ctx.lineWidth = 2 + 8 * a;
    ctx.beginPath();
    ctx.ellipse(LAND_X, LAND_Y, r * 1.15, r * 0.8, 0, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 44; i++) {
    const an = hash(i * 2.9 + 7) * TAU;
    const v = 8 + hash(i * 4.1) * 26;
    const drag = 0.07 + hash(i * 6.7) * 0.05;
    const d = (v / drag) * (1 - Math.exp(-drag * t));
    const life = Math.exp(-t / (8 + 14 * hash(i * 8.8)));
    const x = LAND_X + Math.cos(an) * d * 1.25;
    const y = LAND_Y + Math.sin(an) * d * 0.8;
    if (y > 780) continue;
    glow(ctx, x, y, 3 + 5 * hash(i * 1.1) * life + 1.5, i % 3 === 0 ? C.ice : C.magenta, life);
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
const Main: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const bg = ctx.createRadialGradient(w * 0.55, h * 0.42, 0, w * 0.55, h * 0.42, w * 0.8);
      bg.addColorStop(0, "#081a2e");
      bg.addColorStop(1, "#01030a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      drawStack(ctx, f);
      // calm the background behind the foreground graphics (less while the whole stack burns)
      const calm = 0.5 * (1 - 0.65 * fullLit(f, 4)) * (1 - 0.3 * clamp(1 - f / 40));
      const sc = ctx.createRadialGradient(960, 480, 0, 960, 480, 920);
      sc.addColorStop(0, `rgba(1,3,8,${calm})`);
      sc.addColorStop(0.6, `rgba(1,3,8,${calm * 0.6})`);
      sc.addColorStop(1, "rgba(1,3,8,0)");
      ctx.fillStyle = sc;
      ctx.fillRect(0, 0, w, h);

      // 1. attention row, flipping away at PARALLEL
      const flipOut = ease.inCubic(prog(f, PARALLEL, FLIP_MID));
      if (f >= ATTEND && flipOut < 1) {
        ctx.save();
        ctx.translate(0, MAP_CY);
        ctx.scale(1, Math.max(0.004, 1 - flipOut));
        ctx.translate(0, -MAP_CY);
        drawAttention(ctx, f);
        ctx.restore();
      }
      // 2. heat map → GPUs → sea
      if (f >= PARALLEL) drawParallel(ctx, f);
      // 3. generation
      if (f >= GEN_IN) drawGenerate(ctx, f);
      drawLanding(ctx, f);
    }}
  />
);

// ---------------------------------------------------------------------------------------------
// HUD
const HeadLegend: React.FC = () => {
  const f = useCurrentFrame();
  const out = 1 - prog(f, PARALLEL - 6, PARALLEL + 6);
  return (
    <div style={{ position: "absolute", right: 96, top: 80, textAlign: "right", fontFamily: FONT_MONO }}>
      <div style={{ fontFamily: FONT_CN, fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.92)", opacity: ease.outCubic(prog(f, HEAD_T[0] - 10, HEAD_T[0] + 6)) * out, textShadow: "0 2px 8px #000", marginBottom: 8 }}>
        多头注意力
      </div>
      {["HEAD A", "HEAD B", "HEAD C"].map((t, h) => {
        const a = ease.outCubic(prog(f, HEAD_T[h] - 4, HEAD_T[h] + 10)) * out;
        return (
          <div key={t} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 6, opacity: a, transform: `translateX(${(1 - a) * 20}px)` }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.14em", color: "rgba(255,255,255,0.88)", textShadow: "0 2px 6px #000" }}>{t}</span>
            <span style={{ width: 50, height: 5, borderRadius: 3, background: HEAD_COL[h], boxShadow: `0 0 10px ${HEAD_COL[h]}` }} />
          </div>
        );
      })}
    </div>
  );
};

const TopLabel: React.FC<{ from: number; to: number; text: string; sub: string; col: string; size: number; subSize: number; backing?: boolean }> = ({
  from,
  to,
  text,
  sub,
  col,
  size,
  subSize,
  backing,
}) => {
  const f = useCurrentFrame();
  const a = Math.min(ease.outCubic(prog(f, from, from + 12)), 1 - prog(f, to - 10, to));
  if (a <= 0) return null;
  const sp = 0.2 + 0.25 * (1 - ease.outExpo(prog(f, from, from + 26)));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center", opacity: a }}>
      {backing ? (
        <div
          style={{
            position: "absolute",
            left: 420,
            right: 420,
            top: -40,
            height: size + subSize + 100,
            background: "radial-gradient(closest-side, rgba(1,4,10,0.86), rgba(1,4,10,0.6) 55%, rgba(1,4,10,0))",
          }}
        />
      ) : null}
      <div style={{ position: "relative", fontFamily: FONT_MONO, fontWeight: 800, fontSize: size, lineHeight: 1.15, letterSpacing: `${sp}em`, color: "#fff", textShadow: `0 0 10px ${col}, 0 0 26px ${col}, 0 2px 6px #000` }}>
        {text}
      </div>
      <div style={{ position: "relative", fontFamily: FONT_CN, fontWeight: 700, fontSize: subSize, letterSpacing: "0.3em", color: "rgba(255,255,255,0.92)", marginTop: 6, textShadow: `0 0 12px ${col}, 0 2px 6px #000` }}>
        {sub}
      </div>
    </div>
  );
};

/** Top-right meter: how many GPUs are working at once (log scale, no digits). */
const GpuMeter: React.FC = () => {
  const f = useCurrentFrame();
  const a = Math.min(ease.outCubic(prog(f, X8 - 4, X8 + 10)), 1 - prog(f, SEA_END - 6, SEA_END + 6));
  if (a <= 0) return null;
  const lvl = [X8, X64, X512, TILT].map((T) => ease.outExpo(prog(f, T + 2, T + 14)));
  const fill = (1 + lvl[0] + lvl[1] + lvl[2] + 0.6 * lvl[3]) / 4.6;
  const W = 380;
  return (
    <div style={{ position: "absolute", right: 96, top: 76, width: W, opacity: a, transform: `translateX(${(1 - a) * 24}px)` }}>
      <div style={{ textAlign: "right", fontFamily: FONT_CN, fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.92)", textShadow: "0 2px 6px #000" }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.ice }}>GPU</span> 并行规模
      </div>
      <div style={{ position: "relative", marginTop: 10, height: 14, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(155,232,255,0.35)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fill * 100}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.cyan} 60%, #ffffff)`, boxShadow: `0 0 16px ${C.cyan}` }} />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ position: "absolute", left: `${(i / 4.6) * 100}%`, top: -4, bottom: -4, width: 2, background: "rgba(2,6,14,0.9)" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {Array.from({ length: 24 }, (_, i) => {
          const on = i / 24 < fill;
          return <div key={i} style={{ flex: 1, height: 6, background: on ? C.cyan : "rgba(255,255,255,0.12)", opacity: on ? 0.5 + 0.5 * hash(i * 3.3 + Math.floor(f / 2)) : 1, boxShadow: on ? `0 0 6px ${C.cyan}` : undefined }} />;
        })}
      </div>
    </div>
  );
};

const UserCounter: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease.outCubic(prog(f, USERS, USERS + 14));
  if (a <= 0) return null;
  const p = prog(f, USERS + 4, LAND);
  const K = 4.2;
  const g = (Math.exp(K * p) - 1) / (Math.exp(K) - 1);
  const landed = f >= LAND;
  const lt = f - LAND;
  const num = landed ? "1" : String(Math.round(1 + 9999 * g));
  const unit = landed ? "亿" : "万";
  const sc = landed ? 1.5 + 0.4 * Math.exp(-lt / 3.5) : 1;
  const ab = landed ? 16 * Math.exp(-lt / 5) : 0; // chromatic split on the slam
  const col = landed ? C.magenta : C.cyan;
  const comet = ease.inOutCubic(prog(f, LAND + 2, LAND + 14));
  const under = ease.outCubic(prog(f, LAND + 12, LAND + 22));
  const CW = 380;
  const CH = 48;
  const pts: string[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * p;
    const gy = (Math.exp(K * u) - 1) / (Math.exp(K) - 1);
    pts.push(`${(10 + u * CW).toFixed(1)},${(2 + CH - gy * CH).toFixed(1)}`);
  }
  const numStyle: React.CSSProperties = { fontFamily: FONT_MONO, fontWeight: 800, fontSize: 92, lineHeight: 1, whiteSpace: "nowrap" };
  const unitStyle: React.CSSProperties = { fontFamily: FONT_CN, fontWeight: 900, fontSize: 76, marginLeft: 6 };
  const glowCol = landed ? `0 0 10px #fff, 0 0 30px ${C.magenta}, 0 0 80px ${C.magenta}, 0 2px 8px #000` : `0 0 18px ${C.cyan}, 0 2px 8px #000`;
  return (
    <div style={{ position: "absolute", right: 110, top: 64, width: CW + 40, height: 320, opacity: a, transform: `translateY(${(1 - a) * -16}px)` }}>
      <div style={{ position: "absolute", right: 0, top: 0, fontFamily: FONT_CN, fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.92)", textShadow: "0 2px 6px #000", whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.ice }}>ChatGPT</span> 用户
      </div>
      <div style={{ position: "absolute", right: 0, top: 56, height: 160, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <div style={{ position: "relative", transform: `scale(${sc})`, transformOrigin: "right center" }}>
          {ab > 0.4
            ? [C.magenta, C.cyan].map((cc, i) => (
                <div key={cc} style={{ ...numStyle, position: "absolute", right: 0, top: 0, color: cc, opacity: 0.75, mixBlendMode: "screen", transform: `translateX(${(i ? 1 : -1) * ab}px)` }}>
                  {num}
                  <span style={unitStyle}>{unit}</span>
                </div>
              ))
            : null}
          <div style={{ ...numStyle, position: "relative", color: "#fff", textShadow: glowCol }}>
            {num}
            <span style={{ ...unitStyle, color: landed ? "#ff5fd4" : "#fff" }}>{unit}</span>
          </div>
        </div>
      </div>
      <svg width={CW + 20} height={CH + 46} style={{ position: "absolute", right: 0, top: 236, overflow: "visible" }}>
        <line x1={10} y1={CH + 2} x2={CW + 10} y2={CH + 2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
        <polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth={3} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
        {comet > 0 && comet < 1 ? (
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke="#ffd6f4"
            strokeWidth={6}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.16 1.2"
            strokeDashoffset={0.16 - comet * 1.16}
            style={{ filter: `drop-shadow(0 0 8px ${C.magenta}) drop-shadow(0 0 16px ${C.magenta})` }}
          />
        ) : null}
        <circle cx={10 + p * CW} cy={2 + CH - g * CH} r={landed ? 8 : 6} fill="#fff" style={{ filter: `drop-shadow(0 0 8px ${col})` }} />
        <text x={10} y={CH + 38} fill="rgba(255,255,255,0.82)" fontFamily={FONT_CN} fontWeight={700} fontSize={22} textAnchor="start">
          上线
        </text>
        <text x={CW + 10} y={CH + 38} fill={landed ? "#ff7ad9" : "rgba(255,255,255,0.85)"} fontFamily={FONT_CN} fontWeight={700} fontSize={24} textAnchor="end" style={{ filter: landed ? `drop-shadow(0 0 8px ${C.magenta})` : undefined }}>
          两个月
        </text>
        {under > 0 ? <rect x={CW + 10 - 76 * under} y={CH + 44} width={76 * under} height={3} fill={C.magenta} style={{ filter: `drop-shadow(0 0 6px ${C.magenta})` }} /> : null}
      </svg>
    </div>
  );
};

export const TransformerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = sumShake(
    shake(frame, ALL0, 4, 10),
    shake(frame, IGNITE, 16, 18),
    shake(frame, X8 + 8, 5, 10),
    shake(frame, X64 + 8, 6, 10),
    shake(frame, X512 + 8, 8, 12),
    shake(frame, LAND, 10, 16),
  );
  const fade = Math.min(ease.outCubic(prog(frame, 0, 14)), 1 - prog(frame, DUR - 18, DUR));
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fade }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}rad)` }}>
        <Main />
        <HeadLegend />
        <TopLabel from={ATTEND + 20} to={PARALLEL} text="SELF-ATTENTION" sub="自注意力" col={C.cyan} size={30} subSize={24} />
        <TopLabel from={IGNITE + 7} to={X512 + 8} text="ALL TOKENS · AT ONCE" sub="所有词，同时计算" col={C.cyan} size={42} subSize={30} backing />
        <GpuMeter />
        <UserCounter />
      </AbsoluteFill>
      <YearStamp year="2017" label="Attention Is All You Need" from={ATTEND} to={X512 - 2} color={C.cyan} />
      <YearStamp year="2022" label="ChatGPT 问世" from={GENERATE + 14} color={C.magenta} />
      <Flash at={ALL0} dur={8} color={C.ice} peak={0.1} />
      <Flash at={IGNITE} dur={10} color={C.magenta} peak={0.28} />
      <Flash at={X512 + 8} dur={8} color={C.cyan} peak={0.14} />
      <Flash at={LAND} dur={10} color={C.magenta} peak={0.2} />
      <Captions
        accent={C.cyan}
        items={[
          { from: 35, to: 150, text: "2017年，{{Transformer}}出现了——" },
          { from: 155, to: 275, text: "它让AI同时“注意”一句话里的{{所有词}}。", accent: "#ff7ad9" },
          { from: 285, to: 395, text: "它天生适合并行——{{GPU越多，学得越多}}。" },
          { from: 425, to: 530, text: "2022年，ChatGPT问世，{{两个月用户破亿}}。", accent: "#ff7ad9" },
        ]}
      />
    </AbsoluteFill>
  );
};
