import { describe, expect, it, vi } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { addCryptObject, cryptStamp } from '../src/lib/cryptLayout';
import { paintDecor } from '../src/lib/decor';
import { terrainLayerKey } from '../src/lib/render';
import { EMPTY_LEVEL_EDITS, recallLevel, stashLevel } from '../src/lib/levelEdits';
import type { GenSettings } from '../src/lib/types';

const settings = (patch: Partial<GenSettings>): GenSettings => ({
  ...DEFAULT_GEN, biome: 'dungeon', width: 50, height: 38, rooms: 8,
  dungeonLevels: 3, dungeonLevel: 0, ...patch,
});
const layouts: Array<[string, Partial<GenSettings>]> = [
  ['classic', { dungeonLayout: 'classic' }],
  ['varied', { dungeonLayout: 'varied' }],
  ['complex', { dungeonArchetype: 'sewer', dungeonCondition: 'flooded' }],
];

describe('dungeon walls-only mode', () => {
  for (const [name, patch] of layouts) {
    it(`${name}: empty, editable and deterministic for different seeds and levels`, () => {
      for (const seed of [11, 42]) for (const dungeonLevel of name === 'classic' ? [0] : [0, 1, 2]) {
        const gen = settings({ ...patch, seed, dungeonLevel, dungeonWallsOnly: true });
        const map = generateMap(gen);
        expect(generateMap(gen)).toEqual(map);
        expect(map.dungeonWallsOnly).toBe(true);
        expect(map.structures.length).toBeGreaterThan(0);
        expect(new Set(map.cells.flat().map(c => c.terrain))).toEqual(new Set(['void', 'wall', 'floor']));
        for (const objects of [map.crypt, map.trees, map.rocks, map.chests, map.doors, map.buildings, map.civic, map.lights, map.furnitureSprites]) expect(objects ?? []).toHaveLength(0);
        expect(map.floorLayer).toBeUndefined();
        expect(map.plan?.groups ?? []).toEqual([]);
        expect(map.plan?.report?.problems.filter(p => p.kind === 'crypt_room_empty') ?? []).toEqual([]);
        expect(map.plan?.report?.dungeonDressing).toBeUndefined();
        expect(map.plan?.dungeon?.complex?.scenes ?? []).toEqual([]);
        const floor = map.cells.flatMap((row, y) => row.map((cell, x) => ({ ...cell, x, y }))).find(cell => cell.terrain === 'floor')!;
        const edited = addCryptObject(map, cryptStamp(floor, 'candles', 0, false));
        expect(edited.crypt).toHaveLength(1);
        expect(edited.crypt![0].source).toBe('manual');
        expect(map.crypt).toEqual([]);
        const loaded = parseProject(JSON.parse(JSON.stringify({ version: 1, gen, render: DEFAULT_RENDER, map: edited })));
        expect(loaded?.gen.dungeonWallsOnly).toBe(true);
        expect(loaded?.map?.dungeonWallsOnly).toBe(true);
        expect(loaded?.map?.crypt).toEqual(edited.crypt);
      }
    });
  }

  it('preserves normal generation, legacy projects and other biomes', () => {
    const legacy = settings({ seed: 42 });
    const ordinary = generateMap(legacy);
    expect(generateMap({ ...legacy, dungeonWallsOnly: false })).toEqual(ordinary);
    expect(ordinary.crypt!.length).toBeGreaterThan(0);
    expect(parseProject({ version: 1, gen: legacy, render: DEFAULT_RENDER, map: ordinary })).not.toBeNull();
    expect(parseProject({ version: 1, gen: { ...legacy, dungeonWallsOnly: 'yes' }, render: DEFAULT_RENDER, map: ordinary })).toBeNull();
    expect(parseProject({ version: 1, gen: legacy, render: DEFAULT_RENDER, map: { ...ordinary, dungeonWallsOnly: 1 } })).toBeNull();
    const forest = { ...legacy, biome: 'forest' as const };
    expect(generateMap({ ...forest, dungeonWallsOnly: true })).toEqual(generateMap(forest));
  });

  it('retains manual edits on level switches and invalidates them when the mode changes', () => {
    const gen = settings({ dungeonLayout: 'varied', dungeonWallsOnly: true });
    const map = generateMap(gen);
    const floor = map.cells.flatMap((row, y) => row.map((cell, x) => ({ ...cell, x, y }))).find(cell => cell.terrain === 'floor')!;
    const edited = addCryptObject(map, cryptStamp(floor, 'candles', 0, false));
    const store = stashLevel(EMPTY_LEVEL_EDITS, gen, edited);
    expect(recallLevel(store, { ...gen, dungeonLevel: 1 })).toBeNull();
    expect(recallLevel(store, gen)).toEqual(edited);
    expect(recallLevel(store, { ...gen, dungeonWallsOnly: false })).toBeNull();
  });

  it('does not paint procedural decorations and separates the ground cache', () => {
    const map = generateMap(settings({ dungeonWallsOnly: true }));
    const ctx = { save: vi.fn() } as unknown as CanvasRenderingContext2D;
    paintDecor(ctx, map, DEFAULT_RENDER);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(terrainLayerKey(map, DEFAULT_RENDER, 42, 1200, 912))
      .not.toBe(terrainLayerKey({ ...map, dungeonWallsOnly: false }, DEFAULT_RENDER, 42, 1200, 912));
  });
});
