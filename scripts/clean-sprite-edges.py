"""Чистка краёв спрайтов от белого «шума»: точек, каймы и примеси белого.

Все спрайты вырезаны из листов на белом фоне, поэтому у полупрозрачных пикселей
в цвет подмешан белый, а по силуэту остаются мелкие светлые точки (антиалиасинг,
JPEG-ореол, светлая обводка генератора). Скрипт делает три вещи:

1. снимает примесь белого у полупрозрачных пикселей (un-mix white matte);
2. находит мелкие светлые скопления в кольце у прозрачности и делает их прозрачными;
3. мягко подрезает самый внешний слой силуэта (1 px), где чаще всего живёт «шум».

Крупные светлые детали внутри рисунка (мрамор, кость, ткань) не затрагиваются.

Запуск:
    python scripts/clean-sprite-edges.py [--only rock-4,crypt-altar-2] [--dry-run]
"""

from __future__ import annotations

import argparse
import pathlib
from collections import deque

import numpy as np
from PIL import Image

FOLDER = pathlib.Path(__file__).resolve().parent.parent / "src" / "assets" / "cartography"
NEIGH = ((-1, 0), (1, 0), (0, -1), (0, 1))


def unmix_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Снимает белую подложку у полупрозрачных пикселей: C = (C - (1-a)*255) / a."""
    semi = (alpha > 0) & (alpha < 255)
    if not semi.any():
        return rgb
    out = rgb.astype(np.float32).copy()
    a = (alpha[semi].astype(np.float32) / 255.0)[:, None]
    out[semi] = (out[semi] - (1.0 - a) * 255.0) / np.maximum(a, 1e-3)
    return np.clip(out, 0, 255)


def clean_edges(image: Image.Image, band: int = 2, light: int = 205, chroma_max: int = 25,
                max_pixels: int = 96, erode: int = 1) -> tuple[Image.Image, int]:
    arr = np.asarray(image).astype(np.int16)
    alpha = arr[:, :, 3]
    rgb = arr[:, :, :3].astype(np.float32)
    subject = alpha > 0
    transparent = ~subject
    if not subject.any() or not transparent.any():
        return image, 0

    rgb = unmix_white(rgb, alpha)
    darkest = rgb.min(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)

    grown = transparent.copy()
    for _ in range(max(1, band)):
        step = grown.copy()
        for dy, dx in NEIGH:
            step |= np.roll(np.roll(grown, dy, axis=0), dx, axis=1)
        grown = step
    edge_band = grown & subject

    light_mask = edge_band & (darkest >= light) & (chroma <= chroma_max)
    removed = 0
    if light_mask.any():
        height, width = light_mask.shape
        seen = np.zeros_like(light_mask, dtype=bool)
        for sy, sx in zip(*np.nonzero(light_mask)):
            if seen[sy, sx]:
                continue
            stack = deque([(int(sy), int(sx))])
            seen[sy, sx] = True
            pixels: list[tuple[int, int]] = []
            too_big = False
            while stack:
                y, x = stack.pop()
                pixels.append((y, x))
                if len(pixels) > max_pixels:
                    too_big = True
                    break
                for dy, dx in NEIGH:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and light_mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if not too_big:
                for y, x in pixels:
                    alpha[y, x] = 0
                removed += len(pixels)

    if erode > 0:
        shrunk = alpha.copy()
        for _ in range(erode):
            step = shrunk.copy()
            for dy, dx in NEIGH:
                step = np.minimum(step, np.roll(np.roll(shrunk, dy, axis=0), dx, axis=1))
            shrunk = step
        alpha = np.minimum(alpha, shrunk)

    out = np.dstack([rgb, alpha.astype(np.float32)])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA"), removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Чистка белого шума по краям спрайтов")
    parser.add_argument("--only", default="", help="через запятую: имена без .webp")
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    names = [item.strip() for item in args.only.split(",") if item.strip()]
    files = [FOLDER / f"{name}.webp" for name in names] if names else sorted(FOLDER.glob("*.webp"))

    touched = 0
    for path in files:
        if not path.exists():
            print(f"{path.stem}: пропуск (нет файла)")
            continue
        image = Image.open(path).convert("RGBA")
        fixed, removed = clean_edges(image)
        if removed == 0 and np.array_equal(np.asarray(image), np.asarray(fixed)):
            continue
        touched += 1
        if args.dry_run:
            print(f"{path.stem:28s} убрано точек: {removed}")
            continue
        fixed.save(path, "WEBP", quality=args.quality, method=6)
        print(f"{path.stem:28s} убрано точек: {removed}")

    print(f"файлов затронуто: {touched}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
