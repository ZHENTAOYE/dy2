import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake } from "../lib/math";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("gpu");
const CORES = cue("gpu", "cores");
const RACE = cue("gpu", "race");
const BURST = cue("gpu", "burst");
const MATRIX = cue("gpu", "matrix");

// panels
const PW = 760;
const PH = 470;
const LX = 120;
const RX = 1040;
const PY = 190;

const IMG_W = 720;
const IMG_H = 430;
const PAL: [number, number, number, number][] = [
  [0, 4, 8, 30],
  [0.25, 20, 60, 170],
  [0.5, 56, 214, 255],
  [0.75, 235, 250, 255],
  [1, 255, 166, 61],
];
/** CPU scanline speed (image rows per frame): ~3% of the picture every 2 seconds. */
const CPU_ROWS = 0.22;
let mandel: HTMLCanvasElement | null = null;
/** A Mandelbrot image (the classic GPU demo: seahorse valley, smooth colouring), computed once. */
const mandelbrot = () => {
  if (mandel) return mandel;
  const c = document.createElement("canvas");
  c.width = IMG_W;
  c.height = IMG_H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(IMG_W, IMG_H);
  const max = 400;
  const span = 0.012;
  for (let y = 0; y < IMG_H; y++)
    for (let x = 0; x < IMG_W; x++) {
      const cr = -0.7453 + (x / IMG_W - 0.5) * span;
      const ci = 0.1127 + (y / IMG_H - 0.5) * span * (IMG_H / IMG_W);
      let zr = 0;
      let zi = 0;
      let i = 0;
      while (i < max && zr * zr + zi * zi < 256) {
        const t = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = t;
        i++;
      }
      const k = (y * IMG_W + x) * 4;
      if (i === max) {
        img.data[k] = 2;
        img.data[k + 1] = 4;
        img.data[k + 2] = 14;
      } else {
        const n = i + 1 - Math.log2(Math.log(Math.sqrt(zr * zr + zi * zi)));
        const t = 0.5 - 0.5 * Math.cos(((n / 24) % 1) * Math.PI * 2);
        let j = 1;
        while (j < PAL.length - 1 && t > PAL[j][0]) j++;
        const [a0, r0, g0, b0] = PAL[j - 1];
        const [a1, r1, g1, b1] = PAL[j];
        const u = clamp((t - a0) / (a1 - a0));
        img.data[k] = r0 + (r1 - r0) * u;
        img.data[k + 1] = g0 + (g1 - g0) * u;
        img.data[k + 2] = b0 + (b1 - b0) * u;
      }
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  mandel = c;
  return c;
};

// starts as the chapter card (dur 78) finishes fading, so the title doesn't ghost over the panel outlines
const panelA = (f: number) => ease.outCubic(prog(f, CORES - 14, CORES + 10)) * (1 - prog(f, MATRIX - 20, MATRIX + 10));

const Panels: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#030612");
      bg.addColorStop(1, "#01020a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const a = panelA(f);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      for (const [x, col] of [
        [LX, C.amber],
        [RX, C.cyan],
      ] as const) {
        ctx.strokeStyle = withAlpha(col, 0.5);
        ctx.lineWidth = 2;
        ctx.strokeRect(x, PY, PW, PH);
        ctx.fillStyle = withAlpha(col, 0.04);
        ctx.fillRect(x, PY, PW, PH);
      }
      const race = f >= RACE;
      // CPU: 8 big cores, each a busy little "professor"
      for (let i = 0; i < 8; i++) {
        const t = ease.outBack(clamp((f - CORES - i * 4) / 14));
        if (t <= 0) continue;
        const cx = LX + 100 + (i % 4) * 187;
        const cy = PY + 130 + Math.floor(i / 4) * 220;
        const s = 150 * t;
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, cx, cy, s * 1.1, C.amber, 0.22 * a);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = withAlpha("#2a1a08", 0.95);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
        // internals: ALU, cache, control
        ctx.fillStyle = withAlpha(C.amber, 0.55);
        ctx.fillRect(cx - s * 0.4, cy - s * 0.4, s * 0.45, s * 0.35);
        ctx.fillStyle = withAlpha(C.gold, 0.35);
        ctx.fillRect(cx + s * 0.1, cy - s * 0.4, s * 0.3, s * 0.8);
        ctx.fillStyle = withAlpha(C.amber, 0.25 + 0.4 * hash(i + Math.floor(f / 4)));
        ctx.fillRect(cx - s * 0.4, cy + s * 0.02, s * 0.45, s * 0.38);
      }
      // GPU: thousands of tiny cores
      const cols = 96;
      const rows = 58;
      const cw = PW / cols;
      const ch = PH / rows;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const d = Math.hypot(i - cols / 2, (j - rows / 2) * 1.6);
          const t = clamp((f - CORES - 6 - d * 0.5) / 8);
          if (t <= 0) continue;
          // idle: a slow, smooth shimmer per core (each samples the noise at its own phase); race: frantic flicker
          const busy =
            race && f < MATRIX
              ? 0.6 + 0.4 * hash(i * 7 + j * 13 + Math.floor(f / 2))
              : 0.42 + 0.16 * hash(i + j * 3) + 0.28 * noise1(f / 9 + hash(i * 7 + j * 13) * 97);
          ctx.fillStyle = withAlpha(mix(C.blue, C.cyan, hash(i * 3 + j)), t * busy);
          ctx.fillRect(RX + i * cw + 1, PY + j * ch + 1, cw - 2, ch - 2);
        }
      // the race: render the same picture
      if (race) {
        const img = mandelbrot();
        const rt = f - RACE;
        const iw = PW - 40;
        const ih = PH - 40;
        // CPU: scanline by scanline, painfully slow
        const rowsDone = Math.min(IMG_H, Math.floor(rt * CPU_ROWS));
        ctx.globalAlpha = a * clamp(rt / 10);
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(LX + 20, PY + 20, iw, ih);
        if (rowsDone > 0) ctx.drawImage(img, 0, 0, IMG_W, rowsDone, LX + 20, PY + 20, iw, (ih * rowsDone) / IMG_H);
        const sy = PY + 20 + (ih * (rowsDone + ((rt * CPU_ROWS) % 1))) / IMG_H;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = withAlpha(C.amber, 0.9);
        ctx.fillRect(LX + 20, sy, iw * (((rt * 3) % 60) / 60), 3);
        ctx.globalCompositeOperation = "source-over";
        // GPU: every pixel at once
        const bt = f - BURST;
        if (bt >= 0) {
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(RX + 20, PY + 20, iw, ih);
          const tiles = 24;
          const tw = iw / tiles;
          const th = ih / tiles;
          for (let j = 0; j < tiles; j++)
            for (let i = 0; i < tiles; i++) {
              const at = clamp((bt - hash(i * 31 + j * 17) * 10) / 5);
              if (at <= 0) continue;
              ctx.globalAlpha = a * at;
              ctx.drawImage(img, (i * IMG_W) / tiles, (j * IMG_H) / tiles, IMG_W / tiles, IMG_H / tiles, RX + 20 + i * tw, PY + 20 + j * th, tw + 0.5, th + 0.5);
            }
          ctx.globalAlpha = a;
          ctx.globalCompositeOperation = "lighter";
          glow(ctx, RX + PW / 2, PY + PH / 2, 600, C.cyan, 0.6 * Math.exp(-bt / 10), 0.05);
          ctx.globalCompositeOperation = "source-over";
        }
      }
      ctx.globalAlpha = 1;
    }}
  />
);

const PanelLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = panelA(frame);
  if (a <= 0) return null;
  const race = frame >= RACE;
  const cpuP = race ? Math.min(IMG_H, (frame - RACE) * CPU_ROWS) / IMG_H : 0;
  const gpuP = frame >= BURST ? clamp((frame - BURST) / 15) : 0;
  const head = (x: number, t: string, sub: string, col: string, p: number) => (
    <div style={{ position: "absolute", left: x, top: PY - 96, width: PW }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 52, color: "#fff", textShadow: `0 0 18px ${col}` }}>{t}</span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 28, color: col }}>{sub}</span>
        {race ? (
          <span style={{ marginLeft: "auto", fontFamily: FONT_MONO, fontWeight: 800, fontSize: 40, color: "#fff" }}>{Math.floor(p * 100)}%</span>
        ) : null}
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {head(LX, "CPU", "8 个强大的核心", C.amber, cpuP)}
      {head(RX, "GPU", "上万个简单的核心", C.cyan, gpuP)}
      {race ? (
        <>
          <Bar x={LX} p={cpuP} col={C.amber} />
          <Bar x={RX} p={gpuP} col={C.cyan} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

const Bar: React.FC<{ x: number; p: number; col: string }> = ({ x, p, col }) => (
  <div style={{ position: "absolute", left: x, top: PY + PH + 18, width: PW, height: 10, background: "rgba(255,255,255,0.08)" }}>
    <div style={{ width: `${p * 100}%`, height: "100%", background: col, boxShadow: `0 0 14px ${col}` }} />
  </div>
);

// ---- matrix multiplication -------------------------------------------------
const N = 8;
const CELL = 40;
const GAP = 40;
const BLOCK = N * CELL;
const PITCH = BLOCK + GAP; // A, B and C sit on one grid, so the zoom-out reveals a sea of identical blocks
const CX0 = 980; // C matrix top-left
const CY0 = 440;
const AX0 = CX0 - PITCH;
const BY0 = CY0 - PITCH;
const A = (i: number, k: number) => 1 + Math.floor(hash(i * 13.1 + k * 7.3 + 1) * 9);
const Bm = (k: number, j: number) => 1 + Math.floor(hash(k * 5.7 + j * 11.9 + 2) * 9);
const Cval = (i: number, j: number) => {
  let s = 0;
  for (let k = 0; k < N; k++) s += A(i, k) * Bm(k, j);
  return s;
};
const ONE = cue("gpu", "one"); // first cell computed alone
const ONE_LEN = 40; // its 8 multiply-adds, one every 5 frames
const ALL = cue("gpu", "all"); // then every cell at once
const ZOOM = cue("gpu", "zoom"); // pull back into the sea of blocks
const ZOOM_LEN = 88;

/** Zoom-out: 0..1, the scale of the matrix block and where C's centre sits on screen. */
const zoomAt = (f: number) => {
  const z = ease.inOutCubic(prog(f, ZOOM, ZOOM + ZOOM_LEN));
  const ccx = CX0 + BLOCK / 2;
  const ccy = CY0 + BLOCK / 2;
  return { z, scale: lerp(1, 0.07, z), ccx, ccy, px: lerp(ccx, 960, z), py: lerp(ccy, 470, z) };
};

const MatrixCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const a = ease.outCubic(prog(f, MATRIX - 10, MATRIX + 20));
      if (a <= 0) return;
      const { z, scale, ccx, ccy, px, py } = zoomAt(f);
      // sea of compute: every block is another matrix multiply running at the same time
      if (z > 0) {
        const pitch = PITCH * scale;
        const bs = BLOCK * scale;
        const sub = bs > 120 ? 8 : bs > 36 ? 4 : 1;
        const sc = bs / sub;
        const i0 = Math.floor(-px / pitch) - 1;
        const i1 = Math.ceil((w - px) / pitch) + 1;
        const j0 = Math.floor(-py / pitch) - 1;
        const j1 = Math.ceil((h - py) / pitch) + 1;
        ctx.globalCompositeOperation = "lighter";
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            if ((i === 0 && j === 0) || (i === -1 && j === 0) || (i === 0 && j === -1)) continue;
            const x = px + i * pitch - bs / 2;
            const y = py + j * pitch - bs / 2;
            if (x > w || y > h || x + bs < 0 || y + bs < 0) continue;
            const d = Math.hypot(i, j);
            const tile = clamp((f - ZOOM - 6 - d * 1.3) / 10);
            if (tile <= 0) continue;
            const wave = 0.5 + 0.5 * Math.sin(d * 0.55 - (f - ZOOM) * 0.22);
            const col = mix(C.blue, C.cyan, wave);
            for (let v = 0; v < sub; v++)
              for (let u = 0; u < sub; u++) {
                const flick = hash(i * 7.1 + j * 3.3 + u * 1.7 + v * 5.9 + Math.floor(f / 3));
                ctx.fillStyle = withAlpha(col, (0.12 + 0.55 * wave * flick) * tile * z);
                ctx.fillRect(x + u * sc + (sub > 1 ? 1 : 0), y + v * sc + (sub > 1 ? 1 : 0), sc - (sub > 1 ? 2 : 0), sc - (sub > 1 ? 2 : 0));
              }
          }
        glow(ctx, px, py, 900 * z, C.cyan, 0.35 * z, 0.03);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(px, py);
      ctx.scale(scale, scale);
      ctx.translate(-ccx, -ccy);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const one = clamp((f - ONE) / ONE_LEN);
      const curK = Math.floor(one * N * 0.999);
      const drawGrid = (x0: number, y0: number, val: (i: number, j: number) => string, col: string, hi: (i: number, j: number) => number) => {
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++) {
            const x = x0 + j * CELL;
            const y = y0 + i * CELL;
            const hv = hi(i, j);
            ctx.fillStyle = withAlpha(col, 0.1 + 0.5 * hv);
            ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
            ctx.font = `800 ${hv > 0.5 ? 20 : 17}px ${FONT_MONO}`;
            ctx.fillStyle = hv > 0.3 ? "#fff" : withAlpha("#ffffff", 0.62);
            const v = val(i, j);
            if (v) ctx.fillText(v, x + CELL / 2, y + CELL / 2 + 1);
          }
      };
      const allT = (i: number, j: number) => clamp((f - ALL - hash(i * 9 + j * 5) * 12) / 6);
      drawGrid(AX0, CY0, (i, k) => String(A(i, k)), C.amber, (i, k) => (f >= ONE && f < ALL && i === 0 ? (k === curK ? 1 : 0.35) : f >= ALL ? 0.25 * allT(i, 0) : 0));
      drawGrid(CX0, BY0, (k, j) => String(Bm(k, j)), C.violet, (k, j) => (f >= ONE && f < ALL && j === 0 ? (k === curK ? 1 : 0.35) : f >= ALL ? 0.25 * allT(0, j) : 0));
      drawGrid(
        CX0,
        CY0,
        (i, j) => {
          if (i === 0 && j === 0 && f >= ONE) {
            let s = 0;
            for (let k = 0; k <= Math.min(N - 1, curK); k++) s += A(0, k) * Bm(k, 0);
            return String(s);
          }
          return allT(i, j) > 0 ? String(Cval(i, j)) : "";
        },
        C.cyan,
        (i, j) => (i === 0 && j === 0 && f >= ONE ? 1 : allT(i, j) * (1 - clamp((f - ALL - 24) / 24) * 0.5)),
      );
      ctx.restore();
      // the running dot product for the single cell
      if (f >= ONE && f < ALL) {
        ctx.font = `800 30px ${FONT_MONO}`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = a * (1 - prog(f, ALL - 8, ALL));
        const terms = [];
        for (let k = 0; k <= Math.min(N - 1, curK); k++) terms.push(`${A(0, k)}×${Bm(k, 0)}`);
        ctx.fillText((curK > 3 ? "… + " : "") + terms.slice(-4).join(" + "), CX0 - 28, CY0 - 22);
        ctx.globalAlpha = 1;
      }
    }}
  />
);

const MatrixLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, MATRIX, MATRIX + 20)) * (1 - prog(frame, ZOOM, ZOOM + 26));
  if (a <= 0) return null;
  const s = (x: number, y: number, t: string, col: string) => (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 44, color: col, textShadow: `0 0 16px ${col}` }}>{t}</div>
  );
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {s(AX0 + BLOCK / 2 - 14, CY0 + BLOCK + 4, "A", C.amber)}
      {s(CX0 + BLOCK + 22, BY0 + BLOCK / 2 - 28, "B", C.violet)}
      {s(CX0 + BLOCK + 22, CY0 + BLOCK / 2 - 28, "C = A × B", C.cyan)}
    </AbsoluteFill>
  );
};

export const Gpu: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, BURST, 16, 18);
  const sh2 = shake(frame, ALL, 14, 18);
  const out = prog(frame, DUR - 20, DUR);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: 1 - out }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x + sh2.x}px, ${sh.y + sh2.y}px)` }}>
        <Panels />
        <PanelLabels />
        <MatrixCanvas />
        <MatrixLabels />
      </AbsoluteFill>
      <Flash at={BURST} dur={10} color={C.cyan} peak={0.3} />
      <Flash at={ALL} dur={10} color={C.cyan} peak={0.25} />
      <ChapterCard index={5} title="一万个小学生" en="TEN THOUSAND WORKERS" color={C.cyan} dur={78} />
      <Captions
        accent={C.cyan}
        items={[
          { from: CORES - 16, to: CORES + 104, text: "CPU像几位{{数学教授}}：再难的题都会解，但人数很少。", accent: C.amber },
          { from: CORES + 108, to: RACE - 4, text: "GPU像{{上万名小学生}}：只会简单算术，但能同时开工。" },
          { from: RACE + 2, to: RACE + 99, text: "画一帧游戏画面，要算{{几百万个像素}}——" },
          { from: RACE + 103, to: MATRIX, text: "教授们一行一行地算，小学生们{{一齐落笔}}。" },
          { from: MATRIX + 4, to: ZOOM, text: "AI的核心运算——{{矩阵乘法}}，也是海量的简单乘加。" },
          { from: ZOOM + 4, to: DUR - 12, text: "于是，游戏显卡意外成了{{AI的发动机}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};
