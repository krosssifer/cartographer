import { strict as assert } from 'node:assert';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import { CRYPT, CRYPT_GROUP_COUNTS, CRYPT_KINDS, CRYPT_PLACEMENT_LABEL } from '../src/lib/cryptKit';
import { moveObject, objectInfo, rotateObject } from '../src/lib/objectSizing';
import { contains } from '../src/lib/settlementKit';
import type { MapData } from '../src/lib/types';

// 1. Каталог: минимум по 20 предметов в каждой категории и осмысленное назначение.
for (const { group, count } of CRYPT_GROUP_COUNTS) {
  assert.ok(count >= 20, `${group}: всего ${count} предметов`);
}
assert.ok(CRYPT_KINDS.length >= 80);
for (const kind of CRYPT_KINDS) {
  assert.ok(CRYPT[kind].purpose.length > 10, `${kind}: нет назначения`);
  assert.ok(CRYPT_PLACEMENT_LABEL[CRYPT[kind].placement ?? 'any'], `${kind}: нет роли размещения`);
}
assert.ok(CRYPT_KINDS.every((kind) => CRYPT[kind].w >= 1 && CRYPT[kind].h >= 1));

// 2. Стены: между комнатами не должно быть двух рядов стены.
for (const [width, height] of [[10, 10], [26, 24], [44, 30], [100, 80]] as const) {
  for (const seed of [29, 1337, 42119]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width, height, seed });
    let doubles = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.cells[y][x].terrain !== 'wall') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (map.cells[ny][nx].terrain !== 'wall') continue;
        const a = map.cells[y - dy]?.[x - dx]?.terrain, b = map.cells[ny - dy]?.[nx - dx]?.terrain;
        if ((a === 'floor' || a === 'door') && (b === 'floor' || b === 'door')) { doubles++; break; }
      }
    }
    assert.equal(doubles, 0, `Двойные стены ${width}x${height}, seed ${seed}`);
  }
}

// 3. Расстановка по назначению: залы получают разные предметы, проходы остаются свободными.
const map = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width: 44, height: 30, seed: 1337, cryptDetail: .85 });
const rooms = map.cryptRooms!;
assert.ok(rooms.length >= 5);
const kinds = new Set((map.crypt ?? []).map((item) => item.kind));
assert.ok(kinds.size >= 30, `Всего ${kinds.size} разновидностей предметов`);
for (const room of rooms) {
  const inside = (map.crypt ?? []).filter((item) => item.x < room.x + room.w && item.x + item.w > room.x && item.y < room.y + room.h && item.y + item.h > room.y);
  assert.ok(inside.length > 0, `Зал ${room.theme} пуст`);
}

// 4. Перемещение и поворот на 180 градусов.
const free = (x: number, y: number) => map.cells[y]?.[x]?.terrain === 'floor'
  && !(map.crypt ?? []).some((item) => item !== map.crypt![0] && item.x <= x && item.x + item.w > x && item.y <= y && item.y + item.h > y);
let index = map.crypt!.findIndex((item) => free(item.x + item.w, item.y) && item.x + item.w < map.width - 1);
assert.ok(index >= 0, 'Нуж��н свободный предмет для проверки перемещения');
const target = { type: 'crypt', index } as const;
const before = map.crypt![index];
const moved = moveObject(map, target, 1, 0);
assert.equal(moved.error, undefined);
assert.equal(moved.map.crypt![index].x, before.x + 1);
assert.equal(moved.map.crypt![index].y, before.y);
const spun = rotateObject(map, target, 180);
assert.equal(spun.error, undefined);
assert.equal(spun.map.crypt![index].rotation, (before.rotation + 180) % 360);
const quarter = rotateObject(map, target, 90);
if (quarter.error) assert.ok(quarter.error.length > 0);
else {
  assert.equal(quarter.map.crypt![index].w, before.h);
  assert.equal(quarter.map.crypt![index].h, before.w);
}
const info = objectInfo(map, target);
assert.ok(info && contains(info.bounds, before.x + .5, before.y + .5));

// 5. Перемещение не должно залезать в стены или за край карты.
const edge = { type: 'crypt', index: 0 } as const;
const far = moveObject(map, edge, 0, -50);
assert.ok(far.error, 'Перемещение за пределы карты должно блокироваться');
let spot = { x: 0, y: 0 };
outer: for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 2; x++) {
  const clear = [0, 1, 2, 3].every((d) => map.cells[y][x + d]?.terrain === 'floor')
    && ![0, 1, 2, 3].some((d) => (map.crypt ?? []).some((item) => contains(item, x + d, y)));
  if (clear) { spot = { x, y }; break outer; }
}
const withChest: MapData = { ...map, chests: [{ x: spot.x + .5, y: spot.y + .5, rotation: 0 as const, kind: 'wooden' as const }] };
const chest = moveObject(withChest, { type: 'chest', index: 0 }, 2, 0);
assert.equal(chest.error, undefined);
assert.equal(chest.map.chests[0].x, spot.x + 2.5);
const tree = rotateObject({ ...map, trees: [{ x: 5, y: 5, r: .4, kind: 'oak', v: .2 }] }, { type: 'tree', index: 0 }, 180);
assert.ok(tree.error, 'Деревья не поворачиваются');
const chestSpin = rotateObject(withChest, { type: 'chest', index: 0 }, 180);
assert.equal(chestSpin.error, undefined);
assert.equal(chestSpin.map.chests[0].rotation, 180);
console.log('Settlement moves: catalogue sizes, single walls, themed placement, 1-cell move, 180 and 90 rotation passed.');
