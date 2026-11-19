"""Р СњР В°РЎР‚Р ВµР В·Р С”Р В° Р Р†РЎвЂљР С•РЎР‚Р С•Р С–Р С• РЎРѓР С—РЎР‚Р В°Р в„–РЎвЂљ-Р В»Р С‘РЎРѓРЎвЂљР В° (Р В»Р С•Р Р†РЎС“РЎв‚¬Р С”Р С‘ Р С‘ Р СР ВµРЎвЂ¦Р В°Р Р…Р С‘Р В·Р СРЎвЂ№) Р Р…Р В° Р С—РЎР‚Р С•Р В·РЎР‚Р В°РЎвЂЎР Р…РЎвЂ№Р Вµ WebP.

Р ВРЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”: assets/source/sprite-sheet-traps.jpg (Р В±Р ВµР В»РЎвЂ№Р в„– РЎвЂћР С•Р Р…).
Р В Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ: src/assets/cartography/crypt-<name>.webp.

Р ВР В· Р В»Р С‘РЎРѓРЎвЂљР В° Р Р†РЎвЂ№Р В±РЎР‚Р В°Р Р…РЎвЂ№ 40 Р С”Р В»РЎР‹РЎвЂЎР ВµР Р†РЎвЂ№РЎвЂ¦ Р С•Р В±РЎР‰Р ВµР С”РЎвЂљР С•Р Р†; Р С•РЎРѓРЎвЂљР В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р С”Р В°Р Т‘РЎР‚РЎвЂ№ РІР‚вЂќ Р Р†Р В°РЎР‚Р С‘Р В°РЎвЂ Р С‘Р С‘ РЎвЂљР ВµРЎвЂ¦ Р В¶Р Вµ
Р В»Р С•Р Р†РЎС“РЎв‚¬Р ВµР С”/Р СР ВµРЎвЂ¦Р В°Р Р…Р С‘Р В·Р СР С•Р Р† (РЎРЏР СРЎвЂ№, РЎв‚¬Р С‘Р С—РЎвЂ№, Р С—Р В»Р С‘РЎвЂљРЎвЂ№, РЎв‚¬Р ВµРЎРѓРЎвЂљР ВµРЎР‚Р Р…Р С‘, РЎР‚РЎвЂ№РЎвЂЎР В°Р С–Р С‘, Р Т‘Р Р†Р ВµРЎР‚Р С‘).
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source' / 'sprite-sheet-traps.jpg'
OUT = ROOT / 'src' / 'assets' / 'cartography'

# (Р С‘Р СРЎРЏ, x0, y0, x1, y1) РІР‚вЂќ bbox Р С•Р В±РЎР‰Р ВµР С”РЎвЂљР В° Р Р…Р В° Р В»Р С‘РЎРѓРЎвЂљР Вµ
SPRITES = [
    ('pitSquare', 210, 23, 354, 164),
    ('pitRound', 386, 22, 523, 162),
    ('pitSpikes', 26, 187, 175, 332),
    ('spikeField', 731, 189, 864, 326),
    ('spikeFieldBloody', 1394, 186, 1534, 330),
    ('spikeRack', 1551, 18, 1719, 172),
    ('spikedWheel', 1372, 526, 1539, 653),
    ('sawBlade', 20, 903, 191, 1076),
    ('axeBlade', 560, 947, 768, 1074),
    ('sawBar', 388, 1088, 775, 1134),
    ('portcullis', 1294, 915, 1518, 1137),
    ('portcullisWood', 1546, 987, 1795, 1179),
    ('wreckingBall', 1550, 1195, 1685, 1527),
    ('dartHoleWall', 1014, 732, 1113, 830),
    ('bladeSlot', 60, 698, 123, 855),
    ('pressurePlate', 20, 371, 155, 502),
    ('pressurePlateRound', 177, 371, 307, 502),
    ('pressurePlateRusty', 329, 369, 462, 503),
    ('buttonPanel', 2292, 571, 2377, 657),
    ('gear', 1391, 371, 1543, 498),
    ('gearCog', 1736, 360, 1871, 496),
    ('chainPulley', 2180, 364, 2252, 582),
    ('pulleyBlock', 2282, 363, 2374, 549),
    ('lever', 2525, 368, 2589, 527),
    ('leverBlade', 1305, 690, 1446, 877),
    ('doorWood', 1705, 715, 1857, 869),
    ('doorMetal', 2378, 913, 2536, 1145),
    ('doorRound', 2214, 710, 2375, 873),
    ('doorBarred', 2391, 710, 2552, 874),
    ('gateBars', 2573, 717, 2721, 866),
    ('hangingCage', 2575, 1277, 2721, 1520),
    ('pedestalStatue', 1071, 1193, 1187, 1345),
    ('orbRed', 803, 1193, 894, 1349),
    ('bust', 945, 1355, 1025, 1519),
    ('runeBlue', 16, 1198, 159, 1346),
    ('runeCircleBlue', 176, 1190, 337, 1353),
    ('runeCirclePurple', 356, 1369, 511, 1527),
    ('greenRuneStone', 684, 1375, 762, 1477),
    ('flail', 2242, 1328, 2391, 1517),
    ('crackedPlate', 1991, 200, 2189, 325),
]


# РЈ СЌС‚РёС… РѕР±СЉРµРєС‚РѕРІ Р±РµР»С‹Р№ С„РѕРЅ РµСЃС‚СЊ Рё РІРЅСѓС‚СЂРё РєРѕРЅС‚СѓСЂРѕРІ (СЃРїРёС†С‹ С€РµСЃС‚РµСЂС‘РЅ, С†РµРЅС‚СЂ РїРёР»С‹,
# СѓРіР»С‹ СЂСѓРЅРЅС‹С… РїР»РёС‚). Р”Р»СЏ РЅРёС… СѓР±РёСЂР°РµРј РІРµСЃСЊ РїРѕС‡С‚Рё-Р±РµР»С‹Р№ С†РІРµС‚; Сѓ РѕСЃС‚Р°Р»СЊРЅС‹С… вЂ”
# С‚РѕР»СЊРєРѕ С„РѕРЅ, СЃРІСЏР·Р°РЅРЅС‹Р№ СЃ РєСЂР°РµРј, С‡С‚РѕР±С‹ РЅРµ РІС‹РµСЃС‚СЊ СЃРІРµС‚Р»С‹Рµ Р±Р»РёРєРё (Р»РµР·РІРёРµ С‚РѕРїРѕСЂР°,
# РєР°РјРµРЅРЅС‹Рµ РїР»РёС‚С‹, Р»РёС†Р° СЃС‚Р°С‚СѓР№).
GLOBAL_WHITE = {'gear', 'gearCog', 'spikedWheel', 'sawBlade', 'runeBlue', 'runeCircleBlue', 'runeCirclePurple', 'greenRuneStone'}


def alpha_border(rgb: Image.Image) -> Image.Image:
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
    return Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))


def alpha_global(rgb: Image.Image) -> Image.Image:
    arr = np.asarray(rgb).astype(np.int16)
    alpha = np.where(arr.min(axis=2) >= 244, 0, 255).astype(np.uint8)
    return Image.fromarray(alpha)


def main() -> None:
    rgb = Image.open(SRC).convert('RGB')
    borders = alpha_border(rgb)
    globals_ = alpha_global(rgb)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, x0, y0, x1, y1 in SPRITES:
        pad = 2
        box = (max(0, x0 - pad), max(0, y0 - pad), min(rgb.width, x1 + pad), min(rgb.height, y1 + pad))
        sprite = rgb.crop(box)
        mask = (globals_ if name in GLOBAL_WHITE else borders).crop(box).filter(ImageFilter.MinFilter(3))
        sprite.putalpha(mask)
        target = OUT / f'crypt-{name}.webp'
        sprite.save(target, 'WEBP', lossless=True, quality=100, method=6)
        total += target.stat().st_size
        print(f'{name:20} {sprite.width}x{sprite.height} {target.stat().st_size // 1024} KB')
    print(f'total: {total / 1024 / 1024:.2f} MB, sprites: {len(SPRITES)}')


if __name__ == '__main__':
    main()


