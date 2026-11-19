import { FURNITURE, furnitureBounds } from './furnitureKit';
import { hash2 } from './random';
import { encloses, intersects } from './settlementKit';
import type { Building, ChestRotation, Furnishing, FurnitureKind, Point, Selection } from './types';

type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'pantry' | 'study' | 'common' | 'guest' | 'workshop';
export interface Room extends Selection { kind: RoomKind }
export interface Partition { from: Point; to: Point; doorway: Point }
export interface InteriorPlan { rooms: Room[]; walls: Partition[]; furnishings: Furnishing[]; entrance: Point }

export const ROOM_NAMES: Record<RoomKind, string> = {
  living: 'Гостиная', bedroom: 'Спальня', kitchen: 'Кухня', pantry: 'Кладовая', study: 'Кабинет', common: 'Общий зал', guest: 'Комната для гостей', workshop: 'Мастерская',
};

export const DIRECTIONS = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] } as const;
export const facingOf = (b: Building) => b.facing ?? (b.door.y === b.y ? 180 : b.door.y === b.y + b.h - 1 ? 0 : b.door.x === b.x ? 90 : 270);
const size = (r: Selection) => r.w * r.h;
const bound = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const cached = new WeakMap<Building, InteriorPlan>();

export function tavernName(b: Building, seed: number) {
  const names = ['Медный кубок', 'Три фонаря', 'Золотая кружка', 'Старый дуб', 'Лисий хвост', 'Пьяный грифон'];
  return names[Math.floor(hash2(b.x, b.y, seed + 5) * names.length)];
}

function blockedEntrance(plan: Pick<InteriorPlan, 'walls' | 'entrance'>, box: Selection) {
  return [plan.entrance, ...plan.walls.map((p) => p.doorway)].some(({ x, y }) => intersects(box, { x: x - .39, y: y - .39, w: .78, h: .78 }));
}

function canFit(rooms: Room[], walls: Partition[], entrance: Point, existing: Furnishing[], item: Furnishing) {
  const box = furnitureBounds(item);
  return rooms.some((room) => encloses({ x: room.x + .14, y: room.y + .14, w: room.w - .28, h: room.h - .28 }, box))
    && (FURNITURE[item.kind].flat || !blockedEntrance({ walls, entrance }, box))
    && !existing.some((other) => Boolean(FURNITURE[other.kind].flat) === Boolean(FURNITURE[item.kind].flat) && intersects(furnitureBounds(other), box, .035));
}

export function interiorOf(b: Building): InteriorPlan {
  const found = cached.get(b);
  if (found) return found;
  const facing = facingOf(b), sideways = facing % 180 !== 0;
  const w = sideways ? b.h : b.w, h = sideways ? b.w : b.h;
  const dx = b.door.x - b.x + .5, dy = b.door.y - b.y + .5;
  const front = bound(facing === 0 ? dx : facing === 90 ? dy : facing === 180 ? w - dx : w - dy, .47, w - .47);
  const entry = { x: front, y: h };
  const tavern = b.kind === 'tavern';
  const rooms: Room[] = [], walls: Partition[] = [], furnishings: Furnishing[] = [];

  const addRoom = (kind: RoomKind, x: number, y: number, rw: number, rh: number) => {
    const room = { x, y, w: rw, h: rh, kind };
    rooms.push(room);
    return room;
  };
  const divider = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => walls.push({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, doorway: { x, y } });

  const back = w >= 3.7 && h >= 3.7 ? tavern ? (h >= 7 ? 3 : 2.15) : Math.max(2, Math.floor(h * .45)) : 0;
  let frontRoom: Room;
  if (back > 0) {
    const divideFront = !tavern && w >= 7 && h - back >= 3.5;
    const annexWidth = divideFront ? Math.max(2.4, Math.round(w * .35)) : 0;
    const annexX = front < w / 2 ? w - annexWidth : 0;
    frontRoom = addRoom(tavern ? 'common' : 'living', divideFront && !annexX ? annexWidth : 0, back, w - annexWidth, h - back);
    if (divideFront) {
      addRoom('study', annexX, back, annexWidth, h - back);
      const xx = annexX || annexWidth;
      divider(xx, back, xx, h, xx, back + (h - back) * .63);
    }
    const parts = tavern && w >= 9 ? [0, Math.round(w * .34), Math.round(w * .63), w]
      : !tavern && w >= 9 && back >= 3 ? [0, Math.round(w / 3), Math.round(w * .67), w]
        : w >= (tavern ? 6 : 5.5) ? [0, Math.round(w * .5), w] : [0, w];
    const kinds: RoomKind[] = tavern ? ['kitchen', 'pantry', 'guest'] : ['bedroom', b.kind === 'shop' ? 'workshop' : 'kitchen', 'pantry'];
    for (let i = 1; i < parts.length; i++) {
      const x1 = parts[i - 1], x2 = parts[i];
      addRoom(kinds[i - 1], x1, 0, x2 - x1, back);
      const doorX = bound((x1 + x2) / 2 + (i === 1 && tavern ? .27 : 0), x1 + .5, x2 - .5);
      divider(x1, back, x2, back, doorX, back);
      if (i < parts.length - 1) divider(x2, 0, x2, back, x2, back * .53);
    }
  } else frontRoom = addRoom(tavern ? 'common' : 'living', 0, 0, w, h);

  function put(kind: FurnitureKind, x: number, y: number, rotation: ChestRotation = 0) {
    const item = { kind, x, y, rotation };
    if (!canFit(rooms, walls, entry, furnishings, item)) return false;
    furnishings.push(item);
    return true;
  }

  function furnish(room: Room, kind: FurnitureKind, u: number, v: number, rotation: ChestRotation = 0, tryOthers = true) {
    const spec = FURNITURE[kind], swapped = rotation % 180 !== 0;
    const mx = (swapped ? spec.h : spec.w) / 2 + .17, my = (swapped ? spec.w : spec.h) / 2 + .17;
    if (room.w < 2 * mx || room.h < 2 * my) return false;
    const sites = tryOthers ? [[u, v], [1 - u, v], [u, 1 - v], [.5, .5], [.03, .04], [.96, .04], [.04, .97], [.96, .97]] : [[u, v]];
    return sites.some(([x, y]) => put(kind, room.x + mx + (room.w - mx * 2) * x, room.y + my + (room.h - my * 2) * y, rotation));
  }

  function dining(x: number, y: number, rotate: boolean, many: boolean) {
    if (!put(rotate ? 'longTable' : 'table', x, y)) return false;
    put('chair', x, y - .88, 0);
    put('chair', x, y + .88, 180);
    if (many) {
      put('chair', x - (rotate ? 1.10 : .87), y, 270);
      put('chair', x + (rotate ? 1.10 : .87), y, 90);
    }
    return true;
  }

  if (tavern) {
    const y = frontRoom.y, depth = frontRoom.h;
    furnish(frontRoom, 'bar', .03, .48, 90);
    const line = y + depth * .55;
    for (let x = w - 1.31, i = 0; x >= 2.72; x -= 2.20, i++) {
      const row = line + (w >= 9 ? i % 2 ? -.32 : .32 : 0);
      if (!dining(x, row, false, true)) dining(x, line, false, true);
    }
    for (const off of [-.65, .12, .9]) put('stool', 1.72, line + off);
    furnish(frontRoom, 'hearth', .98, .01, 90);
    furnish(frontRoom, 'barrels', .01, .02, 0, false);
    furnish(frontRoom, 'rug', front / w, .95, 0, false);
    if (w >= 9) furnish(frontRoom, 'linen', .78, .06, 0, false);
    furnish(frontRoom, 'bench', .92, .97, 0, false);
    if (w > 9) furnish(frontRoom, 'lantern', .38, .05);
  } else {
    furnish(frontRoom, b.style === 'village' ? 'linen' : 'rug', .56, .54);
    if (!dining(frontRoom.x + frontRoom.w * .63, frontRoom.y + frontRoom.h * .52, frontRoom.w >= 5, frontRoom.h >= 2.8)) {
      furnish(frontRoom, 'longTable', .79, .45);
      furnish(frontRoom, 'chair', .78, .91);
    }
    furnish(frontRoom, 'hearth', .03, .09, frontRoom.h >= 2.8 ? 90 : 0);
    if (size(frontRoom) >= 13) furnish(frontRoom, 'bench', .03, .92);
    if (size(frontRoom) >= 15) furnish(frontRoom, 'cupboard', .94, .02);
  }

  for (const room of rooms) switch (room.kind) {
    case 'bedroom': case 'guest':
      furnish(room, 'linen', .52, .62);
      furnish(room, 'bed', .02, .0);
      furnish(room, 'wardrobe', .98, .04, room.h < 2.4 ? 90 : 0);
      furnish(room, 'trunk', .07, .98);
      if (size(room) >= 8) furnish(room, 'basin', .96, .9);
      if (size(room) >= 11) furnish(room, room.kind === 'guest' ? 'bed' : 'screen', .70, .06);
      break;
    case 'kitchen':
      furnish(room, 'stove', .02, .03);
      furnish(room, 'worktop', .96, .06);
      furnish(room, 'cupboard', .84, .94);
      furnish(room, 'basket', .09, .89);
      break;
    case 'pantry':
      furnish(room, 'barrels', .01, .03);
      furnish(room, 'crates', .96, .12);
      furnish(room, 'cupboard', .96, .95);
      furnish(room, 'jars', .12, .89);
      if (size(room) >= 8) furnish(room, 'basket', .64, .45);
      break;
    case 'study':
      furnish(room, 'bookcase', .02, .02);
      furnish(room, 'desk', .94, .18);
      furnish(room, 'chair', .73, .63, 180);
      furnish(room, 'lantern', .1, .92);
      furnish(room, 'linen', .48, .75);
      break;
    case 'workshop':
      furnish(room, 'worktop', .07, .03);
      furnish(room, 'crates', .89, .07);
      furnish(room, 'stool', .52, .52);
      furnish(room, 'jars', .95, .92);
      break;
  }

  // Plan in the orientation of the entrance, then rotate into house-local coordinates.
  const point = (p: Point): Point => facing === 0 ? { x: p.x, y: p.y } : facing === 90 ? { x: b.w - p.y, y: p.x }
    : facing === 180 ? { x: b.w - p.x, y: b.h - p.y } : { x: p.y, y: b.h - p.x };
  const plan: InteriorPlan = {
    rooms: rooms.map((room) => {
      const a = point(room), z = point({ x: room.x + room.w, y: room.y + room.h });
      return { kind: room.kind, x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), w: Math.abs(z.x - a.x), h: Math.abs(z.y - a.y) };
    }),
    walls: walls.map(({ from, to, doorway }) => ({ from: point(from), to: point(to), doorway: point(doorway) })),
    furnishings: b.furniture ?? furnishings.map((item, index) => {
      const v = hash2(b.x * 61 + index, b.y * 37, (b.w + b.h) * 18481);
      const finish = v > .94 ? 'moss' : v > .77 ? 'walnut' : v < .067 ? 'ash' : undefined;
      return { ...item, ...point(item), rotation: (item.rotation + facing) % 360 as ChestRotation, ...(finish ? { finish } : {}) };
    }),
    entrance: point(entry),
  };
  cached.set(b, plan);
  return plan;
}

export function canFurnish(b: Building, item: Furnishing) {
  const plan = interiorOf(b);
  return canFit(plan.rooms, plan.walls, plan.entrance, plan.furnishings, item);
}

export function furnishItem(kind: FurnitureKind, position: Point, b: Building, rotation: ChestRotation, snap: boolean): Furnishing {
  const align = (x: number) => snap ? Math.round(x * 2) / 2 : Math.round(x * 100) / 100;
  return { kind, x: align(position.x - b.x), y: align(position.y - b.y), rotation };
}