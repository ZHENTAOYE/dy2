import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmt, hash, prog, shake, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash, YearStamp } from "../components/Hud";
import { CHIPS, cnCount, countAt } from "../data";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("moore");
const SPLIT = cue("moore", "split");
const RUN = cue("moore", "run");
const END = cue("moore", "end");
const YEAR0 = RUN + 50;
const STEP = 18; // frames per doubling in the intro demo

/** Displayed year during the run (accelerating). Exported for the soundtrack's tick math. */
export const yearAt = (f: number) => 1971 + 53 * ease.inQuad(prog(f, YEAR0, END));

const CHIP_X = 1300;
const CHIP_Y = 430;
const CHIP_S = 470;

const demoK = (f: number) => (f < SPLIT ? 0 : Math.min(6, Math.floor((f - SPLIT) / STEP) + 1));

/** Recursive die-shot: split blocks until `depth` runs out; leaves are striped, tinted, twinkling cells. */
const drawDie = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  seed: number,
  f: number,
  heat: number,
) => {
  if (depth < 1 || w < 4 || h < 4) {
    const r = hash(seed * 0.618);
    const hue = 140 + (r - 0.5) * 120 + (hash(seed * 1.7) > 0.85 ? 160 : 0);
    const tw = hash(seed * 3.1 + Math.floor(f / 3) * 0.37);
    const lit = 22 + 30 * r + 20 * tw * (0.3 + heat);
    ctx.fillStyle = `hsl(${hue}, ${55 + 25 * heat}%, ${lit}%)`;
    ctx.fillRect(x, y, w, h);
    if (w > 10 && h > 10) {
      ctx.fillStyle = `hsla(${hue}, 80%, 85%, ${0.12 + 0.18 * tw})`;
      const sp = Math.max(2, Math.min(5, h / 6));
      for (let yy = y + 1; yy < y + h - 1; yy += sp) ctx.fillRect(x + 1, yy, w - 2, 1);
    }
    return;
  }
  // fade-in of the newest level
  const frac = depth - Math.floor(depth);
  const vertical = w > h ? true : w < h ? false : hash(seed) > 0.5;
  const ratio = 0.5 + (hash(seed * 7.13) - 0.5) * 0.5;
  const gap = Math.max(0.5, Math.min(3, Math.min(w, h) * 0.03));
  if (depth < 2 && frac < 1) {
    // last level: split appears gradually
    const g2 = gap * clamp(frac * 2);
    if (vertical) {
      drawDie(ctx, x, y, w * ratio - g2 / 2, h, 0, seed * 2, f, heat);
      drawDie(ctx, x + w * ratio + g2 / 2, y, w * (1 - ratio) - g2 / 2, h, 0, seed * 2 + 1, f, heat);
    } else {
      drawDie(ctx, x, y, w, h * ratio - g2 / 2, 0, seed * 2, f, heat);
      drawDie(ctx, x, y + h * ratio + g2 / 2, w, h * (1 - ratio) - g2 / 2, 0, seed * 2 + 1, f, heat);
    }
    return;
  }
  if (vertical) {
    drawDie(ctx, x, y, w * ratio - gap / 2, h, depth - 1, seed * 2, f, heat);
    drawDie(ctx, x + w * ratio + gap / 2, y, w * (1 - ratio) - gap / 2, h, depth - 1, seed * 2 + 1, f, heat);
  } else {
    drawDie(ctx, x, y, w, h * ratio - gap / 2, depth - 1, seed * 2, f, heat);
    drawDie(ctx, x, y + h * ratio + gap / 2, w, h * (1 - ratio) - gap / 2, depth - 1, seed * 2 + 1, f, heat);
  }
};

const ChipCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      // backdrop: faint traces
      const bg = ctx.createRadialGradient(CHIP_X, CHIP_Y, 0, CHIP_X, CHIP_Y, 1400);
      bg.addColorStop(0, "#04140f");
      bg.addColorStop(1, "#010304");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(61,255,168,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const y = Math.floor(hash(i * 3.3) * 27) * 40 + 0.5;
        const x0 = hash(i * 5.1) * w;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + 120 + hash(i) * 400, y);
        ctx.lineTo(x0 + 160 + hash(i) * 400, y + 40);
        ctx.stroke();
      }
      const appear = ease.outBack(prog(f, 60, 100));
      if (appear <= 0) return;
      const x0 = CHIP_X - CHIP_S / 2;
      const y0 = CHIP_Y - CHIP_S / 2;
      const running = f >= RUN;
      const count = running ? countAt(yearAt(f)) : Math.pow(2, demoK(f));
      const k = Math.log2(count);
      const heat = running ? clamp((k - 11) / 26.6) : 0;
      ctx.save();
      ctx.translate(CHIP_X, CHIP_Y);
      ctx.scale(appear, appear);
      ctx.translate(-CHIP_X, -CHIP_Y);
      // halo grows with the number of transistors
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, CHIP_X, CHIP_Y, CHIP_S * (0.9 + 1.6 * heat), C.green, 0.12 + 0.35 * heat, 0.03);
      if (heat > 0.4) glow(ctx, CHIP_X, CHIP_Y, CHIP_S * (1.2 + 2.5 * heat), C.cyan, 0.25 * (heat - 0.4), 0.02);
      ctx.globalCompositeOperation = "source-over";
      // package + pins
      ctx.fillStyle = "#0a1210";
      ctx.fillRect(x0 - 26, y0 - 26, CHIP_S + 52, CHIP_S + 52);
      ctx.fillStyle = "#b99a52";
      for (let i = 0; i < 24; i++) {
        const p = x0 + 10 + i * ((CHIP_S - 20) / 23);
        ctx.fillRect(p - 4, y0 - 46, 8, 20);
        ctx.fillRect(p - 4, y0 + CHIP_S + 26, 8, 20);
        ctx.fillRect(x0 - 46, p - 4, 20, 8);
        ctx.fillRect(x0 + CHIP_S + 26, p - 4, 20, 8);
      }
      // die
      ctx.fillStyle = "#06100c";
      ctx.fillRect(x0, y0, CHIP_S, CHIP_S);
      const cols = Math.pow(2, Math.ceil(k / 2));
      const rows = Math.pow(2, Math.floor(k / 2));
      if (!running || k < 13) {
        // discrete cells, each a flickering transistor
        const n = Math.round(count);
        const c = running ? Math.ceil(Math.sqrt(n)) : cols;
        const r = running ? Math.ceil(n / c) : rows;
        const cw = CHIP_S / c;
        const ch = CHIP_S / r;
        const gap = Math.max(0.6, Math.min(8, cw * 0.12));
        const pop = running || f < SPLIT ? 1 : ease.outBack(clamp(((f - SPLIT) % STEP) / 8));
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < n; i++) {
          const cx = x0 + (i % c) * cw;
          const cy = y0 + Math.floor(i / c) * ch;
          const lv = 0.45 + 0.55 * hash(i * 1.37 + Math.floor(f / 3) * 0.71);
          const col = mix(C.green, C.cyan, hash(i * 9.1));
          ctx.fillStyle = withAlpha(col, n === 1 ? 0.9 : 0.25 + 0.55 * lv);
          const sw = (cw - gap) * (running ? 1 : pop);
          const sh = (ch - gap) * (running ? 1 : pop);
          ctx.fillRect(cx + (cw - sw) / 2, cy + (ch - sh) / 2, sw, sh);
          if (cw > 40) glow(ctx, cx + cw / 2, cy + ch / 2, cw * 0.7, col, 0.35 * lv);
        }
      } else {
        // a die shot whose functional blocks keep subdividing: every level doubles the leaves
        const depth = 2 + (k - 13) * 0.5;
        drawDie(ctx, x0 + 3, y0 + 3, CHIP_S - 6, CHIP_S - 6, depth, 1, f, heat);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = withAlpha(C.green, 0.8);
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, CHIP_S, CHIP_S);
      ctx.restore();
      // sparks fly off faster and faster
      if (running) {
        ctx.globalCompositeOperation = "lighter";
        const rate = 0.4 + 9 * heat * heat;
        const life = 50;
        const i0 = Math.floor((f - life) * rate);
        const i1 = Math.floor(f * rate);
        for (let i = Math.max(i0, Math.floor(RUN * rate)); i <= i1; i++) {
          const born = i / rate;
          const t = f - born;
          if (t < 0 || t > life) continue;
          const a = hash(i * 1.91) * TAU;
          const sp = 6 + hash(i * 3.7) * 18 * (0.5 + heat);
          const x = CHIP_X + Math.cos(a) * (CHIP_S * 0.5 + sp * t);
          const y = CHIP_Y + Math.sin(a) * (CHIP_S * 0.5 + sp * t);
          glow(ctx, x, y, 3 + 5 * hash(i), i % 3 ? C.green : C.cyan, 1 - t / life);
        }
      }
    }}
  />
);

const RunHud: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < RUN - 5) return null;
  const a = ease.outCubic(prog(frame, RUN - 5, RUN + 15));
  const year = yearAt(frame);
  const count = countAt(year);
  const digits = fmt(count).length;
  const passed = CHIPS.filter((c) => c.year <= year + 0.001);
  const endT = frame - END;
  const slam = endT >= 0 ? 1 + 0.25 * Math.exp(-endT / 6) : 1;
  return (
    <AbsoluteFill style={{ opacity: a }}>
      {/* milestone ladder */}
      <div style={{ position: "absolute", left: 110, top: 110, width: 560 }}>
        {passed
          .slice()
          .reverse()
          .slice(0, 6)
          .map((c, i) => {
            const t = ease.outCubic(clamp((frame - (YEAR0 + 0) - framesTo(c.year)) / 10));
            const fade = 1 - i * 0.13;
            return (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "9px 0",
                  borderBottom: `1px solid ${withAlpha(C.green, 0.2)}`,
                  opacity: fade * (i === 0 ? t : 1),
                  transform: `translateX(${i === 0 ? (1 - t) * -60 : 0}px)`,
                }}
              >
                <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 26, color: C.green, width: 90 }}>{c.year}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 26, color: "#fff", flex: 1 }}>{c.name}</span>
                <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 32, color: "#fff", textShadow: i === 0 ? `0 0 16px ${C.green}` : "none" }}>{cnCount(c.count)}</span>
              </div>
            );
          })}
      </div>
      {/* year + count readout under the chip */}
      <div style={{ position: "absolute", left: 110, width: 800, top: 585 }}>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 30, color: C.green, letterSpacing: "0.3em" }}>
          {Math.floor(year)} · 晶体管数量
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: Math.min(110, 1250 / digits),
            color: "#fff",
            transform: `scale(${slam})`,
            transformOrigin: "left center",
            textShadow: `0 0 ${20 + 30 * clamp((digits - 5) / 10)}px ${C.green}, 0 0 4px #000`,
          }}
        >
          {fmt(count)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Frames from YEAR0 until the run reaches `year` (inverse of yearAt). */
const framesTo = (year: number) => Math.sqrt(clamp((year - 1971) / 53)) * (END - YEAR0);

const DemoHud: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < SPLIT || frame > RUN + 10) return null;
  const k = demoK(frame);
  const t = (frame - SPLIT) % STEP;
  const pop = ease.outBack(clamp(t / 8));
  const a = 1 - prog(frame, RUN - 10, RUN + 5);
  return (
    <div style={{ position: "absolute", left: 200, top: 300, opacity: a }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 200, color: "#fff", textShadow: `0 0 40px ${C.green}`, transform: `scale(${0.8 + 0.2 * pop})`, transformOrigin: "left center" }}>
        {Math.pow(2, k)}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 64, color: C.green, opacity: k > 0 ? 1 : 0 }}>
        ×2 <span style={{ fontFamily: FONT_CN, fontSize: 36, color: "rgba(255,255,255,0.7)" }}>第 {k} 次翻倍</span>
      </div>
    </div>
  );
};

export const Moore: React.FC = () => {
  const frame = useCurrentFrame();
  const ramp = frame > YEAR0 ? clamp((frame - YEAR0) / (END - YEAR0)) : 0;
  const jitter = frame < END ? (hash(frame * 1.3) - 0.5) * 8 * ramp * ramp : 0;
  const sh = shake(frame, END, 30, 24);
  const out = prog(frame, DUR - 25, DUR);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: 1 - out }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x + jitter}px, ${sh.y + jitter * 0.6}px)` }}>
        <ChipCanvas />
        <DemoHud />
        <RunHud />
      </AbsoluteFill>
      <YearStamp year="1965" label="摩尔定律" from={84} to={RUN - 10} color={C.green} />
      <ChapterCard index={3} title="翻倍的力量" en="THE POWER OF DOUBLING" color={C.green} dur={78} />
      <Flash at={END} dur={16} color={C.green} peak={0.7} />
      <Captions
        accent={C.green}
        items={[
          { from: 84, to: 196, text: "1965年，{{戈登·摩尔}}提出了一个大胆的预言：" },
          { from: 200, to: 338, text: "芯片上的晶体管数量，大约每{{两年翻一番}}。" },
          { from: 345, to: 470, text: "1971年，第一款商用微处理器只有{{2300个}}晶体管。" },
          { from: 474, to: 612, text: "此后每隔两年左右，这个数字就{{翻一番}}——" },
          { from: 616, to: END - 4, text: "53年，整整翻了{{约26次}}。" },
          { from: END + 6, to: DUR - 12, text: "2024年，一块AI芯片上已有{{2080亿个}}晶体管。" },
        ]}
      />
    </AbsoluteFill>
  );
};

