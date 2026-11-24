#!/usr/bin/env python3
"""Phase 1 & Phase 5 Comprehensive Graphical Asset Audit for Cartographer.

Scans every graphical resource in the repository:
  - src/assets/cartography/*.webp (production embedded assets)
  - assets/source/* (original source sprite sheets and atlases)
  - public/*.svg (static public icons)
  - Embedded SVG vector registries (furnitureVectors.ts, cryptVectors.ts, chests.ts, cryptArt.ts)
  - sprite_pack/*.png (newly authored 2048x2048 urban sprite sheets)
  - docs/**/*.{png,jpg} (documentation & verification renders)

Produces:
  - docs/assets/asset-manifest.json
  - docs/assets/contact-sheets/*.png (checkerboard contact sheets with labels, dims, usage & issues)
  - Summary JSON printed to stdout for ASSET-AUDIT.md / asset-usage-map.md / asset-style-guide.md
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CARTO_DIR = ROOT / "src" / "assets" / "cartography"
SOURCE_DIR = ROOT / "assets" / "source"
PUBLIC_DIR = ROOT / "public"
SPRITE_PACK_DIR = ROOT / "sprite_pack"
DOCS_DIR = ROOT / "docs"
OUT_DIR = DOCS_DIR / "assets"
SHEETS_OUT = OUT_DIR / "contact-sheets"


def load_font(size: int = 11) -> ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def dhash64(im: Image.Image) -> int:
    # Composite over neutral mid-grey so alpha silhouettes hash consistently
    rgba = im.convert("RGBA")
    bg = Image.new("RGBA", rgba.size, (128, 128, 128, 255))
    comp = Image.alpha_composite(bg, rgba).convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    arr = np.asarray(comp, dtype=np.int16)
    diff = arr[:, 1:] > arr[:, :-1]
    bits = 0
    for b in diff.flatten():
        bits = (bits << 1) | int(bool(b))
    return bits


def hamming64(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def checkerboard(w: int, h: int, cell: int = 12, c1=(46, 44, 40), c2=(64, 60, 54)) -> Image.Image:
    yy, xx = np.indices((h, w))
    mask = ((xx // cell) + (yy // cell)) % 2 == 0
    out = np.zeros((h, w, 3), dtype=np.uint8)
    out[mask] = c1
    out[~mask] = c2
    return Image.fromarray(out, "RGB")


def parse_code_registries() -> dict[str, Any]:
    assets_ts = (ROOT / "src" / "lib" / "assets.ts").read_text(encoding="utf-8")
    materials = re.findall(r"'([A-Za-z0-9_]+)'", re.search(r"MATERIALS\s*=\s*\[([^\]]+)\]", assets_ts).group(1))
    roof_kit_ts = (ROOT / "src" / "lib" / "settlementKit.ts").read_text(encoding="utf-8")
    roof_arts = re.findall(r"art:\s*'([^']+)'", roof_kit_ts.split("export const ROOF_SHAPES")[0])
    civic_block = roof_kit_ts.split("export const CIVIC_KIT")[1].split("satisfies Record")[0]
    civic_entries = dict(re.findall(r"(\w+):\s*\{[^}]*art:\s*'([^']+)'", civic_block))

    crypt_kit_ts = (ROOT / "src" / "lib" / "cryptKit.ts").read_text(encoding="utf-8")
    crypt_kinds = re.findall(r"^\s{2}(\w+):\s*\{", crypt_kit_ts, flags=re.M)

    furn_kit_ts = (ROOT / "src" / "lib" / "furnitureKit.ts").read_text(encoding="utf-8")
    furn_kinds = re.findall(r"^\s{2}(\w+):\s*\{", furn_kit_ts, flags=re.M)

    furn_vec_ts = (ROOT / "src" / "lib" / "furnitureVectors.ts").read_text(encoding="utf-8")
    furn_vecs = re.findall(r"'?(furniture-[A-Za-z0-9_-]+)'?\s*:", furn_vec_ts)

    crypt_vec_ts = (ROOT / "src" / "lib" / "cryptVectors.ts").read_text(encoding="utf-8")
    crypt_vecs = re.findall(r"'?(crypt-[A-Za-z0-9_-]+)'?\s*:", crypt_vec_ts)

    chest_ts = (ROOT / "src" / "lib" / "chests.ts").read_text(encoding="utf-8")
    chest_vecs = re.findall(r"'(chest-[A-Za-z0-9_-]+)'\s*:", chest_ts)

    # Scan all src/lib/**/*.ts for string literal mentions
    all_ts_text = {}
    for p in sorted((ROOT / "src").rglob("*.ts*")):
        all_ts_text[str(p.relative_to(ROOT))] = p.read_text(encoding="utf-8", errors="ignore")

    return {
        "materials": set(materials),
        "roof_arts": set(roof_arts),
        "civic_entries": civic_entries,
        "crypt_kinds": set(crypt_kinds),
        "furn_kinds": set(furn_kinds),
        "furn_vecs": set(furn_vecs),
        "crypt_vecs": set(crypt_vecs),
        "chest_vecs": set(chest_vecs),
        "all_ts_text": all_ts_text,
    }


# Source-sheet lineage from extraction scripts
TRAP_SHEET_NAMES = {
    "pitSquare", "pitRound", "pitSpikes", "spikeField", "spikeFieldBloody", "spikeRack",
    "spikedWheel", "sawBlade", "axeBlade", "sawBar", "portcullis", "portcullisWood",
    "wreckingBall", "dartHoleWall", "bladeSlot", "pressurePlate", "pressurePlateRound",
    "pressurePlateRusty", "buttonPanel", "gear", "gearCog", "chainPulley", "pulleyBlock",
    "lever", "leverBlade", "doorWood", "doorMetal", "doorRound", "doorBarred", "gateBars",
    "hangingCage", "pedestalStatue", "orbRed", "bust", "runeBlue", "runeCircleBlue",
    "runeCirclePurple", "greenRuneStone", "flail", "crackedPlate",
}
OBJECT_SHEET_NAMES = {
    "boulder", "rockPile", "scree", "rockSpikes", "rockSpire", "pebbles", "rockOutcrop",
    "stoneWell", "stalagmites", "stalactites", "puddleBlue", "puddleMud", "puddleAcid",
    "mossGrass", "mushroomsGlow", "mossPatch", "bushPatch", "ivyWall", "roots", "lichen",
    "dirtPatch", "cracks", "nestEggs", "skeletonBones", "logs", "crystals",
}
ISOMETRIC_MARKET_PREFIXES = (
    "marketStall", "marketTent", "marketWagon", "marketWheelbarrow", "marketCrates",
    "marketTable", "marketBench", "marketFence", "marketNoticeBoard", "stallRed", "stallGreen", "cart",
)


def base_stem(stem: str) -> str:
    m = re.match(r"^(.+)-(\d+)$", stem)
    return m.group(1) if m else stem


def classify_cartography_asset(stem: str, reg: dict[str, Any]) -> tuple[str, str, str | None, list[str], bool]:
    b = base_stem(stem)
    usages: list[str] = []
    source_sheet: str | None = None

    # Check urban sprite pack manifest first if present
    sp_manifest_path = SPRITE_PACK_DIR / "urban_asset_manifest.json"
    sp_map = {}
    if sp_manifest_path.exists():
        for entry in json.loads(sp_manifest_path.read_text(encoding="utf-8")):
            sp_map[entry["id"]] = entry

    if b.startswith("road_"):
        category, obj_type = "roads", "seamless_road_texture"
        source_sheet = "generated_road_material_library"
    elif b.startswith("castle_wall_"):
        category, obj_type = "castle-walls", "seamless_fortification_texture"
        source_sheet = "generated_castle_wall_library"
    elif b in ("bank", "cobbles", "flagstone", "earth") and b in reg["materials"]:
        category = "roads" if b in ("bank", "cobbles") else "terrain"
        obj_type = "seamless_material_texture"
        source_sheet = "assets/source/encounter-ground.jpg / encounter-stone.jpg"
    elif b in reg["roof_arts"] or b in ("thatch", "shingles", "terracotta", "slate", "copper", "garnet", "limestone", "mossRoof"):
        category, obj_type = "damage-and-materials", "roof_material_texture"
        source_sheet = "encounter-roofs.jpg / settlement-roofs.jpg"
    elif b in reg["materials"] or b == "timber":
        category, obj_type = "terrain", "seamless_material_texture"
        source_sheet = "assets/source/encounter-interior.jpg" if b in ("caveSoil", "dunes", "timber", "hatching") else "encounter-ground/stone"
    elif b.startswith("wall-"):
        category, obj_type = "castle-walls", "dungeon_wall_strip_or_cap"
        source_sheet = "assets/source/sprite-sheet-walls.jpg"
    elif b.startswith("crypt-"):
        sub = b[len("crypt-"):]
        if sub in TRAP_SHEET_NAMES:
            category, obj_type = "traps-and-mechanisms", "crypt_trap_or_mechanism"
            source_sheet = "assets/source/sprite-sheet-traps.jpg"
        elif sub in OBJECT_SHEET_NAMES:
            category, obj_type = "natural-assets", "cave_or_dungeon_nature_prop"
            source_sheet = "assets/source/sprite-sheet-objects.webp"
        else:
            category, obj_type = "dungeon-assets", "crypt_prop"
            source_sheet = "crypt-relics.png / gemini_sprites"
    elif b in ("oak", "oakGold", "pine", "bush", "dead", "cactus", "mushroom", "reed", "rock", "smallRock"):
        category, obj_type = "natural-assets", "landscape_tree_or_rock"
        source_sheet = "encounter-canopies.png / objects-atlas.png / gemini_sprites"
    elif b.startswith("furniture-"):
        category, obj_type = "furniture-assets", "interior_furniture_sprite"
        source_sheet = "interior-furniture-a.png / gemini_sprites"
    elif b.startswith("decor-"):
        category, obj_type = "decorations", "ground_micro_decor"
        source_sheet = "gemini_sprites"
    elif b in sp_map:
        sheet_name = sp_map[b]["sheet"]
        source_sheet = f"sprite_pack/{sheet_name}"
        if sheet_name == "building_materials.png":
            category = "damage-and-materials"
            obj_type = "seamless_building_material"
        elif sheet_name == "building_damage.png":
            category = "damage-and-materials"
            obj_type = sp_map[b]["assetType"]
        elif sheet_name == "market_goods.png":
            category = "market-assets"
            obj_type = "market_tabletop_good"
        elif sheet_name in ("building_signs.png", "urban_lighting.png"):
            category = "building-assets"
            obj_type = sp_map[b]["assetType"]
        elif sheet_name in ("ground_decals.png", "urban_greenery.png"):
            category = "decorations"
            obj_type = sp_map[b]["assetType"]
        else:
            category = "building-assets"
            obj_type = sp_map[b]["assetType"]
    elif b.startswith("market") or b in ("stallRed", "stallGreen", "cart"):
        category, obj_type = "market-assets", "market_or_civic_prop"
        source_sheet = "assets/source/sprite-sheet-market.jpg" if b.startswith("market") else "settlement-props.png"
    elif b.startswith("urban") or b in ("well", "fountain", "garden"):
        category, obj_type = "building-assets", "settlement_civic_or_craft_prop"
        source_sheet = "settlement-props.png / urban_pack"
    elif b.startswith("chest"):
        category, obj_type = "dungeon-assets", "chest_sprite"
        source_sheet = "encounter-chest.png"
    else:
        category, obj_type = "decorations", "misc_sprite"

    # Trace actual usage in codebase
    if b in reg["materials"]:
        usages.append("assets.ts:MATERIALS -> terrainPaint.ts")
    if b in ("earth", "bank", "cobbles") or b.startswith("road_"):
        usages.append("render.ts:drawRoadRibbons")
    if b.startswith("castle_wall_"):
        usages.append("townWallPaint.ts:drawFortification")
    if b == "timber":
        usages.append("render.ts:drawBridgeDecks & drawWoodwork")
    if b in reg["roof_arts"]:
        usages.append("settlementKit.ts:ROOF_KIT -> settlementPaint.ts:building")
    for ck, art_name in reg["civic_entries"].items():
        if art_name == b:
            usages.append(f"settlementKit.ts:CIVIC_KIT.{ck} -> settlementPaint.ts:civic")
    if b in ("stallGreen", "stallRed"):
        usages.append("settlementKit.ts:civicArt(market) -> settlementPaint.ts:civic")
    if b == "wall-straight":
        usages.append("wallPaint.ts:drawWalls (dungeon wall ribbon pattern)")
    if b.startswith("crypt-") and b[6:] in reg["crypt_kinds"]:
        usages.append(f"cryptKit.ts:CRYPT.{b[6:]} -> cryptPaint.ts")
    if b.startswith("furniture-") and b[10:] in reg["furn_kinds"]:
        usages.append(f"furnitureKit.ts:FURNITURE.{b[10:]} -> interiorPaint.ts")
    if b.startswith("decor-"):
        usages.append("decor.ts:paintDecor")
    if b in ("oak", "oakGold", "pine", "bush", "dead", "cactus", "mushroom", "reed"):
        usages.append("render.ts:drawTree")
    if b in ("rock", "smallRock"):
        usages.append("render.ts:drawRock")
    if b == "chest":
        usages.append("assets.ts:CHEST_ART & chests.ts:chestArt(legacy)")

    # Direct string literal search for any additional references (e.g. settlementPaint attachments/decals/patina)
    for rel_path, content in reg["all_ts_text"].items():
        if f"'{b}'" in content or f'"{b}"' in content or f"'{stem}'" in content or f'"{stem}"' in content:
            tag = f"{rel_path}"
            if not any(rel_path.split("/")[-1] in u for u in usages):
                usages.append(tag)

    is_ref = len(usages) > 0
    return category, obj_type, source_sheet, usages, is_ref


def analyze_image_metrics(path: Path, is_seamless_tex: bool) -> dict[str, Any]:
    im = Image.open(path)
    fmt = (im.format or path.suffix.lstrip(".")).upper()
    w, h = im.size
    has_alpha = im.mode in ("RGBA", "LA") or ("transparency" in im.info)
    rgba = np.asarray(im.convert("RGBA"), dtype=np.int16)
    alpha = rgba[:, :, 3]
    rgb = rgba[:, :, :3]
    total_px = w * h
    transparent_px = int((alpha == 0).sum())
    semi_px = int(((alpha > 0) & (alpha < 255)).sum())
    opaque_px = int((alpha == 255).sum())
    alpha_cov = round(transparent_px / total_px, 4)  # fraction of transparent pixels

    issues: list[str] = []
    halo_ratio = 0.0
    clip_pixels = 0
    seam_lr = 0.0
    seam_tb = 0.0

    if is_seamless_tex:
        if transparent_px > 0:
            issues.append("seamless_texture_has_transparent_pixels")
        f = rgb.astype(np.float32)
        seam_lr = float(np.abs(f[:, 0, :] - f[:, -1, :]).mean())
        seam_tb = float(np.abs(f[0, :, :] - f[-1, :, :]).mean())
        grad = float((np.abs(np.diff(f, axis=1)).mean() + np.abs(np.diff(f, axis=0)).mean()) / 2.0 + 1e-5)
        if seam_lr > grad * 2.2 or seam_tb > grad * 2.2:
            issues.append(f"visible_tile_seam(lr={seam_lr:.1f},tb={seam_tb:.1f},grad={grad:.1f})")
    else:
        if transparent_px == 0:
            issues.append("missing_alpha_opaque_background")
        else:
            # Check border clipping
            edge_alpha = np.concatenate([alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1]])
            clip_pixels = int((edge_alpha > 32).sum())
            if clip_pixels > max(12, int(0.06 * (2 * (w + h)))):
                issues.append(f"clipped_at_image_border({clip_pixels}px)")

            # Check white halo on outer silhouette ring
            subj = alpha > 16
            trans = ~subj
            if subj.any() and trans.any():
                ring = np.zeros_like(subj)
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ring |= np.roll(np.roll(trans, dy, axis=0), dx, axis=1)
                outer = ring & subj
                outer_cnt = int(outer.sum())
                if outer_cnt > 0:
                    darkest = rgb.min(axis=2)
                    chroma = rgb.max(axis=2) - darkest
                    bright_neutral = outer & (darkest >= 225) & (chroma <= 18) & (alpha >= 80)
                    halo_ratio = float(bright_neutral.sum()) / outer_cnt
                    if halo_ratio > 0.08:
                        issues.append(f"white_halo_fringe({halo_ratio*100:.1f}%)")

            # Check excessive empty padding (>88% transparent)
            if alpha_cov > 0.88:
                issues.append(f"excessive_empty_padding({alpha_cov*100:.1f}%_transparent)")

    if max(w, h) < 110:
        issues.append(f"low_resolution({w}x{h})")

    return {
        "format": fmt,
        "width": w,
        "height": h,
        "hasAlpha": bool(has_alpha and transparent_px > 0) if not is_seamless_tex else bool(has_alpha),
        "alphaCoverage": round(1.0 - (transparent_px / total_px), 4),
        "transparentRatio": alpha_cov,
        "semiTransparentRatio": round(semi_px / total_px, 4),
        "opaqueRatio": round(opaque_px / total_px, 4),
        "haloRatio": round(halo_ratio, 4),
        "clipPixels": clip_pixels,
        "seamLR": round(seam_lr, 2),
        "seamTB": round(seam_tb, 2),
        "issues": issues,
        "dhash": dhash64(im),
    }


def compute_score(entry: dict[str, Any]) -> tuple[int, str, dict[str, int]]:
    tech = 95
    vis = 88
    style = 88
    sem = 92
    suit = 90
    issues = entry["detectedIssues"]

    for iss in issues:
        if "missing_alpha" in iss:
            tech -= 35
            suit -= 30
        elif "white_halo" in iss:
            tech -= 20
            vis -= 12
        elif "clipped_at_image_border" in iss:
            tech -= 14
            vis -= 10
        elif "visible_tile_seam" in iss:
            tech -= 25
            suit -= 25
        elif "low_resolution" in iss:
            tech -= 15
            vis -= 12
        elif "excessive_empty_padding" in iss:
            tech -= 8
            suit -= 8
        elif "isometric_perspective_mismatch" in iss:
            style -= 24
            suit -= 10
        elif "road_reuses_river_bank_texture" in iss:
            sem -= 35
            suit -= 30
            vis -= 20
        elif "unreferenced_in_renderer" in iss:
            suit -= 18
        elif "unintegrated_sprite_pack_sheet" in iss:
            suit -= 35
        elif "missing_variant_index_gap" in iss:
            tech -= 6

    sub = {
        "technicalQuality": max(0, min(100, tech)),
        "visualQuality": max(0, min(100, vis)),
        "styleConsistency": max(0, min(100, style)),
        "semanticCorrectness": max(0, min(100, sem)),
        "renderingSuitability": max(0, min(100, suit)),
    }
    total = round(
        sub["technicalQuality"] * 0.25
        + sub["visualQuality"] * 0.20
        + sub["styleConsistency"] * 0.20
        + sub["semanticCorrectness"] * 0.15
        + sub["renderingSuitability"] * 0.20
    )
    if total >= 88 and not any("unintegrated" in i or "reuses_river_bank" in i for i in issues):
        tier = "excellent"
    elif total >= 76:
        tier = "good"
    elif total >= 60:
        tier = "needs_improvement"
    elif total >= 40:
        tier = "poor"
    else:
        tier = "broken"
    return total, tier, sub


def render_contact_sheet(title: str, items: list[dict[str, Any]], out_path: Path, cols: int = 8, thumb: int = 136) -> None:
    if not items:
        return
    font_b = load_font(12)
    font_s = load_font(10)
    cell_w = thumb + 20
    cell_h = thumb + 58
    rows = (len(items) + cols - 1) // cols
    header_h = 46
    W = cols * cell_w + 24
    H = header_h + rows * cell_h + 20

    canvas = Image.new("RGB", (W, H), (28, 26, 24))
    draw = ImageDraw.Draw(canvas)
    draw.text((16, 14), f"{title}  ({len(items)} assets)", fill=(238, 226, 198), font=load_font(16))

    chk = checkerboard(thumb, thumb, cell=12)

    for idx, it in enumerate(items):
        r, c = divmod(idx, cols)
        x0 = 12 + c * cell_w
        y0 = header_h + r * cell_h

        # Border colored by usage/issues
        has_warn = any(
            k in " ".join(it["detectedIssues"])
            for k in ("halo", "clipped", "seam", "isometric", "reuses_river", "unreferenced", "unintegrated")
        )
        border_col = (210, 118, 68) if has_warn else ((92, 168, 112) if it["isReferenced"] else (128, 124, 118))
        draw.rectangle([x0 + 4, y0 + 2, x0 + 4 + thumb + 3, y0 + 2 + thumb + 3], outline=border_col, width=2)
        canvas.paste(chk, (x0 + 6, y0 + 4))

        p = ROOT / it["path"]
        if p.exists() and p.suffix.lower() in (".webp", ".png", ".jpg", ".jpeg"):
            im = Image.open(p).convert("RGBA")
            im.thumbnail((thumb - 6, thumb - 6), Image.Resampling.LANCZOS)
            ox = x0 + 6 + (thumb - im.width) // 2
            oy = y0 + 4 + (thumb - im.height) // 2
            canvas.paste(im, (ox, oy), im)

        label = it["id"] if it["id"] else it["fileName"]
        if len(label) > 21:
            label = label[:19] + ".."
        status = "USED" if it["isReferenced"] else "UNUSED"
        meta = f"{it['width']}x{it['height']} · {status} · Q{it['visualQuality']}"
        draw.text((x0 + 6, y0 + thumb + 9), label, fill=(235, 228, 212), font=font_b)
        draw.text((x0 + 6, y0 + thumb + 24), meta, fill=(172, 165, 152), font=font_s)
        if it["detectedIssues"]:
            short_iss = it["detectedIssues"][0][:24]
            draw.text((x0 + 6, y0 + thumb + 38), short_iss, fill=(235, 146, 98), font=font_s)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SHEETS_OUT.mkdir(parents=True, exist_ok=True)
    reg = parse_code_registries()

    entries: list[dict[str, Any]] = []
    dhashes: list[tuple[int, int]] = []  # (entry_index, dhash)
    sha_groups: dict[str, list[str]] = defaultdict(list)

    # Check variant sequence gaps in cartography
    stems = sorted(p.stem for p in CARTO_DIR.glob("*.webp"))
    by_base: dict[str, list[int]] = defaultdict(list)
    for s in stems:
        m = re.match(r"^(.+)-(\d+)$", s)
        if m:
            by_base[m.group(1)].append(int(m.group(2)))
        else:
            by_base[s].append(1)

    # 1. Production WebP assets in src/assets/cartography
    for p in sorted(CARTO_DIR.glob("*.webp")):
        stem = p.stem
        b = base_stem(stem)
        cat, obj_type, src_sheet, usages, is_ref = classify_cartography_asset(stem, reg)
        is_tex = obj_type in ("seamless_material_texture", "roof_material_texture", "seamless_road_texture", "seamless_fortification_texture", "seamless_building_material")
        metrics = analyze_image_metrics(p, is_seamless_tex=is_tex)
        issues = list(metrics["issues"])

        if b.startswith(ISOMETRIC_MARKET_PREFIXES):
            issues.append("isometric_perspective_mismatch(30deg_vs_90deg_topdown)")
        if stem == "bank":
            # Check if TILE_ART.road still points to 'bank'
            assets_txt = (ROOT / "src" / "lib" / "assets.ts").read_text(encoding="utf-8")
            if re.search(r"road:\s*'bank'", assets_txt):
                issues.append("road_reuses_river_bank_texture(flat_sandy_appearance)")
        nums = sorted(by_base.get(b, []))
        if nums and nums != list(range(1, len(nums) + 1)) and (b not in stems or max(nums) != len(nums)):
            issues.append(f"missing_variant_index_gap({nums})")
        if not is_ref:
            issues.append("unreferenced_in_renderer")

        sha = sha256_file(p)
        rel = str(p.relative_to(ROOT))
        sha_groups[sha].append(rel)

        entry: dict[str, Any] = {
            "id": stem,
            "baseId": b,
            "path": rel,
            "fileName": p.name,
            "assetGroup": "production_cartography",
            "format": metrics["format"],
            "width": metrics["width"],
            "height": metrics["height"],
            "fileSize": p.stat().st_size,
            "hasAlpha": metrics["hasAlpha"],
            "alphaCoverage": metrics["alphaCoverage"],
            "transparentPercent": round(metrics["transparentRatio"] * 100, 2),
            "category": cat,
            "objectType": obj_type,
            "sourceSheet": src_sheet,
            "actualUsage": usages,
            "isReferenced": is_ref,
            "sha256": sha,
            "detectedIssues": issues,
        }
        score, tier, sub = compute_score(entry)
        entry["visualQuality"] = score
        entry["qualityTier"] = tier
        entry["scoreBreakdown"] = sub
        dhashes.append((len(entries), metrics["dhash"]))
        entries.append(entry)

    # 2. Original source sprite sheets in assets/source/
    for p in sorted(SOURCE_DIR.glob("*")):
        if not p.is_file() or p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        im = Image.open(p)
        rel = str(p.relative_to(ROOT))
        sha = sha256_file(p)
        sha_groups[sha].append(rel)
        script_map = {
            "sprite-sheet-objects.webp": "scripts/extract-sprite-sheet.py (26 natural/cave sprites)",
            "sprite-sheet-traps.jpg": "scripts/extract-trap-sheet.py (40 traps & mechanisms)",
            "sprite-sheet-walls.jpg": "scripts/extract-wall-sheet.py (7 dungeon wall strips/caps)",
            "sprite-sheet-market.jpg": "scripts/extract-market-sheet.py (40 market sprites)",
            "encounter-interior.jpg": "scripts/prepare-cartography.py (caveSoil, dunes, timber, hatching)",
        }
        entry = {
            "id": "",
            "baseId": "",
            "path": rel,
            "fileName": p.name,
            "assetGroup": "source_sheet",
            "format": (im.format or p.suffix.lstrip(".")).upper(),
            "width": im.width,
            "height": im.height,
            "fileSize": p.stat().st_size,
            "hasAlpha": im.mode in ("RGBA", "LA"),
            "alphaCoverage": 1.0,
            "transparentPercent": 0.0,
            "category": "source-sheets",
            "objectType": "source_sprite_sheet",
            "sourceSheet": rel,
            "actualUsage": [script_map.get(p.name, "offline_build_source")],
            "isReferenced": False,
            "sha256": sha,
            "detectedIssues": ["offline_source_sheet_not_bundled_at_runtime"],
            "visualQuality": 86,
            "qualityTier": "good",
            "scoreBreakdown": {
                "technicalQuality": 88,
                "visualQuality": 88,
                "styleConsistency": 82,
                "semanticCorrectness": 90,
                "renderingSuitability": 82,
            },
        }
        entries.append(entry)

    # 3. Sprite Pack 2048x2048 RGBA sheets in sprite_pack/
    if SPRITE_PACK_DIR.exists():
        for p in sorted(SPRITE_PACK_DIR.glob("*.png")):
            im = Image.open(p)
            rel = str(p.relative_to(ROOT))
            sha = sha256_file(p)
            sha_groups[sha].append(rel)
            is_preview = p.name == "urban_asset_preview.png"
            # Check if cells from this sheet have been sliced into src/assets/cartography
            sp_sliced = (CARTO_DIR / "signTavernMug.webp").exists()
            iss = []
            if is_preview:
                iss.append("generated_preview_contact_sheet")
            elif not sp_sliced:
                iss.append("unintegrated_sprite_pack_sheet(not_yet_sliced_into_src_assets_cartography)")
            entry = {
                "id": "",
                "baseId": "",
                "path": rel,
                "fileName": p.name,
                "assetGroup": "sprite_pack_preview" if is_preview else "sprite_pack_sheet",
                "format": "PNG",
                "width": im.width,
                "height": im.height,
                "fileSize": p.stat().st_size,
                "hasAlpha": im.mode == "RGBA",
                "alphaCoverage": 0.5,
                "transparentPercent": 50.0,
                "category": "damage-and-materials" if "material" in p.name or "damage" in p.name else "building-assets",
                "objectType": "preview_sheet" if is_preview else "authored_4x4_rgba_sprite_sheet",
                "sourceSheet": rel,
                "actualUsage": ["scripts/integrate-urban-pack.py -> src/assets/cartography/*.webp"] if sp_sliced else [],
                "isReferenced": sp_sliced and not is_preview,
                "sha256": sha,
                "detectedIssues": iss,
                "visualQuality": 94 if sp_sliced or is_preview else 68,
                "qualityTier": "excellent" if sp_sliced or is_preview else "needs_improvement",
                "scoreBreakdown": {
                    "technicalQuality": 96,
                    "visualQuality": 95,
                    "styleConsistency": 94,
                    "semanticCorrectness": 95,
                    "renderingSuitability": 94 if sp_sliced else 45,
                },
            }
            entries.append(entry)

    # 4. Public SVG & Embedded Vector Registries
    fav = PUBLIC_DIR / "favicon.svg"
    if fav.exists():
        entries.append({
            "id": "favicon",
            "baseId": "favicon",
            "path": "public/favicon.svg",
            "fileName": "favicon.svg",
            "assetGroup": "public_svg",
            "format": "SVG",
            "width": 32,
            "height": 32,
            "fileSize": fav.stat().st_size,
            "hasAlpha": True,
            "alphaCoverage": 0.6,
            "transparentPercent": 40.0,
            "category": "ui-and-vectors",
            "objectType": "app_favicon_svg",
            "sourceSheet": None,
            "actualUsage": ["index.html:<link rel='icon'>"],
            "isReferenced": True,
            "sha256": sha256_file(fav),
            "detectedIssues": [],
            "visualQuality": 92,
            "qualityTier": "excellent",
        })

    # Embedded SVG fallbacks / vectors summary entries
    carto_names = {p.stem for p in CARTO_DIR.glob("*.webp")}
    for vec_id in sorted(reg["chest_vecs"]):
        overridden = vec_id in carto_names
        entries.append({
            "id": vec_id,
            "baseId": vec_id,
            "path": "src/lib/chests.ts#chestVectors",
            "fileName": f"{vec_id}.svg(inline)",
            "assetGroup": "embedded_svg_vector",
            "format": "SVG_INLINE",
            "width": 260,
            "height": 180,
            "fileSize": 1950,
            "hasAlpha": True,
            "alphaCoverage": 0.72,
            "transparentPercent": 28.0,
            "category": "dungeon-assets",
            "objectType": "inline_svg_chest_sprite",
            "sourceSheet": "src/lib/chests.ts",
            "actualUsage": ["chests.ts:chestArt -> render.ts:drawChest"],
            "isReferenced": not overridden,
            "detectedIssues": [] if not overridden else ["shadowed_by_bitmap_webp"],
            "visualQuality": 84,
            "qualityTier": "good",
        })

    for vec_id in sorted(reg["furn_vecs"]):
        overridden = vec_id in carto_names
        entries.append({
            "id": vec_id,
            "baseId": vec_id,
            "path": "src/lib/furnitureVectors.ts#furnitureVectors",
            "fileName": f"{vec_id}.svg(inline)",
            "assetGroup": "embedded_svg_vector",
            "format": "SVG_INLINE",
            "width": 160,
            "height": 160,
            "fileSize": 1200,
            "hasAlpha": True,
            "alphaCoverage": 0.65,
            "transparentPercent": 35.0,
            "category": "furniture-assets",
            "objectType": "inline_svg_furniture_fallback",
            "sourceSheet": "src/lib/furnitureVectors.ts",
            "actualUsage": [] if overridden else [f"assets.ts:furnitureVectors -> interiorPaint.ts ({vec_id})"],
            "isReferenced": not overridden,
            "detectedIssues": ["shadowed_by_bitmap_webp_in_cartography"] if overridden else ["vector_svg_mixed_with_painted_furniture"],
            "visualQuality": 78,
            "qualityTier": "good",
        })

    for vec_id in sorted(reg["crypt_vecs"]):
        overridden = vec_id in carto_names
        entries.append({
            "id": vec_id,
            "baseId": vec_id,
            "path": "src/lib/cryptVectors.ts#cryptVectors",
            "fileName": f"{vec_id}.svg(inline)",
            "assetGroup": "embedded_svg_vector",
            "format": "SVG_INLINE",
            "width": 160,
            "height": 160,
            "fileSize": 1100,
            "hasAlpha": True,
            "alphaCoverage": 0.6,
            "transparentPercent": 40.0,
            "category": "dungeon-assets",
            "objectType": "inline_svg_crypt_fallback",
            "sourceSheet": "src/lib/cryptVectors.ts",
            "actualUsage": [] if overridden else [f"assets.ts:cryptVectors -> cryptPaint.ts ({vec_id})"],
            "isReferenced": not overridden,
            "detectedIssues": ["shadowed_by_bitmap_webp_in_cartography"] if overridden else ["flat_vector_svg_fallback"],
            "visualQuality": 76,
            "qualityTier": "good",
        })

    # Documentation images inventory count (recorded in manifest without bloating production contact sheets)
    doc_imgs = [
        p for p in sorted(DOCS_DIR.rglob("*"))
        if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") and "docs/assets" not in str(p)
    ]
    for p in doc_imgs:
        im = Image.open(p)
        rel = str(p.relative_to(ROOT))
        sha = sha256_file(p)
        sha_groups[sha].append(rel)
        entries.append({
            "id": "",
            "baseId": "",
            "path": rel,
            "fileName": p.name,
            "assetGroup": "documentation_image",
            "format": (im.format or p.suffix.lstrip(".")).upper(),
            "width": im.width,
            "height": im.height,
            "fileSize": p.stat().st_size,
            "hasAlpha": im.mode in ("RGBA", "LA"),
            "alphaCoverage": 1.0,
            "transparentPercent": 0.0,
            "category": "documentation",
            "objectType": "documentation_screenshot_or_qa_sheet",
            "sourceSheet": None,
            "actualUsage": ["docs/markdown_reference"],
            "isReferenced": False,
            "sha256": sha,
            "detectedIssues": [],
            "visualQuality": 85,
            "qualityTier": "good",
        })

    # Detect exact duplicates and perceptual near-duplicates among production cartography assets
    exact_dups = {sha: paths for sha, paths in sha_groups.items() if len(paths) > 1}
    for sha, paths in exact_dups.items():
        for e in entries:
            if e.get("sha256") == sha:
                e["detectedIssues"].append(f"exact_duplicate_of({','.join(x for x in paths if x != e['path'])})")

    near_dups: list[tuple[str, str, int]] = []
    for i in range(len(dhashes)):
        idx_a, ha = dhashes[i]
        for j in range(i + 1, len(dhashes)):
            idx_b, hb = dhashes[j]
            dist = hamming64(ha, hb)
            if dist <= 6:
                ea, eb = entries[idx_a], entries[idx_b]
                near_dups.append((ea["fileName"], eb["fileName"], dist))
                if ea["baseId"] != eb["baseId"]:
                    ea["detectedIssues"].append(f"near_duplicate_cross_id({eb['fileName']},d={dist})")
                    eb["detectedIssues"].append(f"near_duplicate_cross_id({ea['fileName']},d={dist})")

    # Write machine-readable manifest
    manifest_path = OUT_DIR / "asset-manifest.json"
    manifest_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")

    # Render required contact sheets for production cartography + relevant sheets
    carto_entries = [e for e in entries if e["assetGroup"] == "production_cartography"]
    render_contact_sheet("ALL PRODUCTION CARTOGRAPHY ASSETS", carto_entries, SHEETS_OUT / "all-assets.png", cols=12, thumb=112)

    cat_map = {
        "terrain": "TERRAIN & SURFACE MATERIALS",
        "roads": "ROAD SURFACE MATERIALS",
        "castle-walls": "WALL & FORTIFICATION ASSETS",
        "dungeon-assets": "DUNGEON & CRYPT PROPS",
        "natural-assets": "NATURAL LANDSCAPE & CAVE ASSETS",
        "traps-and-mechanisms": "TRAPS & MECHANISMS",
        "market-assets": "MARKET STALLS, TENTS & GOODS",
        "building-assets": "SETTLEMENT, CIVIC & WORKSHOP ASSETS",
        "furniture-assets": "INTERIOR FURNITURE ASSETS",
        "decorations": "DECORATIONS, GREENERY & GROUND DECALS",
        "damage-and-materials": "ROOFS, BUILDING MATERIALS & WEAR OVERLAYS",
    }
    for cat_slug, title in cat_map.items():
        subset = [e for e in carto_entries if e["category"] == cat_slug]
        if subset:
            render_contact_sheet(title, subset, SHEETS_OUT / f"{cat_slug}.png", cols=min(8, max(4, len(subset))), thumb=144)

    # Zoomed contact sheet of suspected defects (Phase 1.3 requirement)
    flagged = [
        e for e in carto_entries
        if any(
            k in " ".join(e["detectedIssues"])
            for k in ("halo", "clipped", "seam", "reuses_river", "unreferenced", "low_resolution", "gap")
        )
    ]
    if flagged:
        render_contact_sheet("SUSPECTED DEFECTS — ZOOMED INSPECTION", flagged[:48], SHEETS_OUT / "suspected-defects-zoom.png", cols=6, thumb=196)

    # Print concise audit summary JSON
    summary = {
        "totalEntries": len(entries),
        "productionWebpCount": len(carto_entries),
        "uniqueBaseSpriteIds": len({e["baseId"] for e in carto_entries}),
        "sourceSheetsCount": sum(1 for e in entries if e["assetGroup"] == "source_sheet"),
        "spritePackSheetsCount": sum(1 for e in entries if e["assetGroup"] == "sprite_pack_sheet"),
        "embeddedSvgCount": sum(1 for e in entries if e["assetGroup"] == "embedded_svg_vector"),
        "docImagesCount": len(doc_imgs),
        "activelyUsedCartography": sum(1 for e in carto_entries if e["isReferenced"]),
        "unusedCartography": [e["fileName"] for e in carto_entries if not e["isReferenced"]],
        "exactDuplicateGroups": exact_dups,
        "nearDuplicatePairsCount": len(near_dups),
        "nearDuplicateSample": near_dups[:20],
        "transparencyIssues": [
            {"file": e["fileName"], "issues": e["detectedIssues"]}
            for e in carto_entries
            if any(k in " ".join(e["detectedIssues"]) for k in ("halo", "alpha", "clipped"))
        ],
        "seamIssues": [
            {"file": e["fileName"], "issues": e["detectedIssues"]}
            for e in carto_entries
            if any("seam" in x for x in e["detectedIssues"])
        ],
        "styleInconsistenciesCount": sum(
            1 for e in carto_entries if any("isometric" in x for x in e["detectedIssues"])
        ),
        "variantGaps": sorted({
            e["baseId"]: [x for x in e["detectedIssues"] if "gap" in x][0]
            for e in carto_entries
            if any("gap" in x for x in e["detectedIssues"])
        }.items()),
        "synthesizedCryptCount": len(reg["crypt_kinds"] - {e["baseId"][6:] for e in carto_entries if e["baseId"].startswith("crypt-")} - {v[6:] for v in reg["crypt_vecs"]}),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
