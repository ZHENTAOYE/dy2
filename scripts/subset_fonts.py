#!/usr/bin/env python3
"""Subset the CJK/Latin fonts to exactly the glyphs used in src/ -> public/fonts/*.woff2.

Source TTFs are fetched from Google Fonts into .cache/fonts on first run.
Re-run after editing any on-screen text.
"""
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "fonts"
OUT = ROOT / "public" / "fonts"

SOURCES = {
    "NotoSansSC-Light": "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG4HFnYw.ttf",
    "NotoSansSC-Medium": "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG-3FnYw.ttf",
    "NotoSansSC-Black": "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG3bCnYw.ttf",
    "NotoSerifSC-Black": "https://fonts.gstatic.com/s/notoserifsc/v35/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7QrrCWv.ttf",
    "Montserrat-ExtraLight": "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCvr6Ew-.ttf",
    "Montserrat-Regular": "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf",
    "Montserrat-Bold": "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf",
}


def used_text() -> str:
    chars = set()
    for p in (ROOT / "src").rglob("*"):
        if p.suffix in {".ts", ".tsx", ".json"}:
            chars.update(p.read_text(encoding="utf-8"))
    # Always keep printable ASCII and common typographic marks.
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update("·—–…“”‘’×≈≤≥°₀₁₂³⁻⁰¹²⁴⁵⁶⁷⁸⁹%，。、：；！？（）《》【】「」")
    return "".join(sorted(c for c in chars if c.isprintable()))


def main() -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    text = used_text()
    (CACHE / "glyphs.txt").write_text(text, encoding="utf-8")
    for name, url in SOURCES.items():
        src = CACHE / f"{name}.ttf"
        if not src.exists():
            print(f"download {name}")
            urllib.request.urlretrieve(url, src)
        dst = OUT / f"{name}.woff2"
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.subset", str(src),
                f"--text-file={CACHE / 'glyphs.txt'}",
                "--flavor=woff2",
                "--layout-features=*",
                f"--output-file={dst}",
            ],
            check=True,
        )
        print(f"{dst.name}: {dst.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
