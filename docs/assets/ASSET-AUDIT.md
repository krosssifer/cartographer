# Cartographer — Complete Graphical Asset Audit (`ASSET-AUDIT.md`)

## 1. Executive Summary & Headline Counts (Initial Repository Baseline)

Before replacing any road or castle fortification textures, every graphical resource across the entire Cartographer repository (`src/assets/cartography/`, `assets/source/`, `public/`, inline SVG registries in `src/lib/`, `docs/`, and `sprite_pack/`) was inventoried programmatically (`scripts/audit-assets.py`) and inspected visually via checkerboard contact sheets (`docs/assets/contact-sheets/*.png`).

| Metric | Baseline Count | Notes |
|---|---:|---|
| **Total graphical entries inspected** | **403** | Across production WebPs, source sheets, `sprite_pack`, inline SVGs, public SVG, and doc renders |
| **Original source sheets (`assets/source/`)** | **5** | `encounter-interior.jpg`, `sprite-sheet-market.jpg`, `sprite-sheet-objects.webp`, `sprite-sheet-traps.jpg`, `sprite-sheet-walls.jpg` (plus **10** newly authored `2048×2048` RGBA sheets in `sprite_pack/`) |
| **Extracted / production WebP files (`src/assets/cartography/`)** | **293** | Embedded inline via `import.meta.glob('../assets/cartography/*.webp', { eager: true, query: '?inline' })` |
| **Unique base sprite/material IDs in `cartography/`** | **197** | Grouping numeric `-2`, `-3`, `-4` variants (`artPick` / `VARIANTS`) |
| **Embedded inline SVG vectors (`src/lib/*.ts`)** | **35** | `3` in `chests.ts`, `24` in `furnitureVectors.ts` (`9` shadowed by WebP, `15` active), `8` in `cryptVectors.ts`, plus `136` procedural SVG fallbacks in `cryptArt.ts` |
| **Production WebP assets actively referenced** | **284 / 293** | `96.9%` referenced by terrain, road, dungeon wall, civic, crypt, tree/rock, furniture, or decor renderers |
| **Unused production WebP assets** | **9** | `wall-column`, `wall-column-2`, `wall-end`, `wall-end-2`, `wall-pillar`, `wall-rubble`, `wall-straightIvy`, `wall-straightIvy-2`, `wall-straightShort` (legacy cell-wall sprites superseded by `wallPaint.ts` ribbon) |
| **Unintegrated `sprite_pack` assets (why new urban sprites didn't show on map)** | **160** (`10` sheets) | Present in `sprite_pack/*.png`, **0** sliced into `src/assets/cartography/*.webp` prior to integration |
| **Exact SHA-256 file duplicates** | **0** | Zero byte-identical files across all directories |
| **Perceptual near-duplicates (`dHash` Hamming ≤ 6)** | **31 pairs** | Primarily resized `320px` re-extractions saved as `-2`/`-3`/`-4` variants (`furniture-bed`/`-3`, `crypt-sawBlade`/`-2`, `crypt-altar`/`-2`, `marketStallBread`/`-3`, etc.) |
| **Assets with transparency / halo / artifact defects** | **26** | `12` legacy `urban*.webp` white sticker halos (`8.8%–36.8%`), `4` `decor-*.webp` screenshot UI icon/corner artifacts (`decor-twig`, `decor-crack`, `decor-pebble`, `decor-snow`), `2` enclosed white holes (`furniture-chair`, `furniture-barrels`), `3` glowing rune/mushroom white matte discs (`crypt-runeBlue`, `crypt-runeCircleBlue`, `crypt-mushroomsGlow`), `5` minor border clips (`chest`, `fountain`, `garden`, `well`, `crypt-runeCircle`) |
| **Assets with stylistic / perspective inconsistencies** | **71** | `71` market/stall/wagon/bench WebPs (`marketStall*`, `marketTent*`, `marketWagon*`, `cart`, `stallRed`, `stallGreen`) drawn in ~30° isometric vs. 90° top-down battlemap projection |
| **Broken / missing / mis-mapped critical resources** | **4 systemic** | (1) `TILE_ART.road = 'bank'` reuses flat sandy riverbank texture; (2) `cobbles.webp` has repetitive concentric mandala circles; (3) `townWallPaint.ts` has **0** stone masonry textures (pure flat color strokes); (4) `decor-twig.webp` has 4 web-UI toolbar buttons baked into the image |

---

## 2. Three Distinct Rendering Systems Verified (Phase 0)

1. **System A — Road Rendering (`src/lib/terrainPaint.ts` + `src/lib/render.ts:drawRoadRibbons`)**:
   - **Cell raster (`terrainPaint.ts`)**: `TILE_ART.road` was mapped to `'bank'` (`bank.webp`, river sandbank) with warm tint `[1.19, 1.09, 0.91]`, producing a flat sandy smear. `TILE_ART.plaza` used `'cobbles'` (`cobbles.webp`), which exhibits repetitive radial fan-circles.
   - **Ribbon overlay (`render.ts:drawRoadRibbons`)**: Chaikin-smoothed road polylines (`map.plan?.roads`) stroke world-space `CanvasPattern`s (`DOMMatrix([cs / tile, 0, 0, cs / tile, 0, 0])`) using only `earth`, `bank`, and `cobbles`, without contextual selection across rural dirt, gravel, ordinary town cobblestone, worn commercial streets, noble paving, or poor/damaged stone.
   - **Plazas & Bridges**: Civic squares (`settlementPaint.ts`, `kind === 'square'`) and wooden bridges (`render.ts:drawBridgeDecks` / `drawWoodwork` using `timber.webp`) are separate subsystems and must remain visually distinct from standard road paving.
2. **System B — Settlement Fortification Walls (`src/lib/townWallPaint.ts`)**:
   - Uses `map.plan?.settlement?.fortification` (`rings` + `towers`), painting grass underneath `wall` cells in `terrainPaint.ts` and tracing continuous arc runs (`wallRuns`) that stop cleanly at gates, rivers, and editor-erased cells.
   - **Defect**: `stoneWall()` previously used **zero** image textures — only flat solid hex strokes (`#3b352b`, `#968d78`, `#b3aa92`, dashed `#6f6754`) and fixed `lineWidth = 1` ignoring `RenderSettings.wallThickness`!
3. **System C — Dungeon Walls (`src/lib/wallPaint.ts`)**:
   - Traces `floor`/`door` borders and strokes `art['wall-straight']` scaled by `RenderSettings.wallThickness`. Kept **100% untouched** per specification.

---

## 3. Detailed Visual & Technical Defect Findings by Category

### 3.1. Roads & Surface Materials (`roads.png`, `terrain.png`)
- **`bank.webp` (`768×768`)**: Semantically a river sandbank, reused as `TILE_ART.road` and `drawRoadRibbons` default body. Lacks ruts, gravel, or stones; reads as flat beige sand.
- **`cobbles.webp` (`768×768`)**: Contains stamped concentric circular medallions (`4×4` radial fans per tile) that create an artificial wallpaper effect across streets and plazas.
- **`timber.webp` (`320×320`)**: Lower resolution than the `768×768` terrain textures (`grass`, `bedrock`, `flagstone`, `water`, `dunes`, `snow`, `peat`, `caveSoil`), though clean and seamless for bridge planks.

### 3.2. Castle & Dungeon Walls (`castle-walls.png`)
- **Castle / Settlement Fortifications**: Complete absence of dedicated masonry textures (`castle_wall_stone`, `castle_wall_dressed_stone`, `castle_wall_weathered`).
- **Dungeon Wall Sprites**: `wall-straight.webp` (`421×230`) is actively used in `wallPaint.ts`; the other `9` `wall-*.webp` files (`wall-column`, `wall-end`, `wall-pillar`, `wall-rubble`, `wall-straightIvy`, `wall-straightShort` + `-2` duplicates) are unreferenced remnants of an older cell-based wall renderer (retained safely for compatibility/manual reference).

### 3.3. Decorations & Micro-Decor (`decorations.png`) — **Critical Visual Catch**
- **`decor-twig.webp` (`245×224`)**: Contains **four grey web-UI overlay icons (play, share, copy, download) and a black corner triangle** captured from a screenshot in the top-right quadrant!
- **`decor-crack.webp` (`234×232`), `decor-pebble.webp` (`224×217`), `decor-snow.webp` (`268×244`)**: Contain black screenshot corner triangles in opposite corners, causing >88% empty transparent padding and off-center placement.
- **`decor-flower.webp` (`143×140`)**: Small enclosed white background pocket at lower-right petals.
- **`decor-litter` & `decor-shroom`**: Referenced in `decor.ts` (`ART`), currently falling back to procedural vector shapes because no `.webp` files exist.

### 3.4. Settlement, Civic & Unintegrated Urban Pack (`building-assets.png`, `sprite_pack/`)
- **12 Legacy `urban*.webp` sprites** (`urbanAnvil`, `urbanCoal`, `urbanForge`, `urbanHides`, `urbanLamp`, `urbanPlanks`, `urbanPots`, `urbanSign`, `urbanSignpost`, `urbanTrough`, `urbanWoodpile`, `urbanWorkbench`, ~`256×256`): All 12 exhibit pronounced **`8.8%–36.8%` white outer halos** on dark backgrounds, and `urbanSign` is drawn in front/side elevation rather than top-down bracket view.
- **160 Authored `sprite_pack/*.png` sprites**: High-quality `512×512` RGBA cells across 10 sheets (`urban_street_dressing`, `craft_workshop`, `building_signs`, `urban_lighting`, `residential_yards`, `ground_decals`, `urban_greenery`, `building_damage`, `building_materials`, `market_goods`) were stored only in `sprite_pack/` and not yet sliced into `src/assets/cartography/*.webp` or wired into `settlementKit.ts` / `settlementPaint.ts` / `landmarks.ts` — explaining why the new sprites had not yet appeared on generated maps.

### 3.5. Market Assets (`market-assets.png`)
- **71 sprites** extracted from `assets/source/sprite-sheet-market.jpg` (`marketStall*`, `marketTent*`, `marketWagon*`, `marketWheelbarrow*`, `marketCrates*`, `marketBench*`, `marketFence*`, `marketNoticeBoard*`) + `stallRed`, `stallGreen`, `cart`: Clean alpha edges, warm hand-painted palette, but drawn at an elevated ~30°–45° oblique angle compared to strict 90° top-down furniture/crypt sprites. Meanwhile `marketRope`, `marketWell-2`, `marketHay`, `marketBaskets-2`, `marketSacks-2`, `marketBarrels-2` are closer to overhead view. Integrating the 16 strict-90° `market_goods.png` sprites (`marketScale`..`marketFlowerBundles`) directly enriches market plazas with true top-down detail.

### 3.6. Interior Furniture (`furniture-assets.png`)
- **27 WebP files** covering 9 base kinds (`bar`, `barrels`, `bed`, `chair`, `crates`, `hearth`, `rug`, `table`, `wardrobe`) + **15 active inline SVG vectors** (`desk`, `bookcase`, `stove`, `worktop`, `cupboard`, `jars`, `bench`, `stool`, `linen`, `trunk`, `lantern`, `basin`, `screen`, `basket`, `longTable`).
- **Enclosed white background pockets**: `furniture-chair.webp` (white gaps between backrest spindles/armrests) and `furniture-barrels.webp` (white triangle between the 4 barrels).

### 3.7. Traps, Mechanisms, Dungeon & Natural Assets (`traps-and-mechanisms.png`, `natural-assets.png`, `dungeon-assets.png`)
- **White glow matte discs**: `crypt-runeBlue.webp` (`100%` outer bright fringe), `crypt-runeCircleBlue.webp` (`95.9%`), `crypt-mushroomsGlow.webp`, `crypt-crystals.webp`, and `crypt-bladeSlot.webp` retain opaque white-ish halos from `extract-trap-sheet.py` / `extract-sprite-sheet.py` hard thresholds.
- **Variant numbering gaps**: `crypt-pitSpikes` (`[1, 2, 4]`, missing `-3`) and `crypt-portcullis` (`[1, 2, 4]`, missing `-3`). Note: `assets.ts` sorts `VARIANTS` by numeric suffix (`artPick` indexes `VARIANTS[name]` densely), so `-4` still renders, though the filename sequence has a gap.
- **136 Crypt catalogue entries** (`CRYPT_KINDS` = 224 total; 80 have WebP bitmaps, 8 have `cryptVectors.ts` SVGs, 136 synthesize clean procedural SVGs via `cryptArt.ts`).

---

## 4. Source Sheets & Extraction Scripts Audit (§1.5)

| Script | Source File | Output Count | Audit Assessment |
|---|---|---:|---|
| `scripts/prepare-cartography.py` | `encounter-*.jpg/png` (only `encounter-interior.jpg` currently kept in `assets/source/`) | 22 textures + 32 sprites | Uses cosine edge-crossfade (`seamless()`) and magenta spill removal; historical source PNGs (`encounter-ground.jpg`, `encounter-stone.jpg`, etc.) are no longer in `assets/source/`. |
| `scripts/extract-sprite-sheet.py` | `assets/source/sprite-sheet-objects.webp` (`1024×572`) | 26 `crypt-*` nature sprites | Uses border BFS flood-fill (`min >= 238`) + `MinFilter(3)` alpha erosion. Preserves interior white crystal highlights well, leaves slight bright halo on `crypt-mushroomsGlow` & `crypt-crystals`. |
| `scripts/extract-trap-sheet.py` | `assets/source/sprite-sheet-traps.jpg` (`2752×1536`) | 40 `crypt-*` trap sprites | Uses `GLOBAL_WHITE` (`min >= 244`) on `gear`, `sawBlade`, `runeBlue`, `runeCircleBlue` — cleanly punches gear spokes, but leaves `200..243` white glow ring around blue runes as opaque white sticker. |
| `scripts/extract-wall-sheet.py` | `assets/source/sprite-sheet-walls.jpg` (`2752×1536`) | 7 `wall-*` sprites | Removes neutral grey drop-shadow (`lum >= 120 & chroma < 6`); clean alpha, only `wall-straight` used at runtime. |
| `scripts/extract-market-sheet.py` | `assets/source/sprite-sheet-market.jpg` (`2752×1536`) | 40 `market*` sprites | Lossy WebP `q=85`, downscaled to `320px`; `deep_white` (`lum >= 228 & chroma <= 8`) globally deletes neutral bright whites, risking minor pinholes on pale fabrics/parchment. |
| `scripts/clean-sprite-edges.py` | `src/assets/cartography/*.webp` | In-place cleaner | Unmixes white matte on semi-transparent pixels and removes tiny neutral edge speckles (`<=96 px`) without harming interior whites. |
| `scripts/build-sprite-pack.py` | `sprite_pack/_work/raw/*.png` | 10 × `2048×2048` sheets (`160` cells) | Border flood-fill + enclosed white-pocket knockout + Efros-Freeman DP minimum-error seam quilting for `building_materials.png`. Ready for WebP slicing into `src/assets/cartography/`. |

---

## 5. Highest-Priority Replacements & Targeted Repairs (§1.7–1.8)

1. **P0 — Road Surface Material Library (`Phase 2`)**:
   - Create 6 seamless `1024×1024` PNG source textures (`assets/source/roads/road_*.png`) + production WebP textures (`src/assets/cartography/road_*.webp`): `road_packed_dirt`, `road_gravel`, `road_old_cobblestone`, `road_worn_cobblestone`, `road_noble_paving`, `road_damaged_stone`.
   - Integrate world-space continuous tiling and contextual district/settlement/biome road material selection in `terrainPaint.ts` and `render.ts:drawRoadRibbons` while keeping plazas and wooden bridge decks distinct.
2. **P0 — Castle / Settlement Fortification Wall Library (`Phase 3`)**:
   - Create 3 seamless longitudinal masonry `1024×1024` PNG source textures (`assets/source/walls/castle_wall_*.png`) + production WebPs: `castle_wall_stone`, `castle_wall_dressed_stone`, `castle_wall_weathered`.
   - Upgrade `src/lib/townWallPaint.ts` to clip/align longitudinal stone masonry along straight, curved, and rounded-corner wall ribbons scaled to `RenderSettings.wallThickness`, stopping cleanly at gates and preserving `wallPaint.ts` for dungeons.
3. **P0 — Full Integration of the 160 Urban Sprite Pack Assets (`User Report: "Новые спрайты не проявились на карте"`)**:
   - Slice all `160` cells from `sprite_pack/*.png` into `src/assets/cartography/*.webp` (backing up the 12 white-haloed legacy `urban*.webp` files to `assets/source/backup-legacy-urban/` and replacing them with the crisp zero-halo `sprite_pack` versions).
   - Wire building signs (`sign*`), wall lanterns (`lamp*`), window boxes (`greenWindowBox`, `greenHangingPlanter`), architectural wear overlays (`wear*`), building roof/plinth materials (`mat*`), street/road ground decals (`decal*`), greenery (`green*`), residential yards (`yard*`), street furniture (`urban*`), craft workshops (`urban*`), and tabletop market goods (`market*`) into `assets.ts`, `settlementKit.ts`, `settlementPaint.ts`, `gen/urban/dressing.ts`, `gen/urban/landmarks.ts`, and `render.ts` so they **visibly populate settlements on the live map** while preserving `tests/golden.test.ts` classic hashes!
4. **P1 — Targeted Repairs of Audited Sprite Defects (`Phase 4`)** (with originals backed up in `assets/source/backup-repaired/`):
   - Remove screenshot UI icons & corner triangles from `decor-twig.webp`, `decor-crack.webp`, `decor-pebble.webp`, `decor-snow.webp`, and enclosed white pocket on `decor-flower.webp`.
   - Remove enclosed white background pockets in `furniture-chair.webp` and `furniture-barrels.webp`.
   - Convert opaque white matte halos on `crypt-runeBlue.webp`, `crypt-runeCircleBlue.webp`, `crypt-mushroomsGlow.webp`, and `crypt-bladeSlot.webp` into smooth alpha falloff.

---

## 6. Post-Integration & Post-Repair Verification Summary (Phases 2–6 Final State)

After executing `scripts/integrate-urban-and-materials.py`, de-matting/cleaning the flagged sprites (with pre-repair originals archived in `assets/source/backup-repaired/`), re-running `scripts/audit-assets.py`, and rendering all 10 production showcase sheets (`scripts/generate-showcase.mjs`), every audit target has been verified:

| Metric | Initial Baseline | Final Verified State |
|---|---:|---:|
| **Total manifest entries (`docs/assets/asset-manifest.json`)** | `403` | **`562`** |
| **Production `.webp` assets (`src/assets/cartography/`)** | `293` | **`452`** (`150` net new urban sprites + `10` replaced legacy `urban*` sprites + `6` `road_*` + `3` `castle_wall_*`) |
| **Actively wired production `.webp` assets** | `284 / 293` | **`443 / 452` (`98.0%`)** — only the `9` legacy cell-based `wall-*` dungeon files remain intentionally unused |
| **160-Sprite Urban Pack (`sprite_pack/*.png`) wired & active** | `0 / 160` | **`160 / 160` (`100%`)** exported to `.webp` and active in `settlementKit.ts`, `settlementPaint.ts`, `decor.ts`, `gen/urban/dressing.ts` |
| **Dedicated seamless road textures (`road_*`)** | `0` (`bank` sand reused) | **`6 / 6`** (`1024×1024` masters in `assets/source/roads/`, `640×640` seamless WebPs, `3×3` seam diff `0.8–3.4`) |
| **Dedicated castle wall masonry textures (`castle_wall_*`)** | `0` (flat hex stroke) | **`3 / 3`** (`1024×1024` masters in `assets/source/walls/`, `640×640` longitudinal WebPs, `3×3` seam diff `0.8–1.5`) |
| **Exact SHA-256 duplicates** | `0` | **`0`** |
| **White halo fringes (`white_halo_fringe`)** | `15+` | **`0`** |
| **Opaque background / screenshot UI toolbar defects** | `4` (`decor-twig`, `decor-crack`, `decor-pebble`, `decor-snow`) | **`0`** |

### Visual Verification Artifacts (`docs/assets/`)
- **Contact Sheets & Tileability (`docs/assets/contact-sheets/`)**:
  - `roads.png`, `castle-walls.png`, `building-assets.png`, `damage-and-materials.png`, `decorations.png`, `market-assets.png`, `furniture-assets.png`, `traps-and-mechanisms.png`, `natural-assets.png`, `dungeon-assets.png`, `terrain.png`, `unused-and-orphans.png`
  - `tileability-3x3-roads.png` & `tileability-3x3-walls.png`
- **Production Engine Before/After & Showcase Renders (`docs/assets/showcase/`)**:
  - `01-roads-before-vs-after.png` — Legacy shared sand (`bank`) vs contextual `road_*` ribbons & transitions
  - `02-road-materials-matrix.png` — All 6 `road_*` seamless materials rendered side-by-side
  - `03-castle-walls-before-vs-after.png` — Flat procedural curtain stroke vs longitudinal `castle_wall_*` masonry
  - `04-castle-wall-thickness-and-variants.png` — `wallThickness` (`0.22 / 0.38 / 0.58`) × 3 masonry variants + untouched Dungeon `wallPaint.ts`
  - `05-building-signs-and-lighting.png` — All 16 `sign*` brackets & 16 `lamp*` fixtures in daylight & dusk
  - `06-craft-market-and-street-dressing.png` — 16 `market*` goods, 16 `urban*` street furniture & 16 craft workshop props
  - `07-residential-yards-and-greenery.png` — 16 `yard*` domestic props & 16 `green*` cultivated greenery assets
  - `08-ground-decals-wear-and-materials.png` — `"Old ≠ Neglected"` comparison + 16 `decal*`, 16 `wear*`, and 16 `mat*` assets
  - `09-repaired-sprites-before-vs-after.png` — Before/after proof of de-haloed runes/lamps/signs and cleaned `decor-*` sprites
  - `10-full-settlement-showcase.png` — 4 complete settlements (`Fortified Trade Town`, `Harbor Port Town`, `Noble Citadel Capital`, `Crossroads Market Village`)

