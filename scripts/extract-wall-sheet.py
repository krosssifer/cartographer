"""Нарезка листа стен на прозрачные детали для рендера.

Источник: assets/source/sprite-sheet-walls.jpg (белый фон).
Результат: src/assets/cartography/wall-<name>.webp.

У листа есть мягкая серая тень вокруг деталей: она нейтральная по цвету
(chroma ~0), а камень — зеленоватый. Поэтому кроме белого фона удаляем
нейтральные светлые пиксели, иначе вокруг стен остаётся белый ореол.
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'sprite-sheet-walls.jpg'
OUT = ROOT / 'src' / 'assets' / 'cartography'

# (имя, x0, y0, x1, y1) — bbox детали на листе
SPRITES = [
    ('straight', 1792, 43, 2344, 213),
    ('straightIvy', 1037, 37, 1745, 231),
    ('straightShort', 2390, 44, 2716, 213),
    ('pillar', 1488, 665, 1654, 833),
    ('column', 1747, 682, 1883, 818),
    ('end', 717, 665, 881, 834),
    ('rubble', 2128, 960, 2369, 1185),
]


def build_alpha(rgb: Image.Image) -> Image.Image:
    arr = np.asarray(rgb).astype(np.int16)
    h, w, _ = arr.shape
    near_white = arr.min(axis=2) >= 236
    bg = np.zeros((h, w), dtype=bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                queue.append((ny, nx))
    lum = arr.min(axis=2)
    chroma = arr.max(axis=2) - arr.min(axis=2)
    shadow = (lum >= 120) & (chroma < 6)
    return Image.fromarray(np.where(bg | shadow, 0, 255).astype(np.uint8))


def main() -> None:
    rgb = Image.open(SRC).convert('RGB')
    alpha = build_alpha(rgb)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, x0, y0, x1, y1 in SPRITES:
        pad = 2
        box = (max(0, x0 - pad), max(0, y0 - pad), min(rgb.width, x1 + pad), min(rgb.height, y1 + pad))
        sprite = rgb.crop(box)
        mask = alpha.crop(box).filter(ImageFilter.MinFilter(3))
        sprite.putalpha(mask)
        target = OUT / f'wall-{name}.webp'
        sprite.save(target, 'WEBP', lossless=True, quality=100, method=6)
        print(f'{name:14} {sprite.width}x{sprite.height} {target.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
