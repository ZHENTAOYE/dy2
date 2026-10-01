import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmt, hash, prog } from "../lib/math";
import { Captions } from "../components/Caption";
import { sceneDuration } from "../timeline";
import { camAt, CHIP, CITY, EARTH, FOCAL, HALL, monotone, PKG_C, proj, RACK, SERVER } from "./zoomout/cam";
import { drawChipWorld } from "./zoomout/chip";
import { drawWorld3D, focusBoxes } from "./zoomout/world";
import { drawCity } from "./zoomout/city";
import { drawEarthBack, drawEarthFront } from "./zoomout/earth";

const DUR = sceneDuration("zoomout");

// ---------------------------------------------------------------- main canvas
const World: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const c = camAt(f);
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
      bg.addColorStop(0, "#060b14");
      bg.addColorStop(1, "#010205");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (c.D > 3e4) drawEarthBack(ctx, c, f);
      if (c.D > 200) drawCity(ctx, c, f);
      if (c.view > 0.08) drawWorld3D(ctx, c, f);
      if (c.topDown && c.view < 0.8) {
        drawChipWorld(ctx, f, c.D, [c.T[0], -c.T[2]], -c.yaw, clamp((0.8 - c.view) / 0.45));
      }
      if (c.D > 3e5) drawEarthFront(ctx, c, f);
      streaks(ctx, f);
    }}
  />
);

/** Fine dust rushing to the centre while the pull-back is fast. */
const streaks = (ctx: CanvasRenderingContext2D, f: number) => {
  const c1 = camAt(f);
  if (c1.D > 2000) return;
  const l0 = Math.log10(camAt(f - 1).D);
  const l1 = Math.log10(c1.D);
  const sp = l1 - l0;
  const a = clamp((sp - 0.015) / 0.03) * 0.8;
  if (a <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < 140; i++) {
    const ang = hash(i * 1.37) * Math.PI * 2;
    const ph = (hash(i * 2.71) + l1 * 0.9) % 1;
    const r = 1250 * Math.pow(10, -1.1 * ph);
    const r2 = r * Math.pow(10, Math.min(0.14, sp * 2.6));
    const al = a * (0.12 + 0.3 * hash(i * 5.3)) * clamp((r - 80) / 200);
    ctx.strokeStyle = `rgba(190,230,255,${al})`;
    ctx.lineWidth = 1 + 1.5 * hash(i * 3.3);
    ctx.beginPath();
    ctx.moveTo(960 + Math.cos(ang) * r, 540 + Math.sin(ang) * r * 0.9);
    ctx.lineTo(960 + Math.cos(ang) * r2, 540 + Math.sin(ang) * r2 * 0.9);
    ctx.stroke();
  }
  ctx.restore();
};

// ---------------------------------------------------------------- HUD
const shadow = "0 0 10px #000, 0 0 24px #000, 0 2px 4px #000";

const STAGES = [
  { from: 0, name: "晶体管", en: "TRANSISTORS", col: C.cyan },
  { from: 116, name: "AI 芯片", en: "AI CHIP", col: C.cyan },
  { from: 262, name: "服务器", en: "SERVER", col: C.ice },
  { from: RACK - 8, name: "机柜", en: "RACK", col: C.ice },
  { from: HALL, name: "AI 数据中心", en: "DATA CENTER", col: C.cyan },
  { from: CITY + 4, name: "城市", en: "CITY", col: C.amber },
  { from: EARTH + 40, name: "地球", en: "EARTH", col: "#7fb8ff" },
];

const StageLabel: React.FC = () => {
  const frame = useCurrentFrame();
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (frame >= STAGES[i].from) idx = i;
  const s = STAGES[idx];
  const t = frame - s.from;
  const next = STAGES[idx + 1];
  const outA = next ? 1 - prog(frame, next.from - 6, next.from) : 1;
  const a = Math.min(clamp(t / 6), outA) * prog(frame, 10, 24);
  const typed = Math.ceil(clamp(t / 10) * s.name.length);
  const jit = t < 8 ? (hash(frame * 3.1) - 0.5) * 10 * (1 - t / 8) : 0;
  return (
    <div style={{ position: "absolute", left: 96, top: 70, opacity: a, transform: `translateX(${jit}px)` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 46, color: "#fff", letterSpacing: "0.06em", textShadow: `0 0 18px ${s.col}, ${shadow}` }}>
          {s.name.slice(0, typed)}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 20, letterSpacing: "0.3em", color: s.col, textShadow: shadow, opacity: clamp((t - 6) / 8) }}>
          {s.en}
        </div>
      </div>
    </div>
  );
};

const UNITS: [number, string][] = [
  [-9, "纳米"],
  [-6, "微米"],
  [-3, "毫米"],
  [0, "米"],
  [3, "千米"],
  [7, "万千米"],
];
const LAD_W = 560;
const L_MIN = -9;
const L_MAX = 8;
const lx = (l: number) => ((l - L_MIN) / (L_MAX - L_MIN)) * LAD_W;

const ScaleLadder: React.FC = () => {
  const frame = useCurrentFrame();
  const c = camAt(frame);
  const l = Math.log10(c.view);
  const x = lx(l);
  const a = prog(frame, 14, 30) * (1 - prog(frame, 742, 760));
  return (
    <div style={{ position: "absolute", left: 96, top: 150, width: LAD_W + 40, height: 90, opacity: a }}>
      <div style={{ fontFamily: FONT_CN, fontSize: 18, letterSpacing: "0.2em", color: "rgba(200,230,255,0.75)", textShadow: shadow }}>视野宽度</div>
      <div style={{ position: "absolute", left: 0, top: 36, width: LAD_W, height: 2, background: "rgba(255,255,255,0.22)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 35,
          width: x,
          height: 4,
          background: `linear-gradient(90deg, ${C.cyan}, ${C.violet} 60%, ${C.magenta})`,
          boxShadow: `0 0 10px ${C.cyan}`,
        }}
      />
      {UNITS.map(([u, name]) => {
        const passed = l >= u - 0.15;
        return (
          <div key={name} style={{ position: "absolute", left: lx(u), top: 30, transform: "translateX(-50%)", textAlign: "center" }}>
            <div style={{ width: 2, height: 14, margin: "0 auto", background: passed ? "#fff" : "rgba(255,255,255,0.4)" }} />
            <div
              style={{
                fontFamily: FONT_CN,
                fontWeight: 700,
                fontSize: 19,
                marginTop: 6,
                whiteSpace: "nowrap",
                color: passed ? "#fff" : "rgba(255,255,255,0.45)",
                textShadow: shadow,
              }}
            >
              {name}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: x - 9,
          top: 28,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: "#fff",
          boxShadow: `0 0 14px ${C.cyan}, 0 0 30px ${C.cyan}`,
        }}
      />
    </div>
  );
};

const logC = monotone([
  [0, 15],
  [SERVER + 8, 15],
  [SERVER + 40, Math.log10(8e15)],
  [RACK, Math.log10(8e15)],
  [RACK + 34, Math.log10(7.2e16)],
  [HALL + 6, Math.log10(7.2e16)],
  [HALL + 140, 20],
]);

const Sci: React.FC<{ v: number }> = ({ v }) => {
  let e = Math.floor(v + 1e-9);
  let r = Math.round(Math.pow(10, v - e) * 10) / 10;
  if (r >= 10) {
    e += 1;
    r = 1;
  }
  const ms = r <= 1.04 ? "" : Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1);
  return (
    <span>
      {ms ? `${ms}×` : ""}10
      <span style={{ fontSize: "0.56em", position: "relative", top: "-0.82em", marginLeft: 2 }}>{e}</span>
    </span>
  );
};

const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, CHIP - 10, CHIP + 14));
  if (a <= 0) return null;
  const v = logC(frame);
  const gpus = Math.pow(10, v - 15);
  const prev = logC(frame - 3);
  const hot = clamp((v - prev) * 6);
  const gtxt = gpus < 1.5 ? "单块 GPU" : `${fmt(gpus)} 块 GPU`;
  return (
    <div style={{ position: "absolute", right: 96, top: 66, textAlign: "right", opacity: a }}>
      <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 22, letterSpacing: "0.3em", color: C.ice, textShadow: shadow }}>每秒运算</div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 66,
          lineHeight: 1.15,
          color: "#fff",
          textShadow: `0 0 ${16 + 30 * hot}px ${C.cyan}, ${shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 40, color: "rgba(255,255,255,0.7)", marginRight: 10 }}>≈</span>
        <Sci v={v} />
        <span style={{ fontFamily: FONT_CN, fontSize: 28, fontWeight: 700, marginLeft: 10, color: "rgba(255,255,255,0.8)" }}>次</span>
      </div>
      <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 28, color: C.cyan, textShadow: shadow, marginTop: 2 }}>{gtxt}</div>
    </div>
  );
};

/** Tag that tracks the package on screen: "AI 芯片 / 2080亿个晶体管". */
const ChipCallout: React.FC = () => {
  const frame = useCurrentFrame();
  const from = CHIP + 22;
  const to = SERVER - 24;
  const a = Math.min(clamp((frame - from) / 10), 1 - prog(frame, to - 12, to));
  if (a <= 0) return null;
  const c = camAt(frame);
  const p = proj(c, PKG_C[0] + 0.0245, 0, -(PKG_C[1] - 0.012));
  if (!p) return null;
  const ex = Math.min(1500, p.x + 70);
  const ey = Math.max(330, p.y - 150);
  const t = ease.outCubic(clamp((frame - from) / 16));
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle cx={p.x} cy={p.y} r={7} fill="none" stroke={C.cyan} strokeWidth={2} />
        <circle cx={p.x} cy={p.y} r={3} fill={C.cyan} />
        <polyline points={`${p.x},${p.y} ${p.x + (ex - p.x) * t},${p.y + (ey - p.y) * t} ${ex + 260 * t},${ey}`} stroke={C.cyan} strokeWidth={2} fill="none" />
      </svg>
      <div style={{ position: "absolute", left: ex + 8, top: ey - 74, opacity: clamp((frame - from - 8) / 10) }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 48, color: "#fff", textShadow: `0 0 18px ${C.cyan}, ${shadow}` }}>AI 芯片</div>
      </div>
      <div style={{ position: "absolute", left: ex + 8, top: ey + 10, opacity: clamp((frame - from - 14) / 10) }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 34, color: C.cyan, textShadow: shadow }}>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800 }}>2080</span>亿个晶体管
        </div>
      </div>
    </div>
  );
};

/** Labels riding on the highlight brackets of the server tray and the rack. */
const BoxTags: React.FC = () => {
  const frame = useCurrentFrame();
  const fb = focusBoxes(camAt(frame), frame);
  const tag = (q: { x: number; y: number }[] | null, a: number, title: string, n: string) => {
    if (!q || a <= 0) return null;
    const x = Math.max(...q.map((p) => p.x));
    const y = Math.min(...q.map((p) => p.y));
    const left = Math.min(1500, x + 28);
    const top = clamp(y + 10, 300, 640);
    return (
      <div style={{ position: "absolute", left, top, opacity: a, transform: `translateX(${(1 - a) * 20}px)` }}>
        <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 26, letterSpacing: "0.2em", color: C.ice, textShadow: shadow }}>{title}</div>
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 52, color: "#fff", textShadow: `0 0 18px ${C.cyan}, ${shadow}`, whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800 }}>{n}</span> 块 GPU
        </div>
      </div>
    );
  };
  return (
    <>
      {tag(fb.tray, fb.trayA, "一台服务器", "8")}
      {tag(fb.rack, fb.rackA, "一个机柜", "72")}
    </>
  );
};

/** Two-point chart: training compute AlexNet (2012) vs GPT-4. */
const EndChart: React.FC = () => {
  const frame = useCurrentFrame();
  const from = 770;
  const a = clamp((frame - from) / 12);
  if (a <= 0) return null;
  const W = 380;
  const len = (l: number) => ((l - 16) / 10) * W;
  const g1 = ease.outCubic(clamp((frame - from - 6) / 16));
  const g2 = ease.inOutCubic(clamp((frame - from - 16) / 26));
  const row = (label: React.ReactNode, l: number, gr: number, val: React.ReactNode, col: string, top: number) => (
    <div style={{ position: "absolute", left: 0, top, width: 540 }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: "#fff", textShadow: shadow }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
        <div style={{ width: len(l) * gr, height: 16, background: `linear-gradient(90deg, ${C.cyan}, ${col})`, boxShadow: `0 0 16px ${col}` }} />
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 30, color: col, textShadow: shadow, opacity: clamp(gr * 2 - 1), whiteSpace: "nowrap" }}>
          {val}
        </div>
      </div>
    </div>
  );
  const sup = (m: string, e: string) => (
    <span>
      ≈{m}×10<span style={{ fontSize: "0.58em", position: "relative", top: "-0.8em", marginLeft: 1 }}>{e}</span>
    </span>
  );
  return (
    <div style={{ position: "absolute", right: 96, top: 330, width: 560, height: 300, opacity: a }}>
      <div
        style={{
          position: "absolute",
          left: -28,
          top: -22,
          right: -28,
          bottom: -18,
          borderRadius: 10,
          background: "linear-gradient(135deg, rgba(3,8,18,0.78), rgba(3,8,18,0.6))",
          border: "1px solid rgba(155,232,255,0.22)",
          boxShadow: "0 0 40px rgba(0,0,0,0.6)",
        }}
      />
      <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 24, letterSpacing: "0.12em", color: C.ice, textShadow: shadow }}>训练一个顶尖AI · 总运算量</div>
      <div style={{ position: "absolute", left: 0, top: 44, width: 540, height: 1, background: "rgba(255,255,255,0.25)" }} />
      {row(<>AlexNet · 2012</>, Math.log10(4.7e17), g1, sup("4.7", "17"), C.cyan, 64)}
      {row(<>GPT-4</>, Math.log10(2e25), g2, sup("2", "25"), C.magenta, 150)}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 246,
          fontFamily: FONT_CN,
          fontWeight: 900,
          fontSize: 30,
          color: "#fff",
          textShadow: `0 0 16px ${C.magenta}, ${shadow}`,
          opacity: clamp((frame - from - 40) / 10),
        }}
      >
        十年 · 上千万倍
      </div>
    </div>
  );
};

export const ZoomOut: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = prog(frame, 0, 12);
  const out = prog(frame, DUR - 15, DUR);
  void FOCAL;
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <World />
      <AbsoluteFill
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.62) 0px, rgba(0,0,0,0.38) 170px, rgba(0,0,0,0) 300px)",
          opacity: clamp(frame / 12),
        }}
      />
      <StageLabel />
      <ScaleLadder />
      <Counter />
      <ChipCallout />
      <BoxTags />
      <EndChart />
      <Captions
        accent={C.cyan}
        items={[
          { from: 14, to: 134, text: "支撑这一切的，是规模惊人的{{算力}}。" },
          { from: 145, to: 285, text: "一块顶级AI芯片：{{2000多亿}}个晶体管。" },
          { from: 295, to: 440, text: "一台服务器8块，一个机柜72块。" },
          { from: 450, to: 610, text: "一座AI数据中心：{{十万块}}芯片，耗电堪比一座城市。" },
          { from: 620, to: 825, text: "训练顶尖AI的算力，十年间增长了{{上千万倍}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};
