import { describe, expect, it } from 'vitest';
import { SCENES, rankSceneVariants, scenePartRole } from '../src/lib/gen/complex/scenes';
import type { ComplexPurpose } from '../src/lib/gen/complex/registry';
import { drawDungeonDressingDebug } from '../src/lib/gen/complex/debug';
import { validateDungeonDressing } from '../src/lib/gen/validate';
import { clusterRule } from '../src/lib/gen/complex/clusters';
import { repairMap } from '../src/lib/gen/repair';
import { CRYPT } from '../src/lib/cryptKit';
import { parseProject } from '../src/lib/project';
import { DEFAULT_RENDER } from '../src/lib/presets';
import { DEFAULT_GEN } from '../src/lib/presets';
import { generateMap } from '../src/lib/generator';
import { decorateCrypt } from '../src/lib/cryptLayout';

describe('dungeon dressing pipeline', () => {
  const settings = { ...DEFAULT_GEN, biome: 'dungeon' as const, dungeonArchetype: 'laboratory', width: 64, height: 46, rooms: 8, seed: 42, dungeonLevels: 1 };
  it('ranks variants by actual room space and derives semantic part roles', () => {
    const variants = [
      { id: 'crowded', label: 'crowded', parts: [{ kind: 'coffin' as const, slot: 'row' as const, count: 5 }] },
      { id: 'compact', label: 'compact', parts: [{ kind: 'skull' as const, slot: 'center' as const }] },
    ];
    const context = { area: 20, free: 12, wallCells: 10, width: 4, height: 5, doors: 2, shape: 'L', depth: 2, style: 'stone', condition: 'ruined' };
    const rank = () => rankSceneVariants(variants, context, (kind) => CRYPT[kind as keyof typeof CRYPT], 123);
    expect(rank()[0].id).toBe('compact');
    expect(rank()).toEqual(rank());
    expect(scenePartRole(variants[1].parts[0], true)).toBe('anchor');
    expect(scenePartRole(variants[0].parts[0], false)).toBe('row');
  });
  it('the complex metadata-only legacy pass preserves all objects and does not furnish again', () => {
    const map = generateMap(settings);
    const before = map.crypt ?? [];
    const result = decorateCrypt(map, settings, before, undefined, undefined, 'roomsOnly');
    expect(result.crypt).toEqual(before);
    expect(result.cryptRooms?.length).toBe(map.structures.length);
  });
  it('surviving scene groups contain every required catalog part and round-trip', () => {
    let groupsSeen = 0;
    for (const seed of [3, 42, 101, 400]) {
      const gen = { ...settings, seed };
      const map = generateMap(gen);
      const objects = (map.crypt ?? []).filter(o => o.dungeonScene);
      for (const group of new Set(objects.map(o => o.dungeonScene!.groupId))) {
        groupsSeen++;
        const parts = objects.filter(o => o.dungeonScene!.groupId === group);
        const meta = parts[0].dungeonScene!;
        const variant = SCENES[meta.purpose as ComplexPurpose]?.find(v => v.id === meta.variant);
        expect(variant).toBeDefined();
        variant!.parts.forEach((part, i) => {
          if (!part.optional) expect(parts.filter(o => o.dungeonScene!.role === `${group}:${i}`).length).toBeGreaterThanOrEqual(part.count ?? 1);
        });
        for (const item of parts) if (item.dungeonScene!.attachTo) expect(parts.some(p => p.dungeonScene!.role === item.dungeonScene!.attachTo)).toBe(true);
      }
      const restored = parseProject(JSON.parse(JSON.stringify({ version: 1, gen, render: DEFAULT_RENDER, map })));
      expect(restored?.map?.crypt).toEqual(map.crypt);
    }
    expect(groupsSeen).toBeGreaterThan(0);
  });
  it('rolls back already placed required parts if a later part cannot fit', () => {
    const initial = generateMap(settings);
    const meta = initial.crypt?.find(item => item.dungeonScene?.required)?.dungeonScene;
    expect(meta).toBeDefined();
    const purpose = meta!.purpose as ComplexPurpose;
    const previous = SCENES[purpose];
    const original = previous!.find(v => v.id === meta!.variant)!;
    const first = original.parts.find(part => !part.optional)!;
    try {
      SCENES[purpose] = [{ id: 'only-first', label: 'test', parts: [first] }];
      expect(generateMap(settings).crypt?.some(item => item.dungeonScene?.variant === 'only-first')).toBe(true);
      SCENES[purpose] = [{ id: 'impossible', label: 'test', parts: [first,
        { kind: 'cauldron', slot: 'center', count: 30 },
      ] }];
      const map = generateMap(settings);
      expect(map.crypt?.some(item => item.dungeonScene?.variant === 'impossible')).toBe(false);
      SCENES[purpose] = [{ id: 'optional-fails', label: 'test', parts: [first,
        { kind: 'cauldron', slot: 'center', count: 30, optional: true },
      ] }];
      expect(generateMap(settings).crypt?.some(item => item.dungeonScene?.variant === 'optional-fails' && item.dungeonScene.required)).toBe(true);
    } finally {
      SCENES[purpose] = previous;
    }
  });
  it('repair removes an entire scene if a required blocker becomes invalid', () => {
    const map = generateMap(settings);
    const object = map.crypt?.find(o => o.dungeonScene?.required && CRYPT[o.kind].blocks);
    expect(object).toBeDefined();
    const cells = map.cells.map(row => row.map(cell => ({ ...cell })));
    cells[object!.y][object!.x].terrain = 'water';
    const repaired = repairMap({ ...map, cells }).map;
    expect(repaired.crypt?.some(o => o.dungeonScene?.groupId === object!.dungeonScene!.groupId)).toBe(false);
  });
  it('clusters have appropriate surviving sources, bounded radius and no scene overlap', () => {
    let count = 0;
    for (const dungeonArchetype of ['tomb', 'fortress', 'sewer']) for (const seed of [3, 11, 42]) {
      const gen = { ...settings, dungeonArchetype, seed, dungeonCondition: 'ruined' };
      const map = generateMap(gen);
      for (const item of map.crypt ?? []) {
        const cluster = item.dungeonCluster;
        if (!cluster) continue;
        count++;
        expect(CRYPT[item.kind].blocks).not.toBe(true);
        expect(Math.max(Math.abs(item.x - cluster.source.x), Math.abs(item.y - cluster.source.y))).toBeLessThanOrEqual(cluster.radius);
        expect(map.crypt!.some(source => !source.dungeonCluster && source.kind === cluster.source.kind && source.x === cluster.source.x && source.y === cluster.source.y)).toBe(true);
        expect(map.crypt!.some(scene => scene.dungeonScene && item.x < scene.x + scene.w && scene.x < item.x + item.w && item.y < scene.y + scene.h && scene.y < item.y + item.h)).toBe(false);
      }
      const groups = new Map<string, number>();
      for (const item of map.crypt ?? []) if (item.dungeonCluster) groups.set(item.dungeonCluster.id, (groups.get(item.dungeonCluster.id) ?? 0) + 1);
      for (const n of groups.values()) expect(n).toBeLessThanOrEqual(2);
      expect(generateMap(gen).crypt).toEqual(map.crypt);
    }
    expect(count).toBeGreaterThan(0);
    expect(clusterRule('puddleBlue', { debris: 0, flood: 0, neglect: 0, occupied: 0 })).toBeUndefined();
    expect(clusterRule('workbench', { debris: 0, flood: 0, neglect: 0, occupied: 1 })?.type).toBe('activity');
  });
  it('quality validator detects incomplete groups and keeps empty rooms as warnings', () => {
    const map = generateMap(settings);
    const quality = validateDungeonDressing(map);
    expect(quality.errors).toEqual([]);
    expect(quality.rooms.length).toBe(map.plan!.rooms!.length);
    expect(map.plan!.report!.dungeonDressing).toEqual(quality);
    const part = map.crypt!.find(item => item.dungeonScene?.required)!;
    const broken = { ...map, crypt: map.crypt!.filter(item => item !== part) };
    expect(validateDungeonDressing(broken).errors.some(error => error.includes('missing required part') || error.includes('missing attachment'))).toBe(true);
    const empty = validateDungeonDressing({ ...map, crypt: [] });
    expect(empty.errors).toEqual([]);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
  it('debug overlay is independently serializable and draws scene and rejection data', () => {
    const map = generateMap(settings);
    expect(map.plan?.dungeonDressingDebug?.spine.length).toBeGreaterThan(0);
    expect(map.plan?.dungeonDressingDebug?.rejected.length).toBeGreaterThan(0);
    let rectangles = 0;
    const labels: string[] = [];
    const ctx = { save() {}, restore() {}, strokeRect() { rectangles++; }, fillRect() { rectangles++; }, fillText(t: string) { labels.push(t); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
    drawDungeonDressingDebug(ctx, map, 24);
    expect(rectangles).toBeGreaterThan(0);
    expect(labels.some(label => label.includes('room-'))).toBe(true);
    expect(labels.some(label => label.includes('clearance') || label.includes('collision'))).toBe(true);
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: { ...DEFAULT_RENDER, showDungeonDressingDebug: true }, map })));
    expect(parsed?.render.showDungeonDressingDebug).toBe(true);
    expect(parsed?.map?.plan?.dungeonDressingDebug).toEqual(map.plan?.dungeonDressingDebug);
    const raw = JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map }));
    raw.map.crypt.find((item: { dungeonScene?: unknown }) => item.dungeonScene).dungeonScene = { groupId: 'bad' };
    expect(parseProject(raw)).toBeNull();
  });
  it('checks scene completeness and quality across room sizes, geometries and purposes', () => {
    const seen = new Set<string>();
    const variants = new Set<string>();
    for (const dungeonArchetype of ['fortress', 'tomb', 'laboratory', 'sewer']) {
      for (const [width, height, dungeonGeometry] of [[36, 28, 'regular'], [64, 46, 'varied'], [86, 62, 'organic']] as const) {
        const gen = { ...settings, dungeonArchetype, width, height, dungeonGeometry, seed: 17 };
        const map = generateMap(gen);
        expect(map.plan?.dungeon?.connected).toBe(true);
        expect(validateDungeonDressing(map).errors).toEqual([]);
        for (const room of map.plan?.rooms ?? []) seen.add(room.purpose);
        for (const item of map.crypt ?? []) if (item.dungeonScene) variants.add(`${item.dungeonScene.purpose}:${item.dungeonScene.variant}`);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(variants.size).toBeGreaterThan(8);
  });
  it('does not add the legacy corridor-trap pass on top of a linked mechanism', () => {
    let mechanisms = 0;
    for (const seed of [3, 11, 42, 101]) {
      const map = generateMap({ ...settings, seed, dungeonArchetype: 'tomb', cryptTraps: true });
      if (!map.plan?.dungeon?.complex?.mechanisms.some(m => m.startsWith('ловушечный коридор:'))) continue;
      mechanisms++;
      expect(map.plan.actions?.some(action => action.startsWith('в коридорах скрыто ловушек:'))).not.toBe(true);
    }
    expect(mechanisms).toBeGreaterThan(0);
  });
  it('keeps complex generation deterministic', () => {
    expect(generateMap(settings)).toEqual(generateMap(settings));
  });
});
