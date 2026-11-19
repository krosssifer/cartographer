"""РќР°СЂРµР·РєР° Р»РёСЃС‚Р° СЃС‚РµРЅ РЅР° РїСЂРѕР·СЂР°С‡РЅС‹Рµ РґРµС‚Р°Р»Рё РґР»СЏ СЂРµРЅРґРµСЂР°.

РСЃС‚РѕС‡РЅРёРє: assets/source/sprite-sheet-walls.jpg (Р±РµР»С‹Р№ С„РѕРЅ).
Р РµР·СѓР»СЊС‚Р°С‚: src/assets/cartography/wall-<name>.webp.

РЈ Р»РёСЃС‚Р° РµСЃС‚СЊ РјСЏРіРєР°СЏ СЃРµСЂР°СЏ С‚РµРЅСЊ РІРѕРєСЂСѓРі РґРµС‚Р°Р»РµР№: РѕРЅР° РЅРµР№С‚СЂР°Р»СЊРЅР°СЏ РїРѕ С†РІРµС‚Сѓ
(chroma ~0), Р° РєР°РјРµРЅСЊ вЂ” Р·РµР»РµРЅРѕРІР°С‚С‹Р№. РџРѕСЌС‚РѕРјСѓ РєСЂРѕРјРµ Р±РµР»РѕРіРѕ С„РѕРЅР° СѓРґР°Р»СЏРµРј
РЅРµР№С‚СЂР°Р»СЊРЅС‹Рµ СЃРІРµС‚Р»С‹Рµ РїРёРєСЃРµР»Рё, РёРЅР°С‡Рµ РІРѕРєСЂСѓРі СЃС‚РµРЅ РѕСЃС‚Р°С‘С‚СЃСЏ Р±РµР»С‹Р№ РѕСЂРµРѕР».
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'sprite-sheet-walls.jpg'
OUT = ROOT / 'src' / 'assets' / 'cartography'

# (РёРјСЏ, x0, y0, x1, y1) вЂ” bbox РґРµС‚Р°Р»Рё РЅР° Р»РёСЃС‚Рµ
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


