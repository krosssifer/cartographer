"""РќР°СЂРµР·РєР° СЃРїСЂР°Р№С‚-Р»РёСЃС‚Р° РЅР° РѕС‚РґРµР»СЊРЅС‹Рµ РѕР±СЉРµРєС‚С‹ СЃ РїСЂРѕР·СЂР°С‡РЅС‹Рј С„РѕРЅРѕРј.

РСЃС‚РѕС‡РЅРёРє: assets/source/sprite-sheet-objects.webp (Р»РёСЃС‚ РЅР° Р±РµР»РѕРј С„РѕРЅРµ).
Р РµР·СѓР»СЊС‚Р°С‚: src/assets/cartography/crypt-<name>.webp СЃ Р°Р»СЊС„Р°-РєР°РЅР°Р»РѕРј.

Р‘РµР»С‹Р№ С„РѕРЅ СѓРґР°Р»СЏРµС‚СЃСЏ Р·Р°Р»РёРІРєРѕР№ РѕС‚ РєСЂР°СЏ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ: РІРЅСѓС‚СЂРµРЅРЅРёРµ Р±РµР»С‹Рµ Р±Р»РёРєРё
(РєСЂРёСЃС‚Р°Р»Р»С‹, Р±Р»РёРєРё РЅР° РєР°РјРЅСЏС…) РѕСЃС‚Р°СЋС‚СЃСЏ РЅРµРїСЂРѕР·СЂР°С‡РЅС‹РјРё.
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'sprite-sheet-objects.webp'
OUT = ROOT / 'src' / 'assets' / 'cartography'

SPRITES = [
    ('boulder', (20, 20, 186, 110)),
    ('rockPile', (197, 16, 305, 114)),
    ('scree', (318, 30, 443, 110)),
    ('rockSpikes', (454, 30, 542, 106)),
    ('rockSpire', (555, 13, 694, 115)),
    ('pebbles', (886, 27, 996, 106)),
    ('rockOutcrop', (705, 16, 872, 126)),
    ('stoneWell', (841, 132, 1006, 270)),
    ('stalagmites', (22, 136, 138, 250)),
    ('stalactites', (154, 143, 233, 251)),
    ('puddleBlue', (347, 156, 496, 247)),
    ('puddleMud', (516, 156, 663, 246)),
    ('puddleAcid', (683, 158, 828, 252)),
    ('mossGrass', (15, 280, 174, 409)),
    ('mushroomsGlow', (186, 273, 319, 408)),
    ('mossPatch', (336, 294, 456, 395)),
    ('bushPatch', (473, 291, 594, 401)),
    ('ivyWall', (609, 278, 746, 411)),
    ('roots', (752, 287, 885, 404)),
    ('lichen', (896, 299, 1004, 392)),
    ('dirtPatch', (24, 442, 169, 543)),
    ('cracks', (187, 429, 324, 551)),
    ('nestEggs', (342, 420, 520, 553)),
    ('skeletonBones', (536, 432, 678, 546)),
    ('logs', (696, 422, 846, 554)),
    ('crystals', (865, 413, 1000, 552)),
]


def alpha_mask(rgb: Image.Image) -> Image.Image:
    arr = np.asarray(rgb).astype(np.int16)
    h, w, _ = arr.shape
    near_white = arr.min(axis=2) >= 238
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
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    return Image.fromarray(alpha)


def main() -> None:
    rgb = Image.open(SRC).convert('RGB')
    alpha = alpha_mask(rgb)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (x0, y0, x1, y1) in SPRITES:
        pad = 2
        box = (max(0, x0 - pad), max(0, y0 - pad), min(rgb.width, x1 + pad), min(rgb.height, y1 + pad))
        sprite = rgb.crop(box)
        mask = alpha.crop(box).filter(ImageFilter.MinFilter(3))
        sprite.putalpha(mask)
        target = OUT / f'crypt-{name}.webp'
        sprite.save(target, 'WEBP', lossless=True, quality=100, method=6)
        total += target.stat().st_size
        print(f'{name:14} {sprite.width}x{sprite.height} {target.stat().st_size // 1024} KB')
    print(f'total: {total / 1024 / 1024:.2f} MB, sprites: {len(SPRITES)}')


if __name__ == '__main__':
    main()


