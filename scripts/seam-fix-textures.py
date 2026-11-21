"""Локальная доводка сгенерированных текстур до нормального тайлинга.

Gemini рисует красивые текстуры, но почти всегда добавляет лёгкое виньетирование
(края темнее центра) — при тайлинге это превращается в заметные тёмные полосы.
Скрипт делает три вещи без повторных обращений к модели:

1. обрезает 7% по краям (там обычно самый «мусорный» градиент);
2. растягивает обратно до 768 (или заданного размера);
3. выравнивает края «плоским полем»: плавная 1D-коррекция яркости, которая
   подтягивает среднюю яркость левого/правого/верхнего/нижнего края к средней
   по картинке. Коррекция распределена по всей ширине, поэтому не видна полосой.

Запуск: python scripts/seam-fix-textures.py [--only имя] [--size 768]
Исходники берутся из assets/source/generated/web, результат — в src/assets/cartography.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "assets" / "source" / "generated" / "web"
TARGET_DIR = ROOT / "src" / "assets" / "cartography"

TEXTURES = [
    "grass", "earth", "bank", "water", "waterDeep", "waterRapids", "flagstone", "bedrock", "snow", "peat",
    "caveSoil", "dunes", "hatching", "cobbles", "thatch", "shingles", "terracotta", "slate",
]


def find_raw(name: str) -> Path | None:
    for suffix in (".webp", ".png", ".jpg", ".jpeg"):
        candidate = RAW_DIR / f"{name}{suffix}"
        if candidate.exists():
            return candidate
    return None


def edge_luma(image: Image.Image, side: str, band: int = 4) -> float:
    """Средняя яркость узкой полосы у указанного края."""
    width, height = image.size
    if side == "left":
        box = (0, 0, band, height)
    elif side == "right":
        box = (width - band, 0, width, height)
    elif side == "top":
        box = (0, 0, width, band)
    else:
        box = (0, height - band, width, height)
    return ImageStat.Stat(image.crop(box).convert("L")).mean[0]


def flatten_edges(image: Image.Image, strength: float = 0.85) -> Image.Image:
    """Плавно подтягивает края к средней яркости картинки (без видимой полосы)."""
    width, height = image.size
    mean = ImageStat.Stat(image.convert("L")).mean[0] or 1.0
    left, right = edge_luma(image, "left"), edge_luma(image, "right")
    top, bottom = edge_luma(image, "top"), edge_luma(image, "bottom")

    # Отклонение края от средней яркости, ограниченное разумными пределами.
    def deviation(edge: float) -> float:
        raw = (mean / edge - 1.0) * strength if edge > 1 else 0.0
        return max(-0.22, min(0.22, raw))

    dev_left, dev_right = deviation(left), deviation(right)
    dev_top, dev_bottom = deviation(top), deviation(bottom)

    px = image.load()
    half_w, half_h = width / 2, height / 2
    for y in range(height):
        # Вес коррекции по вертикали: 1 у края, 0 в середине (квадратично).
        wy_top = max(0.0, 1.0 - y / half_h) ** 2 if half_h else 0.0
        wy_bottom = max(0.0, 1.0 - (height - 1 - y) / half_h) ** 2 if half_h else 0.0
        gain_y = 1.0 + dev_top * wy_top + dev_bottom * wy_bottom
        for x in range(width):
            wx_left = max(0.0, 1.0 - x / half_w) ** 2 if half_w else 0.0
            wx_right = max(0.0, 1.0 - (width - 1 - x) / half_w) ** 2 if half_w else 0.0
            gain = gain_y * (1.0 + dev_left * wx_left + dev_right * wx_right)
            r, g, b = px[x, y]
            px[x, y] = (
                max(0, min(255, int(r * gain))),
                max(0, min(255, int(g * gain))),
                max(0, min(255, int(b * gain))),
            )
    return image


def process(name: str, size: int, margin: float, quality: int) -> None:
    raw = find_raw(name)
    if raw is None:
        print(f"{name:<11} пропуск: нет исходника")
        return
    image = Image.open(raw).convert("RGB")
    width, height = image.size
    inset_x, inset_y = int(width * margin), int(height * margin)
    image = image.crop((inset_x, inset_y, width - inset_x, height - inset_y))
    image = image.resize((size, size), Image.LANCZOS)
    image = flatten_edges(image)
    target = TARGET_DIR / f"{name}.webp"
    image.save(target, "WEBP", quality=quality, method=6)
    print(f"{name:<11} {raw.name:<12} → {target.name} {size}x{size} {target.stat().st_size} B")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="обработать только одну текстуру")
    parser.add_argument("--size", type=int, default=768)
    parser.add_argument("--margin", type=float, default=0.07)
    parser.add_argument("--quality", type=int, default=90)
    args = parser.parse_args()
    names = [args.only] if args.only else TEXTURES
    for name in names:
        process(name, args.size, args.margin, args.quality)


if __name__ == "__main__":
    main()
