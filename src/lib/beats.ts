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

// First-star ignitions (seconds into the web scene). The first 16 get an
// audible "ping" in the soundtrack; keep in sync with make_soundtrack.py.
export const IGNITION_COUNT = 44;
export const ignitionTimes = () =>
  Array.from({length: IGNITION_COUNT}, (_, k) => 4.6 + 4.4 * Math.pow(k / IGNITION_COUNT, 0.62));
