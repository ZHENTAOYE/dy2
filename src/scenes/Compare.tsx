import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, rng, shake, sumShake, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { Flash } from "../components/Hud";
import { Glitch } from "../components/Glitch";
import { cue, sceneDuration, ticks } from "../timeline";

// ---------------------------------------------------------------------------------------------
// Compare — the ultimate comparison. ENIAC's 5,000/s ember vs. today's AI supercomputer: a "1"
// followed by twenty zeros slamming in, then the gap (2亿亿×) detonates, then 54 doublings.
// ---------------------------------------------------------------------------------------------

const DUR = sceneDuration("compare");
const ZEROS = cue("compare", "zeros"); // the "1" lands
const SUFFIX = cue("compare", "suffix"); // "次 / 秒" lands
const INHALE = cue("compare", "inhale"); // everything is sucked in before the slam
const GAP = cue("compare", "gap"); // the slam
const DOUBLING = cue("compare", "doubling");
const FULL = cue("compare", "full"); // 54th doubling
const ZT = ticks("compare", "zero"); // 20 landing frames
const DT = ticks("compare", "double"); // 54 doubling frames

// ---- the big number ---------------------------------------------------------------------------
const ADV = 0.78; // digit slot (em): letter-spaced mono digits, the separators sit in the gaps
const EM_MAX = 250;
const WMAX = 1730; // final pixel width of the number
const R_MAX = 1832; // right edge never passes this
const CX0 = 1400; // centre while the number is young
const NY = 520; // vertical centre of the digits
const STRETCH = 1.3; // tall, poster-like digits
const FLY = 6; // frames a glyph flies in before it lands
const CAP = 0.365; // half cap-height of the digits (em)

const landP = (f: number, t: number) => clamp((f - (t - FLY)) / FLY);
/** Continuous number of zeros on screen (drives layout and the zoom-out). */
const nZeros = (f: number) => ZT.reduce((s, t) => s + ease.inOutCubic(landP(f, t)), 0);
/** Whole zeros for the thousands separators (they hop one slot just before each landing). */
const nLanded = (f: number) => ZT.filter((t) => f >= t - 1).length;

// Once all twenty zeros are in, the letter-spaced slots settle into proper thousands groups.
const DW = 0.6; // grouped digit advance (em)
const CW = 0.34; // grouped separator advance (em)
const W_GROUPED = (ZT.length + 1) * DW + 6 * CW;
const groupK = (f: number) => ease.inOutCubic(prog(f, ZT[ZT.length - 1] + 3, SUFFIX + 2));
/** Separators before slot i in the finished number (they follow slots 2, 5, 8, …). */
const sepBefore = (i: number) => (i <= 2 ? 0 : Math.min(6, Math.floor((i - 3) / 3) + 1));
const slotEm = (i: number, gk: number) => lerp((i + 0.5) * ADV, i * DW + DW / 2 + sepBefore(i) * CW, gk);
const sepEm = (i: number, gk: number) => lerp((i + 1) * ADV - 0.02, (i + 1) * DW + sepBefore(i) * CW + CW / 2, gk);

type Layout = { n: number; em: number; right: number; left: number; cx: number; gk: number };
const layout = (f: number): Layout => {
  const n = nZeros(f);
  const gk = groupK(f);
  const wEm = lerp((n + 1) * ADV, W_GROUPED, gk);
  const em = Math.min(EM_MAX, WMAX / wEm);
  const pw = wEm * em;
  const cx = Math.min(CX0, R_MAX - pw / 2);
  return { n, em, right: cx + pw / 2, left: cx - pw / 2, cx, gk };
};

type Glyph = { ch: string; x: number; t: number; idx: number; a: number };
/** Digits sit in fixed slots (no glyph ever slides over another); each zero flies in from the camera to its slot. */
const numberGlyphs = (f: number, L: Layout): Glyph[] => {
  const out: Glyph[] = [];
  if (f >= ZEROS - FLY) out.push({ ch: "1", x: L.left + slotEm(0, L.gk) * L.em, t: ZEROS, idx: 0, a: 1 });
  for (let j = 1; j <= ZT.length; j++) {
    const T = ZT[j - 1];
    if (f < T - FLY) break;
    // in flight: aim at where the slot will be at the moment of impact
    const LT = f < T ? layout(T) : L;
    out.push({ ch: "0", x: LT.left + slotEm(j, LT.gk) * LT.em, t: T, idx: j, a: 1 });
  }
  const N = nLanded(f);
  for (let i = 0; i < N; i++) {
    if ((N - i) % 3 !== 0) continue;
    out.push({ ch: ",", x: L.left + sepEm(i, L.gk) * L.em, t: -1, idx: 100 + i, a: 1 });
  }
  return out;
};

/** gold → magenta → cyan across the screen (the Title's "AI" gradient). */
const hot = (u: number) => {
  const k = clamp(u);
  return k < 0.5 ? mix(C.gold, C.magenta, k / 0.5) : mix(C.magenta, C.cyan, (k - 0.5) / 0.5);
};
const hotX = (x: number) => hot((x - 120) / 1700);

// where each impact happened (pure: layout only depends on the frame)
const IMPACTS = [ZEROS, ...ZT].map((t, i) => {
  const L = layout(t);
  return { t, x: L.right - (ADV / 2) * L.em, em: L.em, i };
});
const DEBRIS = numberGlyphs(GAP - 1, layout(GAP - 1));
const DEBRIS_L = layout(GAP - 1);

/** Brightness kick: 1 at every landing, decaying quickly. */
const kickAt = (f: number) => {
  let k = 0;
  for (const im of IMPACTS) {
    const d = f - im.t;
    if (d >= 0 && d < 30) k = Math.max(k, Math.exp(-d / 5) * (im.i === 0 ? 1.3 : 0.75 + 0.25 * (im.i / 20)));
  }
  const ds = f - SUFFIX;
  if (ds >= 0 && ds < 30) k = Math.max(k, Math.exp(-ds / 6));
  return k;
};

// ---- ENIAC ember --------------------------------------------------------------------------------
const EA = { x: 560, y: 430 };
const EB = { x: 262, y: 196 };
const emberAt = (f: number) => {
  const k = ease.inOutCubic(clamp((nZeros(f) - 2) / 5));
  const blast = f >= GAP ? ease.outCubic(prog(f, GAP, GAP + 26)) : 0;
  return {
    x: lerp(EA.x, EB.x, k) - 520 * blast,
    y: lerp(EA.y, EB.y, k) - 60 * blast,
    s: lerp(1, 0.72, k),
    a: 1 - clamp((f - GAP) / 10),
  };
};

const CAPS = [
  { from: 15, to: 100, text: "ENIAC，每秒{{5000次}}。", accent: C.amber },
  { from: 200, to: 320, text: "从5000次，到{{一万亿亿次}}。" },
  { from: 455, to: 615, text: "78年，翻了约{{54番}}——差不多每一年半翻一倍。", accent: C.gold },
];

// ---- gap slam -------------------------------------------------------------------------------------
const GX = 960;
const GY = 470;

// ---- doubling staircase ---------------------------------------------------------------------------
const TX0 = 176;
const TX1 = 1744;
const TBASE = 690;
const PITCH = (TX1 - TX0) / 54;
const BW = PITCH - 7;
const bh = (k: number) => 22 + (k / 53) * 270;
const doublings = (f: number) => DT.filter((t) => t <= f).length;

// ---- starfield (deterministic, built once) --------------------------------------------------------
const STARS = (() => {
  const r = rng(4242);
  return Array.from({ length: 1100 }, () => ({
    a: r() * TAU,
    d: 40 + Math.pow(r(), 0.65) * 1250,
    s: 0.7 + r() * 1.9,
    b: 0.12 + r() * 0.55,
    c: r(),
    tw: r() * 50,
  }));
})();

/** Camera scale of the deep background: pulls back as the number grows. */
const bgZoom = (f: number) => {
  const push = 1 + 0.04 * prog(f, 0, ZEROS);
  const L = layout(Math.min(f, GAP - 1));
  const pull = Math.pow(L.em / EM_MAX, 0.85);
  const after = f >= GAP ? 1 + 0.5 * ease.outExpo(prog(f, GAP, GAP + 60)) + 0.1 * prog(f, GAP + 60, DUR) : 1;
  return push * pull * after;
};

const Backdrop: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      const g = f - GAP;
      const L = layout(Math.min(f, GAP - 1));
      const kick = kickAt(f);
      const numA = ease.outCubic(prog(f, ZEROS - 12, ZEROS + 30));
      const inhale = f < GAP ? ease.inQuad(prog(f, INHALE, GAP)) : 0;
      // warm pool around the ember, then a cold violet field behind the number
      const e = emberAt(f);
      const warm = 0.22 * (1 - 0.6 * numA) * e.a;
      let grd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 700);
      grd.addColorStop(0, `rgba(80,34,8,${warm})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      if (f < GAP + 30) {
        const cool = (0.18 + 0.02 * L.n + 0.35 * kick) * numA * (1 - clamp(g / 30));
        grd = ctx.createRadialGradient(L.cx, NY, 0, L.cx, NY, 1100);
        grd.addColorStop(0, `rgba(70,30,120,${cool})`);
        grd.addColorStop(0.5, `rgba(20,30,90,${cool * 0.5})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }
      if (g >= 0) {
        const heat = 0.55 * Math.exp(-g / 26) + 0.2 * (1 - prog(f, DOUBLING - 30, DOUBLING + 30));
        grd = ctx.createRadialGradient(GX, GY, 0, GX, GY, 1300);
        grd.addColorStop(0, `rgba(150,40,60,${heat})`);
        grd.addColorStop(0.45, `rgba(70,16,60,${heat * 0.6})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }
      if (f >= DOUBLING - 30) {
        const a = ease.outCubic(prog(f, DOUBLING - 30, DOUBLING + 20));
        const lit = doublings(f) / 54;
        grd = ctx.createLinearGradient(0, TBASE - 420, 0, TBASE + 170);
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(0.72, `rgba(60,24,90,${a * (0.18 + 0.25 * lit)})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, TBASE - 420, w, 590);
      }
      // starfield: pulls back with the number, inhales, then warps outward on the slam
      const z = bgZoom(f);
      const streak = g >= 0 ? 1 + 0.9 * Math.exp(-g / 9) : 1 - 0.35 * inhale;
      const starA = 0.35 + 0.65 * numA;
      const cx = w / 2;
      const cy = h / 2 - 20;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const d = s.d * z;
        const x = cx + Math.cos(s.a) * d;
        const y = cy + Math.sin(s.a) * d * 0.62;
        if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
        const tw = 0.6 + 0.4 * Math.sin(f * 0.07 + s.tw);
        const col = s.c < 0.6 ? "#cfe6ff" : s.c < 0.8 ? C.ice : s.c < 0.92 ? "#ffd2f2" : C.warm;
        const a = s.b * tw * starA * (1 + 1.5 * kick);
        if (Math.abs(streak - 1) > 0.04) {
          const d2 = d * streak;
          ctx.strokeStyle = withAlpha(col, Math.min(1, a * 1.4));
          ctx.lineWidth = s.s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(cx + Math.cos(s.a) * d2, cy + Math.sin(s.a) * d2 * 0.62);
          ctx.stroke();
        } else {
          ctx.fillStyle = withAlpha(col, Math.min(1, a));
          ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
        }
      }
      ctx.globalCompositeOperation = "source-over";
      // inhale: the edges close in
      if (inhale > 0) {
        grd = ctx.createRadialGradient(GX, GY, 200, GX, GY, 1150);
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(1, `rgba(0,0,0,${0.75 * inhale})`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }
    }}
  />
);

// ---- drawing helpers ------------------------------------------------------------------------------
const drawGlyph = (
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  em: number,
  s: number,
  alpha: number,
  col: string,
  heat: number,
  rot = 0,
) => {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s * STRETCH);
  ctx.font = `800 ${em}px ${FONT_MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const by = CAP * em;
  if (heat > 0.04) {
    // chromatic split on impact
    const o = em * 0.07 * heat;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * Math.min(1, heat) * 0.75;
    ctx.fillStyle = "#ff2a3c";
    ctx.fillText(ch, -o, by);
    ctx.fillStyle = "#2ab8ff";
    ctx.fillText(ch, o, by);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.shadowColor = col;
  ctx.shadowBlur = em * (0.16 + 0.3 * Math.min(1, heat));
  ctx.fillStyle = mix(col, "#ffffff", 0.58 + 0.42 * Math.min(1, heat));
  ctx.fillText(ch, 0, by);
  ctx.shadowBlur = 0;
  ctx.restore();
};

const drawEmber = (ctx: CanvasRenderingContext2D, f: number) => {
  const e = emberAt(f);
  if (e.a <= 0) return;
  const fade = ease.outCubic(prog(f, 4, 26)) * e.a;
  const fl = 0.8 + 0.2 * noise1(f * 0.35) + 0.08 * Math.sin(f * 1.7);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, e.x, e.y, 120 * e.s, C.ember, 0.16 * fade * fl, 0.04);
  glow(ctx, e.x, e.y, 30 * e.s * fl, C.amber, 0.95 * fade);
  glow(ctx, e.x, e.y, 9 * e.s, C.warm, fade);
  // drifting ash
  for (let i = 0; i < 26; i++) {
    const life = 90;
    const t = (f + hash(i * 3.7) * life) % life;
    const x = e.x + (hash(i * 1.3) - 0.5) * 90 * e.s + Math.sin(t * 0.08 + i) * 10;
    const y = e.y - t * 1.1 * e.s + 20;
    glow(ctx, x, y, 3 + 2 * hash(i), C.amber, 0.5 * Math.sin((t / life) * Math.PI) * fade);
  }
  ctx.globalCompositeOperation = "source-over";
  // HUD reticle: the ember is tiny, so mark it
  const r = 54 * e.s;
  ctx.strokeStyle = withAlpha(C.amber, 0.45 * fade);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(C.amber, 0.7 * fade);
  ctx.lineWidth = 2;
  for (let q = 0; q < 4; q++) {
    const a = q * (Math.PI / 2) + f * 0.004;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(a) * (r + 6), e.y + Math.sin(a) * (r + 6));
    ctx.lineTo(e.x + Math.cos(a) * (r + 18), e.y + Math.sin(a) * (r + 18));
    ctx.stroke();
  }
};

const drawNumber = (ctx: CanvasRenderingContext2D, f: number, L: Layout) => {
  const inhale = ease.inQuad(prog(f, INHALE, GAP));
  const gl = numberGlyphs(f, L);
  // energy band behind the number
  const kick = kickAt(f);
  const bandA = clamp(L.n / 4) * 0.22 + 0.25 * kick + 0.3 * inhale;
  if (bandA > 0.01) {
    const half = CAP * L.em * STRETCH * 1.7;
    const rx = (L.right - L.left) / 2 + 220;
    ctx.save();
    ctx.translate((L.left + L.right) / 2, NY);
    ctx.scale(rx / half, 1);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, half);
    gr.addColorStop(0, withAlpha(mix(C.violet, C.magenta, 0.4), bandA));
    gr.addColorStop(0.55, withAlpha(mix(C.violet, C.magenta, 0.4), bandA * 0.45));
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, half, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // underglow
  ctx.globalCompositeOperation = "lighter";
  for (const g of gl) {
    if (g.ch === ",") continue;
    const p = landP(f, g.t);
    const dt = f - g.t;
    const heat = dt >= 0 ? Math.exp(-dt / 7) : 0.8 * p;
    glow(ctx, g.x, NY, L.em * 0.95 * (1 + 0.6 * heat), hotX(g.x), (0.16 + 0.55 * heat + 0.25 * inhale) * p, 0.04);
  }
  ctx.globalCompositeOperation = "source-over";
  for (const g of gl) {
    const col = hotX(g.x);
    const jx = inhale > 0 ? (hash(f * 3.1 + g.idx * 7.7) - 0.5) * 16 * inhale * inhale : 0;
    // the last frames before the slam: everything is sucked toward the centre
    const implode = 0.22 * ease.inCubic(prog(f, GAP - 12, GAP));
    const jy = inhale > 0 ? (hash(f * 5.3 + g.idx * 2.9) - 0.5) * 10 * inhale * inhale : 0;
    if (g.ch === ",") {
      drawGlyph(ctx, ",", lerp(g.x, GX, implode) + jx, NY + jy, L.em, lerp(0.82, 1, L.gk), g.a, col, 0.2 * inhale);
      continue;
    }
    const p = landP(f, g.t);
    if (p <= 0) continue;
    const dt = f - g.t;
    const approach = ease.inQuad(p);
    const pop = dt >= 0 ? 1 + 0.14 * Math.exp(-dt / 3) : 1;
    // fly in from the camera; while a caption is up, the flying glyph must stay out of the caption band
    const capOn = CAPS.some((c) => f >= c.from - 12 && f < c.to + 2);
    const maxS = (790 - NY) / (CAP * L.em * STRETCH * 1.2);
    const s0 = capOn ? Math.min(2.6, maxS) : 2.6;
    const s = (1 + (s0 - 1) * (1 - approach)) * pop * (1 + 0.04 * inhale);
    const heat = dt >= 0 ? Math.exp(-dt / 7) : 0.6 + 0.4 * p;
    const alpha = ease.outQuad(p);
    if (p < 1) {
      // motion ghosts as it flies in from the camera
      drawGlyph(ctx, g.ch, g.x, NY, L.em, s * 1.1, alpha * 0.25, col, 0);
      drawGlyph(ctx, g.ch, g.x, NY, L.em, s * 1.2, alpha * 0.12, col, 0);
    }
    drawGlyph(ctx, g.ch, lerp(g.x, GX, implode) + jx, NY + jy, L.em, s * (1 - 0.25 * implode), alpha, col, heat + 0.35 * inhale);
  }
};

/** Shockwave ring + sparks for every landing. */
const drawImpacts = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f >= GAP + 2) return;
  ctx.globalCompositeOperation = "lighter";
  for (const im of IMPACTS) {
    const dt = f - im.t;
    if (dt < 0 || dt > 60) continue;
    const big = im.i === 0 ? 1.5 : 0.8 + 0.5 * (im.i / 20);
    const col = hotX(im.x);
    // brightness kick at the impact point
    glow(ctx, im.x, NY, 420 * big, col, 0.35 * Math.exp(-dt / 5) * big, 0.03);
    glow(ctx, im.x, NY, 120 * big, C.white, 0.5 * Math.exp(-dt / 3), 0.1);
    // two rings
    for (let k = 0; k < 2; k++) {
      const tt = dt - k * 3;
      if (tt < 0) continue;
      const r = im.em * 0.35 + tt * (17 - k * 5) * big * Math.exp(-tt / 45);
      const a = Math.exp(-tt / (10 + k * 5));
      if (a < 0.02) continue;
      ctx.strokeStyle = withAlpha(k ? C.cyan : mix(col, "#ffffff", 0.4), a * 0.85);
      ctx.lineWidth = 1.5 + 9 * a;
      ctx.beginPath();
      ctx.ellipse(im.x, NY, r, r * 0.42, 0, 0, TAU);
      ctx.stroke();
    }
    // sparks
    const n = im.i === 0 ? 150 : 70;
    for (let s = 0; s < n; s++) {
      const seed = im.i * 997 + s;
      const a = -Math.PI / 2 + (hash(seed * 1.31) - 0.5) * Math.PI * 1.9;
      const v = 4 + hash(seed * 2.7) * 22 * big;
      const drag = 0.06 + 0.05 * hash(seed * 3.1);
      const d = (v / drag) * (1 - Math.exp(-drag * dt));
      const x = im.x + Math.cos(a) * d * 1.25;
      const y = NY + Math.sin(a) * d * 0.8 + 0.1 * dt * dt;
      const life = 1 - dt / (24 + 34 * hash(seed * 4.4));
      if (life <= 0) continue;
      const band = clamp((800 - y) / 60);
      glow(ctx, x, y, 2 + 4 * hash(seed) * life + 1.5, s % 3 ? col : C.white, life * band);
    }
  }
  ctx.globalCompositeOperation = "source-over";
};

const drawInhale = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < INHALE || f >= GAP) return;
  const k = prog(f, INHALE, GAP);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 700; i++) {
    const a = hash(i * 1.7 + 0.3) * TAU;
    const r0 = 260 + hash(i * 3.1) * 1300;
    const sp = 0.45 + hash(i * 5.3) * 0.75;
    const q = clamp(k * sp * 1.3);
    const r = r0 * Math.pow(1 - q, 1.8);
    if (q >= 1) continue;
    const x = GX + Math.cos(a + q * 1.4) * r;
    const y = GY + Math.sin(a + q * 1.4) * r * 0.62;
    const col = i % 3 === 0 ? C.cyan : i % 3 === 1 ? C.gold : C.magenta;
    glow(ctx, x, y, 2.5 + 4 * hash(i), col, 0.2 + 0.8 * k);
  }
  glow(ctx, GX, GY, 50 + 320 * Math.pow(k, 3), C.white, 0.75 * k * k, 0.06);
  // anamorphic line tightening
  const la = k * k;
  const gr = ctx.createLinearGradient(0, 0, 1920, 0);
  gr.addColorStop(0, withAlpha(C.magenta, 0));
  gr.addColorStop(0.5, withAlpha("#ffffff", 0.8 * la));
  gr.addColorStop(1, withAlpha(C.magenta, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(0, GY - 1 - 3 * la, 1920, 2 + 6 * la);
  ctx.globalCompositeOperation = "source-over";
};

const drawDebris = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - GAP;
  if (t < 0 || t > 50) return;
  for (const g of DEBRIS) {
    const dx = g.x - GX;
    const side = dx >= 0 ? 1 : -1;
    const sp = (18 + 46 * hash(g.idx * 3.3)) * (0.45 + 0.75 * Math.min(1, Math.abs(dx) / 800));
    const vy = (hash(g.idx * 7.1) - 0.5) * 34 - 4;
    const drag = 0.07;
    const k = (1 - Math.exp(-drag * t)) / drag;
    const x = g.x + side * sp * k;
    const y = NY + vy * k + 0.25 * t * t;
    const rot = (hash(g.idx * 9.9) - 0.5) * 0.09 * t;
    const s = 1 + 0.035 * t;
    const a = Math.exp(-t / 7) * g.a;
    const col = hotX(g.x);
    for (let gh = 3; gh >= 1; gh--) {
      const k2 = (1 - Math.exp(-drag * Math.max(0, t - gh * 1.2))) / drag;
      drawGlyph(ctx, g.ch, g.x + side * sp * k2, NY + vy * k2, DEBRIS_L.em, s, a * 0.14, col, 0, rot);
    }
    drawGlyph(ctx, g.ch, x, y, DEBRIS_L.em, s, a, col, Math.exp(-t / 6), rot);
  }
};

const drawExplosion = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - GAP;
  if (t < 0) return;
  const hold = 1 - prog(f, DOUBLING - 40, DOUBLING + 10);
  ctx.globalCompositeOperation = "lighter";
  // god rays
  const rayA = 0.3 * Math.exp(-t / 28) + 0.07 * hold;
  if (rayA > 0.005) {
    ctx.save();
    ctx.translate(GX, GY);
    ctx.rotate(t * 0.0025);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU + hash(i * 1.9) * 0.08;
      const len = 1500;
      const wid = 0.008 + hash(i * 9.1) * 0.03;
      const col = i % 4 === 0 ? "#ffffff" : mix(C.gold, C.magenta, hash(i * 2.2));
      const gr = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gr.addColorStop(0, withAlpha(col, rayA * (0.6 + 0.4 * hash(i * 4.4))));
      gr.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, a - wid, a + wid);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // core
  glow(ctx, GX, GY, 1000 * Math.exp(-t / 9) + 160, C.white, 0.85 * Math.exp(-t / 7), 0.04);
  glow(ctx, GX, GY, 1500 * Math.exp(-t / 30) + 400, C.ember, 0.55 * Math.exp(-t / 18) + 0.06 * hold, 0.02);
  // shockwave rings
  for (let k = 0; k < 7; k++) {
    const tt = t - k * 3.5;
    if (tt < 0) continue;
    const r = 60 + tt * (64 - k * 6) * Math.exp(-tt / 70);
    const a = Math.exp(-tt / (7 + k)) * (1 - clamp((tt - 20) / 16));
    if (a < 0.02) continue;
    const col = k === 0 ? "#ffffff" : k % 3 === 1 ? C.gold : k % 3 === 2 ? C.magenta : C.cyan;
    ctx.strokeStyle = withAlpha(col, a * 0.9);
    ctx.lineWidth = 3 + 34 * a * (k === 0 ? 1.4 : 0.8);
    ctx.beginPath();
    ctx.ellipse(GX, GY, r, r * 0.6, 0, 0, TAU);
    ctx.stroke();
  }
  // a pressure disc just behind the first wave
  {
    const r = 60 + t * 64 * Math.exp(-t / 70);
    const a = Math.exp(-t / 10);
    if (a > 0.02) {
      ctx.save();
      ctx.translate(GX, GY);
      ctx.scale(1, 0.6);
      const gr = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.85, withAlpha(C.magenta, 0.25 * a));
      gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  // thousands of sparks, the fastest ones as streaks
  const N = 2800;
  ctx.lineCap = "round";
  for (let i = 0; i < N; i++) {
    const life = Math.exp(-t / (22 + hash(i * 8.8) * 80));
    if (life < 0.03) continue;
    const a = hash(i * 2.9) * TAU;
    const v = 6 + Math.pow(hash(i * 4.1), 1.6) * 80;
    const drag = 0.04 + hash(i * 6.7) * 0.05;
    const dd = (v / drag) * (1 - Math.exp(-drag * t));
    const x = GX + Math.cos(a) * dd * 1.35;
    const y = GY + Math.sin(a) * dd * 0.78 + t * t * 0.012 * hash(i * 1.1);
    if (x < -50 || x > 1970 || y < -50 || y > 1130) continue;
    const col = i % 5 === 0 ? "#ffffff" : i % 5 === 1 ? C.cyan : i % 5 === 2 ? C.magenta : C.gold;
    const vel = v * Math.exp(-drag * t);
    if (vel > 9) {
      const sx = Math.cos(a) * vel * 1.35 * 2.2;
      const sy = Math.sin(a) * vel * 0.78 * 2.2;
      ctx.strokeStyle = withAlpha(col, 0.6 * life);
      ctx.lineWidth = 1.2 + 2 * hash(i * 3.3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - sx, y - sy);
      ctx.stroke();
    }
    glow(ctx, x, y, 2 + 6 * hash(i * 1.7) * life + 1.5, col, life);
  }
  // anamorphic flare
  const sa = Math.exp(-t / 22);
  const gr = ctx.createLinearGradient(0, 0, 1920, 0);
  gr.addColorStop(0, withAlpha(C.cyan, 0));
  gr.addColorStop(0.5, withAlpha("#ffffff", 0.95 * sa));
  gr.addColorStop(1, withAlpha(C.cyan, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(0, GY - 3 - 10 * sa, 1920, 6 + 20 * sa);
  // lingering embers drifting up around the text
  if (t > 4) {
    const la = clamp((t - 4) / 20) * hold;
    for (let i = 0; i < 240; i++) {
      const lifeT = 70 + 50 * hash(i * 2.1);
      const ph = (t + hash(i * 5.5) * lifeT) % lifeT;
      const x = GX + (hash(i * 1.37) - 0.5) * 1700 + Math.sin(ph * 0.05 + i) * 20;
      const y = GY + 300 - ph * (2 + 3 * hash(i * 7.3)) + (hash(i * 3.9) - 0.5) * 200;
      const col = i % 3 === 0 ? C.gold : i % 3 === 1 ? C.ember : C.magenta;
      glow(ctx, x, y, 2.5 + 4 * hash(i), col, Math.sin((ph / lifeT) * Math.PI) * 0.8 * la);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // dark backing so the slam text stays legible once the blast clears
  const back = ease.outCubic(prog(f, GAP + 6, GAP + 24)) * (1 - ease.inOutCubic(prog(f, DOUBLING - 32, DOUBLING - 6)));
  if (back > 0.01) {
    ctx.save();
    ctx.translate(GX, GY + 40);
    ctx.scale(1, 0.34);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 760);
    bg.addColorStop(0, `rgba(4,2,8,${0.6 * back})`);
    bg.addColorStop(0.6, `rgba(4,2,8,${0.4 * back})`);
    bg.addColorStop(1, "rgba(4,2,8,0)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, 760, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
};

const drawDoubling = (ctx: CanvasRenderingContext2D, f: number) => {
  const a0 = ease.outCubic(prog(f, DOUBLING - 24, DOUBLING + 4));
  if (a0 <= 0) return;
  const n = doublings(f);
  // axis
  const axisW = (TX1 - TX0 + 20) * ease.inOutCubic(prog(f, DOUBLING - 24, DOUBLING + 6));
  ctx.fillStyle = withAlpha("#ffffff", 0.5 * a0);
  ctx.fillRect(TX0 - 10, TBASE + 10, axisW, 2);
  for (let k = 0; k <= 54; k++) {
    const x = TX0 + k * PITCH;
    if (x - TX0 > axisW) break;
    ctx.fillStyle = withAlpha("#ffffff", (k % 9 === 0 ? 0.5 : 0.22) * a0);
    ctx.fillRect(x - 0.5, TBASE + 12, 1, k % 9 === 0 ? 12 : 6);
  }
  const sweep = f >= FULL ? (f - FULL) * 3.2 : -99;
  for (let k = 0; k < 54; k++) {
    const x = TX0 + k * PITCH + (PITCH - BW) / 2;
    const hk = bh(k);
    // ghost slot, revealed left to right with the axis
    const slotA = clamp((axisW - (x - TX0)) / 60) * a0;
    const dt = f - DT[k];
    if (dt < -2) {
      ctx.strokeStyle = withAlpha("#c9b8ff", 0.22 * slotA);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, TBASE - hk + 0.5, BW - 1, hk - 1);
      continue;
    }
    const p = ease.outBack(clamp((dt + 2) / 6));
    const heat = dt >= 0 ? Math.exp(-dt / 6) : 1;
    const wave = sweep > -50 ? Math.exp(-Math.pow(k - sweep, 2) / 10) : 0;
    const col = hot(k / 53);
    const hh = hk * p;
    const top = TBASE - hh;
    const gr = ctx.createLinearGradient(0, top, 0, TBASE);
    gr.addColorStop(0, mix(col, "#ffffff", Math.min(1, 0.45 + 0.55 * heat + wave)));
    gr.addColorStop(0.3, withAlpha(col, 0.85));
    gr.addColorStop(1, withAlpha(col, 0.22));
    ctx.fillStyle = gr;
    ctx.fillRect(x, top, BW, hh);
    // floor reflection
    const rh = Math.min(hh * 0.4, 70);
    const rg = ctx.createLinearGradient(0, TBASE + 14, 0, TBASE + 14 + rh);
    rg.addColorStop(0, withAlpha(col, 0.22 + 0.2 * heat));
    rg.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x, TBASE + 14, BW, rh);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x + BW / 2, top, 22 + 50 * heat + 40 * wave, col, 0.35 + 0.65 * heat + 0.6 * wave);
    if (heat > 0.1) glow(ctx, x + BW / 2, top + hh / 2, hh * 0.9 + 30, col, 0.35 * heat, 0.04);
    ctx.globalCompositeOperation = "source-over";
  }
  // the line through the block tops: steady doubling is a straight line on this (log) scale
  if (n > 1) {
    const lg = ctx.createLinearGradient(TX0, 0, TX1, 0);
    lg.addColorStop(0, hot(0));
    lg.addColorStop(0.5, hot(0.5));
    lg.addColorStop(1, hot(1));
    const path = () => {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const p = ease.outBack(clamp((f - DT[k] + 2) / 6));
        const x = TX0 + k * PITCH + PITCH / 2;
        const y = TBASE - bh(k) * p - 9;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    };
    const fin = f >= FULL ? Math.exp(-(f - FULL) / 10) : 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = lg;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = (0.14 + 0.2 * fin) * a0;
    ctx.lineWidth = 16;
    path();
    ctx.stroke();
    ctx.globalAlpha = (0.85 + 0.15 * fin) * a0;
    ctx.lineWidth = 3 + 2 * fin;
    path();
    ctx.stroke();
    ctx.restore();
  }
  // scanning head on the newest block
  if (n > 0 && f < FULL + 24) {
    const k = n - 1;
    const x = TX0 + k * PITCH + PITCH / 2;
    const hk = bh(k);
    const ha = a0 * (1 - prog(f, FULL + 4, FULL + 24));
    const gr = ctx.createLinearGradient(0, TBASE - hk - 150, 0, TBASE + 10);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(1, withAlpha("#ffffff", 0.55 * ha));
    ctx.fillStyle = gr;
    ctx.fillRect(x - 1.5, TBASE - hk - 150, 3, hk + 160);
  }
  // ×2 pulses over the newest blocks
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let k = Math.max(0, n - 1); k < n; k++) {
    const dt = f - DT[k];
    if (dt > 16) continue;
    const x = TX0 + k * PITCH + PITCH / 2;
    const rec = k === n - 1 ? 1 : 0.3;
    const a = (1 - dt / 16) * rec * a0;
    const s = 1 + 0.5 * Math.exp(-dt / 3);
    const y = TBASE - bh(k) - 34 - dt * 2.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.font = `800 32px ${FONT_MONO}`;
    ctx.shadowColor = hot(k / 53);
    ctx.shadowBlur = 14;
    ctx.fillStyle = withAlpha("#ffffff", a);
    ctx.fillText("×2", 0, 0);
    ctx.restore();
  }
  // completion: shockwave from the last block
  const tf = f - FULL;
  if (tf >= 0 && tf < 50) {
    const x = TX0 + 53 * PITCH + PITCH / 2;
    const y = TBASE - bh(53);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      const tt = tf - k * 4;
      if (tt < 0) continue;
      const r = 20 + tt * 26 * Math.exp(-tt / 40);
      const a = Math.exp(-tt / 12);
      ctx.strokeStyle = withAlpha(k === 1 ? C.cyan : "#ffffff", a * 0.8);
      ctx.lineWidth = 2 + 10 * a;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, 0, TAU);
      ctx.stroke();
    }
    glow(ctx, x, y, 500, C.cyan, 0.5 * Math.exp(-tf / 8), 0.03);
    ctx.globalCompositeOperation = "source-over";
  }
};

const Stage: React.FC = () => (
  <Canvas
    draw={(ctx, w, h, f) => {
      const L = layout(Math.min(f, GAP - 1));
      drawExplosion(ctx, f);
      drawEmber(ctx, f);
      if (f < GAP) drawNumber(ctx, f, L);
      drawImpacts(ctx, f);
      drawDebris(ctx, f);
      drawInhale(ctx, f);
      drawDoubling(ctx, f);
      // radial zoom-blur echo right after the slam
      const t = f - GAP;
      if (t >= 0 && t < 22) {
        const zb = Math.exp(-t / 7);
        ctx.globalCompositeOperation = "lighter";
        for (let k = 1; k <= 3; k++) {
          const s = 1 + 0.045 * k * zb;
          ctx.globalAlpha = 0.16 * zb;
          ctx.drawImage(ctx.canvas, GX - GX * s, GY - GY * s, w * s, h * s);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    }}
  />
);

// ---- DOM layers -------------------------------------------------------------------------------------
const EniacLabels: React.FC = () => {
  const f = useCurrentFrame();
  const e = emberAt(f);
  const a = ease.outCubic(prog(f, 10, 32)) * e.a;
  if (a <= 0) return null;
  const rise = 1 - ease.outCubic(prog(f, 10, 34));
  return (
    <div
      style={{
        position: "absolute",
        left: e.x,
        top: e.y + 76 * e.s + rise * 16,
        transform: `translateX(-50%) scale(${e.s})`,
        transformOrigin: "50% 0",
        textAlign: "center",
        opacity: a,
        whiteSpace: "nowrap",
        filter: f > GAP ? `blur(${Math.min(12, (f - GAP) * 1.2)}px)` : undefined,
      }}
    >
      <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 30, letterSpacing: "0.22em", color: C.amber, textShadow: `0 0 14px ${C.ember}, 0 2px 6px #000` }}>
        ENIAC · 1946
      </div>
      <div style={{ marginTop: 6, fontFamily: FONT_CN, fontWeight: 700, fontSize: 42, color: "#fff", textShadow: "0 2px 8px #000, 0 0 20px rgba(255,140,40,0.45)" }}>
        每秒 <span style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.warm }}>5,000</span> 次
      </div>
    </div>
  );
};

const AiLabels: React.FC = () => {
  const f = useCurrentFrame();
  if (f < ZEROS - 14) return null;
  const L = layout(Math.min(f, GAP - 1));
  const half = CAP * L.em * STRETCH;
  const blast = f >= GAP ? ease.outCubic(prog(f, GAP, GAP + 24)) : 0;
  const out = 1 - clamp((f - GAP) / 9);
  if (out <= 0) return null;
  const a = ease.outCubic(prog(f, ZEROS - 14, ZEROS + 6)) * out;
  const label = "超算 · 今天";
  const typed = Math.floor(clamp((f - ZEROS + 10) / 14) * label.length);
  const sp = f - SUFFIX;
  const sufP = clamp((sp + 6) / 6);
  const sufS = sp < 0 ? 1 + 1.6 * (1 - ease.inQuad(sufP)) : 1 + 0.15 * Math.exp(-sp / 3);
  return (
    <AbsoluteFill style={{ opacity: a, filter: blast > 0 ? `blur(${blast * 10}px)` : undefined }}>
      <div
        style={{
          position: "absolute",
          right: 1920 - L.right + blast * -500,
          top: NY - half - 96,
          display: "flex",
          alignItems: "center",
          gap: 14,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ width: 12, height: 12, background: C.cyan, boxShadow: `0 0 14px ${C.cyan}`, opacity: Math.floor(f / 8) % 2 ? 1 : 0.3 }} />
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 40, color: "#fff", letterSpacing: "0.08em", textShadow: `0 0 18px ${C.cyan}, 0 2px 6px #000` }}>AI</span>
        <span style={{ fontFamily: FONT_CN, fontWeight: 700, fontSize: 36, color: C.ice, letterSpacing: "0.12em", textShadow: "0 2px 6px #000, 0 0 16px rgba(0,0,0,0.8)" }}>
          {label.slice(0, typed)}
        </span>
      </div>
      {sp >= -6 ? (
        <div
          style={{
            position: "absolute",
            right: 1920 - L.right + blast * -500,
            top: NY + half + 34,
            fontFamily: FONT_CN,
            fontWeight: 900,
            fontSize: 64,
            letterSpacing: "0.1em",
            color: "#fff",
            opacity: ease.outQuad(sufP),
            transform: `scale(${sufS})`,
            transformOrigin: "100% 50%",
            whiteSpace: "nowrap",
            textShadow: `0 0 26px ${C.cyan}, 0 0 6px ${C.cyan}, 0 3px 10px #000`,
          }}
        >
          次 / 秒
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const GapText: React.FC = () => {
  const f = useCurrentFrame();
  const g = f - GAP;
  if (g < -6) return null;
  const pin = clamp((g + 6) / 6);
  const s0 =
    g < 0
      ? lerp(3.6, 1, ease.inQuad(pin))
      : 1 + 0.09 * Math.exp(-g / 5) * Math.cos(g * 0.9) + 0.04 * ease.outCubic(prog(f, GAP, DOUBLING - 32));
  const hd = ease.inOutCubic(prog(f, DOUBLING - 32, DOUBLING - 4));
  const scale = s0 * lerp(1, 0.46, hd) * (1 + 0.04 * Math.exp(-Math.max(0, f - FULL) / 6) * (f >= FULL ? 1 : 0));
  const cy = lerp(GY - 10, 176, hd);
  const a = g < 0 ? ease.outQuad(pin) : 1;
  const blur = g < 0 ? (1 - pin) * 16 : 0;
  const sub = ease.outCubic(prog(f, GAP + 24, GAP + 42));
  const shimmer = (f * 1.4) % 200;
  const glowK = Math.exp(-Math.max(0, g) / 12);
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          width: 1920,
          top: cy,
          transform: `translateY(-50%) scale(${scale})`,
          transformOrigin: "50% 50%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 30, whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 96, color: "#fff", letterSpacing: "0.04em", textShadow: `0 0 30px ${C.magenta}, 0 4px 16px #000` }}>
            差距：约
          </span>
          <span
            style={{
              fontFamily: FONT_CN,
              fontWeight: 900,
              fontSize: 264,
              lineHeight: 1.05,
              letterSpacing: "0.01em",
              background: `linear-gradient(175deg, #ffffff 0%, #fff6d8 22%, ${C.gold} 42%, ${C.ember} 66%, ${C.magenta} 100%)`,
              backgroundSize: "100% 200%",
              backgroundPosition: `0 ${shimmer > 100 ? 200 - shimmer : shimmer}%`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: `drop-shadow(0 0 ${26 + 40 * glowK}px rgba(255,90,40,${0.75 + 0.25 * glowK})) drop-shadow(0 6px 18px rgba(0,0,0,0.9))`,
            }}
          >
            2亿亿
          </span>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 96, color: "#fff", textShadow: `0 0 30px ${C.magenta}, 0 4px 16px #000` }}>倍</span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 64,
            letterSpacing: "0.02em",
            color: "#fff",
            opacity: sub,
            transform: `translateY(${(1 - sub) * 24}px)`,
            textShadow: `0 0 22px ${C.gold}, 0 3px 10px #000`,
            whiteSpace: "nowrap",
          }}
        >
          2 × 10
          <span style={{ fontSize: 38, position: "relative", top: -30, marginLeft: 4 }}>16</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DoubleHud: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease.outCubic(prog(f, DT[0] - 1, DT[0] + 6));
  if (a <= 0) return null;
  const n = Math.max(1, doublings(f));
  const last = DT[n - 1];
  const pop = 1 + 0.22 * Math.exp(-Math.max(0, f - last) / 3);
  const done = f >= FULL ? ease.outCubic(prog(f, FULL, FULL + 10)) : 0;
  const yrA = ease.outCubic(prog(f, DOUBLING - 10, DOUBLING + 12));
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: TX0, top: 318, opacity: a, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 60, color: "#fff", textShadow: "0 2px 10px #000" }}>翻倍</span>
          <span
            style={{
              display: "inline-block",
              fontFamily: FONT_MONO,
              fontWeight: 800,
              fontSize: 168,
              lineHeight: 1,
              color: "#fff",
              transform: `scale(${pop + 0.12 * done})`,
              textShadow: `0 0 ${30 + 30 * done}px ${mix(C.gold, C.cyan, n / 54)}, 0 0 6px ${mix(C.gold, C.cyan, n / 54)}, 0 4px 14px #000`,
            }}
          >
            {n}
          </span>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 60, color: "#fff", textShadow: "0 2px 10px #000" }}>次</span>
        </div>
        <div style={{ marginTop: 10, fontFamily: FONT_CN, fontWeight: 700, fontSize: 30, color: "rgba(255,255,255,0.75)", letterSpacing: "0.08em", textShadow: "0 2px 8px #000" }}>
          每一格 = 算力 <span style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.gold }}>×2</span>
        </div>
      </div>
      <div style={{ opacity: yrA }}>
        <div style={{ position: "absolute", left: TX0 - 10, top: TBASE + 30, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 34, color: C.amber, textShadow: `0 0 14px ${C.ember}, 0 2px 6px #000` }}>
          1946
        </div>
        <div style={{ position: "absolute", right: 1920 - TX1 - 10, top: TBASE + 30, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 34, color: C.cyan, textShadow: `0 0 14px ${C.cyan}, 0 2px 6px #000` }}>
          2024
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Chromatic aberration for the whole stage: split R and B with an SVG filter. */
const ChromaFilter: React.FC<{ amount: number }> = ({ amount }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id="compare-ca" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
      <feOffset in="r" dx={-amount} dy={0} result="r2" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
      <feOffset in="b" dx={amount} dy={amount * 0.3} result="b2" />
      <feBlend mode="screen" in="r2" in2="g" result="rg" />
      <feBlend mode="screen" in="rg" in2="b2" />
    </filter>
  </svg>
);

export const Compare: React.FC = () => {
  const f = useCurrentFrame();
  const g = f - GAP;
  const inhale = f < GAP ? ease.inQuad(prog(f, INHALE, GAP)) : 0;
  const sh = sumShake(
    shake(f, ZEROS, 16, 14),
    ...ZT.map((t, i) => shake(f, t, 5 + i * 0.5, 10)),
    shake(f, SUFFIX, 14, 14),
    shake(f, GAP, 78, 48),
    shake(f, FULL, 18, 18),
  );
  // high-frequency rattle right at the slam + pre-slam tremble
  const rattle = g >= 0 && g < 12 ? (1 - g / 12) * 22 : 0;
  const tremble = inhale * 7;
  const rx = sh.x + (hash(f * 1.37) - 0.5) * 2 * (rattle + tremble);
  const ry = sh.y + (hash(f * 2.11 + 4) - 0.5) * 2 * (rattle + tremble);
  const zoomPunch = g >= 0 ? 1 + 0.1 * Math.exp(-g / 6) : 1 - 0.03 * inhale;
  let ab = 0;
  if (g >= 0) ab = 30 * Math.exp(-g / 7);
  else ab = 7 * inhale;
  for (const t of [ZEROS, ...ZT]) if (f >= t && f < t + 10) ab = Math.max(ab, 4 * Math.exp(-(f - t) / 3));
  const fade = Math.min(ease.outCubic(prog(f, 0, 14)), 1 - prog(f, DUR - 18, DUR - 1));
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fade }}>
      <Backdrop />
      <ChromaFilter amount={ab} />
      <AbsoluteFill
        style={{
          transform: `translate(${rx}px, ${ry}px) rotate(${sh.r * 0.35}rad) scale(${zoomPunch})`,
          filter: ab > 0.6 ? "url(#compare-ca)" : undefined,
        }}
      >
        <Stage />
        <EniacLabels />
        <AiLabels />
        <GapText />
        <DoubleHud />
      </AbsoluteFill>
      <Flash at={ZEROS} dur={8} color={C.cyan} peak={0.22} />
      <Flash at={SUFFIX} dur={8} color={C.magenta} peak={0.2} />
      <Flash at={GAP} dur={8} peak={1} />
      <Glitch at={GAP + 1} before={3} after={9} strength={0.7} />
      <Flash at={FULL} dur={10} color={C.gold} peak={0.3} />
      <Captions accent={C.magenta} items={CAPS} />
    </AbsoluteFill>
  );
};
