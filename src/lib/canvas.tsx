import React, { useLayoutEffect, useRef } from "react";
import { useCurrentFrame } from "remotion";

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) => void;

/**
 * A full-frame <canvas> that is repainted synchronously on every frame.
 * Drawing must be a pure function of the frame so renders are deterministic.
 */
export const Canvas: React.FC<{
  draw: Draw;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}> = ({ draw, width = 1920, height = 1080, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, frame);
  });
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, width, height, ...style }}
    />
  );
};

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Soft radial glow sprite (white-hot core fading into `color`). Cached per color. */
export const glowSprite = (color: string, core = 0.18, size = 128) => {
  const key = `${color}|${core}|${size}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(core, withAlpha(color, 0.95));
  grad.addColorStop(Math.min(0.95, core + 0.22), withAlpha(color, 0.35));
  grad.addColorStop(Math.min(0.97, core + 0.5), withAlpha(color, 0.08));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
};

/** Draw an additive glow dot centred at (x, y) with radius r. */
export const glow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
  core = 0.18,
) => {
  if (alpha <= 0.002 || r <= 0.05) return;
  const s = glowSprite(color, core);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, alpha);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
};

const parsed = new Map<string, [number, number, number]>();
export const rgbOf = (color: string): [number, number, number] => {
  const hit = parsed.get(color);
  if (hit) return hit;
  let out: [number, number, number] = [255, 255, 255];
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
    out = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  } else {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(",").map((s) => parseFloat(s));
      out = [p[0], p[1], p[2]];
    }
  }
  parsed.set(color, out);
  return out;
};

export const withAlpha = (color: string, a: number) => {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r},${g},${b},${a})`;
};

export const mix = (c1: string, c2: string, t: number) => {
  const a = rgbOf(c1);
  const b = rgbOf(c2);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(
    a[2] + (b[2] - a[2]) * k,
  )})`;
};

/** Glowing stroke: a wide faint pass, then a thin bright pass. */
export const glowStroke = (
  ctx: CanvasRenderingContext2D,
  path: () => void,
  color: string,
  width: number,
  alpha = 1,
) => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(color, 0.12 * alpha);
  ctx.lineWidth = width * 7;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, 0.3 * alpha);
  ctx.lineWidth = width * 3;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.strokeStyle = withAlpha(mix(color, "#ffffff", 0.55), alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
};
