import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, prog, shake } from "../lib/math";
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

const IMG_W = 380;
const IMG_H = 235;
let mandel: HTMLCanvasElement | null = null;
/** A Mandelbrot image (the classic GPU demo), computed once. */
const mandelbrot = () => {
  if (mandel) return mandel;
  const c = document.createElement("canvas");
  c.width = IMG_W;
  c.height = IMG_H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(IMG_W, IMG_H);
  for (let y = 0; y < IMG_H; y++)
    for (let x = 0; x < IMG_W; x++) {
      const cr = -0.745 + (x / IMG_W - 0.5) * 0.06;
      const ci = 0.11 + (y / IMG_H - 0.5) * 0.06 * (IMG_H / IMG_W);
      let zr = 0;
      let zi = 0;
      let i = 0;
      const max = 160;
      while (i < max && zr * zr + zi * zi < 4) {
        const t = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = t;
        i++;
      }
      const k = (y * IMG_W + x) * 4;
      if (i === max) {
        img.data[k] = 2;
        img.data[k + 1] = 4;
        img.data[k + 2] = 16;
      } else {
        const v = Math.sqrt(i / max);
        img.data[k] = Math.floor(255 * clamp(1.6 * v - 0.25));
        img.data[k + 1] = Math.floor(255 * clamp(0.3 + 0.9 * Math.sin(v * 3.1)));
        img.data[k + 2] = Math.floor(255 * clamp(0.6 + 0.5 * Math.cos(v * 5)));
      }
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  mandel = c;
  return c;
};

const panelA = (f: number) => ease.outCubic(prog(f, CORES - 20, CORES + 10)) * (1 - prog(f, MATRIX - 20, MATRIX + 10));

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
          const busy = race && f < MATRIX ? 0.6 + 0.4 * hash(i * 7 + j * 13 + Math.floor(f / 2)) : 0.5 + 0.2 * hash(i + j * 3);
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
        const rowsDone = Math.min(IMG_H, Math.floor(rt * 0.12));
        ctx.globalAlpha = a * clamp(rt / 10);
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(LX + 20, PY + 20, iw, ih);
        if (rowsDone > 0) ctx.drawImage(img, 0, 0, IMG_W, rowsDone, LX + 20, PY + 20, iw, (ih * rowsDone) / IMG_H);
        const sy = PY + 20 + (ih * (rowsDone + ((rt * 0.12) % 1))) / IMG_H;
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
  const cpuP = race ? Math.min(IMG_H, (frame - RACE) * 0.12) / IMG_H : 0;
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
const CELL = 46;
const CX0 = 1010; // C matrix top-left
const CY0 = 430;
const AX0 = CX0 - N * CELL - 50;
const BY0 = CY0 - N * CELL - 30;
const A = (i: number, k: number) => Math.floor(hash(i * 13.1 + k * 7.3 + 1) * 10);
const Bm = (k: number, j: number) => Math.floor(hash(k * 5.7 + j * 11.9 + 2) * 10);
const Cval = (i: number, j: number) => {
  let s = 0;
  for (let k = 0; k < N; k++) s += A(i, k) * Bm(k, j);
  return s;
};
const ONE = MATRIX + 40; // first cell computed alone
const ALL = MATRIX + 120; // then every cell at once
const ZOOM = MATRIX + 175;

const MatrixCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const a = ease.outCubic(prog(f, MATRIX - 10, MATRIX + 20));
      if (a <= 0) return;
      const z = ease.inOutCubic(prog(f, ZOOM, ZOOM + 110));
      const scale = lerp(1, 0.08, z);
      const ccx = CX0 + (N * CELL) / 2;
      const ccy = CY0 + (N * CELL) / 2;
      // sea of compute behind (revealed by the zoom-out)
      if (z > 0) {
        const cell = CELL * N * scale;
        ctx.globalCompositeOperation = "lighter";
        const cols = Math.ceil(w / cell) + 2;
        const rows = Math.ceil(h / cell) + 2;
        const sx = ccx - Math.ceil(cols / 2) * cell;
        const sy = ccy - Math.ceil(rows / 2) * cell;
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) {
            const x = sx + i * cell;
            const y = sy + j * cell;
            const d = Math.hypot(x - ccx, y - ccy);
            const wave = 0.5 + 0.5 * Math.sin(d * 0.012 - f * 0.25);
            const tile = clamp((f - ZOOM - 20 - d * 0.05) / 15);
            if (tile <= 0) continue;
            ctx.fillStyle = withAlpha(mix(C.blue, C.cyan, wave), (0.15 + 0.5 * wave * hash(i * 7 + j * 3 + Math.floor(f / 3))) * tile * z);
            ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
          }
        glow(ctx, ccx, ccy, 900 * z, C.cyan, 0.35 * z, 0.03);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.save();
      ctx.globalAlpha = a * (1 - z * 0.3);
      ctx.translate(ccx, ccy);
      ctx.scale(scale, scale);
      ctx.translate(-ccx, -ccy);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const one = clamp((f - ONE) / 50);
      const curK = Math.floor(one * N * 0.999);
      const drawGrid = (x0: number, y0: number, val: (i: number, j: number) => string, col: string, hi: (i: number, j: number) => number) => {
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++) {
            const x = x0 + j * CELL;
            const y = y0 + i * CELL;
            const hv = hi(i, j);
            ctx.fillStyle = withAlpha(col, 0.08 + 0.5 * hv);
            ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
            ctx.font = `800 ${hv > 0.5 ? 22 : 18}px ${FONT_MONO}`;
            ctx.fillStyle = hv > 0.3 ? "#fff" : withAlpha("#ffffff", 0.6);
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
        (i, j) => (i === 0 && j === 0 && f >= ONE ? 1 : allT(i, j) * (1 - clamp((f - ALL - 30) / 30) * 0.5)),
      );
      ctx.restore();
      // the running product for the single cell
      if (f >= ONE && f < ALL) {
        ctx.font = `800 30px ${FONT_MONO}`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.globalAlpha = a;
        const terms = [];
        for (let k = 0; k <= Math.min(N - 1, curK); k++) terms.push(`${A(0, k)}×${Bm(k, 0)}`);
        ctx.fillText(terms.slice(-4).join(" + "), AX0, BY0 + 60);
        ctx.globalAlpha = 1;
      }
    }}
  />
);

const MatrixLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, MATRIX, MATRIX + 20)) * (1 - prog(frame, ZOOM, ZOOM + 30));
  if (a <= 0) return null;
  const s = (x: number, y: number, t: string, col: string) => (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 44, color: col, textShadow: `0 0 16px ${col}` }}>{t}</div>
  );
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {s(AX0 + (N * CELL) / 2 - 14, CY0 + N * CELL + 6, "A", C.amber)}
      {s(CX0 + N * CELL + 18, BY0 + (N * CELL) / 2 - 26, "B", C.violet)}
      {s(CX0 + N * CELL + 18, CY0 + (N * CELL) / 2 - 26, "C = A × B", C.cyan)}
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
      <ChapterCard index={5} title="一万个小学生" en="TEN THOUSAND WORKERS" color={C.cyan} dur={84} />
      <Captions
        accent={C.cyan}
        items={[
          { from: 90, to: 228, text: "CPU像几位{{数学教授}}：再难的题都会解，但人数很少。", accent: C.amber },
          { from: 232, to: 355, text: "GPU像{{上万名小学生}}：只会简单算术，但能同时开工。" },
          { from: 362, to: 480, text: "画一帧游戏画面，要算{{几百万个像素}}——" },
          { from: 484, to: 600, text: "教授们一行一行地算，小学生们{{一齐落笔}}。" },
          { from: 612, to: 770, text: "AI的核心运算——{{矩阵乘法}}，也是海量的简单乘加。" },
          { from: 776, to: DUR - 12, text: "于是，游戏显卡意外成了{{AI的发动机}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};
