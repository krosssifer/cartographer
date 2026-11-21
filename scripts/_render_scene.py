import json, math
from PIL import Image, ImageDraw

CS = 22
data = json.load(open('.tmp/scene.json', encoding='utf-8'))

COLORS = {
    'grass': (122, 148, 96), 'darkGrass': (96, 122, 78), 'dirt': (156, 130, 95),
    'sand': (200, 184, 141), 'mud': (108, 96, 72), 'water': (92, 148, 186),
    'deepWater': (62, 112, 152), 'rock': (126, 126, 124), 'bridge': (128, 94, 58),
    'road': (178, 158, 122), 'snow': (226, 228, 226), 'caveFloor': (110, 102, 94),
    'wall': (70, 70, 70), 'void': (28, 28, 30), 'ice': (186, 216, 226),
    'plaza': (186, 176, 158), 'floor': (168, 156, 140), 'buildingFloor': (150, 138, 122),
    'buildingWall': (92, 78, 62), 'roof': (128, 92, 74), 'door': (110, 78, 54), 'caveWall': (58, 52, 48),
}

for seed, payload in data.items():
    w, h = payload['width'], payload['height']
    img = Image.new('RGB', (w * CS, h * CS), (24, 26, 24))
    draw = ImageDraw.Draw(img, 'RGBA')
    for y in range(h):
        for x in range(w):
            t = payload['rows'][y][x]
            draw.rectangle([x * CS, y * CS, (x + 1) * CS - 1, (y + 1) * CS - 1], fill=COLORS.get(t, (255, 0, 255)))
    plan = payload['plan']
    # мосты: повёрнутые настилы
    for bridge in plan['bridges']:
        cx, cy = bridge['x'] * CS, bridge['y'] * CS
        length, width = bridge['length'] * CS, bridge['width'] * CS
        ang = -bridge['angle']
        pts = []
        for sx, sy in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]:
            px = cx + (sx * length) * math.cos(ang) - (sy * width) * math.sin(ang)
            py = cy + (sx * length) * math.sin(ang) + (sy * width) * math.cos(ang)
            pts.append((px, py))
        draw.polygon(pts, fill=(146, 108, 66), outline=(70, 48, 28))
    # дорога
    for path in plan['roads']:
        pts = [(p['x'] * CS + CS / 2, p['y'] * CS + CS / 2) for p in path['points']]
        if len(pts) > 1:
            draw.line(pts, fill=(196, 120, 70), width=2)
    comp = plan['composition']
    if comp:
        for space in comp['openSpaces']:
            r = space['radius'] * CS
            cx, cy = space['x'] * CS, space['y'] * CS
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(240, 220, 110, 220), width=2)
        for mass in comp['masses']:
            r = mass['radius'] * CS
            cx, cy = mass['x'] * CS, mass['y'] * CS
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(120, 200, 120, 90), width=2)
        for zone in comp['transitions']:
            r = zone['radius'] * CS
            cx, cy = zone['x'] * CS, zone['y'] * CS
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(150, 200, 255, 60), width=1)
    scene = plan['scene']
    if scene and scene.get('crossing'):
        cx, cy = scene['crossing']['x'] * CS + CS / 2, scene['crossing']['y'] * CS + CS / 2
        draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=(120, 240, 255), width=2)
        draw.line([cx - 10, cy, cx + 10, cy], fill=(120, 240, 255), width=1)
        draw.line([cx, cy - 10, cx, cy + 10], fill=(120, 240, 255), width=1)
    for tree in payload['trees']:
        r = max(3, tree['r'] * CS * 0.55)
        cx, cy = tree['x'] * CS + CS / 2, tree['y'] * CS + CS / 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(46, 78, 48, 235), outline=(20, 34, 20))
    for rock in payload['rocks']:
        r = max(2, rock['r'] * CS * 0.45)
        cx, cy = rock['x'] * CS + CS / 2, rock['y'] * CS + CS / 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(132, 132, 130, 240), outline=(60, 60, 60))
    report = plan.get('report') or {}
    print(seed, 'ok', report.get('ok'), 'water%', round(100 * sum(1 for row in payload['rows'] for t in row if t in ('water', 'deepWater')) / (w * h), 1))
    img.save(f'C:/AbsoluteDND/preview-scene-{seed}.png')
