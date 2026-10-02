import React from "react";
import { GLYPHS } from "../lib/glyphPaths";

/** [offset 0..1 along the gradient, colour, opacity] */
export type GradStop = [number, string, number?];

export type GradLayer = {
  stops: GradStop[];
  /** CSS linear-gradient angle in degrees (90 = left→right, 180 = top→bottom). */
  angle?: number;
  /** Gradient length along its axis, in units of the text box (CSS background-size 200% → 2). */
  span?: number;
  /** Where the gradient starts along its axis, in box units (0 = the box edge; negative = before it). */
  offset?: number;
  /** CSS filter (only the first layer's is used: it applies to the whole text). */
  filter?: string;
  blend?: React.CSSProperties["mixBlendMode"];
  opacity?: number;
};

/** Endpoints of a gradient axis in objectBoundingBox units. */
export const gradAxis = (angle = 90, span = 1, offset = 0) => {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const sx = 0.5 - 0.5 * dx;
  const sy = 0.5 - 0.5 * dy;
  return { x1: sx + offset * dx, y1: sy + offset * dy, x2: sx + (offset + span) * dx, y2: sy + (offset + span) * dy };
};

export const GradDef: React.FC<{ id: string; layer: GradLayer }> = ({ id, layer }) => {
  const g = gradAxis(layer.angle, layer.span, layer.offset);
  return (
    <linearGradient id={id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      {layer.stops.map(([o, c, op], i) => (
        <stop key={i} offset={Math.min(1, Math.max(0, o))} stopColor={c} stopOpacity={op ?? 1} />
      ))}
    </linearGradient>
  );
};

export type FaceId = keyof typeof GLYPHS;
export type GlyphRun = ReturnType<typeof glyphRun>;

/** Lay out `text` in a face (px). CSS letter-spacing (in em) is added after every glyph, as in HTML. */
export const glyphRun = (faceId: FaceId, text: string, fontSize: number, letterSpacing = 0) => {
  const face = GLYPHS[faceId];
  const s = fontSize / face.upm;
  let x = 0;
  const glyphs: { x: number; d: string }[] = [];
  for (const ch of text) {
    const g = face.glyphs[ch];
    if (!g) throw new Error(`glyphPaths: no "${ch}" in ${faceId}; add it to scripts/glyph-paths.py`);
    glyphs.push({ x, d: g.d });
    x += g.adv * s + letterSpacing * fontSize;
  }
  return { glyphs, width: x, scale: s, ascent: face.ascent * s, descent: face.descent * s };
};

/** The glyph outlines of a run with its baseline starting at (x, y), in the current SVG user space. */
export const GlyphPaths: React.FC<{ run: GlyphRun; x?: number; y?: number; fill?: string }> = ({ run, x = 0, y = 0, fill }) => (
  <>
    {run.glyphs.map((g, i) => (
      <path key={i} fill={fill} transform={`translate(${x + g.x} ${y}) scale(${run.scale} ${-run.scale})`} d={g.d} />
    ))}
  </>
);

/**
 * Gradient-filled text, drawn as vector glyph outlines: each layer is a gradient rectangle clipped to the glyphs.
 * Never use CSS `background-clip: text` or SVG text with gradient fills here: in long multi-frame renders Chrome
 * draws large gradient-filled glyphs clipped, mis-scaled or not at all (single stills look fine).
 * Renders inline; its bottom edge sits on the text baseline. `id` must be unique on the page and stable.
 */
export const GradientText: React.FC<{
  id: string;
  text: string;
  face: FaceId;
  fontSize: number;
  letterSpacing?: number;
  layers: GradLayer[];
  style?: React.CSSProperties;
}> = ({ id, text, face, fontSize, letterSpacing = 0, layers, style }) => {
  const run = glyphRun(face, text, fontSize, letterSpacing);
  const h = run.ascent + run.descent;
  return (
    <svg
      width={run.width}
      height={run.ascent}
      viewBox={`0 ${-run.ascent} ${run.width} ${run.ascent}`}
      style={{ display: "inline-block", verticalAlign: "baseline", overflow: "visible", filter: layers[0]?.filter, ...style }}
    >
      <defs>
        <clipPath id={`${id}-clip`}>
          <GlyphPaths run={run} />
        </clipPath>
        {layers.map((l, i) => (
          <GradDef key={i} id={`${id}-${i}`} layer={l} />
        ))}
      </defs>
      {layers.map((l, i) => (
        <rect
          key={i}
          x={0}
          y={-run.ascent}
          width={run.width}
          height={h}
          fill={`url(#${id}-${i})`}
          clipPath={`url(#${id}-clip)`}
          opacity={l.opacity}
          style={{ mixBlendMode: l.blend }}
        />
      ))}
    </svg>
  );
};
