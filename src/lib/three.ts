// Minimal perspective camera for 2.5D canvas scenes. Y axis points down (screen-like).
export type Cam = { x: number; y: number; z: number; yaw: number; pitch: number; f: number; cx: number; cy: number };

export const camera = (p: Partial<Cam>): Cam => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: 900, cx: 960, cy: 540, ...p });

/** Project a world point. Returns null if behind the near plane. `s` is pixels per world unit at that depth. */
export const project = (cam: Cam, X: number, Y: number, Z: number, near = 0.05) => {
  let x = X - cam.x;
  let y = Y - cam.y;
  let z = Z - cam.z;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  x = x1;
  y = y2;
  z = z2;
  if (z <= near) return null;
  const s = cam.f / z;
  return { x: cam.cx + x * s, y: cam.cy + y * s, s, z };
};
