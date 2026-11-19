"""РќР°СЂРµР·РєР° Р»РёСЃС‚Р° СЂС‹РЅРѕС‡РЅС‹С… РѕР±СЉРµРєС‚РѕРІ (СЃС†РµРЅР°СЂРёР№ В«РіРѕСЂРѕРґ/РґРµСЂРµРІРЅСЏВ»).

РСЃС‚РѕС‡РЅРёРє: assets/source/sprite-sheet-market.jpg (Р±РµР»С‹Р№ С„РѕРЅ).
Р РµР·СѓР»СЊС‚Р°С‚: src/assets/cartography/market-<name>.webp СЃ Р°Р»СЊС„Р°-РєР°РЅР°Р»РѕРј.
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'sprite-sheet-market.jpg'
OUT = ROOT / 'src' / 'assets' / 'cartography'

SPRITES = [
    ('TentStripe', 34, 16, 323, 322), ('TentBrown', 341, 23, 583, 310),
    ('TentAwning', 616, 45, 951, 322), ('TentRound', 981, 17, 1343, 337),
    ('TentCanopy', 1377, 33, 1644, 311), ('TentPatch', 1681, 53, 2023, 317),
    ('TentTarp', 2054, 43, 2372, 315), ('TentBurlap', 2409, 43, 2712, 316),
    ('StallProduce', 39, 346, 316, 600), ('StallFruit', 334, 395, 498, 583),
    ('StallBread', 526, 385, 820, 587), ('StallGrain', 851, 396, 1082, 591),
    ('StallMeat', 1118, 357, 1368, 601), ('StallPottery', 1676, 366, 1911, 615),
    ('StallFabric', 1941, 386, 2176, 596), ('StallPotion', 2206, 363, 2439, 598),
    ('StallTools', 2461, 366, 2706, 560), ('StallFish', 1407, 399, 1637, 596),
    ('Wagon', 14, 656, 403, 854), ('WagonCovered', 419, 640, 810, 859),
    ('Wheelbarrow', 1145, 667, 1398, 827), ('WheelbarrowStone', 1417, 647, 1658, 903),
    ('Crates', 1666, 675, 1890, 921), ('Barrels', 1901, 700, 2075, 917),
    ('Rope', 2098, 720, 2217, 905), ('Sacks', 2244, 693, 2492, 906),
    ('Chest', 1547, 958, 1715, 1094), ('ChestOpen', 1731, 961, 1891, 1098),
    ('Baskets', 1703, 1348, 1927, 1510), ('BarrelPair', 2521, 1177, 2717, 1341),
    ('NoticeBoard', 805, 1169, 1089, 1382), ('Well', 1111, 1173, 1379, 1395),
    ('Hay', 1941, 1350, 2218, 1507), ('BarrelLying', 2226, 1376, 2377, 1500),
    ('Bench', 814, 908, 1044, 999), ('Table', 451, 900, 780, 1152),
    ('TableLong', 821, 1023, 1051, 1113), ('Fence', 1730, 1162, 1937, 1313),
    ('HayLarge', 2189, 1168, 2501, 1342), ('TableSet', 47, 905, 377, 1152),
]


def alpha_mask(rgb: Image.Image) -> Image.Image:
    arr = np.asarray(rgb).astype(np.int16)
    h, w, _ = arr.shape
    lum = arr.min(axis=2)
    chroma = arr.max(axis=2) - arr.min(axis=2)
    near_white = (lum >= 90) & (chroma <= 12)
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
    deep_white = (lum >= 228) & (chroma <= 8)
    return Image.fromarray(np.where(bg | deep_white, 0, 255).astype(np.uint8))


def main() -> None:
    rgb = Image.open(SRC).convert('RGB')
    alpha = alpha_mask(rgb)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, x0, y0, x1, y1 in SPRITES:
        pad = 2
        box = (max(0, x0 - pad), max(0, y0 - pad), min(rgb.width, x1 + pad), min(rgb.height, y1 + pad))
        sprite = rgb.crop(box)
        mask = alpha.crop(box).filter(ImageFilter.MinFilter(3))
        sprite.putalpha(mask)
        # Спрайты в листе нарисованы с большим запасом под печать; на карте
        # объект занимает 1–3 клетки, поэтому хранить их в полном разрешении
        # дорого: это заметно замедляет загрузку и декодирование.
        if max(sprite.size) > 320:
            sprite.thumbnail((320, 320), Image.Resampling.LANCZOS)
        target = OUT / f'market{name}.webp'
        sprite.save(target, 'WEBP', lossless=False, quality=85, method=6)
        total += target.stat().st_size
        print(f'{name:20} {sprite.width}x{sprite.height} {target.stat().st_size // 1024} KB')
    print(f'total: {total / 1024 / 1024:.2f} MB, sprites: {len(SPRITES)}')


if __name__ == '__main__':
    main()


