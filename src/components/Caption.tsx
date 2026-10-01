import React from "react";
import { useCurrentFrame } from "remotion";
import { C, FONT_CN } from "../lib/theme";
import { clamp, ease, prog } from "../lib/math";

export type Cap = {
  from: number;
  to: number;
  text: string; // `{{...}}` marks the highlighted part
  accent?: string;
  size?: number;
  y?: number; // vertical centre of the line, px
};

type Seg = { ch: string; hi: boolean };

const parse = (text: string): Seg[] => {
  const out: Seg[] = [];
  let hi = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{{", i)) {
      hi = true;
      i++;
      continue;
    }
    if (text.startsWith("}}", i)) {
      hi = false;
      i++;
      continue;
    }
    out.push({ ch: text[i], hi });
  }
  return out;
};

const Line: React.FC<{ cap: Cap; accent: string }> = ({ cap, accent }) => {
  const frame = useCurrentFrame();
  const segs = parse(cap.text);
  const size = cap.size ?? 54;
  const local = frame - cap.from;
  const exit = prog(frame, cap.to - 12, cap.to);
  const stagger = Math.min(1.4, 26 / Math.max(1, segs.length));
  const col = cap.accent ?? accent;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (cap.y ?? 905) - size * 0.7,
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
        padding: "0 160px",
        fontFamily: FONT_CN,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.04em",
        lineHeight: 1.35,
        color: "#eef2f8",
        opacity: 1 - ease.inQuad(exit),
        transform: `translateY(${-14 * ease.inCubic(exit)}px)`,
        filter: exit > 0 ? `blur(${6 * exit}px)` : undefined,
        whiteSpace: "pre",
      }}
    >
      {segs.map((s, i) => {
        const t = ease.outCubic(clamp((local - i * stagger) / 11));
        const hiPulse = s.hi ? 0.6 + 0.4 * Math.sin((local - i * stagger) * 0.12) : 0;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: t,
              transform: `translateY(${(1 - t) * 22}px) scale(${s.hi ? 1 + (1 - t) * 0.5 : 1})`,
              filter: t < 1 ? `blur(${(1 - t) * 10}px)` : undefined,
              color: s.hi ? col : undefined,
              fontWeight: s.hi ? 900 : 700,
              textShadow: s.hi
                ? `0 0 ${18 + 14 * hiPulse}px ${col}, 0 0 4px ${col}, 0 4px 18px rgba(0,0,0,0.9)`
                : "0 2px 4px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.85)",
            }}
          >
            {s.ch}
          </span>
        );
      })}
    </div>
  );
};

/** Cinematic captions: per-glyph blur-in, highlighted keywords glow in the scene accent. */
export const Captions: React.FC<{ items: Cap[]; accent?: string; band?: boolean }> = ({
  items,
  accent = C.amber,
  band = true,
}) => {
  const frame = useCurrentFrame();
  const active = items.filter((c) => frame >= c.from && frame < c.to);
  const bandA = active.length && band ? Math.min(1, ...active.map((c) => Math.min((frame - c.from) / 10, (c.to - frame) / 10))) : 0;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {band ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 360,
            opacity: clamp(bandA) * 0.85,
            background: "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.35) 45%, rgba(0,0,0,0))",
          }}
        />
      ) : null}
      {active.map((c, i) => (
        <Line key={`${c.from}-${i}`} cap={c} accent={accent} />
      ))}
    </div>
  );
};
