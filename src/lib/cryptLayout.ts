import { CRYPT, coversHazard, hazard } from './cryptKit';
import { hash2, mulberry32, randInt } from './random';
import { contains, intersects } from './settlementKit';
import { footprintCells, rectOnGrid, rotatedSize } from './objectGeometry';
import type { ChestRotation, CryptArchetype, CryptKind, CryptObject, CryptRoom, CryptTheme, GenSettings, MapData, ObjectDimensions, Point, Selection, Structure } from './types';

const ADJACENT = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const ROTATIONS: ChestRotation[] = [0, 90, 180, 270];
const size = (room: Selection) => room.w * room.h;
const midpoint = (r: Selection) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
const isFloor = (m: MapData, x: number, y: number) => m.cells[y]?.[x]?.terrain === 'floor';
// Пол, двери и неглубокие лужи проходимы: вода в склепе не разрезает зал.
const open = (m: MapData, x: number, y: number) => {
  const terrain = m.cells[y]?.[x]?.terrain;
  return terrain === 'floor' || terrain === 'door' || terrain === 'water';
};

/** Стабильный сид из нескольких чисел: не зависит от состояния карты и порядка расстановки. */
function mixSeed(...parts: number[]): number {
  let hash = 2166136261;
  for (const value of parts) {
    const v = value | 0;
    for (let i = 0; i < 4; i++) { hash ^= (v >>> (i * 8)) & 255; hash = Math.imul(hash, 16777619); }
  }
  return hash >>> 0;
}
const rngFor = (...parts: number[]) => mulberry32(mixSeed(...parts));

const ROOM_PITCH = 5;

/**
 * Сколько залов физически помещается на карте: комнаты не меньше 4×4
 * плюс обязательный зазор в одну клетку между ними.
 */
export function cryptRoomCapacity(width: number, height: number): number {
  const columns = Math.max(1, Math.floor((width - 3) / ROOM_PITCH));
  const rows = Math.max(1, Math.floor((height - 3) / ROOM_PITCH));
  return columns * rows;
}

/** Запасная раскладка сеткой: нужна, когда BSP не нарезал запрошенное число залов. */
function packBlueprint(settings: GenSettings, target: number): Structure[] {
  const { width, height, seed } = settings;
  const innerW = width - 4, innerH = height - 4;
  const rng = mulberry32(seed + 59117);
  let best: { columns: number; rows: number; cellW: number; cellH: number; score: number } | undefined;
  for (let columns = 1; columns <= target; columns++) {
    const rows = Math.ceil(target / columns);
    const cellW = Math.floor((innerW - (columns - 1)) / columns);
    const cellH = Math.floor((innerH - (rows - 1)) / rows);
    if (cellW < 4 || cellH < 4) continue;
    const score = Math.abs(cellW / cellH - 1.6) + (columns * rows - target) * .08;
    if (!best || score < best.score) best = { columns, rows, cellW, cellH, score };
  }
  if (!best) return [{ x: 2, y: 2, w: Math.max(4, innerW), h: Math.max(4, innerH), ruin: settings.ruined }];
  const { columns, rows, cellW, cellH } = best;
  const rooms: Structure[] = [];
  for (let index = 0; index < target; index++) {
    const column = index % columns, row = Math.floor(index / columns);
    if (row >= rows) break;
    const w = randInt(rng, 4, Math.min(10, cellW));
    const h = randInt(rng, 4, Math.min(9, cellH));
    const x = 2 + column * (cellW + 1) + randInt(rng, 0, cellW - w);
    const y = 2 + row * (cellH + 1) + randInt(rng, 0, cellH - h);
    rooms.push({ x, y, w, h, ruin: settings.ruined });
  }
  return rooms;
}

interface LayoutBuilder {
  rooms: Structure[];
  add: (x: number, y: number, w: number, h: number) => boolean;
  fill: (count: number) => void;
}

/** Сборщик залов: следит за границами и зазором в клетку между комнатами. */
function layoutBuilder(settings: GenSettings): LayoutBuilder {
  const { width, height } = settings;
  const rooms: Structure[] = [];
  const fits = (x: number, y: number, w: number, h: number) => x >= 2 && y >= 2 && x + w <= width - 2 && y + h <= height - 2
    && rooms.every((room) => x >= room.x + room.w + 1 || x + w + 1 <= room.x || y >= room.y + room.h + 1 || y + h + 1 <= room.y);
  const add = (x: number, y: number, w: number, h: number) => {
    if (!fits(x, y, w, h)) return false;
    rooms.push({ x, y, w, h, ruin: settings.ruined });
    return true;
  };
  const fill = (count: number) => {
    for (let y = 2; y + 4 <= height - 2 && rooms.length < count; y += 2) {
      for (let x = 2; x + 4 <= width - 2 && rooms.length < count; x += 2) {
        if (add(x, y, 6, 5)) continue;
        if (add(x, y, 5, 4)) continue;
        add(x, y, 4, 4);
      }
    }
    for (let y = 2; y + 4 <= height - 2 && rooms.length < count; y++) {
      for (let x = 2; x + 4 <= width - 2 && rooms.length < count; x++) add(x, y, 4, 4);
    }
  };
  return { rooms, add, fill };
}

/** Добивает число залов и в крайнем случае отдаёт сетку. */
function finishLayout(builder: LayoutBuilder, settings: GenSettings, count: number): Structure[] {
  builder.fill(count);
  return builder.rooms.length >= count ? builder.rooms.slice(0, count) : packBlueprint(settings, count);
}

function tombBlueprint(settings: GenSettings, count: number): Structure[] {
  const { width, height, seed } = settings;
  const rng = mulberry32(seed + 39113);
  const plots: Selection[] = [], rooms: Structure[] = [];
  const space = (x: number, y: number, w: number, h: number) => { if (w >= 4 && h >= 4) plots.push({ x, y, w, h }); };
  if (width >= 29 && height >= 23 && count >= 5) {
    const w = Math.min(17, Math.floor(width * .31)), h = Math.min(12, Math.floor(height * .36));
    const x = Math.floor((width - w) / 2) + randInt(rng, -1, 1), y = Math.floor((height - h) / 2) + randInt(rng, -1, 1);
    rooms.push({ x, y, w, h, ruin: settings.ruined });
    space(2, 2, x - 4, height - 4);
    space(x + w + 2, 2, width - x - w - 4, height - 4);
    space(x, 2, w, y - 4);
    space(x, y + h + 2, w, height - y - h - 4);
  } else {
    space(2, 2, width - 4, height - 4);
  }
  while (plots.length + rooms.length < count) {
    const options = plots.filter((p) => p.w >= 9 || p.h >= 9).sort((a, b) => size(b) - size(a));
    if (!options.length) break;
    const slot = options[0];
    plots.splice(plots.indexOf(slot), 1);
    if (slot.w >= 9 && (slot.h < 9 || slot.w > slot.h * (.85 + rng() * .3))) {
      const pivot = Math.min(slot.w - 5, Math.max(4, Math.round(slot.w * (.39 + rng() * .20))));
      space(slot.x, slot.y, pivot, slot.h);
      space(slot.x + pivot + 1, slot.y, slot.w - pivot - 1, slot.h);
    } else {
      const pivot = Math.min(slot.h - 5, Math.max(4, Math.round(slot.h * (.39 + rng() * .20))));
      space(slot.x, slot.y, slot.w, pivot);
      space(slot.x, slot.y + pivot + 1, slot.w, slot.h - pivot - 1);
    }
  }
  for (const p of plots.slice(0, count - rooms.length)) {
    const w = Math.min(p.w, randInt(rng, 7, 10)), h = Math.min(p.h, randInt(rng, 6, 9));
    const x = p.x + randInt(rng, 0, p.w - w), y = p.y + randInt(rng, 0, p.h - h);
    rooms.push({ x, y, w, h, ruin: settings.ruined });
  }
  if (rooms.length < count) return packBlueprint(settings, count);
  return rooms.slice(0, count);
}

/** Храм: большой центральный зал и симметричные приделы вокруг. */
function templeBlueprint(settings: GenSettings, count: number): Structure[] {
  const builder = layoutBuilder(settings);
  const { width, height } = settings;
  const hallW = Math.min(18, Math.max(9, Math.round(width * .34)));
  const hallH = Math.min(13, Math.max(7, Math.round(height * .42)));
  const hx = Math.floor((width - hallW) / 2), hy = Math.floor((height - hallH) / 2);
  builder.add(hx, hy, hallW, hallH);
  const chapels: [number, number, number, number][] = [
    [hx - 9, hy + 1, 7, 6], [hx + hallW + 2, hy + 1, 7, 6],
    [hx - 9, hy + hallH - 7, 7, 6], [hx + hallW + 2, hy + hallH - 7, 7, 6],
    [hx + 1, hy - 8, 6, 5], [hx + hallW - 7, hy - 8, 6, 5],
    [hx + 1, hy + hallH + 2, 6, 5], [hx + hallW - 7, hy + hallH + 2, 6, 5],
  ];
  for (const [x, y, w, h] of chapels) {
    if (builder.rooms.length >= count) break;
    builder.add(x, y, w, h);
  }
  return finishLayout(builder, settings, count);
}

/** Архив: два ряда длинных узких хранилищ вдоль центрального прохода. */
function archiveBlueprint(settings: GenSettings, count: number): Structure[] {
  const builder = layoutBuilder(settings);
  const { width, height } = settings;
  const rng = mulberry32(settings.seed + 33127);
  const topY = 3, bottomH = 5, bottomY = height - 3 - bottomH;
  let x = 3;
  while (builder.rooms.length < count && x + 6 <= width - 2) {
    const w = Math.min(width - 2 - x, randInt(rng, 9, 15));
    builder.add(x, topY, w, randInt(rng, 4, 5));
    if (builder.rooms.length < count) builder.add(x, bottomY, w, bottomH);
    x += w + 2;
  }
  return finishLayout(builder, settings, count);
}

/** Тюрьма: камеры в два ряда и пост стражи в центре. */
function prisonBlueprint(settings: GenSettings, count: number): Structure[] {
  const builder = layoutBuilder(settings);
  const { width, height } = settings;
  const cell = 4, topY = 3, bottomY = height - 3 - cell;
  if (count > 2) builder.add(3, Math.floor((height - 7) / 2), 8, 7);
  let x = count > 2 ? 13 : 3;
  while (builder.rooms.length < count && x + cell <= width - 2) {
    builder.add(x, topY, cell, cell);
    if (builder.rooms.length < count) builder.add(x, bottomY, cell, cell);
    x += cell + 1;
  }
  return finishLayout(builder, settings, count);
}

/** Катакомбы: колонны небольших погребальных камер без центрального зала. */
function catacombsBlueprint(settings: GenSettings, count: number): Structure[] {
  const builder = layoutBuilder(settings);
  const { width, height } = settings;
  const rng = mulberry32(settings.seed + 61511);
  const rowsPerColumn = Math.max(1, Math.floor((height - 4) / 5));
  const columns = Math.max(1, Math.ceil(count / rowsPerColumn));
  const step = Math.max(8, Math.floor((width - 4) / columns));
  for (let column = 0; column < columns && builder.rooms.length < count; column++) {
    const x = 3 + column * step;
    if (x + 4 > width - 2) break;
    let y = 3;
    for (let row = 0; row < rowsPerColumn && builder.rooms.length < count; row++) {
      if (y + 4 > height - 2) break;
      const w = randInt(rng, 4, Math.min(7, width - 2 - x));
      const h = randInt(rng, 4, Math.min(6, height - 2 - y));
      if (builder.add(x, y, w, h)) y += h + 1;
      else y += 2;
    }
  }
  return finishLayout(builder, settings, count);
}

export function cryptBlueprint(settings: GenSettings): Structure[] {
  const count = Math.max(1, Math.min(settings.rooms, cryptRoomCapacity(settings.width, settings.height)));
  switch (settings.cryptArchetype ?? 'tomb') {
    case 'catacombs': return catacombsBlueprint(settings, count);
    case 'temple': return templeBlueprint(settings, count);
    case 'archive': return archiveBlueprint(settings, count);
    case 'prison': return prisonBlueprint(settings, count);
    default: return tombBlueprint(settings, count);
  }
}

export function cryptStamp(point: Point, kind: CryptKind, rotation: ChestRotation, hidden: boolean, variant = 0, dimensions?: ObjectDimensions): CryptObject {
  const spec = CRYPT[kind];
  const { w, h } = rotatedSize(dimensions ?? spec, rotation);
  return { kind, ...rectOnGrid(point, { w, h }), rotation, variant, source: 'manual', hidden: spec.secret ? hidden : undefined };
}

function hazardOn(map: MapData, area: Selection) {
  return (map.crypt ?? []).some((p) => hazard(p.kind) && intersects(p, area));
}

export function canPlaceCrypt(map: MapData, item: CryptObject) {
  if (item.x < 0 || item.y < 0 || item.x + item.w > map.width || item.y + item.h > map.height) return false;
  const spec = CRYPT[item.kind];
  const props = map.crypt ?? [];
  if (spec.placement === 'wallFace') {
    if (!footprintCells(item, (x, y) => map.cells[y]?.[x]?.terrain === 'wall')) return false;
    return !props.some((other) => intersects(other, item));
  }
  if (!footprintCells(item, (x, y) => isFloor(map, x, y))) return false;
  if (coversHazard(item.kind) && !hazardOn(map, item)) return false;
  if (props.some((other) => {
    if (!intersects(other, item)) return false;
    if (coversHazard(item.kind) && hazard(other.kind) || coversHazard(other.kind) && hazard(item.kind)) return false;
    if (hazard(item.kind) || hazard(other.kind) || coversHazard(item.kind) || coversHazard(other.kind)) return true;
    const a = CRYPT[item.kind], b = CRYPT[other.kind];
    return !a.flat && !b.flat || (a.flat && b.flat && !a.secret && !b.secret) || a.secret && b.secret;
  })) return false;
  if ((CRYPT[item.kind].blocks || !CRYPT[item.kind].flat) && map.chests.some((c) => contains(item, c.x, c.y))) return false;
  return !(map.buildings ?? []).some((b) => intersects(b, item));
}

export function addCryptObject(map: MapData, item: CryptObject): MapData {
  if ((map.crypt?.length ?? 0) >= Math.min(map.width * map.height * 2, 4000) || !canPlaceCrypt(map, item)) return map;
  const objects = map.crypt ?? [];
  const supports = item.source === 'manual' && coversHazard(item.kind);
  const crypt = supports ? objects.map((p) => hazard(p.kind) && intersects(p, item) ? { ...p, source: 'manual' as const } : p) : objects;
  return { ...map, crypt: [...crypt, item] };
}

export function cryptWalkable(map: MapData, x: number, y: number) {
  if (!open(map, x, y)) return false;
  const area = { x, y, w: 1, h: 1 };
  const props = (map.crypt ?? []).filter((item) => intersects(item, area));
  const surface = props.some((item) => coversHazard(item.kind));
  return !props.some((item) => CRYPT[item.kind].blocks && (!hazard(item.kind) || !surface));
}

export function eraseCrypt(map: MapData, area: Selection, showSecrets = true): MapData {
  const all = map.crypt ?? [];
  const targets = all.filter((item) => intersects(item, area) && (showSecrets || !item.hidden));
  if (!targets.length) return map;
  const last = targets[targets.length - 1];
  const remaining = all.filter((item) => area.w === 1 && area.h === 1 ? item !== last : !targets.includes(item));
  return { ...map, crypt: remaining.filter((item) => !coversHazard(item.kind) || remaining.some((pit) => hazard(pit.kind) && intersects(pit, item))) };
}

/**
 * Каждый зал получает предметы по назначению: вход обозначается колоннами и жаровнями,
 * усыпальница заполняется саркофагами и урнами, кладовая — тарой и инструментом,
 * пост стражи — оружием и очагами. Вес задаёт частоту появления.
 */
type Slot = { kind: CryptKind; weight: number };
const SETS: Record<CryptTheme, Slot[]> = {
  entry: [
    { kind: 'steps', weight: 1 }, { kind: 'pillar', weight: 3 }, { kind: 'mournerStatue', weight: 2 }, { kind: 'brazierStand', weight: 3 },
    { kind: 'candleHolder', weight: 3 }, { kind: 'toolRack', weight: 2 }, { kind: 'cage', weight: 1 }, { kind: 'pillory', weight: 1 },
    { kind: 'manacles', weight: 2 }, { kind: 'chains', weight: 2 }, { kind: 'bench', weight: 2 }, { kind: 'rubble', weight: 2 },
    { kind: 'web', weight: 2 }, { kind: 'brazier', weight: 2 }, { kind: 'signalHorn', weight: 1 }, { kind: 'oilLamp', weight: 2 },
    { kind: 'pebbles', weight: 2 }, { kind: 'mossGrass', weight: 1 }, { kind: 'puddleMud', weight: 1 }, { kind: 'lichen', weight: 1 }, { kind: 'roots', weight: 1 },
    { kind: 'pressurePlate', weight: 1 }, { kind: 'lever', weight: 1 }, { kind: 'doorWood', weight: 1 },
  ],
  burial: [
    { kind: 'coffin', weight: 4 }, { kind: 'openCoffin', weight: 2 }, { kind: 'graveStone', weight: 3 }, { kind: 'nameTomb', weight: 2 },
    { kind: 'tomb', weight: 2 }, { kind: 'mausoleum', weight: 1 }, { kind: 'urns', weight: 3 }, { kind: 'burialUrn', weight: 2 },
    { kind: 'skeleton', weight: 3 }, { kind: 'bones', weight: 3 }, { kind: 'graveCandle', weight: 3 }, { kind: 'wreath', weight: 2 },
    { kind: 'cryptPodium', weight: 1 }, { kind: 'burialNiche', weight: 2 }, { kind: 'catacombArch', weight: 1 }, { kind: 'ossuaryShelf', weight: 1 },
    { kind: 'sarcophagusLid', weight: 1 }, { kind: 'coffinLid', weight: 1 }, { kind: 'graveDirt', weight: 2 }, { kind: 'candleWheel', weight: 1 },
    { kind: 'dirtPatch', weight: 2 }, { kind: 'skeletonBones', weight: 2 }, { kind: 'roots', weight: 1 }, { kind: 'nestEggs', weight: 1 }, { kind: 'cracks', weight: 1 },
    { kind: 'pedestalStatue', weight: 1 }, { kind: 'crackedPlate', weight: 1 },
  ],
  sanctum: [
    { kind: 'altar', weight: 3 }, { kind: 'idol', weight: 2 }, { kind: 'obelisk', weight: 2 }, { kind: 'runeCircle', weight: 2 },
    { kind: 'pedestal', weight: 3 }, { kind: 'brazier', weight: 3 }, { kind: 'candleStand', weight: 3 }, { kind: 'incense', weight: 2 },
    { kind: 'rug', weight: 2 }, { kind: 'shrine', weight: 1 }, { kind: 'offeringBowl', weight: 2 }, { kind: 'crystalCluster', weight: 1 },
    { kind: 'glowingMushroom', weight: 1 }, { kind: 'statue', weight: 2 }, { kind: 'ancientSigil', weight: 1 }, { kind: 'boneCharm', weight: 1 },
    { kind: 'lectern', weight: 2 }, { kind: 'candleHolder', weight: 2 }, { kind: 'templeMask', weight: 1 }, { kind: 'stoneEye', weight: 1 },
    { kind: 'crystals', weight: 2 }, { kind: 'mushroomsGlow', weight: 2 }, { kind: 'mossPatch', weight: 1 }, { kind: 'puddleBlue', weight: 1 }, { kind: 'lichen', weight: 1 }, { kind: 'stalagmites', weight: 1 },
    { kind: 'runeCircleBlue', weight: 1 }, { kind: 'pedestalStatue', weight: 1 }, { kind: 'orbRed', weight: 1 },
  ],
  ossuary: [
    { kind: 'bonePile', weight: 4 }, { kind: 'skeletonPile', weight: 3 }, { kind: 'skull', weight: 3 }, { kind: 'ribcage', weight: 3 },
    { kind: 'pelvis', weight: 2 }, { kind: 'spine', weight: 2 }, { kind: 'femurs', weight: 2 }, { kind: 'jaw', weight: 2 },
    { kind: 'ossuaryShelf', weight: 2 }, { kind: 'catacombArch', weight: 1 }, { kind: 'urns', weight: 2 }, { kind: 'openCoffin', weight: 1 },
    { kind: 'corpse', weight: 1 }, { kind: 'wrappedBody', weight: 1 }, { kind: 'rubble', weight: 2 },
    { kind: 'web', weight: 2 }, { kind: 'boneSnare', weight: 1 }, { kind: 'graveCandle', weight: 1 }, { kind: 'wreath', weight: 1 },
    { kind: 'skeletonBones', weight: 3 }, { kind: 'nestEggs', weight: 2 }, { kind: 'dirtPatch', weight: 2 }, { kind: 'roots', weight: 1 }, { kind: 'cracks', weight: 1 },
    { kind: 'crackedPlate', weight: 1 }, { kind: 'pressurePlate', weight: 1 },
  ],
  archive: [
    { kind: 'bookcase', weight: 4 }, { kind: 'scrollRack', weight: 3 }, { kind: 'writingDesk', weight: 3 }, { kind: 'ledger', weight: 2 },
    { kind: 'mapTable', weight: 2 }, { kind: 'lectern', weight: 2 }, { kind: 'telescope', weight: 1 }, { kind: 'astrolabe', weight: 2 },
    { kind: 'orrery', weight: 1 }, { kind: 'globe', weight: 1 }, { kind: 'inkwell', weight: 2 }, { kind: 'waxSeal', weight: 2 },
    { kind: 'shelf', weight: 3 }, { kind: 'candleStand', weight: 2 }, { kind: 'toolbox', weight: 1 }, { kind: 'bench', weight: 2 },
    { kind: 'mask', weight: 1 }, { kind: 'mirror', weight: 1 }, { kind: 'beamSupport', weight: 1 }, { kind: 'oilLamp', weight: 2 },
    { kind: 'ivyWall', weight: 2 }, { kind: 'lichen', weight: 2 }, { kind: 'mossPatch', weight: 1 }, { kind: 'bushPatch', weight: 1 },
    { kind: 'buttonPanel', weight: 1 }, { kind: 'gear', weight: 1 }, { kind: 'lever', weight: 1 },
  ],
  reliquary: [
    { kind: 'chest', weight: 4 }, { kind: 'relicCase', weight: 3 }, { kind: 'pedestal', weight: 3 }, { kind: 'altar', weight: 2 },
    { kind: 'reliquaryUrn', weight: 2 }, { kind: 'idol', weight: 2 }, { kind: 'brazier', weight: 3 }, { kind: 'candleWheel', weight: 1 },
    { kind: 'runeCircle', weight: 2 }, { kind: 'ancientSigil', weight: 1 }, { kind: 'crystalCluster', weight: 2 }, { kind: 'statue', weight: 2 },
    { kind: 'tapestry', weight: 1 }, { kind: 'banner', weight: 1 }, { kind: 'mask', weight: 1 }, { kind: 'rug', weight: 2 },
    { kind: 'sacrificialKnife', weight: 1 }, { kind: 'chest', weight: 1 }, { kind: 'incense', weight: 1 }, { kind: 'brassScale', weight: 1 },
    { kind: 'crystals', weight: 3 }, { kind: 'lichen', weight: 1 }, { kind: 'mossGrass', weight: 1 },
    { kind: 'orbRed', weight: 2 }, { kind: 'runeCirclePurple', weight: 1 }, { kind: 'bust', weight: 1 }, { kind: 'greenRuneStone', weight: 1 },
  ],
  storage: [
    { kind: 'crates', weight: 4 }, { kind: 'crateStack', weight: 3 }, { kind: 'crateOpen', weight: 2 }, { kind: 'barrels', weight: 3 },
    { kind: 'barrelStack', weight: 2 }, { kind: 'barrelTap', weight: 1 }, { kind: 'sackPile', weight: 3 }, { kind: 'hayPile', weight: 2 },
    { kind: 'shelf', weight: 3 }, { kind: 'toolRack', weight: 2 }, { kind: 'toolbox', weight: 2 }, { kind: 'bucket', weight: 2 },
    { kind: 'bucketStand', weight: 1 }, { kind: 'ladder', weight: 2 }, { kind: 'scaffold', weight: 1 }, { kind: 'beamSupport', weight: 1 },
    { kind: 'coalHeap', weight: 1 }, { kind: 'sawhorse', weight: 1 }, { kind: 'net', weight: 1 }, { kind: 'ropeCoil', weight: 2 },
    { kind: 'workbench', weight: 2 }, { kind: 'vise', weight: 1 }, { kind: 'anvil', weight: 1 }, { kind: 'dryingRack', weight: 1 },
    { kind: 'candleHolder', weight: 1 }, { kind: 'oldCradle', weight: 1 }, { kind: 'mineCart', weight: 1 }, { kind: 'fishNet', weight: 1 },
    { kind: 'logs', weight: 2 }, { kind: 'pebbles', weight: 1 }, { kind: 'scree', weight: 1 }, { kind: 'puddleMud', weight: 1 }, { kind: 'boulder', weight: 1 },
    { kind: 'gearCog', weight: 1 }, { kind: 'chainPulley', weight: 1 }, { kind: 'pulleyBlock', weight: 1 }, { kind: 'hangingCage', weight: 1 }, { kind: 'pressurePlate', weight: 1 },
  ],
  watch: [
    { kind: 'brazier', weight: 4 }, { kind: 'brazierStand', weight: 3 }, { kind: 'bench', weight: 3 }, { kind: 'toolRack', weight: 3 },
    { kind: 'pillar', weight: 2 }, { kind: 'chains', weight: 3 }, { kind: 'manacles', weight: 2 }, { kind: 'stocks', weight: 1 },
    { kind: 'cage', weight: 2 }, { kind: 'cageDoor', weight: 1 }, { kind: 'tortureRack', weight: 1 }, { kind: 'gibbet', weight: 1 },
    { kind: 'signalHorn', weight: 2 }, { kind: 'net', weight: 1 }, { kind: 'ropeCoil', weight: 2 }, { kind: 'oilLamp', weight: 2 },
    { kind: 'candleHolder', weight: 2 }, { kind: 'skull', weight: 1 }, { kind: 'bones', weight: 1 }, { kind: 'crateOpen', weight: 2 },
    { kind: 'mineCart', weight: 1 }, { kind: 'mineRails', weight: 1 }, { kind: 'rubblePile', weight: 1 }, { kind: 'brazierStand', weight: 2 },
    { kind: 'stalagmites', weight: 1 }, { kind: 'rockSpikes', weight: 1 }, { kind: 'boulder', weight: 1 }, { kind: 'rockPile', weight: 1 }, { kind: 'stalactites', weight: 1 },
    { kind: 'portcullis', weight: 1 }, { kind: 'spikedWheel', weight: 1 }, { kind: 'leverBlade', weight: 1 }, { kind: 'hangingCage', weight: 1 }, { kind: 'spikeRack', weight: 1 },
  ],
};

/** Сцена: якорь ставится обычным поиском, спутники — по смещениям от якоря. */
type ScenePart = { kind: CryptKind; dx: number; dy: number };
type CryptScene = { anchor: CryptKind; parts: ScenePart[] };
const SCENES: Record<CryptTheme, CryptScene[]> = {
  entry: [
    { anchor: 'steps', parts: [{ kind: 'brazierStand', dx: -2, dy: 0 }, { kind: 'brazierStand', dx: 2, dy: 0 }, { kind: 'mournerStatue', dx: -1, dy: -2 }, { kind: 'mournerStatue', dx: 1, dy: -2 }] },
    { anchor: 'bench', parts: [{ kind: 'toolRack', dx: -2, dy: 0 }, { kind: 'manacles', dx: 0, dy: 1 }, { kind: 'cage', dx: 2, dy: 0 }] },
    { anchor: 'mossGrass', parts: [{ kind: 'pebbles', dx: 2, dy: 0 }, { kind: 'puddleMud', dx: 0, dy: 2 }, { kind: 'lichen', dx: -2, dy: 0 }] },
    { anchor: 'pressurePlate', parts: [{ kind: 'crackedPlate', dx: 2, dy: 0 }, { kind: 'spikeRack', dx: -2, dy: 0 }] },
  ],
  burial: [
    { anchor: 'coffin', parts: [{ kind: 'graveCandle', dx: -1, dy: 0 }, { kind: 'wreath', dx: 2, dy: 0 }, { kind: 'nameTomb', dx: 0, dy: 2 }] },
    { anchor: 'tomb', parts: [{ kind: 'openCoffin', dx: 0, dy: 2 }, { kind: 'sarcophagusLid', dx: -2, dy: 0 }] },
    { anchor: 'skeletonBones', parts: [{ kind: 'dirtPatch', dx: 0, dy: 1 }, { kind: 'roots', dx: 2, dy: 0 }, { kind: 'nestEggs', dx: -1, dy: 0 }] },
  ],
  sanctum: [
    { anchor: 'altar', parts: [{ kind: 'candleStand', dx: -2, dy: 0 }, { kind: 'candleStand', dx: 2, dy: 0 }, { kind: 'runeCircle', dx: 0, dy: 2 }, { kind: 'rug', dx: 0, dy: 3 }] },
    { anchor: 'altar', parts: [{ kind: 'brazier', dx: -2, dy: 0 }, { kind: 'brazier', dx: 2, dy: 0 }, { kind: 'idol', dx: 0, dy: -2 }] },
    { anchor: 'crystals', parts: [{ kind: 'mushroomsGlow', dx: 2, dy: 0 }, { kind: 'mossPatch', dx: 0, dy: 1 }, { kind: 'puddleBlue', dx: -2, dy: 0 }] },
    { anchor: 'pedestalStatue', parts: [{ kind: 'runeCircleBlue', dx: 2, dy: 0 }, { kind: 'orbRed', dx: -2, dy: 0 }, { kind: 'bust', dx: 0, dy: 2 }] },
  ],
  ossuary: [
    { anchor: 'ossuaryShelf', parts: [{ kind: 'bonePile', dx: 1, dy: 0 }, { kind: 'skull', dx: -1, dy: 0 }, { kind: 'skeletonPile', dx: 0, dy: 1 }] },
    { anchor: 'bonePile', parts: [{ kind: 'ribcage', dx: 1, dy: 0 }, { kind: 'pelvis', dx: -1, dy: 0 }, { kind: 'wreath', dx: 0, dy: 1 }] },
    { anchor: 'skeletonBones', parts: [{ kind: 'nestEggs', dx: 2, dy: 0 }, { kind: 'roots', dx: -1, dy: 0 }, { kind: 'dirtPatch', dx: 0, dy: 1 }] },
  ],
  archive: [
    { anchor: 'writingDesk', parts: [{ kind: 'bookcase', dx: 2, dy: 0 }, { kind: 'lectern', dx: -2, dy: 0 }, { kind: 'ledger', dx: 0, dy: 1 }] },
    { anchor: 'bookcase', parts: [{ kind: 'scrollRack', dx: 1, dy: 0 }, { kind: 'inkwell', dx: 2, dy: 0 }, { kind: 'shelf', dx: -1, dy: 0 }] },
    { anchor: 'lichen', parts: [{ kind: 'bushPatch', dx: 2, dy: 0 }, { kind: 'mossPatch', dx: -2, dy: 0 }, { kind: 'roots', dx: 0, dy: 1 }] },
  ],
  reliquary: [
    { anchor: 'chest', parts: [{ kind: 'pedestal', dx: -2, dy: 0 }, { kind: 'pedestal', dx: 2, dy: 0 }, { kind: 'candleWheel', dx: 0, dy: 2 }, { kind: 'reliquaryUrn', dx: 0, dy: -1 }] },
    { anchor: 'chest', parts: [{ kind: 'relicCase', dx: 2, dy: 0 }, { kind: 'candleStand', dx: -2, dy: 0 }, { kind: 'brassScale', dx: 0, dy: 1 }] },
    { anchor: 'crystals', parts: [{ kind: 'lichen', dx: 2, dy: 0 }, { kind: 'mossGrass', dx: -2, dy: 0 }] },
    { anchor: 'orbRed', parts: [{ kind: 'runeCirclePurple', dx: 0, dy: 2 }, { kind: 'bust', dx: 2, dy: 0 }, { kind: 'greenRuneStone', dx: -2, dy: 0 }] },
  ],
  storage: [
    { anchor: 'crates', parts: [{ kind: 'barrelStack', dx: 2, dy: 0 }, { kind: 'sackPile', dx: 0, dy: 1 }, { kind: 'bucket', dx: -1, dy: 0 }] },
    { anchor: 'workbench', parts: [{ kind: 'toolbox', dx: 2, dy: 0 }, { kind: 'vise', dx: -1, dy: 0 }, { kind: 'crateOpen', dx: 0, dy: 1 }] },
    { anchor: 'logs', parts: [{ kind: 'pebbles', dx: 2, dy: 0 }, { kind: 'scree', dx: 0, dy: 1 }, { kind: 'boulder', dx: -2, dy: 0 }] },
    { anchor: 'hangingCage', parts: [{ kind: 'pressurePlate', dx: 2, dy: 0 }, { kind: 'crateOpen', dx: -2, dy: 0 }, { kind: 'bucket', dx: 0, dy: 2 }] },
  ],
  watch: [
    { anchor: 'brazier', parts: [{ kind: 'bench', dx: 2, dy: 0 }, { kind: 'toolRack', dx: -2, dy: 0 }, { kind: 'manacles', dx: 0, dy: 1 }] },
    { anchor: 'bench', parts: [{ kind: 'signalHorn', dx: 2, dy: 0 }, { kind: 'cage', dx: -2, dy: 0 }, { kind: 'stocks', dx: 0, dy: 1 }] },
    { anchor: 'boulder', parts: [{ kind: 'rockSpikes', dx: 2, dy: 0 }, { kind: 'stalagmites', dx: -2, dy: 0 }, { kind: 'pebbles', dx: 0, dy: 1 }] },
    { anchor: 'spikedWheel', parts: [{ kind: 'portcullis', dx: 2, dy: 0 }, { kind: 'flail', dx: -2, dy: 0 }, { kind: 'hangingCage', dx: 0, dy: 2 }] },
  ],
};
/** По одному настенному украшению на зал: знамёна, маски, гобелены, зеркала. */
const WALL_ORNAMENTS: Partial<Record<CryptTheme, CryptKind>> = {
  entry: 'banner', burial: 'mask', sanctum: 'tapestry', ossuary: 'stoneEye',
  archive: 'banner', reliquary: 'tapestry', storage: 'bell', watch: 'mirror',
};
/** Порядок тем служебных залов от входа в глубину — задаёт характер архетипа. */
const ARCHETYPE_THEMES: Record<CryptArchetype, CryptTheme[]> = {
  tomb: ['watch', 'storage', 'ossuary', 'burial', 'archive', 'reliquary'],
  catacombs: ['ossuary', 'burial', 'ossuary', 'burial', 'storage', 'reliquary'],
  temple: ['watch', 'reliquary', 'archive', 'burial', 'ossuary', 'storage'],
  archive: ['storage', 'archive', 'archive', 'reliquary', 'watch', 'burial'],
  prison: ['watch', 'storage', 'watch', 'storage', 'burial', 'ossuary'],
};
/** Главный зал архетипа: святилище в храме и усыпальнице, архив в архивохранилище, пост в тюрьме. */
export const CRYPT_HALL_THEME: Record<CryptArchetype, CryptTheme> = {
  tomb: 'sanctum', catacombs: 'sanctum', temple: 'sanctum', archive: 'archive', prison: 'watch',
};
/** В архиве и тюрьме главный зал — самый большой, а не самый дальний. */
const HALL_BY_SIZE: Record<CryptArchetype, boolean> = {
  tomb: false, catacombs: false, temple: false, archive: true, prison: true,
};

export function decorateCrypt(base: MapData, settings: GenSettings, preserved: CryptObject[] = []): MapData {
  const seed = settings.seed;
  const detail = Math.min(1, Math.max(0, settings.cryptDetail ?? .67));
  const { width, height } = base;
  const key = (x: number, y: number) => y * width + x;
  const bounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const plan = [...base.structures].sort((a, b) => midpoint(b).y - midpoint(a).y || a.x - b.x);
  const map: MapData = { ...base, crypt: [...preserved], cryptRooms: [] };
  if (!plan.length) return map;

  // Глубина зала — расстояние по полу от входа. По ней раздаются темы,
  // а не по порядку в массиве: служебные залы у входа, святилище в глубине.
  const distance = new Int32Array(width * height).fill(-1);
  const reachable: Point[] = [];
  const entrance = midpoint(plan[0]);
  if (open(map, entrance.x, entrance.y)) {
    distance[key(entrance.x, entrance.y)] = 0;
    reachable.push(entrance);
  }
  for (let i = 0; i < reachable.length; i++) {
    const { x, y } = reachable[i];
    for (const [dx, dy] of ADJACENT) {
      const nx = x + dx, ny = y + dy;
      if (!bounds(nx, ny) || distance[key(nx, ny)] !== -1 || !open(map, nx, ny)) continue;
      distance[key(nx, ny)] = distance[key(x, y)] + 1;
      reachable.push({ x: nx, y: ny });
    }
  }
  const depthOf = (room: Selection) => {
    let best = Number.POSITIVE_INFINITY;
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      const d = distance[key(x, y)];
      if (d >= 0 && d < best) best = d;
    }
    return Number.isFinite(best) ? best : 0;
  };
  const ranked = plan.map((room, index) => ({ room, index, depth: depthOf(room), area: size(room) }));
  const deeper = (a: typeof ranked[number], b: typeof ranked[number]) =>
    b.depth - a.depth || b.area - a.area || a.room.y - b.room.y || a.room.x - b.room.x;
  const candidates = ranked.slice(1);
  const byArea = [...candidates].sort((a, b) => b.area - a.area || b.depth - a.depth || a.room.y - b.room.y || a.room.x - b.room.x);
  // Главный зал: обычно самый большой (центральный), иначе — самый дальний от входа.
  const archetype = settings.cryptArchetype ?? 'tomb';
  const sanctum = candidates.length
    ? (HALL_BY_SIZE[archetype] || byArea[0].area >= (byArea[1]?.area ?? 0) * 1.25 ? byArea[0] : [...candidates].sort(deeper)[0])
    : undefined;
  const service = ranked.slice(1).filter((item) => item !== sanctum)
    .sort((a, b) => a.depth - b.depth || b.area - a.area || a.room.y - b.room.y || a.room.x - b.room.x);
  const order = ARCHETYPE_THEMES[settings.cryptArchetype ?? 'tomb'];
  const assigned = new Map<number, CryptTheme>([[ranked[0].index, ranked.length > 1 ? 'entry' : 'burial']]);
  if (sanctum) assigned.set(sanctum.index, CRYPT_HALL_THEME[settings.cryptArchetype ?? 'tomb']);
  service.forEach((item, i) => assigned.set(item.index, order[i % order.length]));
  const rooms: CryptRoom[] = plan.map((room, index) => ({ x: room.x, y: room.y, w: room.w, h: room.h,
    theme: assigned.get(index) ?? 'burial' }));
  map.cryptRooms = rooms;

  // The reserved aisle network connects every doorway and room centre through the existing floor.
  const aisle = new Set<number>(), root = new Int32Array(width * height).fill(-2), queue: Point[] = [];
  for (const p of rooms.map(midpoint)) if (open(map, p.x, p.y)) { queue.push(p); root[key(p.x, p.y)] = -1; aisle.add(key(p.x, p.y)); break; }
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of ADJACENT) {
      const nx = x + dx, ny = y + dy;
      if (bounds(nx, ny) && root[key(nx, ny)] === -2 && open(map, nx, ny)) { root[key(nx, ny)] = key(x, y); queue.push({ x: nx, y: ny }); }
    }
  }
  const anchor = (x: number, y: number) => {
    for (let p = key(x, y); p >= 0 && root[p] !== -2 && !aisle.has(p); p = root[p]) aisle.add(p);
  };
  for (const room of rooms) {
    const { x, y } = midpoint(room);
    anchor(x, y);
  }
  for (const p of queue) if (map.cells[p.y][p.x].terrain === 'door' || !rooms.some((r) => contains(r, p.x, p.y))) anchor(p.x, p.y);
  const byDoor = (x: number, y: number) => ADJACENT.some(([dx, dy]) => map.cells[y + dy]?.[x + dx]?.terrain === 'door');

  /** Ставит предмет в зал, учитывая его роль: вдоль стен, по центру или в углу.
   *  Сид зависит только от зала и слота, поэтому рост детализации добавляет
   *  предметы, не сдвигая уже поставленные. */
  function tryPlace(kind: CryptKind, room: Selection, salt = 0, max = 160, force?: ChestRotation) {
    const spec = CRYPT[kind];
    const role = spec.placement ?? 'any';
    const local = rngFor(seed, room.x, room.y, salt);
    const offers: { item: CryptObject; score: number }[] = [];
    const rotations: readonly ChestRotation[] = force !== undefined ? [force] : spec.w === spec.h ? [ROTATIONS[randInt(local, 0, 3)]] : [0, 90];
    for (const rotation of rotations) {
      const stamp = cryptStamp({ x: 0, y: 0 }, kind, rotation, true, randInt(local, 0, 3));
      if (kind === 'chasm' && Math.max(room.w, room.h) > 8) {
        if (rotation === 0) stamp.w = Math.min(room.w - 2, 5);
        else stamp.h = Math.min(room.h - 2, 5);
      }
      const m = midpoint(room);
      for (let y = room.y; y + stamp.h <= room.y + room.h; y++) for (let x = room.x; x + stamp.w <= room.x + room.w; x++) {
        const item = { ...stamp, x, y, source: 'layout' as const };
        const rim = Math.min(x - room.x, y - room.y, room.x + room.w - (x + item.w), room.y + room.h - (y + item.h));
        const centre = Math.hypot(x + item.w / 2 - m.x, y + item.h / 2 - m.y);
        const wall = rim === 0 ? 0 : 2.5;
        const corner = Math.min(x - room.x, y - room.y) + Math.min(room.x + room.w - (x + item.w), room.y + room.h - (y + item.h));
        const roleScore = role === 'center' ? centre * .9 : role === 'wall' ? wall + centre * .22 : role === 'corner' ? corner * .9 + centre * .2 : centre * .55 + rim * .3;
        const score = roleScore + hash2(x, y, mixSeed(seed, room.x, room.y, salt, rotation)) * 1.15;
        offers.push({ item, score });
      }
    }
    offers.sort((a, b) => a.score - b.score);
    for (const { item } of offers.slice(0, max)) {
      if (!canPlaceCrypt(map, item)) continue;
      let roomClear = true;
      for (let y = item.y; y < item.y + item.h && roomClear; y++) for (let x = item.x; x < item.x + item.w; x++) {
        if ((spec.blocks && aisle.has(key(x, y))) || ((spec.blocks || hazard(kind)) && byDoor(x, y))) { roomClear = false; break; }
      }
      if (!roomClear) continue;
      map.crypt!.push(item);
      return item;
    }
    return undefined;
  }

  /** Ставит предмет по абсолютной клетке в пределах зала — для сцен. */
  function placeAt(kind: CryptKind, x: number, y: number, room: Selection, salt: number) {
    const spec = CRYPT[kind];
    const local = rngFor(seed, room.x, room.y, salt);
    const item: CryptObject = { ...cryptStamp({ x, y }, kind, 0, true, randInt(local, 0, 3)), source: 'layout' as const };
    if (item.x < room.x || item.y < room.y || item.x + item.w > room.x + room.w || item.y + item.h > room.y + room.h) return undefined;
    if (!canPlaceCrypt(map, item)) return undefined;
    if (spec.blocks || hazard(kind)) {
      for (let yy = item.y; yy < item.y + item.h; yy++) for (let xx = item.x; xx < item.x + item.w; xx++) {
        if (aisle.has(key(xx, yy)) || byDoor(xx, yy)) return undefined;
      }
    }
    map.crypt!.push(item);
    return item;
  }

  /** Сцена: якорь ставится обычным поиском, спутники — по смещениям от якоря. */
  function placeScene(scene: CryptScene, room: Selection, salt: number) {
    const anchor = tryPlace(scene.anchor, room, salt, 120, 0);
    if (!anchor) return false;
    scene.parts.forEach((part, index) => placeAt(part.kind, anchor.x + part.dx, anchor.y + part.dy, room, salt + 100 + index));
    return true;
  }

  /** Настенный предмет: только на стене, примыкающей к залу, и не у двери. */
  function tryPlaceOnWall(kind: CryptKind, room: Selection, salt = 0) {
    const spec = CRYPT[kind];
    if (spec.placement !== 'wallFace') return undefined;
    const ring: Point[] = [];
    for (let x = room.x - 1; x <= room.x + room.w; x++) ring.push({ x, y: room.y - 1 }, { x, y: room.y + room.h });
    for (let y = room.y - 1; y <= room.y + room.h; y++) ring.push({ x: room.x - 1, y }, { x: room.x + room.w, y });
    const noise = mixSeed(seed, room.x, room.y, salt);
    ring.sort((a, b) => hash2(a.x, a.y, noise) - hash2(b.x, b.y, noise) || a.y - b.y || a.x - b.x);
    const local = rngFor(seed, room.x, room.y, salt);
    for (const cell of ring) {
      if (!bounds(cell.x, cell.y) || map.cells[cell.y][cell.x].terrain !== 'wall') continue;
      if (byDoor(cell.x, cell.y)) continue;
      const touchesRoom = ADJACENT.some(([dx, dy]) => contains(room, cell.x + dx, cell.y + dy) && isFloor(map, cell.x + dx, cell.y + dy));
      if (!touchesRoom) continue;
      const item: CryptObject = { ...cryptStamp(cell, kind, 0, true, randInt(local, 0, 3)), source: 'layout' as const };
      if (!canPlaceCrypt(map, item)) continue;
      map.crypt!.push(item);
      return item;
    }
    return undefined;
  }

  if (settings.cryptChasms ?? true) {
    // Провалы уместны только в погребальных залах, святилище и кладовой:
    // в сокровищнице, архиве, на посту стражи и в вестибюле их не бывает.
    const allowed: CryptTheme[] = ['sanctum', 'burial', 'ossuary', 'storage'];
    const bySize = rooms.filter((room) => allowed.includes(room.theme))
      .sort((a, b) => size(b) - size(a) || a.y - b.y || a.x - b.x);
    const target = Math.max(1, Math.min(4, Math.floor(rooms.length / 3), bySize.length));
    let hazards = 0;
    for (const room of bySize) {
      if (hazards >= target) break;
      const pit = tryPlace('chasm', room, 101) ?? tryPlace('pit', room, 102);
      if (!pit) continue;
      hazards++;
      if (pit.kind === 'chasm' && hazards === 1 && pit.w >= 2 && pit.h >= 2) {
        const horizontal = pit.w >= pit.h;
        const item: CryptObject = { ...pit, kind: 'bridge', rotation: horizontal ? 90 : 0,
          x: pit.x + (horizontal ? Math.floor(pit.w / 2) : 0), y: pit.y + (horizontal ? 0 : Math.floor(pit.h / 2)),
          w: horizontal ? 1 : pit.w, h: horizontal ? pit.h : 1 };
        if (canPlaceCrypt(map, item)) map.crypt!.push(item);
      }
    }
  }

  // Базовый набор есть при любой детализации: раньше при 0% склеп оставался
  // пустым. В каждом зале ставится свет, чтобы зал читался и на карте, и в игре.
  const BASE: Record<CryptTheme, CryptKind> = { entry: 'steps', burial: 'coffin', sanctum: 'altar', ossuary: 'bonePile',
    archive: 'bookcase', reliquary: 'chest', storage: 'crates', watch: 'bench' };
  const LIGHT: Record<CryptTheme, CryptKind> = { entry: 'brazierStand', burial: 'graveCandle', sanctum: 'brazier',
    ossuary: 'graveCandle', archive: 'candleStand', reliquary: 'brazier', storage: 'candleHolder', watch: 'brazier' };
  for (const room of rooms) {
    tryPlace(BASE[room.theme], room, 20);
    if (!tryPlace(LIGHT[room.theme], room, 21)) tryPlace('oilLamp', room, 22);
    if (size(room) >= 90) tryPlace(LIGHT[room.theme], room, 23);

    const scenes = SCENES[room.theme];
    const pick = Math.floor(hash2(room.x, room.y, seed + 4242) * scenes.length);
    placeScene(scenes[pick % scenes.length], room, 600);
    if (size(room) >= 90) placeScene(scenes[(pick + 1) % scenes.length], room, 700);

    const ornament = WALL_ORNAMENTS[room.theme];
    if (ornament) tryPlaceOnWall(ornament, room, 40);
  }

  // Кости есть в любом склепе и ставятся до мебели: иначе при росте детализации
  // «гарантированный» скелет переезжает из слота в слот.
  if (!map.crypt?.some(({ kind }) => kind === 'skeleton')) {
    for (const room of rooms.slice().reverse()) if (tryPlace('skeleton', room, 500)) break;
  }

  if (detail > 0) {
    for (const room of rooms) {
      const slots = SETS[room.theme];
      const pool = slots.flatMap((slot) => Array.from({ length: slot.weight }, () => slot.kind));
      const local = rngFor(seed, room.x, room.y, 7);
      const budget = Math.max(1, Math.round(size(room) * (.028 + .155 * detail)));
      const limit = Math.min(pool.length, budget);
      const chosen: CryptKind[] = [];
      for (let i = 0; i < limit && pool.length; i++) {
        const index = randInt(local, 0, pool.length - 1);
        const kind = pool.splice(index, 1)[0];
        chosen.push(kind);
      }
      chosen.forEach((kind, index) => {
        const placed = CRYPT[kind].placement === 'wallFace'
          ? tryPlaceOnWall(kind, room, 200 + index)
          : tryPlace(kind, room, 200 + index);
        if (placed) return;
        const spare = slots.find((slot) => slot.kind !== kind && slot.weight > 0);
        if (!spare) return;
        if (CRYPT[spare.kind].placement === 'wallFace') tryPlaceOnWall(spare.kind, room, 900 + index);
        else tryPlace(spare.kind, room, 900 + index);
      });
    }
  }

  if (settings.cryptTraps ?? true) {
    const kinds: CryptKind[] = ['pressureTile', 'spikeGlyph', 'runeTrap', 'fallSeal'];
    // Ловушки живут в коридорах: в залах они конфликтуют с мебелью, а на входе
    // и вовсе нечестны. Зато в 2–3 клетках перед дверью — самое место.
    const doors: Point[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (map.cells[y][x].terrain === 'door') doors.push({ x, y });
    const doorGap = (p: Point) => doors.reduce((best, door) => Math.min(best, Math.abs(p.x - door.x) + Math.abs(p.y - door.y)), 99);
    const score = (p: Point) => {
      const gap = doorGap(p);
      return hash2(p.x, p.y, seed + 835691) + (gap <= 3 ? .5 : gap <= 5 ? .2 : 0);
    };
    const slots = reachable.filter(({ x, y }) => isFloor(map, x, y) && !byDoor(x, y) && !rooms.some((room) => contains(room, x, y)))
      .sort((a, b) => score(b) - score(a) || a.y - b.y || a.x - b.x);
    const target = Math.max(1, Math.floor(rooms.length * (.5 + detail * .6)));
    const laid: CryptObject[] = [];
    for (const p of slots) {
      if (laid.length >= target) break;
      if (laid.some((t) => Math.abs(p.x - t.x) + Math.abs(p.y - t.y) < 3)) continue;
      const trap = { ...cryptStamp(p, kinds[laid.length % kinds.length], ROTATIONS[laid.length % 4], true), source: 'layout' as const };
      if (canPlaceCrypt(map, trap)) { map.crypt!.push(trap); laid.push(trap); }
    }
  }

  map.rocks = base.rocks.filter((r) => !map.crypt!.some((p) => contains(p, r.x, r.y)));
  map.trees = base.trees.filter((r) => !map.crypt!.some((p) => contains(p, r.x, r.y)));
  return map;
}

export function redecorateCrypt(map: MapData, settings: GenSettings): MapData {
  const result = decorateCrypt(map, settings, (map.crypt ?? []).filter((item) => item.source === 'manual'));
  return { ...result, rocks: map.rocks, trees: map.trees };
}