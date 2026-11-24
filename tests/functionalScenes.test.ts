import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { CIVIC_KIT } from '../src/lib/settlementKit';
import {
  FUNCTIONAL_SCENES,
  functionalPartBounds,
  functionalVariantBounds,
  validateFunctionalScenes,
} from '../src/lib/gen/urban/scenes';

describe('functional scene catalogue', () => {
  it('has named scene types with distinct valid variants and non-overlapping parts', () => {
    expect(FUNCTIONAL_SCENES.length).toBeGreaterThanOrEqual(10);
    expect(FUNCTIONAL_SCENES.every((scene) => ['compact', 'standard', 'extended'].every((size) => scene.variants.some((v) => v.size === size)))).toBe(true);
    expect(validateFunctionalScenes(FUNCTIONAL_SCENES)).toEqual([]);
  });

  it('uses existing civic sprites and their real footprints', () => {
    for (const scene of FUNCTIONAL_SCENES) for (const variant of scene.variants) {
      expect(variant.anchor.role).toBe('anchor');
      expect(variant.anchor.required).toBe(true);
      expect(variant.parts.some((part) => part.required)).toBe(true);
      const bounds = functionalVariantBounds(variant);
      for (const part of [variant.anchor, ...variant.parts]) {
        const spec = CIVIC_KIT[part.kind];
        expect(spec, `${scene.id}/${variant.id}/${part.kind}`).toBeDefined();
        expect(existsSync(`src/assets/cartography/${spec.art}.webp`), spec.art).toBe(true);
        const rect = functionalPartBounds(part);
        expect(rect.w).toBe(part.rotation % 180 ? spec.h : spec.w);
        expect(rect.h).toBe(part.rotation % 180 ? spec.w : spec.h);
        expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
        expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
        expect(rect.x + rect.w).toBeLessThanOrEqual(bounds.x + bounds.w);
        expect(rect.y + rect.h).toBeLessThanOrEqual(bounds.y + bounds.h);
      }
    }
  });

  it('detects duplicates, overlaps and blocked access', () => {
    const scene = FUNCTIONAL_SCENES[0];
    expect(validateFunctionalScenes([scene, scene]).some((error) => error.includes('duplicate'))).toBe(true);
    const variant = scene.variants[0];
    const bad = { ...scene, variants: [{ ...variant, parts: [{ ...variant.parts[0], dx: 0, dy: 0 }], access: [{ x: 0, y: 0, w: 1, h: 1 }] }] };
    const errors = validateFunctionalScenes([bad]);
    expect(errors.some((error) => error.includes('overlapping parts'))).toBe(true);
    expect(errors.some((error) => error.includes('blocked access'))).toBe(true);
  });
});

import { findFunctionalPlacement, FunctionalSceneBoard, rotateFunctionalRect } from '../src/lib/gen/urban/scenePlacement';
import type { UrbanPlot } from '../src/lib/gen/urban/types';
import type { Selection } from '../src/lib/types';

const workshopPlot: UrbanPlot = {
  id: 17, polygon: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 12 }, { x: 0, y: 12 }],
  bounds: { x: 0, y: 0, w: 14, h: 12 }, yardRect: { x: 1, y: 1, w: 12, h: 10 },
  courtyardKind: 'workshop_yard', districtIndex: 0, districtType: 'craft', zone: 'residential',
  size: 168, frontage: 14, depth: 12, orientation: 0, roadLevel: 2, wealth: 0.4, age: 'inner_city', fn: 'workshop',
};

describe('functional scene candidate search', () => {
  const base = { seed: 42, plot: workshopPlot, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null };

  it('rotates footprints and returns to the original after four turns', () => {
    const rect = { x: -2, y: 3, w: 2, h: 1 };
    expect(rotateFunctionalRect(rect, 90)).toEqual({ x: -4, y: -2, w: 1, h: 2 });
    let current: Selection = rect;
    for (let i = 0; i < 4; i++) current = rotateFunctionalRect(current, 90);
    expect(current).toEqual(rect);
  });

  it('returns deterministic complete compositions and independently varies seed', () => {
    const result = findFunctionalPlacement(base);
    expect(result.placement).not.toBeNull();
    expect(findFunctionalPlacement(base)).toEqual(result);
    const placed = result.placement!;
    const def = FUNCTIONAL_SCENES.find((scene) => scene.id === placed.sceneId)!;
    const variant = def.variants.find((v) => v.id === placed.variantId)!;
    expect(placed.anchor.kind).toBe(variant.anchor.kind);
    expect(placed.parts.filter((p) => p.required).length).toBe(variant.parts.filter((p) => p.required).length);
    const keys = new Set(Array.from({ length: 12 }, (_, seed) => JSON.stringify(findFunctionalPlacement({ ...base, seed }).placement)));
    expect(keys.size).toBeGreaterThan(1);
  });

  it('examines every fitting position, orientation and workshop variant before rejecting', () => {
    const scenes = FUNCTIONAL_SCENES.filter((scene) => ['blacksmith', 'carpenter', 'pottery'].includes(scene.id));
    const zone = workshopPlot.yardRect!;
    let expectedPositions = 0;
    let expectedTooLarge = 0;
    for (const scene of scenes) for (const variant of scene.variants) {
      const rects = [functionalPartBounds(variant.anchor), ...variant.parts.filter((p) => p.required).map(functionalPartBounds), ...variant.access];
      const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
      const bounds = { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
      for (const rotation of [0, 90, 180, 270] as const) {
        const rotated = rotateFunctionalRect(bounds, rotation);
        if (rotated.w > zone.w || rotated.h > zone.h) expectedTooLarge++;
        else expectedPositions += (zone.w - rotated.w + 1) * (zone.h - rotated.h + 1);
      }
    }
    const result = findFunctionalPlacement({ ...base, scenes, check: () => 'collision' });
    expect(result.placement).toBeNull();
    expect(result.attempted).toBe(expectedPositions);
    expect(result.rejected.collision).toBe(expectedPositions);
    expect(result.rejected.insufficientSpace).toBe(expectedTooLarge);
    expect(result.rejected.districtMismatch).toBe(0);
  });

  it('records detailed per-orientation failures without changing placement', () => {
    const scenes = FUNCTIONAL_SCENES.filter((scene) => scene.id === 'carpenter');
    const check = () => ({ reason: 'collision' as const, obstacle: 'street' as const });
    const plain = findFunctionalPlacement({ ...base, scenes, check });
    const traced = findFunctionalPlacement({ ...base, scenes, check, trace: true });
    expect(traced.placement).toEqual(plain.placement);
    expect(traced.rejected).toEqual(plain.rejected);
    expect(traced.trace!.rotations).toHaveLength(scenes[0].variants.length * 4);
    expect(traced.trace!.rotations.reduce((sum, row) => sum + row.positions, 0)).toBe(traced.attempted);
    expect(traced.trace!.rotations.reduce((sum, row) => sum + (row.reasons.street ?? 0), 0)).toBe(traced.rejected.collision);
  });

  it('returns no partial composition when any required part is blocked', () => {
    const onlyForge = FUNCTIONAL_SCENES.filter((scene) => scene.id === 'blacksmith');
    const result = findFunctionalPlacement({ ...base, scenes: onlyForge, check: (rect, purpose) => purpose === 'object' && rect.w * rect.h === 4 ? 'collision' : null });
    expect(result.attempted).toBeGreaterThan(0);
    expect(result.rejected.collision).toBeGreaterThan(0);
    expect(result.placement).toBeNull();
  });

  it('rejects too-small yards and door/access conflicts', () => {
    const small = findFunctionalPlacement({ ...base, zone: { x: 1, y: 1, w: 1, h: 1 } });
    expect(small.placement).toBeNull();
    expect(small.rejected.insufficientSpace).toBeGreaterThan(0);
    const blocked = findFunctionalPlacement({ ...base, check: (_rect, purpose) => purpose === 'access' ? 'doorAccess' : null });
    expect(blocked.placement).toBeNull();
    expect(blocked.rejected.doorAccess).toBeGreaterThan(0);
  });

  it('checks the plot polygon, not merely the bounding rectangle', () => {
    const plot = { ...workshopPlot, polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] };
    const result = findFunctionalPlacement({ ...base, plot });
    expect(result.placement).toBeNull();
    expect(result.rejected.bounds).toBeGreaterThan(0);
  });
});


describe('functional scene board', () => {
  it('commits a whole composition and reserves its footprints and access', () => {
    const board = new FunctionalSceneBoard(14, 12);
    const input = { seed: 42, plot: workshopPlot, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null };
    const first = board.place(input);
    expect(first.placement).not.toBeNull();
    const second = board.place(input);
    if (second.placement) {
      const firstRects = [first.placement!.anchor, ...first.placement!.parts, ...first.placement!.access];
      const nextRects = [second.placement.anchor, ...second.placement.parts, ...second.placement.access];
      for (const a of firstRects) for (const b of nextRects) {
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    }
    const before = [...board.placements];
    const blocked = board.place({ ...input, check: () => 'doorAccess' });
    expect(blocked.placement).toBeNull();
    expect(board.placements).toEqual(before);
  });
});

describe('optional components and malformed templates', () => {
  it('fits required parts even when an optional part lies outside the yard', () => {
    const original = FUNCTIONAL_SCENES.find((scene) => scene.id === 'carpenter')!;
    const variant = original.variants[0];
    const modified = { ...original, variants: [{ ...variant, parts: [...variant.parts, { ...variant.parts[0], dx: 10, dy: 10, required: false }] }] };
    const result = findFunctionalPlacement({ seed: 1, plot: workshopPlot, zone: { x: 1, y: 1, w: 5, h: 4 }, scenes: [modified], check: () => null });
    expect(result.placement).not.toBeNull();
    expect(result.placement!.parts).toHaveLength(variant.parts.length);
  });

  it('never accepts a malformed overlapping required part or blocked access', () => {
    const original = FUNCTIONAL_SCENES[0], variant = original.variants[0];
    const overlapping = { ...original, variants: [{ ...variant, parts: [{ ...variant.parts[0], dx: 0, dy: 0 }] }] };
    const input = { seed: 1, plot: workshopPlot, zone: workshopPlot.yardRect!, check: () => null };
    expect(findFunctionalPlacement({ ...input, scenes: [overlapping] }).placement).toBeNull();
    const badAccess = { ...original, variants: [{ ...variant, access: [{ x: 0, y: 0, w: 1, h: 1 }] }] };
    expect(findFunctionalPlacement({ ...input, scenes: [badAccess] }).placement).toBeNull();
  });
});

describe('scene applicability for landmark overrides', () => {
  const building = { x: 0, y: 0, w: 3, h: 3, style: 'town' as const, kind: 'tavern' as const, roof: 0 as const, door: { x: 1, y: 2 }, facing: 0 as const, role: 'tavern' as const };
  it('uses the real building role rather than a parcel classified as a workshop', () => {
    const result = findFunctionalPlacement({ seed: 4, plot: { ...workshopPlot, districtType: 'residential', courtyardKind: 'inn_yard' }, building, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null });
    expect(result.placement?.sceneId).toBe('inn');
    const smith = findFunctionalPlacement({ seed: 4, plot: { ...workshopPlot, fn: 'shop', courtyardKind: 'workshop_yard' }, building: { ...building, kind: 'shop', role: 'smithy' }, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null });
    expect(smith.placement?.sceneId).toBe('blacksmith');
    const hall = findFunctionalPlacement({ seed: 4, plot: workshopPlot, building: { ...building, kind: 'hall', role: 'town_hall' }, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null });
    expect(hall.placement).toBeNull();
  });
});


describe('contextual size preference', () => {
  it('prefers smaller scenes in worn, poorer yards and larger ones in wealthy pristine yards', () => {
    const baseScene = FUNCTIONAL_SCENES.find((s) => s.id === 'carpenter')!;
    const template = baseScene.variants[0];
    const scenes = [{ ...baseScene, variants: (['compact', 'standard', 'extended'] as const).map((size) => ({ ...template, size, id: size })) }];
    const input = { seed: 99, plot: workshopPlot, zone: workshopPlot.yardRect!, scenes, check: () => null };
    const modest = findFunctionalPlacement({ ...input, plot: { ...workshopPlot, wealth: 0 }, condition: 'worn' });
    const rich = findFunctionalPlacement({ ...input, plot: { ...workshopPlot, wealth: 1 }, condition: 'pristine' });
    expect(modest.placement?.variantId).toBe('compact');
    expect(rich.placement?.variantId).toBe('extended');
  });
});

describe('rotated scene footprints', () => {
  it('uses the actual rotated civic dimensions for all orientations', () => {
    const rotations = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const placement = findFunctionalPlacement({ seed, plot: workshopPlot, zone: workshopPlot.yardRect!, scenes: FUNCTIONAL_SCENES, check: () => null }).placement!;
      rotations.add(placement.rotation);
      for (const part of [placement.anchor, ...placement.parts]) {
        const spec = CIVIC_KIT[part.kind];
        expect(part.w).toBe(part.rotation % 180 ? spec.h : spec.w);
        expect(part.h).toBe(part.rotation % 180 ? spec.w : spec.h);
      }
    }
    expect(rotations).toEqual(new Set([0, 90, 180, 270]));
  });
});
