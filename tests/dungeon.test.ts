import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { cryptWalkable } from '../src/lib/cryptLayout';
import { CRYPT, isSecret } from '../src/lib/cryptKit';
import { effectiveLevels, levelLinks, stairFootprint, DUNGEON_GENERATOR_VERSION } from '../src/lib/gen/dungeonArchitect';
import { doorKindAt, pruneDoors, setDoorKind } from '../src/lib/doors';
import { copyArea, eraseArea, floodFill, paintCells, pasteArea } from '../src/lib/edits';
import type { CryptArchetype, GenSettings, MapData, Structure } from '../src/lib/types';

const ARCHETYPES: CryptArchetype[] = ['tomb', 'catacombs', 'temple', 'archive', 'prison'];
const varied = (patch: Partial<GenSettings>): GenSettings => ({
  ...DEFAULT_GEN, biome: 'dungeon', dungeonLayout: 'varied', dungeonLevels: 3, dungeonLevel: 0, ...patch,
});

/** BFS по проходимым клеткам: завал непроходим, тайная дверь проходима. */
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
function doorNear(map: MapData, r: Structure) {
  for (let y = r.y - 3; y <= r.y + r.h + 2; y += 1) for (let x = r.x - 3; x <= r.x + r.w + 2; x += 1) {
    const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    if (!inside && map.cells[y]?.[x]?.terrain === 'door') return true;
  }
  return false;
}

describe('varied dungeon: invariants', () => {
  for (const archetype of ARCHETYPES) {
    it(`${archetype}: connected, doors near rooms, items on valid cells, no repair cuts`, () => {
      for (const [width, height, rooms] of [[44, 30, 8], [60, 40, 12], [26, 24, 9]]) for (const seed of [1, 42]) for (const level of [0, 1, 2]) {
        const map = generateMap(varied({ width, height, rooms, seed, cryptArchetype: archetype, dungeonLevel: level }));
        const tag = `${archetype} ${width}×${height} s${seed} L${level}`;
        const report = map.plan?.dungeon;
        expect(report, tag).toBeDefined();
        expect(report!.generator).toBe(DUNGEON_GENERATOR_VERSION);
        expect(report!.connected, tag).toBe(true);
        expect(report!.placed, tag).toBeGreaterThanOrEqual(Math.min(rooms, 3));
        expect(map.plan!.rooms.length, tag).toBe(report!.placed);
        expect(map.cryptRooms?.length, tag).toBe(report!.placed);
        // repairMap не должен ничего прорубать или замуровывать.
        expect((map.plan!.actions ?? []).filter((a) => /прорублен|замурована|вне земли/.test(a)), tag).toEqual([]);
        // Все залы достижимы от первого зала независимо от отчёта.
        // У зала-ротонды центр занят статуей, поэтому берём проходимые клетки зала.
        const open = (b: Structure) => {
          const list: Array<{ x: number; y: number }> = [];
          for (let y = b.y; y < b.y + b.h; y += 1) for (let x = b.x; x < b.x + b.w; x += 1) if (cryptWalkable(map, x, y)) list.push({ x, y });
          return list;
        };
        const cellsOf = map.plan!.rooms.map((room) => open(room.bounds));
        // Старт — точка появления у входа. В каждый зал можно попасть, а мелкие
        // карманы, отрезанные мебелью декоратора склепа, занимают малую долю пола
        // (в классическом склепе ~4%, здесь требуем ≤ 8% на карту).
        const spawn = map.plan!.spawn!;
        expect(cryptWalkable(map, spawn.x, spawn.y), `${tag}: spawn`).toBe(true);
        const seen = reach(map, spawn);
        let total = 0, lost = 0;
        map.plan!.rooms.forEach((room, i) => {
          const reached = cellsOf[i].filter((c) => seen.has(c.y * map.width + c.x)).length;
          expect(reached, `${tag}: зал ${room.id}`).toBeGreaterThan(0);
          total += cellsOf[i].length;
          lost += cellsOf[i].length - reached;
        });
        expect(lost / total, `${tag}: отрезанный пол`).toBeLessThanOrEqual(0.08);
        if (map.plan!.rooms.length > 1) for (const room of map.plan!.rooms) expect(doorNear(map, room.bounds), `${tag}: без двери ${room.id}`).toBe(true);
        for (const item of map.crypt ?? []) {
          const mounted = CRYPT[item.kind].placement === 'wallFace';
          for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) {
            expect(map.cells[y]?.[x]?.terrain, `${tag}: ${item.kind}@${x},${y}`).toBe(mounted ? 'wall' : 'floor');
          }
          if (CRYPT[item.kind].secret) expect(isSecret(item)).toBe(true);
        }
        for (const door of map.doors ?? []) {
          expect(map.cells[door.y][door.x].terrain, `${tag}: метка двери ${door.x},${door.y}`).toBe('door');
          expect(door.kind).not.toBe('normal');
        }
      }
    });
  }

  it('large map: 14 rooms placed, every room reachable, few dead ends', () => {
    for (const seed of [1, 42, 1337]) {
      const map = generateMap(varied({ width: 100, height: 80, rooms: 14, seed, cryptArchetype: 'tomb' }));
      expect(map.plan!.dungeon!.placed).toBe(14);
      expect(map.plan!.dungeon!.connected).toBe(true);
      expect(map.plan!.dungeon!.deadEnds).toBeLessThanOrEqual(3);
      expect(map.plan!.dungeon!.loops).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('varied dungeon: levels', () => {
  it('stairs of adjacent levels share the same cells', () => {
    for (const seed of [1, 42, 1337]) {
      const base = varied({ width: 60, height: 40, rooms: 10, seed, dungeonLevels: 4 });
      expect(effectiveLevels(base)).toBe(4);
      const links = levelLinks(base);
      expect(links).toHaveLength(3);
      const maps = [0, 1, 2, 3].map((level) => generateMap({ ...base, dungeonLevel: level }));
      for (let level = 0; level < 3; level += 1) {
        const down = maps[level].plan!.dungeon!.stairsDown!;
        const up = maps[level + 1].plan!.dungeon!.stairsUp!;
        expect(down).toEqual(up);
        expect(down).toEqual(stairFootprint(links[level]));
        expect(maps[level].crypt!.some((item) => item.kind === 'stairsDown' && item.x === down.x && item.y === down.y)).toBe(true);
        expect(maps[level + 1].crypt!.some((item) => item.kind === 'stairsUp' && item.x === up.x && item.y === up.y)).toBe(true);
      }
      expect(maps[3].plan!.dungeon!.stairsDown).toBeUndefined();
      // Выход наверх на верхнем уровне.
      expect(maps[0].crypt!.some((item) => item.kind === 'stairsUp')).toBe(true);
      // Уровни различаются.
      expect(maps[1].cells).not.toEqual(maps[2].cells);
    }
  });
  it('small maps collapse to a single level', () => {
    expect(effectiveLevels({ width: 10, height: 10, dungeonLevels: 3 })).toBe(1);
    const map = generateMap(varied({ width: 10, height: 10, rooms: 6, seed: 3, dungeonLevel: 2 }));
    expect(map.plan!.dungeon!.levels).toBe(1);
    expect(map.plan!.dungeon!.level).toBe(0);
  });
});

describe('varied dungeon: variety and stability', () => {
  it('produces several shapes, door kinds and features across seeds', () => {
    const shapes = new Set<string>(), doors = new Set<string>(), features = new Set<string>();
    for (const archetype of ARCHETYPES) for (const seed of [1, 2, 3]) for (const level of [0, 2]) {
      const report = generateMap(varied({ width: 60, height: 40, rooms: 12, seed, cryptArchetype: archetype, dungeonLevel: level })).plan!.dungeon!;
      Object.keys(report.shapes).forEach((key) => shapes.add(key));
      Object.keys(report.doors).forEach((key) => doors.add(key));
      Object.keys(report.features).forEach((key) => features.add(key));
    }
    expect(shapes.size).toBeGreaterThanOrEqual(7);
    for (const kind of ['double', 'arch', 'secret', 'broken', 'blocked', 'portcullis', 'gate']) expect(doors).toContain(kind);
    for (const feature of ['pillars', 'niches', 'pool']) expect(features).toContain(feature);
  });
  it('is deterministic and keeps cells across detail levels', () => {
    const settings = varied({ width: 44, height: 30, rooms: 8, seed: 77, cryptArchetype: 'temple', dungeonLevel: 1, cryptDetail: 1 });
    const map = generateMap(settings);
    expect(generateMap(settings)).toEqual(map);
    const sparse = generateMap({ ...settings, cryptDetail: 0.4 });
    const rich = generateMap({ ...settings, cryptDetail: 0.7 });
    expect(sparse.cells).toEqual(map.cells);
    expect(sparse.doors).toEqual(map.doors);
    const key = (item: { kind: string; x: number; y: number; rotation: number }) => `${item.kind}:${item.x}:${item.y}:${item.rotation}`;
    const richKeys = new Set((rich.crypt ?? []).map(key));
    for (const item of sparse.crypt ?? []) expect(richKeys.has(key(item)), key(item)).toBe(true);
  });
  it('round-trips through the project format with door kinds', () => {
    const settings = varied({ width: 44, height: 30, rooms: 8, seed: 5 });
    const map = generateMap(settings);
    expect(map.doors?.length).toBeGreaterThan(0);
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })));
    expect(parsed?.map).toEqual(JSON.parse(JSON.stringify(map)));
    expect(parsed?.gen.dungeonLayout).toBe('varied');
  });
  it('classic layout stays untouched when the field is absent', () => {
    const classic = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width: 44, height: 30, rooms: 8, seed: 5 });
    expect(classic.plan?.dungeon).toBeUndefined();
    expect(classic.doors).toBeUndefined();
  });
});

describe('door kinds: editor operations and format', () => {
  const base = () => generateMap(varied({ width: 44, height: 30, rooms: 8, seed: 5 }));
  const firstDoor = (map: MapData) => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.cells[y][x].terrain === 'door') return { x, y };
    throw new Error('no door');
  };
  it('setDoorKind stores only non-normal kinds on door cells', () => {
    const map = base();
    const { x, y } = firstDoor(map);
    const arch = setDoorKind(map, x, y, 'arch');
    expect(doorKindAt(arch, x, y)).toBe('arch');
    expect(arch.doors!.filter((d) => d.x === x && d.y === y)).toHaveLength(1);
    const back = setDoorKind(arch, x, y, 'normal');
    expect(doorKindAt(back, x, y)).toBe('normal');
    expect(back.doors?.some((d) => d.x === x && d.y === y) ?? false).toBe(false);
    // Не дверь — метка не ставится.
    expect(setDoorKind(map, 0, 0, 'gate').doors?.some((d) => d.x === 0 && d.y === 0) ?? false).toBe(false);
    // Исходная карта не мутирует.
    expect(doorKindAt(map, x, y)).not.toBe('arch');
  });
  it('painting over a door removes its mark (paint, fill, erase)', () => {
    const map = base();
    const mark = map.doors![0];
    const painted = paintCells(map, { x: mark.x, y: mark.y, w: 1, h: 1 }, 'floor');
    expect(painted.doors?.some((d) => d.x === mark.x && d.y === mark.y) ?? false).toBe(false);
    expect(painted.doors?.length ?? 0).toBe(map.doors!.length - 1);
    const erased = eraseArea(map, { x: mark.x, y: mark.y, w: 1, h: 1 });
    if (erased.cells[mark.y][mark.x].terrain !== 'door') expect(erased.doors?.some((d) => d.x === mark.x && d.y === mark.y) ?? false).toBe(false);
    const filled = floodFill(map, mark.x, mark.y, 'floor');
    expect(filled.doors?.some((d) => d.x === mark.x && d.y === mark.y) ?? false).toBe(false);
    expect(pruneDoors(map)).toBe(map);
  });
  it('copy/paste carries door kinds with the cells', () => {
    const map = base();
    const mark = map.doors![0];
    const clip = copyArea(map, { x: mark.x - 1, y: mark.y - 1, w: 3, h: 3 });
    expect(clip.doors).toEqual([{ ...mark, x: 1, y: 1 }]);
    const pasted = pasteArea(map, clip, 2, 2);
    expect(doorKindAt(pasted, 3, 3)).toBe(mark.kind);
    expect(pasted.cells[3][3].terrain).toBe('door');
  });
  it('project validation rejects malformed door marks and editor door kinds', () => {
    const settings = varied({ width: 44, height: 30, rooms: 8, seed: 5 });
    const map = base();
    const project = (patch: Partial<MapData>, editor?: object) => JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map: { ...map, ...patch }, ...(editor ? { editor } : {}) }));
    expect(parseProject(project({}))).not.toBeNull();
    expect(parseProject(project({ doors: [{ x: 1, y: 1, kind: 'trapdoor' as never }] }))).toBeNull();
    expect(parseProject(project({ doors: [{ x: -1, y: 1, kind: 'arch' }] }))).toBeNull();
    expect(parseProject(project({ doors: [{ x: 1.5, y: 1, kind: 'arch' }] }))).toBeNull();
    expect(parseProject(project({ doors: 'arch' as never }))).toBeNull();
    expect(parseProject({ ...project({}), gen: { ...settings, dungeonLevels: 9 } })).toBeNull();
    expect(parseProject({ ...project({}), gen: { ...settings, dungeonLayout: 'maze' } })).toBeNull();
  });
  it('blocked doors are walled off and never the only way into a room', () => {
    let blocked = 0;
    for (const archetype of ARCHETYPES) for (const seed of [1, 42, 7]) {
      const map = generateMap(varied({ width: 60, height: 40, rooms: 12, seed, cryptArchetype: archetype }));
      const marks = (map.doors ?? []).filter((d) => d.kind === 'blocked');
      expect(marks.length).toBeLessThanOrEqual(1);
      blocked += marks.length;
      for (const door of marks) {
        expect(map.cells[door.y][door.x].terrain).toBe('door');
        // Все залы достижимы от входа, хотя завал непроходим (reach его обходит).
        const seen = reach(map, map.plan!.spawn!);
        for (const room of map.cryptRooms ?? []) {
          let hit = false;
          for (let y = room.y; y < room.y + room.h && !hit; y++) for (let x = room.x; x < room.x + room.w; x++) if (seen.has(y * map.width + x)) { hit = true; break; }
          expect(hit).toBe(true);
        }
      }
      expect(map.plan?.dungeon?.connected).toBe(true);
    }
    expect(blocked).toBeGreaterThan(0);
  });
});
