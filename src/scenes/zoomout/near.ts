// The streets around the AI campus, seen while the camera climbs from the data hall to city scale:
// sodium-lit street grid (lamps + light pools), moving traffic, parking-lot lights and low-rise
// buildings with lit windows. Same road lattice as the far city in city.ts, so the two cross-fade cleanly.
import { glow } from "../../lib/canvas";
import { clamp, hash } from "../../lib/math";
import { C } from "../../lib/theme";
import { Cam, FLOOR_Y, proj } from "./cam";

type G = CanvasRenderingContext2D;

export const CC: [number, number] = [3600, -4300]; // city centre (flat u, v metres from the campus)
export const LOCAL = 220; // local street pitch; every 4th street is an avenue
export const NEAR_R = 1500; // radius around the campus handled by this layer
export const riverV = (u: number) => CC[1] + 1700 + 1300 * Math.sin((u - CC[0]) / 2600) + 380 * Math.sin((u - CC[0]) / 820);
/** The city block the campus occupies (bounded by streets). */
const CB = { u0: -140, u1: 80, v0: -120, v1: 100 };

type Road = { vert: boolean; c: number; a0: number; a1: number; major: boolean; id: number };
const ROADS: Road[] = [];
for (const vert of [true, false]) {
  const base = vert ? CC[0] : CC[1];
  const j0 = Math.ceil((-NEAR_R - base) / LOCAL);
  const j1 = Math.floor((NEAR_R - base) / LOCAL);
  for (let j = j0; j <= j1; j++) {
    const c = base + j * LOCAL;
    const L = Math.sqrt(Math.max(0, NEAR_R * NEAR_R - c * c));
    if (L < 100) continue;
    ROADS.push({ vert, c, a0: -L, a1: L, major: ((j % 4) + 4) % 4 === 0, id: ROADS.length });
  }
}
const pt = (r: Road, a: number, off: number): [number, number] => (r.vert ? [r.c + off, a] : [a, r.c + off]);
const inRiver = (u: number, v: number, m: number) => Math.abs(v - riverV(u)) < m;

// ------------------------------------------------------------------ static point sets (lamps, lot lights)
type Lamps = { u: Float64Array; v: Float64Array; b: Float32Array; k: Uint8Array; n: number };
let lamps: Lamps | null = null;
const lampSet = () => {
  if (lamps) return lamps;
  const U: number[] = [];
  const V: number[] = [];
  const B: number[] = [];
  const K: number[] = [];
  for (const r of ROADS) {
    const step = r.major ? 18 : 24;
    const off = r.major ? 12 : 7.5;
    for (let a = Math.ceil(r.a0 / step) * step; a <= r.a1; a += step) {
      for (const s of [-1, 1]) {
        const [u, v] = pt(r, a + (s > 0 ? step / 2 : 0), s * off);
        if (!r.major && inRiver(u, v, 140)) continue;
        U.push(u);
        V.push(v);
        B.push((r.major ? 1 : 0.72) * (0.8 + 0.2 * hash(u * 0.37 + v * 0.11)));
        K.push(r.major ? 1 : hash(u * 0.05 + v * 0.031) < 0.85 ? 0 : 2);
      }
    }
  }
  // parking-lot floodlights
  for (const b of blocks())
    for (const l of b.lots)
      if (l.lot) {
        for (const [du, dv] of [
          [-0.3, -0.3],
          [0.3, -0.3],
          [-0.3, 0.3],
          [0.3, 0.3],
        ]) {
          U.push(l.u + du * l.w);
          V.push(l.v + dv * l.d);
          B.push(0.9);
          K.push(2);
        }
      }
  const n = U.length;
  lamps = { u: Float64Array.from(U), v: Float64Array.from(V), b: Float32Array.from(B), k: Uint8Array.from(K), n };
  return lamps;
};

// ------------------------------------------------------------------ blocks, lots, buildings
type Lot = { u: number; v: number; w: number; d: number; h: number; id: number; lot: boolean; tall: boolean };
type Block = { lots: Lot[] };
let blockList: Block[] | null = null;
const blocks = () => {
  if (blockList) return blockList;
  const out: Block[] = [];
  const us = ROADS.filter((r) => r.vert).map((r) => r.c);
  const vs = ROADS.filter((r) => !r.vert).map((r) => r.c);
  let id = 0;
  for (let i = 0; i < us.length - 1; i++)
    for (let j = 0; j < vs.length - 1; j++) {
      const u0 = us[i] + 10;
      const u1 = us[i + 1] - 10;
      const v0 = vs[j] + 10;
      const v1 = vs[j + 1] - 10;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      if (Math.hypot(cu, cv) > NEAR_R - 120) continue;
      if (cu > CB.u0 && cu < CB.u1 && cv > CB.v0 && cv < CB.v1) continue; // the campus
      if (inRiver(cu, cv, 170)) continue;
      const hb = hash(i * 7.31 + j * 3.17);
      if (hb < 0.06) continue; // park
      const nu = hb < 0.5 ? 2 : 3;
      const nv = hash(i * 1.9 + j * 5.3) < 0.5 ? 2 : 3;
      const toCore = clamp(1 - Math.hypot(cu - CC[0], cv - CC[1]) / 6500);
      const lots: Lot[] = [];
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++) {
          id++;
          const lw = (u1 - u0) / nu;
          const ld = (v1 - v0) / nv;
          const h1 = hash(id * 1.37);
          const lot = h1 < 0.16;
          const fw = 0.55 + 0.3 * hash(id * 2.1);
          const fd = 0.55 + 0.3 * hash(id * 3.3);
          const tall = hash(id * 5.9) < 0.12 + 0.5 * toCore;
          const h = 7 + 12 * hash(id * 4.7) + (tall ? 18 + 70 * toCore * hash(id * 6.6) : 0);
          lots.push({
            u: u0 + lw * (a + 0.5) + (hash(id * 6.1) - 0.5) * lw * 0.12,
            v: v0 + ld * (b + 0.5) + (hash(id * 7.3) - 0.5) * ld * 0.12,
            w: lot ? lw * 0.8 : lw * fw,
            d: lot ? ld * 0.8 : ld * fd,
            h,
            id,
            lot,
            tall,
          });
        }
      out.push({ lots });
    }
  blockList = out;
  return out;
};

const P = (c: Cam, u: number, y: number, v: number) => proj(c, u, y, -v, 0.001);

const ROOFS = ["#0e131c", "#111824", "#0c1119", "#131a25", "#10151f"];

const drawBuildings = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  const list: { b: Lot; z: number; s: number }[] = [];
  for (const bl of blocks())
    for (const b of bl.lots) {
      if (b.lot) continue;
      const p = P(c, b.u, FLOOR_Y - b.h / 2, b.v);
      if (!p) continue;
      const m = Math.max(b.w, b.d, b.h) * p.s;
      if (p.x < -m || p.x > 1920 + m || p.y < -m || p.y > 1080 + m) continue;
      if (b.w * p.s < 1.2) continue;
      list.push({ b, z: p.z, s: p.s });
    }
  list.sort((a, b) => b.z - a.z);
  const cu = c.x;
  const cv = -c.z;
  g.save();
  g.globalAlpha = alpha;
  g.lineJoin = "round";
  for (const { b, s } of list) {
    const u0 = b.u - b.w / 2;
    const u1 = b.u + b.w / 2;
    const v0 = b.v - b.d / 2;
    const v1 = b.v + b.d / 2;
    const y0 = FLOOR_Y - b.h;
    const px = b.w * s;
    const face = (pts: [number, number, number][], col: string, seed: number, along: number) => {
      const ps = pts.map(([u, y, v]) => P(c, u, y, v));
      if (ps.some((q) => !q)) return;
      g.beginPath();
      g.moveTo(ps[0]!.x, ps[0]!.y);
      for (let i = 1; i < 4; i++) g.lineTo(ps[i]!.x, ps[i]!.y);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      if (seed < 0) {
        g.strokeStyle = "rgba(130,165,210,0.22)";
        g.lineWidth = 1;
        g.stroke();
        return;
      }
      // window grid (floors every ~3.6 m, bays every ~5 m)
      const fh = Math.hypot(ps[3]!.x - ps[0]!.x, ps[3]!.y - ps[0]!.y);
      if (fh < 4 || along * s < 6) return;
      const ny = Math.max(1, Math.min(22, Math.round(b.h / 3.6)));
      const nx = Math.max(1, Math.min(16, Math.round(along / 5)));
      const ws = clamp(Math.min(fh / ny, (along * s) / nx) * 0.45, 0.9, 6);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const hh = hash(b.id * 13.1 + i * 3.7 + j * 9.1 + seed * 1.3);
          if (hh < (b.tall ? 0.42 : 0.6)) continue;
          const st = (i + 0.5) / nx;
          const t = (j + 0.5) / ny;
          const ax = ps[0]!.x + (ps[1]!.x - ps[0]!.x) * st;
          const ay = ps[0]!.y + (ps[1]!.y - ps[0]!.y) * st;
          const bx = ps[3]!.x + (ps[2]!.x - ps[3]!.x) * st;
          const by = ps[3]!.y + (ps[2]!.y - ps[3]!.y) * st;
          const warm = hash(b.id + i * 0.31 + j * 0.77) < 0.72;
          g.fillStyle = warm ? `rgba(255,196,120,${0.55 + 0.4 * hh})` : `rgba(190,222,255,${0.5 + 0.4 * hh})`;
          g.fillRect(ax + (bx - ax) * t - ws / 2, ay + (by - ay) * t - ws * 0.35, ws, ws * 0.7);
        }
      g.restore();
    };
    if (cu < u0) face([[u0, y0, v1], [u0, y0, v0], [u0, FLOOR_Y, v0], [u0, FLOOR_Y, v1]], "#070a10", 1, b.d);
    if (cu > u1) face([[u1, y0, v0], [u1, y0, v1], [u1, FLOOR_Y, v1], [u1, FLOOR_Y, v0]], "#070a10", 2, b.d);
    if (cv > v1) face([[u0, y0, v1], [u1, y0, v1], [u1, FLOOR_Y, v1], [u0, FLOOR_Y, v1]], "#0a0e16", 3, b.w);
    if (cv < v0) face([[u1, y0, v0], [u0, y0, v0], [u0, FLOOR_Y, v0], [u1, FLOOR_Y, v0]], "#0a0e16", 4, b.w);
    if (c.y < y0) face([[u0, y0, v0], [u1, y0, v0], [u1, y0, v1], [u0, y0, v1]], ROOFS[b.id % ROOFS.length], -1, b.w);
    // rooftop details: a few HVAC units, the odd lit sign / skylight, aviation lights on tall ones
    const hr = hash(b.id * 8.1);
    if (px > 10 && !b.tall && hr < 0.4) {
      const q = P(c, b.u + (hash(b.id * 8.7) - 0.5) * b.w * 0.4, y0 - 1.2, b.v + (hash(b.id * 9.2) - 0.5) * b.d * 0.4);
      if (q) {
        g.fillStyle = "rgba(95,115,145,0.22)";
        const r = 2 * q.s;
        g.fillRect(q.x - r, q.y - r * 0.6, r * 2, r * 1.2);
      }
    }
    if (hr > 0.82 && px > 4) {
      const q = P(c, b.u + (hash(b.id * 3.9) - 0.5) * b.w * 0.5, y0 - 0.5, b.v + (hash(b.id * 4.4) - 0.5) * b.d * 0.5);
      if (q) {
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(g, q.x, q.y, clamp(9 * q.s, 2.5, 22), hr > 0.93 ? "#9fd8ff" : "#ffc27a", 0.55 * alpha);
        g.restore();
      }
    }
    if (b.tall && b.h > 30) {
      const t = P(c, b.u, y0 - 2, b.v);
      if (t) {
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(g, t.x, t.y, clamp(5 * t.s, 2.5, 9), C.red, (Math.floor(f / 18 + b.id) % 2 ? 0.85 : 0.15) * alpha);
        g.restore();
      }
    }
  }
  g.restore();
};

// ------------------------------------------------------------------ lamps, pools, roads, traffic
const LCOL = ["#ffb35c", "#ffcf8a", "#e8f2ff"];

const drawLamps = (g: G, c: Cam, alpha: number) => {
  const L = lampSet();
  const cx = c.x;
  const cy = c.y;
  const cz = c.z;
  const pools: number[] = [];
  const dots: number[][] = [[], [], []];
  for (let i = 0; i < L.n; i++) {
    const x = L.u[i] - cx;
    const y = FLOOR_Y - 6 - cy;
    const z = -L.v[i] - cz;
    const x1 = x * c.cyw - z * c.syw;
    const z1 = x * c.syw + z * c.cyw;
    const z2 = y * c.sp + z1 * c.cp;
    if (z2 <= c.D * 0.001) continue;
    const s = 1500 / z2;
    const sx = 960 + x1 * s;
    if (sx < -40 || sx > 1960) continue;
    const sy = 540 + (y * c.cp - z1 * c.sp) * s;
    if (sy < -40 || sy > 1120) continue;
    const pr = 13 * s;
    if (pr > 2.2) pools.push(sx, sy, Math.min(pr, 60), L.b[i], L.k[i]);
    dots[L.k[i]].push(sx, sy, clamp(1.1 * s, 1.1, 3.2), L.b[i]);
  }
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < pools.length; i += 5) {
    const r = pools[i + 2];
    glow(g, pools[i], pools[i + 1], r, LCOL[pools[i + 4]], alpha * pools[i + 3] * 0.32 * clamp((r - 2.2) / 4), 0.02);
  }
  for (let k = 0; k < 3; k++) {
    g.fillStyle = LCOL[k];
    const d = dots[k];
    for (let i = 0; i < d.length; i += 4) {
      g.globalAlpha = Math.min(1, alpha * d[i + 3] * 0.95);
      const s = d[i + 2];
      g.fillRect(d[i] - s / 2, d[i + 1] - s / 2, s, s);
    }
  }
  g.restore();
};

/** Faint lit asphalt under every street, so the grid reads as continuous lines. */
const drawRoads = (g: G, c: Cam, alpha: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const r of ROADS) {
    const w = r.major ? 15 : 9;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a0 = r.a0 + ((r.a1 - r.a0) * k) / n;
      const a1 = r.a0 + ((r.a1 - r.a0) * (k + 1)) / n;
      const q = [pt(r, a0, -w), pt(r, a1, -w), pt(r, a1, w), pt(r, a0, w)].map(([u, v]) => P(c, u, FLOOR_Y, v));
      if (q.some((p) => !p)) continue;
      const xs = q.map((p) => p!.x);
      const ys = q.map((p) => p!.y);
      if (Math.max(...xs) < 0 || Math.min(...xs) > 1920 || Math.max(...ys) < 0 || Math.min(...ys) > 1080) continue;
      g.fillStyle = `rgba(255,150,70,${(r.major ? 0.07 : 0.045) * alpha})`;
      g.beginPath();
      g.moveTo(q[0]!.x, q[0]!.y);
      for (let i = 1; i < 4; i++) g.lineTo(q[i]!.x, q[i]!.y);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
};

const drawTraffic = (g: G, c: Cam, f: number, alpha: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const r of ROADS) {
    const len = r.a1 - r.a0;
    const n = Math.round((len / 1000) * (r.major ? 26 : 7));
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      const sp = (r.major ? 0.55 : 0.35) * (0.8 + 0.4 * hash(r.id * 3.1 + i));
      let t = (hash(r.id * 1.7 + i * 0.37) * len + f * sp * 20) % len;
      if (dir < 0) t = len - t;
      const off = dir * (r.major ? 5 : 2.6);
      const [u, v] = pt(r, r.a0 + t, off);
      const q = P(c, u, FLOOR_Y - 0.8, v);
      if (!q || q.x < -10 || q.x > 1930 || q.y < -10 || q.y > 1090) continue;
      const s = clamp(2.2 * q.s, 1, 4);
      g.globalAlpha = alpha * 0.95;
      g.fillStyle = dir > 0 ? "#fff6e6" : "#ff3b30";
      g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      if (q.s > 1.2) glow(g, q.x, q.y, clamp(6 * q.s, 3, 14), dir > 0 ? "#ffe8c0" : "#ff4a3a", alpha * 0.35);
    }
  }
  g.restore();
};

/** Entry: alphas by camera distance. Returns nothing. */
export const drawNear = (g: G, c: Cam, f: number) => {
  const D = c.D;
  const a = clamp((D - 30) / 110) * (1 - clamp((D - 3600) / 4400));
  if (a <= 0.01) return;
  drawRoads(g, c, a);
  drawLamps(g, c, a);
  drawTraffic(g, c, f, a * (1 - clamp((D - 1800) / 2000)));
  drawBuildings(g, c, f, clamp((D - 40) / 120) * (1 - clamp((D - 3000) / 3500)));
};
