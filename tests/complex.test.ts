import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { cryptWalkable } from '../src/lib/cryptLayout';
import { CRYPT } from '../src/lib/cryptKit';
import { mulberry32 } from '../src/lib/random';
import { buildGraph, graphConnected } from '../src/lib/gen/complex/graph';
import { keepConnected, roomGeometry, shapeFits } from '../src/lib/gen/complex/shapes';
import { COMPLEX_ARCHETYPE_IDS, COMPLEX_GENERATOR_VERSION, PURPOSES, TOPOLOGIES, getComplexArchetype } from '../src/lib/gen/complex/registry';
import { SCENES } from '../src/lib/gen/complex/scenes';
import { FLOOR_CODE_PATTERN } from '../src/lib/gen/complex/styles';
import type { RoomShape } from '../src/lib/gen/plan';
import type { GenSettings, MapData } from '../src/lib/types';

const CONTROL = ['fortress', 'mine', 'temple', 'sewer', 'laboratory', 'ruins', 'cavern', 'hybrid'];
const complex = (patch: Partial<GenSettings>): GenSettings => ({
  ...DEFAULT_GEN, biome: 'dungeon', width: 64, height: 46, rooms: 11, dungeonLevels: 1, dungeonLevel: 0, ...patch,
});

/** BFS по проходимым клеткам (завал непроходим). */
function reach(map: MapData, from: { x: number; y: number }) {
  const blocked = new Set((map.doors ?? []).filter((d) => d.kind === 'blocked').map((d) => d.y * map.width + d.x));
  const seen = new Set<number>([from.y * map.width + from.x]);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = queue[i].x + dx, y = queue[i].y + dy, id = y * map.width + x;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height || seen.has(id) || blocked.has(id) || !cryptWalkable(map, x, y)) continue;
    seen.add(id);
    queue.push({ x, y });
  }
  return seen;
}

describe('complex dungeon: graph', () => {
  it('every topology yields a connected graph with entry, main hall and final hall', () => {
    for (const id of COMPLEX_ARCHETYPE_IDS) for (const topology of TOPOLOGIES) for (const seed of [1, 2, 3]) {
      const archetype = getComplexArchetype(id);
      const graph = buildGraph({ archetype, topology, count: 11, natural: archetype.natural, landing: seed !== 3, fromAbove: seed === 2, rng: mulberry32(seed * 7919) });
      const tag = `${id}/${topology}/s${seed}`;
      expect(graphConnected(graph), tag).toBe(true);
      expect(graph.nodes[graph.entry].tier, tag).toBe('entry');
      expect(graph.main, tag).not.toBe(graph.entry);
      expect(graph.nodes[graph.main].major, tag).toBe(true);
      if (seed !== 3) expect(graph.nodes[graph.landing]?.tier, tag).toBe('landing');
      // Рёбра без петель на себя и без дублей.
      const keys = graph.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`);
      expect(new Set(keys).size, tag).toBe(keys.length);
      for (const e of graph.edges) expect(e.a, tag).not.toBe(e.b);
      // Тайные залы — тупики, достижимые одним ребром.
      for (const node of graph.nodes.filter((n) => n.tier === 'hidden')) expect(graph.edges.filter((e) => e.a === node.id || e.b === node.id).length, tag).toBe(1);
    }
  });

  it('ring and multihub topologies close loops; linear stays a chain', () => {
    const archetype = getComplexArchetype('fortress');
    const loops = (topology: (typeof TOPOLOGIES)[number]) => {
      const g = buildGraph({ archetype, topology, count: 12, natural: 0, landing: false, fromAbove: false, rng: mulberry32(5) });
      return g.edges.length - (g.nodes.length - 1);
    };
    expect(loops('ring')).toBeGreaterThanOrEqual(1);
    expect(loops('multihub')).toBeGreaterThanOrEqual(1);
    expect(loops('linear')).toBeLessThanOrEqual(1);
  });

  it('purposes of an archetype come from its pool and the registry', () => {
    for (const id of COMPLEX_ARCHETYPE_IDS) {
      const archetype = getComplexArchetype(id);
      for (const [purpose] of archetype.pool) expect(PURPOSES[purpose], `${id}:${purpose}`).toBeDefined();
    }
  });
});

describe('complex dungeon: geometry', () => {
  const SHAPES: RoomShape[] = ['rect', 'square', 'circle', 'oval', 'octagon', 'hexagon', 'L', 'T', 'cross', 'niched', 'partitioned', 'irregular', 'gallery', 'composite', 'organic'];
  it('every shape gives one connected mask inside its frame; pillars and water stay on the mask', () => {
    for (const shape of SHAPES) for (const [w, h] of [[9, 7], [13, 11], [16, 10]]) for (const seed of [1, 2]) {
      if (!shapeFits(shape, w, h)) continue;
      const g = roomGeometry({ shape, features: ['pillars', 'pool'], w, h, facing: 2, seed, origin: { x: 10, y: 10 }, rng: mulberry32(seed) });
      const tag = `${shape} ${w}×${h} s${seed}`;
      expect(g.mask.length, tag).toBe(h);
      expect(g.mask[0].length, tag).toBe(w);
      const cells = g.mask.flat().filter(Boolean).length;
      expect(cells, tag).toBeGreaterThan(w * h * 0.3);
      const start = g.mask.flatMap((row, y) => row.map((v, x) => (v ? [x, y] : null))).find(Boolean)!;
      const kept = keepConnected(g.mask, start[0], start[1]).flat().filter(Boolean).length;
      expect(kept, `${tag}: связность маски`).toBe(cells);
      for (const p of [...g.pillars, ...g.water]) expect(g.mask[p.y]?.[p.x], `${tag}: ${p.x},${p.y}`).toBe(true);
    }
  });
});

describe('complex dungeon: control archetypes', () => {
  for (const archetype of CONTROL) {
    it(`${archetype}: connected, rooms placed, items on valid cells, no repair cuts`, () => {
      for (const seed of [1, 2, 3]) {
        const map = generateMap(complex({ seed, dungeonArchetype: archetype }));
        const tag = `${archetype} s${seed}`;
        const report = map.plan?.dungeon;
        expect(report?.complex?.generator, tag).toBe(COMPLEX_GENERATOR_VERSION);
        expect(report!.connected, tag).toBe(true);
        expect(report!.placed, tag).toBeGreaterThanOrEqual(10);
        expect((map.plan!.actions ?? []).filter((a) => /прорублен|замурована|вне земли/.test(a)), tag).toEqual([]);
        // Главный зал не у края карты.
        expect(report!.complex!.mainMargin, tag).toBeGreaterThan(0.12);
        // Каждый зал достижим от точки появления; отрезанного пола мало.
        const seen = reach(map, map.plan!.spawn!);
        let total = 0, lost = 0;
        for (const room of map.plan!.rooms) {
          const b = room.bounds;
          let open = 0, got = 0;
          for (let y = b.y; y < b.y + b.h; y += 1) for (let x = b.x; x < b.x + b.w; x += 1) {
            if (!cryptWalkable(map, x, y)) continue;
            open += 1;
            if (seen.has(y * map.width + x)) got += 1;
          }
          expect(got, `${tag}: зал ${room.id} ${room.purpose}`).toBeGreaterThan(0);
          total += open;
          lost += open - got;
        }
        expect(lost / total, `${tag}: отрезанный пол`).toBeLessThanOrEqual(0.05);
        // Предметы: настенные — на стене, остальные — на полу; двери не заставлены.
        const doorCells = new Set<number>();
        for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) if (map.cells[y][x].terrain === 'door') doorCells.add(y * map.width + x);
        for (const item of map.crypt ?? []) {
          const spec = CRYPT[item.kind];
          for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) {
            const t = map.cells[y]?.[x]?.terrain;
            expect(t, `${tag}: ${item.kind}@${x},${y}`).toBe(spec.placement === 'wallFace' ? 'wall' : 'floor');
            if (spec.blocks) expect(doorCells.has(y * map.width + x), `${tag}: дверь под ${item.kind}`).toBe(false);
          }
        }
        // Покрытие пола согласовано с размером карты.
        expect(map.floorLayer!.codes.length).toBe(map.width * map.height);
        expect(FLOOR_CODE_PATTERN.test(map.floorLayer!.codes)).toBe(true);
      }
    });
  }

  it('archetypes produce their own architecture', () => {
    const at = (archetype: string, seed: number) => generateMap(complex({ seed, dungeonArchetype: archetype })).plan!.dungeon!.complex!;
    const sum = (archetype: string, pick: (r: ReturnType<typeof at>) => number) => [1, 2, 3].reduce((acc, seed) => acc + pick(at(archetype, seed)), 0) / 3;
    expect(sum('cavern', (r) => r.naturalShare)).toBeGreaterThan(0.85);
    expect(sum('fortress', (r) => r.naturalShare)).toBeLessThan(0.1);
    const hybrid = sum('hybrid', (r) => r.naturalShare);
    expect(hybrid).toBeGreaterThan(0.15);
    expect(hybrid).toBeLessThan(0.8);
    expect(sum('mine', (r) => (r.corridors.tunnel ?? 0) + (r.corridors.natural ?? 0) + (r.corridors.winding ?? 0))).toBeGreaterThan(3);
    expect(sum('sewer', (r) => r.corridors.channel ?? 0)).toBeGreaterThan(1);
    expect(sum('temple', (r) => r.corridors.colonnade ?? 0)).toBeGreaterThan(1);
    expect(sum('ruins', (r) => r.breaches)).toBeGreaterThan(0);
  });

  it('two maps of one archetype are different compositions', () => {
    for (const archetype of ['fortress', 'temple', 'mine']) {
      const reports = [1, 2, 3, 4, 5, 6].map((seed) => generateMap(complex({ seed, dungeonArchetype: archetype })));
      const topologies = new Set(reports.map((m) => m.plan!.dungeon!.complex!.topology));
      expect(topologies.size, archetype).toBeGreaterThanOrEqual(2);
      // Крупнейшие залы стоят в разных местах.
      const mains = new Set(reports.map((m) => { const r = [...m.plan!.rooms].sort((a, b) => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h)[0]; return `${Math.round(r.bounds.x / 8)}:${Math.round(r.bounds.y / 8)}`; }));
      expect(mains.size, archetype).toBeGreaterThanOrEqual(3);
    }
  });

  it('scenes exist for every purpose of the control archetypes', () => {
    for (const id of CONTROL) for (const [purpose] of getComplexArchetype(id).pool) {
      if (purpose === 'cave' || purpose === 'lake' || purpose === 'gallery' || purpose === 'landing') continue;
      expect(SCENES[purpose]?.length ?? 0, `${id}:${purpose}`).toBeGreaterThan(0);
    }
  });
});

describe('complex dungeon: levels', () => {
  it('links of adjacent levels share cells; every level stays connected', () => {
    for (const archetype of ['fortress', 'mine', 'sewer', 'hybrid']) for (const seed of [11, 12]) {
      const settings = complex({ seed, width: 60, height: 44, rooms: 9, dungeonArchetype: archetype, dungeonLevels: 3 });
      const maps = [0, 1, 2].map((level) => generateMap({ ...settings, dungeonLevel: level }));
      for (const m of maps) expect(m.plan!.dungeon!.connected, `${archetype} s${seed}`).toBe(true);
      for (let l = 0; l < 2; l += 1) {
        const down = maps[l].plan!.dungeon!.stairsDown, up = maps[l + 1].plan!.dungeon!.stairsUp;
        expect(down, `${archetype} s${seed} L${l}`).toBeDefined();
        expect(up, `${archetype} s${seed} L${l + 1}`).toEqual(down);
        const kindDown = maps[l].plan!.dungeon!.complex!.links.find((k) => k.dir === 'down')!.kind;
        const kindUp = maps[l + 1].plan!.dungeon!.complex!.links.find((k) => k.dir === 'up')!.kind;
        expect(kindUp).toBe(kindDown);
      }
      // Мир один: стиль сохраняется по ярусам.
      expect(new Set(maps.map((m) => m.plan!.dungeon!.complex!.style)).size).toBe(1);
    }
  });

  it('deep levels of a mine turn into caves', () => {
    const settings = complex({ seed: 11, width: 60, height: 44, rooms: 9, dungeonArchetype: 'mine', dungeonLevels: 3 });
    const top = generateMap(settings).plan!.dungeon!.complex!;
    const bottom = generateMap({ ...settings, dungeonLevel: 2 }).plan!.dungeon!.complex!;
    expect(bottom.levelRole).toBe('caves');
    expect(bottom.naturalShare).toBeGreaterThan(top.naturalShare);
  });
});

describe('complex dungeon: determinism, format, legacy', () => {
  it('is deterministic and does not touch Math.random', () => {
    const settings = complex({ seed: 77, dungeonArchetype: 'ruins' });
    const original = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    try {
      const map = generateMap(settings);
      expect(generateMap(settings)).toEqual(map);
    } finally {
      Math.random = original;
    }
  });

  it('style and condition overrides apply and stay deterministic', () => {
    const map = generateMap(complex({ seed: 4, dungeonArchetype: 'temple', dungeonStyle: 'necromantic', dungeonCondition: 'flooded', dungeonTopology: 'ring', dungeonGeometry: 'regular' }));
    const report = map.plan!.dungeon!.complex!;
    expect(report.style).toBe('necromantic');
    expect(report.condition).toBe('flooded');
    expect(report.topology).toBe('ring');
    expect(report.geometry).toBe('regular');
  });

  it('round-trips through the project format with floor layer and unlit lights', () => {
    const settings = complex({ seed: 5, dungeonArchetype: 'catacombs', dungeonCondition: 'abandoned' });
    const map = generateMap(settings);
    expect(map.floorLayer).toBeDefined();
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })));
    expect(parsed?.map).toEqual(JSON.parse(JSON.stringify(map)));
    expect(parsed?.gen.dungeonArchetype).toBe('catacombs');
  });

  it('project validation rejects malformed complex data', () => {
    const settings = complex({ seed: 5, dungeonArchetype: 'fortress' });
    const map = generateMap(settings);
    const project = (gen: unknown, m: unknown) => parseProject(JSON.parse(JSON.stringify({ version: 1, gen, render: DEFAULT_RENDER, map: m })));
    expect(project({ ...settings, dungeonArchetype: 'castle' }, map)).toBeNull();
    expect(project({ ...settings, dungeonTopology: 'spiral' }, map)).toBeNull();
    expect(project({ ...settings, dungeonStyle: 'gothic' }, map)).toBeNull();
    expect(project(settings, { ...map, floorLayer: { codes: 'r', ornaments: [] } })).toBeNull();
    expect(project(settings, { ...map, floorLayer: { codes: 'q'.repeat(map.width * map.height), ornaments: [] } })).toBeNull();
    expect(project(settings, { ...map, crypt: [{ ...map.crypt![0], unlit: 'yes' }] })).toBeNull();
  });

  it('legacy generators stay untouched when the archetype is absent', () => {
    const classic = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width: 44, height: 30, rooms: 8, seed: 5 });
    expect(classic.plan?.dungeon).toBeUndefined();
    expect(classic.floorLayer).toBeUndefined();
    const varied = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', dungeonLayout: 'varied', width: 44, height: 30, rooms: 8, seed: 5 });
    expect(varied.plan?.dungeon?.complex).toBeUndefined();
    expect(varied.floorLayer).toBeUndefined();
  });

  it('old projects without complex fields still load', () => {
    const settings = { ...DEFAULT_GEN, biome: 'dungeon' as const, width: 30, height: 24, rooms: 6, seed: 3 };
    const map = generateMap(settings);
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })));
    expect(parsed).not.toBeNull();
    expect(parsed?.gen.dungeonArchetype).toBeUndefined();
  });
});

describe('complex dungeon: level edits and settings', () => {
  it('level edits survive switching levels and reset on other setting changes', async () => {
    const { EMPTY_LEVEL_EDITS, isLevelSwitch, recallLevel, stashLevel } = await import('../src/lib/levelEdits');
    const gen = complex({ seed: 9, dungeonArchetype: 'fortress', dungeonLevels: 3 });
    const edited = { ...generateMap(gen), rocks: [] };
    expect(isLevelSwitch(gen, { dungeonLevel: 1 })).toBe(true);
    expect(isLevelSwitch(gen, { dungeonLevel: 1, seed: 3 })).toBe(false);
    let store = stashLevel(EMPTY_LEVEL_EDITS, gen, edited);
    const second = { ...gen, dungeonLevel: 1 };
    expect(recallLevel(store, second)).toBeNull();
    store = stashLevel(store, second, null);
    expect(recallLevel(store, gen)).toBe(edited);
    expect(recallLevel(store, { ...gen, seed: 10 })).toBeNull();
  });

  it('density sliders and the traps toggle steer the complex', () => {
    const count = (patch: Partial<GenSettings>, kinds: string[]) => (generateMap(complex({ seed: 2, dungeonArchetype: 'ruins', dungeonCondition: 'ruined', ...patch })).crypt ?? []).filter((o) => kinds.includes(o.kind)).length;
    expect(count({ rocks: 1 }, ['rubble', 'rubblePile', 'cracks', 'crackedFloor'])).toBeGreaterThan(count({ rocks: 0 }, ['rubble', 'rubblePile', 'cracks', 'crackedFloor']));
    expect(count({ vegetation: 1 }, ['mossPatch', 'lichen', 'roots', 'glowingMushroom'])).toBeGreaterThan(count({ vegetation: 0 }, ['mossPatch', 'lichen', 'roots', 'glowingMushroom']));
    const water = (waterLevel: number) => generateMap(complex({ seed: 2, dungeonArchetype: 'sewer', dungeonCondition: 'flooded', waterLevel })).cells.flat().filter((c) => c.terrain === 'water').length;
    expect(water(.7)).toBeGreaterThan(water(.1));
    const tomb = (cryptTraps: boolean) => generateMap(complex({ seed: 3, dungeonArchetype: 'tomb', cryptTraps })).plan!.dungeon!.complex!.mechanisms.filter((m) => /ловушечный/.test(m)).length;
    expect(tomb(false)).toBe(0);
  });

  it('collapsed and reclaimed conditions leave their own traces', () => {
    const kinds = (dungeonCondition: string) => (generateMap(complex({ seed: 3, dungeonArchetype: 'fortress', dungeonCondition })).crypt ?? []).map((o) => o.kind);
    const collapsed = kinds('collapsed'), reclaimed = kinds('reclaimed');
    expect(collapsed.filter((k) => k === 'rockFall' || k === 'rockPile').length).toBeGreaterThan(reclaimed.filter((k) => k === 'rockFall' || k === 'rockPile').length);
    expect(reclaimed.filter((k) => k === 'crateStack' || k === 'barrelStack').length).toBeGreaterThan(collapsed.filter((k) => k === 'crateStack' || k === 'barrelStack').length);
  });
});
