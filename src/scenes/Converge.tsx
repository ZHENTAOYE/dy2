import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fadeInOut, hash, lerp, noise1, prog, rng, shake, sumShake, TAU } from "../lib/math";
import { camera, project, type Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("converge");
const STREAMS = cue("converge", "streams");
const MEET = cue("converge", "meet");
const IMPACT = cue("converge", "impact");
const PULSES = ticks("converge", "pulse");
const WAVES = ticks("converge", "wave");

const CAPS = [
  { from: 80, to: 205, text: "算力、数据、算法——{{三条曲线}}终于在同一时刻交汇。" },
  { from: 230, to: 400, text: "一场真正的爆发开始了。" },
];

type P3 = [number, number, number];
type Pt = { x: number; y: number };

const capAt = (f: number) => Math.max(...CAPS.map((c) => fadeInOut(f, c.from, c.to, 10, 10)));

// ---------------------------------------------------------------------------------------------
// camera: orbits the convergence point O = (0,0,0); pushes in before the impact, is blown back by it

const CX = 960;
const CY = 415;
const FOCAL = 1300;

const orbitCam = (az: number, el: number, dist: number, cy = CY): Cam =>
  camera({
    x: dist * Math.sin(az) * Math.cos(el),
    y: -dist * Math.sin(el),
    z: -dist * Math.cos(az) * Math.cos(el),
    yaw: -az,
    pitch: el,
    f: FOCAL,
    cx: CX,
    cy,
  });

const inhaleAt = (f: number) => (f < IMPACT ? ease.inCubic(prog(f, IMPACT - 14, IMPACT)) : 0);

const camAt = (f: number) => {
  const post = ease.inOutSine(prog(f, IMPACT, DUR));
  const lift = ease.inOutSine(prog(f, IMPACT + 10, IMPACT + 130));
  const az = -0.14 + 0.001 * f + 0.7 * post;
  const el = 0.74 - 0.26 * post;
  const push = ease.inOutCubic(prog(f, 0, IMPACT - 10));
  const inh = ease.inCubic(prog(f, IMPACT - 14, IMPACT));
  const kick = ease.outExpo(prog(f, IMPACT, IMPACT + 50));
  const drift = ease.inOutSine(prog(f, IMPACT + 50, DUR));
  const dist = lerp(41, 32.5, push) - 2 * inh + 17 * kick + 3 * drift;
  return orbitCam(az, el, dist, CY + 65 * lift);
};

const P = (cam: Cam, p: P3) => project(cam, p[0], p[1], p[2]);
const frac = (v: number) => v - Math.floor(v);

// ---------------------------------------------------------------------------------------------
// the three streams: exponential curves (flat at the source, steep at the end) swirling into O

const R_SRC = 15;
const DISK_Y = 0.6;
const SWIRL = 0.95;
const STREAM_W = 0.9;
const expo = (s: number, k = 2.6) => (Math.exp(k * s) - 1) / (Math.exp(k) - 1);

const ARMS = [
  { name: "算力", en: "COMPUTE", col: C.cyan, phi: (5 * Math.PI) / 3, kinds: ["chip"], lx: -195, ly: -34 },
  { name: "数据", en: "DATA", col: C.magenta, phi: Math.PI / 3, kinds: ["photo", "token"], lx: 192, ly: -46 },
  { name: "算法", en: "ALGORITHMS", col: C.gold, phi: Math.PI, kinds: ["graph"], lx: 190, ly: -40 },
];

const armPos = (k: number, s: number, o1 = 0, o2 = 0): P3 => {
  const e = expo(s);
  const r = R_SRC * (1 - e);
  const th = ARMS[k].phi + SWIRL * s;
  const sp = STREAM_W * Math.pow(1 - s, 0.85);
  const rr = r + o1 * sp;
  return [rr * Math.sin(th), DISK_Y * (1 - e) + o2 * sp * 0.55, -rr * Math.cos(th)];
};

/** Head of each stream along its curve: 0 at the source, 1 at O (all three arrive together at MEET). */
const frontAt = (f: number) => {
  const u = prog(f, STREAMS, MEET);
  return 0.3 * u + 0.7 * expo(u, 2.4);
};
/** Integrated flow (cycles) — accelerating. */
const flowAt = (f: number) => {
  const t = Math.max(0, f - STREAMS) / 30;
  return 0.22 * t + 0.075 * t * t;
};
const chargeAt = (f: number) => ease.inQuad(prog(f, MEET - 20, IMPACT));
const pulseAt = (f: number) => {
  let v = 0;
  for (const p of PULSES) {
    const t = f - p;
    if (t >= 0 && t < 24) v = Math.max(v, Math.exp(-t / 5));
  }
  return v;
};

const N_PART = 1500;
type Part = { a: number; sp: number; o1: number; o2: number; sz: number; br: number; b: number };
const PARTS: Part[][] = ARMS.map((_, k) => {
  const r = rng(101 + k * 17);
  return Array.from({ length: N_PART }, () => {
    const g1 = (r() + r() + r() - 1.5) / 1.5;
    const g2 = (r() + r() + r() - 1.5) / 1.5;
    return { a: r(), sp: 0.75 + r() * 0.5, o1: g1, o2: g2, sz: r(), br: 0.4 + 0.6 * r(), b: Math.floor(r() * 3) };
  });
});

const N_SPR = 26;
const SPRS = ARMS.map((_, k) => {
  const r = rng(303 + k * 11);
  return Array.from({ length: N_SPR }, (_, i) => ({
    a: (i + 0.5 * r()) / N_SPR,
    sp: 0.9 + 0.2 * r(),
    o1: (r() - 0.5) * 1.5,
    o2: (r() - 0.5) * 1.0,
    kind: i % ARMS[k].kinds.length,
    rot: (r() - 0.5) * 0.5,
  }));
});

const N_ACC = 1400;
const ACC = (() => {
  const r = rng(909);
  return Array.from({ length: N_ACC }, (_, i) => ({ r: 0.35 + 3.0 * Math.pow(r(), 1.5), a: r() * TAU, y: (r() - 0.5) * 0.35, col: i % 3, br: r() }));
})();

// ---------------------------------------------------------------------------------------------
// sprites riding the streams (no digits, no text)

const sprites: Record<string, HTMLCanvasElement> = {};
const sprite = (kind: string, col: string) => {
  const id = kind + col;
  const hit = sprites[id];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";
  const lite = mix(col, "#ffffff", 0.45);
  g.strokeStyle = lite;
  if (kind === "chip") {
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const p = 21 + i * 7.3;
      g.moveTo(p, 5);
      g.lineTo(p, 14);
      g.moveTo(p, 50);
      g.lineTo(p, 59);
      g.moveTo(5, p);
      g.lineTo(14, p);
      g.moveTo(50, p);
      g.lineTo(59, p);
    }
    g.stroke();
    g.fillStyle = withAlpha(col, 0.35);
    g.fillRect(14, 14, 36, 36);
    g.lineWidth = 2.5;
    g.strokeRect(14, 14, 36, 36);
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(25, 25, 14, 14);
  } else if (kind === "photo") {
    g.fillStyle = withAlpha(col, 0.3);
    g.beginPath();
    g.roundRect(7, 13, 50, 38, 5);
    g.fill();
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(21, 24, 4.5, 0, TAU);
    g.fill();
    g.fillStyle = withAlpha(lite, 0.95);
    g.beginPath();
    g.moveTo(10, 48);
    g.lineTo(25, 31);
    g.lineTo(33, 40);
    g.lineTo(42, 29);
    g.lineTo(54, 48);
    g.closePath();
    g.fill();
  } else if (kind === "token") {
    g.fillStyle = withAlpha(col, 0.3);
    g.beginPath();
    g.roundRect(5, 20, 54, 24, 12);
    g.fill();
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(14, 29, 10, 6);
    g.fillRect(28, 29, 14, 6);
    g.fillRect(46, 29, 5, 6);
  } else {
    const N: [number, number][] = [
      [12, 32],
      [30, 13],
      [30, 51],
      [52, 22],
      [52, 44],
    ];
    g.lineWidth = 2.5;
    g.beginPath();
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]) {
      g.moveTo(N[a][0], N[a][1]);
      g.lineTo(N[b][0], N[b][1]);
    }
    g.stroke();
    for (const [x, y] of N) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(x, y, 5, 0, TAU);
      g.fill();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.stroke();
    }
  }
  sprites[id] = c;
  return c;
};

// ---------------------------------------------------------------------------------------------
// the network that bursts out of the impact: nested shells of nodes; each shell is meshed to its
// neighbours (a glowing geodesic web) and wired to the shell inside it (the layers)

const NET_SHELLS = [12, 40, 90, 170, 280, 420, 600, 800];
const NET_R = NET_SHELLS.map((_, k) => 1.1 * Math.pow(1.4, k));
const HEAT = [0.5, 0.3, 0.12, 0];
const PAL = ARMS.map((a) => HEAT.map((hw) => mix(a.col, "#ffffff", hw)));

type NNode = { k: number; d: P3; rj: number; hue: number; lvl: number; h: number };
type Edge = { a: number; b: number; k: number; mesh: boolean };
const NODES: NNode[] = [];
const EDGES: Edge[] = []; // radial: a = inner node (-1: centre), b = outer node; mesh: both on shell k
(() => {
  const r = rng(777);
  const starts: number[] = [];
  NET_SHELLS.forEach((n, k) => {
    starts.push(NODES.length);
    const rot = r() * TAU;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * 2.399963 + rot;
      const j = 0.35 / Math.sqrt(n);
      let d: P3 = [Math.cos(th) * rad + (r() - 0.5) * j, y + (r() - 0.5) * j, Math.sin(th) * rad + (r() - 0.5) * j];
      const len = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / len, d[1] / len, d[2] / len];
      let best = 0;
      let bv = -9;
      ARMS.forEach((a, q) => {
        const v = d[0] * Math.sin(a.phi) - d[2] * Math.cos(a.phi) + (r() - 0.5) * 0.6;
        if (v > bv) {
          bv = v;
          best = q;
        }
      });
      const lvl = Math.min(3, Math.max(0, Math.floor(k / 2)));
      NODES.push({ k, d, rj: 0.94 + 0.12 * r(), hue: best, lvl, h: r() });
    }
  });
  starts.push(NODES.length);
  const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let k = 0; k < NET_SHELLS.length; k++) {
    const seen = new Set<number>();
    for (let i = starts[k]; i < starts[k + 1]; i++) {
      const d = NODES[i].d;
      // radial wiring to the shell inside
      if (k === 0) EDGES.push({ a: -1, b: i, k, mesh: false });
      else {
        let b1 = -1;
        let b2 = -1;
        let v1 = -9;
        let v2 = -9;
        for (let j = starts[k - 1]; j < starts[k]; j++) {
          const v = dot(d, NODES[j].d);
          if (v > v1) {
            v2 = v1;
            b2 = b1;
            v1 = v;
            b1 = j;
          } else if (v > v2) {
            v2 = v;
            b2 = j;
          }
        }
        EDGES.push({ a: b1, b: i, k, mesh: false });
        if (b2 >= 0 && r() < 0.55) EDGES.push({ a: b2, b: i, k, mesh: false });
      }
      // mesh to the 2 nearest neighbours on the same shell
      if (k < 1) continue;
      const near: [number, number][] = [];
      for (let j = starts[k]; j < starts[k + 1]; j++) {
        if (j === i) continue;
        const v = dot(d, NODES[j].d);
        if (near.length < 2) {
          near.push([v, j]);
          near.sort((a, b) => b[0] - a[0]);
        } else if (v > near[1][0]) {
          near[1] = [v, j];
          near.sort((a, b) => b[0] - a[0]);
        }
      }
      for (const [, j] of near) {
        const key = Math.min(i, j) * 100000 + Math.max(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        EDGES.push({ a: i, b: j, k, mesh: true });
      }
    }
  }
})();

const shellScale = (k: number, t: number) => {
  const tt = t - 1.0 * k;
  if (tt <= 0) return 0;
  return 1 - Math.exp(-tt / (4 + 2 * k));
};
const SIG_D = 5; // frames for a signal to cross one layer

// ---------------------------------------------------------------------------------------------
// blast: sparks + shockwave rings

const N_SPARK = 2800;
const SPARKS = (() => {
  const r = rng(4242);
  return Array.from({ length: N_SPARK }, (_, i) => {
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    let d: P3 = [Math.cos(th) * rad, u, Math.sin(th) * rad];
    if (i % 20 < 11) {
      d = [d[0], d[1] * 0.18, d[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / l, d[1] / l, d[2] / l];
    }
    const v = 0.25 + 1.5 * Math.pow(r(), 2);
    return { d, v, drag: 0.035 + 0.05 * r(), life: 16 + 75 * r(), col: i % 10 === 0 ? 3 : i % 3, sz: r() };
  });
})();
const SPARK_COLS = [C.cyan, C.magenta, C.gold, "#ffffff"];
const sparkAt = (s: (typeof SPARKS)[number], t: number): P3 => {
  const d = (s.v / s.drag) * (1 - Math.exp(-s.drag * Math.max(0, t)));
  return [s.d[0] * d, s.d[1] * d, s.d[2] * d];
};

const RINGS = [
  { rx: 0, rz: 0, v: 36, tau: 20, delay: 0, col: "#ffffff" },
  { rx: 0, rz: 0, v: 25, tau: 28, delay: 4, col: C.gold },
  { rx: 0, rz: 0, v: 16, tau: 34, delay: 9, col: C.cyan },
  { rx: 0.75, rz: 0, v: 27, tau: 24, delay: 2, col: C.magenta },
  { rx: -0.6, rz: 0.9, v: 22, tau: 28, delay: 5, col: C.cyan },
  { rx: 0.35, rz: -1.1, v: 19, tau: 32, delay: 11, col: C.gold },
  { rx: 1.45, rz: 0.3, v: 30, tau: 22, delay: 7, col: "#ffffff" },
];

// background stars on a far sphere
const STARS = (() => {
  const r = rng(55);
  return Array.from({ length: 1100 }, () => {
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    return { p: [Math.cos(th) * rad * 260, u * 260, Math.sin(th) * rad * 260] as P3, sz: Math.pow(r(), 3), tw: r() * 50 };
  });
})();

// ---------------------------------------------------------------------------------------------
// drawing helpers

type Seg = number[];
const strokeSegs = (ctx: CanvasRenderingContext2D, segs: Seg, color: string, width: number, alpha: number) => {
  if (!segs.length || alpha <= 0.003) return;
  ctx.strokeStyle = withAlpha(color, Math.min(1, alpha));
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
};

const polyline = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
};

const glowLine = (ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number) => {
  if (pts.length < 2 || alpha <= 0.003) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(color, 0.1 * alpha);
  ctx.lineWidth = width * 7;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, 0.3 * alpha);
  ctx.lineWidth = width * 2.6;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(mix(color, "#ffffff", 0.6), Math.min(1, alpha));
  ctx.lineWidth = width;
  polyline(ctx, pts);
  ctx.stroke();
};

// ---------------------------------------------------------------------------------------------
// scene layers

const drawBackground = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number, cam: Cam, O: Pt) => {
  const c = chargeAt(f);
  const t = f - IMPACT;
  const after = t >= 0 ? Math.exp(-t / 60) : 0;
  const bg = ctx.createRadialGradient(O.x, O.y, 0, O.x, O.y, w * 0.85);
  bg.addColorStop(0, mix("#0a0e1e", "#1d1424", Math.max(0.6 * c, after)));
  bg.addColorStop(0.5, "#04060f");
  bg.addColorStop(1, "#010207");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  // nebulae far behind each source
  ARMS.forEach((a) => {
    const s = P(cam, [Math.sin(a.phi) * 120, 30, -Math.cos(a.phi) * 120]);
    if (s) glow(ctx, s.x, s.y, 760, a.col, 0.07 + 0.05 * c + 0.1 * after, 0.02);
  });
  // stars (radially smeared by the blast)
  const warp = t >= 0 ? 0.5 * Math.exp(-t / 9) : 0;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(220,235,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const st of STARS) {
    const p = P(cam, st.p);
    if (!p || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
    const tw = 0.35 + 0.65 * noise1(f * 0.05 + st.tw);
    if (warp > 0.01) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (p.x - O.x) * warp, p.y + (p.y - O.y) * warp);
    } else {
      ctx.globalAlpha = 0.25 + 0.6 * st.sz * tw;
      const r = 0.8 + 1.8 * st.sz;
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
  }
  ctx.globalAlpha = 1;
  if (warp > 0.01) ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
};

/** Polar grid on the stream disk; the blast sends a ripple through it. */
const drawGrid = (ctx: CanvasRenderingContext2D, f: number, cam: Cam, alpha: number) => {
  if (alpha <= 0) return;
  const t = f - IMPACT;
  const rs = t >= 0 ? 36 * (1 - Math.exp(-t / 24)) : -99;
  const amp = t >= 0 ? 2.4 * Math.exp(-t / 45) : 0;
  const yAt = (r: number) => DISK_Y - amp * Math.exp(-Math.pow((r - rs) / 1.8, 2));
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 1.3;
  for (let ri = 1; ri <= 9; ri++) {
    const r = ri * 3;
    const near = t >= 0 ? Math.exp(-Math.pow((r - rs) / 2.5, 2)) * Math.exp(-t / 60) : 0;
    ctx.strokeStyle = withAlpha(mix("#5a7cff", "#ffffff", near), (0.13 + 0.45 * near) * alpha * clamp(1.4 - r / 30));
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      const p = project(cam, Math.sin(a) * r, yAt(r), -Math.cos(a) * r, 0.5);
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = withAlpha("#5a7cff", 0.08 * alpha);
  ctx.beginPath();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU;
    let pen = false;
    for (let r = 1.5; r <= 27; r += 1.5) {
      const p = project(cam, Math.sin(a) * r, yAt(r), -Math.cos(a) * r, 0.5);
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
};

const drawStreams = (ctx: CanvasRenderingContext2D, f: number, cam: Cam) => {
  const F = frontAt(f);
  const out = 1 - prog(f, IMPACT, IMPACT + 4);
  if (out <= 0) return;
  const flow = flowAt(f);
  const c = chargeAt(f);
  ctx.globalCompositeOperation = "lighter";
  // emitters (portals) at the sources
  ARMS.forEach((a, k) => {
    const ign = ease.outCubic(prog(f, 22 + k * 7, 56 + k * 7)) * out;
    if (ign <= 0) return;
    const sp = armPos(k, 0);
    const S = P(cam, sp);
    if (!S) return;
    const k2 = S.s / 45;
    const flick = 0.85 + 0.15 * noise1(f * 0.3 + k * 9);
    glow(ctx, S.x, S.y, 150 * k2 * ign, a.col, 0.35 * ign * flick, 0.05);
    glow(ctx, S.x, S.y, 34 * k2, "#ffffff", 0.9 * ign);
    // light pillar
    const top = P(cam, [sp[0], sp[1] - 6, sp[2]]);
    if (top) {
      const g = ctx.createLinearGradient(S.x, S.y, top.x, top.y);
      g.addColorStop(0, withAlpha(a.col, 0.5 * ign));
      g.addColorStop(1, withAlpha(a.col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 10 * k2;
      ctx.beginPath();
      ctx.moveTo(S.x, S.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.lineWidth = 2.5 * k2;
      ctx.stroke();
    }
    // two rings lying on the disk
    for (const [rr, spd] of [
      [1.3, 0.05],
      [2.1, -0.03],
    ]) {
      const pts: Pt[] = [];
      for (let i = 0; i <= 60; i++) {
        const an = (i / 60) * TAU;
        const q = P(cam, [sp[0] + Math.cos(an) * rr, sp[1], sp[2] + Math.sin(an) * rr]);
        if (q) pts.push(q);
      }
      ctx.setLineDash([14 * k2, 10 * k2]);
      ctx.lineDashOffset = f * spd * 60;
      ctx.strokeStyle = withAlpha(a.col, 0.6 * ign);
      ctx.lineWidth = 2 * k2;
      polyline(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  if (F <= 0) {
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  const nAct = Math.floor(N_PART * (0.35 + 0.65 * prog(f, STREAMS, IMPACT)));
  const tl = 0.012 + 0.03 * c;
  ARMS.forEach((a, k) => {
    // volume haze along the stream
    for (let j = 0; j < 40; j++) {
      const s = (F * (j + 0.5)) / 40;
      const q = P(cam, armPos(k, s));
      if (!q) continue;
      glow(ctx, q.x, q.y, 1.5 * STREAM_W * Math.pow(1 - s, 0.85) * q.s + 18, a.col, 0.07 * out, 0.02);
    }
    // the curve itself
    const pts: Pt[] = [];
    for (let s = 0; s <= F + 1e-6; s += 0.01) {
      const q = P(cam, armPos(k, Math.min(s, F)));
      if (q) pts.push(q);
    }
    const hq = P(cam, armPos(k, F));
    if (hq) pts.push(hq);
    glowLine(ctx, pts, a.col, 2.2 + 1.5 * c, (0.55 + 0.45 * c) * out);
    // particles
    const buckets: Seg[] = [[], [], []];
    const L = PARTS[k];
    for (let i = 0; i < nAct; i++) {
      const p = L[i];
      const u = frac(p.a + flow * p.sp);
      const s = F * u;
      if (s < 0.004 || s > 0.995) continue;
      const A = P(cam, armPos(k, s, p.o1, p.o2));
      const B = P(cam, armPos(k, Math.max(0, s - tl * p.sp), p.o1 * 1.02, p.o2 * 1.02));
      if (!A || !B) continue;
      buckets[p.b].push(B.x, B.y, A.x, A.y);
      if (i % 3 === 0) {
        const edge = clamp(s / 0.04) * clamp((1 - s) / 0.05);
        glow(ctx, A.x, A.y, (2 + 5 * p.sz) * (A.s / 45), i % 9 === 0 ? "#ffffff" : a.col, 0.55 * p.br * edge * out);
      }
    }
    strokeSegs(ctx, buckets[0], a.col, 1.2, 0.22 * out);
    strokeSegs(ctx, buckets[1], a.col, 1.8, 0.38 * out);
    strokeSegs(ctx, buckets[2], mix(a.col, "#ffffff", 0.4), 2.4, 0.6 * out);
    // glyph sprites
    for (const sp of SPRS[k]) {
      const u = frac(sp.a + flow * 0.45 * sp.sp);
      const s = F * u;
      const q = P(cam, armPos(k, s, sp.o1, sp.o2));
      if (!q) continue;
      const fade = clamp((s - 0.02) / 0.05) * clamp((0.72 - s) / 0.15) * out;
      if (fade <= 0.01) continue;
      const size = clamp(0.8 * q.s, 16, 50);
      ctx.save();
      ctx.globalAlpha = 0.95 * fade;
      ctx.translate(q.x, q.y);
      ctx.rotate(sp.rot);
      glow(ctx, 0, 0, size * 0.9, a.col, 0.35);
      ctx.drawImage(sprite(a.kinds[sp.kind], a.col), -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // packets: bright comets racing along the curve
    const pf = flowAt(f) * 1.6;
    for (let j = 0; j < 5; j++) {
      const u = frac(j / 5 + pf + k * 0.13);
      const s = F * u;
      const seg: Pt[] = [];
      for (let q = 0; q <= 8; q++) {
        const pp = P(cam, armPos(k, Math.max(0, s - 0.07 * (1 - q / 8))));
        if (pp) seg.push(pp);
      }
      const fade = clamp(s / 0.06) * clamp((1 - s) / 0.04);
      glowLine(ctx, seg, a.col, 3, 0.8 * fade * out);
      const hd = seg[seg.length - 1];
      if (hd) glow(ctx, hd.x, hd.y, 22, "#ffffff", 0.7 * fade * out);
    }
    // head of the stream (comet)
    if (F < 1 && hq) {
      const tail: Pt[] = [];
      for (let q = 0; q <= 14; q++) {
        const pp = P(cam, armPos(k, Math.max(0, F - 0.16 * (1 - q / 14))));
        if (pp) tail.push(pp);
      }
      glowLine(ctx, tail, a.col, 6, 0.9);
      glow(ctx, hq.x, hq.y, 120 * (hq.s / 45), a.col, 0.75);
      glow(ctx, hq.x, hq.y, 36 * (hq.s / 45), "#ffffff", 1);
    }
  });
  ctx.globalCompositeOperation = "source-over";
};

/** The gathering core between MEET and IMPACT. */
const drawCore = (ctx: CanvasRenderingContext2D, w: number, f: number, cam: Cam, O: Pt) => {
  if (f >= IMPACT) return;
  const pre = ease.inQuad(prog(f, STREAMS, MEET));
  const c = chargeAt(f);
  const inh = inhaleAt(f);
  const pu = pulseAt(f);
  const mt = f - MEET;
  const meet = mt >= 0 ? Math.exp(-mt / 9) : 0;
  ctx.globalCompositeOperation = "lighter";
  // accretion vortex
  if (c > 0) {
    const n = Math.floor(N_ACC * clamp(c * 1.3));
    const ph = Math.max(0, f - MEET + 10);
    const phase = ph + (1.4 * ph * ph) / (IMPACT - MEET);
    const shrink = 1 - 0.85 * inh;
    const segs: Seg[] = [[], [], []];
    for (let i = 0; i < n; i++) {
      const p = ACC[i];
      const r = p.r * shrink * (0.9 + 0.1 * c);
      const an = p.a + (phase * 0.045) / Math.pow(p.r, 0.8);
      const an0 = an - 0.12 / Math.pow(p.r, 0.6);
      const A = P(cam, [Math.cos(an) * r, p.y * r, Math.sin(an) * r]);
      const B = P(cam, [Math.cos(an0) * r, p.y * r, Math.sin(an0) * r]);
      if (!A || !B) continue;
      segs[p.col].push(B.x, B.y, A.x, A.y);
      if (i % 4 === 0) glow(ctx, A.x, A.y, 3 + 4 * p.br, i % 8 === 0 ? "#ffffff" : ARMS[p.col].col, 0.6 * c);
    }
    segs.forEach((sg, j) => strokeSegs(ctx, sg, mix(ARMS[j].col, "#ffffff", 0.3), 1.6, 0.45 * c));
  }
  // inward light streaks
  if (c > 0.02) {
    const sg: Seg = [];
    const n = Math.floor(40 + 160 * c);
    const spd = 0.012 + 0.05 * c + 0.08 * inh;
    for (let i = 0; i < n; i++) {
      const an = hash(i * 3.7) * TAU;
      const u = frac(hash(i * 1.3) + (f - MEET) * spd * (0.6 + 0.8 * hash(i * 5.1)));
      const rad = 60 + 700 * Math.pow(1 - u, 1.6);
      const len = 30 + 120 * c * (1 - u);
      sg.push(O.x + Math.cos(an) * rad, O.y + Math.sin(an) * rad, O.x + Math.cos(an) * (rad + len), O.y + Math.sin(an) * (rad + len));
    }
    strokeSegs(ctx, sg, "#dfe8ff", 1.5, 0.35 * c);
  }
  // the moment the three heads meet: a small ring flies out
  if (mt >= 0 && mt < 30) {
    const r = 30 + 26 * mt * Math.exp(-mt / 25);
    const a = Math.exp(-mt / 9);
    ([
      [C.cyan, 0.97],
      ["#ffffff", 1],
      [C.magenta, 1.03],
    ] as const).forEach(([col, k]) => {
      ctx.strokeStyle = withAlpha(col, 0.7 * a);
      ctx.lineWidth = 2 + 5 * a;
      ctx.beginPath();
      ctx.ellipse(O.x, O.y, r * k, r * k * 0.72, 0, 0, TAU);
      ctx.stroke();
    });
  }
  // inward-collapsing rings on each heartbeat pulse
  for (const p of PULSES) {
    const t = f - p;
    if (t < 0 || t > 14) continue;
    const r = 420 * Math.pow(1 - t / 14, 1.5) + 10;
    const a = Math.sin((t / 14) * Math.PI);
    ctx.strokeStyle = withAlpha("#ffffff", 0.5 * a);
    ctx.lineWidth = 2 + 4 * a;
    ctx.beginPath();
    ctx.ellipse(O.x, O.y, r, r * 0.8, 0, 0, TAU);
    ctx.stroke();
  }
  // the core
  const coreR = (40 + 120 * pre + 240 * c + 110 * pu + 160 * meet) * (1 - 0.7 * inh);
  glow(ctx, O.x, O.y, coreR * 2.2, mix(C.gold, C.magenta, 0.3), 0.22 + 0.28 * c, 0.03);
  glow(ctx, O.x, O.y, coreR, "#ffffff", 0.35 + 0.45 * c + 0.3 * meet, 0.08);
  glow(ctx, O.x, O.y, 18 + 30 * c + 40 * inh, "#ffffff", 1);
  // lens ring with chromatic edges
  const ringA = 0.08 + 0.35 * c + 0.3 * meet;
  const rr = (130 + 90 * c + 30 * pu) * (1 - 0.55 * inh);
  ([
    [C.cyan, 0.97],
    ["#ffffff", 1],
    [C.magenta, 1.03],
  ] as const).forEach(([col, k]) => {
    ctx.strokeStyle = withAlpha(col, ringA * 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(O.x, O.y, rr * k, 0, TAU);
    ctx.stroke();
  });
  // star spikes + anamorphic streak
  const sk = 0.15 + 0.6 * c + 0.4 * meet + 0.6 * inh;
  ctx.save();
  ctx.translate(O.x, O.y);
  ctx.rotate(f * 0.004);
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * TAU;
    const len = (220 + 600 * c) * (1 + inh);
    const g = ctx.createLinearGradient(0, 0, Math.cos(an) * len, Math.sin(an) * len);
    g.addColorStop(0, withAlpha("#ffffff", 0.5 * sk));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 2 + 2 * c;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(an) * len, Math.sin(an) * len);
    ctx.stroke();
  }
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(120,200,255,0)");
  g.addColorStop(0.5, withAlpha("#ffffff", 0.55 * sk));
  g.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = g;
  const sw = 2 + 6 * c + 6 * inh;
  ctx.fillRect(0, O.y - sw / 2, w, sw);
  ctx.globalCompositeOperation = "source-over";
};

const ringPoint = (rx: number, rz: number, a: number, r: number): P3 => {
  // circle in the XZ plane, tilted about X then about Z
  const x = Math.cos(a) * r;
  let y = 0;
  let z = Math.sin(a) * r;
  const y1 = y * Math.cos(rx) - z * Math.sin(rx);
  const z1 = y * Math.sin(rx) + z * Math.cos(rx);
  y = y1;
  z = z1;
  const x2 = x * Math.cos(rz) - y * Math.sin(rz);
  const y2 = x * Math.sin(rz) + y * Math.cos(rz);
  return [x2, y2, z];
};

const drawBlast = (ctx: CanvasRenderingContext2D, w: number, f: number, cam: Cam, O: Pt & { s: number }) => {
  const t = f - IMPACT;
  if (t < 0) return;
  ctx.globalCompositeOperation = "lighter";
  // god rays
  ctx.save();
  ctx.translate(O.x, O.y);
  ctx.rotate(t * 0.0025);
  const rayA = 0.15 * Math.exp(-t / 30) + 0.035;
  const shoot = ease.outCubic(clamp((t + 1) / 12));
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU + hash(i) * 0.08;
    const len = 1600 * shoot * (0.7 + 0.3 * hash(i * 2.7));
    const wid = 0.006 + hash(i * 9) * 0.022;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    const col = i % 3 === 0 ? C.cyan : i % 3 === 1 ? C.magenta : C.gold;
    g.addColorStop(0, withAlpha(mix(col, "#ffffff", 0.4), rayA * (0.6 + 0.8 * hash(i * 4.4))));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a - wid, a + wid);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // expanding bubble (sphere silhouette)
  const rb = 26 * (1 - Math.exp(-t / 12)) * O.s;
  const ba = 0.5 * Math.exp(-t / 16);
  if (ba > 0.01 && rb > 4) {
    ([
      [C.cyan, 0.965],
      ["#ffffff", 1],
      [C.magenta, 1.035],
    ] as const).forEach(([col, k]) => {
      const r = rb * k;
      const g = ctx.createRadialGradient(O.x, O.y, r * 0.8, O.x, O.y, r);
      g.addColorStop(0, withAlpha(col, 0));
      g.addColorStop(0.85, withAlpha(col, ba * 0.35));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(O.x, O.y, r, 0, TAU);
      ctx.fill();
    });
  }
  // shockwave rings (3D, chromatic)
  for (const R of RINGS) {
    const tt = t - R.delay;
    if (tt < 0) continue;
    const rad = R.v * (1 - Math.exp(-tt / R.tau));
    const a = Math.exp(-tt / (R.tau * 0.9));
    if (a < 0.01) continue;
    ([
      [C.cyan, 0.975],
      [R.col, 1],
      [C.magenta, 1.025],
    ] as const).forEach(([col, k], j) => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 90; i++) {
        const q = P(cam, ringPoint(R.rx, R.rz, (i / 90) * TAU, rad * k));
        if (q) pts.push(q);
      }
      if (j === 1) glowLine(ctx, pts, col, 2 + 5 * a, a);
      else {
        ctx.strokeStyle = withAlpha(col, 0.5 * a);
        ctx.lineWidth = 2 + 3 * a;
        polyline(ctx, pts);
        ctx.stroke();
      }
    });
  }
  // sparks (3D, motion-blurred)
  const buckets: Seg[] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < N_SPARK; i++) {
    const s = SPARKS[i];
    const life = Math.exp(-t / s.life);
    if (life < 0.03) continue;
    const A = P(cam, sparkAt(s, t));
    const B = P(cam, sparkAt(s, t - 2.2));
    if (!A || !B || A.z < 1.2) continue;
    let dx = A.x - B.x;
    let dy = A.y - B.y;
    const L = Math.hypot(dx, dy);
    if (L > 260) {
      dx *= 260 / L;
      dy *= 260 / L;
    }
    const lv = life > 0.6 ? 2 : life > 0.25 ? 1 : 0;
    buckets[s.col * 3 + lv].push(A.x - dx, A.y - dy, A.x, A.y);
    if (i % 3 === 0) glow(ctx, A.x, A.y, Math.min(30, (2 + 5 * s.sz) * (A.s / 40) * (0.5 + life)), SPARK_COLS[s.col], life);
  }
  buckets.forEach((sg, j) => {
    const col = SPARK_COLS[Math.floor(j / 3)];
    const lv = j % 3;
    strokeSegs(ctx, sg, col, 4, [0.06, 0.12, 0.2][lv]);
    strokeSegs(ctx, sg, mix(col, "#ffffff", 0.5), 1.6, [0.25, 0.5, 0.95][lv]);
  });
  // blast core + anamorphic flare
  const k1 = Math.exp(-t / 7);
  glow(ctx, O.x, O.y, 800 * k1 + 200, mix(C.gold, "#ffffff", 0.4), 0.6 * k1 + 0.14, 0.04);
  glow(ctx, O.x, O.y, 240 * k1 + 60, "#ffffff", 0.9, 0.1);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(120,200,255,0)");
  g.addColorStop(0.5, withAlpha("#ffffff", 0.8 * k1 + 0.1));
  g.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = g;
  const sw = 3 + 30 * k1;
  ctx.fillRect(0, O.y - sw / 2, w, sw);
  ctx.globalCompositeOperation = "source-over";
};

const drawNetwork = (ctx: CanvasRenderingContext2D, f: number, cam: Cam, O: Pt & { s: number; z: number }) => {
  const t = f - IMPACT;
  if (t < 0) return;
  const expand = 1 + 0.5 * (t / (DUR - IMPACT));
  const spin = 0.003 * t;
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const scales = NET_R.map((R, k) => R * shellScale(k, t) * expand);
  const pos = NODES.map((n) => {
    const r = scales[n.k] * n.rj;
    if (r <= 0) return null;
    const x = n.d[0] * r;
    const z = n.d[2] * r;
    return project(cam, x * cs - z * sn, n.d[1] * r, x * sn + z * cs, 1.5);
  });
  // depth cue: the far side of each shell recedes into the dark, the near side close to the lens fades too
  const fogOf = (z: number) => clamp(1.45 - (0.62 * z) / O.z, 0.12, 1) * clamp((z - 2) / 6);
  ctx.globalCompositeOperation = "lighter";
  // edges, batched by colour, depth and kind
  const buckets: Seg[] = Array.from({ length: 48 }, () => []);
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i];
    const B = pos[e.b];
    if (!B) continue;
    const A = e.a < 0 ? O : pos[e.a];
    if (!A) continue;
    if (!e.mesh && e.a >= 0 && scales[e.k] < scales[e.k - 1] * 1.08) continue;
    const n = NODES[e.b];
    const fog = fogOf((A.z + B.z) / 2);
    if (fog < 0.05) continue;
    const key = ((n.hue * 4 + n.lvl) * 2 + (fog > 0.6 ? 1 : 0)) * 2 + (e.mesh ? 1 : 0);
    buckets[key].push(A.x, A.y, B.x, B.y);
  }
  const born = clamp(t / 6);
  buckets.forEach((sg, key) => {
    const mesh = key % 2;
    const near = Math.floor(key / 2) % 2;
    const pal = Math.floor(key / 4);
    const col = PAL[Math.floor(pal / 4)][pal % 4];
    const a = mesh ? (near ? 0.26 : 0.1) : near ? 0.3 : 0.12;
    strokeSegs(ctx, sg, col, near ? 1.5 : 1, a * born);
  });
  // signals racing outward along the layer wiring, one wave after another (forward passes)
  const sig: Seg = [];
  for (let w = 0; w < WAVES.length; w++) {
    const dt = f - WAVES[w];
    if (dt < 0 || dt > (NET_SHELLS.length + 1) * SIG_D) continue;
    for (let i = 0; i < EDGES.length; i++) {
      const e = EDGES[i];
      if (e.mesh) continue;
      const u = (dt - e.k * SIG_D) / SIG_D;
      if (u < 0 || u > 1) continue;
      if (e.a >= 0 && hash(i * 0.618 + w * 3.7) > 0.4) continue;
      const B = pos[e.b];
      const A = e.a < 0 ? O : pos[e.a];
      if (!A || !B) continue;
      const fog = fogOf(B.z);
      if (fog < 0.1) continue;
      const x = lerp(A.x, B.x, u);
      const y = lerp(A.y, B.y, u);
      const u0 = Math.max(0, u - 0.3);
      sig.push(lerp(A.x, B.x, u0), lerp(A.y, B.y, u0), x, y);
      const n = NODES[e.b];
      glow(ctx, x, y, clamp(0.3 * B.s, 6, 24), PAL[n.hue][1], 0.9 * fog);
    }
  }
  strokeSegs(ctx, sig, "#ffffff", 4, 0.14);
  strokeSegs(ctx, sig, "#ffffff", 1.6, 0.7);
  // nodes (kept dim inside the caption band)
  const cap = capAt(f);
  for (let i = 0; i < NODES.length; i++) {
    const p = pos[i];
    if (!p) continue;
    const band = 1 - 0.8 * cap * clamp((p.y - 740) / 120);
    const n = NODES[i];
    let act = 0;
    for (let w = 0; w < WAVES.length; w++) {
      const dt = f - (WAVES[w] + (n.k + 1) * SIG_D);
      if (dt >= 0 && dt < 40 && hash(i * 1.3 + w * 2.9) < 0.5) act = Math.max(act, Math.exp(-dt / 9));
    }
    const pop = clamp((t - n.k) / 5) * (n.k < 3 ? 0.45 + 0.15 * n.k : 1);
    const fog = fogOf(p.z) * band;
    if (fog < 0.03) continue;
    const r = clamp(0.13 * p.s, 1.8, 13) * (1 + 0.9 * act);
    glow(ctx, p.x, p.y, r * 2.8, PAL[n.hue][n.lvl], (0.55 + 0.45 * act) * fog * pop);
    if (act > 0.15 || n.h < 0.1) glow(ctx, p.x, p.y, r * 1.0, "#ffffff", (0.35 + 0.5 * act) * fog * pop);
  }
  // persistent white-hot heart, beating with every wave
  let beat = 0;
  for (const w of WAVES) {
    const dt = f - w;
    if (dt >= 0 && dt < 30) beat = Math.max(beat, Math.exp(-dt / 7));
  }
  glow(ctx, O.x, O.y, 170 + 110 * beat, mix(C.gold, "#ffffff", 0.5), 0.32 + 0.3 * beat, 0.06);
  glow(ctx, O.x, O.y, 30 + 16 * beat, "#ffffff", 1);
  ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------------------------------------


const drawScene = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  const cam = camAt(f);
  const O = project(cam, 0, 0, 0)!;
  drawBackground(ctx, w, h, f, cam, O);
  drawGrid(ctx, f, cam, ease.outCubic(prog(f, 8, 60)) * (1 - 0.5 * prog(f, IMPACT + 60, DUR)));
  drawNetwork(ctx, f, cam, O);
  drawStreams(ctx, f, cam);
  const inh = inhaleAt(f);
  if (inh > 0) {
    ctx.fillStyle = `rgba(0,0,0,${0.5 * inh})`;
    ctx.fillRect(0, 0, w, h);
  }
  drawCore(ctx, w, f, cam, O);
  drawBlast(ctx, w, f, cam, O);
  // keep the caption band calm
  const ca = capAt(f);
  if (ca > 0) {
    const g = ctx.createLinearGradient(0, 740, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, `rgba(0,0,0,${0.5 * ca})`);
    g.addColorStop(1, `rgba(0,0,0,${0.65 * ca})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 740, w, h - 740);
  }
};

// lateral chromatic aberration (radial RGB split around the blast) for the frames around the impact
const caAt = (f: number) => {
  const t = f - IMPACT;
  if (t < -3) return 0;
  if (t < 0) return 0.006 * (t + 4);
  return 0.024 * Math.exp(-t / 10);
};
const offs: HTMLCanvasElement[] = [];
const off = (i: number, w: number, h: number) => {
  if (!offs[i]) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    offs[i] = c;
  }
  return offs[i];
};

const World: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const ca = caAt(f);
      if (ca < 0.0015) {
        drawScene(ctx, w, h, f);
        return;
      }
      const A = off(0, w, h);
      const a = A.getContext("2d")!;
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalAlpha = 1;
      a.globalCompositeOperation = "source-over";
      a.clearRect(0, 0, w, h);
      drawScene(a, w, h, f);
      const T = off(1, w, h);
      const tc = T.getContext("2d")!;
      const O = project(camAt(f), 0, 0, 0)!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const [col, sc] of [
        ["#ff0000", 1 + ca],
        ["#00ff00", 1 + ca / 2],
        ["#0000ff", 1],
      ] as const) {
        tc.globalCompositeOperation = "copy";
        tc.drawImage(A, 0, 0);
        tc.globalCompositeOperation = "multiply";
        tc.fillStyle = col;
        tc.fillRect(0, 0, w, h);
        ctx.setTransform(sc, 0, 0, sc, O.x * (1 - sc), O.y * (1 - sc));
        ctx.drawImage(T, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }}
  />
);

const Labels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, 76, 96)) * (1 - prog(frame, IMPACT - 22, IMPACT - 6));
  if (a <= 0) return null;
  const cam = camAt(frame);
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {ARMS.map((arm, k) => {
        const S = P(cam, armPos(k, 0));
        if (!S) return null;
        const t = ease.outCubic(prog(frame, 78 + k * 5, 100 + k * 5));
        return (
          <div
            key={arm.en}
            style={{
              position: "absolute",
              left: clamp(S.x + arm.lx, 140, 1780),
              top: S.y + arm.ly,
              transform: `translateX(-50%) translateY(${(1 - t) * 16}px)`,
              textAlign: "center",
              opacity: t,
            }}
          >
            <div
              style={{
                fontFamily: FONT_CN,
                fontWeight: 900,
                fontSize: 50,
                lineHeight: 1.15,
                letterSpacing: "0.12em",
                color: "#fff",
                textShadow: `0 0 22px ${arm.col}, 0 0 6px ${arm.col}, 0 2px 10px #000`,
              }}
            >
              {arm.name}
            </div>
            <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 20, letterSpacing: "0.38em", color: arm.col, marginTop: 4, textShadow: "0 1px 6px #000, 0 0 12px #000" }}>
              {arm.en}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Converge: React.FC = () => {
  const frame = useCurrentFrame();
  const c = chargeAt(frame);
  const sh = sumShake(shake(frame, IMPACT, 64, 46), shake(frame, IMPACT + 3, 24, 80), shake(frame, MEET, 12, 18));
  const env = Math.max(Math.pow(1 - prog(frame, IMPACT, IMPACT + 46), 2), 0.4 * Math.pow(1 - prog(frame, IMPACT + 3, IMPACT + 83), 2)) * (frame >= IMPACT ? 1 : 0);
  const trem = frame < IMPACT ? (noise1(frame * 0.9) - 0.5) * 10 * c * c : 0;
  const tremY = frame < IMPACT ? (noise1(frame * 0.9 + 40) - 0.5) * 10 * c * c : 0;
  // zoom punch on the impact, plus overscan so the shaken frame never shows its edges
  const punch = (frame >= IMPACT ? 1 + 0.07 * Math.exp(-(frame - IMPACT) / 6) : 1) * (1 + 0.09 * env + 0.012 * c * c);
  const fade = Math.min(ease.outCubic(prog(frame, 0, 14)), 1 - prog(frame, DUR - 16, DUR));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <AbsoluteFill style={{ transform: `translate(${sh.x + trem}px, ${sh.y + tremY}px) rotate(${sh.r * 0.12}rad) scale(${punch})` }}>
          <World />
          <Labels />
        </AbsoluteFill>
        <Flash at={IMPACT} dur={8} peak={1} />
      </AbsoluteFill>
      <ChapterCard index={7} title="大爆发" en="THE EXPLOSION" color={C.gold} dur={80} />
      <Captions accent={C.gold} items={CAPS} />
    </AbsoluteFill>
  );
};
