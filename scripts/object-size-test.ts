import { strict as assert } from 'node:assert';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { DEFAULT_EDITOR } from '../src/lib/settlementKit';
import { addCryptObject, cryptStamp } from '../src/lib/cryptLayout';
import { canPlaceChest, chestBounds } from '../src/lib/chests';
import { copyArea, pasteArea, placeChest } from '../src/lib/edits';
import { objectAt, objectInfo, resizeObject } from '../src/lib/objectSizing';
import { canPlaceBuilding, civicStamp } from '../src/lib/settlementEdits';
import { furnitureBounds } from '../src/lib/furnitureKit';
import { parseProject } from '../src/lib/project';
import { doorAxis, doorStyle } from '../src/lib/doors';
import type { Biome, Building, MapData } from '../src/lib/types';

const plain: MapData = { width: 36, height: 26, biome: 'dungeon', cells: Array.from({ length: 26 }, () => Array.from({ length: 36 }, () => ({ terrain: 'floor', height: .5, moisture: .5 }))), chests: [], rocks: [], trees: [], structures: [], river: [], road: [] };
let map = addCryptObject(plain, cryptStamp({ x: 4, y: 4 }, 'coffin', 90, false));
const resized = resizeObject(map, { type: 'crypt', index: 0 }, { w: 2.6, h: 1.35 });
assert.equal(resized.error, undefined);
map = resized.map;
assert.deepEqual([map.crypt![0].w, map.crypt![0].h], [1.35, 2.6]);
assert.equal(objectAt(map, { x: 4.8, y: 5 }, DEFAULT_RENDER)?.type, 'crypt');
assert.deepEqual(objectInfo(map, { type: 'crypt', index: 0 })?.size, { w: 2.6, h: 1.35 });
assert.ok(resizeObject(map, { type: 'crypt', index: 0 }, { w: 21, h: 1 }).error);
assert.ok(resizeObject(map, { type: 'crypt', index: 0 }, { w: -.3, h: 1 }).error);

for (const [index, kind] of (['wooden', 'stone', 'ornate'] as const).entries()) {
  const chest = { x: 6.5 + index * 4, y: 14.5, rotation: 90 as const, kind, size: { w: 2.4, h: 1.1 } };
  assert.ok(canPlaceChest(map, chest));
  map = placeChest(map, chest);
  const bounds = chestBounds(chest);
  assert.deepEqual([bounds.w, bounds.h], [1.1, 2.4]);
}
assert.ok(resizeObject(map, { type: 'chest', index: 0 }, { w: 8, h: 9 }).error);
const changedKind = resizeObject(map, { type: 'chest', index: 0 }, { w: 2.1, h: .9 }, 'ornate');
assert.equal(changedKind.map.chests[0].kind, 'ornate');
const fragment = copyArea(map, { x: 5, y: 12, w: 13, h: 5 });
assert.equal(pasteArea(map, fragment, 5, 19).chests.length, 6);

const civic = civicStamp(map, { x: 20, y: 10 }, { ...DEFAULT_EDITOR, tool: 'civic', civicKind: 'well', objectSizes: { 'civic:well:0': { w: 1.25, h: .75 } } });
assert.deepEqual([civic.w, civic.h], [1.25, .75]);
map = { ...map, civic: [civic] };
assert.equal(resizeObject(map, { type: 'civic', index: 0 }, { w: 3.3, h: 1.7 }).error, undefined);

const house: Building = { x: 20, y: 2, w: 7, h: 6, kind: 'house', style: 'town', roof: 2, facing: 0, source: 'manual', door: { x: 23, y: 7 }, furniture: [] };
assert.ok(canPlaceBuilding(map, house));
map = { ...map, buildings: [house] };
const furnishing = { x: 4.5, y: 4.2, kind: 'chair' as const, rotation: 90 as const, size: { w: .5, h: .45 } };
map = { ...map, buildings: [{ ...house, furniture: [furnishing] }] };
const seat = resizeObject(map, { type: 'furniture', building: 0, index: 0 }, { w: .63, h: .46 });
assert.equal(seat.error, undefined);
assert.deepEqual([furnitureBounds(seat.map.buildings![0].furniture![0]).w, furnitureBounds(seat.map.buildings![0].furniture![0]).h], [.46, .63]);
const widerHouse = resizeObject({ ...map, buildings: [house] }, { type: 'building', index: 0 }, { w: 8, h: 7 });
assert.equal(widerHouse.error, undefined);
assert.deepEqual([widerHouse.map.buildings![0].w, widerHouse.map.buildings![0].h], [8, 7]);
const grove = { ...map, trees: [{ x: 9, y: 4, r: .5, kind: 'oak' as const, v: .3 }], rocks: [{ x: 12, y: 4, r: .3, v: .5, pts: [[-.2, -.1], [.3, -.1], [.1, .3]] as [number, number][] }] };
const tallerTree = resizeObject(grove, { type: 'tree', index: 0 }, { w: 2, h: 3 });
assert.deepEqual(tallerTree.map.trees[0].size, { w: 2, h: 3 });
assert.equal(objectAt(tallerTree.map, { x: 9, y: 5.3 }, DEFAULT_RENDER)?.type, 'tree');
const wideRock = resizeObject(grove, { type: 'rock', index: 0 }, { w: 2, h: .5 });
assert.deepEqual(wideRock.map.rocks[0].size, { w: 2, h: .5 });
assert.ok(resizeObject(grove, { type: 'tree', index: 0 }, { w: 20, h: 20 }).error);
const gen = { ...DEFAULT_GEN, width: map.width, height: map.height, biome: map.biome };
const data = { version: 1, gen, map: seat.map, render: DEFAULT_RENDER, editor: { ...DEFAULT_EDITOR, chestKind: 'ornate', objectSizes: { 'crypt:coffin': { w: 2.6, h: 1.35 } } } };
assert.deepEqual(parseProject(JSON.parse(JSON.stringify(data)))?.map, JSON.parse(JSON.stringify(seat.map)));
const invalid = JSON.parse(JSON.stringify(data)); invalid.map.chests[0].size.h = 0;
assert.equal(parseProject(invalid), null);

const styles = new Set();
for (const biome of ['forest', 'plains', 'swamp', 'desert', 'snow', 'cave', 'dungeon', 'town', 'village'] as Biome[]) {
  for (let n = 0; n < 12; n++) styles.add(doorStyle(biome, n, n + 7, 1337));
}
assert.equal(styles.size, 9);
plain.cells[5][4].terrain = 'wall'; plain.cells[5][6].terrain = 'wall'; plain.cells[5][5].terrain = 'door';
assert.equal(doorAxis(plain, 5, 5), 'horizontal');
plain.cells[5][4].terrain = 'floor'; plain.cells[5][6].terrain = 'floor'; plain.cells[4][5].terrain = 'wall'; plain.cells[6][5].terrain = 'wall';
assert.equal(doorAxis(plain, 5, 5), 'vertical');
console.log('Object dimensions: fractional sizes, rotation, picking, collision, three chests, JSON, clipboard and nine door finishes passed.');