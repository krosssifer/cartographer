"""Убирает светлую кайму у спрайтов листвы прямо в готовых файлах.

Gemini иногда рисует по краю кроны светлую обводку («rim light»), которая после
вырезания фона читается как белый контур. Скрипт прогоняет готовые webp через
те же функции, что и reslice-sprites (remove_white_ridges + remove_boundary_white),
и сохраняет их обратно.

Запуск:
    python scripts/fix-fringe.py [--only oak,oak-2] [--quality 95]
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Файл называется reslice-sprites.py (с дефисом), поэтому импортируем через importlib.
_spec = importlib.util.spec_from_file_location(
    "reslice_sprites", Path(__file__).resolve().parent / "reslice-sprites.py"
)
helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(helpers)

FOLDER = Path(__file__).resolve().parent.parent / "src" / "assets" / "cartography"

# Спрайты, у которых встречается нарисованная светлая обводка листвы.
DEFAULT_TARGETS = [
    "oak", "oak-2", "oakGold", "oakGold-2", "pine", "pine-2", "bush", "bush-2",
    "cactus", "cactus-2", "reed", "reed-2", "dead", "dead-2", "mushroom", "mushroom-2",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Чистка светлой каймы у спрайтов листвы")
    parser.add_argument("--only", default="", help="через запятую: имена без .webp")
    parser.add_argument("--quality", type=int, default=95)
    args = parser.parse_args()

    names = [item.strip() for item in args.only.split(",") if item.strip()] or DEFAULT_TARGETS
    for name in names:
        path = FOLDER / f"{name}.webp"
        if not path.exists():
            print(f"{name}: пропуск (нет файла)")
            continue
        image = Image.open(path).convert("RGBA")
        before = np.asarray(image).astype(np.int16)
        subject = before[:, :, 3] > 0
        share_before = ((subject & (before[:, :, :3].min(axis=2) >= 200)).sum()) / max(1, subject.sum())
        fixed = helpers.remove_white_ridges(helpers.remove_boundary_white(image))
        fixed.save(path, "WEBP", quality=args.quality, method=4)
        after = np.asarray(fixed).astype(np.int16)
        subject_after = after[:, :, 3] > 0
        share_after = ((subject_after & (after[:, :, :3].min(axis=2) >= 200)).sum()) / max(1, subject_after.sum())
        print(f"{name:12s} светлых пикселей {share_before * 100:5.2f}% -> {share_after * 100:5.2f}%")


if __name__ == "__main__":
    main()
