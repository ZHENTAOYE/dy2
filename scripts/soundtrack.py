#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/soundtrack.py - music + sound effects for
「从真空管到AI：计算机为什么突然变得这么强？」

    python3 scripts/soundtrack.py             # = npm run soundtrack  ->  public/soundtrack.wav
    python3 scripts/soundtrack.py --quiet     # no event table
    python3 scripts/soundtrack.py --report    # + loudness envelope, loudest moments, onset check

numpy + the Python standard library only. Everything is synthesised (wavetable / additive oscillators,
filtered noise, a synthetic convolution reverb) and fully deterministic: every event and layer gets its
own seeded numpy Generator, nothing depends on the clock. All timing is read from src/timeline.json:

  * scene start frame = sum of the previous durations; a cue's absolute time = (start + cue) / fps
  * an optional  "ticks": {"name": [frames...]}  on a scene puts one sound on every listed frame
  * the output lasts exactly sum(durations) / fps seconds (48 kHz, 16-bit PCM, stereo)

Tuning lives in the tables right below:
  CUE_SOUNDS     scene -> cue -> list of sound specs  (what you hear on every cue; unknown cues are silent
                 and warned about, except in scenes listed in SCENE_FALLBACK)
  TICK_SOUNDS    scene -> ticks series -> sound spec  (unknown series get DEFAULT_TICK)
  SCENE_MUSIC    scene -> music bed (chords per cue, level, brightness, arpeggio / bass / drum sections)
  SYNC_*         timings mirrored from scene code (e.g. Moore.tsx STEP) - keep them in sync
  PEAK_DBFS, DRUM_GLUE   master ceiling and drum-bus soft clip (keeps the big impacts the loudest samples)

Spec keys every sound understands:  gain, pan, rev (reverb send), duck=(depth, release_s),
  at=<frames offset>,  to=<time-expr> (ends exactly there),  until=<time-expr> (lasts until it),
  lead=<seconds> (pre-roll: ends exactly on this cue),  peak_at_cue=True (a whoosh peaks on the cue).
Time expressions: "<cue>", "<cue>+N", "<cue>-N" (N in frames), "@start", "@end" (of the scene).
Synths that take i / n (index / count in a ticks series) or chord (the music's current chord) get them.
"""
import inspect
import json
import math
import os
import re
import sys
import time
import wave
import zlib

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIMELINE = os.path.join(ROOT, "src", "timeline.json")
OUT = os.path.join(ROOT, "public", "soundtrack.wav")

SR = 48000
SEED = 1946
XF = 0.8            # crossfade between music-bed segments (s)
PEAK_DBFS = -1.0
DRUM_GLUE = 0.8     # drum-bus soft clip (tanh knee, linear units): tames kick+snare peaks so they don't set the
                    # master's reference level - the big impacts should be the loudest samples in the film


def S(snd, **kw):
    """A sound spec: S("boom", size=1.2, gain=0.9)."""
    return dict(snd=snd, **kw)


# ================================================================================================
#  CUE -> SOUND TABLE
# ================================================================================================
CUE_SOUNDS = {
    # -- Chapter 1 . vacuum tubes ----------------------------------------------------------------
    "coldopen": {
        "ignite": [S("spark", gain=0.5), S("hum", until="cut", swell=1.5, gain=0.24)],
        "cut": [S("glitch", gain=0.55)],
        "boom": [S("boom", size=0.7, gain=0.8)],
    },
    "title": {
        "riser": [S("riser", to="slam", gain=0.7)],
        "slam": [S("boom", size=1.1, gain=1.0), S("shimmer", dur=4.5, gain=0.4)],
    },
    "tube": {
        "chapter": [S("whoosh", gain=0.4)],
        "heat": [S("hum", until="on", swell=1.8, warm=True, gain=0.12)],
        "on": [S("click", gain=0.6), S("hum", until="off", swell=0.4, gain=0.2)],
        "off": [S("click", gain=0.6), S("powerdown", dur=1.3, gain=0.4)],
        "toggle": [S("gen_toggle", gain=0.42)],
    },
    "eniac": {
        "pull": [S("whoosh", dur=2.4, gain=0.4), S("swell", dur=7.0, low=True, gain=0.28)],
        "burn1": [S("spark", gain=0.65), S("pop", gain=0.55)],
        "burn2": [S("spark", gain=0.7), S("pop", gain=0.6)],
        "burn3": [S("spark", gain=0.75), S("pop", gain=0.65)],
        "dark": [S("powerdown", dur=2.8, big=True, gain=0.72, duck=(0.6, 1.5))],
    },
    # -- Chapter 2 . transistor ------------------------------------------------------------------
    "transistor": {
        "chapter": [S("whoosh", gain=0.42)],
        "appear": [S("shimmer", gain=0.4)],
        "gate": [S("zap", gain=0.32), S("click", gain=0.45)],
        "shrink": [S("descend", dur=2.2, gain=0.45)],
    },
    "litho": {
        "beam": [S("zap", gain=0.36), S("beam", until="wafer", gain=0.12)],
        "wafer": [S("shimmer", gain=0.44)],
        "dive": [S("whoosh", dur=1.8, down=True, gain=0.52)],
    },
    # -- Chapter 3 . Moore -----------------------------------------------------------------------
    "moore": {
        "chapter": [S("whoosh", gain=0.44)],
        "split": [S("gen_doubling", gain=0.44)],
        "run": [S("blip", freq=700, gain=0.36)],
        "year0": [S("gen_years", gain=0.36)],
        "end": [S("hit", size=0.75, gain=0.78)],
    },
    "curve": {
        "draw": [S("rise_tone", to="spike", gain=0.28)],
        "spike": [S("hit", size=0.75, gain=0.78)],
        "morph": [S("whoosh", gain=0.5)],
        "line": [S("shimmer", gain=0.45)],
    },
    "nano": {
        "zoom": [S("dive_drone", until="@end", gain=0.4)],
        "atoms": [S("shimmer", crystal=True, dur=4.0, gain=0.5)],
    },
    # -- Chapter 4 . the power wall --------------------------------------------------------------
    "wall": {
        "chapter": [S("whoosh", gain=0.44)],
        "draw": [S("rise_tone", to="slam", gain=0.32)],
        "slam": [S("boom", size=1.1, metal=1.0, gain=1.0)],
        "heat": [S("sizzle", until="split", gain=0.32)],
        "split": [S("shimmer", gain=0.38), S("gen_wall_split", gain=0.4)],
    },
    # -- Chapter 5 . GPU -------------------------------------------------------------------------
    "gpu": {
        "chapter": [S("whoosh", gain=0.45)],
        "cores": [S("gen_cores", gain=0.44)],
        "race": [S("tick", freq=1400, dec=0.03, gain=0.42), S("gen_cpu_rows", gain=0.13)],
        "burst": [S("boom", size=0.85, gain=0.88), S("whoosh", dur=1.4, gain=0.5)],
        "matrix": [S("gen_matrix", gain=0.34)],
    },
    # -- Chapter 6 . neural networks -------------------------------------------------------------
    "neural": {
        "chapter": [S("whoosh", gain=0.45)],
        "perceptron": [S("pulse", gain=0.5), S("chime", gain=0.34)],
        "freeze": [S("wind", until="flood", gain=0.42)],
        "flood": [S("riser", lead=2.4, gain=0.55), S("rush", dur=3.5, gain=0.55)],
        "shatter": [S("shatter", gain=0.62), S("hit", size=0.6, gain=0.55)],
        "imagenet": [S("shimmer", gain=0.44), S("hit", size=0.55, gain=0.55)],
        "lockin": [S("hit", size=0.5, gain=0.5), S("chime", gain=0.3)],  # the counter locks on 1400万
    },
    "alexnet": {
        "bars": [S("gen_bars", gain=0.32)],
        "drop": [S("boom", size=0.95, gain=0.9)],
        "human": [S("shimmer", gain=0.44), S("stab", gain=0.44)],
    },
    # -- Chapter 7 . the explosion ---------------------------------------------------------------
    "converge": {
        "chapter": [S("whoosh", gain=0.46)],
        "streams": [S("riser", to="impact", top=11000, gain=0.74)],
        "meet": [S("hit", size=0.5, gain=0.5), S("shimmer", dur=2.5, gain=0.3)],
        "impact": [S("boom", size=1.35, gain=0.92), S("crash", gain=0.45)],
    },
    "transformer": {
        "attend": [S("shimmer", gain=0.4)],
        "all": [S("pulse", gain=0.36), S("shimmer", dur=2.0, gain=0.3)],  # every token flares at once
        "parallel": [S("whoosh", dur=0.9, peak=0.3, gain=0.34), S("pulse", gain=0.42)],
        "generate": [S("blip", freq=1500, gain=0.26)],
        # the user counter lands on 1亿 at users+80 (Transformer.tsx LAND)
        "users": [S("riser", to="users+80", gain=0.5), S("hit", at=80, size=0.9, gain=0.82),
                  S("shimmer", at=80, gain=0.38)],
    },
    # each level of the pull-back: a whoosh that crests 2 frames before the cue, then a hit that
    # punches through it - escalating in size from the chip to the Earth
    "zoomout": {
        "start": [S("swell", dur=5.0, low=True, gain=0.5)],
        "chip": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.0, gain=0.3), S("hit", size=0.55, gain=0.65)],
        "server": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.1, gain=0.33), S("hit", size=0.65, gain=0.7)],
        "rack": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.2, gain=0.36), S("hit", size=0.75, gain=0.75)],
        "hall": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.4, gain=0.4), S("hit", size=0.88, gain=0.8)],
        "city": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.6, gain=0.44), S("hit", size=1.0, gain=0.86),
                 S("crash", gain=0.3)],
        "earth": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=2.2, gain=0.48), S("boom", size=1.15, gain=0.75),
                  S("shimmer", dur=5.0, gain=0.4)],
        "network": [S("pulse", gain=0.34), S("shimmer", dur=2.5, gain=0.26)],   # light arcs span the globe
        "chart": [S("blip", freq=1100, gain=0.3)],                                # the training-compute chart opens
        "final": [S("boom", size=1.0, gain=0.78), S("crash", gain=0.3)],          # "上千万倍" slams in
    },
    "compare": {
        "zeros": [S("pulse", gain=0.5), S("rise_tone", to="gap", slow=True, gain=0.16)],
        "suffix": [S("hit", size=0.7, gain=0.62)],                       # "次 / 秒" lands
        "ping": [S("blip", freq=2400, dec=0.08, gain=0.3)],                # the ENIAC ember pings the giant number
        "inhale": [S("suck", to="gap", gain=0.7)],                       # everything is sucked in
        "gap": [S("riser", lead=3.0, top=12500, gain=0.8), S("boom", size=1.95, metal=1.0, gain=1.25),
                S("crash", gain=0.5)],                                   # THE biggest boom
        "doubling": [S("whoosh", gain=0.42), S("stab", gain=0.4)],
        "full": [S("hit", size=1.0, gain=0.82), S("stab", gain=0.45), S("shimmer", gain=0.4)],  # 54th doubling
    },
    # -- Chapter 8 . finale ----------------------------------------------------------------------
    "finale": {
        "chapter": [S("whoosh", gain=0.42)],
        # the ribbon ignites at 1946 and the light front runs along the curve: a soft flare + a long forward whoosh
        "ignite": [S("pulse", gain=0.34), S("whoosh", dur=2.6, peak=0.22, lo=160, hi=2600, gain=0.34),
                   S("chime", gain=0.28)],
        "climb": [S("riser", to="flash", top=12500, gain=0.62), S("swell", dur=4.0, gain=0.3)],
        "here": [S("swell", dur=3.0, bright=True, gain=0.45)],
        # the last doubling wave races up the whole curve (inCubic): an accelerating whoosh + a chord swell,
        # both cresting exactly on the flash
        "wave": [S("whoosh", to="flash", peak=0.97, hi=6000, gain=0.5),
                 S("swell", to="flash", rise=True, bright=True, gain=0.42)],
        # the giant impact clears after ~3 s and leaves ONE sustained tone under the final title,
        # which lets go into a long hall reverb that has died away by "end"
        "flash": [S("boom", size=1.8, metal=0.4, dur=3.4, gain=1.2, rev=0.3), S("hit", size=1.1, gain=0.6),
                  S("shimmer", dur=4.0, gain=0.42),
                  S("crash", gain=0.45), S("tail", until="end", gain=0.62, rev=0.0)],
        "end": [],  # silence after the tail
    },
}

# Cue names a scene may still add while it is being built: they get this instead of silence (with a warning).
SCENE_FALLBACK = {
    "zoomout": [S("whoosh", peak_at_cue=True, at=-2, peak=0.85, dur=1.3, gain=0.38),  # another level of the pull-back
                S("hit", size=0.8, gain=0.75)],
}

# Rhythmic series from a scene's "ticks" object (synths receive i = index, n = count).
TICK_SOUNDS = {
    "neural": {"fire": S("fire", gain=0.42)},                      # the perceptron fires
    "alexnet": {"bar": S("tick", freq=1300, dec=0.03, gain=0.32),   # a bar rises
                "hop": S("blip", rise=True, gain=0.26)},             # the eye hops from bar to bar
    "converge": {"pulse": S("thump", gain=0.6),                    # accelerating heartbeat into the impact
                 "wave": S("wave", gain=0.5)},                     # shockwave rings after it
    "transformer": {"tile": S("tile", gain=0.55),                  # x8, x64, x512 ... then the sea tilts
                    "token": S("token", gain=0.28)},               # one per generated token
    "compare": {"zero": S("zero_hit", gain=0.55),                  # punchy hit per zero, pitch climbing
                "double": S("blip", rise=True, gain=0.3)},         # rapid rising blips
    "zoomout": {"gpu": S("tick", freq=1500, dec=0.03, gain=0.3),   # GPUs click into the server tray
                "tray": S("blip", rise=True, gain=0.26)},          # trays stack into the rack
    "finale": {"double": S("blip", rise=True, gain=0.2),           # each doubling along the curve
               "pylon": S("flyby", peak_at_cue=True, dur=0.8, gain=0.36),           # camera passes a pylon
               "ring": S("flyby", peak_at_cue=True, dur=1.3, ring=True, gain=0.5)},  # a ring sweeps through
}
DEFAULT_TICK = S("tick", freq=1800, dec=0.018, gain=0.22)

# Timings mirrored from scene code (relative to the named cue). Keep in sync if those scenes change.
SYNC_TUBE_BITS = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1]  # Tube.tsx BITS
SYNC_TUBE_BIT_LEN = 9                                              # Tube.tsx BIT_LEN (frames per bit)
SYNC_MOORE_STEP = 18                                               # Moore.tsx STEP (frames per doubling, 6 doublings)
SYNC_MOORE_YEARS = (1971, 53)                                      # Moore.tsx yearAt = 1971 + 53*inQuad(prog(f, year0, end))
SYNC_WALL_SPLIT = (20, 5)                                          # Wall.tsx: a core pops every 20 frames, 5 times
SYNC_GPU_CPU = (8, 4)                                              # Gpu.tsx: 8 CPU cores pop 4 frames apart
SYNC_GPU_GRID = (96, 58, 1.6, 0.5, 6)                              # Gpu.tsx GPU grid: cols, rows, y-squash, frames/unit, offset
SYNC_GPU_CPU_ROWS = 0.22                                           # Gpu.tsx CPU_ROWS (rows per frame)
SYNC_GPU_MATRIX = dict(one=40, one_len=50, n=8, all=120, zoom=175, zoom_len=110)  # Gpu.tsx ONE/ALL/ZOOM from "matrix"
SYNC_ALEXNET_BARS = (6, 8)                                         # only if AlexNet has no ticks.bar: 6 bars, 8 frames apart

# ================================================================================================
#  MUSIC BED - one entry per scene; energy rises chapter by chapter.
#    chords: [(time-expr, "notes" | None, {overrides})]   level: bed gain   saw: 0 warm sine .. 1 bright saws
#    cutoff: low-pass Hz    auto / cutoff_auto: [(time-expr, multiplier)] (linear, held at the ends)
#    arp / bass: [(from, to, {bpm, div, gain, bright, octave, style, anchor})]
#    drums: [(from, to, pattern, gain, {anchor, crash})]
#  Grids are tempo-locked: 100 BPM (one beat = Moore.tsx's 18-frame doubling step) anchored on
#  moore.split; 120 BPM anchored on converge.impact. A section "anchor" re-phases its grid so a
#  downbeat lands exactly on that cue (used for the rolls into compare.gap and finale.flash).
# ================================================================================================
GRID_ANCHORS = {100: ("moore", "split"), 120: ("converge", "impact")}

SCENE_MUSIC = {
    # Chapter 1 - warm amber minor drone (sine-heavy, dark low-pass)
    "coldopen": dict(level=0.3, saw=0.08, cutoff=420,
                     chords=[("@start", "D1 D2 A2"),
                             ("cut", "D3 A3 E4 F4", dict(saw=0.45, cutoff=2600, level=0.2))],
                     auto=[("@start", 0.0), ("ignite", 0.55), ("cut-20", 1.0), ("cut", 0.25), ("cut+40", 1.0)]),
    "title": dict(level=0.34, saw=0.3, cutoff=1200,
                  chords=[("@start", "D2 A2 D3"),
                          ("slam", "D2 A2 D3 E3 F3 A3 E4", dict(level=0.5, saw=0.45, cutoff=2300))],
                  auto=[("@start", 0.7), ("slam-12", 0.12), ("slam", 1.0), ("@end", 0.85)]),
    "tube": dict(level=0.31, saw=0.06, cutoff=650, chords=[("@start", "D1 D2 A2 F3")],
                 auto=[("@start", 0.85), ("heat", 1.0)]),
    "eniac": dict(level=0.37, saw=0.14, cutoff=850, chords=[("@start", "Bb1 F2 D3 A3")],
                  auto=[("@start", 1.0), ("dark", 1.0), ("dark+45", 0.05), ("@end", 0.0)]),
    # Chapter 2 - brighter as transistors arrive (saws enter)
    "transistor": dict(level=0.56, saw=0.35, cutoff=1500,
                       chords=[("@start", "F1 F2 C3 A3 G4"), ("shrink", "C2 G2 E3 D4 G4")],
                       auto=[("@start", 0.0), ("@start+40", 1.0)]),
    "litho": dict(level=0.56, saw=0.45, cutoff=2000,
                  chords=[("@start", "C2 G2 E3 B3"), ("wafer", "F1 F2 C3 A3 E4")]),
    # Chapter 3 - arpeggio pulse, tempo-locked to the doubling step
    "moore": dict(level=0.56, saw=0.55, cutoff=1900, chords=[("@start", "A1 A2 E3 G3 C4")],
                  cutoff_auto=[("run", 1.0), ("end", 1.7)],
                  arp=[("split", "run", dict(bpm=100, div=2, gain=0.24, bright=0.35)),
                       ("run", "@end", dict(bpm=100, div=4, gain=0.27, bright=0.5))]),
    "curve": dict(level=0.58, saw=0.55, cutoff=2300,
                  chords=[("@start", "F1 F2 C3 E3 A3"), ("spike", "D2 A2 D3 F3 C4"),
                          ("morph", "Bb1 F2 D3 A3"), ("line", "C2 G2 E3 G3 D4")],
                  arp=[("@start", "@end", dict(bpm=100, div=4, gain=0.27, bright=0.55))]),
    "nano": dict(level=0.58, saw=0.4, cutoff=1500,
                 chords=[("@start", "C2 G2 D3 G3 A3"), ("atoms", "A1 A2 E3 B3 C4")],
                 arp=[("@start", "@end", dict(bpm=100, div=2, gain=0.2, bright=0.25, octave=5))]),
    # Chapter 4 - the power wall: dark and tense, the arp stops, a heartbeat takes over
    "wall": dict(level=0.6, saw=0.6, cutoff=850,
                 chords=[("@start", "D1 D2 A2 D3"), ("slam", "D1 D2 Ab2 Eb3 A3", dict(cutoff=1250)),
                         ("split", "D2 A2 D3 F3 A3", dict(cutoff=1800))],
                 arp=[("@start", "draw", dict(bpm=100, div=2, gain=0.14, bright=0.3)),
                      ("split", "@end", dict(bpm=100, div=4, gain=0.2, bright=0.45))],
                 bass=[("draw", "split", dict(bpm=100, style="heart", gain=0.6))]),
    # Chapter 5 - GPU: energetic 16th arp + pulsing 8th bass
    "gpu": dict(level=0.62, saw=0.65, cutoff=2500,
                chords=[("@start", "D2 A2 D3 F3 A3 C4"), ("matrix", "Bb1 F2 D3 F3 A3 C4")],
                arp=[("@start", "@end", dict(bpm=100, div=4, gain=0.27, bright=0.65))],
                bass=[("cores", "@end", dict(bpm=100, div=2, gain=0.34))]),
    # Chapter 6 - neural: cold; near-silence in the AI winter, floods back stronger
    "neural": dict(level=0.6, saw=0.45, cutoff=1700,
                   chords=[("@start", "G1 G2 D3 Bb3 F4"),
                           ("flood", "Bb1 F2 D3 F3 C4 D4", dict(level=0.72, saw=0.6, cutoff=3200))],
                   auto=[("@start", 1.0), ("freeze", 1.0), ("freeze+25", 0.05), ("flood-40", 0.05), ("flood", 1.2)],
                   arp=[("@start", "freeze", dict(bpm=100, div=2, gain=0.16, bright=0.3)),
                        ("flood", "@end", dict(bpm=100, div=4, gain=0.29, bright=0.7))],
                   bass=[("flood", "@end", dict(bpm=100, div=2, gain=0.36))]),
    "alexnet": dict(level=0.66, saw=0.6, cutoff=2700,
                    chords=[("@start", "F1 F2 C3 A3 E4"), ("drop", "D2 A2 D3 F3 A3 E4"),
                            ("human", "C2 G2 C3 E3 G3 D4", dict(level=0.72, cutoff=3500))],
                    arp=[("@start", "@end", dict(bpm=100, div=4, gain=0.28, bright=0.7))],
                    bass=[("@start", "@end", dict(bpm=100, div=2, gain=0.36))]),
    # Chapter 7 - convergence; drums from converge.impact (120 BPM), building through compare
    "converge": dict(level=0.64, saw=0.6, cutoff=1500,
                     chords=[("@start", "D1 D2 A2 D3"),
                             ("impact", "Bb1 Bb2 F3 D4 A4", dict(level=0.78, cutoff=3600, saw=0.7))],
                     cutoff_auto=[("streams", 1.0), ("impact-1", 2.2), ("impact", 1.0)],
                     auto=[("@start", 1.0), ("streams", 0.85), ("impact-6", 1.15), ("impact", 1.0)],
                     arp=[("@start", "impact", dict(bpm=100, div=4, gain=0.24, bright=0.6)),
                          ("impact", "@end", dict(bpm=120, div=4, gain=0.27, bright=0.7))],
                     bass=[("impact", "@end", dict(bpm=120, div=2, gain=0.4))],
                     drums=[("impact", "@end", "half", 0.78, {})]),
    "transformer": dict(level=0.7, saw=0.65, cutoff=3000,
                        chords=[("@start", "G1 G2 D3 Bb3 F4"), ("parallel", "Bb1 Bb2 F3 D4 A4"),
                                ("users", "C2 C3 G3 E4 D5")],
                        arp=[("@start", "@end", dict(bpm=120, div=4, gain=0.27, bright=0.72))],
                        bass=[("@start", "@end", dict(bpm=120, div=2, gain=0.4))],
                        drums=[("@start", "parallel", "drive", 0.62, {}),
                               ("parallel", "@end", "drive", 0.74, {})]),
    "zoomout": dict(level=0.72, saw=0.7, cutoff=2600,
                    chords=[("@start", "D1 D2 A2 D3"), ("chip", "D2 A2 D3 F3 A3"),
                            ("server", "Bb1 F2 Bb2 D3 F3 A3"), ("rack", "F1 F2 C3 F3 A3 C4"),
                            ("hall", "C2 G2 C3 E3 G3 D4"), ("city", "D2 A2 D3 F3 A3 E4"),
                            ("earth", "Bb1 F2 Bb2 D3 F3 A3 C4 F4", dict(level=0.88, cutoff=5000))],
                    cutoff_auto=[("@start", 0.45), ("chip", 1.0), ("earth", 1.6)],
                    auto=[("@start", 0.55), ("chip", 0.8), ("earth", 1.1)],
                    arp=[("chip", "@end", dict(bpm=120, div=4, gain=0.28, bright=0.75))],
                    bass=[("chip", "@end", dict(bpm=120, div=2, gain=0.42))],
                    drums=[("@start", "chip", "pulse", 0.5, {}), ("chip", "server", "half", 0.58, {}),
                           ("server", "rack", "drive", 0.64, {}), ("rack", "hall", "drive", 0.7, {}),
                           ("hall", "city", "drive2", 0.76, {}), ("city", "earth", "drive2", 0.84, {}),
                           ("earth", "@end", "half", 0.95, {})]),
    "compare": dict(level=0.74, saw=0.7, cutoff=2300,
                    chords=[("@start", "D1 D2 A2 D3 A3"),
                            ("gap", "Bb1 Bb2 F3 D4 F4 A4", dict(level=0.9, cutoff=4500)),
                            ("doubling", "C2 C3 G3 E4 G4 D5", dict(level=0.92, cutoff=5200))],
                    auto=[("@start", 0.9), ("inhale", 1.0), ("gap-2", 0.15), ("gap", 1.0)],
                    arp=[("@start", "inhale", dict(bpm=120, div=4, gain=0.24, bright=0.6)),
                         ("gap+30", "@end", dict(bpm=120, div=4, gain=0.31, bright=0.85))],
                    bass=[("gap+30", "@end", dict(bpm=120, div=2, gain=0.44))],
                    drums=[("@start", "zeros", "pulse", 0.55, {}),
                           ("zeros", "inhale", "build", 0.88, {"anchor": "gap"}),
                           ("gap+30", "doubling", "half", 0.86, {}),
                           ("doubling", "@end", "drive2", 0.92, {"crash": True})]),
    # Chapter 8 - a reflective breath, full lift on the climb, peak at the flash, single-tone tail
    "finale": dict(level=0.6, saw=0.5, cutoff=1900,
                   chords=[("@start", "F1 F2 C3 A3 E4"), ("climb", "Bb1 Bb2 F3 D4 A4"),
                           ("here", "D2 D3 A3 F4 A4 E5", dict(level=0.88, cutoff=6000, saw=0.8)),
                           ("flash+8", None)],
                   cutoff_auto=[("climb", 1.0), ("flash", 2.4)],
                   # a breath before the blow: the band drops out ~2 frames before the flash while the
                   # riser / wave whoosh / swell keep climbing into it
                   auto=[("@start", 0.8), ("climb", 0.9), ("here", 1.1), ("flash-6", 1.2), ("flash-2", 0.25),
                         ("flash", 0.0)],
                   arp=[("@start", "climb", dict(bpm=120, div=2, gain=0.16, bright=0.35)),
                        ("climb", "flash-3", dict(bpm=120, div=4, gain=0.31, bright=0.85, anchor="flash"))],
                   bass=[("climb", "flash-3", dict(bpm=120, div=2, gain=0.44, anchor="flash"))],
                   drums=[("climb", "flash-3", "build", 0.86, {"anchor": "flash"})]),
}
DEFAULT_MUSIC = dict(level=0.5, saw=0.5, cutoff=2000, chords=[("@start", "D2 A2 D3 F3")])

# Reverb send per sound (overridable with rev=...)
REV_SEND = dict(boom=0.45, hit=0.3, riser=0.25, whoosh=0.3, shimmer=0.6, chime=0.55, stab=0.4, swell=0.35,
                glitch=0.1, spark=0.2, pop=0.2, tick=0.15, blip=0.25, token=0.15, zero_hit=0.3, click=0.1,
                powerdown=0.3, hum=0.08, sizzle=0.15, zap=0.3, beam=0.2, wind=0.3, rush=0.3, pulse=0.3,
                descend=0.35, rise_tone=0.25, dive_drone=0.3, crash=0.35, tail=0.0, pop_swarm=0.2,
                shatter=0.45, fire=0.3, thump=0.2, wave=0.4, tile=0.35, suck=0.15, flyby=0.4)


# ================================================================================================
#  DSP helpers
# ================================================================================================
SQ2 = math.sqrt(2.0)
NOTE_PC = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)


def N(sec):
    return max(0, int(round(sec * SR)))


def tvec(n):
    return np.arange(n) / SR


def midi(name):
    m = re.match(r"^([A-G])([#b]?)(-?\d)$", name)
    if not m:
        raise ValueError(f"bad note {name}")
    pc = NOTE_PC[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + pc


def hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def fades(x, fin=0.002, fout=0.02):
    """Raised-cosine fade in/out (every synthesized event gets one -> no clicks at its edges)."""
    n = x.shape[-1]
    a = min(n // 2, N(fin))
    b = min(n // 2, N(fout))
    if a > 0:
        x[..., :a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        x[..., n - b:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
    return x


def pan(mono, p=0.0):
    """Equal-power pan (p in -1..1, scalar or per-sample) -> (2, n); centre = unity per channel."""
    a = (np.clip(p, -1, 1) + 1) * (np.pi / 4)
    return np.stack([mono * (np.cos(a) * SQ2), mono * (np.sin(a) * SQ2)])


def _onepole(x, fc):
    """Vectorised one-pole low-pass y[n] = a[n]*y[n-1] + (1-a[n])*x[n]; fc (Hz) scalar or per-sample.
    Blocked prefix-product trick: inside a block y = P*cumsum(b*x/P), carried across blocks."""
    x = np.asarray(x, dtype=np.float64)
    shape = x.shape
    n = shape[-1]
    X = x.reshape(-1, n)
    fcv = np.clip(np.asarray(fc, dtype=np.float64), 1.0, 0.45 * SR)
    const = fcv.ndim == 0
    la = -2 * np.pi * fcv / SR  # log(a)
    L = int(np.clip(600.0 / max(1e-12, -float(np.min(la))), 16, 8192))
    nb = -(-n // L)
    pad = nb * L - n
    if const:
        c = la * np.arange(1, L + 1)
        ec = np.exp(c)[None, :]
        iec = np.exp(-c)[None, :]
        b = 1.0 - math.exp(float(la))
        bp = None
    else:
        lav = np.concatenate([la, np.zeros(pad)]).reshape(nb, L)
        c = np.cumsum(lav, axis=1)
        ec = np.exp(c)
        iec = np.exp(-c)
        bp = np.concatenate([1.0 - np.exp(la), np.zeros(pad)]).reshape(nb, L)
    out = np.empty_like(X)
    for ch in range(X.shape[0]):
        xp = np.concatenate([X[ch], np.zeros(pad)]).reshape(nb, L)
        drive = (xp * b if bp is None else xp * bp) * iec
        yl = np.cumsum(drive, axis=1)
        yl *= ec
        last = yl[:, -1]
        dec = np.broadcast_to(ec[:, -1], (nb,))
        carry = np.empty(nb)
        y = 0.0
        for i in range(nb):
            carry[i] = y
            y = last[i] + dec[i] * y
        yl += np.broadcast_to(ec, (nb, L)) * carry[:, None]
        out[ch] = yl.reshape(-1)[:n]
    return out.reshape(shape)


def lowpass(x, fc, order=1):
    for _ in range(order):
        x = _onepole(x, fc)
    return x


def highpass(x, fc, order=1):
    for _ in range(order):
        x = x - _onepole(x, fc)
    return x


def unit(x):
    return x / (np.sqrt(np.mean(x * x)) + 1e-12)


def band_noise(rng, n, lo=None, hi=None, ch=2, order=2):
    """Unit-RMS band-limited noise, shape (ch, n)."""
    x = rng.standard_normal((ch, n))
    if lo:
        x = highpass(x, lo, order)
    if hi:
        x = lowpass(x, hi, order)
    return unit(x)


NFFT, HOP = 2048, 512
WIN = np.hanning(NFFT + 1)[:-1]
FREQS = np.fft.rfftfreq(NFFT, 1.0 / SR)


def bell(f, fc, oct_sigma):
    """Unit-power log-frequency Gaussian band around fc (noise through it has ~unit RMS at any fc)."""
    g = np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / oct_sigma) ** 2)
    return g * np.sqrt((SR / 2) / (fc * oct_sigma * 1.2286))


def shaped_noise(rng, n, gain_fn, ch=2):
    """Noise synthesised in the STFT domain with a time-frequency gain gain_fn(t[F,1], f[1,B]) -> (ch, n).
    White noise (gain 1) has unit RMS; Hann OLA at 75 % overlap keeps it stationary."""
    F = n // HOP + NFFT // HOP + 2
    centre = (np.arange(F) * HOP + NFFT / 2 - (NFFT - HOP)) / SR
    G = np.broadcast_to(gain_fn(centre[:, None], FREQS[None, :]), (F, len(FREQS)))
    out = np.zeros((ch, n))
    off = NFFT - HOP
    for c in range(ch):
        spec = (rng.standard_normal(G.shape) + 1j * rng.standard_normal(G.shape)) * G
        fr = np.fft.irfft(spec, NFFT, axis=1) * (WIN * math.sqrt(NFFT / 3.0))
        buf = np.zeros((F + 3) * HOP)
        b2 = buf.reshape(F + 3, HOP)
        fr4 = fr.reshape(F, 4, HOP)
        for q in range(4):
            b2[q:q + F] += fr4[:, q]
        out[c] = buf[off:off + n]
    return out


def fft_convolve(x, ir, block=1 << 18):
    """Block overlap-add FFT convolution; returns len(x) + len(ir) - 1 samples."""
    m = len(ir)
    nfft = 1 << int(math.ceil(math.log2(block + m - 1)))
    H = np.fft.rfft(ir, nfft)
    out = np.zeros(len(x) + m - 1)
    for s in range(0, len(x), block):
        seg = np.asarray(x[s:s + block], dtype=np.float64)
        y = np.fft.irfft(np.fft.rfft(seg, nfft) * H, nfft)[:len(seg) + m - 1]
        out[s:s + len(y)] += y
    return out


def make_ir(rng, seconds, rt_lo, rt_hi, predelay=0.02):
    """Synthetic stereo hall: decorrelated noise with a frequency-dependent exponential decay."""
    def g(t, f):
        rt = rt_lo + (rt_hi - rt_lo) * np.clip(np.log2(np.maximum(f, 150) / 150) / 6.5, 0, 1)
        tt = np.maximum(t - predelay, 0)
        return np.exp(-6.91 * tt / rt) * smooth((t - predelay) / 0.015 + 0.5) * np.clip(f / 140, 0, 1)
    ir = shaped_noise(rng, N(seconds), g, ch=2)
    fades(ir, 0.0, 0.08)
    return ir / np.sqrt(np.sum(ir * ir) / 2)


def slow_curve(rng, dur, every=0.6):
    """A smooth-ish random curve in [-1, 1] as a function of time (deterministic for a given rng)."""
    kt = np.arange(0, dur + 2 * every, every)
    kv = rng.uniform(-1, 1, len(kt))
    return lambda t: np.interp(t, kt, kv)


# Band-limited wavetables ------------------------------------------------------------------------
TBL = 4096
_tables = {}


def saw_table(f, tilt=1.0):
    """Saw-like table band-limited for a fundamental up to f (harmonic k has amplitude 1/k**tilt)."""
    K = int(np.clip(15000.0 / max(f, 1.0), 1, 360))
    key = ("saw", K, tilt)
    if key not in _tables:
        k = np.arange(1, K + 1)
        ph = np.arange(TBL + 1) / TBL
        y = np.sin(2 * np.pi * ph[:, None] * k[None, :]) @ (np.sinc(k / (K + 1)) / k ** tilt)
        _tables[key] = y / np.max(np.abs(y))
    return _tables[key]


def warm_table():
    key = ("warm",)
    if key not in _tables:
        ph = 2 * np.pi * np.arange(TBL + 1) / TBL
        y = np.sin(ph) + 0.28 * np.sin(2 * ph + 0.3) + 0.1 * np.sin(3 * ph + 0.7)
        _tables[key] = np.tanh(1.2 * y) / np.tanh(1.2) * 0.85
    return _tables[key]


def _lookup(tbl, ph):
    idx = ph * TBL
    i = idx.astype(np.int64)
    fr = idx - i
    return tbl[i] + (tbl[i + 1] - tbl[i]) * fr


def wt_osc(tbl, f, n, phase0=0.0):
    return _lookup(tbl, (np.arange(n) * (f / SR) + phase0) % 1.0)


def glide_saw(freq, rng, tilt=1.0):
    """Saw following a per-sample frequency curve (wavetable band-limited for its highest pitch)."""
    return _lookup(saw_table(float(np.max(freq)), tilt), (np.cumsum(freq) / SR + rng.random()) % 1.0)


def sine_sweep(freq):
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


_pluck_cache = {}


def pluck_wave(m, bright=0.5, decay=0.35, dur=0.6):
    """Additive pluck: brighter harmonics decay faster (a filter-envelope sound without a filter)."""
    key = (m, round(bright, 2), round(decay, 3), round(dur, 2))
    if key not in _pluck_cache:
        f = hz(m)
        n = N(dur)
        t = tvec(n)
        K = int(np.clip(13000.0 / f, 1, 32))
        y = np.zeros(n)
        for k in range(1, K + 1):
            a = np.exp(-(k - 1) * (0.42 - 0.32 * bright)) / k
            d = (1.0 + (k - 1) * (0.9 - 0.6 * bright)) / decay
            y += a * np.sin(2 * np.pi * k * f * t + 0.7 * k) * np.exp(-t * d)
        y *= smooth(t / 0.003)
        fades(y, 0.0, 0.02)
        _pluck_cache[key] = y / (np.max(np.abs(y)) + 1e-12)
    return _pluck_cache[key]


def chord_pcs(chord):
    seen = []
    for m in sorted(chord):
        if m % 12 not in seen:
            seen.append(m % 12)
    return seen


def notes_in_octave(chord, octave, count=None):
    base = 12 * (octave + 1)
    pcs = chord_pcs(chord)
    pcs = pcs[1:] + pcs[:1] if len(pcs) > 3 else pcs  # lead with the colour tones
    notes = sorted({base + pc for pc in pcs})
    return notes[:count] if count else notes


# Pad notes as seamless loops ---------------------------------------------------------------------
# Every pad voice is rendered once as an exactly periodic LOOP_S-second loop (its frequency is
# quantised to 1/LOOP_S Hz - at most ~3 cents off for the lowest notes, far less above) and tiled in
# absolute time. That makes the bed cheap, and a note shared by two neighbouring chords stays
# phase-coherent through their crossfade.
LOOP_S = 8.0
LOOP_N = int(LOOP_S * SR)
_loops = {}


def note_loop(m):
    """(saw_part, warm_part), each (2, LOOP_N) float32: three detuned band-limited saws spread
    L/C/R, and a warm tube-like sine layer; both share a slow amplitude LFO."""
    if m not in _loops:
        rng = np.random.default_rng([SEED, 7, m])
        f = hz(m)

        def q(x):
            return max(1, round(x * LOOP_S)) / LOOP_S
        t = tvec(LOOP_N)
        lfo = 1 + 0.12 * np.sin(2 * np.pi * int(rng.integers(1, 3)) / LOOP_S * t + rng.uniform(0, 2 * np.pi))
        tbl = saw_table(f)
        saw = np.zeros((2, LOOP_N))
        for cents, p in ((-9.0, -0.7), (0.0, 0.0), (8.0, 0.7)):
            saw += pan(wt_osc(tbl, q(f * 2 ** (cents / 1200)), LOOP_N, rng.random()), p) * 0.45
        warm = pan(wt_osc(warm_table(), q(f), LOOP_N, rng.random()), rng.uniform(-0.25, 0.25))
        _loops[m] = ((saw * lfo).astype(np.float32), (warm * lfo).astype(np.float32))
    return _loops[m]


def chord_loop(notes, saw):
    y = np.zeros((2, LOOP_N), np.float32)
    for m in notes:
        s, w = note_loop(m)
        g = 1.0 if hz(m) < 400 else math.sqrt(400 / hz(m))
        y += (saw * g) * s + ((1 - saw) * g) * w
    return y / math.sqrt(len(notes))


def periodic_lowpass(loop, fc, order):
    """Steady-state low-pass of a periodic loop (filter two periods, keep the second)."""
    y = lowpass(np.concatenate([loop, loop], axis=1), fc, order)
    return y[:, LOOP_N:]


def tile_abs(loop, i0, n):
    """The loop laid out in absolute time: samples i0 .. i0+n."""
    s = i0 % LOOP_N
    reps = (s + n) // LOOP_N + 1
    return np.tile(loop, reps)[:, s:s + n]


# ================================================================================================
#  SOUND EFFECTS - each returns a stereo float array (2, n)
# ================================================================================================
def metal_clang(rng, n, f0=180.0):
    t = tvec(n)
    ratios = [1.0, 1.47, 2.09, 2.56, 2.94, 3.42, 4.07, 4.81, 5.53, 6.27, 7.18, 8.4]
    y = np.zeros((2, n))
    for i, r in enumerate(ratios):
        f = f0 * r * (1 + rng.uniform(-0.01, 0.01))
        if f * 1.003 > 18000:
            continue
        dec = 2.2 / (1 + 0.45 * i)
        a = 1.0 / (1 + 0.35 * i)
        v = a * (np.sin(2 * np.pi * f * t + rng.uniform(0, 6.3)) + 0.6 * np.sin(2 * np.pi * f * 1.003 * t)) * np.exp(-t / dec)
        y += pan(v, rng.uniform(-0.7, 0.7))
    y = y / len(ratios) * 2.2
    y += band_noise(rng, n, 1500, 7000) * np.exp(-t / 0.08) * 0.35
    return y


def sfx_boom(rng, size=1.0, metal=0.0, dur=None):
    """Sub-drop + bright crack + low rumble body + long dark tail (+ optional metallic clang)."""
    dur = dur or (2.2 + 2.8 * size)
    n = N(dur)
    t = tvec(n)
    f = 31 + (85 + 40 * size) * np.exp(-t / (0.09 + 0.16 * size))
    sub = np.tanh(2.0 * sine_sweep(f) * np.exp(-t / (0.45 + 0.9 * size))) / np.tanh(2.0)
    crack = band_noise(rng, n, 500, 8000) * np.exp(-t / 0.03)
    body = band_noise(rng, n, 30, 260 + 120 * size) * np.exp(-t / (0.25 + 0.5 * size))
    tail = band_noise(rng, n, 25, 150) * np.exp(-t / (0.8 + 1.0 * size)) * smooth(t / 0.15)
    y = pan(sub) + crack * 0.26 + body * 0.5 + tail * 0.32
    if metal > 0:
        y += metal * metal_clang(rng, n, 150 + 30 * size)
    y *= smooth(t / 0.003) * (1 - smooth((t - 0.6 * dur) / (0.4 * dur)))  # always dies out by `dur`
    return y * (0.55 + 0.45 * min(size, 2.0) / 2.0)


def sfx_hit(rng, size=0.6):
    n = N(0.9 + 1.2 * size)
    t = tvec(n)
    sub = np.tanh(1.8 * sine_sweep(42 + 80 * np.exp(-t / 0.05)) * np.exp(-t / (0.18 + 0.25 * size))) / np.tanh(1.8)
    snap = band_noise(rng, n, 900, 8000) * np.exp(-t / 0.035)
    body = band_noise(rng, n, 80, 900) * np.exp(-t / (0.08 + 0.1 * size))
    y = pan(sub) + snap * 0.28 + body * 0.35
    return y * smooth(t / 0.002) * (0.6 + 0.4 * size)


def sfx_riser(rng, dur=3.0, top=9000.0, low=200.0):
    """Noise band sweeping up + two-octave saw glide + reverse-cymbal swell; ends exactly on its target."""
    n = N(dur)
    t = tvec(n)
    u = t / dur

    def g(tc, f):
        uu = np.clip(tc / dur, 0, 1)
        fc = low * (top / low) ** (uu ** 1.3)
        return bell(f, fc, 0.55) * (0.03 + uu ** 2.2)
    y = shaped_noise(rng, n, g) * 0.55
    fr = 90 * 4.0 ** (u ** 1.5)
    cut = 300 + 6000 * u ** 2
    L = lowpass(glide_saw(fr * 0.994, rng) + glide_saw(fr * 1.003, rng), cut, 2)
    R = lowpass(glide_saw(fr * 1.006, rng) + glide_saw(fr * 0.998, rng), cut, 2)
    y += np.stack([L, R]) * 0.22 * u ** 2.5
    y += band_noise(rng, n, 3000, 14000) * np.exp((t - dur) / 0.35) * 0.3
    return fades(y, min(0.3, dur * 0.3), 0.05)  # a 50 ms dip right before the target lets the hit land


def sfx_whoosh(rng, dur=1.2, peak=0.45, lo=220.0, hi=3600.0, down=False, width=0.8):
    n = N(dur)

    def shape(uu):
        if down:
            return hi * (lo / hi) ** uu, np.sin(np.pi * np.clip(uu, 0, 1)) ** 1.2
        rise = lo * (hi / lo) ** np.clip(uu / peak, 0, 1)
        fall = hi * (1.6 * lo / hi) ** np.clip((uu - peak) / max(1e-3, 1 - peak), 0, 1)
        amp = np.where(uu < peak, smooth(uu / peak) ** 1.5, (1 - np.clip((uu - peak) / max(1e-3, 1 - peak), 0, 1)) ** 1.6)
        return np.where(uu < peak, rise, fall), amp

    def g(tc, f):
        fc, amp = shape(np.clip(tc / dur, 0, 1))
        return bell(f, fc, 0.9) * amp
    y = shaped_noise(rng, n, g, ch=1)[0]
    side = shaped_noise(rng, n, g, ch=1)[0]
    p = np.linspace(-width, width, n) * (1 if rng.random() < 0.5 else -1)
    out = pan(y, p) + np.stack([side, -side]) * 0.25
    return fades(out, 0.01, 0.03) * 0.8


def sfx_suck(rng, dur=1.0):
    """Reverse whoosh: everything is sucked in toward the slam; ends abruptly on the target."""
    n = N(dur)
    u = tvec(n) / dur

    def g(tc, f):
        uu = np.clip(tc / dur, 0, 1)
        return bell(f, 300 * 20 ** uu, 1.2) * np.exp((uu - 1) * 4.0)
    y = shaped_noise(rng, n, g) * 0.8
    y += pan(glide_saw(55 * 2 ** (2 * u), rng, tilt=1.4) * np.exp((u - 1) * 3.0) * 0.3)
    return fades(y, 0.05, 0.004)


def sfx_glitch(rng, dur=0.42):
    """Bit-crushed bursts: squares, sample-and-hold noise, chirps and gaps, hopping across the field."""
    n = N(dur)
    y = np.zeros((2, n))
    i = 0
    while i < n:
        L = min(n - i, int(rng.uniform(0.012, 0.055) * SR))
        tt = np.arange(L) / SR
        kind = rng.integers(0, 5)
        if kind == 0:
            s = np.sign(np.sin(2 * np.pi * rng.uniform(80, 1800) * tt))
        elif kind == 1:
            hold = int(rng.integers(4, 40))
            s = np.repeat(rng.uniform(-1, 1, L // hold + 1), hold)[:L]
        elif kind == 2:
            s = np.sin(2 * np.pi * rng.uniform(300, 4000) * tt)
        elif kind == 3:
            s = np.sign(np.sin(2 * np.pi * np.linspace(rng.uniform(2000, 6000), rng.uniform(100, 400), L) * tt))
        else:
            s = np.zeros(L)
        q = 2 ** int(rng.integers(2, 5)) / 2
        s = np.round(s * q) / q * rng.uniform(0.4, 1.0)
        y[:, i:i + L] += pan(s, rng.uniform(-0.8, 0.8))
        i += L
    y = lowpass(y, 9000)
    y *= 1 - 0.5 * np.linspace(0, 1, n)
    return y * 0.5


def sfx_spark(rng, dur=0.6):
    n = N(dur)
    t = tvec(n)
    imp = np.zeros((2, n))
    k = 46
    times = np.clip(rng.exponential(0.09, k), 0, dur * 0.8)
    amps = rng.uniform(0.2, 1.0, k) * np.exp(-times / 0.2) * rng.choice([-1, 1], k)
    pans = rng.uniform(-0.8, 0.8, k)
    for tm, a, p in zip(times, amps, pans):
        idx = N(tm)
        if idx < n:
            imp[0, idx] += a * math.cos((p + 1) * math.pi / 4) * SQ2
            imp[1, idx] += a * math.sin((p + 1) * math.pi / 4) * SQ2
    kern = highpass(rng.standard_normal(160), 2500) * np.exp(-np.arange(160) / 30.0)
    y = np.stack([np.convolve(imp[c], kern)[:n] for c in range(2)])
    buzz = band_noise(rng, n, 1500, 6000) * (np.sin(2 * np.pi * 120 * t) > 0) * np.exp(-t / 0.05)
    return y * 0.9 + buzz * 0.3


def sfx_pop(rng, dur=0.18):
    n = N(dur)
    t = tvec(n)
    y = sine_sweep(220 + 1100 * np.exp(-t / 0.010)) * np.exp(-t / 0.035)
    y += band_noise(rng, n, 1500, 9000, ch=1)[0] * np.exp(-t / 0.0015) * 0.5
    return pan(y * 0.8, rng.uniform(-0.4, 0.4))


def sfx_powerdown(rng, dur=1.4, big=False):
    """Falling-pitch hum (120 -> 24 Hz, buzzy harmonics, closing filter); big adds thud, relay and whine."""
    n = N(dur)
    t = tvec(n)
    u = t / dur
    f = 24 + 100 * (1 - u) ** 1.7
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = sum(np.sin(k * ph) / k ** 1.1 for k in range(1, 11))
    y = lowpass(y, 200 + 3200 * (1 - u) ** 2, 2) * (1 - u) ** 1.3 * smooth(t / 0.01)
    out = pan(y * 0.5)
    if big:
        out += pan(np.tanh(1.5 * sine_sweep(30 + 45 * np.exp(-t / 0.08)) * np.exp(-t / 0.35))) * 0.8
        out += pan(sine_sweep(180 + 3000 * np.exp(-t / 0.45)) * 0.06 * (1 - u) ** 2, 0.3)
        out[:, :N(0.08)] += sfx_click(rng)[:, :N(0.08)] * 0.8
    return out


def sfx_tick(rng, freq=1800.0, dec=0.02, noise=0.35, i=0, n=1):
    m = N(max(0.08, dec * 6))
    t = tvec(m)
    y = np.sin(2 * np.pi * freq * t) * np.exp(-t / dec) + 0.35 * np.sin(2 * np.pi * 2.01 * freq * t) * np.exp(-t / (dec * 0.5))
    y += band_noise(rng, m, 2500, 12000, ch=1)[0] * np.exp(-t / 0.0012) * noise
    return pan(y * smooth(t / 0.0006) * 0.6, rng.uniform(-0.25, 0.25))


def sfx_blip(rng, freq=900.0, rise=False, i=0, n=1, dec=0.035):
    if rise:
        freq = 600 * 2 ** (3.0 * i / max(1, n - 1))
    m = N(0.18)
    t = tvec(m)
    f = freq * (1 + 0.15 * (1 - np.exp(-t / 0.02)))
    y = (sine_sweep(f) + 0.2 * sine_sweep(2 * f)) * np.exp(-t / dec) * smooth(t / 0.002)
    return pan(y * 0.6, 0.3 * math.sin(i * 1.7))


def sfx_token(rng, i=0, n=1):
    f = 2200 + 900 * ((i * 0.618034) % 1.0)
    m = N(0.1)
    t = tvec(m)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.012) * 0.5 + np.sin(2 * np.pi * 320 * t) * np.exp(-t / 0.02) * 0.4
    y += band_noise(rng, m, 3000, 12000, ch=1)[0] * np.exp(-t / 0.001) * 0.3
    return pan(y * smooth(t / 0.0005), 0.4 * math.sin(i * 2.3))


def sfx_zero_hit(rng, i=0, n=1):
    u = i / max(1, n - 1)
    hit = sfx_hit(rng, size=0.35 + 0.25 * u)
    t = tvec(hit.shape[1])
    f = 220 * 2 ** (2.0 * u)
    tone = (np.sin(2 * np.pi * f * t) + 0.15 * np.sign(np.sin(2 * np.pi * f * t))) * np.exp(-t / 0.22)
    return (hit + pan(lowpass(tone, 3000) * 0.5)) * (0.75 + 0.25 * u)


def sfx_fire(rng, i=0, n=1):
    """A neuron fires: a quick rising 'bloop', a soft electric click and a little low thump."""
    u = i / max(1, n - 1)
    m = N(0.35)
    t = tvec(m)
    f0 = 380 * 2 ** (0.8 * u)
    y = sine_sweep(f0 * (1 + 1.5 * (1 - np.exp(-t / 0.02)))) * np.exp(-t / 0.07) * 0.6
    y += band_noise(rng, m, 2500, 10000, ch=1)[0] * np.exp(-t / 0.0015) * 0.25
    y += sine_sweep(55 + 50 * np.exp(-t / 0.02)) * np.exp(-t / 0.08) * 0.5
    return pan(y * smooth(t / 0.001), 0.35 * math.sin(i * 2.1))


def sfx_thump(rng, i=0, n=1):
    """Heartbeat thump; gets heavier and slightly higher along the series."""
    u = i / max(1, n - 1)
    m = N(0.6)
    t = tvec(m)
    body = sine_sweep((45 + 12 * u) + 60 * np.exp(-t / 0.025)) * np.exp(-t / 0.2)
    whomp = band_noise(rng, m, 40, 300, ch=1)[0] * np.exp(-t / 0.06) * 0.4
    return pan(np.tanh(1.5 * (body + whomp)) / np.tanh(1.5) * (0.6 + 0.4 * u) * smooth(t / 0.002))


def sfx_wave(rng, i=0, n=1):
    """Shockwave ring: soft low boom + an airy falling whoosh; later rings are fainter."""
    u = i / max(1, n - 1)
    m = N(1.6)
    t = tvec(m)
    low = sine_sweep(32 + 45 * np.exp(-t / 0.06)) * np.exp(-t / 0.45) * smooth(t / 0.003)

    def g(tc, f):
        return bell(f, 2600 * (500 / 2600) ** np.clip(tc / 1.2, 0, 1), 0.9) * smooth(tc / 0.03) * np.exp(-np.maximum(tc, 0) / 0.4)
    return (pan(low) * 0.8 + shaped_noise(rng, m, g) * 0.5) * (1 - 0.5 * u)


def sfx_tile(rng, i=0, n=1, chord=None):
    """Transformer: a tile ignites / multiplies (x8, x64, x512 - each hit bigger, with a ripple of
    plucks that grows with it); the last one in the series is the sea tilting away (whoosh)."""
    if n > 1 and i == n - 1:
        return sfx_whoosh(rng, dur=1.1, peak=0.35, lo=150, hi=3200)
    y = sfx_hit(rng, size=0.45 + 0.15 * i)
    notes = notes_in_octave(chord or [62, 65, 69], min(4 + i, 6))
    for k, m in enumerate((notes * 4)[:3 + 2 * i]):
        w = pluck_wave(m, 0.8, 0.25, 0.5)
        s0 = N(0.028 * k)
        if s0 + len(w) > y.shape[1]:
            break
        y[:, s0:s0 + len(w)] += pan(w, 0.7 * math.sin(k * 1.9)) * 0.22
    return y


def sfx_flyby(rng, dur=0.8, peak=0.55, ring=False, i=0, n=1, chord=None):
    """Finale: the camera flies past a glowing pylon (or a ring sweeps through) - a short panned whoosh
    that peaks on the pass, plus a bell note (a chord shimmer for rings) ringing out from that point."""
    y = sfx_whoosh(rng, dur=dur, peak=peak, lo=300, hi=4500 if ring else 3000, width=0.9)
    s0 = N(peak * dur)
    if ring:
        bell_ = sfx_shimmer(rng, dur=2.2, chord=chord)
    else:
        notes = notes_in_octave(chord or [62, 69], 5)
        f = hz(notes[i % len(notes)])
        tt = tvec(N(1.6))
        v = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.76 * f * tt) * np.exp(-tt / 0.2)
        bell_ = pan(v * np.exp(-tt / 0.5) * smooth(tt / 0.003) * 0.5, 0.5 * math.sin(i * 2.4))
    out = np.zeros((2, max(y.shape[1], s0 + bell_.shape[1])))
    out[:, :y.shape[1]] += y
    out[:, s0:s0 + bell_.shape[1]] += bell_
    return out


def sfx_shatter(rng, dur=1.8):
    """Ice shatters: a broadband crack, a thud and a shower of glassy shards."""
    n = N(dur)
    t = tvec(n)
    y = band_noise(rng, n, 1200, 14000) * np.exp(-t / 0.018) * 0.9
    y += pan(sine_sweep(50 + 60 * np.exp(-t / 0.02)) * np.exp(-t / 0.12)) * 0.6
    for s0 in np.sort(np.clip(rng.exponential(0.18, 48), 0, dur - 0.3)):
        i0 = N(s0)
        m = min(N(0.25), n - i0)
        tt = tvec(m)
        f = rng.uniform(2500, 8000)
        dec = rng.uniform(0.02, 0.12)
        v = np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 2.32 * tt) * (f * 2.32 < 18000)
        v = v * np.exp(-tt / dec) * rng.uniform(0.15, 0.5) * math.exp(-s0 / 0.5)
        y[:, i0:i0 + m] += pan(v, rng.uniform(-0.9, 0.9))
    return y * 0.7


def sfx_click(rng):
    n = N(0.08)
    t = tvec(n)
    a = band_noise(rng, n, 1800, 9000, ch=1)[0] * np.exp(-t / 0.0018)
    b = np.zeros(n)
    s = N(0.006)
    b[s:] = a[:n - s] * 0.55
    y = a + b + np.sin(2 * np.pi * 120 * t) * np.exp(-t / 0.012) * 0.6
    return pan(y * 0.5, rng.uniform(-0.2, 0.2))


def sfx_zap(rng, dur=0.28):
    n = N(dur)
    t = tvec(n)
    f = 160 + 3400 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph + 3 * np.exp(-t / 0.05) * np.sin(2.5 * ph)) * np.exp(-t / 0.1)
    y += band_noise(rng, n, 3000, 12000, ch=1)[0] * np.exp(-t / 0.01) * 0.3
    d = N(0.005)
    return np.stack([y, np.concatenate([np.zeros(d), y[:-d]])]) * 0.5


def sfx_beam(rng, dur=4.0):
    """Lithography laser: a steady beating hum with a faint high whine."""
    n = N(dur)
    t = tvec(n)
    env = smooth(t / 0.4) * smooth((dur - t) / 0.8)
    y = (0.5 * np.sin(2 * np.pi * 220 * t) + 0.35 * np.sin(2 * np.pi * 440.7 * t) + 0.2 * np.sin(2 * np.pi * 661 * t)
         + 0.08 * np.sin(2 * np.pi * 3520 * t + 2 * np.sin(2 * np.pi * 5 * t)))
    y *= (1 + 0.25 * np.sin(2 * np.pi * 7 * t)) * env
    R = (0.5 * np.sin(2 * np.pi * 220.4 * t + 1) + 0.35 * np.sin(2 * np.pi * 441.3 * t)) * env
    return np.stack([y, 0.6 * y + 0.4 * R]) * 0.6


def sfx_shimmer(rng, dur=3.5, chord=None, crystal=False, octave=6):
    """High bell partials on the current chord's tones, lightly staggered, with an airy top."""
    notes = notes_in_octave(chord or [62, 69, 65], octave + 1 if crystal else octave, 5)
    n = N(dur)
    t = tvec(n)
    ratios = [1, 2.32, 4.25, 6.63] if crystal else [1, 2.0, 2.76, 4.07]
    amps = [1, 0.45, 0.28, 0.12]
    y = np.zeros((2, n))
    for i, m in enumerate(notes):
        s0 = N(i * (0.09 if crystal else 0.05))
        tt = t[:n - s0]
        f = hz(m)
        v = np.zeros(n - s0)
        for j, (r, a) in enumerate(zip(ratios, amps)):
            if f * r > 18000:
                continue
            dec = dur * 0.45 / (1 + 0.9 * j)
            v += a * 0.5 * (np.sin(2 * np.pi * f * r * tt + rng.uniform(0, 6.3)) + np.sin(2 * np.pi * (f * r + 0.9) * tt)) * np.exp(-tt / dec)
        y[:, s0:] += pan(v * smooth(tt / 0.004), 0.55 if i % 2 else -0.55)
    y /= math.sqrt(max(1, len(notes)))
    y += band_noise(rng, n, 5000, 16000) * smooth(t / 0.04) * np.exp(-t / 0.7) * 0.1
    return y * 0.7


def sfx_chime(rng, dur=2.5, chord=None):
    return sfx_shimmer(rng, dur=dur, chord=chord, octave=5) * 0.9


def sfx_stab(rng, dur=1.4, chord=None):
    notes = notes_in_octave(chord or [62, 65, 69], 4) + notes_in_octave(chord or [62], 3, 2)
    n = N(dur)
    y = np.zeros((2, n))
    for i, m in enumerate(notes):
        y += pan(pluck_wave(m, bright=0.85, decay=0.5, dur=dur), -0.6 + 1.2 * i / max(1, len(notes) - 1))
    return y / math.sqrt(len(notes))


def sfx_hum(rng, dur=2.0, swell=0.5, warm=False):
    """Mains hum (60 / 120 Hz and harmonics); warm = the softer filament warm-up version."""
    n = N(dur)
    t = tvec(n)
    s = np.sin(2 * np.pi * 60 * t)
    y = (0.45 * s + 0.8 * np.sin(2 * np.pi * 120 * t + 0.4) + 0.3 * np.sin(2 * np.pi * 180 * t + 1.1)
         + 0.22 * np.sin(2 * np.pi * 240 * t + 0.3) + 0.1 * np.sin(2 * np.pi * 300 * t) + 0.06 * np.sin(2 * np.pi * 360 * t))
    if not warm:
        y += lowpass(np.sign(s) * 0.12, 1800)
    wob = slow_curve(rng, dur, 0.8)
    y *= (1 + 0.06 * np.sin(2 * np.pi * 0.7 * t) + 0.05 * wob(t)) * smooth(t / max(swell, 0.01)) * smooth((dur - t) / 0.25)
    d = N(0.0007)
    return np.stack([y, np.concatenate([np.zeros(d), y[:-d]])]) / 1.3


def sfx_sizzle(rng, dur=4.0):
    """Overheating: crackles whose density climbs, over a rising high hiss."""
    n = N(dur)
    t = tvec(n)
    u = t / dur
    rate = 25 + 450 * u ** 1.6
    out = np.zeros((2, n))
    kern = highpass(rng.standard_normal(60), 4000) * np.exp(-np.arange(60) / 12.0)
    for c in range(2):
        imp = (rng.random(n) < rate / SR) * rng.uniform(0.2, 1.0, n) * rng.choice([-1.0, 1.0], n)
        out[c] = np.convolve(imp, kern)[:n]
    out += band_noise(rng, n, 3500, 12000) * (0.15 + 0.6 * u ** 1.5) * 0.25
    return fades(out * 0.9, 0.3, 0.4)


def sfx_pulse(rng, chord=None):
    n = N(1.2)
    t = tvec(n)
    thump = sine_sweep(48 + 40 * np.exp(-t / 0.03)) * np.exp(-t / 0.22)
    f = hz(notes_in_octave(chord or [62], 4)[0])
    tone = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t / 0.45) * smooth(t / 0.006) * 0.35
    return pan(thump * 0.9 + tone)


def sfx_wind(rng, dur=4.0):
    """AI winter: cold whistling wind in slow gusts, with sparse glassy ice crackles."""
    n = N(dur)
    s1, s2, s3 = slow_curve(rng, dur, 0.7), slow_curve(rng, dur, 0.5), slow_curve(rng, dur, 0.9)

    def g(tc, f):
        c1 = 650 * 2 ** (0.7 * s1(tc))
        c2 = 1400 * 2 ** (0.5 * s2(tc))
        gust = 0.55 + 0.45 * s3(tc)
        return (bell(f, c1, 0.18) * 0.5 + bell(f, c2, 0.22) * 0.3 + bell(f, 320, 1.2) * 0.45) * gust
    y = shaped_noise(rng, n, g) * 0.5
    for tm in np.sort(rng.uniform(0.3, max(0.4, dur - 0.2), int(dur * 7))):
        m = N(0.02)
        tt = tvec(m)
        v = np.sin(2 * np.pi * rng.uniform(5000, 11000) * tt) * np.exp(-tt / rng.uniform(0.002, 0.007))
        i0 = N(tm)
        k = max(0, min(m, n - i0))
        y[:, i0:i0 + k] += pan(v[:k] * rng.uniform(0.1, 0.35), rng.uniform(-0.8, 0.8))
    return fades(y, 1.0, 0.6)


def sfx_rush(rng, dur=3.5):
    n = N(dur)
    t = tvec(n)
    u = t / dur

    def g(tc, f):
        uu = np.clip(tc / dur, 0, 1)
        return bell(f, 400 * 2 ** (3 * smooth(uu / 0.3)), 1.6) * smooth(tc / 0.12) * (1 - uu) ** 1.2
    return shaped_noise(rng, n, g) * 0.7 + band_noise(rng, n, 30, 200) * smooth(t / 0.2) * (1 - u) ** 2 * 0.6


def sfx_descend(rng, dur=2.2):
    n = N(dur)
    t = tvec(n)
    u = t / dur
    f = 1600 * (110 / 1600) ** (u ** 0.8)
    tone = glide_saw(f, rng, tilt=1.6) * smooth(t / 0.05) * (1 - u) ** 0.7 * 0.35

    def g(tc, fr):
        uu = np.clip(tc / dur, 0, 1)
        return bell(fr, 7000 * (250 / 7000) ** uu, 1.0) * smooth(tc / 0.05) * (1 - uu) ** 0.7
    return pan(tone) + shaped_noise(rng, n, g) * 0.3


def sfx_rise_tone(rng, dur=3.0, slow=False):
    """A tone gliding up with a tremolo that speeds up - tension leading into a target cue."""
    n = N(dur)
    t = tvec(n)
    u = t / dur
    f0, f1 = (80.0, 600.0) if slow else (130.0, 1100.0)
    f = f0 * (f1 / f0) ** (u ** 1.25)
    trem = 1 - 0.35 * u * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(3 + 11 * u) / SR))
    y = np.stack([glide_saw(f * 0.997, rng, tilt=1.6), glide_saw(f * 1.003, rng, tilt=1.6)]) * (u ** 1.6 * trem) * 0.45

    def g(tc, fr):
        uu = np.clip(tc / dur, 0, 1)
        return bell(fr, 400 * 2 ** (4 * uu), 0.7) * uu ** 2
    y += shaped_noise(rng, n, g) * 0.15
    return fades(y, 0.05, 0.006)


def sfx_dive_drone(rng, dur=20.0):
    """Nano: a long descending whoosh/drone - falling from a hair into silicon atoms."""
    n = N(dur)
    t = tvec(n)
    u = t / dur
    f = 110 * 0.5 ** u
    v = np.stack([glide_saw(f * 0.995, rng), glide_saw(f * 1.005, rng)])
    v = lowpass(v, 1800 * (300 / 1800) ** u, 2)

    def g(tc, fr):
        uu = np.clip(tc / dur, 0, 1)
        return bell(fr, 8000 * (200 / 8000) ** uu, 0.8) * (0.6 + 0.4 * np.sin(2 * np.pi * tc / 3.1) ** 2)
    return (v * 0.35 + shaped_noise(rng, n, g) * 0.25) * smooth(t / 1.5) * smooth((dur - t) / 1.2)


def sfx_swell(rng, dur=5.0, chord=None, low=False, bright=False, rise=False):
    """A pad swell on the current chord (deep = lower voicing), filter opening with the envelope.
    rise=True: a one-way crescendo that crests at the very end (use with to=<cue> to land on a hit)."""
    notes = sorted(chord or [38, 45, 50, 53])
    if low:
        notes = [m - 12 if i < 3 and m - 12 >= 28 else m for i, m in enumerate(notes)]
    n = N(dur)
    t = tvec(n)
    y = tile_abs(chord_loop(notes, 0.6), 0, n).astype(np.float64)
    if rise:
        env = smooth(t / dur) ** 2.2 * smooth((dur - t) / 0.03)
    else:
        env = smooth(t / (0.55 * dur)) ** 1.5 * smooth((dur - t) / (0.45 * dur))
    return lowpass(y, 250 + ((2600 if bright else 1200) - 250) * env, 2) * env * 0.7


def sfx_crash(rng, dur=2.6):
    n = N(dur)
    t = tvec(n)
    y = band_noise(rng, n, 4500, 15000) * np.exp(-t / 0.9)
    y += metal_clang(rng, n, 2900) * np.exp(-t / 0.6) * 0.25
    return y * smooth(t / 0.002) * 0.45


def sfx_tail(rng, dur=5.0, chord=None):
    """Finale: everything collapses to ONE sustained tone (the chord's root, octave 4). It holds under the
    final title - swelling a little as the impact clears, a slow vibrato blooming in - then lets go
    (from ~55 % of dur) into a long synthetic-hall reverb that has faded to silence at the end."""
    root = chord_pcs(chord or [62])[0]
    f = hz(12 * 5 + root)  # octave 4
    n = N(dur)
    t = tvec(n)
    vib = 1 + 0.0016 * np.sin(2 * np.pi * 4.3 * t) * smooth((t - 0.8) / 1.6)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    ph2 = 2 * np.pi * np.cumsum(f * 1.0013 * vib) / SR  # a slow beat keeps the single tone alive
    y = (np.sin(ph) + 0.55 * np.sin(ph2 + 1.3) + 0.2 * np.sin(2 * ph + 0.5) + 0.06 * np.sin(3 * ph + 1.0)) / 1.55
    let_go = 0.55 * dur
    env = (smooth(t / 0.05) * (0.75 + 0.25 * smooth(t / (0.35 * dur)))
           * np.where(t < let_go, 1.0, np.exp(-(t - let_go) / (0.1 * dur))))
    dry = np.stack([y * env, np.concatenate([np.zeros(N(0.0004)), (y * env)[:n - N(0.0004)]])]) * 0.5
    ir = make_ir(rng, min(6.0, dur), 4.5, 2.6, predelay=0.03)
    wet = np.stack([fft_convolve(dry[c], ir[c])[:n] for c in range(2)])
    return (dry * 0.7 + wet * 0.75) * (1 - smooth((t - 0.72 * dur) / (0.28 * dur)))


def sfx_pop_swarm(rng, times=()):
    """GPU: thousands of cores lighting up - a crackle that follows their arrival profile."""
    if not len(times):
        return np.zeros((2, 1))
    n = N(max(times) + 0.2)
    y = np.zeros((2, n))
    for tm in times:
        m = N(0.03)
        tt = tvec(m)
        v = np.sin(2 * np.pi * rng.uniform(1800, 5200) * tt * (1 + 0.6 * np.exp(-tt / 0.004))) * np.exp(-tt / 0.008)
        i0 = N(tm)
        k = min(m, n - i0)
        y[:, i0:i0 + k] += pan(v[:k] * rng.uniform(0.2, 0.5), rng.uniform(-0.9, 0.9))
    return y


SYNTHS = dict(boom=sfx_boom, hit=sfx_hit, riser=sfx_riser, whoosh=sfx_whoosh, suck=sfx_suck, glitch=sfx_glitch,
              spark=sfx_spark, pop=sfx_pop, powerdown=sfx_powerdown, tick=sfx_tick, blip=sfx_blip, token=sfx_token,
              zero_hit=sfx_zero_hit, fire=sfx_fire, thump=sfx_thump, wave=sfx_wave, tile=sfx_tile,
              shatter=sfx_shatter, flyby=sfx_flyby, click=sfx_click, zap=sfx_zap, beam=sfx_beam, shimmer=sfx_shimmer,
              chime=sfx_chime, stab=sfx_stab, hum=sfx_hum, sizzle=sfx_sizzle, pulse=sfx_pulse, wind=sfx_wind,
              rush=sfx_rush, descend=sfx_descend, rise_tone=sfx_rise_tone, dive_drone=sfx_dive_drone,
              swell=sfx_swell, crash=sfx_crash, tail=sfx_tail, pop_swarm=sfx_pop_swarm)
_PARAMS = {name: set(inspect.signature(fn).parameters) for name, fn in SYNTHS.items()}
IMPULSIVE = ("boom", "hit", "click", "pop", "tick", "blip", "token", "zero_hit", "fire", "thump", "wave", "tile", "shatter")


def is_impulsive(ev):
    """Sounds with a sharp attack on their sync time (the onset check). The last 'tile' is the sea tilting
    away - a whoosh, not a hit."""
    if ev.snd == "tile" and ev.params.get("n", 1) > 1 and ev.params.get("i") == ev.params.get("n") - 1:
        return False
    return ev.snd in IMPULSIVE


# ================================================================================================
#  MUSIC instruments
# ================================================================================================
_drum_cache = {}


def drum(kind):
    """Synthesised kit: K kick, S snare, H closed hat, O open hat, C clap, T tom."""
    if kind in _drum_cache:
        return _drum_cache[kind]
    rng = np.random.default_rng([SEED, zlib.crc32(kind.encode())])
    if kind == "K":
        n = N(0.5)
        t = tvec(n)
        body = sine_sweep(48 + 110 * np.exp(-t / 0.035)) * np.exp(-t / 0.28)
        click = band_noise(rng, n, 2000, 9000, ch=1)[0] * np.exp(-t / 0.003) * 0.35
        y = pan(np.tanh(1.8 * (body + click)) / np.tanh(1.8))
    elif kind == "S":
        n = N(0.4)
        t = tvec(n)
        tone = 0.5 * np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.07) + 0.3 * np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.05)
        y = pan(tone) + band_noise(rng, n, 1200, 9000) * np.exp(-t / 0.16) * 0.55
    elif kind in ("H", "O"):
        n = N(0.5 if kind == "O" else 0.12)
        t = tvec(n)
        y = band_noise(rng, n, 7000, 16000) * np.exp(-t / (0.22 if kind == "O" else 0.03)) * 0.35
    elif kind == "C":
        n = N(0.3)
        t = tvec(n)
        e = sum(np.exp(-np.maximum(t - d, 0) / 0.008) * (t >= d) for d in (0, 0.011, 0.022)) + np.exp(-t / 0.09) * 0.5
        y = band_noise(rng, n, 900, 4000) * e * 0.45
    else:
        n = N(0.45)
        t = tvec(n)
        y = pan(sine_sweep(95 + 70 * np.exp(-t / 0.04)) * np.exp(-t / 0.18)) * 0.8
    _drum_cache[kind] = fades(y, 0.0005, 0.01)
    return _drum_cache[kind]


PATTERNS = {  # 16 steps per bar; values are velocities
    "pulse": {"K": {0: 0.8, 8: 0.7}, "H": {4: 0.25, 12: 0.25}},
    "half": {"K": {0: 1.0, 10: 0.8}, "S": {8: 1.0}, "C": {8: 0.5},
             "H": {s: (0.4 if s % 4 == 2 else 0.25) for s in range(0, 16, 2)}},
    "drive": {"K": {0: 1.0, 4: 0.9, 8: 1.0, 12: 0.9}, "S": {4: 1.0, 12: 1.0},
              "H": {s: (0.45 if s % 2 == 0 else 0.28) for s in range(16)}, "O": {14: 0.4}},
    "drive2": {"K": {0: 1.0, 4: 0.9, 8: 1.0, 10: 0.6, 12: 0.9}, "S": {4: 1.0, 7: 0.3, 12: 1.0, 15: 0.35},
               "C": {4: 0.6, 12: 0.6}, "H": {s: (0.55 if s % 2 == 0 else 0.35) for s in range(16)},
               "O": {6: 0.35, 14: 0.45}},
}


def build_hits(u, s):
    """'build': four-on-the-floor, snares densifying (backbeat -> quarters -> 8ths -> 16ths) into the target."""
    hits = {}
    if s % 4 == 0:
        hits["K"] = 0.8 + 0.2 * u
    if (u < 0.3 and s in (4, 12)) or (0.3 <= u < 0.55 and s % 4 == 0) or (0.55 <= u < 0.8 and s % 2 == 0) or u >= 0.8:
        hits["S"] = 0.3 + 0.7 * u ** 1.3
    if s % 2 == 0:
        hits["H"] = 0.2 + 0.25 * u
    return hits


# ================================================================================================
#  Timeline
# ================================================================================================
WARNINGS = []


def warn(msg):
    if msg not in WARNINGS:
        WARNINGS.append(msg)


class Scene:
    _expr = re.compile(r"^\s*(@start|@end|[A-Za-z_]\w*)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?\s*$")

    def __init__(self, d, start, fps):
        self.id = d["id"]
        self.duration = int(d["duration"])
        self.cues = dict(d.get("cues", {}))
        self.ticks = dict(d.get("ticks", {}) or {})
        self.start = start
        self.fps = fps

    def rel(self, expr):
        """Scene-relative frame of a time expression (None if it names a missing cue)."""
        if isinstance(expr, (int, float)):
            return float(expr)
        m = self._expr.match(expr)
        if not m:
            warn(f"{self.id}: cannot parse time expression {expr!r}")
            return None
        base, sign, num = m.groups()
        if base == "@start":
            v = 0.0
        elif base == "@end":
            v = float(self.duration)
        elif base in self.cues:
            v = float(self.cues[base])
        else:
            warn(f"{self.id}: a table refers to missing cue '{base}'")
            return None
        if num:
            v += float(num) * (1 if sign == "+" else -1)
        return v

    def abs(self, expr):
        r = self.rel(expr)
        return None if r is None else (self.start + r) / self.fps

    @property
    def t0(self):
        return self.start / self.fps

    @property
    def t1(self):
        return (self.start + self.duration) / self.fps


def load_timeline():
    with open(TIMELINE, encoding="utf-8") as fh:
        data = json.load(fh)
    fps = data.get("fps", 30)
    scenes, start = [], 0
    for d in data["scenes"]:
        scenes.append(Scene(d, start, fps))
        start += int(d["duration"])
    return fps, scenes, start


class Curve:
    """Piecewise-linear automation in absolute time (flat beyond the ends); empty -> constant 1."""

    def __init__(self, pts):
        pts = sorted(pts)
        self.x = np.array([p[0] for p in pts], dtype=float)
        self.y = np.array([p[1] for p in pts], dtype=float)
        for i in range(1, len(self.x)):
            if self.x[i] <= self.x[i - 1]:
                self.x[i] = self.x[i - 1] + 1e-6

    def __call__(self, t):
        if len(self.x) == 0:
            return np.ones_like(np.asarray(t, dtype=float))
        return np.interp(t, self.x, self.y)


def curve_for(sc, pts):
    out = []
    for expr, v in pts or []:
        a = sc.abs(expr)
        if a is not None:
            out.append((a, v))
    return Curve(out)


# ================================================================================================
#  Event expansion (cue tables -> concrete sounds at absolute times)
# ================================================================================================
class Ev:
    def __init__(self, t, start, label, snd, gain=1.0, rev=None, duck=None, params=None):
        self.t, self.start, self.label, self.snd = t, start, label, snd
        self.gain = gain
        self.rev = REV_SEND.get(snd, 0.2) if rev is None else rev
        self.duck = duck
        self.params = params or {}
        self.dur = 0.0


def gen_toggle(sc, cue, t, gain, p):
    """Tube: a click on every on/off transition of the clocked bit pattern; a short hum while 'on'."""
    f0 = sc.cues[cue]
    evs, prev, f = [], 0, f0
    while f < sc.duration - 6:
        k = (f - f0) // SYNC_TUBE_BIT_LEN
        b = SYNC_TUBE_BITS[k % len(SYNC_TUBE_BITS)]
        if b != prev:
            tt = (sc.start + f) / sc.fps
            fade_k = 1.0 - 0.4 * (f - f0) / max(1, sc.duration - f0)
            evs.append(Ev(tt, tt, f"{sc.id}.{cue}", "click", gain * (1.0 if b else 0.7) * fade_k))
            if b:
                run = 1
                while SYNC_TUBE_BITS[(k + run) % len(SYNC_TUBE_BITS)] == 1 and run < 4:
                    run += 1
                d = min(run * SYNC_TUBE_BIT_LEN, sc.duration - 6 - f) / sc.fps
                evs.append(Ev(tt, tt, f"{sc.id}.{cue}", "hum", gain * 0.35 * fade_k, params=dict(dur=d, swell=0.02)))
            prev = b
        f += SYNC_TUBE_BIT_LEN
    return evs


def gen_doubling(sc, cue, t, gain, p):
    evs = []
    for k in range(6):
        tt = (sc.start + sc.cues[cue] + k * SYNC_MOORE_STEP) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#{k}", "blip", gain * (0.8 + 0.04 * k), params=dict(freq=660 * 2 ** (k / 2.4))))
    return evs


def gen_years(sc, cue, t, gain, p):
    """Moore: one tick per two displayed years - yearAt(f) = 1971 + 53*inQuad(prog(f, year0, end))."""
    if "end" not in sc.cues:
        warn("moore: no 'end' cue - year ticks skipped")
        return []
    y0, e = sc.cues[cue], sc.cues["end"]
    base, span = SYNC_MOORE_YEARS
    frames, prev = [], None
    for f in range(int(y0), int(e) + 1):
        pr = min(1.0, max(0.0, (f - y0) / max(1e-9, e - y0)))
        b = math.floor(span * pr * pr / 2)
        if prev is not None and b > prev:
            frames.append(f)
        prev = b
    evs = []
    for i, f in enumerate(frames):
        u = i / max(1, len(frames) - 1)
        tt = (sc.start + f) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#{i}", "tick", gain * (0.7 + 0.3 * u), params=dict(freq=900 * 2 ** (1.6 * u), dec=0.016)))
    return evs


def gen_wall_split(sc, cue, t, gain, p):
    every, count = SYNC_WALL_SPLIT
    evs = []
    for k in range(count):
        tt = (sc.start + sc.cues[cue] + k * every) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#{k}", "tick", gain, params=dict(freq=1200 * 2 ** (k / 4), dec=0.025)))
    return evs


def gen_cores(sc, cue, t, gain, p):
    count, every = SYNC_GPU_CPU
    f0 = sc.cues[cue]
    evs = []
    for i in range(count):
        tt = (sc.start + f0 + i * every) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#cpu{i}", "pop", gain))
    cols, rows, sq, per, off = SYNC_GPU_GRID
    jj, ii = np.mgrid[0:rows, 0:cols]
    arrive = np.sort((off + np.hypot(ii - cols / 2, (jj - rows / 2) * sq) * per).ravel())  # frames after the cue
    times = arrive[:: max(1, len(arrive) // 48)] / sc.fps
    t0 = (sc.start + f0) / sc.fps + times[0]
    evs.append(Ev(t0, t0, f"{sc.id}.{cue}#gpu", "pop_swarm", gain * 0.9, params=dict(times=list(times - times[0]))))
    return evs


def gen_cpu_rows(sc, cue, t, gain, p):
    """GPU race: the CPU plods along, one soft tock every two rows (CPU_ROWS rows/frame)."""
    f0 = sc.cues[cue]
    stop = sc.cues.get("matrix", sc.duration) - 20
    step = 2 / SYNC_GPU_CPU_ROWS
    evs, k = [], 1
    while f0 + k * step < stop:
        tt = (sc.start + f0 + k * step) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#row{k}", "tick", gain, params=dict(freq=700, dec=0.02, noise=0.2)))
        k += 1
    return evs


def gen_matrix(sc, cue, t, gain, p):
    """GPU matrix: soft ticks for the first cell's multiply-adds, a burst when every cell fires, a whoosh on the zoom-out."""
    g = SYNC_GPU_MATRIX
    f0 = sc.cues[cue]
    evs = []
    for k in range(g["n"]):
        tt = (sc.start + f0 + g["one"] + k * g["one_len"] / g["n"]) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#mac{k}", "tick", gain, params=dict(freq=1000 * 2 ** (k / 8), dec=0.03)))
    ta = (sc.start + f0 + g["all"]) / sc.fps
    evs.append(Ev(ta, ta, f"{sc.id}.{cue}#all", "shimmer", gain * 1.3))
    evs.append(Ev(ta, ta, f"{sc.id}.{cue}#all", "hit", gain * 1.4, params=dict(size=0.5)))
    tz = (sc.start + f0 + g["zoom"]) / sc.fps
    evs.append(Ev(tz, tz, f"{sc.id}.{cue}#zoom", "whoosh", gain * 1.4, params=dict(dur=g["zoom_len"] / sc.fps, peak=0.6, lo=150, hi=2500)))
    return evs


def gen_bars(sc, cue, t, gain, p):
    if any(k in sc.ticks for k in ("bar", "bars")):
        return []  # the ticks series carries the sound
    count, every = SYNC_ALEXNET_BARS
    evs = []
    for k in range(count):
        tt = (sc.start + sc.cues[cue] + k * every) / sc.fps
        evs.append(Ev(tt, tt, f"{sc.id}.{cue}#{k}", "tick", gain, params=dict(freq=1300 * 2 ** (k / 10), dec=0.03)))
    return evs


GENERATORS = dict(gen_toggle=gen_toggle, gen_doubling=gen_doubling, gen_years=gen_years, gen_wall_split=gen_wall_split,
                  gen_cores=gen_cores, gen_cpu_rows=gen_cpu_rows, gen_matrix=gen_matrix, gen_bars=gen_bars)
DEFAULT_DUR = dict(whoosh=1.2, riser=3.0, swell=5.0)


def expand_spec(sc, cue, spec):
    spec = dict(spec)
    snd = spec.pop("snd")
    t = sc.abs(cue)
    if t is None:
        return []
    t += spec.pop("at", 0) / sc.fps
    gain = spec.pop("gain", 1.0)
    rev = spec.pop("rev", None)
    duck = spec.pop("duck", None)
    label = f"{sc.id}.{cue}"
    if snd in GENERATORS:
        return GENERATORS[snd](sc, cue, t, gain, spec)
    if snd not in SYNTHS:
        warn(f"{label}: unknown sound '{snd}'")
        return []
    start = t
    for key in ("to", "until"):
        if key in spec:
            tgt = sc.abs(spec.pop(key))
            if tgt is None or tgt <= t + 0.05:
                warn(f"{label}: '{key}' target missing or not after the cue - {snd} skipped")
                return []
            spec["dur"] = tgt - t
    if "lead" in spec:
        spec["dur"] = spec.pop("lead")
        start = t - spec["dur"]
    if spec.pop("peak_at_cue", False):
        spec.setdefault("dur", DEFAULT_DUR.get(snd, 1.2))
        start = t - spec.get("peak", 0.45) * spec["dur"]
    return [Ev(t, max(0.0, start), label, snd, gain, rev, duck, spec)]


def expand_events(scenes):
    evs = []
    for sc in scenes:
        table = CUE_SOUNDS.get(sc.id)
        if table is None:
            warn(f"scene '{sc.id}' has no entry in CUE_SOUNDS - its cues are silent")
            table = {}
        for cue in sc.cues:
            specs = table.get(cue)
            if specs is None and sc.id in SCENE_FALLBACK:
                warn(f"no sound mapped for cue {sc.id}.{cue} - using the {sc.id} fallback")
                specs = SCENE_FALLBACK[sc.id]
            elif specs is None:
                warn(f"no sound mapped for cue {sc.id}.{cue}")
                continue
            for spec in specs:
                evs += expand_spec(sc, cue, spec)
        for cue in table:
            if cue not in sc.cues:
                warn(f"CUE_SOUNDS maps {sc.id}.{cue} but the timeline has no such cue")
        for name, frames in sc.ticks.items():
            spec = TICK_SOUNDS.get(sc.id, {}).get(name)
            if spec is None:
                warn(f"ticks {sc.id}.{name}: no mapping - using the default tick")
                spec = DEFAULT_TICK
            spec = dict(spec)
            snd = spec.pop("snd")
            gain = spec.pop("gain", 1.0)
            for i, f in enumerate(frames):
                tt = (sc.start + float(f)) / sc.fps
                params = dict(spec)
                start = tt
                if params.pop("peak_at_cue", False):
                    params.setdefault("dur", DEFAULT_DUR.get(snd, 1.2))
                    start = tt - params.get("peak", 0.55 if snd == "flyby" else 0.45) * params["dur"]
                if "lead" in params:
                    params["dur"] = params.pop("lead")
                    start = tt - params["dur"]
                if "i" in _PARAMS[snd]:
                    params.update(i=i, n=len(frames))
                evs.append(Ev(tt, max(0.0, start), f"{sc.id}.ticks.{name}#{i}", snd, gain, params=params))
    evs.sort(key=lambda e: (e.t, e.label))
    return evs


def default_duck(ev):
    if ev.duck is not None:
        return ev.duck
    if ev.snd == "boom":
        s = ev.params.get("size", 1.0)
        return (min(0.85, 0.4 + 0.3 * s), 0.4 + 0.8 * s)
    if ev.snd == "hit":
        return (0.12 + 0.2 * ev.params.get("size", 0.6), 0.3)
    if ev.snd in ("shatter", "tile", "zero_hit"):
        return (0.2, 0.3)
    return None


# ================================================================================================
#  Music plan
# ================================================================================================
class Seg:
    pass


def build_music_plan(scenes):
    segs, arps, basses, drums = [], [], [], []
    prev_cfg = DEFAULT_MUSIC
    for sc in scenes:
        cfg = SCENE_MUSIC.get(sc.id)
        if cfg is None:
            warn(f"scene '{sc.id}' has no SCENE_MUSIC entry - continuing the previous bed")
            cfg = dict(prev_cfg, auto=[], cutoff_auto=[], arp=[], bass=[], drums=[])
        prev_cfg = cfg
        auto = curve_for(sc, cfg.get("auto"))
        cut = curve_for(sc, cfg.get("cutoff_auto"))
        base = dict(level=cfg.get("level", 0.5), saw=cfg.get("saw", 0.5), cutoff=cfg.get("cutoff", 2000))
        entries = []
        for e in cfg.get("chords", DEFAULT_MUSIC["chords"]):
            a = sc.abs(e[0])
            if a is not None:
                entries.append((a, e[1], e[2] if len(e) > 2 else {}))
        entries.sort(key=lambda e: e[0])
        for i, (a, notes, ov) in enumerate(entries):
            b = entries[i + 1][0] if i + 1 < len(entries) else sc.t1
            if b <= a:
                continue
            s = Seg()
            s.scene, s.t0, s.t1 = sc.id, a, b
            s.notes = [midi(x) for x in notes.split()] if notes else None
            s.p = dict(base, **ov)
            s.auto, s.cut = auto, cut
            segs.append(s)
        for kind, dest in (("arp", arps), ("bass", basses)):
            for frm, to, opt in cfg.get(kind, []):
                a, b = sc.abs(frm), sc.abs(to)
                if a is None or b is None or b <= a:
                    continue
                dest.append(dict(opt, t0=a, t1=b, auto=auto, scene=sc))
        for frm, to, pat, g, opt in cfg.get("drums", []):
            a, b = sc.abs(frm), sc.abs(to)
            if a is None or b is None or b <= a:
                continue
            drums.append(dict(opt, t0=a, t1=b, pattern=pat, gain=g, scene=sc))
    return segs, arps, basses, drums


def make_chord_lookup(segs):
    starts = np.array([s.t0 for s in segs])
    voiced, last = [], [50, 57, 62, 65]
    for s in segs:
        if s.notes:
            last = s.notes
        voiced.append(last)

    def chord_at(t):
        i = int(np.searchsorted(starts, t + 1e-6, side="right")) - 1
        return voiced[max(0, i)]
    return chord_at


def grid_origin(sec, scenes_by_id, bpm):
    anchor = sec.get("anchor")
    if anchor:
        a = sec["scene"].abs(anchor)
        if a is not None:
            return a
    sid, cue = GRID_ANCHORS.get(bpm, (None, None))
    sc = scenes_by_id.get(sid)
    if sc is not None and cue in sc.cues:
        return sc.abs(cue)
    return sec["t0"]


def grid_times(t0, t1, origin, step):
    k0 = math.ceil((t0 - origin) / step - 1e-6)
    k1 = math.ceil((t1 - origin) / step - 1e-6)
    return [(k, origin + k * step) for k in range(k0, k1)]


def add_to(bus, t0, x, gain=1.0):
    i0 = int(round(t0 * SR))
    n = x.shape[-1]
    a, b = max(0, i0), min(bus.shape[1], i0 + n)
    if b > a:
        bus[:, a:b] += (x[:, a - i0:b - i0] * gain).astype(np.float32)


# ================================================================================================
#  Render
# ================================================================================================
def render_pads(mus, segs, total_s):
    n_total = mus.shape[1]
    nx_full = N(XF)
    for s in segs:
        if not s.notes:
            continue
        a, b = max(0.0, s.t0 - XF / 2), min(total_s, s.t1 + XF / 2)
        i0 = N(a)
        n = min(n_total, N(b)) - i0
        if n <= 0:
            continue
        ta = (i0 + np.arange(n)) / SR
        mult = s.cut(ta)
        lo, hi = float(np.min(mult)), float(np.max(mult))
        loop = chord_loop(s.notes, s.p["saw"])
        if hi - lo < 1e-6:  # static brightness: filter the loop itself, then tile
            y = tile_abs(periodic_lowpass(loop, min(16000, s.p["cutoff"] * hi), 2), i0, n)
        else:               # automated: a static pole at the brightest setting + one moving pole
            y = tile_abs(periodic_lowpass(loop, min(16000, s.p["cutoff"] * hi), 1), i0, n)
            y = lowpass(y, np.clip(s.p["cutoff"] * mult, 60, 16000), 1)
        w = np.ones(n)
        nx = min(nx_full, n // 2)
        if s.t0 - XF / 2 > 0:   # sin^2 / cos^2: notes shared by both chords stay at constant level
            w[:nx] = np.sin(0.5 * np.pi * np.arange(nx) / nx) ** 2
        if s.t1 + XF / 2 < total_s:
            w[n - nx:] = np.cos(0.5 * np.pi * (np.arange(nx) + 1) / nx) ** 2
        mus[:, i0:i0 + n] += (y * (s.p["level"] * s.auto(ta) * w)).astype(np.float32)


def render_arps(mus, arps, chord_at, by_id):
    for sec in arps:
        bpm, div = sec.get("bpm", 100), sec.get("div", 4)
        oc = sec.get("octave", 4)
        bright = sec.get("bright", 0.5)
        for k, t in grid_times(sec["t0"], sec["t1"], grid_origin(sec, by_id, bpm), 60.0 / bpm / div):
            ch = chord_at(t)
            notes = notes_in_octave(ch, oc) + notes_in_octave(ch, oc + 1)
            seq = list(range(len(notes))) + list(range(len(notes) - 2, 0, -1))  # up-down
            w = pluck_wave(notes[seq[k % len(seq)]], bright, decay=0.22 + 0.25 * (1 - bright), dur=sec.get("gate", 0.5))
            g = sec["gain"] * (1.0 if k % div == 0 else 0.72) * float(sec["auto"](t))
            p = 0.35 if k % 2 else -0.35
            add_to(mus, t, pan(w, p), g)
            add_to(mus, t + 0.75 * 60.0 / bpm, pan(w, -p), g * 0.28)  # dotted-eighth echo, opposite side


def render_bass(mus, basses, chord_at, by_id):
    heart = None
    for sec in basses:
        bpm = sec.get("bpm", 100)
        origin = grid_origin(sec, by_id, bpm)
        if sec.get("style") == "heart":  # lub-dub every other beat
            if heart is None:
                tt = tvec(N(0.5))
                heart = pan(sine_sweep(46 + 30 * np.exp(-tt / 0.03)) * np.exp(-tt / 0.16) * smooth(tt / 0.003))
            for k, t in grid_times(sec["t0"], sec["t1"], origin, 2 * 60.0 / bpm):
                for dt, v in ((0.0, 1.0), (0.21, 0.65)):
                    add_to(mus, t + dt, heart, sec["gain"] * v * float(sec["auto"](t)))
            continue
        div = sec.get("div", 2)
        for k, t in grid_times(sec["t0"], sec["t1"], origin, 60.0 / bpm / div):
            root = chord_pcs(chord_at(t))[0]
            m = 36 + root if root >= 4 else 48 + root  # E2..D#3 keeps the bass audible
            add_to(mus, t, pan(pluck_wave(m, 0.28, decay=0.22, dur=0.3)), sec["gain"] * (1.0 if k % 2 else 0.78) * float(sec["auto"](t)))


def render_drums(drm, drum_secs, by_id, pumps):
    step = 60.0 / 120 / 4
    for sec in drum_secs:
        origin = grid_origin(sec, by_id, 120)
        dur = sec["t1"] - sec["t0"]
        if sec.get("crash"):
            add_to(drm, sec["t0"], sfx_crash(np.random.default_rng([SEED, 7])), 0.5 * sec["gain"])
        for k, t in grid_times(sec["t0"], sec["t1"] - 0.03, origin, step):
            s = k % 16
            if sec["pattern"] == "build":
                hits = build_hits((t - sec["t0"]) / dur, s)
            else:
                hits = {inst: steps[s] for inst, steps in PATTERNS[sec["pattern"]].items() if s in steps}
            for inst, v in hits.items():
                if v > 0:
                    add_to(drm, t, drum(inst), sec["gain"] * v ** 1.3)
                    if inst == "K" and sec["pattern"] != "pulse":
                        pumps.append((t, 0.22, 0.16))


def render(quiet=False, report=False):
    t_start = time.time()
    fps, scenes, total_frames = load_timeline()
    total_s = total_frames / fps
    n_total = int(round(total_frames * SR / fps))
    by_id = {s.id: s for s in scenes}

    mus = np.zeros((2, n_total), np.float32)   # pads + arp + bass (scene automation, pump + big ducks)
    drm = np.zeros((2, n_total), np.float32)   # drums (big ducks only)
    sfx = np.zeros((2, n_total), np.float32)   # sound effects (dry)
    srev = np.zeros((2, n_total), np.float32)  # sound-effect reverb sends
    ducks, pumps = [], []

    # -- music --
    segs, arps, basses, drum_secs = build_music_plan(scenes)
    chord_at = make_chord_lookup(segs)
    render_pads(mus, segs, total_s)
    render_arps(mus, arps, chord_at, by_id)
    render_bass(mus, basses, chord_at, by_id)
    render_drums(drm, drum_secs, by_id, pumps)
    t_music = time.time() - t_start

    # -- sound effects --
    events = expand_events(scenes)
    counts = {}
    for ev in events:
        key = f"{ev.label}|{ev.snd}"
        counts[key] = counts.get(key, 0) + 1
        rng = np.random.default_rng([SEED, zlib.crc32(f"{key}|{counts[key]}".encode())])
        params = dict(ev.params)
        p = params.pop("pan", None)
        if "chord" in _PARAMS[ev.snd]:
            params["chord"] = chord_at(ev.t)
        x = fades(np.array(SYNTHS[ev.snd](rng, **params), dtype=np.float64), 0.0015, 0.012)
        if p is not None:  # balance
            a = (np.clip(p, -1, 1) + 1) * (np.pi / 4)
            x[0] *= math.cos(a) * SQ2
            x[1] *= math.sin(a) * SQ2
        add_to(sfx, ev.start, x, ev.gain)
        if ev.rev > 0:
            add_to(srev, ev.start, x, ev.gain * ev.rev)
        ev.dur = x.shape[1] / SR
        if report and is_impulsive(ev):  # for the onset check: own onset (in isolation) + the head of the sound
            k0 = N(ev.t - ev.start)
            head = np.abs(x[:, k0:k0 + N(0.15)]).max(axis=0)
            ev.iso_ms = (ev.start - ev.t) * 1000 + (int(np.argmax(head > 0.1 * head.max())) / SR * 1000 if head.size else 0)
            ev.head = (x[:, k0:k0 + N(0.03)].mean(axis=0) * ev.gain).astype(np.float32)
        d = default_duck(ev)
        if d:
            ducks.append((ev.t, d[0], d[1]))
    t_sfx = time.time() - t_start - t_music

    # -- ducking (1 ms resolution), reverb, master --
    n_ms = int(math.ceil(total_s * 1000)) + 2
    tm = np.arange(n_ms) / 1000.0

    def duck_curve(evs):
        g = np.ones(n_ms)
        for t, depth, rel in evs:
            a = max(0, int((t - 0.01) * 1000))
            b = min(n_ms, int((t + rel * 6) * 1000) + 1)
            if b > a:
                dt = tm[a:b] - t
                e = 1 - depth * np.where(dt < 0, np.clip((dt + 0.01) / 0.01, 0, 1), np.exp(-np.maximum(dt, 0) / rel))
                g[a:b] = np.minimum(g[a:b], e)
        return g

    big = duck_curve(ducks)
    pos = np.arange(n_total) / SR  # seconds, like tm
    mus *= np.interp(pos, tm, np.minimum(big, duck_curve(pumps))).astype(np.float32)
    drm *= np.interp(pos, tm, big).astype(np.float32)
    drm = (DRUM_GLUE * np.tanh(drm / DRUM_GLUE)).astype(np.float32)  # drum-bus glue
    del pos

    ir = make_ir(np.random.default_rng([SEED, 99]), 3.2, 2.4, 1.1)
    mix = np.zeros((2, n_total))
    for c in range(2):
        wet = fft_convolve(mus[c] * 0.22 + drm[c] * 0.1 + srev[c], ir[c])[:n_total]
        mix[c] = mus[c] + drm[c] + sfx[c] + wet * 0.36
    sfx_dry = sfx.mean(axis=0) if report else None
    del mus, drm, sfx, srev

    mix = highpass(mix, 22.0)
    mix -= mix.mean(axis=1, keepdims=True)
    drive = 2.0  # tanh knee: only the biggest impacts reach it; lifts the bed ~1.5 dB relative to the peaks
    mix = np.tanh(mix * (drive / (np.max(np.abs(mix)) + 1e-12))) / math.tanh(drive)  # soft limiter
    fades(mix, 0.05, 0.5)
    mix *= 10 ** (PEAK_DBFS / 20) / (np.max(np.abs(mix)) + 1e-12)

    pcm = np.clip(np.round(mix.T * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with wave.open(OUT, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    elapsed = time.time() - t_start

    # -- report --
    if not quiet:
        print(f"\n{'start':>9} {'sync':>9}  {'scene.cue':<34} {'sound':<11} {'dur':>6} {'gain':>5}")
        for ev in events:
            print(f"{fmt_t(ev.start):>9} {fmt_t(ev.t):>9}  {ev.label:<34} {ev.snd:<11} {ev.dur:6.2f} {ev.gain:5.2f}")
    peak = 20 * math.log10(np.max(np.abs(pcm)) / 32768 + 1e-12)
    rms = 20 * math.log10(np.sqrt(np.mean((pcm.astype(np.float64) / 32768) ** 2)) + 1e-12)
    print(f"\nscenes: {len(scenes)}   events placed: {len(events)}   music segments: {len(segs)}"
          f"   arp/bass/drum sections: {len(arps)}/{len(basses)}/{len(drum_secs)}")
    print(f"duration: {n_total / SR:.3f} s  (timeline: {total_frames} frames / {fps} fps = {total_s:.3f} s)")
    print(f"peak: {peak:.2f} dBFS   RMS: {rms:.2f} dBFS   DC: {mix.mean():+.2e}")
    print(f"time: {elapsed:.1f} s  (music {t_music:.1f} s, sfx {t_sfx:.1f} s)")
    print(f"wrote {os.path.relpath(OUT, ROOT)}")
    for w_ in WARNINGS:
        print(f"WARNING: {w_}")
    if report:
        loudness_report(mix, sfx_dry, scenes, events)
    return dict(duration=n_total / SR, peak=peak, rms=rms, events=len(events), warnings=list(WARNINGS), elapsed=elapsed)


def fmt_t(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"


def onset_ms(sig, t, half=100, diff=True, env_cache={}):
    """Steepest rise of a 5 ms RMS envelope within +-half ms of t; returns ms relative to t.
    diff=True works on the first difference (transient-weighted, for bright sounds)."""
    key = (id(sig), diff)
    if key not in env_cache:
        d = np.diff(sig.astype(np.float64), prepend=0.0) if diff else sig.astype(np.float64)
        cs = np.concatenate([[0.0], np.cumsum(d * d)])
        idx = np.arange(0, len(sig) - 480, SR // 1000)
        env_cache[key] = np.sqrt((cs[idx + 480] - cs[idx]) / 480 + 1e-12)  # 10 ms windows, 1 ms hop
    env = env_cache[key]
    c = int(t * 1000)
    a, b = max(10, c - half - 5), min(len(env) - 11, c + half - 4)
    rise = env[a:b] / (env[a - 10:b - 10] + 1e-6)  # energy in the 10 ms after k vs the 10 ms before
    return int(np.argmax(rise)) + a - c


def loudness_report(mix, sfx_dry, scenes, events):
    mono = mix.mean(axis=0)
    nsec = len(mono) // SR
    db = 20 * np.log10(np.sqrt(np.mean(mono[:nsec * SR].reshape(nsec, SR) ** 2, axis=1)) + 1e-9)
    w = SR * 2 // 5
    print("\nper-scene loudness (RMS dBFS / loudest 400 ms):")
    for sc in scenes:
        seg = mono[int(sc.t0 * SR):int(sc.t1 * SR)]
        r = 20 * math.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)
        k = len(seg) // w
        mx = 20 * math.log10(np.max(np.sqrt(np.mean(seg[:k * w].reshape(k, w) ** 2, axis=1))) + 1e-9) if k else r
        print(f"  {sc.id:<12} {fmt_t(sc.t0):>8}  rms {r:6.1f}   max400ms {mx:6.1f}")
    chars = " .:-=+*#%@"
    print("\nper-second envelope (1 char = 1 s; ' ' <= -42 dB ... '@' >= -6 dB):")
    for row in range(0, nsec, 60):
        s = "".join(chars[int(np.clip((d + 42) / 36 * 9, 0, 9))] for d in db[row:row + 60])
        print(f"  {fmt_t(row):>8} |{s}|")
    k = len(mono) // w
    st = np.sqrt(np.mean(mono[:k * w].reshape(k, w) ** 2, axis=1))
    print("\nloudest 400 ms windows:")
    shown = []
    for i in np.argsort(st)[::-1]:
        t = i * w / SR
        if any(abs(t - s) < 2.0 for s in shown):
            continue
        shown.append(t)
        near = min((e for e in events if e.snd in ("boom", "hit", "zero_hit", "tile", "shatter")), key=lambda e: abs(e.t - t))
        print(f"  {fmt_t(t):>8}  {20 * math.log10(st[i] + 1e-9):6.1f} dB   nearest impact: {near.label} ({near.snd})")
        if len(shown) >= 10:
            break
    imp = [ev for ev in events if ev.start == ev.t and hasattr(ev, "iso_ms")]
    # 1) every impulsive event rendered in isolation: its first strong sample vs its sync time
    late = [ev for ev in imp if abs(ev.iso_ms) > 33]
    worst = max((abs(ev.iso_ms) for ev in imp), default=0.0)
    print(f"\nonset check, isolated: {len(imp) - len(late)}/{len(imp)} impulsive events start within 1 frame "
          f"of their cue (worst {worst:.1f} ms)")
    for ev in late:
        print(f"  CHECK {ev.label} ({ev.snd}) {ev.iso_ms:+.0f} ms")
    # 2) in context on the effects bus - only where the event owns most of the bus energy over the whole
    #    search window (in the detector's domain); otherwise an overlapping transient (a swarm of pops, ice
    #    shards, ...) can own the steepest rise and the measurement says nothing about this event
    ts = np.array(sorted({ev.t for ev in imp}))
    bad, masked = [], 0
    for ev in imp:
        j = int(np.searchsorted(ts, ev.t))
        gap = min(ev.t - ts[j - 1] if j > 0 else 1.0, ts[j + 1] - ev.t if j + 1 < len(ts) else 1.0)
        half = int(max(10, min(100, 500 * gap)))  # never reach a neighbour's onset
        lf = ev.snd in ("boom", "hit", "thump", "wave", "zero_hit", "tile")
        i0 = N(ev.t)
        a = max(0, i0 - N(half / 1000))
        h = ev.head[:max(0, len(sfx_dry) - i0)]
        bus = sfx_dry[a:i0 + len(h)].astype(np.float64)
        own = np.zeros_like(bus)
        own[i0 - a:] = h
        if not lf:
            bus, own = np.diff(bus), np.diff(own)
        if np.sum(own * own) < 0.5 * np.sum(bus * bus):
            masked += 1
            continue
        d = onset_ms(sfx_dry, ev.t, half, diff=not lf)
        if abs(d) > 33:
            bad.append((ev.label, ev.snd, d))
    checked = len(imp) - masked
    print(f"onset check, effects bus: {checked - len(bad)}/{checked} dominant events within 1 frame "
          f"({masked} masked by louder overlapping sounds - covered by the isolated check)")
    for lab, snd, d in bad:
        print(f"  CHECK {lab} ({snd}) {d:+d} ms")
    print("onset check on the final mix (big impacts):")
    for ev in events:
        if (ev.snd == "boom" or (ev.snd == "hit" and ev.params.get("size", 0) >= 0.75)) and "#" not in ev.label:
            d = onset_ms(mono, ev.t, 60, diff=False)
            print(f"  {ev.label:<24} {ev.snd:<5} cue {fmt_t(ev.t)}  onset {d:+4d} ms  {'OK' if abs(d) <= 33 else 'CHECK'}")


if __name__ == "__main__":
    render(quiet="--quiet" in sys.argv, report="--report" in sys.argv)
