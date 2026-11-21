#!/usr/bin/env python3
"""Нарезка сгенерированных спрайт-листов на отдельные WebP-файлы.

Поддерживает три режима:
  auto  — ищет предметы на белом фоне (связные области) и вырезает каждый;
  grid  — режет лист на равные ячейки rows×cols;
  quad  — режет на 2×2 (удобно для бесшовных текстур).

Примеры:
  python scripts/slice-sheet.py sprites/tree.jpg -o src/assets/cartography \\
      --names oak,oakGold,pine,bush --mode quad

  python scripts/slice-sheet.py sprites/dungeon_arch.jpg -o /tmp/out \\
      --mode auto --prefix crypt- --min-area 0.0003

  python scripts/slice-sheet.py sprites/city.jpg -o src/assets/cartography \\
      --names wagon,wagonCovered,wheelbarrow,wheelbarrowStone --mode grid --rows 4 --cols 4

Если имя уже занято, файл получает суффикс варианта: oak.webp, oak-2.webp, oak-3.webp —
именно такой формат подхватывает artPick/artVariants в src/lib/assets.ts.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Консоль Windows может быть в cp1251 — принудительно печатаем в UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WHITE = 246


def load_rgba(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGBA")
    return np.array(image)


def object_mask(arr: np.ndarray, white: int) -> np.ndarray:
    """Маска «не белого»: всё, что заметно отличается от белого фона."""
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    near_white = np.min(rgb, axis=2) >= white
    return (~(near_white & (alpha > 250))).astype(np.uint8)


def label_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """Простая 8-связная разметка областей (без scipy)."""
    height, width = mask.shape
    labels = np.zeros((height, width), dtype=np.int32)
    current = 0
    stack: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or labels[y, x]:
                continue
            current += 1
            labels[y, x] = current
            stack.append((y, x))
            while stack:
                cy, cx = stack.pop()
                for ny in (cy - 1, cy, cy + 1):
                    if ny < 0 or ny >= height:
                        continue
                    for nx in (cx - 1, cx, cx + 1):
                        if nx < 0 or nx >= width:
                            continue
                        if mask[ny, nx] and not labels[ny, nx]:
                            labels[ny, nx] = current
                            stack.append((ny, nx))
    return labels, current


def trim_to_object(arr: np.ndarray, white: int, pad: int) -> np.ndarray | None:
    """Обрезает картинку по содержимому и убирает белый фон."""
    mask = object_mask(arr, white)
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
    crop = arr[y0:y1, x0:x1].copy()
    rgb = crop[:, :, :3].astype(np.int16)
    alpha = crop[:, :, 3]
    near_white = np.min(rgb, axis=2) >= white
    crop[:, :, 3] = np.where(near_white, 0, alpha)
    return crop


def split_grid(arr: np.ndarray, rows: int, cols: int) -> list[np.ndarray]:
    height, width = arr.shape[:2]
    cells = []
    for r in range(rows):
        for c in range(cols):
            y0, y1 = round(r * height / rows), round((r + 1) * height / rows)
            x0, x1 = round(c * width / cols), round((c + 1) * width / cols)
            cells.append(arr[y0:y1, x0:x1])
    return cells


def split_quad(arr: np.ndarray) -> list[np.ndarray]:
    return split_grid(arr, 2, 2)


def unique_name(directory: Path, name: str) -> tuple[Path, str]:
    """Возвращает свободное имя: oak → oak, oak-2, oak-3 …"""
    path = directory / f"{name}.webp"
    if not path.exists():
        return path, name
    index = 2
    while True:
        candidate = directory / f"{name}-{index}.webp"
        if not candidate.exists():
            return candidate, f"{name}-{index}"
        index += 1


def save_webp(array: np.ndarray, path: Path, lossy: bool, max_size: int, quality: int) -> None:
    image = Image.fromarray(array, mode="RGBA")
    if max_size and max(image.size) > max_size:
        scale = max_size / max(image.size)
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                             Image.LANCZOS)
    if lossy:
        image.save(path, "WEBP", quality=quality, method=6)
    else:
        image.save(path, "WEBP", lossless=True, quality=100, method=6)


def auto_cells(arr: np.ndarray, white: int, min_area: float, pad: int) -> list[np.ndarray]:
    """Ищет отдельные предметы: размыкает близкие части, режет по bbox."""
    mask = object_mask(arr, white)
    # Лёгкая дилатация, чтобы части одного предмета (ножка + столешница) не
    # распались на два спрайта.
    blur = Image.fromarray(mask * 255).filter(ImageFilter.MaxFilter(9))
    grown = (np.array(blur) > 40).astype(np.uint8)
    labels, count = label_components(grown)
    total = arr.shape[0] * arr.shape[1]
    cells: list[tuple[int, int, int, np.ndarray]] = []
    for label in range(1, count + 1):
        component = labels == label
        area = float(component.sum())
        if area / total < min_area:
            continue
        ys, xs = np.where(component)
        y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
        x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
        crop = arr[y0:y1, x0:x1].copy()
        rgb = crop[:, :, :3].astype(np.int16)
        near_white = np.min(rgb, axis=2) >= white
        crop[:, :, 3] = np.where(near_white, 0, crop[:, :, 3])
        cells.append((int(y0), int(ys.min()), int(x0), crop))
    # Сортируем как читаем: сначала полосы по вертикали, внутри полосы — слева
    # направо. Полоса определяется по верхней границе с допуском в 12 % высоты.
    tolerance = max(12, arr.shape[0] * 0.12)
    cells.sort(key=lambda item: item[1])
    bands: list[list[tuple[int, int, int, np.ndarray]]] = []
    for cell in cells:
        if bands and cell[1] - bands[-1][0][1] <= tolerance:
            bands[-1].append(cell)
        else:
            bands.append([cell])
    ordered: list[np.ndarray] = []
    for band in bands:
        band.sort(key=lambda item: item[2])
        ordered.extend(item[3] for item in band)
    return ordered


def main() -> None:
    parser = argparse.ArgumentParser(description="Нарезка спрайт-листов на WebP")
    parser.add_argument("source", type=Path, help="исходный лист (jpg/png/webp)")
    parser.add_argument("-o", "--out", type=Path, required=True, help="каталог для результата")
    parser.add_argument("--mode", choices=["auto", "grid", "quad"], default="auto")
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument("--cols", type=int, default=2)
    parser.add_argument("--names", default="", help="имена через запятую (по порядку ячеек)")
    parser.add_argument("--prefix", default="", help="префикс для auto-режима, если имён нет")
    parser.add_argument("--white", type=int, default=WHITE, help="порог белого фона 0–255")
    parser.add_argument("--min-area", type=float, default=0.0004,
                        help="минимальная доля площади листа для auto-режима")
    parser.add_argument("--pad", type=int, default=6, help="отступ вокруг спрайта, px")
    parser.add_argument("--lossy", action="store_true", help="сжимать с потерями (мельче файлы)")
    parser.add_argument("--quality", type=int, default=90, help="качество lossy WebP (по умолчанию 90)")
    parser.add_argument("--max-size", type=int, default=0,
                        help="уменьшить спрайт до N px по большей стороне (0 — не трогать)")
    parser.add_argument("--force", action="store_true",
                        help="перезаписывать существующие файлы вместо суффикса -2, -3")
    args = parser.parse_args()

    arr = load_rgba(args.source)
    args.out.mkdir(parents=True, exist_ok=True)
    names = [name.strip() for name in args.names.split(",") if name.strip()]

    def maybe_trim(cell: np.ndarray) -> np.ndarray:
        trimmed = trim_to_object(cell, args.white, args.pad)
        return cell if trimmed is None else trimmed

    if args.mode == "quad":
        cells = [maybe_trim(cell) for cell in split_quad(arr)]
    elif args.mode == "grid":
        cells = [maybe_trim(cell) for cell in split_grid(arr, args.rows, args.cols)]
    else:
        cells = auto_cells(arr, args.white, args.min_area, args.pad)

    if not cells:
        raise SystemExit("Ничего не найдено: проверьте --white / --min-area / --mode")

    written = []
    for index, cell in enumerate(cells):
        if names:
            name = names[index] if index < len(names) else f"{names[0]}-{index + 1}"
        else:
            name = f"{args.prefix}part-{index + 1}"
        if args.force:
            path, final = args.out / f"{name}.webp", name
        else:
            path, final = unique_name(args.out, name)
        save_webp(cell, path, args.lossy, args.max_size, args.quality)
        written.append({"name": final, "file": str(path), "width": int(cell.shape[1]),
                        "height": int(cell.shape[0])})

    manifest = args.out / f"_manifest-{args.source.stem}.json"
    manifest.write_text(json.dumps({"source": str(args.source), "mode": args.mode,
                                    "sprites": written}, ensure_ascii=False, indent=2), "utf-8")
    print(f"Готово: {len(written)} спрайтов -> {args.out}")
    for item in written:
        print(f"  {item['name']}: {item['width']}×{item['height']}")


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent.parent)
    main()
