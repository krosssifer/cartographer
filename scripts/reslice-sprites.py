"""Пересборка спрайтов из уже скачанного сырья в высоком качестве.

Не обращается к Gemini: берёт листы из assets/source/generated/web, режет по
сетке задания и перезаписывает существующие файлы вариантов (rock.webp,
rock-2.webp, ...), сохраняя нумерацию. Запуск:
    python scripts/reslice-sprites.py [--quality 95] [--max-size 0] [--only имя]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gemini_sprites as gs  # noqa: E402


NEIGHBOURS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))

# Белая обводка встречается у генераций листвы: применяем чистку только к ним,
# чтобы не портить белые детали (мрамор, кость, ткань, снег) у других спрайтов.
FRINGE_NAMES = ("oak", "oakGold", "pine", "bush", "cactus", "reed", "dead", "mushroom")



def remove_background_soft(tile: Image.Image, bg_threshold: int = 230, solid_threshold: int = 170, band: int = 2) -> Image.Image:
    """Аккуратно вырезает белый фон и убирает белёсую кайму по краю рисунка.

    Порог 246 из базовой версии оставлял у бледной листвы полупрозрачно-белые
    пиксели. Здесь фон ищется заливкой от краёв (связная область), а пиксели
    двухпиксельной каймы перекрашиваются в «твёрдые» цвета соседних листьев —
    белого контура больше нет.
    """
    import numpy as np
    from PIL import ImageDraw

    arr = np.asarray(tile.convert("RGBA")).astype(np.int16)
    darkest = arr[:, :, :3].min(axis=2)
    background = (darkest >= bg_threshold).astype(np.uint8) * 255
    # .copy() обязателен: в Pillow 10 floodfill не меняет изображение, созданное из массива.
    mask = Image.fromarray(background, "L").copy()
    width, height = mask.size
    seeds = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1),
             (width // 2, 0), (width // 2, height - 1), (0, height // 2), (width - 1, height // 2)]
    for point in seeds:
        if mask.getpixel(point) == 255:
            ImageDraw.floodfill(mask, point, 128)
    solid_bg = np.asarray(mask) == 128

    alpha = arr[:, :, 3].copy()
    alpha[solid_bg] = 0

    # Пиксели «твёрдого» тела рисунка — источник достоверных цветов.
    solid = (~solid_bg) & (darkest < solid_threshold)
    tint = arr[:, :, :3].astype(np.float32)
    known = solid.copy()
    for _ in range(band + 2):
        if known.all():
            break
        acc = np.zeros_like(tint)
        count = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in NEIGHBOURS:
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            shifted_tint = np.roll(np.roll(tint, dy, axis=0), dx, axis=1)
            acc += shifted_tint * shifted_known[:, :, None]
            count += shifted_known.astype(np.float32)
        grow = (~known) & (count > 0)
        if not grow.any():
            break
        tint[grow] = acc[grow] / count[grow][:, None]
        known = known | grow

    # Кайма у прозрачного фона: красим в цвет тела, а не в белый.
    band_mask = solid_bg.copy()
    for _ in range(band):
        grown = band_mask.copy()
        for dy, dx in NEIGHBOURS:
            grown |= np.roll(np.roll(band_mask, dy, axis=0), dx, axis=1)
        band_mask = grown
    edge = band_mask & ~solid_bg
    arr[:, :, :3] = np.where(edge[:, :, None], np.clip(tint, 0, 255), arr[:, :, :3])

    # Бледную кайму (светлые пиксели у самого края) гасим по альфе: при смешении
    # с травой они не дают белого контура.
    pale = np.clip((darkest - 150) / 80, 0.0, 1.0)
    fade = np.where(edge, 1.0 - pale * 0.9, 1.0)
    alpha = alpha * fade

    # Лёгкая эрозия силуэта на 1 пиксель убирает самый внешний полупрозрачный слой.
    shrunk = alpha.copy()
    for dy, dx in NEIGHBOURS:
        shrunk = np.minimum(shrunk, np.roll(np.roll(alpha, dy, axis=0), dx, axis=1))
    alpha = np.minimum(alpha, np.where(alpha > 0, shrunk, 0))

    arr[:, :, 3] = alpha

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")



def remove_boundary_white(tile: Image.Image, band: int = 4, light: int = 200, rim_alpha: float = 0.4) -> Image.Image:
    """Убирает светлую кайму у самого силуэта (нарисованный генератором «свет» или остаток фона)."""
    arr = np.asarray(tile).astype(np.int16)
    alpha = arr[:, :, 3]
    color = arr[:, :, :3].astype(np.float32)
    darkest = color.min(axis=2)
    subject = alpha > 0
    transparent = ~subject
    if not transparent.any() or not subject.any():
        return tile

    grown = transparent.copy()
    for _ in range(max(1, band)):
        step = grown.copy()
        for dy, dx in NEIGHBOURS:
            step |= np.roll(np.roll(grown, dy, axis=0), dx, axis=1)
        grown = step
    edge_band = grown & subject

    rim = edge_band & (darkest >= light)
    if not rim.any():
        return tile

    known = subject & ~rim & (darkest < light)
    filled = color.copy()
    for _ in range(5):
        if not (~known & rim).any():
            break
        acc = np.zeros_like(filled)
        cnt = np.zeros(darkest.shape, dtype=np.float32)
        for dy, dx in NEIGHBOURS:
            k = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            c = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            acc += c * k[:, :, None]
            cnt += k
        grow = (cnt > 0) & ~known
        if not grow.any():
            break
        filled[grow] = acc[grow] / cnt[grow][:, None]
        known |= grow

    color = np.where(rim[:, :, None], filled, color)
    alpha = np.where(rim, (alpha * rim_alpha).astype(np.int16), alpha)
    out = np.dstack([np.clip(color, 0, 255), np.clip(alpha, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def punch_white_holes(tile: Image.Image, threshold: int = 236, chroma_max: int = 14,
                      max_share: float = 0.05) -> Image.Image:
    """Делает прозрачными белые «просветы» внутри кроны: щели между ветками и листвой.

    Генератор оставляет между ветвями замкнутые участки белого фона, которые заливка
    от края не достаёт. Ищем связные пятна почти белого (яркость >= threshold и
    насыщенность <= chroma_max) и гасим их альфу. Крупные белые детали (кора, цветы)
    не трогаем: пятно больше max_share от площади спрайта остаётся как есть.
    """
    from collections import deque

    arr = np.asarray(tile).astype(np.int16)
    alpha = arr[:, :, 3]
    rgb = arr[:, :, :3]
    darkest = rgb.min(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    subject = alpha > 0
    white = subject & (darkest >= threshold) & (chroma <= chroma_max)
    if not white.any():
        return tile

    budget = max(64, int(white.sum() * 0 + subject.sum() * max_share))
    height, width = white.shape
    visited = np.zeros_like(white, dtype=bool)
    remove = []

    for start_y, start_x in zip(*np.nonzero(white)):
        if visited[start_y, start_x]:
            continue
        stack = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        pixels = []
        while stack:
            y, x = stack.pop()
            pixels.append((y, x))
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < height and 0 <= nx < width and white[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    stack.append((ny, nx))
        if len(pixels) <= budget:
            remove.extend(pixels)

    if not remove:
        return tile

    out = arr.copy()
    for y, x in remove:
        out[y, x, 3] = 0
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def remove_white_ridges(tile: Image.Image, light: int = 205, core_erosion: int = 2, rim_alpha: float = 0.5) -> Image.Image:
    """Убирает тонкие светлые «прожилки»-обводки, нарисованные генератором по краю листвы.

    Толщина таких прожилок — 1–2 px: после двух эрозий от них остаются единицы пикселей.
    Тонкие пиксели перекрашиваются в цвет ближайшего «тела» (распространение цвета)
    и получают частичную прозрачность, поэтому в игре растворяются в фоне без белого контура.
    """
    arr = np.asarray(tile).astype(np.int16)
    alpha = arr[:, :, 3]
    color = arr[:, :, :3].astype(np.float32)
    darkest = color.min(axis=2)
    subject = alpha > 0
    white = subject & (darkest >= light)
    if not white.any():
        return tile

    core = white.copy()
    for _ in range(max(1, core_erosion)):
        shrunk = core.copy()
        for dy, dx in NEIGHBOURS:
            shrunk &= np.roll(np.roll(core, dy, axis=0), dx, axis=1)
        core = shrunk
    rim = white & ~core
    if not rim.any():
        return tile

    known = subject & ~white
    filled = color.copy()
    for _ in range(4):
        if not (~known & rim).any():
            break
        acc = np.zeros_like(filled)
        cnt = np.zeros(darkest.shape, dtype=np.float32)
        for dy, dx in NEIGHBOURS:
            k = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            c = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            acc += c * k[:, :, None]
            cnt += k
        grow = (cnt > 0) & ~known
        if not grow.any():
            break
        filled[grow] = acc[grow] / cnt[grow][:, None]
        known |= grow

    color = np.where(rim[:, :, None], filled, color)
    alpha = np.where(rim, (alpha * rim_alpha).astype(np.int16), alpha)
    out = np.dstack([np.clip(color, 0, 255), np.clip(alpha, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def defringe(tile: Image.Image) -> Image.Image:
    """Убирает белый «ореол» вокруг спрайта.

    Два шага:
    * полупрозрачные пиксели ребра «разминируются» от белого фона:
      color = (color - (1 - a) * 255) / a — именно из-за них при уменьшении
      картинки появляется светлая кайма;
    * полностью прозрачные пиксели у границы получают цвет ближайшей непрозрачной
      области (color bleeding): билинейная фильтрация браузера смешивает уже
      цветные пиксели, а не белые.
    """
    import numpy as np

    data = np.asarray(tile, dtype=np.float32).copy()
    alpha = data[:, :, 3] / 255.0
    # 1. Разминирование ребра от белого.
    edge = (alpha > 0.03) & (alpha < 0.98)
    if edge.any():
        safe = np.clip(alpha[edge][:, None], 0.03, 1.0)
        rgb = (data[:, :, :3][edge] - (1.0 - safe) * 255.0) / safe
        data[:, :, :3][edge] = np.clip(rgb, 0.0, 255.0)
    # 2. Заливка цвета в прозрачную кайму.
    known = alpha > 0.5
    rgb = data[:, :, :3]
    for _ in range(4):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        count = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            shifted_rgb = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            acc += shifted_rgb * shifted_known[:, :, None]
            count += shifted_known.astype(np.float32)
        grow = (~known) & (count > 0)
        if not grow.any():
            break
        rgb[grow] = acc[grow] / count[grow][:, None]
        known = known | grow
    data[:, :, :3] = rgb
    return Image.fromarray(np.clip(data, 0, 255).astype(np.uint8), mode="RGBA")


def variant_targets(folder: Path, base: str) -> list[Path]:
    """Существующие файлы вариантов базы, отсортированные по номеру варианта."""
    found = sorted(folder.glob(f"{base}*.webp"))
    exact = [p for p in found if p.stem == base or p.stem.startswith(base + "-")]

    def index(path: Path) -> int:
        stem = path.stem
        if stem == base:
            return 1
        try:
            return int(stem.rsplit("-", 1)[1])
        except ValueError:
            return 999

    return sorted(exact, key=index)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--max-size", type=int, default=0)
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    folder = gs.FINAL_SPRITES_DIR
    before = after = 0
    written = 0

    for task in gs.TASKS:
        if args.only and task.name != args.only:
            continue
        raw = gs._existing_raw(gs.RAW_OUTPUT_DIR, task.name)
        if raw is None:
            print(f"{task.name:<18} пропуск: нет сырья")
            continue
        image = Image.open(raw).convert("RGBA")
        cell_w, cell_h = image.width / task.cols, image.height / task.rows
        max_size = args.max_size or task.max_size
        limit = max_size or 10_000
        seen: dict[str, int] = {}
        print(f"{task.name:<18} {raw.name}")
        for row in range(task.rows):
            for col in range(task.cols):
                position = row * task.cols + col
                name = task.names[position] if position < len(task.names) else f"{task.name}_{position + 1:02d}"
                base_name = name.split("-")[0]
                box = (
                    round(col * cell_w), round(row * cell_h),
                    round((col + 1) * cell_w), round((row + 1) * cell_h),
                )
                tile = image.crop(box)
                tile = remove_background_soft(tile)
                tile = gs.trim_tile(tile)
                tile = defringe(tile)
                if base_name in FRINGE_NAMES or base_name.startswith("decor-"):
                    tile = remove_white_ridges(tile)
                    tile = remove_boundary_white(tile)
                    if base_name in FRINGE_NAMES:
                        tile = punch_white_holes(tile)
                if max(tile.size) > limit:
                    scale = limit / max(tile.size)
                    tile = tile.resize((max(1, round(tile.width * scale)), max(1, round(tile.height * scale))), Image.LANCZOS)
                seen[name] = seen.get(name, 0) + 1
                targets = variant_targets(folder, name)
                slot = seen[name] - 1
                if slot < len(targets):
                    target = targets[slot]
                else:
                    target = folder / f"{name}.webp"
                    n = 2
                    while target.exists():
                        target = folder / f"{name}-{n}.webp"
                        n += 1
                before += target.stat().st_size if target.exists() else 0
                tile.save(target, "WEBP", quality=args.quality, method=6)
                after += target.stat().st_size
                written += 1
                print(f"    {name:<26} -> {target.name:<28} {tile.width}x{tile.height} {target.stat().st_size // 1024} KB")

    print(f"итого: {before / 1024 / 1024:.2f} МБ -> {after / 1024 / 1024:.2f} МБ, перезаписано {written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())