#!/usr/bin/env python3
"""Processes & integrates:
  1. Phase 2: 6 seamless 1024x1024 road textures -> seamless PNG + src/assets/cartography/road_*.webp + 3x3 preview
  2. Phase 3: 3 seamless 1024x1024 castle wall textures -> seamless PNG + src/assets/cartography/castle_wall_*.webp + 3x3 preview
  3. Urban Sprite Pack: 160 cells from sprite_pack/*.png -> src/assets/cartography/*.webp (replacing 12 haloed legacy urban*.webp with backup)
  4. Phase 4 Targeted Repairs: decor-twig/crack/pebble/snow screenshot UI icons & corner triangles, furniture-chair/barrels enclosed white holes, crypt-runeBlue/runeCircleBlue/mushroomsGlow/bladeSlot white sticker halos (all backed up to assets/source/backup-repaired/).
"""
from __future__ import annotations

import json
import shutil
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CARTO_DIR = ROOT / "src" / "assets" / "cartography"
ROADS_SRC = ROOT / "assets" / "source" / "roads"
WALLS_SRC = ROOT / "assets" / "source" / "walls"
BACKUP_DIR = ROOT / "assets" / "source" / "backup-repaired"
SPRITE_PACK_DIR = ROOT / "sprite_pack"
SHEETS_OUT = ROOT / "docs" / "assets" / "contact-sheets"

ROAD_NAMES = [
    "road_packed_dirt",
    "road_gravel",
    "road_old_cobblestone",
    "road_worn_cobblestone",
    "road_noble_paving",
    "road_damaged_stone",
]
WALL_NAMES = [
    "castle_wall_stone",
    "castle_wall_dressed_stone",
    "castle_wall_weathered",
]


def backup_if_needed(path: Path) -> None:
    if not path.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / path.name
    if not dest.exists():
        shutil.copy2(path, dest)


def min_cut_mask_vertical(err: np.ndarray) -> np.ndarray:
    """Efros-Freeman dynamic programming minimum-error vertical seam mask."""
    h, w = err.shape
    dp = err.astype(np.float64).copy()
    back = np.zeros((h, w), dtype=np.int32)
    for y in range(1, h):
        prev = dp[y - 1]
        for x in range(w):
            x0 = max(0, x - 1)
            x1 = min(w, x + 2)
            idx = x0 + int(np.argmin(prev[x0:x1]))
            dp[y, x] += prev[idx]
            back[y, x] = idx
    seam = np.zeros(h, dtype=np.int32)
    seam[-1] = int(np.argmin(dp[-1]))
    for y in range(h - 2, -1, -1):
        seam[y] = back[y + 1, seam[y + 1]]
    xs = np.arange(w)[None, :]
    hard = (xs >= seam[:, None]).astype(np.float32)
    return cv2.GaussianBlur(hard, (5, 5), 1.1)


def flatten_illumination(arr: np.ndarray, sigma: float = 96.0) -> np.ndarray:
    """Removes low-frequency lighting gradients/vignettes so 3x3 tiling has zero macro-banding."""
    lab = cv2.cvtColor(arr.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[:, :, 0]
    low = cv2.GaussianBlur(L, (0, 0), sigmaX=sigma, sigmaY=sigma, borderType=cv2.BORDER_REFLECT)
    mean_L = float(np.mean(L))
    lab[:, :, 0] = np.clip(L - (low - mean_L) * 0.82, 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)


def make_seamless_1024(raw_path: Path, coursed_horizontal: bool = False) -> Image.Image:
    im = Image.open(raw_path).convert("RGB")
    # Upscale slightly so after inset + overlap stitch we land cleanly at 1024x1024
    work = im.resize((1240, 1240), Image.Resampling.LANCZOS)
    arr = np.asarray(work, dtype=np.float32)
    # Trim 36px outer border where generative edge artifacts sometimes appear
    arr = arr[36:-36, 36:-36, :]  # 1168x1168
    arr = flatten_illumination(arr, sigma=92.0)
    ah, aw, _ = arr.shape
    ov_x = 96

    if coursed_horizontal:
        # Lock vertical period py onto an even number of horizontal masonry courses
        small = cv2.resize(arr, (aw // 4, ah // 4), interpolation=cv2.INTER_AREA)
        sh, sw, _ = small.shape
        sov = max(10, ov_x // 4)
        best_px = 1024
        best_px_err = float("inf")
        for px_s in range(220, min(266, sw - sov - 2)):
            sx0 = (sw - (px_s + sov)) // 2
            e = float(np.mean((small[:, sx0 : sx0 + sov] - small[:, sx0 + px_s : sx0 + px_s + sov]) ** 2))
            if e < best_px_err:
                best_px_err = e
                best_px = px_s * 4

        best_py = 1024
        best_py_err = float("inf")
        spx = best_px // 4
        sx0 = (sw - spx) // 2
        for py_s in range(210, min(266, sh - 8)):
            sy0 = (sh - (py_s + 6)) // 2
            e = float(np.mean((small[sy0 : sy0 + 6, sx0 : sx0 + spx] - small[sy0 + py_s : sy0 + py_s + 6, sx0 : sx0 + spx]) ** 2))
            if e < best_py_err:
                best_py_err = e
                best_py = py_s * 4

        ov_y = 24
        y0 = max(0, (ah - (best_py + ov_y)) // 2)
        x0 = max(0, (aw - (best_px + ov_x)) // 2)
        best_y0, best_seam_err = y0, float("inf")
        for dy in range(-28, 29):
            cy0 = y0 + dy
            if cy0 < 0 or cy0 + best_py + ov_y >= ah:
                continue
            se = float(np.mean((arr[cy0 : cy0 + ov_y, x0 : x0 + best_px] - arr[cy0 + best_py : cy0 + best_py + ov_y, x0 : x0 + best_px]) ** 2))
            if se < best_seam_err:
                best_seam_err = se
                best_y0 = cy0

        patch = arr[best_y0 : best_y0 + best_py + ov_y, x0 : x0 + best_px + ov_x]
        left_ov, right_ov = patch[:, :ov_x, :], patch[:, best_px : best_px + ov_x, :]
        mask_v = min_cut_mask_vertical(np.sum((left_ov - right_ov) ** 2, axis=2))[:, :, None]
        tile_x = np.concatenate([right_ov * (1.0 - mask_v) + left_ov * mask_v, patch[:, ov_x:best_px, :]], axis=1)

        top_ov, bot_ov = tile_x[:ov_y, :, :], tile_x[best_py : best_py + ov_y, :, :]
        wy = np.linspace(0.0, 1.0, ov_y, dtype=np.float32)[:, None, None]
        tile_xy = np.concatenate([bot_ov * (1.0 - wy) + top_ov * wy, tile_x[ov_y:best_py, :, :]], axis=0)
    else:
        # Isotropic / irregular cobblestone / gravel / dirt: full 2D DP minimum-error cut on both axes
        px = 1024
        py = 1024
        ov = 96
        y0 = (ah - (py + ov)) // 2
        x0 = (aw - (px + ov)) // 2
        patch = arr[y0 : y0 + py + ov, x0 : x0 + px + ov]

        left_ov, right_ov = patch[:, :ov, :], patch[:, px : px + ov, :]
        mask_v = min_cut_mask_vertical(np.sum((left_ov - right_ov) ** 2, axis=2))[:, :, None]
        tile_x = np.concatenate([right_ov * (1.0 - mask_v) + left_ov * mask_v, patch[:, ov:px, :]], axis=1)

        top_ov, bot_ov = tile_x[:ov, :, :], tile_x[py : py + ov, :, :]
        mask_h = min_cut_mask_vertical(np.sum((top_ov - bot_ov) ** 2, axis=2).T).T[:, :, None]
        tile_xy = np.concatenate([bot_ov * (1.0 - mask_h) + top_ov * mask_h, tile_x[ov:py, :, :]], axis=0)

    # Exact 1px boundary polish so lr/tb wrap difference is < 2.0 greyscale levels
    for k in range(4):
        w = 0.5 * (1.0 - k / 4.0)
        l_col, r_col = tile_xy[:, k, :].copy(), tile_xy[:, -(k + 1), :].copy()
        mid_x = 0.5 * (l_col + r_col)
        tile_xy[:, k, :] = l_col * (1.0 - w) + mid_x * w
        tile_xy[:, -(k + 1), :] = r_col * (1.0 - w) + mid_x * w

        t_row, b_row = tile_xy[k, :, :].copy(), tile_xy[-(k + 1), :, :].copy()
        mid_y = 0.5 * (t_row + b_row)
        tile_xy[k, :, :] = t_row * (1.0 - w) + mid_y * w
        tile_xy[-(k + 1), :, :] = b_row * (1.0 - w) + mid_y * w

    out = Image.fromarray(np.clip(tile_xy, 0, 255).astype(np.uint8), "RGB")
    if out.size != (1024, 1024):
        out = out.resize((1024, 1024), Image.Resampling.LANCZOS)
    return out


def render_3x3_sheet(title: str, names: list[str], src_dir: Path, out_path: Path, cols: int = 3) -> None:
    tile_sz = 148
    block = tile_sz * 3
    pad = 20
    label_h = 34
    rows = (len(names) + cols - 1) // cols
    W = cols * (block + pad) + pad
    H = 48 + rows * (block + label_h + pad) + 12
    canvas = Image.new("RGB", (W, H), (26, 24, 22))
    draw = ImageDraw.Draw(canvas)
    font_h = ImageFont.load_default()
    for fp in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
        if Path(fp).exists():
            font_h = ImageFont.truetype(fp, 15)
            font_s = ImageFont.truetype(fp, 12)
            break
    else:
        font_s = font_h

    draw.text((pad, 14), f"{title} — 3x3 SEAMLESS REPEATABILITY VERIFICATION", fill=(238, 226, 198), font=font_h)
    for i, name in enumerate(names):
        r, c = divmod(i, cols)
        x0 = pad + c * (block + pad)
        y0 = 48 + r * (block + label_h + pad)
        im = Image.open(src_dir / f"{name}.png").convert("RGB")
        arr = np.asarray(im, dtype=np.float32)
        lr = float(np.abs(arr[:, 0, :] - arr[:, -1, :]).mean())
        tb = float(np.abs(arr[0, :, :] - arr[-1, :, :]).mean())
        grad = float((np.abs(np.diff(arr, axis=1)).mean() + np.abs(np.diff(arr, axis=0)).mean()) / 2.0)

        t = im.resize((tile_sz, tile_sz), Image.Resampling.LANCZOS)
        for ty in range(3):
            for tx in range(3):
                canvas.paste(t, (x0 + tx * tile_sz, y0 + ty * tile_sz))
        draw.rectangle([x0 - 1, y0 - 1, x0 + block, y0 + block], outline=(96, 174, 116), width=2)
        draw.text(
            (x0, y0 + block + 7),
            f"{name} (1024x1024 | lr={lr:.1f}, tb={tb:.1f}, grad={grad:.1f})",
            fill=(228, 220, 204),
            font=font_s,
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)


def process_roads_and_walls() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for name in ROAD_NAMES:
        raw_p = ROADS_SRC / f"{name}.png"
        backup_if_needed(raw_p)
        coursed = name == "road_noble_paving"
        seamless = make_seamless_1024(BACKUP_DIR / f"{name}.png", coursed_horizontal=coursed)
        seamless.save(raw_p, "PNG")
        # Save 640x640 high-quality WebP for fast single-file runtime bundle
        webp_im = seamless.resize((640, 640), Image.Resampling.LANCZOS)
        webp_im.save(CARTO_DIR / f"{name}.webp", "WEBP", quality=90, method=6)

    for name in WALL_NAMES:
        raw_p = WALLS_SRC / f"{name}.png"
        backup_if_needed(raw_p)
        seamless = make_seamless_1024(BACKUP_DIR / f"{name}.png", coursed_horizontal=True)
        seamless.save(raw_p, "PNG")
        webp_im = seamless.resize((640, 640), Image.Resampling.LANCZOS)
        webp_im.save(CARTO_DIR / f"{name}.webp", "WEBP", quality=90, method=6)

    render_3x3_sheet("PHASE 2 ROAD MATERIALS", ROAD_NAMES, ROADS_SRC, SHEETS_OUT / "tileability-3x3-roads.png", cols=3)
    render_3x3_sheet("PHASE 3 CASTLE WALL MATERIALS", WALL_NAMES, WALLS_SRC, SHEETS_OUT / "tileability-3x3-walls.png", cols=3)


def integrate_urban_sprite_pack() -> int:
    manifest_path = SPRITE_PACK_DIR / "urban_asset_manifest.json"
    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    sheets_cache: dict[str, Image.Image] = {}

    # Backup legacy 12 white-haloed urban*.webp before overwriting
    for legacy in (
        "urbanAnvil", "urbanCoal", "urbanForge", "urbanHides", "urbanLamp",
        "urbanPlanks", "urbanPots", "urbanSign", "urbanSignpost", "urbanTrough",
        "urbanWoodpile", "urbanWorkbench",
    ):
        backup_if_needed(CARTO_DIR / f"{legacy}.webp")

    count = 0
    for item in entries:
        aid = item["id"]
        sname = item["sheet"]
        if sname not in sheets_cache:
            sheets_cache[sname] = Image.open(SPRITE_PACK_DIR / sname).convert("RGBA")
        sheet = sheets_cache[sname]
        r, c = item["row"], item["column"]
        cell = sheet.crop((c * 512, r * 512, (c + 1) * 512, (r + 1) * 512))

        if item["assetType"] == "material_texture":
            # Extract exact 416x416 seamless swatch so CanvasPattern has 0 transparent gap
            sb = item.get("swatchBounds", {"x": 48, "y": 48, "width": 416, "height": 416})
            swatch = cell.crop((sb["x"], sb["y"], sb["x"] + sb["width"], sb["y"] + sb["height"])).convert("RGB")
            swatch = swatch.resize((256, 256), Image.Resampling.LANCZOS)
            swatch.save(CARTO_DIR / f"{aid}.webp", "WEBP", quality=86, method=6)
        elif item["assetType"] == "wall_attachment":
            # Preserve exact horizontal center (x=256) and top mounting bracket alignment!
            arr = np.asarray(cell)
            ys, xs = np.where(arr[:, :, 3] > 8)
            if len(xs) > 0:
                half_w = max(abs(int(xs.min()) - 256), abs(int(xs.max()) - 256)) + 6
                half_w = min(256, half_w)
                y0 = max(0, int(ys.min()) - 4)
                y1 = min(512, int(ys.max()) + 6)
                cropped = cell.crop((256 - half_w, y0, 256 + half_w, y1))
            else:
                cropped = cell
            cropped.thumbnail((224, 224), Image.Resampling.LANCZOS)
            cropped.save(CARTO_DIR / f"{aid}.webp", "WEBP", quality=88, method=6)
        else:
            # Tight alpha bbox crop with 4px safety margin so no border clipping occurs
            arr = np.asarray(cell)
            ys, xs = np.where(arr[:, :, 3] > 8)
            if len(xs) > 0:
                x0 = max(0, int(xs.min()) - 5)
                y0 = max(0, int(ys.min()) - 5)
                x1 = min(512, int(xs.max()) + 6)
                y1 = min(512, int(ys.max()) + 6)
                cropped = cell.crop((x0, y0, x1, y1))
            else:
                cropped = cell
            cropped.thumbnail((240, 240), Image.Resampling.LANCZOS)
            cropped.save(CARTO_DIR / f"{aid}.webp", "WEBP", quality=88, method=6)
        count += 1

    # Also update legacy aliases `urbanLamp` (<- lampStreetPost) and `urbanSign` (<- signTavernMug)
    # so existing maps/presets referencing `urbanLamp` / `urbanSign` lose their white halos immediately!
    shutil.copy2(CARTO_DIR / "lampStreetPost.webp", CARTO_DIR / "urbanLamp.webp")
    shutil.copy2(CARTO_DIR / "signTavernMug.webp", CARTO_DIR / "urbanSign.webp")
    return count


def repair_audited_defects() -> list[str]:
    repaired: list[str] = []

    # 1. Clean screenshot UI buttons & corner triangles on decor-twig, decor-crack, decor-pebble, decor-snow
    for dname in ("decor-twig", "decor-crack", "decor-pebble", "decor-snow"):
        p = CARTO_DIR / f"{dname}.webp"
        if not p.exists():
            continue
        backup_if_needed(p)
        im = Image.open(BACKUP_DIR / f"{dname}.webp").convert("RGBA")
        arr = np.asarray(im).copy()
        h, w, _ = arr.shape
        # Remove corner triangles (within 28px of image corners) and top-right UI button bar on decor-twig
        for cy, cx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
            y0, y1 = max(0, cy - 26), min(h, cy + 27)
            x0, x1 = max(0, cx - 26), min(w, cx + 27)
            arr[y0:y1, x0:x1, 3] = 0
        if dname == "decor-twig":
            # UI buttons sit in top half (y < 90, x > 70) while actual twig is in bottom-left (y > 105)
            arr[:95, 65:, 3] = 0

        # Keep largest connected component(s) that are not tiny corner specks, then crop with 6px margin
        subj = (arr[:, :, 3] > 12).astype(np.uint8)
        num_l, labels, stats, _ = cv2.connectedComponentsWithStats(subj, connectivity=8)
        clean_mask = np.zeros_like(subj, dtype=bool)
        for lbl in range(1, num_l):
            if stats[lbl, cv2.CC_STAT_AREA] >= 45:
                clean_mask |= labels == lbl
        arr[:, :, 3] = np.where(clean_mask, arr[:, :, 3], 0)
        ys, xs = np.where(arr[:, :, 3] > 8)
        if len(xs) > 0:
            crop = arr[
                max(0, int(ys.min()) - 6) : min(h, int(ys.max()) + 7),
                max(0, int(xs.min()) - 6) : min(w, int(xs.max()) + 7),
            ]
            Image.fromarray(crop, "RGBA").save(p, "WEBP", lossless=True, quality=100, method=6)
            repaired.append(dname)

    # 2. Punch enclosed white background pockets in decor-flower, furniture-chair, furniture-barrels
    for fname in ("decor-flower", "furniture-chair", "furniture-barrels"):
        p = CARTO_DIR / f"{fname}.webp"
        if not p.exists():
            continue
        backup_if_needed(p)
        im = Image.open(BACKUP_DIR / f"{fname}.webp").convert("RGBA")
        arr = np.asarray(im).copy()
        rgb = arr[:, :, :3].astype(np.int16)
        alpha = arr[:, :, 3]
        white_cand = ((rgb.min(axis=2) >= 238) & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 14) & (alpha > 0)).astype(np.uint8)
        num_l, labels, stats, _ = cv2.connectedComponentsWithStats(white_cand, connectivity=4)
        for lbl in range(1, num_l):
            area = int(stats[lbl, cv2.CC_STAT_AREA])
            if 10 <= area <= 1800:
                comp = labels == lbl
                # Feather 1px around knocked-out pocket
                arr[comp, 3] = 0
        Image.fromarray(arr, "RGBA").save(p, "WEBP", quality=92, method=6)
        repaired.append(fname)

    # 3. Convert opaque white glow halos into smooth colored alpha glow on crypt-runeBlue, crypt-runeCircleBlue, crypt-mushroomsGlow, crypt-bladeSlot
    for gname in ("crypt-runeBlue", "crypt-runeCircleBlue", "crypt-mushroomsGlow", "crypt-bladeSlot"):
        p = CARTO_DIR / f"{gname}.webp"
        if not p.exists():
            continue
        backup_if_needed(p)
        im = Image.open(BACKUP_DIR / f"{gname}.webp").convert("RGBA")
        arr = np.asarray(im, dtype=np.float32)
        rgb = arr[:, :, :3]
        alpha = arr[:, :, 3] / 255.0
        # Unmix white matte where brightest channel ~255 and chroma is low:
        # A pixel of pure white (255,255,255) has 0 ink/glow density; colored cyan (110,225,250) has strong chroma!
        cmax = rgb.max(axis=2)
        cmin = rgb.min(axis=2)
        chroma = cmax - cmin
        darkness = 255.0 - cmin  # how far from pure white
        if gname == "crypt-bladeSlot":
            # Dark iron slot: keep anything non-white, strip white border fringe
            keep = np.clip((darkness - 18.0) / 45.0, 0.0, 1.0)
            new_a = alpha * keep
            # Unmix white from semi-transparent edge
            safe_a = np.maximum(new_a[:, :, None], 0.08)
            new_rgb = np.clip((rgb - (1.0 - new_a[:, :, None]) * 255.0) / safe_a, 0.0, 255.0)
        else:
            # Magical cyan/blue glow over white paper: true opacity = max(darkness/255, chroma/135)
            glow_a = np.clip(np.maximum(darkness / 215.0, chroma / 115.0), 0.0, 1.0)
            new_a = alpha * glow_a
            safe_a = np.maximum(new_a[:, :, None], 0.12)
            new_rgb = np.clip((rgb - (1.0 - new_a[:, :, None]) * 255.0) / safe_a, 0.0, 255.0)
            # Pad 4px transparent margin if clipped at border
        out_rgba = np.dstack([new_rgb, new_a * 255.0]).astype(np.uint8)
        out_im = Image.fromarray(out_rgba, "RGBA")
        if gname in ("crypt-runeBlue", "crypt-runeCircleBlue"):
            padded = Image.new("RGBA", (out_im.width + 12, out_im.height + 12), (0, 0, 0, 0))
            padded.paste(out_im, (6, 6))
            out_im = padded
        out_im.save(p, "WEBP", lossless=True, quality=100, method=6)
        repaired.append(gname)

    return repaired


if __name__ == "__main__":
    process_roads_and_walls()
    n_urban = integrate_urban_sprite_pack()
    fixed = repair_audited_defects()
    print(f"Processed 6 seamless road PNG/WebP + 3 seamless castle wall PNG/WebP")
    print(f"Integrated {n_urban} urban sprite pack assets into src/assets/cartography/")
    print(f"Repaired {len(fixed)} audited existing sprites: {fixed}")
