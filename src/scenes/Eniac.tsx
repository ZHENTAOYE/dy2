import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, fmt, hash, lerp, noise1, prog, shake, sumShake } from "../lib/math";
import { camera, project } from "../lib/three";
import { Captions } from "../components/Caption";
import { Flash } from "../components/Hud";
import { cue, sceneDuration } from "../timeline";

const DUR = sceneDuration("eniac");
const BURNS = [cue("eniac", "burn1"), cue("eniac", "burn2"), cue("eniac", "burn3")];
const DARK = cue("eniac", "dark");
const EXTEND = BURNS[2] + 10; // the room starts growing right after the third burn-out
const PULL = 212; // opening pull-back from one tube to the whole room
const GROW = 132; // camera rise / pull-back while the room extends

const HALF_W = 6; // room half width
const BACK_Z0 = 30; // back wall depth before the room "extends"
const ROWS = 11;
const SP = 0.26; // tube spacing
const TOP_Y = -1.35;

// burn-out tubes sit on the back wall, near the centre of the view
const BURN_TUBES = [
  { x: -1.3, y: TOP_Y + 3 * SP },
  { x: 1.82, y: TOP_Y + 6 * SP },
  { x: 0.26, y: TOP_Y + 9 * SP },
];

const START = { x: 0.26, y: TOP_Y + 5 * SP, z: BACK_Z0 };
const HALLS = [0, -13, 13, -26, 26];

const camAt = (f: number) => {
  const a = ease.inOutCubic(prog(f, 0, PULL));
  const b = ease.inOutCubic(prog(f, EXTEND, EXTEND + GROW));
  return camera({
    x: lerp(START.x, 0, a) + Math.sin(f * 0.01) * 0.25 * a,
    y: lerp(START.y, 0.1, a) + lerp(0, -15, b),
    z: lerp(BACK_Z0 - 0.55, -1, a) + lerp(0, -20, b),
    pitch: lerp(0, 0.5, b),
    yaw: Math.sin(f * 0.006) * 0.03 * a,
    f: 950,
  });
};

const backZ = (f: number) => BACK_Z0 + 34 * ease.inOutCubic(prog(f, EXTEND, EXTEND + GROW - 8));

/** Tube brightness incl. ignition, computation waves, burn-outs and the final power-down. */
const tubeLevel = (f: number, id: number, X: number, Y: number, z: number, hall: number, isBurn: number) => {
  let ign: number;
  if (hall === 0) {
    const d = Math.hypot(X - START.x, Y - START.y, z - START.z);
    ign = clamp((f + 5 - d * 3.2 - hash(id) * 8) / 8);
    if (z > BACK_Z0 + 0.5) ign = clamp((f - EXTEND - (z - BACK_Z0) * 2.35 - hash(id) * 8) / 8);
  } else {
    ign = clamp((f - EXTEND - 8 - Math.abs(hall) * 1.25 - z * 1.1 - hash(id) * 11) / 10);
  }
  const comp = 0.62 + 0.25 * noise1(f * 0.22 + id * 0.37) + 0.25 * Math.max(0, Math.sin(z * 0.6 - f * 0.18 + hall));
  let v = ign * comp;
  if (isBurn >= 0) {
    const t = f - BURNS[isBurn];
    if (t >= 0) v = t < 6 ? 2.6 : t < 14 ? (hash(f * 3.3) > 0.5 ? 1.2 : 0.1) : 0.04;
  }
  // power-down wave rolls from the far end toward the camera
  const dark = clamp((f - DARK - (70 - z) * 0.9) / 16);
  return v * (1 - dark);
};

const Room: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const cam = camAt(f);
      const bz = backZ(f);
      ctx.fillStyle = "#030203";
      ctx.fillRect(0, 0, w, h);
      // floor grid
      ctx.strokeStyle = "rgba(255,150,60,0.07)";
      ctx.lineWidth = 1;
      const gx = f > EXTEND ? 34 : HALF_W;
      for (let x = -gx; x <= gx; x += 1) {
        const a = project(cam, x, 1.6, 0.5);
        const b = project(cam, x, 1.6, 64);
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (let z = 1; z <= 64; z += 1.5) {
        const a = project(cam, -gx, 1.6, z);
        const b = project(cam, gx, 1.6, z);
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const quad = (pts: [number, number, number][], fill: string, stroke: string) => {
        const P = pts.map((p) => project(cam, p[0], p[1], p[2]));
        if (P.some((p) => !p)) return;
        ctx.beginPath();
        P.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y)));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.stroke();
      };
      const PY0 = TOP_Y - 0.35;
      const PY1 = 1.6;
      const halls = HALLS.filter((hx) => hx === 0 || f > EXTEND);
      for (const hx of halls) {
        const hz = hx === 0 ? bz : 64;
        for (let z = 1; z < hz; z += 2) {
          for (const sx of [-HALF_W, HALF_W]) {
            quad(
              [
                [hx + sx, PY0, z],
                [hx + sx, PY0, z + 1.94],
                [hx + sx, PY1, z + 1.94],
                [hx + sx, PY1, z],
              ],
              "rgba(16,10,7,0.95)",
              "rgba(255,166,61,0.18)",
            );
          }
        }
        for (let x = -HALF_W; x < HALF_W; x += 2) {
          quad(
            [
              [hx + x, PY0, hz],
              [hx + x + 1.94, PY0, hz],
              [hx + x + 1.94, PY1, hz],
              [hx + x, PY1, hz],
            ],
            "rgba(16,10,7,0.95)",
            "rgba(255,166,61,0.18)",
          );
        }
      }
      ctx.globalCompositeOperation = "lighter";
      const drawTube = (X: number, Y: number, Z: number, id: number, hall: number, burn: number) => {
        const p = project(cam, X, Y, Z);
        if (!p || p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) return;
        const lod = p.s < 16;
        if (lod && id % 2) return;
        const v = tubeLevel(f, id, X - hall, Y, Z, hall, burn);
        if (v <= 0.01) return;
        const r = Math.max(1.4, 0.11 * p.s) * (lod ? 1.5 : 1);
        const fog = clamp(1.25 - p.z / 80);
        const col = burn >= 0 && f >= BURNS[burn] && f < BURNS[burn] + 6 ? C.white : mix(C.ember, C.warm, clamp(v - 0.3));
        glow(ctx, p.x, p.y, r * (1.6 + v), col, Math.min(1, v) * fog);
        if (p.s > 120) glow(ctx, p.x, p.y, r * 6, C.ember, 0.18 * v * fog, 0.05);
      };
      let id = 0;
      for (const hx of halls) {
        const hz = hx === 0 ? bz : 64;
        for (let z = 1.15; z < hz; z += SP) {
          for (let r = 0; r < ROWS; r++) {
            const y = TOP_Y + r * SP;
            drawTube(hx - HALF_W + 0.05, y, z, id++, hx, -1);
            drawTube(hx + HALF_W - 0.05, y, z, id++, hx, -1);
          }
        }
        for (let x = -HALF_W + 0.2; x < HALF_W; x += SP) {
          for (let r = 0; r < ROWS; r++) {
            const y = TOP_Y + r * SP;
            const bi = hx === 0 ? BURN_TUBES.findIndex((b) => Math.abs(b.x - x) < 0.05 && Math.abs(b.y - y) < 0.05) : -1;
            drawTube(hx + x, y, hz - 0.05, 100000 + id++, hx, bi);
          }
        }
      }
      // burn-out sparks
      BURN_TUBES.forEach((b, k) => {
        const t = f - BURNS[k];
        if (t < 0 || t > 60) return;
        const p = project(cam, b.x, b.y, bz - 0.05);
        if (!p) return;
        glow(ctx, p.x, p.y, 120 * Math.exp(-t / 6), C.white, Math.exp(-t / 8));
        for (let i = 0; i < 40; i++) {
          const a = hash(i * 3.1 + k) * Math.PI * 2;
          const v = 2 + hash(i * 7.3 + k) * 9;
          const x = p.x + Math.cos(a) * v * t;
          const y = p.y + Math.sin(a) * v * t + 0.25 * t * t;
          glow(ctx, x, y, 4, C.gold, Math.exp(-t / 12));
        }
      });
    }}
  />
);

/** Screen-space alarm markers around each burnt tube. */
const BurnMarkers: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame);
  const bz = backZ(frame);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      {BURN_TUBES.map((b, k) => {
        const t = frame - BURNS[k];
        if (t < 0 || frame > EXTEND + 10) return null;
        const p = project(cam, b.x, b.y, bz - 0.05);
        if (!p) return null;
        const a = clamp(t / 4) * (1 - prog(frame, EXTEND - 15, EXTEND + 10));
        const r = 26 + 40 * Math.exp(-t / 8);
        const blink = Math.floor(t / 6) % 2 ? 0.45 : 1; // open on the bright phase so each label reads at once
        const latest = BURNS.filter((b2) => frame >= b2).length - 1 === k;
        const ly = [-90, 80, -150][k];
        return (
          <g key={k} opacity={a * blink}>
            <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={C.red} strokeWidth={3} />
            {latest ? (
              <>
                <line x1={p.x + r * 0.7} y1={p.y + Math.sign(ly) * r * 0.7} x2={p.x + 110} y2={p.y + ly} stroke={C.red} strokeWidth={2} />
                <text x={p.x + 118} y={p.y + ly - 4} fill={C.red} fontFamily={FONT_MONO} fontWeight={800} fontSize={26}>
                  TUBE FAILURE #{k + 1}
                </text>
                <text x={p.x + 118} y={p.y + ly + 26} fill="#ffb0b0" fontFamily={FONT_CN} fontWeight={700} fontSize={24}>
                  灯丝烧断
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, number, string, number][] = [
    ["真空管", 17468, "根", 32],
    ["重量", 30, "吨", 88],
    ["功耗", 150, "千瓦", 136],
    ["占地", 167, "平方米", 182],
  ];
  const a = 1 - prog(frame, EXTEND + 24, EXTEND + 55);
  return (
    <div style={{ position: "absolute", right: 96, top: 90, width: 420, opacity: a }}>
      {rows.map(([k, v, u, t0]) => {
        const t = ease.outCubic(prog(frame, t0, t0 + 40));
        if (t <= 0) return null;
        return (
          <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: `1px solid ${withAlpha(C.amber, 0.3)}`, padding: "10px 0", opacity: t, transform: `translateX(${(1 - t) * 40}px)` }}>
            <span style={{ fontFamily: FONT_CN, fontSize: 26, color: "rgba(255,255,255,0.75)", textShadow: "0 0 10px #000" }}>{k}</span>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 46, color: "#fff", textShadow: `0 0 18px ${C.amber}, 0 0 4px #000` }}>
              {fmt(v * t)}
              <span style={{ fontFamily: FONT_CN, fontSize: 22, fontWeight: 400, color: C.amber, marginLeft: 8 }}>{u}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const Eniac: React.FC = () => {
  const frame = useCurrentFrame();
  const sh = sumShake(...BURNS.map((b) => shake(frame, b, 10, 14)));
  const alarm = BURNS.reduce((acc, b) => acc + Math.exp(-Math.max(0, frame - b) / 20) * (frame >= b ? 1 : 0), 0);
  const inA = ease.outCubic(prog(frame, 0, 20));
  const out = prog(frame, DUR - 30, DUR);
  return (
    <AbsoluteFill style={{ background: "#030203", opacity: inA * (1 - out) }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
        <Room />
        <BurnMarkers />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(255,0,0,0) 40%, rgba(255,20,30,${0.45 * clamp(alarm)}) 100%)`,
        }}
      />
      <Stats />
      {BURNS.map((b) => (
        <Flash key={b} at={b} dur={8} color={C.red} peak={0.25} />
      ))}
      <Captions
        accent={C.amber}
        items={[
          { from: 22, to: 112, text: "ENIAC 里装了{{17468根}}真空管，" },
          { from: 116, to: 223, text: "耗电{{150千瓦}}，相当于上百户人家同时用电。" },
          { from: BURNS[0] - 27, to: BURNS[2] + 5, text: "灯丝会烧断，{{几乎每天都有管子坏掉}}。", accent: "#ff6b5a" },
          { from: EXTEND, to: DARK - 24, text: "想要更强？只能塞进{{更多的管子、更大的房间}}——" },
          { from: DARK - 20, to: DUR - 10, text: "这条路，{{走到头了}}。" },
        ]}
      />
    </AbsoluteFill>
  );
};

