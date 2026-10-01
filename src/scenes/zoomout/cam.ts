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
export const EARTH = cue("zoomout", "earth");
/** The closing beat: every network arc fires at once, the sun flares and "上千万倍" slams in. */
export const FINAL = 812;

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
/** log10 of camera distance. Frames <= 305 are given as view widths (top-down). */
const logD = monotone(
  (
    [
      [0, 3.2e-7 * VD],
      [22, 5.2e-7 * VD],
      [55, 5e-6 * VD],
      [86, 1.6e-4 * VD],
      [116, 5e-3 * VD],
      [146, 4.6e-2 * VD],
      [180, 1.36e-1 * VD],
      [236, 1.85e-1 * VD],
      [272, 5.5e-1 * VD],
      [296, 2.0 * VD],
      [345, 2.55],
      [392, 5.0],
      [450, 10.5],
      [520, 34],
      [600, 250],
      [650, 1.5e3],
      [690, 1.5e4],
      [712, 1.0e5],
      [732, 6.5e5],
      [748, 3.6e6],
      [764, 1.75e7],
      [778, 2.5e7],
      [806, 2.85e7],
      [840, 2.68e7],
    ] as [number, number][]
  ).map(([f, d]) => [f, Math.log10(d)] as [number, number]),
  0.004,
  0.0016,
);

const pitchAt = monotone([
  [0, Math.PI / 2],
  [302, Math.PI / 2],
  [386, 0.12],
  [460, 0.36],
  [600, 0.92],
  [690, 1.1],
  [840, 1.2],
]);

const yawAt = monotone([
  [0, -0.42],
  [300, 0],
  [390, 0],
  [470, 0.1],
  [600, 0.55],
  [690, 0.75],
  [840, 1.15],
]);

/** How far the tray drawer is pulled out (it slides back in while the camera tilts). */
export const pullAt = (f: number) => {
  const t = clamp((f - 318) / (384 - 318));
  return PULL0 * (1 - (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));
};

type V3 = [number, number, number];
const uv = (p: [number, number], y = 0): V3 => [p[0], y, -p[1]];
const RACK_CENTRE: V3 = [RACK_U, (RACK_TOP + FLOOR_Y) / 2, -RACK_FRONT];
const EARTH_C: V3 = [0, R_EARTH + FLOOR_Y, 0];

/** Camera target as a function of distance: linear-in-distance blends keep the old focus near the centre. */
const NODES: [number, V3][] = [
  [2.2e-5 * VD, [0, 0, 0]],
  [4e-3 * VD, uv(SM_C)],
  [5.5e-2 * VD, uv(DIE_C)],
  [1.6e-1 * VD, uv(PKG_C)],
  [4.5e-1 * VD, uv(MOD_C)],
  [1.65 * VD, uv(TRAY_C0)],
  [4.0, RACK_CENTRE],
  [60, [RACK_U + 4, 1.2, -(RACK_FRONT - 12)]],
  [700, [RACK_U + 17, FLOOR_Y, -(RACK_FRONT - 36)]],
  [2.5e4, [RACK_U + 2600, FLOOR_Y, -(RACK_FRONT - 3200)]],
  [3e5, [RACK_U + 2600, FLOOR_Y, -(RACK_FRONT - 3200)]],
  [1.7e7, EARTH_C],
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
};

/** Lift (fraction of the view width) that keeps each beat's subject above the caption band. */
const liftAt = monotone([
  [140, 0],
  [168, 0.085],
  [200, 0.05],
  [262, 0.05],
  [284, 0.03],
  [304, 0.066],
  [362, 0.066],
  [388, 0.05],
  [412, 0.058],
  [440, 0.06],
  [470, 0.035],
  [520, 0],
]);

/** Screen-space composition offset (fractions of the view width). */
const compose = (f: number, D: number) => {
  const e = smoothstep((f - 742) / 22);
  let ox = 0;
  let oy = liftAt(f);
  if (e > 0) {
    // the globe: centre at x = 700 px, its lowest point kept above the caption band
    const rG = (FOCAL * R_EARTH) / Math.sqrt(Math.max(1, D * D - R_EARTH * R_EARTH));
    const cy = clamp(785 - rG, 300, 420);
    ox += e * ((960 - 700) / SW);
    oy += e * ((540 - cy) / SW);
  }
  return { ox, oy };
};

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
  const { ox, oy } = compose(f, D);
  if (ox || oy) {
    // screen-right R = (cyw, 0, -syw); screen-down U = (-syw*sp, cp, -cyw*sp)
    T[0] += cyw * ox * view - syw * sp * oy * view;
    T[1] += cp * oy * view;
    T[2] += -syw * ox * view - cyw * sp * oy * view;
  }
  return {
    f,
    D,
    view,
    yaw,
    pitch,
    x: T[0] - D * syw * cp,
    y: T[1] - D * sp,
    z: T[2] - D * cyw * cp,
    cyw,
    syw,
    cp,
    sp,
    T,
    topDown: f <= 302,
  };
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

export { EARTH_C };
export type { V3 };
