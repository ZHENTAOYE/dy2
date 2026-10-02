// City around the campus (street lights, highways, power lines) and the surrounding region of towns.
import { glow, glowStroke } from "../../lib/canvas";
import { clamp, hash, rng } from "../../lib/math";
import { C } from "../../lib/theme";
import { Cam, onEarth, proj, R_EARTH } from "./cam";
import { landAt } from "./earth";
import { CC, drawNear, NEAR_R, riverV } from "./near";
import { CAMPUS_U0, CAMPUS_U1, CAMPUS_V0, CAMPUS_V1, SUBSTATION } from "./world";

type G = CanvasRenderingContext2D;

export { CC };
const CAMPUS_MID: [number, number] = [(CAMPUS_U0 + CAMPUS_U1) / 2, (CAMPUS_V0 + CAMPUS_V1) / 2];
const radiusAt = (ang: number) =>
  10800 * (0.8 + 0.16 * Math.sin(ang * 3 + 1.3) + 0.1 * Math.sin(ang * 5 - 0.4) + 0.05 * Math.sin(ang * 11));
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
let cityIn: Pts | null = null;
/** Street lamps of the whole city; `cityIn` holds the ones the near layer replaces up close. */
const city = () => {
  if (cityPts) return cityPts;
  const L: number[] = [];
  const LI: number[] = [];
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
    (Math.hypot(u, v) < NEAR_R - 60 ? LI : L).push(u, v, 8, bright * (0.4 + 0.6 * core) * (0.75 + 0.25 * hash(h * 91)), c);
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
  cityIn = makePts(LI);
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
  for (let q = 0; q < 3200; q++) {
    const a = r() * Math.PI * 2;
    const d = 5200 * Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * 0.8;
    L.push(CC[0] + Math.cos(a) * d, CC[1] + Math.sin(a) * d, 0, 0.6 + 0.4 * r(), r() < 0.6 ? 0 : 1);
  }
  // suburbs and satellite villages thinning out around the city
  for (let q = 0; q < 2600; q++) {
    const a = r() * Math.PI * 2;
    const d = 7000 - 11000 * Math.log(1 - r() * 0.995);
    const sx = CC[0] + Math.cos(a) * d;
    const sy = CC[1] + Math.sin(a) * d;
    const cl = 1 + Math.floor(r() * 4);
    for (let k = 0; k < cl; k++) L.push(sx + (r() - 0.5) * 600, sy + (r() - 0.5) * 600, 0, (0.35 + 0.5 * r()) * Math.exp(-(d - 7000) / 40000), r() < 0.8 ? 0 : 1);
  }
  for (let i = 0; i < 11000; i++) {
    const ang = r() * Math.PI * 2;
    // first 5000: log-uniform in distance (15 km .. 800 km) so every zoom level has the same richness
    const nearT = i < 4000;
    const dist = nearT ? 28000 * Math.pow(800 / 28, r()) : 8e5 + Math.pow(r(), 0.75) * 2.6e6;
    const u = (nearT ? CC[0] : 0) + Math.cos(ang) * dist;
    const v = (nearT ? CC[1] : 0) + Math.sin(ang) * dist;
    const accept = r();
    const big = r() < (nearT ? 0.04 : 0.05);
    const sc = nearT ? clamp(dist / 120000, 0.35, 1.4) : 1;
    const n = big ? 200 + Math.floor(r() * 350) : 6 + Math.floor(r() * 26);
    const sig = (big ? 4000 + r() * 5000 : 500 + r() * 1800) * (nearT ? Math.sqrt(sc) : 1);
    const [X, Y, Z] = onEarth(u, v, 0);
    const n0 = X / R_EARTH;
    const n2 = Z / R_EARTH;
    const dens = 0.5 + 0.3 * Math.sin(n0 * 90 + 1) * Math.sin(n2 * 70 + 2) + 0.2 * Math.sin(n0 * 210 - n2 * 160);
    if (accept > 0.2 + 0.8 * clamp(dens)) continue;
    const land = landAt(X, Y - R_EARTH - 1.9, Z);
    if (land < 0.003) continue;
    const coast = land < 0.03 ? 1 : 0.75;
    TOWNS.push(u, v, sig, coast * Math.sqrt(n) / 26);
    if (nearT) LINKN.push(u, v, big ? 1 : 0);
    for (let q = 0; q < n; q++) {
      const a2 = r() * Math.PI * 2;
      const d2 = sig * Math.sqrt(-2 * Math.log(1 - r() * 0.999));
      L.push(u + Math.cos(a2) * d2, v + Math.sin(a2) * d2, 0, coast * (big ? 0.95 : 0.65) * (0.35 + 0.65 * r()), r() < 0.8 ? 0 : 1);
    }
  }
  regionPts = makePts(L);
  LINKN.push(CC[0], CC[1], 1);
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

const LINKN: number[] = [];
type Links = { a: Float64Array; b: Float64Array; k: Uint8Array; n: number };
let links: Links | null = null;
/** Highways between neighbouring towns (each town to its 2 nearest neighbours). */
const linkSet = () => {
  if (links) return links;
  region();
  const n = LINKN.length / 3;
  const A: number[] = [];
  const B: number[] = [];
  const K: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const ui = LINKN[i * 3];
    const vi = LINKN[i * 3 + 1];
    let b1 = -1;
    let b2 = -1;
    let d1 = Infinity;
    let d2 = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(LINKN[j * 3] - ui, LINKN[j * 3 + 1] - vi);
      if (d < d1) {
        d2 = d1;
        b2 = b1;
        d1 = d;
        b1 = j;
      } else if (d < d2) {
        d2 = d;
        b2 = j;
      }
    }
    for (const j of [b1, b2]) {
      if (j < 0) continue;
      const key = Math.min(i, j) * 100000 + Math.max(i, j);
      if (seen.has(key)) continue;
      seen.add(key);
      const uj = LINKN[j * 3];
      const vj = LINKN[j * 3 + 1];
      if (Math.hypot(uj - ui, vj - vi) > 42000) continue;
      const mid = onEarth((ui + uj) / 2, (vi + vj) / 2, 0);
      if (landAt(mid[0], mid[1] - R_EARTH - 1.9, mid[2]) < 0) continue;
      A.push(...onEarth(ui, vi, 0));
      B.push(...onEarth(uj, vj, 0));
      K.push(LINKN[i * 3 + 2] + LINKN[j * 3 + 2] > 0 ? 1 : 0);
    }
  }
  links = { a: Float64Array.from(A), b: Float64Array.from(B), k: Uint8Array.from(K), n: K.length };
  return links;
};

const highwayWeb = (g: G, c: Cam, alpha: number) => {
  if (alpha <= 0.01) return;
  const L = linkSet();
  const paths = [new Path2D(), new Path2D()];
  const pr = (X: number, Y: number, Z: number): [number, number] | null => {
    const x = X - c.x;
    const y = Y - c.y;
    const z = Z - c.z;
    const x1 = x * c.cyw - z * c.syw;
    const z1 = x * c.syw + z * c.cyw;
    const z2 = y * c.sp + z1 * c.cp;
    if (z2 <= c.D * 0.01) return null;
    const s = 1500 / z2;
    return [960 + x1 * s, 540 + (y * c.cp - z1 * c.sp) * s];
  };
  for (let i = 0; i < L.n; i++) {
    const p = pr(L.a[i * 3], L.a[i * 3 + 1], L.a[i * 3 + 2]);
    const q = pr(L.b[i * 3], L.b[i * 3 + 1], L.b[i * 3 + 2]);
    if (!p || !q) continue;
    const X0 = -c.sx;
    const Y0 = -c.sy;
    if ((p[0] < X0 && q[0] < X0) || (p[0] > X0 + 1920 && q[0] > X0 + 1920) || (p[1] < Y0 && q[1] < Y0) || (p[1] > Y0 + 1080 && q[1] > Y0 + 1080)) continue;
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 2) continue;
    paths[L.k[i]].moveTo(p[0], p[1]);
    paths[L.k[i]].lineTo(q[0], q[1]);
  }
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.strokeStyle = `rgba(255,150,70,${0.13 * alpha})`;
  g.lineWidth = 1;
  g.stroke(paths[0]);
  g.strokeStyle = `rgba(255,170,90,${0.22 * alpha})`;
  g.lineWidth = 1.4;
  g.stroke(paths[1]);
  g.restore();
};

/** Soft bloom around every town so the region reads like night-time satellite imagery. */
const townBloom = (g: G, c: Cam, alpha: number) => {
  region();
  const T = townW!;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < T.n; i++) {
    const q = proj(c, T.x[i], T.y[i], T.z[i], 0.001);
    if (!q || q.x < -80 - c.sx || q.x > 2000 - c.sx || q.y < -80 - c.sy || q.y > 1160 - c.sy) continue;
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
    if (sx < -10 - c.sx || sx > 1930 - c.sx) continue;
    const sy = 540 + (y * c.cp - z1 * c.sp) * s;
    if (sy < -10 - c.sy || sy > 1090 - c.sy) continue;
    const px = sizeM * s;
    if (px > maxPx * 1.6 && big.length < 30000) big.push(sx, sy, Math.min(10, px * 0.35), p.b[i], p.c[i]);
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
  for (let i = 0; i < big.length; i += 5) glow(g, big[i], big[i + 1], big[i + 2], COLS[big[i + 4]], alpha * big[i + 3] * 0.3, 0.05);
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

/** Highways only read near the city: they fade out with distance from its centre. */
const hwFade = (u: number, v: number) => clamp(1 - (Math.hypot(u - CC[0], v - CC[1]) - 9000) / 8000);

const highways = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  POLYS.forEach((pl, hi) => {
    const nL = Math.floor(pl.L / 45);
    g.fillStyle = "#ffc070";
    for (let i = 0; i <= nL; i++) {
      const [u, v] = polyAt(pl, i / nL);
      const near = hwFade(u, v);
      if (near <= 0) continue;
      const [X, Y, Z] = onEarth(u, v, 10);
      const q = proj(c, X, Y, Z, 0.001);
      if (!q || q.x < -20 || q.x > 1940 || q.y < -20 || q.y > 1100) continue;
      g.globalAlpha = 0.6 * alpha * near;
      const s = clamp(26 * q.s, 1, 3);
      g.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    for (let i = 0; i < 520; i++) {
      const dir = i % 2;
      const sp = (24 + 10 * hash(i * 3.1 + hi)) / pl.L;
      let t = (hash(i * 1.7 + hi * 9) + f * sp) % 1;
      if (dir) t = 1 - t;
      const [u, v, nx, ny] = polyAt(pl, t);
      const near = hwFade(u, v);
      if (near <= 0) continue;
      const off = dir ? 12 : -12;
      const [X, Y, Z] = onEarth(u + nx * off, v + ny * off, 2);
      const q = proj(c, X, Y, Z, 0.001);
      if (!q || q.x < -10 || q.x > 1930 || q.y < -10 || q.y > 1090) continue;
      g.globalAlpha = alpha * 0.95 * near;
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

const PULSE_EVERY = 12; // frames between energy pulses on each line
const PULSE_RUN = 70; // frames a pulse takes from the plant to the campus

const powerLines = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  LINES.forEach((towers, li) => {
    for (let i = 0; i < towers.length; i++) {
      const [u, v] = towers[i];
      const [X, Y, Z] = onEarth(u, v, 0);
      const [Xt, Yt, Zt] = onEarth(u, v, 42);
      const b = proj(c, X, Y, Z, 0.001);
      const t = proj(c, Xt, Yt, Zt, 0.001);
      if (!b || !t) continue;
      g.globalAlpha = 0.5 * alpha;
      g.strokeStyle = "#7d8ea8";
      g.lineWidth = clamp(2 * t.s, 1, 4);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(t.x, t.y);
      g.stroke();
      g.globalAlpha = 1;
      const blink = (Math.floor(f / 15) + i) % 2 ? 1 : 0.25;
      glow(g, t.x, t.y, clamp(10 * t.s, 3, 12), C.red, alpha * 0.75 * blink);
    }
    // the wires: one glowing strand per phase
    const wire: { x: number; y: number }[][] = [[], [], []];
    for (let w = -1; w <= 1; w++)
      for (let i = 0; i < towers.length - 1; i++) {
        const [u0, v0] = towers[i];
        const [u1, v1] = towers[i + 1];
        const dx = u1 - u0;
        const dy = v1 - v0;
        const L = Math.hypot(dx, dy);
        for (let s2 = 0; s2 < 4; s2++) {
          const t = s2 / 4;
          const [X, Y, Z] = onEarth(u0 + dx * t + (-dy / L) * w * 7, v0 + dy * t + (dx / L) * w * 7, 40 - 12 * Math.sin(t * Math.PI));
          const q = proj(c, X, Y, Z, 0.001);
          if (q) wire[w + 1].push(q);
        }
      }
    for (const ws of wire) {
      if (ws.length < 2) continue;
      glowStroke(g, () => {
        g.moveTo(ws[0].x, ws[0].y);
        for (let i = 1; i < ws.length; i++) g.lineTo(ws[i].x, ws[i].y);
      }, "#8fd0ff", 1.6, 0.42 * alpha);
    }
    // energy pulses flowing to the campus: a new one every PULSE_EVERY frames, accelerating as they arrive
    for (let q = 0; q < Math.ceil(PULSE_RUN / PULSE_EVERY) + 1; q++) {
      const born = Math.floor((f + li * 5) / PULSE_EVERY) * PULSE_EVERY - q * PULSE_EVERY - li * 5;
      const t = (f - born) / PULSE_RUN;
      if (t < 0 || t > 1) continue;
      const tt = t * t * (1.6 - 0.6 * t);
      for (let tr = 0; tr < 4; tr++) {
        const pos = clamp(tt - tr * 0.012) * (towers.length - 1);
        const i = Math.min(towers.length - 2, Math.floor(pos));
        const k = pos - i;
        const [u0, v0] = towers[i];
        const [u1, v1] = towers[i + 1];
        const [X, Y, Z] = onEarth(u0 + (u1 - u0) * k, v0 + (v1 - v0) * k, 40 - 12 * Math.sin(k * Math.PI));
        const p = proj(c, X, Y, Z, 0.001);
        if (!p) continue;
        const ta = (1 - tr / 4) * Math.min(1, t * 6);
        glow(g, p.x, p.y, clamp(110 * p.s, 8, 44) * (1 - tr * 0.15), C.cyan, alpha * 0.9 * ta);
        if (tr === 0) glow(g, p.x, p.y, clamp(30 * p.s, 3, 11), "#ffffff", alpha * 0.9);
      }
    }
    const [pu, pv] = PLANTS[li];
    const [X, Y, Z] = onEarth(pu, pv, 30);
    const p = proj(c, X, Y, Z, 0.001);
    if (p) {
      glow(g, p.x, p.y, clamp(420 * p.s, 10, 160), C.amber, alpha * 0.45, 0.05);
      glow(g, p.x, p.y, clamp(80 * p.s, 3, 30), "#fff2d0", alpha * 0.8);
    }
  });
  // the substation receiving it all
  const [su, sv] = SUBSTATION;
  const [X, Y, Z] = onEarth(su, sv, 6);
  const sp = proj(c, X, Y, Z, 0.001);
  if (sp) {
    const beat = Math.pow(1 - ((((f + 2) % PULSE_EVERY) + PULSE_EVERY) % PULSE_EVERY) / PULSE_EVERY, 3);
    glow(g, sp.x, sp.y, clamp(60 * sp.s, 10, 70), C.cyan, alpha * (0.25 + 0.35 * beat), 0.08);
  }
  g.restore();
};

/** Power lines, kept out of the caption band once the last caption is up (soft mask via an offscreen layer). */
let plLayer: HTMLCanvasElement | null = null;
const CAP_FROM = 612;
const powerLinesMasked = (g: G, c: Cam, f: number, alpha: number) => {
  if (alpha <= 0.01) return;
  const k = clamp((f - CAP_FROM) / 8);
  if (k <= 0) {
    powerLines(g, c, f, alpha);
    return;
  }
  if (!plLayer) {
    plLayer = document.createElement("canvas");
    plLayer.width = 1920;
    plLayer.height = 1080;
  }
  const o = plLayer.getContext("2d")!;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.globalAlpha = 1;
  o.clearRect(0, 0, 1920, 1080);
  o.setTransform(g.getTransform());
  powerLines(o, c, f, alpha);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "destination-in";
  const gr = o.createLinearGradient(0, 740, 0, 815);
  gr.addColorStop(0, "rgba(0,0,0,1)");
  gr.addColorStop(1, `rgba(0,0,0,${1 - k})`);
  o.fillStyle = gr;
  o.fillRect(0, 0, 1920, 1080);
  o.globalCompositeOperation = "source-over";
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "lighter";
  g.drawImage(plLayer, 0, 0);
  g.restore();
};

// ------------------------------------------------------------------ continuous lit street lines (whole city)
type Lines = { a: Float64Array; b: Float64Array; k: Uint8Array; n: number };
let lines: Lines | null = null;
const streetSegs = () => {
  if (lines) return lines;
  const A: number[] = [];
  const B: number[] = [];
  const K: number[] = [];
  const road = (vert: boolean, c: number, major: boolean) => {
    const N = 64;
    for (let i = 0; i < N; i++) {
      const t0 = -13000 + (26000 * i) / N;
      const t1 = -13000 + (26000 * (i + 1)) / N;
      const tm = (t0 + t1) / 2;
      const [um, vm] = vert ? [c, CC[1] + tm] : [CC[0] + tm, c];
      const du = um - CC[0];
      const dv = vm - CC[1];
      const r = Math.hypot(du, dv);
      const R = radiusAt(Math.atan2(dv, du));
      if (r > R) continue;
      if (!major && Math.abs(vm - riverV(um)) < 150) continue;
      if (!major && hash(c * 0.0137 + i * 7.31) < 0.18) continue;
      const core = clamp(1 - r / R);
      const k = Math.min(3, Math.floor(core * 3.2 + (major ? 1 : 0)));
      const p0 = vert ? onEarth(c, CC[1] + t0, 4) : onEarth(CC[0] + t0, c, 4);
      const p1 = vert ? onEarth(c, CC[1] + t1, 4) : onEarth(CC[0] + t1, c, 4);
      A.push(...p0);
      B.push(...p1);
      K.push(k);
    }
  };
  for (let k = -16; k <= 16; k++) {
    road(true, CC[0] + k * 880, true);
    road(false, CC[1] + k * 880, true);
  }
  for (let k = -60; k <= 60; k++) {
    if (k % 4 === 0) continue;
    road(true, CC[0] + k * 220, false);
    road(false, CC[1] + k * 220, false);
  }
  lines = { a: Float64Array.from(A), b: Float64Array.from(B), k: Uint8Array.from(K), n: K.length };
  return lines;
};

const streetLines = (g: G, c: Cam, alpha: number) => {
  if (alpha <= 0.01) return;
  const L = streetSegs();
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  const pr = (X: number, Y: number, Z: number): [number, number] | null => {
    const x = X - c.x;
    const y = Y - c.y;
    const z = Z - c.z;
    const x1 = x * c.cyw - z * c.syw;
    const z1 = x * c.syw + z * c.cyw;
    const z2 = y * c.sp + z1 * c.cp;
    if (z2 <= c.D * 0.01) return null;
    const s = 1500 / z2;
    return [960 + x1 * s, 540 + (y * c.cp - z1 * c.sp) * s];
  };
  for (let i = 0; i < L.n; i++) {
    const p = pr(L.a[i * 3], L.a[i * 3 + 1], L.a[i * 3 + 2]);
    const q = pr(L.b[i * 3], L.b[i * 3 + 1], L.b[i * 3 + 2]);
    if (!p || !q) continue;
    if ((p[0] < 0 && q[0] < 0) || (p[0] > 1920 && q[0] > 1920) || (p[1] < 0 && q[1] < 0) || (p[1] > 1080 && q[1] > 1080)) continue;
    const P2 = paths[L.k[i]];
    P2.moveTo(p[0], p[1]);
    P2.lineTo(q[0], q[1]);
  }
  const s0 = 1500 / c.D;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  for (let k = 0; k < 4; k++) {
    g.strokeStyle = `rgba(255,160,80,${alpha * (0.03 + (0.055 * k * k) / 3)})`;
    g.lineWidth = clamp(14 * s0, 0.8, 3);
    g.stroke(paths[k]);
  }
  g.restore();
};

// ------------------------------------------------------------------ entry
/** City + region layers. Fades are by camera distance. */
export const drawCity = (g: G, c: Cam, f: number) => {
  const D = c.D;
  const cityA = clamp((D - 60) / 300) * (1 - clamp((D - 3.5e4) / 1.2e5));
  const regA = clamp((D - 8000) / 30000) * (1 - clamp((D - 3e6) / 6e6));
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
    highwayWeb(g, c, regA * (1 - clamp((D - 1.5e6) / 2.5e6)));
    townBloom(g, c, regA * (1 - clamp((D - 8e5) / 1.4e6)));
    drawPts(g, c, region(), regA * 1.25, 260, 1, 2.4);
  }
  if (cityA > 0) {
    drawPts(g, c, city(), cityA, 24, 1, 3.2);
    drawPts(g, c, cityIn!, cityA * clamp((D - 3200) / 3600), 24, 1, 3.2);
    streetLines(g, c, cityA * clamp((D - 900) / 2600));
    drawNear(g, c, f);
    highways(g, c, f, cityA * (1 - clamp((D - 6e4) / 8e4)));
    powerLinesMasked(g, c, f, cityA * (1 - clamp((D - 1.3e4) / 1.2e4)));
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
