import { describe, expect, it } from 'vitest';
import {
  clampMapDimensions,
  detectMapSizeProfile,
  isValidMapDimensions,
  MAP_SIZE_PROFILES,
  MAX_MAP_CELLS,
  safeExportCellSize,
} from '../src/lib/mapDimensions';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { renderMap } from '../src/lib/render';
import { getCivicRenderDiagnostics } from '../src/lib/settlementPaint';
import { CIVIC_KIT, intersects } from '../src/lib/settlementKit';
import { SpatialHash } from '../src/lib/gen/urban/spatialHash';
import { calculateDistrictBudget, DISTRICT_AFFINITY } from '../src/lib/gen/urban/districts';
import { PROP_TAXONOMY, DISTRICT_DRESSING, doorStepCells, coversCell, resolveMaterialProfile } from '../src/lib/gen/urban/dressing';
import { getSettlementType, getUrbanCharacter } from '../src/lib/gen/settlementTypes';
import type { GenSettings, Selection } from '../src/lib/types';

function makeMockCanvas(width = 400, height = 300): HTMLCanvasElement {
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
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    transform: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    setLineDash: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 6 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
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
  return canvasObj as unknown as HTMLCanvasElement;
}

describe('Phase 1: Map Size Profiles & 32,000-cell budget', () => {
  it('supports Standard (100×80), Large (160×120), Epic (200×160), and clamps Custom to <= 32,000 cells', () => {
    expect(MAP_SIZE_PROFILES.standard).toMatchObject({ width: 100, height: 80 });
    expect(MAP_SIZE_PROFILES.large).toMatchObject({ width: 160, height: 120 });
    expect(MAP_SIZE_PROFILES.epic).toMatchObject({ width: 200, height: 160 });
    expect(200 * 160).toBe(MAX_MAP_CELLS);

    expect(detectMapSizeProfile(100, 80)).toBe('standard');
    expect(detectMapSizeProfile(160, 120)).toBe('large');
    expect(detectMapSizeProfile(200, 160)).toBe('epic');
    expect(detectMapSizeProfile(140, 100)).toBe('custom');

    const clampedW = clampMapDimensions(240, 200, 'width');
    expect(clampedW.width).toBe(240);
    expect(clampedW.width * clampedW.height).toBeLessThanOrEqual(MAX_MAP_CELLS);
    expect(isValidMapDimensions(clampedW.width, clampedW.height)).toBe(true);
    expect(isValidMapDimensions(201, 160)).toBe(false);

    // OOM-safe PNG export cell size on 200×160:
    const exportCs = safeExportCellSize(200, 160, 144);
    expect(exportCs).toBeLessThan(144);
    expect(200 * exportCs * (160 * exportCs)).toBeLessThanOrEqual(67_108_864);
    expect(safeExportCellSize(64, 48, 96)).toBe(96);
  });

  it('generates and round-trips a 200×160 Epic settlement through parseProject', () => {
    const gen: GenSettings = {
      ...DEFAULT_GEN,
      mapSizeProfile: 'epic',
      width: 200,
      height: 160,
      biome: 'town',
      settlement: 'town',
      settlementType: 'large_city',
      density: 0.65,
      seed: 4242,
      urbanDressing: 0.75,
    };
    const map = generateMap(gen);
    expect(map.width).toBe(200);
    expect(map.height).toBe(160);
    expect((map.buildings?.length ?? 0)).toBeGreaterThan(120);
    expect((map.lights?.length ?? 0)).toBeGreaterThan(20);

    const render = {
      ...DEFAULT_RENDER,
      timeOfDay: 'night' as const,
      showDebug: true,
      settlementDebug: {
        ...DEFAULT_RENDER.settlementDebug,
        market: true,
        activity: true,
        anchors: true,
        lighting: true,
      },
    };
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen, render, map })));
    expect(parsed).not.toBeNull();
    expect(parsed!.map?.width).toBe(200);
    expect(parsed!.map?.height).toBe(160);
    expect(parsed!.render.timeOfDay).toBe('night');
  });
});

describe('Phase 2: Adaptive Footprint, Monotonic District Budget, Hierarchy & Reservations', () => {
  it('scales districts monotonically from 64×48 -> 100×80 -> 160×120 -> 200×160 on cities while keeping villages rural', () => {
    const cityType = getSettlementType('large_city')!;
    const char = getUrbanCharacter('auto', cityType);
    const b64 = calculateDistrictBudget({ width: 64, height: 48, usableFootprintCells: 1_800, totalUsableCells: 2_600, type: cityType, character: char, density: 0.7 });
    const b100 = calculateDistrictBudget({ width: 100, height: 80, usableFootprintCells: 4_800, totalUsableCells: 6_800, type: cityType, character: char, density: 0.7 });
    const b160 = calculateDistrictBudget({ width: 160, height: 120, usableFootprintCells: 11_200, totalUsableCells: 16_000, type: cityType, character: char, density: 0.7 });
    const b200 = calculateDistrictBudget({ width: 200, height: 160, usableFootprintCells: 18_500, totalUsableCells: 27_000, type: cityType, character: char, density: 0.7 });
    expect(b64).toBeLessThan(b100);
    expect(b100).toBeLessThan(b160);
    expect(b160).toBeLessThan(b200);

    const counts = ([
      [64, 48],
      [100, 80],
      [160, 120],
      [200, 160],
    ] as const).map(([w, h]) => {
      const m = generateMap({
        ...DEFAULT_GEN,
        biome: 'town',
        settlement: 'town',
        settlementType: 'trade_town',
        width: w,
        height: h,
        density: 0.7,
        seed: 1337,
      });
      const diag = m.plan!.settlement!.districtDiagnostics!;
      expect(diag.mandatoryPlaced).toBe(diag.mandatoryPlanned);
      return diag.placedDistricts;
    });
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBeLessThan(counts[3]);

    // Small village on 160×120 stays compact and leaves countryside (>40% unassigned natural surroundings):
    const village = generateMap({
      ...DEFAULT_GEN,
      biome: 'village',
      settlement: 'village',
      settlementType: 'small_village',
      width: 160,
      height: 120,
      density: 0.7,
      seed: 1337,
    });
    const vDiag = village.plan!.settlement!.districtDiagnostics!;
    expect(vDiag.assignedArea / vDiag.usableArea).toBeLessThan(0.6);

    // Affinity matrix: > 0 means repulsion penalty, < 0 means attraction bonus!
    expect(DISTRICT_AFFINITY.noble!.poor!).toBeGreaterThan(0);
    expect(DISTRICT_AFFINITY.noble!.docks!).toBeGreaterThan(0);
    expect(DISTRICT_AFFINITY.noble!.temple!).toBeLessThan(0);
  });

  it('records spatial reservations for citadel keep and market plaza prior to building placement', () => {
    const fortress = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortress',
      width: 100,
      height: 80,
      seed: 77,
    });
    const fortRes = fortress.plan?.settlement?.reservations ?? [];
    expect(fortRes.some((r) => r.kind === 'keep')).toBe(true);
    expect(fortRes.some((r) => r.kind === 'parade_ground')).toBe(true);

    const town = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      width: 100,
      height: 80,
      seed: 77,
    });
    const townRes = town.plan?.settlement?.reservations ?? [];
    expect(townRes.some((r) => r.kind === 'market_plaza')).toBe(true);
  });
});

describe('Phase 3: Market Repair, 5-Step Fallback, Expanded MarketReport & Render Diagnostics', () => {
  it('never produces empty markets on tight (36×22), standard (100×80), or epic (200×160) maps and populates diagnostics', () => {
    for (const [w, h] of [[36, 22], [100, 80], [200, 160]] as const) {
      for (const seed of [1, 13, 42]) {
        const map = generateMap({
          ...DEFAULT_GEN,
          biome: 'town',
          settlement: 'town',
          settlementType: 'trade_town',
          width: w,
          height: h,
          seed,
          density: 0.75,
          publicSpaces: true,
          marketArchetype: 'auto',
          marketRichness: 0.65,
        });
        const mr = map.plan?.market;
        expect(mr, `${w}x${h} seed=${seed}`).toBeDefined();
        expect(mr!.valid).toBe(true);
        expect(mr!.marketZoneCreated).toBe(true);
        expect(mr!.placed).toBeGreaterThan(0);
        expect(mr!.objects).toBeGreaterThan(0);
        expect(mr!.mandatoryObjects?.placed ?? 0).toBeGreaterThanOrEqual(1);
        expect(mr!.candidatesEvaluated ?? 0).toBeGreaterThan(0);
        expect(mr!.placedByCategory).toBeDefined();
      }
    }
  });

  it('tracks civic render diagnostics and renders day, dusk, and night passes cleanly', () => {
    const map = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'trade_town',
      width: 80,
      height: 60,
      seed: 99,
      urbanDressing: 0.8,
    });
    const prevDoc = globalThis.document;
    const prevImgData = globalThis.ImageData;
    const prevDomMatrix = globalThis.DOMMatrix;
    globalThis.document = {
      createElement: () => makeMockCanvas(200, 150),
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
    } as unknown as typeof DOMMatrix;
    try {
      const ctx = makeMockCanvas(80 * 32, 60 * 32);
      for (const timeOfDay of ['day', 'dusk', 'night'] as const) {
        renderMap(ctx, map, {
          ...DEFAULT_RENDER,
          cellSize: 32,
          timeOfDay,
          showDebug: true,
          settlementDebug: {
            ...DEFAULT_RENDER.settlementDebug,
            market: true,
            activity: true,
            anchors: true,
            lighting: true,
          },
        });
      }
    } finally {
      globalThis.document = prevDoc;
      globalThis.ImageData = prevImgData;
      globalThis.DOMMatrix = prevDomMatrix;
    }
    const diag = getCivicRenderDiagnostics(map);
    expect(diag).toBeDefined();
    expect(diag!.reachedRender).toBe(map.civic?.length ?? 0);
    expect(diag!.skippedByLayerToggle).toBe(false);
  });
});

describe('Phase 4: SpatialHash exactness & performance primitives', () => {
  it('matches brute-force overlap, radius, and removal queries identically', () => {
    const hash = new SpatialHash<Selection & { id: number }>(200, 160, 8);
    const items: (Selection & { id: number })[] = [];
    for (let i = 0; i < 160; i += 1) {
      const rect = {
        id: i,
        x: (i * 17) % 185,
        y: (i * 29) % 145,
        w: 1 + (i % 5),
        h: 1 + ((i * 3) % 4),
      };
      items.push(rect);
      hash.insert(rect, rect.x, rect.y, rect.w, rect.h);
    }

    for (let q = 0; q < 60; q += 1) {
      const probe: Selection = { x: (q * 23) % 180, y: (q * 19) % 140, w: 4, h: 3 };
      const gap = q % 3;
      const expected = items.some((it) => intersects(probe, it, gap));
      expect(hash.hasOverlap(probe, gap)).toBe(expected);
    }

    const removed = hash.remove((it) => it.id % 2 === 0);
    expect(removed).toBe(80);
    const oddItems = items.filter((it) => it.id % 2 === 1);
    for (let q = 0; q < 40; q += 1) {
      const probe: Selection = { x: (q * 13) % 180, y: (q * 31) % 140, w: 5, h: 4 };
      expect(hash.hasOverlap(probe, 0)).toBe(oddItems.some((it) => intersects(probe, it, 0)));
    }
  });
});

describe('Phases 5–9: ActivityField, Prop Taxonomy, Facade Attachments, Lighting & Material Model', () => {
  it('validates PROP_TAXONOMY against CIVIC_KIT and DISTRICT_DRESSING categories', () => {
    const allDistrictCats = new Set(Object.values(DISTRICT_DRESSING).flatMap((d) => d.categories));
    expect(PROP_TAXONOMY.length).toBeGreaterThanOrEqual(20);
    for (const p of PROP_TAXONOMY) {
      expect(CIVIC_KIT[p.id], p.id).toBeDefined();
      expect(p.footprint.w).toBe(CIVIC_KIT[p.id].w);
      expect(p.footprint.h).toBe(CIVIC_KIT[p.id].h);
      expect(p.anchorTypes.length).toBeGreaterThan(0);
      expect(p.dressingCategories.some((c) => allDistrictCats.has(c))).toBe(true);
    }
  });

  it('decouples Old ≠ Poor and Poor ≠ Ruined in resolveMaterialProfile', () => {
    const ancientNoble = resolveMaterialProfile('lived_in', 'ancient', 'noble', 0.9, 'old_core');
    const bustlingPoor = resolveMaterialProfile('lived_in', 'trade', 'poor', 0.15, 'inner_city');
    const ruinedOutpost = resolveMaterialProfile('worn', 'ruined', 'residential', 0.3, 'outer_city');

    // Old ≠ Poor: ancient noble is very old AND wealthy AND well-preserved/maintained!
    expect(ancientNoble.age).toBeGreaterThan(0.8);
    expect(ancientNoble.wealth).toBeGreaterThan(0.75);
    expect(ancientNoble.preservation).toBeGreaterThan(0.75);
    expect(ancientNoble.maintenance).toBeGreaterThan(0.7);

    // Poor ≠ Ruined: poor quarter has low wealth, high population, higher preservation than ruined!
    expect(bustlingPoor.wealth).toBeLessThan(0.25);
    expect(bustlingPoor.population).toBeGreaterThan(0.8);
    expect(bustlingPoor.preservation).toBeGreaterThan(ruinedOutpost.preservation);
    expect(bustlingPoor.population).toBeGreaterThan(ruinedOutpost.population);
  });

  it('populates ActivityField, facade attachments, non-blocking anchor props, and district-sensitive lighting', () => {
    const map = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'large_city',
      width: 100,
      height: 80,
      density: 0.72,
      seed: 2026,
      urbanDressing: 0.9,
      cityCondition: 'lived_in',
    });
    const settlement = map.plan?.settlement;
    expect(settlement?.activitySummary).toBeDefined();
    expect(settlement!.activitySummary!.intersections).toBeGreaterThan(0);
    expect(settlement!.activitySummary!.meanStreetActivity).toBeGreaterThan(0.15);
    expect(settlement?.materialProfile).toBeDefined();

    // Facade attachments exist on buildings (shop signs, awnings, tavern signs, wall lanterns, banners):
    const withAttachments = (map.buildings ?? []).filter((b) => (b.attachments?.length ?? 0) > 0);
    expect(withAttachments.length).toBeGreaterThan(8);
    const attachmentKinds = new Set(withAttachments.flatMap((b) => b.attachments!.map((a) => a.kind)));
    expect(attachmentKinds.size).toBeGreaterThanOrEqual(3);

    // No civic object blocks any building door approach cell:
    const doors = doorStepCells(map.buildings ?? [], map.width, map.height);
    for (const item of map.civic ?? []) {
      if (item.kind === 'square') continue;
      expect(coversCell(item, doors, map.width), `${item.kind} at (${item.x},${item.y}) blocks door`).toBe(false);
    }

    // Honest urban lighting: lights are placed, and pristine wealthy cities maintain more working lights than worn ruined ones:
    expect((map.lights?.length ?? 0)).toBeGreaterThan(15);
    const wornRuined = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'large_city',
      settlementCharacter: 'ruined',
      width: 100,
      height: 80,
      density: 0.72,
      seed: 2026,
      urbanDressing: 0.9,
      cityCondition: 'worn',
    });
    expect((map.lights?.length ?? 0)).toBeGreaterThan((wornRuined.lights?.length ?? 0));
  });
});
