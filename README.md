# 宇宙热寂 · The Heat Death of the Universe

A popular-science video made with Remotion. Every frame is drawn in code (Canvas 2D, plus WebGL shaders for the black hole, nebulae and stellar surfaces). No image assets are used.

- 1920×1080 · 30 fps · 6000 frames (3 min 20 s)
- The storyboard (scene timing, captions, impacts, cosmic clock keyframes) lives in `src/timeline.json`.

## Running it

```bash
npm install
npm run studio                                   # live preview
node scripts/stills.mjs 360 2335 3700            # render a few frames to out/stills/
npx remotion render HeatDeath out/heat-death.mp4 --props='{"audio":false}'
```

> `soundtrack.wav` doesn't exist yet (see TODO). Until it does, pass `--props='{"audio":false}'` when rendering. Otherwise the render fails on the missing file.
>
> `remotion.config.ts` uses `swangle` (software WebGL). On a Mac or a machine with a GPU, add `--gl=angle` to the render command for a big speedup.
> `scripts/sheet.sh out.jpg <cols> a.jpg b.jpg ...` stitches stills into a contact sheet (needs ffmpeg).

## Structure

```
src/
  timeline.json          storyboard: scenes / captions / impacts / risers / logTime / hud
  HeatDeath.tsx          main composition: scenes + shake/chromatic aberration + HUD + captions + flash
  components/
    Canvas2D.tsx         full-frame 2D canvas, redrawn every frame (order-independent rendering)
    ShaderCanvas.tsx     full-screen WebGL fragment shader (downsampled + optional bloom)
    Captions.tsx         bilingual captions (per-character blur-in)
    Hud.tsx              cosmic clock: 10⁰→10¹¹⁰ yr log axis, era bands, age readout
    Effects.tsx          ShakeLayer (shake + RGB split), Flash, Vignette
    Scene.tsx            places a scene at its timeline slot, with crossfades
  lib/
    hdr.ts               additive float framebuffer + filmic tone mapping (dense particles)
    canvas.ts            glow sprites, diffraction spikes, cheap two-level bloom
    galaxy.ts            70k-star 3D spiral galaxy (differential rotation, aging, star deaths, dust, HII regions)
    galaxySprites.ts     small galaxy sprites for wide cosmic views
    starfield.ts         star field (supports warp/zoom streaks)
    burst.ts             explosion debris + shock rings
    glsl.ts              shaders: STAR / NEBULA / DWARF (dissolve) / MILKYWAY / BLACKHOLE (ray-traced Schwarzschild)
    fonts.ts labels.ts   fonts (fontsource, blocks rendering until all glyphs load) / every on-screen label
  scenes/
    S0Open.tsx           ✅ lone star → implosion → explosion → nebula + title slam
    S1Entropy.tsx        ✅ gas diffusion box + entropy meter, ΔS≥0, heat engine wheel stops, zoom out → "热寂"
    S2Stars.tsx          ✅ galaxy fly-in + "you are here" + stellar close-up + accelerating expansion past the horizon
    S3Collapse.tsx       ✅ galaxy ages → blue supergiant → supernova → reddening → last red dwarf goes out
    S4Degenerate.tsx     ✅ remnant field (pulsars / ejections / infall) → black dwarf + proton-decay dissolve
    S5BlackHole.tsx      🟡 ray-traced black hole + accretion disk + lensing → Hawking evaporation → final explosion (needs tuning, see below)
```

## TODO (where the cloud session stopped)

### 1. S5 black hole tuning (planned but not yet applied)
- `glsl.ts` BLACKHOLE_FS:
  - Disk is overexposed: `return vec4(col * dens * 2.6, a) * uDisk;` → change `2.6` to about `1.55`.
  - Hawking glow turns the shadow into a red disc too early. Change it to:
    `col += uHawkCol * (hit ? max(uHawk - 1.2, 0.) * .9 : uHawk * halo * .9);`
    (only the rim glows at first; the shadow lights up only near the end.)
- `S5BlackHole.tsx`:
  - The temperature readout goes the wrong way (it falls). Change to `logT = Math.log10(6.2e-19) - Math.log10(M) + 28 * Math.pow(tauAt(t), 6)` (from 6×10⁻¹⁹ K up to about 10¹² K).
  - Whiteout fades too slowly: `white = 1 - smoothstep(BOOM + 12, BOOM + 55, t)`.
  - Pull the camera back slightly: `camAt` `lerp(36, 17, …)` → `lerp(38, 19, …)`.
  - Aftermath is too faint: lengthen the burst `tau/life`, and after BOOM add a violet `NEBULA_FS` shell (uColA `[0.45,0.4,1]`, uColB `[1,0.35,0.75]`, uR growing from 0.08 to 0.83, uI decaying as `exp(-k/70)`).
- S4 proton-decay dissolve pacing was just tuned (`thr = mix(.3,.82,uDissolve)`) and hasn't been re-checked with stills yet (frames around 3300–3420).

### 2. S6 Dark Era (`dark`, global frames 4530–5300) — not yet written
- Afterglow fades out of the whiteout → sparse, faint, slowly drifting photons and leptons (blue-violet short streaks plus dim dots). The camera keeps pulling back, so they thin out.
- Temperature readout drops from 2.7 K (today's CMB) to 10⁻¹⁰ K, then 10⁻³⁰ K. A temperature heatmap (24×14 tiles) converges to perfectly uniform ("ΔT → 0"). The entropy meter reads "S → S_max".
- During caption 35 (5000–5115), all motion freezes.
- 5130–5280: a huge serif "热寂 / HEAT DEATH" fades in slowly (the deep hit at 5135 is already in the impacts list), then everything goes to pure black.

### 3. S7 Epilogue (`epilogue`, 5280–6000) — not yet written
- 5280–5340 black and silent → at 5340 a spark ignites (the swell impact is already in the timeline) → warp back. The HUD races from 10¹⁴⁰ back to 10¹⁰ (logTime keyframes are already set).
- 5370–5500: the galaxy again (reuse `makeGalaxy`/`viewAt`, full color).
- 5500–5660: "powers of ten" timeline dive. One line stands for 10¹⁰⁰ years; zoom in from 10¹⁰⁰ to about 10¹⁰·⁵ (zoom counter ×10⁸⁹) until the colored stelliferous band and a "今天 ●" marker appear.
- 5660–6000: closing night sky. `MILKYWAY_FS` band + HDR stars + mountain silhouette + a small person looking up + one meteor. End card "宇宙热寂 / THE HEAT DEATH OF THE UNIVERSE / 画面与声音全部由代码实时生成" (`L.title`, `L.credit`). Fade to black over the last 25 frames.
- Register S6 and S7 in `HeatDeath.tsx`, the same way as the other scenes.

### 4. Soundtrack `scripts/make-audio.mjs` → `public/soundtrack.wav` — not yet written
Pure Node synthesis (Float32Array, 48 kHz stereo, 16-bit WAV). Read `src/timeline.json` (`impacts` / `risers` / `scenes`) so the sound lines up with the picture:
- Drone bed: detuned low sines (D1 / A1 / D2) + low-passed noise "wind", growing darker act by act and fading to near-silence in the Dark Era.
- Pads: D minor progression i–VI–III–VII (detuned saw with additive harmonics + one-pole low-pass); switch to a warm major chord for the epilogue.
- impacts: `boom` = 120→30 Hz sine sweep + noise burst + tanh saturation + Schroeder reverb; `final` is the largest; `sub` is a pure sub-bass hit; `bell` is a single sine bell (the last star going out); `whoosh` / `swell` = filtered noise sweeps.
- risers: rising band-pass noise + Shepard-tone rise.
- Black hole evaporation (4150–4400): rising whine plus accelerating heartbeat pulses.
- `npm run render` already chains audio generation and rendering.

### 5. Full render and review
After it renders, pull frames at each key moment, check pacing and exposure, then commit.
