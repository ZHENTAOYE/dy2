// Accelerating heartbeat used by the rewind scene; mirrored in
// scripts/make_soundtrack.py so the visuals pulse with the drums.
export const heartbeatTimes = (len: number, start = 0.95, end = 0.22) => {
  const out: number[] = [];
  let t = 0.3;
  while (t < len) {
    out.push(t);
    const k = t / len;
    t += start * Math.pow(end / start, k);
  }
  return out;
};
