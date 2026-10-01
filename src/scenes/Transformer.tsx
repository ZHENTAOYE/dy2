import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmt, hash, lerp, noise1, prog, shake, sumShake, TAU } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { Flash, YearStamp } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("transformer");
const ATTEND = cue("transformer", "attend");
const PARALLEL = cue("transformer", "parallel");
const GENERATE = cue("transformer", "generate");
const USERS = cue("transformer", "users");
/** ignite (every cell at once), ×8, ×64, ×512, tilt into the sea of tiles */
const [IGNITE, X8, X64, X512, TILT] = ticks("transformer", "tile");
/** one frame per generated answer token */
const TOKEN = ticks("transformer", "token");
const LAND = USERS + 80; // the user counter lands on 1亿

// ---------------------------------------------------------------------------------------------
// tokens & deterministic "attention"
const QTOK = ["计", "算", "机", "为", "什", "么", "突", "然", "变", "得", "这", "么", "强", "？"];
const NQ = QTOK.length;
const ANS = ["因为", "算力", "、", "数据", "和", "算法", "，", "终于", "同时", "就位", "了", "。"];
const NA = ANS.length;

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
/** heat map: strongest head per cell */
const HM: number[][] = [];
const HMH: number[][] = [];
for (let q = 0; q < NQ; q++) {
  HM.push([]);
  HMH.push([]);
  for (let k = 0; k < NQ; k++) {
    let best = 0;
    let bh = 1;
    for (let h = 0; h < 3; h++)
      if (WQ[h][q][k] > best) {
        best = WQ[h][q][k];
        bh = h;
      }
    HM[q].push(k === q ? 0.72 : clamp(Math.pow(best, 2.2) * 0.95 + 0.05 * hash(q * 31 + k * 7)));
    HMH[q].push(bh);
  }
}
const heatVal = (v: number, q: number, k: number) =>
  v === 0 || q === k ? HM[q][k] : clamp(HM[(q + v * 5) % NQ][(k + v * 3) % NQ] * (0.55 + 0.75 * hash(v * 71.3 + q * 14.1 + k * 3.7)));
const heatHead = (v: number, q: number, k: number) => (v === 0 ? HMH[q][k] : (HMH[(q + v * 5) % NQ][(k + v * 3) % NQ] + v) % 3);

// ---------------------------------------------------------------------------------------------
// background: a perspective stack of network layers
const NL = 12;
const GX = 22;
const GY = 12;
const LHW = 12;
const LHH = 6.75;
const LZ0 = 13;
const LDZ = 3.6;
/** per-layer grid offset (in cells) so the node lattices of successive layers don't line up into streaks */
const LOX = (k: number) => (hash(k * 3.1 + 1) - 0.5) * 0.8;
const LOY = (k: number) => (hash(k * 5.7 + 2) - 0.5) * 0.8;
const LXc = (ix: number, k: number) => -LHW + ((ix + 0.5 + LOX(k)) * 2 * LHW) / GX;
const LYc = (iy: number, k: number) => -LHH + ((iy + 0.5 + LOY(k)) * 2 * LHH) / GY;
const LZc = (k: number) => LZ0 + k * LDZ;

const camAt = (f: number) =>
  camera({
    x: -9 + 1.3 * Math.sin(f / 170),
    y: -3 + 0.5 * Math.sin(f / 230 + 2),
    z: -1 + f * 0.006,
    yaw: 0.3 + 0.03 * Math.sin(f / 210 + 1),
    pitch: 0.1,
    f: 1000,
  });

const tokPulse = (f: number, delay: number) => {
  let s = 0;
  for (const T of TOKEN) {
    const d = f - (T - delay);
    if (d > -8 && d < 8) s += Math.exp((-d * d) / 10);
  }
  return s;
};

/** 0..1+ brightness of layer k */
const layerLit = (f: number, k: number) => {
  const base = 0.3 + 0.12 * prog(f, GENERATE - 10, GENERATE + 12);
  const par = ease.outCubic(prog(f, IGNITE - 6 + k * 3, IGNITE + 16 + k * 3)) * (1 - ease.inOutCubic(prog(f, GENERATE - 12, GENERATE + 12)));
  const pre = 0.25 * ease.inOutSine(prog(f, 258, 280)) * (1 - prog(f, PARALLEL, PARALLEL + 20));
  const pulse = f > 395 ? 0.6 * tokPulse(f, (NL - 1 - k) * 1.3 + 2) : 0;
  return base + 0.75 * par + pre + pulse;
};

const NODE_COL = [C.cyan, C.ice, C.blue, C.cyan];
const NSIG = 190;
const sigNode = (s: number, k: number): [number, number] => {
  const bx = Math.floor(hash(s * 1.37) * GX);
  const by = Math.floor(hash(s * 2.91 + 4) * GY);
  const ix = clamp(Math.round(bx + (noise1(s * 3.1 + k * 0.6) - 0.5) * 9), 0, GX - 1);
  const iy = clamp(Math.round(by + (noise1(s * 5.3 + k * 0.7 + 40) - 0.5) * 6), 0, GY - 1);
  return [LXc(ix, k), LYc(iy, k)];
};

const drawStack = (ctx: CanvasRenderingContext2D, f: number) => {
  const cam = camAt(f);
  ctx.globalCompositeOperation = "lighter";
  for (let k = NL - 1; k >= 0; k--) {
    const lit = layerLit(f, k);
    const z = LZc(k);
    const cs = [
      project(cam, -LHW, -LHH, z),
      project(cam, LHW, -LHH, z),
      project(cam, LHW, LHH, z),
      project(cam, -LHW, LHH, z),
    ];
    if (cs.some((p) => !p)) continue;
    const P = cs as { x: number; y: number; s: number }[];
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = withAlpha(C.blue, Math.min(0.05, 0.01 + 0.03 * lit));
    ctx.fill();
    ctx.strokeStyle = withAlpha(C.ice, Math.min(0.7, 0.08 + 0.4 * lit));
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // grid lines
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
    ctx.strokeStyle = withAlpha(C.cyan, Math.min(0.2, 0.02 + 0.06 * lit));
    ctx.lineWidth = 1;
    ctx.stroke();
    // nodes
    for (let iy = 0; iy < GY; iy++)
      for (let ix = 0; ix < GX; ix++) {
        const p = project(cam, LXc(ix, k), LYc(iy, k), z);
        if (!p) continue;
        const id = k * 400 + iy * 20 + ix;
        const tw = noise1(f * 0.045 + hash(id) * 60);
        const b = lit * (0.2 + 0.8 * tw * tw);
        glow(ctx, p.x, p.y, p.s * 0.3 * (0.7 + 0.5 * Math.min(1, b)), NODE_COL[id % 4], Math.min(0.85, 0.7 * b));
      }
  }
  // signals flowing up through the layers
  for (let s = 0; s < NSIG; s++) {
    const sp = 0.035 + 0.035 * hash(s * 1.3);
    const ph = (f * sp + hash(s * 7.7) * NL) % NL;
    const k = Math.floor(ph);
    if (k >= NL - 1) continue;
    const t = ease.inOutSine(ph - k);
    const [x0, y0] = sigNode(s, k);
    const [x1, y1] = sigNode(s, k + 1);
    const pa = project(cam, x0, y0, LZc(k));
    const pb = project(cam, lerp(x0, x1, t), lerp(y0, y1, t), lerp(LZc(k), LZc(k + 1), t));
    if (!pa || !pb) continue;
    const lit = Math.min(1.3, (layerLit(f, k) + layerLit(f, k + 1)) / 2);
    const fade = Math.sin((Math.PI * ph) / (NL - 1));
    const col = s % 7 === 0 ? C.magenta : C.ice;
    ctx.strokeStyle = withAlpha(col, 0.22 * lit * fade);
    ctx.lineWidth = Math.max(1, pb.s * 0.03);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    glow(ctx, pb.x, pb.y, pb.s * 0.42, col, Math.min(1, 0.9 * lit * fade));
  }
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// attention row
const TOK_Y = 575;
const TB = 92; // box
const TP = 110; // pitch
const tokX = (i: number) => 960 + (i - (NQ - 1) / 2) * TP;
const MAP_CY = 455; // centre of the attention group == centre of the heat-map tile
const HEAD_T = [ATTEND + 32, ATTEND + 58, ATTEND + 84];
const SW0 = 118; // query sweep start
const SWP = 10; // frames per query
const ALL0 = SW0 + NQ * SWP; // then every token at once

const sweepPos = (f: number) => (f - SW0) / SWP;
const flareOf = (f: number, i: number) => {
  const qf = sweepPos(f);
  const sweep = qf > -0.6 && qf < NQ + 0.2 ? clamp(1.5 - Math.abs(qf - i - 0.5) * 1.6) : 0;
  const all = ease.outCubic(prog(f, ALL0, ALL0 + 10));
  return Math.max(sweep, all);
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
  if (hi > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x, y, w * 1.25, col, 0.45 * hi, 0.05);
    ctx.globalCompositeOperation = "source-over";
  }
  roundBox(ctx, x, y, w, h, h * 0.16);
  ctx.fillStyle = mix("#06111c", "#0e3550", hi);
  ctx.globalAlpha = a * 0.92;
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.strokeStyle = withAlpha(mix(col, "#ffffff", hi * 0.6), 0.5 + 0.5 * hi);
  ctx.lineWidth = 2 + hi;
  ctx.stroke();
  if (flash > 0.01) {
    ctx.fillStyle = withAlpha("#ffffff", flash);
    ctx.fill();
  }
  ctx.font = `900 ${px}px ${FONT_CN}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = flash > 0.5 ? mix("#ffffff", col, flash) : "#ffffff";
  ctx.shadowColor = withAlpha(col, 0.9);
  ctx.shadowBlur = 6 + 14 * hi;
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
        const alpha = Math.min(1, 0.05 + 0.45 * w + 0.85 * fl * fl);
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
        const x = cx + Math.cos(an) * rx;
        const y = by + Math.sin(an) * ry;
        glow(ctx, x, y, 8 + 14 * w, HEAD_COL[h], 0.9 * w * Math.sin(Math.PI * u));
      }
  }
  ctx.globalCompositeOperation = "source-over";
  // tokens
  for (let i = 0; i < NQ; i++) {
    const t = clamp((f - ATTEND - i * 3) / 12);
    if (t <= 0) continue;
    const pop = ease.outBack(t);
    const hi = flareOf(f, i);
    const flash = Math.exp(-(f - ATTEND - i * 3) / 4) * 0.8;
    const y = TOK_Y - (1 - ease.outCubic(t)) * 40;
    drawToken(ctx, tokX(i), y, TB * pop, TB * pop, QTOK[i], 56 * pop, clamp(t * 2), hi, flash);
  }
  // attention-weight bars under the keys for the current query
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
    ctx.fillStyle = "rgba(255,255,255,0.14)";
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
    ctx.globalAlpha = 1;
  }
};

// ---------------------------------------------------------------------------------------------
// heat-map tiles
const drawHeat = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, inten: number, white: number) => {
  const cs = s / NQ;
  const gap = Math.max(0.6, cs * 0.07);
  ctx.fillStyle = "rgba(3,9,18,0.94)";
  ctx.fillRect(x, y, s, s);
  for (let q = 0; q < NQ; q++)
    for (let k = 0; k < NQ; k++) {
      const b = heatVal(v, q, k) * inten;
      const col = HEAD_COL[heatHead(v, q, k)];
      const c2 = b > 0.75 ? mix(col, "#ffffff", (b - 0.75) * 1.6) : mix("#0b2133", col, b / 0.75);
      ctx.fillStyle = withAlpha(c2, 0.35 + 0.65 * Math.min(1, b + 0.1));
      ctx.fillRect(x + k * cs + gap, y + q * cs + gap, cs - 2 * gap, cs - 2 * gap);
    }
  ctx.globalCompositeOperation = "lighter";
  for (let q = 0; q < NQ; q++)
    for (let k = 0; k < NQ; k++) {
      const b = heatVal(v, q, k) * inten;
      if (b > 0.5) glow(ctx, x + (k + 0.5) * cs, y + (q + 0.5) * cs, cs * 1.25, HEAD_COL[heatHead(v, q, k)], (b - 0.4) * 0.55);
    }
  if (white > 0.01) {
    ctx.fillStyle = withAlpha("#ffffff", white);
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = withAlpha(C.cyan, 0.9);
  ctx.lineWidth = Math.max(1, s / 150);
  ctx.strokeRect(x, y, s, s);
};

const TILE_PX = 224;
const NVAR = 5;
const tileCache: HTMLCanvasElement[] = [];
const tileImg = (v: number) => {
  const hit = tileCache[v];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = TILE_PX;
  const g = c.getContext("2d")!;
  drawHeat(g, 0, 0, TILE_PX, v, 1, 0);
  tileCache[v] = c;
  return c;
};

/** Small-size version: only the strong cells and a bold frame, so a sea of them stays crisp. */
const MINI_PX = 56;
const miniCache: HTMLCanvasElement[] = [];
const miniImg = (v: number) => {
  const hit = miniCache[v];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = MINI_PX;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(4,12,26,0.96)";
  g.fillRect(0, 0, MINI_PX, MINI_PX);
  const cs = (MINI_PX - 6) / NQ;
  for (let q = 0; q < NQ; q++)
    for (let k = 0; k < NQ; k++) {
      const b = heatVal(v, q, k);
      if (b < 0.45) continue;
      g.fillStyle = mix(HEAD_COL[heatHead(v, q, k)], "#ffffff", clamp((b - 0.7) * 1.5));
      g.globalAlpha = clamp(0.4 + b);
      g.fillRect(3 + k * cs, 3 + q * cs, cs, cs);
    }
  g.globalAlpha = 1;
  g.strokeStyle = C.cyan;
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, MINI_PX - 3, MINI_PX - 3);
  miniCache[v] = c;
  return c;
};
const anyTile = (v: number, size: number) => (size < 50 ? miniImg(v) : tileImg(v));

const STAGES = [
  { c: 1, r: 1, s: 440, p: 0 },
  { c: 4, r: 2, s: 200, p: 226 },
  { c: 8, r: 8, s: 68, p: 77 },
  { c: 32, r: 16, s: 35, p: 40 },
];
const ST_T = [IGNITE, X8, X64, X512];
const stagePos = (n: number, c: number, r: number) => {
  const S = STAGES[n];
  return { x: 960 + (c - (S.c - 1) / 2) * S.p, y: MAP_CY + (r - (S.r - 1) / 2) * S.p };
};
const tileVar = (n: number, c: number, r: number): number => {
  if (n === 0) return 0;
  const P = STAGES[n - 1];
  const S = STAGES[n];
  const rc = S.c / P.c;
  const rr = S.r / P.r;
  if (c % rc === 0 && r % rr === 0) return tileVar(n - 1, Math.floor(c / rc), Math.floor(r / rr));
  return Math.floor(hash(n * 31.7 + c * 7.1 + r * 3.3) * NVAR);
};

const drawStageTiles = (ctx: CanvasRenderingContext2D, f: number, n: number) => {
  const S = STAGES[n];
  const P = STAGES[n - 1];
  const rc = S.c / P.c;
  const rr = S.r / P.r;
  const T0 = ST_T[n];
  const sync = f >= T0 + 9 ? Math.exp(-(f - T0 - 9) / 5) : 0;
  for (let pass = 0; pass < 2; pass++)
    for (let r = 0; r < S.r; r++)
      for (let c = 0; c < S.c; c++) {
        const isParent = c % rc === 0 && r % rr === 0;
        // copies first, the original on top while they split off
        if ((pass === 1) !== isParent) continue;
        const d = hash(c * 7.1 + r * 3.3 + n) * 1.5;
        const t = ease.outExpo(clamp((f - T0 - d) / 9));
        const a = stagePos(n - 1, Math.floor(c / rc), Math.floor(r / rr));
        const b = stagePos(n, c, r);
        const x = lerp(a.x, b.x, t);
        const y = lerp(a.y, b.y, t);
        const s = lerp(P.s, S.s, t);
        const flick = 0.86 + 0.14 * hash(c * 3.7 + r * 9.1 + Math.floor(f / 3));
        ctx.globalAlpha = flick;
        ctx.drawImage(anyTile(tileVar(n, c, r), s), x - s / 2, y - s / 2, s, s);
        const fl = (isParent ? 0 : 0.6 * (1 - t)) + 0.45 * sync;
        if (fl > 0.02) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = withAlpha(C.ice, Math.min(0.7, fl * 0.55));
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          ctx.globalCompositeOperation = "source-over";
        }
      }
  ctx.globalAlpha = 1;
  // halo
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 960, MAP_CY, 600 + 220 * n, C.cyan, 0.1 + 0.22 * sync, 0.04);
  ctx.globalCompositeOperation = "source-over";
};

const SEA_PIVOT = MAP_CY + 8 * 40 - 2.5; // bottom edge of the 32×16 block
const SEA_OUT0 = GENERATE - 14;
const SEA_OUT1 = GENERATE;
const SEA_COLS = [C.cyan, C.blue, C.ice, C.cyan];
const seaTheta = (f: number) => 1.15 * ease.inOutCubic(prog(f, TILT, TILT + 24)) + 0.1 * ease.inOutSine(prog(f, TILT + 24, SEA_OUT1));
const SEA_D = 1000;
const seaV = (r: number) => (r - 7.5) * 40 - 317.5; // plane coordinate relative to the pivot

const drawSea = (ctx: CanvasRenderingContext2D, f: number, alpha: number) => {
  if (alpha <= 0) return;
  const th = seaTheta(f);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const D = SEA_D;
  const t = f - TILT;
  const REXT = 64;
  const proj = (v: number) => {
    const Z = D - v * sn;
    const sc = D / Z;
    return { Z, sc, y: SEA_PIVOT + v * cs * sc };
  };
  ctx.globalCompositeOperation = "lighter";
  // horizon haze
  if (sn > 0.12) {
    const hy = SEA_PIVOT - (D * cs) / sn;
    const ha = alpha * clamp((sn - 0.12) / 0.5);
    const g = ctx.createLinearGradient(0, hy - 160, 0, hy + 260);
    g.addColorStop(0, withAlpha(C.cyan, 0));
    g.addColorStop(0.36, withAlpha(C.cyan, 0.18 * ha));
    g.addColorStop(0.48, withAlpha(C.ice, 0.42 * ha));
    g.addColorStop(0.7, withAlpha(C.blue, 0.16 * ha));
    g.addColorStop(1, withAlpha(C.blue, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy - 160, 1920, 420);
    // far-field floor: rows and converging columns beyond the tiles
    const ext = clamp((t - 8) / 14) * ha;
    if (ext > 0) {
      const far = proj(seaV(-REXT));
      ctx.lineWidth = 1;
      for (let k = 1; k < 40; k++) {
        const p = proj(seaV(-REXT - k * k * 1.6));
        ctx.strokeStyle = withAlpha(C.cyan, 0.22 * ext * (1 - k / 40));
        ctx.beginPath();
        ctx.moveTo(0, p.y);
        ctx.lineTo(1920, p.y);
        ctx.stroke();
      }
      ctx.strokeStyle = withAlpha(C.cyan, 0.16 * ext);
      ctx.beginPath();
      for (let c = -400; c <= 431; c += 8) {
        const x = 960 + (c - 15.5) * 40 * far.sc;
        if (x < -2000 || x > 3920) continue;
        ctx.moveTo(x, far.y);
        ctx.lineTo(960 + (x - 960) * 0.02, hy);
      }
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  const crests: number[] = [];
  for (let r = -REXT; r < 16; r++) {
    const v = seaV(r);
    const { Z, sc } = proj(v);
    const yb = proj(v + 17.5).y;
    const yt = proj(v - 17.5).y;
    const hgt = Math.max(0.8, yb - yt);
    const w = 35 * sc;
    const depthFade = clamp(1.2 - (Z - D) / 3600);
    const halfCols = Math.ceil(1000 / (40 * sc)) + 1;
    for (let c = Math.floor(15.5 - halfCols); c <= Math.ceil(15.5 + halfCols); c++) {
      const inGrid = r >= 0 && c >= 0 && c < 32;
      const dc = c < 0 ? -c : c > 31 ? c - 31 : 0;
      const dist = inGrid ? 0 : Math.max(-r, dc);
      const ea = inGrid ? 1 : clamp((t - 2 - dist * 0.3) / 7);
      if (ea <= 0) continue;
      const x = 960 + (c - 15.5) * 40 * sc;
      if (x + w < 0 || x - w > 1920) continue;
      const dd = Math.hypot(c - 15.5, (r - 7.5) * 1.4);
      const wave = 0.5 + 0.5 * Math.sin(dd * 0.32 - t * 0.42);
      const a = alpha * ea * depthFade * (inGrid ? 0.8 + 0.2 * wave : 0.3 + 0.7 * wave * wave);
      if (a <= 0.01) continue;
      const crest = clamp((wave - 0.78) / 0.22);
      if (crest > 0 && w >= 3) crests.push(x - w / 2, yt, w, hgt, crest * a);
      if (w >= 6) {
        ctx.globalAlpha = a;
        ctx.drawImage(miniImg(Math.floor(hash(c * 7.7 + r * 13.3) * NVAR)), x - w / 2, yt, w, hgt);
      } else {
        ctx.globalAlpha = a * 0.75;
        ctx.fillStyle = SEA_COLS[(((c * 7 + r * 3) % 4) + 4) % 4];
        ctx.fillRect(x - w * 0.42, yt, w * 0.84, Math.max(0.8, hgt * 0.84));
      }
    }
  }
  // computation ripples: bright crests rolling outward across the sea
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = C.ice;
  for (let i = 0; i < crests.length; i += 5) {
    ctx.globalAlpha = crests[i + 4] * 0.32;
    ctx.fillRect(crests[i], crests[i + 1], crests[i + 2], crests[i + 3]);
  }
  ctx.globalAlpha = 1;
  // glowing front edge
  const g = ctx.createLinearGradient(0, 0, 1920, 0);
  g.addColorStop(0, withAlpha(C.cyan, 0));
  g.addColorStop(0.5, withAlpha(C.ice, 0.7 * alpha));
  g.addColorStop(1, withAlpha(C.cyan, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, SEA_PIVOT + 2, 1920, 2);
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------
// generation
const QY = 400;
const QB = 74;
const QP = 88;
const qX = (i: number) => 960 + (i - (NQ - 1) / 2) * QP;
const AY = 610;
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

const qRowA = (f: number, i: number) => ease.outCubic(prog(f, SEA_OUT1 - 4 + i * 0.9, SEA_OUT1 + 12 + i * 0.9));

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
      const ry = Math.min(105, 18 + rx * 0.3);
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
      for (let i = 0; i < 10; i++) {
        const an = (i / 10) * TAU + hash(n * 9 + i) * 0.5;
        const d = 12 + t * (5 + 3 * hash(i + n * 2));
        glow(ctx, x0 + Math.cos(an) * d * 1.4, AY + Math.sin(an) * d * 0.8, 5, i % 2 ? C.ice : C.magenta, 1 - t / 18);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // question row (compact)
  for (let i = 0; i < NQ; i++) {
    const a = qRowA(f, i);
    drawToken(ctx, qX(i), QY - (1 - a) * 30, QB, QB, QTOK[i], 44, a, Math.min(1, qHi[i] * 0.9));
  }
  // answer tokens
  let last = -1;
  for (let n = 0; n < NA; n++) {
    const t = f - TOKEN[n];
    if (t < 0) break;
    last = n;
    const pop = ease.outBack(clamp(t / 9));
    const s = 1 + 0.3 * (1 - pop);
    const flash = Math.exp(-t / 5) * 0.9;
    const hi = Math.min(1, 0.25 + Math.exp(-t / 12) * 0.75 + aHi[n] * 0.8);
    drawToken(ctx, AX[n], AY, aW(n) * s, AH * s, ANS[n], AFONT * s, clamp(t / 3 + 0.2), hi, flash, n % 2 ? C.cyan : C.ice);
  }
  // cursor
  const ca = ease.outCubic(prog(f, GENERATE + 2, GENERATE + 10));
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
  ctx.globalAlpha = ta * 0.85;
  ctx.font = `800 20px ${FONT_MONO}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.ice;
  ctx.fillText("PROMPT", qX(0) - QB / 2 - 22, QY);
  ctx.fillStyle = C.magenta;
  ctx.fillText("AI", AX[0] - aW(0) / 2 - 22, AY);
  ctx.globalAlpha = 1;
};

// ---------------------------------------------------------------------------------------------
const Main: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.8);
      bg.addColorStop(0, "#071526");
      bg.addColorStop(1, "#01030a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      drawStack(ctx, f);
      // calm the background behind the foreground graphics
      const calm = 0.55 * (1 - 0.6 * ease.inOutCubic(prog(f, IGNITE, IGNITE + 20)) * (1 - prog(f, SEA_OUT0, SEA_OUT1)));
      const sc = ctx.createRadialGradient(960, 470, 0, 960, 470, 900);
      sc.addColorStop(0, `rgba(1,3,8,${calm})`);
      sc.addColorStop(0.6, `rgba(1,3,8,${calm * 0.6})`);
      sc.addColorStop(1, "rgba(1,3,8,0)");
      ctx.fillStyle = sc;
      ctx.fillRect(0, 0, w, h);

      // 1. attention row, flipping away at PARALLEL
      const flipOut = ease.inCubic(prog(f, PARALLEL, PARALLEL + 13));
      if (f >= ATTEND && flipOut < 1) {
        ctx.save();
        ctx.translate(0, MAP_CY);
        ctx.scale(1, Math.max(0.004, 1 - flipOut));
        ctx.translate(0, -MAP_CY);
        drawAttention(ctx, f);
        ctx.restore();
      }
      // flip streak
      const st = Math.exp(-Math.pow((f - PARALLEL - 13) / 5, 2));
      if (st > 0.01) {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, withAlpha(C.cyan, 0));
        g.addColorStop(0.5, withAlpha("#ffffff", 0.95 * st));
        g.addColorStop(1, withAlpha(C.cyan, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, MAP_CY - 2 - 5 * st, w, 4 + 10 * st);
        glow(ctx, 960, MAP_CY, 380, C.cyan, 0.5 * st, 0.05);
        ctx.globalCompositeOperation = "source-over";
      }

      // 2. heat-map tile → replication → sea
      const seaA = 1 - ease.inOutCubic(prog(f, SEA_OUT0, SEA_OUT1));
      if (f >= PARALLEL + 10 && f < X8) {
        const un = ease.outBack(prog(f, PARALLEL + 12, PARALLEL + 26));
        const ig = f >= IGNITE;
        const inten = ig ? 1 : 0.35;
        const white = ig ? 0.9 * Math.exp(-(f - IGNITE) / 5) : 0;
        const S = 440;
        ctx.save();
        ctx.translate(0, MAP_CY);
        ctx.scale(1, Math.max(0.004, un));
        ctx.translate(0, -MAP_CY);
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, 960, MAP_CY, 520, C.cyan, 0.25 + (ig ? 0.5 * Math.exp(-(f - IGNITE) / 10) : 0), 0.04);
        ctx.globalCompositeOperation = "source-over";
        drawHeat(ctx, 960 - S / 2, MAP_CY - S / 2, S, 0, inten, white);
        // axis labels
        const la = clamp(un) * (1 - prog(f, X8 - 6, X8));
        ctx.globalAlpha = la;
        ctx.font = `700 20px ${FONT_CN}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        const cs = S / NQ;
        for (let i = 0; i < NQ; i++) {
          ctx.fillText(QTOK[i], 960 - S / 2 + (i + 0.5) * cs, MAP_CY - S / 2 - 18);
          ctx.fillText(QTOK[i], 960 - S / 2 - 20, MAP_CY - S / 2 + (i + 0.5) * cs);
        }
        ctx.font = `800 16px ${FONT_MONO}`;
        ctx.fillStyle = C.cyan;
        ctx.fillText("KEY  →", 960, MAP_CY - S / 2 - 48);
        ctx.save();
        ctx.translate(960 - S / 2 - 50, MAP_CY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("←  QUERY", 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.restore();
        // ignition shockwave
        if (ig) {
          const tt = f - IGNITE;
          const ra = Math.exp(-tt / 6);
          const grow = 30 + tt * 30;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, 790); // keep the caption band clean
          ctx.clip();
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = withAlpha(C.ice, 0.8 * ra);
          ctx.lineWidth = 2 + 8 * ra;
          ctx.strokeRect(960 - S / 2 - grow, MAP_CY - S / 2 - grow, S + 2 * grow, S + 2 * grow);
          ctx.restore();
        }
      } else if (f >= X8 && f < TILT) {
        drawStageTiles(ctx, f, f >= X512 ? 3 : f >= X64 ? 2 : 1);
      } else if (f >= TILT && seaA > 0) {
        drawSea(ctx, f, seaA);
      }

      // 3. generation
      if (f >= SEA_OUT1 - 6) drawGenerate(ctx, f);
    }}
  />
);

// ---------------------------------------------------------------------------------------------
// HUD
const HeadLegend: React.FC = () => {
  const f = useCurrentFrame();
  const out = 1 - prog(f, PARALLEL - 6, PARALLEL + 6);
  return (
    <div style={{ position: "absolute", right: 96, top: 84, textAlign: "right", fontFamily: FONT_MONO }}>
      <div style={{ fontFamily: FONT_CN, fontSize: 24, fontWeight: 700, color: "rgba(255,255,255,0.85)", opacity: ease.outCubic(prog(f, HEAD_T[0] - 10, HEAD_T[0] + 6)) * out, textShadow: "0 2px 8px #000", marginBottom: 10 }}>
        多头注意力 <span style={{ fontFamily: FONT_MONO, fontSize: 16, letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)" }}>MULTI-HEAD</span>
      </div>
      {["HEAD A", "HEAD B", "HEAD C"].map((t, h) => {
        const a = ease.outCubic(prog(f, HEAD_T[h] - 4, HEAD_T[h] + 10)) * out;
        return (
          <div key={t} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 6, opacity: a, transform: `translateX(${(1 - a) * 20}px)` }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(255,255,255,0.75)" }}>{t}</span>
            <span style={{ width: 46, height: 4, borderRadius: 2, background: HEAD_COL[h], boxShadow: `0 0 10px ${HEAD_COL[h]}` }} />
          </div>
        );
      })}
    </div>
  );
};

const TopLabel: React.FC<{ from: number; to: number; text: string; sub: string; col: string }> = ({ from, to, text, sub, col }) => {
  const f = useCurrentFrame();
  const a = Math.min(ease.outCubic(prog(f, from, from + 14)), 1 - prog(f, to - 10, to));
  if (a <= 0) return null;
  const sp = 0.5 + 0.3 * (1 - ease.outExpo(prog(f, from, from + 30)));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 86, textAlign: "center", opacity: a }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 22, letterSpacing: `${sp}em`, color: col, textShadow: `0 0 14px ${col}, 0 2px 6px #000` }}>{text}</div>
      <div style={{ fontFamily: FONT_CN, fontWeight: 400, fontSize: 20, letterSpacing: "0.3em", color: "rgba(255,255,255,0.7)", marginTop: 6, textShadow: "0 2px 6px #000" }}>{sub}</div>
    </div>
  );
};

const BarLabel: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease.outCubic(prog(f, SW0 - 12, SW0 + 4)) * (1 - prog(f, PARALLEL - 2, PARALLEL + 6));
  if (a <= 0) return null;
  return (
    <div style={{ position: "absolute", right: 1920 - (tokX(0) - TB / 2 - 18), top: TOK_Y + 78, textAlign: "right", opacity: a, fontFamily: FONT_CN, fontSize: 20, color: "rgba(255,255,255,0.7)", textShadow: "0 2px 6px #000" }}>
      注意力
      <br />
      权重
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
  const num = landed ? "1" : fmt((1e8 * g) / 1e4);
  const unit = landed ? "亿" : "万";
  const lt = f - LAND;
  const pop = landed ? 1 + 0.4 * Math.exp(-lt / 6) : 1;
  const burst = landed ? Math.exp(-lt / 14) : 0;
  const col = landed ? C.magenta : C.cyan;
  // sparkline
  const CW = 380;
  const CH = 70;
  const pts: string[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * p;
    const gy = (Math.exp(K * u) - 1) / (Math.exp(K) - 1);
    pts.push(`${(u * CW).toFixed(1)},${(CH - gy * CH).toFixed(1)}`);
  }
  return (
    <div style={{ position: "absolute", right: 120, top: 76, width: CW + 20, textAlign: "right", opacity: a, transform: `translateY(${(1 - a) * -16}px)` }}>
      {burst > 0.01 ? (
        <div
          style={{
            position: "absolute",
            right: -130,
            top: -45,
            width: 460,
            height: 260,
            opacity: burst,
            background: `radial-gradient(closest-side, ${C.magenta}bb 0%, ${C.magenta}40 45%, transparent 100%)`,
            mixBlendMode: "screen",
            transform: `scale(${0.7 + 0.5 * (1 - burst)})`,
          }}
        />
      ) : null}
      <div style={{ fontFamily: FONT_CN, fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.85)", textShadow: "0 2px 6px #000" }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.ice }}>ChatGPT</span> 用户
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 86,
          lineHeight: 1.08,
          color: "#fff",
          textShadow: `0 0 ${18 + 20 * (pop - 1) * 3}px ${col}, 0 2px 8px #000`,
          transform: `scale(${pop})`,
          transformOrigin: "right center",
        }}
      >
        {num}
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 68, color: landed ? "#ff8ce0" : "#fff", marginLeft: 4 }}>{unit}</span>
      </div>
      <svg width={CW + 20} height={CH + 40} style={{ display: "block", marginTop: 16, overflow: "visible" }}>
        <line x1={10} y1={CH + 2} x2={CW + 10} y2={CH + 2} stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
        <polyline points={pts.map((s) => s.split(",").map((v, i) => (i ? Number(v) + 2 : Number(v) + 10)).join(",")).join(" ")} fill="none" stroke={col} strokeWidth={3} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
        <circle cx={10 + p * CW} cy={2 + CH - g * CH} r={6} fill="#fff" style={{ filter: `drop-shadow(0 0 8px ${col})` }} />
        <text x={10} y={CH + 30} fill="rgba(255,255,255,0.55)" fontFamily={FONT_CN} fontSize={20} textAnchor="start">
          上线
        </text>
        <text x={CW + 10} y={CH + 30} fill={landed ? C.magenta : "rgba(255,255,255,0.75)"} fontFamily={FONT_CN} fontWeight={700} fontSize={22} textAnchor="end">
          两个月
        </text>
      </svg>
    </div>
  );
};

export const TransformerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = sumShake(
    shake(frame, IGNITE, 10, 16),
    shake(frame, X8 + 9, 4, 10),
    shake(frame, X64 + 9, 5, 10),
    shake(frame, X512 + 9, 6, 12),
    shake(frame, LAND, 7, 14),
  );
  const fade = Math.min(ease.outCubic(prog(frame, 0, 14)), 1 - prog(frame, DUR - 18, DUR));
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fade }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}rad)` }}>
        <Main />
        <HeadLegend />
        <BarLabel />
        <TopLabel from={ATTEND + 20} to={PARALLEL} text="SELF-ATTENTION" sub="自注意力" col={C.cyan} />
        <TopLabel from={IGNITE + 6} to={X64 + 2} text="ALL TOKENS · AT ONCE" sub="所有词，同时计算" col={C.ice} />
        <UserCounter />
      </AbsoluteFill>
      <YearStamp year="2017" label="Attention Is All You Need" from={ATTEND} to={345} color={C.cyan} />
      <YearStamp year="2022" label="ChatGPT 问世" from={GENERATE + 14} color={C.magenta} />
      <Flash at={IGNITE} dur={10} color={C.cyan} peak={0.3} />
      <Flash at={LAND} dur={10} color={C.magenta} peak={0.12} />
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
