import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, glowStroke, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmtCN, hash, hash2, noise1, prog, shake, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { YearStamp, Flash } from "../components/Hud";
import { Glitch } from "../components/Glitch";
import { cue, sceneDuration } from "../timeline";

const IGNITE = cue("coldopen", "ignite");
const CUT = cue("coldopen", "cut");
const END = sceneDuration("coldopen");

/** Filament brightness: stutters on like an old bulb, then breathes. */
const filamentHeat = (f: number, start: number) => {
  const t = f - start;
  if (t < 0) return 0;
  if (t < 26) {
    const on = hash(Math.floor(t / 2) * 3.7 + start) > 0.55 - t / 40;
    return on ? 0.35 + 0.5 * (t / 26) : 0.05;
  }
  return 0.88 + 0.12 * noise1(f * 0.15 + start);
};

const drawFilament = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, heat: number, alpha: number) => {
  if (heat <= 0.01 || alpha <= 0.01) return;
  const col = mix(C.ember, C.warm, heat);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, x, y, 90 * s * (0.6 + heat), C.ember, 0.55 * heat * alpha, 0.05);
  glow(ctx, x, y, 34 * s * (0.7 + heat), C.amber, 0.9 * heat * alpha, 0.12);
  if (s > 0.35) {
    const L = 46 * s;
    const wv = 7 * s;
    glowStroke(
      ctx,
      () => {
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const px = x + Math.sin(t * TAU * 6) * wv;
          const py = y - L / 2 + t * L;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      },
      col,
      Math.max(0.8, 1.6 * s),
      heat * alpha,
    );
    // support wires + glass hint
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = withAlpha("#8a6a50", 0.35 * alpha);
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(x - wv, y + L / 2);
    ctx.lineTo(x - wv * 1.4, y + L * 1.6);
    ctx.moveTo(x + wv, y + L / 2);
    ctx.lineTo(x + wv * 1.4, y + L * 1.6);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(C.warm, 0.12 * alpha * heat);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(x, y + L * 0.2, L * 0.9, L * 1.8, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
};

const EniacField: React.FC = () => {
  return (
    <Canvas
      draw={(ctx, w, h, f) => {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2 - 40;
        // camera pulls back from one filament to a whole wall of them
        const z = prog(f, IGNITE + 30, CUT - 10);
        const s = Math.exp(Math.log(7) * (1 - ease.inOutCubic(z)));
        const spacing = 92;
        const cols = 26;
        const rows = 16;
        const PULSE = CUT - 50; // the wall throbs in anticipation of the cut
        const pulse = f > PULSE ? 0.5 + 0.5 * Math.sin((f - PULSE) * 0.5) : 0;
        for (let j = -rows; j <= rows; j++) {
          for (let i = -cols; i <= cols; i++) {
            const x = cx + i * spacing * s;
            const y = cy + j * spacing * 1.1 * s;
            if (x < -80 || x > w + 80 || y < -80 || y > h + 80) continue;
            const d = Math.hypot(i, j);
            // the rest of the wall catches fire outward from the first filament
            const start = i === 0 && j === 0 ? IGNITE : IGNITE + 47 + d * 8 + hash2(i, j) * 27;
            const heat = filamentHeat(f, start) * (0.75 + 0.25 * hash2(i + 9, j));
            drawFilament(ctx, x, y, s * 0.9, heat * (1 + pulse * 0.25), i === 0 && j === 0 ? 1 : 0.85);
          }
        }
      }}
    />
  );
};

const Phone: React.FC = () => {
  const frame = useCurrentFrame() - CUT;
  const draw = ease.outExpo(prog(frame, 0, 26));
  const ops = 3.5e13 * ease.outQuart(prog(frame, 6, 70));
  return (
    <AbsoluteFill>
      <Canvas
        draw={(ctx, w, h) => {
          const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
          g.addColorStop(0, "#071a33");
          g.addColorStop(1, "#010309");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          const cx = w / 2;
          const cy = h / 2 - 40;
          const pw = 330;
          const ph = 660;
          // swirling compute storm inside the phone
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 48);
          ctx.clip();
          ctx.globalCompositeOperation = "lighter";
          const n = 1400;
          for (let i = 0; i < n; i++) {
            const r0 = hash(i * 1.31);
            const a0 = hash(i * 7.77) * TAU;
            const sp = 0.02 + 0.06 * (1 - r0);
            const rad = 20 + r0 * 420;
            const a = a0 + frame * sp * (1 + 2 * draw);
            const x = cx + Math.cos(a) * rad * 0.62;
            const y = cy + Math.sin(a) * rad * 1.05;
            const col = i % 7 === 0 ? C.magenta : i % 3 === 0 ? C.blue : C.cyan;
            glow(ctx, x, y, 5 + 9 * hash(i * 3.3), col, 0.55 * draw);
          }
          glow(ctx, cx, cy, 380, C.cyan, 0.25 * draw, 0.02);
          ctx.restore();
          // outline drawn on
          ctx.globalCompositeOperation = "lighter";
          const per = 2 * (pw + ph);
          ctx.setLineDash([per * draw, per]);
          glowStroke(ctx, () => ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 48), C.ice, 3, 1);
          ctx.setLineDash([]);
          glowStroke(ctx, () => ctx.roundRect(cx - 40, cy - ph / 2 + 18, 80, 18, 9), C.ice, 1.5, draw);
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 400,
          textAlign: "center",
          fontFamily: FONT_CN,
          fontWeight: 900,
          fontSize: 76,
          color: "#fff",
          textShadow: `0 0 24px ${C.cyan}, 0 0 4px #000`,
          opacity: draw,
        }}
      >
        {fmtCN(ops)}
        <div style={{ fontFamily: FONT_CN, fontSize: 24, fontWeight: 700, color: C.ice, marginTop: 4, letterSpacing: "0.2em" }}>
          次运算 / 秒
        </div>
      </div>
      {/* left/right spec cards */}
      <Spec x={170} label="ENIAC · 1946" lines={["30 吨", "5,000 次 / 秒"]} color={C.amber} t={prog(frame, 14, 34)} />
      <Spec x={1350} label="智能手机 · 今天" lines={["约 0.2 千克", "约 35 万亿次 / 秒"]} color={C.cyan} t={prog(frame, 22, 42)} />
    </AbsoluteFill>
  );
};

const Spec: React.FC<{ x: number; label: string; lines: string[]; color: string; t: number }> = ({ x, label, lines, color, t }) => {
  const e = ease.outCubic(clamp(t));
  return (
    <div style={{ position: "absolute", left: x, top: 330, width: 400, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 22, letterSpacing: "0.2em", color }}>{label}</div>
      <div style={{ height: 2, width: 300 * e, background: color, margin: "12px 0 18px", boxShadow: `0 0 10px ${color}` }} />
      {lines.map((l) => (
        <div key={l} style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 40, color: "#fff", marginBottom: 8 }}>
          {l}
        </div>
      ))}
    </div>
  );
};

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = shake(frame, CUT, 18, 18);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
        {frame < CUT ? <EniacField /> : <Phone />}
      </AbsoluteFill>
      {frame < CUT ? <YearStamp year="1946" label="美国 · 宾夕法尼亚大学" from={IGNITE + 10} to={CUT} /> : null}
      <Captions
        accent={frame < CUT ? C.amber : C.cyan}
        items={[
          // the three ENIAC lines are packed back-to-back (4-frame gaps) so the last one lands on the cut
          { from: IGNITE + 12, to: CUT - 171, text: "1946年，第一台通用电子计算机 {{ENIAC}} 诞生。" },
          { from: CUT - 167, to: CUT - 82, text: "它重达{{30吨}}，塞满了一整个房间，" },
          { from: CUT - 78, to: CUT, text: "每秒，却只能做{{5000次}}加法。" },
          { from: CUT + 17, to: END - 2, text: "今天，你口袋里的手机比它快了{{几十亿倍}}。", accent: C.cyan },
        ]}
      />
      <Glitch at={CUT} before={5} after={12} />
      <Flash at={CUT} dur={10} color={C.ice} peak={0.6} />
    </AbsoluteFill>
  );
};
