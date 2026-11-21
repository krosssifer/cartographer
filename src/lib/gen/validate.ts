import type { MapData, Point, Terrain } from '../types';
import { CRYPT } from '../cryptKit';

/**
 * Валидатор готовой карты: проверяет инварианты, которые «must always hold»
 * независимо от того, какой генератор собрал карту.
 *
 * Идея: после генерации мы всегда прогоняем карту через `validateMap`, а затем
 * `repairMap` чинит найденные проблемы. Так любые будущие эксперименты с
 * алгоритмами не могут тихо сломать проходимость или поставить объект в воду.
 */

/** Клетки, по которым вообще можно ходить (без учёта мостов). */
const WALKABLE: ReadonlySet<Terrain> = new Set<Terrain>([
  'grass', 'darkGrass', 'dirt', 'mud', 'sand', 'snow', 'ice', 'road', 'bridge', 'plaza',
  'floor', 'door', 'buildingFloor', 'caveFloor',
]);

/** Клетки, на которых не может стоять растительность/камни. */
const FORBIDDEN_FOR_PROPS: ReadonlySet<Terrain> = new Set<Terrain>([
  'water', 'deepWater', 'wall', 'void', 'roof', 'caveWall', 'buildingWall',
]);

export type ProblemKind =
  | 'connectivity'
  | 'prop_on_forbidden'
  | 'open_space_blocked'
  | 'door_blocked'
  | 'crypt_blocking_door'
  | 'crypt_off_floor'
  | 'entrance_missing'
  | 'crypt_room_empty'
  | 'bridge_misaligned'
  | 'bridge_off_water';

export interface MapProblem {
  kind: ProblemKind;
  message: string;
  at?: Point;
}

export interface MapStats {
  floor: number;
  reachable: number;
  trees: number;
  rocks: number;
  roads: number;
  doors: number;
  crypt: number;
}

export interface MapReport {
  ok: boolean;
  problems: MapProblem[];
  /** Некритичные замечания: карта играбельна, но композиция недоделана. */
  warnings: string[];
  stats: MapStats;
}

const ADJACENT: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const isWalkable = (terrain: Terrain): boolean => WALKABLE.has(terrain);

const terrainAt = (map: MapData, x: number, y: number): Terrain | undefined =>
  map.cells[y]?.[x]?.terrain;

/** Клетка, с которой начинать проверку связности. */
function pickStart(map: MapData): Point | undefined {
  const entrance = (map.plan?.poi ?? []).find((poi) => poi.type === 'entrance');
  if (entrance && isWalkable(terrainAt(map, entrance.x, entrance.y) ?? 'void')) {
    return { x: entrance.x, y: entrance.y };
  }
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (isWalkable(terrainAt(map, x, y) ?? 'void')) return { x, y };
    }
  }
  return undefined;
}

/** Сколько клеток пола достижимо от входа (4-связность). */
export function reachableFloor(map: MapData, start?: Point): Set<number> {
  const seen = new Set<number>();
  const from = start ?? pickStart(map);
  if (!from) return seen;
  const stack = [from.y * map.width + from.x];
  seen.add(stack[0]);
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % map.width;
    const y = Math.floor(at / map.width);
    for (const [dx, dy] of ADJACENT) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (!isWalkable(terrainAt(map, nx, ny) ?? 'void')) continue;
      const next = ny * map.width + nx;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

/**
 * Полная проверка карты. `strictConnectivity` включается для подземных карт,
 * где весь пол обязан быть связан; для поверхности вода честно делит карту.
 */
export function validateMap(map: MapData, options: { strictConnectivity?: boolean } = {}): MapReport {
  const problems: MapProblem[] = [];
  const underground = map.biome === 'cave' || map.biome === 'dungeon';
  const strict = options.strictConnectivity ?? underground;

  let floor = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (isWalkable(terrainAt(map, x, y) ?? 'void')) floor += 1;
    }
  }
  const reachable = reachableFloor(map);
  // Открытые пространства композиции — не место для препятствий. Проверяем
  // после деревьев/камней: если центр арены заставлен, карта непригодна для боя.
  const openSpaces = map.plan?.composition?.openSpaces ?? [];
  for (const space of openSpaces) {
    if (space.kind !== 'battle_area' && space.kind !== 'clearing' && space.kind !== 'yard') continue;
    const inner = space.radius * 0.7;
    const blockers = map.trees.filter((tree) => Math.hypot(tree.x - space.x, tree.y - space.y) < inner).length
      + map.rocks.filter((rock) => Math.hypot(rock.x - space.x, rock.y - space.y) < inner).length;
    if (blockers > 0) {
      problems.push({
        kind: 'open_space_blocked',
        message: `открытое пространство ${space.id} заставлено объектами: ${blockers}`,
        at: { x: space.x, y: space.y },
      });
    }
  }

  const stats: MapStats = {
    floor,
    reachable: reachable.size,
    trees: map.trees.length,
    rocks: map.rocks.length,
    roads: map.road.length,
    doors: 0,
    crypt: map.crypt?.length ?? 0,
  };

  if (strict && floor > 0 && reachable.size / floor < 0.97) {
    problems.push({
      kind: 'connectivity',
      message: `достижимо ${Math.round((reachable.size / floor) * 100)}% пола (порог 97%)`,
      at: pickStart(map),
    });
  }

  // Объекты не могут стоять в воде/стене/пустоте.
  for (const tree of map.trees) {
    const terrain = terrainAt(map, Math.round(tree.x), Math.round(tree.y));
    if (terrain && FORBIDDEN_FOR_PROPS.has(terrain)) {
      problems.push({ kind: 'prop_on_forbidden', message: `дерево ${tree.kind} на ${terrain}`, at: { x: tree.x, y: tree.y } });
    }
  }
  for (const rock of map.rocks) {
    const terrain = terrainAt(map, Math.round(rock.x), Math.round(rock.y));
    if (terrain && FORBIDDEN_FOR_PROPS.has(terrain)) {
      problems.push({ kind: 'prop_on_forbidden', message: `камень на ${terrain}`, at: { x: rock.x, y: rock.y } });
    }
  }

  // Дверь обязана соединять два проходимых пространства.
  const doors: Point[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (terrainAt(map, x, y) !== 'door') continue;
      doors.push({ x, y });
      const sides = ADJACENT.filter(([dx, dy]) => isWalkable(terrainAt(map, x + dx, y + dy) ?? 'void')).length;
      if (sides < 2) problems.push({ kind: 'door_blocked', message: `дверь ${x}:${y} ведёт в стену`, at: { x, y } });
    }
  }
  stats.doors = doors.length;

  // Предметы склепа: непроходимые не должны перекрывать двери, а сами предметы —
  // стоять вне пола.
  for (const item of map.crypt ?? []) {
    for (let y = item.y; y < item.y + item.h; y += 1) {
      for (let x = item.x; x < item.x + item.w; x += 1) {
        const terrain = terrainAt(map, x, y);
        if (terrain === undefined) continue;
        if (CRYPT[item.kind]?.blocks && terrain === 'door') {
          problems.push({ kind: 'crypt_blocking_door', message: `${item.kind} перекрывает дверь ${x}:${y}`, at: { x, y } });
        }
        if (!isWalkable(terrain) && terrain !== 'door' && terrain !== 'wall' && terrain !== 'void' && CRYPT[item.kind]?.blocks) {
          problems.push({ kind: 'crypt_off_floor', message: `${item.kind} на ${terrain}`, at: { x, y } });
        }
      }
    }
  }

  // Каждый зал склепа должен быть обставлен: пустой зал — это провал композиции.
  if (map.biome === 'dungeon' && map.plan?.rooms?.length) {
    for (const room of map.plan.rooms) {
      if (room.bounds.w * room.bounds.h < 12) continue;
      const inside = (map.crypt ?? []).some((item) =>
        item.x >= room.bounds.x && item.y >= room.bounds.y
        && item.x < room.bounds.x + room.bounds.w && item.y < room.bounds.y + room.bounds.h);
      if (!inside) {
        problems.push({
          kind: 'crypt_room_empty',
          message: `зал ${room.id} (${room.purpose}) без обстановки`,
          at: { x: room.bounds.x + Math.floor(room.bounds.w / 2), y: room.bounds.y + Math.floor(room.bounds.h / 2) },
        });
      }
    }
  }

  // Вход в пещеру обязателен: без него карта неиграбельна.
  if (map.biome === 'cave') {
    let borderFloor = 0;
    for (let x = 0; x < map.width; x += 1) {
      if (isWalkable(terrainAt(map, x, 0) ?? 'void')) borderFloor += 1;
      if (isWalkable(terrainAt(map, x, map.height - 1) ?? 'void')) borderFloor += 1;
    }
    for (let y = 0; y < map.height; y += 1) {
      if (isWalkable(terrainAt(map, 0, y) ?? 'void')) borderFloor += 1;
      if (isWalkable(terrainAt(map, map.width - 1, y) ?? 'void')) borderFloor += 1;
    }
    if (borderFloor === 0) problems.push({ kind: 'entrance_missing', message: 'в пещере нет проёма на краю карты' });
  }

  // Композиционные предупреждения: POI без подхода — не поломка, но повод
  // показать автору карты, что центр остался в глуши.
  const warnings: string[] = [];
  const plan = map.plan;
  if (plan && plan.poi?.length) {
    const trails = (plan.roads ?? []).filter((path) => path.type === 'trail');
    // Залы склепа связаны коридорами и графом — для них подхода-тропы не бывает,
    // предупреждаем только про наземные композиционные центры.
    const approachTypes = new Set(['grove', 'clearing', 'camp', 'boulder_field']);
    for (const poi of plan.poi) {
      if (!approachTypes.has(poi.type)) continue;
      const near = trails.some((trail) => trail.points.some((point) =>
        Math.max(Math.abs(point.x - poi.x), Math.abs(point.y - poi.y)) <= 3));
      if (!near) warnings.push(`POI ${poi.id} (${poi.type}) остался без подхода: тропа не проложена`);
    }
  }
  if (plan?.spawn) {
    const spawnTerrain = terrainAt(map, plan.spawn.x, plan.spawn.y);
    if (!spawnTerrain || !isWalkable(spawnTerrain)) {
      warnings.push(`точка старта (${plan.spawn.x}:${plan.spawn.y}) стоит на ${spawnTerrain ?? 'краю карты'}`);
    }
  }
  if (plan?.rooms?.length && plan.graph?.length) {
    const roomCount = plan.rooms.length;
    const links = plan.graph.length;
    if (roomCount > 2 && links < roomCount - 1) {
      warnings.push(`граф залов неполный: ${links} связей на ${roomCount} залов`);
    }
  }

  // Мосты: ось настила обязана идти по дороге, а под настилом — вода.
  for (const bridge of map.plan?.bridges ?? []) {
    const road = (map.plan?.roads ?? []).find((path) => path.id === bridge.pathId);
    if (road && road.points.length > 1) {
      const index = road.points.findIndex((point) => Math.round(bridge.x - 0.5) === point.x && Math.round(bridge.y - 0.5) === point.y);
      const from = road.points[Math.max(0, (index > 0 ? index : 0) - 1)];
      const to = road.points[Math.min(road.points.length - 1, (index > 0 ? index : 0) + 1)];
      const tangent = Math.atan2(to.y - from.y, to.x - from.x);
      const delta = Math.abs(Math.atan2(Math.sin(bridge.angle - tangent), Math.cos(bridge.angle - tangent)));
      if (delta > (35 * Math.PI) / 180) {
        problems.push({ kind: 'bridge_misaligned', message: `мост ${bridge.id} повёрнут на ${Math.round((delta * 180) / Math.PI)}° от дороги`, at: { x: bridge.x, y: bridge.y } });
      }
    }
    for (const cell of bridge.cells) {
      const terrain = terrainAt(map, cell.x, cell.y);
      if (terrain !== 'bridge' && terrain !== 'water' && terrain !== 'deepWater') {
        problems.push({ kind: 'bridge_off_water', message: `мост ${bridge.id} лежит не над водой`, at: { x: cell.x, y: cell.y } });
        break;
      }
    }
  }

  return { ok: problems.length === 0, problems, warnings, stats };
}
