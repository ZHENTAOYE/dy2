import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, prog } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { ChapterCard, YearStamp } from "../components/Hud";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("transistor");
const APPEAR = cue("transistor", "appear");
const GATE = cue("transistor", "gate");
const SHRINK = cue("transistor", "shrink");
/** Device slides right and the vacuum-tube comparison fades in (with its caption). */
const COMPARE = GATE + 116;
/** Device has collapsed to a point; from here the dot multiplies into a grid. */
const COLLAPSE = SHRINK + 54;

const gateOn = (f: number) => {
  if (f < GATE) return 0;
  const t = f - GATE;
  // on, then a few clean toggles while the caption explains it (last toggle at GATE+100, then steady)
  const pattern = [1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1];
  return pattern[Math.min(pattern.length - 1, Math.floor(t / 10))];
};

// Diamond-cubic silicon lattice (the crystal transistors are carved from).
const LATTICE = (() => {
  const base = [
    [0, 0, 0],
    [0, 2, 2],
    [2, 0, 2],
    [2, 2, 0],
    [3, 3, 3],
    [3, 1, 1],
    [1, 3, 1],
    [1, 1, 3],
  ];
  const pts: [number, number, number][] = [];
  const N = 3;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      for (let k = 0; k < N; k++)
        for (const b of base) pts.push([(i * 4 + b[0]) / 4 - N / 2, (j * 4 + b[1]) / 4 - N / 2, (k * 4 + b[2]) / 4 - N / 2]);
  const bonds: [number, number][] = [];
  for (let a = 0; a < pts.length; a++)
    for (let b = a + 1; b < pts.length; b++) {
      const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1], pts[a][2] - pts[b][2]);
      if (Math.abs(d - Math.sqrt(3) / 4) < 0.01) bonds.push([a, b]);
    }
  return { pts, bonds };
})();

const Lattice: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
      g.addColorStop(0, "#04121f");
      g.addColorStop(1, "#010308");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const a = f * 0.004;
      const cam = camera({ z: -4.2, f: 900 });
      const rot = (p: [number, number, number]) => {
        const [x, y, z] = p;
        const x1 = x * Math.cos(a) - z * Math.sin(a);
        const z1 = x * Math.sin(a) + z * Math.cos(a);
        const b = 0.5 + Math.sin(f * 0.003) * 0.2;
        const y1 = y * Math.cos(b) - z1 * Math.sin(b);
        const z2 = y * Math.sin(b) + z1 * Math.cos(b);
        return project(cam, x1 * 1.3, y1 * 1.3, z2 * 1.3);
      };
      const vis = clamp(f / 40) * (1 - 0.65 * ease.inOutCubic(prog(f, APPEAR - 16, APPEAR + 26))) * (1 - prog(f, SHRINK, SHRINK + 32));
      const P = LATTICE.pts.map(rot);
      ctx.lineWidth = 1.5;
      for (const [i, j] of LATTICE.bonds) {
        const p = P[i];
        const q = P[j];
        if (!p || !q) continue;
        const fog = clamp(1.4 - (p.z + q.z) / 2 / 5);
        ctx.strokeStyle = withAlpha(C.cyan, 0.35 * vis * fog);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "lighter";
      P.forEach((p, i) => {
        if (!p) return;
        const fog = clamp(1.4 - p.z / 5);
        glow(ctx, p.x, p.y, 0.05 * p.s, i % 9 === 0 ? C.ice : C.cyan, 0.8 * vis * fog);
      });
    }}
  />
);

/** Pseudo-3D MOSFET cross-section drawn around local origin (top-centre of the silicon block). */
const drawMosfet = (ctx: CanvasRenderingContext2D, f: number, appear: number) => {
  const on = gateOn(f);
  const onK = f >= GATE ? clamp(on ? 1 : 0) : 0;
  const DX = 120;
  const DY = -80;
  const A = (k: number) => clamp((appear - k) / 0.25);
  const face = (pts: number[][], fill: string | CanvasGradient, stroke?: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const box = (x0: number, x1: number, y0: number, y1: number, front: string, top: string, side: string, stroke: string, alpha = 1) => {
    face([[x0, y0], [x0 + DX, y0 + DY], [x1 + DX, y0 + DY], [x1, y0]], top, stroke, alpha);
    face([[x1, y0], [x1 + DX, y0 + DY], [x1 + DX, y1 + DY], [x1, y1]], side, stroke, alpha);
    face([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], front, stroke, alpha);
  };
  // substrate
  const a0 = A(0);
  const sub = ctx.createLinearGradient(0, 0, 0, 300);
  sub.addColorStop(0, "#22344a");
  sub.addColorStop(1, "#0b1420");
  box(-420, 420, 0, 280, sub as unknown as string, "#2c4562", "#16263a", withAlpha(C.ice, 0.4), a0);
  // source / drain wells (n+)
  const a1 = A(0.2);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -380 : 140;
    const x1 = sx < 0 ? -140 : 380;
    ctx.globalAlpha = a1;
    ctx.fillStyle = "#3a6fae";
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, 70);
    ctx.quadraticCurveTo(x0, 130, (x0 + x1) / 2, 130);
    ctx.quadraticCurveTo(x1, 130, x1, 70);
    ctx.lineTo(x1, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(C.ice, 0.6);
    ctx.stroke();
    face([[x0, 0], [x0 + DX, DY], [x1 + DX, DY], [x1, 0]], "#4b86c8", withAlpha(C.ice, 0.5), a1);
    ctx.globalAlpha = 1;
  }
  // free electrons jiggling inside the wells
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 60; i++) {
    const sx = i % 2 ? -1 : 1;
    const cx = sx < 0 ? -260 : 260;
    const x = cx + (hash(i * 1.3) - 0.5) * 200 + Math.sin(f * 0.2 + i) * 6;
    const y = 15 + hash(i * 2.7) * 90 + Math.cos(f * 0.17 + i * 2) * 5;
    glow(ctx, x, y, 7, C.cyan, 0.6 * a1);
  }
  // channel glow + flowing electrons
  if (onK > 0) {
    const cg = ctx.createLinearGradient(0, 0, 0, 34);
    cg.addColorStop(0, withAlpha(C.cyan, 0.85));
    cg.addColorStop(1, withAlpha(C.cyan, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(-140, 0, 280, 34);
    glow(ctx, 0, 10, 260, C.cyan, 0.35, 0.05);
    for (let i = 0; i < 70; i++) {
      const sp = 0.012 + hash(i * 4.1) * 0.01;
      const u = (hash(i * 9.7) + (f - GATE) * sp) % 1;
      const x = lerp(-300, 300, u);
      const y = 8 + hash(i * 5.5) * 20 + (Math.abs(x) > 140 ? (Math.abs(x) - 140) * 0.25 : 0);
      glow(ctx, x, y, 9, C.ice, 0.95);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // gate oxide + gate electrode
  const a2 = A(0.4);
  box(-135, 135, -12, 0, "#d8e6f2", "#eef6ff", "#b5c6d6", withAlpha("#ffffff", 0.6), a2);
  const gateCol = mix("#6c7684", "#9ff0ff", onK);
  box(-125, 125, -95, -12, gateCol, mix("#8b96a5", "#c8fbff", onK), mix("#4d5662", "#5fd8f0", onK), withAlpha(C.ice, 0.7), A(0.5));
  if (onK > 0) {
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, 0, -55, 220, C.cyan, 0.4, 0.05);
    ctx.globalCompositeOperation = "source-over";
  }
  // metal contacts
  const a3 = A(0.65);
  for (const [x, y0] of [
    [-260, 0],
    [0, -95],
    [260, 0],
  ] as const) {
    box(x - 28, x + 28, -190, y0, "#c9a45c", "#e8c77e", "#8c6f38", withAlpha(C.gold, 0.6), a3);
  }
  // labels
  ctx.globalAlpha = A(0.8);
  ctx.textAlign = "center";
  const lab = (x: number, t: string, s: string, col: string) => {
    ctx.font = `900 40px ${FONT_CN}`;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.fillText(t, x + DX / 2, -318);
    ctx.shadowBlur = 0;
    ctx.font = `800 22px ${FONT_MONO}`;
    ctx.fillStyle = col;
    ctx.fillText(s, x + DX / 2, -288);
  };
  lab(-260, "源极", "SOURCE", C.ice);
  lab(0, "栅极", "GATE", onK ? C.cyan : "#c9d3de");
  lab(260, "漏极", "DRAIN", C.ice);
  ctx.font = `700 26px ${FONT_CN}`;
  ctx.fillStyle = "rgba(200,225,255,0.65)";
  ctx.fillText("硅 Si", 0, 230);
  ctx.globalAlpha = 1;
};

const Device: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const appear = clamp((f - APPEAR) / 56);
      if (appear <= 0) return;
      // layout phases: centred → shifted right for comparison → collapse to a point
      const cmp = ease.inOutCubic(prog(f, COMPARE, COMPARE + 34));
      const shr = ease.inExpo(prog(f, SHRINK, COLLAPSE));
      const s = lerp(1, 0.62, cmp) * (1 - shr * 0.995);
      const x = lerp(w / 2 - 50, 1300, cmp) + (w / 2 - lerp(w / 2 - 50, 1300, cmp)) * ease.inOutCubic(prog(f, SHRINK - 26, SHRINK + 8));
      const y = lerp(560, 540, cmp);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      drawMosfet(ctx, f, appear);
      ctx.restore();
      if (f > SHRINK) {
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, w / 2, 540, 30 + 200 * shr, C.cyan, 0.9 * shr, 0.1);
        // the dot multiplies into a grid – the seed of the integrated circuit
        const split = prog(f, COLLAPSE, DUR);
        if (split > 0) {
          // 256 reached ~7 frames before the cut so the finished grid registers
          const n = Math.pow(2, Math.min(8, Math.floor(split * 9.4)));
          const cols = Math.ceil(Math.sqrt(n));
          const rows = Math.ceil(n / cols);
          const sp = lerp(160, 34, split);
          for (let i = 0; i < n; i++) {
            const cx = w / 2 + ((i % cols) - (cols - 1) / 2) * sp;
            const cy = 540 + (Math.floor(i / cols) - (rows - 1) / 2) * sp;
            glow(ctx, cx, cy, 16, C.cyan, 0.9);
          }
        }
      }
    }}
  />
);

const Compare: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, COMPARE + 8, COMPARE + 34)) * (1 - prog(frame, SHRINK - 18, SHRINK + 8));
  if (a <= 0) return null;
  const tags = (items: string[], col: string) => (
    <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 26 }}>
      {items.map((t) => (
        <div key={t} style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 26, color: col, border: `1.5px solid ${withAlpha(col, 0.6)}`, padding: "6px 16px", borderRadius: 6, background: withAlpha(col, 0.08) }}>
          {t}
        </div>
      ))}
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <g transform="translate(470 470)">
          <path d="M -90 230 L -90 -150 Q -90 -250 0 -255 Q 90 -250 90 -150 L 90 230 Z" fill="rgba(255,166,61,0.06)" stroke={C.amber} strokeWidth={3} />
          <rect x={-100} y={230} width={200} height={50} rx={10} fill="rgba(80,50,30,0.7)" stroke={C.amber} />
          <rect x={-8} y={-130} width={16} height={260} fill={C.amber} opacity={0.8} />
          <circle cx={0} cy={0} r={150} fill={C.ember} opacity={0.12} />
        </g>
        <g transform="translate(860 470)" stroke="#fff" strokeWidth={4} fill="none" opacity={0.85}>
          <line x1={-60} y1={0} x2={60} y2={0} />
          <polyline points="35,-22 60,0 35,22" />
        </g>
      </svg>
      <div style={{ position: "absolute", left: 270, top: 790, width: 400, textAlign: "center" }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 40, color: C.amber }}>真空管</div>
        {tags(["灯丝发热", "体积大", "易烧坏"], C.amber)}
      </div>
      <div style={{ position: "absolute", left: 1090, top: 790, width: 560, textAlign: "center" }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 40, color: C.cyan }}>晶体管</div>
        {tags(["无需加热", "可以做得极小", "几乎不会坏"], C.cyan)}
      </div>
    </AbsoluteFill>
  );
};

export const Transistor: React.FC = () => {
  const frame = useCurrentFrame();
  // band off while the comparison caption sits low under the tags (back on once it has ended)
  // starts at COMPARE-4 (caption 3 has ended, band already at 0) so the band never pops on/off under caption 4
  const capsHidden = frame >= COMPARE - 4 && frame < SHRINK - 4;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Lattice />
      <Device />
      <Compare />
      <YearStamp year="1947" label="美国 · 贝尔实验室" from={70} to={COMPARE} color={C.cyan} />
      <ChapterCard index={2} title="硅的魔法" en="THE MAGIC OF SILICON" color={C.cyan} dur={75} />
      <Captions
        accent={C.cyan}
        band={!capsHidden}
        items={[
          { from: 74, to: 163, text: "1947年，贝尔实验室发明了{{晶体管}}。" },
          { from: 167, to: GATE - 4, text: "它同样是开关——但{{没有灯丝，没有真空}}，只是一小块硅。" },
          { from: GATE, to: COMPARE - 4, text: "给栅极加上电压，{{电子通道}}就会打开，电流流过。" },
          { from: COMPARE, to: SHRINK - 4, text: "它{{更小、更省电、更可靠}}，开关速度也快得多。", y: 1000 },
          { from: SHRINK, to: DUR - 8, text: "更重要的是——它可以{{越做越小}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};

