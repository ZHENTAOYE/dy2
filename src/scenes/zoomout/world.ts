// 3D part of the ZoomOut scene: the server tray (drawer), racks of 72 GPUs, data halls and the campus.
import { glow, glowStroke, mix, withAlpha } from "../../lib/canvas";
import { clamp, hash } from "../../lib/math";
import { C } from "../../lib/theme";
import {
  Cam,
  depth,
  FLOOR_Y,
  HALL_OFF,
  MOD_COLS,
  MOD_H,
  MOD_ROWS,
  MOD_W,
  P2,
  proj,
  PULL0,
  pullAt,
  RACK_DEPTH,
  RACK_FRONT,
  RACK_TOP,
  RACK_U,
  RACK,
  SERVER,
  RACK_W,
  RACKS_PER_ROW,
  ROW_PITCH,
  ROWS,
  TRAY_C0,
  TRAY_D,
  TRAY_PITCH,
  TRAY_W,
} from "./cam";
import { moduleTexture } from "./chip";

const mk = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

type G = CanvasRenderingContext2D;

const path = (g: G, ps: P2[]) => {
  g.beginPath();
  g.moveTo(ps[0].x, ps[0].y);
  for (let i = 1; i < ps.length; i++) g.lineTo(ps[i].x, ps[i].y);
  g.closePath();
};

/** Project a (u, Y, v) point (flat coords + height). */
const P = (c: Cam, u: number, y: number, v: number) => proj(c, u, y, -v);

const quad = (g: G, c: Cam, pts: [number, number, number][], fill: string | CanvasGradient) => {
  const ps: P2[] = [];
  for (const [u, y, v] of pts) {
    const p = P(c, u, y, v);
    if (!p) return null;
    ps.push(p);
  }
  path(g, ps);
  g.fillStyle = fill;
  g.fill();
  return ps;
};

/** Axis-aligned box in (u, Y, v); y0 < y1 (y0 is the top). Draws only faces turned to the camera. */
const box = (
  g: G,
  c: Cam,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  v0: number,
  v1: number,
  top: string,
  side: string,
  front: string,
) => {
  const cu = c.x;
  const cv = -c.z;
  if (cu < u0) quad(g, c, [[u0, y0, v0], [u0, y0, v1], [u0, y1, v1], [u0, y1, v0]], side);
  if (cu > u1) quad(g, c, [[u1, y0, v0], [u1, y0, v1], [u1, y1, v1], [u1, y1, v0]], side);
  if (cv > v1) quad(g, c, [[u0, y0, v1], [u1, y0, v1], [u1, y1, v1], [u0, y1, v1]], front);
  if (cv < v0) quad(g, c, [[u0, y0, v0], [u1, y0, v0], [u1, y1, v0], [u0, y1, v0]], side);
  if (c.y < y0) quad(g, c, [[u0, y0, v0], [u1, y0, v0], [u1, y0, v1], [u0, y0, v1]], top);
};

/** Draw an image onto a projected parallelogram/quad (two affine triangles for accuracy). */
const texQuad = (g: G, img: CanvasImageSource, iw: number, ih: number, p00: P2, p10: P2, p01: P2, p11: P2, alpha = 1) => {
  const tri = (a: P2, b: P2, cc: P2, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    // affine mapping texture (ax,ay)->a, (bx,by)->b, (cx,cy)->cc
    const den = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(den) < 1e-9) return;
    const m11 = ((b.x - a.x) * (cy - ay) - (cc.x - a.x) * (by - ay)) / den;
    const m12 = ((cc.x - a.x) * (bx - ax) - (b.x - a.x) * (cx - ax)) / den;
    const m21 = ((b.y - a.y) * (cy - ay) - (cc.y - a.y) * (by - ay)) / den;
    const m22 = ((cc.y - a.y) * (bx - ax) - (b.y - a.y) * (cx - ax)) / den;
    const dx = a.x - m11 * ax - m12 * ay;
    const dy = a.y - m21 * ax - m22 * ay;
    g.save();
    g.beginPath();
    // slightly expanded triangle to hide seams
    const mx = (a.x + b.x + cc.x) / 3;
    const my = (a.y + b.y + cc.y) / 3;
    const ex = (p: P2) => [p.x + Math.sign(p.x - mx) * 0.6, p.y + Math.sign(p.y - my) * 0.6];
    const [x1, y1] = ex(a);
    const [x2, y2] = ex(b);
    const [x3, y3] = ex(cc);
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineTo(x3, y3);
    g.closePath();
    g.clip();
    g.globalAlpha *= alpha;
    g.transform(m11, m21, m12, m22, dx, dy);
    g.drawImage(img, 0, 0);
    g.restore();
  };
  tri(p00, p10, p01, 0, 0, iw, 0, 0, ih);
  tri(p10, p11, p01, iw, 0, iw, ih, 0, ih);
};

const bil = (p00: P2, p10: P2, p01: P2, p11: P2, s: number, t: number) => {
  const ax = p00.x + (p10.x - p00.x) * s;
  const ay = p00.y + (p10.y - p00.y) * s;
  const bx = p01.x + (p11.x - p01.x) * s;
  const by = p01.y + (p11.y - p01.y) * s;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
};

// ------------------------------------------------------------------ textures
const TF_W = 600; // tray front: 0.6 m x 0.178 m at 1 mm/px
const TF_H = 178;
const FAN_U = [-0.18, -0.09, 0, 0.09, 0.18];
const LED_X = (i: number) => 0.075 + i * 0.0575; // GPU status LEDs (front-local x, metres)

const drawTrayFront = (g: CanvasRenderingContext2D, x0: number, y0: number) => {
  const s = 1000;
  const gr = g.createLinearGradient(0, y0, 0, y0 + TF_H);
  gr.addColorStop(0, "#2a313c");
  gr.addColorStop(0.15, "#1a1f27");
  gr.addColorStop(1, "#11151b");
  g.fillStyle = gr;
  g.fillRect(x0 + 30, y0 + 2, 540, TF_H - 4);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(x0 + 30, y0 + 2, 540, 2);
  // fans behind a perforated grille
  for (const fu of FAN_U) {
    const cx = x0 + 300 + fu * s;
    const cy = y0 + 104;
    g.fillStyle = "#06080b";
    g.beginPath();
    g.arc(cx, cy, 39, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(140,160,190,0.25)";
    g.lineWidth = 1.5;
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2;
      g.beginPath();
      g.arc(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 20, a + 1.9, a + 3.0);
      g.stroke();
    }
    g.fillStyle = "#2a2f38";
    g.beginPath();
    g.arc(cx, cy, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(160,180,210,0.18)";
    for (let yy = -36; yy <= 36; yy += 6)
      for (let xx = -36; xx <= 36; xx += 6) if (xx * xx + yy * yy < 37 * 37) g.fillRect(cx + xx + ((yy / 6) % 2 ? 3 : 0) - 1, cy + yy - 1, 2, 2);
    g.strokeStyle = "rgba(160,180,210,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 39, 0, Math.PI * 2);
    g.stroke();
  }
  // GPU status windows
  for (let i = 0; i < 8; i++) {
    g.fillStyle = "#05070a";
    g.fillRect(x0 + LED_X(i) * s, y0 + 30, 40, 12);
    g.fillStyle = "rgba(56,214,255,0.25)";
    g.fillRect(x0 + LED_X(i) * s + 2, y0 + 32, 36, 8);
  }
  // handles
  g.fillStyle = "#8d96a6";
  g.fillRect(x0 + 38, y0 + 20, 6, 140);
  g.fillRect(x0 + 556, y0 + 20, 6, 140);
};

let rackFront: HTMLCanvasElement | null = null;
const RF_H = 2090;
/** Front of a rack: 9 GPU trays (72 GPUs), switch trays, power shelves. 1 mm / px. */
const rackFrontTex = () => {
  if (rackFront) return rackFront;
  const c = mk(TF_W, RF_H);
  const g = c.getContext("2d")!;
  g.fillStyle = "#0c0f14";
  g.fillRect(0, 0, TF_W, RF_H);
  // posts
  for (const x of [0, 570]) {
    const gr = g.createLinearGradient(x, 0, x + 30, 0);
    gr.addColorStop(0, "#1c2129");
    gr.addColorStop(0.5, "#2e3540");
    gr.addColorStop(1, "#161a20");
    g.fillStyle = gr;
    g.fillRect(x, 0, 30, RF_H);
    g.fillStyle = "#07090c";
    for (let y = 10; y < RF_H; y += 15) g.fillRect(x + 11, y, 8, 8);
  }
  g.fillStyle = "#1a1f27";
  g.fillRect(0, 0, TF_W, 21);
  for (let k = 0; k < 9; k++) drawTrayFront(g, 0, 21 + k * 178);
  // NVLink switch trays
  for (let k = 0; k < 2; k++) {
    const y = 1623 + k * 44.5;
    g.fillStyle = "#151a21";
    g.fillRect(30, y + 2, 540, 40);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = "#05070a";
      g.fillRect(60 + i * 27, y + 10, 20, 14);
      g.fillStyle = i % 3 ? "#7a3cff" : "#ff3ec8";
      g.fillRect(64 + i * 27, y + 26, 12, 3);
    }
  }
  // power shelves
  for (let k = 0; k < 2; k++) {
    const y = 1712 + k * 89;
    g.fillStyle = "#171b22";
    g.fillRect(30, y + 2, 540, 85);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = "#0a0c10";
      g.fillRect(42 + i * 88, y + 8, 80, 72);
      g.fillStyle = "rgba(150,170,200,0.2)";
      for (let yy = 0; yy < 8; yy++) g.fillRect(48 + i * 88, y + 14 + yy * 8, 68, 3);
    }
  }
  // base vent
  g.fillStyle = "#101318";
  g.fillRect(30, 1890, 540, 200);
  g.fillStyle = "rgba(120,140,170,0.15)";
  for (let y = 1900; y < 2080; y += 10) g.fillRect(40, y, 520, 4);
  // cable bundles along the posts
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = i % 2 ? "rgba(255,62,200,0.35)" : "rgba(56,214,255,0.35)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(34 + i * 4, 30);
    g.bezierCurveTo(30 + i * 5, 600, 40 + i * 3, 1200, 34 + i * 4, 1880);
    g.stroke();
  }
  rackFront = c;
  return c;
};

let trayFrontC: HTMLCanvasElement | null = null;
const trayFrontTex = () => {
  if (trayFrontC) return trayFrontC;
  const c = mk(TF_W, TF_H);
  drawTrayFront(c.getContext("2d")!, 0, 0);
  trayFrontC = c;
  return c;
};

// ------------------------------------------------------------------ the tray (drawer)
const TRAY_TOP = -0.169;
const TRAY_BOT = 0.009;
export const trayCentre = (f: number): [number, number] => [TRAY_C0[0], TRAY_C0[1] - (PULL0 - pullAt(f))];

/** Draw the part of the tray with v in [vlo, vhi]. */
const drawTrayPart = (g: G, c: Cam, f: number, vlo: number, vhi: number) => {
  const [tu, tv] = trayCentre(f);
  const V0 = Math.max(tv - TRAY_D / 2, vlo);
  const V1 = Math.min(tv + TRAY_D / 2, vhi);
  if (V1 <= V0) return;
  const U0 = tu - TRAY_W / 2;
  const U1 = tu + TRAY_W / 2;
  // floor / mainboard
  quad(g, c, [[U0, 0.002, V0], [U1, 0.002, V0], [U1, 0.002, V1], [U0, 0.002, V1]], "#0b1612");
  // side walls (drawn under the contents; they are low)
  for (const su of [U0, U1]) {
    quad(g, c, [[su, TRAY_TOP + 0.09, V0], [su, TRAY_TOP + 0.09, V1], [su, TRAY_BOT, V1], [su, TRAY_BOT, V0]], "#1a1f26");
    const a = P(c, su, TRAY_TOP + 0.09, V0);
    const b = P(c, su, TRAY_TOP + 0.09, V1);
    if (a && b) {
      g.strokeStyle = "rgba(190,205,230,0.45)";
      g.lineWidth = clamp(0.003 * a.s, 1, 3);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
  }
  // modules
  const tex = moduleTexture();
  for (const mc of MOD_COLS)
    for (const mr of MOD_ROWS) {
      const mu = tu + mc;
      const mv = tv + mr;
      const a0 = Math.max(mv - MOD_H / 2, V0);
      const a1 = Math.min(mv + MOD_H / 2, V1);
      if (a1 <= a0) continue;
      const p00 = P(c, mu - MOD_W / 2, 0, mv - MOD_H / 2);
      const p10 = P(c, mu + MOD_W / 2, 0, mv - MOD_H / 2);
      const p01 = P(c, mu - MOD_W / 2, 0, mv + MOD_H / 2);
      const p11 = P(c, mu + MOD_W / 2, 0, mv + MOD_H / 2);
      if (!p00 || !p10 || !p01 || !p11) continue;
      const partial = a0 > mv - MOD_H / 2 + 1e-6 || a1 < mv + MOD_H / 2 - 1e-6;
      g.save();
      if (partial) {
        const q = [P(c, mu - MOD_W / 2, 0, a0), P(c, mu + MOD_W / 2, 0, a0), P(c, mu + MOD_W / 2, 0, a1), P(c, mu - MOD_W / 2, 0, a1)];
        if (q.some((p) => !p)) {
          g.restore();
          continue;
        }
        path(g, q as P2[]);
        g.clip();
      }
      texQuad(g, tex, tex.width, tex.height, p00, p10, p01, p11);
      g.restore();
    }
  // NVSwitch chips, CPUs + DIMMs, fans as boxes (sorted far -> near)
  type B = [number, number, number, number, number, number, string, string, string];
  const boxes: B[] = [];
  for (const su of [-0.165, -0.055, 0.055, 0.165]) boxes.push([su - 0.025, su + 0.025, -0.03, 0, -0.05, 0, "#2b313b", "#1a1e25", "#232831"]);
  for (const s of [-1, 1]) {
    boxes.push([s * 0.11 - 0.035, s * 0.11 + 0.035, -0.035, 0, 0.075, 0.145, "#3a3f4a", "#20242b", "#2a2f38"]);
    for (let d = 0; d < 8; d++) {
      const du = s * 0.11 + (d < 4 ? -0.05 - d * 0.011 : 0.05 + (d - 4) * 0.011);
      boxes.push([du - 0.003, du + 0.003, -0.04, 0, 0.04, 0.18, "#1c3a2c", "#10241b", "#16301f"]);
    }
  }
  for (const fu of FAN_U) boxes.push([fu - 0.041, fu + 0.041, -0.082, 0, 0.29, 0.37, "#14171c", "#0e1014", "#14171c"]);
  const vis = boxes
    .map((b) => {
      const v0 = Math.max(tv + b[4], V0);
      const v1 = Math.min(tv + b[5], V1);
      return { b, v0, v1, d: depth(c, tu + (b[0] + b[1]) / 2, (b[2] + b[3]) / 2, -(v0 + v1) / 2) };
    })
    .filter((x) => x.v1 > x.v0)
    .sort((a, b) => b.d - a.d);
  for (const { b, v0, v1 } of vis) box(g, c, tu + b[0], tu + b[1], b[2], b[3], v0, v1, b[6], b[7], b[8]);
  // fan blades (top view), spinning
  for (const fu of FAN_U) {
    const fv = tv + 0.33;
    if (fv < V0 || fv > V1) continue;
    const p = P(c, tu + fu, -0.082, fv);
    if (!p) continue;
    const r = 0.036 * p.s;
    if (r < 2) continue;
    g.save();
    g.translate(p.x, p.y);
    g.scale(1, Math.max(0.15, Math.abs(c.sp)));
    g.strokeStyle = "rgba(150,170,200,0.35)";
    g.lineWidth = Math.max(1, r * 0.06);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(120,140,170,0.22)";
    const rot = f * 0.9 + fu * 10;
    for (let b = 0; b < 7; b++) {
      const a = rot + (b / 7) * Math.PI * 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r * 0.92, a, a + 0.5);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  // coolant loops (glowing) running in the gaps between the module columns
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const u = tu - 0.22 + i * 0.11;
    const va = Math.max(tv - 0.375, V0);
    const vb = Math.min(tv + 0.27, V1);
    if (vb <= va) continue;
    const a = P(c, u, -0.006, va);
    const b = P(c, u, -0.006, vb);
    if (!a || !b) continue;
    const w = clamp(0.004 * Math.min(a.s, b.s), 0.8, 3.2);
    glowStroke(g, () => {
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }, i % 2 ? C.cyan : "#5ab8ff", w, 0.38);
    // coolant flow beads
    for (let q = 0; q < 4; q++) {
      const t = (f * 0.01 + q / 4 + i * 0.13) % 1;
      const vq = va + (vb - va) * (1 - t);
      const p = P(c, u, -0.006, vq);
      if (p) glow(g, p.x, p.y, w * 3.5, C.cyan, 0.5);
    }
  }
  // module activity glows: the 8 GPUs light up one after another while the counter climbs 1 -> 8
  for (let mi = 0; mi < 8; mi++) {
    const mc = MOD_COLS[MOD_ORDER[mi] % 4];
    const mr = MOD_ROWS[MOD_ORDER[mi] < 4 ? 0 : 1];
    const mv = tv + mr - 0.018;
    if (mv < V0 || mv > V1) continue;
    const p = P(c, tu + mc, -0.004, mv);
    if (!p) continue;
    const t = f - (SERVER + 8 + mi * 4.2);
    const ign = mi === 0 ? 1 : clamp(t / 4);
    const fl = 0.75 + 0.25 * Math.sin(f * 0.3 + mc * 40 + mr * 17);
    glow(g, p.x, p.y, 0.055 * p.s, C.cyan, (0.1 + 0.4 * ign) * fl);
    if (t > 0 && t < 14 && mi > 0) {
      const k = 1 - t / 14;
      glow(g, p.x, p.y, 0.09 * p.s * (1.2 - k * 0.6), "#ffffff", 0.55 * k);
    }
  }
  g.restore();
  // front panel
  const vf = tv + TRAY_D / 2;
  if (vf >= V0 && vf <= V1 + 1e-6 && -c.z > vf - 10) {
    const q00 = P(c, tu - 0.3, TRAY_TOP, vf);
    const q10 = P(c, tu + 0.3, TRAY_TOP, vf);
    const q01 = P(c, tu - 0.3, TRAY_BOT, vf);
    const q11 = P(c, tu + 0.3, TRAY_BOT, vf);
    if (q00 && q10 && q01 && q11 && -c.z > vf) {
      const tf = trayFrontTex();
      texQuad(g, tf, TF_W, TF_H, q00, q10, q01, q11);
      gpuLeds(g, f, q00, q10, q01, q11, 0, 1.3);
    }
  }
};

/** Animated GPU status LEDs on one tray front (quad = the 0.6 m x 0.178 m panel). */
const gpuLeds = (g: G, f: number, p00: P2, p10: P2, p01: P2, p11: P2, seed: number, boost = 1) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  const sc = Math.hypot(p10.x - p00.x, p10.y - p00.y) / 0.6;
  for (let i = 0; i < 8; i++) {
    const p = bil(p00, p10, p01, p11, (LED_X(i) + 0.02) / 0.6, 0.036 / 0.178);
    const busy = 0.6 + 0.4 * hash(seed * 7.3 + i * 1.7 + Math.floor(f / 3 + hash(seed + i) * 3));
    glow(g, p.x, p.y, Math.max(2.5, 0.032 * sc), C.cyan, 0.8 * busy * boost);
    if (sc > 250) {
      g.fillStyle = withAlpha("#d8f6ff", Math.min(1, 0.85 * busy * boost));
      g.fillRect(p.x - 0.017 * sc, p.y - 0.004 * sc, 0.034 * sc, 0.008 * sc);
    }
  }
  g.restore();
};

// ------------------------------------------------------------------ racks
/** Order in which the 8 modules light up (focus module = column 1, row 1 first). */
const MOD_ORDER = [5, 4, 6, 7, 1, 0, 2, 3];
/** 0..1 ignition of tray k of the focus rack (top to bottom) while the counter climbs 8 -> 72. */
const trayIgn = (f: number, k: number) => (k === 0 ? 1 : clamp((f - (RACK + 2 + k * 3.7)) / 4));
type Rack = { u: number; v: number; id: number; hall: number; focus: boolean; end: number };
export const RACKS: Rack[] = [];
for (let h = 0; h < HALL_OFF.length; h++)
  for (let r = 0; r < ROWS; r++)
    for (let ci = 0; ci < RACKS_PER_ROW; ci++) {
      const cidx = ci - 20;
      RACKS.push({
        u: RACK_U + HALL_OFF[h][0] + cidx * RACK_W,
        v: RACK_FRONT + HALL_OFF[h][1] - r * ROW_PITCH,
        id: RACKS.length,
        hall: h,
        focus: h === 0 && r === 0 && cidx === 0,
        end: ci === 0 ? -1 : ci === RACKS_PER_ROW - 1 ? 1 : 0,
      });
    }

/** Per-tray LED bars (simplified LOD) on a projected rack front. */
const ledBars = (g: G, f: number, p00: P2, p10: P2, p01: P2, p11: P2, id: number, a: number) => {
  for (let k = 0; k < 9; k++) {
    const t = (0.021 + 0.036 + k * TRAY_PITCH) / 2.09;
    const l = bil(p00, p10, p01, p11, 0.12, t);
    const r = bil(p00, p10, p01, p11, 0.88, t);
    const busy = 0.55 + 0.45 * hash(id * 3.1 + k * 7.7 + Math.floor(f / 4 + hash(id + k) * 4));
    g.strokeStyle = withAlpha(C.cyan, a * busy);
    g.beginPath();
    g.moveTo(l.x, l.y);
    g.lineTo(r.x, r.y);
    g.stroke();
  }
};

const drawRack = (g: G, c: Cam, f: number, rk: Rack, pc: P2, trayOut: boolean) => {
  const u0 = rk.u - RACK_W / 2;
  const u1 = rk.u + RACK_W / 2;
  const v1 = rk.v;
  const v0 = rk.v - RACK_DEPTH;
  const px = RACK_W * pc.s;
  if (px < 2.2) {
    const fl = 0.55 + 0.45 * hash(rk.id * 1.3 + Math.floor(f / 5 + hash(rk.id) * 5));
    g.fillStyle = withAlpha(mix(C.cyan, C.blue, hash(rk.id * 0.7)), 0.75 * fl * clamp(px / 1.2));
    const sz = Math.max(1.2, px);
    g.fillRect(pc.x - sz / 2, pc.y - sz / 2, sz, sz);
    return;
  }
  const cu = c.x;
  const cv = -c.z;
  // side + back + top
  const side = "#0b0e13";
  if (cu < u0 && rk.end === -1) quad(g, c, [[u0, RACK_TOP, v0], [u0, RACK_TOP, v1], [u0, FLOOR_Y, v1], [u0, FLOOR_Y, v0]], side);
  if (cu > u1 && rk.end === 1) quad(g, c, [[u1, RACK_TOP, v0], [u1, RACK_TOP, v1], [u1, FLOOR_Y, v1], [u1, FLOOR_Y, v0]], side);
  if (cv < v0) quad(g, c, [[u0, RACK_TOP, v0], [u1, RACK_TOP, v0], [u1, FLOOR_Y, v0], [u0, FLOOR_Y, v0]], "#0d1016");
  const front = cv > v1;
  let f00: P2 | null = null;
  let f10: P2 | null = null;
  let f01: P2 | null = null;
  let f11: P2 | null = null;
  if (front) {
    f00 = P(c, u0, RACK_TOP, v1);
    f10 = P(c, u1, RACK_TOP, v1);
    f01 = P(c, u0, FLOOR_Y, v1);
    f11 = P(c, u1, FLOOR_Y, v1);
  }
  if (front && f00 && f10 && f01 && f11) {
    if (px > 40) {
      texQuad(g, rackFrontTex(), TF_W, RF_H, f00, f10, f01, f11);
      if (trayOut) {
        // the top slot is open: dark recess
        const a = bil(f00, f10, f01, f11, 0.05, 0.021 / 2.09);
        const b = bil(f00, f10, f01, f11, 0.95, 0.021 / 2.09);
        const d = bil(f00, f10, f01, f11, 0.95, 0.199 / 2.09);
        const e = bil(f00, f10, f01, f11, 0.05, 0.199 / 2.09);
        g.fillStyle = "#020305";
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineTo(d.x, d.y);
        g.lineTo(e.x, e.y);
        g.closePath();
        g.fill();
      }
      for (let k = trayOut ? 1 : 0; k < 9; k++) {
        const t0 = (0.021 + k * TRAY_PITCH) / 2.09;
        const t1 = (0.199 + k * TRAY_PITCH) / 2.09;
        const ig = rk.focus ? trayIgn(f, k) : 1;
        gpuLedsFace(g, f, f00, f10, f01, f11, rk.id * 9 + k, t0, t1, rk.focus ? 0.12 + 1.25 * ig : 1);
        const ft = rk.focus ? f - (RACK + 2 + k * 3.7) : -1;
        if (ft > 0 && ft < 12 && k > 0) {
          const a = bil(f00, f10, f01, f11, 0.05, (t0 + t1) / 2);
          const b = bil(f00, f10, f01, f11, 0.95, (t0 + t1) / 2);
          g.save();
          g.globalCompositeOperation = "lighter";
          glowStroke(g, () => {
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
          }, C.cyan, 2.5, 1 - ft / 12);
          g.restore();
        }
      }
      // switch / power LEDs
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const p = bil(f00, f10, f01, f11, 0.12 + i * 0.147, (1712 + 82) / 2090);
        glow(g, p.x, p.y, Math.max(2, 0.008 * pc.s), C.green, 0.6);
        const q = bil(f00, f10, f01, f11, 0.12 + i * 0.147, (1801 + 82) / 2090);
        glow(g, q.x, q.y, Math.max(2, 0.008 * pc.s), C.green, 0.6);
      }
      g.restore();
    } else {
      path(g, [f00, f10, f11, f01]);
      g.fillStyle = "#141a22";
      g.fill();
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineWidth = Math.max(1, px * 0.025);
      ledBars(g, f, f00, f10, f01, f11, rk.id, px > 8 ? 0.9 : 0.6);
      g.restore();
    }
  }
  if (c.y < RACK_TOP) {
    quad(g, c, [[u0, RACK_TOP, v0], [u1, RACK_TOP, v0], [u1, RACK_TOP, v1], [u0, RACK_TOP, v1]], "#141922");
    if (px > 30) {
      // vents + cable bundles running back to the overhead trays
      const a = P(c, rk.u - 0.2, RACK_TOP, v1 - 0.15);
      const b = P(c, rk.u - 0.2, RACK_TOP, v0 + 0.1);
      const a2 = P(c, rk.u + 0.2, RACK_TOP, v1 - 0.15);
      const b2 = P(c, rk.u + 0.2, RACK_TOP, v0 + 0.1);
      if (a && b && a2 && b2) {
        g.strokeStyle = "rgba(255,62,200,0.16)";
        g.lineWidth = clamp(0.025 * a.s, 1, 5);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.strokeStyle = "rgba(56,214,255,0.16)";
        g.beginPath();
        g.moveTo(a2.x, a2.y);
        g.lineTo(b2.x, b2.y);
        g.stroke();
      }
    }
  }
};

/** Full GPU LEDs for one tray slot of a rack face spanning [t0, t1] of the face height. */
const gpuLedsFace = (g: G, f: number, p00: P2, p10: P2, p01: P2, p11: P2, seed: number, t0: number, t1: number, boost: number) => {
  const q = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, s: 1, z: 1 });
  gpuLeds(g, f, q(bil(p00, p10, p01, p11, 0, t0)), q(bil(p00, p10, p01, p11, 1, t0)), q(bil(p00, p10, p01, p11, 0, t1)), q(bil(p00, p10, p01, p11, 1, t1)), seed, boost);
};

// ------------------------------------------------------------------ halls, cable trays, campus
const HALL_U0 = RACK_U - 20 * RACK_W - 2.2;
const HALL_U1 = RACK_U + 19 * RACK_W + 2.2;
const HALL_V1 = RACK_FRONT + 6;
const HALL_V0 = RACK_FRONT - (ROWS - 1) * ROW_PITCH - RACK_DEPTH - 2.5;

const hallFloor = (g: G, c: Cam, f: number, h: number) => {
  const [du, dv] = HALL_OFF[h];
  const u0 = HALL_U0 + du;
  const u1 = HALL_U1 + du;
  const v0 = HALL_V0 + dv;
  const v1 = HALL_V1 + dv;
  const ps = quad(g, c, [[u0, FLOOR_Y, v0], [u1, FLOOR_Y, v0], [u1, FLOOR_Y, v1], [u0, FLOOR_Y, v1]], "#070b12");
  if (!ps) return;
  // floor tiles
  const s = (P(c, (u0 + u1) / 2, FLOOR_Y, (v0 + v1) / 2) ?? { s: 0 }).s;
  const step = 0.6 * s > 7 ? 0.6 : 0.6 * s * 10 > 7 ? 6 : 0;
  if (step) {
    g.strokeStyle = "rgba(80,120,170,0.12)";
    g.lineWidth = 1;
    g.beginPath();
    for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) {
      const a = P(c, u, FLOOR_Y, v0);
      const b = P(c, u, FLOOR_Y, v1);
      if (a && b) {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
    }
    for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) {
      const a = P(c, u0, FLOOR_Y, v);
      const b = P(c, u1, FLOOR_Y, v);
      if (a && b) {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
    }
    g.stroke();
  }
  // cold-aisle glow strips in front of every row
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let r = 0; r < ROWS; r++) {
    const vf = RACK_FRONT + dv - r * ROW_PITCH;
    const q = quad(
      g,
      c,
      [
        [u0 + 2, FLOOR_Y, vf + 0.05],
        [u1 - 2, FLOOR_Y, vf + 0.05],
        [u1 - 2, FLOOR_Y, vf + 1.2],
        [u0 + 2, FLOOR_Y, vf + 1.2],
      ],
      withAlpha(C.cyan, 0.06 + 0.02 * Math.sin(f * 0.1 + r)),
    );
    void q;
  }
  g.restore();
  // building outline (roofline, cut away)
  const ry = FLOOR_Y - 7;
  const corners: [number, number][] = [
    [u0 - 1, v0 - 1],
    [u1 + 1, v0 - 1],
    [u1 + 1, v1 + 1],
    [u0 - 1, v1 + 1],
  ];
  const top = corners.map(([u, v]) => P(c, u, ry, v));
  const bot = corners.map(([u, v]) => P(c, u, FLOOR_Y, v));
  g.save();
  g.globalCompositeOperation = "lighter";
  const la = clamp((c.D - 20) / 60);
  if (la > 0 && top.every(Boolean) && bot.every(Boolean)) {
    g.strokeStyle = withAlpha("#7fb8ff", 0.35 * la);
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = top[i]!;
      const b = top[(i + 1) % 4]!;
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.moveTo(a.x, a.y);
      g.lineTo(bot[i]!.x, bot[i]!.y);
    }
    g.stroke();
    // translucent walls
    g.fillStyle = withAlpha("#3a6aa8", 0.05 * la);
    for (let i = 0; i < 4; i++) {
      const a = top[i]!;
      const b = top[(i + 1) % 4]!;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(bot[(i + 1) % 4]!.x, bot[(i + 1) % 4]!.y);
      g.lineTo(bot[i]!.x, bot[i]!.y);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
};

type Seg = { h: number; r: number; k: number; u0: number; u1: number; v: number };
const SEGS: Seg[] = [];
const TRAY_SEGS = 10;
for (let h = 0; h < HALL_OFF.length; h++)
  for (let r = 0; r < ROWS; r++) {
    const [du, dv] = HALL_OFF[h];
    const U0 = HALL_U0 + du + 1.5;
    const U1 = HALL_U1 + du - 1.5;
    for (let k = 0; k < TRAY_SEGS; k++)
      SEGS.push({ h, r, k, u0: U0 + ((U1 - U0) * k) / TRAY_SEGS, u1: U0 + ((U1 - U0) * (k + 1)) / TRAY_SEGS, v: RACK_FRONT + dv - r * ROW_PITCH - RACK_DEPTH - 0.85 });
  }
const TRAY_Y = FLOOR_Y - 2.45;

/** One piece of an overhead cable tray, with the light streaks (data packets) that pass through it. */
const drawSeg = (g: G, c: Cam, f: number, sg: Seg) => {
  const a = P(c, sg.u0, TRAY_Y, sg.v);
  const b = P(c, sg.u1, TRAY_Y, sg.v);
  if (!a || !b) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.strokeStyle = "rgba(90,110,140,0.3)";
  g.lineWidth = clamp(0.3 * Math.min(a.s, b.s), 1, 6);
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
  const [du] = HALL_OFF[sg.h];
  const U0 = HALL_U0 + du + 1.5;
  const U1 = HALL_U1 + du - 1.5;
  for (let q = 0; q < 3; q++) {
    const id = sg.h * 100 + sg.r * 7 + q;
    const sp = 0.006 + 0.008 * hash(id * 1.3);
    const dir = hash(id * 2.7) < 0.5 ? 1 : -1;
    const t = (f * sp + hash(id * 5.1)) % 1;
    const tt = dir > 0 ? t : 1 - t;
    const ua = U0 + (U1 - U0) * clamp(tt - (dir > 0 ? 0.12 : -0.12));
    const ub = U0 + (U1 - U0) * tt;
    const lo = Math.max(Math.min(ua, ub), sg.u0);
    const hi = Math.min(Math.max(ua, ub), sg.u1);
    if (hi <= lo) continue;
    const pa = P(c, ua, TRAY_Y, sg.v);
    const pb = P(c, ub, TRAY_Y, sg.v);
    const pl = P(c, lo, TRAY_Y, sg.v);
    const ph = P(c, hi, TRAY_Y, sg.v);
    if (!pa || !pb || !pl || !ph) continue;
    const col = q === 0 ? C.cyan : q === 1 ? C.magenta : "#bfe9ff";
    const gr = g.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
    gr.addColorStop(0, withAlpha(col, 0));
    gr.addColorStop(1, withAlpha(col, 0.75));
    g.strokeStyle = gr;
    g.lineWidth = clamp(0.06 * pb.s, 1, 3);
    g.beginPath();
    g.moveTo(pl.x, pl.y);
    g.lineTo(ph.x, ph.y);
    g.stroke();
    if (ub >= sg.u0 && ub <= sg.u1) glow(g, pb.x, pb.y, clamp(0.3 * pb.s, 3, 12), col, 0.7);
  }
  g.restore();
};

/** Campus surroundings: chiller yard, substation, generators, perimeter road with lights, fibre backbone. */
const CAMPUS_U0 = HALL_U0 - 14;
const CAMPUS_U1 = HALL_U1 + 32 + 14;
const CAMPUS_V1 = HALL_V1 + 16;
const CAMPUS_V0 = HALL_V0 - 38 - 16;
export const SUBSTATION: [number, number] = [CAMPUS_U0 - 30, (CAMPUS_V0 + CAMPUS_V1) / 2];

const campus = (g: G, c: Cam, f: number) => {
  const a = clamp((c.D - 25) / 60);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  // site pad
  quad(
    g,
    c,
    [
      [CAMPUS_U0 - 45, FLOOR_Y + 0.05, CAMPUS_V0],
      [CAMPUS_U1, FLOOR_Y + 0.05, CAMPUS_V0],
      [CAMPUS_U1, FLOOR_Y + 0.05, CAMPUS_V1],
      [CAMPUS_U0 - 45, FLOOR_Y + 0.05, CAMPUS_V1],
    ],
    "#0a0e14",
  );
  // chiller yard along the far side
  const cy0 = CAMPUS_V0 + 3;
  for (let i = 0; i < 22; i++) {
    const u = CAMPUS_U0 + 6 + i * 4.6;
    box(g, c, u, u + 3.6, FLOOR_Y - 2.6, FLOOR_Y, cy0, cy0 + 9, "#1b222c", "#10151b", "#141a22");
    if (c.y < FLOOR_Y - 2.6) {
      for (let q = 0; q < 3; q++) {
        const p = P(c, u + 1.8, FLOOR_Y - 2.6, cy0 + 1.5 + q * 3);
        if (p && p.s * 1.2 > 1.5) {
          g.strokeStyle = "rgba(120,180,255,0.35)";
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(p.x, p.y, 1.3 * p.s, 1.3 * p.s * Math.max(0.2, c.sp), 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
  }
  // generators
  for (let i = 0; i < 10; i++) {
    const v = CAMPUS_V0 + 18 + i * 7;
    box(g, c, CAMPUS_U1 - 10, CAMPUS_U1 - 3, FLOOR_Y - 3, FLOOR_Y, v, v + 4.5, "#232a33", "#151a21", "#1b2129");
  }
  // substation
  const [su, sv] = SUBSTATION;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 2; j++) {
      const u = su - 12 + i * 7;
      const v = sv - 8 + j * 12;
      box(g, c, u, u + 4, FLOOR_Y - 4, FLOOR_Y, v, v + 5, "#3a3f47", "#22262d", "#2c3139");
    }
  g.globalCompositeOperation = "lighter";
  // substation glow + perimeter lights
  const sp = P(c, su, FLOOR_Y - 3, sv);
  if (sp) glow(g, sp.x, sp.y, clamp(18 * sp.s, 4, 60), C.amber, 0.3);
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    let u: number;
    let v: number;
    const per = 2 * (CAMPUS_U1 - CAMPUS_U0 + 45) + 2 * (CAMPUS_V1 - CAMPUS_V0);
    let d = t * per;
    const W = CAMPUS_U1 - CAMPUS_U0 + 45;
    const H = CAMPUS_V1 - CAMPUS_V0;
    if (d < W) [u, v] = [CAMPUS_U0 - 45 + d, CAMPUS_V1];
    else if ((d -= W) < H) [u, v] = [CAMPUS_U1, CAMPUS_V1 - d];
    else if ((d -= H) < W) [u, v] = [CAMPUS_U1 - d, CAMPUS_V0];
    else [u, v] = [CAMPUS_U0 - 45, CAMPUS_V0 + (d - W)];
    const p = P(c, u, FLOOR_Y - 8, v);
    if (p) glow(g, p.x, p.y, clamp(2.2 * p.s, 1.5, 9), "#ffcf8a", 0.7);
  }
  // internal roads between the halls
  const midU = (HALL_U1 + HALL_U0 + 32) / 2;
  const midV = (HALL_V0 + HALL_V1 - 38) / 2;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    for (const [u, v] of [
      [midU - 2.5, CAMPUS_V0 + 14 + (CAMPUS_V1 - CAMPUS_V0 - 20) * t],
      [CAMPUS_U0 - 40 + (CAMPUS_U1 - CAMPUS_U0 + 30) * t, midV + 2.5],
    ] as [number, number][]) {
      const p = P(c, u, FLOOR_Y - 6, v);
      if (p) glow(g, p.x, p.y, clamp(1.8 * p.s, 1.2, 7), "#ffd9a0", 0.6);
    }
  }
  g.restore();
};

/** Hall-scale glow: each hall reads as a block of light from far away. */
const hallGlow = (g: G, c: Cam, f: number) => {
  const a = clamp((c.D - 80) / 300);
  if (a <= 0) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let h = 0; h < 4; h++) {
    const [du, dv] = HALL_OFF[h];
    const p = P(c, (HALL_U0 + HALL_U1) / 2 + du, FLOOR_Y - 1, (HALL_V0 + HALL_V1) / 2 + dv);
    if (!p) continue;
    glow(g, p.x, p.y, Math.max(8, 30 * p.s), C.cyan, a * (0.35 + 0.08 * Math.sin(f * 0.12 + h)), 0.05);
  }
  g.restore();
};

// ------------------------------------------------------------------ entry point
/**
 * Draw tray, racks, halls and campus. Returns nothing; draws in screen space (identity transform).
 * `trayAlpha` fades the tray detail out once it is too small to matter.
 */
export const drawWorld3D = (g: G, c: Cam, f: number) => {
  const D = c.D;
  if (D > 5e4) return;
  const near = D < 40;
  // floors
  for (let h = 0; h < HALL_OFF.length; h++) {
    if (h > 0 && D < 6) continue;
    hallFloor(g, c, f, h);
  }
  campus(g, c, f);
  // racks, far -> near
  const items: { rk: Rack; p: P2; d: number }[] = [];
  for (const rk of RACKS) {
    const p = P(c, rk.u, (RACK_TOP + FLOOR_Y) / 2, rk.v - RACK_DEPTH / 2);
    if (!p) continue;
    const m = 2.2 * p.s + 40;
    if (p.x < -m || p.x > 1920 + m || p.y < -m - 2.1 * p.s || p.y > 1080 + m + 2.1 * p.s) continue;
    items.push({ rk, p, d: p.z });
  }
  const segs: { sg: Seg; d: number }[] = [];
  if (!near || D > 3)
    for (const sg of SEGS) {
      const p = P(c, (sg.u0 + sg.u1) / 2, TRAY_Y, sg.v);
      if (!p) continue;
      const m = (sg.u1 - sg.u0) * p.s;
      if (p.x < -m || p.x > 1920 + m || p.y < -200 || p.y > 1280) continue;
      segs.push({ sg, d: p.z });
    }
  type It = { d: number; rk?: Rack; p?: P2; sg?: Seg };
  const all: It[] = [...items, ...segs];
  all.sort((a, b) => b.d - a.d);
  const out = pullAt(f) > 0.003;
  for (const it of all) {
    if (it.rk && it.p) drawRack(g, c, f, it.rk, it.p, it.rk.focus && out);
    else if (it.sg) drawSeg(g, c, f, it.sg);
  }
  if (out) drawTrayPart(g, c, f, RACK_FRONT, 1e9);
  hallGlow(g, c, f);
  // highlight brackets: the 8-GPU server, then the 72-GPU rack
  const fb = focusBoxes(c, f);
  g.save();
  g.globalCompositeOperation = "lighter";
  if (fb.tray && fb.trayA > 0) brackets(g, fb.tray, fb.trayA);
  if (fb.rack && fb.rackA > 0) brackets(g, fb.rack, fb.rackA);
  g.restore();
};

const brackets = (g: G, q: P2[], a: number) => {
  g.strokeStyle = withAlpha(C.cyan, 0.95 * a);
  g.lineWidth = 3;
  g.shadowColor = C.cyan;
  g.shadowBlur = 12;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n1 = q[(i + 1) % 4];
    const n0 = q[(i + 3) % 4];
    const k = 0.16;
    g.beginPath();
    g.moveTo(p.x + (n0.x - p.x) * k, p.y + (n0.y - p.y) * k);
    g.lineTo(p.x, p.y);
    g.lineTo(p.x + (n1.x - p.x) * k, p.y + (n1.y - p.y) * k);
    g.stroke();
  }
  g.shadowBlur = 0;
};

export const TRAY_TAG: [number, number] = [298, 352];
export const RACK_TAG: [number, number] = [386, 446];
/** Screen quads (clockwise from top-left) of the focus tray and the focus rack front, with their highlight alphas. */
export const focusBoxes = (c: Cam, f: number) => {
  const [tu, tv] = trayCentre(f);
  const ta = Math.min(clamp((f - TRAY_TAG[0]) / 10), clamp((TRAY_TAG[1] - f) / 10));
  const ra = Math.min(clamp((f - RACK_TAG[0]) / 10), clamp((RACK_TAG[1] - f) / 10));
  let tray: P2[] | null = null;
  let rack: P2[] | null = null;
  if (ta > 0) {
    const m = 0.015;
    const q = [
      P(c, tu - TRAY_W / 2 - m, -0.03, tv - TRAY_D / 2 - m),
      P(c, tu + TRAY_W / 2 + m, -0.03, tv - TRAY_D / 2 - m),
      P(c, tu + TRAY_W / 2 + m, -0.03, tv - 0.04),
      P(c, tu - TRAY_W / 2 - m, -0.03, tv - 0.04),
    ];
    if (q.every(Boolean)) tray = q as P2[];
  }
  if (ra > 0) {
    const m = 0.03;
    const q = [
      P(c, RACK_U - RACK_W / 2 - m, RACK_TOP - m, RACK_FRONT),
      P(c, RACK_U + RACK_W / 2 + m, RACK_TOP - m, RACK_FRONT),
      P(c, RACK_U + RACK_W / 2 + m, FLOOR_Y, RACK_FRONT),
      P(c, RACK_U - RACK_W / 2 - m, FLOOR_Y, RACK_FRONT),
    ];
    if (q.every(Boolean)) rack = q as P2[];
  }
  return { tray, rack, trayA: ta, rackA: ra };
};

export { CAMPUS_U0, CAMPUS_U1, CAMPUS_V0, CAMPUS_V1 };
