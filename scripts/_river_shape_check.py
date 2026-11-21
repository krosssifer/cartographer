"""Проверка формы воды: повторяет новый drawRiverRibbon (blur-mask) из render.ts."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

CS = 22
COLORS = {
    'grass': (122, 143, 86), 'darkGrass': (96, 118, 70), 'dirt': (168, 132, 90),
    'sand': (206, 184, 138), 'mud': (124, 110, 86), 'snow': (232, 236, 240),
    'water': (116, 158, 196), 'deepWater': (86, 124, 168), 'road': (196, 168, 118),
    'bridge': (150, 116, 76), 'wall': (70, 70, 70), 'void': (28, 28, 30),
    'plaza': (186, 176, 158), 'caveFloor': (150, 136, 116), 'floor': (168, 156, 140),
    'buildingFloor': (150, 138, 122), 'buildingWall': (92, 78, 62), 'roof': (128, 92, 74),
    'door': (110, 78, 54), 'caveWall': (58, 52, 48), 'ice': (200, 220, 232),
}


def render(seed):
    data = json.loads(Path('.tmp/scene.json').read_text(encoding='utf-8'))[seed]
    width, height, rows = data['width'], data['height'], data['rows']
    W, H = width * CS, height * CS

    base = Image.new('RGB', (W, H), (30, 30, 30))
    draw = ImageDraw.Draw(base)
    for y, row in enumerate(rows):
        for x, terrain in enumerate(row):
            color = COLORS.get(terrain, (200, 0, 200))
            if terrain in ('water', 'deepWater'):
                color = (110, 132, 78)  # суша под водой: чтобы видеть, что нарисует маска
            draw.rectangle([x * CS, y * CS, x * CS + CS - 1, y * CS + CS - 1], fill=color)

    mask = Image.new('L', (W, H), 0)
    mdraw = ImageDraw.Draw(mask)
    water_cells = []
    for y, row in enumerate(rows):
        for x, terrain in enumerate(row):
            if terrain in ('water', 'deepWater'):
                water_cells.append((x, y))
                mdraw.rectangle([x * CS, y * CS, x * CS + CS - 1, y * CS + CS - 1], fill=255)
    if not water_cells:
        base.save('C:/AbsoluteDND/preview-river-shape-%s.png' % seed)
        return

    grain = mask.filter(ImageFilter.GaussianBlur(CS * 0.42))
    # аддитивное накопление трёх слоёв: alpha = 1 - (1 - a)^3
    soft = grain.point(lambda v: min(255, int(255 * (1 - (1 - v / 255.0) ** 3))))

    ring = mask.filter(ImageFilter.GaussianBlur(CS * 0.95))
    ring = Image.composite(Image.new('L', (W, H), 0), ring, mask)  # ring * (1 - mask)
    ring = ring.point(lambda v: int(v * 0.92))

    # вода: текстура-заливка под мягкой маской
    water_layer = Image.new('RGB', (W, H), (116, 158, 196))
    water_layer = Image.composite(water_layer, base, soft)

    base = Image.composite(Image.new('RGB', (W, H), (206, 184, 138)), base, ring)
    base = Image.composite(water_layer, base, soft)

    base.save('C:/AbsoluteDND/preview-river-shape-%s.png' % seed)
    print(seed, 'cells', len(water_cells))


for name in ('583921', '777001', '424242'):
    render(name)
