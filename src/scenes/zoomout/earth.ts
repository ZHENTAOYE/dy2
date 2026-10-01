// Night-side Earth for the ZoomOut finale: procedural continents, city lights, sunrise crescent,
// atmosphere, stars and glowing network arcs between AI data centres. All deterministic.
import { glow, glowStroke, mix, withAlpha } from "../../lib/canvas";
import { clamp, ease, hash, rng } from "../../lib/math";
import { C } from "../../lib/theme";
import { Cam, camAt, EARTH_C, FINAL, FOCAL, R_EARTH } from "./cam";

type G = CanvasRenderingContext2D;
type V = [number, number, number];

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------ noise
const h3 = (i: number, j: number, k: number) => hash(i * 12.9898 + j * 78.233 + k * 37.719);
const vn3 = (x: number, y: number, z: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = h3(xi, yi, zi);
  const c100 = h3(xi + 1, yi, zi);
  const c010 = h3(xi, yi + 1, zi);
  const c110 = h3(xi + 1, yi + 1, zi);
  const c001 = h3(xi, yi, zi + 1);
  const c101 = h3(xi + 1, yi, zi + 1);
  const c011 = h3(xi, yi + 1, zi + 1);
  const c111 = h3(xi + 1, yi + 1, zi + 1);
  return l(l(l(c000, c100, ux), l(c010, c110, ux), uy), l(l(c001, c101, ux), l(c011, c111, ux), uy), uz);
};
const fbm = (n: V, base: number, oct: number, off = 0) => {
  let s = 0;
  let a = 0.5;
  let fq = base;
  let tot = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vn3(n[0] * fq + off + o * 17.3, n[1] * fq - off * 0.7 + o * 3.1, n[2] * fq + off * 1.3 - o * 9.7);
    tot += a;
    a *= 0.5;
    fq *= 2;
  }
  return s / tot;
};

// lat/lon convention: the campus (world up = -Y) sits at lat 0, lon 0; +Z is north.
const N0: V = [0, -1, 0];
const toN = (lat: number, lon: number): V => [Math.cos(lat) * Math.sin(lon), -Math.cos(lat) * Math.cos(lon), Math.sin(lat)];

const MW = 512;
const MH = 256;
let mask: Float32Array | null = null;
let THRESH = 0.5;
const rawLand = (n: V) => {
  const d0 = (n[0] - N0[0]) ** 2 + (n[1] - N0[1]) ** 2 + (n[2] - N0[2]) ** 2;
  return fbm(n, 1.5, 5, 3.7) + 0.16 * Math.exp(-d0 / 0.05);
};
const landMask = () => {
  if (mask) return mask;
  const m = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) {
    const lat = (0.5 - (y + 0.5) / MH) * Math.PI;
    for (let x = 0; x < MW; x++) {
      const lon = ((x + 0.5) / MW - 0.5) * Math.PI * 2;
      m[y * MW + x] = rawLand(toN(lat, lon));
    }
  }
  // threshold so that ~33 % of the sphere is land
  const r = rng(99);
  const vals: number[] = [];
  for (let i = 0; i < 6000; i++) {
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    vals.push(rawLand([s * Math.cos(a), s * Math.sin(a), z]));
  }
  vals.sort((a, b) => a - b);
  THRESH = vals[Math.floor(vals.length * 0.67)];
  mask = m;
  return m;
};

/** > 0 on land. (x, y, z) is any vector from the Earth's centre. */
export const landAt = (x: number, y: number, z: number) => {
  const m = landMask();
  const l = Math.hypot(x, y, z) || 1;
  const n: V = [x / l, y / l, z / l];
  const lat = Math.asin(clamp(n[2], -1, 1));
  const lon = Math.atan2(n[0], -n[1]);
  const fx = (lon / (Math.PI * 2) + 0.5) * MW - 0.5;
  const fy = (0.5 - lat / Math.PI) * MH - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.max(0, Math.min(MH - 2, Math.floor(fy)));
  const tx = fx - x0;
  const ty = clamp(fy - y0);
  const xa = ((x0 % MW) + MW) % MW;
  const xb = (xa + 1) % MW;
  const v =
    (m[y0 * MW + xa] * (1 - tx) + m[y0 * MW + xb] * tx) * (1 - ty) + (m[(y0 + 1) * MW + xa] * (1 - tx) + m[(y0 + 1) * MW + xb] * tx) * ty;
  const det = (vn3(n[0] * 60, n[1] * 60, n[2] * 60) - 0.5) * 0.05 + (vn3(n[0] * 170 + 5, n[1] * 170, n[2] * 170) - 0.5) * 0.025;
  return v + det - THRESH;
};

// ------------------------------------------------------------------ night-light density (equirect)
let popM: Float32Array | null = null;
let popR: Float32Array | null = null;
const popRaw = (n: V, land: number) => {
  const cont = fbm(n, 2.2, 2, 5.5);
  const coast = land < 0.03 ? 1.25 : 1;
  // our campus sits in a populous region (matches the towns drawn by city.ts)
  const d0 = (n[0] - N0[0]) ** 2 + (n[1] - N0[1]) ** 2 + (n[2] - N0[2]) ** 2;
  return (0.55 * cont + 0.45 * fbm(n, 11, 3, 11.1)) * coast * (Math.abs(n[2]) > 0.82 ? 0.5 : 1) + 0.16 * Math.exp(-d0 / 0.03);
};
const popMap = () => {
  if (popM) return popM;
  landMask();
  const m = new Float32Array(MW * MH);
  const raw = new Float32Array(MW * MH).fill(-1);
  for (let y = 0; y < MH; y++) {
    const lat = (0.5 - (y + 0.5) / MH) * Math.PI;
    for (let x = 0; x < MW; x++) {
      const lon = ((x + 0.5) / MW - 0.5) * Math.PI * 2;
      const n = toN(lat, lon);
      const land = landAt(n[0], n[1], n[2]);
      if (land < -0.03) continue;
      const pop = popRaw(n, land);
      raw[y * MW + x] = pop;
      if (land < -0.01) continue;
      m[y * MW + x] = Math.pow(clamp((pop - 0.5) * 4.4), 1.6) * clamp((land + 0.01) / 0.02);
    }
  }
  popM = m;
  popR = raw;
  return m;
};
const sampleEq = (m: Float32Array, n: V) => {
  const lat = Math.asin(clamp(n[2], -1, 1));
  const lon = Math.atan2(n[0], -n[1]);
  const fx = (lon / (Math.PI * 2) + 0.5) * MW - 0.5;
  const fy = (0.5 - lat / Math.PI) * MH - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.max(0, Math.min(MH - 2, Math.floor(fy)));
  const tx = fx - x0;
  const ty = clamp(fy - y0);
  const xa = ((x0 % MW) + MW) % MW;
  const xb = (xa + 1) % MW;
  return (m[y0 * MW + xa] * (1 - tx) + m[y0 * MW + xb] * tx) * (1 - ty) + (m[(y0 + 1) * MW + xa] * (1 - tx) + m[(y0 + 1) * MW + xb] * tx) * ty;
};
const popAt = (n: V) => sampleEq(popMap(), n);

// ------------------------------------------------------------------ sun
let SUN: V | null = null;
/** Sun almost directly behind the globe (seen from the final camera), peeking at the upper right. */
export const sunDir = (): V => {
  if (SUN) return SUN;
  const c = camAt(805);
  const Vc = norm([c.x - EARTH_C[0], c.y - EARTH_C[1], c.z - EARTH_C[2]]);
  const Rv: V = [c.cyw, 0, -c.syw];
  const Uv: V = [-c.syw * c.sp, c.cp, -c.cyw * c.sp];
  SUN = norm([-0.955 * Vc[0] + 0.26 * Rv[0] - 0.2 * Uv[0], -0.955 * Vc[1] + 0.26 * Rv[1] - 0.2 * Uv[1], -0.955 * Vc[2] + 0.26 * Rv[2] - 0.2 * Uv[2]]);
  return SUN;
};

// ------------------------------------------------------------------ city lights on the globe
type Lights = { n: Float32Array; b: Float32Array; cnt: number };
let lights: Lights | null = null;
const globeLights = () => {
  if (lights) return lights;
  popMap();
  const R = popR!;
  const N = 340000;
  const ga = Math.PI * (3 - Math.sqrt(5));
  const tmpN: number[] = [];
  const tmpB: number[] = [];
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const s = Math.sqrt(1 - z * z);
    const a = i * ga;
    const n: V = [s * Math.cos(a), s * Math.sin(a), z];
    const pop = sampleEq(R, n);
    if (pop < 0.5) continue;
    // cheap rejection first, then the exact coastline
    const dens = clamp((pop - 0.5) * 6);
    const h = hash(i * 9.13 + 0.7);
    if (h > dens * 0.7) continue;
    if (landAt(n[0], n[1], n[2]) < 0) continue;
    // break dense regions into clusters and threads instead of solid fills
    const cl = vn3(n[0] * 260 + 3.3, n[1] * 260, n[2] * 260 - 1.7);
    const th = vn3(n[0] * 900 - 7.1, n[1] * 900 + 2.2, n[2] * 900);
    if (h > dens * 0.7 * clamp(0.15 + 1.25 * (cl - 0.3)) * (0.45 + 0.55 * th)) continue;
    const j = 0.006;
    const m = norm([n[0] + (hash(i * 1.3) - 0.5) * j, n[1] + (hash(i * 2.9) - 0.5) * j, n[2] + (hash(i * 4.7) - 0.5) * j]);
    tmpN.push(m[0], m[1], m[2]);
    tmpB.push(clamp(Math.pow((pop - 0.5) * 4.2, 1.4) * (0.55 + 0.45 * hash(i * 7.7)) * (0.6 + 0.6 * cl) + 0.1));
  }
  lights = { n: new Float32Array(tmpN), b: new Float32Array(tmpB), cnt: tmpB.length };
  return lights;
};

// data-centre sites (ours first) and the network arcs between them
type Site = { n: V; t: number };
let sites: Site[] | null = null;
const SITE_T0 = 754;
const WAVE = 0.05; // rad per frame
const dataCentres = () => {
  if (sites) return sites;
  const L = globeLights();
  const out: Site[] = [{ n: N0, t: SITE_T0 }];
  const cand: { n: V; b: number }[] = [];
  for (let i = 0; i < L.cnt; i += 3) if (L.b[i] > 0.6) cand.push({ n: [L.n[i * 3], L.n[i * 3 + 1], L.n[i * 3 + 2]], b: L.b[i] });
  cand.sort((a, b) => b.b - a.b);
  for (const c of cand) {
    if (out.length >= 24) break;
    if (out.every((s) => Math.acos(clamp(dot(s.n, c.n), -1, 1)) > 0.3)) out.push({ n: c.n, t: 0 });
  }
  // ignition: when the light wave from our campus sweeps over them
  out.slice(1).forEach((s) => (s.t = SITE_T0 + Math.acos(clamp(dot(s.n, N0), -1, 1)) / WAVE));
  sites = out;
  return out;
};
type Arc = { a: number; b: number; t0: number };
let arcs: Arc[] | null = null;
const arcList = () => {
  if (arcs) return arcs;
  const S = dataCentres();
  const out: Arc[] = [];
  for (let i = 1; i < S.length; i++) out.push({ a: 0, b: i, t0: SITE_T0 });
  // a few links between the other sites (nearest neighbours)
  for (let i = 1; i < S.length; i++) {
    let best = -1;
    let bd = 9;
    for (let j = 1; j < S.length; j++) {
      if (j === i) continue;
      const d = Math.acos(clamp(dot(S[i].n, S[j].n), -1, 1));
      if (d < bd && !out.some((o) => (o.a === j && o.b === i) || (o.a === i && o.b === j))) {
        bd = d;
        best = j;
      }
    }
    if (best > 0) out.push({ a: i, b: best, t0: Math.max(S[i].t, S[best].t) + 4 });
  }
  arcs = out;
  return out;
};

// ------------------------------------------------------------------ stars
type Star = { d: V; b: number; c: string };
let stars: Star[] | null = null;
const starList = () => {
  if (stars) return stars;
  const r = rng(2024);
  const out: Star[] = [];
  const band = norm([0.3, 0.5, 0.8]);
  const bu = norm([band[1], -band[0], 0]);
  const bv: V = [band[1] * bu[2] - band[2] * bu[1], band[2] * bu[0] - band[0] * bu[2], band[0] * bu[1] - band[1] * bu[0]];
  for (let i = 0; i < 2600; i++) {
    let d: V;
    if (i < 1100) {
      const z = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      d = [s * Math.cos(a), s * Math.sin(a), z];
    } else {
      // milky-way band
      const a = r() * Math.PI * 2;
      const off = (r() + r() + r() - 1.5) * 0.18;
      d = norm([
        Math.cos(a) * bu[0] + Math.sin(a) * bv[0] + off * band[0],
        Math.cos(a) * bu[1] + Math.sin(a) * bv[1] + off * band[1],
        Math.cos(a) * bu[2] + Math.sin(a) * bv[2] + off * band[2],
      ]);
    }
    const b = Math.pow(r(), i < 1100 ? 3.2 : 5);
    const h = r();
    out.push({ d, b, c: h < 0.7 ? "#ffffff" : h < 0.85 ? "#a8c8ff" : "#ffd8a8" });
  }
  stars = out;
  return out;
};

const dirToScreen = (c: Cam, d: V) => {
  const x1 = d[0] * c.cyw - d[2] * c.syw;
  const z1 = d[0] * c.syw + d[2] * c.cyw;
  const y2 = d[1] * c.cp - z1 * c.sp;
  const z2 = d[1] * c.sp + z1 * c.cp;
  if (z2 <= 0.01) return null;
  return { x: 960 + (x1 / z2) * FOCAL, y: 540 + (y2 / z2) * FOCAL };
};

const drawStars = (g: G, c: Cam, f: number, a: number) => {
  if (a <= 0.01) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const s of starList()) {
    const p = dirToScreen(c, s.d);
    if (!p || p.x < -4 || p.x > 1924 || p.y < -4 || p.y > 1084) continue;
    const tw = 0.75 + 0.25 * Math.sin(f * 0.15 + s.b * 400);
    const sz = 0.8 + 2.2 * s.b;
    g.globalAlpha = a * clamp(0.18 + s.b * 1.4) * tw;
    g.fillStyle = s.c;
    g.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    if (s.b > 0.55) glow(g, p.x, p.y, 6 + 10 * s.b, s.c === "#ffffff" ? "#cfe0ff" : s.c, a * 0.5 * tw);
  }
  g.restore();
};

// ------------------------------------------------------------------ ray-cast globe base
// Rendered only over the globe's screen bounding box, at <= ~95k rays, with an anti-aliased silhouette
// (coverage from the ray's closest approach), so the limb stays smooth after upscaling.
const MAX_RAYS = 95000;
let baseC: HTMLCanvasElement | null = null;
let baseImg: ImageData | null = null;
const drawBase = (g: G, c: Cam, f: number, a: number, lightA: number) => {
  if (a <= 0.01) return;
  const S = sunDir();
  const o: V = [c.x - EARTH_C[0], c.y - EARTH_C[1], c.z - EARTH_C[2]];
  const oo = dot(o, o);
  const R2 = R_EARTH * R_EARTH;
  // screen-space bounds of the globe
  const gc = globeCircle(c);
  let x0 = 0;
  let y0 = 0;
  let x1 = 1920;
  let y1 = 1080;
  if (gc && gc.r < 2400) {
    const m = gc.r * 1.06 + 8;
    x0 = Math.max(0, Math.floor(gc.x - m));
    y0 = Math.max(0, Math.floor(gc.y - m));
    x1 = Math.min(1920, Math.ceil(gc.x + m));
    y1 = Math.min(1080, Math.ceil(gc.y + m));
  }
  if (x1 - x0 < 4 || y1 - y0 < 4) return;
  const sx = Math.max(2.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_RAYS));
  const BW = Math.ceil((x1 - x0) / sx);
  const BH = Math.ceil((y1 - y0) / sx);
  if (!baseC || baseC.width < BW || baseC.height < BH) {
    baseC = document.createElement("canvas");
    baseC.width = Math.max(BW, baseC ? baseC.width : 0, 400);
    baseC.height = Math.max(BH, baseC ? baseC.height : 0, 400);
    baseImg = null;
  }
  if (!baseImg || baseImg.width !== BW || baseImg.height !== BH) baseImg = baseC.getContext("2d")!.createImageData(BW, BH);
  const img = baseImg;
  const Rv: V = [c.cyw, 0, -c.syw];
  const Uv: V = [-c.syw * c.sp, c.cp, -c.cyw * c.sp];
  const Fv: V = [c.syw * c.cp, c.sp, c.cyw * c.cp];
  const data = img.data;
  const pixAng = sx / FOCAL;
  const camH = Math.sqrt(oo) - R_EARTH;
  // ground context while we are still low: terrain texture + aerial haze towards the far (upper) part of the frame
  const lowK = 1 - clamp((camH - 1.2e6) / 3e6);
  for (let py = 0; py < BH; py++)
    for (let px = 0; px < BW; px++) {
      const x = x0 + (px + 0.5) * sx - 960;
      const y = y0 + (py + 0.5) * sx - 540;
      const d = norm([x * Rv[0] + y * Uv[0] + FOCAL * Fv[0], x * Rv[1] + y * Uv[1] + FOCAL * Fv[1], x * Rv[2] + y * Uv[2] + FOCAL * Fv[2]]);
      const b = dot(o, d);
      const k = (py * BW + px) * 4;
      if (b >= 0) {
        data[k + 3] = 0;
        continue;
      }
      const h2 = Math.max(0, oo - b * b);
      const hRay = Math.sqrt(h2);
      const texM = -b * pixAng; // metres covered by one texel at the closest approach
      const cov = clamp(0.5 + (R_EARTH - hRay) / texM);
      if (cov <= 0) {
        data[k + 3] = 0;
        continue;
      }
      const disc = R2 - h2;
      const t = disc > 0 ? -b - Math.sqrt(disc) : -b;
      const n: V = norm([o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]]);
      const land = clamp((landAt(n[0], n[1], n[2]) + 0.012) / 0.024);
      const ndl = dot(n, S);
      const mu = clamp(-dot(d, n));
      let r = 2 + 9 * land;
      let gg = 5 + 11 * land;
      let bb = 13 + 12 * land;
      if (lowK > 0 && land > 0) {
        // night terrain: value noise with level-of-detail by texel footprint
        const foot = t * pixAng;
        let tv = 0;
        let tw = 0;
        for (let o2 = 0; o2 < 3; o2++) {
          const fq = 260 * Math.pow(3.2, o2);
          const cell = R_EARTH / fq;
          const w = clamp(cell / (foot * 3) - 0.5) / (1 + o2 * 0.6);
          if (w <= 0) continue;
          tv += w * (vn3(n[0] * fq + o2 * 7.1, n[1] * fq - o2 * 3.3, n[2] * fq + 1.9) - 0.5);
          tw += w;
        }
        const tt = tw > 0 ? tv / Math.max(tw, 0.6) : 0;
        const kk = lowK * land;
        r += kk * (6 + 26 * tt);
        gg += kk * (5 + 22 * tt);
        bb += kk * (2 + 12 * tt);
        // aerial perspective: the further the ground, the more blue-grey haze
        const hz = clamp((t / Math.max(camH, 1) - 1.04) * 1.6) * lowK;
        r += hz * 16;
        gg += hz * 30;
        bb += hz * 52;
      }
      const day = clamp((ndl + 0.04) / 0.3);
      if (day > 0) {
        const k2 = day * (0.35 + 0.65 * clamp(ndl * 2));
        r += k2 * (land ? 150 : 40) * (land * 0.9 + 0.1);
        gg += k2 * (land * 130 + (1 - land) * 95);
        bb += k2 * (land * 90 + (1 - land) * 175);
      }
      const tw = Math.exp(-((ndl / 0.07) ** 2));
      r += 120 * tw;
      gg += 45 * tw;
      bb += 20 * tw;
      // soft city-light glow of populated regions, only well inside the night side
      const nightK = clamp((-0.04 - ndl) / 0.2);
      if (nightK > 0 && lightA > 0) {
        const em = Math.min(0.6, popAt(n) * nightK * lightA * clamp(mu * 4));
        r += 140 * em;
        gg += 80 * em;
        bb += 30 * em;
      }
      const rim = Math.pow(1 - mu, 3);
      const rimDay = 0.35 + 1.6 * clamp(ndl + 0.3);
      r += 18 * rim * rimDay;
      gg += 70 * rim * rimDay;
      bb += 170 * rim * rimDay;
      data[k] = Math.min(255, r);
      data[k + 1] = Math.min(255, gg);
      data[k + 2] = Math.min(255, bb);
      data[k + 3] = Math.round(255 * cov);
    }
  baseC.getContext("2d")!.putImageData(img, 0, 0);
  g.save();
  g.globalAlpha = a;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(baseC, 0, 0, BW, BH, x0, y0, BW * sx, BH * sx);
  g.restore();
  void f;
};

/** Projected globe circle (approximate for off-axis views). */
const globeCircle = (c: Cam) => {
  const o: V = [c.x - EARTH_C[0], c.y - EARTH_C[1], c.z - EARTH_C[2]];
  const d = Math.hypot(o[0], o[1], o[2]);
  const x = -o[0];
  const y = -o[1];
  const z = -o[2];
  const x1 = x * c.cyw - z * c.syw;
  const z1 = x * c.syw + z * c.cyw;
  const y2 = y * c.cp - z1 * c.sp;
  const z2 = y * c.sp + z1 * c.cp;
  if (z2 <= 0) return null;
  const r = (FOCAL * R_EARTH) / Math.sqrt(Math.max(1, d * d - R_EARTH * R_EARTH));
  return { x: 960 + (x1 / z2) * FOCAL, y: 540 + (y2 / z2) * FOCAL, r, d };
};

const drawAtmosphere = (g: G, c: Cam, f: number, a: number) => {
  const gc = globeCircle(c);
  if (!gc || gc.r > 5000 || a <= 0.01) return;
  const S = sunDir();
  const Rv: V = [c.cyw, 0, -c.syw];
  const Uv: V = [-c.syw * c.sp, c.cp, -c.cyw * c.sp];
  const sx = dot(S, Rv);
  const sy = dot(S, Uv);
  const sl = Math.hypot(sx, sy) || 1;
  const ux = sx / sl;
  const uy = sy / sl;
  g.save();
  g.globalCompositeOperation = "lighter";
  // halo ring
  const ring = g.createRadialGradient(gc.x, gc.y, gc.r * 0.97, gc.x, gc.y, gc.r * 1.16);
  ring.addColorStop(0, withAlpha("#3a8cff", 0));
  ring.addColorStop(0.12, withAlpha("#5ab4ff", 0.42 * a));
  ring.addColorStop(0.3, withAlpha("#2a6cff", 0.16 * a));
  ring.addColorStop(1, withAlpha("#1a3cff", 0));
  g.fillStyle = ring;
  g.beginPath();
  g.arc(gc.x, gc.y, gc.r * 1.16, 0, Math.PI * 2);
  g.arc(gc.x, gc.y, gc.r * 0.97, 0, Math.PI * 2, true);
  g.fill();
  // sun-side scattering
  const lx = gc.x + ux * gc.r;
  const ly = gc.y + uy * gc.r;
  const sg = g.createRadialGradient(lx, ly, 0, lx, ly, gc.r * 0.9);
  sg.addColorStop(0, withAlpha("#ffe2b0", 0.75 * a));
  sg.addColorStop(0.25, withAlpha("#ff9a50", 0.24 * a));
  sg.addColorStop(1, withAlpha("#ff6a30", 0));
  g.fillStyle = sg;
  g.beginPath();
  g.arc(gc.x, gc.y, gc.r * 1.2, 0, Math.PI * 2);
  g.arc(gc.x, gc.y, gc.r * 0.985, 0, Math.PI * 2, true);
  g.fill();
  // thin vector rim: a crisp, anti-aliased limb over the ray-cast base
  if (gc.r < 1400) {
    const rimG = g.createLinearGradient(gc.x - ux * gc.r, gc.y - uy * gc.r, gc.x + ux * gc.r, gc.y + uy * gc.r);
    rimG.addColorStop(0, withAlpha("#4f8dff", 0.55 * a));
    rimG.addColorStop(0.6, withAlpha("#7fc4ff", 0.7 * a));
    rimG.addColorStop(1, withAlpha("#ffe0b0", 0.9 * a));
    g.strokeStyle = rimG;
    g.lineWidth = Math.max(1.5, gc.r * 0.006);
    g.beginPath();
    g.arc(gc.x, gc.y, gc.r * 0.999, 0, Math.PI * 2);
    g.stroke();
  }
  // the sun peeking over the limb (+ a short warm bloom on the final beat)
  const fl = a * clamp((f - 735) / 40);
  const ft = f - FINAL;
  const burst = ft >= 0 && ft < 14 ? Math.pow(1 - ft / 14, 2) : 0;
  if (fl > 0) {
    const fx = gc.x + ux * gc.r * 1.015;
    const fy = gc.y + uy * gc.r * 1.015;
    glow(g, fx, fy, (260 + 260 * burst) * fl, "#ffb860", (0.55 + 0.35 * burst) * fl, 0.04);
    glow(g, fx, fy, 70 + 60 * burst, "#fff4e0", 0.95 * fl, 0.25);
    if (burst > 0) glow(g, fx, fy, 900 * (0.6 + 0.4 * burst), "#ffcf8a", 0.22 * burst * fl, 0.02);
    const st = g.createLinearGradient(fx - 380, fy, fx + 380, fy);
    st.addColorStop(0, withAlpha("#7fc8ff", 0));
    st.addColorStop(0.5, withAlpha("#ffffff", (0.75 + 0.25 * burst) * fl));
    st.addColorStop(1, withAlpha("#7fc8ff", 0));
    g.fillStyle = st;
    const sw = 380 + 420 * burst;
    g.save();
    g.translate(fx, fy);
    g.scale(sw / 380, 1);
    g.fillRect(-380, -2 - 2 * burst, 760, 4 + 4 * burst);
    g.restore();
    // lens ghosts along the axis through the frame centre
    for (const [k, r, col] of [
      [0.5, 46, "#7fffd4"],
      [1.35, 28, "#ff9ad5"],
      [1.7, 70, "#7fa8ff"],
    ] as [number, number, string][]) {
      const gx = fx + (960 - fx) * k;
      const gy = fy + (540 - fy) * k;
      glow(g, gx, gy, r, col, 0.16 * fl, 0.5);
    }
  }
  g.restore();
};

// ------------------------------------------------------------------ lights + network
const drawLights = (g: G, c: Cam, f: number, a: number) => {
  if (a <= 0.01) return;
  const L = globeLights();
  const S = sunDir();
  const o: V = [c.x - EARTH_C[0], c.y - EARTH_C[1], c.z - EARTH_C[2]];
  const od = Math.hypot(o[0], o[1], o[2]);
  const big: number[] = [];
  g.save();
  g.globalCompositeOperation = "lighter";
  const cols = ["#ffb35c", "#ffe0a8"];
  for (let pass = 0; pass < 2; pass++) {
    g.fillStyle = cols[pass];
    for (let i = pass; i < L.cnt; i += 2) {
      const nx = L.n[i * 3];
      const ny = L.n[i * 3 + 1];
      const nz = L.n[i * 3 + 2];
      const facing = (nx * o[0] + ny * o[1] + nz * o[2]) / od - R_EARTH / od;
      if (facing <= 0) continue;
      const night = clamp((-0.05 - (nx * S[0] + ny * S[1] + nz * S[2])) / 0.2);
      if (night <= 0) continue;
      const X = EARTH_C[0] + nx * R_EARTH;
      const Y = EARTH_C[1] + ny * R_EARTH;
      const Z = EARTH_C[2] + nz * R_EARTH;
      const x = X - c.x;
      const y = Y - c.y;
      const z = Z - c.z;
      const x1 = x * c.cyw - z * c.syw;
      const z1 = x * c.syw + z * c.cyw;
      const y2 = y * c.cp - z1 * c.sp;
      const z2 = y * c.sp + z1 * c.cp;
      if (z2 <= 0) continue;
      const sx = 960 + (x1 / z2) * FOCAL;
      const sy = 540 + (y2 / z2) * FOCAL;
      if (sx < -4 || sx > 1924 || sy < -4 || sy > 1084) continue;
      const b = L.b[i];
      const limb = clamp(facing * 9);
      g.globalAlpha = Math.min(0.62, a * night * limb * (0.3 + 0.6 * b));
      const s = 0.9 + 1.1 * b;
      g.fillRect(sx - s / 2, sy - s / 2, s, s);
      if (b > 0.9 && big.length < 1200) big.push(sx, sy, a * night * limb * b);
    }
  }
  g.globalAlpha = 1;
  const bigA = clamp((od - R_EARTH - 6e6) / 8e6);
  if (bigA > 0) for (let i = 0; i < big.length; i += 3) glow(g, big[i], big[i + 1], 5, "#ffb35c", big[i + 2] * 0.35 * bigA);
  g.restore();
};

/** Point on the great circle from a to b at t, lifted by h (metres); returns world coords. */
const arcPoint = (a: V, b: V, t: number, h: number): V => {
  const om = Math.acos(clamp(dot(a, b), -1, 1));
  const so = Math.sin(om) || 1;
  const ka = Math.sin((1 - t) * om) / so;
  const kb = Math.sin(t * om) / so;
  const n = norm([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]);
  const r = R_EARTH + h;
  return [EARTH_C[0] + n[0] * r, EARTH_C[1] + n[1] * r, EARTH_C[2] + n[2] * r];
};

const occluded = (c: Cam, P: V) => {
  const o: V = [c.x - EARTH_C[0], c.y - EARTH_C[1], c.z - EARTH_C[2]];
  const d: V = [P[0] - c.x, P[1] - c.y, P[2] - c.z];
  const A = dot(d, d);
  const B = 2 * dot(o, d);
  const Cc = dot(o, o) - R_EARTH * R_EARTH * 0.999;
  const disc = B * B - 4 * A * Cc;
  if (disc <= 0) return false;
  const t1 = (-B - Math.sqrt(disc)) / (2 * A);
  return t1 > 0 && t1 < 1;
};

const project = (c: Cam, P: V) => {
  const x = P[0] - c.x;
  const y = P[1] - c.y;
  const z = P[2] - c.z;
  const x1 = x * c.cyw - z * c.syw;
  const z1 = x * c.syw + z * c.cyw;
  const y2 = y * c.cp - z1 * c.sp;
  const z2 = y * c.sp + z1 * c.cp;
  if (z2 <= 0) return null;
  return { x: 960 + (x1 / z2) * FOCAL, y: 540 + (y2 / z2) * FOCAL, s: FOCAL / z2 };
};

const drawNetwork = (g: G, c: Cam, f: number, a: number) => {
  if (a <= 0.01) return;
  const S = dataCentres();
  const A = arcList();
  g.save();
  g.globalCompositeOperation = "lighter";
  A.forEach((arc, ai) => {
    const dur = arc.a === 0 ? Math.max(10, S[arc.b].t - arc.t0) : 22;
    const rv = arc.a === 0 ? clamp((f - arc.t0) / dur) : ease.inOutCubic(clamp((f - arc.t0) / dur));
    if (rv <= 0) return;
    const na = S[arc.a].n;
    const nb = S[arc.b].n;
    const om = Math.acos(clamp(dot(na, nb), -1, 1));
    const H = (0.025 + 0.13 * (om / Math.PI)) * R_EARTH;
    const N = 56;
    const pts: ({ x: number; y: number } | null)[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * rv;
      const P = arcPoint(na, nb, t, Math.sin(Math.PI * t) * H);
      pts.push(occluded(c, P) ? null : project(c, P));
    }
    const col = arc.a === 0 ? (ai % 2 ? C.cyan : "#7fd8ff") : C.magenta;
    // draw visible runs
    let run: { x: number; y: number }[] = [];
    const flush = () => {
      if (run.length > 1) {
        const r = run;
        glowStroke(g, () => {
          g.moveTo(r[0].x, r[0].y);
          for (let i = 1; i < r.length; i++) g.lineTo(r[i].x, r[i].y);
        }, col, 1.6, 0.85 * a);
      }
      run = [];
    };
    for (const p of pts) {
      if (p) run.push(p);
      else flush();
    }
    flush();
    // head of the arc while it travels
    const head = pts[pts.length - 1];
    if (head && rv < 1) {
      glow(g, head.x, head.y, 22, col, a * 0.8);
      glow(g, head.x, head.y, 8, "#ffffff", a);
    }
    // packets
    if (rv >= 1)
      for (let q = 0; q < 2; q++) {
        const t = (f * (0.011 + 0.004 * hash(ai)) + q * 0.5 + hash(ai * 3.3)) % 1;
        const P = arcPoint(na, nb, t, Math.sin(Math.PI * t) * H);
        if (occluded(c, P)) continue;
        const p = project(c, P);
        if (p) glow(g, p.x, p.y, 9, mix(col, "#ffffff", 0.5), a * 0.95);
      }
  });
  // the wave of light sweeping out from our campus
  const th = (f - SITE_T0) * WAVE;
  if (th > 0 && th < 2.2) {
    const N0x: V = [1, 0, 0];
    const N0z: V = [0, 0, 1];
    for (const [lag, wa] of [
      [0, 1],
      [0.09, 0.45],
    ] as [number, number][]) {
      const t2 = th - lag;
      if (t2 <= 0) continue;
      const fade = clamp(t2 / 0.15) * clamp((2.2 - t2) / 0.9);
      const pts: ({ x: number; y: number } | null)[] = [];
      for (let i = 0; i <= 120; i++) {
        const ph = (i / 120) * Math.PI * 2;
        const ct = Math.cos(t2);
        const st = Math.sin(t2);
        const n: V = [N0[0] * ct + (N0x[0] * Math.cos(ph) + N0z[0] * Math.sin(ph)) * st, N0[1] * ct + (N0x[1] * Math.cos(ph) + N0z[1] * Math.sin(ph)) * st, N0[2] * ct + (N0x[2] * Math.cos(ph) + N0z[2] * Math.sin(ph)) * st];
        const P: V = [EARTH_C[0] + n[0] * R_EARTH * 1.003, EARTH_C[1] + n[1] * R_EARTH * 1.003, EARTH_C[2] + n[2] * R_EARTH * 1.003];
        pts.push(occluded(c, P) ? null : project(c, P));
      }
      let run: { x: number; y: number }[] = [];
      const flush = () => {
        if (run.length > 1) {
          const r = run;
          glowStroke(g, () => {
            g.moveTo(r[0].x, r[0].y);
            for (let i = 1; i < r.length; i++) g.lineTo(r[i].x, r[i].y);
          }, C.cyan, 2.2, a * fade * wa);
        }
        run = [];
      };
      for (const p of pts) {
        if (p) run.push(p);
        else flush();
      }
      flush();
    }
  }
  // sites: beacons + ignition rings
  S.forEach((s, i) => {
    const lit = clamp((f - s.t) / 4);
    if (lit <= 0) return;
    const P: V = [EARTH_C[0] + s.n[0] * R_EARTH, EARTH_C[1] + s.n[1] * R_EARTH, EARTH_C[2] + s.n[2] * R_EARTH];
    const o: V = [c.x - P[0], c.y - P[1], c.z - P[2]];
    if (dot(o, s.n) <= 0) return;
    const p = project(c, P);
    if (!p) return;
    const pulse = 0.75 + 0.25 * Math.sin(f * 0.3 + i);
    const col = i === 0 ? C.cyan : C.magenta;
    glow(g, p.x, p.y, (i === 0 ? 34 : 18) * pulse, col, a * lit);
    const pop = f - s.t;
    if (pop >= 0 && pop < 10) glow(g, p.x, p.y, 40 * (1 - pop / 10) + 10, "#ffffff", a * (1 - pop / 10));
    glow(g, p.x, p.y, 5, "#ffffff", a * lit);
    const rt = (f - s.t) / 30;
    if (rt > 0 && rt < 1) {
      g.strokeStyle = withAlpha(col, a * (1 - rt) * 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(p.x, p.y, 10 + 60 * rt, (10 + 60 * rt) * 0.75, 0, 0, Math.PI * 2);
      g.stroke();
    }
  });
  g.restore();
};

// ------------------------------------------------------------------ entry
export const drawEarthBack = (g: G, c: Cam, f: number) => {
  const D = c.D;
  drawStars(g, c, f, clamp((D - 1.5e6) / 4e6));
  drawBase(g, c, f, clamp((D - 3e4) / 1.6e5), clamp((D - 1.8e6) / 5e6));
};

export const drawEarthFront = (g: G, c: Cam, f: number) => {
  const D = c.D;
  drawLights(g, c, f, clamp((D - 1.4e6) / 4e6));
  drawAtmosphere(g, c, f, clamp((D - 2.5e6) / 5e6));
  drawNetwork(g, c, f, clamp((D - 3e5) / 1e6));
};

/** Screen position of our campus on the globe (for HUD callouts). */
export const campusOnScreen = (c: Cam) => project(c, [EARTH_C[0] + N0[0] * R_EARTH, EARTH_C[1] + N0[1] * R_EARTH, EARTH_C[2] + N0[2] * R_EARTH]);
