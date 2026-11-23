import { describe, expect, it, vi } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import {
  SETTLEMENT_GENERATOR_VERSION,
  SETTLEMENT_LAYOUT_IDS,
  SETTLEMENT_TYPES,
  URBAN_CHARACTER_IDS,
  type SettlementTypeId,
} from '../src/lib/gen/settlementTypes';
import type { GenSettings, MapData, Terrain } from '../src/lib/types';

const STREET_TERRAIN = new Set<Terrain>(['road', 'plaza', 'bridge']);
const INVALID_HOUSE_TERRAIN = new Set<Terrain>(['wall', 'water', 'deepWater', 'rock', 'road', 'plaza', 'bridge']);

function makeSettings(typeId: SettlementTypeId, patch: Partial<GenSettings> = {}): GenSettings {
  const def = SETTLEMENT_TYPES.find((t) => t.id === typeId)!;
  return {
    ...DEFAULT_GEN,
    biome: def.style,
    settlement: def.style,
    settlementType: typeId,
    width: 96,
    height: 76,
    seed: 101,
    density: 0.62,
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
    expect(b.x >= 1 && b.y >= 1 && b.x + b.w <= map.width - 1 && b.y + b.h <= map.height - 1, `${label}: building inside bounds`).toBe(true);
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

  // 2. Дворы, проходы и огороды сохранены: застройка никогда не заливает карту сплошняком.
  const roofShare = used.reduce((a, b) => a + b, 0) / (map.width * map.height);
  expect(roofShare, `${label}: open space preserved`).toBeLessThan(0.42);

  // 3. Единая связная сеть улиц и мостов.
  expect(report!.quality!.connectivity, `${label}: road connectivity`).toBeGreaterThanOrEqual(0.97);

  // 4. 100% зданий достижимы пешком от главной уличной сети.
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
        const s = makeSettings(type.id, { seed: GOLDEN_SEEDS[type.id] });
        const mapA = generateMap(s);
        const mapB = generateMap({ ...s });

        expect(spy, `${type.id}: Math.random must never be called`).not.toHaveBeenCalled();
        expect(mapA, `${type.id}: deterministic output`).toEqual(mapB);

        verifyHardInvariants(mapA, `${type.id} seed ${s.seed}`);

        const report = mapA.plan!.settlement!;
        expect(report.quality!.score, `${type.id}: settlementQualityScore`).toBeGreaterThanOrEqual(70);
        expect(report.nodes!.length, `${type.id}: urban node skeleton`).toBeGreaterThanOrEqual(2);
        expect(report.plots!.total, `${type.id}: parcel plots generated`).toBeGreaterThan(0);

        if (type.walls !== 'none') {
          expect(report.gates, `${type.id}: gates connected`).toBeGreaterThanOrEqual(1);
          expect(report.towers, `${type.id}: wall towers placed`).toBeGreaterThanOrEqual(4);
        }
        if (type.id === 'port') {
          expect(report.piers, 'port has piers').toBeGreaterThanOrEqual(2);
          expect(report.landmarks!.some((l) => l.kind === 'warehouse' || l.kind === 'tavern'), 'port has harbour landmarks').toBe(true);
        }
        if (type.id === 'fortress') {
          expect(report.landmarks!.some((l) => l.kind === 'citadel'), 'fortress has citadel').toBe(true);
          expect(mapA.buildings!.some((b) => b.role === 'citadel' && b.annex === 'battlement'), 'citadel has battlement annex').toBe(true);
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

describe('urban generator v2: density skeleton invariance & urban characters', () => {
  it('changing density (0 -> 0.2 -> 0.5 -> 0.85) never moves roads, walls, gates, districts, or primary landmarks', () => {
    for (const typeId of ['fortified_town', 'port', 'large_city'] as const) {
      const d0 = generateMap(makeSettings(typeId, { seed: 303, density: 0 }));
      const d20 = generateMap(makeSettings(typeId, { seed: 303, density: 0.2 }));
      const d50 = generateMap(makeSettings(typeId, { seed: 303, density: 0.5 }));
      const d85 = generateMap(makeSettings(typeId, { seed: 303, density: 0.85 }));

      expect(d0.buildings!.length).toBe(0);
      expect(d20.buildings!.length).toBeLessThan(d50.buildings!.length);
      expect(d50.buildings!.length).toBeLessThan(d85.buildings!.length);

      // Префиксная стабильность зданий (первыми стоят главные ориентиры: таверна, ратуша, храм, цитадель).
      expect(d50.buildings!.slice(0, d20.buildings!.length)).toEqual(d20.buildings);
      expect(d85.buildings!.slice(0, d50.buildings!.length)).toEqual(d50.buildings);

      // Скелет города (улицы, площади, стены, мосты, вода) неизменен при смене плотности!
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

  it('supports all 11 urbanCharacter profiles and all 7 layouts with hierarchical roads and project serialization', () => {
    const footprints = new Set<string>();
    for (const ch of URBAN_CHARACTER_IDS) {
      const map = generateMap(makeSettings('small_city', {
        seed: 55,
        width: 80,
        height: 64,
        settlementCharacter: ch,
      }));
      verifyHardInvariants(map, `character=${ch}`);
      expect(map.plan!.settlement!.character).toBe(ch);
      footprints.add(map.buildings!.slice(0, 6).map((b) => `${b.x},${b.y},${b.kind}`).join('|'));
    }
    expect(footprints.size, 'different urban characters produce distinct urban morphology').toBeGreaterThanOrEqual(4);

    // Проверка всех 7 планировок на едином типе и сиде + проверка уровней иерархии дорог.
    for (const layout of SETTLEMENT_LAYOUT_IDS) {
      const map = generateMap(makeSettings('fortified_town', {
        seed: 71,
        width: 80,
        height: 64,
        settlementLayout: layout,
      }));
      verifyHardInvariants(map, `layout=${layout}`);
      const hierarchies = new Set((map.plan!.roads ?? []).map((r) => r.hierarchy).filter(Boolean));
      expect(hierarchies.size, `layout=${layout} has multi-level road hierarchy`).toBeGreaterThanOrEqual(2);
    }

    // Проверка обратной совместимости и сохранения новых полей в формате проекта.
    const gen = makeSettings('trade_town', { seed: 91, settlementCharacter: 'ancient' });
    const map = generateMap(gen);
    const render = {
      ...DEFAULT_RENDER,
      showDebug: false,
      settlementDebug: { districts: true, landmarks: true, urbanAge: true },
    };
    const raw = JSON.parse(JSON.stringify({ version: 1, gen, render, map }));
    const parsed = parseProject(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.gen.settlementCharacter).toBe('ancient');
    expect(parsed!.render.settlementDebug?.urbanAge).toBe(true);
    expect(parsed!.map?.buildings?.length).toBe(map.buildings?.length);

    // Старый проект без новых полей валидируется без ошибок.
    const legacy = parseProject(JSON.parse(JSON.stringify({
      version: 1,
      gen: { ...DEFAULT_GEN, biome: 'town', settlement: 'town', seed: 12 },
      render: DEFAULT_RENDER,
      map: generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', seed: 12 }),
    })));
    expect(legacy).not.toBeNull();

    // Некорректные значения отклоняются валидатором.
    expect(parseProject({ version: 1, gen: { ...gen, settlementCharacter: 'cyberpunk' }, render, map })).toBeNull();
  });
});
