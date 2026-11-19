import { strict as assert } from 'node:assert';
import { generateSettlement } from '../src/lib/settlement';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { contains, DEFAULT_EDITOR, intersects } from '../src/lib/settlementKit';
import { buildingStamp, addBuilding, addCivic, civicStamp, replanSettlement } from '../src/lib/settlementEdits';
import { eraseArea, copyArea, pasteArea, placeChest } from '../src/lib/edits';
import { parseProject } from '../src/lib/project';
import { interiorOf } from '../src/lib/interiors';
import { furnitureBounds } from '../src/lib/furnitureKit';
import type { Point } from '../src/lib/types';

for (const biome of ['village', 'town'] as const) for (const [width, height] of [[10, 10], [80, 10], [14, 60], [28, 20], [44, 28], [100, 80]]) {
  for (const seed of [29, 425, 1337, 4294967294]) {
    const settings = { ...DEFAULT_GEN, biome, seed, width, height };
    const planned = [0, .05, .15, .35, .60, 1].map((density) => generateSettlement({ ...settings, density }));
    const houses = planned.map((m) => m.buildings!);
    assert.equal(houses[0].length, 0);
    assert.ok(houses[5].length >= 1, `${biome}, ${width}x${height}, seed ${seed}`);
    assert.equal(houses[5].filter((b) => b.kind === 'tavern').length, 1);
    assert.equal(houses[1][0].kind, 'tavern');
    assert.ok(houses[1].length <= Math.max(1, houses[5].length * .12));
    for (let i = 0; i < houses.length; i++) {
      assert.deepEqual(planned[i].road, planned[0].road);
      assert.deepEqual(planned[i].civic, planned[0].civic);
      assert.deepEqual(houses[i], houses[5].slice(0, houses[i].length));
      if (i > 0) assert.ok(houses[i].length >= houses[i - 1].length);
    }
    const busy = planned[5];
    assert.deepEqual(busy, generateSettlement({ ...settings, density: 1 }));
    assert.ok(busy.civic!.some((p) => p.kind === 'square'));
    for (const [i, b] of houses[5].entries()) {
      assert.ok(b.w * b.h >= 20);
      assert.ok(Math.min(b.w, b.h) >= 4);
      assert.ok(!houses[5].slice(i + 1).some((other) => intersects(b, other)));
      assert.ok(!busy.civic!.some((item) => intersects(b, item)));
      assert.ok(!busy.road.some((p) => contains(b, p.x, p.y)));
      assert.ok(contains(b, b.door.x, b.door.y));
      const out = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[b.facing!];
      const [x, y] = [b.door.x + out[0], b.door.y + out[1]];
      assert.ok(!houses[5].some((other) => contains(other, x, y)));
      assert.ok(!['water', 'deepWater'].includes(busy.cells[y][x].terrain));
      const plan = interiorOf(b);
      assert.ok(plan.rooms.length > 1);
      for (const item of plan.furnishings) {
        const area = furnitureBounds(item);
        assert.ok(area.x >= 0 && area.y >= 0 && area.x + area.w <= b.w && area.y + area.h <= b.h);
      }
      if (b.kind === 'tavern') {
        assert.ok(b.w * b.h >= 42);
        assert.ok(plan.rooms.length >= 3);
        assert.ok(plan.furnishings.some((f) => f.kind === 'bar'));
        assert.ok(plan.furnishings.filter((f) => f.kind === 'table').length >= 2);
        assert.ok(plan.furnishings.filter((f) => f.kind === 'chair').length >= 4);
      }
    }
    assert.deepEqual(parseProject({ version: 1, gen: settings, map: busy, render: DEFAULT_RENDER })?.map, busy);
  }
}

const settings = { ...DEFAULT_GEN, biome: 'town' as const, width: 44, height: 28, density: 0, publicSpaces: false };
const quiet = generateSettlement(settings);
const first: Point = { x: 4, y: 4 };
const stamp = buildingStamp(quiet, first, { ...DEFAULT_EDITOR, roofMaterial: 4, roofShape: 'cross' });
const house = addBuilding(quiet, stamp);
assert.equal(house.buildings?.length, 1);
assert.equal(addBuilding(house, stamp), house);
const edited = addCivic(house, civicStamp(house, { x: 3, y: 7 }, { ...DEFAULT_EDITOR, civicKind: 'well' }));
assert.equal(edited.civic?.length, 1);
const player = placeChest(edited, { x: 3.5, y: 7.5, rotation: 0 });
const replanned = replanSettlement(player, quiet, generateSettlement({ ...settings, density: 1, publicSpaces: true }));
assert.ok(replanned.buildings?.find((b) => b === stamp));
assert.ok(replanned.civic?.some((p) => p.kind === 'well' && p.x === 3 && p.y === 7 && p.source === 'manual'));
assert.deepEqual(replanned.chests, player.chests);
assert.equal(eraseArea(edited, { x: 3, y: 7, w: 1, h: 1 }, 'civic').civic?.length, 0);
const copied = copyArea(edited, { x: 1, y: 1, w: 8, h: 8 });
const pasted = pasteArea(edited, copied, 18, 18);
assert.equal(pasted.civic?.length, 2);
assert.equal(pasted.buildings?.length, 2);
assert.equal(pasteArea(edited, copied, 18, 18, ['civic']).civic?.length, 1);
console.log('Layout: deterministic density, open doors, geometry, serialization, manual merge and clipboard passed.');