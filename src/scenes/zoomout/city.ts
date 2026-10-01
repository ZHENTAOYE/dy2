// City around the campus (street lights, highways, buildings, power lines) and the surrounding region of towns.
import { glow } from "../../lib/canvas";
import { clamp, hash, rng } from "../../lib/math";
import { C } from "../../lib/theme";
import { Cam, onEarth, proj, R_EARTH } from "./cam";
import { landAt } from "./earth";
import { CAMPUS_U0, CAMPUS_U1, CAMPUS_V0, CAMPUS_V1, SUBSTATION } from "./world";

type G = CanvasRenderingContext2D;

export const CC: [number, number] = [3600, -4300]; // city centre (flat u, v metres from the campus)
const CAMPUS_MID: [number, number] = [(CAMPUS_U0 + CAMPUS_U1) / 2, (CAMPUS_V0 + CAMPUS_V1) / 2];
const radiusAt = (ang: number) =>
  10800 * (0.8 + 0.16 * Math.sin(ang * 3 + 1.3) + 0.1 * Math.sin(ang * 5 - 0.4) + 0.05 * Math.sin(ang * 11));
const riverV = (u: number) => CC[1] + 1700 + 1300 * Math.sin((u - CC[0]) / 2600) + 380 * Math.sin((u - CC[0]) / 820);
const inCampus = (u: number, v: number, m: number) => u > CAMPUS_U0 - 60 - m && u < CAMPUS_U1 + m && v > CAMPUS_V0 - m && v < CAMPUS_V1 + m;

// colour buckets for batched drawing
const COLS = ["#ffb35c", "#ffdcaa", "#d9ebff", "#ff9a3c"];

type Pts = { x: Float64Array; y: Float64Array; z: Float64Array; b: Float32Array; c: Uint8Array; n: number };
const makePts = (list: number[]): Pts => {
  const n = list.length / 5;
  const o: Pts = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), b: new Float32Array(n), c: new Uint8Array(n), n };
  for (let i = 0; i < n; i++) {
    const [X, Y, Z] = onEarth(list[i * 5], list[i * 5 + 1], list[i * 5 + 2]);
    o.x[i] = X;
    o.y[i] = Y;
    o.z[i] = Z;
    o.b[i] = list[i * 5 + 3];
    o.c[i] = list[i * 5 + 4];
  }
  return o;
};

let cityPts: Pts | null = null;
const city = () => {
  if (cityPts) return cityPts;
  const L: number[] = [];
  const add = (u: number, v: number, bright: number, local: boolean) => {
    const du = u - CC[0];
    const dv = v - CC[1];
    const r = Math.hypot(du, dv);
    const R = radiusAt(Math.atan2(dv, du));
    if (r > R) return;
    if (Math.abs(v - riverV(u)) < 150) return;
    if (inCampus(u, v, 25)) return;
    const blk = hash(Math.floor(u / 660) * 3.1 + Math.floor(v / 660) * 7.7);
    if (local && blk < 0.2 && r > 2500) return; // parks / fields
    const core = clamp(1 - r / R);
    const h = hash(u * 0.0131 + v * 0.0071);
    const c = local ? (h < 0.82 ? 0 : h < 0.95 ? 1 : 3) : h < 0.45 ? 1 : h < 0.75 ? 0 : 2;
    L.push(u, v, 8, bright * (0.4 + 0.6 * core) * (0.75 + 0.25 * hash(h * 91)), c);
  };
  for (let k = -16; k <= 16; k++)
    for (let t = -13000; t <= 13000; t += 38) {
      add(CC[0] + k * 880, CC[1] + t, 1, false);
      add(CC[0] + t, CC[1] + k * 880, 1, false);
    }
  for (let k = -60; k <= 60; k++) {
    if (k % 4 === 0) continue;
    for (let t = -13000; t <= 13000; t += 52) {
      add(CC[0] + k * 220, CC[1] + t, 0.5, true);
      add(CC[0] + t, CC[1] + k * 220, 0.5, true);
    }
  }
  // lit windows / plazas in the dense core
  const r = rng(51);
  for (let i = 0; i < 9000; i++) {
    const a = r() * Math.PI * 2;
    const d = 3600 * Math.sqrt(r()) * (0.4 + 0.6 * r());
    const u = CC[0] + Math.cos(a) * d;
    const v = CC[1] + Math.sin(a) * d;
    if (Math.abs(v - riverV(u)) < 160) continue;
    L.push(u, v, 30, 0.35 + 0.4 * r(), r() < 0.6 ? 1 : 2);
  }
  cityPts = makePts(L);
  return cityPts;
};

let regionPts: Pts | null = null;
/** Town centres for bloom glows: u, v, sigma, weight. */
const TOWNS: number[] = [];
let townW: { x: Float64Array; y: Float64Array; z: Float64Array; s: Float32Array; w: Float32Array; n: number } | null = null;
const region = () => {
  if (regionPts) return regionPts;
  const r = rng(4242);
  const L: number[] = [];
  // the city itself as a blob, for when its street grid is sub-pixel
  for (let q = 0; q < 1400; q++) {
    const a = r() * Math.PI * 2;
    const d = 5200 * Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * 0.8;
    L.push(CC[0] + Math.cos(a) * d, CC[1] + Math.sin(a) * d, 0, 0.5 + 0.5 * r(), r() < 0.7 ? 0 : 1);
  }
  for (let i = 0; i < 8000; i++) {
    const ang = r() * Math.PI * 2;
    const dist = 18000 + Math.pow(r(), 0.75) * 3.4e6;
    const u = Math.cos(ang) * dist;
    const v = Math.sin(ang) * dist;
    const accept = r();
    const big = r() < 0.05;
    const n = big ? 200 + Math.floor(r() * 350) : 4 + Math.floor(r() * 20);
    const sig = big ? 4500 + r() * 6000 : 600 + r() * 2000;
    const [X, Y, Z] = onEarth(u, v, 0);
    const n0 = X / R_EARTH;
    const n2 = Z / R_EARTH;
    const dens = 0.5 + 0.3 * Math.sin(n0 * 90 + 1) * Math.sin(n2 * 70 + 2) + 0.2 * Math.sin(n0 * 210 - n2 * 160);
    if (accept > 0.2 + 0.8 * clamp(dens)) continue;
    const land = landAt(X, Y - R_EARTH - 1.9, Z);
    if (land < 0.003) continue;
    const coast = land < 0.03 ? 1 : 0.75;
    TOWNS.push(u, v, sig, coast * Math.sqrt(n) / 26);
    for (let q = 0; q < n; q++) {
      const a2 = r() * Math.PI * 2;
      const d2 = sig * Math.sqrt(-2 * Math.log(1 - r() * 0.999));
      L.push(u + Math.cos(a2) * d2, v + Math.sin(a2) * d2, 0, coast * (big ? 0.95 : 0.65) * (0.35 + 0.65 * r()), r() < 0.8 ? 0 : 1);
    }
  }
  regionPts = makePts(L);
  TOWNS.push(CC[0], CC[1], 6000, 1.6);
  const n = TOWNS.length / 4;
  townW = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), s: new Float32Array(n), w: new Float32Array(n), n };
  for (let i = 0; i < n; i++) {
    const [X, Y, Z] = onEarth(TOWNS[i * 4], TOWNS[i * 4 + 1], 0);
    townW.x[i] = X;
    townW.y[i] = Y;
    townW.z[i] = Z;
    townW.s[i] = TOWNS[i * 4 + 2];
    townW.w[i] = TOWNS[i * 4 + 3];
  }
  return regionPts;
};

/** Soft bloom around every town so the region reads like night-time satellite imagery. */
const townBloom = (g: G, c: Cam, alpha: number) => {
  region();
  const T = townW!;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < T.n; i++) {
    const q = proj(c, T.x[i], T.y[i], T.z[i], 0.001);
    if (!q || q.x < -80 || q.x > 2000 || q.y < -80 || q.y > 1160) continue;
    const r = clamp(T.s[i] * 2.6 * q.s, 2.5, 90);
    glow(g, q.x, q.y, r, "#ff9a3c", alpha * clamp(T.w[i]) * 0.55, 0.06);
  }
  g.restore();
};

/** Batched additive lamps; `sizeM` = metres a lamp's glow covers. Near lamps become glow sprites. */
const drawPts = (g: G, c: Cam, p: Pts, alpha: number, sizeM: number, minPx: number, maxPx: number) => {
  if (alpha <= 0.01) return;
  const bx: number[][] = [[], [], [], []];
  const by: number[][] = [[], [], [], []];
  const bs: number[][] = [[], [], [], []];
  const ba: number[][] = [[], [], [], []];
  const big: number[] = [];
  const cx = c.x;
  const cy = c.y;
  const cz = c.z;
  for (let i = 0; i < p.n; i++) {
    const x = p.x[i] - cx;
    const y = p.y[i] - cy;
    const z = p.z[i] - cz;
    const x1 = x * c.cyw - z * c.syw;
    const z1 = x * c.syw + z * c.cyw;
    const z2 = y * c.sp + z1 * c.cp;
    if (z2 <= c.D * 0.001) continue;
    const s = 1500 / z2;
    const sx = 960 + x1 * s;
    if (sx < -10 || sx > 1930) continue;
    const sy = 540 + (y * c.cp - z1 * c.sp) * s;
    if (sy < -10 || sy > 1090) continue;
    const px = sizeM * s;
    if (px > maxPx * 1.6) {
      if (big.length < 30000) big.push(sx, sy, Math.min(13, px * 0.5), p.b[i], p.c[i]);
      continue;
    }
    const k = p.c[i];
    bx[k].push(sx);
    by[k].push(sy);
    bs[k].push(clamp(px, minPx, maxPx));
    ba[k].push(p.b[i]);
  }
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < 4; k++) {
    g.fillStyle = COLS[k];
    const X = bx[k];
    const Y = by[k];
    const S = bs[k];
    const A = ba[k];
    for (let i = 0; i < X.length; i++) {
      g.globalAlpha = Math.min(1, alpha * A[i]);
      const s = S[i];
      g.fillRect(X[i] - s / 2, Y[i] - s / 2, s, s);
    }
  }
  g.globalAlpha = 1;
  for (let i = 0; i < big.length; i += 5) glow(g, big[i], big[i + 1], big[i + 2], COLS[big[i + 4]], alpha * big[i + 3]);
  g.restore();
};

// ------------------------------------------------------------------ highways (moving car lights)
const HIGHWAYS: [number, number][][] = [
  [
    [-16000, 2400],
    [-6000, 800],
    [-600, 420],
    [2200, -1800],
    [CC[0] - 200, CC[1] + 600],
    [12000, -10500],
    [22000, -16000],
  ],
  [
    [-2400, -18000],
    [-200, -6000],
    [1200, -2400],
    [CC[0] - 900, CC[1] - 200],
    [11000, 600],
    [19000, 6000],
  ],
  [
    [-9000, -9000],
    [CC[0] - 4000, CC[1] - 2600],
    [CC[0] + 300, CC[1] - 900],
    [CC[0] + 6000, CC[1] + 1500],
    [16000, 9000],
  ],
];
type Poly = { pts: [number, number][]; cum: number[]; L: number };
const POLYS: Poly[] = HIGHWAYS.map((pts) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, L: cum[cum.length - 1] };
});
const polyAt = (pl: Poly, t: number): [number, number, number, number] => {
  const d = clamp(t) * pl.L;
  let i = 1;
  while (i < pl.cum.length - 1 && pl.cum[i] < d) i++;
  const k = (d - pl.cum[i - 1]) / (pl.cum[i] - pl.cum[i - 1]);
  const a = pl.pts[i - 1];
  const b = pl.pts[i];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [a[0] + dx * k, a[1] + dy * k, -dy / l, dx / l];
};

const highways = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  POLYS.forEach((pl, hi) => {
    const nL = Math.floor(pl.L / 45);
    g.fillStyle = "#ffc070";
    for (let i = 0; i <= nL; i++) {
      const [u, v] = polyAt(pl, i / nL);
      const [X, Y, Z] = onEarth(u, v, 10);
      const q = proj(c, X, Y, Z, 0.001);
      if (!q || q.x < -20 || q.x > 1940 || q.y < -20 || q.y > 1100) continue;
      g.globalAlpha = 0.6 * alpha;
      const s = clamp(26 * q.s, 1, 3);
      g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    for (let i = 0; i < 520; i++) {
      const dir = i % 2;
      const sp = (24 + 10 * hash(i * 3.1 + hi)) / pl.L;
      let t = (hash(i * 1.7 + hi * 9) + f * sp) % 1;
      if (dir) t = 1 - t;
      const [u, v, nx, ny] = polyAt(pl, t);
      const off = dir ? 12 : -12;
      const [X, Y, Z] = onEarth(u + nx * off, v + ny * off, 2);
      const q = proj(c, X, Y, Z, 0.001);
      if (!q || q.x < -10 || q.x > 1930 || q.y < -10 || q.y > 1090) continue;
      g.globalAlpha = alpha * 0.95;
      g.fillStyle = dir ? "#ff3b30" : "#f4f8ff";
      const s = clamp(14 * q.s, 1, 3.5);
      g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
  });
  g.restore();
};

// ------------------------------------------------------------------ power lines feeding the campus
const PLANTS: [number, number][] = [
  [-9200, 5400],
  [-5200, -12400],
];
const LINES: [number, number][][] = PLANTS.map((pp) => {
  const [su, sv] = SUBSTATION;
  const n = Math.round(Math.hypot(pp[0] - su, pp[1] - sv) / 330);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = Math.sin(t * Math.PI) * 600;
    const dx = su - pp[0];
    const dy = sv - pp[1];
    const L = Math.hypot(dx, dy);
    pts.push([pp[0] + dx * t + (-dy / L) * bend, pp[1] + dy * t + (dx / L) * bend]);
  }
  return pts;
});

const powerLines = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  LINES.forEach((towers, li) => {
    for (let i = 0; i < towers.length; i++) {
      const [u, v] = towers[i];
      const [X, Y, Z] = onEarth(u, v, 0);
      const [Xt, Yt, Zt] = onEarth(u, v, 42);
      const b = proj(c, X, Y, Z, 0.001);
      const t = proj(c, Xt, Yt, Zt, 0.001);
      if (!b || !t) continue;
      g.globalAlpha = 0.45 * alpha;
      g.strokeStyle = "#7d8ea8";
      g.lineWidth = clamp(2 * t.s, 0.8, 4);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(t.x, t.y);
      g.stroke();
      const blink = (Math.floor(f / 15) + i) % 2 ? 1 : 0.25;
      glow(g, t.x, t.y, clamp(10 * t.s, 2, 10), C.red, alpha * 0.7 * blink);
    }
    for (let w = -1; w <= 1; w++) {
      g.globalAlpha = 0.5 * alpha;
      g.strokeStyle = "#8fb6ff";
      g.lineWidth = 1;
      g.beginPath();
      let started = false;
      for (let i = 0; i < towers.length - 1; i++) {
        const [u0, v0] = towers[i];
        const [u1, v1] = towers[i + 1];
        const dx = u1 - u0;
        const dy = v1 - v0;
        const L = Math.hypot(dx, dy);
        for (let s = 0; s <= 4; s++) {
          const t = s / 4;
          const [X, Y, Z] = onEarth(u0 + dx * t + (-dy / L) * w * 7, v0 + dy * t + (dx / L) * w * 7, 40 - 12 * Math.sin(t * Math.PI));
          const q = proj(c, X, Y, Z, 0.001);
          if (!q) {
            started = false;
            continue;
          }
          if (!started) {
            g.moveTo(q.x, q.y);
            started = true;
          } else g.lineTo(q.x, q.y);
        }
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // energy pulses flowing to the campus
    for (let q = 0; q < 18; q++) {
      const t = (f * 0.007 + q / 18 + li * 0.37) % 1;
      const pos = t * (towers.length - 1);
      const i = Math.floor(pos);
      const k = pos - i;
      const [u0, v0] = towers[i];
      const [u1, v1] = towers[Math.min(towers.length - 1, i + 1)];
      const [X, Y, Z] = onEarth(u0 + (u1 - u0) * k, v0 + (v1 - v0) * k, 40 - 12 * Math.sin(k * Math.PI));
      const p = proj(c, X, Y, Z, 0.001);
      if (!p) continue;
      glow(g, p.x, p.y, clamp(70 * p.s, 5, 30), C.cyan, alpha * 0.85);
      glow(g, p.x, p.y, clamp(20 * p.s, 2, 8), "#ffffff", alpha * 0.75);
    }
    const [pu, pv] = PLANTS[li];
    const [X, Y, Z] = onEarth(pu, pv, 30);
    const p = proj(c, X, Y, Z, 0.001);
    if (p) {
      glow(g, p.x, p.y, clamp(420 * p.s, 10, 160), C.amber, alpha * 0.45, 0.05);
      glow(g, p.x, p.y, clamp(80 * p.s, 3, 30), "#fff2d0", alpha * 0.8);
    }
  });
  g.restore();
};

// ------------------------------------------------------------------ buildings in the blocks around the campus
type Bld = { u: number; v: number; w: number; d: number; h: number; id: number };
let blds: Bld[] | null = null;
const buildings = () => {
  if (blds) return blds;
  const out: Bld[] = [];
  for (let i = -14; i <= 14; i++)
    for (let j = -14; j <= 14; j++) {
      const bu = CC[0] + Math.round((CAMPUS_MID[0] - CC[0]) / 220) * 220 + i * 220 + 110;
      const bv = CC[1] + Math.round((CAMPUS_MID[1] - CC[1]) / 220) * 220 + j * 220 + 110;
      const id = (i + 20) * 61 + j + 20;
      if (Math.hypot(bu - CAMPUS_MID[0], bv - CAMPUS_MID[1]) > 2900) continue;
      if (hash(id * 1.37) < 0.3) continue;
      if (Math.abs(bv - riverV(bu)) < 260) continue;
      const w = 60 + hash(id * 2.1) * 100;
      const d = 60 + hash(id * 3.3) * 100;
      if (inCampus(bu, bv, Math.max(w, d) / 2 + 10)) continue;
      const toCore = clamp(1 - Math.hypot(bu - CC[0], bv - CC[1]) / 7000);
      const h = 8 + 26 * hash(id * 4.7) + 110 * toCore * toCore * hash(id * 5.9);
      out.push({ u: bu + (hash(id * 6.1) - 0.5) * 20, v: bv + (hash(id * 7.3) - 0.5) * 20, w, d, h, id });
    }
  blds = out;
  return out;
};

const drawBuildings = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  const list = buildings()
    .map((b) => ({ b, p: proj(c, b.u, 1.9 - b.h / 2, -b.v, 0.001) }))
    .filter((x) => x.p && x.p.x > -300 && x.p.x < 2220 && x.p.y > -300 && x.p.y < 1380)
    .sort((a, b) => b.p!.z - a.p!.z);
  g.save();
  g.globalAlpha = alpha;
  for (const { b, p } of list) {
    const px = b.w * p!.s;
    if (px < 1.5) continue;
    const u0 = b.u - b.w / 2;
    const u1 = b.u + b.w / 2;
    const v0 = b.v - b.d / 2;
    const v1 = b.v + b.d / 2;
    const y0 = 1.9 - b.h;
    const cu = c.x;
    const cv = -c.z;
    const face = (pts: [number, number, number][], col: string, lit: number, roof: boolean) => {
      const ps = pts.map(([u, y, v]) => proj(c, u, y, -v, 0.001));
      if (ps.some((q) => !q)) return;
      g.beginPath();
      g.moveTo(ps[0]!.x, ps[0]!.y);
      for (let i = 1; i < 4; i++) g.lineTo(ps[i]!.x, ps[i]!.y);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      if (roof) {
        g.strokeStyle = "rgba(120,150,190,0.35)";
        g.lineWidth = 1;
        g.stroke();
        return;
      }
      if (px > 5) {
        g.save();
        g.globalCompositeOperation = "lighter";
        const nx = Math.max(2, Math.min(7, Math.round(px / 9)));
        const ny = Math.max(1, Math.min(9, Math.round(b.h / 7)));
        const ws = clamp(px / 26, 1.2, 3);
        for (let i = 0; i < nx; i++)
          for (let j = 0; j < ny; j++) {
            if (hash(b.id * 13.1 + i * 3.7 + j * 9.1 + lit) < 0.5) continue;
            const s = (i + 0.5) / nx;
            const t = (j + 0.5) / ny;
            const ax = ps[0]!.x + (ps[1]!.x - ps[0]!.x) * s;
            const ay = ps[0]!.y + (ps[1]!.y - ps[0]!.y) * s;
            const bx = ps[3]!.x + (ps[2]!.x - ps[3]!.x) * s;
            const by = ps[3]!.y + (ps[2]!.y - ps[3]!.y) * s;
            g.fillStyle = hash(b.id + i * 0.3 + j * 0.7) < 0.72 ? "rgba(255,196,120,0.85)" : "rgba(200,225,255,0.8)";
            g.fillRect(ax + (bx - ax) * t - ws / 2, ay + (by - ay) * t - ws / 2, ws, ws);
          }
        g.restore();
      }
    };
    if (cu < u0) face([[u0, y0, v1], [u0, y0, v0], [u0, 1.9, v0], [u0, 1.9, v1]], "#0b0f16", 1, false);
    if (cu > u1) face([[u1, y0, v0], [u1, y0, v1], [u1, 1.9, v1], [u1, 1.9, v0]], "#0b0f16", 2, false);
    if (cv > v1) face([[u0, y0, v1], [u1, y0, v1], [u1, 1.9, v1], [u0, 1.9, v1]], "#0f141c", 3, false);
    if (cv < v0) face([[u1, y0, v0], [u0, y0, v0], [u0, 1.9, v0], [u1, 1.9, v0]], "#0f141c", 4, false);
    if (c.y < y0) face([[u0, y0, v0], [u1, y0, v0], [u1, y0, v1], [u0, y0, v1]], "#151b25", 0, true);
    if (b.h > 60) {
      const t = proj(c, b.u, y0 - 2, -b.v, 0.001);
      if (t) glow(g, t.x, t.y, clamp(6 * t.s, 2, 8), C.red, (Math.floor(f / 20 + b.id) % 2 ? 0.8 : 0.2) * alpha);
    }
  }
  g.restore();
};

// ------------------------------------------------------------------ entry
/** City + region layers. Fades are by camera distance. */
export const drawCity = (g: G, c: Cam, f: number) => {
  const D = c.D;
  const cityA = clamp((D - 60) / 300) * (1 - clamp((D - 3.5e4) / 1.2e5));
  const regA = clamp((D - 8000) / 30000) * (1 - clamp((D - 7e6) / 1e7));
  if (cityA <= 0 && regA <= 0) return;
  if (cityA > 0) {
    // warm sky-glow over the city
    const [X, Y, Z] = onEarth(CC[0], CC[1], 0);
    const p = proj(c, X, Y, Z, 0.001);
    if (p) {
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(g, p.x, p.y, clamp(11000 * p.s, 40, 2400), "#ff9a3c", 0.2 * cityA * clamp((D - 800) / 3000), 0.02);
      g.restore();
    }
  }
  if (regA > 0) {
    townBloom(g, c, regA);
    drawPts(g, c, region(), regA * 1.25, 260, 1, 2.4);
  }
  if (cityA > 0) {
    drawBuildings(g, c, f, clamp((D - 120) / 250) * (1 - clamp((D - 5000) / 7000)));
    drawPts(g, c, city(), cityA, 24, 1, 3.2);
    highways(g, c, f, cityA * (1 - clamp((D - 6e4) / 8e4)));
    powerLines(g, c, f, cityA * (1 - clamp((D - 8e4) / 1e5)));
  }
  // the campus as a cyan beacon once it is small
  const ba = clamp((D - 500) / 1500) * (1 - clamp((D - 4e5) / 6e5));
  if (ba > 0) {
    const [X, Y, Z] = onEarth(CAMPUS_MID[0], CAMPUS_MID[1], 0);
    const p = proj(c, X, Y, Z, 0.001);
    if (p) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const pulse = 0.8 + 0.2 * Math.sin(f * 0.25);
      glow(g, p.x, p.y, clamp(240 * p.s, 22, 200) * pulse, C.cyan, 0.75 * ba, 0.08);
      glow(g, p.x, p.y, Math.max(6, 60 * p.s), "#ffffff", 0.8 * ba);
      const rt = (((f - 600) % 40) + 40) % 40 / 40;
      g.strokeStyle = `rgba(56,214,255,${0.6 * ba * (1 - rt)})`;
      g.lineWidth = 2;
      g.beginPath();
      const rr = Math.max(20, 200 * p.s) * (0.4 + 1.6 * rt);
      g.ellipse(p.x, p.y, rr, rr * Math.max(0.3, Math.abs(c.sp)), 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
};
