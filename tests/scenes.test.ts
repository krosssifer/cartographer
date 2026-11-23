import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject, validateProject } from '../src/lib/project';
import { OVERLAND_BIOMES, SCENE_ARCHETYPES, archetypeSupports, resolveArchetype } from '../src/lib/gen/archetypes';
import { FEATURE_IDS } from '../src/lib/gen/features';
import type { GenSettings, MapData } from '../src/lib/types';

const gen = (patch: Partial<GenSettings>): GenSettings => ({ ...DEFAULT_GEN, ...patch });
const isWater = (terrain: string) => terrain === 'water' || terrain === 'deepWater';

describe('archetype registry', () => {
  it('has 28 archetypes in three categories with unique ids', () => {
    expect(SCENE_ARCHETYPES.length).toBe(28);
    expect(new Set(SCENE_ARCHETYPES.map((item) => item.id)).size).toBe(28);
    for (const category of ['natural', 'architectural', 'special']) {
      expect(SCENE_ARCHETYPES.some((item) => item.category === category)).toBe(true);
    }
  });
  it('every feature has a builder and every fallback chain ends in a compatible scene', () => {
    for (const archetype of SCENE_ARCHETYPES) {
      for (const feature of archetype.features) expect(FEATURE_IDS).toContain(feature);
      for (const biome of OVERLAND_BIOMES) {
        const resolution = resolveArchetype(archetype.id, biome);
        expect(resolution, `${archetype.id}/${biome}`).toBeDefined();
        expect(archetypeSupports(resolution!.archetype, biome)).toBe(true);
        if (archetypeSupports(archetype, biome)) expect(resolution!.requested).toBeUndefined();
        else expect(resolution!.requested?.id).toBe(archetype.id);
      }
    }
  });
  it('does not apply to caves, dungeons and settlements', () => {
    for (const biome of ['cave', 'dungeon', 'village', 'town'] as const) {
      expect(resolveArchetype('bandit_camp', biome)).toBeUndefined();
    }
  });
});

describe('scene generation', () => {
  const cases = SCENE_ARCHETYPES.map((archetype) => ({ archetype, biome: archetype.biomes[0] }));
  for (const { archetype, biome } of cases) {
    it(`${archetype.id} is deterministic, valid and composed`, () => {
      const settings = gen({ seed: 4242, biome, sceneArchetype: archetype.id });
      const map = generateMap(settings);
      expect(JSON.stringify(generateMap(settings))).toBe(JSON.stringify(map));
      expect(map.plan?.archetype?.id).toBe(archetype.id);
      expect(validateProject({ version: 1, gen: settings, render: DEFAULT_RENDER, map })).toBe(true);
      // Главное пространство существует и свободно от стволов в ядре.
      const composition = map.plan!.composition!;
      const focal = composition.openSpaces[0];
      expect(focal).toBeDefined();
      if (focal.kind === 'battle_area') {
        const inside = map.trees.filter((tree) => tree.kind !== 'bush' && Math.hypot(tree.x - focal.x, tree.y - focal.y) < focal.radius * 0.7);
        expect(inside.length).toBe(0);
      }
      // Ни один объект не стоит в воде.
      for (const tree of map.trees) expect(isWater(map.cells[Math.round(Math.min(map.height - 1, tree.y))]?.[Math.round(Math.min(map.width - 1, tree.x))]?.terrain ?? '')).toBe(false);
      // Проверки ландшафта пройдены (после локальных починок).
      for (const check of map.plan!.archetype!.landscape.checks) expect(check.ok, check.id).toBe(true);
    });
  }

  it('different archetypes give different maps for one seed', () => {
    const a = generateMap(gen({ seed: 7, sceneArchetype: 'glade' }));
    const b = generateMap(gen({ seed: 7, sceneArchetype: 'graveyard' }));
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(b.cells));
  });

  it('second spaces are not uniformly spaced and masses vary in size', () => {
    let varied = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const map = generateMap(gen({ seed, width: 60, height: 40, sceneArchetype: 'lakeland' }));
      const radii = map.plan!.composition!.masses.map((mass) => mass.radius.toFixed(2));
      if (new Set(radii).size === radii.length && radii.length > 1) varied += 1;
    }
    expect(varied).toBeGreaterThanOrEqual(4);
  });

  it('architectural features produce editable objects', () => {
    const fortress = generateMap(gen({ seed: 3, sceneArchetype: 'ruined_fortress' }));
    expect(fortress.cells.flat().some((cell) => cell.terrain === 'wall')).toBe(true);
    const camp = generateMap(gen({ seed: 3, sceneArchetype: 'fortified_camp' }));
    expect((camp.civic ?? []).length).toBeGreaterThan(0);
    const cave = generateMap(gen({ seed: 3, sceneArchetype: 'cave_entrance' }));
    expect(cave.cells.flat().some((cell) => cell.terrain === 'caveFloor')).toBe(true);
  });

  it('crossing scenes put the road over the river with a designed bridge', () => {
    for (const seed of [1, 2, 3]) {
      const map = generateMap(gen({ seed, sceneArchetype: 'river_crossing' }));
      expect(map.cells.flat().some((cell) => isWater(cell.terrain))).toBe(true);
      expect((map.plan?.bridges ?? []).length).toBeGreaterThan(0);
    }
  });

  it('incompatible biome falls back and reports the substitution', () => {
    const map = generateMap(gen({ seed: 9, biome: 'desert', sceneArchetype: 'swamp_islands' }));
    expect(map.plan?.archetype?.requested).toBe('swamp_islands');
    expect(map.plan?.archetype?.id).not.toBe('swamp_islands');
  });

  it('large maps stay within the time budget', () => {
    const started = performance.now();
    const map: MapData = generateMap(gen({ seed: 5, width: 100, height: 80, sceneArchetype: 'forest_ambush' }));
    const elapsed = performance.now() - started;
    expect(map.width).toBe(100);
    expect(elapsed).toBeLessThan(4000);
  });
});

describe('project compatibility', () => {
  it('old projects without sceneArchetype still load', () => {
    const { sceneArchetype, ...old } = DEFAULT_GEN;
    void sceneArchetype;
    const project = parseProject({ version: 1, gen: old, render: DEFAULT_RENDER, map: null });
    expect(project).not.toBeNull();
    expect(project!.gen.sceneArchetype).toBeUndefined();
  });
  it('unknown scene ids are rejected, known ones round-trip', () => {
    expect(validateProject({ version: 1, gen: { ...DEFAULT_GEN, sceneArchetype: 'nope' }, render: DEFAULT_RENDER, map: null })).toBe(false);
    const settings = gen({ sceneArchetype: 'graveyard' });
    const map = generateMap(settings);
    const restored = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })));
    expect(restored?.gen.sceneArchetype).toBe('graveyard');
    expect(restored?.map?.crypt?.length).toBe(map.crypt?.length);
  });
});

describe('session storage', () => {
  it('a corrupted autosave is quarantined before it can be overwritten', async () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    (globalThis as unknown as { localStorage: typeof fake }).localStorage = fake;
    const { readSession, saveSession, sessionWasQuarantined, CORRUPT_SESSION_KEY } = await import('../src/lib/project');
    store.set('battlemap-studio-project-v1', '{"version":1,"gen":{broken');
    expect(readSession()).toBeNull();
    expect(sessionWasQuarantined()).toBe(true);
    expect(store.get(CORRUPT_SESSION_KEY)).toBe('{"version":1,"gen":{broken');
    saveSession({ version: 1, gen: DEFAULT_GEN, render: DEFAULT_RENDER, map: null });
    expect(store.get(CORRUPT_SESSION_KEY)).toBe('{"version":1,"gen":{broken');
    expect(readSession()?.gen.seed).toBe(DEFAULT_GEN.seed);
  });
});
