#!/usr/bin/env python3
"""
Cartographer — Complete Urban Asset Sprite Pack Builder & QA Verifier.
Generates `sprite_pack/urban_asset_manifest.json` (160 assets across 10 sheets),
extracts clean true-RGBA 512x512 cells from raw renders, assembles 2048x2048
4x4 sprite sheets, and renders visual QA previews.
"""

from __future__ import annotations
import json
import math
import os
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
PACK_DIR = ROOT / "sprite_pack"
WORK_DIR = PACK_DIR / "_work"
RAW_DIR = WORK_DIR / "raw"
CELLS_DIR = WORK_DIR / "cells"

CELL_SIZE = 512
GRID_DIM = 4
SHEET_SIZE = CELL_SIZE * GRID_DIM  # 2048x2048
PAD_RATIO = 0.10  # 10% padding (within 8-12% specification)

# ---------------------------------------------------------------------------
# Complete 160-Asset Specification (10 sheets x 16 cells)
# ---------------------------------------------------------------------------

SHEETS_SPEC = [
    {
        "prefix": "s01",
        "filename": "urban_street_dressing.png",
        "title": "01 — Urban Street Dressing",
        "items": [
            ("urbanTrough", "civic_object", "water", ["roadside", "gate_zone", "courtyard"], (2, 1), "Wooden animal water trough"),
            ("urbanHandPump", "civic_object", "water", ["intersection", "courtyard", "plaza_edge"], (1, 1), "Traditional iron hand water pump"),
            ("urbanHitchingPost", "civic_object", "traffic", ["facade_front", "roadside", "gate_zone"], (1, 1), "Wooden horse hitching post"),
            ("urbanHitchingRail", "civic_object", "traffic", ["facade_front", "inn_yard", "gate_zone"], (2, 1), "Horizontal tethering rail"),
            ("urbanStoneBollard", "civic_object", "traffic", ["intersection", "plaza_edge", "roadside"], (1, 1), "Weathered stone street bollard"),
            ("urbanMilestone", "civic_object", "traffic", ["gate_zone", "roadside", "intersection"], (1, 1), "Carved stone milestone without text"),
            ("urbanDrainGrate", "civic_object", "traffic", ["roadside", "alley_back", "plaza_edge"], (1, 1), "Iron street drainage grate"),
            ("urbanManholeCover", "civic_object", "traffic", ["intersection", "roadside", "alley_back"], (1, 1), "Stone and iron underground cover"),
            ("urbanWaterBasin", "civic_object", "water", ["plaza_edge", "courtyard", "intersection"], (2, 2), "Public stone water basin"),
            ("urbanWashTub", "civic_object", "residential", ["courtyard", "alley_back", "roadside"], (1, 1), "Wooden public washing tub"),
            ("urbanBucketStand", "civic_object", "water", ["courtyard", "facade_side", "roadside"], (2, 1), "Stand with wooden water buckets"),
            ("urbanStreetShrine", "civic_object", "decoration", ["intersection", "plaza_edge", "gate_zone"], (1, 1), "Small roadside stone shrine"),
            ("urbanStonePlanter", "civic_object", "decoration", ["facade_front", "plaza_edge", "courtyard"], (2, 1), "Rectangular stone planter"),
            ("urbanRoadBarrier", "civic_object", "traffic", ["gate_zone", "roadside"], (2, 1), "Medieval wooden road barrier"),
            ("urbanStreetBroom", "civic_object", "residential", ["alley_back", "facade_side", "courtyard"], (1, 1), "Street cleaning broom and tools"),
            ("urbanSignpost", "civic_object", "traffic", ["intersection", "gate_zone"], (1, 1), "Wooden directional signpost, no lettering"),
        ],
    },
    {
        "prefix": "s02",
        "filename": "craft_workshop.png",
        "title": "02 — Craft & Workshop District",
        "items": [
            ("urbanAnvil", "civic_object", "workshop", ["workshop_yard", "facade_side"], (1, 1), "Blacksmith anvil on a wooden base"),
            ("urbanWorkbench", "civic_object", "workshop", ["workshop_yard", "facade_side"], (2, 1), "Rugged artisan workbench"),
            ("urbanForge", "civic_object", "workshop", ["workshop_yard", "courtyard"], (2, 2), "Compact stone and iron forge"),
            ("urbanBellows", "civic_object", "workshop", ["workshop_yard", "facade_side"], (1, 1), "Leather and wooden blacksmith bellows"),
            ("urbanWoodpile", "civic_object", "cargo", ["alley_back", "facade_side", "courtyard"], (2, 1), "Stacked split firewood"),
            ("urbanPlanks", "civic_object", "cargo", ["workshop_yard", "quayside", "alley_back"], (2, 1), "Stack of rough wooden boards"),
            ("urbanCoal", "civic_object", "workshop", ["workshop_yard", "alley_back"], (1, 1), "Compact blacksmith coal pile"),
            ("urbanHides", "civic_object", "workshop", ["workshop_yard", "courtyard"], (2, 1), "Animal hides on drying rack"),
            ("urbanPots", "civic_object", "cargo", ["facade_front", "workshop_yard", "courtyard"], (1, 1), "Rustic clay pottery vessels"),
            ("urbanToolRack", "civic_object", "workshop", ["facade_side", "workshop_yard"], (2, 1), "Organized rack of metalworking tools"),
            ("urbanGrindingWheel", "civic_object", "workshop", ["workshop_yard", "facade_side"], (1, 1), "Manual grinding wheel"),
            ("urbanSawhorse", "civic_object", "workshop", ["workshop_yard", "alley_back"], (2, 1), "Carpenter's wooden sawhorse"),
            ("urbanPotteryWheel", "civic_object", "workshop", ["workshop_yard", "courtyard"], (1, 1), "Traditional wooden pottery wheel"),
            ("urbanPotteryKiln", "civic_object", "workshop", ["workshop_yard", "courtyard"], (2, 2), "Compact outdoor pottery kiln"),
            ("urbanDyeVat", "civic_object", "workshop", ["workshop_yard", "courtyard"], (2, 2), "Wooden textile dyeing vat"),
            ("urbanLoom", "civic_object", "workshop", ["workshop_yard", "facade_side"], (2, 1), "Compact medieval weaving loom"),
        ],
    },
    {
        "prefix": "s03",
        "filename": "building_signs.png",
        "title": "03 — Building Signs & Facade Attachments",
        "items": [
            ("signTavern", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Hanging beer mug tavern sign"),
            ("signForge", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Hammer and anvil sign"),
            ("signBakery", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Bread loaf sign"),
            ("signButcher", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Meat cleaver sign"),
            ("signFishmonger", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Fish symbol sign"),
            ("signHerbalist", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Herb bundle sign"),
            ("signApothecary", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Potion bottle sign"),
            ("signClothier", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Fabric and spindle sign"),
            ("signTailor", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Needle and scissors sign"),
            ("signCobbler", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Leather boot sign"),
            ("signCarpenter", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Hand plane and mallet sign"),
            ("signStable", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Horseshoe and horse emblem"),
            ("signInn", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Bed symbol sign"),
            ("signTemple", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Sacred sun religious emblem"),
            ("signGuild", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Crossed artisan tools emblem"),
            ("signGeneralStore", "building_attachment", "signs", ["building_wall", "building_front"], (1, 1), "Merchant scales symbol"),
        ],
    },
    {
        "prefix": "s04",
        "filename": "urban_lighting.png",
        "title": "04 — Urban Lighting",
        "items": [
            ("lampStreetIron", "light_fixture", "lighting", ["intersection", "roadside", "plaza_edge"], (1, 1), "Wrought iron street lamp"),
            ("lampStreetWood", "light_fixture", "lighting", ["roadside", "intersection", "gate_zone"], (1, 1), "Wooden lantern post"),
            ("lampStreetStone", "light_fixture", "lighting", ["plaza_edge", "intersection", "courtyard"], (1, 1), "Decorative stone street lamp"),
            ("lampStreetFancy", "light_fixture", "lighting", ["plaza_edge", "noble_avenue", "intersection"], (1, 1), "Ornate wealthy district street lamp"),
            ("lampWallLantern", "building_attachment", "lighting", ["building_wall", "building_front"], (1, 1), "Wall-mounted iron lantern"),
            ("lampWallTorch", "building_attachment", "lighting", ["building_wall", "gate_wall"], (1, 1), "Wall-mounted torch bracket"),
            ("lampHangingLantern", "building_attachment", "lighting", ["building_eave", "building_front"], (1, 1), "Suspended medieval lantern"),
            ("lampHangingCage", "building_attachment", "lighting", ["building_wall", "gate_arch"], (1, 1), "Iron-caged hanging lantern"),
            ("lampBrazierSquare", "light_fixture", "lighting", ["plaza_edge", "gate_zone", "temple_court"], (1, 1), "Square stone brazier"),
            ("lampBrazierRound", "light_fixture", "lighting", ["gate_zone", "plaza_edge", "courtyard"], (1, 1), "Round iron brazier"),
            ("lampTorchStand", "light_fixture", "lighting", ["gate_zone", "courtyard", "roadside"], (1, 1), "Freestanding wooden torch stand"),
            ("lampFireBasket", "light_fixture", "lighting", ["quayside", "gate_zone", "alley_back"], (1, 1), "Iron fire basket"),
            ("lampOilLantern", "light_fixture", "lighting", ["market_table", "courtyard", "facade_front"], (1, 1), "Portable brass oil lantern"),
            ("lampCandleLantern", "light_fixture", "lighting", ["courtyard", "facade_front", "shrine"], (1, 1), "Enclosed candle lantern"),
            ("lampHarborLantern", "light_fixture", "lighting", ["quayside", "pier_head"], (1, 1), "Weatherproof harbor lantern"),
            ("lampSignalBeacon", "light_fixture", "lighting", ["wall_tower", "gate_zone", "pier_head"], (2, 2), "Raised signal beacon brazier"),
        ],
    },
    {
        "prefix": "s05",
        "filename": "residential_yards.png",
        "title": "05 — Residential Yards",
        "items": [
            ("yardLaundryLine", "civic_object", "residential", ["courtyard", "alley_back"], (2, 1), "Laundry line on wooden supports"),
            ("yardWashTub", "civic_object", "residential", ["courtyard", "facade_side"], (1, 1), "Household washing tub"),
            ("yardWashboard", "civic_object", "residential", ["courtyard", "facade_side"], (1, 1), "Individual wooden washboard"),
            ("yardWaterPail", "civic_object", "residential", ["courtyard", "facade_side"], (1, 1), "Water bucket with ladle"),
            ("yardChoppingBlock", "civic_object", "residential", ["courtyard", "alley_back"], (1, 1), "Wood chopping block with axe"),
            ("yardFirewoodRack", "civic_object", "residential", ["facade_side", "courtyard", "alley_back"], (2, 1), "Stacked firewood rack"),
            ("yardBroomRake", "civic_object", "residential", ["facade_side", "courtyard"], (1, 1), "Household cleaning tools"),
            ("yardCompostBin", "civic_object", "farm", ["courtyard", "alley_back"], (1, 1), "Wooden compost container"),
            ("yardChickenCoop", "civic_object", "farm", ["courtyard", "farm_yard"], (2, 1), "Small wooden chicken coop"),
            ("yardFeedTrough", "civic_object", "farm", ["courtyard", "farm_yard"], (2, 1), "Animal feeding trough"),
            ("yardBeehive", "civic_object", "farm", ["garden_yard", "farm_yard"], (1, 1), "Straw and wooden beehive"),
            ("yardDoghouse", "civic_object", "residential", ["courtyard", "facade_side"], (1, 1), "Small wooden doghouse"),
            ("yardHerbBed", "civic_object", "farm", ["garden_yard", "courtyard"], (2, 1), "Compact medicinal herb garden"),
            ("yardVegetableBed", "civic_object", "farm", ["garden_yard", "farm_yard"], (2, 2), "Raised vegetable garden"),
            ("yardFlowerPots", "civic_object", "residential", ["facade_front", "courtyard"], (1, 1), "Group of three clay flower pots"),
            ("yardOutdoorCookstove", "civic_object", "residential", ["courtyard", "inn_yard"], (1, 1), "Small stone outdoor cooking stove"),
        ],
    },
    {
        "prefix": "s06",
        "filename": "ground_decals.png",
        "title": "06 — Ground Decals",
        "items": [
            ("decalCartTracksStraight", "ground_decal", "traffic", ["dirt_road", "gate_zone", "market_entry"], (2, 1), "Straight cart wheel tracks"),
            ("decalCartTracksTurn", "ground_decal", "traffic", ["intersection", "dirt_road"], (2, 2), "Curved cart wheel tracks"),
            ("decalBootFootprintsMud", "ground_decal", "traffic", ["alley", "door_approach", "dirt_road"], (1, 1), "Muddy boot footprints"),
            ("decalHoofprints", "ground_decal", "traffic", ["dirt_road", "stable_yard", "gate_zone"], (1, 1), "Horse hoofprints"),
            ("decalTrampledGrass", "ground_decal", "residential", ["courtyard", "outskirts_path"], (2, 2), "Flattened grass from repeated walking"),
            ("decalMudSplashes", "ground_decal", "litter", ["alley", "roadside", "market_unload"], (1, 1), "Irregular mud splashes"),
            ("decalWoodChips", "ground_decal", "workshop", ["workshop_yard", "carpenter_front"], (1, 1), "Scattered wood shavings"),
            ("decalStraw", "ground_decal", "market", ["stable_yard", "market_unload", "farm_yard"], (2, 1), "Scattered straw and hay"),
            ("decalCobbleCracks", "ground_decal", "traffic", ["cobble_street", "plaza"], (1, 1), "Cracked cobblestone surface"),
            ("decalMissingCobble", "ground_decal", "traffic", ["cobble_street", "old_plaza"], (1, 1), "Missing paving stones"),
            ("decalSootStain", "ground_decal", "workshop", ["smithy_front", "forge_yard", "ruin"], (1, 1), "Irregular soot stain"),
            ("decalWetPatch", "ground_decal", "traffic", ["well_surround", "quayside", "wash_area"], (1, 1), "Damp ground patch"),
            ("decalManure", "ground_decal", "litter", ["stable_yard", "gate_zone", "dirt_road"], (1, 1), "Small animal manure patch"),
            ("decalBrokenPottery", "ground_decal", "litter", ["alley_back", "market_edge", "potter_yard"], (1, 1), "Broken pottery fragments"),
            ("decalWeedsInCracks", "ground_decal", "residential", ["old_plaza", "alley", "abandoned_street"], (1, 1), "Small weeds in paving cracks"),
            ("decalRopeDrag", "ground_decal", "workshop", ["quayside", "warehouse_entry"], (2, 1), "Curved rope dragging mark"),
        ],
    },
    {
        "prefix": "s07",
        "filename": "urban_greenery.png",
        "title": "07 — Urban Greenery",
        "items": [
            ("greenStonePlanterRound", "civic_object", "green", ["plaza_edge", "noble_courtyard", "facade_front"], (1, 1), "Round stone flower planter"),
            ("greenStonePlanterRect", "civic_object", "green", ["plaza_edge", "facade_front", "temple_court"], (2, 1), "Rectangular stone planter"),
            ("greenFlowerUrn", "civic_object", "decoration", ["noble_courtyard", "facade_front", "plaza_edge"], (1, 1), "Ornate ceramic flower urn"),
            ("greenHerbPot", "civic_object", "residential", ["courtyard", "facade_front"], (1, 1), "Medicinal herb pot"),
            ("greenTopiaryCone", "civic_object", "green", ["noble_courtyard", "temple_court", "plaza_edge"], (1, 1), "Trimmed conical shrub"),
            ("greenTopiaryBall", "civic_object", "green", ["noble_courtyard", "plaza_edge"], (1, 1), "Rounded decorative topiary"),
            ("greenHedgeBox", "civic_object", "green", ["noble_courtyard", "private_garden"], (2, 1), "Rectangular clipped hedge"),
            ("greenPottedCypress", "civic_object", "green", ["temple_court", "noble_courtyard", "facade_front"], (1, 1), "Miniature ornamental cypress"),
            ("greenRoseTrellis", "civic_object", "green", ["private_garden", "facade_side"], (2, 1), "Wooden trellis with climbing roses"),
            ("greenGrapeTrellis", "civic_object", "green", ["garden_yard", "inn_yard"], (2, 1), "Grape vine support"),
            ("greenFlowerBed", "civic_object", "green", ["private_garden", "plaza_edge"], (2, 2), "Arranged flower bed"),
            ("greenVegetableHerbBox", "civic_object", "residential", ["courtyard", "garden_yard"], (2, 1), "Culinary herb planter"),
            ("greenHangingPlanter", "building_attachment", "green", ["building_eave", "building_front"], (1, 1), "Hanging flower basket"),
            ("greenWindowBox", "building_attachment", "green", ["building_window", "building_front"], (1, 1), "Building window flower box"),
            ("greenOrnamentalShrubPot", "civic_object", "decoration", ["facade_front", "noble_courtyard"], (1, 1), "Decorative shrub in clay pot"),
            ("greenSmallGardenStatue", "civic_object", "decoration", ["noble_courtyard", "temple_court", "private_garden"], (1, 1), "Small stone garden statue"),
        ],
    },
    {
        "prefix": "s08",
        "filename": "building_damage.png",
        "title": "08 — Building Damage Overlays",
        "items": [
            ("wearStoneChips", "building_damage_overlay", "decoration", ["building_wall", "foundation"], (1, 1), "Chipped stone masonry"),
            ("wearStoneCrackShort", "building_damage_overlay", "decoration", ["building_wall"], (1, 1), "Short branching stone cracks"),
            ("wearStoneCrackLong", "building_damage_overlay", "decoration", ["building_wall", "tower_wall"], (1, 2), "Long structural crack"),
            ("wearMissingMortar", "building_damage_overlay", "decoration", ["building_wall", "foundation"], (1, 1), "Eroded masonry joints"),
            ("wearPlasterPeelingSmall", "building_damage_overlay", "residential", ["building_wall"], (1, 1), "Small peeling plaster patch"),
            ("wearPlasterPeelingLarge", "building_damage_overlay", "residential", ["building_wall"], (2, 1), "Large plaster loss"),
            ("wearExposedBrick", "building_damage_overlay", "residential", ["building_wall"], (1, 1), "Exposed underlying brick"),
            ("wearPatchedPlaster", "building_damage_overlay", "residential", ["building_wall"], (1, 1), "Poorly repaired plaster"),
            ("wearMossFooting", "building_damage_overlay", "decoration", ["foundation", "north_wall"], (2, 1), "Moss on building foundation"),
            ("wearDampStain", "building_damage_overlay", "residential", ["foundation", "building_wall"], (1, 1), "Moisture stain"),
            ("wearSootStreak", "building_damage_overlay", "decoration", ["chimney_wall", "smithy_wall", "ruin_wall"], (1, 1), "Dark soot marks"),
            ("wearLichenStone", "building_damage_overlay", "decoration", ["ancient_wall", "foundation"], (1, 1), "Lichen on masonry"),
            ("wearTimberRot", "building_damage_overlay", "residential", ["timber_wall", "eave"], (1, 1), "Decayed timber surface"),
            ("wearBrokenBoard", "building_damage_overlay", "residential", ["timber_wall", "shed_wall"], (1, 1), "Broken wooden plank"),
            ("wearFoundationCrack", "building_damage_overlay", "decoration", ["foundation_corner"], (1, 1), "Damaged foundation corner"),
            ("wearMissingShingles", "building_damage_overlay", "residential", ["building_roof"], (1, 1), "Missing roof shingles"),
        ],
    },
    {
        "prefix": "s09",
        "filename": "building_materials.png",
        "title": "09 — Building Materials",
        "items": [
            ("matLimestone", "material_texture", "architecture", ["wall_surface", "civic_masonry"], (1, 1), "Warm aged limestone"),
            ("matGranite", "material_texture", "architecture", ["fortification_wall", "foundation"], (1, 1), "Coarse dark granite"),
            ("matFieldstone", "material_texture", "architecture", ["village_wall", "boundary_wall"], (1, 1), "Irregular fieldstone masonry"),
            ("matRubbleStone", "material_texture", "architecture", ["foundation", "outbuilding_wall"], (1, 1), "Rough rubble foundation"),
            ("matWeatheredSandstone", "material_texture", "architecture", ["wall_surface", "temple_masonry"], (1, 1), "Weathered sandstone"),
            ("matCutStone", "material_texture", "architecture", ["noble_wall", "town_hall_wall"], (1, 1), "Refined cut stone"),
            ("matBrick", "material_texture", "architecture", ["townhouse_wall", "workshop_wall"], (1, 1), "Medieval clay brick"),
            ("matMossyStone", "material_texture", "architecture", ["ancient_wall", "damp_foundation"], (1, 1), "Mossy stone masonry"),
            ("matCreamPlaster", "material_texture", "architecture", ["townhouse_wall", "upper_storey"], (1, 1), "Aged cream plaster"),
            ("matOchrePlaster", "material_texture", "architecture", ["market_facade", "townhouse_wall"], (1, 1), "Ochre plaster"),
            ("matRosePlaster", "material_texture", "architecture", ["noble_facade", "guild_wall"], (1, 1), "Muted rose plaster"),
            ("matAdobe", "material_texture", "architecture", ["arid_wall", "vernacular_wall"], (1, 1), "Adobe construction"),
            ("matTimberPlanks", "material_texture", "architecture", ["cottage_wall", "warehouse_wall"], (1, 1), "Weathered wooden planks"),
            ("matHalfTimber", "material_texture", "architecture", ["medieval_facade", "inn_wall"], (1, 1), "Timber frame and plaster infill"),
            ("matCharredTimber", "material_texture", "architecture", ["damaged_wall", "smithy_wall"], (1, 1), "Smoke-darkened timber"),
            ("matFoundationStone", "material_texture", "architecture", ["foundation_course", "retaining_wall"], (1, 1), "Rough foundation masonry"),
        ],
    },
    {
        "prefix": "s10",
        "filename": "market_goods.png",
        "title": "10 — Market Goods Expansion",
        "items": [
            ("marketScale", "civic_object", "market", ["stall_counter", "table_top"], (1, 1), "Small brass merchant balance scale"),
            ("marketWeights", "civic_object", "market", ["stall_counter", "table_top"], (1, 1), "Medieval trade measuring weights"),
            ("marketCoins", "civic_object", "market", ["stall_counter", "guild_desk"], (1, 1), "Coin tray with gold and silver coins"),
            ("marketLedger", "civic_object", "market", ["stall_counter", "warehouse_desk"], (1, 1), "Merchant ledger, quill and ink"),
            ("marketSpiceBowls", "civic_object", "market", ["stall_counter", "bazaar_display"], (1, 1), "Ceramic bowls of spices"),
            ("marketSpiceRack", "civic_object", "market", ["stall_counter", "bazaar_display"], (1, 1), "Small wooden spice rack"),
            ("marketHerbBundles", "civic_object", "market", ["stall_counter", "apothecary_front"], (1, 1), "Bundles of dried medicinal herbs"),
            ("marketHoneyJars", "civic_object", "market", ["stall_counter", "village_stall"], (1, 1), "Small sealed honey pots"),
            ("marketSmokedFishRack", "civic_object", "market", ["port_stall", "quayside_market"], (1, 1), "Compact rack of preserved fish"),
            ("marketMeatHooks", "civic_object", "market", ["butcher_stall", "market_row"], (1, 1), "Small cured meat display"),
            ("marketCheeseWheels", "civic_object", "market", ["stall_counter", "dairy_stall"], (1, 1), "Group of rustic cheese wheels"),
            ("marketSaltMeasure", "civic_object", "market", ["stall_counter", "caravan_stall"], (1, 1), "Salt blocks and measuring scoop"),
            ("marketGlassVials", "civic_object", "market", ["stall_counter", "apothecary_stall"], (1, 1), "Glass potion vials on a narrow tray"),
            ("marketCandleBundles", "civic_object", "market", ["stall_counter", "craft_stall"], (1, 1), "Bundle of handcrafted candles"),
            ("marketFabricBolts", "civic_object", "market", ["clothier_stall", "bazaar_display"], (1, 1), "Folded and rolled dyed fabrics"),
            ("marketFlowerBundles", "civic_object", "market", ["market_basket", "plaza_vendor"], (1, 1), "Merchant flower bouquets"),
        ],
    },
]

LIGHT_METADATA = {
    "lampStreetIron": (5.5, 0.90, "#ffb85c", "street_lantern"),
    "lampStreetWood": (5.0, 0.82, "#ffb357", "street_lantern"),
    "lampStreetStone": (5.5, 0.88, "#ffc270", "street_lantern"),
    "lampStreetFancy": (6.5, 0.96, "#ffd084", "street_lantern"),
    "lampWallLantern": (4.0, 0.78, "#ffc06e", "wall_sconce"),
    "lampWallTorch": (4.5, 0.84, "#ff9947", "wall_sconce"),
    "lampHangingLantern": (4.2, 0.80, "#ffc478", "wall_sconce"),
    "lampHangingCage": (4.0, 0.75, "#ffad58", "wall_sconce"),
    "lampBrazierSquare": (5.8, 0.92, "#ff8c42", "brazier"),
    "lampBrazierRound": (5.5, 0.90, "#ff8c42", "brazier"),
    "lampTorchStand": (4.8, 0.85, "#ff9848", "gate_torch"),
    "lampFireBasket": (5.2, 0.88, "#ff853b", "brazier"),
    "lampOilLantern": (3.2, 0.65, "#ffca7a", "street_lantern"),
    "lampCandleLantern": (2.8, 0.55, "#ffd591", "street_lantern"),
    "lampHarborLantern": (5.6, 0.88, "#ffbe6b", "pier_lantern"),
    "lampSignalBeacon": (9.0, 1.00, "#ff7b36", "brazier"),
}

DAMAGE_COMPATIBILITY = {
    "wearStoneChips": ["matLimestone", "matGranite", "matCutStone", "matWeatheredSandstone"],
    "wearStoneCrackShort": ["matLimestone", "matGranite", "matCutStone", "matFieldstone"],
    "wearStoneCrackLong": ["matLimestone", "matGranite", "matCutStone", "matFoundationStone"],
    "wearMissingMortar": ["matFieldstone", "matBrick", "matRubbleStone", "matCutStone"],
    "wearPlasterPeelingSmall": ["matCreamPlaster", "matOchrePlaster", "matRosePlaster", "matHalfTimber"],
    "wearPlasterPeelingLarge": ["matCreamPlaster", "matOchrePlaster", "matRosePlaster", "matAdobe"],
    "wearExposedBrick": ["matCreamPlaster", "matOchrePlaster", "matRosePlaster", "matBrick"],
    "wearPatchedPlaster": ["matCreamPlaster", "matOchrePlaster", "matAdobe", "matHalfTimber"],
    "wearMossFooting": ["matLimestone", "matFieldstone", "matFoundationStone", "matMossyStone"],
    "wearDampStain": ["matCreamPlaster", "matOchrePlaster", "matLimestone", "matAdobe"],
    "wearSootStreak": ["matBrick", "matLimestone", "matCreamPlaster", "matCharredTimber"],
    "wearLichenStone": ["matGranite", "matFieldstone", "matLimestone", "matFoundationStone"],
    "wearTimberRot": ["matTimberPlanks", "matHalfTimber"],
    "wearBrokenBoard": ["matTimberPlanks", "matHalfTimber", "matCharredTimber"],
    "wearFoundationCrack": ["matFoundationStone", "matRubbleStone", "matGranite", "matLimestone"],
    "wearMissingShingles": ["roof_shingles", "roof_slate", "roof_tile"],
}


def build_manifest() -> list[dict]:
    manifest = []
    seen_ids = set()
    for sheet in SHEETS_SPEC:
        sheet_file = sheet["filename"]
        assert len(sheet["items"]) == 16, f"{sheet_file} must have 16 items"
        for idx, (obj_id, asset_type, category, contexts, fp, desc) in enumerate(sheet["items"]):
            assert obj_id not in seen_ids, f"Duplicate asset ID: {obj_id}"
            seen_ids.add(obj_id)
            row = idx // GRID_DIM
            col = idx % GRID_DIM

            if asset_type == "building_attachment":
                anchor = {"x": 0.5, "y": 0.1}
            else:
                anchor = {"x": 0.5, "y": 0.5}

            entry: dict = {
                "id": obj_id,
                "assetType": asset_type,
                "category": category,
                "placementContext": contexts,
                "footprint": {"width": fp[0], "height": fp[1]},
                "anchor": anchor,
                "sheet": sheet_file,
                "cellIndex": idx + 1,
                "row": row,
                "column": col,
                "description": desc,
            }

            if asset_type == "building_attachment":
                entry["mountingAnchor"] = {"x": 0.5, "y": 0.1, "edge": "top_center", "facadeRelative": True}

            if obj_id in LIGHT_METADATA:
                rad, inten, col_hex, ltype = LIGHT_METADATA[obj_id]
                entry["lightRadius"] = rad
                entry["lightIntensity"] = inten
                entry["lightColor"] = col_hex
                entry["lightType"] = ltype

            if asset_type == "ground_decal":
                entry["surfaceContext"] = contexts
                entry["blocksMovement"] = False

            if asset_type == "building_damage_overlay":
                entry["compatibleMaterials"] = DAMAGE_COMPATIBILITY.get(obj_id, ["stone", "plaster", "timber"])

            if asset_type == "material_texture":
                entry["tileSeamless"] = True
                entry["swatchBounds"] = {"x": 48, "y": 48, "width": 416, "height": 416}

            manifest.append(entry)
    assert len(manifest) == 160, f"Expected 160 entries, got {len(manifest)}"
    return manifest


# ---------------------------------------------------------------------------
# Alpha Extraction, Despill & Seamless Tile Synthesis
# ---------------------------------------------------------------------------

def extract_prop_rgba(raw_path: Path, is_attachment: bool = False) -> Image.Image:
    """
    Extracts a closed-contour RPG prop on a #FFFFFF studio background into a clean
    512x512 true-RGBA cell with 10% padding and zero white halo.
    """
    im = Image.open(raw_path).convert("RGB")
    arr = np.asarray(im, dtype=np.float32)
    h, w, _ = arr.shape

    # Distance from pure white (#FFFFFF) considering luminance + chroma:
    diff = 255.0 - arr
    max_drop = np.max(diff, axis=2)
    chroma = np.max(arr, axis=2) - np.min(arr, axis=2)
    whiteness_dist = max_drop + chroma * 0.65

    # Candidate background pixels: very close to white
    bg_candidate = (whiteness_dist < 22.0).astype(np.uint8)

    # Flood-fill from all 4 borders so interior highlights/water/parchment are NEVER erased!
    labeled, _ = ndimage.label(bg_candidate)
    border_labels = set(np.unique(labeled[0, :])) | set(np.unique(labeled[-1, :])) | set(np.unique(labeled[:, 0])) | set(np.unique(labeled[:, -1]))
    border_labels.discard(0)
    exterior_bg = np.isin(labeled, list(border_labels))

    # Also knock out enclosed studio-white pockets trapped inside dark-ink frames/rings/brackets/chains:
    near_white = (np.min(arr, axis=2) >= 220.0) & (chroma <= 16.0) & (~exterior_bg)
    pw_lbl, n_pw = ndimage.label(near_white)
    if n_pw > 0:
        lum = np.mean(arr, axis=2)
        for pid in range(1, n_pw + 1):
            pocket = pw_lbl == pid
            if int(pocket.sum()) < 8:
                continue
            dil = ndimage.binary_dilation(pocket, iterations=2)
            rim = dil & (~pocket) & (~exterior_bg)
            if (
                rim.any()
                and float(np.median(lum[rim])) < 185.0
                and float(np.percentile(lum[rim], 25)) < 90.0
                and float(np.mean(chroma[pocket])) <= 5.5
            ):
                exterior_bg = exterior_bg | ndimage.binary_dilation(pocket, iterations=1)

    # Remove tiny disconnected exterior noise specks (< 0.06% area)
    fg_mask = (~exterior_bg).astype(np.uint8)
    fg_lbl, n_fg = ndimage.label(fg_mask)
    if n_fg > 1:
        min_area = max(24, int(h * w * 0.0005))
        sizes = ndimage.sum(fg_mask, fg_lbl, range(1, n_fg + 1))
        keep_labels = [i + 1 for i, s in enumerate(sizes) if s >= min_area]
        if keep_labels:
            fg_mask = np.isin(fg_lbl, keep_labels).astype(np.uint8)

    # Smooth outer 1.5px edge & un-premultiply white halo along outer boundary:
    dist_in = ndimage.distance_transform_edt(fg_mask)
    alpha = np.clip(dist_in / 1.6, 0.0, 1.0)
    # On boundary band (0 < dist_in <= 2.5), modulate alpha by whiteness_dist for crisp dark ink edges:
    edge_band = (dist_in > 0) & (dist_in <= 2.5)
    ink_alpha = np.clip((whiteness_dist - 10.0) / 38.0, 0.0, 1.0)
    alpha = np.where(edge_band, np.maximum(alpha * 0.55, ink_alpha), alpha)
    alpha = np.where(fg_mask == 0, 0.0, alpha)

    # Un-premultiply white from semi-transparent edge pixels:
    safe_a = np.maximum(alpha[:, :, None], 1e-3)
    rgb_clean = np.where(
        (alpha[:, :, None] > 0.02) & (alpha[:, :, None] < 0.96),
        np.clip((arr - (1.0 - safe_a) * 255.0) / safe_a, 0.0, 255.0),
        arr,
    )

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.round(rgb_clean).astype(np.uint8)
    rgba[:, :, 3] = np.round(alpha * 255.0).astype(np.uint8)

    # Crop tight bounding box and place into 512x512 with 10% padding:
    ys, xs = np.where(rgba[:, :, 3] > 12)
    if len(xs) == 0:
        return Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))

    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA")

    pad_px = int(round(CELL_SIZE * PAD_RATIO))  # 51 px (10%)
    max_span = CELL_SIZE - 2 * pad_px           # 410 px
    scale = min(max_span / cropped.width, max_span / cropped.height)
    new_w = max(1, int(round(cropped.width * scale)))
    new_h = max(1, int(round(cropped.height * scale)))
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    ox = (CELL_SIZE - new_w) // 2
    # Attachments align mounting bracket at top padding line (y = 10%); regular props center!
    oy = pad_px if is_attachment else (CELL_SIZE - new_h) // 2
    cell.alpha_composite(resized, (ox, oy))
    return cell


def extract_decal_rgba(raw_path: Path) -> Image.Image:
    """
    Soft continuous alpha extraction + white un-premultiplication for ground decals
    and building damage overlays.
    """
    im = Image.open(raw_path).convert("RGB")
    arr = np.asarray(im, dtype=np.float32)
    diff = 255.0 - arr
    max_drop = np.max(diff, axis=2)
    chroma = np.max(arr, axis=2) - np.min(arr, axis=2)
    strength = np.clip((max_drop + chroma * 0.5 - 12.0) / 165.0, 0.0, 1.0)
    alpha = np.power(strength, 0.82)

    # Fade outer 4% border gently to prevent any square frame clipping:
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w]
    edge_dist = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / max(1.0, min(h, w) * 0.06)
    alpha *= np.clip(edge_dist, 0.0, 1.0)

    safe_a = np.maximum(alpha[:, :, None], 1e-3)
    rgb = np.clip((arr - (1.0 - safe_a) * 255.0) / safe_a, 0.0, 255.0)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.round(rgb).astype(np.uint8)
    rgba[:, :, 3] = np.round(alpha * 255.0).astype(np.uint8)

    ys, xs = np.where(rgba[:, :, 3] > 8)
    if len(xs) == 0:
        return Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA")

    pad_px = int(round(CELL_SIZE * PAD_RATIO))
    max_span = CELL_SIZE - 2 * pad_px
    scale = min(max_span / cropped.width, max_span / cropped.height)
    resized = cropped.resize(
        (max(1, int(round(cropped.width * scale))), max(1, int(round(cropped.height * scale)))),
        Image.Resampling.LANCZOS,
    )
    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    cell.alpha_composite(resized, ((CELL_SIZE - resized.width) // 2, (CELL_SIZE - resized.height) // 2))
    return cell


def _min_cut_mask_vertical(err: np.ndarray) -> np.ndarray:
    """Dynamic programming minimum-error vertical seam mask (H x OV), True = keep right/primary."""
    h, w = err.shape
    dp = err.copy()
    back = np.zeros((h, w), dtype=np.int32)
    for y in range(1, h):
        prev = dp[y - 1]
        for x in range(w):
            x0 = max(0, x - 1)
            x1 = min(w, x + 2)
            best_off = int(np.argmin(prev[x0:x1]))
            bx = x0 + best_off
            dp[y, x] += prev[bx]
            back[y, x] = bx
    mask = np.zeros((h, w), dtype=np.float32)
    cx = int(np.argmin(dp[-1]))
    for y in range(h - 1, -1, -1):
        mask[y, cx:] = 1.0
        cx = int(back[y, cx])
    return cv2.GaussianBlur(mask, (0, 0), sigmaX=1.5, sigmaY=1.5)


def make_seamless_material(raw_path: Path) -> Image.Image:
    """
    Produces a 416x416 razor-sharp seamlessly tileable square material swatch centered
    inside a 512x512 RGBA cell (48px = 9.375% transparent padding, zero neighbor bleed)
    using course-phase matching + Efros-Freeman DP minimum-error seam quilting.
    """
    SWATCH = 416
    PAD = (CELL_SIZE - SWATCH) // 2  # 48 px (9.375% padding)

    im = Image.open(raw_path).convert("RGB")
    if im.width < 900 or im.height < 900:
        im = im.resize((1024, 1024), Image.Resampling.LANCZOS)
    w, h = im.size
    mx, my = int(w * 0.04), int(h * 0.04)
    arr = np.asarray(im.crop((mx, my, w - mx, h - my)), dtype=np.float32)

    # Flatten low-frequency lighting gradient so opposite edges match seamlessly:
    blur = cv2.GaussianBlur(arr, (0, 0), sigmaX=88, sigmaY=88)
    mean_color = np.mean(arr, axis=(0, 1), keepdims=True)
    arr = np.clip(arr - blur + mean_color, 0.0, 255.0)

    ah, aw, _ = arr.shape
    ov = 64

    # Find best (py, px) in [360..min(580, dim - ov - 8)] using full 2D overlap pixel agreement
    # so running-bond masonry locks onto an EVEN number of courses (matching perpends too!):
    small = cv2.resize(arr, (aw // 4, ah // 4), interpolation=cv2.INTER_AREA)
    sh, sw, _ = small.shape
    sov = max(8, ov // 4)

    best_px, best_px_err = SWATCH, float("inf")
    for px_s in range(90, min(146, sw - sov - 2)):
        sx0 = (sw - (px_s + sov)) // 2
        e = float(np.mean((small[:, sx0 : sx0 + sov] - small[:, sx0 + px_s : sx0 + px_s + sov]) ** 2))
        if e < best_px_err:
            best_px_err = e
            best_px = px_s * 4

    best_py, best_py_err = SWATCH, float("inf")
    sx0 = (sw - (best_px // 4)) // 2
    spx = best_px // 4
    for py_s in range(90, min(146, sh - sov - 2)):
        sy0 = (sh - (py_s + sov)) // 2
        e = float(
            np.mean(
                (
                    small[sy0 : sy0 + sov, sx0 : sx0 + spx]
                    - small[sy0 + py_s : sy0 + py_s + sov, sx0 : sx0 + spx]
                )
                ** 2
            )
        )
        if e < best_py_err:
            best_py_err = e
            best_py = py_s * 4

    # 2) Stitch vertical wrap using a tight 20px overlap centered on the best horizontal mortar line
    # so the horizontal seam runs strictly along mortar joints and never notches into stone/brick faces:
    ov_y = 20
    y0 = (ah - (best_py + ov_y)) // 2
    x0 = (aw - (best_px + ov)) // 2
    # Refine y0 by +-24px so row y0 (and y0 + best_py) sits right on the lowest-error horizontal seam:
    best_y0, best_seam_err = y0, float("inf")
    for dy in range(-28, 29):
        cy0 = y0 + dy
        if cy0 < 0 or cy0 + best_py + ov_y >= ah:
            continue
        se = float(np.mean((arr[cy0 : cy0 + ov_y, x0 : x0 + best_px] - arr[cy0 + best_py : cy0 + best_py + ov_y, x0 : x0 + best_px]) ** 2))
        if se < best_seam_err:
            best_seam_err = se
            best_y0 = cy0

    patch = arr[best_y0 : best_y0 + best_py + ov_y, x0 : x0 + best_px + ov]
    left_ov = patch[:, :ov, :]
    right_ov = patch[:, best_px : best_px + ov, :]
    err_v = np.sum((left_ov - right_ov) ** 2, axis=2)
    mask_v = _min_cut_mask_vertical(err_v)[:, :, None]
    stitched_ov_x = right_ov * (1.0 - mask_v) + left_ov * mask_v
    tile_x = np.concatenate([stitched_ov_x, patch[:, ov:best_px, :]], axis=1)

    top_ov = tile_x[:ov_y, :, :]
    bot_ov = tile_x[best_py : best_py + ov_y, :, :]
    wy = np.linspace(0.0, 1.0, ov_y, dtype=np.float32)[:, None, None]
    stitched_ov_y = bot_ov * (1.0 - wy) + top_ov * wy
    tile_xy = np.concatenate([stitched_ov_y, tile_x[ov_y:best_py, :, :]], axis=0)

    # 3) Periodic-padded resize to exact SWATCH x SWATCH so Lanczos kernel wraps cleanly:
    pad_w = 16
    tiled_3x3 = np.tile(np.clip(tile_xy, 0, 255).astype(np.uint8), (3, 3, 1))
    th, tw, _ = tile_xy.shape
    sub_pil = Image.fromarray(tiled_3x3[th - pad_w : 2 * th + pad_w, tw - pad_w : 2 * tw + pad_w])
    scale_x = SWATCH / tw
    scale_y = SWATCH / th
    new_pw = int(round(pad_w * scale_x))
    new_ph = int(round(pad_w * scale_y))
    resized = sub_pil.resize((SWATCH + 2 * new_pw, SWATCH + 2 * new_ph), Image.Resampling.LANCZOS)
    swatch_rgb = resized.crop((new_pw, new_ph, new_pw + SWATCH, new_ph + SWATCH))

    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    swatch_rgba = swatch_rgb.convert("RGBA")
    cell.paste(swatch_rgba, (PAD, PAD))
    return cell


def process_all_available() -> tuple[int, list[str]]:
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    CELLS_DIR.mkdir(parents=True, exist_ok=True)

    manifest = build_manifest()
    manifest_path = PACK_DIR / "urban_asset_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    processed_count = 0
    missing_keys: list[str] = []
    completed_sheets: list[tuple[str, Image.Image]] = []

    for sheet in SHEETS_SPEC:
        prefix = sheet["prefix"]
        sheet_img = Image.new("RGBA", (SHEET_SIZE, SHEET_SIZE), (0, 0, 0, 0))
        sheet_complete = True

        for idx, (obj_id, asset_type, *_rest) in enumerate(sheet["items"]):
            key = f"{prefix}_{idx + 1:02d}_{obj_id}"
            raw_file = RAW_DIR / f"{key}.png"
            cell_file = CELLS_DIR / f"{key}.png"

            if not raw_file.exists():
                sheet_complete = False
                missing_keys.append(key)
                continue

            if not cell_file.exists() or raw_file.stat().st_mtime > cell_file.stat().st_mtime:
                if asset_type == "material_texture":
                    cell_im = make_seamless_material(raw_file)
                elif asset_type in ("ground_decal", "building_damage_overlay"):
                    cell_im = extract_decal_rgba(raw_file)
                else:
                    cell_im = extract_prop_rgba(raw_file, is_attachment=(asset_type == "building_attachment"))
                cell_im.save(cell_file, "PNG")
            else:
                cell_im = Image.open(cell_file).convert("RGBA")

            processed_count += 1
            r, c = idx // GRID_DIM, idx % GRID_DIM
            sheet_img.alpha_composite(cell_im, (c * CELL_SIZE, r * CELL_SIZE))

        if sheet_complete:
            out_sheet = PACK_DIR / sheet["filename"]
            sheet_img.save(out_sheet, "PNG")
            completed_sheets.append((sheet["title"], sheet_img))

    # Build a checkerboard QA preview of the latest 10 processed cells (by mtime):
    cell_files = sorted(CELLS_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime)
    if cell_files:
        recent = cell_files[-10:]
        cols = min(5, len(recent))
        rows = math.ceil(len(recent) / cols)
        thumb = 240
        prev = Image.new("RGBA", (cols * thumb, rows * thumb), (46, 42, 36, 255))
        draw = ImageDraw.Draw(prev)
        # Subtle warm checkerboard to verify true transparency & zero white halo!
        step = 20
        for y in range(0, prev.height, step):
            for x in range(0, prev.width, step):
                if ((x // step) + (y // step)) % 2 == 0:
                    draw.rectangle([x, y, x + step - 1, y + step - 1], fill=(58, 53, 45, 255))
        for i, cf in enumerate(recent):
            im = Image.open(cf).convert("RGBA").resize((thumb - 12, thumb - 12), Image.Resampling.LANCZOS)
            gx = (i % cols) * thumb + 6
            gy = (i // cols) * thumb + 6
            prev.alpha_composite(im, (gx, gy))
        prev.save(WORK_DIR / "latest_qa_preview.png", "PNG")

    if len(completed_sheets) == 10:
        # Build full 10-sheet master contact sheet `urban_asset_preview.png` (5x2 sheets at 512x512 each = 2560x1024)
        master = Image.new("RGBA", (5 * 512, 2 * 512), (44, 40, 34, 255))
        mdraw = ImageDraw.Draw(master)
        for y in range(0, master.height, 16):
            for x in range(0, master.width, 16):
                if ((x // 16) + (y // 16)) % 2 == 0:
                    mdraw.rectangle([x, y, x + 15, y + 15], fill=(54, 49, 42, 255))
        for idx, (_title, simg) in enumerate(completed_sheets):
            thumb_s = simg.resize((496, 496), Image.Resampling.LANCZOS)
            gx = (idx % 5) * 512 + 8
            gy = (idx // 5) * 512 + 8
            master.alpha_composite(thumb_s, (gx, gy))
        master.save(PACK_DIR / "urban_asset_preview.png", "PNG")

    return processed_count, missing_keys


if __name__ == "__main__":
    done, missing = process_all_available()
    print(f"Processed RGBA cells: {done}/160")
    print(f"Manifest written: {PACK_DIR / 'urban_asset_manifest.json'}")
    if missing:
        print(f"Next 10 queued: {missing[:10]}")
