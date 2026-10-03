#!/usr/bin/env python3
"""Lay the 贾老师 narration (voiceover/narration.mp3, one take of voiceover/script.txt
from 冬瓜配音, plus separately recorded INSERTS) over the music (public/audio/music.mp3) -> public/audio/soundtrack.mp3.

- The take is split into sentences at the ≥0.7 s pauses (one sentence per script line).
- Each sentence is placed at its caption's start (TARGETS below), never more than
  EARLY s before it and at least GAP s after the previous one.
- A scene whose sentences would run late or past the scene end is sped up a little
  (atempo, ≤ MAX_TEMPO); scene durations and music cues are untouched.
- Music ducks DUCK_DB under the voice; the mix is normalised to -16 LUFS.
- Writes voiceover/timing.json (per sentence: scene, local start/end) for the captions.
"""
import json
import os
import pathlib
import re
import subprocess
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
EARLY, GAP, MAX_TEMPO, MAX_LATE = 0.4, 0.25, 1.15, 1.2
DUCK_DB = -7.0
# Lines recorded separately (script line index -> file); they are not in narration.mp3.
INSERTS = {9: "voiceover/insert-space.mp3"}
TL = json.loads((ROOT / "src" / "timeline.json").read_text(encoding="utf-8"))

_bundled = ROOT / "node_modules" / "@remotion" / "compositor-win32-x64-msvc" / "ffmpeg.exe"
FFMPEG = os.environ.get("FFMPEG") or (str(_bundled) if _bundled.exists() else "ffmpeg")

# Scene start/end in seconds.
START, END, t = {}, {}, 0.0
for s in TL["scenes"]:
    START[s["id"]] = t
    t += s["duration"]
    END[s["id"]] = t
TOTAL = t

# One entry per script line: (scene, scene-local time the line should start).
# Caption lines start with their caption; the extra lines read on-screen statements.
TARGETS = [
    ("hook", 0.8), ("hook", 4.9), ("hook", 8.7),
    ("hubble", 0.6), ("hubble", 4.8), ("hubble", 9.0), ("hubble", 13.5), ("hubble", 17.8),
    ("space", 0.5), ("space", 4.3), ("space", 8.4), ("space", 12.6), ("space", 16.9), ("space", 20.3),
    ("rewind", 0.4), ("rewind", 3.7), ("rewind", 7.5), ("rewind", 11.0),
    ("bigbang", 6.0), ("bigbang", 10.0), ("bigbang", 14.0), ("bigbang", 18.0), ("bigbang", 22.3),
    ("cmb", 0.5), ("cmb", 4.7), ("cmb", 8.7), ("cmb", 12.2), ("cmb", 16.0), ("cmb", 20.3),
    ("web", 0.5), ("web", 4.3), ("web", 8.6), ("web", 12.3), ("web", 20.3),
    ("darkenergy", 0.5), ("darkenergy", 4.5), ("darkenergy", 8.5), ("darkenergy", 12.1),
    ("darkenergy", 16.1), ("darkenergy", 20.1),
    ("observable", 0.5), ("observable", 9.6), ("observable", 14.0), ("observable", 18.0),
    ("observable", 21.7), ("observable", 28.3),
    ("finale", 0.5), ("finale", 4.6), ("finale", 8.5), ("finale", 12.3), ("finale", 16.7),
    ("finale", 20.45), ("finale", 26.6),
]


def read_wav_bytes(raw, channels):
    # (The bundled ffmpeg has no raw-PCM muxer, so audio is piped as 16-bit WAV.)
    import io
    import wave
    with wave.open(io.BytesIO(raw)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    return x.reshape(-1, channels).T.copy()


def decode(path, channels):
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(path), "-f", "wav", "-c:a", "pcm_s16le", "-ac", str(channels), "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return read_wav_bytes(raw, channels)


def tempo(x, f):
    if abs(f - 1) < 1e-3:
        return x
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-i", "-",
         "-af", f"atempo={f:.4f}", "-f", "wav", "-c:a", "pcm_s16le", "-"],
        input=x.astype("<f4").tobytes(), capture_output=True, check=True,
    ).stdout
    return read_wav_bytes(raw, 1)[0]


def sentences(voice):
    """Split at pauses ≥0.7 s (sentence ends; commas pause ~0.25 s)."""
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(ROOT / "voiceover" / "narration.mp3"),
         "-af", "silencedetect=noise=-38dB:d=0.2", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stderr
    sil, st = [], None
    for line in out.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m:
            st = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", line)
        if m:
            sil.append((st, float(m.group(1)), float(m.group(2))))
    dur = voice.shape[-1] / SR
    cur = sil[0][1] if sil and sil[0][0] < 0.01 else 0.0
    segs = []
    for a, b, d in sil:
        if d > 0.7 and a > cur:
            segs.append((cur, a))
            cur = b
    if cur < dur - 0.05:
        segs.append((cur, dur))
    pad = int(0.04 * SR)  # keep consonant onsets / tails
    return [voice[max(0, int(a * SR) - pad): int(b * SR) + pad] for a, b in segs]


def place(clips):
    """Per scene, the smallest tempo that keeps every line on time and inside the scene."""
    plan, prev_end = [], -1.0
    for sc in START:
        idx = [k for k, (s, _) in enumerate(TARGETS) if s == sc]
        for f in np.arange(1.0, MAX_TEMPO + 1e-6, 0.01):
            pe, rows, ok = prev_end, [], True
            for k in idx:
                d = len(clips[k]) / SR / f
                want = START[sc] + TARGETS[k][1]
                s = max(want - EARLY, pe + GAP)
                pe = s + d
                rows.append((k, s, pe, f))
                ok &= s - want <= MAX_LATE
            ok &= pe <= END[sc] - 0.3
            if ok:
                break
        plan += rows
        prev_end = pe
    return plan


def main():
    lines = [l for l in (ROOT / "voiceover" / "script.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
    voice = decode(ROOT / "voiceover" / "narration.mp3", 1)[0]
    clips = sentences(voice)
    for k in sorted(INSERTS):
        x = decode(ROOT / INSERTS[k], 1)[0]
        on = np.flatnonzero(np.abs(x) > 10 ** (-38 / 20))
        pad = int(0.04 * SR)
        clips.insert(k, x[max(0, on[0] - pad): on[-1] + pad])
    if not (len(clips) == len(lines) == len(TARGETS)):
        sys.exit(f"sentence count mismatch: audio {len(clips)}, script {len(lines)}, targets {len(TARGETS)}")
    plan = place(clips)

    n = int(TOTAL * SR)
    vo = np.zeros(n, dtype=np.float64)
    timing = []
    for k, s, e, f in plan:
        c = tempo(clips[k], f)
        a = int(s * SR)
        c = c[: max(0, n - a)]
        vo[a: a + len(c)] += c
        sc = TARGETS[k][0]
        timing.append({"line": k, "scene": sc, "text": lines[k], "tempo": round(float(f), 2),
                       "start": round(s - START[sc], 2), "end": round(e - START[sc], 2),
                       "late": round(s - START[sc] - TARGETS[k][1], 2)})
    music = decode(ROOT / "public" / "audio" / "music.mp3", 2)
    music = np.pad(music, ((0, 0), (0, max(0, n - music.shape[1]))))[:, :n].astype(np.float64)

    # Ducking envelope: 1 where the voice speaks, smoothed (attack 0.12 s, release 0.6 s).
    active = np.zeros(n)
    for k, s, e, f in plan:
        active[int(s * SR): int(e * SR)] = 1.0
    block = 480
    nb = n // block + 1
    env_b = np.array([active[i * block:(i + 1) * block].max() if i * block < n else 0 for i in range(nb)])
    g, out_b = 0.0, np.empty(nb)
    att = np.exp(-block / (0.12 * SR))
    rel = np.exp(-block / (0.6 * SR))
    for i in range(nb):
        coef = att if env_b[i] > g else rel
        g = coef * g + (1 - coef) * env_b[i]
        out_b[i] = g
    duck = 10 ** (DUCK_DB * np.repeat(out_b, block)[:n] / 20)

    # Voice level relative to music, then loudness-normalise the sum.
    vrms = np.sqrt(np.mean(vo[active > 0] ** 2)) + 1e-9
    mrms = np.sqrt(np.mean(music ** 2)) + 1e-9
    vo *= (mrms * 10 ** (6 / 20)) / vrms  # voice ~6 dB above the (unducked) music bed
    mix = music * duck + vo[None, :]

    tmp = ROOT / "public" / "audio" / "_mix.wav"
    write_wav(tmp, mix / (np.max(np.abs(mix)) + 1e-9) * 0.7)
    stats = subprocess.run([FFMPEG, "-hide_banner", "-i", str(tmp), "-af",
                            "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    meas = float(re.search(r'"input_i" : "(-?[\d.]+)"', stats).group(1))
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.7 * 10 ** ((-16 - meas) / 20)
    peak = np.max(np.abs(mix))
    if peak > 10 ** (-1 / 20):  # soft-limit the rare peaks
        mix = np.tanh(mix / 10 ** (-1 / 20)) * 10 ** (-1 / 20)
    write_wav(tmp, mix)
    mp3 = ROOT / "public" / "audio" / "soundtrack.mp3"
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(tmp), "-c:a", "libmp3lame", "-b:a", "224k", str(mp3)], check=True)
    tmp.unlink()
    (ROOT / "voiceover" / "timing.json").write_text(json.dumps(timing, ensure_ascii=False, indent=1), encoding="utf-8")
    for row in timing:
        print(f"{row['scene']:10s} {row['start']:6.2f}-{row['end']:6.2f} tempo {row['tempo']:.2f} late {row['late']:+.2f}  {row['text'][:18]}")
    print(f"wrote {mp3}")


def write_wav(path, x):
    import wave
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").T.copy()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
