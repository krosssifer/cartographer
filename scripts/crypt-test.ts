import { strict as assert } from 'node:assert';
import { addCryptObject, canPlaceCrypt, cryptRoomCapacity, cryptStamp, cryptWalkable, eraseCrypt, redecorateCrypt } from '../src/lib/cryptLayout';
import { CRYPT, CRYPT_KINDS, hazard, isSecret } from '../src/lib/cryptKit';
import { copyArea, eraseArea, pasteArea, paintCells } from '../src/lib/edits';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER, STARTER_CRYPT } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { contains } from '../src/lib/settlementKit';
import type { GenSettings, MapData, Point } from '../src/lib/types';

function connections(map: MapData) {
  const centres = (map.cryptRooms ?? []).map((r) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }));
  const visited = new Set<number>(), key = (x: number, y: number) => y * map.width + x;
  const queue = centres.slice(0, 1);
  if (queue[0]) visited.add(key(queue[0].x, queue[0].y));
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = queue[i].x + dx, y = queue[i].y + dy, id = key(x, y);
    if (visited.has(id) || !cryptWalkable(map, x, y)) continue;
    visited.add(id); queue.push({ x, y });
  }
  for (const p of centres) assert.ok(cryptWalkable(map, p.x, p.y) && visited.has(key(p.x, p.y)), `Room inaccessible (${p.x}, ${p.y})`);
}

const LIGHT_KINDS = new Set(['brazier', 'brazierStand', 'candleStand', 'candleHolder', 'oilLamp', 'candleWheel', 'graveCandle', 'incense']);
const HAZARD_THEMES = new Set(['sanctum', 'burial', 'ossuary', 'storage']);
const TRAP_KINDS = new Set(['pressureTile', 'spikeGlyph', 'runeTrap', 'fallSeal']);
function doorNear(map: MapData, room: { x: number; y: number; w: number; h: number }) {
  for (let x = room.x - 1; x <= room.x + room.w; x++) for (const y of [room.y - 1, room.y + room.h]) if (map.cells[y]?.[x]?.terrain === 'door') return true;
  for (let y = room.y - 1; y <= room.y + room.h; y++) for (const x of [room.x - 1, room.x + room.w]) if (map.cells[y]?.[x]?.terrain === 'door') return true;
  return false;
}
const themeAt = (map: MapData, x: number, y: number) => map.cryptRooms?.find((room) => contains(room, x, y))?.theme;
const signature = (map: MapData) => new Set((map.crypt ?? []).map((item) => `${item.kind}:${item.x}:${item.y}:${item.rotation}`));

assert.ok(CRYPT_KINDS.length >= 80, `Всего ${CRYPT_KINDS.length} предметов`);
for (const group of ['hazards', 'burial', 'relics', 'furnishings'] as const) {
  const count = CRYPT_KINDS.filter((kind) => CRYPT[kind].group === group).length;
  assert.ok(count >= 20, `${group}: только ${count} предметов`);
}
const seen = new Set();
for (const archetype of ['tomb', 'catacombs', 'temple', 'archive', 'prison'] as const)
for (const [width, height, rooms] of [[10, 10, 6], [10, 80, 14], [100, 10, 10], [26, 24, 9], [44, 30, 8], [100, 80, 14]]) {
  for (const seed of [7, 1337, 42119, 4200000000]) {
    const settings: GenSettings = { ...DEFAULT_GEN, width, height, rooms, seed, biome: 'dungeon', cryptDetail: 1, waterLevel: .7, cryptArchetype: archetype };
    const map = generateMap(settings);
    assert.ok(map.cryptRooms?.length);
    for (const item of map.crypt ?? []) {
      seen.add(item.kind);
      const mounted = CRYPT[item.kind].placement === 'wallFace';
      for (let y = item.y; y < item.y + item.h; y++) for (let x = item.x; x < item.x + item.w; x++) assert.equal(map.cells[y]?.[x]?.terrain, mounted ? 'wall' : 'floor');
      if (CRYPT[item.kind].secret) assert.ok(isSecret(item));
    }
    const wet = map.cells.flatMap((row, y) => row.map((cell, x) => ({ cell, x, y }))).find(({ cell }) => cell.terrain === 'water');
    if (wet) assert.ok(cryptWalkable(map, wet.x, wet.y), 'Лужа должна быть проходимой');
    connections(map);
    assert.deepEqual(map, generateMap(settings));
    assert.equal(map.cryptRooms?.length, Math.min(rooms, cryptRoomCapacity(width, height)), `Число залов ${width}×${height}, запрошено ${rooms}`);
    for (const room of map.cryptRooms ?? []) {
      if ((map.cryptRooms?.length ?? 0) > 1) assert.ok(doorNear(map, room), `Зал без двери: ${room.theme} @${room.x},${room.y}`);
      assert.ok((map.crypt ?? []).some((item) => contains(room, item.x, item.y) && LIGHT_KINDS.has(item.kind)), `Зал без света: ${room.theme}`);
    }
    for (const item of map.crypt ?? []) {
      if (hazard(item.kind)) assert.ok(HAZARD_THEMES.has(themeAt(map, item.x, item.y) ?? 'burial'), `Опасность в неподходящем зале: ${item.kind} @${item.x},${item.y}`);
      if (TRAP_KINDS.has(item.kind)) assert.ok(!map.cryptRooms?.some((room) => contains(room, item.x, item.y)), `Ловушка внутри зала @${item.x},${item.y}`);
    }
    const empty = generateMap({ ...settings, cryptDetail: 0, cryptTraps: false, cryptChasms: false });
    assert.ok((empty.crypt?.length ?? 0) >= (empty.cryptRooms?.length ?? 0), 'Базовый набор отсутствует при детализации 0');
    assert.deepEqual(empty.cells, map.cells);
    assert.deepEqual(empty.cryptRooms, map.cryptRooms);
    assert.deepEqual(parseProject(JSON.parse(JSON.stringify({ version: 1, gen: settings, render: DEFAULT_RENDER, map })))?.map, JSON.parse(JSON.stringify(map)));
  }
}
assert.ok(seen.size >= 26);
const starter = generateMap(STARTER_CRYPT);
assert.ok(starter.crypt!.some(({ kind }) => kind === 'chasm'));
assert.ok(starter.crypt!.some(({ kind }) => kind === 'skeleton'));
assert.ok(starter.crypt!.some(({ kind }) => kind === 'altar'));
assert.ok(starter.cryptRooms!.some(({ theme }) => theme === 'archive'));
assert.ok(starter.crypt!.some(({ kind }) => kind === 'bookcase'));
assert.ok(starter.crypt!.some(isSecret));
assert.equal(new Set(starter.cryptRooms!.map(({ theme }) => theme)).size, starter.cryptRooms!.length, 'Темы залов должны различаться');
const sanctum = starter.cryptRooms!.find(({ theme }) => theme === 'sanctum')!;
const sanctumProps = starter.crypt!.filter((item) => contains(sanctum, item.x, item.y));
assert.ok(sanctumProps.filter(({ kind }) => kind === 'altar' || kind === 'candleStand' || kind === 'brazier').length >= 2, 'Сцена святилища не собралась');
const wallProps = starter.crypt!.filter((item) => CRYPT[item.kind].placement === 'wallFace');
assert.ok(wallProps.length > 0, 'Нет настенных украшений');
for (const item of wallProps) assert.equal(starter.cells[item.y][item.x].terrain, 'wall');
const archetypeMap = (cryptArchetype: GenSettings['cryptArchetype']) => generateMap({ ...STARTER_CRYPT, width: 44, height: 30, rooms: 8, cryptArchetype }).cryptRooms!;
const templeRooms = archetypeMap('temple');
assert.ok(templeRooms.some((room) => room.w >= 12 && room.h >= 9), 'В храме нет большого зала');
assert.ok(templeRooms.filter((room) => room.w <= 8 && room.h <= 7).length >= 4, 'В храме нет приделов');
const archiveRooms = archetypeMap('archive');
assert.ok(archiveRooms.filter((room) => room.h <= 5 && room.w >= 8).length >= 4, 'В архиве нет длинных залов');
const prisonRooms = archetypeMap('prison');
assert.ok(prisonRooms.filter((room) => room.w <= 5 && room.h <= 5).length >= 4, 'В тюрьме нет камер');
assert.ok(prisonRooms.some((room) => room.w >= 7 && room.h >= 6), 'В тюрьме нет поста стражи');
const catacombRooms = archetypeMap('catacombs');
assert.ok(catacombRooms.filter((room) => room.w * room.h <= 36).length >= 3, 'Катакомбы без мелких камер');
assert.ok(archetypeMap('tomb').some((room) => room.w >= 12 && room.h >= 9), 'В усыпальнице нет центрального зала');
const legacyGen: Record<string, unknown> = { ...STARTER_CRYPT };
delete legacyGen.cryptArchetype;
assert.equal(parseProject({ version: 1, gen: legacyGen, render: DEFAULT_RENDER, map: null })?.gen.cryptArchetype, 'tomb', 'Старый проект без архетипа должен читаться как усыпальница');
const sparse = signature(generateMap({ ...STARTER_CRYPT, seed: 1337, cryptDetail: .4 }));
const richer = signature(generateMap({ ...STARTER_CRYPT, seed: 1337, cryptDetail: .7 }));
for (const item of sparse) assert.ok(richer.has(item), `Детализация переставляет предмет ${item}`);
const blank = generateMap({ ...STARTER_CRYPT, cryptDetail: 0, cryptTraps: false, cryptChasms: false });
assert.ok((blank.crypt?.length ?? 0) > 0, 'При детализации 0 остаётся базовый набор');
const bare: MapData = { ...blank, crypt: [] };
const first = bare.cryptRooms![0];
const p: Point = { x: first.x + 1, y: first.y + 1 };
const plate = cryptStamp(p, 'pressureTile', 90, true);
const edit = addCryptObject(bare, plate);
assert.equal(edit.crypt?.length, 1);
assert.ok(!canPlaceCrypt(edit, plate));
assert.equal(eraseCrypt(edit, { ...p, w: 1, h: 1 }, false), edit);
assert.equal(eraseArea(edit, { ...p, w: 1, h: 1 }, 'crypt').crypt?.length, 0);
const clipboard = copyArea(edit, { ...p, w: 1, h: 1 });
const pasted = pasteArea(edit, clipboard, p.x + 1, p.y);
assert.equal(pasted.crypt?.length, 2);
assert.equal(pasteArea(edit, clipboard, p.x + 1, p.y, ['crypt']).crypt?.length, 1);
assert.equal(paintCells(edit, { ...p, w: 1, h: 1 }, 'wall').crypt?.length, 0);
let wallCell: Point | undefined;
for (let y = 1; y < bare.height - 1 && !wallCell; y++) for (let x = 1; x < bare.width - 1 && !wallCell; x++) if (bare.cells[y][x].terrain === 'wall') wallCell = { x, y };
assert.ok(wallCell, 'На карте нет стены для настенного предмета');
const banner = cryptStamp(wallCell!, 'banner', 0, false);
assert.ok(canPlaceCrypt(bare, banner), 'Знамя должно ставиться на стену');
const hung = addCryptObject(bare, banner);
assert.equal(hung.crypt?.length, 1);
assert.ok(!canPlaceCrypt(bare, cryptStamp(p, 'banner', 0, false)), 'На полу настенный предмет не ставится');
assert.equal(paintCells(hung, { ...wallCell!, w: 1, h: 1 }, 'floor').crypt?.length, 0, 'Настенный предмет снимается вместе со стеной');
const renewed = redecorateCrypt(edit, STARTER_CRYPT);
assert.ok(renewed.crypt?.includes(plate));
const pit = bare.cryptRooms!.find((r) => r.w >= 4 && r.h >= 3)!;
const hole = cryptStamp({ x: pit.x + 1, y: pit.y + 1 }, 'chasm', 0, false);
const abyss = addCryptObject(bare, hole);
assert.ok(!cryptWalkable(abyss, hole.x, hole.y));
const bridge = cryptStamp({ x: hole.x + 1, y: hole.y }, 'bridge', 90, false);
const crossed = addCryptObject(abyss, bridge);
assert.ok(cryptWalkable(crossed, bridge.x, bridge.y));
assert.ok(crossed.crypt?.some((k) => contains(k, hole.x, hole.y) && hazard(k.kind)));
console.log(`${seen.size} auto-placed object types; seeded geometry, clear corridors, regeneration, secret markers, clipboard and JSON passed.`);