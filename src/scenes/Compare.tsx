import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, glow, mix, withAlpha } from "../lib/canvas";
import { C, FONT_CN, FONT_MONO } from "../lib/theme";
import { clamp, ease, hash, lerp, noise1, prog, rng, shake, sumShake, TAU } from "../lib/math";
import { Captions } from "../components/Caption";
import { GradientText } from "../components/GradientText";
import { Flash } from "../components/Hud";
import { cue, sceneDuration, ticks } from "../timeline";

// ---------------------------------------------------------------------------------------------
// Compare — the ultimate comparison. ENIAC's 5,000/s ember vs. today's AI supercomputer: a "1"
// followed by twenty zeros slamming in, the ember pings the finished number once, then the gap
// (2亿亿×) detonates, then 54 doublings light up a straight log ramp from 1946 to 2024 and the
// 54th sends its light up into the "2亿亿" headline (54 doublings = the gap).
// ---------------------------------------------------------------------------------------------

const DUR = sceneDuration("compare");
const ZEROS = cue("compare", "zeros"); // the "1" lands
const SUFFIX = cue("compare", "suffix"); // "次 / 秒" lands
const PING = cue("compare", "ping"); // the tiny ember pings the giant number
const INHALE = cue("compare", "inhale"); // everything is sucked in before the slam
const GAP = cue("compare", "gap"); // the slam
const DOUBLING = cue("compare", "doubling");
const FULL = cue("compare", "full"); // the 54th doubling: light sweep, then a beam up into the headline
const ZT = ticks("compare", "zero"); // 20 landing frames
const DT = ticks("compare", "double"); // 54 doubling frames
const LAST_Z = ZT[ZT.length - 1];
const PUSH0 = LAST_Z + 2; // the camera starts pushing in on the finished number

// ---- the big number ---------------------------------------------------------------------------
// Tight, properly grouped digits all the way through: every comma owns a half slot. When a zero
// lands, the old commas blink out, the digits ease over, and the new commas appear (never both).
// Digits are Noto Sans SC Black: a plain zero (no dot / slash), heavy and poster-like.
const DIGIT_FONT = (em: number) => `900 ${em}px ${FONT_CN}`;
const DW = 0.6; // digit advance (em); the face's own advance is 0.609
const CW = 0.28; // separator advance (em)
const EM_MAX = 250;
const WMAX = 1700; // final pixel width of the number
const R_MAX = 1810; // right edge never passes this (the finished number is centred on x = 960)
const CX0 = 1340; // centre while the number is young
const NY = 520; // vertical centre of the digits
const FLY = 6; // frames a glyph flies in before it lands
const CAP = 0.372; // half height of the digits (em, before the vertical stretch): 0..0.758 above the baseline
const S_FLY = 1.35; // scale a zero starts at when it flies in from the camera
const ND = ZT.length + 1; // 21 digits
/** While a caption is on screen, nothing bright may enter the caption band (y >= ~820). */
const capOnAt = (f: number) => CAPS.some((c) => f >= c.from - 10 && f < c.to + 2);
const bandK = (f: number, y: number) => (capOnAt(f) ? clamp((790 - y) / 70) : 1);

const landP = (f: number, t: number) => clamp((f - (t - FLY)) / FLY);
/** Continuous number of zeros on screen. */
const nZeros = (f: number) => ZT.reduce((s, t) => s + ease.inOutCubic(landP(f, t)), 0);

const sepAfter = (a: number, D: number) => a < D - 1 && (D - 1 - a) % 3 === 0;
/** SB[D][i]: thousands separators before digit i in a D-digit number. */
const SB: number[][] = Array.from({ length: ND + 1 }, (_, D) => {
  const row: number[] = [];
  let s = 0;
  for (let i = 0; i < ND; i++) {
    row.push(s);
    if (sepAfter(i, D)) s++;
  }
  return row;
});
const sepsOf = (D: number) => Math.max(0, Math.floor((D - 1) / 3));

/**
 * Tall poster digits: as the width clamps and the em shrinks, the digits stretch vertically so the
 * number keeps (and at the end gains) height instead of thinning into a strip.
 */
const stretchOf = (em: number, f: number) =>
  Math.min(1.72, 1.25 * Math.pow(EM_MAX / em, 0.75)) * (1 + 0.05 * ease.inOutCubic(prog(f, PUSH0, SUFFIX + 8)));

/**
 * Regrouping of the thousands separators for the landing at `t`: a quick 2-frame move in the middle of
 * the zero's flight, ~80% done on the flight's middle frame, so no frame shows two half-open groupings.
 */
const regroupP = (f: number, t: number) => ease.inOutCubic(clamp((f - (t - 4.25)) / 2));

type Layout = { w: number[]; wS: number[]; n: number; em: number; st: number; left: number; right: number; cx: number };
const layout = (f: number): Layout => {
  // c[j]: landing progress of digit j (the "1" is always there); w[D]: weight of the D-digit state.
  // cs / wS: the same for the separator grouping (which regroups faster than the digit flies in).
  const c = [1, ...ZT.map((t) => ease.inOutCubic(landP(f, t)))];
  const cs = [1, ...ZT.map((t) => regroupP(f, t))];
  const w: number[] = [0];
  const wS: number[] = [0];
  let wEm = 0;
  for (let D = 1; D <= ND; D++) {
    const wd = c[D - 1] - (D < ND ? c[D] : 0);
    const ws = cs[D - 1] - (D < ND ? cs[D] : 0);
    w.push(wd);
    wS.push(ws);
    wEm += wd * D * DW + ws * sepsOf(D) * CW;
  }
  const n = c.reduce((s, v) => s + v, 0) - 1;
  const em = Math.min(EM_MAX, WMAX / wEm);
  const pw = wEm * em;
  const cx = Math.min(CX0, R_MAX - pw / 2);
  return { w, wS, n, em, st: stretchOf(em, f), left: cx - pw / 2, right: cx + pw / 2, cx };
};
/** Centre of digit i (em from the left edge). */
const digitEm = (i: number, L: Layout) => {
  let s = 0;
  let tot = 0;
  for (let D = i + 1; D <= ND; D++) {
    s += L.wS[D] * SB[D][i];
    tot += L.wS[D];
  }
  return i * DW + DW / 2 + (tot > 1e-6 ? s / tot : SB[Math.min(ND, i + 1)][i]) * CW;
};

type Glyph = { ch: string; x: number; t: number; idx: number; a: number };
/** Digits sit in their slots; each zero flies in from the camera to where its slot will be at impact. */
const numberGlyphs = (f: number, L: Layout): Glyph[] => {
  const out: Glyph[] = [];
  if (f >= ZEROS - FLY) out.push({ ch: "1", x: L.left + digitEm(0, L) * L.em, t: ZEROS, idx: 0, a: 1 });
  for (let j = 1; j <= ZT.length; j++) {
    const T = ZT[j - 1];
    if (f < T - FLY) break;
    const LT = f < T ? layout(T) : L;
    out.push({ ch: "0", x: LT.left + digitEm(j, LT) * LT.em, t: T, idx: j, a: 1 });
  }
  // Commas belong to exactly one state: the dominant one (ties go to the newer, longer number). The
  // whole set hops to its new grouping on the landing's middle frame; never two sets at once.
  let dom = 1;
  for (let D = 2; D <= ND; D++) if (L.wS[D] >= L.wS[dom]) dom = D;
  for (let a = 0; a < ND - 1; a++) {
    if (!sepAfter(a, dom)) continue;
    // centred in the gap as it is right now (equals the full-gap position once it has opened)
    out.push({ ch: ",", x: L.left + ((digitEm(a, L) + digitEm(a + 1, L)) / 2) * L.em, t: -1, idx: 100 + a, a: 1 });
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
  return { t, x: L.left + digitEm(i, L) * L.em, em: L.em, i };
});
const DEBRIS_L = layout(GAP - 1);
const DEBRIS = numberGlyphs(GAP - 1, DEBRIS_L);

/** Brightness kick: 1 at every landing, decaying quickly. */
const kickAt = (f: number) => {
  let k = 0;
  for (const im of IMPACTS) {
    const d = f - im.t;
    if (d >= 0 && d < 30) k = Math.max(k, Math.exp(-d / 5) * (im.i === 0 ? 1.3 : im.i === ND - 1 ? 1.25 : 0.75 + 0.25 * (im.i / 20)));
  }
  const ds = f - SUFFIX;
  if (ds >= 0 && ds < 30) k = Math.max(k, Math.exp(-ds / 6));
  return k;
};

/** The old picture (number, labels, ember) stays until the last breath: the digits implode right up to the slam. */
const oldA = (f: number) => 1 - ease.inQuad(prog(f, GAP - 6, GAP));
/** How far the digits have been sucked toward the slam point (0..0.32). */
const IMPLODE = 0.32;
const implodeAt = (f: number) => IMPLODE * ease.inCubic(prog(f, GAP - 14, GAP - 1));

// ---- ENIAC ember --------------------------------------------------------------------------------
const EA = { x: 560, y: NY };
const EB = { x: 262, y: 196 };
const emberAt = (f: number) => {
  const n = nZeros(Math.min(f, GAP - 1));
  const k = ease.inOutCubic(clamp((n - 2) / 5));
  const k2 = ease.inOutCubic(clamp((n - 6) / 14));
  return {
    x: lerp(EA.x, EB.x, k),
    y: lerp(EA.y, EB.y, k),
    s: lerp(1, 0.72, k) * lerp(1, 0.58, k2), // ~0.42 once all twenty zeros are in
    ls: lerp(1, 0.84, k) * lerp(1, 0.84, k2), // the labels shrink less, so they stay readable
    dim: lerp(1, 0.6, k2),
    a: oldA(f),
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
const TX1 = 1700;
const TBASE = 690;
const PITCH = (TX1 - TX0) / 54;
const BW = PITCH - 7;
/** Log scale: every block is one doubling, so the tops form a straight ramp. */
const bhLog = (k: number) => 40 + (k / 53) * 252;
const barX = (k: number) => TX0 + k * PITCH + PITCH / 2;
const doublings = (f: number) => DT.filter((t) => t <= f).length;
// The payoff after the 54th doubling: a light wave runs up the ramp (left to right) while a span
// draws "78 年" along the axis; when the wave reaches the top block, a beam carries its light up into
// the "2亿亿" headline, which flares on arrival.
const SWEEP_LEN = 12; // frames for the wave to cross all 54 blocks
const BEAM0 = FULL + SWEEP_LEN - 1; // the beam leaves the top block
const BEAM_LEN = 11;
const HIT = BEAM0 + BEAM_LEN; // ...and lands in the headline
const sweepAt = (f: number) => (f >= FULL && f < FULL + SWEEP_LEN + 8 ? (f - FULL) * (53 / (SWEEP_LEN - 1)) : -99);
/** Where the headline's "2亿亿" sits once it has docked at the top (frame coordinates). */
const HEAD = { x: 1032, y: 196 };
/** Half-width of the docked headline block ("差距：约 2亿亿 倍" is centred on x = 960), plus a margin. */
const HEAD_RX = 380;
const beamPt = (u: number) => {
  const x0 = barX(53);
  const y0 = TBASE - bhLog(53) - 8;
  // arcs high over the headline's right end and drops into "2亿亿"
  const cx = 1500;
  const cy = 10;
  const x1 = HEAD.x + 20;
  const y1 = HEAD.y - 34;
  const v = 1 - u;
  return { x: v * v * x0 + 2 * v * u * cx + u * u * x1, y: v * v * y0 + 2 * v * u * cy + u * u * y1 };
};

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

const STAR_COLS = ["#cfe6ff", C.ice, "#ffd2f2", C.warm];

/** Camera scale of the deep background: pulls back as the number grows. */
const bgZoom = (f: number) => {
  const push = 1 + 0.04 * prog(f, 0, ZEROS);
  const L = layout(Math.min(f, GAP - 1));
  const pull = Math.pow(L.em / EM_MAX, 0.85);
  const after = f >= GAP ? 1 + 0.5 * ease.outExpo(prog(f, GAP, GAP + 60)) + 0.1 * prog(f, GAP + 60, DUR) : 1;
  return push * pull * after;
};

/** Deep background, drawn into the stage canvas (frame coordinates; it also fills the off-screen margin). */
const drawBackdrop = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number) => {
  ctx.fillStyle = C.bg;
  ctx.fillRect(-SM, -SM, w + 2 * SM, h + 2 * SM);
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
  ctx.fillRect(-SM, -SM, w + 2 * SM, h + 2 * SM);
  if (f < GAP + 30) {
    const cool = (0.18 + 0.02 * L.n + 0.35 * kick) * numA * (1 - clamp(g / 30)) * (0.35 + 0.65 * oldA(f));
    grd = ctx.createRadialGradient(L.cx, NY, 0, L.cx, NY, 1100);
    grd.addColorStop(0, `rgba(70,30,120,${cool})`);
    grd.addColorStop(0.5, `rgba(20,30,90,${cool * 0.5})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(-SM, -SM, w + 2 * SM, h + 2 * SM);
  }
  if (g >= 0) {
    const heat = 0.55 * Math.exp(-g / 26) + 0.2 * (1 - prog(f, DOUBLING - 30, DOUBLING + 30));
    grd = ctx.createRadialGradient(GX, GY, 0, GX, GY, 1300);
    grd.addColorStop(0, `rgba(150,40,60,${heat})`);
    grd.addColorStop(0.45, `rgba(70,16,60,${heat * 0.6})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(-SM, -SM, w + 2 * SM, h + 2 * SM);
  }
  if (f >= DOUBLING - 30) {
    const a = ease.outCubic(prog(f, DOUBLING - 30, DOUBLING + 20));
    const lit = doublings(f) / 54;
    grd = ctx.createLinearGradient(0, TBASE - 420, 0, TBASE + 170);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.72, `rgba(60,24,90,${a * (0.18 + 0.25 * lit)})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(-SM, TBASE - 420, w + 2 * SM, 590);
  }
  // starfield: pulls back with the number, inhales, then warps outward on the slam
  const z = bgZoom(f);
  const streak = g >= 0 ? 1 + 0.9 * Math.exp(-g / 9) : 1 - 0.35 * inhale;
  const starA = (0.35 + 0.65 * numA) * (1 - 0.6 * (1 - oldA(f)));
  const cx = w / 2;
  const cy = h / 2 - 20;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  // batched by colour x brightness bucket: a few draw calls instead of a thousand
  const asStreak = Math.abs(streak - 1) > 0.04;
  const paths: Path2D[] = Array.from({ length: STAR_COLS.length * 5 }, () => new Path2D());
  const boost = starA * (1 + 1.5 * kick) * (asStreak ? 1.4 : 1);
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    const d = s.d * z;
    const x = cx + Math.cos(s.a) * d;
    const y = cy + Math.sin(s.a) * d * 0.62;
    if (x < -SM || x > w + SM || y < -SM || y > h + SM) continue;
    const tw = 0.6 + 0.4 * Math.sin(f * 0.07 + s.tw);
    const ci = s.c < 0.6 ? 0 : s.c < 0.8 ? 1 : s.c < 0.92 ? 2 : 3;
    const a = Math.min(1, s.b * tw * boost);
    if (a < 0.05) continue;
    const p = paths[ci * 5 + Math.min(4, Math.floor(a * 5))];
    if (asStreak) {
      const d2 = d * streak;
      p.moveTo(x, y);
      p.lineTo(cx + Math.cos(s.a) * d2, cy + Math.sin(s.a) * d2 * 0.62);
    } else p.rect(x - s.s / 2, y - s.s / 2, s.s, s.s);
  }
  ctx.lineWidth = 1.6;
  for (let k = 0; k < paths.length; k++) {
    const col = withAlpha(STAR_COLS[Math.floor(k / 5)], ((k % 5) + 0.5) / 5);
    if (asStreak) {
      ctx.strokeStyle = col;
      ctx.stroke(paths[k]);
    } else {
      ctx.fillStyle = col;
      ctx.fill(paths[k]);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // inhale: the edges close in, all the way to a near-black frame on the last breath
  if (inhale > 0) {
    const last = ease.inQuad(prog(f, GAP - 7, GAP - 1));
    grd = ctx.createRadialGradient(GX, GY, lerp(200, 90, last), GX, GY, lerp(1150, 760, last));
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, `rgba(0,0,0,${0.75 * inhale + 0.2 * last})`);
    ctx.fillStyle = grd;
    ctx.fillRect(-SM, -SM, w + 2 * SM, h + 2 * SM);
  }
};

// ---- drawing helpers ------------------------------------------------------------------------------
const drawGlyph = (
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  em: number,
  st: number,
  s: number,
  alpha: number,
  col: string,
  heat: number,
  rot = 0,
  shadow = true,
  /** additive, flat-coloured copy (motion streaks) */
  streak = false,
) => {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s * st);
  ctx.font = DIGIT_FONT(em);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const by = CAP * em;
  if (streak) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.fillText(ch, 0, by);
    ctx.restore();
    return;
  }
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
  if (shadow) {
    ctx.shadowColor = col;
    ctx.shadowBlur = em * (0.16 + 0.3 * Math.min(1, heat));
  }
  // at rest: a pale top falling into the fully saturated colour; heat bleaches it white-hot
  const hk = Math.min(1, heat);
  const gr = ctx.createLinearGradient(0, -CAP * em, 0, CAP * em);
  gr.addColorStop(0, mix(col, "#ffffff", 0.55 + 0.45 * hk));
  gr.addColorStop(0.45, mix(col, "#ffffff", 0.2 + 0.7 * hk));
  gr.addColorStop(1, mix(col, "#ffffff", 0.6 * hk));
  ctx.fillStyle = gr;
  ctx.fillText(ch, 0, by);
  ctx.shadowBlur = 0;
  ctx.restore();
};

const drawEmber = (ctx: CanvasRenderingContext2D, f: number) => {
  const e = emberAt(f);
  if (e.a <= 0) return;
  const fade = ease.outCubic(prog(f, 4, 26)) * e.a;
  const fl = 0.8 + 0.2 * noise1(f * 0.35) + 0.08 * Math.sin(f * 1.7);
  const d = e.dim;
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, e.x, e.y, 120 * e.s, C.ember, 0.16 * fade * fl * d, 0.04);
  glow(ctx, e.x, e.y, 30 * e.s * fl, C.amber, 0.95 * fade * d);
  glow(ctx, e.x, e.y, 9 * e.s, C.warm, fade);
  // drifting ash
  for (let i = 0; i < 26; i++) {
    const life = 90;
    const t = (f + hash(i * 3.7) * life) % life;
    const x = e.x + (hash(i * 1.3) - 0.5) * 90 * e.s + Math.sin(t * 0.08 + i) * 10 * e.s;
    const y = e.y - t * 1.1 * e.s + 20 * e.s;
    glow(ctx, x, y, (3 + 2 * hash(i)) * Math.max(0.6, e.s), C.amber, 0.5 * Math.sin((t / life) * Math.PI) * fade * d);
  }
  // a slow heartbeat of ripples, dying away once the AI number takes over
  const ripA = fade * (1 - 0.75 * ease.inOutCubic(prog(f, ZEROS - 10, ZEROS + 50)));
  for (let k = 0; k < 2; k++) {
    const u = ((((f + k * 22) % 44) + 44) % 44) / 44;
    const r = (14 + 120 * ease.outCubic(u)) * e.s;
    ctx.strokeStyle = withAlpha(C.amber, 0.32 * Math.pow(1 - u, 2) * ripA);
    ctx.lineWidth = 1.5 + 2 * (1 - u);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, r, r * 0.92, 0, 0, TAU);
    ctx.stroke();
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
    ctx.moveTo(e.x + Math.cos(a) * (r + 6 * e.s), e.y + Math.sin(a) * (r + 6 * e.s));
    ctx.lineTo(e.x + Math.cos(a) * (r + 18 * e.s), e.y + Math.sin(a) * (r + 18 * e.s));
    ctx.stroke();
  }
};

/**
 * Opening: an empty slot on the right where today's number will land, and the ember's heartbeat
 * sending a slow ping across to it (and finding nothing there yet).
 */
const SLOT = { x: CX0, y: NY, hw: 250, hh: 190 };
const PINGS = [10, 50];
const PING_LEN = 30;
const drawOpening = (ctx: CanvasRenderingContext2D, f: number) => {
  const end = ZEROS + 2;
  if (f >= end) return;
  const fade = ease.outCubic(prog(f, 8, 34)) * (1 - ease.inCubic(prog(f, ZEROS - 10, end)));
  if (fade <= 0) return;
  let hit = 0;
  ctx.globalCompositeOperation = "lighter";
  // the faint wire between them
  const x0 = EA.x + 90;
  const x1 = SLOT.x - SLOT.hw - 24;
  const wire = ctx.createLinearGradient(x0, 0, x1, 0);
  wire.addColorStop(0, withAlpha(C.amber, 0.16 * fade));
  wire.addColorStop(1, withAlpha(C.ice, 0.1 * fade));
  ctx.fillStyle = wire;
  for (let x = x0; x < x1; x += 14) ctx.fillRect(x, NY - 0.75, 7, 1.5);
  for (const t0 of PINGS) {
    const u = (f - t0) / PING_LEN;
    if (u < 0) continue;
    if (u >= 1) {
      hit = Math.max(hit, Math.exp(-((u - 1) * PING_LEN) / 7));
      continue;
    }
    const q = ease.inOutSine(u);
    const x = lerp(x0, x1, q);
    const col = mix(C.amber, C.ice, q);
    const tr = ctx.createLinearGradient(x - 220, 0, x, 0);
    tr.addColorStop(0, withAlpha(col, 0));
    tr.addColorStop(1, withAlpha(col, 0.75 * fade));
    ctx.fillStyle = tr;
    ctx.fillRect(x - 220, NY - 1.5, 220, 3);
    glow(ctx, x, NY, 46, col, 0.5 * fade, 0.06);
    glow(ctx, x, NY, 9, C.white, 0.9 * fade);
  }
  // the empty slot: corner brackets that flare when a ping arrives
  const k = 1 - 0.12 * ease.inCubic(prog(f, ZEROS - 8, ZEROS));
  const hw = SLOT.hw * k;
  const hh = SLOT.hh * k;
  const a = (0.16 + 0.55 * hit) * fade;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = withAlpha(mix(C.ice, "#ffffff", hit), a);
  ctx.lineWidth = 2 + 1.5 * hit;
  const L = 40;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const cx = SLOT.x + sx * hw;
    const cy = NY + sy * hh;
    ctx.beginPath();
    ctx.moveTo(cx - sx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - sy * L);
    ctx.stroke();
  }
  if (hit > 0.01) {
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x1 + 20, NY, 120, C.ice, 0.35 * hit * fade, 0.05);
    ctx.strokeStyle = withAlpha(C.ice, 0.25 * hit * fade);
    ctx.lineWidth = 1;
    ctx.strokeRect(SLOT.x - hw, NY - hh, hw * 2, hh * 2);
  }
  ctx.globalCompositeOperation = "source-over";
};

const drawNumber = (ctx: CanvasRenderingContext2D, f: number, L: Layout) => {
  const A = oldA(f);
  if (A <= 0) return;
  const inhale = ease.inQuad(prog(f, INHALE, GAP));
  const gl = numberGlyphs(f, L);
  const half = CAP * L.em * L.st;
  // energy band behind the number
  const kick = kickAt(f);
  const bandA = (clamp(L.n / 4) * 0.22 + 0.25 * kick + 0.3 * inhale) * A;
  if (bandA > 0.01) {
    const bh = half * 1.7;
    const rx = (L.right - L.left) / 2 + 220;
    ctx.save();
    ctx.translate((L.left + L.right) / 2, NY);
    ctx.scale(rx / bh, 1);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, bh);
    gr.addColorStop(0, withAlpha(mix(C.violet, C.magenta, 0.4), bandA));
    gr.addColorStop(0.55, withAlpha(mix(C.violet, C.magenta, 0.4), bandA * 0.45));
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, bh, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // a specular sheen runs once across the finished number
  const sweepX = lerp(L.left - 300, L.right + 300, ease.inOutSine(prog(f, PUSH0, PUSH0 + 18)));
  const sheenOn = f >= PUSH0 && f <= PUSH0 + 18;
  // underglow
  ctx.globalCompositeOperation = "lighter";
  for (const g of gl) {
    if (g.ch === ",") continue;
    const p = landP(f, g.t);
    const dt = f - g.t;
    const heat = dt >= 0 ? Math.exp(-dt / 7) : 0.8 * p;
    glow(ctx, g.x, NY, half * 2 * (1 + 0.6 * heat), hotX(g.x), (0.16 + 0.55 * heat + 0.25 * inhale) * p * A, 0.04);
  }
  ctx.globalCompositeOperation = "source-over";
  // the last frames before the slam: everything is sucked toward the centre
  const implode = implodeAt(f);
  const stc = Math.min(L.st, 1.5); // commas keep a sane shape
  for (const g of gl) {
    const col = hotX(g.x);
    const jx = inhale > 0 ? (hash(f * 3.1 + g.idx * 7.7) - 0.5) * 16 * inhale * inhale : 0;
    const jy = inhale > 0 ? (hash(f * 5.3 + g.idx * 2.9) - 0.5) * 10 * inhale * inhale : 0;
    const sheen = sheenOn ? 0.6 * Math.exp(-Math.pow((g.x - sweepX) / 230, 2)) : 0;
    const ping = pingHeat(f, g.x);
    if (g.ch === ",") {
      const cy = NY + CAP * L.em * (L.st - stc);
      drawGlyph(ctx, ",", lerp(g.x, GX, implode) + jx, cy + jy, L.em, stc, 1, g.a * A, col, 0.2 * inhale + sheen + ping);
      continue;
    }
    const p = landP(f, g.t);
    if (p <= 0) continue;
    const dt = f - g.t;
    const approach = ease.inQuad(p);
    const pop = dt >= 0 ? 1 + 0.12 * Math.exp(-dt / 3) : 1;
    // fly in from the camera; while a caption is up, the flying glyph must stay out of the caption band
    const maxS = (790 - NY) / (half * 1.15);
    const s0 = capOnAt(f) ? Math.min(S_FLY, maxS) : S_FLY;
    const s = (1 + (s0 - 1) * (1 - approach)) * pop * (1 + 0.04 * inhale);
    // white-hot while it flies in (solid almost at once), cooling into its colour after the impact
    const heat = dt >= 0 ? Math.exp(-dt / 6) : 0.7;
    const alpha = ease.outCubic(p) * A;
    if (p < 1) {
      // short zoom streak: additive, saturated copies trailing back toward the camera
      const trail = 1 - approach;
      for (let q = 1; q <= 3; q++) {
        const sq = s * (1 + 0.045 * q * (0.3 + trail));
        drawGlyph(ctx, g.ch, g.x, NY, L.em, L.st, sq, alpha * 0.24 * (1 - q / 4), col, 0, 0, false, true);
      }
    }
    drawGlyph(ctx, g.ch, lerp(g.x, GX, implode) + jx, NY + jy, L.em, L.st, s * (1 - 0.3 * implode), alpha, col, heat + 0.35 * inhale + sheen + ping);
  }
};

// ---- the ember's ping ---------------------------------------------------------------------------
// The opening pings found nothing; now one sonar ring leaves the tiny ember and washes over the giant
// number, lighting each digit as it passes: 5,000 vs. this.
const PING_V = 118; // px per frame
const PING_OUT = 2; // the ring leaves this long after the ember flares
const pingHeat = (f: number, x: number) => {
  const t = f - PING - PING_OUT;
  if (t < 0 || f >= GAP) return 0;
  const e = emberAt(f);
  const dt = t - Math.hypot(x - e.x, NY - e.y) / PING_V;
  return dt < 0 ? 0 : 0.9 * Math.exp(-dt / 4);
};
const drawPing = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - PING;
  if (t < -5 || t > 32 || f >= GAP) return;
  const e = emberAt(f);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // the ember gathers itself, then flares
  const charge = t < 0 ? ease.inQuad((t + 5) / 5) : Math.exp(-t / 6);
  glow(ctx, e.x, e.y, 80 + 170 * charge, C.amber, 0.55 * charge, 0.05);
  glow(ctx, e.x, e.y, 18 + 26 * charge, C.white, 0.95 * charge);
  const tr = t - PING_OUT;
  if (tr >= 0) {
    const R = 24 + tr * PING_V;
    const a = Math.exp(-tr / 12) * (1 - clamp((tr - 13) / 6));
    if (a > 0.01) {
      // one stroke per layer; a vertical gradient fades it out above the caption band (no hard cut-off)
      const col = mix(C.amber, C.ice, clamp(tr / 12));
      const core = mix(col, "#ffffff", 0.5);
      const fadeY = (c: string, k: number) => {
        const g = ctx.createLinearGradient(0, 690, 0, 785);
        g.addColorStop(0, withAlpha(c, k));
        g.addColorStop(1, withAlpha(c, 0));
        return g;
      };
      ctx.beginPath();
      ctx.arc(e.x, e.y, R - 10, 0, TAU);
      ctx.strokeStyle = fadeY(col, 0.16 * a);
      ctx.lineWidth = 26;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(e.x, e.y, R, 0, TAU);
      ctx.strokeStyle = fadeY(core, 0.95 * a);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  ctx.restore();
};

const impactBig = (i: number) => (i === 0 ? 1.5 : i === ND - 1 ? 1.75 : 0.8 + 0.5 * (i / 20));
/** Shockwave rings of every landing: drawn BEHIND the digits, so they never cut through a glyph. */
const drawImpactRings = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f >= GAP - 4) return;
  const A = oldA(f);
  ctx.globalCompositeOperation = "lighter";
  for (const im of IMPACTS) {
    const dt = f - im.t;
    if (dt < 0 || dt > 40) continue;
    const last = im.i === ND - 1;
    const big = impactBig(im.i);
    const col = hotX(im.x);
    const nr = last ? 3 : 2;
    // the last landing's rings are short-lived, so the finished number reads clean
    const life = last ? 1 - clamp((dt - 6) / 8) : 1 - clamp((dt - 14) / 16);
    for (let k = 0; k < nr; k++) {
      const tt = dt - k * 3;
      if (tt < 0) continue;
      const r = im.em * 0.35 + tt * (17 - k * 5) * big * Math.exp(-tt / 45);
      const a = Math.exp(-tt / (10 + k * 5)) * A * life;
      if (a < 0.02) continue;
      ctx.strokeStyle = withAlpha(k === 1 ? C.cyan : k === 2 ? C.magenta : mix(col, "#ffffff", 0.4), a * 0.85);
      ctx.lineWidth = 1.5 + 9 * a;
      ctx.beginPath();
      ctx.ellipse(im.x, NY, r, r * 0.42, 0, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
};
/** Brightness kick + sparks of every landing: in front of the digits. */
const drawImpacts = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f >= GAP - 4) return;
  const A = oldA(f);
  ctx.globalCompositeOperation = "lighter";
  for (const im of IMPACTS) {
    const dt = f - im.t;
    if (dt < 0 || dt > 50) continue;
    const last = im.i === ND - 1;
    const big = impactBig(im.i);
    const col = hotX(im.x);
    // brightness kick at the impact point
    glow(ctx, im.x, NY, 420 * big, col, 0.35 * Math.exp(-dt / 5) * big * A, 0.03);
    glow(ctx, im.x, NY, 90 * big, C.white, 0.34 * Math.exp(-dt / 3) * A, 0.1);
    // sparks
    const n = im.i === 0 ? 150 : last ? 190 : 70;
    for (let s = 0; s < n; s++) {
      const seed = im.i * 997 + s;
      const a = -Math.PI / 2 + (hash(seed * 1.31) - 0.5) * Math.PI * 1.9;
      const v = 4 + hash(seed * 2.7) * 22 * big;
      const drag = 0.06 + 0.05 * hash(seed * 3.1);
      const d = (v / drag) * (1 - Math.exp(-drag * dt));
      const x = im.x + Math.cos(a) * d * 1.25;
      const y = NY + Math.sin(a) * d * 0.8 + 0.1 * dt * dt;
      const life = 1 - dt / (last ? 12 + 12 * hash(seed * 4.4) : 20 + 28 * hash(seed * 4.4));
      if (life <= 0) continue;
      glow(ctx, x, y, 2 + 4 * hash(seed) * life + 1.5, s % 3 ? col : C.white, life * bandK(f, y) * A);
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
    glow(ctx, x, y, 2.5 + 4 * hash(i), col, (0.2 + 0.8 * k) * bandK(f, y));
  }
  // the singularity everything falls into: tight and hot, not a wash of white
  glow(ctx, GX, GY, 40 + 150 * Math.pow(k, 3), C.white, 0.9 * k * k, 0.12);
  glow(ctx, GX, GY, 80 + 320 * Math.pow(k, 3), C.magenta, 0.3 * k * k, 0.03);
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

/** The old digits blast aside: away from the slam text's row (up or down), fading fast, behind it. */
const drawDebris = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - GAP;
  if (t < 0 || t > 40) return;
  for (const g of DEBRIS) {
    // the blast starts from where the inhale left each digit (imploded toward the slam point)
    const x0 = lerp(g.x, GX, IMPLODE);
    const dx = g.x - GX;
    const side = dx >= 0 ? 1 : -1;
    const sp = (20 + 46 * hash(g.idx * 3.3)) * (0.45 + 0.75 * Math.min(1, Math.abs(dx) / 800));
    const up = hash(g.idx * 7.1) < 0.5 ? -1 : 1;
    const vy = up * (46 + 40 * hash(g.idx * 5.7));
    const drag = 0.07;
    const k = (1 - Math.exp(-drag * t)) / drag;
    const x = x0 + side * sp * k;
    const y = NY + vy * k + 0.25 * t * t;
    const rot = (hash(g.idx * 9.9) - 0.5) * 0.12 * t;
    const s = (1 - 0.3 * IMPLODE) * (1 + 0.06 * t);
    const a = 0.55 * Math.exp(-t / 4.5) * g.a;
    const col = hotX(g.x);
    const st = g.ch === "," ? Math.min(DEBRIS_L.st, 1.5) : DEBRIS_L.st;
    drawGlyph(ctx, g.ch, x, y, DEBRIS_L.em, st, s, a, col, Math.exp(-t / 6), rot);
  }
};

const SPARK_COLS = ["#ffffff", C.cyan, C.magenta, C.gold];
const drawExplosion = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - GAP;
  if (t < 0) return;
  const hold = 1 - prog(f, DOUBLING - 40, DOUBLING + 10);
  ctx.globalCompositeOperation = "lighter";
  // god rays: white-gold at the blast, settling into warm, slowly breathing amber/ember rays for the hold
  const rayA = 0.3 * Math.exp(-t / 28) + (0.13 + 0.03 * Math.sin(t * 0.11)) * hold * clamp(t / 20);
  if (rayA > 0.005) {
    ctx.save();
    ctx.translate(GX, GY);
    ctx.rotate(t * 0.0025);
    const warmK = clamp(t / 30);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU + hash(i * 1.9) * 0.08;
      const len = 1500;
      const wid = 0.008 + hash(i * 9.1) * 0.03;
      const hot0 = i % 4 === 0 ? "#ffffff" : mix(C.gold, C.magenta, hash(i * 2.2));
      const warm0 = i % 4 === 0 ? C.warm : mix(C.gold, C.ember, hash(i * 2.2));
      const col = mix(hot0, warm0, warmK);
      // each ray breathes on its own phase
      const br = 0.75 + 0.25 * Math.sin(t * 0.07 + i * 1.7);
      const gr = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gr.addColorStop(0, withAlpha(col, rayA * br * (0.6 + 0.4 * hash(i * 4.4))));
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
  glow(ctx, GX, GY, 1000 * Math.exp(-t / 9) + 160, C.white, 0.8 * Math.exp(-t / 6), 0.04);
  glow(ctx, GX, GY, 1500 * Math.exp(-t / 30) + 400, C.ember, 0.55 * Math.exp(-t / 18) + 0.06 * hold, 0.02);
  // shockwave rings
  for (let k = 0; k < 7; k++) {
    const tt = t - k * 3.5;
    if (tt < 0) continue;
    const r = 60 + tt * (64 - k * 4) * Math.exp(-tt / 70);
    // every wave is gone before the sub-line comes up under the headline
    const a = Math.exp(-tt / (7 + k)) * (1 - clamp((tt - 20) / 16)) * (1 - clamp((t - 18) / 8));
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
  // thousands of sparks: the fastest as streaks, the dying ones as plain dots (batched, no glow sprite)
  const N = 2600;
  ctx.lineCap = "round";
  const streaks: Path2D[] = Array.from({ length: SPARK_COLS.length * 4 }, () => new Path2D());
  const dots: Path2D[] = SPARK_COLS.map(() => new Path2D());
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
    const ci = i % 5 === 0 ? 0 : i % 5 === 1 ? 1 : i % 5 === 2 ? 2 : 3;
    const vel = v * Math.exp(-drag * t);
    if (vel > 9) {
      const sx = Math.cos(a) * vel * 1.35 * 2.2;
      const sy = Math.sin(a) * vel * 0.78 * 2.2;
      const p = streaks[ci * 4 + Math.min(3, Math.floor(life * 4))];
      p.moveTo(x, y);
      p.lineTo(x - sx, y - sy);
    }
    if (life < 0.2) {
      const r = 1.2 + 1.5 * hash(i * 1.7);
      dots[ci].rect(x - r, y - r, r * 2, r * 2);
      continue;
    }
    glow(ctx, x, y, 2 + 6 * hash(i * 1.7) * life + 1.5, SPARK_COLS[ci], life);
  }
  ctx.lineWidth = 2.2;
  for (let k = 0; k < streaks.length; k++) {
    ctx.strokeStyle = withAlpha(SPARK_COLS[Math.floor(k / 4)], (0.6 * ((k % 4) + 0.5)) / 4);
    ctx.stroke(streaks[k]);
  }
  for (let k = 0; k < dots.length; k++) {
    ctx.fillStyle = withAlpha(SPARK_COLS[k], 0.45);
    ctx.fill(dots[k]);
  }
  // forked lightning tearing outward from the impact for the first few frames
  if (t < 14) {
    const la = Math.exp(-t / 4.5);
    const epoch = Math.floor(f / 2);
    ctx.lineJoin = "round";
    for (let b = 0; b < 11; b++) {
      const seed = b * 31.7 + epoch * 7.3;
      const ang = (b / 11) * TAU + (hash(seed) - 0.5) * 0.5;
      const len = (520 + 700 * hash(seed + 1.1)) * (0.55 + 0.45 * ease.outCubic(clamp((t + 1) / 4)));
      const pts: [number, number][] = [[GX, GY]];
      const segs = 13;
      for (let q = 1; q <= segs; q++) {
        const d = (q / segs) * len;
        const j = (hash(seed + q * 3.7) - 0.5) * 70 * (q / segs + 0.3);
        pts.push([GX + Math.cos(ang) * d * 1.3 - Math.sin(ang) * j, GY + Math.sin(ang) * d * 0.8 + Math.cos(ang) * j * 0.8]);
      }
      const col = b % 3 === 0 ? C.cyan : b % 3 === 1 ? C.magenta : "#ffffff";
      const path = () => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      };
      ctx.strokeStyle = withAlpha(col, 0.18 * la);
      ctx.lineWidth = 16;
      path();
      ctx.stroke();
      ctx.strokeStyle = withAlpha(mix(col, "#ffffff", 0.6), 0.9 * la);
      ctx.lineWidth = 2.5;
      path();
      ctx.stroke();
      // a fork from the middle
      const m = pts[6];
      const fa = ang + (hash(seed + 9.9) - 0.5) * 1.2;
      ctx.beginPath();
      ctx.moveTo(m[0], m[1]);
      for (let q = 1; q <= 5; q++) {
        const d = q * 46;
        const j = (hash(seed + q * 5.1 + 2) - 0.5) * 40;
        ctx.lineTo(m[0] + Math.cos(fa) * d * 1.3 - Math.sin(fa) * j, m[1] + Math.sin(fa) * d * 0.8 + Math.cos(fa) * j);
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  // aftershocks: slow ripples rolling out from just outside the text block while it holds (they
  // start beyond the text's extent, so no ring ever crosses the headline or the sub-line)
  if (t > 26) {
    const ra = hold * clamp((t - 26) / 20);
    for (let k = 0; k < 3; k++) {
      const u = ((((t - 26 + k * 12) % 36) + 36) % 36) / 36;
      const r = RING_R0 + 800 * ease.outCubic(u);
      ctx.strokeStyle = withAlpha(k === 1 ? C.ember : C.gold, 0.2 * Math.pow(1 - u, 1.5) * ra * clamp(u * 6));
      ctx.lineWidth = 2 + 6 * (1 - u);
      ctx.beginPath();
      ctx.ellipse(GX, GY, r, r * 0.62, 0, 0, TAU);
      ctx.stroke();
    }
  }
  // one last heavy aftershock while the text holds, so the hold keeps breathing
  const ta = f - AFTERSHOCK;
  if (ta >= 0 && ta < 40) {
    const a = Math.exp(-ta / 9) * hold;
    for (let k = 0; k < 2; k++) {
      const tk = ta - k * 4;
      if (tk < 0) continue;
      const r = RING_R0 + tk * (34 - k * 8) * Math.exp(-tk / 40);
      const ak = Math.exp(-tk / (9 + 4 * k)) * hold;
      ctx.strokeStyle = withAlpha(k ? C.magenta : mix(C.gold, "#ffffff", 0.4), 0.6 * ak);
      ctx.lineWidth = 2 + 12 * ak;
      ctx.beginPath();
      ctx.ellipse(GX, GY, r, r * 0.6, 0, 0, TAU);
      ctx.stroke();
    }
    glow(ctx, GX, GY, 700, C.ember, 0.22 * a, 0.03);
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
const AFTERSHOCK = GAP + 64;
/** Aftershock rings start outside the slam text block (its half-width is ~700 px at the hold's scale). */
const RING_R0 = 760;

const drawDoubling = (ctx: CanvasRenderingContext2D, f: number) => {
  const a0 = ease.outCubic(prog(f, DOUBLING - 24, DOUBLING + 4));
  if (a0 <= 0) return;
  const n = doublings(f);
  const tf = f - FULL;
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
  // a comet draws the 1946 -> 2024 axis before the first block lights
  const ap = prog(f, DOUBLING - 24, DOUBLING + 6);
  if (ap > 0 && ap < 1) {
    const hx = TX0 - 10 + axisW;
    const ha = a0 * Math.min(1, ap * 8) * (1 - ease.inQuad(prog(ap, 0.86, 1)));
    const hc = mix(C.gold, C.cyan, ap);
    ctx.globalCompositeOperation = "lighter";
    const tr = ctx.createLinearGradient(hx - 520, 0, hx, 0);
    tr.addColorStop(0, withAlpha(C.gold, 0));
    tr.addColorStop(1, withAlpha(hc, 0.9 * ha));
    ctx.fillStyle = tr;
    ctx.fillRect(hx - 520, TBASE + 6, 520, 10);
    ctx.fillRect(hx - 260, TBASE + 2, 260, 18);
    glow(ctx, hx, TBASE + 11, 170, hc, 0.75 * ha, 0.05);
    glow(ctx, hx, TBASE + 11, 26, C.white, ha);
    // sparks shed behind the head
    for (let q = 0; q < 24; q++) {
      const age = hash(q * 3.1) * 10;
      const sx = hx - age * 38 * (0.6 + 0.4 * hash(q * 1.7));
      const sy = TBASE + 11 + (hash(q * 5.3) - 0.5) * age * 5 + 0.25 * age * age;
      glow(ctx, sx, sy, 3 + 3 * hash(q), q % 2 ? hc : C.white, ha * (1 - age / 10));
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // arrival at 2024: a ring burst at the end of the axis
  const ar = f - (DOUBLING + 2);
  if (ar >= 0 && ar < 26) {
    ctx.save();
    // clipped just under the axis, so it never touches the "2024" label popping in below
    ctx.beginPath();
    ctx.rect(TX1 - 200, TBASE - 200, 400, 222);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 2; k++) {
      const tt = ar - k * 4;
      if (tt < 0) continue;
      const r = 10 + tt * 9 * Math.exp(-tt / 30);
      ctx.strokeStyle = withAlpha(k ? C.white : C.cyan, 0.8 * Math.exp(-tt / 7) * a0);
      ctx.lineWidth = 2 + 5 * Math.exp(-tt / 6);
      ctx.beginPath();
      ctx.ellipse(TX1 + 10, TBASE + 11, r, r * 0.42, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, TX1 + 10, TBASE + 11, 140, C.cyan, 0.6 * Math.exp(-ar / 6) * a0, 0.05);
    ctx.globalCompositeOperation = "source-over";
  }
  // the 54th doubling: a light wave runs up the whole ramp, left to right
  const sweep = sweepAt(f);
  for (let k = 0; k < 54; k++) {
    const x = TX0 + k * PITCH + (PITCH - BW) / 2;
    const hk = bhLog(k);
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
    const pc = clamp(p);
    const heat = dt >= 0 ? Math.exp(-dt / 6) : 1;
    const wave = sweep > -50 ? Math.exp(-Math.pow(k - sweep, 2) / 8) : 0;
    const col = hot(k / 53);
    const hh = hk * p;
    const top = TBASE - hh;
    const gr = ctx.createLinearGradient(0, top, 0, TBASE);
    gr.addColorStop(0, mix(col, "#ffffff", Math.min(1, 0.5 + 0.5 * heat + wave)));
    gr.addColorStop(Math.min(0.5, 24 / Math.max(1, hh)), mix(col, "#ffffff", 0.6 * wave));
    gr.addColorStop(1, withAlpha(mix(col, "#ffffff", 0.4 * wave), 0.36 + 0.4 * wave));
    ctx.fillStyle = gr;
    ctx.fillRect(x, top, BW, hh);
    // floor reflection
    const rh = Math.min(hh * 0.4, 70);
    if (rh > 1) {
      const rg = ctx.createLinearGradient(0, TBASE + 14, 0, TBASE + 14 + rh);
      rg.addColorStop(0, withAlpha(col, 0.22 + 0.2 * heat + 0.2 * wave));
      rg.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x, TBASE + 14, BW, rh);
    }
    ctx.globalCompositeOperation = "lighter";
    // the top glow rises with the block (no hot dot parked on the floor before it grows)
    glow(ctx, x + BW / 2, top, 30 + 60 * heat + 50 * wave, col, (0.4 + 0.6 * heat + 0.7 * wave) * pc);
    if (heat > 0.1) glow(ctx, x + BW / 2, top + hh / 2, Math.max(90, hh * 0.9 + 30), col, 0.35 * heat * pc, 0.04);
    // the wave lifts a short shaft of light off each block top as it passes
    if (wave > 0.04) {
      const sh = 70 + 90 * (k / 53);
      const sg = ctx.createLinearGradient(0, top - sh, 0, top);
      sg.addColorStop(0, withAlpha(col, 0));
      sg.addColorStop(1, withAlpha(mix(col, "#ffffff", 0.5), 0.55 * wave));
      ctx.fillStyle = sg;
      ctx.fillRect(x, top - sh, BW, sh);
    }
    // a little burst of sparks off the top of every new block
    if (dt >= 0 && dt < 16) {
      for (let q = 0; q < 14; q++) {
        const sd = k * 131 + q;
        const an = -Math.PI / 2 + (hash(sd * 1.7) - 0.5) * 2.4;
        const v = 3 + 7 * hash(sd * 2.3);
        const d = v * dt * (1 - dt / 40);
        const life = 1 - dt / 16;
        glow(ctx, x + BW / 2 + Math.cos(an) * d, TBASE - bhLog(k) + Math.sin(an) * d + 0.12 * dt * dt, 2 + 3 * hash(sd), q % 3 ? col : "#ffffff", life);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // the line through the block tops: one doubling per block, so on this (log) scale it is a straight ramp
  if (n > 1) {
    const lg = ctx.createLinearGradient(TX0, 0, TX1, 0);
    lg.addColorStop(0, hot(0));
    lg.addColorStop(0.5, hot(0.5));
    lg.addColorStop(1, hot(1));
    const path = () => {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const p = ease.outBack(clamp((f - DT[k] + 2) / 6));
        const y = TBASE - bhLog(k) * p - 9;
        if (k) ctx.lineTo(barX(k), y);
        else ctx.moveTo(barX(k), y);
      }
    };
    const fin = tf >= 0 ? Math.exp(-tf / 14) : 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = lg;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = (0.14 + 0.3 * fin) * a0;
    ctx.lineWidth = 16 + 8 * fin;
    path();
    ctx.stroke();
    ctx.globalAlpha = (0.85 + 0.15 * fin) * a0;
    ctx.lineWidth = 3 + 2 * fin;
    path();
    ctx.stroke();
    ctx.restore();
  }
  // scanning head on the newest block (retires once the last one is in)
  if (n > 0 && f < FULL + 8) {
    const k = n - 1;
    const x = barX(k);
    const hk = bhLog(k);
    const ha = a0 * (1 - prog(f, FULL, FULL + 8));
    const gr = ctx.createLinearGradient(0, TBASE - hk - 150, 0, TBASE + 10);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(1, withAlpha("#ffffff", 0.55 * ha));
    ctx.fillStyle = gr;
    ctx.fillRect(x - 1.5, TBASE - hk - 150, 3, hk + 160);
  }
  // ×2 pulses over the newest block
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let k = Math.max(0, n - 1); k < n; k++) {
    const dt = f - DT[k];
    if (dt > 16) continue;
    const a = (1 - dt / 16) * a0;
    const s = 1 + 0.5 * Math.exp(-dt / 3);
    const y = TBASE - bhLog(k) - 34 - dt * 2.6;
    ctx.save();
    ctx.translate(barX(k), y);
    ctx.scale(s, s);
    ctx.font = `800 32px ${FONT_MONO}`;
    ctx.shadowColor = hot(k / 53);
    ctx.shadowBlur = 14;
    ctx.fillStyle = withAlpha("#ffffff", a);
    ctx.fillText("×2", 0, 0);
    ctx.restore();
  }
  // the 54th lands: a ring burst on the top of the ramp
  if (tf >= 0 && tf < 30) {
    const x = barX(53);
    const y = TBASE - bhLog(53);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      const tt = tf - k * 3;
      if (tt < 0) continue;
      const r = 16 + tt * (16 - k * 3) * Math.exp(-tt / 30);
      const a = Math.exp(-tt / 8);
      ctx.strokeStyle = withAlpha(k === 1 ? C.cyan : k === 2 ? C.magenta : "#ffffff", a * 0.9);
      ctx.lineWidth = 2 + 10 * a;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, 0, 0, TAU);
      ctx.stroke();
    }
    glow(ctx, x, y, 360, C.cyan, 0.5 * Math.exp(-tf / 7), 0.03);
    glow(ctx, x, y, 90, C.white, 0.9 * Math.exp(-tf / 4), 0.1);
    for (let q = 0; q < 60; q++) {
      const an = -Math.PI / 2 + (hash(q * 4.7) - 0.5) * 2.6;
      const v = 5 + 15 * hash(q * 2.1);
      const d = (v / 0.08) * (1 - Math.exp(-0.08 * tf));
      const life = 1 - tf / (14 + 12 * hash(q * 3.3));
      if (life <= 0) continue;
      glow(ctx, x + Math.cos(an) * d, y + Math.sin(an) * d * 0.8 + 0.2 * tf * tf, 2 + 4 * hash(q), q % 3 ? C.cyan : "#ffffff", life);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  drawSpan(ctx, f, a0);
  drawBeam(ctx, f);
  // after the beam: embers keep lifting off the hot upper half of the ramp
  if (f > HIT - 6) {
    const ea = clamp((f - HIT + 6) / 10);
    ctx.globalCompositeOperation = "lighter";
    for (let q = 0; q < 56; q++) {
      const k = 22 + Math.floor(hash(q * 1.9) * 32);
      const lifeT = 26 + 20 * hash(q * 5.1);
      const ph = (f - HIT + hash(q * 7.7) * lifeT) % lifeT;
      const u = ph / lifeT;
      const x = barX(k) + (hash(q * 3.1) - 0.5) * PITCH * 1.4 + Math.sin(ph * 0.2 + q) * 4;
      const y = TBASE - bhLog(k) - 10 - u * (60 + 50 * hash(q * 2.7));
      glow(ctx, x, y, 2 + 3 * hash(q), q % 3 ? hot(k / 53) : "#ffffff", Math.sin(u * Math.PI) * 0.8 * ea * a0);
    }
    ctx.globalCompositeOperation = "source-over";
  }
};

/** "1946 ←—— 78 年 ——→ 2024": a span drawn along the year row in step with the light wave. */
const SPAN_Y = TBASE + 52;
const SPAN_X0 = TX0 + 92;
const SPAN_X1 = TX1 - 92;
const SPAN_MID = (SPAN_X0 + SPAN_X1) / 2;
const SPAN_GAP = 84; // half-width of the hole the "78 年" label sits in
const spanP = (f: number) => ease.inOutSine(prog(f, FULL, FULL + SWEEP_LEN));
const drawSpan = (ctx: CanvasRenderingContext2D, f: number, a0: number) => {
  const p = spanP(f);
  if (p <= 0) return;
  // drawn outward from the middle to both ends
  const half = (SPAN_MID - SPAN_X0) * p;
  ctx.save();
  ctx.globalAlpha = a0;
  const lg = ctx.createLinearGradient(SPAN_X0, 0, SPAN_X1, 0);
  lg.addColorStop(0, withAlpha(C.amber, 0.85));
  lg.addColorStop(0.5, withAlpha("#ffffff", 0.7));
  lg.addColorStop(1, withAlpha(C.cyan, 0.85));
  ctx.fillStyle = lg;
  const l0 = SPAN_MID - half;
  const r1 = SPAN_MID + half;
  if (SPAN_MID - SPAN_GAP > l0) ctx.fillRect(l0, SPAN_Y - 1, SPAN_MID - SPAN_GAP - l0, 2);
  if (r1 > SPAN_MID + SPAN_GAP) ctx.fillRect(SPAN_MID + SPAN_GAP, SPAN_Y - 1, r1 - SPAN_MID - SPAN_GAP, 2);
  // arrow heads once the span reaches the ends
  const ah = clamp((p - 0.92) / 0.08);
  if (ah > 0) {
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2;
    ctx.globalAlpha = a0 * ah;
    for (const [x, d] of [
      [SPAN_X0, 1],
      [SPAN_X1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + d * 12, SPAN_Y - 8);
      ctx.lineTo(x, SPAN_Y);
      ctx.lineTo(x + d * 12, SPAN_Y + 8);
      ctx.stroke();
    }
  }
  // the two running heads
  if (p < 1) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    glow(ctx, l0, SPAN_Y, 26, C.amber, 0.8 * a0);
    glow(ctx, r1, SPAN_Y, 26, C.cyan, 0.8 * a0);
  }
  ctx.restore();
};

/** The 54th doubling's light travels from the top block up into the "2亿亿" headline. */
const drawBeam = (ctx: CanvasRenderingContext2D, f: number) => {
  const t = f - BEAM0;
  if (t < 0 || t > BEAM_LEN + 34) return;
  const head = ease.inOutCubic(clamp(t / BEAM_LEN));
  const tail = ease.inOutCubic(clamp((t - 5) / BEAM_LEN));
  const fade = 1 - clamp((t - BEAM_LEN) / 6);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  if (fade > 0 && head > tail) {
    // one continuous path per layer (no overlapping caps), fading in from the tail to the head
    const N = 30;
    const pts = Array.from({ length: N + 1 }, (_, i) => beamPt(lerp(tail, head, i / N)));
    const p0 = pts[0];
    const p1 = pts[N];
    const col = mix(C.cyan, C.gold, head);
    const layer = (c: string, a: number, wdt: number) => {
      const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      g.addColorStop(0, withAlpha(c, 0));
      g.addColorStop(0.6, withAlpha(c, a * 0.45));
      g.addColorStop(1, withAlpha(c, a));
      ctx.strokeStyle = g;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    };
    ctx.lineJoin = "round";
    layer(col, 0.14 * fade, 46);
    layer(col, 0.42 * fade, 14);
    layer(mix(col, "#ffffff", 0.7), fade, 5);
    const h = beamPt(head);
    glow(ctx, h.x, h.y, 220, mix(C.cyan, C.gold, head), 0.75 * fade, 0.05);
    glow(ctx, h.x, h.y, 44, C.white, fade);
    // sparks shed behind the head
    for (let q = 0; q < 26; q++) {
      const back = hash(q * 3.3) * 0.22;
      const pt = beamPt(clamp(head - back));
      const age = back / 0.22;
      glow(ctx, pt.x + (hash(q * 5.1) - 0.5) * 30 * age, pt.y + (hash(q * 7.9) - 0.5) * 30 * age + 20 * age * age, 2 + 3 * hash(q), q % 2 ? C.gold : C.white, (1 - age) * fade);
    }
  }
  // the launch flare on the top block
  const l = Math.exp(-t / 5);
  const b0 = beamPt(0);
  glow(ctx, b0.x, b0.y, 200, C.cyan, 0.5 * l, 0.04);
  // arrival: the headline takes the hit
  const th = f - HIT;
  if (th >= 0) {
    const a = Math.exp(-th / 8);
    glow(ctx, HEAD.x, HEAD.y - 30, 420, C.gold, 0.3 * a, 0.03);
    glow(ctx, HEAD.x, HEAD.y - 30, 140, C.white, 0.7 * Math.exp(-th / 4), 0.1);
    // rings roll out from just outside the whole headline block, so none crosses its text
    for (let k = 0; k < 3; k++) {
      const tt = th - k * 3;
      if (tt < 0) continue;
      const rx = HEAD_RX + tt * (26 - k * 5) * Math.exp(-tt / 30);
      const ra = Math.exp(-tt / 7);
      ctx.strokeStyle = withAlpha(k === 1 ? C.magenta : k === 2 ? C.cyan : mix(C.gold, "#ffffff", 0.5), 0.8 * ra);
      ctx.lineWidth = 2 + 9 * ra;
      ctx.beginPath();
      ctx.ellipse(960, HEAD.y - 26, rx, rx * 0.36, 0, 0, TAU);
      ctx.stroke();
    }
    for (let q = 0; q < 90; q++) {
      const an = hash(q * 2.9 + 0.4) * TAU;
      const v = 6 + 16 * hash(q * 4.1);
      const d = (v / 0.09) * (1 - Math.exp(-0.09 * th));
      const life = 1 - th / (14 + 16 * hash(q * 3.7));
      if (life <= 0) continue;
      glow(ctx, HEAD.x + Math.cos(an) * d * 1.5, HEAD.y - 30 + Math.sin(an) * d * 0.5 + 0.15 * th * th, 2 + 4 * hash(q), q % 3 ? C.gold : "#ffffff", life);
    }
  }
  ctx.restore();
};

/** Frame-wide chromatic aberration (px): the slam, and the last breath before it. Zero landings split per glyph instead. */
const abAt = (f: number) => {
  const g = f - GAP;
  if (g >= 0) return 34 * Math.exp(-g / 6);
  const k = ease.inQuad(prog(f, INHALE, GAP));
  return 8 * k * k;
};

let caBuf: HTMLCanvasElement | null = null;
let caHalf: HTMLCanvasElement | null = null;
let caTint: HTMLCanvasElement | null = null;
const buffers = (w: number, h: number) => {
  if (!caBuf || !caHalf || !caTint) {
    caBuf = document.createElement("canvas");
    caHalf = document.createElement("canvas");
    caTint = document.createElement("canvas");
    caBuf.width = w;
    caBuf.height = h;
    caHalf.width = caTint.width = Math.ceil(w / 2);
    caHalf.height = caTint.height = Math.ceil(h / 2);
  }
  return { buf: caBuf, half: caHalf, tint: caTint };
};
/**
 * True RGB split of the (opaque) stage canvas. The green channel is kept in place at full resolution
 * (a multiply), red and blue are isolated from a half-resolution copy and added back with their offsets:
 * they are offset anyway, so their softness never shows, and it costs a fraction of a full-res split.
 */
const chroma = (ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) => {
  const { half, tint } = buffers(w, h);
  const hb = half.getContext("2d")!;
  const t = tint.getContext("2d")!;
  hb.globalCompositeOperation = "copy";
  hb.drawImage(ctx.canvas, 0, 0, half.width, half.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  for (const [col, dx, dy] of [
    ["#ff0000", -1, 0],
    ["#0000ff", 1, 0.35],
  ] as const) {
    t.globalCompositeOperation = "copy";
    t.drawImage(half, 0, 0);
    t.globalCompositeOperation = "multiply";
    t.fillStyle = col;
    t.fillRect(0, 0, tint.width, tint.height);
    ctx.drawImage(tint, dx * amount, dy * amount, w, h);
  }
  ctx.restore();
};

/** Glitch strength around the slam (0..1), same envelope as the shared Glitch component. */
const tearK = (f: number) => {
  const t = f - (GAP + 2);
  if (t < 0 || t > 8) return 0;
  return 0.8 * Math.pow(1 - t / 8, 1.5);
};
/**
 * Digital tear done inside the stage canvas: horizontal slices of the frame jump sideways, with
 * coloured scan bars and block noise screened on top. (A blended DOM layer costs ~200 ms a frame.)
 */
const tear = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number, k: number) => {
  const { buf } = buffers(w, h);
  const b = buf.getContext("2d")!;
  b.globalCompositeOperation = "copy";
  b.globalAlpha = 1;
  b.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const n = Math.floor(6 + 14 * k);
  for (let i = 0; i < n; i++) {
    const y = Math.floor(hash(f * 13.1 + i * 7.7) * h);
    const bh = Math.floor(4 + hash(f * 3.3 + i * 1.9 + 4) * 70 * k);
    const off = (hash(f * 5.9 + i * 2.3 + 9) - 0.5) * 300 * k;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(buf, 0, y, w, bh, off, y, w, bh);
  }
  ctx.globalCompositeOperation = "screen";
  const cols = ["rgba(56,214,255,", "rgba(255,62,200,", "rgba(255,255,255,", "rgba(255,166,61,"];
  for (let i = 0; i < 10 + 24 * k; i++) {
    const r1 = hash(f * 17.3 + i * 5.1);
    const r2 = hash(f * 2.9 + i * 3.7 + 1);
    ctx.fillStyle = cols[i % 4] + (0.08 + 0.35 * k * r2) + ")";
    ctx.fillRect((hash(f * 7.7 + i) - 0.5) * 400 * k, r1 * h, w * (0.3 + r1 * 0.9), 2 + r2 * 26 * k);
  }
  // block noise in the palette's colours (grey blocks read as dirt)
  const bs = 24;
  for (let i = 0; i < 120 * k; i++) {
    const bx = Math.floor(hash(f * 7 + i * 3.1) * (w / bs)) * bs;
    const by = Math.floor(hash(f * 11 + i * 5.3) * (h / bs)) * bs;
    ctx.fillStyle = cols[i % 4] + 0.4 * k + ")";
    ctx.fillRect(bx, by, bs * (1 + Math.floor(hash(i * 2.2 + f) * 4)), bs);
  }
  ctx.restore();
};

/** Off-screen margin of the stage canvas, so camera shake and rotation never reveal its edge. */
const SM = 120;
const Stage: React.FC = () => (
  <Canvas
    width={1920 + 2 * SM}
    height={1080 + 2 * SM}
    style={{ left: -SM, top: -SM }}
    draw={(ctx, cw, chh, f) => {
      const w = 1920;
      const h = 1080;
      ctx.translate(SM, SM);
      drawBackdrop(ctx, w, h, f);
      const L = layout(Math.min(f, GAP - 1));
      drawExplosion(ctx, f);
      drawOpening(ctx, f);
      drawEmber(ctx, f);
      drawPing(ctx, f);
      drawImpactRings(ctx, f);
      if (f < GAP) drawNumber(ctx, f, L);
      drawImpacts(ctx, f);
      drawDebris(ctx, f);
      drawInhale(ctx, f);
      drawDoubling(ctx, f);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const ab = abAt(f);
      if (ab > 2.5) chroma(ctx, cw, chh, ab);
      const tk = tearK(f);
      if (tk > 0.01) tear(ctx, cw, chh, f, tk);
      // the slam's light: an additive, coloured burst from the centre that dies in a handful of frames
      const lt = f - (GAP + 2);
      if (lt >= 0 && lt < 7) {
        const a = 0.85 * Math.pow(1 - lt / 7, 3.5);
        ctx.save();
        ctx.translate(GX + SM, GY + SM);
        ctx.scale(1, 0.62);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1250);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(0.16, `rgba(255,232,190,${a * 0.85})`);
        gr.addColorStop(0.42, withAlpha(C.gold, a * 0.42));
        gr.addColorStop(0.72, withAlpha(C.magenta, a * 0.16));
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = gr;
        ctx.fillRect(-1250, -1250, 2500, 2500);
        ctx.restore();
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
  // the labels kick with the ember when it pings the big number
  const tp = f - PING;
  const pk = tp < -5 || tp > 30 ? 0 : tp < 0 ? 0.4 * ease.inQuad((tp + 5) / 5) : Math.exp(-tp / 7);
  return (
    <div
      style={{
        position: "absolute",
        left: e.x,
        top: e.y + 72 * e.s + 10 + rise * 16,
        transform: `translateX(-50%) scale(${e.ls * (1 + 0.12 * pk)})`,
        filter: pk > 0.02 ? `brightness(${1 + 0.6 * pk})` : undefined,
        transformOrigin: "50% 0",
        textAlign: "center",
        opacity: a,
        whiteSpace: "nowrap",
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
  const out = oldA(f);
  if (out <= 0) return null;
  const L = layout(Math.min(f, GAP - 1));
  const half = CAP * L.em * L.st;
  const a = ease.outCubic(prog(f, ZEROS - 14, ZEROS + 6)) * out;
  const label = "超算 · 今天";
  const typed = Math.floor(clamp((f - ZEROS + 10) / 14) * label.length);
  const sp = f - SUFFIX;
  const sufP = clamp((sp + 6) / 6);
  // lands from 1.5x, anchored at its top-right corner, so it never rises over the digits
  const sufS = sp < 0 ? 1 + 0.5 * (1 - ease.inQuad(sufP)) : 1 + 0.1 * Math.exp(-sp / 3);
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <div
        style={{
          position: "absolute",
          right: 1920 - L.right,
          // sits just clear of the biggest zero still flying in from the camera; once the last zero
          // is in, it settles down close to the finished number it labels
          top: lerp(NY - half * S_FLY - 64, NY - half - 92, ease.inOutCubic(prog(f, LAST_Z + 1, LAST_Z + 12))),
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
            right: 1920 - L.right,
            top: NY + half + 30,
            fontFamily: FONT_CN,
            fontWeight: 900,
            fontSize: 64,
            letterSpacing: "0.1em",
            color: "#fff",
            opacity: ease.outQuad(sufP),
            transform: `scale(${sufS})`,
            transformOrigin: "100% 0",
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

const SHEEN0 = GAP + 48;
const SHEEN1 = GAP + 70;
/** The slam text. `ink` renders a flat silhouette (impact frames, chromatic copies). */
const GapText: React.FC<{ ink?: string; dx?: number }> = ({ ink, dx = 0 }) => {
  const f = useCurrentFrame();
  const g = f - GAP;
  if (g < 0) return null;
  // the slam overshoots and recoils, then the text keeps swelling slowly through the hold
  const s0 = 1 + 0.16 * Math.exp(-g / 3.5) * Math.cos(g * 0.7) + 0.07 * ease.inOutSine(prog(f, GAP + 12, DOUBLING - 32));
  const hd = ease.inOutCubic(prog(f, DOUBLING - 32, DOUBLING - 4));
  // the 54th doubling's beam lands in it: a recoil-free swell and a flare
  const th = f - HIT;
  const hitK = th >= 0 ? Math.exp(-th / 7) : 0;
  const scale = s0 * lerp(1, 0.46, hd) * (1 + 0.08 * hitK * (1 - Math.exp(-Math.max(0, th) * 1.2)));
  const cy = lerp(GY - 10, 176, hd);
  const sub = ease.outCubic(prog(f, GAP + 24, GAP + 42));
  const shimmer = (f * 1.4) % 200;
  const glowK = Math.max(Math.exp(-g / 12), 0.9 * hitK);
  const sheenP = f < DOUBLING ? prog(f, SHEEN0, SHEEN1) : prog(f, HIT - 1, HIT + 15);
  const sheenOn = !ink && sheenP > 0 && sheenP < 1;
  const big: React.CSSProperties = { fontFamily: FONT_CN, fontWeight: 900, fontSize: 264, lineHeight: 1.05, letterSpacing: "0.01em" };
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          width: 1920,
          top: cy,
          transform: `translate(${dx}px, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 30, whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 96, color: ink ?? "#fff", letterSpacing: "0.04em", textShadow: ink ? undefined : `0 0 30px ${C.magenta}, 0 4px 16px #000` }}>
            差距：约
          </span>
          <span style={{ position: "relative", display: "inline-block" }}>
            {ink ? (
              <span style={{ ...big, color: ink }}>2亿亿</span>
            ) : (
              <GradientText
                id="cmp-gap"
                text="2亿亿"
                face="cn900"
                fontSize={264}
                letterSpacing={0.01}
                layers={[
                  {
                    // hot gradient twice the text height, drifting up and down (was background-size 100% 200%)
                    angle: 175,
                    span: 2,
                    offset: -(shimmer > 100 ? 200 - shimmer : shimmer) / 100,
                    stops: [[0, "#ffffff"], [0.22, "#fff6d8"], [0.42, C.gold], [0.66, C.ember], [1, C.magenta]],
                    filter: `drop-shadow(0 0 ${24 + 18 * glowK}px rgba(255,90,40,${0.75 + 0.25 * glowK})) drop-shadow(0 6px 14px rgba(0,0,0,0.9))`,
                  },
                  ...(sheenOn
                    ? [
                        {
                          // one specular band sweeps across the hot text while it holds (was background-size 300%)
                          angle: 100,
                          span: 3,
                          offset: (-2 * (100 - 100 * ease.inOutSine(sheenP))) / 100,
                          stops: [
                            [0, "#ffffff", 0],
                            [0.42, "#ffffff", 0],
                            [0.5, "#ffffff", 0.92],
                            [0.58, "#ffffff", 0],
                            [1, "#ffffff", 0],
                          ] as [number, string, number][],
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </span>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 96, color: ink ?? "#fff", textShadow: ink ? undefined : `0 0 30px ${C.magenta}, 0 4px 16px #000` }}>倍</span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 64,
            letterSpacing: "0.02em",
            color: "#fff",
            opacity: ink ? 0 : sub,
            transform: `translateY(${(1 - sub) * 24}px)`,
            textShadow: `0 0 22px ${C.gold}, 0 3px 10px #000, 0 0 34px rgba(0,0,0,0.9)`,
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

const INK = "#0a0306";
/**
 * Manga-style impact frames, shaken with the stage: one frame of paper-white with ink speed lines and
 * the text as a silhouette, then one negative frame (ink paper, white-hot lines and text).
 */
const ImpactFrame: React.FC = () => {
  const f = useCurrentFrame();
  const g = f - GAP;
  if (g < 0 || g >= 2) return null;
  const neg = g === 1;
  return (
    <AbsoluteFill>
      <Canvas
        width={1920 + 2 * SM}
        height={1080 + 2 * SM}
        style={{ left: -SM, top: -SM }}
        draw={(ctx, w, h, fr) => {
          ctx.fillStyle = neg ? INK : "#fff8f2";
          ctx.fillRect(0, 0, w, h);
          ctx.translate(SM, SM);
          // converging spikes, thick at the frame edge, needle-thin toward the centre
          for (let i = 0; i < 120; i++) {
            const an = (i / 120) * TAU + (hash(i * 3.3 + fr) - 0.5) * 0.05;
            const wid = 0.004 + 0.014 * hash(i * 7.1 + (neg ? 5 : 0));
            const r0 = 330 + 260 * hash(i * 1.9 + (neg ? 2 : 0));
            const R = 1700;
            ctx.fillStyle = neg ? (i % 5 === 0 ? C.magenta : i % 7 === 0 ? C.gold : "#fff4ea") : INK;
            ctx.beginPath();
            ctx.moveTo(GX + Math.cos(an) * r0 * 1.35, GY + Math.sin(an) * r0 * 0.75);
            ctx.lineTo(GX + Math.cos(an - wid) * R * 1.35, GY + Math.sin(an - wid) * R * 0.75);
            ctx.lineTo(GX + Math.cos(an + wid) * R * 1.35, GY + Math.sin(an + wid) * R * 0.75);
            ctx.closePath();
            ctx.fill();
          }
          if (neg) {
            ctx.globalCompositeOperation = "lighter";
            glow(ctx, GX, GY, 520, C.ember, 0.55, 0.05);
            ctx.globalCompositeOperation = "source-over";
          }
        }}
      />
      <GapText ink={neg ? "#ffffff" : INK} />
    </AbsoluteFill>
  );
};

const DoubleHud: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease.outCubic(prog(f, DT[0] - 1, DT[0] + 6));
  if (f < DOUBLING - 26) return null;
  const n = Math.max(1, doublings(f));
  const last = DT[n - 1];
  // every doubling kicks the count; the 54th kicks it hardest and leaves it glowing
  const pop = 1 + (f >= FULL ? 0.24 : 0.13) * Math.exp(-Math.max(0, f - last) / (f >= FULL ? 5 : 3));
  const done = f >= FULL ? ease.outCubic(prog(f, FULL, FULL + 10)) : 0;
  const yrA = ease.outCubic(prog(f, DOUBLING - 26, DOUBLING - 14));
  // the comet head has faded by now, so "2024" never comes up under its glare
  const yrB = ease.outBack(prog(f, DOUBLING + 6, DOUBLING + 16));
  // "78 年" pops into the middle of the span as it starts drawing outward
  const spA = ease.outBack(prog(f, FULL + 1, FULL + 8));
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: TX0, top: 318, opacity: a, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 60, color: "#fff", textShadow: "0 2px 10px #000" }}>翻倍</span>
          <span
            style={{
              display: "inline-block",
              // side padding absorbs the pop, so the count never touches 翻倍 / 次
              padding: "0 0.09em",
              fontFamily: FONT_MONO,
              fontWeight: 800,
              fontSize: 168,
              lineHeight: 1,
              color: "#fff",
              transformOrigin: "50% 70%",
              transform: `scale(${pop + 0.06 * done})`,
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
      {spA > 0 ? (
        <div
          style={{
            position: "absolute",
            left: SPAN_MID,
            top: SPAN_Y,
            transform: `translate(-50%, -50%) scale(${0.5 + 0.5 * spA})`,
            opacity: clamp(spA),
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            textShadow: `0 0 16px ${C.gold}, 0 2px 8px #000, 0 0 20px rgba(0,0,0,0.9)`,
            color: "#fff",
          }}
        >
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 40 }}>78</span>
          <span style={{ fontFamily: FONT_CN, fontWeight: 900, fontSize: 34 }}>年</span>
        </div>
      ) : null}
      <div style={{ position: "absolute", left: TX0 - 10, top: TBASE + 30, opacity: yrA, transform: `translateY(${(1 - yrA) * 12}px)`, fontFamily: FONT_MONO, fontWeight: 800, fontSize: 34, color: C.amber, textShadow: `0 0 14px ${C.ember}, 0 2px 6px #000` }}>
        1946
      </div>
      <div style={{ position: "absolute", right: 1920 - TX1 - 10, top: TBASE + 30, opacity: clamp(yrB), transform: `scale(${0.6 + 0.4 * yrB})`, transformOrigin: "100% 0", fontFamily: FONT_MONO, fontWeight: 800, fontSize: 34, color: C.cyan, textShadow: `0 0 14px ${C.cyan}, 0 2px 6px #000` }}>
        2024
      </div>
    </AbsoluteFill>
  );
};

// ---- camera -----------------------------------------------------------------------------------------
/** The heaviest shake of the film: big, low-frequency translation and one or two slow, heavy tilts. */
const slamShake = (f: number) => {
  const g = f - GAP;
  if (g < 0 || g > 50) return { x: 0, y: 0, r: 0 };
  const env = Math.pow(1 - g / 50, 2);
  return {
    x: (noise1(g * 0.36 + 3.1) - 0.5) * 2 * 82 * env,
    y: (noise1(g * 0.36 + 17.7) - 0.5) * 2 * 64 * env,
    r: (noise1(g * 0.16 + 41.3) - 0.5) * 2 * 0.07 * env,
  };
};
/** Slow push-ins: toward the lone ember while it is all there is, then onto the finished number. */
const pushAt = (f: number) => {
  if (f < ZEROS + 40) {
    const P = 1 + 0.07 * ease.inOutSine(prog(f, 0, 86)) * (1 - ease.inOutCubic(prog(f, 84, 102)));
    return { P, fx: EA.x, fy: EA.y };
  }
  // (centred on the finished number, so even pushed in it keeps > 60 px from both frame edges)
  if (f < GAP) return { P: 1 + 0.03 * ease.inOutCubic(prog(f, PUSH0, INHALE + 2)), fx: 960, fy: NY };
  if (f < DOUBLING - 8) {
    // a slow push onto the slam text while it holds, easing back out as the text docks at the top
    const P = 1 + 0.05 * ease.inOutSine(prog(f, GAP + 14, DOUBLING - 36)) * (1 - ease.inOutCubic(prog(f, DOUBLING - 36, DOUBLING - 8)));
    return { P, fx: 960, fy: GY };
  }
  // and a last gentle push once the ramp is complete
  return { P: 1 + 0.03 * ease.inOutSine(prog(f, FULL - 6, DUR)), fx: 960, fy: 470 };
};
/** A small zoom punch on every zero landing (bigger on the "1" and the last zero). */
const landPunch = (f: number) => {
  let k = 0;
  for (const im of IMPACTS) {
    const d = f - im.t;
    if (d >= 0 && d < 20) k = Math.max(k, (im.i === 0 || im.i === ND - 1 ? 0.035 : 0.018) * Math.exp(-d / 4));
  }
  return k;
};

export const Compare: React.FC = () => {
  const f = useCurrentFrame();
  const g = f - GAP;
  const inhale = f < GAP ? ease.inQuad(prog(f, INHALE, GAP)) : 0;
  const sh = sumShake(
    shake(f, ZEROS, 16, 14),
    ...ZT.map((t, i) => shake(f, t, 5 + i * 0.5 + (i === ZT.length - 1 ? 10 : 0), 10 + (i === ZT.length - 1 ? 6 : 0))),
    shake(f, SUFFIX, 14, 14),
    shake(f, FULL, 12, 14),
    shake(f, HIT, 9, 12),
  );
  const ss = slamShake(f);
  // high-frequency rattle right at the slam + pre-slam tremble
  const rattle = g >= 0 && g < 8 ? (1 - g / 8) * 20 : 0;
  const tremble = inhale * 7;
  const rx = sh.x + ss.x + (hash(f * 1.37) - 0.5) * 2 * (rattle + tremble);
  const ry = sh.y + ss.y + (hash(f * 2.11 + 4) - 0.5) * 2 * (rattle + tremble);
  const zoomPunch = g >= 0 ? 1 + 0.1 * Math.exp(-g / 6) : (1 + landPunch(f)) * (1 - 0.03 * inhale);
  const rot = sh.r * 0.12 + ss.r;
  // overscan: the smallest scale at which the shaken, rotated stage (with its margin) still covers the frame
  let cover = 0;
  for (const [cx, cy] of [
    [960, 540],
    [-960, 540],
  ]) {
    for (const sg of [1, -1]) {
      const px = sg * cx - rx;
      const py = sg * cy - ry;
      const qx = Math.cos(rot) * px + Math.sin(rot) * py;
      const qy = -Math.sin(rot) * px + Math.cos(rot) * py;
      cover = Math.max(cover, Math.abs(qx) / (960 + SM), Math.abs(qy) / (540 + SM));
    }
  }
  const camS = Math.max(zoomPunch, cover);
  const { P, fx, fy } = pushAt(f);
  const ab = abAt(f);
  const fade = Math.min(ease.outCubic(prog(f, 0, 14)), 1 - prog(f, DUR - 18, DUR - 1));
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fade }}>
      <AbsoluteFill
        style={{
          transform: `translate(${rx}px, ${ry}px) rotate(${rot}rad) scale(${camS}) translate(${fx - 960}px, ${fy - 540}px) scale(${P}) translate(${960 - fx}px, ${540 - fy}px)`,
        }}
      >
        <Stage />
        <EniacLabels />
        <AiLabels />
        {g >= 2 && ab > 0.8 ? (
          <AbsoluteFill style={{ opacity: 0.7 * Math.min(1, ab / 6) }}>
            <GapText ink={C.red} dx={-ab} />
            <GapText ink={"#2a8cff"} dx={ab} />
          </AbsoluteFill>
        ) : null}
        <GapText />
        <DoubleHud />
        <ImpactFrame />
      </AbsoluteFill>
      <Flash at={ZEROS} dur={8} color={C.cyan} peak={0.22} />
      <Flash at={LAST_Z} dur={6} color={C.cyan} peak={0.14} />
      <Flash at={SUFFIX} dur={8} color={C.magenta} peak={0.2} />
      <Flash at={FULL} dur={6} color={C.ice} peak={0.12} />
      <Captions accent={C.magenta} items={CAPS} />
    </AbsoluteFill>
  );
};
