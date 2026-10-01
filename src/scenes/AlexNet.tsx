import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake, TAU } from "../lib/math";
import { camera, project, type Cam } from "../lib/three";
import { Captions } from "../components/Caption";
import { Flash, YearStamp } from "../components/Hud";
import { HUMAN_ERR, IMAGENET } from "../data";
import { cue, sceneDuration, ticks } from "../timeline";

const DUR = sceneDuration("alexnet");
const BARS = cue("alexnet", "bars");
const DROP = cue("alexnet", "drop");
const HUMAN = cue("alexnet", "human");
/** Bar rises: 2010, 2011, 2013, 2014, 2015 (2012 is the DROP slam). */
const RISE = ticks("alexnet", "bar");
const RUNNER_UP = 26.2;

const VIO = C.violet;
const MAG = C.magenta;
const LILAC = "#c9a8ff";

// ---------------------------------------------------------------------------
// 3D helpers
type V3 = [number, number, number];
type Pt = { x: number; y: number; s: number; z: number };
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
const drawBox = (
  cam: Cam,
  X: Xf,
  b: [number, number, number, number, number, number],
  paint: (k: Face, pts: Pt[]) => void,
) => {
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

// ---------------------------------------------------------------------------
// Beat 1: two GTX 580 cards + AlexNet split across them as two parallel streams

/** 0 → hero layout, 1 → cards parked small in the upper right. */
const shrinkK = (f: number) => ease.inOutCubic(prog(f, BARS - 2, BARS + 38));
const netA = (f: number) => (1 - ease.inOutQuad(prog(f, BARS - 6, BARS + 20)));
const PARK = { x: 1588, y: 300, s: 0.34 };
const CARD_C = { x: 960, y: 648 };

const cardCam = (f: number) => lookAt([0, 0.02, 0], lerp(-0.07, 0.06, ease.inOutSine(prog(f, 0, 140))), 0.22, 10, 2040, CARD_C.x, CARD_C.y);
const netCam = (f: number) => lookAt([0, 0, 4], lerp(0.08, -0.05, ease.inOutSine(prog(f, 0, 120))), 0.3, 18, 2300, 960, 266);

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

/** Card-local point on the top of the shroud above the fan: where the "power cone" rises from. */
const EMIT: V3 = [0.0, -0.52, -0.05];

const drawCard = (ctx: CanvasRenderingContext2D, cam: Cam, f: number, ci: number, hot: number) => {
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
  const pulse = 0.75 + 0.25 * Math.sin(f * 0.21 + ci * 2.1);

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
  drawBox(cam, X, [-1.0, -0.78, -0.65, -0.6, 0.105, 0.145], (k, pts) => {
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
  // LED strips along the panel + outline of the shroud face
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

// ---- AlexNet: two streams of conv slabs receding into depth -------------
type Slab = { x: number; y: number; z: number; w: number; h: number; d: number; kind: "img" | "conv" | "fc" | "out"; s: number; gx: number; gy: number; id: number };
const SX = 1.9;
const LAYERS: [number, number, number, number, "conv" | "fc", number, number][] = [
  [1.45, 1.1, 1.1, 0.2, "conv", 9, 9],
  [2.75, 0.84, 0.84, 0.38, "conv", 7, 7],
  [3.95, 0.58, 0.58, 0.5, "conv", 5, 5],
  [4.95, 0.58, 0.58, 0.5, "conv", 5, 5],
  [5.95, 0.58, 0.58, 0.4, "conv", 5, 5],
  [7.05, 0.14, 1.05, 0.14, "fc", 1, 9],
  [7.85, 0.14, 1.05, 0.14, "fc", 1, 9],
];
const OUT_Z = 8.9;
const SLABS: Slab[] = (() => {
  const out: Slab[] = [{ x: 0, y: -0.4, z: 0, w: 1.15, h: 1.15, d: 0.05, kind: "img", s: -1, gx: 12, gy: 12, id: 0 }];
  for (const s of [0, 1])
    LAYERS.forEach(([z, w, h, d, kind, gx, gy], i) =>
      out.push({ x: s ? SX : -SX, y: 0, z, w, h, d, kind, s, gx, gy, id: 1 + s * 10 + i }),
    );
  out.push({ x: 0, y: 0, z: OUT_Z, w: 3.6, h: 0.15, d: 0.14, kind: "out", s: -1, gx: 16, gy: 1, id: 30 });
  return out.sort((a, b) => b.z - a.z);
})();
const streamCol = (s: number) => (s === 0 ? VIO : s === 1 ? MAG : LILAC);

/** The input "photo": a 12x12 mosaic of sky, ground and a warm subject. */
const imgColor = (i: number, j: number) => {
  const d = Math.hypot(i - 6.2, (j - 6.6) * 1.1);
  const n = hash(i * 7.3 + j * 3.1);
  if (d < 3.3) return mix("#ff9a3d", "#7a3a14", clamp(d / 3.3) * 0.7 + n * 0.3);
  if (j < 6) return mix("#5fa8ff", "#1b3f8a", j / 6 + n * 0.15);
  return mix("#3f8f4a", "#1d3f1f", (j - 6) / 6 + n * 0.2);
};

const wave = (f: number) => (((f + 26) * 0.19) % 11) - 1.6;

const drawNetwork = (ctx: CanvasRenderingContext2D, cam: Cam, f: number, a: number) => {
  if (a <= 0.01) return;
  const wz = wave(f);
  const act = (z: number) => 0.25 + 0.75 * Math.exp(-((z - wz) * (z - wz)) / 0.9);
  // halo behind each tower
  ctx.globalCompositeOperation = "lighter";
  for (const s of [0, 1]) {
    const hp = project(cam, s ? SX : -SX, 0, 3.6);
    if (hp) glow(ctx, hp.x, hp.y, 360, streamCol(s), 0.22 * a, 0.02);
  }
  const ip = project(cam, 0, -0.4, 0);
  if (ip) glow(ctx, ip.x, ip.y, 260, C.ice, 0.12 * a, 0.02);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = a;
  for (const sl of SLABS) {
    const col = streamCol(sl.s);
    const A = act(sl.z);
    // layers assemble from the input upward during the fade-in
    const ap = ease.outCubic(clamp((f - 2 - sl.z * 2.6) / 12));
    if (ap <= 0) continue;
    ctx.globalAlpha = a * ap;
    const yo = sl.y + (1 - ap) * 0.35;
    const b: [number, number, number, number, number, number] = [sl.x - sl.w / 2, sl.x + sl.w / 2, yo - sl.h / 2, yo + sl.h / 2, sl.z - sl.d / 2, sl.z + sl.d / 2];
    drawBox(cam, IDENT, b, (k, pts) => {
      polyPath(ctx, pts);
      if (k === "front") {
        ctx.fillStyle = sl.kind === "img" ? "rgba(6,8,16,0.9)" : withAlpha(mix("#0a0616", col, 0.25), 0.5);
        ctx.fill();
        // activation grid / photo mosaic, perspective-correct
        const g: (Pt | null)[][] = [];
        for (let i = 0; i <= sl.gx; i++) {
          g.push([]);
          for (let j = 0; j <= sl.gy; j++) g[i].push(project(cam, b[0] + (i / sl.gx) * sl.w, b[2] + (j / sl.gy) * sl.h, b[4] - 0.001));
        }
        ctx.globalCompositeOperation = sl.kind === "img" ? "source-over" : "lighter";
        for (let i = 0; i < sl.gx; i++)
          for (let j = 0; j < sl.gy; j++) {
            const p00 = g[i][j];
            const p10 = g[i + 1][j];
            const p11 = g[i + 1][j + 1];
            const p01 = g[i][j + 1];
            if (!p00 || !p10 || !p11 || !p01) continue;
            const ins = sl.kind === "img" ? 0.04 : 0.14;
            const cxp = (p00.x + p11.x) / 2;
            const cyp = (p00.y + p11.y) / 2;
            const sh = (p: Pt) => ({ x: p.x + (cxp - p.x) * ins, y: p.y + (cyp - p.y) * ins });
            polyPath(ctx, [sh(p00), sh(p10), sh(p11), sh(p01)]);
            if (sl.kind === "img") {
              ctx.fillStyle = imgColor(i, j);
            } else {
              const h = hash(i * 7.1 + j * 3.7 + sl.id * 13.3 + Math.floor(f / 3) * 0.37);
              let v = A * (0.25 + 0.75 * h * h);
              if (sl.kind === "out") v = i === 11 ? clamp(0.3 + 1.6 * A) : 0.12 + 0.3 * A * h;
              ctx.fillStyle = withAlpha(mix(col, "#ffffff", v * 0.55), clamp(v));
            }
            ctx.fill();
          }
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.fillStyle = withAlpha(col, k === "top" ? 0.16 + 0.22 * A : 0.08 + 0.14 * A);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.35), 0.35 + 0.5 * A);
      ctx.lineWidth = 1.4;
      polyPath(ctx, pts);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    });
  }
  ctx.globalAlpha = 1;
  a *= clamp((f - 18) / 16);
  ctx.globalCompositeOperation = "lighter";
  // receptive-field pyramids: a kernel window on one layer feeding one point of the next
  for (const s of [0, 1]) {
    const col = streamCol(s);
    const chain = [SLABS.find((q) => q.kind === "img")!, ...SLABS.filter((q) => q.s === s && q.kind === "conv").sort((p, q) => p.z - q.z)];
    for (let L = 0; L < chain.length - 1; L++) {
      const A = chain[L];
      const B = chain[L + 1];
      const u = 0.32 * Math.sin(f * 0.045 + L * 1.3 + s * 2.1);
      const v = 0.32 * Math.cos(f * 0.037 + L * 0.7 + s * 1.3);
      const k = (A.kind === "img" ? 0.12 : 0.2) * A.w;
      const ax = A.kind === "img" ? (s ? 0.25 : -0.25) * A.w + u * 0.35 * A.w : A.x + u * A.w;
      const ay = A.y + v * A.h;
      const az = A.z + A.d / 2;
      const tgt = project(cam, B.x + u * B.w * 0.8, v * B.h * 0.8, B.z - B.d / 2);
      const cs = [
        project(cam, ax - k / 2, ay - k / 2, az),
        project(cam, ax + k / 2, ay - k / 2, az),
        project(cam, ax + k / 2, ay + k / 2, az),
        project(cam, ax - k / 2, ay + k / 2, az),
      ];
      if (!tgt || cs.some((c) => !c)) continue;
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.3), 0.45 * a);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const c of cs) {
        ctx.moveTo(c!.x, c!.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#ffffff", 0.8 * a);
      ctx.lineWidth = 1.6;
      polyPath(ctx, cs as Pt[]);
      ctx.stroke();
      glow(ctx, tgt.x, tgt.y, 0.06 * tgt.s, col, 0.9 * a);
    }
  }
  // cross-GPU links (layer 3 and the dense layers read from both GPUs)
  const byId = (id: number) => SLABS.find((q) => q.id === id)!;
  const links: [number, number][] = [
    [2, 13],
    [12, 3],
    [6, 17],
    [16, 7],
  ];
  links.forEach(([p, q], li) => {
    const A = byId(p);
    const B = byId(q);
    for (let n = 0; n < 4; n++) {
      const pa = project(cam, A.x + (hash(n + li * 9) - 0.5) * A.w * 0.6, (hash(n * 3 + li) - 0.5) * A.h * 0.6, A.z + A.d / 2);
      const pb = project(cam, B.x + (hash(n * 5 + li) - 0.5) * B.w * 0.6, (hash(n * 7 + li) - 0.5) * B.h * 0.6, B.z - B.d / 2);
      if (!pa || !pb) continue;
      ctx.strokeStyle = withAlpha("#ffffff", 0.16 * a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  });
  // signal particles flowing input → conv → dense → output, along each stream
  for (const s of [0, 1]) {
    const col = streamCol(s);
    const sx = s ? SX : -SX;
    const path: V3[] = [[0, -0.4, 0], ...LAYERS.map(([z]) => [sx, 0, z] as V3), [sx * 0.3, 0, OUT_Z]];
    for (let i = 0; i < 70; i++) {
      const u = (f * 0.012 + hash(i * 3.3 + s * 71)) % 1;
      const segf = u * (path.length - 1);
      const si = Math.floor(segf);
      const t = segf - si;
      const p0 = path[si];
      const p1 = path[si + 1];
      const spread = lerp(0.6, 0.15, u);
      const x = lerp(p0[0], p1[0], t) + (hash(i * 1.7 + s) - 0.5) * spread;
      const y = lerp(p0[1], p1[1], t) + (hash(i * 2.9 + s) - 0.5) * spread;
      const z = lerp(p0[2], p1[2], t);
      const p = project(cam, x, y, z);
      if (!p) continue;
      glow(ctx, p.x, p.y, 0.07 * p.s + 2.5, col, 0.9 * a * Math.min(1, u * 8, (1 - u) * 8));
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
};

/** Holographic cone from each card up into its stream: the GPU computing that half of the network. */
const drawCones = (ctx: CanvasRenderingContext2D, ncam: Cam, ccam: Cam, f: number, a: number) => {
  if (a <= 0.01) return;
  ctx.globalCompositeOperation = "lighter";
  CARDS.forEach((c, ci) => {
    const X = cardXf(c.x, c.rot, c.mir);
    const w = X.p(EMIT);
    const ep = project(ccam, w[0], w[1], w[2]);
    const e = ep ? applyGroup(groupT(f), ep) : null;
    const conv1 = SLABS.find((q) => q.s === ci && q.z === LAYERS[0][0])!;
    const conv5 = SLABS.find((q) => q.s === ci && q.z === LAYERS[4][0])!;
    const l = project(ncam, conv1.x - conv1.w / 2, conv1.h / 2, conv1.z - conv1.d / 2);
    const r = project(ncam, conv1.x + conv1.w / 2, conv1.h / 2, conv1.z - conv1.d / 2);
    const far = project(ncam, conv5.x, conv5.h / 2, conv5.z);
    if (!e || !l || !r || !far) return;
    const g = ctx.createLinearGradient(e.x, e.y, (l.x + r.x) / 2, (l.y + r.y) / 2);
    g.addColorStop(0, withAlpha(c.col, 0.55 * a));
    g.addColorStop(1, withAlpha(c.col, 0.03 * a));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(l.x, l.y);
    ctx.lineTo(far.x, far.y);
    ctx.lineTo(r.x, r.y);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 26; i++) {
      const u = (f * 0.028 + hash(i * 5.1 + ci * 31)) % 1;
      const tx = lerp(l.x, r.x, hash(i * 2.3 + ci));
      const ty = lerp(l.y, r.y, hash(i * 2.3 + ci));
      glow(ctx, lerp(e.x, tx, u), lerp(e.y, ty, u), 3 + 4 * u, c.col, a * 0.8 * Math.sin(u * Math.PI));
    }
    glow(ctx, e.x, e.y, 26, c.col, 0.7 * a);
  });
  ctx.globalCompositeOperation = "source-over";
};

const HeroCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, _w, _h, f) => {
      const ncam = netCam(f);
      const ccam = cardCam(f);
      const na = netA(f);
      drawNetwork(ctx, ncam, f, na);
      drawCones(ctx, ncam, ccam, f, na);
      const g = groupT(f);
      // the cards flare when AlexNet lands
      const hot = Math.exp(-Math.max(0, f - DROP) / 14) * (f >= DROP ? 1 : 0);
      const ca = 1 - 0.35 * ease.inOutCubic(prog(f, HUMAN, HUMAN + 30));
      ctx.save();
      ctx.globalAlpha = ca;
      const base = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(g.x, g.y);
        ctx.scale(g.s, g.s);
        ctx.translate(-CARD_C.x, -CARD_C.y);
      };
      for (let ci = 0; ci < 2; ci++) {
        base();
        drawCard(ctx, ccam, f, ci, hot);
      }
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }}
  />
);

// ---------------------------------------------------------------------------
// Backdrop

const Backdrop: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const k = shrinkK(f);
      const bg = ctx.createRadialGradient(w * lerp(0.5, 0.45, k), h * lerp(0.36, 0.5, k), 0, w * 0.5, h * 0.5, w * 0.85);
      bg.addColorStop(0, "#1b0d33");
      bg.addColorStop(0.45, "#0a0618");
      bg.addColorStop(1, "#020108");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // slow bokeh
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
// Beats 2–4: the ImageNet error-rate chart

const BASE = 726;
const KPX = 18;
const AX_L = 210;
const AX_R = 1500;
const yErr = (e: number) => BASE - e * KPX;
const SLOT = [345, 540, 742, 1022, 1212, 1402];
const GHOST_X = 848;
const BW = 128;
const GW = 58;
/** Oblique depth of the 3D columns. */
const DX = 16;
const DY = -10;
const NAMES = IMAGENET.map((d) => d.label);
const riseOf = (i: number) => RISE[i < 2 ? i : i - 1];

const chartA = (f: number) => ease.outCubic(prog(f, BARS + 10, BARS + 40));
const humanSweep = (f: number) => ease.inOutCubic(prog(f, HUMAN, HUMAN + 26));
const resnetLit = (f: number) => ease.outCubic(prog(f, HUMAN + 20, HUMAN + 34));

/** The AlexNet bar: vertical offset while falling, squash/stretch after landing. */
const alexState = (f: number) => {
  const t = f - DROP;
  if (t < -10) return null;
  if (t < 0) {
    const k = ease.inCubic((t + 10) / 10);
    return { off: lerp(-(BASE + 40), 0, k), sx: lerp(0.94, 0.9, k), sy: lerp(1.05, 1.3, k), t };
  }
  const sq = Math.exp(-t / 7) * Math.sin(t * 0.55 + 0.6);
  return { off: 0, sx: 1 + 0.13 * sq, sy: 1 - 0.24 * sq, t };
};

const font = (ctx: CanvasRenderingContext2D, w: number, px: number, mono = false) => {
  ctx.font = `${w} ${px}px ${mono ? FONT_MONO : FONT_CN}`;
};

const ChartCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const ca = chartA(f);
      if (ca <= 0) return;
      ctx.globalAlpha = ca;
      // grid (no tick numbers) + axes
      ctx.lineWidth = 1;
      for (let e = 5; e <= 30; e += 5) {
        const y = yErr(e);
        const draw = ease.outCubic(prog(f, BARS + 14 + e, BARS + 40 + e));
        ctx.strokeStyle = "rgba(200,190,255,0.08)";
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.moveTo(AX_L, y);
        ctx.lineTo(lerp(AX_L, AX_R, draw), y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const ax = ease.outExpo(prog(f, BARS + 8, BARS + 36));
      ctx.strokeStyle = "rgba(235,230,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(AX_L, BASE - (BASE - yErr(31)) * ax);
      ctx.lineTo(AX_L, BASE);
      ctx.lineTo(AX_L + (AX_R - AX_L) * ax, BASE);
      ctx.stroke();

      const valText = (cx: number, top: number, bot: number, v: string, a: number) => {
        if (bot - top < 44 || a <= 0) return;
        font(ctx, 800, 30, true);
        ctx.textAlign = "center";
        ctx.fillStyle = withAlpha("#ffffff", a);
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 6;
        ctx.fillText(v, cx, bot - top >= 160 ? top + 38 : (top + bot) / 2 + 11);
        ctx.shadowBlur = 0;
      };
      const underLabel = (i: number, a: number) => {
        if (a <= 0) return;
        const x = SLOT[i];
        ctx.textAlign = "center";
        font(ctx, 800, 26, true);
        ctx.fillStyle = withAlpha("#ffffff", 0.85 * a);
        ctx.fillText(String(IMAGENET[i].year), x, BASE + 36);
        const deep = i >= 2;
        if (deep) font(ctx, 800, 23, true);
        else font(ctx, 700, 22);
        const col = i === 2 ? "#d6b8ff" : deep ? "#ff9ee3" : "rgba(170,186,220,1)";
        ctx.fillStyle = withAlpha(col, a);
        if (i === 2) {
          ctx.shadowColor = VIO;
          ctx.shadowBlur = 12;
        }
        ctx.fillText(NAMES[i], x, BASE + 70);
        ctx.shadowBlur = 0;
      };
      const bar = (cx: number, bw: number, bot: number, hpx: number, c0: string, c1: string, a: number, edge: string) => {
        const top = bot - hpx;
        const x0 = cx - bw / 2;
        const x1 = cx + bw / 2;
        // 3D column: side and top faces
        ctx.fillStyle = withAlpha(mix(c0, "#000000", 0.45), a);
        polyPath(ctx, [
          { x: x1, y: top },
          { x: x1 + DX, y: top + DY },
          { x: x1 + DX, y: bot + DY },
          { x: x1, y: bot },
        ]);
        ctx.fill();
        ctx.fillStyle = withAlpha(mix(c1, "#ffffff", 0.35), a);
        polyPath(ctx, [
          { x: x0, y: top },
          { x: x0 + DX, y: top + DY },
          { x: x1 + DX, y: top + DY },
          { x: x1, y: top },
        ]);
        ctx.fill();
        const g = ctx.createLinearGradient(0, bot, 0, top);
        g.addColorStop(0, withAlpha(c0, a));
        g.addColorStop(1, withAlpha(c1, a));
        ctx.fillStyle = g;
        ctx.fillRect(cx - bw / 2, top, bw, hpx);
        ctx.fillStyle = withAlpha(edge, a);
        ctx.fillRect(cx - bw / 2, top, bw, 3);
        ctx.strokeStyle = withAlpha(edge, 0.35 * a);
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - bw / 2 + 0.5, top + 0.5, bw - 1, hpx - 1);
        return top;
      };
      /** A diagonal specular sheen sliding across a bar (p: 0..1). */
      const sheen = (cx: number, bw: number, bot: number, hpx: number, p: number, col = "#ffffff") => {
        if (p <= 0 || p >= 1) return;
        const top = bot - hpx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - bw / 2, top, bw, hpx);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        const x = lerp(cx - bw / 2 - hpx * 0.6 - 60, cx + bw / 2 + 60, ease.inOutCubic(p));
        const g = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
        g.addColorStop(0, withAlpha(col, 0));
        g.addColorStop(0.5, withAlpha(col, 0.45 * Math.sin(p * Math.PI)));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 40, bot);
        ctx.lineTo(x + 40, bot);
        ctx.lineTo(x + 40 + hpx * 0.6, top);
        ctx.lineTo(x - 40 + hpx * 0.6, top);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };

      const dim = 1 - 0.28 * ease.inOutCubic(prog(f, HUMAN + 16, HUMAN + 40));
      // 2010, 2011 — the classic computer-vision pipelines
      for (const i of [0, 1]) {
        const t = clamp((f - riseOf(i)) / 18);
        if (t <= 0) continue;
        const e = IMAGENET[i].err * ease.outBack(t);
        const top = bar(SLOT[i], BW, BASE, e * KPX, "#1c2438", "#56688f", clamp(t * 4) * dim, "#a9b8dc");
        valText(SLOT[i], top, BASE, IMAGENET[i].err.toFixed(1), clamp((t - 0.5) * 3));
        underLabel(i, clamp(t * 3));
      }

      // 2012 slot: placeholder → slam
      const slotA = ease.outCubic(prog(f, DROP - 40, DROP - 26));
      const st = alexState(f);
      if (slotA > 0 && (!st || st.t < 2)) {
        const pa = slotA * (0.55 + 0.45 * Math.sin(f * 0.35));
        ctx.setLineDash([8, 7]);
        ctx.strokeStyle = withAlpha(LILAC, 0.55 * pa);
        ctx.lineWidth = 2;
        ctx.strokeRect(SLOT[2] - BW / 2, yErr(15.3), BW, 15.3 * KPX);
        ctx.setLineDash([]);
        font(ctx, 900, 64, true);
        ctx.textAlign = "center";
        ctx.fillStyle = withAlpha(LILAC, 0.75 * pa);
        ctx.fillText("?", SLOT[2], yErr(15.3 / 2) + 22);
        // anticipation: a column of violet light from above
        ctx.globalCompositeOperation = "lighter";
        const ant = ease.inQuad(prog(f, DROP - 30, DROP)) * (st && st.t >= 0 ? 0 : 1);
        const cg = ctx.createLinearGradient(0, 0, 0, BASE);
        cg.addColorStop(0, withAlpha(VIO, 0.38 * ant));
        cg.addColorStop(1, withAlpha(VIO, 0.02 * ant));
        ctx.fillStyle = cg;
        ctx.fillRect(SLOT[2] - BW / 2 - 6, 0, BW + 12, BASE);
        ctx.globalCompositeOperation = "source-over";
      }
      underLabel(2, slotA);

      // the runner-up ghost (appears just after the slam)
      const ga = ease.outCubic(prog(f, DROP + 8, DROP + 22));
      if (ga > 0) {
        const gt = yErr(RUNNER_UP);
        ctx.fillStyle = withAlpha("#ffffff", 0.05 * ga);
        ctx.fillRect(GHOST_X - GW / 2, gt, GW, BASE - gt);
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = withAlpha("#d8dcf0", 0.6 * ga);
        ctx.lineWidth = 2;
        ctx.strokeRect(GHOST_X - GW / 2, gt, GW, BASE - gt);
        ctx.setLineDash([]);
        ctx.textAlign = "center";
        font(ctx, 700, 22);
        ctx.fillStyle = withAlpha("#d8dcf0", 0.85 * ga);
        ctx.fillText("第二名", GHOST_X, gt - 42);
        font(ctx, 800, 26, true);
        ctx.fillStyle = withAlpha("#ffffff", 0.9 * ga);
        ctx.fillText(RUNNER_UP.toFixed(1), GHOST_X, gt - 12);
      }

      // AlexNet bar
      if (st) {
        const { off, sx, sy, t } = st;
        const hpx = 15.3 * KPX * sy;
        const bw = BW * sx;
        const bot = BASE + off;
        const top = bot - hpx;
        ctx.globalCompositeOperation = "lighter";
        if (t < 0) {
          // motion trail above the falling bar
          const tg = ctx.createLinearGradient(0, top - 420, 0, top);
          tg.addColorStop(0, withAlpha(VIO, 0));
          tg.addColorStop(1, withAlpha(LILAC, 0.55));
          ctx.fillStyle = tg;
          ctx.fillRect(SLOT[2] - bw / 2 + 8, top - 420, bw - 16, 420);
        }
        const halo = t >= 0 ? 0.35 + 0.65 * Math.exp(-t / 16) : 0.5;
        ctx.save();
        ctx.translate(SLOT[2], (top + bot) / 2);
        ctx.scale(1, (hpx / bw) * 1.1);
        glow(ctx, 0, 0, bw * 1.25, VIO, 0.55 * halo, 0.08);
        ctx.restore();
        // chromatic split for a few frames after impact
        if (t >= 0 && t < 9) {
          const ab = 14 * Math.pow(1 - t / 9, 2);
          ctx.fillStyle = withAlpha(C.cyan, 0.35 * (1 - t / 9));
          ctx.fillRect(SLOT[2] - bw / 2 - ab, top, bw, hpx);
          ctx.fillStyle = withAlpha(C.red, 0.35 * (1 - t / 9));
          ctx.fillRect(SLOT[2] - bw / 2 + ab, top, bw, hpx);
        }
        ctx.globalCompositeOperation = "source-over";
        bar(SLOT[2], bw, bot, hpx, "#5a2bd6", "#c46bff", t >= 0 ? dim : 1, "#f3e6ff");
        sheen(SLOT[2], bw, bot, hpx, prog(f, DROP + 12, DROP + 40));
        ctx.globalCompositeOperation = "lighter";
        const hotA = t >= 0 ? Math.exp(-t / 10) : 0.4;
        ctx.fillStyle = withAlpha("#ffffff", 0.55 * hotA);
        ctx.fillRect(SLOT[2] - bw / 2, top, bw, hpx);
        ctx.globalCompositeOperation = "source-over";
        valText(SLOT[2], top, bot, "15.3", 1);

        if (t >= 0) {
          ctx.globalCompositeOperation = "lighter";
          // local bloom at the foot of the bar
          glow(ctx, SLOT[2], BASE - 40, 760, VIO, 0.75 * Math.exp(-t / 7), 0.04);
          glow(ctx, SLOT[2], BASE - 20, 220, "#ffffff", 0.9 * Math.exp(-t / 4), 0.1);
          // anamorphic streak along the baseline
          const sa = Math.exp(-t / 11);
          const sg = ctx.createLinearGradient(0, 0, w, 0);
          sg.addColorStop(0, withAlpha(VIO, 0));
          sg.addColorStop(SLOT[2] / w, withAlpha("#ffffff", 0.95 * sa));
          sg.addColorStop(1, withAlpha(MAG, 0));
          ctx.fillStyle = sg;
          ctx.fillRect(0, BASE - 2 - 5 * sa, w, 4 + 10 * sa);
          // shockwave rings (flattened, on the floor) + an expanding screen ring
          for (let r = 0; r < 3; r++) {
            const tt = t - r * 4;
            if (tt < 0) continue;
            const rx = 40 + tt * (44 - r * 8) * Math.exp(-tt / 40);
            const al = Math.exp(-tt / (14 + r * 6));
            ctx.strokeStyle = withAlpha([ "#ffffff", LILAC, MAG][r], 0.85 * al);
            ctx.lineWidth = 2 + 9 * al;
            ctx.beginPath();
            ctx.ellipse(SLOT[2], BASE, rx, rx * 0.14, 0, Math.PI, TAU);
            ctx.stroke();
          }
          {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, w, BASE);
            ctx.clip();
            const rr = 60 + t * 34 * Math.exp(-t / 50);
            const al = Math.exp(-t / 12);
            ctx.strokeStyle = withAlpha(LILAC, 0.5 * al);
            ctx.lineWidth = 3 + 14 * al;
            ctx.beginPath();
            ctx.ellipse(SLOT[2], BASE - 130, rr, rr * 0.7, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
          }
          // light pillar
          const pa = Math.exp(-t / 9);
          const pg = ctx.createLinearGradient(0, 0, 0, BASE);
          pg.addColorStop(0, withAlpha(VIO, 0));
          pg.addColorStop(1, withAlpha("#ffffff", 0.5 * pa));
          ctx.fillStyle = pg;
          ctx.fillRect(SLOT[2] - bw * 0.7, 0, bw * 1.4, BASE);
          // impact sparks spraying from the foot of the bar
          if (t < 70) {
            for (let i = 0; i < 520; i++) {
              const side = i % 2 ? 1 : -1;
              const low = i % 3 === 0; // skimming along the floor
              const an = low ? -0.02 - 0.18 * hash(i * 1.37) : -0.25 - 1.2 * hash(i * 1.37);
              const v = (low ? 18 : 10) + 30 * hash(i * 3.91);
              const drag = 0.035 + 0.04 * hash(i * 7.3);
              const d = (v / drag) * (1 - Math.exp(-drag * t));
              const x0 = SLOT[2] + side * (bw / 2 - 6) + (hash(i * 5.5) - 0.5) * 16;
              const x = x0 + side * Math.cos(an) * d;
              const y = Math.min(BASE, BASE - 4 + Math.sin(an) * d + 0.07 * t * t * (0.4 + hash(i)));
              const life = Math.exp(-t / (10 + 30 * hash(i * 9.9)));
              const col = i % 5 === 0 ? "#ffffff" : i % 3 ? LILAC : MAG;
              glow(ctx, x, y, 2.5 + 7 * life * hash(i * 2.2), col, life);
            }
          }
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // the drop: from the runner-up's level down to AlexNet's
      const ar = prog(f, DROP + 18, DROP + 40);
      if (ar > 0) {
        const fade = 1 - 0.55 * ease.inOutCubic(prog(f, HUMAN - 10, HUMAN + 20));
        const y0 = yErr(RUNNER_UP);
        const y1 = yErr(15.3) - 12;
        const hx0 = GHOST_X - GW / 2;
        const hx1 = SLOT[2] - BW / 2;
        const p1 = ease.outCubic(clamp(ar / 0.35));
        const p2 = ease.inOutCubic(clamp((ar - 0.3) / 0.7));
        ctx.globalCompositeOperation = "lighter";
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = withAlpha("#d8dcf0", 0.5 * fade);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx0, y0);
        ctx.lineTo(lerp(hx0, hx1, p1), y0);
        ctx.stroke();
        ctx.setLineDash([]);
        if (p2 > 0) {
          const yy = lerp(y0, y1, p2);
          glowStroke(
            ctx,
            () => {
              ctx.moveTo(SLOT[2], y0);
              ctx.lineTo(SLOT[2], yy);
            },
            MAG,
            4,
            fade,
          );
          ctx.fillStyle = withAlpha("#ffd6f4", fade);
          ctx.beginPath();
          ctx.moveTo(SLOT[2] - 16, yy - 18);
          ctx.lineTo(SLOT[2] + 16, yy - 18);
          ctx.lineTo(SLOT[2], yy + 2);
          ctx.closePath();
          ctx.fill();
          glow(ctx, SLOT[2], yy - 6, 34, MAG, 0.8 * fade);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // 2013–2015: deep learning keeps going
      const lit = resnetLit(f);
      for (const i of [3, 4, 5]) {
        const t = clamp((f - riseOf(i)) / 14);
        if (t <= 0) continue;
        const e = IMAGENET[i].err * ease.outBack(t);
        const isRes = i === 5;
        const c0 = isRes ? mix("#7a1f8f", "#b07a10", lit) : "#7a1f8f";
        const c1 = isRes ? mix("#ff5fd2", "#ffe08a", lit) : "#ff5fd2";
        if (isRes && lit > 0) {
          ctx.globalCompositeOperation = "lighter";
          const pulse = 0.75 + 0.25 * Math.sin((f - HUMAN) * 0.2);
          ctx.save();
          ctx.translate(SLOT[i], BASE - (e * KPX) / 2);
          ctx.scale(1, 0.6);
          glow(ctx, 0, 0, 150, C.gold, 0.55 * lit * pulse, 0.1);
          ctx.restore();
          ctx.globalCompositeOperation = "source-over";
        }
        const top = bar(SLOT[i], BW, BASE, e * KPX, c0, c1, clamp(t * 4) * (isRes ? 1 : dim), isRes ? mix("#ffd0f2", "#fff6d6", lit) : "#ffd0f2");
        sheen(SLOT[i], BW, BASE, e * KPX, prog(f, riseOf(i) + 8, riseOf(i) + 30));
        if (isRes) sheen(SLOT[i], BW, BASE, e * KPX, prog(f, HUMAN + 24, HUMAN + 46), "#fff1b0");
        // settle flash
        ctx.globalCompositeOperation = "lighter";
        const fl = Math.exp(-Math.max(0, f - riseOf(i) - 6) / 6) * clamp(t * 3);
        ctx.fillStyle = withAlpha("#ffffff", 0.35 * fl);
        ctx.fillRect(SLOT[i] - BW / 2, top, BW, e * KPX);
        glow(ctx, SLOT[i], top, 60, MAG, 0.5 * fl);
        ctx.globalCompositeOperation = "source-over";
        valText(SLOT[i], top, BASE, IMAGENET[i].err.toFixed(1), clamp((t - 0.5) * 3));
        underLabel(i, clamp(t * 3));
      }

      // human-level line
      const sw = humanSweep(f);
      if (sw > 0) {
        const y = yErr(HUMAN_ERR);
        const xe = lerp(AX_L, AX_R + 8, sw);
        ctx.globalCompositeOperation = "lighter";
        // the "better than human" zone under the line
        const zg = ctx.createLinearGradient(0, y, 0, BASE);
        zg.addColorStop(0, withAlpha(C.gold, 0.14 * sw));
        zg.addColorStop(1, withAlpha(C.gold, 0.02 * sw));
        ctx.fillStyle = zg;
        ctx.fillRect(AX_L, y, xe - AX_L, BASE - y);
        glowStroke(
          ctx,
          () => {
            ctx.moveTo(AX_L, y);
            ctx.lineTo(xe, y);
          },
          C.gold,
          3,
          1,
        );
        if (sw < 1) {
          glow(ctx, xe, y, 70, C.gold, 0.9);
          glow(ctx, xe, y, 16, "#ffffff", 1);
          for (let i = 0; i < 40; i++) {
            const back = hash(i * 3.3) * 160;
            glow(ctx, xe - back, y + (hash(i * 7.7) - 0.5) * 18 * (back / 160), 2 + 3 * hash(i), C.gold, (1 - back / 160) * 0.8);
          }
        }
        ctx.globalCompositeOperation = "source-over";
        const la = ease.outCubic(prog(f, HUMAN + 22, HUMAN + 38));
        if (la > 0) {
          ctx.textAlign = "left";
          font(ctx, 900, 30);
          ctx.shadowColor = C.gold;
          ctx.shadowBlur = 16;
          ctx.fillStyle = withAlpha("#fff3c8", la);
          ctx.fillText(`人类水平 ≈ ${HUMAN_ERR.toFixed(1)}%`, AX_R + 26 - 16 * (1 - la), y + 11);
          ctx.shadowBlur = 0;
        }
      }
      // ResNet beats humans
      const ba = ease.outBack(prog(f, HUMAN + 30, HUMAN + 46));
      if (ba > 0) {
        const x = SLOT[5];
        const y = yErr(HUMAN_ERR) - 56;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(lerp(1.4, 1, clamp(ba)), lerp(1.4, 1, clamp(ba)));
        ctx.globalAlpha = ca * clamp(ba);
        ctx.textAlign = "center";
        font(ctx, 900, 36);
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = 22;
        ctx.fillStyle = "#ffffff";
        ctx.fillText("超越人类", 0, 0);
        ctx.shadowBlur = 0;
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.moveTo(-10, 14);
        ctx.lineTo(10, 14);
        ctx.lineTo(0, 26);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // sparkles rising from the ResNet bar
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 24; i++) {
          const u = ((f - HUMAN) * 0.02 + hash(i * 4.1)) % 1;
          const px = x + (hash(i * 2.7) - 0.5) * BW;
          const py = BASE - u * 150;
          glow(ctx, px, py, 3 + 3 * hash(i), C.gold, Math.sin(u * Math.PI) * 0.8 * clamp(ba));
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;
    }}
  />
);

const ChartTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, BARS + 16, BARS + 40));
  if (a <= 0) return null;
  return (
    <div style={{ position: "absolute", left: AX_L, top: 92, opacity: a, transform: `translateY(${(1 - a) * 16}px)` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 42, color: "#fff", textShadow: `0 0 18px ${VIO}` }}>ImageNet</span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 42, color: "#fff", letterSpacing: "0.04em", textShadow: `0 0 18px ${VIO}` }}>
          图像识别错误率
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "0.14em",
            color: LILAC,
            border: `1.5px solid ${withAlpha(LILAC, 0.6)}`,
            padding: "2px 10px",
          }}
        >
          TOP-5
        </span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 400, fontSize: 22, color: "rgba(255,255,255,0.7)", letterSpacing: "0.1em" }}>越低越好</span>
      </div>
    </div>
  );
};

export const AlexNet: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, DROP, 30, 24);
  const push = ease.inOutCubic(prog(frame, HUMAN, HUMAN + 110));
  const punch = frame >= DROP ? 0.04 * Math.exp(-(frame - DROP) / 7) : 0;
  const sc = 1 + 0.055 * push;
  const fadeIn = clamp(frame / 14);
  const out = prog(frame, DUR - 18, DUR);
  const drift = (noise1(frame * 0.02) - 0.5) * 4;
  return (
    <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - out) }}>
      <Backdrop />
      <AbsoluteFill style={{ transform: `translate(${sh.x + drift}px, ${sh.y}px) rotate(${sh.r * 0.2}rad)` }}>
        <AbsoluteFill style={{ transform: `scale(${sc})`, transformOrigin: "1120px 640px" }}>
          <AbsoluteFill style={{ transform: `scale(${1 + punch})`, transformOrigin: `${SLOT[2]}px ${BASE}px` }}>
            <HeroCanvas />
            <ChartCanvas />
            <ChartTitle />
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>
      <Flash at={DROP} dur={6} color="#ffffff" peak={0.3} />
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
