import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, rgbOf, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, sumShake, TAU } from "../lib/math";
import { camera, project, type Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { YearStamp } from "../components/Hud";
import { HUMAN_ERR, IMAGENET } from "../data";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("alexnet");
const BARS = cue("alexnet", "bars");
const DROP = cue("alexnet", "drop");
const HUMAN = cue("alexnet", "human");
/** Bar rises: 2010, 2011, 2013, 2014, 2015 (2012 is the DROP slam). */
const RISE = ticks("alexnet", "bar");
/** A light ball hopping down the column tops, 2010 → 2015, once ResNet has landed. */
const HOPS = ticks("alexnet", "hop");
const RUNNER_UP = 26.2;
/** Payoff timing (after the human line has reached ResNet). */
const SINK0 = HUMAN + 40; // 2010/2011 sink into the dark
const PUSH0 = HUMAN + 50; // dolly toward ResNet
const PUSH1 = HUMAN + 114;
const FILL0 = HUMAN + 64; // the better-than-human zone fills with light
const FILL1 = HUMAN + 102;

const VIO = C.violet;
const MAG = C.magenta;
const LILAC = "#c9a8ff";
const GOLD = C.gold;

// ---------------------------------------------------------------------------
// 3D helpers

type V3 = [number, number, number];
type Pt = { x: number; y: number; s: number; z: number };
type Box = [number, number, number, number, number, number];
type Xf = { p: (l: V3) => V3; n: (l: V3) => V3 };

/** Camera orbiting `t` at distance D (Y down, positive pitch looks down). */
const lookAt = (t: V3, yaw: number, pitch: number, D: number, f: number, cx: number, cy: number): Cam => {
  const cp = Math.cos(pitch);
  return camera({ x: t[0] - D * cp * Math.sin(yaw), y: t[1] - D * Math.sin(pitch), z: t[2] - D * cp * Math.cos(yaw), yaw, pitch, f, cx, cy });
};

type Face = "front" | "back" | "top" | "bottom" | "left" | "right";
const FACES: { k: Face; n: V3; c: V3[] }[] = [
  { k: "back", n: [0, 0, 1], c: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]] },
  { k: "bottom", n: [0, 1, 0], c: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { k: "left", n: [-1, 0, 0], c: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] },
  { k: "right", n: [1, 0, 0], c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { k: "top", n: [0, -1, 0], c: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { k: "front", n: [0, 0, -1], c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
];
const IDENT: Xf = { p: (l) => l, n: (l) => l };

/** Draw the camera-facing faces of an (optionally transformed) box [x0,x1,y0,y1,z0,z1]. */
const drawBox = (cam: Cam, X: Xf, b: Box, paint: (k: Face, pts: Pt[]) => void) => {
  const [x0, x1, y0, y1, z0, z1] = b;
  for (const face of FACES) {
    const loc = face.c.map(([i, j, k]) => [i ? x1 : x0, j ? y1 : y0, k ? z1 : z0] as V3);
    const cl: V3 = [(loc[0][0] + loc[2][0]) / 2, (loc[0][1] + loc[2][1]) / 2, (loc[0][2] + loc[2][2]) / 2];
    const cw = X.p(cl);
    const n = X.n(face.n);
    if (n[0] * (cam.x - cw[0]) + n[1] * (cam.y - cw[1]) + n[2] * (cam.z - cw[2]) <= 0) continue;
    const pts: Pt[] = [];
    for (const l of loc) {
      const w = X.p(l);
      const p = project(cam, w[0], w[1], w[2]);
      if (!p) break;
      pts.push(p);
    }
    if (pts.length === 4) paint(face.k, pts);
  }
};

const polyPath = (ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
};

const font = (ctx: CanvasRenderingContext2D, w: number, px: number, mono = false) => {
  ctx.font = `${w} ${px}px ${mono ? FONT_MONO : FONT_CN}`;
};

// ---------------------------------------------------------------------------
// Beat 1: two GTX 580 cards; AlexNet, split in two lanes, flies out of them

/** 0 → hero layout, 1 → cards parked small in the upper right. */
const shrinkK = (f: number) => ease.inOutCubic(prog(f, BARS - 4, BARS + 28));
const netA = (f: number) => 1 - ease.inOutQuad(prog(f, BARS - 8, BARS + 8));
/** Parked over the slots still to come, so the right of the stage is never empty while 2010–2012 play out. */
const PARK = { x: 1440, y: 288, s: 0.44 };
/** Card-local points (fan, shroud corners, LED strip) that leave light trails during the swoop. */
const TRAIL_PTS: V3[] = [
  [0.84, 0, -0.2],
  [-1.4, -0.5, -0.2],
  [1.5, -0.5, -0.2],
  [-1.3, 0.35, -0.2],
  [0.3, 0.26, -0.2],
];
const CARD_C = { x: 1040, y: 664 };

const cardCam = (f: number) => lookAt([0, 0.02, 0], lerp(-0.07, 0.06, ease.inOutSine(prog(f, 0, 140))), 0.22, 10, 1880, CARD_C.x, CARD_C.y);

const groupT = (f: number) => {
  const k = shrinkK(f);
  return { k, x: lerp(CARD_C.x, PARK.x, k), y: lerp(CARD_C.y, PARK.y, k), s: lerp(1, PARK.s, k) };
};
const applyGroup = (g: { x: number; y: number; s: number }, p: { x: number; y: number }) => ({
  x: g.x + (p.x - CARD_C.x) * g.s,
  y: g.y + (p.y - CARD_C.y) * g.s,
});

const CARDS = [
  { x: -1.62, rot: -0.12, mir: 1, col: VIO },
  { x: 1.62, rot: 0.12, mir: -1, col: MAG },
];

const cardXf = (posX: number, rot: number, mir: number): Xf => {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return {
    p: (l) => {
      const x = l[0] * mir;
      return [posX + x * cr + l[2] * sr, l[1], -x * sr + l[2] * cr];
    },
    n: (l) => {
      const x = l[0] * mir;
      return [x * cr + l[2] * sr, l[1], -x * sr + l[2] * cr];
    },
  };
};

/** Card-local point on the top edge of the shroud above the fan, where a card's lane of the network comes from. */
const EMIT: V3 = [0.84, -0.52, -0.05];
/** 0..1 breathing of a card's LEDs; its lane of the network pulses with it. */
const ledPulse = (ci: number, f: number) => 0.5 + 0.5 * Math.sin(f * 0.21 + ci * 2.1);
/** The parked cards bounce when the AlexNet column lands. */
const cardJolt = (f: number) => {
  const t = f - DROP;
  return t < 0 || t > 30 ? 0 : -20 * Math.exp(-t / 5) * Math.cos(t * 0.95);
};
/** The cards leave once the chart no longer needs them (before the human line arrives). */
const cardFade = (f: number) => 1 - ease.inOutCubic(prog(f, HUMAN - 24, HUMAN + 6));
/** A gentle push-in on the opening shot, released as the cards swoop away. */
const heroZoom = (f: number) => 1 + 0.05 * ease.inOutSine(prog(f, 12, 68)) * (1 - shrinkK(f));

const drawCard = (ctx: CanvasRenderingContext2D, cam: Cam, f: number, ci: number, hot: number, labA = 1) => {
  const { x: posX, rot, mir, col } = CARDS[ci];
  const X = cardXf(posX, rot, mir);
  const P = (x: number, y: number, z: number) => {
    const w = X.p([x, y, z]);
    return project(cam, w[0], w[1], w[2])!;
  };
  const faceP = (pts: [number, number][], z: number) => polyPath(ctx, pts.map(([x, y]) => P(x, y, z)));
  const ring = (cx: number, cy: number, r: number, z: number, n = 44) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const p = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.closePath();
  };
  const FZ = -0.2; // front plane of the shroud
  const pulse = 0.5 + 0.5 * ledPulse(ci, f);

  // floor glow
  ctx.globalCompositeOperation = "lighter";
  const fg = P(0.05, 0.64, 0);
  ctx.save();
  ctx.translate(fg.x, fg.y);
  ctx.scale(1, 0.12);
  glow(ctx, 0, 0, 1.9 * fg.s, col, 0.3 + 0.4 * hot, 0.05);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // PCB, power connectors, SLI fingers, PCIe fingers
  drawBox(cam, X, [-1.46, 1.52, -0.6, 0.56, 0.1, 0.15], (k, pts) => {
    polyPath(ctx, pts);
    ctx.fillStyle = k === "front" ? "#0b0f18" : "#1a2233";
    ctx.fill();
  });
  for (const px of [0.92, 1.2]) {
    drawBox(cam, X, [px, px + 0.22, -0.7, -0.6, -0.02, 0.1], (k, pts) => {
      polyPath(ctx, pts);
      ctx.fillStyle = k === "top" ? "#2a2f3c" : "#11141c";
      ctx.fill();
    });
  }
  drawBox(cam, X, [-0.95, 0.55, 0.56, 0.645, 0.105, 0.145], (k, pts) => {
    polyPath(ctx, pts);
    ctx.fillStyle = k === "front" ? "#c9952e" : "#8a6418";
    ctx.fill();
  });
  ctx.strokeStyle = "rgba(40,24,0,0.6)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const x = -0.93 + (i / 30) * 1.46;
    const a = P(x, 0.575, 0.104);
    const b = P(x, 0.64, 0.104);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  drawBox(cam, X, [-1.0, -0.78, -0.65, -0.6, 0.105, 0.145], (_k, pts) => {
    polyPath(ctx, pts);
    ctx.fillStyle = "#b8862a";
    ctx.fill();
  });

  // shroud
  drawBox(cam, X, [-1.4, 1.5, -0.5, 0.5, FZ, 0.1], (k, pts) => {
    polyPath(ctx, pts);
    if (k === "front") {
      const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[3].x, pts[3].y);
      g.addColorStop(0, "#2a2e3d");
      g.addColorStop(1, "#11131b");
      ctx.fillStyle = g;
    } else ctx.fillStyle = k === "top" ? "#353a4b" : "#181b25";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,130,160,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  // raised angular panel
  faceP(
    [
      [-1.32, -0.42],
      [0.26, -0.42],
      [0.36, -0.3],
      [0.36, 0.3],
      [0.26, 0.42],
      [-1.32, 0.42],
    ],
    FZ - 0.001,
  );
  const pg = P(-0.5, -0.42, FZ);
  const pg2 = P(-0.5, 0.42, FZ);
  const panel = ctx.createLinearGradient(pg.x, pg.y, pg2.x, pg2.y);
  panel.addColorStop(0, "#343a4e");
  panel.addColorStop(0.5, "#22263a");
  panel.addColorStop(1, "#171a26");
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = "rgba(170,180,215,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // vents near the bracket
  ctx.fillStyle = "#07080c";
  for (let i = 0; i < 6; i++) {
    const y = -0.3 + i * 0.12;
    faceP(
      [
        [-1.28, y],
        [-1.1, y - 0.05],
        [-1.1, y - 0.01],
        [-1.28, y + 0.04],
      ],
      FZ - 0.002,
    );
    ctx.fill();
  }
  // fan: dark well, blurred blades, hub, LED ring
  const FX = 0.84;
  const FR = 0.4;
  ring(FX, 0, FR + 0.03, FZ - 0.001);
  ctx.fillStyle = "#3a3f52";
  ctx.fill();
  ring(FX, 0, FR, FZ - 0.002);
  const fc = P(FX, 0, FZ);
  const well = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, FR * fc.s);
  well.addColorStop(0, "#151824");
  well.addColorStop(1, "#040509");
  ctx.fillStyle = well;
  ctx.fill();
  const spin = f * 0.36 * mir + ci;
  const NB = 13;
  for (let m = 0; m < 3; m++) {
    ctx.fillStyle = withAlpha("#8a93b0", [0.55, 0.28, 0.14][m]);
    for (let b = 0; b < NB; b++) {
      const a = spin - m * 0.1 + (b / NB) * TAU;
      const pts: [number, number][] = [
        [FX + Math.cos(a) * 0.12, Math.sin(a) * 0.12],
        [FX + Math.cos(a + 0.16) * 0.12, Math.sin(a + 0.16) * 0.12],
        [FX + Math.cos(a + 0.5) * 0.37, Math.sin(a + 0.5) * 0.37],
        [FX + Math.cos(a + 0.36) * 0.37, Math.sin(a + 0.36) * 0.37],
      ];
      faceP(pts, FZ - 0.003);
      ctx.fill();
    }
  }
  ring(FX, 0, 0.115, FZ - 0.004);
  ctx.fillStyle = "#1c2030";
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  glowStroke(ctx, () => ring(FX, 0, FR + 0.015, FZ - 0.005), col, 2.2, 0.55 + 0.35 * pulse + 0.4 * hot);
  glowStroke(ctx, () => ring(FX, 0, 0.08, FZ - 0.005, 24), col, 1.6, 0.7);
  glow(ctx, fc.x, fc.y, 0.12 * fc.s, col, 0.6 + 0.4 * hot);
  // LED strips along the panel + top edge of the shroud
  const strip = (pts: [number, number][], w: number, a: number) =>
    glowStroke(
      ctx,
      () => {
        pts.forEach(([x, y], i) => {
          const p = P(x, y, FZ - 0.006);
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
      },
      col,
      w,
      a,
    );
  strip(
    [
      [-1.3, 0.35],
      [0.22, 0.35],
      [0.3, 0.26],
    ],
    2,
    0.75 * pulse + 0.4 * hot,
  );
  strip(
    [
      [-1.4, -0.5],
      [1.5, -0.5],
    ],
    1.6,
    0.55 + 0.3 * hot,
  );
  ctx.globalCompositeOperation = "source-over";
  // label printed on the shroud (affine approximation of the perspective at the label)
  const LX = -0.47;
  const LY = 0.03;
  const o = P(LX, LY, FZ - 0.007);
  const ux = P(LX + 0.01 * mir, LY, FZ - 0.007);
  const uy = P(LX, LY + 0.01, FZ - 0.007);
  ctx.save();
  ctx.globalAlpha *= labA;
  ctx.transform(ux.x - o.x, ux.y - o.y, uy.x - o.x, uy.y - o.y, o.x, o.y);
  ctx.font = `800 25px ${FONT_MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = col;
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("GTX 580", 0, 0);
  ctx.shadowBlur = 0;
  ctx.restore();
  // bracket
  drawBox(cam, X, [-1.55, -1.5, -0.64, 0.66, -0.27, 0.15], (k, pts) => {
    polyPath(ctx, pts);
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
    g.addColorStop(0, "#b9c0cf");
    g.addColorStop(1, "#5d6475");
    ctx.fillStyle = k === "front" || k === "left" || k === "right" ? g : "#8d94a6";
    ctx.fill();
  });
};

// ---- AlexNet: input photo, then two lanes of conv slabs (one per GPU) --------

type Kind = "img" | "conv" | "fc" | "out";
type Slab = { id: number; lane: number; layer: number; kind: Kind; cx: number; cy: number; w: number; h: number; d: number; gx: number; gy: number };
const LANE_Y = 0.6;
/** centre x, face size, depth (channels), grid, kind */
const LAYERS: [number, number, number, number, Kind][] = [
  [1.75, 1.0, 0.25, 9, "conv"],
  [2.95, 0.8, 0.5, 7, "conv"],
  [3.95, 0.56, 0.8, 5, "conv"],
  [4.8, 0.56, 0.8, 5, "conv"],
  [5.65, 0.56, 0.65, 5, "conv"],
  [6.45, 0.14, 0.14, 9, "fc"],
  [6.9, 0.14, 0.14, 9, "fc"],
];
const OUT_X = 7.56;
const SLABS: Slab[] = (() => {
  const out: Slab[] = [{ id: 0, lane: -1, layer: -1, kind: "img", cx: 0, cy: 0, w: 1.6, h: 1.6, d: 0.05, gx: 16, gy: 16 }];
  for (const lane of [0, 1])
    LAYERS.forEach(([cx, s, d, g, kind], i) => {
      const fc = kind === "fc";
      out.push({ id: 1 + lane * 10 + i, lane, layer: i, kind, cx, cy: lane ? LANE_Y : -LANE_Y, w: s, h: fc ? 1.0 : s, d, gx: fc ? 1 : g, gy: g });
    });
  out.push({ id: 30, lane: -1, layer: 7, kind: "out", cx: OUT_X, cy: 0, w: 0.12, h: 2.0, d: 0.12, gx: 1, gy: 10 });
  return out;
})();
const slabById = (id: number) => SLABS.find((q) => q.id === id)!;
const laneCol = (lane: number) => (lane === 0 ? VIO : lane === 1 ? MAG : LILAC);

const NET_CX = 1238;
const NET_CY = 328;
const netCam = (f: number) =>
  lookAt([3.75, 0, 0.5], lerp(0.27, 0.19, ease.inOutSine(prog(f, 0, 90))), 0.1, lerp(14.7, 13.9, ease.outCubic(prog(f, 0, 90))), 2040, NET_CX, NET_CY);

/** The input photo: a 16x16 pixel-art cat on a sky background. */
const CAT = [
  "................",
  "..d..........d..",
  "..dd........dd..",
  "..odd......ddo..",
  "..oooooooooooo..",
  ".oooooooooooooo.",
  ".ooeeooooooeeoo.",
  ".ooek" + "oooooo" + "keoo.",
  ".oooooooooooooo.",
  ".ooooownnwooooo.",
  "..oooowwwwoooo..",
  "...oooooooooo...",
  "....oooooooo....",
  "...oooooooooo...",
  "..oooooooooooo..",
  ".oooooooooooooo.",
];
const catColor = (i: number, j: number) => {
  const ch = CAT[j]?.[i] ?? ".";
  const n = hash(i * 7.3 + j * 3.1);
  switch (ch) {
    case "o":
      return mix("#ffa142", "#d8661a", n * 0.6 + (j > 12 ? 0.3 : 0));
    case "d":
      return mix("#c25a14", "#8a3a0c", n * 0.5);
    case "e":
      return "#a8ff5a";
    case "k":
      return "#0b1408";
    case "w":
      return mix("#ffe2c0", "#f6c89a", n);
    case "n":
      return "#ff7aa8";
    default:
      return mix("#6aaeff", "#1d3d8a", j / 15 + n * 0.12);
  }
};

const netWave = (f: number) => ((f - 12) * 0.16) % 10 - 1;

/** Where a lane's slabs come from: the top of its card's shroud, in screen space. */
const emitters = (ccam: Cam, g: { x: number; y: number; s: number }) =>
  CARDS.map((c) => {
    const w = cardXf(c.x, c.rot, c.mir).p(EMIT);
    const p = project(ccam, w[0], w[1], w[2]);
    return p ? applyGroup(g, p) : { x: CARD_C.x, y: CARD_C.y };
  });

const slabOrder = (sl: Slab) => (sl.kind === "img" ? 0 : sl.kind === "out" ? 8.4 : sl.layer + 1);
/** Slabs fly out of their card one layer after another, once the fade-in from black is done. */
const assemble = (f: number, sl: Slab) => ease.outCubic(clamp((f - 10 - slabOrder(sl) * 3.2) / 16));

const drawSlab = (ctx: CanvasRenderingContext2D, cam: Cam, sl: Slab, f: number, A: number) => {
  const col = laneCol(sl.lane);
  const b: Box = [sl.cx - sl.w / 2, sl.cx + sl.w / 2, sl.cy - sl.h / 2, sl.cy + sl.h / 2, 0, sl.d];
  drawBox(cam, IDENT, b, (k, pts) => {
    polyPath(ctx, pts);
    if (k === "front") {
      ctx.fillStyle = sl.kind === "img" ? "#05070e" : mix("#0a0616", col, 0.2);
      ctx.fill();
      const g: (Pt | null)[][] = [];
      for (let i = 0; i <= sl.gx; i++) {
        g.push([]);
        for (let j = 0; j <= sl.gy; j++) g[i].push(project(cam, b[0] + (i / sl.gx) * sl.w, b[2] + (j / sl.gy) * sl.h, -0.002));
      }
      const img = sl.kind === "img";
      ctx.globalCompositeOperation = img ? "source-over" : "lighter";
      const ins = img ? 0.04 : sl.kind === "conv" ? 0.16 : 0.2;
      for (let i = 0; i < sl.gx; i++)
        for (let j = 0; j < sl.gy; j++) {
          const p00 = g[i][j];
          const p10 = g[i + 1][j];
          const p11 = g[i + 1][j + 1];
          const p01 = g[i][j + 1];
          if (!p00 || !p10 || !p11 || !p01) continue;
          const cx = (p00.x + p11.x) / 2;
          const cy = (p00.y + p11.y) / 2;
          const sh = (p: Pt) => ({ x: p.x + (cx - p.x) * ins, y: p.y + (cy - p.y) * ins });
          polyPath(ctx, [sh(p00), sh(p10), sh(p11), sh(p01)]);
          if (img) ctx.fillStyle = catColor(i, j);
          else {
            const h = hash(i * 7.1 + j * 3.7 + sl.id * 13.3 + Math.floor(f / 3) * 0.37);
            let v = A * (0.18 + 0.82 * h * h);
            if (sl.kind === "out") v = j === 3 ? clamp(0.2 + 1.6 * A) : 0.08 + 0.25 * A * h;
            ctx.fillStyle = withAlpha(mix(col, "#ffffff", v * 0.6), clamp(0.12 + v));
          }
          ctx.fill();
        }
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.fillStyle = mix("#0a0616", col, k === "top" ? 0.42 + 0.3 * A : 0.26 + 0.2 * A);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.4), 0.3 + 0.5 * A);
    ctx.lineWidth = 1.3;
    polyPath(ctx, pts);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  });
};

const drawNet = (ctx: CanvasRenderingContext2D, cam: Cam, f: number, a: number, em: { x: number; y: number }[]) => {
  if (a <= 0.01) return;
  const wv = netWave(f);
  const act = (x: number) => 0.22 + 0.78 * Math.exp(-((x - wv) * (x - wv)) / 0.5);
  const live = clamp((f - 30) / 14);
  /** Each lane breathes with its own card's LEDs, so the colours bind card ↔ lane. */
  const laneK = (lane: number) => (lane < 0 ? 1 : 0.72 + 0.5 * ledPulse(lane, f) * live);

  // halos behind each lane and the photo
  ctx.globalCompositeOperation = "lighter";
  for (const lane of [0, 1]) {
    const hp = project(cam, 4.2, lane ? LANE_Y : -LANE_Y, 0.5);
    if (hp) glow(ctx, hp.x, hp.y, 430, laneCol(lane), 0.16 * a * laneK(lane), 0.02);
  }
  const ip = project(cam, 0, 0, 0);
  if (ip) glow(ctx, ip.x, ip.y, 300, C.ice, 0.1 * a, 0.02);
  ctx.globalCompositeOperation = "source-over";

  // slabs, far → near; lane slabs fly out of their card
  const order = SLABS.map((sl) => ({ sl, z: project(cam, sl.cx, sl.cy, sl.d / 2)?.z ?? 0 })).sort((p, q) => q.z - p.z);
  for (const { sl } of order) {
    const ap = assemble(f, sl);
    if (ap <= 0) continue;
    const P = project(cam, sl.cx, sl.cy, sl.d / 2);
    if (!P) continue;
    const O = sl.lane >= 0 ? em[sl.lane] : P;
    const k = lerp(sl.lane >= 0 ? 0.12 : 0.6, 1, ap);
    const cx = lerp(O.x, P.x, ap);
    const cy = lerp(O.y, P.y, ap);
    if (sl.lane >= 0 && ap < 1) {
      // light streak behind the flying slab
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(O.x, O.y, cx, cy);
      g.addColorStop(0, withAlpha(laneCol(sl.lane), 0));
      g.addColorStop(1, withAlpha(mix(laneCol(sl.lane), "#ffffff", 0.4), 0.8 * a * (1 - ap)));
      ctx.strokeStyle = g;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(O.x, O.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.save();
    ctx.globalAlpha = a * clamp(ap * 1.6);
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.translate(-P.x, -P.y);
    drawSlab(ctx, cam, sl, f, sl.kind === "img" ? 1 : Math.min(1.15, (act(sl.cx) * live + (1 - live) * 0.35) * laneK(sl.lane)));
    ctx.restore();
  }

  // power ribbons: each card feeds its own lane (drawn over the slabs; the violet one threads the gap in the magenta lane)
  const tg = [project(cam, 2.4, -LANE_Y + 0.42, 0.1), project(cam, 4.38, LANE_Y + 0.3, 0.1)];
  ctx.globalCompositeOperation = "lighter";
  for (const lane of [0, 1]) {
    const E = em[lane];
    const T = tg[lane];
    if (!T) continue;
    const ba = a * ease.outCubic(clamp((f - 10) / 14));
    if (ba <= 0.01) continue;
    const col = laneCol(lane);
    const lp = ledPulse(lane, f);
    const grow = ease.inOutCubic(clamp((f - 10) / 16));
    const Cx = E.x + (T.x - E.x) * 0.08;
    const Cy = lerp(E.y, T.y, 0.7);
    const at = (u: number) => {
      const v = 1 - u;
      return { x: v * v * E.x + 2 * v * u * Cx + u * u * T.x, y: v * v * E.y + 2 * v * u * Cy + u * u * T.y };
    };
    const path = () => {
      for (let i = 0; i <= 28; i++) {
        const p = at((i / 28) * grow);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
    };
    glowStroke(ctx, path, col, 7, 0.3 * ba * (0.6 + 0.6 * lp));
    glowStroke(ctx, path, mix(col, "#ffffff", 0.25), 1.8, 0.9 * ba);
    // bright packets running card → lane
    for (let i = 0; i < 7; i++) {
      const u = (f * 0.042 + i / 7 + lane * 0.07) % 1;
      if (u > grow) continue;
      const p = at(u);
      const env = Math.min(1, u * 6, (1 - u) * 6);
      glow(ctx, p.x, p.y, 20, col, 0.75 * ba * env);
      glow(ctx, p.x, p.y, 6, "#ffffff", ba * env);
    }
    glow(ctx, E.x, E.y, 36 + 14 * lp, col, (0.55 + 0.45 * lp) * ba);
    const hT = at(grow);
    glow(ctx, hT.x, hT.y, 30 + 12 * lp, col, (0.45 + 0.45 * lp) * ba);
  }
  ctx.globalCompositeOperation = "source-over";

  const la = a * live;
  if (la <= 0.01) return;
  ctx.globalCompositeOperation = "lighter";
  // receptive fields: a kernel window on one layer feeding one point of the next
  const img = SLABS[0];
  for (const lane of [0, 1]) {
    const col = laneCol(lane);
    const chain = [img, ...SLABS.filter((q) => q.lane === lane && q.kind === "conv")];
    for (let L = 0; L < chain.length - 1; L++) {
      const A = chain[L];
      const B = chain[L + 1];
      const u = 0.3 * Math.sin(f * 0.05 + L * 1.3 + lane * 2.1);
      const v = 0.3 * Math.cos(f * 0.041 + L * 0.7 + lane * 1.3);
      const kk = (A.kind === "img" ? 0.13 : 0.22) * A.w;
      const ax = A.cx + u * A.w * 0.6;
      const ay = (A.kind === "img" ? (lane ? 0.36 : -0.36) : A.cy) + v * (A.kind === "img" ? 0.6 : A.h);
      const tgt = project(cam, B.cx + u * B.w * 0.7, B.cy + v * B.h * 0.7, -0.003);
      const cs = [
        project(cam, ax - kk / 2, ay - kk / 2, -0.003),
        project(cam, ax + kk / 2, ay - kk / 2, -0.003),
        project(cam, ax + kk / 2, ay + kk / 2, -0.003),
        project(cam, ax - kk / 2, ay + kk / 2, -0.003),
      ];
      if (!tgt || cs.some((c) => !c)) continue;
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.3), 0.42 * la);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const c of cs) {
        ctx.moveTo(c!.x, c!.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#ffffff", 0.85 * la);
      ctx.lineWidth = 1.6;
      polyPath(ctx, cs as Pt[]);
      ctx.stroke();
      glow(ctx, tgt.x, tgt.y, 0.07 * tgt.s, col, 0.9 * la);
    }
  }
  // the two GPUs talk only at a few layers
  const links: [number, number][] = [
    [2, 13],
    [12, 3],
    [5, 16],
    [15, 6],
    [6, 17],
    [16, 7],
    [7, 30],
    [17, 30],
  ];
  links.forEach(([p, q], li) => {
    const A = slabById(p);
    const B = slabById(q);
    for (let n = 0; n < 3; n++) {
      const pa = project(cam, A.cx + A.w / 2, A.cy + (hash(n * 3 + li) - 0.5) * A.h * 0.7, A.d * hash(n + li * 9));
      const pb = project(cam, B.cx - B.w / 2, B.cy + (hash(n * 7 + li) - 0.5) * B.h * 0.7, B.d * hash(n * 5 + li));
      if (!pa || !pb) continue;
      ctx.strokeStyle = withAlpha("#ffffff", 0.16 * la);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  });
  // signal particles flowing photo → conv → dense → output along each lane
  for (const lane of [0, 1]) {
    const col = laneCol(lane);
    const ly = lane ? LANE_Y : -LANE_Y;
    const path: V3[] = [[0, ly * 0.45, -0.02], ...LAYERS.map(([x]) => [x, ly, -0.02] as V3), [OUT_X, ly * 0.4, -0.02]];
    for (let i = 0; i < 64; i++) {
      const u = (f * 0.0125 + hash(i * 3.3 + lane * 71)) % 1;
      const segf = u * (path.length - 1);
      const si = Math.floor(segf);
      const t = segf - si;
      const p0 = path[si];
      const p1 = path[si + 1];
      const spread = lerp(0.7, 0.12, u);
      const p = project(cam, lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t) + (hash(i * 2.9 + lane) - 0.5) * spread, -0.02);
      if (!p) continue;
      glow(ctx, p.x, p.y, 0.05 * p.s + 2.5, col, 0.9 * la * Math.min(1, u * 8, (1 - u) * 8) * laneK(lane));
    }
  }
  // the answer lights up at the output
  const op = project(cam, OUT_X, -1.0 + 3.5 * 0.2, -0.01);
  if (op) glow(ctx, op.x, op.y, 46, LILAC, la * clamp(0.2 + 1.4 * act(OUT_X)) * 0.8);
  ctx.globalCompositeOperation = "source-over";
};

/** GPU load: the parked cards rev up before the slam and flare whenever a column lands, hardest on AlexNet. */
const cardHot = (f: number) => {
  let h = 0.45 * antK(f);
  for (const i of [0, 1, 3, 4, 5]) {
    const t = f - landOf(i);
    if (t >= 0) h = Math.max(h, 0.6 * Math.exp(-t / 10));
  }
  const t = f - DROP;
  if (t >= 0) h = Math.max(h, 1.6 * Math.exp(-t / 18));
  return h;
};

const HeroCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, _w, _h, f) => {
      const cardA = cardFade(f);
      const na = netA(f);
      if (cardA <= 0.002 && na <= 0.01) return;
      const g0 = groupT(f);
      const g = { ...g0, y: g0.y + cardJolt(f) };
      const ccam = cardCam(f);
      const em = emitters(ccam, g);
      const Z = heroZoom(f);
      const base = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(960, 460);
        ctx.scale(Z, Z);
        ctx.translate(-960, -460);
      };
      base();
      if (na > 0.01) {
        // the network lifts away up and to the right while it dissolves
        const ncam = netCam(f);
        const out = ease.inQuad(1 - na);
        ctx.save();
        ctx.translate(NET_CX + 90 * out, NET_CY - 50 * out);
        ctx.scale(1 + 0.08 * out, 1 + 0.08 * out);
        ctx.translate(-NET_CX, -NET_CY);
        drawNet(ctx, ncam, f, na, em);
        ctx.restore();
      }
      const hot = cardHot(f);
      if (cardA <= 0.002) return;
      // the shroud print is unreadable at parking size, so it fades out on the way
      const labA = 1 - ease.inOutQuad(prog(g.k, 0.12, 0.55));
      // light streaks trailing the swoop to the parking spot
      const g2 = groupT(f - 2);
      const trail = clamp((Math.hypot(g.x - g2.x, g.y - g2.y) - 6) / 50);
      if (trail > 0.01) {
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        CARDS.forEach((c) => {
          const X = cardXf(c.x, c.rot, c.mir);
          for (const a of TRAIL_PTS) {
            const wpt = X.p(a);
            const p = project(ccam, wpt[0], wpt[1], wpt[2]);
            if (!p) continue;
            let prev = applyGroup(g, p);
            for (let k = 1; k <= 9; k++) {
              const gk = groupT(f - k * 0.8);
              const q = applyGroup(gk, p);
              const fall = 1 - k / 10;
              ctx.strokeStyle = withAlpha(c.col, 0.1 * trail * fall);
              ctx.lineWidth = 16 * gk.s;
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
              ctx.strokeStyle = withAlpha(mix(c.col, "#ffffff", 0.45), 0.7 * trail * fall);
              ctx.lineWidth = 2.5 * fall + 0.5;
              ctx.stroke();
              prev = q;
            }
          }
        });
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.save();
      ctx.globalAlpha = cardA;
      for (let ci = 0; ci < 2; ci++) {
        base();
        ctx.translate(g.x, g.y);
        ctx.scale(g.s, g.s);
        ctx.translate(-CARD_C.x, -CARD_C.y);
        drawCard(ctx, ccam, f, ci, hot, labA);
      }
      ctx.restore();
      base();
      // LED flare that still reads at parking size
      if (hot > 0.02 && g.k > 0.5) {
        ctx.globalCompositeOperation = "lighter";
        CARDS.forEach((c) => {
          const wpt = cardXf(c.x, c.rot, c.mir).p([0.6, 0, -0.2]);
          const p = project(ccam, wpt[0], wpt[1], wpt[2]);
          if (!p) return;
          const q = applyGroup(g, p);
          glow(ctx, q.x, q.y, 80 + 70 * Math.min(1, hot), c.col, 0.32 * Math.min(1.2, hot) * cardA, 0.04);
        });
        ctx.globalCompositeOperation = "source-over";
      }
    }}
  />
);

// ---------------------------------------------------------------------------
// Backdrop

const Backdrop: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const k = shrinkK(f);
      const bg = ctx.createRadialGradient(w * lerp(0.58, 0.45, k), h * lerp(0.4, 0.42, k), 0, w * 0.5, h * 0.5, w * 0.85);
      bg.addColorStop(0, "#1d0e38");
      bg.addColorStop(0.45, "#0b0619");
      bg.addColorStop(1, "#020108");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 46; i++) {
        const x = ((hash(i * 3.7) * 1.2 - 0.1) * w + f * (0.15 + hash(i) * 0.4)) % (w * 1.1);
        const y = hash(i * 9.1) * h * 0.8 + Math.sin(f * 0.01 + i) * 20;
        glow(ctx, x, y, 14 + 40 * hash(i * 5.3), i % 3 ? VIO : MAG, 0.05 + 0.07 * hash(i * 2.1), 0.3);
      }
      ctx.globalCompositeOperation = "source-over";
    }}
  />
);

// ---------------------------------------------------------------------------
// Beats 2–4: the ImageNet error-rate chart, as 3D columns on a glossy floor

/** World units per percentage point. */
const U = 0.1;
const BWD = 0.62;
/** Column depth: shallower than wide, so the top faces stay thin once the camera drops to the human line. */
const DEP = 0.44;
/** Evenly spaced slots: the runner-up ghost stands right behind the AlexNet column, so no slot is reserved for it. */
const SLOT_X = [-2.95, -1.77, -0.59, 0.59, 1.77, 2.95];
/** The runner-up ghost: same footprint class as a column, just behind AlexNet and peeking out to its right. */
const GHOST_X0 = SLOT_X[2] + 0.04;
const GHOST_X1 = SLOT_X[2] + 0.6;
const GHOST_Z0 = DEP / 2 + 0.02;
const GHOST_Z1 = DEP / 2 + 0.4;
const X_L = -3.75;
const X_R = 3.45;
const HY = -HUMAN_ERR * U;
const FZ0 = -DEP / 2;
/** The human line lives on the columns' front plane, so ResNet's top reads clearly below it. */
const LZ = FZ0 - 0.005;
const NAMES = IMAGENET.map((d) => d.label);
const riseOf = (i: number) => RISE[i < 2 ? i : i - 1];
/** The frame a column settles (2012 is the slam). */
const landOf = (i: number) => (i === 2 ? DROP : riseOf(i) + (i < 2 ? 10 : 8));
const colT = (f: number, i: number) => clamp((f - riseOf(i)) / (i < 2 ? 16 : 12));
/** Captions own the band below this line while they are up. */
const CAP_Y = 812;

// ---- camera: intro swoop, a lean toward the empty 2012 slot, a descent to the human line (all six columns in frame),
// then a dolly onto ResNet once 2010/2011 have sunk into the dark
type CK = { yaw: number; pitch: number; D: number; tx: number; ty: number; cy: number };
const CK_IN: CK = { yaw: 0.15, pitch: 0.36, D: 22, tx: 0.1, ty: -1.3, cy: 470 };
const CK_MAIN: CK = { yaw: -0.03, pitch: 0.16, D: 16, tx: 0.0, ty: -1.3, cy: 470 };
const CK_LOW: CK = { yaw: 0.03, pitch: 0.022, D: 13.0, tx: 0.62, ty: -0.76, cy: 524 };
const CK_END: CK = { yaw: 0.05, pitch: 0.03, D: 9.0, tx: 1.75, ty: -0.6, cy: 474 };
const lerpCK = (a: CK, b: CK, t: number): CK => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  D: lerp(a.D, b.D, t),
  tx: lerp(a.tx, b.tx, t),
  ty: lerp(a.ty, b.ty, t),
  cy: lerp(a.cy, b.cy, t),
});
/** Tension before the slam (0..1), released right after the hit. */
const antK = (f: number) => ease.inOutSine(prog(f, DROP - 44, DROP - 2)) * (1 - ease.inOutCubic(prog(f, DROP + 2, DROP + 34)));
const chartCK = (f: number): CK => {
  let k = lerpCK(CK_IN, CK_MAIN, ease.outCubic(prog(f, BARS, BARS + 52)));
  k.yaw += 0.04 * ease.inOutSine(prog(f, BARS + 30, HUMAN));
  // lean in on the empty 2012 slot so the slam fills more of the frame
  const lean = ease.inOutSine(prog(f, DROP - 44, DROP - 2)) * (1 - ease.inOutCubic(prog(f, DROP + 8, DROP + 60)));
  k.D *= 1 - 0.12 * lean;
  k.tx = lerp(k.tx, SLOT_X[2], 0.4 * lean);
  k.cy -= 12 * lean;
  k = lerpCK(k, CK_LOW, ease.inOutCubic(prog(f, HUMAN - 32, HUMAN + 26)));
  k = lerpCK(k, CK_END, ease.inOutCubic(prog(f, PUSH0, PUSH1)));
  k.D *= 1 - 0.03 * prog(f, PUSH1, DUR);
  return k;
};
const chartCam = (f: number) => {
  const k = chartCK(f);
  return lookAt([k.tx, k.ty, 0], k.yaw, k.pitch, k.D, 2700, 960, k.cy);
};
/** Where the AlexNet column hits the floor, on screen (the flash, vignette and zoom punch centre on it). */
const IMPACT_PT = project(chartCam(DROP), SLOT_X[2], 0, FZ0)!;

/** Back-out easing with adjustable overshoot. */
const backOut = (t: number, s: number) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const chartA = (f: number) => ease.outCubic(prog(f, BARS + 2, BARS + 24));
const SWEEP = 28;
const humanSweep = (f: number) => ease.inOutCubic(prog(f, HUMAN, HUMAN + SWEEP));
/** The frame the sweeping human line reaches the ResNet column. */
const CONTACT = (() => {
  for (let f = HUMAN; f < HUMAN + SWEEP; f++) if (lerp(X_L, X_R, humanSweep(f)) >= SLOT_X[5] - BWD / 2) return f;
  return HUMAN + SWEEP;
})();
const resnetLit = (f: number) => ease.outCubic(prog(f, CONTACT, CONTACT + 12));
/** Where the human line touches ResNet, on screen (the contact punch and bloom centre on it). */
const CONTACT_PT = project(chartCam(CONTACT), SLOT_X[5], -IMAGENET[5].err * U, FZ0)!;
/** Everything but ResNet steps back once the human line is in play, and a little more during the dolly. */
const oldK = (f: number) => ease.inOutCubic(prog(f, HUMAN - 24, HUMAN + 24)) + 0.35 * ease.inOutCubic(prog(f, PUSH0, PUSH1));
/** 2010 and 2011 sink into the dark before the dolly would carry them off the left edge. */
const sinkK = (f: number) => ease.inOutCubic(prog(f, SINK0, PUSH0 + 22));
/** The runner-up ghost and the drop arrow clear the stage once caption 2 has made its point. */
const clutterA = (f: number) => 1 - ease.inOutCubic(prog(f, HOPS[0], HOPS[HOPS.length - 1]));
/** The better-than-human zone fills from the floor up to the line. */
const fillK = (f: number) => ease.inOutCubic(prog(f, FILL0, FILL1));

type Style = { c0: string; c1: string; edge: string; side: string; top: string };
const ST_OLD: Style = { c0: "#1a2236", c1: "#5d7099", edge: "#b8c6ea", side: "#111727", top: "#8193bd" };
const ST_ALEX: Style = { c0: "#4a1fc0", c1: "#c47dff", edge: "#f5ebff", side: "#2a1170", top: "#e6caff" };
const ST_DEEP: Style = { c0: "#6a1580", c1: "#ff5fd2", edge: "#ffd6f4", side: "#3c0a49", top: "#ffa3e8" };
const ST_GOLD: Style = { c0: "#8a5200", c1: "#ffe08a", edge: "#fff6d6", side: "#593500", top: "#fff0b4" };
const DARK = "#06040e";
const ST_DARK: Style = { c0: DARK, c1: DARK, edge: DARK, side: DARK, top: DARK };
const mixStyle = (a: Style, b: Style, t: number): Style => ({
  c0: mix(a.c0, b.c0, t),
  c1: mix(a.c1, b.c1, t),
  edge: mix(a.edge, b.edge, t),
  side: mix(a.side, b.side, t),
  top: mix(a.top, b.top, t),
});
/** Dim a column by darkening its paint (it stays solid, unlike lowering its alpha). */
const darken = (s: Style, k: number) => (k <= 0.001 ? s : mixStyle(s, ST_DARK, k));

/** The AlexNet column: height above the floor while falling, squash/stretch after landing. */
const FALL = 10;
/** Height above the floor while falling: enters the top of frame ~6 frames before contact. */
const fallLift = (t: number) => lerp(4.3, 0, ease.inQuad(clamp((t + FALL) / FALL)));
const alexState = (f: number) => {
  const t = f - DROP;
  if (t < -FALL) return null;
  if (t < 0) {
    const k = ease.inQuad((t + FALL) / FALL);
    return { lift: fallLift(t), sx: lerp(0.94, 0.88, k), sy: lerp(1.12, 1.34, k), t };
  }
  const sq = Math.exp(-t / 7) * Math.cos(t * 0.6);
  return { lift: 0, sx: 1 + 0.16 * sq, sy: 1 - 0.26 * sq, t };
};

/** Everything standing on the floor hops when the AlexNet column lands; the shock travels outward. */
const hopAt = (x: number, f: number) => {
  const dx = Math.abs(x - SLOT_X[2]);
  const t = f - DROP - dx * 1.6;
  if (t <= 0 || t >= 12 || dx < 0.01) return 0;
  return 0.085 * Math.sin((Math.PI * t) / 12) * Math.exp(-dx * 0.22);
};

/** Shockwaves travel slower toward the viewer, so they stay out of the caption band. */
const RZ = 0.38;

/** A soft vertical shaft of light (fades out toward the top, gaussian sideways, white-hot core). Cached per colour. */
const beamCache = new Map<string, HTMLCanvasElement>();
const beamSprite = (color: string, coreK: number) => {
  const key = `${color}|${coreK}`;
  const hit = beamCache.get(key);
  if (hit) return hit;
  const BW = 96;
  const BH = 256;
  const c = document.createElement("canvas");
  c.width = BW;
  c.height = BH;
  const g = c.getContext("2d")!;
  const img = g.createImageData(BW, BH);
  const [r, gr, b] = rgbOf(color);
  for (let y = 0; y < BH; y++) {
    const v = Math.pow(y / (BH - 1), 1.5);
    for (let x = 0; x < BW; x++) {
      const u = ((x + 0.5) / BW) * 2 - 1;
      const body = Math.exp(-u * u * 4.2);
      const core = coreK * Math.exp(-u * u * 90);
      const wt = clamp(core * 1.2);
      const o = (y * BW + x) * 4;
      img.data[o] = Math.round(lerp(r, 255, wt));
      img.data[o + 1] = Math.round(lerp(gr, 255, wt));
      img.data[o + 2] = Math.round(lerp(b, 255, wt));
      img.data[o + 3] = Math.round(255 * clamp(v * (0.85 * body + 0.6 * core)));
    }
  }
  g.putImageData(img, 0, 0);
  beamCache.set(key, c);
  return c;
};
/** Draw a light shaft centred on x=cx from y0 (transparent end) to y1 (bright end). coreK: 0 = pure volume, 1 = hot core line. */
const beam = (ctx: CanvasRenderingContext2D, cx: number, halfW: number, y0: number, y1: number, color: string, alpha: number, coreK = 1) => {
  if (alpha <= 0.003 || y1 <= y0 || halfW <= 0.5) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, alpha);
  ctx.drawImage(beamSprite(color, coreK), cx - halfW, y0, halfW * 2, y1 - y0);
  ctx.globalAlpha = prev;
};

const ChartCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const ca = chartA(f);
      if (ca <= 0) return;
      const cam = chartCam(f);
      const P = (x: number, y: number, z: number) => project(cam, x, y, z)!;
      const st = alexState(f);
      const tImp = f - DROP;
      const impact = tImp >= 0 && tImp < 60;
      const ringR = (k: number) => {
        const tt = tImp - k * 3;
        return tt < 0 ? -1 : 0.3 + (6 - k) * (1 - Math.exp(-tt / 10));
      };
      const ant = antK(f);
      const old = oldK(f);
      const lit = resnetLit(f);
      const sw = humanSweep(f);
      const xe = lerp(X_L, X_R, sw);
      const tC = f - CONTACT;
      const clutter = clutterA(f);
      const sink = sinkK(f);
      const fill = fillK(f);
      /** How far a column (and its labels) steps back: 2010/2011 while the slam builds, all but ResNet at the end. */
      const backK = (i: number) => clamp(i === 5 ? 0 : i === 2 ? 0.22 * old : (i < 2 ? 0.32 * ant : 0) + 0.42 * old + (i < 2 ? 0.4 * sink : 0));
      /** 2010/2011 are gone before the dolly reaches them. */
      const colA = (i: number) => (i < 2 ? 1 - sink : 1);
      /** Text grows a little as the camera closes in. */
      const ck = chartCK(f);
      const zs = clamp(Math.sqrt(P(ck.tx, ck.ty, 0).s / 190), 0.95, 1.2);

      /** Labels fade out as a camera move carries them toward the frame edge. */
      const edgeA = (x: number, half: number) => clamp((x - half - 50) / 50) * clamp((w - x - half - 50) / 50);
      // ---- under-label layout; bright floor FX fade out (feathered) around the labels and above the caption band ----
      const labA = [0, 1, 2, 3, 4, 5].map(
        (i) =>
          (i === 2 ? ease.outCubic(prog(f, DROP - 40, DROP - 26)) : clamp(colT(f, i) * 3)) *
          (1 - 0.75 * backK(i)) *
          colA(i) *
          edgeA(P(SLOT_X[i], 0, FZ0).x, 60),
      );
      const boxes: [number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) {
        if (labA[i] <= 0.02) continue;
        const p = P(SLOT_X[i], 0, FZ0);
        font(ctx, 800, 26 * zs, true);
        let wd = ctx.measureText(String(IMAGENET[i].year)).width;
        if (i >= 2) font(ctx, 800, 22 * zs, true);
        else font(ctx, 700, 22 * zs);
        wd = Math.max(wd, ctx.measureText(NAMES[i]).width);
        boxes.push([p.x - wd / 2 - 22, p.y + 14 * zs, wd + 44, 80 * zs]);
      }
      /** 1 in the clear, 0 on a label or in the caption band, with soft edges. */
      const maskAt = (x: number, y: number) => {
        let m = clamp((CAP_Y - y) / 36);
        for (const b of boxes) {
          const dx = Math.max(b[0] - x, 0, x - (b[0] + b[2]));
          const dy = Math.max(b[1] - y, 0, y - (b[1] + b[3]));
          m = Math.min(m, clamp(Math.hypot(dx, dy) / 34));
        }
        return m;
      };
      /** A glowing ring on the floor, drawn in runs so it can fade around the labels. dash>0: animated dashes of that many segments. */
      const floorRing = (cx: number, cz: number, r: number, rz: number, col: string, wd: number, alpha: number, n = 72, dash = 0) => {
        if (alpha <= 0.004) return;
        const pts: (Pt | null)[] = [];
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * TAU;
          pts.push(project(cam, cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r * rz));
        }
        let run: Pt[] = [];
        let runM = -1;
        const flush = () => {
          if (run.length > 1 && runM > 0.01) {
            const rr = run;
            glowStroke(ctx, () => rr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))), col, wd, alpha * runM);
          }
          run = [];
          runM = -1;
        };
        for (let i = 0; i < n; i++) {
          const p0 = pts[i];
          const p1 = pts[i + 1];
          const on = dash <= 0 || Math.floor(i / dash + f * 0.08) % 2 === 0;
          if (!p0 || !p1 || !on) {
            flush();
            continue;
          }
          const m = Math.round(maskAt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2) * 8) / 8;
          if (m !== runM) {
            flush();
            runM = m;
            run = [p0];
          }
          run.push(p1);
        }
        flush();
      };

      // ---- floor glow + glossy sheen ----
      ctx.globalAlpha = ca;
      ctx.globalCompositeOperation = "lighter";
      {
        const c = P(0, 0, 0.4);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(1, 0.16);
        glow(ctx, 0, 0, 1100, VIO, 0.22, 0.02);
        ctx.restore();
      }
      {
        const q = [P(-7, 0, 1.6), P(7, 0, 1.6), P(7, 0, -3), P(-7, 0, -3)];
        const g = ctx.createLinearGradient(0, q[0].y, 0, q[2].y);
        g.addColorStop(0, withAlpha(VIO, 0));
        g.addColorStop(0.3, withAlpha("#7d5cff", 0.1));
        g.addColorStop(0.45, withAlpha("#7d5cff", 0.07));
        g.addColorStop(1, withAlpha(VIO, 0));
        ctx.fillStyle = g;
        polyPath(ctx, q);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // ---- floor grid (lights up where the shock ring passes), back-wall guides, baseline ----
      ctx.save();
      const gridDraw = ease.outCubic(prog(f, BARS + 6, BARS + 40));
      const R0 = impact ? ringR(0) : -1;
      const ripA = impact ? Math.exp(-tImp / 16) : 0;
      ctx.lineWidth = 1.2;
      const seg = (x0: number, z0: number, x1: number, z1: number) => {
        const x = (x0 + x1) / 2;
        const z = (z0 + z1) / 2;
        const fade = clamp((z + 3.2) / 1.6) * Math.exp(-Math.max(0, z) / 3.4) * clamp(1 - Math.abs(x) / 7.5);
        const base = 0.19 * fade;
        if (base <= 0.004 && R0 <= 0) return;
        const p0 = project(cam, x0, 0, z0);
        const p1 = project(cam, x1, 0, z1);
        if (!p0 || !p1) return;
        let a = base;
        if (R0 > 0) {
          const d = Math.hypot(x - SLOT_X[2], z / RZ);
          a += ripA * Math.exp(-((d - R0) * (d - R0)) / 0.12) * clamp(1 - Math.abs(x) / 7.5) * maskAt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        }
        a *= gridDraw;
        if (a <= 0.004) return;
        ctx.strokeStyle = R0 > 0 ? withAlpha(mix("#a98cff", "#ffffff", clamp(a * 2 - 0.2)), Math.min(1, a)) : withAlpha("#a98cff", a);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      };
      const nearRing = (x: number, z: number) => R0 > 0 && Math.abs(Math.hypot(x - SLOT_X[2], z / RZ) - R0) < 1.6;
      const line = (x0: number, z0: number, x1: number, z1: number) => {
        const n = Math.round(Math.hypot(x1 - x0, z1 - z0));
        for (let i = 0; i < n; i++) {
          const ax = lerp(x0, x1, i / n);
          const az = lerp(z0, z1, i / n);
          const bx = lerp(x0, x1, (i + 1) / n);
          const bz = lerp(z0, z1, (i + 1) / n);
          if (nearRing((ax + bx) / 2, (az + bz) / 2)) for (let k = 0; k < 4; k++) seg(lerp(ax, bx, k / 4), lerp(az, bz, k / 4), lerp(ax, bx, (k + 1) / 4), lerp(az, bz, (k + 1) / 4));
          else seg(ax, az, bx, bz);
        }
      };
      for (let z = -3.0; z <= 4.01; z += 0.5) line(-7, z, 7, z);
      for (let x = -7; x <= 7.01; x += 0.5) line(x, -3, x, 4);
      // back wall guide lines every 5 points (no tick labels)
      ctx.setLineDash([5, 9]);
      ctx.lineWidth = 1;
      const heads: { x: number; y: number; a: number }[] = [];
      for (let e = 5; e <= 30; e += 5) {
        const dr = ease.inOutCubic(prog(f, BARS + 8 + e * 0.6, BARS + 30 + e * 0.6));
        if (dr <= 0) continue;
        const a = P(X_L, -e * U, 0.95);
        const b = P(lerp(X_L, X_R, dr), -e * U, 0.95);
        ctx.strokeStyle = "rgba(205,190,255,0.13)";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (dr < 1) heads.push({ x: b.x, y: b.y, a: 0.55 * Math.sin(dr * Math.PI) });
      }
      ctx.setLineDash([]);
      {
        // the baseline powers on: a bright head runs along it while it draws
        const ax = ease.inOutCubic(prog(f, BARS + 6, BARS + 30));
        if (ax > 0) {
          const a = P(X_L, 0, FZ0 - 0.14);
          const b = P(lerp(X_L, X_R, ax), 0, FZ0 - 0.14);
          ctx.globalCompositeOperation = "lighter";
          glowStroke(
            ctx,
            () => {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            },
            "#b9a6ff",
            1.6 + 1.4 * (1 - ax),
            0.55 + 0.45 * (1 - ax),
          );
          if (ax < 1) heads.push({ x: b.x, y: b.y, a: 0.3 + 0.7 * Math.sin(ax * Math.PI) });
          ctx.globalCompositeOperation = "source-over";
        }
      }
      if (heads.length) {
        ctx.globalCompositeOperation = "lighter";
        for (const hd of heads) {
          glow(ctx, hd.x, hd.y, 60, "#b9a6ff", 0.7 * hd.a, 0.06);
          glow(ctx, hd.x, hd.y, 12, "#ffffff", hd.a);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
      ctx.globalAlpha = ca;

      // ---- collect the columns ----
      type Col = { i: number; x: number; wd: number; d: number; h: number; lift: number; st: Style; a: number; t: number };
      const cols: Col[] = [];
      for (const i of [0, 1, 3, 4, 5]) {
        const t = colT(f, i);
        if (t <= 0) continue;
        const base = i < 2 ? ST_OLD : i === 5 ? mixStyle(ST_DEEP, ST_GOLD, lit) : ST_DEEP;
        const a = clamp(t * 4) * colA(i);
        if (a <= 0.003) continue;
        cols.push({ i, x: SLOT_X[i], wd: BWD, d: DEP, h: IMAGENET[i].err * U * backOut(t, i < 2 ? 0.7 : 1.5), lift: hopAt(SLOT_X[i], f), st: darken(base, backK(i)), a, t });
      }
      if (st) cols.push({ i: 2, x: SLOT_X[2], wd: BWD * st.sx, d: DEP * st.sx, h: 15.3 * U * st.sy, lift: st.lift, st: darken(ST_ALEX, backK(2)), a: 1, t: 1 });

      // reflections in the glossy floor
      for (const c of cols) {
        const x0 = c.x - c.wd / 2;
        const x1 = c.x + c.wd / 2;
        if (c.lift > 1) continue;
        const rh = Math.min(c.h, 1.0);
        const q = [P(x0, c.lift, FZ0), P(x1, c.lift, FZ0), P(x1, c.lift + rh, FZ0), P(x0, c.lift + rh, FZ0)];
        // the reflection is gone before the caption band
        const g = ctx.createLinearGradient(0, q[0].y, 0, Math.max(q[0].y + 10, Math.min(q[3].y, CAP_Y - 24)));
        g.addColorStop(0, withAlpha(mix(c.st.c0, c.st.c1, 0.35), 0.62 * c.a * ca));
        g.addColorStop(0.5, withAlpha(c.st.c0, 0.18 * c.a * ca));
        g.addColorStop(1, withAlpha(c.st.c0, 0));
        ctx.fillStyle = g;
        polyPath(ctx, q);
        ctx.fill();
      }

      // ---- floor FX ----
      const padA = (i: number) =>
        ease.outCubic(prog(f, BARS + 18 + (i - 2) * 5, BARS + 40 + (i - 2) * 5)) *
        (1 - prog(f, landOf(i), landOf(i) + 14)) *
        (i === 2 ? 1 - ease.inOutCubic(prog(f, DROP - 44, DROP - 32)) : 1);
      const tgtA = ease.outCubic(prog(f, DROP - 44, DROP - 30)) * (1 - prog(f, DROP - 2, DROP + 2));
      const tgtLock = ease.inOutCubic(prog(f, DROP - 34, DROP - 4));
      /** A soft pool of light on the floor (squashed glow). */
      const pool = (x: number, z: number, r: number, col: string, a: number, sy = 0.2, core = 0.05) => {
        if (a <= 0.003) return;
        const c = P(x, 0, z);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(1, sy);
        glow(ctx, 0, 0, r, col, a, core);
        ctx.restore();
      };
      // broad glows: not knocked out (a hard-edged hole in a bloom would read as a box around the label)
      ctx.globalCompositeOperation = "lighter";
      for (let i = 2; i < 6; i++) pool(SLOT_X[i], 0, 120, VIO, 0.3 * padA(i) * (0.75 + 0.25 * Math.sin(f * 0.08 + i * 1.7)), 0.22);
      if (tgtA > 0) pool(SLOT_X[2], 0, 150 + 90 * tgtLock, VIO, 0.55 * tgtA * (0.5 + tgtLock));
      if (impact) {
        pool(SLOT_X[2], FZ0, 760, VIO, 0.95 * Math.exp(-tImp / 10), 0.2, 0.04);
        pool(SLOT_X[2], FZ0, 300, "#ffffff", Math.exp(-tImp / 5), 0.2, 0.1);
        // dust rolling outward along the floor
        for (let n = 0; n < 18; n++) {
          const th = (n / 18) * TAU + hash(n) * 0.3;
          const r = 0.4 + 1.9 * (1 - Math.exp(-tImp / 14)) * (0.6 + 0.4 * hash(n * 3.3));
          const p = project(cam, SLOT_X[2] + Math.cos(th) * r, -0.05, Math.sin(th) * r * 0.6);
          if (!p) continue;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(1, 0.45);
          glow(ctx, 0, 0, (0.35 + tImp * 0.02) * p.s, n % 2 ? LILAC : VIO, 0.16 * Math.exp(-tImp / 22), 0.02);
          ctx.restore();
        }
      }
      if (tC >= 0 && tC < 44) pool(SLOT_X[5], FZ0, 340, GOLD, 0.7 * Math.exp(-tC / 12), 0.22);

      // thin strokes and particles (rings fade out around the labels and above the caption band)
      ctx.save();
      // pads marking the slots still to be filled, so the stage reads as a planned chart
      for (let i = 2; i < 6; i++) {
        const pa = padA(i);
        if (pa <= 0.01) continue;
        const hx = BWD * 0.62;
        const hz = DEP * 0.8;
        const cx = SLOT_X[i];
        const q = [P(cx - hx, 0, -hz), P(cx + hx, 0, -hz), P(cx + hx, 0, hz), P(cx - hx, 0, hz)];
        const br = 0.75 + 0.25 * Math.sin(f * 0.08 + i * 1.7);
        ctx.fillStyle = withAlpha(VIO, 0.08 * pa * br);
        polyPath(ctx, q);
        ctx.fill();
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = withAlpha(LILAC, 0.26 * pa);
        ctx.lineWidth = 1.2;
        polyPath(ctx, q);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = withAlpha("#ece0ff", 0.75 * pa * br);
        ctx.lineWidth = 2;
        for (let k = 0; k < 4; k++) {
          const a = q[k];
          const b = q[(k + 1) % 4];
          const d = q[(k + 3) % 4];
          ctx.beginPath();
          ctx.moveTo(lerp(a.x, b.x, 0.26), lerp(a.y, b.y, 0.26));
          ctx.lineTo(a.x, a.y);
          ctx.lineTo(lerp(a.x, d.x, 0.26), lerp(a.y, d.y, 0.26));
          ctx.stroke();
        }
      }
      // 2012 target ring, locking on before the drop
      if (tgtA > 0) {
        const r = lerp(1.25, 0.46, tgtLock);
        const pa = 0.6 + 0.4 * Math.sin(f * 0.5);
        floorRing(SLOT_X[2], 0, r, 1, LILAC, 1.6, 0.8 * tgtA * pa, 96, 3);
      }
      // shockwave rings
      if (impact) {
        for (let k = 0; k < 3; k++) {
          const r = ringR(k);
          if (r < 0) continue;
          const al = Math.exp(-(tImp - k * 3) / (12 + k * 5));
          floorRing(SLOT_X[2], 0, r, RZ, ["#ffffff", LILAC, MAG][k], 2.5 + 5 * al, al, 96);
        }
      }
      // small landing rings for the other columns
      for (const i of [0, 1, 3, 4, 5]) {
        const tt = f - landOf(i);
        if (tt < 0 || tt > 30) continue;
        const al = Math.exp(-tt / 8);
        floorRing(SLOT_X[i], 0, 0.34 + tt * 0.045, 0.8, i < 2 ? "#b8c6ea" : MAG, 1.8, 0.8 * al, 64);
      }
      // gold contact rings when the human line reaches ResNet, and again when the zone has filled
      for (const [t0, big] of [
        [CONTACT, 0],
        [FILL1, 1],
      ] as const) {
        const tt0 = f - t0;
        if (tt0 < 0 || tt0 >= 48) continue;
        for (let k = 0; k < 2; k++) {
          const tt = tt0 - k * 5;
          if (tt < 0) continue;
          const r = 0.3 + (2.1 + 0.6 * big - k * 0.6) * (1 - Math.exp(-tt / 9));
          const al = Math.exp(-tt / (11 + k * 4));
          floorRing(SLOT_X[5], 0, r, 0.5, k ? GOLD : "#fff3c8", 2 + 3 * al, 0.95 * al, 72);
        }
      }
      if (f >= FILL1 && f < FILL1 + 44) pool(SLOT_X[5], FZ0, 300, GOLD, 0.55 * Math.exp(-(f - FILL1) / 12), 0.22);
      // implosion: light is sucked into the empty slot just before the drop
      const imp = prog(f, DROP - 32, DROP - FALL + 1);
      if (imp > 0 && imp < 1) {
        const c = P(SLOT_X[2], -0.8, FZ0);
        for (let n = 0; n < 110; n++) {
          const sp = 0.55 + 0.45 * hash(n * 5.3);
          const k = clamp(imp * sp * 1.35);
          if (k >= 1) continue;
          const r = (200 + 260 * hash(n * 3.1)) * Math.pow(1 - k, 1.7);
          const a = hash(n * 1.7) * TAU + k * 2.2;
          const x = c.x + Math.cos(a) * r;
          const y = c.y + Math.sin(a) * r * 0.5;
          glow(ctx, x, y, 2 + 3 * hash(n), n % 3 ? LILAC : MAG, (0.25 + 0.75 * k) * clamp(imp * 4) * clamp((1 - k) * 6) * maskAt(x, y));
        }
      }
      ctx.restore();
      ctx.globalAlpha = ca;
      ctx.globalCompositeOperation = "source-over";

      // ---- god rays fanning up from the impact (behind the columns) ----
      if (impact && tImp < 46) {
        const c = P(SLOT_X[2], 0, FZ0);
        const grow = ease.outCubic(clamp((tImp + 1) / 6));
        const ra = 0.24 * Math.exp(-tImp / 13);
        ctx.save();
        ctx.translate(c.x, c.y - 6);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 30; i++) {
          const a = -Math.PI + 0.34 + ((i + 0.5 + (hash(i * 3.3) - 0.5) * 0.8) / 30) * (Math.PI - 0.68) + tImp * 0.0025 * (i % 2 ? 1 : -1);
          const len = (520 + 700 * hash(i * 9.1)) * grow;
          const wid = 0.008 + 0.024 * hash(i * 5.7);
          const col = i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? LILAC : MAG;
          const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
          g.addColorStop(0, withAlpha(col, ra));
          g.addColorStop(1, withAlpha(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, len, a - wid, a + wid);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // ---- the anticipation shaft over the empty 2012 slot: volumetric beam + dust motes ----
      const shaft = f < DROP ? ease.inQuad(prog(f, DROP - 40, DROP - FALL)) : 0;
      if (shaft > 0) {
        const bot = P(SLOT_X[2], 0, FZ0);
        const halfW = (BWD * bot.s) / 2;
        const flick = 0.92 + 0.08 * Math.sin(f * 0.9) * Math.sin(f * 0.37);
        ctx.globalCompositeOperation = "lighter";
        beam(ctx, bot.x, halfW * 2.8, -40, bot.y, VIO, 0.75 * shaft * flick, 0);
        beam(ctx, bot.x, halfW * 1.3, -40, bot.y, LILAC, 0.42 * shaft * flick, 0);
        beam(ctx, bot.x, halfW * 0.7, 120, bot.y, "#ffffff", 0.35 * shaft * flick, 0.6);
        ctx.save();
        ctx.translate(bot.x, bot.y);
        ctx.scale(1, 0.18);
        glow(ctx, 0, 0, halfW * 3.4, VIO, 0.7 * shaft, 0.05);
        ctx.restore();
        const H = bot.y + 40;
        for (let n = 0; n < 34; n++) {
          const u = (f * (0.004 + 0.004 * hash(n * 1.9)) + hash(n * 4.3)) % 1;
          const x = bot.x + (hash(n * 7.1) - 0.5) * halfW * 2.4 + Math.sin(f * 0.05 + n) * 6;
          const tw = 0.5 + 0.5 * Math.sin(f * 0.3 + n * 2.3);
          glow(ctx, x, bot.y - u * H * 0.9, 2 + 2.5 * hash(n * 2.2), n % 3 ? LILAC : "#ffffff", shaft * tw * Math.sin(u * Math.PI) * 0.9);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- light shafts around the AlexNet column (drawn behind it, so the column hides their bright foot) ----
      if (st) {
        const top = P(SLOT_X[2], -st.lift - 15.3 * U * st.sy, FZ0);
        const bot = P(SLOT_X[2], -st.lift, FZ0);
        const floorY = P(SLOT_X[2], 0, FZ0).y;
        const halfW = (BWD * st.sx * bot.s) / 2;
        ctx.globalCompositeOperation = "lighter";
        if (st.t < 0) beam(ctx, top.x, halfW * 1.15, top.y - 560, top.y + 40, LILAC, 0.95, 0.3);
        else {
          // impact pillar: a soft shaft straight up through the column, reaching down to the floor around it
          const pa = Math.exp(-st.t / 7);
          beam(ctx, bot.x, halfW * 3.2, -40, floorY, VIO, pa, 0);
          beam(ctx, bot.x, halfW * 1.2, -40, floorY, "#ffffff", pa, 1);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- the better-than-human zone: everything under the gold line, on the columns' front plane, behind them ----
      const flareC = tC >= 0 ? Math.exp(-tC / 10) : 0;
      const flareF = f >= FILL1 ? Math.exp(-(f - FILL1) / 12) : 0;
      if (sw > 0) {
        const zz = LZ + 0.01;
        const q = [P(X_L, 0, zz), P(xe, 0, zz), P(xe, HY, zz), P(X_L, HY, zz)];
        ctx.globalCompositeOperation = "lighter";
        const aTop = 0.14 + 0.4 * flareC + 0.3 * flareF;
        const g = ctx.createLinearGradient(0, q[3].y, 0, q[0].y);
        g.addColorStop(0, withAlpha(GOLD, aTop));
        g.addColorStop(0.4, withAlpha(GOLD, aTop * 0.38));
        g.addColorStop(1, withAlpha(GOLD, aTop * 0.12));
        ctx.fillStyle = g;
        polyPath(ctx, q);
        ctx.fill();
        if (fill > 0) {
          // light pours in from the floor up to the human line, then settles to a glow
          const yl = HY * fill;
          const settle = 1 - 0.5 * ease.inOutSine(prog(f, FILL1, FILL1 + 36));
          const qf = [P(X_L, 0, zz), P(xe, 0, zz), P(xe, yl, zz), P(X_L, yl, zz)];
          const gf = ctx.createLinearGradient(0, qf[3].y, 0, qf[0].y);
          gf.addColorStop(0, withAlpha("#ffd977", 0.26 * settle));
          gf.addColorStop(0.5, withAlpha(GOLD, 0.1 * settle));
          gf.addColorStop(1, withAlpha(GOLD, 0.04 * settle));
          ctx.fillStyle = gf;
          polyPath(ctx, qf);
          ctx.fill();
          if (fill < 1) {
            glowStroke(
              ctx,
              () => {
                ctx.moveTo(qf[3].x, qf[3].y);
                ctx.lineTo(qf[2].x, qf[2].y);
              },
              GOLD,
              2.4,
              0.9 * Math.sin(Math.PI * Math.min(1, fill * 1.15)),
            );
          }
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- the ghost of the runner-up (just behind the 2012 column, peeking out to its right) ----
      const ga = ease.outCubic(prog(f, DROP + 10, DROP + 24)) * clutter;
      if (ga > 0.01) {
        const hh = RUNNER_UP * U;
        const b: Box = [GHOST_X0, GHOST_X1, -hh, 0, GHOST_Z0, GHOST_Z1];
        ctx.globalAlpha = ga * ca;
        drawBox(cam, IDENT, b, (k, pts) => {
          polyPath(ctx, pts);
          ctx.fillStyle = k === "front" ? "rgba(216,220,240,0.06)" : "rgba(216,220,240,0.1)";
          ctx.fill();
          ctx.setLineDash([7, 6]);
          ctx.strokeStyle = "rgba(216,220,240,0.6)";
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.setLineDash([]);
        });
        ctx.globalAlpha = ca;
      }

      // ---- columns (far from the camera axis first) ----
      const camX = cam.x;
      const sorted = [...cols].sort((p, q) => Math.abs(q.x - camX) - Math.abs(p.x - camX));
      for (const c of sorted) {
        const x0 = c.x - c.wd / 2;
        const x1 = c.x + c.wd / 2;
        const yb = -c.lift;
        const yt = -c.lift - c.h;
        const b: Box = [x0, x1, yt, yb, -c.d / 2, c.d / 2];
        const al = c.a * ca;
        if (al <= 0) continue;
        const bk = backK(c.i);
        // glow halo (behind)
        ctx.globalCompositeOperation = "lighter";
        const mid = P(c.x, (yt + yb) / 2, 0);
        const hb =
          c.i === 2
            ? st && st.t >= 0
              ? 0.32 + 0.68 * Math.exp(-st.t / 16)
              : 0.5
            : c.i === 5
              ? 0.15 + lit * (0.5 + 0.15 * Math.sin(f * 0.13)) + 0.7 * flareC + 0.25 * fill + 0.5 * flareF
              : 0.08;
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.scale(1, Math.max(0.6, (c.h * mid.s) / (BWD * mid.s * 2.4)));
        glow(ctx, 0, 0, BWD * mid.s * (c.i === 5 ? 1.25 + 0.45 * lit : 1.25), c.i === 2 ? VIO : c.i === 5 ? mix(MAG, GOLD, lit) : c.i < 2 ? "#5d7099" : MAG, hb * al * (1 - bk), 0.08);
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = al;
        let front: Pt[] | null = null;
        let topF: Pt[] | null = null;
        drawBox(cam, IDENT, b, (k, pts) => {
          polyPath(ctx, pts);
          if (k === "front") {
            front = pts;
            const g = ctx.createLinearGradient(0, pts[3].y, 0, pts[0].y);
            g.addColorStop(0, c.st.c0);
            g.addColorStop(1, c.st.c1);
            ctx.fillStyle = g;
          } else {
            if (k === "top") topF = pts;
            ctx.fillStyle = k === "top" ? c.st.top : c.st.side;
          }
          ctx.fill();
        });
        if (front) {
          const fp = front as Pt[];
          // rim light: when a column settles, when the shock passes it, when the human line touches ResNet
          const rim =
            c.i === 2
              ? st && st.t >= 0
                ? Math.exp(-st.t / 9)
                : 0
              : c.i === 5 && tC >= 0
                ? Math.max(Math.exp(-tC / 7), f >= riseOf(c.i) ? Math.exp(-Math.abs(f - landOf(c.i)) / 3.5) : 0)
                : f >= riseOf(c.i)
                  ? Math.exp(-Math.abs(f - landOf(c.i)) / 3.5)
                  : 0;
          const shock = c.i !== 2 ? clamp(c.lift / 0.05) : 0;
          ctx.save();
          polyPath(ctx, fp);
          ctx.clip();
          ctx.globalCompositeOperation = "lighter";
          // gloss strip
          const gw = (fp[1].x - fp[0].x) * 0.16;
          const gg = ctx.createLinearGradient(fp[0].x, 0, fp[0].x + gw * 2.2, 0);
          gg.addColorStop(0, "rgba(255,255,255,0.0)");
          gg.addColorStop(0.4, `rgba(255,255,255,${0.13 * (1 - bk)})`);
          gg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gg;
          ctx.fillRect(fp[0].x, fp[0].y - 20, gw * 2.2, fp[3].y - fp[0].y + 40);
          // diagonal sheen after a column settles
          const shP = c.i === 2 ? prog(f, DROP + 14, DROP + 44) : c.i === 5 && lit > 0 ? prog(f, CONTACT + 6, CONTACT + 32) : prog(f, landOf(c.i), landOf(c.i) + 22);
          if (shP > 0 && shP < 1) {
            const H = fp[3].y - fp[0].y;
            const sl = Math.min(H * 0.35, 90);
            const sx = lerp(fp[0].x - sl - 60, fp[1].x + 60, ease.inOutCubic(shP));
            const mx = sx + sl / 2;
            const my = (fp[0].y + fp[3].y) / 2;
            const nl = Math.hypot(H, sl) || 1;
            const nx = (H / nl) * 42;
            const ny = (sl / nl) * 42;
            const sg = ctx.createLinearGradient(mx - nx, my - ny, mx + nx, my + ny);
            const scol = c.i === 5 && lit > 0 ? "#fff1b0" : "#ffffff";
            sg.addColorStop(0, withAlpha(scol, 0));
            sg.addColorStop(0.5, withAlpha(scol, 0.32 * Math.sin(shP * Math.PI)));
            sg.addColorStop(1, withAlpha(scol, 0));
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.moveTo(sx - 60, fp[3].y);
            ctx.lineTo(sx + 60, fp[3].y);
            ctx.lineTo(sx + 60 + sl, fp[0].y);
            ctx.lineTo(sx - 60 + sl, fp[0].y);
            ctx.closePath();
            ctx.fill();
          }
          if (c.i === 2) {
            // rising energy inside the AlexNet column
            for (let n = 0; n < 14; n++) {
              const u = (f * 0.02 + hash(n * 4.1)) % 1;
              glow(ctx, lerp(fp[0].x, fp[1].x, 0.15 + 0.7 * hash(n * 2.7)), lerp(fp[3].y, fp[0].y, u), 3 + 3 * hash(n), "#ffffff", 0.45 * Math.sin(u * Math.PI) * (1 - bk));
            }
            // the hit: white for a frame, then lilac, so the column keeps its form
            if (st) {
              const tint = st.t < 0 ? 0.2 : 0.8 * Math.exp(-st.t / 2.4);
              if (tint > 0.01) {
                ctx.fillStyle = withAlpha(mix("#ffffff", LILAC, clamp(st.t / 2.5)), tint);
                ctx.fillRect(fp[0].x - 2, fp[0].y - 2, fp[1].x - fp[0].x + 4, fp[3].y - fp[0].y + 4);
              }
            }
          } else {
            const ft = 0.07 * Math.max(rim, shock * 0.6);
            if (ft > 0.005) {
              ctx.fillStyle = withAlpha("#ffffff", ft);
              ctx.fillRect(fp[0].x - 2, fp[0].y - 2, fp[1].x - fp[0].x + 4, fp[3].y - fp[0].y + 4);
            }
          }
          ctx.restore();
          ctx.globalCompositeOperation = "lighter";
          const rimA = Math.max(rim, shock);
          if (rimA > 0.02) {
            const tf = topF as Pt[] | null;
            glowStroke(
              ctx,
              () => {
                polyPath(ctx, fp);
                if (tf) {
                  ctx.moveTo(tf[0].x, tf[0].y);
                  ctx.lineTo(tf[1].x, tf[1].y);
                }
              },
              mix(c.st.edge, "#ffffff", 0.5),
              1.8,
              rimA,
            );
          }
          ctx.strokeStyle = withAlpha(c.st.edge, 0.95);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(fp[0].x, fp[0].y);
          ctx.lineTo(fp[1].x, fp[1].y);
          ctx.stroke();
          ctx.strokeStyle = withAlpha(c.st.edge, 0.3);
          ctx.lineWidth = 1;
          polyPath(ctx, fp);
          ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.globalAlpha = ca;
      }

      // ---- AlexNet: falling trail, chromatic split, impact pillar, floor streak ----
      if (st) {
        const top = P(SLOT_X[2], -st.lift - 15.3 * U * st.sy, FZ0);
        const bot = P(SLOT_X[2], -st.lift, FZ0);
        const halfW = (BWD * st.sx * bot.s) / 2;
        ctx.globalCompositeOperation = "lighter";
        if (st.t < 0) {
          // vertical smear: earlier positions of the column, only where they stick out above it
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, Math.max(0, top.y + 4));
          ctx.clip();
          for (let k = 1; k <= 4; k++) {
            const lk = fallLift(st.t - 0.55 * k);
            const tk = P(SLOT_X[2], -lk - 15.3 * U * st.sy, FZ0);
            const bk = P(SLOT_X[2], -lk, FZ0);
            const sg = ctx.createLinearGradient(0, tk.y, 0, bk.y);
            const al = 0.42 * (1 - k / 5);
            sg.addColorStop(0, withAlpha(LILAC, al * 0.3));
            sg.addColorStop(1, withAlpha(mix(LILAC, "#ffffff", 0.4), al));
            ctx.fillStyle = sg;
            ctx.fillRect(tk.x - halfW * (1 - 0.06 * k), tk.y, halfW * 2 * (1 - 0.06 * k), bk.y - tk.y);
          }
          ctx.restore();
          // speed streaks, kept inside the frame: from the top edge down beside / over the falling column
          for (let n = 0; n < 16; n++) {
            const x = top.x + (hash(n * 3.1) - 0.5) * halfW * 3.6;
            const yb = bot.y - 20 - (bot.y + 40) * 0.6 * hash(n * 1.3);
            if (yb < 30) continue;
            const ya = Math.max(0, yb - (200 + 340 * hash(n * 7.7)));
            const lg = ctx.createLinearGradient(0, ya, 0, yb);
            lg.addColorStop(0, withAlpha("#ffffff", 0));
            lg.addColorStop(1, withAlpha(n % 3 ? "#ffffff" : LILAC, 0.6));
            ctx.fillStyle = lg;
            ctx.fillRect(x, ya, n % 4 ? 2 : 3, yb - ya);
          }
        } else {
          if (st.t < 7) {
            // chromatic fringes just outside the column edges
            const k = 1 - st.t / 7;
            const ab = 2 + 7 * k * k;
            ctx.fillStyle = withAlpha(C.cyan, 0.55 * k);
            ctx.fillRect(top.x - halfW - ab, top.y, ab, bot.y - top.y);
            ctx.fillStyle = withAlpha(MAG, 0.55 * k);
            ctx.fillRect(top.x + halfW, top.y, ab, bot.y - top.y);
          }
          const sa = Math.exp(-st.t / 9);
          const sg = ctx.createLinearGradient(0, 0, w, 0);
          sg.addColorStop(0, withAlpha(VIO, 0));
          sg.addColorStop(clamp(bot.x / w), withAlpha("#ffffff", 0.9 * sa));
          sg.addColorStop(1, withAlpha(MAG, 0));
          ctx.fillStyle = sg;
          ctx.fillRect(0, bot.y - 1.5 - 3.5 * sa, w, 3 + 7 * sa);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- the "?" waiting in the 2012 slot, with a reticle locking on ----
      const qIn = ease.outCubic(prog(f, DROP - 44, DROP - 34));
      const qOut = prog(f, DROP - FALL - 2, DROP - FALL + 3);
      const qa = qIn * (1 - qOut);
      if (qa > 0.01) {
        const p = P(SLOT_X[2], -0.8, FZ0);
        const s = (0.6 + 0.4 * qIn) * (1 + 0.06 * Math.sin(f * 0.32)) * (1 + 0.8 * qOut);
        ctx.save();
        ctx.globalAlpha = ca * qa;
        ctx.translate(p.x, p.y);
        ctx.scale(s, s);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        font(ctx, 900, 112, true);
        ctx.shadowColor = VIO;
        ctx.shadowBlur = 40;
        ctx.fillStyle = withAlpha(LILAC, 0.95);
        ctx.fillText("?", 0, 4);
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#ffffff";
        ctx.fillText("?", 0, 4);
        ctx.restore();
        ctx.textBaseline = "alphabetic";
        const lock = ease.inOutCubic(prog(f, DROP - 40, DROP - 16));
        const R = lerp(122, 76, lock);
        const L = 24;
        const blink = lock >= 1 ? (Math.floor(f / 3) % 2 ? 1 : 0.5) : 1;
        ctx.globalCompositeOperation = "lighter";
        glowStroke(
          ctx,
          () => {
            for (const [sx, sy] of [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ]) {
              ctx.moveTo(p.x + sx * R, p.y + sy * (R - L));
              ctx.lineTo(p.x + sx * R, p.y + sy * R);
              ctx.lineTo(p.x + sx * (R - L), p.y + sy * R);
            }
          },
          LILAC,
          2,
          0.9 * qa * blink,
        );
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- labels: values on the columns, year + method under them ----
      const valText = (c: Col, txt: string, a: number, size = 30, scale = 1, outline = 0) => {
        if (a <= 0) return;
        const tp = P(c.x, -c.lift - c.h, FZ0);
        const bp = P(c.x, -c.lift, FZ0);
        const H = bp.y - tp.y;
        a *= edgeA(tp.x, 48);
        if (H < 34 || a <= 0.01) return;
        size *= zs;
        ctx.save();
        // 2014 sits just above the human line, so its value goes on top of the column instead of inside
        const above = c.i === 4;
        const y = above ? tp.y - 26 * zs : H >= 150 ? tp.y + 40 * zs : tp.y + Math.min(38 * zs, H / 2 + 11);
        ctx.translate(tp.x, y - size * 0.36);
        ctx.scale(scale, scale);
        font(ctx, 800, size, true);
        ctx.textAlign = "center";
        ctx.fillStyle = withAlpha("#ffffff", a);
        ctx.lineJoin = "round";
        if (outline > 0) {
          // a thin dark keyline while the column is still white-hot
          ctx.shadowColor = "rgba(20,4,50,0.9)";
          ctx.shadowBlur = 6;
          ctx.strokeStyle = withAlpha("#2a0b6e", 0.7 * outline * a);
          ctx.lineWidth = 3.5;
          ctx.strokeText(txt, 0, size * 0.36);
        }
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 8;
        ctx.fillText(txt, 0, size * 0.36);
        ctx.restore();
      };
      /** Dark pills behind the under-labels while the shock rings pass them. */
      const pillA = 0.6 * clamp((tImp + 1) / 2) * clamp((44 - tImp) / 14);
      const underLabel = (i: number, a: number) => {
        if (a <= 0.01) return;
        const p = P(SLOT_X[i], 0, FZ0);
        if (pillA > 0.01 && i <= 3) {
          font(ctx, 800, 22 * zs, true);
          const wd = Math.max(ctx.measureText(NAMES[i]).width, 64 * zs) + 26;
          ctx.save();
          ctx.fillStyle = `rgba(6,3,16,${pillA * a})`;
          ctx.shadowColor = `rgba(6,3,16,${pillA * a})`;
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.roundRect(p.x - wd / 2, p.y + 18 * zs, wd, 66 * zs, 12);
          ctx.fill();
          ctx.restore();
        }
        ctx.textAlign = "center";
        font(ctx, 800, 26 * zs, true);
        ctx.fillStyle = withAlpha("#ffffff", 0.88 * a);
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 10;
        ctx.fillText(String(IMAGENET[i].year), p.x, p.y + 44 * zs);
        if (i >= 2) font(ctx, 800, 22 * zs, true);
        else font(ctx, 700, 22 * zs);
        const col = i === 2 ? "#dcc2ff" : i === 5 ? mix("#ff9ee3", "#ffe08a", lit) : i > 2 ? "#ff9ee3" : "#aab8da";
        ctx.fillStyle = withAlpha(col, a);
        if (i === 2) {
          ctx.shadowColor = VIO;
          ctx.shadowBlur = 14;
        }
        ctx.fillText(NAMES[i], p.x, p.y + 75 * zs);
        ctx.shadowBlur = 0;
      };
      ctx.globalAlpha = ca;
      for (const c of cols) {
        if (c.i === 2) continue;
        // the value appears once the settle flash has passed
        valText(c, IMAGENET[c.i].err.toFixed(1), clamp((c.t - 0.7) * 3.4) * (1 - 0.6 * backK(c.i)) * colA(c.i));
      }
      for (let i = 0; i < 6; i++) underLabel(i, labA[i]);
      if (st && st.t >= 0) {
        const c = cols.find((q) => q.i === 2)!;
        const pop = 1 + 0.6 * (1 - ease.outBack(clamp(st.t / 10)));
        const va = 1 - 0.6 * backK(2);
        if (st.t < 7) {
          const k = 1 - st.t / 7;
          ctx.globalCompositeOperation = "lighter";
          for (const dx of [-5, 5]) {
            ctx.save();
            ctx.translate(dx * k, 0);
            valText(c, "15.3", 0.45 * k, 34, pop);
            ctx.restore();
          }
          ctx.globalCompositeOperation = "source-over";
        }
        valText(c, "15.3", va, 34, pop, 1 - prog(st.t, 4, 12));
      }

      // ---- the step-down: a ball of light hops from top to top, 28.2 → 3.6 ----
      const hopEnd = HOPS[HOPS.length - 1];
      if (f >= HOPS[0] - 5 && f < hopEnd + 24) {
        const topPt = (i: number) => P(SLOT_X[i] - 0.19, -IMAGENET[i].err * U - 0.015, FZ0);
        const ballAt = (ff: number) => {
          if (ff <= HOPS[0]) return topPt(0);
          for (let j = 0; j < HOPS.length - 1; j++) {
            if (ff < HOPS[j + 1]) {
              const u = (ff - HOPS[j]) / (HOPS[j + 1] - HOPS[j]);
              const a = topPt(j);
              const b = topPt(j + 1);
              const arc = 46 + 0.3 * Math.abs(b.y - a.y);
              return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - arc * 4 * u * (1 - u) };
            }
          }
          return topPt(HOPS.length - 1);
        };
        // the ball ignites on 2010's top, then hops down the staircase
        const ballA = ease.outCubic(clamp((f - HOPS[0] + 5) / 5)) * (1 - prog(f, hopEnd + 4, hopEnd + 16));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // the staircase it leaves behind
        const trailA = 0.75 * (1 - prog(f, hopEnd + 6, hopEnd + 24));
        ctx.setLineDash([4, 7]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = withAlpha(mix(LILAC, "#ffffff", 0.3), trailA);
        // (it follows the ball's arcs, which stay above the column tops and their values)
        ctx.beginPath();
        const tEnd = Math.min(f, hopEnd);
        for (let ff = HOPS[0], first = true; ff <= tEnd + 0.01; ff += 0.5, first = false) {
          const q = ballAt(ff);
          first ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // landing flares on each top edge
        for (let j = 0; j < HOPS.length; j++) {
          const tt = f - HOPS[j];
          if (tt < 0 || tt > 20) continue;
          const fl = Math.exp(-tt / 5) * (1 - 0.6 * backK(j)) * colA(j);
          const hgt = -IMAGENET[j].err * U;
          const l = P(SLOT_X[j] - BWD / 2, hgt, FZ0);
          const r = P(SLOT_X[j] + BWD / 2, hgt, FZ0);
          const last = j === HOPS.length - 1;
          glowStroke(
            ctx,
            () => {
              ctx.moveTo(l.x, l.y);
              ctx.lineTo(r.x, r.y);
            },
            last ? MAG : j < 2 ? "#b8c6ea" : LILAC,
            3,
            fl,
          );
          const p = topPt(j);
          glow(ctx, p.x, p.y, (last ? 120 : 80) * zs, last ? MAG : VIO, 0.85 * fl, 0.05);
          glow(ctx, p.x, p.y, 16 * zs, "#ffffff", fl);
        }
        // the ball and its comet tail
        if (ballA > 0.01) {
          for (let k = 12; k >= 1; k--) {
            const q = ballAt(f - k * 0.4);
            const kk = 1 - k / 13;
            glow(ctx, q.x, q.y, (6 + 14 * kk) * zs, LILAC, ballA * kk * 0.65);
          }
          const q = ballAt(f);
          glow(ctx, q.x, q.y, 64 * zs, VIO, 0.75 * ballA, 0.05);
          glow(ctx, q.x, q.y, 20 * zs, "#ffffff", ballA);
        }
        ctx.restore();
        ctx.globalAlpha = ca;
      }

      // ---- impact sparks thrown from the foot of the column (kept off the labels and the caption band) ----
      if (impact) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const t = tImp;
        for (let n = 0; n < 340; n++) {
          const th = hash(n * 1.37) * TAU;
          const v = 0.05 + 0.2 * hash(n * 3.91);
          const drag = 0.05 + 0.06 * hash(n * 2.3);
          const dd = (v / drag) * (1 - Math.exp(-drag * t));
          const up = 0.03 + 0.17 * hash(n * 7.7) * hash(n * 7.7);
          const yv = Math.max(0, up * t - 0.009 * t * t);
          const r0 = 0.3 + 0.05 * hash(n * 5.5);
          const p = project(cam, SLOT_X[2] + Math.cos(th) * (r0 + dd), -yv, Math.sin(th) * (r0 + dd) * (Math.sin(th) < 0 ? 0.45 : 0.8));
          if (!p) continue;
          const life = Math.exp(-t / (8 + 26 * hash(n * 9.9)));
          const col = n % 5 === 0 ? "#ffffff" : n % 3 ? LILAC : MAG;
          glow(ctx, p.x, p.y, (0.012 + 0.03 * life * hash(n * 2.2)) * p.s + 1.5, col, life * maskAt(p.x, p.y));
        }
        ctx.restore();
        ctx.globalAlpha = ca;
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- the drop: from the runner-up's height down to AlexNet's ----
      const ar = prog(f, DROP + 18, DROP + 42);
      const arA = clutter * ca;
      if (ar > 0 && arA > 0.01) {
        const y0 = -RUNNER_UP * U;
        const y1 = -15.3 * U - 0.09;
        // the old level carried across the AlexNet column, then the drop
        const pA = P(GHOST_X0, y0, GHOST_Z0);
        const pL = P(SLOT_X[2] - BWD / 2 - 0.06, y0, FZ0);
        const pB = P(SLOT_X[2], y0, FZ0);
        const p1 = ease.outCubic(clamp(ar / 0.35));
        const p2 = ease.inOutCubic(clamp((ar - 0.3) / 0.7));
        ctx.globalCompositeOperation = "lighter";
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = withAlpha("#d8dcf0", 0.55 * arA);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(lerp(pA.x, pL.x, p1), lerp(pA.y, pL.y, p1));
        ctx.stroke();
        ctx.setLineDash([]);
        if (p2 > 0) {
          const pe = P(SLOT_X[2], lerp(y0, y1, p2), FZ0);
          glowStroke(
            ctx,
            () => {
              ctx.moveTo(pB.x, pB.y);
              ctx.lineTo(pe.x, pe.y);
            },
            MAG,
            4,
            arA,
          );
          ctx.fillStyle = withAlpha("#ffd6f4", arA);
          ctx.beginPath();
          ctx.moveTo(pe.x - 15, pe.y - 18);
          ctx.lineTo(pe.x + 15, pe.y - 18);
          ctx.lineTo(pe.x, pe.y + 2);
          ctx.closePath();
          ctx.fill();
          glow(ctx, pe.x, pe.y - 6, 34, MAG, 0.8 * arA);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // runner-up label
      if (ga > 0.01) {
        const p = P((GHOST_X0 + GHOST_X1) / 2 + 0.06, -RUNNER_UP * U, GHOST_Z0);
        ctx.globalAlpha = ga * ca;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 6;
        font(ctx, 700, 22);
        ctx.fillStyle = "#d8dcf0";
        ctx.fillText("第二名", p.x, p.y - 46);
        font(ctx, 800, 27, true);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(RUNNER_UP.toFixed(1), p.x, p.y - 14);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = ca;
      }

      // ---- the human line: a gold spark gathers at the left end, then sweeps across the columns' front plane ----
      const gather = ease.inOutSine(prog(f, HUMAN - 16, HUMAN)) * (1 - prog(f, HUMAN + 2, HUMAN + 10));
      if (gather > 0.01) {
        const s0 = P(X_L, HY, LZ);
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, s0.x, s0.y, 30 + 50 * gather, GOLD, 0.9 * gather);
        glow(ctx, s0.x, s0.y, 10, "#ffffff", gather);
        ctx.globalCompositeOperation = "source-over";
      }
      if (sw > 0) {
        ctx.globalCompositeOperation = "lighter";
        const a = P(X_L, HY, LZ);
        const b = P(xe, HY, LZ);
        const breath = 0.86 + 0.14 * Math.sin(f * 0.11);
        const flare = (tC >= 0 ? Math.exp(-tC / 8) : 0) + 0.8 * flareF;
        glowStroke(
          ctx,
          () => {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          },
          GOLD,
          3 + 2.5 * flare,
          Math.min(1, breath + flare),
        );
        if (sw >= 1) {
          // a glint keeps running along the line
          const u = ((((f - HUMAN - SWEEP) / 54) % 1) + 1) % 1;
          const g = P(lerp(X_L, X_R, ease.inOutSine(u)), HY, LZ);
          const ga2 = Math.sin(u * Math.PI);
          glow(ctx, g.x, g.y, 46, GOLD, 0.55 * ga2);
          glow(ctx, g.x, g.y, 10, "#ffffff", 0.8 * ga2);
        } else {
          glow(ctx, b.x, b.y, 80, GOLD, 0.9);
          glow(ctx, b.x, b.y, 18, "#ffffff", 1);
          for (let i = 0; i < 40; i++) {
            const back = hash(i * 3.3) * 180;
            glow(ctx, b.x - back, b.y + (hash(i * 7.7) - 0.5) * 22 * (back / 180), 2 + 3 * hash(i), GOLD, (1 - back / 180) * 0.8);
          }
        }
        ctx.globalCompositeOperation = "source-over";
        const la = ease.outCubic(prog(f, HUMAN + 20, HUMAN + 36));
        if (la > 0) {
          const e = P(X_R, HY, LZ);
          const fs = 30 * zs;
          ctx.textAlign = "left";
          font(ctx, 900, fs);
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = withAlpha("#fff3c8", la);
          const tx = e.x + 18 - 16 * (1 - la);
          ctx.fillText("人类水平", tx, e.y + fs * 0.36);
          const w1 = ctx.measureText("人类水平 ").width;
          font(ctx, 800, fs, true);
          ctx.shadowColor = GOLD;
          ctx.shadowBlur = 14;
          ctx.fillText(`≈ ${HUMAN_ERR.toFixed(1)}%`, tx + w1, e.y + fs * 0.36);
          ctx.shadowBlur = 0;
        }
      }
      // contact: a bloom and a fan of gold sparks off ResNet's top
      if (tC >= 0 && tC < 36) {
        const tp = P(SLOT_X[5], -IMAGENET[5].err * U, FZ0);
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, tp.x, tp.y, 260, GOLD, 0.85 * Math.exp(-tC / 6), 0.06);
        glow(ctx, tp.x, tp.y, 70, "#ffffff", Math.exp(-tC / 4));
        for (let n = 0; n < 60; n++) {
          const th = -Math.PI * (0.08 + 0.84 * hash(n * 2.1));
          const v = 2 + 9 * hash(n * 3.7);
          const d = (v / 0.12) * (1 - Math.exp(-0.12 * tC));
          const life = Math.exp(-tC / (8 + 14 * hash(n * 5.9)));
          glow(ctx, tp.x + Math.cos(th) * d, tp.y + Math.sin(th) * d * 0.8 + 0.05 * tC * tC, 1.5 + 3 * life, n % 3 ? GOLD : "#ffffff", life);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // ResNet beats humans
      const ba = ease.outBack(prog(f, CONTACT + 2, CONTACT + 16));
      if (ba > 0) {
        const p = P(SLOT_X[5], HY, LZ);
        const fs = 54 * zs;
        const s = lerp(1.4, 1, clamp(ba)) * (1 + 0.1 * flareF);
        const ty = -40 - 18 * zs; // text baseline above the line (clear of the line label on the right)
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = ca * clamp(ba);
        // soft dark backing so the label holds over the busy columns
        ctx.save();
        ctx.translate(0, ty - fs * 0.38);
        ctx.scale(1, 0.42);
        const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, fs * 2.9);
        bg.addColorStop(0, "rgba(6,3,14,0.62)");
        bg.addColorStop(0.6, "rgba(6,3,14,0.38)");
        bg.addColorStop(1, "rgba(6,3,14,0)");
        ctx.fillStyle = bg;
        ctx.fillRect(-fs * 3, -fs * 3, fs * 6, fs * 6);
        ctx.restore();
        // gold bloom behind the letters
        ctx.globalCompositeOperation = "lighter";
        ctx.save();
        ctx.translate(0, ty - fs * 0.38);
        ctx.scale(1, 0.38);
        glow(ctx, 0, 0, fs * 2.6, GOLD, 0.34 + 0.4 * flareC + 0.35 * flareF, 0.04);
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
        ctx.translate(0, ty);
        ctx.scale(s, s);
        ctx.textAlign = "center";
        font(ctx, 900, fs);
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "#fff8e2";
        ctx.fillText("超越人类", 0, 0);
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 26 + 20 * flareF;
        ctx.fillText("超越人类", 0, 0);
        ctx.shadowBlur = 0;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(-12, 8);
        ctx.lineTo(12, 8);
        ctx.lineTo(0, 22);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // golden sparkles rising out of the ResNet column
        ctx.globalCompositeOperation = "lighter";
        const bp = P(SLOT_X[5], -IMAGENET[5].err * U, FZ0);
        for (let i = 0; i < 24; i++) {
          const u = ((f - HUMAN) * 0.02 + hash(i * 4.1)) % 1;
          const px = bp.x + (hash(i * 2.7) - 0.5) * BWD * bp.s * 1.1;
          const py = bp.y - u * (bp.y - p.y + 10);
          glow(ctx, px, py, (3 + 3 * hash(i)) * zs, GOLD, Math.sin(u * Math.PI) * (0.55 + 0.4 * fill) * clamp(ba));
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;
    }}
  />
);

const ChartTitle: React.FC = () => {
  const frame = useCurrentFrame();
  // in after the year stamp has gone; out as the camera drops toward the human line (the tall columns rise into this corner)
  const inK = ease.outCubic(prog(frame, BARS + 12, BARS + 36));
  const outK = ease.inOutCubic(prog(frame, HUMAN - 34, HUMAN - 12));
  const a = inK * (1 - outK);
  // a compact copy returns top-right once the parked cards have left, so the payoff still says what is measured
  const b = ease.outCubic(prog(frame, HUMAN + 8, HUMAN + 30));
  if (a <= 0 && b <= 0) return null;
  const lift = (1 - inK) * 16 - outK * 12;
  const shadow = `0 0 18px ${VIO}, 0 2px 6px #000`;
  return (
    <>
      {a > 0 && (
        <div style={{ position: "absolute", left: 96, top: 84, opacity: a, transform: `translateY(${lift}px)` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 42, color: "#fff", textShadow: shadow }}>ImageNet</span>
            <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 42, color: "#fff", letterSpacing: "0.04em", textShadow: shadow }}>图像识别错误率</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <div style={{ width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: `12px solid ${LILAC}`, filter: `drop-shadow(0 0 6px ${VIO})` }} />
            <span style={{ fontFamily: FONT_CN, fontWeight: 400, fontSize: 24, color: "rgba(255,255,255,0.78)", letterSpacing: "0.12em", textShadow: "0 2px 6px #000" }}>越低越好</span>
            <div style={{ width: 100, height: 1.5, background: `linear-gradient(90deg, ${withAlpha(LILAC, 0.7)}, transparent)` }} />
          </div>
        </div>
      )}
      {b > 0 && (
        <div style={{ position: "absolute", right: 96, top: 80, opacity: b, transform: `translateY(${(1 - b) * -10}px)`, textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 12, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 30, color: "#fff", textShadow: shadow }}>ImageNet</span>
            <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 30, color: "#fff", letterSpacing: "0.04em", textShadow: shadow }}>图像识别错误率</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <div style={{ width: 90, height: 1.5, background: `linear-gradient(270deg, ${withAlpha(LILAC, 0.7)}, transparent)` }} />
            <div style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: `9px solid ${LILAC}`, filter: `drop-shadow(0 0 6px ${VIO})` }} />
            <span style={{ fontFamily: FONT_CN, fontWeight: 400, fontSize: 20, color: "rgba(255,255,255,0.78)", letterSpacing: "0.12em", textShadow: "0 2px 6px #000" }}>越低越好</span>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Grade for the slam: the room darkens while it builds; on contact a burst of light from the impact point
 * (white core, violet rim, no vignette on that frame), a short violet tint, then a hard contrast punch.
 * The human line touching ResNet gets a smaller gold bloom.
 */
const HitGrade: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - DROP;
  const pre = t < 0 ? 0.34 * ease.inQuad(prog(frame, DROP - 38, DROP - 1)) : 0;
  const post = t < 1 ? 0 : 0.62 * Math.exp(-(t - 1) / 3.5);
  const vig = t === 0 ? 0 : Math.max(pre, post);
  const bloom = t === 0 ? 1 : t === 1 ? 0.3 : t === 2 ? 0.08 : 0;
  const tint = t === 1 ? 0.12 : t === 2 ? 0.06 : 0;
  const tc = frame - CONTACT;
  const gold = tc === 0 ? 0.62 : tc === 1 ? 0.34 : tc === 2 ? 0.14 : 0;
  const bx = IMPACT_PT.x;
  const by = IMPACT_PT.y - 60;
  return (
    <>
      {vig > 0.005 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 1050px 720px at ${IMPACT_PT.x}px ${IMPACT_PT.y - 130}px, rgba(0,0,0,0) 24%, rgba(0,0,0,0.88) 100%)`,
            opacity: vig,
          }}
        />
      )}
      {bloom > 0 && (
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(circle at ${bx}px ${by}px, rgba(255,255,255,1) 0px, rgba(255,250,255,0.95) 110px, rgba(236,220,255,0.7) 270px, rgba(180,140,255,0.38) 520px, rgba(140,96,255,0.22) 780px, rgba(110,70,230,0.12) 1300px)`,
              `radial-gradient(circle at ${bx}px ${by}px, rgba(0,0,0,0) 600px, rgba(160,110,255,0.5) 700px, rgba(255,90,210,0.25) 760px, rgba(0,0,0,0) 880px)`,
            ].join(", "),
            opacity: bloom,
            mixBlendMode: "screen",
          }}
        />
      )}
      {tint > 0 && <AbsoluteFill style={{ background: VIO, opacity: tint, mixBlendMode: "screen" }} />}
      {gold > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${CONTACT_PT.x}px ${CONTACT_PT.y}px, rgba(255,250,225,1) 0px, rgba(255,215,110,0.7) 120px, rgba(255,190,60,0.3) 380px, rgba(255,170,40,0.08) 900px, rgba(0,0,0,0) 1300px)`,
            opacity: gold,
            mixBlendMode: "screen",
          }}
        />
      )}
    </>
  );
};

/** A frame-wide RGB split for the first frames of the slam (SVG filter on the picture, not on the captions). */
const RGB_ID = "alexnet-rgb-split";
const rgbSplit = (f: number) => {
  const t = f - DROP;
  return t === 0 ? 14 : t === 1 ? 9 : t === 2 ? 4 : 0;
};
const RgbFilter: React.FC<{ d: number }> = ({ d }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <defs>
      <filter id={RGB_ID} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
        <feOffset in="r" dx={-d} dy={0} result="ro" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
        <feOffset in="b" dx={d} dy={0} result="bo" />
        <feBlend in="ro" in2="g" mode="screen" result="rg" />
        <feBlend in="rg" in2="bo" mode="screen" />
      </filter>
    </defs>
  </svg>
);

export const AlexNet: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = sumShake(shake(frame, DROP, 34, 26), shake(frame, CONTACT, 13, 16));
  const rumble = antK(frame) * (frame < DROP ? 1 : 0);
  const contactPhase = frame >= HUMAN;
  const punch = contactPhase
    ? frame >= CONTACT
      ? 0.03 * Math.exp(-(frame - CONTACT) / 5)
      : 0
    : frame >= DROP
      ? 0.08 * Math.exp(-(frame - DROP) / 6)
      : 0;
  const origin = contactPhase ? CONTACT_PT : IMPACT_PT;
  const fadeIn = clamp(frame / 14);
  const out = prog(frame, DUR - 18, DUR - 1);
  const dx = sh.x + (noise1(frame * 0.02) - 0.5) * 4 + (noise1(frame * 0.9 + 7) - 0.5) * 5 * rumble;
  const dy = sh.y + (noise1(frame * 0.9 + 21) - 0.5) * 4 * rumble;
  const split = rgbSplit(frame);
  return (
    <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - out) }}>
      {split > 0 && <RgbFilter d={split} />}
      <AbsoluteFill style={split > 0 ? { filter: `url(#${RGB_ID})` } : undefined}>
        <Backdrop />
        <AbsoluteFill
          style={{
            transform: `translate(${dx}px, ${dy}px) rotate(${sh.r * 0.25}rad) scale(${1 + punch})`,
            transformOrigin: `${origin.x}px ${origin.y}px`,
          }}
        >
          <ChartCanvas />
          <HeroCanvas />
          <ChartTitle />
        </AbsoluteFill>
      </AbsoluteFill>
      <HitGrade />
      <YearStamp year="2012" label="AlexNet · 多伦多大学" from={4} to={BARS + 16} color={VIO} />
      <Captions
        accent={LILAC}
        items={[
          { from: 10, to: 140, text: "2012年，AlexNet 用{{两块游戏显卡}}训练——" },
          { from: 150, to: 290, text: "把图像识别错误率从26%一口气降到{{15%}}。" },
          { from: 325, to: 465, text: "几年后，机器识图甚至{{超过了人类}}。", accent: C.gold },
        ]}
      />
    </AbsoluteFill>
  );
};
