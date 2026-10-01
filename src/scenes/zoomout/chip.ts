// Flat (top-down) chip world for the ZoomOut scene: transistors -> standard cells -> SM -> die -> package -> module.
// Everything is drawn in world metres through a Map2 (pixel = ((u - ox) * k, (v - oy) * k) in the current transform),
// so the same code renders live (centred, rotated screen) and into cached textures.
import { glow, withAlpha } from "../../lib/canvas";
import { clamp, hash, hash2 } from "../../lib/math";
import { C } from "../../lib/theme";
import { DIE_C, DIE_H, DIE_W, MOD_C, MOD_H, MOD_W, PKG_C, SM_H, SM_W } from "./cam";

export type Map2 = { ox: number; oy: number; k: number; u0: number; v0: number; u1: number; v1: number };

const mk = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

// ------------------------------------------------------------------ mip-mapped textures
type Mips = HTMLCanvasElement[];
const mipsOf = (c: HTMLCanvasElement, min = 4): Mips => {
  const out = [c];
  let cur = c;
  while (cur.width > min && cur.height > min) {
    const n = mk(Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
    const g = n.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, n.width, n.height);
    out.push(n);
    cur = n;
  }
  return out;
};
/** Level whose texels are >= ~0.7 screen px. `scale` = screen px per level-0 texel. */
const pick = (m: Mips, scale: number) => {
  let lv = 0;
  let s = scale;
  while (s < 0.7 && lv < m.length - 1) {
    s *= 2;
    lv++;
  }
  return { img: m[lv], f: m[0].width / m[lv].width };
};

/** Fill a world rect with a repeating texture anchored at world (au, av); texelM = metres per level-0 texel. */
const fillTex = (
  g: CanvasRenderingContext2D,
  M: Map2,
  m: Mips,
  texelM: number,
  au: number,
  av: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
) => {
  const ru0 = Math.max(u0, M.u0);
  const rv0 = Math.max(v0, M.v0);
  const ru1 = Math.min(u1, M.u1);
  const rv1 = Math.min(v1, M.v1);
  if (ru1 <= ru0 || rv1 <= rv0) return;
  const { img, f } = pick(m, texelM * M.k);
  const pat = g.createPattern(img, "repeat");
  if (!pat) return;
  const s = texelM * f * M.k;
  pat.setTransform(new DOMMatrix([s, 0, 0, s, (au - M.ox) * M.k, (av - M.oy) * M.k]));
  g.fillStyle = pat;
  g.fillRect((ru0 - M.ox) * M.k, (rv0 - M.oy) * M.k, (ru1 - ru0) * M.k, (rv1 - rv0) * M.k);
};

const rect = (g: CanvasRenderingContext2D, M: Map2, u0: number, v0: number, u1: number, v1: number) => {
  if (u1 < M.u0 || u0 > M.u1 || v1 < M.v0 || v0 > M.v1) return;
  g.fillRect((u0 - M.ox) * M.k, (v0 - M.oy) * M.k, (u1 - u0) * M.k, (v1 - v0) * M.k);
};

// ------------------------------------------------------------------ standard-cell layout (shared)
export const CH = 240e-9; // cell row height
export const GP = 48e-9; // contacted gate pitch
const GW = 16e-9;
const FW = 7e-9;
const FINS = [54e-9, 84e-9, 156e-9, 186e-9];
const NG = 160; // layout repeats every 160 gates x 32 rows = 7.68 µm
const NR = 32;
const TILE_M = NG * GP; // 7.68e-6
const wrap = (i: number, n: number) => ((i % n) + n) % n;
const dummy = (i: number, j: number) => hash2(wrap(i, NG) + 0.31, wrap(j, NR) + 0.77) < 0.15;
const cut = (i: number, j: number) => hash2(wrap(i, NG) + 5.13, wrap(j, NR) + 40.3) < 0.3;

let cellMips: Mips | null = null;
const CELL_PX = 2048;
const CELL_TEXEL = TILE_M / CELL_PX; // 3.75 nm
const cellTile = () => {
  if (cellMips) return cellMips;
  const c = mk(CELL_PX, CELL_PX);
  const g = c.getContext("2d")!;
  const P = 1 / CELL_TEXEL;
  g.fillStyle = "#0a1220";
  g.fillRect(0, 0, CELL_PX, CELL_PX);
  for (let j = 0; j < NR; j++) {
    const v0 = j * CH * P;
    // fins
    g.fillStyle = "#2b7fc4";
    for (const fy of FINS) g.fillRect(0, v0 + (fy - FW / 2) * P, CELL_PX, FW * P);
    for (let i = 0; i < NG; i++) {
      const uc = (i + 0.5) * GP * P;
      const d = dummy(i, j);
      // trench contacts between gates
      if (!d && !dummy(i + 1, j)) {
        g.fillStyle = "#b08a52";
        const cu = (i + 1) * GP * P;
        g.fillRect(cu - 1.6, v0 + 46e-9 * P, 3.2, 46e-9 * P);
        g.fillRect(cu - 1.6, v0 + 148e-9 * P, 3.2, 46e-9 * P);
      }
      g.fillStyle = d ? "#2c3442" : "#9aa6bf";
      const top = v0 + 24e-9 * P;
      const bot = v0 + 216e-9 * P;
      if (cut(i, j) && !d) {
        g.fillRect(uc - (GW / 2) * P, top, GW * P, (120e-9 - 24e-9 - 8e-9) * P);
        g.fillRect(uc - (GW / 2) * P, v0 + 128e-9 * P, GW * P, (216e-9 - 128e-9) * P);
      } else g.fillRect(uc - (GW / 2) * P, top, GW * P, bot - top);
    }
    // power rails on the row boundary
    g.fillStyle = "#7a5a32";
    g.fillRect(0, v0 - 12e-9 * P, CELL_PX, 24e-9 * P);
  }
  g.fillStyle = "#7a5a32";
  g.fillRect(0, CELL_PX - 12e-9 * P, CELL_PX, 12e-9 * P);
  cellMips = mipsOf(c);
  return cellMips;
};

let sramMips: Mips | null = null;
const SRAM_PX = 512;
const SRAM_TEXEL = 50e-9;
const sramTile = () => {
  if (sramMips) return sramMips;
  const c = mk(SRAM_PX, SRAM_PX);
  const g = c.getContext("2d")!;
  g.fillStyle = "#140f2c";
  g.fillRect(0, 0, SRAM_PX, SRAM_PX);
  for (let y = 0; y < SRAM_PX; y += 4) {
    g.fillStyle = y % 8 ? "#4a3da0" : "#6553c8";
    g.fillRect(0, y, SRAM_PX, 2);
  }
  g.fillStyle = "rgba(10,8,24,0.55)";
  for (let x = 0; x < SRAM_PX; x += 8) g.fillRect(x, 0, 2, SRAM_PX);
  // sub-array boundaries with sense amps
  for (let y = 0; y < SRAM_PX; y += 128) {
    g.fillStyle = "#0b0818";
    g.fillRect(0, y, SRAM_PX, 8);
    g.fillStyle = "#8b78e8";
    g.fillRect(0, y + 2, SRAM_PX, 2);
  }
  for (let x = 0; x < SRAM_PX; x += 256) {
    g.fillStyle = "#0b0818";
    g.fillRect(x, 0, 10, SRAM_PX);
    g.fillStyle = "#3d6db8";
    g.fillRect(x + 3, 0, 3, SRAM_PX);
  }
  sramMips = mipsOf(c);
  return sramMips;
};

let noiseC: HTMLCanvasElement | null = null;
const NOISE_TEXEL = 6e-6;
/** Low-frequency cell-density variation (dark translucent blotches), tileable. */
const densityNoise = () => {
  if (noiseC) return noiseC;
  const n = 128;
  const c = mk(n, n);
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const cell = (x: number, y: number, s: number) => hash2(wrap(x, s) + 0.5, wrap(y, s) + 9.5);
  const vn = (x: number, y: number, s: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = cell(xi, yi, s);
    const b = cell(xi + 1, yi, s);
    const cc = cell(xi, yi + 1, s);
    const d = cell(xi + 1, yi + 1, s);
    return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = 0.6 * vn(x / 16, y / 16, 8) + 0.4 * vn(x / 4, y / 4, 32);
      const k = (y * n + x) * 4;
      img.data[k] = 0;
      img.data[k + 1] = 0;
      img.data[k + 2] = 0;
      img.data[k + 3] = Math.round(clamp((v - 0.35) * 1.4) * 150);
    }
  g.putImageData(img, 0, 0);
  noiseC = c;
  return c;
};

// ------------------------------------------------------------------ SM layout (mm, SM-local, y down)
type Kind = "logic" | "tc" | "sram" | "fp" | "l1";
type Blk = { x0: number; y0: number; x1: number; y1: number; kind: Kind };
const SM_BLOCKS: Blk[] = [{ x0: -1.16, y0: -0.94, x1: 1.16, y1: -0.62, kind: "l1" }];
for (const [px, py] of [
  [-1.16, -0.58],
  [0.02, -0.58],
  [-1.16, 0.2],
  [0.02, 0.2],
]) {
  SM_BLOCKS.push({ x0: px + 0.04, y0: py + 0.04, x1: px + 0.36, y1: py + 0.7, kind: "sram" });
  SM_BLOCKS.push({ x0: px + 0.4, y0: py + 0.04, x1: px + 0.84, y1: py + 0.48, kind: "tc" });
  SM_BLOCKS.push({ x0: px + 0.88, y0: py + 0.04, x1: px + 1.1, y1: py + 0.48, kind: "logic" });
  SM_BLOCKS.push({ x0: px + 0.4, y0: py + 0.52, x1: px + 1.1, y1: py + 0.7, kind: "fp" });
}
export const TC_BLOCKS = SM_BLOCKS.filter((b) => b.kind === "tc");

/** Draw one SM (centre cu, cv in world metres) from its blocks. flip = mirror vertically. */
const drawSM = (g: CanvasRenderingContext2D, M: Map2, cu: number, cv: number, flip: boolean) => {
  const hw = SM_W / 2;
  const hh = SM_H / 2;
  if (cu + hw < M.u0 || cu - hw > M.u1 || cv + hh < M.v0 || cv - hh > M.v1) return;
  g.fillStyle = "#06090f";
  rect(g, M, cu - hw, cv - hh, cu + hw, cv + hh);
  const cell = cellTile();
  const sram = sramTile();
  const lw = (m: number) => Math.max(0.6, m * M.k);
  for (const b of SM_BLOCKS) {
    const y0 = flip ? -b.y1 : b.y0;
    const y1 = flip ? -b.y0 : b.y1;
    const u0 = cu + b.x0 * 1e-3;
    const u1 = cu + b.x1 * 1e-3;
    const v0 = cv + y0 * 1e-3;
    const v1 = cv + y1 * 1e-3;
    if (u1 < M.u0 || u0 > M.u1 || v1 < M.v0 || v0 > M.v1) continue;
    if (b.kind === "sram" || b.kind === "l1") fillTex(g, M, sram, SRAM_TEXEL, 0, 0, u0, v0, u1, v1);
    else fillTex(g, M, cell, CELL_TEXEL, 0, 0, u0, v0, u1, v1);
    // block character
    if (b.kind === "tc") {
      g.fillStyle = "rgba(40,200,255,0.10)";
      rect(g, M, u0, v0, u1, v1);
      g.fillStyle = "rgba(4,10,18,0.85)";
      const w = (u1 - u0) / 4;
      const h = (v1 - v0) / 4;
      for (let q = 1; q < 4; q++) {
        rect(g, M, u0 + q * w - 2.5e-6, v0, u0 + q * w + 2.5e-6, v1);
        rect(g, M, u0, v0 + q * h - 2.5e-6, u1, v0 + q * h + 2.5e-6);
      }
    } else if (b.kind === "fp") {
      g.fillStyle = "rgba(60,110,255,0.12)";
      rect(g, M, u0, v0, u1, v1);
      g.fillStyle = "rgba(4,8,20,0.8)";
      const n = 16;
      const w = (u1 - u0) / n;
      for (let q = 1; q < n; q++) rect(g, M, u0 + q * w - 1.5e-6, v0, u0 + q * w + 1.5e-6, v1);
      rect(g, M, u0, (v0 + v1) / 2 - 1.5e-6, u1, (v0 + v1) / 2 + 1.5e-6);
    } else if (b.kind === "logic") {
      g.fillStyle = "rgba(150,170,200,0.06)";
      rect(g, M, u0, v0, u1, v1);
    }
    if (b.kind !== "sram" && b.kind !== "l1") {
      const nz = densityNoise();
      const pat = g.createPattern(nz, "repeat");
      if (pat) {
        const s = NOISE_TEXEL * M.k;
        pat.setTransform(new DOMMatrix([s, 0, 0, s, (0 - M.ox) * M.k, (0 - M.oy) * M.k]));
        g.fillStyle = pat;
        rect(g, M, u0, v0, u1, v1);
      }
    }
    // outline (routing channel edge)
    g.strokeStyle = "rgba(120,150,190,0.35)";
    g.lineWidth = lw(1.5e-6);
    const x = (u0 - M.ox) * M.k;
    const y = (v0 - M.oy) * M.k;
    g.strokeRect(x, y, (u1 - u0) * M.k, (v1 - v0) * M.k);
  }
  // SM frame
  g.strokeStyle = "rgba(90,130,180,0.5)";
  g.lineWidth = lw(6e-6);
  g.strokeRect((cu - hw - M.ox) * M.k, (cv - hh - M.oy) * M.k, SM_W * M.k, SM_H * M.k);
};

let smMips: Mips | null = null;
const SMT_K = 5e5; // px per metre (2 µm / px)
const smTexture = () => {
  if (smMips) return smMips;
  const w = Math.round(SM_W * SMT_K);
  const h = Math.round(SM_H * SMT_K);
  const c = mk(w, h);
  const g = c.getContext("2d")!;
  const M: Map2 = { ox: -SM_W / 2, oy: -SM_H / 2, k: SMT_K, u0: -1, v0: -1, u1: 1, v1: 1 };
  drawSM(g, M, 0, 0, false);
  smMips = mipsOf(c);
  return smMips;
};

// ------------------------------------------------------------------ die layout (mm, die-local)
type SMslot = { x: number; y: number; flip: boolean; id: number };
export const SM_SLOTS: SMslot[] = [];
for (let half = 0; half < 2; half++)
  for (let gpc = 0; gpc < 4; gpc++)
    for (let s = 0; s < 2; s++)
      for (let r = 0; r < 5; r++) {
        const x = -10.4 + 5.2 * gpc + 1.3 + 2.6 * s;
        const y = half === 0 ? -13.2 + 2.28 * (r + 0.5) : 1.8 + 2.28 * (4 - r + 0.5);
        SM_SLOTS.push({ x, y, flip: half === 1, id: SM_SLOTS.length });
      }

const drawDieBase = (g: CanvasRenderingContext2D, M: Map2, cu: number, cv: number) => {
  const mm = 1e-3;
  g.fillStyle = "#070b13";
  rect(g, M, cu - DIE_W / 2, cv - DIE_H / 2, cu + DIE_W / 2, cv + DIE_H / 2);
  const sram = sramTile();
  // L2 cache band (two rows of banks) + crossbar
  fillTex(g, M, sram, SRAM_TEXEL, 0, 0, cu - 10.4 * mm, cv - 1.6 * mm, cu + 10.4 * mm, cv + 1.6 * mm);
  g.fillStyle = "rgba(6,4,16,0.9)";
  for (let b = 0; b <= 16; b++) {
    const x = cu + (-10.4 + 1.3 * b) * mm;
    rect(g, M, x - 0.04 * mm, cv - 1.6 * mm, x + 0.04 * mm, cv + 1.6 * mm);
  }
  g.fillStyle = "#0d1522";
  rect(g, M, cu - 10.4 * mm, cv - 0.32 * mm, cu + 10.4 * mm, cv + 0.32 * mm);
  fillTex(g, M, cellTile(), CELL_TEXEL, 0, 0, cu - 10.4 * mm, cv - 0.28 * mm, cu + 10.4 * mm, cv + 0.28 * mm);
  // HBM PHYs (top & bottom edges), NVLink SerDes (outer edge), die-to-die link (inner edge)
  const phy = (u0: number, v0: number, u1: number, v1: number, col: string, step: number, vertical: boolean) => {
    g.fillStyle = "#151008";
    rect(g, M, u0, v0, u1, v1);
    g.fillStyle = col;
    if (vertical) for (let x = u0 + step / 2; x < u1; x += step) rect(g, M, x, v0 + step * 0.4, x + step * 0.45, v1 - step * 0.4);
    else for (let y = v0 + step / 2; y < v1; y += step) rect(g, M, u0 + step * 0.4, y, u1 - step * 0.4, y + step * 0.45);
  };
  for (const s of [-1, 1]) {
    phy(cu - 11 * mm, cv + s * 14.3 * mm - 0.65 * mm, cu - 1.4 * mm, cv + s * 14.3 * mm + 0.65 * mm, "#b8873e", 0.12 * mm, true);
    phy(cu + 1.4 * mm, cv + s * 14.3 * mm - 0.65 * mm, cu + 11 * mm, cv + s * 14.3 * mm + 0.65 * mm, "#b8873e", 0.12 * mm, true);
  }
  phy(cu - 11.9 * mm, cv - 13 * mm, cu - 10.7 * mm, cv + 13 * mm, "#a77a3a", 0.2 * mm, false);
  phy(cu + 10.7 * mm, cv - 13.4 * mm, cu + 11.9 * mm, cv + 13.4 * mm, "#e0a650", 0.08 * mm, false);
  // GPC frames
  g.strokeStyle = "rgba(120,160,220,0.28)";
  g.lineWidth = Math.max(0.6, 0.05 * mm * M.k);
  for (const top of [true, false])
    for (let gpc = 0; gpc < 4; gpc++) {
      const x = cu + (-10.4 + 5.2 * gpc + 0.06) * mm;
      const y = cv + (top ? -13.3 : 1.7) * mm;
      g.strokeRect((x - M.ox) * M.k, (y - M.oy) * M.k, 5.08 * mm * M.k, 11.6 * mm * M.k);
    }
};

let dieMips: Mips | null = null;
const DIE_K = 75000; // 13.3 µm / px
const dieTexture = () => {
  if (dieMips) return dieMips;
  const w = Math.round(DIE_W * DIE_K);
  const h = Math.round(DIE_H * DIE_K);
  const c = mk(w, h);
  const g = c.getContext("2d")!;
  const M: Map2 = { ox: -DIE_W / 2, oy: -DIE_H / 2, k: DIE_K, u0: -1, v0: -1, u1: 1, v1: 1 };
  drawDieBase(g, M, 0, 0);
  const sm = smTexture();
  const { img } = pick(sm, 1 / (SMT_K / DIE_K));
  for (const s of SM_SLOTS) {
    const x = (s.x * 1e-3 - SM_W / 2 + DIE_W / 2) * DIE_K;
    const y = (s.y * 1e-3 - SM_H / 2 + DIE_H / 2) * DIE_K;
    g.save();
    if (s.flip) {
      g.translate(0, y * 2 + SM_H * DIE_K);
      g.scale(1, -1);
    }
    g.drawImage(img, x, y, SM_W * DIE_K, SM_H * DIE_K);
    g.restore();
  }
  dieMips = mipsOf(c, 8);
  return dieMips;
};

/** Draw a die (texture) centred at (cu, cv); mirrored = die 2 (link edge faces die 1). */
const drawDieTex = (g: CanvasRenderingContext2D, M: Map2, cu: number, cv: number, mirrored: boolean, alpha = 1) => {
  if (cu + DIE_W / 2 < M.u0 || cu - DIE_W / 2 > M.u1 || cv + DIE_H / 2 < M.v0 || cv - DIE_H / 2 > M.v1) return;
  const dm = dieTexture();
  const { img } = pick(dm, M.k / DIE_K);
  const x = (cu - M.ox) * M.k;
  const y = (cv - M.oy) * M.k;
  const w = DIE_W * M.k;
  const h = DIE_H * M.k;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  if (mirrored) g.scale(-1, 1);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
};

// ------------------------------------------------------------------ package + module board
const HBM_POS: [number, number][] = [];
for (const sv of [-1, 1]) for (const du of [-18.5, -6.5, 6.5, 18.5]) HBM_POS.push([du * 1e-3, sv * 21.8e-3]);
export const HBM_W = 11e-3;
export const HBM_H = 10e-3;

const drawPackage = (g: CanvasRenderingContext2D, M: Map2, pu: number, pv: number) => {
  const mm = 1e-3;
  // substrate
  g.fillStyle = "#13201b";
  rect(g, M, pu - 38 * mm, pv - 38 * mm, pu + 38 * mm, pv + 38 * mm);
  g.fillStyle = "#18291f";
  rect(g, M, pu - 36.5 * mm, pv - 36.5 * mm, pu + 36.5 * mm, pv + 36.5 * mm);
  // capacitor fields around the interposer
  const capPx = 0.9 * mm * M.k;
  if (capPx > 0.8) {
    for (let side = 0; side < 4; side++)
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 34; i++) {
          const t = -31.5 + i * 1.9;
          const off = 31 + r * 1.6;
          let u = 0;
          let v = 0;
          if (side === 0) [u, v] = [t, -off];
          else if (side === 1) [u, v] = [t, off];
          else if (side === 2) [u, v] = [-off, t];
          else [u, v] = [off, t];
          if (hash(side * 977 + r * 131 + i) < 0.22) continue;
          const cu = pu + u * mm;
          const cv = pv + v * mm;
          const horiz = side < 2;
          const a = horiz ? 0.5 : 0.9;
          const b = horiz ? 0.9 : 0.5;
          g.fillStyle = "#2a2622";
          rect(g, M, cu - a * mm * 0.5, cv - b * mm * 0.5, cu + a * mm * 0.5, cv + b * mm * 0.5);
          g.fillStyle = "#c9a35c";
          if (horiz) {
            rect(g, M, cu - 0.25 * mm, cv - 0.45 * mm, cu + 0.25 * mm, cv - 0.3 * mm);
            rect(g, M, cu - 0.25 * mm, cv + 0.3 * mm, cu + 0.25 * mm, cv + 0.45 * mm);
          } else {
            rect(g, M, cu - 0.45 * mm, cv - 0.25 * mm, cu - 0.3 * mm, cv + 0.25 * mm);
            rect(g, M, cu + 0.3 * mm, cv - 0.25 * mm, cu + 0.45 * mm, cv + 0.25 * mm);
          }
        }
  }
  // interposer
  g.fillStyle = "#0e121a";
  rect(g, M, pu - 27 * mm, pv - 28.5 * mm, pu + 27 * mm, pv + 28.5 * mm);
  // HBM <-> die wiring on the interposer
  g.fillStyle = "rgba(210,160,80,0.22)";
  for (const [hu, hv] of HBM_POS) {
    const s = Math.sign(hv);
    const ve = pv + hv - (s * HBM_H) / 2;
    const vd = pv + s * 15 * mm;
    for (let l = 0; l < 22; l++) {
      const u = pu + hu - 4.6 * mm + l * 0.44 * mm;
      rect(g, M, u - 0.06 * mm, Math.min(ve, vd), u + 0.06 * mm, Math.max(ve, vd));
    }
  }
  // dies
  drawDieTex(g, M, pu - 12.5 * mm, pv, false);
  drawDieTex(g, M, pu + 12.5 * mm, pv, true);
  // HBM stacks
  for (const [hu, hv] of HBM_POS) {
    const u0 = pu + hu - HBM_W / 2;
    const v0 = pv + hv - HBM_H / 2;
    if (u0 > M.u1 || u0 + HBM_W < M.u0 || v0 > M.v1 || v0 + HBM_H < M.v0) continue;
    const x = (u0 - M.ox) * M.k;
    const y = (v0 - M.oy) * M.k;
    const w = HBM_W * M.k;
    const h = HBM_H * M.k;
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, "#3a404e");
    gr.addColorStop(0.45, "#1d2129");
    gr.addColorStop(1, "#2b303b");
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(200,210,230,0.45)";
    g.lineWidth = Math.max(0.6, 0.12 * mm * M.k);
    g.strokeRect(x, y, w, h);
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (let q = 1; q < 8; q++) g.fillRect(x + w * 0.08, y + (h * q) / 8, w * 0.84, Math.max(0.5, h * 0.012));
    g.fillStyle = "rgba(200,160,90,0.5)";
    g.fillRect(x + w * 0.08, y + h * 0.08, w * 0.08, w * 0.08);
  }
};

const drawBoard = (g: CanvasRenderingContext2D, M: Map2, mu: number, mv: number) => {
  const mm = 1e-3;
  const u0 = mu - MOD_W / 2;
  const v0 = mv - MOD_H / 2;
  g.fillStyle = "#0b1d16";
  rect(g, M, u0, v0, u0 + MOD_W, v0 + MOD_H);
  g.fillStyle = "#0f2a1f";
  rect(g, M, u0 + 1.5 * mm, v0 + 1.5 * mm, u0 + MOD_W - 1.5 * mm, v0 + MOD_H - 1.5 * mm);
  // copper traces fanning out to the edge connectors
  g.strokeStyle = "rgba(205,150,70,0.16)";
  g.lineWidth = Math.max(0.5, 0.25 * mm * M.k);
  g.beginPath();
  for (let i = 0; i < 40; i++) {
    const a = (i / 39 - 0.5) * 70 * mm;
    const sx = (mu + a * 0.9 - M.ox) * M.k;
    const sy = (mv + 20 * mm - M.oy) * M.k;
    const ex = (mu + a * 0.62 - M.ox) * M.k;
    const ey = (v0 + MOD_H - 8 * mm - M.oy) * M.k;
    g.moveTo(sx, sy);
    g.bezierCurveTo(sx, sy + 20 * mm * M.k, ex, ey - 20 * mm * M.k, ex, ey);
  }
  g.stroke();
  // VRM: inductors + power stages
  const ind = (cu: number, cv: number, s: number) => {
    const x = (cu - s / 2 - M.ox) * M.k;
    const y = (cv - s / 2 - M.oy) * M.k;
    const w = s * M.k;
    if (x > 4000 || y > 4000 || x + w < -4000 || y + w < -4000) return;
    const gr = g.createLinearGradient(x, y, x, y + w);
    gr.addColorStop(0, "#3c3f46");
    gr.addColorStop(1, "#1a1c21");
    g.fillStyle = gr;
    g.fillRect(x, y, w, w);
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(x + w * 0.12, y + w * 0.12, w * 0.76, w * 0.2);
  };
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 10; i++) {
      const cu = mu + (-40.5 + i * 9) * mm;
      const cv = mv + (24 + r * 9.5) * mm;
      ind(cu, cv, 6.5 * mm);
      g.fillStyle = "#0a0b0d";
      rect(g, M, cu - 2 * mm, cv + 3.6 * mm, cu + 2 * mm, cv + 5.2 * mm);
    }
  for (const s of [-1, 1])
    for (let i = 0; i < 6; i++) ind(mu + s * 44.5 * mm, mv + (-62 + i * 9.2) * mm, 6 * mm);
  // mezzanine connectors
  for (const s of [-1, 1]) {
    g.fillStyle = "#16181c";
    rect(g, M, mu + s * 24 * mm - 17 * mm, mv + 52 * mm, mu + s * 24 * mm + 17 * mm, mv + 61 * mm);
    g.fillStyle = "#c9a35c";
    if (0.6 * mm * M.k > 1)
      for (let i = 0; i < 40; i++)
        for (let r = 0; r < 3; r++) {
          const cu = mu + s * 24 * mm - 16 * mm + i * 0.82 * mm;
          rect(g, M, cu, mv + (53.5 + r * 2.4) * mm, cu + 0.4 * mm, mv + (54.5 + r * 2.4) * mm);
        }
  }
  // mounting holes
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = (mu + a * 45 * mm - M.ox) * M.k;
    const y = (mv + b * 65 * mm - M.oy) * M.k;
    g.fillStyle = "#c9a35c";
    g.beginPath();
    g.arc(x, y, 3 * mm * M.k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#020304";
    g.beginPath();
    g.arc(x, y, 1.8 * mm * M.k, 0, Math.PI * 2);
    g.fill();
  }
  drawPackage(g, M, mu, mv - 18 * mm);
};

let modTex: HTMLCanvasElement | null = null;
export const MOD_K = 8000;
/** Static texture of one GPU module (board + package), used by the 3D tray. */
export const moduleTexture = () => {
  if (modTex) return modTex;
  const c = mk(Math.round(MOD_W * MOD_K), Math.round(MOD_H * MOD_K));
  const g = c.getContext("2d")!;
  const M: Map2 = { ox: -MOD_W / 2, oy: -MOD_H / 2, k: MOD_K, u0: -1, v0: -1, u1: 1, v1: 1 };
  drawBoard(g, M, 0, 0);
  modTex = c;
  return c;
};

// ------------------------------------------------------------------ live layers
const fade = (x: number, a: number, b: number) => clamp((x - a) / (b - a));

/** Transistors (fins x gates) with switching glows. */
const drawTransistors = (g: CanvasRenderingContext2D, M: Map2, f: number, alpha: number) => {
  const k = M.k;
  const i0 = Math.floor(M.u0 / GP) - 1;
  const i1 = Math.ceil(M.u1 / GP) + 1;
  const j0 = Math.floor(M.v0 / CH) - 1;
  const j1 = Math.ceil(M.v1 / CH);
  const X = (u: number) => (u - M.ox) * k;
  const Y = (v: number) => (v - M.oy) * k;
  const xa = X(M.u0);
  const xw = (M.u1 - M.u0) * k;
  const big = GW * k > 18;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "#081020";
  g.fillRect(xa, Y(M.v0), xw, (M.v1 - M.v0) * k);
  for (let j = j0; j <= j1; j++) {
    const vt = j * CH;
    // fins
    for (const fy of FINS) {
      const y = Y(vt + fy - FW / 2);
      const h = FW * k;
      if (big) {
        const gr = g.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, "#123a66");
        gr.addColorStop(0.5, "#4fb4ff");
        gr.addColorStop(1, "#123a66");
        g.fillStyle = gr;
      } else g.fillStyle = "#2f8ad6";
      g.fillRect(xa, y, xw, h);
    }
    for (let i = i0; i <= i1; i++) {
      const uc = (i + 0.5) * GP;
      const d = dummy(i, j);
      // contacts
      if (!d && !dummy(i + 1, j)) {
        g.fillStyle = "#b8925a";
        const cu = X((i + 1) * GP);
        const cw = 6.5e-9 * k;
        g.fillRect(cu - cw / 2, Y(vt + 46e-9), cw, 46e-9 * k);
        g.fillRect(cu - cw / 2, Y(vt + 148e-9), cw, 46e-9 * k);
      }
      const x = X(uc - GW / 2);
      const w = GW * k;
      if (big && !d) {
        const gr = g.createLinearGradient(x, 0, x + w, 0);
        gr.addColorStop(0, "#5d6680");
        gr.addColorStop(0.5, "#d6dcef");
        gr.addColorStop(1, "#5d6680");
        g.fillStyle = gr;
      } else g.fillStyle = d ? "#2c3442" : "#a3aec6";
      const top = Y(vt + 24e-9);
      const bot = Y(vt + 216e-9);
      if (cut(i, j) && !d) {
        g.fillRect(x, top, w, Y(vt + 112e-9) - top);
        g.fillRect(x, Y(vt + 128e-9), w, bot - Y(vt + 128e-9));
      } else g.fillRect(x, top, w, bot - top);
    }
    // power rail
    g.fillStyle = "#86643a";
    g.fillRect(xa, Y(vt - 12e-9), xw, 24e-9 * k);
  }
  // switching glows at gate x fin crossings
  g.globalCompositeOperation = "lighter";
  const r = Math.max(2, 20e-9 * k);
  const tick = Math.floor(f / 3);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (dummy(i, j)) continue;
      const wave = 0.5 + 0.5 * Math.sin((i * GP) * 1.6e6 + (j * CH) * 0.9e6 - f * 0.22);
      for (let q = 0; q < 4; q++) {
        const ph = hash(i * 3.17 + j * 7.31 + q * 1.93);
        const on = hash(i * 1.7 + j * 9.3 + q * 4.1 + Math.floor(tick + ph * 5) * 0.37) < 0.18 + 0.32 * wave;
        if (!on) continue;
        const x = X((i + 0.5) * GP);
        const y = Y(j * CH + FINS[q]);
        glow(g, x, y, r * 2.4, C.cyan, 0.55 * alpha);
        if (big) glow(g, x, y, r * 0.7, "#ffffff", 0.6 * alpha);
      }
    }
  g.restore();
};

type Layer = { h: number; pitch: number; width: number; horiz: boolean; seg: number; col: string; phase: number };
const METALS: Layer[] = [
  { h: 60e-9, pitch: 40e-9, width: 18e-9, horiz: true, seg: 6, col: "#e09a4a", phase: 0.1 },
  { h: 130e-9, pitch: 64e-9, width: 28e-9, horiz: false, seg: 5, col: "#f0b060", phase: 0.37 },
  { h: 220e-9, pitch: 96e-9, width: 44e-9, horiz: true, seg: 9, col: "#e09a4a", phase: 0.71 },
  { h: 0.55e-6, pitch: 0.36e-6, width: 0.16e-6, horiz: false, seg: 7, col: "#d9a25e", phase: 0.23 },
  { h: 1.3e-6, pitch: 1.2e-6, width: 0.5e-6, horiz: true, seg: 6, col: "#e6ad62", phase: 0.53 },
  { h: 3.2e-6, pitch: 5.6e-6, width: 2.2e-6, horiz: false, seg: 0, col: "#ffbf6a", phase: 0.91 },
  { h: 6.5e-6, pitch: 14e-6, width: 5.5e-6, horiz: true, seg: 0, col: "#ffc878", phase: 0.11 },
];

/** Interconnect layers above the transistors, each at its own height (true parallax as we pull back). */
const drawMetals = (g: CanvasRenderingContext2D, T: [number, number], D: number, f: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let li = 0; li < METALS.length; li++) {
    const L = METALS[li];
    if (D <= L.h * 1.05) continue;
    const mag = D / (D - L.h);
    const k = 1500 / (D - L.h);
    const pPx = L.pitch * k;
    const a = clamp((2.6 - mag) / 1.0) * fade(pPx, 3, 9) * (li < 3 ? 0.55 : 0.42);
    if (a <= 0.01) continue;
    const R = 1110 / k;
    const along0 = (L.horiz ? T[0] : T[1]) - R;
    const along1 = (L.horiz ? T[0] : T[1]) + R;
    const acr0 = (L.horiz ? T[1] : T[0]) - R;
    const acr1 = (L.horiz ? T[1] : T[0]) + R;
    const t0 = Math.floor(acr0 / L.pitch);
    const t1 = Math.ceil(acr1 / L.pitch);
    const seglen = L.seg ? L.pitch * L.seg : 0;
    for (let t = t0; t <= t1; t++) {
      if (L.seg && hash(t * 3.3 + li * 17) < 0.12) continue;
      const c = (t + 0.5) * L.pitch;
      const pieces: [number, number][] = [];
      if (!L.seg) pieces.push([along0, along1]);
      else {
        const s0 = Math.floor(along0 / seglen) - 1;
        const s1 = Math.ceil(along1 / seglen);
        for (let s = s0; s <= s1; s++) {
          const h1 = hash(t * 7.7 + s * 3.1 + li * 31);
          if (h1 < 0.3) continue;
          const st = s * seglen + hash(t * 1.3 + s * 5.9 + li) * seglen * 0.4;
          const en = (s + 1) * seglen - hash(t * 2.9 + s * 1.1 + li) * seglen * 0.35;
          pieces.push([st, en]);
        }
      }
      for (const [p0, p1] of pieces) {
        // world -> rotated screen (camera above T)
        const toS = (al: number) => {
          const u = L.horiz ? al : c;
          const v = L.horiz ? c : al;
          return [(u - T[0]) * k, (v - T[1]) * k];
        };
        const [ax, ay] = toS(p0);
        const [bx, by] = toS(p1);
        const w = L.width * k;
        g.fillStyle = withAlpha(L.col, 0.22 * a);
        if (L.horiz) g.fillRect(ax, ay - w / 2, bx - ax, w);
        else g.fillRect(ax - w / 2, ay, w, by - ay);
        g.fillStyle = withAlpha("#ffe3b0", 0.3 * a);
        if (L.horiz) g.fillRect(ax, ay - w * 0.12, bx - ax, w * 0.24);
        else g.fillRect(ax - w * 0.12, ay, w * 0.24, by - ay);
        // data pulse
        const id = t * 13.7 + Math.floor(p0 / (L.pitch * 3)) * 3.3 + li * 7;
        if (hash(id) < 0.45) {
          const len = p1 - p0;
          const sp = 0.012 + 0.02 * hash(id + 1);
          const ph = (f * sp + hash(id + 2)) % 1;
          const [px, py] = toS(p0 + len * ph);
          glow(g, px, py, Math.max(3, w * 2.2), C.cyan, 0.9 * a);
        }
      }
    }
  }
  g.restore();
};

/** Multi-scale switching activity: grid cells light up and flicker. */
const drawActivity = (g: CanvasRenderingContext2D, M: Map2, f: number, alpha: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let lv = 0; lv < 6; lv++) {
    const s = 0.5e-6 * Math.pow(6, lv);
    const px = s * M.k;
    const a = fade(px, 10, 26) * (1 - fade(px, 90, 220)) * alpha;
    if (a <= 0.01) continue;
    const i0 = Math.floor(M.u0 / s);
    const i1 = Math.ceil(M.u1 / s);
    const j0 = Math.floor(M.v0 / s);
    const j1 = Math.ceil(M.v1 / s);
    const tick = Math.floor(f / 4);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const h = hash2(i + lv * 101.3, j - lv * 57.1);
        const wave = 0.5 + 0.5 * Math.sin(i * 0.9 + j * 0.6 - f * 0.18 + lv);
        const on = hash(h * 91.7 + Math.floor(tick + h * 7)) < 0.08 + 0.18 * wave;
        if (!on) continue;
        const x = ((i + 0.5) * s - M.ox) * M.k;
        const y = ((j + 0.5) * s - M.oy) * M.k;
        glow(g, x, y, px * 0.9, h < 0.7 ? C.cyan : C.blue, a * 0.7);
      }
  }
  g.restore();
};

/** SM-level traffic: tensor-core blocks breathing in waves. */
const drawSMActivity = (g: CanvasRenderingContext2D, M: Map2, f: number, alpha: number, dieU: number, dieV: number) => {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const s of SM_SLOTS) {
    const cu = dieU + s.x * 1e-3;
    const cv = dieV + s.y * 1e-3;
    if (cu + SM_W < M.u0 || cu - SM_W > M.u1 || cv + SM_H < M.v0 || cv - SM_H > M.v1) continue;
    for (const b of TC_BLOCKS) {
      const y0 = s.flip ? -b.y1 : b.y0;
      const y1 = s.flip ? -b.y0 : b.y1;
      const u = cu + ((b.x0 + b.x1) / 2) * 1e-3;
      const v = cv + ((y0 + y1) / 2) * 1e-3;
      const w = 0.5 + 0.5 * Math.sin(s.id * 0.7 + b.x0 * 4 + b.y0 * 3 - f * 0.25);
      const fl = 0.6 + 0.4 * hash(s.id * 3.1 + b.x0 * 7 + Math.floor(f / 3));
      glow(g, (u - M.ox) * M.k, (v - M.oy) * M.k, 0.42e-3 * M.k, C.cyan, alpha * (0.15 + 0.5 * w * w) * fl);
    }
  }
  g.restore();
};

/** Die/package-level traffic: SMs pulsing in waves, crossbar packets, HBM streams, die-to-die link. */
const drawDieActivity = (g: CanvasRenderingContext2D, M: Map2, f: number, alpha: number, pu: number, pv: number) => {
  const mm = 1e-3;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const side of [-1, 1]) {
    const du = pu + side * 12.5 * mm;
    for (const s of SM_SLOTS) {
      const cu = du + side * s.x * mm;
      const cv = pv + s.y * mm;
      const d = Math.hypot(cu - pu, cv - pv) * 260;
      const w = 0.5 + 0.5 * Math.sin(d - f * 0.2);
      const fl = 0.7 + 0.3 * hash(s.id * 2.3 + side + Math.floor(f / 4));
      glow(g, (cu - M.ox) * M.k, (cv - M.oy) * M.k, 1.7 * mm * M.k, side < 0 ? C.cyan : C.blue, alpha * (0.08 + 0.42 * w * w * w) * fl);
    }
    // crossbar packets running from the L2 band to the GPCs
    for (let i = 0; i < 26; i++) {
      const lane = Math.floor(hash(i * 3.7 + side) * 8);
      const x = du + side * (-10.4 + 1.3 + lane * 2.6) * mm;
      const dir = hash(i * 5.1 + side) < 0.5 ? -1 : 1;
      const ph = (f * (0.012 + 0.01 * hash(i * 1.9)) + hash(i * 7.3 + side)) % 1;
      const y = pv + dir * (1.4 + ph * 11.5) * mm;
      glow(g, (x - M.ox) * M.k, (y - M.oy) * M.k, 0.55 * mm * M.k, "#bfefff", alpha * 0.8 * Math.sin(ph * Math.PI));
    }
  }
  // HBM streams
  for (let h = 0; h < HBM_POS.length; h++) {
    const [hu, hv] = HBM_POS[h];
    const s = Math.sign(hv);
    for (let q = 0; q < 5; q++) {
      const ph = (f * 0.03 + q / 5 + hash(h * 3.3 + q)) % 1;
      const u = pu + hu + (hash(h * 7 + q) - 0.5) * 8 * mm;
      const v = pv + hv - s * (HBM_H / 2 + ph * 1.9 * mm);
      glow(g, (u - M.ox) * M.k, (v - M.oy) * M.k, 0.9 * mm * M.k, C.gold, alpha * 0.75 * Math.sin(ph * Math.PI));
    }
    glow(g, (pu + hu - M.ox) * M.k, (pv + hv - M.oy) * M.k, 7 * mm * M.k, C.amber, alpha * (0.12 + 0.06 * Math.sin(f * 0.2 + h)));
  }
  // die-to-die link
  const lk = 0.55 + 0.45 * Math.sin(f * 0.35);
  for (let i = 0; i < 9; i++) {
    const v = pv + (-13 + i * 3.25) * mm;
    glow(g, (pu - M.ox) * M.k, (v - M.oy) * M.k, 2.4 * mm * M.k, C.gold, alpha * 0.35 * lk);
  }
  g.restore();
};

/**
 * Draw the flat chip world, centred on the screen with the camera straight above T (u, v).
 * `D` is the camera height above the board (metres), `rot` the in-plane rotation (-yaw).
 */
export const drawChipWorld = (
  g: CanvasRenderingContext2D,
  f: number,
  D: number,
  T: [number, number],
  rot: number,
  alpha: number,
) => {
  if (alpha <= 0.002) return;
  const k = 1500 / D;
  const view = 1920 / k;
  const R = 1110 / k;
  const M: Map2 = { ox: T[0], oy: T[1], k, u0: T[0] - R, v0: T[1] - R, u1: T[0] + R, v1: T[1] + R };
  g.save();
  g.translate(960, 540);
  g.rotate(rot);
  g.globalAlpha = alpha;
  const mm = 1e-3;
  // 1. board + package (+ die textures)
  if (view > 0.012) {
    drawBoard(g, M, MOD_C[0], MOD_C[1]);
  } else {
    g.fillStyle = "#070b13";
    g.fillRect(-1200, -1200, 2400, 2400);
    drawDieTex(g, M, DIE_C[0], DIE_C[1], false);
  }
  // 2. per-SM textures (sharper than the die texture)
  const smTexA = clamp((0.032 - view) / 0.012);
  if (smTexA > 0) {
    const sm = smTexture();
    const { img } = pick(sm, k / SMT_K);
    g.save();
    g.globalAlpha = alpha * smTexA;
    for (const s of SM_SLOTS) {
      const cu = DIE_C[0] + s.x * mm;
      const cv = DIE_C[1] + s.y * mm;
      if (cu + SM_W < M.u0 || cu - SM_W > M.u1 || cv + SM_H < M.v0 || cv - SM_H > M.v1) continue;
      const x = (cu - SM_W / 2 - M.ox) * k;
      const y = (cv - SM_H / 2 - M.oy) * k;
      g.save();
      if (s.flip) {
        g.translate(0, y * 2 + SM_H * k);
        g.scale(1, -1);
      }
      g.drawImage(img, x, y, SM_W * k, SM_H * k);
      g.restore();
    }
    g.restore();
  }
  // 3. block-level SMs (pattern fills) + L2 band
  const blkA = clamp((0.0045 - view) / 0.0018);
  if (blkA > 0) {
    g.save();
    g.globalAlpha = alpha * blkA;
    for (const s of SM_SLOTS) drawSM(g, M, DIE_C[0] + s.x * mm, DIE_C[1] + s.y * mm, s.flip);
    fillTex(g, M, sramTile(), SRAM_TEXEL, 0, 0, DIE_C[0] - 10.4 * mm, DIE_C[1] - 1.6 * mm, DIE_C[0] + 10.4 * mm, DIE_C[1] + 1.6 * mm);
    g.restore();
  }
  // 4. live transistors
  const trA = clamp((3.6e-6 - view) / 1.4e-6);
  if (trA > 0) drawTransistors(g, M, f, alpha * trA);
  // 5. activity
  drawActivity(g, M, f, alpha * clamp((4e-4 - view) / 2e-4));
  const smActA = fade(view, 4e-4, 1e-3) * (1 - fade(view, 0.012, 0.03));
  if (smActA > 0) drawSMActivity(g, M, f, alpha * smActA, DIE_C[0], DIE_C[1]);
  const dieActA = fade(view, 0.008, 0.02);
  if (dieActA > 0) drawDieActivity(g, M, f, alpha * dieActA, PKG_C[0], PKG_C[1]);
  g.globalAlpha = alpha;
  // 6. interconnect stack above, with parallax
  drawMetals(g, T, D, f);
  g.restore();
};

export { HBM_POS };
