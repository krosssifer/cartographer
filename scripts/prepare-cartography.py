"""Build the embedded WebP materials and sprites (requires Pillow and NumPy)."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/source'
OUTPUT = ROOT / 'src/assets/cartography'
OUTPUT.mkdir(parents=True, exist_ok=True)


def atlas_crop(im, column, row, cols, rows, inset=0):
    w, h = im.width / cols, im.height / rows
    return im.crop(tuple(round(v) for v in (
        (column + inset) * w, (row + inset) * h,
        (column + 1 - inset) * w, (row + 1 - inset) * h,
    )))


def seamless(im):
    arr = np.array(im.resize((640, 640), Image.Resampling.LANCZOS).convert('RGB'), dtype=np.float32)
    for axis in range(2):
        edge = np.swapaxes(arr, axis, 0)
        n = 36
        a, b = edge[:n].copy(), edge[:-n-1:-1].copy()
        w = (0.5 * np.cos(np.linspace(0, np.pi / 2, n)) ** 2)[:, None, None]
        edge[:n] = a * (1 - w) + b * w
        edge[:-n-1:-1] = b * (1 - w) + a * w
    return Image.fromarray(arr.astype(np.uint8))


for atlas, names in (
    ('encounter-ground.jpg', ('grass', 'earth', 'bank', 'water')),
    ('encounter-stone.jpg', ('flagstone', 'bedrock', 'snow', 'peat')),
    ('encounter-interior.jpg', ('caveSoil', 'dunes', 'timber', 'hatching')),
    ('encounter-roofs.jpg', ('thatch', 'shingles', 'terracotta', 'slate')),
    ('settlement-roofs.jpg', ('copper', 'garnet', 'limestone', 'mossRoof')),
):
    im = Image.open(SOURCE / atlas)
    for i, name in enumerate(names):
        seamless(atlas_crop(im, i % 2, i // 2, 2, 2, 0.032)).save(OUTPUT / f'{name}.webp', quality=88)


def transparent(im):
    rgba = np.array(im.convert('RGBA'), dtype=np.float32)
    r, g, b = (rgba[:, :, i] for i in range(3))
    spill = np.minimum(r, b) - g
    strength = np.clip((spill - 14) / 75, 0, 1) * np.clip((np.minimum(r, b) - 55) / 85, 0, 1)
    rgba[:, :, 3] *= 1 - strength
    rgba[:, :, 0] -= strength * 50
    rgba[:, :, 2] -= strength * 62
    rgba[:, :, 3] = np.where(rgba[:, :, 3] < 12, 0, rgba[:, :, 3])
    result = Image.fromarray(np.uint8(np.clip(rgba, 0, 255)))
    box = result.getchannel('A').getbbox()
    return result.crop(box) if box else result


# Cobblestone streets are a finer cut of the flagstone material.
seamless(atlas_crop(Image.open(SOURCE / 'encounter-stone.jpg'), 0, 0, 2, 2, 0.08)).save(OUTPUT / 'cobbles.webp', quality=88)


def sprite(im, name, size=380):
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    im.save(OUTPUT / f'{name}.webp', quality=90, method=6)


canopies = Image.open(SOURCE / 'encounter-canopies.png')
for i, name in enumerate(('oak', 'oakGold', 'pine', 'rock')):
    sprite(transparent(atlas_crop(canopies, i % 2, i // 2, 2, 2)), name)

sprite(transparent(Image.open(SOURCE / 'encounter-chest.png')), 'chest', 300)

old = Image.open(SOURCE / 'objects-atlas.png')
old_names = ('oak', 'pine', 'bush', 'dead', 'rock', 'reed', 'cactus', 'mushroom', 'smallRock')
for name in ('dead', 'cactus', 'reed', 'mushroom', 'bush', 'smallRock'):
    i = old_names.index(name)
    sprite(transparent(atlas_crop(old, i % 3, i // 3, 3, 3)), name, 300)

props = Image.open(SOURCE / 'settlement-props.png')
for i, name in enumerate(('stallRed', 'stallGreen', 'well', 'fountain', 'cart', 'garden')):
    sprite(transparent(atlas_crop(props, i % 3, i // 3, 3, 2)), name, 380)

furniture = Image.open(SOURCE / 'interior-furniture-a.png')
for i, name in enumerate(('table', 'chair', 'bar', 'bed', 'wardrobe', 'hearth', 'rug', 'barrels', 'crates')):
    sprite(transparent(atlas_crop(furniture, i % 3, i // 3, 3, 3, .15 if name == 'chair' else 0)), 'furniture-' + name, 310)

crypt = Image.open(SOURCE / 'crypt-relics.png')
for i, name in enumerate(('openCoffin', 'coffin', 'skeleton', 'altar', 'urns', 'lectern', 'pit', 'bones', 'runeCircle')):
    sprite(transparent(atlas_crop(crypt, i % 3, i // 3, 3, 3)), 'crypt-' + name, 340)