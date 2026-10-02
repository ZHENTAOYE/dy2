// Camera path + world layout for the ZoomOut scene (one continuous "Powers of Ten" pull-back).
// World units are metres. Y points down (as in lib/three). Flat chip coordinates (u, v) = (X, -Z):
// with the camera looking straight down, +u is screen-right and +v is screen-down.
import { clamp } from "../../lib/math";
import { cue } from "../../timeline";

export const FOCAL = 1500;
export const SW = 1920;
export const SH = 1080;
export const R_EARTH = 6.371e6;
export const FLOOR_Y = 1.9; // hall floor, 1.9 m below the tray board

export const CHIP = cue("zoomout", "chip");
export const SERVER = cue("zoomout", "server");
export const RACK = cue("zoomout", "rack");
export const HALL = cue("zoomout", "hall");
export const CITY = cue("zoomout", "city");
/** The globe is recognisable (limb + atmosphere on screen). */
export const EARTH = cue("zoomout", "earth");
/** Our campus fires the network: the light wave and the arcs leave the hub. */
export const NETWORK = cue("zoomout", "network");
/** The AlexNet -> GPT-4 training-compute chart opens. */
export const CHART = cue("zoomout", "chart");
/** The closing beat: every network arc fires at once, flash + shake, "上千万倍" slams in. */
export const FINAL = cue("zoomout", "final");

// ---------------------------------------------------------------- layout (flat u, v)
/** Focus transistor sits at the origin, inside a tensor-core block of one SM. */
export const SM_W = 2.4e-3;
export const SM_H = 1.96e-3;
export const SM_C: [number, number] = [-0.5e-3, -0.42e-3];
export const DIE_W = 24e-3;
export const DIE_H = 30e-3;
export const DIE_C: [number, number] = [0.8e-3, 2.52e-3];
export const PKG_C: [number, number] = [DIE_C[0] + 12.5e-3, DIE_C[1]];
export const MOD_W = 0.1;
export const MOD_H = 0.14;
export const MOD_C: [number, number] = [PKG_C[0], PKG_C[1] + 0.018];
export const TRAY_W = 0.45;
export const TRAY_D = 0.8;
export const MOD_COLS = [-0.165, -0.055, 0.055, 0.165];
export const MOD_ROWS = [-0.3, -0.14];
export const TRAY_C0: [number, number] = [MOD_C[0] + 0.055, MOD_C[1] + 0.14];
export const PULL0 = 0.84; // how far the tray drawer is pulled out of the rack at the start
export const RACK_U = TRAY_C0[0];
export const RACK_FRONT = TRAY_C0[1] + TRAY_D / 2 - PULL0; // v of the rack front plane
export const RACK_W = 0.6;
export const RACK_DEPTH = 1.1;
export const RACK_TOP = -0.19;
export const TRAY_PITCH = 0.178; // 4U per 8-GPU tray, 9 trays = 72 GPUs
export const ROW_PITCH = 2.8;
export const RACKS_PER_ROW = 40;
export const ROWS = 10;
export const HALL_OFF: [number, number][] = [
  [0, 0],
  [32, 0],
  [0, -38],
  [32, -38],
];

export const smoothstep = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

/** Monotone cubic (Fritsch–Carlson) interpolation through keys; flat ends by default. */
export const monotone = (pts: [number, number][], m0 = 0, mN = 0) => {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = m0;
  m[n - 1] = mN;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
};

const VD = FOCAL / SW; // camera distance per metre of view width
/**
 * log10 of the camera distance to the target. Frames <= 300 are given as view widths (top-down).
 * Beyond the city the target stays on our campus, so D is the campus-to-camera distance.
 */
const logD = monotone(
  (
    [
      [0, 3.2e-7 * VD],
      [22, 5.2e-7 * VD],
      [55, 5e-6 * VD],
      [86, 1.6e-4 * VD],
      [116, 5e-3 * VD],
      [146, 4.6e-2 * VD],
      [168, 1.28e-1 * VD], // the whole package is in frame (above the caption band) when its caption arrives
      [184, 1.42e-1 * VD],
      [236, 1.85e-1 * VD],
      [272, 5.6e-1 * VD],
      [300, 1.55 * VD], // the server tray lies across ~52 % of the frame width
      [332, 1.68 * VD], // ... and stays close while its 8 GPUs ignite
      [360, 2.9], // swinging round to the front of the rack
      [388, 5.6], // the rack hero shot: 72 GPUs light up tray by tray
      [414, 7.6],
      [450, 14],
      [490, 24],
      [525, 40],
      [562, 90],
      [600, 250],
      [650, 1.5e3],
      [690, 1.5e4],
      [712, 1.1e5],
      [728, 7e5],
      [744, 3.6e6],
      [760, 1.15e7],
      [776, 1.75e7],
      [800, 2.05e7],
      [840, 2.2e7],
    ] as [number, number][]
  ).map(([f, d]) => [f, Math.log10(d)] as [number, number]),
  0.004,
  0.0008,
);

const pitchAt = monotone([
  [0, Math.PI / 2],
  [286, Math.PI / 2],
  [332, 1.22],
  [360, 0.62],
  [388, 0.14],
  [414, 0.17],
  [450, 0.5],
  [490, 0.64],
  [540, 0.76],
  [600, 0.92],
  [690, 1.12],
  [745, 1.24],
  [790, 1.3],
  [840, 1.32],
]);

const yawAt = monotone([
  [0, -0.42],
  [228, -0.08],
  [300, Math.PI / 2], // a slow roll during the pull-back: the tray ends up lying across the frame
  [332, Math.PI / 2 - 0.05],
  [362, 1.0],
  [388, 0.5], // three-quarter view of the rack row
  [414, 0.45],
  [450, 0.34],
  [520, 0.33],
  [600, 0.55],
  [690, 0.75],
  [840, 1.15],
]);

/** The tray drawer: pulled out during the server beat, slides back into the rack while the camera swings round. */
export const PULL_T: [number, number] = [334, 382];
/** How far the tray drawer is pulled out (it slides back in while the camera tilts). */
export const pullAt = (f: number) => {
  const t = clamp((f - PULL_T[0]) / (PULL_T[1] - PULL_T[0]));
  return PULL0 * (1 - (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));
};

type V3 = [number, number, number];
const uv = (p: [number, number], y = 0): V3 => [p[0], y, -p[1]];
const RACK_CENTRE: V3 = [RACK_U, (RACK_TOP + FLOOR_Y) / 2, -RACK_FRONT];
const EARTH_C: V3 = [0, R_EARTH + FLOOR_Y, 0];
/** Our campus on the globe (the hub of the network), straight above the Earth's centre. */
const HUB: V3 = [0, FLOOR_Y, 0];

/** Camera target as a function of distance: linear-in-distance blends keep the old focus near the centre. */
const NODES: [number, V3][] = [
  [2.2e-5 * VD, [0, 0, 0]],
  [4e-3 * VD, uv(SM_C)],
  [5.5e-2 * VD, uv(DIE_C)],
  [1.6e-1 * VD, uv(PKG_C)],
  [4.5e-1 * VD, uv(MOD_C)],
  [0.92, uv(TRAY_C0)],
  [1.1, uv(TRAY_C0)],
  [4.0, RACK_CENTRE],
  [60, [RACK_U + 4, 1.2, -(RACK_FRONT - 12)]],
  [700, [RACK_U + 17, FLOOR_Y, -(RACK_FRONT - 36)]],
  [2.5e4, [RACK_U + 2600, FLOOR_Y, -(RACK_FRONT - 3200)]],
  [3e5, HUB],
];

const targetAt = (D: number): V3 => {
  if (D <= NODES[0][0]) return NODES[0][1];
  for (let i = 1; i < NODES.length; i++) {
    const [d1, p1] = NODES[i];
    if (D <= d1) {
      const [d0, p0] = NODES[i - 1];
      const t = smoothstep((D - d0) / (d1 - d0));
      return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
    }
  }
  return NODES[NODES.length - 1][1];
};

export type Cam = {
  f: number;
  D: number;
  view: number; // width of the view at the target distance, metres
  yaw: number;
  pitch: number;
  x: number;
  y: number;
  z: number;
  cyw: number;
  syw: number;
  cp: number;
  sp: number;
  T: V3;
  topDown: boolean;
  /** Screen-space lens shift (px) used to compose the globe; the World canvas is translated by it. */
  sx: number;
  sy: number;
};

/** Lift (fraction of the view width) that keeps each beat's subject above the caption band. */
const liftAt = monotone([
  [118, 0],
  [146, 0.085],
  [172, 0.092],
  [205, 0.055],
  [236, 0.05],
  [262, 0.06],
  [286, 0.02],
  [300, 0.012],
  [332, 0.016],
  [360, 0.04],
  [388, 0.036],
  [414, 0.042],
  [450, 0.065],
  [500, 0.075],
  [525, 0.085],
  [548, 0.085],
  [585, 0.025],
  [615, 0],
]);

/** Sideways composition offset (fraction of the view width; negative moves the subject right). */
const shiftAt = monotone([
  [272, 0],
  [296, -0.03],
  [336, -0.03],
  [372, 0],
]);

/** Globe composition: a lens shift that moves the globe to x = 720 px with its lowest point above the caption band. */
const GLOBE_T: [number, number] = [718, 778];

export const camAt = (f: number): Cam => {
  const D = Math.pow(10, logD(f));
  const pitch = pitchAt(f);
  const yaw = yawAt(f);
  const T = targetAt(D).slice() as V3;
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const view = (D * SW) / FOCAL;
  const oy = liftAt(f);
  const ox = shiftAt(f);
  if (oy || ox) {
    // screen-right R = (cyw, 0, -syw); screen-down U = (-syw*sp, cp, -cyw*sp)
    T[0] += (cyw * ox - syw * sp * oy) * view;
    T[1] += cp * oy * view;
    T[2] += (-syw * ox - cyw * sp * oy) * view;
  }
  const x = T[0] - D * syw * cp;
  const y = T[1] - D * sp;
  const z = T[2] - D * cyw * cp;
  let sx = 0;
  let sy = 0;
  const e = smoothstep((f - GLOBE_T[0]) / (GLOBE_T[1] - GLOBE_T[0]));
  if (e > 0) {
    const dx = EARTH_C[0] - x;
    const dy = EARTH_C[1] - y;
    const dz = EARTH_C[2] - z;
    const x1 = dx * cyw - dz * syw;
    const z1 = dx * syw + dz * cyw;
    const y2 = dy * cp - z1 * sp;
    const z2 = dy * sp + z1 * cp;
    if (z2 > 0) {
      const dist = Math.hypot(dx, dy, dz);
      const rG = (FOCAL * R_EARTH) / Math.sqrt(Math.max(1, dist * dist - R_EARTH * R_EARTH));
      const gy = clamp(785 - rG, 300, 420);
      // the hub (our campus, the camera target) never leaves the safe middle of the frame on the way
      sx = e * clamp(720 - (SW / 2 + (x1 / z2) * FOCAL), -300, 0);
      sy = e * clamp(gy - (SH / 2 + (y2 / z2) * FOCAL), -270, 60);
    }
  }
  return { f, D, view, yaw, pitch, x, y, z, cyw, syw, cp, sp, T, topDown: f <= 286, sx, sy };
};

/** Project for HUD overlays (includes the lens shift). */
export const projScreen = (c: Cam, X: number, Y: number, Z: number) => {
  const p = proj(c, X, Y, Z);
  return p ? { ...p, x: p.x + c.sx, y: p.y + c.sy } : null;
};

export type P2 = { x: number; y: number; s: number; z: number };

/** Perspective projection (same convention as lib/three). Returns null behind the near plane. */
export const proj = (c: Cam, X: number, Y: number, Z: number, nearK = 0.02): P2 | null => {
  const x = X - c.x;
  const y = Y - c.y;
  const z = Z - c.z;
  const x1 = x * c.cyw - z * c.syw;
  const z1 = x * c.syw + z * c.cyw;
  const y2 = y * c.cp - z1 * c.sp;
  const z2 = y * c.sp + z1 * c.cp;
  if (z2 <= c.D * nearK) return null;
  const s = FOCAL / z2;
  return { x: SW / 2 + x1 * s, y: SH / 2 + y2 * s, s, z: z2 };
};

/** Camera-space depth only (for sorting / culling). */
export const depth = (c: Cam, X: number, Y: number, Z: number) => {
  const x = X - c.x;
  const y = Y - c.y;
  const z = Z - c.z;
  const z1 = x * c.syw + z * c.cyw;
  return y * c.sp + z1 * c.cp;
};

/** Local tangent-plane point (u, v metres from the campus) wrapped onto the Earth. */
export const onEarth = (u: number, v: number, h = 0): V3 => {
  const x = u;
  const z = -v;
  const rho = Math.hypot(x, z);
  if (rho < 1) return [x, FLOOR_Y - h, z];
  const a = rho / R_EARTH;
  const r = R_EARTH + h;
  const sa = Math.sin(a);
  return [(x / rho) * r * sa, EARTH_C[1] - r * Math.cos(a), (z / rho) * r * sa];
};

export { EARTH_C, HUB };
export type { V3 };
