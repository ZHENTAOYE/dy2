/**
 * Additive floating-point framebuffer for dense particle systems.
 * Splat thousands of points with sub-pixel precision, then tone-map once.
 */
export class HDRBuffer {
  w: number;
  h: number;
  buf: Float32Array;
  img: ImageData | null = null;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Float32Array(w * h * 3);
  }

  clear() {
    this.buf.fill(0);
  }

  /** Bilinear point splat. */
  add(x: number, y: number, r: number, g: number, b: number) {
    const {w, h, buf} = this;
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return;
    const ix = x | 0;
    const iy = y | 0;
    const fx = x - ix;
    const fy = y - iy;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    let i = (iy * w + ix) * 3;
    buf[i] += r * w00; buf[i + 1] += g * w00; buf[i + 2] += b * w00;
    buf[i + 3] += r * w10; buf[i + 4] += g * w10; buf[i + 5] += b * w10;
    i += w * 3;
    buf[i] += r * w01; buf[i + 1] += g * w01; buf[i + 2] += b * w01;
    buf[i + 3] += r * w11; buf[i + 4] += g * w11; buf[i + 5] += b * w11;
  }

  /** Small soft disc (gaussian-ish), radius in px (<= ~6). */
  disc(x: number, y: number, rad: number, r: number, g: number, b: number) {
    if (rad <= 0.8) {
      this.add(x, y, r, g, b);
      return;
    }
    const {w, h, buf} = this;
    const R = Math.ceil(rad * 1.6);
    const x0 = Math.max(0, Math.floor(x - R));
    const x1 = Math.min(w - 1, Math.ceil(x + R));
    const y0 = Math.max(0, Math.floor(y - R));
    const y1 = Math.min(h - 1, Math.ceil(y + R));
    const inv = 1 / (rad * rad);
    const norm = 1 / (rad * rad * 1.2);
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - y;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        const k = Math.exp(-(dx * dx + dy * dy) * inv * 1.4) * norm;
        if (k < 0.002) continue;
        const i = (yy * w + xx) * 3;
        buf[i] += r * k; buf[i + 1] += g * k; buf[i + 2] += b * k;
      }
    }
  }

  /** Streak from (x0,y0) to (x1,y1); total energy spread along the line. */
  line(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.min(200, Math.ceil(len)));
    const s = 1 / n;
    for (let i = 0; i <= n; i++) {
      const t = i * s;
      // brighter towards the head
      const k = s * (0.25 + 1.5 * t);
      this.add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r * k, g * k, b * k);
    }
  }

  /** Tone-map (filmic exponential) and write to the context. */
  flush(ctx: CanvasRenderingContext2D, exposure = 1) {
    const {w, h, buf} = this;
    if (!this.img || this.img.width !== w) this.img = ctx.createImageData(w, h);
    const d = this.img.data;
    const n = w * h;
    for (let p = 0, i = 0, j = 0; p < n; p++, i += 3, j += 4) {
      const r = buf[i] * exposure;
      const g = buf[i + 1] * exposure;
      const b = buf[i + 2] * exposure;
      // Highlights bleed into white like film
      const m = Math.max(0, (r + g + b) * 0.333 - 1.2) * 0.35;
      d[j] = 255 * (1 - Math.exp(-(r + m)));
      d[j + 1] = 255 * (1 - Math.exp(-(g + m)));
      d[j + 2] = 255 * (1 - Math.exp(-(b + m)));
      d[j + 3] = 255;
    }
    ctx.putImageData(this.img, 0, 0);
  }
}

const buffers = new Map<string, HDRBuffer>();
export const getHDR = (w: number, h: number, key = 'main') => {
  const k = `${key}:${w}x${h}`;
  let b = buffers.get(k);
  if (!b) {
    b = new HDRBuffer(w, h);
    buffers.set(k, b);
  }
  b.clear();
  return b;
};
