# Cartographer — Asset Usage Graph (`asset-usage-map.md`)

## End-to-End Pipeline

```text
Source Sheet / Raw Render
  ├── assets/source/encounter-*.jpg/png ──► scripts/prepare-cartography.py
  ├── assets/source/sprite-sheet-objects.webp ──► scripts/extract-sprite-sheet.py
  ├── assets/source/sprite-sheet-traps.jpg ──► scripts/extract-trap-sheet.py
  ├── assets/source/sprite-sheet-walls.jpg ──► scripts/extract-wall-sheet.py
  ├── assets/source/sprite-sheet-market.jpg ──► scripts/extract-market-sheet.py
  ├── sprite_pack/*.png (10 × 2048×2048 RGBA) ──► scripts/integrate-urban-and-materials.py
  ├── assets/source/roads/road_*.png (6 × 1024×1024) ──► scripts/integrate-urban-and-materials.py
  └── assets/source/walls/castle_wall_*.png (3 × 1024×1024) ──► scripts/integrate-urban-and-materials.py
        │
        ▼
Production Bundle Directory: src/assets/cartography/*.webp (452 files total; 443 actively referenced)
  │  (discovered via Vite import.meta.glob('../assets/cartography/*.webp', { eager: true, query: '?inline' }))
  ▼
Asset Loader & Variant Resolver: src/lib/assets.ts
  ├── MATERIALS[] ──► ctx.getImageData() ──► assets.materials[material]
  ├── assets.art[name] ──► HTMLImageElement (decoded via loadAssets / loadMarketAssets)
  ├── VARIANTS[base] ──► artPick(name, hash) -> spriteLook.ts (deterministic variant/tint/flip/scale)
  └── Vector Fallbacks: furnitureVectors.ts, cryptVectors.ts, chests.ts, cryptArt.ts (synthesized SVG)
        │
        ├──► 1. Terrain & Surface Raster: src/lib/terrainPaint.ts
        │       └── TILE_ART + contextual road material -> world-space UV wrap + Perlin drift -> groundCache
        │
        ├──► 2. Road Ribbons & Bridges: src/lib/render.ts
        │       ├── drawRoadRibbons() -> Chaikin polylines stroked with world-space CanvasPattern (road_*)
        │       └── drawBridgeDecks() / drawWoodwork() -> rotated timber.webp plank decks
        │
        ├──► 3. Settlement Fortification Walls: src/lib/townWallPaint.ts
        │       └── drawFortification() -> wallRuns() ribbon + longitudinal masonry (castle_wall_*) + towers
        │
        ├──► 4. Dungeon Walls (Separate System): src/lib/wallPaint.ts
        │       └── drawWalls() -> floor-contour ribbon stroked with wall-straight.webp
        │
        ├──► 5. Settlements, Buildings, Yards & Markets: src/lib/settlementPaint.ts + settlementKit.ts
        │       ├── ROOF_KIT (thatch, shingles, terracotta, slate, copper, garnet, limestone, mossRoof)
        │       ├── Building facade materials (mat*), wear/damage decals (wear*), attachments (sign*, lamp*, greenWindowBox)
        │       └── CIVIC_KIT -> settlement.ts / gen/settlementPlanner.ts / gen/urban/{dressing,landmarks}.ts / gen/marketLayout.ts
        │
        ├──► 6. Building Interiors: src/lib/interiorPaint.ts + furnitureKit.ts
        │       └── FURNITURE (24 kinds: 9 painted WebP families + 15 inline SVG vectors + user FurnitureSprite imports)
        │
        ├──► 7. Dungeon / Crypt Objects: src/lib/cryptPaint.ts + cryptKit.ts
        │       └── CRYPT (224 kinds: 80 painted WebP families + 8 cryptVectors + 136 cryptArt procedural SVGs)
        │
        └──► 8. Landscape & Ground Micro-Decor: src/lib/render.ts + src/lib/decor.ts
                ├── drawTree() -> oak, oakGold, pine, bush, dead, cactus, mushroom, reed
                ├── drawRock() -> rock, smallRock
                ├── drawChest() -> chest, chest-wooden, chest-stone, chest-ornate
                └── paintDecor() -> decor-* + urban ground decals (decal*)
```

---

## Registry Audit Findings

| Subsystem | Registered IDs | Backed by `.webp` | Backed by SVG | Unreferenced `.webp` | Status & Notes |
|---|---:|---:|---:|---:|---|
| `MATERIALS` (`assets.ts`) | 18 (+6 road) | 18 (+6 road) | 0 | 0 | `copper`, `garnet`, `limestone`, `mossRoof`, `timber` loaded via `assets.art[name]` for `CanvasPattern` |
| Dungeon `wall-*` | 1 (`wall-straight`) | 10 files | 0 | 9 files | `wall-column*`, `wall-end*`, `wall-pillar`, `wall-rubble`, `wall-straightIvy*`, `wall-straightShort` unused by ribbon renderer; preserved |
| Castle Walls (`townWallPaint.ts`) | 3 (`castle_wall_*`) | 3 files | 0 | 0 | `castle_wall_stone`, `castle_wall_dressed_stone`, `castle_wall_weathered` |
| `CIVIC_KIT` (`settlementKit.ts`) | **148** | 148 files | 0 | 0 | Expanded with street dressing, craft workshops, residential yards, greenery, lighting posts, and tabletop market goods (`160/160` urban pack sprites active across `CIVIC_KIT` + facade/wear/material/decal layers) |
| Building Attachments & Overlays | 54 (`sign*`, `lampWall*`, `lampHanging*`, `greenWindowBox`, `greenHangingPlanter`, `wear*`, `mat*`) | 54 files | Procedural fallback | 0 | Rendered in `settlementPaint.ts` (`drawBuildingAttachments`, `drawBuildingWearOverlays`, `pickPlinthMaterial`) |
| Ground Decals (`decor.ts` / `settlementPaint.ts`) | 10 `decor-*` + 16 `decal*` | 24 files | 2 (`litter`, `shroom`) | 0 | Screenshot UI artifacts cleaned from `decor-twig`, `decor-crack`, `decor-pebble`, `decor-snow` |
| `FURNITURE` (`furnitureKit.ts`) | 24 kinds | 9 kinds (27 files) | 15 active (`9` shadowed) | 0 | Enclosed white holes fixed in `furniture-chair` and `furniture-barrels` |
| `CRYPT` (`cryptKit.ts`) | 224 kinds | 80 kinds (93 files) | 8 `cryptVectors` + 136 `cryptArt` | 0 | White glow matte halos fixed in `crypt-runeBlue`, `crypt-runeCircleBlue`, `crypt-mushroomsGlow`, `crypt-bladeSlot` |
