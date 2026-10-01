import {clamp} from './math';
import {gauss, mulberry32} from './rng';

export type Ctx = CanvasRenderingContext2D;
export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Offscreen canvases (cached per tab, keyed by name)
// ---------------------------------------------------------------------------
const scratch = new Map<string, HTMLCanvasElement>();

export const getScratch = (key: string, w: number, h: number) => {
  let c = scratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratch.set(key, c);
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
};

const textures = new Map<string, HTMLCanvasElement>();

// Build a texture once per tab; later calls return the cached canvas.
export const memoTexture = (
  key: string,
  w: number,
  h: number,
  build: (ctx: Ctx, w: number, h: number) => void,
) => {
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  build(ctx, w, h);
  textures.set(key, c);
  return c;
};

const dataCache = new Map<string, unknown>();
export const memo = <T,>(key: string, build: () => T): T => {
  if (dataCache.has(key)) return dataCache.get(key) as T;
  const v = build();
  dataCache.set(key, v);
  return v;
};

// ---------------------------------------------------------------------------
// Post effects
// ---------------------------------------------------------------------------

// Cheap cinematic bloom: blur a downsampled copy and add it back.
export const bloom = (ctx: Ctx, w: number, h: number, strength = 0.8, radius = 10, scale = 4) => {
  if (strength <= 0) return;
  const sw = w / scale;
  const sh = h / scale;
  const off = getScratch('bloom', sw, sh);
  const o = off.getContext('2d')!;
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, sw, sh);
  o.filter = `blur(${radius / scale}px)`;
  o.drawImage(ctx.canvas, 0, 0, sw, sh);
  o.filter = 'none';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(strength, 0, 4) > 1 ? 1 : strength;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, w, h);
  if (strength > 1) {
    ctx.globalAlpha = Math.min(1, strength - 1);
    ctx.drawImage(off, 0, 0, w, h);
  }
  ctx.restore();
};

// Two-radius bloom gives a tight core and a wide halo.
export const bloom2 = (ctx: Ctx, w: number, h: number, strength = 0.8) => {
  bloom(ctx, w, h, strength * 0.7, 8, 4);
  bloom(ctx, w, h, strength * 0.5, 40, 8);
};

// RGB split around the centre — used on impacts.
export const chromatic = (ctx: Ctx, w: number, h: number, amount: number) => {
  if (amount < 0.5) return;
  const src = getScratch('chroma-src', w, h);
  const s = src.getContext('2d')!;
  s.globalCompositeOperation = 'copy';
  s.drawImage(ctx.canvas, 0, 0);
  const tint = getScratch('chroma-tint', w, h);
  const t = tint.getContext('2d')!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  // No channel is drawn smaller than the frame, so the edges never lose a channel.
  const channels: [string, number][] = [
    ['#ff0000', 0],
    ['#00ff00', amount],
    ['#0000ff', 2 * amount],
  ];
  for (const [col, off] of channels) {
    t.globalCompositeOperation = 'copy';
    t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = col;
    t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(src, 0, 0);
    const k = 1 + off / w;
    ctx.drawImage(tint, (w - w * k) / 2, (h - h * k) / 2, w * k, h * k);
  }
  ctx.restore();
};

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

export const glowSprite = (rgb: RGB = [255, 255, 255], soft = 2.2) => {
  const key = `glow-${rgb.join(',')}-${soft}`;
  return memoTexture(key, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (let i = 0; i <= 12; i++) {
      const x = i / 12;
      const a = Math.pow(1 - x, soft);
      g.addColorStop(x, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
};

export const drawGlow = (ctx: Ctx, x: number, y: number, r: number, rgb: RGB, alpha = 1, soft = 2.2) => {
  if (alpha <= 0.002 || r <= 0.2) return;
  const s = glowSprite(rgb, soft);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp(alpha, 0, 1);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
};

// Star with soft halo and four diffraction spikes.
export const flareSprite = (rgb: RGB = [255, 255, 255]) =>
  memoTexture(`flare-${rgb.join(',')}`, 256, 256, (ctx) => {
    ctx.globalCompositeOperation = 'lighter';
    const c = 128;
    const g = ctx.createRadialGradient(c, c, 0, c, c, 128);
    g.addColorStop(0, `rgba(255,255,255,1)`);
    g.addColorStop(0.04, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`);
    g.addColorStop(0.15, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.25)`);
    g.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.05)`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    for (const ang of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(ang);
      const lg = ctx.createLinearGradient(-128, 0, 128, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(${(rgb[0] + 255) / 2},${(rgb[1] + 255) / 2},${(rgb[2] + 255) / 2},0.9)`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-128, -1.2, 256, 2.4);
      ctx.restore();
    }
  });

export const drawFlare = (ctx: Ctx, x: number, y: number, r: number, rgb: RGB, alpha = 1, rot = 0) => {
  if (alpha <= 0.002 || r <= 0.5) return;
  const s = flareSprite(rgb);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp(alpha, 0, 1);
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(s, -r, -r, r * 2, r * 2);
    ctx.restore();
  } else {
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = prev;
};

// Horizontal anamorphic lens streak.
export const drawStreak = (ctx: Ctx, x: number, y: number, len: number, thick: number, rgb: RGB, alpha = 1) => {
  if (alpha <= 0.002) return;
  const s = glowSprite(rgb, 1.6);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp(alpha, 0, 1);
  ctx.drawImage(s, x - len, y - thick, len * 2, thick * 2);
  ctx.drawImage(s, x - len * 0.4, y - thick * 0.35, len * 0.8, thick * 0.7);
  ctx.globalAlpha = prev;
};

// Expanding ring (shockwave).
export const drawRing = (ctx: Ctx, x: number, y: number, r: number, thick: number, rgb: RGB, alpha = 1) => {
  if (alpha <= 0.002 || r <= 0) return;
  const inner = Math.max(0, r - thick);
  const g = ctx.createRadialGradient(x, y, inner, x, y, r + thick);
  const c = `${rgb[0]},${rgb[1]},${rgb[2]}`;
  g.addColorStop(0, `rgba(${c},0)`);
  g.addColorStop(0.5, `rgba(${c},${clamp(alpha)})`);
  g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r + thick, 0, Math.PI * 2);
  ctx.fill();
};

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

// Approximate black-body-ish star colours (cool red → hot blue).
export const STAR_COLORS: RGB[] = [
  [255, 190, 140],
  [255, 214, 170],
  [255, 240, 220],
  [255, 255, 255],
  [220, 232, 255],
  [180, 205, 255],
  [155, 185, 255],
];

export const starColor = (r: number): RGB => {
  const i = Math.min(STAR_COLORS.length - 1, Math.floor(r * STAR_COLORS.length));
  return STAR_COLORS[i];
};

// Hot plasma ramp: black → deep red → orange → yellow → white.
export const heatColor = (t: number): RGB => {
  const x = clamp(t);
  const stops: [number, RGB][] = [
    [0, [0, 0, 0]],
    [0.2, [80, 6, 20]],
    [0.4, [200, 40, 10]],
    [0.6, [255, 130, 30]],
    [0.8, [255, 220, 120]],
    [1, [255, 255, 245]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
};

// ---------------------------------------------------------------------------
// Galaxy sprites
// ---------------------------------------------------------------------------

export type GalaxyKind = 'spiral' | 'barred' | 'elliptical';

export const galaxySprite = (seed: number, kind: GalaxyKind = 'spiral', size = 256, points = 6000) =>
  memoTexture(`gal-${seed}-${kind}-${size}-${points}`, size, size, (ctx, w) => {
    const r = mulberry32(seed);
    const c = w / 2;
    const R = w * 0.46;
    ctx.globalCompositeOperation = 'lighter';
    // Diffuse disc light.
    const disc = ctx.createRadialGradient(c, c, 0, c, c, R);
    const warm = kind === 'elliptical';
    disc.addColorStop(0, warm ? 'rgba(255,220,170,0.9)' : 'rgba(255,236,200,0.85)');
    disc.addColorStop(0.12, warm ? 'rgba(255,190,130,0.45)' : 'rgba(255,214,170,0.35)');
    disc.addColorStop(0.45, warm ? 'rgba(200,140,100,0.12)' : 'rgba(120,150,255,0.10)');
    disc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = disc;
    ctx.fillRect(0, 0, w, w);

    if (kind === 'elliptical') {
      for (let i = 0; i < points; i++) {
        const rad = Math.abs(gauss(r)) * R * 0.32;
        const a = r() * Math.PI * 2;
        const x = c + Math.cos(a) * rad;
        const y = c + Math.sin(a) * rad * 0.8;
        const b = 0.15 + 0.5 * r();
        ctx.fillStyle = `rgba(255,${200 + 40 * r()},${150 + 60 * r()},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
      return;
    }

    const arms = kind === 'barred' ? 2 : 2 + Math.floor(r() * 2);
    const twist = 2.4 + r() * 1.6;
    const bar = kind === 'barred' ? 0.22 : 0.06;
    for (let i = 0; i < points; i++) {
      const arm = i % arms;
      const t = Math.pow(r(), 0.65);
      const rad = bar * R + t * R * (1 - bar);
      const base = (arm / arms) * Math.PI * 2;
      const ang = base + Math.log(1 + t * 6) * twist + gauss(r) * (0.28 + 0.25 * (1 - t));
      let x = c + Math.cos(ang) * rad;
      let y = c + Math.sin(ang) * rad;
      x += gauss(r) * R * 0.03;
      y += gauss(r) * R * 0.03;
      const u = r();
      let col: string;
      if (u < 0.05) col = `rgba(255,120,190,${0.5 + 0.4 * r()})`; // HII regions
      else if (u < 0.55) col = `rgba(${150 + 60 * r()},${180 + 50 * r()},255,${0.25 + 0.5 * r()})`;
      else col = `rgba(255,${210 + 40 * r()},${170 + 60 * r()},${0.2 + 0.4 * r()})`;
      ctx.fillStyle = col;
      const s = u < 0.05 ? 1.6 : r() < 0.1 ? 1.4 : 1;
      ctx.fillRect(x, y, s, s);
    }
    if (kind === 'barred') {
      ctx.save();
      ctx.translate(c, c);
      const bg = ctx.createLinearGradient(-bar * R, 0, bar * R, 0);
      bg.addColorStop(0, 'rgba(255,220,170,0)');
      bg.addColorStop(0.5, 'rgba(255,225,180,0.5)');
      bg.addColorStop(1, 'rgba(255,220,170,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(-bar * R * 1.2, -R * 0.035, bar * R * 2.4, R * 0.07);
      ctx.restore();
    }
    // Bright bulge.
    const core = ctx.createRadialGradient(c, c, 0, c, c, R * 0.16);
    core.addColorStop(0, 'rgba(255,250,235,1)');
    core.addColorStop(0.4, 'rgba(255,225,170,0.5)');
    core.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, w);
  });

// Draw a galaxy sprite with inclination (squash) and rotation.
export const drawGalaxy = (
  ctx: Ctx,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  rot: number,
  tilt: number,
  alpha = 1,
) => {
  if (alpha <= 0.003 || size < 0.6) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp(alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, Math.max(0.12, tilt));
  ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.globalAlpha = prev;
};

// ---------------------------------------------------------------------------
// Noise textures
// ---------------------------------------------------------------------------

export const clearCtx = (ctx: Ctx, w: number, h: number, color?: string) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
};

// ---------------------------------------------------------------------------
// Spectrum helpers
// ---------------------------------------------------------------------------

// Visible wavelength (nm) → RGB, after Dan Bruton's approximation.
export const wavelengthRGB = (nm: number): RGB => {
  let r = 0,
    g = 0,
    b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) {
    r = 1;
  }
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (780 - nm)) / 80;
  const k = (c: number) => Math.round(255 * Math.pow(c * f, 0.8));
  return [k(r), k(g), k(b)];
};

export const ABSORPTION_LINES = [393.4, 396.8, 430.8, 486.1, 517.3, 589.0, 656.3];

// Horizontal spectrum strip with absorption lines shifted by redshift z.
export const drawSpectrum = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  alpha = 1,
  lo = 380,
  hi = 720,
) => {
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  for (let i = 0; i < w; i += 1) {
    const nm = lo + ((hi - lo) * i) / w;
    const c = wavelengthRGB(nm);
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(x + i, y, 1.5, h);
  }
  for (const l of ABSORPTION_LINES) {
    const nm = l * (1 + z);
    if (nm < lo || nm > hi) continue;
    const px = x + ((nm - lo) / (hi - lo)) * w;
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(px - 2, y, 4, h);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  ctx.restore();
};

export const font = (size: number, weight = 500, family = '"Noto Sans SC"') => `${weight} ${size}px ${family}`;

export const drawArrow = (
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
  head = 10,
) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;
  const hl = Math.min(head, len * 0.5);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * hl - uy * hl * 0.55, y1 - uy * hl + ux * hl * 0.55);
  ctx.lineTo(x1 - ux * hl + uy * hl * 0.55, y1 - uy * hl - ux * hl * 0.55);
  ctx.closePath();
  ctx.fill();
};

// Volumetric-looking light rays fanning out from a point.
export const drawGodRays = (
  ctx: Ctx,
  cx: number,
  cy: number,
  len: number,
  n: number,
  rot: number,
  alpha: number,
  rgb: RGB,
  seed = 1,
) => {
  if (alpha <= 0.003) return;
  const r = mulberry32(seed);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
  g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha)})`);
  g.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha) * 0.35})`);
  g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const wdt = 0.008 + r() * 0.03;
    const L = len * (0.5 + r() * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - wdt) * L, cy + Math.sin(a - wdt) * L);
    ctx.lineTo(cx + Math.cos(a + wdt) * L, cy + Math.sin(a + wdt) * L);
    ctx.closePath();
    ctx.fill();
  }
};
