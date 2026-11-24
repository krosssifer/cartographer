import { describe, expect, it, vi } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { addBuilding, addCivic, replanSettlement } from '../src/lib/settlementEdits';
import { drawSettlementDebugOverlay } from '../src/lib/gen/urban/debug';
import {
  SETTLEMENT_GENERATOR_VERSION,
  SETTLEMENT_LAYOUT_IDS,
  SETTLEMENT_TYPES,
  URBAN_CHARACTER_IDS,
  type SettlementTypeId,
} from '../src/lib/gen/settlementTypes';
import type { Building, CivicObject, GenSettings, MapData, SettlementDebugLayers, Terrain } from '../src/lib/types';

const STREET_TERRAIN = new Set<Terrain>(['road', 'plaza', 'bridge']);
const INVALID_HOUSE_TERRAIN = new Set<Terrain>(['wall', 'water', 'deepWater', 'rock', 'road', 'plaza', 'bridge']);

function makeSettings(typeId: SettlementTypeId, patch: Partial<GenSettings> = {}): GenSettings {
  const def = SETTLEMENT_TYPES.find((t) => t.id === typeId)!;
  return {
    ...DEFAULT_GEN,
    biome: def.style,
    settlement: def.style,
    settlementType: typeId,
    width: 84,
    height: 60,
    seed: 101,
    density: 0.68,
    road: true,
    river: true,
    publicSpaces: true,
    ...patch,
  };
}

function verifyHardInvariants(map: MapData, label: string) {
  const report = map.plan?.settlement;
  expect(report, `${label}: settlement report exists`).toBeDefined();
  expect(report!.generator).toBe(SETTLEMENT_GENERATOR_VERSION);
  expect(report!.origin, `${label}: causal origin recorded`).toBeDefined();
  expect(report!.quality, `${label}: quality report exists`).toBeDefined();
  expect(report!.debug, `${label}: debug data exists`).toBeDefined();

  // 1. Нет зданий в воде, на стене, скале или улице, и нет пересечений зданий.
  const used = new Uint8Array(map.width * map.height);
  for (const b of map.buildings ?? []) {
    expect(
      b.x >= 1 && b.y >= 1 && b.x + b.w <= map.width - 1 && b.y + b.h <= map.height - 1,
      `${label}: building inside bounds`,
    ).toBe(true);
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const tr = map.cells[y][x].terrain;
        expect(INVALID_HOUSE_TERRAIN.has(tr), `${label}: building (${b.x},${b.y}) on ${tr}`).toBe(false);
        const idx = y * map.width + x;
        expect(used[idx], `${label}: building overlap at (${x},${y})`).toBe(0);
        used[idx] = 1;
      }
    }
  }

  // 2. Дворы, проходы, площади и окраины сохранены: застройка не заливает всю карту.
  const roofShare = used.reduce((a, b) => a + b, 0) / (map.width * map.height);
  expect(roofShare, `${label}: open space preserved`).toBeLessThan(0.45);

  // 3. Единая связная сеть улиц и мостов.
  expect(report!.quality!.connectivity, `${label}: road connectivity`).toBeGreaterThanOrEqual(0.97);

  // 4. 100% зданий (включая вторичные дворовые флигели) достижимы пешком от уличной сети.
  expect(report!.quality!.accessibility, `${label}: building accessibility`).toBe(1);

  // 5. Ключевые ориентиры размещены и достижимы.
  for (const lm of report!.landmarks ?? []) {
    expect(lm.accessible, `${label}: landmark ${lm.id} (${lm.kind}) accessible`).toBe(true);
  }
}

describe('urban generator v2: golden seeds across all 11 settlement types', () => {
  const GOLDEN_SEEDS: Record<SettlementTypeId, number> = {
    small_village: 17,
    large_village: 29,
    trade_town: 42,
    craft_town: 53,
    fortified_town: 68,
    small_city: 77,
    large_city: 89,
    fortress: 104,
    port: 118,
    mountain: 131,
    frontier_outpost: 149,
  };

  for (const type of SETTLEMENT_TYPES) {
    it(`${type.id} (golden seed ${GOLDEN_SEEDS[type.id]}): causal pipeline, landmarks, quality & zero Math.random`, () => {
      const spy = vi.spyOn(Math, 'random');
      try {
        const s = makeSettings(type.id, { seed: GOLDEN_SEEDS[type.id], width: 96, height: 76 });
        const mapA = generateMap(s);
        const mapB = generateMap({ ...s });

        expect(spy, `${type.id}: Math.random must never be called`).not.toHaveBeenCalled();
        expect(mapA, `${type.id}: deterministic output`).toEqual(mapB);

        verifyHardInvariants(mapA, `${type.id} seed ${s.seed}`);

        const report = mapA.plan!.settlement!;
        expect(report.quality!.score, `${type.id}: settlementQualityScore`).toBeGreaterThanOrEqual(75);
        expect(report.nodes!.length, `${type.id}: urban node skeleton`).toBeGreaterThanOrEqual(2);
        expect(report.plots!.total, `${type.id}: parcel plots generated`).toBeGreaterThan(0);

        if (type.walls !== 'none') {
          expect(report.gates, `${type.id}: gates connected`).toBeGreaterThanOrEqual(1);
          expect(report.towers, `${type.id}: wall towers placed`).toBeGreaterThanOrEqual(4);
        }
        if (type.id === 'port') {
          expect(report.piers, 'port has piers').toBeGreaterThanOrEqual(2);
          expect(
            report.landmarks!.some((l) => l.kind === 'warehouse' || l.kind === 'tavern'),
            'port has harbour landmarks',
          ).toBe(true);
        }
        if (type.id === 'fortress') {
          expect(report.landmarks!.some((l) => l.kind === 'citadel'), 'fortress has citadel').toBe(true);
          expect(
            mapA.buildings!.some((b) => b.role === 'citadel' && b.annex === 'battlement'),
            'citadel has battlement annex',
          ).toBe(true);
        }
        if (type.id === 'mountain') {
          expect(report.geography).toBe('mountain');
          expect(report.landmarks!.some((l) => l.kind === 'smithy'), 'mountain town has smithy').toBe(true);
        }
      } finally {
        spy.mockRestore();
      }
    });
  }
});

describe('urban geometry overhaul: 8 required scenarios across multiple seeds', () => {
  const SCENARIOS: { name: string; typeId: SettlementTypeId; patch: Partial<GenSettings> }[] = [
    { name: 'small village', typeId: 'small_village', patch: { width: 54, height: 38, density: 0.65 } },
    { name: 'large village', typeId: 'large_village', patch: { width: 64, height: 46, density: 0.68 } },
    { name: 'medieval town', typeId: 'craft_town', patch: { width: 74, height: 52, density: 0.72 } },
    { name: 'large trade city', typeId: 'large_city', patch: { width: 88, height: 64, density: 0.75 } },
    { name: 'port city', typeId: 'port', patch: { width: 78, height: 54, density: 0.72 } },
    { name: 'river town', typeId: 'trade_town', patch: { width: 74, height: 52, density: 0.72, river: true } },
    { name: 'fortified city', typeId: 'fortified_town', patch: { width: 78, height: 56, density: 0.72 } },
    { name: 'mountain settlement', typeId: 'mountain', patch: { width: 74, height: 52, density: 0.70 } },
  ];

  const SEEDS = [11, 42, 87];

  for (const sc of SCENARIOS) {
    it(`${sc.name} (seeds ${SEEDS.join(', ')}): footprint, core/fringe gradient, blocks, courtyards & secondary buildings`, () => {
      let totalSecondary = 0;
      let totalCourtyards = 0;
      const blockShapes = new Set<string>();
      const courtyardKinds = new Set<string>();

      for (const seed of SEEDS) {
        const map = generateMap(makeSettings(sc.typeId, { ...sc.patch, seed }));
        const where = `${sc.name} seed=${seed}`;
        verifyHardInvariants(map, where);

        const report = map.plan!.settlement!;
        const q = report.quality!;
        const dbg = report.debug!;

        // 1. City Footprint НЕ совпадает с прямоугольником карты: есть и городское ядро, и дикая природа вокруг.
        const hasCoreOrCity = dbg.zoneGrid.some((z) => z <= 2);
        const hasWilderness = dbg.zoneGrid.some((z) => z === 5);
        expect(hasCoreOrCity, `${where}: has urban core/residential zones`).toBe(true);
        expect(hasWilderness, `${where}: surrounded by non-urban countryside`).toBe(true);

        // 2. Градиент плотности: центр значительно плотнее окраины, нет пустого зелёного центра.
        expect(q.coreDensity, `${where}: core density > fringe density`).toBeGreaterThan(q.fringeDensity + 0.25);
        expect(q.unaccountedGreenShare, `${where}: minimal unaccounted core green`).toBeLessThan(0.28);

        // 3. Реальные городские кварталы (Blocks) и участки (Plots).
        expect(dbg.blocks.length, `${where}: urban blocks extracted`).toBeGreaterThanOrEqual(3);
        for (const blk of dbg.blocks) blockShapes.add(blk.shape);
        for (const plt of dbg.plots) {
          if (plt.courtyardKind) courtyardKinds.add(plt.courtyardKind);
        }

        // 4. Классификация открытых пространств (Empty Areas) заполнена.
        expect(dbg.emptyGrid.length).toBe(dbg.gw * dbg.gh);
        expect(dbg.densityGrid.some((v) => v >= 50), `${where}: peak density >= 50%`).toBe(true);

        totalSecondary += q.secondaryBuildings;
        totalCourtyards += report.plots?.courtyards ?? 0;
      }

      expect(totalCourtyards, `${sc.name}: courtyards generated across seeds`).toBeGreaterThanOrEqual(3);
      expect(totalSecondary, `${sc.name}: secondary courtyard buildings generated`).toBeGreaterThanOrEqual(1);
      expect(courtyardKinds.size, `${sc.name}: typed courtyards`).toBeGreaterThanOrEqual(1);
      if (sc.patch.width! >= 70) {
        expect(blockShapes.size, `${sc.name}: varied block geometry`).toBeGreaterThanOrEqual(2);
      }
    });
  }
});

describe('urban generator v2: density invariance, manual editing & 11 debug layers', () => {
  it('changing density (0 -> 0.2 -> 0.5 -> 0.85) never moves roads, walls, gates, districts, or primary landmarks', () => {
    for (const typeId of ['fortified_town', 'port', 'large_city'] as const) {
      const d0 = generateMap(makeSettings(typeId, { seed: 303, density: 0 }));
      const d20 = generateMap(makeSettings(typeId, { seed: 303, density: 0.2 }));
      const d50 = generateMap(makeSettings(typeId, { seed: 303, density: 0.5 }));
      const d85 = generateMap(makeSettings(typeId, { seed: 303, density: 0.85 }));

      expect(d0.buildings!.length).toBe(0);
      expect(d20.buildings!.length).toBeLessThan(d50.buildings!.length);
      expect(d50.buildings!.length).toBeLessThan(d85.buildings!.length);

      expect(d50.buildings!.slice(0, d20.buildings!.length)).toEqual(d20.buildings);
      expect(d85.buildings!.slice(0, d50.buildings!.length)).toEqual(d50.buildings);

      for (let y = 0; y < d20.height; y++) {
        for (let x = 0; x < d20.width; x++) {
          const t20 = d20.cells[y][x].terrain;
          const t85 = d85.cells[y][x].terrain;
          if (STREET_TERRAIN.has(t20) || t20 === 'wall' || t20 === 'water' || t20 === 'deepWater') {
            expect(t85, `${typeId} skeleton cell (${x},${y})`).toBe(t20);
          }
        }
      }

      expect(d20.plan!.settlement!.origin).toEqual(d85.plan!.settlement!.origin);
      expect(d20.plan!.settlement!.gates).toBe(d85.plan!.settlement!.gates);
      expect(d20.plan!.settlement!.towers).toBe(d85.plan!.settlement!.towers);
      expect(d20.plan!.settlement!.districts.map((d) => ({ kind: d.kind, x: d.x, y: d.y }))).toEqual(
        d85.plan!.settlement!.districts.map((d) => ({ kind: d.kind, x: d.x, y: d.y })),
      );
    }
  });

  it('preserves manual user buildings and civic objects across replanSettlement', () => {
    const baseGen = makeSettings('trade_town', { seed: 77, width: 68, height: 48, density: 0.55 });
    const oldPlan = generateMap(baseGen);

    // Находим свободную сухую площадку на окраине под ручную постройку и колодец пользователя.
    let manualHouse: Building | undefined;
    for (let y = 2; y < oldPlan.height - 6 && !manualHouse; y++) {
      for (let x = 2; x < oldPlan.width - 6; x++) {
        const cand: Building = {
          x,
          y,
          w: 4,
          h: 4,
          style: 'town',
          kind: 'house',
          roof: 2,
          shape: 'gable',
          door: { x: x + 2, y: y + 3 },
          facing: 0,
          source: 'manual',
          role: 'house',
        };
        const withHouse = addBuilding(oldPlan, cand);
        if (withHouse !== oldPlan) {
          manualHouse = cand;
          let edited = withHouse;
          const manualWell: CivicObject = { x: x + 2, y: y + 4, w: 1, h: 1, kind: 'well', variant: 0, source: 'manual' };
          edited = addCivic(edited, manualWell);

          const denserPlan = generateMap({ ...baseGen, density: 0.85 });
          const replanned = replanSettlement(edited, oldPlan, denserPlan);

          expect(
            replanned.buildings?.some((b) => b.source === 'manual' && b.x === cand.x && b.y === cand.y),
            'manual building preserved after density replan',
          ).toBe(true);
          if (edited.civic?.some((c) => c.source === 'manual')) {
            expect(
              replanned.civic?.some((c) => c.source === 'manual' && c.kind === 'well'),
              'manual civic object preserved after density replan',
            ).toBe(true);
          }
          break;
        }
      }
    }
    expect(manualHouse).toBeDefined();
  });

  it('renders all 11 required debug visualization layers cleanly without errors', () => {
    const map = generateMap(makeSettings('trade_town', { seed: 42, width: 68, height: 48 }));
    let drawCalls = 0;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      fillRect: () => { drawCalls++; },
      strokeRect: () => { drawCalls++; },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => { drawCalls++; },
      fill: () => { drawCalls++; },
      arc: () => {},
      setLineDash: () => {},
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: () => { drawCalls++; },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
    } as unknown as CanvasRenderingContext2D;

    const allElevenLayers: SettlementDebugLayers = {
      footprint: true,
      density: true,
      districts: true,
      blocks: true,
      plots: true,
      roadHierarchy: true,
      frontage: true,
      courtyards: true,
      emptyAreas: true,
      accessibility: true,
      riverInfluence: true,
      landmarks: true,
      districtLabels: true,
    };

    drawSettlementDebugOverlay(mockCtx, map, 32, allElevenLayers);
    expect(drawCalls).toBeGreaterThan(100);
    expect(DEFAULT_RENDER.showDebug).toBe(false);
  });

  it('supports all 11 urbanCharacter profiles, all 7 layouts, and full project serialization', () => {
    const footprints = new Set<string>();
    for (const ch of URBAN_CHARACTER_IDS) {
      const map = generateMap(makeSettings('small_city', {
        seed: 55,
        width: 80,
        height: 60,
        settlementCharacter: ch,
      }));
      verifyHardInvariants(map, `character=${ch}`);
      expect(map.plan!.settlement!.character).toBe(ch);
      footprints.add(map.buildings!.slice(0, 6).map((b) => `${b.x},${b.y},${b.kind}`).join('|'));
    }
    expect(footprints.size, 'different urban characters produce distinct urban morphology').toBeGreaterThanOrEqual(4);

    for (const layout of SETTLEMENT_LAYOUT_IDS) {
      const map = generateMap(makeSettings('fortified_town', {
        seed: 71,
        width: 80,
        height: 60,
        settlementLayout: layout,
      }));
      verifyHardInvariants(map, `layout=${layout}`);
      const hierarchies = new Set((map.plan!.roads ?? []).map((r) => r.hierarchy).filter(Boolean));
      expect(hierarchies.size, `layout=${layout} has multi-level road hierarchy`).toBeGreaterThanOrEqual(2);
    }

    const gen = makeSettings('trade_town', { seed: 91, settlementCharacter: 'ancient' });
    const map = generateMap(gen);
    const render = {
      ...DEFAULT_RENDER,
      showDebug: false,
      settlementDebug: {
        footprint: true,
        density: true,
        districts: true,
        blocks: true,
        plots: true,
        roadHierarchy: true,
        frontage: true,
        courtyards: true,
        emptyAreas: true,
        accessibility: true,
        riverInfluence: true,
      },
    };
    const raw = JSON.parse(JSON.stringify({ version: 1, gen, render, map }));
    const parsed = parseProject(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.gen.settlementCharacter).toBe('ancient');
    expect(parsed!.render.settlementDebug?.footprint).toBe(true);
    expect(parsed!.render.settlementDebug?.courtyards).toBe(true);
    expect(parsed!.render.settlementDebug?.emptyAreas).toBe(true);
    expect(parsed!.map?.buildings?.length).toBe(map.buildings?.length);

    const legacy = parseProject(JSON.parse(JSON.stringify({
      version: 1,
      gen: { ...DEFAULT_GEN, biome: 'town', settlement: 'town', seed: 12 },
      render: DEFAULT_RENDER,
      map: generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', seed: 12 }),
    })));
    expect(legacy).not.toBeNull();

    expect(parseProject({ version: 1, gen: { ...gen, settlementCharacter: 'cyberpunk' }, render, map })).toBeNull();
  });
});
