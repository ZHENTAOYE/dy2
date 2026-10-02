import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, prog, rng, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { Callout, YearStamp } from "../components/Hud";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("litho");
const BEAM = cue("litho", "beam");
const WAFER = cue("litho", "wafer");
const DIVE = cue("litho", "dive");

const UV = "#9b6bff";
// mask pattern: 1 = transparent slit
const MASK = [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1];

let dieCache: HTMLCanvasElement | null = null;
/** A procedurally generated "chip layout" used for every die. */
const diePattern = () => {
  if (dieCache) return dieCache;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rng(7);
  g.fillStyle = "rgba(0,0,0,0)";
  g.fillRect(0, 0, S, S);
  // functional blocks
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * 7) * 64 + 16;
    const y = Math.floor(r() * 7) * 64 + 16;
    const w = 64 * (1 + Math.floor(r() * 2)) - 16;
    const h = 64 * (1 + Math.floor(r() * 2)) - 16;
    g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.strokeRect(x + 0.5, y + 0.5, w, h);
    // cell rows
    g.fillStyle = "rgba(255,255,255,0.25)";
    for (let yy = y + 6; yy < y + h - 4; yy += 6) g.fillRect(x + 4, yy, w - 8, 2);
  }
  // routing
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 2;
  for (let i = 0; i < 60; i++) {
    let x = Math.floor(r() * 32) * 16;
    let y = Math.floor(r() * 32) * 16;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (k % 2) y = Math.floor(r() * 32) * 16;
      else x = Math.floor(r() * 32) * 16;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // pads
  g.fillStyle = "rgba(255,230,160,0.7)";
  for (let i = 8; i < S; i += 24) {
    g.fillRect(i, 2, 10, 8);
    g.fillRect(i, S - 10, 10, 8);
    g.fillRect(2, i, 8, 10);
    g.fillRect(S - 10, i, 8, 10);
  }
  dieCache = c;
  return c;
};

const R = 400;
const PITCH = 52;
/** Die positions in the stepper's serpentine exposure order. */
const DIES: [number, number][] = (() => {
  const out: [number, number][] = [];
  const n = Math.ceil(R / PITCH);
  for (let j = -n; j <= n; j++) {
    const row: [number, number][] = [];
    for (let i = -n; i <= n; i++) {
      const x = i * PITCH - PITCH / 2;
      const y = j * PITCH - PITCH / 2;
      const far = Math.max(Math.hypot(x, y), Math.hypot(x + PITCH, y), Math.hypot(x, y + PITCH), Math.hypot(x + PITCH, y + PITCH));
      if (far < R - 6) row.push([x, y]);
    }
    if ((j + n) % 2) row.reverse();
    out.push(...row);
  }
  return out;
})();

const Machine: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const vis = 1 - prog(f, WAFER - 30, WAFER);
      if (vis <= 0) return;
      ctx.globalAlpha = vis;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#07041a");
      g.addColorStop(1, "#020208");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const on = clamp((f - BEAM) / 20);
      const cx = 960;
      // lamp housing
      ctx.fillStyle = "#1a1530";
      ctx.strokeStyle = withAlpha(UV, 0.6);
      ctx.beginPath();
      ctx.moveTo(cx - 160, 70);
      ctx.lineTo(cx + 160, 70);
      ctx.lineTo(cx + 260, 160);
      ctx.lineTo(cx - 260, 160);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, cx, 150, 260, UV, 0.6 * on, 0.05);
      // collimated beam onto the mask
      const MY = 340;
      const bw = 520;
      const bg = ctx.createLinearGradient(0, 160, 0, MY);
      bg.addColorStop(0, withAlpha(UV, 0.55 * on));
      bg.addColorStop(1, withAlpha(UV, 0.3 * on));
      ctx.fillStyle = bg;
      ctx.fillRect(cx - bw / 2, 160, bw, MY - 160);
      // photons
      for (let i = 0; i < 120; i++) {
        const x = cx - bw / 2 + hash(i * 1.7) * bw;
        const y = 160 + ((hash(i * 3.3) * 180 + (f - BEAM) * 9) % 180);
        glow(ctx, x, y, 6, "#d9c8ff", 0.7 * on);
      }
      // mask plate
      ctx.globalCompositeOperation = "source-over";
      const sw = bw / MASK.length;
      ctx.fillStyle = "rgba(180,190,220,0.25)";
      ctx.fillRect(cx - bw / 2 - 40, MY, bw + 80, 14);
      MASK.forEach((m, i) => {
        if (!m) {
          ctx.fillStyle = "#0b0b14";
          ctx.fillRect(cx - bw / 2 + i * sw, MY, sw, 14);
        }
      });
      ctx.strokeStyle = "rgba(220,225,255,0.6)";
      ctx.strokeRect(cx - bw / 2 - 40, MY, bw + 80, 14);
      // shafts through slits converging through the lens to the wafer
      const LY = 520;
      const WY = 800;
      const red = 0.28; // 4x-ish reduction
      ctx.globalCompositeOperation = "lighter";
      MASK.forEach((m, i) => {
        if (!m) return;
        const x0 = cx - bw / 2 + i * sw;
        const x1 = x0 + sw;
        const wx0 = cx + (x0 - cx) * red;
        const wx1 = cx + (x1 - cx) * red;
        const sg = ctx.createLinearGradient(0, MY, 0, WY);
        sg.addColorStop(0, withAlpha(UV, 0.45 * on));
        sg.addColorStop(0.5, withAlpha(UV, 0.3 * on));
        sg.addColorStop(1, withAlpha("#c8b0ff", 0.65 * on));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(x0, MY + 14);
        ctx.lineTo(x1, MY + 14);
        ctx.lineTo(x1 + (x1 - cx) * 0.06, LY);
        ctx.lineTo(wx1, WY);
        ctx.lineTo(wx0, WY);
        ctx.lineTo(x0 + (x0 - cx) * 0.06, LY);
        ctx.closePath();
        ctx.fill();
      });
      // lens
      ctx.globalCompositeOperation = "source-over";
      const lg = ctx.createLinearGradient(0, LY - 40, 0, LY + 40);
      lg.addColorStop(0, "rgba(200,220,255,0.08)");
      lg.addColorStop(0.5, "rgba(220,235,255,0.28)");
      lg.addColorStop(1, "rgba(200,220,255,0.08)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(cx, LY, 330, 42, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(230,240,255,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // wafer slab with resist
      ctx.fillStyle = "#1b2433";
      ctx.fillRect(cx - 520, WY + 8, 1040, 50);
      ctx.fillStyle = "#3a2d5a";
      ctx.fillRect(cx - 520, WY, 1040, 8);
      ctx.strokeStyle = "rgba(200,210,240,0.5)";
      ctx.strokeRect(cx - 520, WY, 1040, 58);
      // exposed pattern burning into the resist
      const burn = clamp((f - BEAM - 30) / 64);
      ctx.globalCompositeOperation = "lighter";
      MASK.forEach((m, i) => {
        if (!m) return;
        const x0 = cx + (cx - bw / 2 + i * sw - cx) * red;
        glow(ctx, x0 + (sw * red) / 2, WY + 4, 26, "#e4d6ff", burn * on);
        ctx.fillStyle = withAlpha("#f0e8ff", 0.9 * burn);
        ctx.fillRect(x0, WY, sw * red, 8);
      });
      ctx.globalAlpha = 1;
    }}
  />
);

const WaferView: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const t = f - (WAFER - 30);
      if (t < 0) return;
      const a = clamp(t / 30);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#03030a";
      ctx.fillRect(0, 0, w, h);
      const cx = 960;
      const cy = 500;
      const pitch = PITCH;
      const dies = DIES;
      const dive = ease.inExpo(prog(f, DIVE, DUR));
      const zoom = Math.exp(Math.log(16) * dive);
      const tilt = 1 - 0.12 * (1 - ease.outCubic(clamp(t / 60)));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(zoom, zoom * tilt);
      ctx.rotate(lerp(-0.25, 0, ease.outCubic(clamp(t / 90))));
      // wafer disc
      const wg = ctx.createRadialGradient(-120, -160, 20, 0, 0, R);
      wg.addColorStop(0, "#5a6170");
      wg.addColorStop(0.6, "#2a2f3a");
      wg.addColorStop(1, "#171a22");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(220,230,255,0.6)";
      ctx.lineWidth = 2 / zoom;
      ctx.stroke();
      // dies exposed by the stepper in a serpentine path, accelerating
      const prog01 = ease.inQuad(prog(f, WAFER, DIVE - 20));
      const exposed = prog01 * dies.length;
      const pat = diePattern();
      dies.forEach(([x, y], k) => {
        const e = clamp(exposed - k);
        if (e <= 0) {
          ctx.fillStyle = "rgba(60,50,90,0.35)";
          ctx.fillRect(x + 2, y + 2, pitch - 4, pitch - 4);
          return;
        }
        const hue = (Math.atan2(y, x) * 57 + Math.hypot(x, y) * 0.5 + f * 1.2) % 360;
        ctx.fillStyle = `hsla(${hue}, 85%, ${45 + 10 * Math.sin((x + y) * 0.02 + f * 0.05)}%, ${0.55 * e})`;
        ctx.fillRect(x + 2, y + 2, pitch - 4, pitch - 4);
        ctx.globalAlpha = a * e;
        ctx.drawImage(pat, x + 2, y + 2, pitch - 4, pitch - 4);
        ctx.globalAlpha = a;
        // fresh-exposure flash
        const fl = clamp(1 - (exposed - k) / 3);
        if (fl > 0 && e > 0) {
          ctx.globalCompositeOperation = "lighter";
          glow(ctx, x + pitch / 2, y + pitch / 2, pitch * 1.6, UV, fl);
          ctx.globalCompositeOperation = "source-over";
        }
      });
      // sheen
      ctx.globalCompositeOperation = "lighter";
      const sg = ctx.createLinearGradient(-R, -R, R, R);
      const sh = (f * 0.004) % 1;
      sg.addColorStop(0, "rgba(255,255,255,0)");
      sg.addColorStop(clamp(sh), "rgba(255,255,255,0.12)");
      sg.addColorStop(clamp(sh + 0.1), "rgba(255,255,255,0)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      // during the dive, fade to a cyan circuit glow
      if (dive > 0.5) {
        ctx.fillStyle = withAlpha("#02040a", (dive - 0.5) * 2);
        ctx.fillRect(0, 0, w, h);
      }
    }}
  />
);

const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease.outCubic(prog(frame, WAFER + 10, WAFER + 30)) * (1 - prog(frame, DIVE, DIVE + 20));
  if (a <= 0) return null;
  const n = Math.min(DIES.length, Math.floor(ease.inQuad(prog(frame, WAFER, DIVE - 20)) * DIES.length + 0.999));
  return (
    <div style={{ position: "absolute", right: 110, top: 360, textAlign: "right", opacity: a }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 22, letterSpacing: "0.25em", color: UV }}>EXPOSED DIES</div>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 84, color: "#fff", textShadow: `0 0 24px ${UV}` }}>{n}</div>
      <div style={{ fontFamily: FONT_CN, fontSize: 24, color: "rgba(255,255,255,0.7)" }}>一片晶圆 · 上百颗芯片</div>
    </div>
  );
};

export const Litho: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Machine />
      <WaferView />
      {frame < WAFER - 20 ? (
        <>
          <Callout x={1220} y={130} dx={160} dy={-30} text="紫外光" sub="UV LIGHT" from={BEAM + 8} to={WAFER - 20} color={UV} />
          <Callout x={1260} y={347} dx={150} dy={0} text="掩模 · 电路图案" sub="PHOTOMASK" from={BEAM + 24} to={WAFER - 20} color={UV} />
          <Callout x={1290} y={520} dx={130} dy={40} text="透镜 · 缩小投影" sub="REDUCTION LENS" from={BEAM + 40} to={WAFER - 20} color={UV} />
          <Callout x={1480} y={808} dx={60} dy={-90} text="硅晶圆" sub="WAFER + PHOTORESIST" from={BEAM + 56} to={WAFER - 20} color={UV} />
        </>
      ) : null}
      <Counter />
      <YearStamp year="1958" label="集成电路诞生" from={6} to={WAFER - 20} color={UV} />
      <Captions
        accent={"#b99bff"}
        items={[
          { from: 10, to: WAFER - 126, text: "1958年，{{集成电路}}诞生了：" },
          { from: WAFER - 122, to: WAFER - 4, text: "把大量晶体管和导线，直接{{“印”在同一块硅片上}}。" },
          { from: WAFER, to: WAFER + 116, text: "以光为刀，像冲洗照片一样，{{一次印出成千上万个}}。" },
          // ends exactly on the dive cue: fully faded before the dive whoosh starts (dive = 54f = whoosh 1.8 s)
          { from: WAFER + 120, to: DIVE, text: "电路越印越精细，一块芯片上的晶体管{{越来越多}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};

