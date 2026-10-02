import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, prog, shake, TAU } from "../lib/math";
import { Flash } from "../components/Hud";
import { GradientText } from "../components/GradientText";
import { cue, sceneDuration } from "../timeline";

const RISER = cue("title", "riser");
const SLAM = cue("title", "slam");
const DUR = sceneDuration("title");
// post-slam reveal, relative to SLAM: subtitle, then the timeline bar with its milestones popping in
const SUB_IN = 20;
const SUB_END = 44;
// the bar starts one step before milestone 0 and runs 8 steps, so its eased midpoint (50 %) lands on milestone 3
const LINE_IN = 35;
const LINE_END = 75;
const MS_IN = 40;
const MS_STEP = 5;
const MS_DUR = 16;
const FADE_OUT = 20;

const MILESTONES = [
  ["1946", "真空管", C.amber],
  ["1947", "晶体管", C.cyan],
  ["1958", "集成电路", C.cyan],
  ["1971", "微处理器", C.green],
  ["2005", "多核", C.blue],
  ["2012", "深度学习", C.violet],
  ["2022", "大模型", C.magenta],
] as const;

const Burst: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const cx = w / 2;
      const cy = h / 2 - 40;
      const t = f - SLAM;
      // pre-slam: particles sucked toward the centre
      ctx.globalCompositeOperation = "lighter";
      if (t < 0) {
        const k = clamp((f - RISER) / (SLAM - RISER));
        for (let i = 0; i < 500; i++) {
          const a = hash(i * 1.7) * TAU;
          const r0 = 300 + hash(i * 3.1) * 1100;
          const sp = 0.4 + hash(i * 5.3) * 0.6;
          const r = r0 * Math.pow(1 - clamp(k * sp * 1.25), 1.6);
          const col = i % 2 ? C.amber : C.cyan;
          glow(ctx, cx + Math.cos(a + k * 2) * r, cy + Math.sin(a + k * 2) * r * 0.7, 3 + 4 * hash(i), col, 0.25 + 0.7 * k);
        }
        glow(ctx, cx, cy, 80 + 240 * Math.pow(k, 3), C.white, 0.6 * Math.pow(k, 2), 0.05);
        return;
      }
      // god rays
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.002);
      const rayA = 0.18 * Math.exp(-t / 70) + 0.05;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU + hash(i) * 0.1;
        const len = 1400;
        const wid = 0.012 + hash(i * 9) * 0.03;
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
        const col = mix(C.amber, C.magenta, hash(i * 2.2));
        g.addColorStop(0, withAlpha(col, rayA));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, len, a - wid, a + wid);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // shockwave rings
      for (let k = 0; k < 4; k++) {
        const tt = t - k * 5;
        if (tt < 0) continue;
        const r = 30 + tt * (26 - k * 3) * Math.exp(-tt / 90);
        const a = Math.exp(-tt / (18 + k * 6));
        ctx.strokeStyle = withAlpha(k % 2 ? C.cyan : C.amber, a * 0.8);
        ctx.lineWidth = 2 + 10 * a;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, TAU);
        ctx.stroke();
      }
      // sparks
      for (let i = 0; i < 900; i++) {
        const a = hash(i * 2.9) * TAU;
        const v = 6 + hash(i * 4.1) * 38;
        const drag = 0.035 + hash(i * 6.7) * 0.03;
        const d = (v / drag) * (1 - Math.exp(-drag * t));
        const x = cx + Math.cos(a) * d * 1.3;
        const y = cy + Math.sin(a) * d * 0.75 + t * t * 0.004 * hash(i);
        const life = Math.exp(-t / (30 + hash(i * 8.8) * 70));
        const col = i % 3 === 0 ? C.cyan : i % 3 === 1 ? C.amber : C.magenta;
        glow(ctx, x, y, 2 + 6 * hash(i * 1.1) * life + 2, col, life);
      }
      // anamorphic streak
      const sa = Math.exp(-t / 25);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, withAlpha(C.cyan, 0));
      g.addColorStop(0.5, withAlpha("#ffffff", 0.9 * sa));
      g.addColorStop(1, withAlpha(C.cyan, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, cy - 3 - 6 * sa, w, 6 + 12 * sa);
      glow(ctx, cx, cy, 500 * sa + 120, C.amber, 0.5 * sa + 0.08, 0.04);
    }}
  />
);

const TitleText: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - SLAM;
  if (t < 0) return null;
  const e = ease.outExpo(clamp(t / 24));
  const sc = 1.6 - 0.6 * e + 0.03 * prog(frame, SLAM, DUR);
  const ab = 26 * Math.exp(-t / 8);
  const sub = ease.outCubic(prog(frame, SLAM + SUB_IN, SLAM + SUB_END));
  const out = prog(frame, DUR - FADE_OUT, DUR);
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: FONT_CN,
    fontWeight: 900,
    fontSize: 168,
    letterSpacing: "0.06em",
  };
  const words = (
    <>
      从真空管到<span style={{ fontFamily: FONT_MONO, letterSpacing: 0 }}>AI</span>
    </>
  );
  return (
    <AbsoluteFill style={{ opacity: 1 - out, filter: out > 0 ? `blur(${out * 12}px)` : undefined }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(-70px) scale(${sc})` }}>
        <div style={{ ...base, color: C.red, transform: `translateX(${-ab}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{words}</div>
        <div style={{ ...base, color: C.cyan, transform: `translateX(${ab}px)`, mixBlendMode: "screen", opacity: 0.8 }}>{words}</div>
        <div
          style={{
            ...base,
            color: "#fff",
            textShadow: `0 0 30px ${C.amber}, 0 0 80px rgba(255,120,40,0.6)`,
          }}
        >
          从真空管到
          <GradientText
            id="title-ai"
            text="AI"
            font={{ fontFamily: FONT_MONO, fontWeight: 900, fontSize: 168, letterSpacing: 0 }}
            layers={[{ angle: 100, stops: [[0, C.gold], [0.5, C.magenta], [1, C.cyan]], filter: `drop-shadow(0 0 22px ${C.magenta})` }]}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 600,
          textAlign: "center",
          fontFamily: FONT_CN,
          fontWeight: 700,
          fontSize: 54,
          letterSpacing: `${0.3 - 0.18 * sub}em`,
          color: "#fff",
          opacity: sub,
          textShadow: "0 0 18px rgba(56,214,255,0.8), 0 2px 8px #000",
        }}
      >
        计算机为什么突然变得这么强？
      </div>
      <div style={{ position: "absolute", left: 210, right: 210, top: 790, height: 120 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 20,
            height: 2,
            width: `${100 * ease.inOutCubic(prog(frame, SLAM + LINE_IN, SLAM + LINE_END))}%`,
            background: `linear-gradient(90deg, ${C.amber}, ${C.cyan} 40%, ${C.violet} 75%, ${C.magenta})`,
            boxShadow: `0 0 12px ${C.cyan}`,
          }}
        />
        {MILESTONES.map(([y, label, col], i) => {
          const x = (i / (MILESTONES.length - 1)) * 100;
          const a0 = SLAM + MS_IN + i * MS_STEP;
          const a = ease.outBack(prog(frame, a0, a0 + MS_DUR));
          return (
            <div key={y} style={{ position: "absolute", left: `${x}%`, top: 0, transform: `translateX(-50%)`, textAlign: "center", opacity: clamp(a) }}>
              <div style={{ width: 14, height: 14, margin: "13px auto 0", borderRadius: 7, background: col, boxShadow: `0 0 14px ${col}`, transform: `scale(${a})` }} />
              <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: "#fff", marginTop: 12 }}>{y}</div>
              <div style={{ fontFamily: FONT_CN, fontWeight: 400, fontSize: 22, color: col, marginTop: 2, whiteSpace: "nowrap" }}>{label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, SLAM, 34, 26);
  const q = Math.min(ease.outCubic(prog(frame, 0, 18)), 1 - prog(frame, SLAM - 10, SLAM - 1));
  const qs = 1 + 0.08 * prog(frame, 0, SLAM);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}rad)` }}>
        <Burst />
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: q }}>
          <div
            style={{
              fontFamily: FONT_CN,
              fontWeight: 700,
              fontSize: 72,
              color: "#fff",
              letterSpacing: "0.12em",
              transform: `scale(${qs})`,
              textShadow: "0 0 24px rgba(255,255,255,0.35)",
              marginTop: -80,
            }}
          >
            短短<span style={{ color: C.gold, fontWeight: 900, textShadow: `0 0 24px ${C.gold}` }}>80</span>年，到底发生了什么？
          </div>
        </AbsoluteFill>
        <TitleText />
      </AbsoluteFill>
      <Flash at={SLAM} dur={18} peak={1} />
    </AbsoluteFill>
  );
};
