import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, shake } from "../lib/math";
import { Captions } from "../components/Caption";
import { ChapterCard, Flash } from "../components/Hud";
import { CLOCKS } from "../data";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("wall");
const DRAW = cue("wall", "draw");
const SLAM = cue("wall", "slam");
const HEAT = cue("wall", "heat");
const SPLIT = cue("wall", "split");

const L = 200;
const R = 1180;
const T = 170;
const B = 720;
const Y0 = 1971;
const Y1 = 2024;
const WALL_YEAR = 2005;
const xOf = (y: number) => L + ((y - Y0) / (Y1 - Y0)) * (R - L);
const yOf = (hz: number) => B - ((Math.log10(hz) - 5) / 5) * (B - T);

const clockAt = (year: number) => {
  for (let i = 1; i < CLOCKS.length; i++) {
    const a = CLOCKS[i - 1];
    const b = CLOCKS[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return Math.exp(lerp(Math.log(a.hz), Math.log(b.hz), t));
    }
  }
  return CLOCKS[CLOCKS.length - 1].hz;
};

const penAt = (f: number) =>
  f < SLAM ? lerp(Y0, 2004.6, ease.inQuad(prog(f, DRAW, SLAM))) : lerp(2004.6, Y1, ease.outCubic(prog(f, SLAM + 10, SLAM + 160)));

/** 0 = cool, 1 = white hot. */
const heatAt = (f: number) => {
  const h = f < SLAM ? clamp((Math.log10(clockAt(penAt(f))) - 7.5) / 2.1) : 1;
  const cool = ease.inOutCubic(prog(f, SPLIT + 20, SPLIT + 120));
  return h * (1 - cool) + (f > HEAT && f < SPLIT ? 0.15 * noise1(f * 0.3) : 0);
};

/** cool teal → amber → red → white-hot */
const heatColor = (h: number) =>
  h < 0.4 ? mix("#1f8fa8", C.amber, h / 0.4) : h < 0.75 ? mix(C.amber, C.ember, (h - 0.4) / 0.35) : mix(C.ember, "#fff4dc", (h - 0.75) / 0.25);

const ChartCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const heat = heatAt(f);
      const bg = ctx.createRadialGradient(w * 0.75, h * 0.4, 0, w * 0.75, h * 0.4, w);
      bg.addColorStop(0, mix("#0b0605", "#2a0905", heat));
      bg.addColorStop(1, "#020102");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const a = ease.outCubic(prog(f, 70, 100));
      if (a <= 0) return;
      ctx.globalAlpha = a;
      // grid
      ctx.lineWidth = 1;
      for (let d = 5; d <= 10; d++) {
        const y = yOf(Math.pow(10, d));
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.moveTo(L, y);
        ctx.lineTo(R, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L, T - 20);
      ctx.lineTo(L, B);
      ctx.lineTo(R + 20, B);
      ctx.stroke();
      // clock line
      const pen = penAt(f);
      if (f >= DRAW) {
        const pts: [number, number][] = [];
        for (let y = Y0; y <= pen; y += 0.1) pts.push([xOf(y), yOf(clockAt(y))]);
        pts.push([xOf(pen), yOf(clockAt(pen))]);
        ctx.globalCompositeOperation = "lighter";
        const col = mix(C.amber, C.red, clamp((pen - 1990) / 14));
        glowStroke(ctx, () => pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))), col, 4, 1);
        const [hx, hy] = pts[pts.length - 1];
        glow(ctx, hx, hy, 50, col, 0.9);
        glow(ctx, hx, hy, 14, C.white, 1);
        // the old trend that never happened
        if (f > SLAM + 30) {
          const ga = ease.outCubic(prog(f, SLAM + 30, SLAM + 70));
          ctx.globalCompositeOperation = "source-over";
          ctx.setLineDash([10, 10]);
          ctx.strokeStyle = withAlpha(C.red, 0.55 * ga);
          ctx.lineWidth = 3;
          ctx.beginPath();
          const x0 = xOf(2004.6);
          const y0 = yOf(clockAt(2004.6));
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + (110 * ga), y0 + (T - 30 - y0) * ga);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `700 24px ${FONT_CN}`;
          ctx.fillStyle = withAlpha("#ff9a9a", ga);
          ctx.fillText("按老趋势：几十 GHz？", x0 + 125, T - 22);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // the wall
      const wt = f - SLAM;
      if (wt > -14) {
        const drop = ease.outExpo(clamp((wt + 14) / 14));
        const wx = xOf(WALL_YEAR) + 6;
        const wy = lerp(-h, 0, drop);
        const ww = 56;
        ctx.save();
        ctx.translate(0, wy);
        const wg = ctx.createLinearGradient(wx, 0, wx + ww, 0);
        wg.addColorStop(0, "rgba(255,45,61,0.15)");
        wg.addColorStop(0.5, "rgba(255,80,60,0.55)");
        wg.addColorStop(1, "rgba(255,45,61,0.15)");
        ctx.fillStyle = wg;
        ctx.fillRect(wx, T - 60, ww, B - T + 60);
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx, T - 60, ww, B - T + 60);
        ctx.clip();
        ctx.fillStyle = "rgba(255,210,60,0.35)";
        for (let y = T - 120; y < B + 60; y += 44) {
          ctx.beginPath();
          ctx.moveTo(wx, y + (f % 44));
          ctx.lineTo(wx + ww, y - 30 + (f % 44));
          ctx.lineTo(wx + ww, y - 8 + (f % 44));
          ctx.lineTo(wx, y + 22 + (f % 44));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.globalCompositeOperation = "lighter";
        for (let y = T - 60; y < B; y += 40) glow(ctx, wx + ww / 2, y, 70, C.red, 0.18 + 0.1 * Math.sin(f * 0.3 + y));
        ctx.restore();
        // impact sparks
        if (wt >= 0 && wt < 60) {
          for (let i = 0; i < 120; i++) {
            const an = -Math.PI * hash(i * 1.7);
            const v = 4 + hash(i * 3.9) * 16;
            const x = wx + ww / 2 + Math.cos(an) * v * wt;
            const y = B + Math.sin(an) * v * wt + 0.3 * wt * wt;
            glow(ctx, x, y, 3 + 4 * hash(i), i % 2 ? C.gold : C.red, 1 - wt / 60);
          }
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;
    }}
  />
);

/** The chip on the right: heats up, then splits into many cooler cores. */
const ChipCanvas: React.FC = () => (
  <Canvas
    draw={(ctx, _w, _h, f) => {
      if (f < 80) return;
      const a = ease.outBack(prog(f, 80, 110));
      const heat = heatAt(f);
      const cx = 1560;
      const cy = 400;
      const S = 260 * a;
      ctx.globalCompositeOperation = "lighter";
      const hot = heatColor(clamp(heat));
      glow(ctx, cx, cy, S * (1.4 + 1.6 * heat), heat > 0.3 ? C.ember : C.cyan, 0.25 + 0.45 * heat, 0.03);
      // heat shimmer rising
      for (let i = 0; i < 70 * heat; i++) {
        const life = 60;
        const t = (f * 1.2 + hash(i) * life) % life;
        const x = cx + (hash(i * 3.1) - 0.5) * S + Math.sin(t * 0.2 + i) * 14;
        const y = cy - S / 2 - t * 4.5;
        glow(ctx, x, y, 8 + 10 * hash(i * 7), C.ember, (1 - t / life) * 0.6 * heat);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#120c0a";
      ctx.fillRect(cx - S / 2 - 18, cy - S / 2 - 18, S + 36, S + 36);
      // cores
      const sp = prog(f, SPLIT, SPLIT + 100);
      const k = Math.floor(sp * 4.999);
      const cols = [1, 2, 2, 4, 4][k];
      const rows = [1, 1, 2, 2, 4][k];
      const pop = ease.outBack(clamp(((f - SPLIT) % 20) / 8));
      const gap = 10;
      const cw = (S - gap * (cols + 1)) / cols;
      const chh = (S - gap * (rows + 1)) / rows;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = cx - S / 2 + gap + i * (cw + gap);
          const y = cy - S / 2 + gap + j * (chh + gap);
          const s = f >= SPLIT && sp < 1 ? 0.3 + 0.7 * pop : 1;
          const flick = 0.85 + 0.15 * hash(i * 3 + j * 7 + Math.floor(f / 3));
          ctx.fillStyle = withAlpha(hot, flick);
          ctx.fillRect(x + (cw * (1 - s)) / 2, y + (chh * (1 - s)) / 2, cw * s, chh * s);
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.strokeRect(x, y, cw, chh);
          // die texture: functional units inside every core
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          const n = Math.max(2, Math.round(8 / cols));
          for (let u = 1; u < n; u++) {
            ctx.fillRect(x + (cw * u) / n - 1, y + 4, 2, chh - 8);
            ctx.fillRect(x + 4, y + (chh * u) / n - 1, cw - 8, 2);
          }
        }
      // hot spots
      if (heat > 0.5) {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 6; i++) {
          const x = cx + (hash(i * 2.3) - 0.5) * S * 0.7;
          const y = cy + (hash(i * 5.7) - 0.5) * S * 0.7;
          glow(ctx, x, y, S * 0.25, "#fff4dc", (heat - 0.5) * (0.5 + 0.5 * noise1(f * 0.2 + i * 9)));
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }}
  />
);

const ChipHud: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, 90, 120));
  const heat = heatAt(frame);
  const year = Math.floor(penAt(frame));
  const ghz = clockAt(penAt(frame)) / 1e9;
  const sp = prog(frame, SPLIT, SPLIT + 100);
  const cores = [1, 2, 4, 8, 16][Math.floor(sp * 4.999)];
  const temp = Math.round(lerp(35, 105, heat));
  const pd = prog(frame, HEAT - 10, HEAT + 20) * (1 - prog(frame, SPLIT + 30, SPLIT + 60));
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <div style={{ position: "absolute", left: 1330, width: 460, top: 570, textAlign: "center", fontFamily: FONT_MONO }}>
        <div style={{ display: "flex", justifyContent: "space-around" }}>
          <Stat k="频率" v={ghz >= 1 ? `${ghz.toFixed(1)} GHz` : `${Math.round(ghz * 1000)} MHz`} col={C.amber} />
          <Stat k="温度" v={`${temp}°C`} col={heat > 0.6 ? C.red : C.amber} />
          <Stat k="核心" v={`${cores}`} col={C.cyan} />
        </div>
        <div style={{ marginTop: 6, fontSize: 20, color: "rgba(255,255,255,0.5)" }}>{year}</div>
      </div>
      {/* power-density ladder (Gelsinger, ISSCC 2001) */}
      <div style={{ position: "absolute", left: 1290, width: 540, top: 120, opacity: pd }}>
        <div style={{ fontFamily: FONT_CN, fontSize: 22, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>发热密度（瓦 / 平方厘米）</div>
        <div style={{ position: "relative", height: 70 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 4, background: `linear-gradient(90deg, ${C.amber}, ${C.red}, #fff)` }} />
          {(
            [
              ["电炉", 1],
              ["核反应堆", 2],
              ["火箭喷口", 3],
              ["太阳表面", 3.8],
            ] as const
          ).map(([t, lg]) => (
            <div key={t} style={{ position: "absolute", left: `${(lg / 4) * 100}%`, top: 0, transform: "translateX(-50%)", textAlign: "center" }}>
              <div style={{ fontFamily: FONT_CN, fontSize: 20, color: "#fff", whiteSpace: "nowrap" }}>{t}</div>
              <div style={{ width: 2, height: 22, background: "#fff", margin: "4px auto 0" }} />
            </div>
          ))}
          <div
            style={{
              position: "absolute",
              left: `${(lerp(1.4, 2.1, ease.inOutCubic(prog(frame, HEAT - 10, HEAT + 60))) / 4) * 100}%`,
              top: 40,
              transform: "translateX(-50%)",
              textAlign: "center",
            }}
          >
            <div style={{ width: 0, height: 0, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderBottom: `14px solid ${C.red}`, margin: "0 auto" }} />
            <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 22, color: "#fff", textShadow: `0 0 10px ${C.red}, 0 0 4px ${C.red}`, whiteSpace: "nowrap" }}>CPU</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ k: string; v: string; col: string }> = ({ k, v, col }) => (
  <div>
    <div style={{ fontFamily: FONT_CN, fontSize: 22, color: "rgba(255,255,255,0.6)" }}>{k}</div>
    <div style={{ fontWeight: 800, fontSize: 40, color: "#fff", textShadow: `0 0 16px ${col}` }}>{v}</div>
  </div>
);

const ChartLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, 70, 100));
  const wl = ease.outCubic(prog(frame, SLAM + 4, SLAM + 20));
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <div style={{ position: "absolute", left: L, top: 92, fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff" }}>
        单核处理器频率 <span style={{ fontFamily: FONT_MONO, fontSize: 22, color: "rgba(255,255,255,0.5)" }}>（对数坐标）</span>
      </div>
      {["100 kHz", "1 MHz", "10 MHz", "100 MHz", "1 GHz", "10 GHz"].map((t, i) => (
        <div key={t} style={{ position: "absolute", right: 1920 - L + 14, top: yOf(Math.pow(10, 5 + i)) - 14, fontFamily: FONT_MONO, fontSize: 20, color: "rgba(255,255,255,0.55)" }}>
          {t}
        </div>
      ))}
      {[1971, 1990, 2005, 2024].map((y) => (
        <div key={y} style={{ position: "absolute", left: xOf(y) - 40, width: 80, textAlign: "center", top: B + 12, fontFamily: FONT_MONO, fontSize: 22, color: "rgba(255,255,255,0.65)" }}>
          {y}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: xOf(WALL_YEAR) + 80,
          top: T + 300,
          opacity: wl,
          transform: `scale(${1 + 0.3 * (1 - wl)})`,
          transformOrigin: "left center",
        }}
      >
        <div style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 64, color: "#fff", textShadow: `0 0 30px ${C.red}, 0 0 4px #000` }}>功耗墙</div>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 26, letterSpacing: "0.3em", color: C.red }}>POWER WALL</div>
      </div>
    </AbsoluteFill>
  );
};

export const Wall: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, SLAM, 40, 30);
  const tremble = frame > HEAT && frame < SPLIT ? (noise1(frame * 0.8) - 0.5) * 6 : 0;
  const out = prog(frame, DUR - 20, DUR);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: 1 - out }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x + tremble}px, ${sh.y}px) rotate(${sh.r}rad)` }}>
        <ChartCanvas />
        <ChartLabels />
        <ChipCanvas />
        <ChipHud />
      </AbsoluteFill>
      <Flash at={SLAM} dur={14} color={C.red} peak={0.55} />
      <ChapterCard index={4} title="撞墙" en="THE POWER WALL" color={C.red} dur={80} />
      <Captions
        accent={"#ff6b5a"}
        items={[
          { from: 84, to: 200, text: "但在2005年前后，{{一堵墙}}挡在了面前。" },
          { from: 210, to: 330, text: "单核频率卡在了{{几GHz}}，再也提不上去。" },
          { from: 335, to: 492, text: "再提频率就太烫了——照老路走，芯片会热得{{堪比核反应堆}}。" },
          { from: 500, to: DUR - 12, text: "一个核心跑不快了，那就让{{很多核心一起跑}}。", accent: C.cyan },
        ]}
      />
    </AbsoluteFill>
  );
};

