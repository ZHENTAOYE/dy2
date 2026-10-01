#!/usr/bin/env python3
"""Synthesize the cinematic score for 宇宙膨胀 from scratch (numpy/scipy only).

Every hit is placed from src/timeline.json so audio and picture stay locked:
scene durations give absolute times, and `cues` mark impacts, risers, braams…
Musical beds (pads, arpeggios, drums) are written per scene below.

Output: public/audio/soundtrack.mp3 (and a .wav next to it when --wav is given).
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
RNG = np.random.default_rng(7)

TL = json.loads((ROOT / "src" / "timeline.json").read_text(encoding="utf-8"))
START = {}
_acc = 0.0
for s in TL["scenes"]:
    START[s["id"]] = _acc
    _acc += s["duration"]
TOTAL = _acc
N = int(TOTAL * SR) + SR * 2

# Stereo buses: dry mix and reverb send.
DRY = np.zeros((2, N), np.float32)
WET = np.zeros((2, N), np.float32)

BPM = 100.0
BEAT = 60.0 / BPM
BAR = BEAT * 4

# ---------------------------------------------------------------------------
# Notes & chords
# ---------------------------------------------------------------------------
_PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
       "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(name: str) -> float:
    pc = name[:-1]
    octave = int(name[-1])
    midi = 12 * (octave + 1) + _PC[pc]
    return 440.0 * 2 ** ((midi - 69) / 12)


CHORDS = {
    "Dm": ["D2", "A2", "D3", "F3", "A3", "E4"],
    "Bb": ["Bb1", "F2", "Bb2", "D3", "F3", "C4"],
    "F": ["F2", "C3", "F3", "A3", "C4", "G4"],
    "C": ["C2", "G2", "C3", "E3", "G3", "D4"],
    "Gm": ["G1", "D2", "G2", "Bb2", "D3", "A3"],
    "A": ["A1", "E2", "A2", "C#3", "E3", "B3"],
    "Eb": ["Eb2", "Bb2", "Eb3", "G3", "Bb3", "F4"],
    "Fadd9": ["F2", "C3", "F3", "A3", "C4", "G4", "A4"],
    "Dadd9": ["D2", "A2", "D3", "F#3", "A3", "E4", "F#4", "A4"],
    "Dsus2": ["D2", "A2", "D3", "E3", "A3", "E4"],
    "Bbmaj7": ["Bb1", "F2", "Bb2", "D3", "A3", "F4"],
}
# Upper chord tones for arpeggios.
ARP = {
    "Dm": ["D4", "A4", "D5", "F5", "A5", "F5", "D5", "A4"],
    "Bb": ["Bb3", "F4", "Bb4", "D5", "F5", "D5", "Bb4", "F4"],
    "F": ["F4", "C5", "F5", "A5", "C6", "A5", "F5", "C5"],
    "C": ["C4", "G4", "C5", "E5", "G5", "E5", "C5", "G4"],
    "Gm": ["G3", "D4", "G4", "Bb4", "D5", "Bb4", "G4", "D4"],
    "A": ["A3", "E4", "A4", "C#5", "E5", "C#5", "A4", "E4"],
    "Eb": ["Eb4", "Bb4", "Eb5", "G5", "Bb5", "G5", "Eb5", "Bb4"],
}
ROOTS = {"Dm": "D2", "Bb": "Bb1", "F": "F2", "C": "C2", "Gm": "G1", "A": "A1", "Eb": "Eb2"}


# ---------------------------------------------------------------------------
# DSP helpers
# ---------------------------------------------------------------------------
def tvec(n):
    return np.arange(n, dtype=np.float64) / SR


def lp(x, fc, order=2):
    fc = min(fc, SR * 0.45)
    sos = butter(order, fc / (SR / 2), btype="low", output="sos")
    return sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype="high", output="sos")
    return sosfilt(sos, x)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], btype="band", output="sos")
    return sosfilt(sos, x)


def sweep_filter(x, f0, f1, kind="low", block=512, curve=1.0):
    """Time-varying 2nd-order filter, cutoff moving exponentially f0 → f1."""
    out = np.zeros_like(x)
    zi = np.zeros(2)
    nb = int(np.ceil(len(x) / block))
    for i in range(nb):
        k = (i / max(1, nb - 1)) ** curve
        fc = f0 * (f1 / f0) ** k
        fc = min(max(fc, 20), SR * 0.45)
        b, a = butter(2, fc / (SR / 2), btype=kind)
        seg = x[i * block:(i + 1) * block]
        y, zi = lfilter(b, a, seg, zi=zi)
        out[i * block:i * block + len(seg)] = y
    return out


def env_ar(n, attack, release, curve=2.0):
    t = tvec(n)
    dur = n / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((dur - t) / max(release, 1e-4), 0, 1)
    return (a ** 1.0) * (r ** curve)


def db(x):
    return 10 ** (x / 20)


def place(sig, start, gain=1.0, pan=0.0, send=0.25):
    """Mix a mono (n,) or stereo (2,n) signal into the buses at `start` seconds."""
    i0 = int(round(start * SR))
    if i0 >= N:
        return
    if sig.ndim == 1:
        p = (pan + 1) * np.pi / 4
        st = np.vstack([sig * np.cos(p), sig * np.sin(p)])
    else:
        st = sig
    if i0 < 0:
        st = st[:, -i0:]
        i0 = 0
    n = min(st.shape[1], N - i0)
    st = st[:, :n].astype(np.float32) * gain
    DRY[:, i0:i0 + n] += st
    if send > 0:
        WET[:, i0:i0 + n] += st * send


def additive(f, n, harmonics=8, roll=1.5, detune=0.0, vib=0.0, vib_rate=5.0, phase_seed=None):
    t = tvec(n)
    f = f * 2 ** (detune / 1200)
    rng = np.random.default_rng(phase_seed) if phase_seed is not None else RNG
    out = np.zeros(n)
    pm = vib * np.sin(2 * np.pi * vib_rate * t + rng.uniform(0, 6.28)) if vib else 0.0
    for k in range(1, harmonics + 1):
        if f * k > 14000:
            break
        out += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28) + pm * k) / k ** roll
    return out


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------
def pad(chord, start, dur, gain_db=-26, attack=1.5, release=2.0, bright=1800, notes=None, send=0.45, width=0.7):
    names = notes if notes is not None else CHORDS[chord]
    n = int((dur + release) * SR)
    env = env_ar(n, attack, release + 0.01, curve=1.5)
    L = np.zeros(n)
    R = np.zeros(n)
    for i, nm in enumerate(names):
        f = hz(nm)
        h = 6 if f > 400 else 9
        v = additive(f, n, h, 1.7, -5) + additive(f, n, h, 1.7, +5)
        v *= 1 / np.sqrt(len(names))
        pan = (i / max(1, len(names) - 1) - 0.5) * 2 * width
        p = (pan + 1) * np.pi / 4
        L += v * np.cos(p)
        R += v * np.sin(p)
    lfo = 1 + 0.08 * np.sin(2 * np.pi * 0.17 * tvec(n) + RNG.uniform(0, 6))
    st = np.vstack([lp(L, bright), lp(R, bright)]) * env * lfo * 0.5
    place(st, start, db(gain_db), send=send)


def pluck(name, start, gain_db=-24, dur=1.8, pan=0.0, bright=1.0, send=0.35):
    gain_db += 2
    f = hz(name) if isinstance(name, str) else name
    n = int(dur * SR)
    t = tvec(n)
    out = np.zeros(n)
    for k in range(1, 8):
        if f * k > 12000:
            break
        decay = 2.2 + k * 1.6 / bright
        out += np.sin(2 * np.pi * f * k * t + RNG.uniform(0, 6)) * np.exp(-t * decay) / k ** 1.3
    out *= np.clip(t / 0.004, 0, 1)
    place(out * 0.6, start, db(gain_db), pan, send)


def bell(name, start, gain_db=-22, dur=5.0, pan=0.0, send=0.55):
    f = hz(name) if isinstance(name, str) else name
    n = int(dur * SR)
    t = tvec(n)
    ratios = [1.0, 2.0, 2.76, 4.07, 5.4, 8.93]
    amps = [1.0, 0.45, 0.35, 0.2, 0.14, 0.06]
    rates = [0.7, 1.0, 1.5, 2.2, 3.0, 4.5]
    out = np.zeros(n)
    for r, a, d in zip(ratios, amps, rates):
        if f * r > 15000:
            continue
        out += a * np.sin(2 * np.pi * f * r * t + RNG.uniform(0, 6)) * np.exp(-t * d)
    out *= np.clip(t / 0.002, 0, 1)
    place(out * 0.5, start, db(gain_db), pan, send)


def kick(start, gain_db=-12, pan=0.0, send=0.1, tight=1.0):
    n = int(0.6 * SR)
    t = tvec(n)
    f = 44 + 110 * np.exp(-t * 32 * tight)
    ph = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(ph) * np.exp(-t * 6.5 * tight)
    click = hp(RNG.standard_normal(n), 2500) * np.exp(-t * 300) * 0.25
    out = np.tanh((out + click) * 1.4)
    place(out, start, db(gain_db), pan, send)


def taiko(start, gain_db=-12, pitch=1.0, pan=0.0, send=0.3):
    n = int(1.4 * SR)
    t = tvec(n)
    f = 52 * pitch + 75 * pitch * np.exp(-t * 16)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 4.2)
    skin = lp(RNG.standard_normal(n), 1100) * np.exp(-t * 22) * 0.7
    out = np.tanh((body + skin) * 1.5)
    place(out, start, db(gain_db), pan, send)


def snare(start, gain_db=-20, pan=0.0, send=0.3):
    n = int(0.5 * SR)
    t = tvec(n)
    noise = bp(RNG.standard_normal(n), 900, 7000) * np.exp(-t * 16)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.6
    place((noise + tone) * 0.7, start, db(gain_db), pan, send)


def hat(start, gain_db=-30, pan=0.0, open_=False):
    n = int((0.35 if open_ else 0.09) * SR)
    t = tvec(n)
    out = hp(RNG.standard_normal(n), 7000) * np.exp(-t * (14 if open_ else 70))
    place(out * 0.5, start, db(gain_db), pan, 0.1)


def sub_boom(start, gain_db=-6, dur=3.5, f_hi=95, f_lo=27, speed=2.0):
    n = int(dur * SR)
    t = tvec(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t * speed)
    ph = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(ph) * np.exp(-t * (1.6 / dur) * 2.2) * np.clip(t / 0.004, 0, 1)
    out = np.tanh(out * 1.6) / np.tanh(1.6)
    place(out, start, db(gain_db), 0.0, 0.05)


def noise_hit(start, gain_db=-10, dur=4.0, f0=9000, f1=180, send=0.7):
    n = int(dur * SR)
    t = tvec(n)
    x = RNG.standard_normal((2, n))
    out = np.vstack([sweep_filter(x[0], f0, f1), sweep_filter(x[1], f0 * 0.9, f1)])
    out *= np.exp(-t * (3.0 / dur)) * np.clip(t / 0.003, 0, 1)
    place(out * 0.35, start, db(gain_db), send=send)


def impact(start, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    sub_boom(start, -7 + g, dur=3.2)
    noise_hit(start, -15 + g, dur=3.0, f0=7000, f1=150)
    taiko(start, -10 + g, pitch=0.8)
    hat(start, -26 + g, open_=True)


def bang(start, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    sub_boom(start, -3 + g, dur=6.0, f_hi=110, f_lo=24, speed=1.2)
    noise_hit(start, -9 + g, dur=7.0, f0=12000, f1=90, send=0.9)
    taiko(start, -7 + g, pitch=0.7)
    taiko(start + 0.01, -9 + g, pitch=1.3, pan=0.3)
    # Crackle: sparse distorted bursts in the tail.
    n = int(3.0 * SR)
    t = tvec(n)
    cr = (RNG.random(n) < 0.004) * RNG.standard_normal(n) * 3
    cr = lp(cr, 5000) * np.exp(-t * 1.2)
    place(np.vstack([cr, np.roll(cr, 300)]) * 0.5, start + 0.05, db(-20 + g), send=0.6)


def riser(start, dur, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    k = t / dur
    x = RNG.standard_normal((2, n))
    nz = np.vstack([sweep_filter(x[0], 250, 9000, "low", curve=1.6), sweep_filter(x[1], 260, 9500, "low", curve=1.6)])
    nz = np.vstack([hp(nz[0], 120), hp(nz[1], 120)])
    amp = k ** 2.4 * np.clip((dur - t) / 0.01, 0, 1)
    out = nz * amp * 0.5
    # Rising tone cluster.
    for base, pan in ((hz("D3"), -0.4), (hz("A3"), 0.4), (hz("D4"), 0.0)):
        f = base * 2 ** (2.0 * k ** 1.5)
        ph = 2 * np.pi * np.cumsum(f) / SR
        trem = 1 + 0.5 * np.sin(2 * np.pi * (4 + 18 * k ** 2) * t)
        tone = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * amp * trem * 0.12
        p = (pan + 1) * np.pi / 4
        out[0] += tone * np.cos(p)
        out[1] += tone * np.sin(p)
    place(out, start, db(-12 + g), send=0.35)


def whoosh(start, strength=1.0, dur=1.5):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    k = t / dur
    x = RNG.standard_normal(n)
    y = sweep_filter(x, 500, 5000, "low") * np.sin(np.pi * k) ** 2
    pan = np.clip(-1 + 2 * k, -1, 1)
    p = (pan + 1) * np.pi / 4
    place(np.vstack([y * np.cos(p), y * np.sin(p)]) * 0.5, start - dur * 0.5, db(-16 + g), send=0.4)


def reverse_swell(start, dur, strength=1.0, chord="Dm"):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    k = t / dur
    nz = hp(RNG.standard_normal((2, n)), 2500)
    amp = k ** 3.5 * np.clip((dur - t) / 0.01, 0, 1)
    out = nz * amp * 0.25
    # A reversed bell-pad chord.
    tone = np.zeros(n)
    for nm in CHORDS[chord][2:]:
        f = hz(nm) * 2
        tone += np.sin(2 * np.pi * f * t) * np.exp(-(dur - t) * 1.2)
    out += np.vstack([tone, tone]) * amp * 0.08
    place(out, start, db(-12 + g), send=0.3)


def shepard(start, dur, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    period = 3.0
    out = np.zeros(n)
    for k in range(8):
        pos = (k + t / period) % 8
        f = 30 * 2 ** pos
        ph = 2 * np.pi * np.cumsum(f) / SR
        amp = np.exp(-0.5 * ((pos - 4.2) / 1.25) ** 2)
        out += np.sin(ph) * amp
    out *= (t / dur) ** 1.4 * np.clip((dur - t) / 0.02, 0, 1) * 0.18
    place(np.vstack([out, np.roll(out, 240)]), start, db(-10 + g), send=0.3)


def heartbeat(start, length, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    t = 0.3
    times = []
    while t < length:
        times.append(t)
        t += 0.95 * (0.22 / 0.95) ** (t / length)
    for i, bt in enumerate(times):
        k = bt / length
        kick(start + bt, -14 + g + 8 * k, tight=0.8)
        kick(start + bt + 0.16 * (1 - 0.5 * k), -20 + g + 8 * k, tight=1.0)


def ticks(start, dur, rate0, rate1, gain_db=-28):
    t = 0.0
    while t < dur:
        k = t / dur
        n = int(0.012 * SR)
        x = hp(RNG.standard_normal(n), 3500) * np.exp(-tvec(n) * 400)
        place(x, start + t, db(gain_db + 8 * k), pan=RNG.uniform(-0.5, 0.5), send=0.2)
        t += 1.0 / (rate0 * (rate1 / rate0) ** k)


def suck(start, strength=1.0, dur=1.6):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    k = t / dur
    x = RNG.standard_normal((2, n))
    y = np.vstack([sweep_filter(x[0], 200, 12000, "low", curve=2.0), sweep_filter(x[1], 200, 12000, "low", curve=2.0)])
    y *= np.exp((k - 1) * 5) * np.clip((dur - t) / 0.005, 0, 1)
    place(y * 0.5, start - dur, db(-8 + g), send=0.05)


def tone(start, dur, strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    n = int(dur * SR)
    t = tvec(n)
    vib = 0.004 * np.sin(2 * np.pi * 5.5 * t)
    out = (np.sin(2 * np.pi * hz("A5") * t * (1 + vib)) + 0.5 * np.sin(2 * np.pi * hz("D6") * t)) * env_ar(n, 1.0, 1.0)
    place(out * 0.2, start, db(-14 + g), send=0.6)


def braam(start, dur, chord="Dm", strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    names = CHORDS[chord][:4]
    n = int(dur * SR)
    t = tvec(n)
    L = np.zeros(n)
    R = np.zeros(n)
    for i, nm in enumerate(names):
        f = hz(nm)
        if f > 220:
            f /= 2
        for det, side in ((-9, 0), (0, 2), (9, 1)):
            v = additive(f, n, 28, 1.0, det)
            if side == 0:
                L += v
            elif side == 1:
                R += v
            else:
                L += v * 0.7
                R += v * 0.7
    # Filter blooms open then settles.
    out = []
    for ch in (L, R):
        a = sweep_filter(ch, 3200, 420, "low", curve=0.35)
        out.append(a)
    out = np.vstack(out)
    env = np.clip(t / 0.05, 0, 1) * (0.55 + 0.45 * np.exp(-t * 1.4)) * np.clip((dur - t) / (dur * 0.45), 0, 1) ** 1.5
    out = np.tanh(out * env * 0.12) * 1.0
    place(out, start, db(-9 + g), send=0.5)


def bloom(start, dur, chord="Fadd9", strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    pad(None, start, dur, -16 + g, attack=1.4, release=3.0, bright=5200, notes=CHORDS[chord], send=0.7, width=0.9)
    # Shimmer an octave up.
    upper = [nm[:-1] + str(int(nm[-1]) + 1) for nm in CHORDS[chord][3:]]
    pad(None, start + 0.3, dur, -26 + g, attack=2.0, release=3.0, bright=9000, notes=upper, send=0.8, width=1.0)
    for i, nm in enumerate(upper):
        bell(nm, start + 0.08 * i, -24 + g, pan=(i % 2) * 0.8 - 0.4)


def sparkles(start, dur, density=3.0, gain_db=-30, seed=1):
    rng = np.random.default_rng(seed)
    scale = ["D6", "F6", "G6", "A6", "C7", "D7", "A5", "F5"]
    t = 0.0
    while t < dur:
        bell(scale[rng.integers(len(scale))], start + t, gain_db + rng.uniform(-6, 0), dur=2.5, pan=rng.uniform(-0.9, 0.9), send=0.6)
        t += rng.exponential(1.0 / density)


def sub_bass(name, start, dur, gain_db=-22):
    gain_db -= 2
    f = hz(name)
    n = int(dur * SR)
    t = tvec(n)
    out = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * env_ar(n, 0.08, 0.3)
    place(out, start, db(gain_db), send=0.05)


def ostinato(chords, start, bars, gain_db=-24, sixteenth=True, bright=1800, octave_up=True):
    step = BEAT / (4 if sixteenth else 2)
    for b in range(bars):
        ch = chords[b % len(chords)]
        root = ROOTS[ch]
        nm = root[:-1] + str(int(root[-1]) + (2 if octave_up else 1))
        f = hz(nm)
        for s in range(int(BAR / step)):
            n = int(step * 1.6 * SR)
            t = tvec(n)
            v = additive(f, n, 14, 1.0, RNG.uniform(-4, 4)) * np.exp(-t * 14) * np.clip(t / 0.003, 0, 1)
            v = lp(v, bright)
            acc = 1.0 if s % 4 == 0 else 0.62
            place(v * 0.4 * acc, start + b * BAR + s * step, db(gain_db), pan=0.25 if s % 2 else -0.25, send=0.2)


def arp(chords, start, bars, gain_db=-26, sixteenth=False, bright=1.0):
    step = BEAT / (4 if sixteenth else 2)
    per = int(BAR / step)
    for b in range(bars):
        notes = ARP[chords[b % len(chords)]]
        for s in range(per):
            nm = notes[s % len(notes)]
            pluck(nm, start + b * BAR + s * step, gain_db + (0 if s % 4 == 0 else -3), dur=1.6, pan=0.5 if s % 2 else -0.5, bright=bright)


def chord_pads(chords, start, bars, gain_db=-27, bright=1800, bar_len=BAR):
    for b in range(bars):
        pad(chords[b % len(chords)], start + b * bar_len, bar_len, gain_db, attack=0.8, release=1.6, bright=bright * 1.4)


def drum_pattern(start, bars, style="web", strength=1.0):
    g = 20 * np.log10(max(strength, 0.05))
    for b in range(bars):
        t0 = start + b * BAR
        prog = b / max(1, bars - 1)
        if style == "web":
            kick(t0, -13 + g)
            kick(t0 + 2 * BEAT, -14 + g)
            if b % 2 == 1:
                taiko(t0 + 3 * BEAT, -14 + g, 1.0, -0.3)
                taiko(t0 + 3.5 * BEAT, -15 + g, 1.2, 0.3)
            if b >= 2:
                snare(t0 + BEAT, -22 + g)
                snare(t0 + 3 * BEAT, -22 + g)
            for e in range(8):
                hat(t0 + e * BEAT / 2, -32 + g + (3 if e % 2 == 0 else 0), pan=0.3)
        else:  # "epic": an escalating build for the observable-universe zoom
            taiko(t0, -11 + g + 4 * prog, 0.75)
            taiko(t0 + 2 * BEAT, -13 + g + 4 * prog, 0.8)
            if b >= 2:
                for e in (6, 7):
                    taiko(t0 + e * BEAT / 2, -18 + g + 4 * prog, 1.25, pan=0.4 if e == 6 else -0.4)
            if b >= 4:
                snare(t0 + BEAT, -20 + g + 3 * prog)
                snare(t0 + 3 * BEAT, -20 + g + 3 * prog)
                for e in range(8):
                    hat(t0 + e * BEAT / 2, -30 + g, pan=-0.3)
            if b >= 6:
                for e in range(4):
                    taiko(t0 + e * BEAT, -14 + g + 4 * prog, 0.9)
                for e in range(16):
                    hat(t0 + e * BEAT / 4, -34 + g + 4 * prog, pan=0.3)


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------
def compose():
    S = START

    # 1. Hook ---------------------------------------------------------------
    h = S["hook"]
    pad(None, h + 0.2, 15.0, -24, attack=4.0, release=1.5, bright=400, notes=["D1", "D2", "A2"], send=0.3)
    pad("Dm", h + 0.6, 9.8, -27, attack=3.5, release=0.25, bright=1500)
    pad(None, h + 5.0, 5.4, -30, attack=4.0, release=0.2, bright=4000, notes=["A4", "D5", "E5", "A5"], send=0.7)
    pad(None, h + 10.6, 5.0, -29, attack=1.0, release=2.4, bright=6000, notes=["A4", "D5", "F5", "A5", "E6"], send=0.8, width=1.0)

    # 2. Hubble — curiosity -----------------------------------------------------
    hb = S["hubble"]
    prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "A", "Dm", "Bb", "F"]
    chord_pads(prog, hb, 11, -28, bright=1700)
    arp(prog, hb + 0.0, 11, -28)
    for i, ch in enumerate(prog):
        sub_bass(ROOTS[ch], hb + i * BAR, BAR, -24)

    # 3. Space — momentum -------------------------------------------------------
    sp = S["space"]
    prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "F", "C", "Gm"]
    chord_pads(prog, sp, 9, -27, bright=2000)
    arp(prog[:2], sp, 2, -28)
    arp(prog[2:], sp + 2 * BAR, 6, -29, sixteenth=True)
    for b in range(2, 8):
        kick(sp + b * BAR, -18)
        kick(sp + b * BAR + 2 * BEAT, -19)
    for i, ch in enumerate(prog):
        sub_bass(ROOTS[ch], sp + i * BAR, BAR, -24)

    # 4. Rewind — tension ------------------------------------------------------
    rw = S["rewind"]
    pad(None, rw, 13.6, -26, attack=6.0, release=0.2, bright=900, notes=["D2", "Eb2", "A2", "D3"], send=0.3)
    ticks(rw + 0.4, 13.2, 3.0, 22.0, -30)

    # 5. Big Bang & inflation ---------------------------------------------------
    bb = S["bigbang"]
    ticks(bb + 10.0, 7.6, 4.0, 30.0, -28)
    pad(None, bb + 10.0, 7.6, -27, attack=5.0, release=0.15, bright=3000, notes=["D3", "A3", "D4", "E4", "A4"], send=0.4)
    prog = ["Bb", "F", "Gm", "Dm"]
    for i, ch in enumerate(prog):
        pad(ch, bb + 18.2 + i * 2.5, 2.5, -27, attack=1.0, release=2.0, bright=2200)
    sparkles(bb + 22.3, 5.5, density=4.0, gain_db=-32, seed=3)

    # 6. CMB — first light ------------------------------------------------------
    cm = S["cmb"]
    pad("Dm", cm, 12.0, -27, attack=2.0, release=0.4, bright=650)
    for i in range(6):
        sub_bass("D1", cm + i * 2.0, 1.6, -22)
    prog = ["F", "C", "Dm", "Bb"]
    for i, ch in enumerate(prog):
        pad(ch, cm + 16.0 + i * 2.5, 2.5, -28, attack=1.2, release=2.0, bright=2400)
    for i, nm in enumerate(["A4", "C5", "F5", "E5", "D5", "C5", "A4", "F4"]):
        pluck(nm, cm + 16.2 + i * 1.2, -27, dur=2.4, pan=0.4 if i % 2 else -0.4)

    # 7. First stars & the cosmic web --------------------------------------------
    wb = S["web"]
    pad(None, wb, 12.0, -25, attack=3.0, release=1.0, bright=500, notes=["D1", "A1", "D2"], send=0.3)
    ign = [4.6 + 4.4 * (k / 44) ** 0.62 for k in range(44)]
    scale = ["D5", "F5", "G5", "A5", "C6", "D6", "F6", "G6", "A6", "C7", "D7", "A6", "F6", "D6", "C6", "A5"]
    for k, ti in enumerate(ign):
        if k < 16:
            bell(scale[k], wb + ti, -22 - k * 0.3, pan=((k * 0.37) % 1.6) - 0.8)
        elif k % 3 == 0:
            bell(scale[k % len(scale)], wb + ti, -34, dur=2.0, pan=((k * 0.53) % 1.6) - 0.8)
    pad("Dm", wb + 4.3, 7.7, -29, attack=3.0, release=1.0, bright=3000)
    prog = ["Dm", "Bb", "F", "C", "Dm"]
    chord_pads(prog, wb + 12.0, 5, -26, bright=2400)
    ostinato(prog, wb + 12.0, 5, -25, bright=2000)
    for i, ch in enumerate(prog):
        sub_bass(ROOTS[ch], wb + 12.0 + i * BAR, BAR, -22)

    # 8. Dark energy -----------------------------------------------------------
    de = S["darkenergy"]
    pad("Gm", de, 8.4, -28, attack=2.0, release=0.3, bright=900)
    bell("D6", de + 1.5, -18, dur=6.0)
    bell("A6", de + 1.52, -22, dur=6.0, pan=0.3)
    prog = ["Gm", "Eb", "Bb", "F", "Gm"]
    chord_pads(prog, de + 12.0, 5, -27, bright=1400)
    ostinato(prog, de + 12.0, 5, -27, sixteenth=False, bright=900, octave_up=False)
    for b in range(5):
        kick(de + 12.0 + b * BAR, -17)
        kick(de + 12.0 + b * BAR + 2 * BEAT, -18)
    bell("F6", de + 20.1, -20, dur=4.0)

    # 9. The observable universe — the build ----------------------------------------
    ob = S["observable"]
    pad("Dm", ob, 3.6, -27, attack=1.0, release=0.6, bright=1600)
    pluck("D5", ob + 0.4, -24, dur=3.0)
    pluck("A5", ob + 1.6, -25, dur=3.0)
    bars = 9  # 3.5 s → ~24.3 s at 100 BPM
    prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "A", "A"]
    chord_pads(prog, ob + 3.5, bars, -26, bright=2600)
    ostinato(prog, ob + 3.5, bars, -24, bright=2600)
    for i, ch in enumerate(prog):
        sub_bass(ROOTS[ch], ob + 3.5 + i * BAR, BAR, -21)
    prog2 = ["F", "C", "Dm", "Bb"]
    for i, ch in enumerate(prog2):
        pad(ch, ob + 24.3 + i * 1.9, 1.9 if i < 3 else 3.0, -22, attack=0.5, release=2.0, bright=3800)
    sparkles(ob + 24.5, 7.0, density=5.0, gain_db=-30, seed=5)

    # 10. Finale --------------------------------------------------------------
    fn = S["finale"]
    pad("Bbmaj7", fn, 6.0, -28, attack=2.0, release=1.5, bright=1600)
    pad("Dsus2", fn + 6.0, 6.3, -28, attack=1.5, release=2.0, bright=1600)
    for i, nm in enumerate(["D5", "A4", "E5", "F5", "D5", "A4"]):
        pluck(nm, fn + 0.8 + i * 1.8, -28, dur=2.6, pan=0.4 if i % 2 else -0.4)
    pad(None, fn + 12.3, 4.6, -27, attack=1.5, release=1.0, bright=500, notes=["D1", "D2"], send=0.3)
    for i, nm in enumerate(["D5", "A4", "F4"]):
        bell(nm, fn + 12.6 + i * 1.5, -24, dur=4.5)
    heartbeat(fn + 16.8, 3.6, 0.7)
    pad("Dadd9", fn + 26.0, 5.6, -26, attack=0.5, release=3.0, bright=2400)
    bell("D6", fn + 26.6, -22, dur=6.0)
    bell("A5", fn + 26.62, -26, dur=6.0, pan=0.4)

    # Cue-driven hits ------------------------------------------------------------
    for c in TL["cues"]:
        t0 = S[c["scene"]] + c["t"]
        st = c.get("strength", 1.0)
        kind = c["type"]
        if kind == "impact":
            impact(t0, st)
        elif kind == "bang":
            bang(t0, st)
        elif kind == "riser":
            riser(t0, c["len"], st)
        elif kind == "braam":
            braam(t0, c["len"], c.get("chord", "Dm"), st)
        elif kind == "bloom":
            bloom(t0, c["len"], c.get("chord", "Fadd9"), st)
        elif kind == "whoosh":
            whoosh(t0, st)
        elif kind == "reverse":
            reverse_swell(t0, c["len"], st)
        elif kind == "heartbeat":
            heartbeat(t0, c["len"], st)
        elif kind == "shepard":
            shepard(t0, c["len"], st)
        elif kind == "suck":
            suck(t0, st)
        elif kind == "tone":
            tone(t0, c["len"], st)
        elif kind == "swell":
            pass  # handled by the hook pad layers
        elif kind == "ignitions":
            pass  # handled in the web scene (bells on each ignition)
        elif kind == "drums":
            bars = int(round(c["len"] / BAR))
            drum_pattern(t0, bars, "web" if c["scene"] == "web" else "epic", st)
        elif kind == "supernova":
            noise_hit(t0, -14, dur=3.0, f0=12000, f1=600)
            sub_boom(t0, -12, dur=2.0)
        else:
            print(f"unknown cue {kind}", file=sys.stderr)


def make_ir(seconds=3.6, predelay=0.025):
    n = int(seconds * SR)
    t = tvec(n)
    dec = np.exp(-6.9 * t / seconds)
    ir = RNG.standard_normal((2, n)) * dec
    ir = np.vstack([lp(ir[0], 5500), lp(ir[1], 5200)])
    # Smear the onset so the tail blooms rather than clicks.
    ir *= np.clip(t / 0.06, 0, 1)
    ir = np.hstack([np.zeros((2, int(predelay * SR))), ir])
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    return ir


def master(mix):
    # Gentle bus compression (block-based envelope follower), then a soft limiter.
    mix = mix / (np.max(np.abs(mix)) + 1e-9)
    block = 256
    nb = mix.shape[1] // block
    peak = np.abs(mix[:, : nb * block]).reshape(2, nb, block).max(axis=(0, 2))
    thr = 0.3
    ratio = 4.0
    gains = np.ones(nb)
    g = 1.0
    att = np.exp(-block / (0.005 * SR))
    rel = np.exp(-block / (0.35 * SR))
    for i in range(nb):
        target = 1.0 if peak[i] <= thr else (thr / peak[i]) ** (1 - 1 / ratio)
        coef = att if target < g else rel
        g = coef * g + (1 - coef) * target
        gains[i] = g
    gs = np.repeat(gains, block)
    gs = np.concatenate([gs, np.full(mix.shape[1] - len(gs), gains[-1])])
    out = mix * gs
    out /= np.max(np.abs(out)) + 1e-9
    out *= 1.5
    out = np.tanh(out) / np.tanh(1.5)
    return out * db(-1.0)


def main():
    compose()
    print("convolving reverb…", flush=True)
    ir = make_ir()
    wet = np.vstack([fftconvolve(WET[0], ir[0])[:N], fftconvolve(WET[1], ir[1])[:N]])
    mix = DRY.astype(np.float64) + wet * 0.9
    mix = hp(mix, 22)
    # Tilt EQ for small speakers: tame the sub region, add a little air.
    mix = mix - 0.32 * lp(mix, 110) + 0.22 * hp(mix, 4500)
    mix = master(mix)
    mix = mix[:, : int(TOTAL * SR)]
    # Fade the very end.
    tail = int(0.8 * SR)
    mix[:, -tail:] *= np.linspace(1, 0, tail) ** 2
    rms = np.sqrt(np.mean(mix ** 2))
    print(f"duration {mix.shape[1] / SR:.2f}s  peak {np.max(np.abs(mix)):.3f}  rms {20 * np.log10(rms):.1f} dBFS")
    out_dir = ROOT / "public" / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").T.copy()
    wav = out_dir / "soundtrack.wav"
    import wave

    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    mp3 = out_dir / "soundtrack.mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "224k", str(mp3)], check=True)
    if "--wav" not in sys.argv:
        wav.unlink()
    print(f"wrote {mp3}")


if __name__ == "__main__":
    main()
