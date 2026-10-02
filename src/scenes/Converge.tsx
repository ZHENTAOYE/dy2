import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fadeInOut, hash, lerp, noise1, prog, rng, shake, sumShake, TAU } from "../lib/math";
import { project, type Cam } from "../lib/three";
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
  { from: STREAMS + 10, to: IMPACT - 5, text: "算力、数据、算法——{{三条曲线}}终于在同一时刻交汇。" },
  { from: IMPACT + 20, to: DUR - 20, text: "一场真正的爆发开始了。" },
];
// how strongly the caption band (y >= ~760) must be kept clear; held a little past each caption's exit
const CAP_HOLD = [4, 14];
const bandAt = (f: number) => Math.max(...CAPS.map((c, i) => fadeInOut(f, c.from - 8, c.to + CAP_HOLD[i], 10, CAP_HOLD[i])));

type P3 = [number, number, number];
type Pt = { x: number; y: number };
type Seg = number[];
const frac = (v: number) => v - Math.floor(v);
const WHITE = "#ffffff";
const DEG = Math.PI / 180;

// =============================================================================================
// world: a polar floor (y = 0, Y points down) and the apex O above its centre, where the three
// exponential curves meet. Camera: an orbit rig around O. Before the blast it is a low dolly looking up
// at the apex (slow drift, then a hard push-in during the charge); the blast throws it back and up, it
// orbits the expanding network and finally dollies into it.

const FOCAL = 1500;
const H = 10; // apex height
const O3: P3 = [0, -H, 0];

const inhaleAt = (f: number) => (f < IMPACT ? ease.inCubic(prog(f, IMPACT - 15, IMPACT - 1)) : 0);
const chargeAt = (f: number) => ease.inQuad(prog(f, MEET - 15, IMPACT));

type Rig = { dist: number; el: number; az: number; cy: number };
const preRig = (f: number): Rig => {
  const drift = ease.inOutSine(prog(f, 0, MEET));
  const push = ease.inCubic(prog(f, MEET - 4, IMPACT - 1));
  const inh = inhaleAt(f);
  return {
    dist: lerp(44, 40.5, drift) - 12.5 * push - 1.2 * inh,
    el: -0.161 + 0.06 * push,
    az: lerp(-0.045, 0.04, drift) + 0.03 * push,
    cy: 322 + 48 * push,
  };
};
const PRE_END = preRig(IMPACT);
const rigAt = (f: number): Rig => {
  const t = f - IMPACT;
  if (t < 0) return preRig(f);
  // the camera holds for a few frames so the blast overtakes the lens; only then is it thrown back, and
  // soon after it starts to dive back into the growing network
  const kick = ease.outCubic(clamp((t - 5) / 64));
  const dolly = ease.inOutCubic(prog(f, IMPACT + 38, DUR + 8));
  return {
    dist: lerp(PRE_END.dist, 66, kick) - 26 * dolly,
    el: lerp(PRE_END.el, 0.24, ease.inOutSine(prog(f, IMPACT + 2, IMPACT + 110))),
    az: PRE_END.az + 1.5 * ease.inOutSine(prog(f, IMPACT + 4, DUR + 40)),
    cy: lerp(PRE_END.cy, 440, ease.outCubic(prog(f, IMPACT, IMPACT + 40))),
  };
};
const camAt = (f: number): Cam => {
  const r = rigAt(f);
  const dh = r.dist * Math.cos(r.el);
  return { x: dh * Math.sin(r.az), y: -H - r.dist * Math.sin(r.el), z: -dh * Math.cos(r.az), yaw: -r.az, pitch: r.el, f: FOCAL, cx: 960, cy: r.cy };
};

const P = (cam: Cam, p: P3, near = 0.4) => project(cam, p[0], p[1], p[2], near);
const horizonY = (cam: Cam) => cam.cy - cam.f * Math.tan(cam.pitch);

// =============================================================================================
// the three streams: each one is an exponential curve rising from its source on the floor to O.
// Two wide arms come in from the left and the right; the third (gold) rises from the near side, so no
// arm ever lines up with the view axis and all three curves read in profile.

const K_EXP = 2.4;
const EK = Math.exp(K_EXP) - 1;
const expo = (s: number) => (Math.exp(K_EXP * s) - 1) / EK;
const dexpo = (s: number) => (K_EXP * Math.exp(K_EXP * s)) / EK;

const ARMS = [
  { name: "算力", en: "COMPUTE", col: C.cyan, psi: -120 * DEG, R: 26, wid: 2.1, kinds: ["chip"], ign: STREAMS - 32, launch: STREAMS - 2 },
  { name: "数据", en: "DATA", col: C.magenta, psi: 120 * DEG, R: 26, wid: 2.1, kinds: ["photo", "token"], ign: STREAMS - 26, launch: STREAMS + 2 },
  { name: "算法", en: "ALGORITHMS", col: C.gold, psi: 26 * DEG, R: 13, wid: 0.95, kinds: ["graph"], ign: STREAMS - 6, launch: STREAMS + 8 },
];
const LITE = ARMS.map((a) => mix(a.col, WHITE, 0.55));

const armPos = (k: number, s: number, o1 = 0, o2 = 0): P3 => {
  const A = ARMS[k];
  const r = A.R * (1 - s);
  const st = Math.sin(A.psi);
  const ct = Math.cos(A.psi);
  const h = H * expo(s);
  if (o1 === 0 && o2 === 0) return [r * st, -h, -r * ct];
  const w = A.wid * Math.pow(1 - s, 0.7) + 0.1;
  const dh = H * dexpo(s);
  const L = Math.hypot(A.R, dh);
  const q = o2 * w * 0.75;
  const rr = r + (q * dh) / L;
  return [rr * st + o1 * w * ct, -(h + (q * A.R) / L), -rr * ct + o1 * w * st];
};
const groundOf = (k: number, s: number): P3 => {
  const A = ARMS[k];
  const r = A.R * (1 - s);
  return [r * Math.sin(A.psi), 0, -r * Math.cos(A.psi)];
};

/** Where the head of each stream is along its curve (0 = source, 1 = O); accelerating. */
const frontAt = (f: number, k: number) => {
  const u = prog(f, ARMS[k].launch, MEET);
  return 0.5 * ease.outCubic(u) + 0.5 * u * u * u;
};
/** Integrated particle flow (in path cycles): accelerating, then a last violent rush during the inhale. */
const flowAt = (f: number) => {
  const t = Math.max(0, f - STREAMS + 8) / 30;
  const it = Math.max(0, f - (IMPACT - 14)) / 14;
  return 0.2 * t + 0.07 * t * t + 0.5 * Math.min(it, 1) * Math.min(it, 1) * Math.min(it, 1);
};
/** After the meeting the sources are spent: the tails of the streams race up into the core. */
const cutAt = (f: number) => 0.68 * ease.inOutSine(prog(f, MEET + 6, IMPACT - 4));
const pulseAt = (f: number) => {
  let v = 0;
  for (const p of PULSES) {
    const t = f - p;
    if (t >= 0 && t < 24) v = Math.max(v, Math.exp(-t / 4.5));
  }
  return v;
};

const N_PART = 2200;
type Part = { a: number; sp: number; o1: number; o2: number; sz: number; b: number; tl: number };
const PARTS: Part[][] = ARMS.map((_, k) => {
  const r = rng(101 + k * 17);
  return Array.from({ length: N_PART }, () => {
    const wide = r() < 0.12 ? 1.9 : 1;
    const g1 = ((r() + r() + r() - 1.5) / 1.5) * wide;
    const g2 = ((r() + r() + r() - 1.5) / 1.5) * wide;
    return { a: r(), sp: 0.75 + 0.5 * r(), o1: g1, o2: g2, sz: r(), b: r() < 0.2 ? 1 : 0, tl: 0.55 + 0.9 * r() };
  });
});

const N_SPR = 30;
const SPRS = ARMS.map((a, k) => {
  const r = rng(303 + k * 11);
  return Array.from({ length: N_SPR }, (_, i) => ({
    a: (i + 0.6 * r()) / N_SPR,
    sp: 0.85 + 0.3 * r(),
    o1: (r() - 0.5) * 1.6,
    o2: (r() - 0.5) * 1.2,
    kind: a.kinds[i % a.kinds.length],
    rot: (r() - 0.5) * 0.6,
    v: Math.floor(r() * 3),
  }));
});

// data motes drifting in from all around toward the apex (fills the sky above the curves)
const N_MOTE = 300;
const MOTES = (() => {
  const r = rng(2024);
  return Array.from({ length: N_MOTE }, (_, i) => ({
    p: [(r() - 0.5) * 76, -2 - r() * 30, -14 + r() * 54] as P3,
    ph: r(),
    sp: 0.22 + 0.3 * r(),
    col: i % 3,
    sz: r(),
  }));
})();

// accretion disc around O (between the meeting and the blast): three spiral arms, one per stream
const N_ACC = 2700;
const ACC = (() => {
  const r = rng(909);
  // most particles hug their arm; the rest fill the disc between the arms
  return Array.from({ length: N_ACC }, (_, i) => ({ arm: i % 3, u: r(), sp: 0.75 + 0.5 * r(), jit: (r() + r() - 1) * (r() < 0.62 ? 0.32 : 1.25), y: (r() - 0.5) * 0.5, br: r() }));
})();
const ACC_RMAX = 7;
const ACC_TILT = 0.72;
const ACC_WIND = 1.35;
const accPos = (r: number, a: number, y: number): P3 => {
  const x = Math.cos(a) * r;
  const v = Math.sin(a) * r;
  // disc spanned by (1,0,0) and (0,-sin T,cos T): its far side is tipped up so it reads as a wide ellipse
  return [x, -H - v * Math.sin(ACC_TILT) + y * Math.cos(ACC_TILT), v * Math.cos(ACC_TILT) + y * Math.sin(ACC_TILT)];
};
const accFlow = (f: number) => {
  const t = Math.max(0, f - MEET + 6);
  return 0.006 * t + 0.00007 * t * t + 0.25 * inhaleAt(f);
};
const accSpin = (f: number) => {
  const t = Math.max(0, f - MEET + 6);
  return 0.018 * t + 0.0005 * t * t + 1.2 * inhaleAt(f);
};

// =============================================================================================
// sprites riding the streams (glyph-free: chips, picture thumbnails, tokens, little node graphs)

const sprites: Record<string, HTMLCanvasElement> = {};
const sprite = (kind: string, col: string, v = 0) => {
  const id = `${kind}|${col}|${v}`;
  const hit = sprites[id];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";
  const lite = mix(col, WHITE, 0.5);
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
    g.fillStyle = withAlpha(col, 0.4);
    g.fillRect(14, 14, 36, 36);
    g.lineWidth = 2.5;
    g.strokeRect(14, 14, 36, 36);
    g.fillStyle = "rgba(255,255,255,0.92)";
    if (v === 1) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.fillRect(20 + i * 13, 20 + j * 13, 10, 10);
    } else g.fillRect(24, 24, 16, 16);
  } else if (kind === "photo") {
    g.fillStyle = withAlpha(col, 0.32);
    g.beginPath();
    g.roundRect(7, 13, 50, 38, 5);
    g.fill();
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = WHITE;
    if (v === 1) {
      // portrait
      g.beginPath();
      g.arc(32, 27, 7, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(32, 48, 13, 9, 0, Math.PI, TAU);
      g.fill();
    } else {
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
    }
  } else if (kind === "token") {
    g.fillStyle = withAlpha(col, 0.32);
    g.beginPath();
    g.roundRect(5, 20, 54, 24, 12);
    g.fill();
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.92)";
    const ws = v === 1 ? [8, 18, 6] : [12, 14, 8];
    let x = 14;
    for (const ww of ws) {
      g.fillRect(x, 29, ww, 6);
      x += ww + 4;
    }
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
      g.fillStyle = WHITE;
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

// =============================================================================================
// the network that bursts out of O: nested shells (layers) of nodes. Every layer is meshed into a
// geodesic web; every node is wired to one or two nodes of the layer inside it (fan-in edges).

const SHELL_N = [20, 28, 38, 52, 72, 100, 138, 190, 262, 362, 500, 690];
const NSH = SHELL_N.length;
const SHELL_R = SHELL_N.map((_, k) => 1.3 * Math.pow(1.32, k));
const SHELL_DELAY = SHELL_N.map((_, k) => 1 + 0.6 * k);
const HUE_COLS = [C.cyan, C.magenta, C.gold, mix(C.cyan, C.magenta, 0.5), mix(C.magenta, C.gold, 0.5), mix(C.gold, C.cyan, 0.5)];
const HEAT = [0.62, 0.38, 0.16, 0];
const PAL = HUE_COLS.map((c) => HEAT.map((hw) => mix(c, WHITE, hw)));
// colour regions of the network: compute on the left, data on the right, algorithms on top
const HUE_ANCHORS: P3[] = [
  [-0.85, 0.3, -0.43],
  [0.85, 0.3, -0.43],
  [0, -0.95, 0.3],
];
const WAVE_COLS = [WHITE, C.gold, C.cyan, C.magenta, C.gold, WHITE];

type NNode = { k: number; d: P3; rj: number; hue: number; lvl: number; h: number };
// cls: 0 = fan-in (radial) edge, 1 = mesh edge, 2 = mesh edge on one of the two outer shells (kept faint)
type Edge = { a: number; b: number; k: number; cls: number; key: number };
const NODES: NNode[] = [];
const EDGES: Edge[] = [];
const RADIAL: number[][] = SHELL_N.map(() => []);
(() => {
  const r = rng(777);
  const starts: number[] = [];
  SHELL_N.forEach((n, k) => {
    starts.push(NODES.length);
    const rot = r() * TAU;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * 2.399963 + rot;
      const j = 0.5 / Math.sqrt(n);
      let d: P3 = [Math.cos(th) * rad + (r() - 0.5) * j, y + (r() - 0.5) * j, Math.sin(th) * rad + (r() - 0.5) * j];
      const len = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / len, d[1] / len, d[2] / len];
      const ws = HUE_ANCHORS.map((a) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2] + (r() - 0.5) * 0.45);
      const ord = [0, 1, 2].sort((p, q) => ws[q] - ws[p]);
      let hue = ord[0];
      if (ws[ord[0]] - ws[ord[1]] < 0.2) {
        const pair = [ord[0], ord[1]].sort().join("");
        hue = pair === "01" ? 3 : pair === "12" ? 4 : 5;
      }
      const lvl = k <= 2 ? 0 : k <= 5 ? 1 : k <= 8 ? 2 : 3;
      // the outer shells get a ragged radius so their silhouette dissolves instead of tracing a polygon
      const rj = k >= NSH - 2 ? 0.85 + 0.35 * r() : k >= NSH - 4 ? 0.92 + 0.16 * r() : 0.96 + 0.08 * r();
      NODES.push({ k, d, rj, hue, lvl, h: r() });
    }
  });
  starts.push(NODES.length);
  const keyOf = (b: number, cls: number) => {
    const n = NODES[b];
    return ((((n.hue * 4 + n.lvl) * 2 + (n.k % 2)) * 3 + cls) * 2) | 0;
  };
  const add = (a: number, b: number, k: number, cls: number) => {
    if (cls === 0) RADIAL[k].push(EDGES.length);
    EDGES.push({ a, b, k, cls, key: keyOf(b, cls) });
  };
  const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let k = 0; k < NSH; k++) {
    const seen = new Set<number>();
    for (let i = starts[k]; i < starts[k + 1]; i++) {
      const d = NODES[i].d;
      if (k === 0) add(-1, i, k, 0);
      else {
        const cand: [number, number][] = [];
        for (let j = starts[k - 1]; j < starts[k]; j++) cand.push([dot(d, NODES[j].d), j]);
        cand.sort((p, q) => q[0] - p[0]);
        add(cand[0][1], i, k, 0);
        const m = Math.min(cand.length - 1, 5);
        if (m >= 1 && r() < 0.55) add(cand[1 + Math.floor(r() * m)][1], i, k, 0);
      }
      const near: [number, number][] = [];
      for (let j = starts[k]; j < starts[k + 1]; j++) {
        if (j === i) continue;
        const v = dot(d, NODES[j].d);
        if (near.length < 3) {
          near.push([v, j]);
          near.sort((p, q) => q[0] - p[0]);
        } else if (v > near[2][0]) {
          near[2] = [v, j];
          near.sort((p, q) => q[0] - p[0]);
        }
      }
      for (const [, j] of near) {
        const key = Math.min(i, j) * 100000 + Math.max(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        add(i, j, k, k >= NSH - 2 ? 2 : 1);
      }
    }
  }
})();
const N_BUCKET = 6 * 4 * 2 * 3 * 2;
const BUCKET_STYLE = Array.from({ length: N_BUCKET }, (_, key) => {
  const near = key % 2;
  const cls = Math.floor(key / 2) % 3;
  const odd = Math.floor(key / 6) % 2;
  const pal = Math.floor(key / 12);
  const lvl = pal % 4;
  // at rest the fan-in wiring stays thin (it lights up when a wave runs along it); the meshes of the even
  // layers carry the shell structure
  const base = cls === 0 ? (near ? 0.15 : 0.055) : (near ? 0.15 : 0.055) * (cls === 2 ? 0.4 : odd ? 1 : 1.5);
  return {
    col: PAL[Math.floor(pal / 4)][lvl],
    alpha: base * [0.5, 0.72, 0.9, 1][lvl] * (odd ? 0.55 : 1),
    width: near ? (cls === 0 ? 1.5 : 1.2) : 1,
  };
});

/**
 * Push an edge, grown to `g` from A. Long edges (right in front of the lens) would read as sticks rather than
 * wiring: past `l0` px they shrink smoothly to two short stubs at their nodes and are gone at `l1` px.
 */
const pushStub = (sg: Seg, A: Pt, B: Pt, g: number, l0: number, l1: number) => {
  const keep = clamp((l1 - Math.hypot(B.x - A.x, B.y - A.y)) / (l1 - l0));
  if (keep <= 0) return;
  if (keep >= 1) {
    sg.push(A.x, A.y, lerp(A.x, B.x, g), lerp(A.y, B.y, g));
    return;
  }
  const u = Math.min(g, 0.5 * keep);
  sg.push(A.x, A.y, lerp(A.x, B.x, u), lerp(A.y, B.y, u));
  if (g >= 1) sg.push(B.x, B.y, lerp(B.x, A.x, 0.5 * keep), lerp(B.y, A.y, 0.5 * keep));
};

const shellScale = (k: number, t: number) => {
  const tt = t - SHELL_DELAY[k];
  if (tt <= 0) return 0;
  return 1 - Math.exp(-tt / (4.5 + 0.5 * k));
};
const SIG_D = 4; // frames for a forward-pass signal to cross one layer

// drifting dust around the network: a parallax reference once the floor and horizon are gone
const N_DUST = 380;
const DUST = (() => {
  const r = rng(8080);
  return Array.from({ length: N_DUST }, () => {
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    const R = 14 + 80 * Math.pow(r(), 0.6);
    return { p: [Math.cos(th) * rad * R, -H + u * R * 0.8, Math.sin(th) * rad * R] as P3, sz: r(), tw: r() * 30 };
  });
})();

// =============================================================================================
// the blast

const N_SPARK = 3600;
const SPARK_COLS = [C.cyan, C.magenta, C.gold, WHITE];
const SPARKS = (() => {
  const r = rng(4242);
  return Array.from({ length: N_SPARK }, (_, i) => {
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    let d: P3 = [Math.cos(th) * rad, u, Math.sin(th) * rad];
    if (i % 20 < 4) {
      // a flattened equatorial disc of debris
      d = [d[0], d[1] * 0.16, d[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / l, d[1] / l, d[2] / l];
    }
    const v = 0.5 + 1.5 * Math.pow(r(), 2);
    return { d, v, drag: 0.03 + 0.05 * r(), life: 14 + 58 * r(), col: i % 9 === 0 ? 3 : i % 3, sz: r() };
  });
})();
const sparkAt = (s: (typeof SPARKS)[number], t: number): P3 => {
  const d = (s.v / s.drag) * (1 - Math.exp(-s.drag * Math.max(0, t)));
  return [s.d[0] * d, -H + s.d[1] * d + 0.0004 * t * t, s.d[2] * d];
};

// slow embers that linger after the flash
const N_EMBER = 400;
const EMBERS = (() => {
  const r = rng(5151);
  return Array.from({ length: N_EMBER }, (_, i) => {
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    return { d: [Math.cos(th) * rad, u, Math.sin(th) * rad] as P3, v: 0.08 + 0.5 * r(), life: 70 + 120 * r(), col: i % 4, sz: r(), tw: r() * 40 };
  });
})();

// the stream glyphs, flung out by the blast
const N_DEB = 96;
const DEBRIS = (() => {
  const r = rng(6161);
  return Array.from({ length: N_DEB }, (_, i) => {
    const k = i % 3;
    const u = r() * 2 - 1;
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    return {
      k,
      kind: ARMS[k].kinds[Math.floor(r() * ARMS[k].kinds.length)],
      v: Math.floor(r() * 2),
      d: [Math.cos(th) * rad, u * 0.7, Math.sin(th) * rad] as P3,
      sp: 0.5 + 1.1 * r(),
      spin: (r() - 0.5) * 0.4,
      rot: r() * TAU,
      life: 45 + 50 * r(),
    };
  });
})();

// two equatorial rings (the first one rips past the frame edges within ~10 frames) and five tilted ones,
// all well away from edge-on so each reads as a ring, not as a skewed loop across the core
const RINGS = [
  { rx: 0, rz: 0, v: 64, tau: 18, delay: 0, col: WHITE, eq: true },
  { rx: 0, rz: 0, v: 30, tau: 26, delay: 5, col: C.gold, eq: true },
  { rx: 0.82, rz: 0.25, v: 36, tau: 22, delay: 1, col: C.magenta, eq: false },
  { rx: -0.9, rz: 1.05, v: 27, tau: 26, delay: 3, col: C.cyan, eq: false },
  { rx: 0.95, rz: -1.1, v: 21, tau: 28, delay: 7, col: C.gold, eq: false },
  { rx: -0.72, rz: -0.35, v: 46, tau: 20, delay: 4, col: WHITE, eq: false },
  { rx: 1.0, rz: 2.2, v: 16, tau: 30, delay: 11, col: C.magenta, eq: false },
];
const ringNormal = (rx: number, rz: number): P3 => [Math.sin(rz) * Math.cos(rx), -Math.cos(rz) * Math.cos(rx), -Math.sin(rx)];
const ringPoint = (rx: number, rz: number, a: number, r: number): P3 => {
  const x = Math.cos(a) * r;
  const z0 = Math.sin(a) * r;
  const y1 = -z0 * Math.sin(rx);
  const z1 = z0 * Math.cos(rx);
  return [x * Math.cos(rz) - y1 * Math.sin(rz), -H + x * Math.sin(rz) + y1 * Math.cos(rz), z1];
};

// debris that flies straight past the lens in the first frames (camera space: O sits at (0, 0, dist))
const N_FLY = 240;
const FLY = (() => {
  const r = rng(7373);
  return Array.from({ length: N_FLY }, (_, i) => ({
    phi: 0.14 + 0.5 * Math.sqrt(r()), // angle off the view axis
    th: r() * TAU,
    v: 1.7 + 1.9 * r(),
    tb: Math.pow(r(), 1.5) * 13,
    col: i % 5 === 4 ? 3 : i % 3,
    w: r(),
  }));
})();

// stars on the upper half of a far sphere around O
const STARS = (() => {
  const r = rng(55);
  return Array.from({ length: 1300 }, () => {
    const u = Math.pow(r(), 0.8);
    const th = r() * TAU;
    const rad = Math.sqrt(1 - u * u);
    return { p: [Math.cos(th) * rad * 300, -H - u * 300 + 20, Math.sin(th) * rad * 300] as P3, sz: Math.pow(r(), 3), tw: r() * 50 };
  });
})();

// =============================================================================================
// drawing helpers

/**
 * Glows grouped by colour: drawing every sprite of one colour in a row lets the canvas batch them, which is
 * many times faster than alternating sprites call by call.
 */
class GlowBatch {
  private m = new Map<string, number[]>();
  add(col: string, x: number, y: number, r: number, a: number) {
    if (a <= 0.002 || r <= 0.05) return;
    let l = this.m.get(col);
    if (!l) {
      l = [];
      this.m.set(col, l);
    }
    l.push(x, y, r, a);
  }
  flush(ctx: CanvasRenderingContext2D) {
    this.m.forEach((l, col) => {
      for (let i = 0; i < l.length; i += 4) glow(ctx, l[i], l[i + 1], l[i + 2], col, l[i + 3]);
    });
    this.m.clear();
  }
}

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
/** Project a closed 3D loop into runs of screen points, breaking wherever it passes behind the lens. */
const loopRuns = (cam: Cam, n: number, at: (u: number) => P3, near = 1.2): Pt[][] => {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const q = P(cam, at(i / n), near);
    if (!q || Math.abs(q.x - 960) > 5000 || Math.abs(q.y - 540) > 5000) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
      continue;
    }
    cur.push(q);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
};
const polyline = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
};
const glowLine = (ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number) => {
  if (pts.length < 2 || alpha <= 0.003) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(color, Math.min(1, 0.1 * alpha));
  ctx.lineWidth = width * 7;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, Math.min(1, 0.3 * alpha));
  ctx.lineWidth = width * 2.6;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(mix(color, WHITE, 0.6), Math.min(1, alpha));
  ctx.lineWidth = width;
  polyline(ctx, pts);
  ctx.stroke();
};
const chromaRing = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ry: number, alpha: number, width: number, mid = WHITE) => {
  if (alpha <= 0.005 || r <= 1) return;
  ([
    [C.cyan, 0.975, 0.7],
    [mid, 1, 1],
    [C.magenta, 1.025, 0.7],
  ] as const).forEach(([col, k, a]) => {
    ctx.strokeStyle = withAlpha(col, Math.min(1, alpha * a));
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(x, y, r * k, ry * k, 0, 0, TAU);
    ctx.stroke();
  });
};
/** A soft glowing ring: wide faint halo + thin bright core. */
const haloRing = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ry: number, color: string, width: number, alpha: number) => {
  if (alpha <= 0.004 || r <= 1) return;
  for (const [wk, ak, c] of [
    [6, 0.1, color],
    [2.4, 0.3, color],
    [1, 1, mix(color, WHITE, 0.6)],
  ] as const) {
    ctx.strokeStyle = withAlpha(c, Math.min(1, alpha * ak));
    ctx.lineWidth = width * wk;
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, TAU);
    ctx.stroke();
  }
};

// =============================================================================================
// layers

const BG_SCALE = 0.25;
let bgCanvas: HTMLCanvasElement | null = null;
const drawBackground = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number, cam: Cam, O: Pt) => {
  const c = chargeAt(f);
  const t = f - IMPACT;
  const after = t >= 0 ? Math.exp(-t / 70) : 0;
  const hy = horizonY(cam);
  // the soft layers (space gradient, nebulae, ground, horizon glow) are painted at quarter resolution
  if (!bgCanvas) {
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = Math.round(w * BG_SCALE);
    bgCanvas.height = Math.round(h * BG_SCALE);
  }
  const b = bgCanvas.getContext("2d")!;
  b.setTransform(BG_SCALE, 0, 0, BG_SCALE, 0, 0);
  b.globalAlpha = 1;
  b.globalCompositeOperation = "source-over";
  const bg = b.createRadialGradient(O.x, O.y, 0, O.x, O.y, w * 0.9);
  bg.addColorStop(0, mix("#0b1024", "#24162a", Math.max(0.7 * c, after)));
  bg.addColorStop(0.45, "#050816");
  bg.addColorStop(1, "#010208");
  b.fillStyle = bg;
  b.fillRect(0, 0, w, h);
  b.globalCompositeOperation = "lighter";
  // nebulae far out along each stream's direction
  // (a coreless gradient: a glow sprite's white centre would read as a stain on the lens)
  ARMS.forEach((a, k) => {
    const s = P(cam, [[-170, 170, 10][k], [-70, -80, -120][k], 230]);
    if (!s) return;
    const A = 0.06 + 0.05 * c + 0.04 * after + (t >= 0 ? 0.03 : 0);
    const ng = b.createRadialGradient(s.x, s.y, 0, s.x, s.y, 900);
    ng.addColorStop(0, withAlpha(a.col, 0.8 * A));
    ng.addColorStop(0.24, withAlpha(a.col, 0.35 * A));
    ng.addColorStop(0.52, withAlpha(a.col, 0.08 * A));
    ng.addColorStop(1, withAlpha(a.col, 0));
    b.fillStyle = ng;
    b.fillRect(s.x - 900, s.y - 900, 1800, 1800);
  });
  b.globalCompositeOperation = "source-over";
  // the ground below the horizon and the horizon glow: both gone soon after the blast
  const ga = 1 - prog(f, IMPACT + 5, IMPACT + 45);
  if (ga > 0 && hy < h) {
    const y0 = Math.max(0, hy);
    const g = b.createLinearGradient(0, y0, 0, h);
    g.addColorStop(0, `rgba(4,6,16,${0.55 * ga})`);
    g.addColorStop(1, `rgba(1,2,6,${0.92 * ga})`);
    b.fillStyle = g;
    b.fillRect(0, y0, w, h - y0);
  }
  if (ga > 0 && hy > -150 && hy < h + 150) {
    b.globalCompositeOperation = "lighter";
    const hg = b.createLinearGradient(0, hy - 90, 0, hy + 60);
    const ha = (0.16 + 0.06 * prog(f, 8, 60) + 0.22 * c + 0.2 * after) * ga;
    hg.addColorStop(0, "rgba(60,90,200,0)");
    hg.addColorStop(0.6, withAlpha(mix("#3a5cff", C.gold, 0.25 + 0.4 * c), ha));
    hg.addColorStop(0.62, withAlpha(mix("#9fb5ff", WHITE, c), 0.5 * ha));
    hg.addColorStop(1, "rgba(60,90,200,0)");
    b.fillStyle = hg;
    b.fillRect(0, hy - 90, w, 150);
    b.globalCompositeOperation = "source-over";
  }
  ctx.drawImage(bgCanvas, 0, 0, w, h);
  // stars (smeared radially by the blast), at full resolution
  const warp = t >= 0 ? 0.55 * Math.exp(-t / 9) : 0;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = "rgba(220,235,255,0.5)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const st of STARS) {
    const p = P(cam, st.p, 1);
    if (!p || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
    const tw = 0.35 + 0.65 * noise1(f * 0.05 + st.tw);
    if (warp > 0.01) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (p.x - O.x) * warp, p.y + (p.y - O.y) * warp);
    } else {
      ctx.globalAlpha = 0.22 + 0.6 * st.sz * tw;
      const r = 0.8 + 1.8 * st.sz;
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
  }
  ctx.globalAlpha = 1;
  if (warp > 0.01) ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
};

/** Polar grid on the floor; the blast sends a ripple across it. */
const drawFloor = (ctx: CanvasRenderingContext2D, f: number, cam: Cam, alpha: number) => {
  if (alpha <= 0.01) return;
  const t = f - IMPACT;
  const rs = t >= 0 ? 75 * (1 - Math.exp(-t / 26)) : -99;
  const amp = t >= 0 ? 2.6 * Math.exp(-t / 34) : 0;
  const yAt = (r: number) => -amp * Math.exp(-Math.pow((r - rs) / 2.6, 2));
  const grow = ease.outCubic(prog(f, 4, 60));
  ctx.globalCompositeOperation = "lighter";
  const RMAX = 46;
  for (let ri = 1; ri <= 23; ri++) {
    const r = ri * 2;
    if (r > RMAX * grow + 2) break;
    const near = t >= 0 ? Math.exp(-Math.pow((r - rs) / 3, 2)) * Math.exp(-t / 70) : 0;
    const base = (ri % 4 === 0 ? 0.28 : 0.15) * clamp(1.25 - r / RMAX) * clamp((RMAX * grow + 2 - r) / 6);
    ctx.strokeStyle = withAlpha(mix("#4f6dff", WHITE, near), (base + 0.6 * near) * alpha);
    ctx.lineWidth = ri % 4 === 0 ? 1.6 : 1.1;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      const p = project(cam, Math.sin(a) * r, yAt(r), -Math.cos(a) * r, 0.6);
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
  ctx.strokeStyle = withAlpha("#4f6dff", 0.1 * alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    let pen = false;
    for (let r = 1; r <= RMAX * grow; r += 1.5) {
      const p = project(cam, Math.sin(a) * r, yAt(r), -Math.cos(a) * r, 0.6);
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

/** Data motes drifting in toward the apex from everywhere (pre-impact). */
const drawMotes = (ctx: CanvasRenderingContext2D, f: number, cam: Cam) => {
  const vis = (0.45 * prog(f, 10, 40) + 0.55 * prog(f, STREAMS - 10, STREAMS + 30)) * (1 - inhaleAt(f));
  if (vis <= 0.01 || f >= IMPACT) return;
  const c = chargeAt(f);
  const fl = flowAt(f) + (0.2 * f) / 30;
  const segs: Seg[] = [[], [], []];
  const gb = new GlowBatch();
  for (const m of MOTES) {
    const u = frac(m.ph + fl * m.sp * 0.5);
    const e = ease.inCubic(u);
    const e0 = ease.inCubic(Math.max(0, u - 0.03 - 0.03 * c));
    const at = (k: number): P3 => [lerp(m.p[0], O3[0], k), lerp(m.p[1], O3[1], k), lerp(m.p[2], O3[2], k)];
    const A = P(cam, at(e), 1);
    const B = P(cam, at(e0), 1);
    if (!A || !B) continue;
    const a = Math.sin(Math.PI * u) * vis * (0.5 + 0.4 * c);
    segs[m.col].push(B.x, B.y, A.x, A.y);
    gb.add(ARMS[m.col].col, A.x, A.y, clamp(0.09 * A.s, 1.2, 4.5) * (1 + m.sz), a);
  }
  gb.flush(ctx);
  segs.forEach((sg, k) => strokeSegs(ctx, sg, LITE[k], 1.2, 0.3 * vis * (0.5 + 0.5 * c)));
};

const drawStreams = (ctx: CanvasRenderingContext2D, f: number, cam: Cam) => {
  const out = 1 - prog(f, IMPACT, IMPACT + 3);
  if (out <= 0) return;
  const flow = flowAt(f);
  const c = chargeAt(f);
  const inh = inhaleAt(f);
  const dim = out * (1 - 0.7 * inh);
  const cut = cutAt(f);
  const mt = f - MEET;
  // emitters: portals on the floor at the sources (spent soon after the meeting)
  ARMS.forEach((a, k) => {
    const ign = ease.outCubic(prog(f, a.ign, a.ign + 26)) * (1 - prog(f, MEET + 4, MEET + 34)) * out;
    if (ign <= 0) return;
    const sp = groundOf(k, 0);
    const S = P(cam, sp);
    if (!S) return;
    const k2 = S.s / 45;
    const flick = 0.85 + 0.15 * noise1(f * 0.3 + k * 9);
    // the gold source sits close to the lens: keep it from blooming once its stream is running
    const near = k === 2 ? 1 - 0.45 * prog(f, a.launch, a.launch + 30) : 1;
    glow(ctx, S.x, S.y, Math.min(150, 130 * k2) * ign, a.col, 0.3 * ign * flick * near, 0.05);
    glow(ctx, S.x, S.y, Math.min(40, 32 * k2), WHITE, 0.9 * ign * near);
    // ignition beacon: a pillar of light that shoots up and dissipates before the labels arrive
    const top = P(cam, [sp[0], -7, sp[2]]);
    const pil = ign * (1 - prog(f, a.ign + 18, a.ign + 36));
    if (top && pil > 0) {
      const g = ctx.createLinearGradient(S.x, S.y, top.x, top.y);
      g.addColorStop(0, withAlpha(a.col, 0.6 * pil));
      g.addColorStop(1, withAlpha(a.col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 12 * k2;
      ctx.beginPath();
      ctx.moveTo(S.x, S.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.lineWidth = 2.5 * k2;
      ctx.stroke();
    }
    // two rotating dashed rings lying on the floor
    for (const [rr, spd] of [
      [1.5, 0.05],
      [2.5, -0.03],
    ]) {
      const pts: Pt[] = [];
      for (let i = 0; i <= 64; i++) {
        const an = (i / 64) * TAU;
        const q = P(cam, [sp[0] + Math.cos(an) * rr, 0, sp[2] + Math.sin(an) * rr]);
        if (q) pts.push(q);
      }
      ctx.setLineDash([14 * k2, 10 * k2]);
      ctx.lineDashOffset = f * spd * 60;
      ctx.strokeStyle = withAlpha(a.col, 0.65 * ign);
      ctx.lineWidth = 2.2 * k2;
      polyline(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  const nAct = Math.floor(N_PART * (0.4 + 0.6 * prog(f, STREAMS, IMPACT - 20)));
  const trailU = 0.035 + 0.035 * c + 0.06 * inh;
  ARMS.forEach((a, k) => {
    const F = frontAt(f, k);
    const col = a.col;
    // guide: a faint dashed forecast of the whole curve, traced ahead of the stream's head
    const gs = Math.max(a.ign + 4, STREAMS + 4);
    const G = ease.inOutCubic(prog(f, gs, gs + 30));
    if (G > F + 0.01) {
      const gp: Pt[] = [];
      for (let s = F; s <= G + 1e-6; s += 0.012) {
        const q = P(cam, armPos(k, Math.min(s, G)));
        if (q) gp.push(q);
      }
      ctx.setLineDash([9, 9]);
      ctx.lineDashOffset = -f * 1.6;
      ctx.strokeStyle = withAlpha(LITE[k], 0.42 * dim);
      ctx.lineWidth = 1.6;
      polyline(ctx, gp);
      ctx.stroke();
      ctx.setLineDash([]);
      const end = gp[gp.length - 1];
      if (end && G < 0.995) glow(ctx, end.x, end.y, 9, col, 0.8 * dim);
    }
    if (F <= 0.001) return;
    const s0c = Math.min(cut, F);
    // curtain: the area under the curve, like a chart, plus its shadow on the floor
    const cur: Seg = [];
    const curTop: Seg = [];
    const shadow: Pt[] = [];
    for (let j = 0; j <= 70; j++) {
      const s = s0c + ((F - s0c) * j) / 70;
      if (s > 0.985) break;
      const tp = P(cam, armPos(k, s));
      const bt = P(cam, groundOf(k, s));
      if (!tp || !bt) continue;
      cur.push(tp.x, tp.y, bt.x, bt.y);
      curTop.push(tp.x, tp.y, lerp(tp.x, bt.x, 0.3), lerp(tp.y, bt.y, 0.3));
      shadow.push(bt);
    }
    strokeSegs(ctx, cur, col, 1.2, 0.06 * dim);
    strokeSegs(ctx, curTop, col, 1.6, 0.09 * dim);
    if (shadow.length > 1) {
      ctx.strokeStyle = withAlpha(col, 0.3 * dim);
      ctx.lineWidth = 1.5;
      polyline(ctx, shadow);
      ctx.stroke();
    }
    // volume haze along the stream
    for (let j = 0; j < 12; j++) {
      const s = s0c + ((F - s0c) * (j + 0.5)) / 12;
      const q = P(cam, armPos(k, s));
      if (!q) continue;
      const gb0 = k === 2 ? lerp(0.5, 1, clamp(s / 0.25)) : 1;
      glow(ctx, q.x, q.y, Math.min(120, 1.5 * (a.wid * Math.pow(1 - s, 0.7) + 0.1) * q.s + 20), col, (0.09 + 0.07 * s + 0.08 * c) * dim * gb0, 0.02);
    }
    // the curve itself, brighter toward O (exponential glow); it thickens as the charge builds
    const pts: Pt[] = [];
    for (let s = s0c; s <= F + 1e-6; s += 0.008) {
      const q = P(cam, armPos(k, Math.min(s, F)));
      if (q) pts.push(q);
    }
    const hq = P(cam, armPos(k, F));
    if (hq) pts.push(hq);
    const n = pts.length;
    const lowK = k === 2 ? [0.4, 0.7, 1, 1] : [1, 1, 1, 1];
    for (let j = 0; j < 4; j++) {
      const sub = pts.slice(Math.floor((n * j) / 4), Math.min(n, Math.floor((n * (j + 1)) / 4) + 1));
      glowLine(ctx, sub, col, 1.7 + 0.8 * j + 3 * c, (0.34 + 0.22 * j + 0.35 * c) * dim * lowK[j]);
    }
    // the meeting: a bright pulse runs back down each curve
    if (mt >= 0 && mt < 26) {
      const sp = 1 - ease.outQuad(mt / 24);
      const seg: Pt[] = [];
      for (let q = 0; q <= 12; q++) {
        const s = clamp(sp - 0.08 + (0.16 * q) / 12, s0c, 1);
        const pp = P(cam, armPos(k, s));
        if (pp) seg.push(pp);
      }
      glowLine(ctx, seg, mix(col, WHITE, 0.5), 9, (1 - mt / 26) * dim);
      const hd = P(cam, armPos(k, Math.max(sp, s0c)));
      if (hd) {
        glow(ctx, hd.x, hd.y, 120, col, 0.9 * (1 - mt / 26) * dim);
        glow(ctx, hd.x, hd.y, 30, WHITE, (1 - mt / 26) * dim);
      }
    }
    // particles: long motion trails, bright heads. A young stream carries fewer of them, so its first
    // few metres do not pile up into a blob.
    const buckets: Seg[] = Array.from({ length: 8 }, () => []);
    const gb = new GlowBatch();
    const L = PARTS[k];
    const nK = Math.floor(nAct * clamp(0.15 + F / 0.4));
    for (let i = 0; i < nK; i++) {
      const p = L[i];
      const u = frac(p.a + flow * p.sp);
      const s = F * Math.pow(u, 1.3);
      if (s < 0.003 || s > 0.985 || s < cut + 0.05 * p.sz) continue;
      const s0 = F * Math.pow(Math.max(0, u - trailU * p.tl), 1.3);
      const A = P(cam, armPos(k, s, p.o1, p.o2));
      const B = P(cam, armPos(k, s0, p.o1, p.o2));
      if (!A || !B) continue;
      const band = s < 0.2 ? 0 : s < 0.4 ? 1 : s < 0.75 ? 2 : 3;
      buckets[band * 2 + p.b].push(B.x, B.y, A.x, A.y);
      if (i % 3 === 0) {
        const edge = clamp(s / 0.03) * clamp((F - s) / 0.02 + 0.3);
        const gb0 = k === 2 ? lerp(0.5, 1, clamp(s / 0.25)) : 1;
        gb.add(p.b && (k !== 2 || s > 0.4) ? WHITE : col, A.x, A.y, Math.min(14, (1.6 + 4.2 * p.sz) * (A.s / 42) * (0.8 + 0.5 * s)), (0.3 + 0.5 * s) * edge * dim * gb0);
      }
    }
    gb.flush(ctx);
    // (the gold source is close to the lens: its base is kept dim so it does not bloom to white)
    const baseK = k === 2 ? [0.3, 0.6, 1, 1] : [1, 1, 1, 1];
    for (let band = 0; band < 4; band++) {
      const wA = [1.1, 1.1, 1.5, 2.1][band] * (1 + 0.5 * c);
      const aA = [0.24, 0.24, 0.36, 0.5][band] * (1 + 0.5 * c) * baseK[band];
      strokeSegs(ctx, buckets[band * 2], col, wA * 2.6, aA * 0.25 * dim);
      strokeSegs(ctx, buckets[band * 2], col, wA, aA * dim);
      strokeSegs(ctx, buckets[band * 2 + 1], k === 2 && band < 2 ? col : LITE[k], wA * 1.2, Math.min(1, aA * 1.8) * dim);
    }
    // glyph sprites riding the stream
    for (const sp of SPRS[k]) {
      // spread over the whole curve and revealed as the head passes (a young stream carries only a few)
      const u = frac(sp.a + flow * 0.42 * sp.sp);
      const s = 0.8 * u;
      const fade = clamp((s - 0.02) / 0.05) * clamp((0.74 - s) / 0.14) * clamp((s - cut) / 0.05) * clamp((F - s) / 0.04) * dim;
      if (fade <= 0.01) continue;
      const q = P(cam, armPos(k, s, sp.o1, sp.o2));
      if (!q) continue;
      const size = clamp(0.62 * q.s, 15, 40);
      ctx.save();
      ctx.globalAlpha = 0.95 * fade;
      ctx.translate(q.x, q.y);
      ctx.rotate(sp.rot + 0.02 * f * (sp.v - 1));
      glow(ctx, 0, 0, size * 0.95, col, 0.28, 0.05);
      ctx.drawImage(sprite(sp.kind, col, sp.v), -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // packets: bright comets racing along the curve
    const pf = flow * 1.7;
    for (let j = 0; j < 6; j++) {
      const u = frac(j / 6 + pf + k * 0.13);
      const s = F * Math.pow(u, 1.2);
      if (s < cut) continue;
      const seg: Pt[] = [];
      for (let q = 0; q <= 8; q++) {
        const pp = P(cam, armPos(k, Math.max(cut, s - 0.08 * (1 - q / 8))));
        if (pp) seg.push(pp);
      }
      const fade = clamp(s / 0.06) * clamp((1 - s) / 0.04) * (k === 2 ? lerp(0.35, 1, clamp(s / 0.4)) : 1);
      glowLine(ctx, seg, col, 3, 0.8 * fade * dim);
      const hd = seg[seg.length - 1];
      if (hd) glow(ctx, hd.x, hd.y, 22, WHITE, 0.75 * fade * dim);
    }
    // the head of the stream (a comet: a point with a cross flare, not a blob)
    if (F < 1 && hq) {
      const tail: Pt[] = [];
      for (let q = 0; q <= 16; q++) {
        const pp = P(cam, armPos(k, Math.max(0, F - 0.2 * (1 - q / 16))));
        if (pp) tail.push(pp);
      }
      const k2 = Math.min(1.4, hq.s / 45);
      glowLine(ctx, tail, col, 5.5, 0.95 * dim);
      glow(ctx, hq.x, hq.y, 100 * k2, col, 0.5 * dim);
      glow(ctx, hq.x, hq.y, 26 * k2, WHITE, dim);
      ctx.strokeStyle = withAlpha(WHITE, 0.55 * dim);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const L2 = 64 * k2;
      ctx.moveTo(hq.x - L2, hq.y);
      ctx.lineTo(hq.x + L2, hq.y);
      ctx.moveTo(hq.x, hq.y - L2 * 0.6);
      ctx.lineTo(hq.x, hq.y + L2 * 0.6);
      ctx.stroke();
    }
  });
};

/** The gathering core between the first glimmer and the blast. */
const drawCore = (ctx: CanvasRenderingContext2D, w: number, f: number, cam: Cam, O: Pt & { s: number }) => {
  if (f >= IMPACT) return;
  const pre = ease.inQuad(prog(f, STREAMS + 26, MEET));
  const c = chargeAt(f);
  const inh = inhaleAt(f);
  const pu = pulseAt(f);
  const mt = f - MEET;
  const meet = mt >= 0 ? Math.exp(-mt / 9) : 0;
  const k = O.s / 45;
  // accretion disc: three spiral arms (one per stream) winding into the core, spinning ever faster
  const grow = ease.outCubic(prog(f, MEET - 6, MEET + 34));
  if (grow > 0) {
    const R = ACC_RMAX * grow * (1 - 0.85 * inh);
    const n = Math.floor(N_ACC * clamp(grow * (0.45 + 0.8 * c)));
    const spin = accSpin(f);
    const fl = accFlow(f);
    const du = 0.035 + 0.05 * c + 0.05 * inh;
    const rOf = (u: number) => 0.035 + 0.965 * Math.pow(1 - u, 1.5);
    const angOf = (p: (typeof ACC)[number], rho: number, sp: number) =>
      (p.arm * TAU) / 3 + sp + ACC_WIND * Math.log(1 / rho) + p.jit * (0.3 + 0.7 * rho);
    const segs: Seg[] = [[], [], [], [], [], []];
    const da = 0.04 + 0.06 * c;
    const gb = new GlowBatch();
    for (let i = 0; i < n; i++) {
      const p = ACC[i];
      const u = frac(p.u + fl * p.sp);
      const rho = rOf(u);
      const rho0 = rOf(Math.max(0, u - du));
      const A = P(cam, accPos(rho * R, angOf(p, rho, spin), p.y * rho));
      const B = P(cam, accPos(rho0 * R, angOf(p, rho0, spin - da), p.y * rho0));
      if (!A || !B) continue;
      const inner = rho < 0.35 ? 1 : 0;
      segs[p.arm * 2 + inner].push(B.x, B.y, A.x, A.y);
      if (i % 3 === 0) {
        const fade = clamp(u / 0.1);
        gb.add(rho < 0.22 ? WHITE : ARMS[p.arm].col, A.x, A.y, (2.5 + 5 * p.br) * Math.max(0.8, k), (0.45 + 0.4 * c) * fade * grow);
      }
    }
    gb.flush(ctx);
    for (let j = 0; j < 3; j++) {
      strokeSegs(ctx, segs[j * 2], ARMS[j].col, 4, (0.12 + 0.12 * c) * grow);
      strokeSegs(ctx, segs[j * 2], LITE[j], 1.6, (0.45 + 0.35 * c) * grow);
      strokeSegs(ctx, segs[j * 2 + 1], mix(ARMS[j].col, WHITE, 0.8), 2, (0.6 + 0.35 * c) * grow);
    }
    // bright spines along the three spiral arms
    for (let j = 0; j < 3; j++) {
      const spine: Pt[] = [];
      for (let q = 0; q <= 40; q++) {
        const rho = 1 - (0.96 * q) / 40;
        const an = (j * TAU) / 3 + spin + ACC_WIND * Math.log(1 / rho);
        const pp = P(cam, accPos(rho * R, an, 0));
        if (pp) spine.push(pp);
      }
      glowLine(ctx, spine.slice(8), ARMS[j].col, 2.2 + 1.5 * c, (0.35 + 0.35 * c) * grow);
      glowLine(ctx, spine.slice(0, 9), ARMS[j].col, 1.6, 0.18 * grow);
    }
    // the disc's own soft body
    glow(ctx, O.x, O.y, R * O.s * 1.05, mix(C.magenta, C.gold, 0.4), 0.16 * grow * (1 - inh), 0.02);
  }
  // light streaks being sucked in from all around
  if (c > 0.02) {
    const sg: Seg = [];
    const n = Math.floor(50 + 220 * c);
    const spd = 0.012 + 0.05 * c + 0.1 * inh;
    for (let i = 0; i < n; i++) {
      const an = hash(i * 3.7) * TAU;
      const u = frac(hash(i * 1.3) + (f - MEET) * spd * (0.6 + 0.8 * hash(i * 5.1)));
      const rmax = 1100;
      const rad = 70 + (rmax - 70) * Math.pow(1 - u, 1.6);
      const len = 30 + 160 * c * (1 - u);
      const r2 = Math.min(rad + len, rmax);
      sg.push(O.x + Math.cos(an) * rad, O.y + Math.sin(an) * rad, O.x + Math.cos(an) * r2, O.y + Math.sin(an) * r2);
    }
    strokeSegs(ctx, sg, "#e4ecff", 1.5, 0.3 * c + 0.2 * inh);
  }
  // the three heads meet: a bloom and three staggered chromatic rings fly out
  if (mt >= 0 && mt < 44) {
    glow(ctx, O.x, O.y, 260 * Math.max(0.8, k), mix(C.gold, WHITE, 0.45), 0.85 * Math.exp(-mt / 7), 0.06);
    for (let j = 0; j < 3; j++) {
      const tt = mt - j * 4;
      if (tt < 0) continue;
      const r = (50 + (380 + 120 * j) * ease.outCubic(clamp(tt / 32))) * Math.max(0.8, k);
      chromaRing(ctx, O.x, O.y, r, r * 0.66, 0.85 * Math.exp(-tt / 10), 2 + 6 * Math.exp(-tt / 7), [WHITE, C.gold, WHITE][j]);
    }
  }
  // heartbeat: inward-collapsing rings
  for (const p of PULSES) {
    const t = f - p;
    if (t < 0 || t > 14) continue;
    const r = 460 * Math.pow(1 - t / 14, 1.5) + 12;
    const a = Math.sin((t / 14) * Math.PI);
    ctx.strokeStyle = withAlpha(WHITE, 0.5 * a);
    ctx.lineWidth = 2 + 4 * a;
    ctx.beginPath();
    ctx.ellipse(O.x, O.y, r, r * 0.7, 0, 0, TAU);
    ctx.stroke();
  }
  // the core
  const coreR = (36 + 90 * pre + 190 * c + 110 * pu + 120 * meet) * (1 - 0.75 * inh) * Math.max(0.7, k);
  glow(ctx, O.x, O.y, coreR * 2.3, mix(C.gold, C.magenta, 0.3), (0.2 + 0.28 * c) * (1 - 0.5 * inh), 0.03);
  glow(ctx, O.x, O.y, coreR, WHITE, 0.3 + 0.4 * c + 0.3 * meet, 0.08);
  glow(ctx, O.x, O.y, 16 + 30 * c + 26 * inh, WHITE, 1);
  // lens ring with chromatic edges
  const ringA = (0.06 * prog(f, STREAMS + 14, STREAMS + 40) + 0.4 * c + 0.3 * meet) * (1 - 0.6 * inh);
  const rr = (120 + 110 * c + 34 * pu) * (1 - 0.55 * inh);
  chromaRing(ctx, O.x, O.y, rr, rr, ringA * 0.6, 2);
  chromaRing(ctx, O.x, O.y, rr * 1.9, rr * 1.9, ringA * 0.18, 1.5);
  // star spikes + anamorphic streak
  const sk = 0.15 * prog(f, STREAMS + 6, STREAMS + 34) + 0.55 * c + 0.4 * meet + 0.5 * inh;
  ctx.save();
  ctx.translate(O.x, O.y);
  ctx.rotate(f * 0.004);
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * TAU;
    const len = (200 + 620 * c) * (1 + 1.2 * inh);
    const g = ctx.createLinearGradient(0, 0, Math.cos(an) * len, Math.sin(an) * len);
    g.addColorStop(0, withAlpha(WHITE, 0.5 * sk));
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
  g.addColorStop(0.5, withAlpha(WHITE, 0.5 * sk));
  g.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = g;
  const sw = 2 + 6 * c + 4 * inh;
  ctx.fillRect(0, O.y - sw / 2, w, sw);
};

const drawRays = (ctx: CanvasRenderingContext2D, f: number, O: Pt) => {
  const t = f - IMPACT;
  if (t < 0) return;
  const rayA = 0.32 * Math.exp(-Math.max(0, t - 5) / 15) * (1 - prog(t, 36, 60));
  if (rayA <= 0.004) return;
  ctx.save();
  ctx.translate(O.x, O.y);
  ctx.rotate(t * 0.0025);
  const shoot = ease.outCubic(clamp((t + 1) / 8));
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * TAU + hash(i) * 0.09;
    const len = 2500 * shoot * (0.7 + 0.3 * hash(i * 2.7));
    const wid = 0.006 + hash(i * 9) * 0.028;
    const col = HUE_COLS[i % 3];
    const ra = rayA * (0.6 + 0.8 * hash(i * 4.4));
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    g.addColorStop(0, withAlpha(mix(col, WHITE, 0.4), ra));
    g.addColorStop(0.5, withAlpha(col, 0.3 * ra));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a - wid, a + wid);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

const drawBlast = (ctx: CanvasRenderingContext2D, w: number, f: number, cam: Cam, O: Pt & { s: number }) => {
  const t = f - IMPACT;
  if (t < 0 || t > 110) return;
  // expanding shock bubble (sphere silhouette with a chromatic rim), drawn as soft strokes
  const rb = 30 * (1 - Math.exp(-t / 11)) * O.s;
  const ba = 0.55 * Math.exp(-t / 13);
  if (ba > 0.01 && rb > 4) {
    ([
      [C.cyan, 0.965],
      [WHITE, 1],
      [C.magenta, 1.035],
    ] as const).forEach(([col, k]) => {
      const r = rb * k;
      ctx.strokeStyle = withAlpha(col, ba * 0.12);
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(O.x, O.y, r * 0.9, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(col, ba * 0.3);
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.arc(O.x, O.y, r * 0.96, 0, TAU);
      ctx.stroke();
    });
  }
  // shockwave rings (3D, chromatic); short tails so they are gone before the network settles. A tilted
  // ring fades as soon as it turns close to edge-on.
  const vd = [O3[0] - cam.x, O3[1] - cam.y, O3[2] - cam.z];
  const vl = Math.hypot(vd[0], vd[1], vd[2]);
  for (const R of RINGS) {
    const tt = t - R.delay;
    if (tt < 0) continue;
    const rad = R.v * (1 - Math.exp(-tt / R.tau));
    let a = Math.exp(-tt / (R.tau * 0.6));
    if (!R.eq) {
      const n = ringNormal(R.rx, R.rz);
      a *= clamp((Math.abs(n[0] * vd[0] + n[1] * vd[1] + n[2] * vd[2]) / vl - 0.15) / 0.15);
    }
    if (a < 0.02) continue;
    ([
      [C.cyan, 0.975],
      [R.col, 1],
      [C.magenta, 1.025],
    ] as const).forEach(([col, k], j) => {
      for (const pts of loopRuns(cam, 120, (u) => ringPoint(R.rx, R.rz, u * TAU, rad * k))) {
        if (j === 1) glowLine(ctx, pts, col, 2 + 6 * a, a);
        else {
          ctx.strokeStyle = withAlpha(col, 0.5 * a);
          ctx.lineWidth = 2 + 3 * a;
          polyline(ctx, pts);
          ctx.stroke();
        }
      }
    });
  }
  // debris flying straight past the lens: streaks that tear off all four edges within a few frames
  if (t < 30) {
    const D = PRE_END.dist;
    const fb: Seg[] = Array.from({ length: 12 }, () => []);
    const fgb = new GlowBatch();
    for (const s of FLY) {
      const tt = t - s.tb;
      if (tt <= 0) continue;
      const sp = Math.sin(s.phi);
      const cp = Math.cos(s.phi);
      const scr = (u: number) => {
        const d = s.v * Math.max(0, u);
        const z = D - cp * d;
        return z < 0.6 ? null : { x: cam.cx + (cam.f * sp * Math.cos(s.th) * d) / z, y: cam.cy + (cam.f * sp * Math.sin(s.th) * d) / z, z };
      };
      const A = scr(tt);
      const B = scr(tt - 1.4);
      if (!A || !B) continue;
      if (Math.abs(B.x - 960) > 1100 || Math.abs(B.y - 540) > 700) continue;
      const near = clamp((D - A.z) / D);
      const tier = near > 0.55 ? 2 : near > 0.25 ? 1 : 0;
      fb[s.col * 3 + tier].push(B.x, B.y, A.x, A.y);
      if (Math.abs(A.x - 960) < 1000 && Math.abs(A.y - 540) < 600) fgb.add(SPARK_COLS[s.col], A.x, A.y, 6 + 20 * near * (0.5 + s.w), 0.5 * clamp(tt / 2));
    }
    fgb.flush(ctx);
    fb.forEach((sg, j) => {
      const col = SPARK_COLS[Math.floor(j / 3)];
      const tier = j % 3;
      strokeSegs(ctx, sg, col, [5, 9, 16][tier], [0.16, 0.2, 0.22][tier]);
      strokeSegs(ctx, sg, mix(col, WHITE, 0.55), [1.6, 2.8, 4.5][tier], [0.75, 0.85, 0.9][tier]);
    });
  }
  // sparks (3D, motion-blurred); the ones right on top of the core are held back for the first frames
  // so the ring and spark structure reads instead of a flat white disc
  const buckets: Seg[] = Array.from({ length: 12 }, () => []);
  const hold = t < 24 ? 1 - t / 24 : 0;
  const gb = new GlowBatch();
  // the sparks thin out quickly after the first second so the network takes over
  const sparkFade = (1 - 0.7 * ease.inOutSine(prog(t, 14, 38))) * (1 - prog(t, 34, 62));
  for (let i = 0; i < N_SPARK; i++) {
    const s = SPARKS[i];
    let life = Math.exp(-t / s.life) * sparkFade;
    if (life < 0.03) continue;
    const A = P(cam, sparkAt(s, t), 1.2);
    const B = P(cam, sparkAt(s, t - 2.4), 1.2);
    if (!A || !B) continue;
    // early on only the fast sparks show, so the burst reads as a hollow shell of streaks
    if (hold > 0) life *= lerp(1, (0.25 + 0.75 * clamp((s.v - 0.6) / 0.9)) * Math.pow(clamp(Math.hypot(A.x - O.x, A.y - O.y) / 280), 1.3), 0.92 * hold);
    if (life < 0.03) continue;
    let dx = A.x - B.x;
    let dy = A.y - B.y;
    const L = Math.hypot(dx, dy);
    if (L > 280) {
      dx *= 280 / L;
      dy *= 280 / L;
    }
    // streaks right on top of the core stay in the faintest tier early on (no flat white disc)
    const onCore = t < 12 && Math.hypot(A.x - O.x, A.y - O.y) < 240;
    const lv = onCore ? 0 : life > 0.6 ? 2 : life > 0.25 ? 1 : 0;
    buckets[s.col * 3 + lv].push(A.x - dx, A.y - dy, A.x, A.y);
    if (i % 3 === 0) gb.add(SPARK_COLS[s.col], A.x, A.y, Math.min(26, (2 + 5 * s.sz) * (A.s / 40) * (0.5 + life)), life * (0.5 + 0.5 * clamp(t / 12)));
  }
  gb.flush(ctx);
  // the first frames are the densest: keep the streaks translucent so they never pile up into flat white
  const dens = lerp(0.25, 1, ease.inQuad(clamp(t / 16)));
  buckets.forEach((sg, j) => {
    const col = SPARK_COLS[Math.floor(j / 3)];
    const lv = j % 3;
    strokeSegs(ctx, sg, col, 4.5, [0.06, 0.12, 0.2][lv] * dens);
    strokeSegs(ctx, sg, mix(col, WHITE, 0.5), 1.7, [0.25, 0.5, 0.95][lv] * dens);
  });
  // flung glyphs
  for (const d of DEBRIS) {
    const life = 1 - t / d.life;
    if (life <= 0) continue;
    const dist = (d.sp / 0.045) * (1 - Math.exp(-0.045 * t));
    const q = P(cam, [d.d[0] * dist, -H + d.d[1] * dist, d.d[2] * dist], 1.5);
    if (!q) continue;
    const size = clamp(0.75 * q.s, 12, 64);
    ctx.save();
    ctx.globalAlpha = 0.9 * Math.pow(life, 1.4) * clamp(t / 3);
    ctx.translate(q.x, q.y);
    ctx.rotate(d.rot + d.spin * t);
    glow(ctx, 0, 0, size, ARMS[d.k].col, 0.4);
    ctx.drawImage(sprite(d.kind, ARMS[d.k].col, d.v), -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  // embers: slow, long-lived
  for (let i = 0; i < N_EMBER; i++) {
    const e = EMBERS[i];
    const born = clamp((t - 4) / 10);
    const life = Math.exp(-t / e.life) * born * (1 - prog(t, 70, 110));
    if (life < 0.03) continue;
    const dist = (e.v / 0.02) * (1 - Math.exp(-0.02 * t));
    const wob = 0.6 * (noise1(t * 0.03 + e.tw) - 0.5);
    const q = P(cam, [e.d[0] * dist + wob, -H + e.d[1] * dist - 0.01 * t, e.d[2] * dist - wob], 1.5);
    if (!q) continue;
    const tw = 0.5 + 0.5 * noise1(f * 0.15 + e.tw);
    gb.add(SPARK_COLS[e.col], q.x, q.y, clamp((1.5 + 3.5 * e.sz) * (q.s / 40), 1.5, 14), 0.8 * life * tw);
  }
  gb.flush(ctx);
  // blast core (gold-white, fast decay) + anamorphic flare
  const k1 = Math.exp(-t / 4);
  const tail = 1 - prog(t, 20, 60);
  glow(ctx, O.x, O.y, 760 * k1 + 220, mix(C.gold, WHITE, 0.4), 0.6 * k1 + 0.1 * tail, 0.04);
  glow(ctx, O.x, O.y, 140 * k1 + 40, mix(C.gold, WHITE, 0.5), 0.4 * (0.3 + 0.7 * k1) * (0.4 + 0.6 * tail), 0.1);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(120,200,255,0)");
  g.addColorStop(0.5, withAlpha(WHITE, 0.85 * Math.exp(-t / 7) + 0.08 * (1 - prog(t, 8, 30))));
  g.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = g;
  const sw = 3 + 34 * Math.exp(-t / 7);
  if (t < 30) ctx.fillRect(0, O.y - sw / 2, w, sw);
};

const drawNetwork = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number, cam: Cam, O: Pt & { s: number; z: number }) => {
  const t = f - IMPACT;
  if (t < 0) return;
  // front-loaded: the network keeps bursting outward right after the blast, then keeps growing slowly
  const expand = 1 + 0.12 * prog(t, 0, 15) + 0.75 * ease.outCubic(prog(t, 12, DUR - IMPACT + 10));
  const spin = 0.0022 * t;
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const scales = SHELL_R.map((R, k) => R * shellScale(k, t) * expand);
  const pos = NODES.map((n) => {
    const r = scales[n.k] * n.rj;
    if (r <= 0) return null;
    const x = n.d[0] * r;
    const z = n.d[2] * r;
    return project(cam, x * cs - z * sn, -H + n.d[1] * r, x * sn + z * cs, 1.0);
  });
  const dist = O.z;
  // depth cue: the far side recedes into the dark; nodes right at the lens fade out too
  const fogOf = (z: number) => clamp(1.5 - (0.7 * z) / dist, 0.14, 1) * clamp((z - 2) / 6);
  const outside = (p: Pt) => p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60;
  // per-layer wave activity: each wave fires every layer in turn, SIG_D frames apart
  const actK = new Array<number>(NSH).fill(0);
  const colK = new Array<string>(NSH).fill(WHITE);
  for (let wv = 0; wv < WAVES.length; wv++) {
    for (let k = 0; k < NSH; k++) {
      const dt = f - (WAVES[wv] + (k + 1) * SIG_D);
      if (dt < -SIG_D || dt > 40) continue;
      const v = dt < 0 ? 0.25 * (1 + dt / SIG_D) : Math.exp(-dt / 8);
      if (v > actK[k]) {
        actK[k] = v;
        colK[k] = WAVE_COLS[wv % WAVE_COLS.length];
      }
    }
  }
  // the sparks own the first frames; the network fades in from inside them
  const born = ease.inOutSine(clamp((t - 4) / 16));
  // a shell that is still tiny on screen is dim (otherwise the first frames pile up into a white disc)
  const vis = scales.map((R) => clamp((R * O.s - 30) / 150));
  // ...and so is a shell whose nodes are still packed too tightly on screen to read as separate points
  const sparse = scales.map((R, k) => {
    const rs = dist > R * 1.05 ? (FOCAL * R) / Math.sqrt(dist * dist - R * R) : 9999;
    return clamp(rs / (26 * Math.sqrt(SHELL_N[k])));
  });
  // edges
  const buckets: Seg[] = Array.from({ length: N_BUCKET }, () => []);
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i];
    const B = pos[e.b];
    if (!B) continue;
    const A = e.a < 0 ? O : pos[e.a];
    if (!A) continue;
    if (e.cls === 0 && e.a >= 0 && scales[e.k] < scales[e.k - 1] * 1.08) continue;
    if (outside(A) && outside(B)) continue;
    if (vis[e.k] < 1 && hash(i * 0.917) > vis[e.k]) continue;
    const fog = fogOf((A.z + B.z) / 2);
    if (fog < 0.05) continue;
    // radial wiring grows outward from the inner node
    const g = e.cls ? 1 : clamp((t - SHELL_DELAY[e.k] - 1) / 5);
    pushStub(buckets[e.key + (fog > 0.62 ? 1 : 0)], A, B, g, e.cls ? 280 : 200, e.cls ? 440 : 340);
  }
  buckets.forEach((sg, key) => {
    if (!sg.length) return;
    const st = BUCKET_STYLE[key];
    strokeSegs(ctx, sg, st.col, st.width, st.alpha * born);
  });
  // layer rims: the silhouette of every shell, faint; they flare as a wave passes through the layer
  const rim: number[] = [];
  for (let k = 0; k < NSH; k++) {
    const R = scales[k];
    if (R <= 0.05 || dist < R * 1.12) continue;
    const rs = (FOCAL * R) / Math.sqrt(dist * dist - R * R);
    if (rs > 1500) continue;
    rim.push(k, rs);
  }
  ctx.lineWidth = 1.2;
  for (let i = 0; i < rim.length; i += 2) {
    const k = rim[i];
    const rs = rim[i + 1];
    ctx.strokeStyle = withAlpha(mix(C.ice, WHITE, 0.3), (k % 2 ? 0.035 : 0.07) * born * clamp(t / 20));
    ctx.beginPath();
    ctx.arc(O.x, O.y, rs, 0, TAU);
    ctx.stroke();
    if (actK[k] > 0.02) haloRing(ctx, O.x, O.y, rs, rs, colK[k], 1.6, 0.55 * actK[k]);
  }
  // wavefronts: one bright chromatic sphere per wave, racing outward through the layers
  for (let wv = 0; wv < WAVES.length; wv++) {
    const kf = (f - WAVES[wv]) / SIG_D - 1;
    if (kf < -1 || kf > NSH) continue;
    const k0 = Math.floor(kf);
    const fr = kf - k0;
    const Ra = k0 < 0 ? 0 : scales[Math.min(k0, NSH - 1)];
    const Rb = scales[Math.min(k0 + 1, NSH - 1)];
    const R = lerp(Ra, Rb, fr) * 1.02;
    if (R <= 0.05 || dist < R * 1.15) continue;
    const rs = (FOCAL * R) / Math.sqrt(dist * dist - R * R);
    const a = 0.7 * clamp((kf + 1) / 1.5) * (1 - prog(kf, NSH - 3, NSH));
    chromaRing(ctx, O.x, O.y, rs, rs, a, 2.4, WAVE_COLS[wv % WAVE_COLS.length]);
  }
  // signals: forward passes racing outward layer by layer on each wave, plus constant chatter
  // signal tails take the colour of the region they run through; only the heads are white-hot
  const sig: Seg[] = HUE_COLS.map(() => []);
  const sgb = new GlowBatch();
  const sigGlow = (A: Pt, B: Pt & { z: number; s: number }, u: number, hue: number, br: number) => {
    const x = lerp(A.x, B.x, u);
    const y = lerp(A.y, B.y, u);
    if (Math.hypot(B.x - A.x, B.y - A.y) < 260) {
      const u0 = Math.max(0, u - 0.4);
      sig[hue].push(lerp(A.x, B.x, u0), lerp(A.y, B.y, u0), x, y);
    }
    sgb.add(PAL[hue][0], x, y, clamp(0.3 * B.s, 5, 18), br * fogOf(B.z));
  };
  // wiring a pass has just crossed: coloured by region, fainter on the big outer layers
  const lit: Seg[] = Array.from({ length: HUE_COLS.length * 3 }, () => []);
  for (let wv = 0; wv < WAVES.length; wv++) {
    const dt = f - WAVES[wv];
    if (dt < 0 || dt > (NSH + 1) * SIG_D) continue;
    for (let k = 0; k < NSH; k++) {
      const u = (dt - k * SIG_D) / SIG_D;
      if (u < 0 || u > 1) continue;
      for (const i of RADIAL[k]) {
        const e = EDGES[i];
        const B = pos[e.b];
        const A = e.a < 0 ? O : pos[e.a];
        if (!A || !B || outside(B) || fogOf(B.z) < 0.1) continue;
        sigGlow(A, B, u, NODES[e.b].hue, 1);
      }
    }
    // the wiring a pass has just crossed keeps glowing for a moment
    for (let k = 0; k < NSH; k++) {
      const da = dt - (k + 1) * SIG_D;
      if (da < 0 || da > 12) continue;
      const a = Math.exp(-da / 4);
      const tier = k < 6 ? 0 : k < 8 ? 1 : 2;
      for (const i of RADIAL[k]) {
        if (hash(i * 0.73) > a) continue;
        const e = EDGES[i];
        const B = pos[e.b];
        const A = e.a < 0 ? O : pos[e.a];
        if (!A || !B || (outside(A) && outside(B)) || fogOf(B.z) < 0.15) continue;
        pushStub(lit[NODES[e.b].hue * 3 + tier], A, B, 1, 170, 300);
      }
    }
  }
  lit.forEach((sg, j) => strokeSegs(ctx, sg, PAL[Math.floor(j / 3)][1], 1.4, [0.3, 0.2, 0.12][j % 3]));
  if (t > 14) {
    const chat = clamp((t - 14) / 20);
    for (let k = 1; k < NSH; k++) {
      const L = RADIAL[k];
      for (let j = k % 13; j < L.length; j += 13) {
        const i = L[j];
        const e = EDGES[i];
        const u = frac(t / (16 + 10 * hash(i * 1.7)) + hash(i * 3.3));
        const B = pos[e.b];
        const A = pos[e.a];
        if (!A || !B || outside(B) || fogOf(B.z) < 0.2) continue;
        if (chat < 1 && hash(i * 0.37) > chat) continue;
        sigGlow(A, B, u, NODES[e.b].hue, 0.4);
      }
    }
  }
  sig.forEach((sg, hue) => {
    strokeSegs(ctx, sg, PAL[hue][2], 4, 0.12);
    strokeSegs(ctx, sg, PAL[hue][1], 1.5, 0.6);
  });
  sgb.flush(ctx);
  const ngb = new GlowBatch();
  const wgb = new GlowBatch();
  // nodes: even layers bigger and brighter than odd ones so the shells read as layers
  for (let i = 0; i < NODES.length; i++) {
    const p = pos[i];
    if (!p || outside(p)) continue;
    const n = NODES[i];
    const act = actK[n.k];
    const bt = t - SHELL_DELAY[n.k];
    const flare = bt >= 0 ? Math.exp(-bt / 6) : 0;
    const pop = clamp(bt / 4) * (n.k < 4 ? 0.3 + 0.15 * n.k : 1);
    // the ragged outer rim fades out instead of ending in a hard edge
    const rimFade = n.k >= NSH - 2 ? 1.2 - 0.6 * n.rj : 1;
    const fog = fogOf(p.z) * rimFade * vis[n.k] * sparse[n.k] * born;
    if (fog < 0.03 || pop <= 0) continue;
    const odd = n.k % 2;
    const r = clamp(0.17 * p.s, 2.2, 10) * (odd ? 0.72 : 1.3) * (1 + 0.8 * act + 0.6 * flare);
    ngb.add(PAL[n.hue][n.lvl], p.x, p.y, Math.min(20, r * 2.5), (odd ? 0.42 : 0.66) * (1 + 0.6 * act) * fog * pop);
    const fl = n.k >= 3 ? flare : 0;
    if (act > 0.15 || n.h < 0.1 || fl > 0.2) wgb.add(WHITE, p.x, p.y, Math.min(9, r), (0.3 + 0.6 * act + 0.4 * fl) * fog * pop);
  }
  ngb.flush(ctx);
  wgb.flush(ctx);
  // the white-hot heart, beating with every wave
  let beat = 0;
  for (const wv of WAVES) {
    const dt = f - wv;
    if (dt >= 0 && dt < 30) beat = Math.max(beat, Math.exp(-dt / 7));
  }
  const settle = clamp((t - 6) / 20);
  glow(ctx, O.x, O.y, (170 + 120 * beat) * settle, mix(C.gold, WHITE, 0.5), (0.2 + 0.28 * beat) * settle, 0.06);
  glow(ctx, O.x, O.y, (30 + 20 * beat) * settle, WHITE, settle);
  // dust: drifts past the lens as the camera orbits and dives in
  const da = clamp((t - 20) / 30);
  if (da > 0) {
    for (const d of DUST) {
      const q = P(cam, d.p, 0.8);
      if (!q || outside(q)) continue;
      const rr = clamp(0.05 * q.s, 0.8, 9);
      const tw = 0.6 + 0.4 * noise1(f * 0.04 + d.tw);
      glow(ctx, q.x, q.y, rr * (1 + d.sz), "#cfe0ff", (0.22 * tw * da * clamp((q.z - 1) / 4)) / Math.sqrt(Math.max(1, rr / 2)));
    }
  }
};

// =============================================================================================

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

const drawScene = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  const cam = camAt(f);
  const O = project(cam, O3[0], O3[1], O3[2])!;
  drawBackground(ctx, w, h, f, cam, O);
  drawFloor(ctx, f, cam, 1 - prog(f, IMPACT + 5, IMPACT + 45));
  const inh = inhaleAt(f);
  if (inh > 0) {
    ctx.fillStyle = `rgba(0,0,0,${0.75 * inh})`;
    ctx.fillRect(0, 0, w, h);
  }
  // every effect goes onto an additive layer, so the caption band can be cleared without touching the sky
  const L = off(2, w, h);
  const g = L.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  drawMotes(g, f, cam);
  drawRays(g, f, O);
  drawNetwork(g, w, h, f, cam, O);
  drawStreams(g, f, cam);
  drawCore(g, w, f, cam, O);
  drawBlast(g, w, f, cam, O);
  const band = bandAt(f);
  if (band > 0) {
    g.globalCompositeOperation = "destination-out";
    // (during the streams the action sits low in the frame, so the fade starts lower there)
    const M0 = f < IMPACT ? 690 : 625;
    const M1 = 822;
    const m = g.createLinearGradient(0, M0, 0, M1);
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      m.addColorStop(u, `rgba(0,0,0,${band * u * u * (3 - 2 * u)})`);
    }
    g.fillStyle = m;
    g.fillRect(0, M0, w, h - M0);
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(L, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  // keep the caption band calm (darken whatever background is left there)
  if (band > 0) {
    const gr = ctx.createLinearGradient(0, 730, 0, h);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(0.45, `rgba(0,0,0,${0.55 * band})`);
    gr.addColorStop(1, `rgba(0,0,0,${0.75 * band})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 730, w, h - 730);
  }
};

// lateral chromatic aberration (radial RGB split around the blast) in the first frames after the impact
const caAt = (f: number) => {
  const t = f - IMPACT;
  if (t < 0 || t > 16) return 0;
  return 0.026 * Math.exp(-t / 9) * (1 - prog(t, 10, 16));
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
      const O = project(camAt(f), O3[0], O3[1], O3[2])!;
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

/** Stream labels: they ride along with the camera and leave before the charge peaks. */
const LABEL_IN = STREAMS + 20;
const LABEL_OUT = MEET + 14;
// offsets from each source on the floor (px): above the two side portals, beside the gold one
const LABEL_OFF = [
  { dx: 0, dy: -160 },
  { dx: 0, dy: -160 },
  { dx: 175, dy: -72 },
];
const Labels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = 1 - prog(frame, LABEL_OUT, LABEL_OUT + 16);
  if (a <= 0 || frame < LABEL_IN) return null;
  const cam = camAt(frame);
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {ARMS.map((arm, k) => {
        const S = P(cam, groundOf(k, 0));
        if (!S) return null;
        const t = ease.outCubic(prog(frame, LABEL_IN + k * 5, LABEL_IN + 20 + k * 5));
        const o = LABEL_OFF[k];
        return (
          <div
            key={arm.en}
            style={{
              position: "absolute",
              left: clamp(S.x + o.dx, 170, 1750),
              top: S.y + o.dy,
              transform: `translateX(-50%) translateY(${(1 - t) * 16}px)`,
              textAlign: "center",
              opacity: t,
            }}
          >
            <div
              style={{
                fontFamily: FONT_CN,
                fontWeight: 900,
                fontSize: 52,
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
  const sh = sumShake(shake(frame, IMPACT, 66, 50), shake(frame, IMPACT + 3, 26, 90), shake(frame, MEET, 22, 20));
  const tx = sh.x + (frame < IMPACT ? (noise1(frame * 0.9) - 0.5) * 12 * c * c : 0);
  const ty = sh.y + (frame < IMPACT ? (noise1(frame * 0.9 + 40) - 0.5) * 12 * c * c : 0);
  const rot = sh.r * 0.08;
  // zoom punch on the impact; the overscan is the smallest zoom at which the shaken, rolled frame still
  // covers the whole screen, so no edge ever shows
  const cr = Math.cos(rot);
  const sr = Math.abs(Math.sin(rot));
  const ex = 960 + Math.abs(tx);
  const ey = 540 + Math.abs(ty);
  const cover = 1.002 * Math.max((ex * cr + ey * sr) / 960, (ex * sr + ey * cr) / 540);
  const punch = Math.max(frame >= IMPACT ? 1 + 0.07 * Math.exp(-(frame - IMPACT) / 6) : 1, cover);
  const fade = Math.min(ease.outCubic(prog(frame, 0, 14)), 1 - prog(frame, DUR - 16, DUR));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) rotate(${rot}rad) scale(${punch})` }}>
          <World />
          <Labels />
        </AbsoluteFill>
        {/* mounted only from the impact on, so the frames before it stay the darkest of the inhale */}
        {frame >= IMPACT && <Flash at={IMPACT} dur={6} peak={1} />}
      </AbsoluteFill>
      <ChapterCard index={7} title="大爆发" en="THE EXPLOSION" color={C.gold} dur={80} />
      <Captions accent={C.gold} items={CAPS} />
    </AbsoluteFill>
  );
};
