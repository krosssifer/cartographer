import type { MapData, Point, Terrain } from '../types';
import { emptyPlan } from './plan';
import type { MapComposition } from './composition';

/**
 * CompositionValidator — отдельный слой проверок ПОВЕРХ базового `validateMap`.
 *
 * Базовый валидатор отвечает на вопрос «можно ли по этой карте играть»
 * (проходимость, объекты не в воде, двери не замурованы). Этот отвечает на
 * вопрос «получилась ли сцена»: есть ли структура, читается ли дорога,
 * уместна ли река, растёт ли лес группами и достижимы ли боевые площадки.
 *
 * Категории соответствуют PATCH PROMPT: structure / road / river / forest /
 * gameplay. Проблемы блокирующие, замечания — нет (карта играбельна, но
 * композиция недоделана).
 */

export type CompositionCategory = 'structure' | 'road' | 'river' | 'forest' | 'gameplay';

export interface CompositionIssue {
  category: CompositionCategory;
  message: string;
  at?: Point;
}

export interface CompositionReport {
  ok: boolean;
  /** Сколько сидов/карт проверено. */
  checked: number;
  issues: CompositionIssue[];
  warnings: string[];
  stats: {
    spaces: number;
    masses: number;
    transitions: number;
    roadCells: number;
    waterCells: number;
    trees: number;
    rocks: number;
  };
}

const WALKABLE: ReadonlySet<Terrain> = new Set<Terrain>([
  'grass', 'darkGrass', 'dirt', 'mud', 'sand', 'snow', 'ice', 'road', 'bridge', 'plaza',
  'floor', 'door', 'buildingFloor', 'caveFloor',
]);

const isWalkable = (terrain: Terrain | undefined): boolean => (terrain ? WALKABLE.has(terrain) : false);
const isRoad = (terrain: Terrain | undefined): boolean => terrain === 'road' || terrain === 'bridge';
const isWater = (terrain: Terrain | undefined): boolean =>
  terrain === 'water' || terrain === 'deepWater' || terrain === 'ice';

const ADJACENT: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Диагонали: дорога шириной 2 клетки может соединяться «через угол». */
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const terrainAt = (map: MapData, x: number, y: number): Terrain | undefined => map.cells[y]?.[x]?.terrain;

/** Компоненты клеток, удовлетворяющих условию (4- или 8-связность). */
function components(map: MapData, match: (terrain: Terrain) => boolean, diagonal = false): number[][] {
  const seen = new Set<number>();
  const result: number[][] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const start = y * map.width + x;
      if (seen.has(start)) continue;
      if (!match(terrainAt(map, x, y) ?? 'void')) continue;
      const stack = [start];
      const bucket: number[] = [];
      seen.add(start);
      while (stack.length) {
        const at = stack.pop()!;
        bucket.push(at);
        const ax = at % map.width;
        const ay = Math.floor(at / map.width);
        for (const [dx, dy] of diagonal ? DIAGONAL : ADJACENT) {
          const nx = ax + dx;
          const ny = ay + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          const next = ny * map.width + nx;
          if (seen.has(next)) continue;
          if (!match(terrainAt(map, nx, ny) ?? 'void')) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      result.push(bucket);
    }
  }
  return result;
}

/** Все клетки, достижимые по проходимому террейну от стартовой точки. */
function reachable(map: MapData, from: Point): Set<number> {
  const seen = new Set<number>();
  const start = from.y * map.width + from.x;
  if (!isWalkable(terrainAt(map, from.x, from.y))) return seen;
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % map.width;
    const y = Math.floor(at / map.width);
    for (const [dx, dy] of ADJACENT) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = ny * map.width + nx;
      if (seen.has(next)) continue;
      if (!isWalkable(terrainAt(map, nx, ny))) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

const compositionOf = (map: MapData): MapComposition | undefined => map.plan?.composition;

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Проверка одной карты. Возвращает проблемы и замечания по пяти категориям. */
export function validateCompositionMap(map: MapData): CompositionReport {
  const issues: CompositionIssue[] = [];
  const warnings: string[] = [];
  const composition = compositionOf(map);
  const plan = map.plan ?? emptyPlan();
  const total = map.width * map.height;

  let roadCells = 0;
  let waterCells = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const terrain = terrainAt(map, x, y);
      if (isRoad(terrain)) roadCells += 1;
      if (isWater(terrain)) waterCells += 1;
    }
  }

  const stats = {
    spaces: composition?.openSpaces.length ?? 0,
    masses: composition?.masses.length ?? 0,
    transitions: composition?.transitions.length ?? 0,
    roadCells,
    waterCells,
    trees: map.trees.length,
    rocks: map.rocks.length,
  };

  // ---- structure -----------------------------------------------------------
  if (composition) {
    const battle = composition.openSpaces.filter((space) => space.kind === 'battle_area');
    if (composition.openSpaces.length > 0 && battle.length === 0
      && (map.biome === 'forest' || map.biome === 'plains' || map.biome === 'cave' || map.biome === 'town')) {
      issues.push({ category: 'structure', message: 'в композиции нет главного открытого пространства (battle_area)' });
    }
    for (const space of composition.openSpaces) {
      if (space.x - space.radius < 0 || space.y - space.radius < 0
        || space.x + space.radius >= map.width || space.y + space.radius >= map.height) {
        warnings.push(`пространство ${space.id} выходит за край карты`);
      }
      // Пространство обязано быть пригодным для боя: большая часть его ядра —
      // проходимый грунт (точка центра может попасть на камень/воду — это не приговор).
      const coreRadius = Math.max(1, Math.round(space.radius * 0.6));
      let coreTotal = 0;
      let coreWalkable = 0;
      for (let dy = -coreRadius; dy <= coreRadius; dy += 1) {
        for (let dx = -coreRadius; dx <= coreRadius; dx += 1) {
          if (Math.hypot(dx, dy) > coreRadius) continue;
          const x = Math.round(space.x) + dx;
          const y = Math.round(space.y) + dy;
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          coreTotal += 1;
          if (isWalkable(terrainAt(map, x, y))) coreWalkable += 1;
        }
      }
      const walkableShare = coreTotal ? coreWalkable / coreTotal : 0;
      if (walkableShare < 0.55) {
        issues.push({
          category: 'structure',
          message: `пространство ${space.id} непригодно для боя: проходимо ${(walkableShare * 100).toFixed(0)} % ядра`,
          at: { x: Math.round(space.x), y: Math.round(space.y) },
        });
      }
    }
    for (let i = 0; i < composition.openSpaces.length; i += 1) {
      for (let j = i + 1; j < composition.openSpaces.length; j += 1) {
        const a = composition.openSpaces[i];
        const b = composition.openSpaces[j];
        if (distance(a, b) < (a.radius + b.radius) * 0.55) {
          warnings.push(`пространства ${a.id} и ${b.id} слишком близко (${distance(a, b).toFixed(1)} кл.)`);
        }
      }
    }
    if (composition.masses.length === 0 && map.biome === 'forest') {
      warnings.push('в лесной сцене нет массивов леса (masses)');
    }
  } else if (map.biome === 'forest' || map.biome === 'plains') {
    warnings.push('у поверхностной карты нет композиции');
  }

  // ---- road ---------------------------------------------------------------
  if (roadCells > 0) {
    const roadParts = components(map, (terrain) => isRoad(terrain), true);
    if (roadParts.length > 1) {
      const largest = roadParts.reduce((best, part) => (part.length > best.length ? part : best), roadParts[0]);
      const detached = roadParts.filter((part) => part !== largest).reduce((sum, part) => sum + part.length, 0);
      if (detached > 2) {
        issues.push({ category: 'road', message: `дорога распалась на ${roadParts.length} частей (${detached} клеток в отрыве)` });
      }
    }
    // Тупики: клетка дороги с одним соседом-дорогой, не у края и не у площадки.
    const yardCenters = (composition?.openSpaces ?? []).filter((space) => space.kind === 'yard' || space.kind === 'battle_area');
    let deadEnds = 0;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (!isRoad(terrainAt(map, x, y))) continue;
        let neighbours = 0;
        for (const [dx, dy] of ADJACENT) {
          if (isRoad(terrainAt(map, x + dx, y + dy))) neighbours += 1;
        }
        if (neighbours > 1) continue;
        const atBorder = x <= 1 || y <= 1 || x >= map.width - 2 || y >= map.height - 2;
        const nearSpace = yardCenters.some((space) => Math.hypot(space.x - x, space.y - y) <= space.radius + 2.5);
        if (!atBorder && !nearSpace) deadEnds += 1;
      }
    }
    if (deadEnds > 1) warnings.push(`дорога обрывается в пустоте: ${deadEnds} тупиков`);
  }

  // ---- river --------------------------------------------------------------
  const sceneRiver = plan.scene?.river;
  const waterShare = waterCells / total;
  if (sceneRiver) {
    if (waterShare < 0.06 || waterShare > 0.24) {
      issues.push({
        category: 'river',
        message: `покрытие реки ${(waterShare * 100).toFixed(1)} % выходит из диапазона 6–24 %`,
      });
    }
    const waterParts = components(map, (terrain) => isWater(terrain));
    if (waterParts.length > 3) {
      warnings.push(`водоёмов больше трёх (${waterParts.length}); лишние пятна стоит убрать`);
    }
    if (roadCells > 0 && (plan.bridges?.length ?? 0) === 0) {
      issues.push({ category: 'river', message: 'река и дорога есть, но переправы не спроектированы' });
    }
  } else if (waterShare > 0.02) {
    warnings.push(`реки в сцене нет, а вода занимает ${(waterShare * 100).toFixed(1)} %`);
  }

  // ---- forest -------------------------------------------------------------
  const battle = composition?.openSpaces.find((space) => space.kind === 'battle_area');
  if (battle) {
    const canopyInside = map.trees.filter((tree) => Math.hypot(tree.x - battle.x, tree.y - battle.y) < battle.radius * 0.7).length;
    if (canopyInside > 0) {
      issues.push({
        category: 'forest',
        message: `в боевой поляне ${battle.id} стоят деревья: ${canopyInside}`,
        at: { x: Math.round(battle.x), y: Math.round(battle.y) },
      });
    }
  }
  if (map.biome === 'forest' && map.trees.length >= 12) {
    const nearest = map.trees.map((tree) => {
      let best = Infinity;
      for (const other of map.trees) {
        if (other === tree) continue;
        best = Math.min(best, Math.hypot(other.x - tree.x, other.y - tree.y));
      }
      return best;
    });
    const sorted = [...nearest].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median > 3.2) warnings.push(`деревья стоят слишком редко (медиана ${median.toFixed(2)} кл.)`);
    const loners = nearest.filter((value) => value > 4).length / nearest.length;
    if (loners > 0.25) warnings.push(`много одиночных деревьев: ${(loners * 100).toFixed(0)} %`);
  }

  // ---- gameplay -----------------------------------------------------------
  const spawn = plan.spawn ?? plan.poi.find((poi) => poi.type === 'entrance') ?? { x: 0, y: 0 };
  const reach = reachable(map, spawn);
  if (reach.size === 0) {
    issues.push({ category: 'gameplay', message: 'от точки старта нечего достичь: старт на непроходимой клетке', at: spawn });
  } else {
    for (const space of composition?.openSpaces ?? []) {
      // Достижимо ли хоть одно проходимое место внутри пространства.
      const probe = Math.max(1, Math.round(space.radius * 0.6));
      let anyReachable = false;
      for (let dy = -probe; dy <= probe && !anyReachable; dy += 1) {
        for (let dx = -probe; dx <= probe && !anyReachable; dx += 1) {
          if (Math.hypot(dx, dy) > probe) continue;
          const x = Math.round(space.x) + dx;
          const y = Math.round(space.y) + dy;
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          if (reach.has(y * map.width + x)) anyReachable = true;
        }
      }
      if (!anyReachable) {
        issues.push({
          category: 'gameplay',
          message: `от старта не дойти до пространства ${space.id}`,
          at: { x: Math.round(space.x), y: Math.round(space.y) },
        });
      }
    }
    const unreachableRoad = (() => {
      if (roadCells === 0) return 0;
      let count = 0;
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (!isRoad(terrainAt(map, x, y))) continue;
          if (!reach.has(y * map.width + x)) count += 1;
        }
      }
      return count;
    })();
    if (unreachableRoad > roadCells * 0.15) {
      warnings.push(`часть дороги недостижима от старта: ${unreachableRoad} из ${roadCells}`);
    }
  }

  return { ok: issues.length === 0, checked: 1, issues, warnings, stats };
}

/** Прогон по набору карт: суммарный отчёт для CompositionValidator. */
export function validateCompositionAcross(maps: MapData[]): CompositionReport {
  const issues: CompositionIssue[] = [];
  const warnings: string[] = [];
  const stats = { spaces: 0, masses: 0, transitions: 0, roadCells: 0, waterCells: 0, trees: 0, rocks: 0 };
  for (const map of maps) {
    const report = validateCompositionMap(map);
    for (const issue of report.issues) issues.push(issue);
    for (const warning of report.warnings) warnings.push(warning);
    stats.spaces += report.stats.spaces;
    stats.masses += report.stats.masses;
    stats.transitions += report.stats.transitions;
    stats.roadCells += report.stats.roadCells;
    stats.waterCells += report.stats.waterCells;
    stats.trees += report.stats.trees;
    stats.rocks += report.stats.rocks;
  }
  return { ok: issues.length === 0, checked: maps.length, issues, warnings, stats };
}
