import { describe, expect, it } from 'vitest';
import { FUNCTIONAL_SCENES, functionalPartBounds, functionalVariantBounds, validateFunctionalScenes } from '../src/lib/gen/urban/scenes';
import { findFunctionalPlacement, FunctionalSceneBoard, functionalSceneApplies, rotateFunctionalRect } from '../src/lib/gen/urban/scenePlacement';
import { CIVIC_KIT, intersects } from '../src/lib/settlementKit';
import type { UrbanPlot } from '../src/lib/gen/urban/types';
import type { Building, Selection } from '../src/lib/types';
import { existsSync } from 'node:fs';

const rotations = [0, 90, 180, 270] as const;
const box = { x: 0, y: 0, w: 32, h: 32 };
const yard = { x: 2, y: 2, w: 26, h: 26 };
const building: Building = { x: 28, y: 3, w: 3, h: 4, style: 'town', kind: 'house', roof: 0, door: { x: 28, y: 5 }, facing: 270 };
const rectKey = (r: Selection) => `${r.x},${r.y},${r.w},${r.h}`;
const translated = (r: Selection) => ({ ...r, x: r.x + 15, y: r.y + 15 });

function plotFor(scene: typeof FUNCTIONAL_SCENES[number]): UrbanPlot {
  return { id: 17, polygon: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 0, y: 32 }], bounds: box, yardRect: yard,
    courtyardKind: scene.courtyardKinds[0], districtIndex: 0, districtType: scene.districts[0], zone: 'residential',
    size: 1024, frontage: 32, depth: 32, orientation: 0, roadLevel: 2, wealth: .5, age: 'inner_city', fn: scene.plotFunctions[0] };
}

describe('complete functional scene catalogue matrix', () => {
  for (const scene of FUNCTIONAL_SCENES) {
    it(`${scene.id}: catalogue, eligibility and all isolated variants and rotations`, () => {
      const plot = plotFor(scene);
      expect(functionalSceneApplies(plot, building, scene)).toBe(true);
      expect(new Set(scene.variants.map(v => v.id)).size).toBe(scene.variants.length);
      const signatures = new Set<string>();
      for (const variant of scene.variants) {
        expect(variant.anchor.required).toBe(true);
        expect(variant.parts.some(p => p.required)).toBe(true);
        const signature = JSON.stringify({ anchor: variant.anchor, parts: variant.parts, access: variant.access });
        expect(signatures.has(signature), `${scene.id}/${variant.id}: duplicate composition`).toBe(false);
        signatures.add(signature);
        const bounds = functionalVariantBounds(variant);
        for (const part of [variant.anchor, ...variant.parts]) {
          const spec = CIVIC_KIT[part.kind];
          expect(spec, `${scene.id}/${variant.id}/${part.kind}`).toBeDefined();
          expect(existsSync(`src/assets/cartography/${spec.art}.webp`), spec.art).toBe(true);
          expect([0, 90, 180, 270]).toContain(part.rotation);
          expect(Number.isInteger(part.dx) && Number.isInteger(part.dy)).toBe(true);
          const rect = functionalPartBounds(part);
          expect(rect.x).toBeGreaterThanOrEqual(bounds.x); expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
          expect(rect.x + rect.w).toBeLessThanOrEqual(bounds.x + bounds.w); expect(rect.y + rect.h).toBeLessThanOrEqual(bounds.y + bounds.h);
        }
        for (const rotation of rotations) {
          const isolated = { ...scene, variants: [variant] };
          const objectRects = [variant.anchor, ...variant.parts].map(p => translated(rotateFunctionalRect(functionalPartBounds(p), rotation)));
          const accessRects = variant.access.map(r => translated(rotateFunctionalRect(r, rotation)));
          const allowedObjects = new Set(objectRects.map(rectKey));
          const allowedAccess = new Set(accessRects.map(rectKey));
          const board = new FunctionalSceneBoard(32, 32);
          const result = board.place({ seed: 42, plot, building, zone: yard, scenes: [isolated], trace: true,
            check: (rect, purpose) => intersects(rect, building) ? 'collision' : (purpose === 'object' ? allowedObjects : allowedAccess).has(rectKey(rect)) ? null : 'collision' });
          const trace = result.trace!.rotations.find(row => row.rotation === rotation)!;
          expect(trace.geometricallyValid, `${scene.id}/${variant.id}/${rotation}: no valid candidate`).toBeGreaterThan(0);
          const placed = result.placement;
          expect(placed, `${scene.id}/${variant.id}/${rotation}: no placement`).not.toBeNull();
          expect(placed!.rotation, `${scene.id}/${variant.id}/${rotation}: other orientation won`).toBe(rotation);
          expect(placed!.anchor.kind).toBe(variant.anchor.kind);
          for (const part of [variant.anchor, ...variant.parts.filter(p => p.required)]) {
            const expected = translated(rotateFunctionalRect(functionalPartBounds(part), rotation));
            expect([placed!.anchor, ...placed!.parts].some(actual => actual.kind === part.kind && rectKey(actual) === rectKey(expected) && actual.rotation === (part.rotation + rotation) % 360), `${scene.id}/${variant.id}/${rotation}/${part.kind}`).toBe(true);
          }
          const items = [placed!.anchor, ...placed!.parts];
          for (const [i, item] of items.entries()) {
            expect(items.slice(i + 1).some(other => intersects(item, other))).toBe(false);
            expect(placed!.access.some(area => intersects(item, area))).toBe(false);
            expect(intersects(item, building)).toBe(false);
          }
          expect(board.placements).toEqual([placed]);
          const before = [...board.placements];
          const blocked = board.place({ seed: 42, plot, building, zone: yard, scenes: [isolated], check: () => 'collision' });
          expect(blocked.placement).toBeNull(); expect(board.placements).toEqual(before);
        }
      }
    });
  }
});

describe('conflicting access areas', () => {
  it('rejects overlapping functional zones without committing a partial scene', () => {
    const original = FUNCTIONAL_SCENES.find(scene => scene.id === 'carpenter')!;
    const variant = original.variants[0];
    const invalid = { ...original, variants: [{ ...variant, access: [variant.access[0], { ...variant.access[0] }] }] };
    expect(validateFunctionalScenes([invalid]).some(error => error.includes('overlapping access areas'))).toBe(true);
    const board = new FunctionalSceneBoard(32, 32);
    const result = board.place({ seed: 42, plot: plotFor(original), building, zone: yard, scenes: [invalid], check: () => null });
    expect(result.placement).toBeNull();
    expect(result.rejected.collision).toBeGreaterThan(0);
    expect(board.placements).toEqual([]);
  });
});

describe('external obstacles and atomicity', () => {
  const original = FUNCTIONAL_SCENES.find(scene => scene.id === 'carpenter')!;
  const plot = plotFor(original);
  for (const obstacle of ['building', 'street', 'passage', 'reservation', 'water', 'terrain', 'civic', 'door'] as const) {
    it(`reports ${obstacle} and leaves no partial scene or reservation`, () => {
      const board = new FunctionalSceneBoard(32, 32);
      const reason = obstacle === 'door' ? 'doorAccess' as const : 'collision' as const;
      const args = { seed: 42, plot, building, zone: yard, scenes: [original], trace: true };
      const failure = board.place({ ...args, check: () => ({ reason, obstacle }) });
      expect(failure.placement).toBeNull();
      expect(failure.rejected[reason]).toBeGreaterThan(0);
      expect(failure.trace!.rotations.some(r => (r.reasons[obstacle] ?? 0) > 0)).toBe(true);
      expect(board.placements).toEqual([]);
      expect(board.place({ ...args, check: () => null }).placement).not.toBeNull();
      expect(board.placements).toHaveLength(1);
    });
  }
  it('rejects an incompatible function or district for a generic building', () => {
    const wrongFunction = { ...plot, fn: 'warehouse' as const };
    const wrongDistrict = { ...plot, districtType: 'temple' as const };
    for (const p of [wrongFunction, wrongDistrict]) {
      const result = findFunctionalPlacement({ seed: 42, plot: p, building, zone: yard, scenes: [original], check: () => null });
      expect(result.placement).toBeNull();
      expect(result.rejected.districtMismatch).toBe(1);
    }
  });
  it('rejects every candidate when the access corridor is obstructed', () => {
    const board = new FunctionalSceneBoard(32, 32);
    const result = board.place({ seed: 42, plot, building, zone: yard, scenes: [original], check: (_rect, purpose) => purpose === 'access' ? 'doorAccess' : null });
    expect(result.placement).toBeNull(); expect(result.rejected.doorAccess).toBeGreaterThan(0); expect(board.placements).toEqual([]);
  });
  it('does not allow a second scene to claim the first scene or its access areas', () => {
    const board = new FunctionalSceneBoard(32, 32);
    const args = { seed: 42, plot, building, zone: yard, scenes: [original], check: () => null };
    const first = board.place(args).placement!;
    expect(first).toBeTruthy();
    const area = first.bounds;
    const second = board.place({ ...args, zone: area });
    expect(second.placement).toBeNull();
    expect(board.placements).toEqual([first]);
    expect(board.place(args).placement).not.toBeNull();
  });
  it('does not let landmark roles bypass district or courtyard restrictions', () => {
    const smith = FUNCTIONAL_SCENES.find(scene => scene.id === 'blacksmith')!;
    const appropriate = plotFor(smith);
    const smithy = { ...building, role: 'smithy' as const };
    // A landmark can override plot function, but must still match its yard and district.
    expect(functionalSceneApplies({ ...appropriate, fn: 'shop' }, smithy, smith)).toBe(true);
    expect(functionalSceneApplies({ ...appropriate, districtType: 'temple' }, smithy, smith)).toBe(false);
    expect(functionalSceneApplies({ ...appropriate, courtyardKind: 'private_garden' }, smithy, smith)).toBe(false);
  });
});


describe('scene independence', () => {
  for (const scene of FUNCTIONAL_SCENES) it(`${scene.id} is independent of unrelated searches`, () => {
    const plot = plotFor(scene), args = { seed: 87, plot, building, zone: yard, scenes: [scene], check: () => null };
    const first = findFunctionalPlacement(args);
    for (const other of FUNCTIONAL_SCENES) findFunctionalPlacement({ ...args, seed: 11, plot: plotFor(other), scenes: [other] });
    expect(findFunctionalPlacement(args)).toEqual(first);
  });
});
