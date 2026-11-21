"""Делает текстуры по-настоящему бесшовными (периодическими).

Идея: заменяем mirror-тайлинг нормальным wrap-тайлингом, но сначала убираем
разрыв на швах. Для каждой пары противоположных кромок (левая/правая,
верхняя/нижняя) в узкой полосе B пикселей значения плавно сходятся к среднему
пары, поэтому на стыке текстура совпадает точно, а полоса остаётся
незаметной (её ширина ~6 %).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BAND = 0.06  # доля размера под сглаживаемую полосу
MATERIALS = [
    'grass', 'earth', 'bank', 'water', 'waterDeep', 'waterRapids', 'flagstone',
    'bedrock', 'snow', 'peat', 'caveSoil', 'dunes', 'hatching', 'cobbles',
    'thatch', 'shingles', 'terracotta', 'slate',
]

root = Path('src/assets/cartography')
backup = Path('assets/source/generated/backup-textures')
backup.mkdir(parents=True, exist_ok=True)


def blend_band(a: np.ndarray, axis: int) -> np.ndarray:
    size = a.shape[axis]
    band = max(8, int(round(size * BAND)))
    idx = np.arange(band, dtype=np.float32)
    weight = (1.0 - idx / band)  # 1 у самой кромки, 0 на границе полосы
    weight = (weight * weight * (3 - 2 * weight))[:, None]  # сглаженная (smoothstep)
    out = a.copy()
    for k, w in enumerate(weight[:, 0]):
        if axis == 1:  # горизонтальные швы: левая и правая кромки
            left, right = out[:, k, :], out[:, size - 1 - k, :]
            mixed = (left + right) / 2.0
            out[:, k, :] = left * (1 - w) + mixed * w
            out[:, size - 1 - k, :] = right * (1 - w) + mixed * w
        else:  # вертикальные швы: верхняя и нижняя кромки
            top, bottom = out[k, :, :], out[size - 1 - k, :, :]
            mixed = (top + bottom) / 2.0
            out[k, :, :] = top * (1 - w) + mixed * w
            out[size - 1 - k, :, :] = bottom * (1 - w) + mixed * w
    return out


def seam_metric(a: np.ndarray) -> tuple[float, float, float]:
    lr = np.abs(a[:, 0, :] - a[:, -1, :]).mean()
    tb = np.abs(a[0, :, :] - a[-1, :, :]).mean()
    grad = (np.abs(np.diff(a, axis=1)).mean() + np.abs(np.diff(a, axis=0)).mean()) / 2
    return lr, tb, grad


def process(name: str) -> None:
    path = root / (name + '.webp')
    if not path.exists():
        print(f'{name:10s} missing')
        return
    image = Image.open(path).convert('RGB')
    data = np.asarray(image).astype(np.float32)
    lr0, tb0, grad = seam_metric(data)
    fixed = blend_band(blend_band(data, axis=1), axis=0)
    lr1, tb1, _ = seam_metric(fixed)
    target = backup / f'{name}.webp'
    if not target.exists():
        image.save(target, 'WEBP', quality=95)
    out = Image.fromarray(np.clip(fixed, 0, 255).astype(np.uint8))
    out.save(path, 'WEBP', quality=95, method=6)
    print(f'{name:10s} lr {lr0:5.1f}->{lr1:4.1f}  tb {tb0:5.1f}->{tb1:4.1f}  (grad {grad:4.1f})')


for material in MATERIALS:
    process(material)
