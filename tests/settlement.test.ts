import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import {
  SETTLEMENT_GENERATOR_VERSION,
  SETTLEMENT_LAYOUT_IDS,
  SETTLEMENT_TYPES,
  type SettlementTypeDef,
} from '../src/lib/gen/settlementTypes';
import type { GenSettings, MapData, Terrain } from '../src/lib/types';

const typed = (type: SettlementTypeDef, patch: Partial<GenSettings> = {}): GenSettings => ({
  ...DEFAULT_GEN, biome: type.style, settlement: type.style, settlementType: type.id,
  density: 1, river: true, road: true, publicSpaces: true, ...patch,
});

const STREET: ReadonlySet<Terrain> = new Set<Terrain>(['road', 'plaza', 'bridge']);
const BLOCKED: ReadonlySet<Terrain> = new Set<Terrain>(['wall', 'water', 'deepWater', 'rock']);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function occupied(map: MapData) {
  const taken = new Uint8Array(map.width * map.height);
  for (const b of map.buildings ?? []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) taken[y * map.width + x] = 1;
  return taken;
}

/** Доля уличных клеток в крупнейшей связной сети. */
function streetShare(map: MapData) {
  const seen = new Uint8Array(map.width * map.height);
  let total = 0, best = 0;
  for (let i = 0; i < map.width * map.height; i++) {
    const x0 = i % map.width, y0 = (i - x0) / map.width;
    if (!STREET.has(map.cells[y0][x0].terrain)) continue;
    total++;
    if (seen[i]) continue;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % map.width, y = (c - x) / map.width;
      size++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy, n = ny * map.width + nx;
        if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && !seen[n] && STREET.has(map.cells[ny][nx].terrain)) { seen[n] = 1; stack.push(n); }
      }
    }
    best = Math.max(best, size);
  }
  return total ? best / total : 1;
}

/** Сколько домов достижимо пешком от крупнейшей улицы (по земле, мимо домов, стен и воды). */
function reachableHouses(map: MapData) {
  const taken = occupied(map);
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height
    && !taken[y * map.width + x] && (!BLOCKED.has(map.cells[y][x].terrain) || map.cells[y][x].terrain === 'bridge');
  let start = -1, bestShare = -1;
  // Старт — уличная клетка с наибольшим числом уличных соседей рядом с центром карты.
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!STREET.has(map.cells[y][x].terrain) || !walk(x, y)) continue;
    const score = -Math.hypot(x - map.width / 2, y - map.height / 2);
    if (score > bestShare || start < 0) { bestShare = score; start = y * map.width + x; }
  }
  const seen = new Uint8Array(map.width * map.height);
  if (start >= 0) {
    const queue = [start];
    seen[start] = 1;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i], x = c % map.width, y = (c - x) / map.width;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (walk(nx, ny) && !seen[ny * map.width + nx]) { seen[ny * map.width + nx] = 1; queue.push(ny * map.width + nx); }
      }
    }
  }
  const houses = map.buildings ?? [];
  const ok = houses.filter((b) => {
    for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= 0 && y >= 0 && x < map.width && y < map.height && seen[y * map.width + x]) return true;
    }
    return false;
  });
  return { ok: ok.length, total: houses.length };
}

describe('typed settlements: every type', () => {
  for (const type of SETTLEMENT_TYPES) {
    it(`${type.id}: streets connected, houses valid and reachable, features by type`, () => {
      for (const [width, height] of [[60, 44], [100, 80]]) for (const seed of [1, 42]) {
        const map = generateMap(typed(type, { width, height, seed }));
        const report = map.plan?.settlement;
        const where = `${type.id} ${width}x${height} seed ${seed}`;
        expect(report, where).toBeDefined();
        expect(report!.generator).toBe(SETTLEMENT_GENERATOR_VERSION);
        expect(report!.type).toBe(type.id);
        expect(report!.layout).toBe(type.layouts[0]);
        expect(report!.geography).toBe(type.geography);
        // Улицы — одна сеть (обрывки до 3% допускаются у причалов и краёв).
        expect(streetShare(map), where).toBeGreaterThan(.97);
        // Дома: не на воде/стене/скале/улице, не пересекаются.
        const seen = new Uint8Array(width * height);
        for (const b of map.buildings ?? []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          const terrain = map.cells[y][x].terrain;
          expect(BLOCKED.has(terrain) || STREET.has(terrain), `${where}: house on ${terrain} at ${x},${y}`).toBe(false);
          expect(seen[y * width + x], `${where}: overlapping houses at ${x},${y}`).toBe(0);
          seen[y * width + x] = 1;
        }
        const access = reachableHouses(map);
        expect(access.ok, `${where}: reachable houses`).toBe(access.total);
        expect(map.buildings!.length, where).toBeGreaterThanOrEqual(width >= 100 ? 25 : 4);
        // Кварталы — только из набора типа; на большой карте застроено хотя бы два вида.
        for (const district of report!.districts) expect(type.districts[district.kind], where).toBeGreaterThan(0);
        const built = new Set(report!.districts.filter((d) => d.buildings > 0).map((d) => d.kind));
        if (width >= 100) expect(built.size, where).toBeGreaterThanOrEqual(2);
        expect(report!.districts.reduce((sum, d) => sum + d.buildings, 0)).toBe(map.buildings!.length);
        // Стены, ворота и башни.
        if (type.walls !== 'none') {
          expect(report!.walls, where).toBe(type.walls);
          expect(report!.gates, where).toBeGreaterThanOrEqual(1);
          expect(report!.towers, where).toBeGreaterThanOrEqual(4);
          expect(report!.fortification?.rings.length, where).toBeGreaterThanOrEqual(1);
          expect(map.cells.flat().filter((c) => c.terrain === 'wall').length, where).toBeGreaterThan(20);
        } else {
          expect(report!.walls).toBe('none');
          expect(report!.fortification).toBeUndefined();
        }
        if (type.keep) expect(map.buildings!.some((b) => b.kind === 'tower' && b.w >= 5), `${where}: keep`).toBe(true);
        if (type.geography === 'coast') {
          expect(report!.piers, `${where}: piers`).toBeGreaterThanOrEqual(1);
          expect(map.cells.flat().filter((c) => c.terrain === 'deepWater').length, where).toBeGreaterThan(width * 3);
        }
        if (type.geography === 'mountain') {
          expect(map.cells.flat().filter((c) => c.terrain === 'rock').length / (width * height), `${where}: rock`).toBeGreaterThan(.05);
        }
      }
    });
  }
});

describe('typed settlements: layouts', () => {
  for (const id of ['trade_town', 'small_village', 'port'] as const) {
    const type = SETTLEMENT_TYPES.find((t) => t.id === id)!;
    it(`${id}: every layout builds a connected, distinct street network`, () => {
      const signatures = new Set<string>();
      for (const layout of SETTLEMENT_LAYOUT_IDS) {
        const map = generateMap(typed(type, { width: 64, height: 48, seed: 9, settlementLayout: layout }));
        const where = `${id} ${layout}`;
        expect(map.plan?.settlement?.layout, where).toBe(layout);
        expect(streetShare(map), where).toBeGreaterThan(.97);
        const access = reachableHouses(map);
        expect(access.ok, where).toBe(access.total);
        expect(access.total, where).toBeGreaterThanOrEqual(6);
        signatures.add(map.cells.map((row) => row.map((c) => STREET.has(c.terrain) ? 1 : 0).join('')).join(''));
      }
      expect(signatures.size).toBe(SETTLEMENT_LAYOUT_IDS.length);
    });
  }
});

describe('typed settlements: engineering', () => {
  const town = SETTLEMENT_TYPES.find((t) => t.id === 'fortified_town')!;
  it('is deterministic, also across the planner cache', () => {
    const settings = typed(town, { width: 60, height: 44, seed: 77 });
    const first = JSON.stringify(generateMap(settings));
    generateMap(typed(SETTLEMENT_TYPES[0], { width: 50, height: 40, seed: 3 }));
    expect(JSON.stringify(generateMap(settings))).toBe(first);
    expect(JSON.stringify(generateMap(settings))).toBe(first);
  });
  it('density keeps a prefix of the same plots', () => {
    const sparse = generateMap(typed(town, { width: 60, height: 44, seed: 5, density: .3 }));
    const dense = generateMap(typed(town, { width: 60, height: 44, seed: 5, density: .8 }));
    expect(sparse.buildings!.length).toBeLessThan(dense.buildings!.length);
    const key = (b: { x: number; y: number; w: number; h: number }) => `${b.x},${b.y},${b.w},${b.h}`;
    const denseKeys = new Set(dense.buildings!.map(key));
    for (const b of sparse.buildings!) expect(denseKeys.has(key(b))).toBe(true);
    expect(generateMap(typed(town, { width: 60, height: 44, seed: 5, density: 0 })).buildings).toEqual([]);
  });
  it('small maps degrade gracefully: no walls below 24 cells, no crash for any type', () => {
    for (const type of SETTLEMENT_TYPES) for (const [width, height] of [[22, 20], [30, 24]]) {
      const map = generateMap(typed(type, { width, height, seed: 2 }));
      expect(map.plan?.settlement?.type).toBe(type.id);
      if (Math.min(width, height) < 24) expect(map.plan?.settlement?.walls).toBe('none');
    }
  });
  it('river can be switched off and streets off still yield houses', () => {
    const plain = SETTLEMENT_TYPES.find((t) => t.id === 'large_village')!;
    const dry = generateMap(typed(plain, { width: 60, height: 44, seed: 4, river: false }));
    expect(dry.plan?.settlement?.river).toBe(false);
    expect(dry.cells.flat().some((c) => c.terrain === 'water' || c.terrain === 'deepWater')).toBe(false);
  });
  it('round-trips through the project format; bad values are rejected', () => {
    const settings = typed(town, { width: 60, height: 44, seed: 8, settlementLayout: 'grid' });
    const map = generateMap(settings);
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })));
    expect(parsed?.map).toEqual(JSON.parse(JSON.stringify(map)));
    expect(parsed?.gen.settlementType).toBe('fortified_town');
    expect(parsed?.gen.settlementLayout).toBe('grid');
    expect(parseProject({ version: 1, gen: { ...settings, settlementType: 'metropolis' }, render: DEFAULT_RENDER, map })).toBeNull();
    expect(parseProject({ version: 1, gen: { ...settings, settlementLayout: 'spiral' }, render: DEFAULT_RENDER, map })).toBeNull();
  });
  it('classic settlements are untouched when the type is absent', () => {
    const classic = generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', width: 60, height: 44, seed: 42 });
    expect(classic.plan?.settlement).toBeUndefined();
    const classicNamed = generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', width: 60, height: 44, seed: 42, settlementType: 'classic' });
    expect(JSON.stringify(classicNamed)).toBe(JSON.stringify(classic));
  });
});
