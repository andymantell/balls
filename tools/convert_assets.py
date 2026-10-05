#!/usr/bin/env python3
"""Convert the original "I've got some BALLS" v1.02 (1999) release into the
asset layout used by the three.js port (public/assets).

Usage:
    python3 tools/convert_assets.py <path-to-extracted-original-release>

Requires Pillow (`pip install pillow`) and an ffmpeg build with libopenmpt
(used to render the Impulse Tracker music to Ogg Vorbis).

What it does:
  * *.bmp (some RLE-compressed)   -> public/assets/textures/<lowercase>.png
  * *.wav                         -> public/assets/sounds/<lowercase>.wav (copied)
  * menu.it / game.it             -> public/assets/music/<name>.ogg and .m4a
  * ball/ball2/dia/menu.3DO       -> public/assets/models/<lowercase>.3do (copied, parsed at runtime)
  * maps/*.3DO, *.rec, *.rep      -> public/assets/maps/<slug>.<ext> (copied)
  * text documentation            -> docs/original/ (converted from CP850 to UTF-8)
"""
import os
import re
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "public", "assets")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def ensure(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


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
            for ext_out, codec in ((".ogg", ["-c:a", "libvorbis", "-q:a", "5"]),
                                   (".m4a", ["-c:a", "aac", "-b:a", "160k"])):
                out = os.path.join(mus, base.lower() + ext_out)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path] + codec + [out], check=True)
        elif ext == ".3do":
            shutil.copyfile(path, os.path.join(mdl, base.lower() + ".3do"))
        elif ext == ".txt":
            with open(path, "rb") as fh:
                text = fh.read().decode("cp850").replace("\r\n", "\n")
            with open(os.path.join(docs, base.lower() + ".txt"), "w", encoding="utf-8") as fh:
                fh.write(text)

    map_dir = os.path.join(src, "maps")
    for f in sorted(os.listdir(map_dir)):
        base, ext = os.path.splitext(f)
        shutil.copyfile(os.path.join(map_dir, f), os.path.join(maps, slug(base) + ext.lower()))
    print("Assets written to", ASSETS)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
