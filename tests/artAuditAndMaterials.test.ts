import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ART_SCALE, MATERIALS, TILE_ART } from '../src/lib/assets';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { renderMap } from '../src/lib/render';
import {
  CASTLE_WALL_MATERIAL_IDS,
  isCastleWallMaterialSetting,
  isRoadMaterialSetting,
  resolveCastleWallMaterial,
  resolveLaneRoadMaterial,
  ROAD_MATERIAL_IDS,
  selectCellRoadMaterial,
} from '../src/lib/roadMaterials';
import { CIVIC_KIT, CIVIC_KINDS } from '../src/lib/settlementKit';
import { drawFortification, fortificationOf } from '../src/lib/townWallPaint';
import { drawWalls } from '../src/lib/wallPaint';
import type { Cell, GenSettings, MapData, Terrain } from '../src/lib/types';

const ROOT = path.resolve(__dirname, '..');
const CARTO_DIR = path.join(ROOT, 'src', 'assets', 'cartography');
const SOURCE_ROADS_DIR = path.join(ROOT, 'assets', 'source', 'roads');
const SOURCE_WALLS_DIR = path.join(ROOT, 'assets', 'source', 'walls');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'assets', 'asset-manifest.json');
const URBAN_PACK_MANIFEST = path.join(ROOT, 'sprite_pack', 'urban_asset_manifest.json');

interface MockDrawStats {
  strokes: number;
  fills: number;
  arcs: number;
  lineWidths: number[];
}

function createInstrumentedCanvas(width = 640, height = 480): {
  canvas: HTMLCanvasElement;
  stats: MockDrawStats;
} {
  const stats: MockDrawStats = { strokes: 0, fills: 0, arcs: 0, lineWidths: [] };
  const noop = () => {};
  const grad = { addColorStop: noop };
  const canvasObj: { width: number; height: number; getContext: () => CanvasRenderingContext2D } = {
    width,
    height,
    getContext: () => ctx as unknown as CanvasRenderingContext2D,
  };
  const ctx = {
    canvas: canvasObj,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    transform: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: () => { stats.fills++; },
    strokeRect: () => { stats.strokes++; },
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: () => { stats.arcs++; },
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: () => { stats.fills++; },
    stroke: function (this: { lineWidth: number }) {
      stats.strokes++;
      stats.lineWidths.push(this.lineWidth);
    },
    clip: noop,
    setLineDash: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 6 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({ setTransform: noop }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: noop,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    font: '12px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    filter: 'none',
    shadowBlur: 0,
    shadowColor: 'transparent',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return { canvas: canvasObj as unknown as HTMLCanvasElement, stats };
}

function withCanvasGlobals<T>(fn: () => T): T {
  const prevDoc = globalThis.document;
  const prevImgData = globalThis.ImageData;
  const prevDomMatrix = globalThis.DOMMatrix;
  globalThis.document = {
    createElement: () => createInstrumentedCanvas(256, 256).canvas,
  } as unknown as Document;
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  } as unknown as typeof ImageData;
  globalThis.DOMMatrix = class {
    rotate() { return this; }
    scale() { return this; }
    translate() { return this; }
  } as unknown as typeof DOMMatrix;
  try {
    return fn();
  } finally {
    globalThis.document = prevDoc;
    globalThis.ImageData = prevImgData;
    globalThis.DOMMatrix = prevDomMatrix;
  }
}

function makeSyntheticRoadMap(width: number, height: number, biome: MapData['biome'] = 'town'): MapData {
  const cells: Cell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ terrain: 'grass' as Terrain, height: 0.5, moisture: 0.4 })),
  );
  // 4-way intersection + diagonal + curve + plaza + bridge over river:
  for (let x = 2; x < width - 2; x++) cells[12][x].terrain = 'road';
  for (let y = 2; y < height - 2; y++) cells[y][14].terrain = 'road';
  for (let d = 0; d < 8; d++) cells[4 + d][4 + d].terrain = 'road';
  // Plaza block (distinct from road):
  for (let y = 10; y <= 14; y++) {
    for (let x = 20; x <= 25; x++) cells[y][x].terrain = 'plaza';
  }
  // River + bridge crossing:
  for (let y = 0; y < height; y++) cells[y][8].terrain = 'water';
  cells[12][8].terrain = 'bridge';

  return {
    width,
    height,
    biome,
    cells,
    trees: [],
    rocks: [],
    structures: [],
    chests: [],
    river: Array.from({ length: height }, (_, y) => ({ x: 8, y })),
    road: Array.from({ length: width - 4 }, (_, i) => ({ x: 2 + i, y: 12 })),
    civic: [
      { x: 20, y: 10, w: 6, h: 5, kind: 'square', rotation: 0, variant: 0, source: 'layout' },
    ],
    plan: {
      version: 1,
      engine: 'structured',
      zones: [],
      poi: [],
      groups: [],
      bridges: [{ id: 'b1', x: 8.5, y: 12.5, angle: 0, length: 2.2, width: 1.4, cells: [{ x: 8, y: 12 }], pathId: 'r-h' }],
      roads: [
        {
          id: 'r-h',
          type: 'main',
          width: 1.5,
          bridges: 1,
          hierarchy: 1,
          points: Array.from({ length: width - 4 }, (_, i) => ({ x: 2 + i, y: 12 })),
        },
        {
          id: 'r-v',
          type: 'main',
          width: 1.3,
          bridges: 0,
          hierarchy: 2,
          points: Array.from({ length: height - 4 }, (_, i) => ({ x: 14, y: 2 + i })),
        },
        {
          id: 'r-diag',
          type: 'trail',
          width: 1.0,
          bridges: 0,
          hierarchy: 3,
          points: Array.from({ length: 9 }, (_, i) => ({ x: 4 + i, y: 4 + i })),
        },
        {
          id: 'r-curve',
          type: 'trail',
          width: 1.0,
          bridges: 0,
          hierarchy: 4,
          points: [
            { x: 14, y: 18 }, { x: 16, y: 19 }, { x: 19, y: 20 }, { x: 22, y: 19 }, { x: 24, y: 17 },
          ],
        },
      ],
    },
  };
}

describe('Phase 5.1 & 5.2: Asset Manifest, 160 Urban Sprites & Seamless Road/Wall Textures', () => {
  it('verifies asset-manifest.json, 160 urban sprites, zero white halos, zero SHA-256 duplicates, and valid files', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    const entries: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    expect(Array.isArray(entries)).toBe(true);
    const prodEntries = entries.filter((e) => e.assetGroup === 'production_cartography');
    expect(prodEntries.length).toBeGreaterThanOrEqual(452);

    const seenSha = new Set<string>();
    for (const entry of prodEntries) {
      const fullPath = path.join(ROOT, String(entry.path));
      expect(fs.existsSync(fullPath), `${entry.path} exists on disk`).toBe(true);
      expect(Number(entry.width)).toBeGreaterThan(0);
      expect(Number(entry.height)).toBeGreaterThan(0);
      // Zero SHA-256 duplicates in production cartography:
      const sha = String(entry.sha256);
      expect(seenSha.has(sha), `duplicate sha256 on ${entry.id}`).toBe(false);
      seenSha.add(sha);
      // Zero fully transparent sprites:
      expect(Number(entry.transparentPercent)).toBeLessThan(99.5);
      expect(Number(entry.alphaCoverage)).toBeGreaterThan(0.005);
      const issues = (entry.detectedIssues as string[]) ?? [];
      expect(issues.some((iss) => iss.startsWith('white_halo_fringe')), `${entry.id} has no white halo`).toBe(false);
      expect(issues.includes('missing_alpha_opaque_background'), `${entry.id} alpha valid`).toBe(false);
    }

    // All 160 sprites from urban_asset_manifest.json are exported into src/assets/cartography/*.webp and actively used:
    const urbanPack: Array<{ id: string }> = JSON.parse(fs.readFileSync(URBAN_PACK_MANIFEST, 'utf8'));
    expect(urbanPack.length).toBe(160);
    for (const sp of urbanPack) {
      const webpPath = path.join(CARTO_DIR, `${sp.id}.webp`);
      expect(fs.existsSync(webpPath), `${sp.id}.webp exported`).toBe(true);
      const prodEntry = prodEntries.find((e) => e.id === sp.id);
      expect(prodEntry, `${sp.id} audited in manifest`).toBeDefined();
      expect(prodEntry!.isReferenced, `${sp.id} wired in renderer/generator`).toBe(true);
    }

    // Every CIVIC_KIT art resolves to an existing .webp file:
    for (const kind of CIVIC_KINDS) {
      const art = CIVIC_KIT[kind].art;
      expect(fs.existsSync(path.join(CARTO_DIR, `${art}.webp`)), `CIVIC_KIT.${kind} -> ${art}.webp`).toBe(true);
    }
  });

  it('verifies all 6 road textures and all 3 castle wall textures (1024x1024 masters + seamless runtime WebPs)', () => {
    expect(TILE_ART.road).toBe('road_packed_dirt');
    expect(TILE_ART.sand).toBe('bank');
    expect(TILE_ART.plaza).toBe('cobbles');

    const entries: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

    for (const roadId of ROAD_MATERIAL_IDS) {
      expect(MATERIALS).toContain(roadId);
      expect(ART_SCALE[roadId]).toBeGreaterThan(3);
      expect(fs.existsSync(path.join(SOURCE_ROADS_DIR, `${roadId}.png`)), `${roadId}.png 1024 master`).toBe(true);
      expect(fs.existsSync(path.join(CARTO_DIR, `${roadId}.webp`)), `${roadId}.webp runtime`).toBe(true);

      const entry = entries.find((e) => e.id === roadId && e.assetGroup === 'production_cartography');
      expect(entry).toBeDefined();
      expect(entry!.width).toBe(640);
      expect(entry!.height).toBe(640);
      expect(entry!.hasAlpha).toBe(false);
      const issues = (entry!.detectedIssues as string[]) ?? [];
      expect(issues.some((iss) => iss.startsWith('visible_tile_seam')), `${roadId} seamless`).toBe(false);
    }

    for (const wallId of CASTLE_WALL_MATERIAL_IDS) {
      expect(fs.existsSync(path.join(SOURCE_WALLS_DIR, `${wallId}.png`)), `${wallId}.png 1024 master`).toBe(true);
      expect(fs.existsSync(path.join(CARTO_DIR, `${wallId}.webp`)), `${wallId}.webp runtime`).toBe(true);

      const entry = entries.find((e) => e.id === wallId && e.assetGroup === 'production_cartography');
      expect(entry).toBeDefined();
      expect(entry!.width).toBe(640);
      expect(entry!.height).toBe(640);
      expect(entry!.hasAlpha).toBe(false);
      const issues = (entry!.detectedIssues as string[]) ?? [];
      expect(issues.some((iss) => iss.startsWith('visible_tile_seam')), `${wallId} seamless`).toBe(false);
    }

    // 3x3 seamless contact sheets exist:
    expect(fs.existsSync(path.join(ROOT, 'docs', 'assets', 'contact-sheets', 'tileability-3x3-roads.png'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'docs', 'assets', 'contact-sheets', 'tileability-3x3-walls.png'))).toBe(true);
  });
});

describe('Phase 5.3 & 5.4: Contextual Road & Castle Wall Rendering Across Geometries, Thicknesses & Cell Sizes', () => {
  it('selects distinct road materials by context (rural, village, town, commercial, noble, poor/ruined) and renders all road geometries', () => {
    const forestMap = generateMap({ ...DEFAULT_GEN, biome: 'forest', road: true, seed: 42 });
    expect(selectCellRoadMaterial(forestMap, 10, 10)).toBe('road_packed_dirt');

    const cityMap = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'large_city',
      width: 100,
      height: 80,
      density: 0.72,
      seed: 89,
    });
    const chosenMaterials = new Set<string>();
    for (const lane of cityMap.plan?.roads ?? []) {
      chosenMaterials.add(resolveLaneRoadMaterial(cityMap, lane).surface);
    }
    // Large city naturally uses multiple road materials across arterial, ordinary, noble, poor, and outer lanes:
    expect(chosenMaterials.size).toBeGreaterThanOrEqual(3);

    // Render synthetic road map (H, V, diagonal, curve, 4-way, plaza, bridge) across multiple cell sizes & overrides:
    const synth = makeSyntheticRoadMap(32, 24, 'town');
    withCanvasGlobals(() => {
      for (const cellSize of [16, 32, 48, 64]) {
        for (const roadMaterial of ['auto', ...ROAD_MATERIAL_IDS] as const) {
          const { canvas, stats } = createInstrumentedCanvas(32 * cellSize, 24 * cellSize);
          renderMap(canvas, synth, { ...DEFAULT_RENDER, cellSize, roadMaterial }, 1337);
          expect(stats.fills + stats.strokes).toBeGreaterThan(0);
        }
      }
    });
  });

  it('scales settlement castle walls by wallThickness, selects masonry variants, and keeps dungeon wallPaint untouched', () => {
    const fortMap = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      width: 84,
      height: 64,
      density: 0.7,
      seed: 68,
    });
    expect(fortificationOf(fortMap)?.kind).toBe('stone');
    expect(resolveCastleWallMaterial(fortMap)).toBe('castle_wall_stone');

    const nobleCity = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'large_city',
      settlementCharacter: 'noble',
      width: 96,
      height: 76,
      seed: 89,
    });
    expect(resolveCastleWallMaterial(nobleCity)).toBe('castle_wall_dressed_stone');

    const oldWorn = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      settlementCharacter: 'old',
      cityCondition: 'worn',
      width: 84,
      height: 64,
      seed: 68,
    });
    expect(resolveCastleWallMaterial(oldWorn)).toBe('castle_wall_weathered');

    // Verify wallThickness monotonically scales rendered stroke widths across cell sizes:
    withCanvasGlobals(() => {
      for (const cs of [20, 36, 56]) {
        const thin = createInstrumentedCanvas(84 * cs, 64 * cs);
        const medium = createInstrumentedCanvas(84 * cs, 64 * cs);
        const thick = createInstrumentedCanvas(84 * cs, 64 * cs);

        drawFortification(thin.canvas.getContext('2d')!, fortMap, cs, 68, {
          wallThickness: 0.18,
          shading: true,
          texture: true,
          castleWallMaterial: 'castle_wall_stone',
        });
        drawFortification(medium.canvas.getContext('2d')!, fortMap, cs, 68, {
          wallThickness: 0.34,
          shading: true,
          texture: true,
          castleWallMaterial: 'castle_wall_dressed_stone',
        });
        drawFortification(thick.canvas.getContext('2d')!, fortMap, cs, 68, {
          wallThickness: 0.85,
          shading: true,
          texture: true,
          castleWallMaterial: 'castle_wall_weathered',
        });

        const maxThin = Math.max(...thin.stats.lineWidths);
        const maxMed = Math.max(...medium.stats.lineWidths);
        const maxThick = Math.max(...thick.stats.lineWidths);
        expect(maxThin).toBeLessThan(maxMed);
        expect(maxMed).toBeLessThan(maxThick);
        expect(thin.stats.arcs).toBeGreaterThan(0); // stone towers rendered
      }

      // Dungeon wallPaint remains separate and operational:
      const dungeonMap = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width: 44, height: 30, seed: 42 });
      expect(fortificationOf(dungeonMap)).toBeUndefined();
      const dCanvas = createInstrumentedCanvas(44 * 32, 30 * 32);
      expect(() => drawWalls(dCanvas.canvas.getContext('2d')!, dungeonMap, 32, 42, true, 0.34)).not.toThrow();
    });
  });

  it('maintains project save/load backward compatibility with legacy and new settings & CivicKinds', () => {
    expect(isRoadMaterialSetting('auto')).toBe(true);
    expect(isRoadMaterialSetting('road_noble_paving')).toBe(true);
    expect(isRoadMaterialSetting('invalid_road')).toBe(false);
    expect(isCastleWallMaterialSetting('castle_wall_weathered')).toBe(true);
    expect(isCastleWallMaterialSetting('invalid_wall')).toBe(false);

    const gen: GenSettings = {
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'trade_town',
      width: 72,
      height: 54,
      seed: 515,
      urbanDressing: 0.85,
    };
    const map = generateMap(gen);

    // Legacy project JSON (without roadMaterial / castleWallMaterial):
    const legacyJson = JSON.stringify({
      version: 1,
      gen,
      render: DEFAULT_RENDER,
      map,
    });
    const parsedLegacy = parseProject(JSON.parse(legacyJson));
    expect(parsedLegacy).not.toBeNull();

    // New project JSON (with roadMaterial, castleWallMaterial, and newly placed urban sprites):
    const enrichedJson = JSON.stringify({
      version: 1,
      gen,
      render: {
        ...DEFAULT_RENDER,
        roadMaterial: 'road_worn_cobblestone',
        castleWallMaterial: 'castle_wall_dressed_stone',
        wallThickness: 0.52,
      },
      map,
    });
    const parsedNew = parseProject(JSON.parse(enrichedJson));
    expect(parsedNew).not.toBeNull();
    expect(parsedNew!.render.roadMaterial).toBe('road_worn_cobblestone');
    expect(parsedNew!.render.castleWallMaterial).toBe('castle_wall_dressed_stone');
    expect(parsedNew!.render.wallThickness).toBe(0.52);
  });
});
