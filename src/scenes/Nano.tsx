import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, prog, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("nano");
const ATOMS = cue("nano", "atoms");

const UM = 1e-6;
const NM = 1e-9;

// [frame, field-of-view width in metres] — log-interpolated with smoothstep.
const KEYS: [number, number][] = [
  [0, 2.6e-4],
  [130, 1.8e-4],
  [190, 3.0e-5],
  [290, 2.3e-5],
  [330, 4.6e-6],
  [380, 3.4e-6],
  [430, 3.6e-7],
  [ATOMS - 10, 3.0e-7],
  [ATOMS + 50, 3.0e-8],
  [DUR, 2.4e-8],
];

export const viewAt = (f: number) => {
  for (let i = 1; i < KEYS.length; i++) {
    const [f0, v0] = KEYS[i - 1];
    const [f1, v1] = KEYS[i];
    if (f <= f1) {
      const t = ease.inOutCubic(clamp((f - f0) / (f1 - f0)));
      return Math.exp(lerp(Math.log(v0), Math.log(v1), t));
    }
  }
  return KEYS[KEYS.length - 1][1];
};

/** Visibility by apparent size (fraction of screen width): fade in when it appears, out when it overfills. */
const vis = (sizeM: number, view: number, lo = 0.04, hi = 4) => {
  const s = sizeM / view;
  return clamp((s - lo) / lo) * clamp((hi - s) / (hi * 0.4));
};

const label = (ctx: CanvasRenderingContext2D, x: number, y: number, t: string, sub: string, col: string, a: number) => {
  if (a <= 0.02) return;
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.font = `900 34px ${FONT_CN}`;
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 12;
  ctx.fillText(t, x, y);
  ctx.font = `800 22px ${FONT_MONO}`;
  ctx.fillStyle = col;
  ctx.fillText(sub, x, y + 30);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

const Scene: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const view = viewAt(f);
      const ppm = w / view; // pixels per metre
      const cx = w / 2;
      const cy = h / 2 - 30;
      const X = (m: number) => cx + m * ppm;
      const Y = (m: number) => cy + m * ppm;
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.75);
      bg.addColorStop(0, "#0a1420");
      bg.addColorStop(1, "#020409");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // 1. hair (80 µm)
      const hv = vis(80 * UM, view, 0.05, 3);
      if (hv > 0) {
        ctx.save();
        ctx.globalAlpha = hv;
        ctx.translate(cx, cy);
        ctx.rotate(-0.35);
        const r = 40 * UM * ppm;
        const g = ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, "#1c120c");
        g.addColorStop(0.3, "#6b4a33");
        g.addColorStop(0.5, "#a07656");
        g.addColorStop(0.75, "#5a3d2a");
        g.addColorStop(1, "#140c08");
        ctx.fillStyle = g;
        ctx.fillRect(-3000, -r, 6000, 2 * r);
        // cuticle scales
        ctx.strokeStyle = "rgba(255,220,180,0.25)";
        ctx.lineWidth = Math.max(1, 0.4 * UM * ppm);
        const step = 7 * UM * ppm;
        const off = (f * 0.4) % step;
        for (let x = -3000 - off; x < 3000; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, -r);
          ctx.bezierCurveTo(x + step * 0.5, -r * 0.4, x + step * 0.5, r * 0.4, x, r);
          ctx.stroke();
        }
        ctx.restore();
        label(ctx, cx - 520, cy - 300, "人类头发", "≈ 80 µm", C.amber, hv * clamp(1 - (80 * UM) / view / 1.2) * 2);
      }

      // 2. 1971 transistor (≈10 µm layout) and a red blood cell (7.5 µm)
      const tv = vis(10 * UM, view, 0.05, 3);
      if (tv > 0) {
        ctx.save();
        ctx.globalAlpha = tv;
        const ox = -7.5 * UM;
        const s = UM * ppm;
        // diffusion
        ctx.fillStyle = "#3e8a4f";
        ctx.fillRect(X(ox - 5 * UM), Y(-3 * UM), 10 * s, 6 * s);
        // poly gate
        ctx.fillStyle = "#c8423a";
        ctx.fillRect(X(ox - 1.2 * UM), Y(-5 * UM), 2.4 * s, 10 * s);
        // metal + contacts
        ctx.fillStyle = "rgba(170,180,210,0.75)";
        ctx.fillRect(X(ox - 4.6 * UM), Y(-5.5 * UM), 2.6 * s, 11 * s);
        ctx.fillRect(X(ox + 2 * UM), Y(-5.5 * UM), 2.6 * s, 11 * s);
        ctx.fillStyle = "#1a1a24";
        for (const dx of [-3.3, 3.3]) for (const dy of [-1.5, 1.5]) ctx.fillRect(X(ox + (dx - 0.5) * UM), Y((dy - 0.5) * UM), s, s);
        ctx.restore();
        label(ctx, X(ox), Math.max(84, Y(-6.4 * UM) - 34), "1971年的晶体管", "≈ 10 µm", C.green, tv);
        // red blood cell
        const rx = X(7.5 * UM);
        const ry = Y(0);
        const rr = 3.75 * UM * ppm;
        ctx.save();
        ctx.globalAlpha = tv;
        const rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
        rg.addColorStop(0, "#7a0f18");
        rg.addColorStop(0.45, "#a3121f");
        rg.addColorStop(0.8, "#e0303a");
        rg.addColorStop(1, "#5a0a10");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(rx, ry, rr, 0, TAU);
        ctx.fill();
        ctx.restore();
        label(ctx, rx, Math.max(84, ry - rr - 46), "红细胞", "≈ 7.5 µm", "#ff6b6b", tv);
      }

      // 3. bacterium (2 µm rod)
      const bv = vis(2 * UM, view, 0.05, 2.5);
      if (bv > 0) {
        const s = UM * ppm;
        ctx.save();
        ctx.globalAlpha = bv;
        ctx.translate(cx, cy);
        ctx.rotate(0.25);
        ctx.strokeStyle = "rgba(160,255,190,0.35)";
        ctx.lineWidth = Math.max(1, 0.03 * s);
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const x = -1 * s - t * 2.4 * s;
            const y = (k - 2) * 0.12 * s + Math.sin(t * 12 + f * 0.25 + k) * 0.1 * s;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        const bg2 = ctx.createLinearGradient(0, -0.25 * s, 0, 0.25 * s);
        bg2.addColorStop(0, "#1f7a4a");
        bg2.addColorStop(0.5, "#5fe39a");
        bg2.addColorStop(1, "#14593a");
        ctx.fillStyle = bg2;
        ctx.beginPath();
        ctx.roundRect(-1 * s, -0.25 * s, 2 * s, 0.5 * s, 0.25 * s);
        ctx.fill();
        ctx.restore();
        label(ctx, cx, Math.max(84, cy - 0.6 * s - 34), "细菌", "≈ 2 µm", C.green, bv * clamp((2 * UM) / view / 0.15 - 0.5) * clamp((1.1 - (2 * UM) / view) / 0.3));
      }

      // 4. modern transistors (fins × gates) beside a virus (100 nm)
      const atomIn = clamp((f - ATOMS) / 40) * clamp((0.235 * NM * ppm - 4) / 6);
      const mv = vis(200 * NM, view, 0.05, 30) * (1 - 0.85 * atomIn);
      if (mv > 0) {
        const s = NM * ppm;
        ctx.save();
        ctx.globalAlpha = mv;
        // fins
        for (let k = -2; k <= 2; k++) {
          const y = k * 30 * NM;
          const g = ctx.createLinearGradient(0, Y(y - 3 * NM), 0, Y(y + 3 * NM));
          g.addColorStop(0, "#1b4f7a");
          g.addColorStop(0.5, "#56b8ff");
          g.addColorStop(1, "#1b4f7a");
          ctx.fillStyle = g;
          ctx.fillRect(X(-165 * NM), Y(y - 3 * NM), 190 * s, 6 * s);
        }
        // gates
        for (let j = -3; j <= 0; j++) {
          const x = j * 48 * NM;
          ctx.fillStyle = "rgba(210,215,230,0.55)";
          ctx.fillRect(X(x - 8 * NM), Y(-75 * NM), 16 * s, 150 * s);
        }
        ctx.globalCompositeOperation = "lighter";
        const near = clamp(3 - (200 * NM) / view);
        for (let k = -2; k <= 2; k++)
          for (let j = -3; j <= 0; j++) {
            const on = hash(k * 7 + j * 13 + Math.floor(f / 6)) > 0.4;
            if (on) glow(ctx, X(j * 48 * NM), Y(k * 30 * NM), 14 * s, C.cyan, 0.7 * near);
          }
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
        const lv = mv * clamp(1.2 - (200 * NM) / view) * clamp(((200 * NM) / view - 0.2) / 0.12);
        label(ctx, X(-70 * NM), 120, "今天的晶体管", "栅极间距 ≈ 48 nm", C.cyan, lv);
        // virus
        const vx = X(110 * NM);
        const vy = Y(10 * NM);
        const vr = 50 * NM * ppm;
        ctx.save();
        ctx.globalAlpha = mv;
        ctx.strokeStyle = "#ff7a9a";
        ctx.lineWidth = Math.max(1, 3 * s);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * TAU + f * 0.003;
          ctx.beginPath();
          ctx.moveTo(vx + Math.cos(a) * vr, vy + Math.sin(a) * vr);
          ctx.lineTo(vx + Math.cos(a) * vr * 1.22, vy + Math.sin(a) * vr * 1.22);
          ctx.stroke();
          ctx.fillStyle = "#ff9ab4";
          ctx.beginPath();
          ctx.arc(vx + Math.cos(a) * vr * 1.25, vy + Math.sin(a) * vr * 1.25, 5 * s, 0, TAU);
          ctx.fill();
        }
        const vg = ctx.createRadialGradient(vx - vr * 0.3, vy - vr * 0.3, 0, vx, vy, vr);
        vg.addColorStop(0, "#ffb3c6");
        vg.addColorStop(0.7, "#c2365f");
        vg.addColorStop(1, "#6b1030");
        ctx.fillStyle = vg;
        ctx.beginPath();
        ctx.arc(vx, vy, vr, 0, TAU);
        ctx.fill();
        ctx.restore();
        label(ctx, vx, 120, "病毒", "≈ 100 nm", "#ff7a9a", lv);
      }

      // 5. silicon atoms inside one fin
      const d = 0.235 * NM;
      const spacing = d * ppm;
      const av = clamp((f - ATOMS) / 40) * clamp((spacing - 4) / 6);
      if (av > 0) {
        const s = NM * ppm;
        const outer = clamp((spacing - 14) / 10);
        ctx.globalCompositeOperation = "lighter";
        const half = (view / 2) * 1.1;
        const yr = outer > 0 ? half * 0.6 : 3 * NM;
        for (let y = -yr; y < yr; y += d * 0.87) {
          const row = Math.round(y / (d * 0.87));
          const inFin = Math.abs(y) < 3 * NM;
          if (!inFin && outer <= 0) continue;
          for (let x = -half; x < half; x += d) {
            const xx = x + (row % 2 ? d / 2 : 0);
            const under = Math.abs(xx) < 8 * NM;
            const col = inFin ? C.cyan : under ? "#c9d2e6" : "#3d5a80";
            const a = av * (inFin ? 0.95 : 0.35 * outer) * (0.8 + 0.2 * Math.sin(f * 0.2 + xx * 4e9 + y * 3e9));
            glow(ctx, X(xx), Y(y), (inFin ? 0.14 : 0.1) * s, col, a, 0.3);
          }
        }
        ctx.globalCompositeOperation = "source-over";
        // bracket: fin width
        const a2 = clamp((f - ATOMS - 50) / 20);
        if (a2 > 0) {
          ctx.globalAlpha = a2;
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 3;
          const bx = X(4.6 * NM);
          ctx.beginPath();
          ctx.moveTo(bx - 14, Y(-3 * NM));
          ctx.lineTo(bx, Y(-3 * NM));
          ctx.lineTo(bx, Y(3 * NM));
          ctx.lineTo(bx - 14, Y(3 * NM));
          ctx.stroke();
          ctx.textAlign = "left";
          ctx.font = `900 50px ${FONT_CN}`;
          ctx.fillStyle = "#fff";
          ctx.shadowColor = "#000";
          ctx.shadowBlur = 14;
          ctx.fillText("≈ 6 纳米", bx + 22, Y(0) - 8);
          ctx.font = `700 32px ${FONT_CN}`;
          ctx.fillStyle = C.cyan;
          ctx.fillText("约 25 个硅原子", bx + 22, Y(0) + 36);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
    }}
  />
);

const NICE = [1, 2, 5];
const ScaleBar: React.FC = () => {
  const frame = useCurrentFrame();
  const view = viewAt(frame);
  const ppm = 1920 / view;
  let best = 1e-9;
  for (let e = -10; e <= -3; e++)
    for (const n of NICE) {
      const v = n * Math.pow(10, e);
      if (v * ppm >= 160 && v * ppm <= 420) best = v;
    }
  const px = best * ppm;
  const lab = best >= 1e-6 ? `${Math.round(best / 1e-6)} 微米` : `${Math.round(best / 1e-9)} 纳米`;
  const mag = (2.6e-4 / view);
  return (
    <>
      <div style={{ position: "absolute", left: 110, bottom: 220, textAlign: "left" }}>
        <div style={{ width: px, height: 12, borderLeft: "3px solid #fff", borderRight: "3px solid #fff", borderBottom: "3px solid #fff" }} />
        <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff", marginTop: 8, textShadow: "0 0 8px #000, 0 0 18px #000" }}>{lab}</div>
      </div>
      <div style={{ position: "absolute", right: 110, bottom: 210, textAlign: "right", fontFamily: FONT_MONO, textShadow: "0 0 10px #000, 0 0 24px #000" }}>
        <div style={{ fontSize: 22, letterSpacing: "0.3em", color: C.ice }}>MAGNIFICATION</div>
        <div style={{ fontSize: 56, fontWeight: 800, color: "#fff", textShadow: `0 0 18px ${C.cyan}, 0 0 12px #000` }}>×{Math.round(mag).toLocaleString("en-US")}</div>
      </div>
    </>
  );
};

export const Nano: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = prog(frame, 0, 15);
  const out = prog(frame, DUR - 18, DUR);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <Scene />
      <ScaleBar />
      <Captions
        accent={C.cyan}
        items={[
          { from: 10, to: 178, text: "晶体管能做多小？从一根{{头发丝}}开始放大——" },
          { from: 184, to: 322, text: "1971年的晶体管约{{10微米}}，和红细胞差不多大。" },
          { from: 436, to: 520, text: "今天的晶体管只有{{几十纳米}}，比病毒还小。" },
          { from: 524, to: 600, text: "一根头发丝的宽度，能并排放下{{上千个}}。" },
          { from: 606, to: DUR - 6, text: "最窄处，只有{{几十个原子}}宽。" },
        ]}
      />
    </AbsoluteFill>
  );
};

