const spriteCache = new Map<string, HTMLCanvasElement>();

/** Radial glow sprite: hot white core fading through the given color. */
export const glowSprite = (r: number, g: number, b: number, core = 0.15, size = 128) => {
  const key = `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${core},${size}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const to = (k: number, a: number) => {
    const wr = Math.round(255 * Math.min(1, r + (1 - r) * k));
    const wg = Math.round(255 * Math.min(1, g + (1 - g) * k));
    const wb = Math.round(255 * Math.min(1, b + (1 - b) * k));
    return `rgba(${wr},${wg},${wb},${a})`;
  };
  grd.addColorStop(0, to(1, 1));
  grd.addColorStop(core, to(0.6, 0.85));
  grd.addColorStop(core * 2.2, to(0.1, 0.32));
  grd.addColorStop(0.55, to(0, 0.08));
  grd.addColorStop(1, to(0, 0));
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
};

/** Draw a glow sprite centered at (x, y) with given diameter. Assumes 'lighter' composite for best results. */
export const drawGlow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  d: number,
  color: [number, number, number],
  alpha = 1,
  core = 0.15,
) => {
  if (alpha <= 0.003 || d <= 0.5) return;
  const s = glowSprite(color[0], color[1], color[2], core);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(s, x - d / 2, y - d / 2, d, d);
  ctx.globalAlpha = 1;
};

/** Four-point diffraction spikes, like a telescope's. */
export const drawSpikes = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  color: [number, number, number],
  alpha = 1,
  angle = 0,
  width = 2,
) => {
  if (alpha <= 0.01 || len < 2) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const c = color.map((v) => Math.round(255 * Math.min(1, v * 0.5 + 0.5)));
  for (let k = 0; k < 4; k++) {
    ctx.rotate(Math.PI / 2);
    const grd = ctx.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
    grd.addColorStop(0.25, `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.35})`);
    grd.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

const bloomCache = new Map<string, HTMLCanvasElement>();
const bloomCanvas = (w: number, h: number, key: string) => {
  const k = `${key}:${w}x${h}`;
  let c = bloomCache.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    bloomCache.set(k, c);
  }
  return c;
};

/**
 * Cheap two-level bloom: downsample + blur the canvas, then add it back on top.
 * `contrast` > 1 acts like a soft threshold so only highlights bloom.
 */
export const bloom = (
  ctx: CanvasRenderingContext2D,
  strength = 0.8,
  contrast = 1.6,
  spread = 1,
) => {
  if (strength <= 0) return;
  const src = ctx.canvas;
  const W = src.width;
  const H = src.height;
  const levels: [number, number, number][] = [
    [8, 2 * spread, 0.65],
    [24, 3 * spread, 0.85],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const [div, blur, w] of levels) {
    const bw = Math.max(4, Math.round(W / div));
    const bh = Math.max(4, Math.round(H / div));
    const c = bloomCanvas(bw, bh, `b${div}`);
    const bctx = c.getContext('2d')!;
    bctx.globalCompositeOperation = 'copy';
    bctx.filter = `blur(${blur}px) brightness(${0.9}) contrast(${contrast})`;
    bctx.drawImage(src, 0, 0, bw, bh);
    bctx.filter = 'none';
    ctx.globalAlpha = strength * w;
    ctx.drawImage(c, 0, 0, W, H);
  }
  ctx.restore();
};
