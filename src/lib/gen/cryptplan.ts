import type { MapData, CryptTheme, CryptObject, Point } from '../types';
import { addCryptObject, canPlaceCrypt, cryptStamp } from '../cryptLayout';
import { CRYPT } from '../cryptKit';
import type { DungeonRoom, GenerationPlan, GroupType, ObjectGroup, Poi, PoiType, Zone, ZoneType } from './plan';
import { emptyPlan } from './plan';

/**
 * Композиционный план склепа: переводит уже расставленные `cryptRooms`/`crypt`
 * в общую структуру `GenerationPlan` (зоны, POI, группы).
 *
 * Зачем это нужно:
 *  - валидатор и debug-оверлей работают с планом, а не с приватными массивами
 *    декоратора залов;
 *  - можно проверить замысел: «в усыпальнице есть саркофаги», «в сокровищнице
 *    есть сундуки», «в каждом зале есть свет».
 *
 * План только описывает то, что уже стоит в карте: он ничего не двигает, поэтому
 * детерминизм и существующие тесты не ломаются.
 */

const POI_BY_PURPOSE: Record<DungeonRoom['purpose'], PoiType> = {
  entrance: 'entrance',
  hall: 'chamber',
  guard: 'chamber',
  crypt: 'chamber',
  treasury: 'chamber',
  storage: 'chamber',
};

const GROUP_BY_THEME: Record<CryptTheme, GroupType> = {
  entry: 'roadside_line',
  burial: 'coffin_row',
  sanctum: 'altar_scene',
  ossuary: 'coffin_row',
  archive: 'storage_clutter',
  reliquary: 'treasure_pile',
  storage: 'storage_clutter',
  watch: 'guard_post',
};

const ZONE_BY_THEME: Record<CryptTheme, ZoneType> = {
  entry: 'chamber',
  burial: 'chamber',
  sanctum: 'chamber',
  ossuary: 'chamber',
  archive: 'chamber',
  reliquary: 'chamber',
  storage: 'chamber',
  watch: 'chamber',
};

const center = (area: { x: number; y: number; w: number; h: number }) => ({
  x: area.x + Math.floor(area.w / 2),
  y: area.y + Math.floor(area.h / 2),
});

const containsPoint = (area: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
  x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h;

/**
 * Собирает план по готовой (уже декорированной) карте подземелья.
 * `base` — план из `dungeonPlan` (залы/граф), который нужно дополнить.
 */
export function cryptCompositionPlan(map: MapData, base: GenerationPlan): GenerationPlan {
  const plan = base ?? emptyPlan();
  const rooms = map.cryptRooms ?? [];
  const themeOf = (room: { x: number; y: number; w: number; h: number }): CryptTheme =>
    rooms.find((entry) => entry.x === room.x && entry.y === room.y && entry.w === room.w && entry.h === room.h)?.theme ?? 'burial';

  const zones: Zone[] = [];
  const poi: Poi[] = [];
  const groups: ObjectGroup[] = [];
  const crypt = map.crypt ?? [];

  // Клетки коридоров — всё, что не входит в залы.
  const roomCells = new Set<number>();
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) roomCells.add(y * map.width + x);
    }
  }

  rooms.forEach((room, index) => {
    const theme = room.theme ?? themeOf(room);
    const roomPoiType = POI_BY_PURPOSE[(plan.rooms?.[index]?.purpose ?? 'hall') as DungeonRoom['purpose']] ?? 'chamber';
    const hub = center(room);
    zones.push({
      id: `zone_room_${index}`,
      type: ZONE_BY_THEME[theme],
      density: theme === 'ossuary' ? 0.7 : theme === 'reliquary' ? 0.55 : 0.5,
      bounds: { x: room.x, y: room.y, w: room.w, h: room.h },
      area: room.w * room.h,
    });
    poi.push({ id: `poi_room_${index}`, type: roomPoiType, x: hub.x, y: hub.y, radius: Math.max(1.5, Math.min(room.w, room.h) / 3) });

    // Группа описывает замысел зала: сколько его предметов реально стоит внутри.
    const inside = crypt.filter((item) => containsPoint(room, item.x, item.y)).length;
    groups.push({
      id: `group_room_${index}`,
      type: GROUP_BY_THEME[theme],
      x: hub.x,
      y: hub.y,
      placed: inside,
    });
  });

  // Коридоры — отдельной зоной, чтобы валидатор мог отличить «проход» от «зала».
  let corridorCells = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const terrain = map.cells[y][x].terrain;
      if ((terrain === 'floor' || terrain === 'door') && !roomCells.has(y * map.width + x)) corridorCells += 1;
    }
  }
  if (corridorCells > 0) {
    zones.push({
      id: 'zone_corridors',
      type: 'tunnel',
      density: 0.08,
      bounds: { x: 0, y: 0, w: map.width, h: map.height },
      area: corridorCells,
    });
  }

  // Вход: первая комната (decorateCrypt всегда делает её «вестибюлем»).
  if (rooms.length) {
    const first = rooms[0];
    const hub = center(first);
    if (!poi.some((entry) => entry.type === 'entrance')) {
      poi.push({ id: 'poi_entrance', type: 'entrance', x: hub.x, y: hub.y, radius: 1.5 });
    }
  }

  // Старт партии — в центре входного зала (decorateCrypt делает первый зал вестибюлем).
  const spawn = rooms.length ? center(rooms[0]) : undefined;
  return { ...plan, zones, poi, groups, spawn };
}

/** Пустой отчёт-заглушка, пока карта не проверена валидатором. */
/**
 * Наполнение по назначению зала: план не только описывает замысел, но и
 * доставляет ключевой предмет, если тема зала его не поставила.
 *   treasury → сундук, crypt → тайник, guard → ловушка-стража.
 * Это правка уже обставленной карты, детерминизм сохраняется.
 */
export function furnishByPurpose(map: MapData, plan: GenerationPlan): { map: MapData; plan: GenerationPlan } {
  const rooms = plan.rooms ?? [];
  if (!rooms.length) return { map, plan };
  const hasInside = (room: DungeonRoom, predicate: (item: CryptObject) => boolean): boolean =>
    (map.crypt ?? []).some((item) => predicate(item)
      && item.x >= room.bounds.x && item.y >= room.bounds.y
      && item.x + item.w <= room.bounds.x + room.bounds.w
      && item.y + item.h <= room.bounds.y + room.bounds.h);
  // Ищем свободную клетку пола: сначала с отступом в клетку от мебели, затем
  // без отступа. Плоский декор (ковры, лужи, мох) не считается занятостью —
  // сундук вполне может стоять на ковре.
  const blocked = (x: number, y: number, pad: number): boolean =>
    (map.crypt ?? []).some((item) => {
      if (CRYPT[item.kind].flat) return false;
      return x >= item.x - pad && x <= item.x + item.w - 1 + pad
        && y >= item.y - pad && y <= item.y + item.h - 1 + pad;
    });
  const freeSpot = (room: DungeonRoom): Point | undefined => {
    for (const pad of [1, 0]) {
      for (let y = room.bounds.y + 1; y < room.bounds.y + room.bounds.h - 1; y += 1) {
        for (let x = room.bounds.x + 1; x < room.bounds.x + room.bounds.w - 1; x += 1) {
          if (map.cells[y]?.[x]?.terrain !== 'floor') continue;
          if (!blocked(x, y, pad)) return { x, y };
        }
      }
    }
    return undefined;
  };
  let next = map;
  const actions: string[] = [];
  for (const room of rooms) {
    const spot = freeSpot(room);
    if (!spot) continue;
    if (room.purpose === 'treasury' && !hasInside(room, (item) => item.kind === 'chest')) {
      const item = cryptStamp(spot, 'chest', 0, false);
      if (canPlaceCrypt(next, item)) {
        next = addCryptObject(next, item);
        actions.push(`зал ${room.id}: добавлен сундук сокровищницы`);
      }
    } else if (room.purpose === 'crypt' && !hasInside(room, (item) => item.hidden === true)) {
      // cryptStamp сохраняет hidden только для «секретных» видов, поэтому
      // скрытый тайник делаем сундуком и помечаем hidden вручную.
      const item = { ...cryptStamp(spot, 'chest', 0, false), hidden: true };
      if (canPlaceCrypt(next, item)) {
        next = addCryptObject(next, item);
        actions.push(`зал ${room.id}: добавлен тайник крипты`);
      }
    } else if (room.purpose === 'guard' && !hasInside(room, (item) => item.kind === 'pressureTile' || item.kind === 'spikeGlyph' || item.kind === 'runeTrap')) {
      const item = cryptStamp(spot, 'pressureTile', 0, false);
      if (canPlaceCrypt(next, item)) {
        next = addCryptObject(next, item);
        actions.push(`зал ${room.id}: добавлена стража-ловушка`);
      }
    }
  }
  if (!actions.length) return { map, plan };
  const updated: GenerationPlan = { ...plan, actions: [...(plan.actions ?? []), ...actions] };
  return { map: { ...next, plan: updated }, plan: updated };
}

/**
 * Скрытые ловушки в коридорах: залы стражи — не единственное место, где
 * может щёлкнуть плита. Ставим детерминированно (по координатам), максимум
 * несколько штук, только на пол вне залов и не рядом с дверями.
 */
export function placeCorridorTraps(map: MapData, plan: GenerationPlan): { map: MapData; plan: GenerationPlan } {
  const rooms = plan.rooms ?? [];
  if (!rooms.length) return { map, plan };
  const inRoom = (x: number, y: number): boolean => rooms.some((room) =>
    x >= room.bounds.x - 1 && x < room.bounds.x + room.bounds.w + 1
    && y >= room.bounds.y - 1 && y < room.bounds.y + room.bounds.h + 1);
  const nearDoor = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (map.cells[y + dy]?.[x + dx]?.terrain === 'door') return true;
      }
    }
    return false;
  };
  let next = map;
  let placed = 0;
  const spots: Point[] = [];
  for (let y = 1; y < map.height - 1 && placed < 4; y += 1) {
    for (let x = 1; x < map.width - 1 && placed < 4; x += 1) {
      if ((x * 31 + y * 17) % 23 !== 5) continue;
      if (map.cells[y][x].terrain !== 'floor') continue;
      if (inRoom(x, y) || nearDoor(x, y)) continue;
      if (spots.some((spot) => Math.abs(spot.x - x) + Math.abs(spot.y - y) < 5)) continue;
      const item = cryptStamp({ x, y }, 'pressureTile', 0, true);
      if (!canPlaceCrypt(next, item)) continue;
      next = addCryptObject(next, item);
      spots.push({ x, y });
      placed += 1;
    }
  }
  if (!placed) return { map, plan };
  const updated: GenerationPlan = {
    ...plan,
    actions: [...(plan.actions ?? []), `в коридорах скрыто ловушек: ${placed}`],
  };
  return { map: { ...next, plan: updated }, plan: updated };
}

export const cryptPlanSummary = (plan: GenerationPlan) => ({
  rooms: plan.rooms?.length ?? 0,
  zones: plan.zones.length,
  poi: plan.poi.length,
  groups: plan.groups.length,
  items: plan.groups.reduce((sum, group) => sum + group.placed, 0),
});
