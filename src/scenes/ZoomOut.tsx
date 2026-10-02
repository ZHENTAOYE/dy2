import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmt, hash, prog, shake } from "../lib/math";
import { Captions } from "../components/Caption";
import { Flash } from "../components/Hud";
import { sceneDuration, ticks } from "../timeline";
import { camAt, CHART, CHIP, CITY, EARTH, FINAL, HALL, monotone, PKG_C, proj, RACK, SERVER } from "./zoomout/cam";
import { drawChipWorld } from "./zoomout/chip";
import { drawWorld3D, focusBoxes } from "./zoomout/world";
import { drawCity } from "./zoomout/city";
import { drawEarthBack, drawEarthFront } from "./zoomout/earth";

const DUR = sceneDuration("zoomout");
const GPU_T = ticks("zoomout", "gpu");
const TRAY_T = ticks("zoomout", "tray");

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
      ctx.save();
      ctx.translate(c.sx, c.sy);
      if (c.D > 3e4) drawEarthBack(ctx, c, f);
      if (c.D > 25) drawCity(ctx, c, f);
      if (c.view > 0.08) drawWorld3D(ctx, c, f);
      if (c.topDown && c.view < 0.8) {
        drawChipWorld(ctx, f, c.D, [c.T[0], -c.T[2]], -c.yaw, clamp((0.8 - c.view) / 0.45));
      }
      if (c.D > 3e5) drawEarthFront(ctx, c, f);
      ctx.restore();
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
  { from: SERVER - 2, name: "服务器", en: "SERVER", col: C.ice },
  { from: RACK - 4, name: "机柜", en: "RACK", col: C.ice },
  { from: HALL, name: "AI 数据中心", en: "DATA CENTER", col: C.cyan },
  { from: CITY + 4, name: "城市", en: "CITY", col: C.amber },
  { from: EARTH, name: "地球", en: "EARTH", col: "#7fb8ff" },
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
    <div style={{ position: "absolute", left: 96, top: 146, width: LAD_W + 40, height: 96, opacity: a }}>
      {/* soft dark backing plate so the ladder reads over bright textures */}
      <div
        style={{
          position: "absolute",
          left: -34,
          top: -14,
          width: LAD_W + 80,
          height: 108,
          borderRadius: 30,
          background: "rgba(2,6,14,0.62)",
          filter: "blur(12px)",
        }}
      />
      <div style={{ position: "relative", fontFamily: FONT_CN, fontSize: 19, fontWeight: 700, letterSpacing: "0.2em", color: "rgba(214,238,255,0.9)", textShadow: shadow }}>
        视野宽度
      </div>
      <div style={{ position: "absolute", left: 0, top: 38, width: LAD_W, height: 2, background: "rgba(255,255,255,0.3)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 37,
          width: x,
          height: 4,
          background: `linear-gradient(90deg, ${C.cyan}, ${C.violet} 60%, ${C.magenta})`,
          boxShadow: `0 0 10px ${C.cyan}`,
        }}
      />
      {UNITS.map(([u, name]) => {
        const passed = l >= u - 0.15;
        return (
          <div key={name} style={{ position: "absolute", left: lx(u), top: 32, transform: "translateX(-50%)", textAlign: "center" }}>
            <div style={{ width: 2, height: 14, margin: "0 auto", background: passed ? "#fff" : "rgba(255,255,255,0.45)" }} />
            <div
              style={{
                fontFamily: FONT_CN,
                fontWeight: 700,
                fontSize: 22,
                marginTop: 5,
                whiteSpace: "nowrap",
                color: passed ? "#fff" : "rgba(255,255,255,0.5)",
                textShadow: passed ? `0 0 10px rgba(56,214,255,0.6), ${shadow}` : shadow,
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
          top: 30,
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

/** GPUs counted so far: 1 -> 8 as the server's GPUs ignite, 8 -> 72 tray by tray, then the hall glides to 100,000. */
const steps = (f: number, ts: number[]) => {
  let n = 1;
  for (const t of ts) n += ease.outCubic(clamp((f - t) / 4));
  return n;
};
const hallC = monotone([
  [HALL + 6, Math.log10(7.2e16)],
  [HALL + 140, 20],
]);
/** GPUs counted at frame f: whole numbers while the server / rack light up, a log glide across the hall. */
const gpusAt = (f: number) => {
  if (f < RACK) return Math.round(steps(f, GPU_T));
  if (f < HALL + 6) return 8 * Math.round(steps(f, TRAY_T));
  return Math.pow(10, hallC(f) - 15);
};
const logC = (f: number) => 15 + Math.log10(gpusAt(f));

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
  const gpus = gpusAt(frame);
  const v = 15 + Math.log10(gpus);
  const prev = logC(frame - 3);
  const fin = frame - FINAL;
  const finK = fin >= -2 && fin < 26 ? (fin < 0 ? (fin + 2) / 2 : Math.pow(1 - fin / 26, 1.6)) : 0;
  const hot = Math.max(clamp((v - prev) * 6), finK);
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
          color: finK > 0.05 ? `rgb(255,${Math.round(255 - 60 * finK)},${Math.round(255 - 20 * finK)})` : "#fff",
          textShadow: `0 0 ${16 + 30 * hot}px ${finK > 0.05 ? C.magenta : C.cyan}, 0 0 ${50 * finK}px ${C.magenta}, ${shadow}`,
          transform: `scale(${1 + 0.06 * finK})`,
          transformOrigin: "100% 50%",
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

/** Tag that tracks the package on screen: the transistor count of the chip. */
const ChipCallout: React.FC = () => {
  const frame = useCurrentFrame();
  const from = 190;
  const to = 252;
  const a = Math.min(clamp((frame - from) / 10), 1 - prog(frame, to - 12, to));
  if (a <= 0) return null;
  const c = camAt(frame);
  const p = proj(c, PKG_C[0] + 0.0245, 0, -(PKG_C[1] - 0.012));
  if (!p) return null;
  const ex = Math.min(1440, p.x + 70);
  const ey = Math.max(320, p.y - 140);
  const t = ease.outCubic(clamp((frame - from) / 16));
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle cx={p.x} cy={p.y} r={7} fill="none" stroke={C.cyan} strokeWidth={2} />
        <circle cx={p.x} cy={p.y} r={3} fill={C.cyan} />
        <polyline points={`${p.x},${p.y} ${p.x + (ex - p.x) * t},${p.y + (ey - p.y) * t} ${ex + 330 * t},${ey}`} stroke={C.cyan} strokeWidth={2} fill="none" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: ex - 4,
          top: ey - 82,
          width: 350 * t,
          height: 82,
          background: "linear-gradient(90deg, rgba(2,6,14,0.86), rgba(2,6,14,0.5))",
          opacity: clamp((frame - from - 4) / 10),
        }}
      />
      <div style={{ position: "absolute", left: ex + 10, top: ey - 80, opacity: clamp((frame - from - 8) / 10), whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 54, color: "#fff", textShadow: `0 0 18px ${C.cyan}, ${shadow}` }}>2080</span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 40, color: "#fff", textShadow: `0 0 14px ${C.cyan}, ${shadow}` }}>亿</span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: C.ice, marginLeft: 10, textShadow: shadow }}>个晶体管</span>
      </div>
    </div>
  );
};

/** Labels riding on the highlight brackets of the server tray and the rack, counting up as the GPUs ignite. */
const BoxTags: React.FC = () => {
  const frame = useCurrentFrame();
  const fb = focusBoxes(camAt(frame), frame);
  const tag = (q: { x: number; y: number }[] | null, a: number, title: string, n: number, top: number) => {
    if (!q || a <= 0) return null;
    const x = Math.max(...q.map((p) => p.x));
    const left = Math.min(1572, x + 26);
    // the text fades before its dark backing, so nothing ghosts over the scene
    const ta = clamp((a - 0.5) / 0.5);
    return (
      <div style={{ position: "absolute", left, top, transform: `translateX(${(1 - a) * 20}px)` }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: a,
            background: "linear-gradient(90deg, rgba(2,6,14,0.9), rgba(2,6,14,0.66))",
            borderLeft: `3px solid ${C.cyan}`,
            boxShadow: "0 0 30px rgba(0,0,0,0.55)",
          }}
        />
        <div style={{ position: "relative", padding: "10px 22px 12px 18px", opacity: ta }}>
          <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 26, letterSpacing: "0.2em", color: C.ice, textShadow: shadow }}>{title}</div>
          <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 52, color: "#fff", textShadow: `0 0 18px ${C.cyan}, ${shadow}`, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 800 }}>{n}</span> 块 GPU
          </div>
        </div>
      </div>
    );
  };
  const ys = (q: { y: number }[]) => q.map((p) => p.y);
  const trayTop = fb.tray ? clamp((Math.min(...ys(fb.tray)) + Math.max(...ys(fb.tray))) / 2 - 70, 220, 600) : 0;
  const rackTop = fb.rack ? clamp(Math.min(...ys(fb.rack)) + 12, 220, 600) : 0;
  return (
    <>
      {tag(fb.tray, fb.trayA, "一台服务器", Math.round(steps(frame, GPU_T)), trayTop)}
      {tag(fb.rack, fb.rackA, "一个机柜", 8 * Math.round(steps(frame, TRAY_T)), rackTop)}
    </>
  );
};

/** Training compute, AlexNet (2012) vs GPT-4: a stub vs eight igniting x10 blocks, then the punchline. */
const CH_FROM = CHART;
const ROW1 = CHART + 4; // AlexNet first ...
const ROW2 = CHART + 13; // ... GPT-4 well after it
const SEG0 = CHART + 16;
const SEG_STEP = 1.8;
const DEC = Math.log10(2e25 / 4.7e17); // ~7.6 decades
const N_SEG = Math.ceil(DEC);
const SEG_DONE = SEG0 + (N_SEG - 1) * SEG_STEP + 3;
const UNIT = 48;
const STUB = 14;
const EndChart: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(clamp((frame - CH_FROM) / 10));
  if (a <= 0) return null;
  const g1 = ease.outCubic(clamp((frame - ROW1) / 8));
  const g2 = ease.outCubic(clamp((frame - ROW2) / 6));
  const sup = (m: string, e: string) => (
    <span>
      ≈{m}×10<span style={{ fontSize: "0.58em", position: "relative", top: "-0.8em", marginLeft: 1 }}>{e}</span>
    </span>
  );
  const fin = frame - FINAL;
  const slam = clamp((fin + 1) / 4);
  const slamS = 1 + 0.5 * Math.pow(1 - ease.outCubic(clamp(fin / 8)), 2);
  const flashK = fin >= 0 && fin < 14 ? Math.pow(1 - fin / 14, 2) : 0;
  const segs: React.ReactNode[] = [];
  for (let k = 0; k < N_SEG; k++) {
    const t = frame - (SEG0 + k * SEG_STEP);
    if (t < 0) break;
    const w = UNIT * Math.min(1, DEC - k) - 4;
    const on = ease.outCubic(clamp(t / 3));
    const fl = t < 8 ? Math.pow(1 - t / 8, 2) : 0;
    const col = k / (N_SEG - 1);
    const rgb = `rgb(${Math.round(56 + (255 - 56) * col)},${Math.round(214 + (62 - 214) * col)},${Math.round(255 + (200 - 255) * col)})`;
    const hot = Math.max(fl, flashK * 0.8);
    segs.push(
      <div
        key={k}
        style={{
          position: "absolute",
          left: STUB + 4 + k * UNIT,
          top: -2 - 6 * hot,
          width: w * on,
          height: 20 + 12 * hot,
          background: hot > 0.05 ? `linear-gradient(90deg, #ffffff, ${rgb})` : rgb,
          boxShadow: `0 0 ${12 + 26 * hot}px ${rgb}`,
          opacity: 0.85 + 0.15 * on,
        }}
      />,
    );
  }
  const g2v = clamp((frame - SEG_DONE) / 6);
  const legend = clamp((frame - SEG0 - 2) / 8);
  return (
    <div style={{ position: "absolute", right: 96, top: 236, width: 560, height: 380, opacity: a }}>
      {/* panel + the slam's magenta flare, clipped to the panel */}
      <div
        style={{
          position: "absolute",
          left: -30,
          top: -24,
          right: -30,
          bottom: -10,
          borderRadius: 12,
          overflow: "hidden",
          background: "linear-gradient(135deg, rgba(3,8,18,0.9), rgba(3,8,18,0.82))",
          border: `1px solid rgba(155,232,255,${0.28 + 0.5 * flashK})`,
          boxShadow: `0 0 50px rgba(0,0,0,0.7), 0 0 ${60 * flashK}px rgba(255,62,200,${0.6 * flashK})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 60% 55% at 30% 82%, rgba(255,62,200,${0.6 * flashK}) 0%, rgba(255,62,200,0) 100%)`,
          }}
        />
      </div>
      <div style={{ position: "relative", fontFamily: FONT_CN, fontWeight: 700, fontSize: 26, letterSpacing: "0.1em", color: "#cfe9ff", textShadow: shadow }}>
        训练顶尖AI · 总运算量（次）
      </div>
      <div style={{ position: "absolute", left: 0, top: 46, width: 500, height: 1, background: "rgba(207,233,255,0.3)" }} />
      {/* AlexNet: a stub */}
      <div style={{ position: "absolute", left: 0, top: 60, width: 540, opacity: g1 }}>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: "#fff", textShadow: shadow }}>AlexNet · 2012</div>
        <div style={{ position: "relative", height: 34, marginTop: 6 }}>
          <div style={{ position: "absolute", left: 0, top: 6, width: STUB * g1, height: 20, background: C.cyan, boxShadow: `0 0 12px ${C.cyan}` }} />
          <div style={{ position: "absolute", left: STUB + 14, top: -4, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 30, color: C.cyan, textShadow: shadow, whiteSpace: "nowrap" }}>
            {sup("4.7", "17")}
          </div>
        </div>
      </div>
      {/* GPT-4: the same stub, then one block per x10 */}
      <div style={{ position: "absolute", left: 0, top: 140, width: 560, opacity: g2 }}>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 24, color: "#fff", textShadow: shadow }}>GPT-4</div>
        <div style={{ position: "relative", height: 34, marginTop: 6 }}>
          <div style={{ position: "absolute", left: 0, top: 6, width: STUB, height: 20, background: C.cyan, opacity: 0.7 }} />
          <div style={{ position: "absolute", left: 0, top: 6, width: 0, height: 20 }}>{segs}</div>
          <div
            style={{
              position: "absolute",
              left: STUB + 4 + DEC * UNIT + 12,
              top: -4,
              fontFamily: FONT_MONO,
              fontWeight: 800,
              fontSize: 30,
              color: C.magenta,
              textShadow: shadow,
              whiteSpace: "nowrap",
              opacity: g2v,
              transform: `translateX(${(1 - g2v) * -12}px)`,
            }}
          >
            {sup("2", "25")}
          </div>
        </div>
        {/* legend: what one block means */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, opacity: legend }}>
          <div style={{ width: UNIT - 4, height: 10, background: "linear-gradient(90deg, #38d6ff, #a070ff)", opacity: 0.8 }} />
          <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 21, color: "rgba(214,238,255,0.85)", textShadow: shadow, whiteSpace: "nowrap" }}>
            每格 <span style={{ fontFamily: FONT_MONO, fontWeight: 800 }}>×10</span>
          </div>
        </div>
      </div>
      {/* the punchline */}
      <div
        style={{
          position: "absolute",
          left: -4,
          top: 248,
          fontFamily: FONT_CN,
          fontWeight: 900,
          fontSize: 96,
          lineHeight: 1.1,
          letterSpacing: "0.04em",
          color: "#fff",
          whiteSpace: "nowrap",
          textShadow: `0 0 ${20 + 50 * flashK}px ${C.magenta}, 0 0 ${8 + 24 * flashK}px ${C.magenta}, ${shadow}`,
          opacity: slam,
          transform: `scale(${slamS})`,
          transformOrigin: "0% 60%",
        }}
      >
        上千万倍
      </div>
    </div>
  );
};

/** Dark scrim behind the caption band while bright layers pass under it. */
const CaptionScrim: React.FC = () => {
  const frame = useCurrentFrame();
  const busy = Math.max(
    0.3,
    0.68 * (1 - clamp((frame - 100) / 18)),
    0.5 * clamp((frame - 136) / 10) * (1 - clamp((frame - 186) / 20)),
    0.62 * clamp((frame - 655) / 20) * (1 - clamp((frame - 772) / 14)),
  );
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(to bottom, rgba(0,0,0,0) 740px, rgba(1,3,8,${busy}) 860px, rgba(1,3,8,${busy}) 960px, rgba(0,0,0,0) 1080px)`,
        opacity: clamp((frame - 6) / 12),
      }}
    />
  );
};

export const ZoomOut: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = prog(frame, 0, 12);
  const out = prog(frame, DUR - 16, DUR - 1);
  // stronger top shade while the far rows of the hall sit behind the HUD
  const hk = clamp((frame - 410) / 20) * (1 - clamp((frame - 480) / 30));
  const sh = shake(frame, FINAL, 18, 10);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: inA * (1 - out) }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r * 0.3}rad)` }}>
        <World />
        <AbsoluteFill
          style={{
            background: `linear-gradient(to bottom, rgba(0,0,0,${0.62 + 0.2 * hk}) 0px, rgba(0,0,0,${0.38 + 0.3 * hk}) ${170 + 70 * hk}px, rgba(0,0,0,0) ${300 + 60 * hk}px)`,
            opacity: clamp(frame / 12),
          }}
        />
        <CaptionScrim />
        <StageLabel />
        <ScaleLadder />
        <Counter />
        <ChipCallout />
        <BoxTags />
        <EndChart />
      </AbsoluteFill>
      <Flash at={FINAL} dur={8} color="#ffe8f8" peak={0.5} />
      <Captions
        accent={C.cyan}
        items={[
          { from: 14, to: 134, text: "支撑这一切的，是规模惊人的{{算力}}。" },
          { from: 168, to: 262, text: "一块顶级AI芯片：{{2000多亿}}个晶体管。" },
          { from: 295, to: 440, text: "一台服务器8块，一个机柜72块。" },
          { from: 450, to: 610, text: "一座AI数据中心：{{十万块}}芯片，耗电堪比一座城市。" },
          { from: 620, to: 825, text: "训练顶尖AI的算力，十年间增长了{{上千万倍}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};
