import React from "react";

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
  /** CSS filter for this layer (e.g. drop-shadow glows). */
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

export const GradDef: React.FC<{ id: string; layer: GradLayer; units?: "objectBoundingBox" | "userSpaceOnUse" }> = ({
  id,
  layer,
  units = "objectBoundingBox",
}) => {
  const g = gradAxis(layer.angle, layer.span, layer.offset);
  return (
    <linearGradient id={id} gradientUnits={units} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      {layer.stops.map(([o, c, op], i) => (
        <stop key={i} offset={Math.min(1, Math.max(0, o))} stopColor={c} stopOpacity={op ?? 1} />
      ))}
    </linearGradient>
  );
};

/**
 * Gradient-filled text drawn as SVG. Replaces CSS `background-clip: text`, which Chrome sometimes stops
 * clipping during long multi-tab renders (the gradient then shows as a solid rectangle in the video).
 * A transparent copy of the text keeps the inline layout; each layer is an SVG <text> on top of it.
 * `id` must be unique on the page and stable across frames.
 */
export const GradientText: React.FC<{
  id: string;
  text: string;
  font: { fontFamily: string; fontWeight: number; fontSize: number; letterSpacing?: string | number };
  layers: GradLayer[];
  style?: React.CSSProperties;
}> = ({ id, text, font, layers, style }) => {
  const fontStyle: React.CSSProperties = { ...font, lineHeight: 1, whiteSpace: "pre" };
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      <span style={{ ...fontStyle, color: "transparent", textShadow: "none" }}>{text}</span>
      {layers.map((layer, i) => (
        <svg
          key={i}
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            overflow: "visible",
            filter: layer.filter,
            mixBlendMode: layer.blend,
            opacity: layer.opacity,
          }}
        >
          <defs>
            <GradDef id={`${id}-${i}`} layer={layer} />
          </defs>
          <text x={0} y="50%" dominantBaseline="central" fill={`url(#${id}-${i})`} style={fontStyle}>
            {text}
          </text>
        </svg>
      ))}
    </span>
  );
};
