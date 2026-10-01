import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fadeInOut, hash, prog } from "../lib/math";
import { Canvas } from "../lib/canvas";

/** Top-left era stamp: big year + place, typed in. */
export const YearStamp: React.FC<{
  year: string;
  label: string;
  from?: number;
  to?: number;
  color?: string;
}> = ({ year, label, from = 0, to = 99999, color = C.amber }) => {
  const frame = useCurrentFrame();
  const a = fadeInOut(frame, from, to, 10, 15);
  if (a <= 0) return null;
  const typed = Math.floor(clamp((frame - from - 6) / 18) * label.length);
  const yearT = ease.outExpo(prog(frame, from, from + 20));
  return (
    <div style={{ position: "absolute", left: 96, top: 74, opacity: a }}>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 64,
          letterSpacing: "0.06em",
          color: "#fff",
          textShadow: `0 0 24px ${color}, 0 2px 6px #000, 0 0 30px #000`,
          transform: `translateX(${(1 - yearT) * -40}px)`,
        }}
      >
        {year}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
        <div
          style={{
            width: 10,
            height: 10,
            background: color,
            boxShadow: `0 0 12px ${color}`,
            opacity: Math.floor(frame / 8) % 2 ? 1 : 0.25,
          }}
        />
        <div style={{ fontFamily: FONT_CN, fontSize: 26, fontWeight: 400, color: "rgba(255,255,255,0.88)", letterSpacing: "0.12em", textShadow: "0 1px 4px #000, 0 0 16px #000" }}>
          {label.slice(0, typed)}
        </div>
      </div>
      <div style={{ marginTop: 14, height: 2, width: 280 * yearT, background: `linear-gradient(90deg, ${color}, transparent)` }} />
    </div>
  );
};

/** Chapter title that slams in at scene start. */
export const ChapterCard: React.FC<{
  index: number;
  title: string;
  en: string;
  from?: number;
  dur?: number;
  color?: string;
}> = ({ index, title, en, from = 0, dur = 95, color = C.amber }) => {
  const frame = useCurrentFrame() - from;
  if (frame < 0 || frame > dur) return null;
  const a = Math.min(clamp(frame / 6), 1 - prog(frame, dur - 18, dur));
  const line = ease.outExpo(prog(frame, 0, 26));
  const tIn = ease.outCubic(prog(frame, 4, 24));
  const spread = 0.6 * (1 - ease.outExpo(prog(frame, 2, 40)));
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: a }}>
      <div style={{ position: "relative", textAlign: "center", transform: `scale(${1 + 0.04 * prog(frame, 0, dur)})` }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: `${0.5 + spread}em`,
            color,
            textShadow: `0 0 18px ${color}`,
            opacity: tIn,
          }}
        >
          CHAPTER {String(index).padStart(2, "0")}
        </div>
        <div style={{ margin: "20px auto", height: 2, width: 760 * line, background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
        <div
          style={{
            fontFamily: FONT_CN,
            fontWeight: 900,
            fontSize: 112,
            color: "#fff",
            letterSpacing: `${0.12 + spread * 0.6}em`,
            textShadow: `0 0 40px ${color}, 0 0 8px rgba(255,255,255,0.6)`,
            opacity: tIn,
            filter: `blur(${(1 - tIn) * 14}px)`,
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: FONT_MONO,
            fontSize: 24,
            letterSpacing: "0.4em",
            color: "rgba(255,255,255,0.6)",
            opacity: ease.outCubic(prog(frame, 14, 34)),
          }}
        >
          {en}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** A HUD label with a leader line pointing at (x, y). */
export const Callout: React.FC<{
  x: number;
  y: number;
  dx: number;
  dy: number;
  text: string;
  sub?: string;
  from: number;
  to?: number;
  color?: string;
  align?: "left" | "right";
}> = ({ x, y, dx, dy, text, sub, from, to = 99999, color = C.amber, align }) => {
  const frame = useCurrentFrame();
  const a = fadeInOut(frame, from, to, 8, 10);
  if (a <= 0) return null;
  const t = ease.outCubic(prog(frame, from, from + 16));
  const ex = x + dx;
  const ey = y + dy;
  const side = align ?? (dx >= 0 ? "left" : "right");
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle cx={x} cy={y} r={6} fill="none" stroke={color} strokeWidth={2} />
        <circle cx={x} cy={y} r={2.5} fill={color} />
        <polyline
          points={`${x},${y} ${x + (ex - x) * t},${y + (ey - y) * t}`}
          stroke={color}
          strokeWidth={1.5}
          fill="none"
          opacity={0.9}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: side === "left" ? ex + 12 : undefined,
          right: side === "right" ? 1920 - ex + 12 : undefined,
          top: ey - 22,
          textAlign: side,
          opacity: ease.outCubic(prog(frame, from + 8, from + 22)),
        }}
      >
        <div style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "#fff", textShadow: `0 0 14px ${color}` }}>{text}</div>
        {sub ? (
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, color, letterSpacing: "0.12em", marginTop: 2 }}>{sub}</div>
        ) : null}
      </div>
    </div>
  );
};

/** Full-screen colour flash. */
export const Flash: React.FC<{ at: number; dur?: number; color?: string; peak?: number }> = ({
  at,
  dur = 14,
  color = "#fff",
  peak = 0.9,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -2 || t > dur) return null;
  const a = t < 0 ? (t + 2) / 2 : Math.pow(1 - t / dur, 2.2);
  return <AbsoluteFill style={{ background: color, opacity: a * peak, mixBlendMode: "screen" }} />;
};

/** Film grain + vignette + subtle scanlines, drawn on top of everything. */
export const FilmLook: React.FC<{ grain?: number; vignette?: number }> = ({ grain = 0.07, vignette = 0.75 }) => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${vignette}) 100%)`,
        }}
      />
      <Canvas
        draw={(ctx, w, h, frame) => {
          const tile = grainTile();
          const ox = Math.floor(hash(frame * 1.7) * 256);
          const oy = Math.floor(hash(frame * 3.1 + 5) * 256);
          ctx.globalAlpha = grain;
          ctx.globalCompositeOperation = "source-over";
          for (let y = -oy; y < h; y += 256) for (let x = -ox; x < w; x += 256) ctx.drawImage(tile, x, y);
        }}
        style={{ mixBlendMode: "overlay" }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 4px)",
        }}
      />
    </AbsoluteFill>
  );
};

let grainCanvas: HTMLCanvasElement | null = null;
const grainTile = () => {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = Math.floor(hash(i * 0.731 + 0.17) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
};

/** Thin tech frame: corner brackets + a progress tick. */
export const Brackets: React.FC<{ color?: string; opacity?: number }> = ({ color = "rgba(255,255,255,0.5)", opacity = 1 }) => {
  const s = 34;
  const m = 46;
  const st: React.CSSProperties = { position: "absolute", width: s, height: s, borderColor: color, borderStyle: "solid", borderWidth: 0 };
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <div style={{ ...st, left: m, top: m, borderLeftWidth: 2, borderTopWidth: 2 }} />
      <div style={{ ...st, right: m, top: m, borderRightWidth: 2, borderTopWidth: 2 }} />
      <div style={{ ...st, left: m, bottom: m, borderLeftWidth: 2, borderBottomWidth: 2 }} />
      <div style={{ ...st, right: m, bottom: m, borderRightWidth: 2, borderBottomWidth: 2 }} />
    </AbsoluteFill>
  );
};
