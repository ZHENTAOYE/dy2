import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, noise1, prog } from "../lib/math";
import { Captions } from "../components/Caption";
import { Callout, ChapterCard } from "../components/Hud";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("tube");
const HEAT = cue("tube", "heat");
const ON = cue("tube", "on");
const OFF = cue("tube", "off");
const TOGGLE = cue("tube", "toggle");
const DRAW0 = 70;

const CX = 700;
const TOP = 150;
const BOT = 800;
const BITS = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1];
const BIT_LEN = 9;

export const tubeState = (f: number) => {
  if (f < ON) return 0;
  if (f < OFF) return 1;
  if (f < TOGGLE) return 0;
  return BITS[Math.floor((f - TOGGLE) / BIT_LEN) % BITS.length];
};

const heatAt = (f: number) => ease.inOutCubic(prog(f, HEAT, HEAT + 50)) * (0.93 + 0.07 * noise1(f * 0.2));

const Blueprint: React.FC = () => (
  <Canvas
    draw={(ctx, w, h) => {
      const g = ctx.createRadialGradient(CX, 480, 0, CX, 480, 1300);
      g.addColorStop(0, "#1a0f06");
      g.addColorStop(0.5, "#0a0604");
      g.addColorStop(1, "#020103");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,166,61,0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,166,61,0.1)";
      for (let x = 0; x < w; x += 200) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 200) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
    }}
  />
);

/** The vacuum tube itself, drawn on with stroke animation. */
const TubeSvg: React.FC<{ frame: number }> = ({ frame }) => {
  const d = (a: number, b: number) => 1 - ease.inOutCubic(prog(frame, DRAW0 + a, DRAW0 + b));
  const fillA = ease.outCubic(prog(frame, DRAW0 + 40, DRAW0 + 70));
  const heat = heatAt(frame);
  const st = tubeState(frame);
  const neg = frame >= OFF && st === 0;
  const gridCol = neg ? C.red : "#b9c2cc";
  const cathodeCol = mix("#5a4a40", "#ffb060", heat);
  const glass = `M ${CX - 150} ${BOT - 30} L ${CX - 150} ${TOP + 120} Q ${CX - 150} ${TOP} ${CX} ${TOP - 10} Q ${CX + 150} ${TOP} ${CX + 150} ${TOP + 120} L ${CX + 150} ${BOT - 30} Z`;
  const gridY: number[] = [];
  for (let y = 312; y <= 632; y += 16) gridY.push(y);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="glassFill" x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.1} />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity={0.03} />
          <stop offset="0.8" stopColor="#ffffff" stopOpacity={0.02} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0.08} />
        </linearGradient>
        <linearGradient id="plate" x1="0" x2="1">
          <stop offset="0" stopColor="#2b2f36" />
          <stop offset="0.5" stopColor="#5b616b" />
          <stop offset="1" stopColor="#24272d" />
        </linearGradient>
        <linearGradient id="base" x1="0" x2="1">
          <stop offset="0" stopColor="#120c08" />
          <stop offset="0.4" stopColor="#3a2a1e" />
          <stop offset="1" stopColor="#0d0805" />
        </linearGradient>
        <linearGradient id="getter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c7ccd6" stopOpacity={0.55} />
          <stop offset="1" stopColor="#c7ccd6" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* glass */}
      <path d={glass} fill="url(#glassFill)" opacity={fillA} />
      <path d={`M ${CX - 140} ${TOP + 110} Q ${CX - 138} ${TOP + 6} ${CX} ${TOP - 2} Q ${CX + 138} ${TOP + 6} ${CX + 140} ${TOP + 110} Z`} fill="url(#getter)" opacity={fillA * 0.8} />
      <path d={glass} fill="none" stroke="rgba(230,240,255,0.75)" strokeWidth={2.5} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(0, 40)} />
      <path d={`M ${CX - 128} ${TOP + 140} L ${CX - 128} ${BOT - 80}`} stroke="rgba(255,255,255,0.35)" strokeWidth={6} strokeLinecap="round" opacity={fillA} />
      <path d={`M ${CX + 132} ${TOP + 160} L ${CX + 132} ${TOP + 260}`} stroke="rgba(255,255,255,0.18)" strokeWidth={4} strokeLinecap="round" opacity={fillA} />
      {/* mica spacers */}
      {[290, 652].map((y) => (
        <rect key={y} x={CX - 115} y={y} width={230} height={8} rx={2} fill="rgba(220,200,170,0.35)" opacity={fillA} stroke="rgba(255,230,200,0.6)" strokeWidth={1} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(10, 40)} />
      ))}
      {/* plates (anode) */}
      {[-1, 1].map((s) => (
        <g key={s}>
          <rect x={s < 0 ? CX - 98 : CX + 72} y={300} width={26} height={350} fill="url(#plate)" opacity={fillA} />
          <rect x={s < 0 ? CX - 98 : CX + 72} y={300} width={26} height={350} fill="none" stroke="#9aa3ad" strokeWidth={1.5} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(14, 48)} />
        </g>
      ))}
      {/* grid: support rods + windings */}
      {[-1, 1].map((s) => (
        <line key={s} x1={CX + s * 42} y1={296} x2={CX + s * 42} y2={650} stroke={gridCol} strokeWidth={2} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(20, 50)} />
      ))}
      {gridY.map((y, i) => (
        <path
          key={y}
          d={`M ${CX - 42} ${y} Q ${CX} ${y + 6} ${CX + 42} ${y}`}
          stroke={gridCol}
          strokeWidth={1.4}
          fill="none"
          opacity={clamp((frame - DRAW0 - 26 - i * 1.2) / 8)}
          style={{ filter: neg ? `drop-shadow(0 0 4px ${C.red})` : undefined }}
        />
      ))}
      {/* cathode sleeve */}
      <rect x={CX - 8} y={300} width={16} height={350} rx={3} fill={cathodeCol} opacity={fillA} style={{ filter: heat > 0.05 ? `drop-shadow(0 0 ${10 * heat}px ${C.amber})` : undefined }} />
      <rect x={CX - 8} y={300} width={16} height={350} rx={3} fill="none" stroke="#d9c2a8" strokeWidth={1.2} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(24, 54)} />
      {/* leads */}
      {[-60, -24, 24, 60].map((x, i) => (
        <line key={x} x1={CX + x} y1={660} x2={CX + x * 1.4} y2={BOT - 30} stroke="#8d7a66" strokeWidth={2} pathLength={1} strokeDasharray="1 1" strokeDashoffset={d(30 + i * 2, 60)} />
      ))}
      {/* base + pins */}
      <rect x={CX - 160} y={BOT - 40} width={320} height={90} rx={14} fill="url(#base)" opacity={fillA} stroke="rgba(255,190,120,0.35)" />
      {[-110, -66, -22, 22, 66, 110].map((x) => (
        <rect key={x} x={CX + x - 4} y={BOT + 50} width={8} height={60} rx={3} fill="#b8a07c" opacity={fillA} />
      ))}
    </svg>
  );
};

const Electrons: React.FC = () => (
  <Canvas
    draw={(ctx, _w, _h, f) => {
      const heat = heatAt(f);
      ctx.globalCompositeOperation = "lighter";
      // filament / cathode glow and space-charge cloud
      if (heat > 0.01) {
        for (let y = 310; y <= 640; y += 22) glow(ctx, CX, y, 46 * heat, C.amber, 0.35 * heat, 0.1);
        glow(ctx, CX, 475, 260 * heat, C.ember, 0.22 * heat, 0.03);
        for (let y = 320; y <= 630; y += 30) glow(ctx, CX, y, 26, C.cyan, 0.08 * heat, 0.2);
      }
      if (heat < 0.3) return;
      const flow = tubeState(f);
      if (f >= ON && flow) {
        glow(ctx, CX - 85, 475, 150, C.cyan, 0.16, 0.05);
        glow(ctx, CX + 85, 475, 150, C.cyan, 0.16, 0.05);
      }
      const per = 0.28;
      const life = 46;
      const i0 = Math.ceil((f - life) / per);
      const i1 = Math.floor(f / per);
      for (let i = i0; i <= i1; i++) {
        const birth = i * per;
        if (birth < HEAT + 30) continue;
        const t = f - birth;
        const on = tubeState(birth) === 1;
        const side = hash(i * 0.37) < 0.5 ? -1 : 1;
        const y0 = 312 + hash(i * 3.13) * 326;
        let d: number;
        let a = 1;
        if (on) {
          d = 0.6 * t + 0.07 * t * t;
          if (d > 64) {
            // absorbed by the plate: brief spark
            const k = (d - 64) / 18;
            if (k < 1) glow(ctx, CX + side * 71, y0, 10, C.ice, (1 - k) * 0.7);
            continue;
          }
        } else {
          const v0 = 1.1 + hash(i * 7.7) * 1.5;
          d = v0 * t - 0.055 * t * t;
          if (d < 0) continue;
          a = clamp(d / 10);
        }
        const y = y0 + Math.sin(t * 0.25 + i) * 2.5;
        glow(ctx, CX + side * (10 + d), y, on ? 10 : 7, on ? C.cyan : "#6fa8ff", (on ? 1 : 0.7) * a);
      }
    }}
  />
);

const Readout: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, ON - 30, ON - 5)) * (1 - prog(frame, TOGGLE - 10, TOGGLE + 5));
  const st = tubeState(frame);
  const col = st ? C.amber : "#5f6b7a";
  if (a <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 1150, top: 250, width: 560, opacity: a, textAlign: "center" }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 24, letterSpacing: "0.3em", color: "rgba(255,255,255,0.6)" }}>OUTPUT</div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 300,
          lineHeight: 1.1,
          color: st ? "#fff" : "#7c8796",
          textShadow: st ? `0 0 40px ${C.amber}, 0 0 90px ${C.ember}` : "none",
        }}
      >
        {st}
      </div>
      <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 40, color: col, textShadow: st ? `0 0 16px ${col}` : "none" }}>
        {st ? "开 · 电流导通" : "关 · 电流截止"}
      </div>
      <div style={{ marginTop: 24, fontFamily: FONT_MONO, fontSize: 22, color: frame >= OFF && !st ? C.red : "rgba(255,255,255,0.55)" }}>
        栅极电压 {frame >= OFF && !st ? "−5 V" : "0 V"}
      </div>
    </div>
  );
};

/** Binary adder: 0101 + 0011 = 1000, the result bits clocking out of the tube. */
const Adder: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - TOGGLE;
  if (t < 0) return null;
  const a = ease.outCubic(clamp(t / 20)) * (1 - prog(frame, DUR - 40, DUR - 15));
  const row = (bits: string, label: string, reveal: number, col: string, op = " ") => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 20 }}>
      <span style={{ color: "rgba(255,255,255,0.5)", width: 50 }}>{op}</span>
      {bits.split("").map((b, i) => {
        const on = i < reveal;
        return (
          <span
            key={i}
            style={{
              width: 78,
              textAlign: "center",
              color: on ? (b === "1" ? "#fff" : "#8892a0") : "transparent",
              textShadow: on && b === "1" ? `0 0 24px ${col}` : "none",
            }}
          >
            {b}
          </span>
        );
      })}
      <span style={{ fontFamily: FONT_CN, fontSize: 40, color: col, width: 110, textAlign: "left", opacity: reveal >= 4 ? 1 : 0 }}>{label}</span>
    </div>
  );
  const r1 = Math.floor(clamp(t / 30) * 4.99);
  const r2 = Math.floor(clamp((t - 24) / 30) * 4.99);
  const r3 = Math.floor(clamp((t - 60) / 36) * 4.99);
  return (
    <div style={{ position: "absolute", left: 1060, top: 230, opacity: a, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 96, lineHeight: 1.25 }}>
      {row("0101", "= 5", r1, C.amber)}
      {row("0011", "= 3", r2, C.amber, "+")}
      <div style={{ height: 4, margin: "10px 0 10px 70px", background: C.amber, boxShadow: `0 0 16px ${C.amber}`, width: `${88 * ease.outCubic(clamp((t - 50) / 14))}%` }} />
      {row("1000", "= 8", r3, C.gold)}
    </div>
  );
};

export const Tube: React.FC = () => {
  const frame = useCurrentFrame();
  const z = 1 + 0.06 * prog(frame, 60, DUR);
  const out = ease.inCubic(prog(frame, DUR - 40, DUR));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Blueprint />
      <AbsoluteFill
        style={{
          transform: `translateY(-64px) scale(${0.94 * z * (1 - 0.75 * out)})`,
          transformOrigin: `${CX}px 480px`,
          opacity: 1 - out,
        }}
      >
        <TubeSvg frame={frame} />
        <Electrons />
        <Callout x={CX} y={360} dx={-280} dy={-80} text="阴极 · 灯丝加热" sub="CATHODE" from={HEAT + 20} to={OFF + 40} color={C.amber} />
        <Callout x={CX - 42} y={560} dx={-250} dy={90} text="栅极 · 控制开关" sub="GRID" from={HEAT + 40} to={TOGGLE} color={frame >= OFF ? C.red : "#c9d3de"} />
        <Callout x={CX + 85} y={420} dx={200} dy={-150} text="阳极 · 收集电子" sub="PLATE" from={HEAT + 60} to={ON - 30} color={C.ice} />
      </AbsoluteFill>
      <Readout />
      <Adder />
      <ChapterCard index={1} title="会发光的开关" en="THE GLOWING SWITCH" dur={78} />
      <Captions
        accent={C.amber}
        items={[
          { from: 92, to: 205, text: "计算机的本质，是{{一大堆开关}}。" },
          { from: 208, to: 300, text: "开，代表{{1}}；关，代表{{0}}。" },
          { from: 303, to: 445, text: "真空管就是当年的开关：灯丝加热，{{电子飞过真空}}，电流接通。" },
          { from: 450, to: 556, text: "给栅极加上负电压，电子被挡回去——{{开关就断了}}。" },
          { from: 562, to: DUR - 20, text: "成千上万个开关组合起来，就能{{做加法、做乘法}}……" },
        ]}
      />
    </AbsoluteFill>
  );
};

