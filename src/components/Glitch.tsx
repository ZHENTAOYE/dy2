import React from "react";
import { useCurrentFrame } from "remotion";
import { Canvas } from "../lib/canvas";
import { hash } from "../lib/math";

/** Digital tear: coloured slices + block noise around frame `at`. */
export const Glitch: React.FC<{ at: number; before?: number; after?: number; strength?: number }> = ({
  at,
  before = 4,
  after = 10,
  strength = 1,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -before || t > after) return null;
  const k = strength * (t < 0 ? (t + before) / before : Math.pow(1 - t / after, 1.5));
  return (
    <Canvas
      draw={(ctx, w, h, f) => {
        const n = Math.floor(10 + 26 * k);
        for (let i = 0; i < n; i++) {
          const r1 = hash(f * 13.1 + i * 7.7);
          const r2 = hash(f * 3.3 + i * 1.9 + 4);
          const r3 = hash(f * 5.9 + i * 2.3 + 9);
          const y = r1 * h;
          const bh = 4 + r2 * 60 * k;
          const x = (r3 - 0.5) * 400 * k;
          const cols = ["rgba(56,214,255,", "rgba(255,62,200,", "rgba(255,255,255,", "rgba(255,166,61,"];
          ctx.fillStyle = cols[i % 4] + (0.12 + 0.5 * k * r2) + ")";
          ctx.fillRect(x, y, w * (0.3 + r1 * 0.9), bh);
        }
        // block noise
        const bs = 24;
        for (let i = 0; i < 160 * k; i++) {
          const bx = Math.floor(hash(f * 7 + i * 3.1) * (w / bs)) * bs;
          const by = Math.floor(hash(f * 11 + i * 5.3) * (h / bs)) * bs;
          const v = Math.floor(hash(f + i * 9.1) * 255);
          ctx.fillStyle = `rgba(${v},${v},${v},${0.5 * k})`;
          ctx.fillRect(bx, by, bs * (1 + Math.floor(hash(i * 2.2 + f) * 4)), bs);
        }
      }}
      style={{ mixBlendMode: "screen" }}
    />
  );
};
