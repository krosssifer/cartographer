"""Сжимает спрайты и текстуры перед сборкой single-file бандла.

Спрайты инлайнятся в index.html как base64 (+33% к размеру), поэтому
lossless-WebP от нарезки листов делает бандл неподъёмным.
Запуск:  python scripts/optimize-sprites.py [--dry]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image

FOLDER = pathlib.Path(__file__).resolve().parent.parent / "src" / "assets" / "cartography"

# Материалы земли: сэмплируются с заворотом и downsample, нужен запас по разрешению.
TEXTURES = {
    "grass", "earth", "bank", "water", "flagstone", "bedrock", "snow", "peat",
    "caveSoil", "dunes", "hatching", "cobbles", "thatch", "shingles",
    "terracotta", "slate",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="только посчитать, не перезаписывать")
    args = parser.parse_args()

    before = after = 0
    changed = 0
    for path in sorted(FOLDER.glob("*.webp")):
        before += path.stat().st_size
        is_texture = path.stem in TEXTURES
        limit = 768 if is_texture else 512
        quality = 92 if is_texture else 90
        with Image.open(path) as img:
            img.load()
            scale = min(1.0, limit / max(img.width, img.height))
            width = max(1, round(img.width * scale))
            height = max(1, round(img.height * scale))
            resized = img if scale == 1.0 else img.resize((width, height), Image.LANCZOS)
            target = path.with_suffix(".tmp.webp")
            resized.save(target, "WEBP", quality=quality, method=6)
        size = target.stat().st_size
        if size >= path.stat().st_size:
            target.unlink()
            after += path.stat().st_size
            continue
        if args.dry:
            target.unlink()
        else:
            target.replace(path)
        after += size
        changed += 1
        print(f"  {path.name}: {path.stat().st_size // 1024} KB -> {size // 1024} KB")

    print(f"итого: {before / 1024 / 1024:.2f} МБ -> {after / 1024 / 1024:.2f} МБ, файлов изменено: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())