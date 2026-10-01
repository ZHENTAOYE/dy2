import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { ease, hash, lerp, prog, shake } from "../lib/math";
import { Captions } from "../components/Caption";
import { Flash } from "../components/Hud";
import { countAt } from "../data";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("curve");
const DRAW = cue("curve", "draw");
const SPIKE = cue("curve", "spike");
const MORPH = cue("curve", "morph");
const LINE = cue("curve", "line");

const L = 250;
const R = 1690;
const T = 150;
const B = 730;
const Y0 = 1971;
const Y1 = 2024;
const LIN_MAX = 1e11; // the last years blow straight through the top of the chart
const LOG_MIN = 3;
const LOG_MAX = 12;

const xOf = (year: number) => L + ((year - Y0) / (Y1 - Y0)) * (R - L);
const yLin = (v: number) => B - (v / LIN_MAX) * (B - T);
const yLog = (v: number) => B - ((Math.log10(v) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (B - T);

const morphAt = (f: number) => ease.inOutCubic(prog(f, MORPH, MORPH + 80));
/** Year the pen has reached; slow through the flat decades, then whips up. */
const penAt = (f: number) => lerp(Y0, Y1, ease.inOutQuad(prog(f, DRAW, SPIKE + 6)));

const Chart: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
      g.addColorStop(0, "#03140f");
      g.addColorStop(1, "#010304");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const m = morphAt(f);
      const yOf = (v: number) => lerp(yLin(v), yLog(v), m);
      const axisA = ease.outCubic(prog(f, 0, 25));
      // gridlines: linear ticks fade out, log decades fade in
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = (LIN_MAX / 4) * i;
        const y = yLin(v);
        ctx.strokeStyle = withAlpha("#ffffff", 0.08 * axisA * (1 - m));
        ctx.beginPath();
        ctx.moveTo(L, y);
        ctx.lineTo(R, y);
        ctx.stroke();
      }
      for (let d = LOG_MIN; d <= LOG_MAX; d++) {
        const y = yLog(Math.pow(10, d));
        ctx.strokeStyle = withAlpha(C.green, 0.12 * m);
        ctx.beginPath();
        ctx.moveTo(L, y);
        ctx.lineTo(R, y);
        ctx.stroke();
      }
      for (let yr = 1975; yr <= 2020; yr += 5) {
        const x = xOf(yr);
        ctx.strokeStyle = withAlpha("#ffffff", 0.05 * axisA);
        ctx.beginPath();
        ctx.moveTo(x, T);
        ctx.lineTo(x, B);
        ctx.stroke();
      }
      ctx.strokeStyle = withAlpha("#ffffff", 0.6 * axisA);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L, T - 20);
      ctx.lineTo(L, B);
      ctx.lineTo(R + 20, B);
      ctx.stroke();
      // curve
      const pen = penAt(f);
      if (f < DRAW) return;
      const pts: [number, number][] = [];
      for (let yr = Y0; yr <= pen + 1e-6; yr += 0.1) pts.push([xOf(yr), yOf(countAt(yr))]);
      pts.push([xOf(pen), yOf(countAt(pen))]);
      // area fill
      const fillG = ctx.createLinearGradient(0, T, 0, B);
      fillG.addColorStop(0, withAlpha(C.green, 0.28));
      fillG.addColorStop(1, withAlpha(C.green, 0.02));
      ctx.fillStyle = fillG;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], B);
      pts.forEach(([x, y]) => ctx.lineTo(x, Math.max(-200, y)));
      ctx.lineTo(pts[pts.length - 1][0], B);
      ctx.closePath();
      ctx.fill();
      // ghost of the linear curve after the morph
      if (m > 0) {
        ctx.setLineDash([8, 10]);
        ctx.strokeStyle = withAlpha("#ffffff", 0.25 * m);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let yr = Y0; yr <= Y1; yr += 0.1) {
          const x = xOf(yr);
          const y = Math.max(-50, yLin(countAt(yr)));
          if (yr === Y0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalCompositeOperation = "lighter";
      const col = mix(C.green, C.cyan, m);
      glowStroke(
        ctx,
        () => pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, Math.max(-200, y)) : ctx.moveTo(x, y))),
        col,
        4,
        1,
      );
      // pen head
      const [hx, hy] = pts[pts.length - 1];
      if (hy > -100) {
        glow(ctx, hx, hy, 60, col, 0.9);
        glow(ctx, hx, hy, 16, C.white, 1);
      }
      // the spike: burst where the curve leaves the chart
      const st = f - SPIKE;
      if (st > 0 && st < 70 && m < 0.5) {
        const ex = xOf(2021.7);
        for (let i = 0; i < 160; i++) {
          const a = -Math.PI / 2 + (hash(i * 1.3) - 0.5) * 2.4;
          const v = 4 + hash(i * 2.7) * 22;
          const x = ex + Math.cos(a) * v * st;
          const y = T - 10 + Math.sin(a) * v * st * 0.6 + 0.08 * st * st;
          glow(ctx, x, y, 3 + 5 * hash(i), i % 2 ? C.green : C.white, 1 - st / 70);
        }
      }
      // doubling beats marching along the straightened line
      if (f > LINE) {
        const lt = f - LINE;
        for (let yr = Y0; yr <= Y1; yr += 2) {
          const x = xOf(yr);
          const y = yOf(countAt(yr));
          const k = (yr - Y0) / 2;
          const hit = Math.exp(-Math.pow((lt * 0.55 - k) / 1.2, 2));
          glow(ctx, x, y, 10 + 40 * hit, C.cyan, 0.4 + 0.6 * hit);
        }
      }
    }}
  />
);

const Labels: React.FC = () => {
  const frame = useCurrentFrame();
  const m = morphAt(frame);
  const a = ease.outCubic(prog(frame, 0, 25));
  const linTicks = ["0", "250亿", "500亿", "750亿", "1000亿"];
  const logTicks = ["1千", "1万", "10万", "100万", "1000万", "1亿", "10亿", "100亿", "1000亿", "1万亿"];
  const flat = ease.outCubic(prog(frame, SPIKE - 50, SPIKE - 30)) * (1 - prog(frame, MORPH - 10, MORPH + 10));
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {linTicks.map((t, i) => (
        <div key={t} style={{ position: "absolute", right: 1920 - L + 18, top: yLin((LIN_MAX / 4) * i) - 16, fontFamily: FONT_CN, fontSize: 24, color: "rgba(255,255,255,0.6)", opacity: 1 - m }}>
          {t}
        </div>
      ))}
      {logTicks.map((t, i) => (
        <div key={t} style={{ position: "absolute", right: 1920 - L + 18, top: yLog(Math.pow(10, LOG_MIN + i)) - 16, fontFamily: FONT_CN, fontSize: 24, color: C.green, opacity: m }}>
          {t}
        </div>
      ))}
      {[1971, 1980, 1990, 2000, 2010, 2024].map((y) => (
        <div key={y} style={{ position: "absolute", left: xOf(y) - 40, width: 80, textAlign: "center", top: B + 14, fontFamily: FONT_MONO, fontSize: 24, color: "rgba(255,255,255,0.65)" }}>
          {y}
        </div>
      ))}
      <div style={{ position: "absolute", left: L, top: 66, fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff" }}>
        芯片上的晶体管数量 ·{" "}
        <span style={{ color: m < 0.5 ? "#fff" : C.green, textShadow: m > 0.5 ? `0 0 14px ${C.green}` : "none" }}>{m < 0.5 ? "普通（线性）坐标" : "对数坐标：每格 ×10"}</span>
      </div>
      {/* annotation of the deceptively flat decades */}
      <div style={{ position: "absolute", left: xOf(1972), width: xOf(2010) - xOf(1972), top: B - 120, opacity: flat, textAlign: "center" }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff", textShadow: "0 0 10px #000" }}>40年：看起来几乎没动</div>
        <div style={{ height: 16, marginTop: 10, borderLeft: "2px solid #fff", borderRight: "2px solid #fff", borderTop: "2px solid #fff", opacity: 0.7 }} />
      </div>
    </AbsoluteFill>
  );
};

export const Curve: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, SPIKE, 26, 24);
  const out = prog(frame, DUR - 20, DUR);
  const inA = prog(frame, 0, 15);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
        <Chart />
        <Labels />
      </AbsoluteFill>
      <Flash at={SPIKE} dur={12} color={C.green} peak={0.35} />
      <Captions
        accent={C.green}
        items={[
          { from: 14, to: 128, text: "把它画在普通坐标上——" },
          { from: 132, to: 322, text: "前40年几乎{{贴着地面}}，最近几年却{{突然冲天}}。" },
          { from: 330, to: 470, text: "换成对数坐标，每往上一格就是{{×10}}，" },
          { from: 474, to: 590, text: "它其实是一条{{笔直的线}}：半个世纪，从未停止翻倍。" },
          { from: 594, to: DUR - 8, text: "所谓“突然”，是{{指数增长}}给人的错觉。" },
        ]}
      />
    </AbsoluteFill>
  );
};
