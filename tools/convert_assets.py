#!/usr/bin/env python3
"""Convert the original "I've got some BALLS" v1.02 (1999) release into the
asset layout used by the Godot port.

Usage:
    python3 tools/convert_assets.py <path-to-extracted-original-release>

Requires Pillow (`pip install pillow`) and an ffmpeg build with libopenmpt
(used to render the Impulse Tracker music to Ogg Vorbis).

What it does:
  * *.bmp (some RLE-compressed)   -> assets/textures/<lowercase>.png
  * *.wav                         -> assets/sounds/<lowercase>.wav (copied)
  * menu.it / game.it             -> assets/music/<name>.ogg
  * ball/ball2/dia/menu.3DO       -> assets/models/<lowercase>.3do (copied, parsed at runtime)
  * maps/*.3DO, *.rec, *.rep      -> assets/maps/<slug>.<ext> (copied)
  * text documentation            -> docs/original/ (converted from CP850 to UTF-8)
"""
import os
import re
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def ensure(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


FONT_LAYOUT = [
    "ABCDEFGHIJKLMNOP",  # ifont1.bmp, 4 x 4 cells of 64 x 64
    "QRSTUVWXYZ012345",  # ifont2.bmp
    "6789:/%!?.+-,*()",  # ifont3.bmp ('*' is the diamond icon)
]


def build_font(src: str, out_dir: str) -> None:
    """Pack ifont1-3.bmp into one RGBA atlas plus per-glyph metrics."""
    import json
    atlas = Image.new("RGBA", (256, 256 * len(FONT_LAYOUT)), (255, 255, 255, 0))
    glyphs = []
    for page, chars in enumerate(FONT_LAYOUT):
        img = Image.open(os.path.join(src, "ifont%d.bmp" % (page + 1))).convert("L")
        alpha = Image.merge("RGBA", (Image.new("L", img.size, 255),) * 3 + (img,))
        atlas.paste(alpha, (0, page * 256))
        for i, ch in enumerate(chars):
            cx, cy = (i % 4) * 64, (i // 4) * 64
            cols = [x for x in range(64) if max(img.getpixel((cx + x, cy + y)) for y in range(64)) > 40]
            left, right = (min(cols), max(cols)) if cols else (0, 31)
            glyphs.append({"char": ch, "x": cx + left, "y": page * 256 + cy, "w": right - left + 1})
    atlas.save(os.path.join(out_dir, "balls_font.png"), optimize=True)
    with open(os.path.join(out_dir, "balls_font.json"), "w") as fh:
        json.dump({"cell": 64, "glyphs": glyphs}, fh, indent=1)


def main(src: str) -> None:
    tex = ensure(os.path.join(ASSETS, "textures"))
    snd = ensure(os.path.join(ASSETS, "sounds"))
    mus = ensure(os.path.join(ASSETS, "music"))
    mdl = ensure(os.path.join(ASSETS, "models"))
    maps = ensure(os.path.join(ASSETS, "maps"))
    docs = ensure(os.path.join(ROOT, "docs", "original"))

    for f in sorted(os.listdir(src)):
        path = os.path.join(src, f)
        base, ext = os.path.splitext(f)
        ext = ext.lower()
        if ext == ".bmp":
            Image.open(path).convert("RGB").save(os.path.join(tex, base.lower() + ".png"), optimize=True)
        elif ext == ".wav":
            shutil.copyfile(path, os.path.join(snd, base.lower() + ".wav"))
        elif ext == ".it":
            out = os.path.join(mus, base.lower() + ".ogg")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                            "-c:a", "libvorbis", "-q:a", "5", out], check=True)
        elif ext == ".3do":
            shutil.copyfile(path, os.path.join(mdl, base.lower() + ".3do"))
        elif ext == ".txt":
            with open(path, "rb") as fh:
                text = fh.read().decode("cp850").replace("\r\n", "\n")
            with open(os.path.join(docs, base.lower() + ".txt"), "w", encoding="utf-8") as fh:
                fh.write(text)

    build_font(src, ensure(os.path.join(ASSETS, "fonts")))

    map_dir = os.path.join(src, "maps")
    for f in sorted(os.listdir(map_dir)):
        base, ext = os.path.splitext(f)
        shutil.copyfile(os.path.join(map_dir, f), os.path.join(maps, slug(base) + ext.lower()))
    print("Assets written to", ASSETS)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
