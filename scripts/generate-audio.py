#!/usr/bin/env python3
"""Generate short mono WAV tokens for the dichotic listening engine.

Uses macOS `say` so the tokens are actual spoken English (the ASTB DLT is
speech, not beeps). Each file is trimmed, peak-normalized, and padded to a
fixed length so left/right streams can start on the same sample.
"""
from __future__ import annotations

import array
import math
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio"
RATE = 22050
PAD_S = 0.42
PEAK = 0.9

DIGITS = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}

# Spoken letter names, not NATO alphabet — matches published DLT descriptions.
LETTERS = {
    "A": "A",
    "B": "B",
    "C": "C",
    "D": "D",
    "E": "E",
    "F": "F",
    "G": "G",
    "H": "H",
    "J": "J",
    "K": "K",
    "L": "L",
    "M": "M",
    "N": "N",
    "P": "P",
    "R": "R",
    "S": "S",
    "T": "T",
    "W": "W",
    "X": "X",
    "Y": "Y",
    "Z": "Z",
}

PHRASES = {
    "attend-left": "Attend to the left ear.",
    "attend-right": "Attend to the right ear.",
    "engine-fire": "Engine fire.",
    "hyd-fail": "Hydraulic failure.",
    "elec-fail": "Electrical failure.",
    "cabin-press": "Cabin pressure.",
    "engine-fail": "Engine failure.",
    "fuel-leak": "Fuel leak.",
}


def run_say(text: str, dest: Path, rate: int = 190) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "say",
        "-v",
        "Samantha",
        "-r",
        str(rate),
        "--data-format=LEI16@22050",
        "-o",
        str(dest),
        text,
    ]
    subprocess.run(cmd, check=True)


def read_wav(path: Path) -> tuple[int, list[float]]:
    with wave.open(str(path), "rb") as w:
        assert w.getsampwidth() == 2
        rate = w.getframerate()
        nch = w.getnchannels()
        frames = array.array("h")
        frames.frombytes(w.readframes(w.getnframes()))
    samples = [s / 32768.0 for s in frames]
    if nch == 2:
        samples = [(samples[i] + samples[i + 1]) / 2 for i in range(0, len(samples), 2)]
    return rate, samples


def write_wav(path: Path, rate: int, samples: list[float]) -> None:
    clipped = [max(-1.0, min(1.0, s)) for s in samples]
    frames = array.array("h", [int(s * 32767) for s in clipped])
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames.tobytes())


def trim_pad(samples: list[float], rate: int, pad_s: float) -> list[float]:
    thresh = 0.02
    start = 0
    end = len(samples)
    for i, s in enumerate(samples):
        if abs(s) > thresh:
            start = max(0, i - int(rate * 0.02))
            break
    for i in range(len(samples) - 1, -1, -1):
        if abs(samples[i]) > thresh:
            end = min(len(samples), i + int(rate * 0.04))
            break
    body = samples[start:end] or samples[:]
    peak = max((abs(s) for s in body), default=1.0) or 1.0
    body = [s * (PEAK / peak) for s in body]
    want = int(rate * pad_s)
    if len(body) > want:
        body = body[:want]
    if len(body) < want:
        body = body + [0.0] * (want - len(body))
    # 4 ms fade in/out to avoid clicks when two streams start together.
    fade = max(1, int(rate * 0.004))
    for i in range(fade):
        g = i / fade
        body[i] *= g
        body[-1 - i] *= g
    return body


def tone(freq: float, seconds: float, rate: int = RATE) -> list[float]:
    n = int(rate * seconds)
    out = []
    for i in range(n):
        t = i / rate
        env = 1.0
        if i < rate * 0.01:
            env = i / (rate * 0.01)
        if i > n - rate * 0.02:
            env = max(0.0, (n - i) / (rate * 0.02))
        out.append(0.35 * env * math.sin(2 * math.pi * freq * t))
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs: list[tuple[str, str, int]] = []
    for k, spoken in DIGITS.items():
        jobs.append((f"digit-{k}", spoken, 200))
    for k, spoken in LETTERS.items():
        jobs.append((f"letter-{k}", spoken, 200))
    for k, spoken in PHRASES.items():
        jobs.append((k, spoken, 170))

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for name, text, rate in jobs:
            raw = tmp / f"{name}.wav"
            print(f"say {name}: {text}")
            run_say(text, raw, rate=rate)
            sr, samples = read_wav(raw)
            pad = 1.6 if name.startswith("attend") or name in PHRASES else PAD_S
            if name.startswith("attend") or "-" in name and name.split("-")[0] in {
                "engine",
                "hyd",
                "elec",
                "cabin",
                "fuel",
            }:
                pad = 1.7
            if name in PHRASES:
                pad = 1.7
            cooked = trim_pad(samples, sr, pad)
            write_wav(OUT / f"{name}.wav", sr, cooked)

    write_wav(OUT / "tone-left.wav", RATE, tone(440, 0.7))
    write_wav(OUT / "tone-right.wav", RATE, tone(554.37, 0.7))
    write_wav(OUT / "blip.wav", RATE, tone(880, 0.12))
    print(f"wrote {len(list(OUT.glob('*.wav')))} wavs to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
