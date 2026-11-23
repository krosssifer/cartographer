import type { Cell, GenSettings, Point, Rock, Terrain, Tree, TreeKind } from '../types';
import { biomePoiCount, biomePois, pickVegetation, roadClearance } from './catalog';
import { OccupancyGrid, SpatialHash, catalogEntry } from './occupancy';
import type { GenerationPlan, GroupType, ObjectGroup, Poi, RoadPath } from './plan';
import { emptyPlan } from './plan';
import { SeededRandom } from './random';
import { buildZoneField, type ZoneField } from './zones';
import {
  buildComposition,
  compositionDensity,
  insideOpenSpace,
  massInfluence,
  transitionInfluence,
  type MapComposition,
} from './composition';

export interface ValidationReport {
  connectivity: number;
  overlap: number;
  density: number;
  composition: number;
  diversity: number;
  readability: number;
  problems: string[];
}

/** Управление растительностью со стороны сцены-архетипа (scenes.ts). */
export interface VegetationOptions {
  /** Готовая композиция сцены вместо автоматической. */
  composition?: MapComposition;
  /** Множители бюджетов крон, подлеска и камней. */
  canopy?: number;
  undergrowth?: number;
  rocks?: number;
  /** Плодородие 0..1 по клеткам (landscape.ts). */
  fertility?: Float32Array;
  /** Кольцо деревьев вокруг главной поляны (по умолчанию есть). */
  arenaRing?: boolean;
  /** Тропы от тракта к POI (по умолчанию есть; у сцены к фокусу ведёт своё ответвление). */
  trails?: boolean;
  /** Прямоугольники сюжетных построек: растительность их обходит. */
  reserved?: { x: number; y: number; w: number; h: number }[];
}

export interface VegetationResult {
  trees: Tree[];
  rocks: Rock[];
  plan: GenerationPlan;
  report: ValidationReport;
}

const HARD_BLOCKED: Terrain[] = ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'door', 'void'];

const terrainAt = (cells: Cell[][], x: number, y: number): Terrain => cells[y][x].terrain;

/**
 * Держит координату объекта внутри его клетки-якоря: после округления позиция
 * обязана попасть ровно в anchorCell, иначе проверки террейна/занятости врут.
 */
function clampToCell(value: number, anchorCell: number): number {
  const min = anchorCell - 0.45;
  const max = anchorCell + 0.45;
  return Math.min(max, Math.max(min, value));
}

/** Джиттер не должен выносить объект за пределы карты (крайние клетки). */
function clampToMap(value: number, size: number): number {
  return Math.min(size - 0.06, Math.max(0.06, value));
}

/** Форма камня: тот же принцип, что в старом rockPolygon, но на SeededRandom. */
function rockPolygon(rng: SeededRandom, radius: number): [number, number][] {
  const count = rng.int(5, 8);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const scaled = radius * (0.7 + rng.next() * 0.4);
    points.push([Math.cos(angle) * scaled, Math.sin(angle) * scaled * 0.8]);
  }
  return points;
}

/**
 * Структурная растительность: зоны → POI → группы → отдельные объекты.
 *
 * Это замена цикла «на каждой клетке бросить вероятность и поставить спрайт».
 * Решение принимается сначала для зоны и композиции, и только потом — для
 * конкретной клетки, с проверкой занятости и минимальных расстояний.
 */
export function generateStructuredVegetation(
  settings: GenSettings,
  cells: Cell[][],
  river: Point[],
  road: Point[],
  structures: { x: number; y: number; w: number; h: number; ruin: boolean }[] = [],
  options: VegetationOptions = {},
): VegetationResult {
  const { width, height } = settings;
  const rng = new SeededRandom(settings.seed, 0x5eed);
  const zones = buildZoneField(settings, cells, river, road);
  // Сцена-архетип: плодородие рельефа (влажность, крутизна, близость воды)
  // модулирует плотность зон — лес гуще в сырых низинах и реже на склонах.
  if (options.fertility) {
    for (let index = 0; index < zones.density.length; index += 1) {
      zones.density[index] = Math.max(0, Math.min(1, zones.density[index] * (0.3 + options.fertility[index] * 1.05)));
    }
  }
  const occupancy = OccupancyGrid.fromMap(width, height, (x, y) => terrainAt(cells, x, y), (terrain) =>
    HARD_BLOCKED.includes(terrain as Terrain),
  );
  // Дорога и берег реки недоступны для стволов: держимся на расстоянии от кромки.
  for (const point of road) markCell(occupancy, point.x, point.y);
  for (const point of river) markCell(occupancy, point.x, point.y);
  for (const rect of options.reserved ?? []) {
    for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y += 1) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x += 1) {
        if (x >= 0 && y >= 0 && x < width && y < height) markCell(occupancy, x, y);
      }
    }
  }

  // Дистанция до дороги: кроны крупных деревьев не должны свисать на полотно.
  // BFS от всех клеток road/bridge, не глубже 6 клеток.
  const computeRoadDist = (): Int16Array => {
    const distance = new Int16Array(width * height).fill(99);
    const queue: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const terrain = cells[y][x].terrain;
        if (terrain === 'road' || terrain === 'bridge') {
          distance[y * width + x] = 0;
          queue.push(y * width + x);
        }
      }
    }
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const current = distance[index];
      if (current >= 6) continue;
      const px = index % width;
      const node = (index - px) / width;
      const next = current + 1;
      const neighbours: [number, number][] = [[px + 1, node], [px - 1, node], [px, node + 1], [px, node - 1]];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (distance[ni] <= next) continue;
        distance[ni] = next;
        queue.push(ni);
      }
    }

    return distance;
  };
  let roadDist = computeRoadDist();

  const spatial = new SpatialHash(2);
  const trees: Tree[] = [];
  /** Есть ли дерево в радиусе двух клеток (для грибов у корней). */
  const treeNearby = (x: number, y: number): boolean => {
    const reach = 2.4;
    for (let i = trees.length - 1; i >= 0 && i >= trees.length - 80; i -= 1) {
      const tree = trees[i];
      if (tree.kind === 'bush' || tree.kind === 'mushroom') continue;
      if (Math.abs(tree.x - x) <= reach && Math.abs(tree.y - y) <= reach) return true;
    }
    return false;
  };

  const rocks: Rock[] = [];
  const plan: GenerationPlan = emptyPlan();
  plan.zones = zones.zones;
  // Композиция строится ДО объектов: сначала пространства и переходы, потом декор.
  const composition: MapComposition = options.composition ?? buildComposition({
    settings: { width, height, biome: settings.biome, seed: settings.seed },
    map: { width, height, cells },
    river,
    road,
    zones,
    rng,
    structures,
  });
  plan.composition = composition;
  const groups: ObjectGroup[] = [];

  const groupPlan = (type: GroupType, x: number, y: number, placed: number) => {
    const group: ObjectGroup = { id: `${type}_${groups.length}`, type, x, y, placed };
    groups.push(group);
    return group;
  };

  const plant = (kind: TreeKind, cx: number, cy: number, tight: boolean): Tree | null => {
    const entry = catalogEntry(kind);
    // Джиттер вычисляем ДО проверки: якорь обязан совпадать с той клеткой,
    // в которую попадёт сохранённая позиция после округления (иначе объект
    // может формально встать в стену соседней клетки).
    const x = Math.round(cx);
    const y = Math.round(cy);
    const jitterX = clampToMap(clampToCell(cx + (rng.next() - 0.5) * 0.55, x), width);
    const jitterY = clampToMap(clampToCell(cy + (rng.next() - 0.5) * 0.55, y), height);
    if (!zones.has(x, y)) return null;
    const terrain = terrainAt(cells, x, y);
    if (!entry.preferredTerrain.includes(terrain)) return null;
    if (!occupancy.canPlace(entry, x, y, false)) return null;
    // Кроны: держим крупные деревья так, чтобы они не нависали над полотном.
    if (roadDist[y * width + x] < roadClearance(kind)) return null;
    const spacing = tight ? entry.minDistance * 0.62 : entry.minDistance * 0.92;
    if (spatial.tooClose(jitterX, jitterY, entry.id, spacing)) return null;
    const radius = rng.range(entry.radius[0], entry.radius[1]);
    const tree: Tree = { x: jitterX, y: jitterY, r: radius, kind, v: rng.next() };
    trees.push(tree);
    occupancy.place(entry, x, y);
    spatial.add({ x: jitterX, y: jitterY, kind: entry.id, radius: radius * 2.1 });
    return tree;
  };

  /** Растение, уместное в текущем биоме (для композиционных групп). */
  const biomeKind = (zone: ReturnType<ZoneField['typeAt']>, fallback: TreeKind): TreeKind =>
    pickVegetation(rng, settings.biome, zone) ?? fallback;

  const dropRock = (kind: 'rock' | 'smallRock' | 'boulder', cx: number, cy: number): Rock | null => {
    const entry = catalogEntry(kind);
    const x = Math.round(cx);
    const y = Math.round(cy);
    const jitterX = clampToMap(clampToCell(cx + (rng.next() - 0.5) * 0.4, x), width);
    const jitterY = clampToMap(clampToCell(cy + (rng.next() - 0.5) * 0.4, y), height);
    if (!zones.has(x, y)) return null;
    const terrain = terrainAt(cells, x, y);
    if (!entry.preferredTerrain.includes(terrain)) return null;
    if (!occupancy.canPlace(entry, x, y, false)) return null;
    if (roadDist[y * width + x] < roadClearance(kind)) return null;
    if (spatial.tooClose(jitterX, jitterY, entry.id, entry.minDistance * 0.75)) return null;
    const radius = rng.range(entry.radius[0], entry.radius[1]);
    const rock: Rock = {
      x: jitterX,
      y: jitterY,
      r: radius,
      pts: rockPolygon(rng, radius),
      v: kind === 'smallRock' ? 0.8 + rng.next() * 0.2 : rng.next() * 0.66,
    };
    rocks.push(rock);
    occupancy.place(entry, x, y);
    spatial.add({ x: rock.x, y: rock.y, kind: entry.id, radius: radius * 2.4 });
    return rock;
  };

  // ---- POI: композиционные центры -----------------------------------------
  const pois = pickPois(settings, zones, cells, road, rng, composition);
  plan.poi = pois;

  // ---- Арена: главная поляна для боя ---------------------------------------
  // По правилам хороших боевых карт пространство боя важнее декора: держим
  // одну большую открытую поляну (к ней ведут тропы) и не застраиваем её.
  const arena = pois.find((poi) => poi.type === 'clearing');
  const arenaRadius = arena ? Math.max(3, poiRadius(arena)) : 0;
  const inArena = (x: number, y: number): boolean =>
    Boolean(arena) && Math.hypot(x - arena!.x, y - arena!.y) < arenaRadius + 0.6;
  // Открытые пространства композиции неприкосновенны: это игровые площадки,
  // а не «пустые клетки под декор».
  for (const space of composition.openSpaces) {
    const reserve = Math.ceil(space.radius + 0.5);
    for (let dy = -reserve; dy <= reserve; dy += 1) {
      for (let dx = -reserve; dx <= reserve; dx += 1) {
        const x = Math.round(space.x) + dx;
        const y = Math.round(space.y) + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.hypot(dx, dy) <= space.radius + 0.5) occupancy.set(x, y, 2);
      }
    }
  }
  if (arena) {
    const reserve = Math.ceil(arenaRadius + 0.5);
    for (let dy = -reserve; dy <= reserve; dy += 1) {
      for (let dx = -reserve; dx <= reserve; dx += 1) {
        const x = arena.x + dx;
        const y = arena.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.hypot(dx, dy) <= arenaRadius + 0.5) occupancy.set(x, y, 2);
      }
    }
  }


  // ---- Валуны-анкоры -------------------------------------------------------
  // Ставятся ДО крон: у валуна должен остаться свободный 2x2 футпринт,
  // а деревья потом обходят его через occupancy. Вокруг валуна вырастет мелочь.
  for (const mass of composition.masses) {
    if (!rng.chance(0.75)) continue;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = (attempt / 8) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const distance = mass.radius * rng.range(0.7, 1.05);
      if (dropRock('boulder', mass.x + Math.cos(angle) * distance, mass.y + Math.sin(angle) * distance)) break;
    }
  }

  // ---- Тропы к композиционным центрам ------------------------------------
  // От магистрали к рощам, лагерям и полянам: одна клетка шириной, только по
  // «мягкому» грунту. Так POI достижимы пешком и не висят в чистом поле.
  const trails: RoadPath[] = [];
  const TRAIL_COST: Partial<Record<Terrain, number>> = {
    grass: 1, darkGrass: 1, dirt: 1, sand: 1, snow: 1.2, rock: 1.6,
    mud: 2.4, ice: 1.8, water: 40, deepWater: 55, road: 1, bridge: 1,
  };
  const TRAIL_STEPS: readonly (readonly [number, number, number])[] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.42], [1, -1, 1.42], [-1, 1, 1.42], [-1, -1, 1.42],
  ];
  const findTrailPath = (from: Point): { points: Point[]; bridges: number } | null => {
    const total = width * height;
    const cost = new Float64Array(total).fill(Infinity);
    const previous = new Int32Array(total).fill(-1);
    const done = new Uint8Array(total);
    const heap: { node: number; value: number }[] = [];
    const push = (node: number, value: number): void => {
      heap.push({ node, value });
      let index = heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].value <= heap[index].value) break;
        [heap[parent], heap[index]] = [heap[index], heap[parent]];
        index = parent;
      }
    };
    const pop = (): { node: number; value: number } => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          if (left < heap.length && heap[left].value < heap[smallest].value) smallest = left;
          if (right < heap.length && heap[right].value < heap[smallest].value) smallest = right;
          if (smallest === index) break;
          [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
          index = smallest;
        }
      }
      return top;
    };
    const startNode = from.y * width + from.x;
    cost[startNode] = 0;
    push(startNode, 0);
    let targetNode = -1;
    while (heap.length) {
      const { node, value } = pop();
      if (done[node]) continue;
      done[node] = 1;
      const x = node % width;
      const y = (node - x) / width;
      const terrain = cells[y][x].terrain;
      if (node !== startNode && (terrain === 'road' || terrain === 'bridge')) {
        targetNode = node;
        break;
      }
      if (value > 400) continue;
      for (const [dx, dy, weight] of TRAIL_STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
        const next = ny * width + nx;
        const step = TRAIL_COST[cells[ny][nx].terrain];
        if (step === undefined || done[next]) continue;
        // Диагональ рубим только если оба прямых соседа проходимы: иначе тропа
        // срезала бы угол стены/воды и выглядела бы дырой в рельефе.
        if (dx !== 0 && dy !== 0) {
          const sideA = TRAIL_COST[cells[y][nx].terrain];
          const sideB = TRAIL_COST[cells[ny][x].terrain];
          if (sideA === undefined || sideB === undefined) continue;
        }
        const candidate = value + step * weight;
        if (candidate >= cost[next]) continue;
        cost[next] = candidate;
        previous[next] = node;
        push(next, candidate);
      }
    }
    if (targetNode < 0) return null;
    const points: Point[] = [];
    let node = targetNode;
    while (node !== startNode && node >= 0) {
      const x = node % width;
      const y = (node - x) / width;
      points.push({ x, y });
      node = previous[node];
    }
    points.reverse();
    if (points.length < 4) return null;
    const bridges = points.reduce((sum, point) => {
      const terrain = cells[point.y][point.x].terrain;
      return sum + (terrain === 'water' || terrain === 'deepWater' ? 1 : 0);
    }, 0);
    if (bridges > 4) return null;
    return { points, bridges };
  };
  const carveTrail = (origin: { x: number; y: number }): void => {
    const found = findTrailPath({ x: Math.round(origin.x), y: Math.round(origin.y) });
    if (!found) return;
    for (const point of found.points) {
      const terrain = cells[point.y][point.x].terrain;
      if (terrain === 'road' || terrain === 'bridge') continue;
      const wet = terrain === 'water' || terrain === 'deepWater';
      cells[point.y][point.x] = { ...cells[point.y][point.x], terrain: wet ? 'bridge' : 'dirt' };
      occupancy.set(point.x, point.y, 2);
    }
    trails.push({ id: `trail_${trails.length}`, type: 'trail', width: 1, points: found.points, bridges: found.bridges });
  };
  for (const poi of options.trails === false ? [] : pois) {
    if (poi.type === 'grove' || poi.type === 'camp' || poi.type === 'clearing' || poi.type === 'boulder_field') carveTrail(poi);
  }
  if (trails.length) roadDist = computeRoadDist();
  plan.roads = trails;

  // ---- Дворы: обломки по краю и тропа к дороге ---------------------------
  // Двор уже зарезервирован как открытое пространство (внутри растительности
  // нет), а по кромке ставим обломки кладки — это «след постройки».
  const yardSpaces = composition.openSpaces.filter((space) => space.kind === 'yard');
  const findYardStart = (space: { x: number; y: number; radius: number }): Point | null => {
    for (let ring = 0.6; ring <= space.radius + 1.2; ring += 0.8) {
      for (let step = 0; step < 24; step += 1) {
        const angle = (step / 24) * Math.PI * 2;
        const x = Math.round(space.x + Math.cos(angle) * (space.radius + ring));
        const y = Math.round(space.y + Math.sin(angle) * (space.radius + ring));
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
        const terrain = cells[y][x].terrain;
        if (terrain === 'road' || terrain === 'bridge') continue;
        if (TRAIL_COST[terrain] === undefined) continue;
        return { x, y };
      }
    }
    return null;
  };
  for (let index = 0; index < yardSpaces.length; index += 1) {
    const yard = yardSpaces[index];
    const debrisCount = 5 + Math.floor(rng.range(0, 4));
    let debris = 0;
    // Кандидаты по кольцу двора: фиксированные углы, чтобы обломки лежали
    // именно по кромке, а не «где получилось». Два прохода: сначала обычные
    // требования к соседям, затем ослабленные — двор не должен остаться пустым.
    const ring = (step: number, total: number, spread: number): { x: number; y: number } => {
      const angle = (step / total) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const distance = yard.radius + spread;
      return { x: yard.x + Math.cos(angle) * distance, y: yard.y + Math.sin(angle) * distance };
    };
    for (let step = 0; step < debrisCount * 3 && debris < debrisCount; step += 1) {
      const spot = ring(step, debrisCount * 3, rng.range(0.4, 1.6));
      if (dropRock('smallRock', spot.x, spot.y)) debris += 1;
    }
    if (debris < 3) {
      // Тесный двор (например, между домами): добираем обломки вплотную.
      for (let step = 0; step < 12 && debris < 3; step += 1) {
        const spot = ring(step, 12, rng.range(0.2, 0.9));
        if (dropRock('smallRock', spot.x, spot.y)) debris += 1;
      }
    }
    groupPlan('clearing_edge', yard.x, yard.y, debris);
    // Двор должен читаться как место, куда можно прийти: тянем тропу к дороге.
    const start = findYardStart(yard);
    if (start) {
      // Заросли по внешнему краю двора: руина не должна стоять «на газоне».
      // Один сектор оставляем открытым — там начинается тропа (подход).
      const approach = Math.atan2(start.y - yard.y, start.x - yard.x);
      const overgrowthCount = 7;
      for (let step = 0; step < overgrowthCount; step += 1) {
        const angle = approach + 0.7 + (step / overgrowthCount) * (Math.PI * 2 - 1.4);
        const distance = yard.radius + rng.range(1.0, 2.3);
        const px = yard.x + Math.cos(angle) * distance;
        const py = yard.y + Math.sin(angle) * distance;
        if (insideOpenSpace(composition, px, py, 0)) continue;
        plant(rng.chance(0.7) ? 'bush' : 'mushroom', px, py, true);
      }
      carveTrail(start);
    }
  }
  if (yardSpaces.length && trails.length) {
    plan.roads = trails;
    roadDist = computeRoadDist();
  }

  for (const poi of pois) {
    const zone = zones.typeAt(poi.x, poi.y);
    const count = Math.max(3, Math.round(poi.radius * 2.4));
    if (poi.type === 'grove') {
      const kind = pickVegetation(rng, settings.biome, zone) ?? 'oak';
      let placed = 0;
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const distance = rng.range(0.6, poi.radius);
        if (plant(kind, poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, true)) placed += 1;
      }
      groupPlan('forest_cluster', poi.x, poi.y, placed);
    } else if (poi.type === 'boulder_field') {
      dropRock('boulder', poi.x, poi.y);
      let placed = 1;
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const distance = rng.range(1, poi.radius + 1.5);
        if (dropRock(rng.chance(0.65) ? 'smallRock' : 'rock', poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance)) placed += 1;
      }
      for (let i = 0; i < 3; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        if (plant('bush', poi.x + Math.cos(angle) * (poi.radius + 0.8), poi.y + Math.sin(angle) * (poi.radius + 0.8), true)) placed += 1;
      }
      groupPlan('boulder_scene', poi.x, poi.y, placed);
    } else if (poi.type === 'camp') {
      // Кольцо камней и сушняка вокруг открытой площадки.
      let placed = 0;
      for (let i = 0; i < 7; i += 1) {
        const angle = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const distance = poi.radius + rng.range(-0.3, 0.6);
        if (rng.chance(0.5)) {
          if (dropRock('smallRock', poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance)) placed += 1;
        } else if (plant(biomeKind(zone, 'bush'), poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, true)) placed += 1;
      }
      groupPlan('fallen_tree_scene', poi.x, poi.y, placed);
    } else {
      // Поляна: центр оставляем открытым, по кромке — редкая растительность.
      let placed = 0;
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2 + rng.range(-0.25, 0.25);
        const distance = poi.radius + rng.range(0.4, 1.2);
        if (plant(biomeKind(zone, 'bush'), poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, true)) placed += 1;
      }
      groupPlan('clearing_edge', poi.x, poi.y, placed);
    }
  }

  // ---- Полоса вдоль дороги: редкие кусты и камни на обочине ---------------
  if (road.length > 6) {
    let placed = 0;
    for (let i = 4; i < road.length - 4; i += 1) {
      if (!rng.chance(0.5)) continue;
      const point = road[i];
      const previous = road[i - 1];
      const stepX = point.x - previous.x;
      const stepY = point.y - previous.y;
      // Нормаль к направлению тракта — обочина сбоку, а не поверх полотна.
      const normalX = stepY === 0 ? 0 : 1;
      const normalY = stepX === 0 ? 0 : 1;
      if (normalX === 0 && normalY === 0) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const distance = rng.range(2.5, 3.8);
      const targetX = point.x + normalX * distance * side;
      const targetY = point.y + normalY * distance * side;
      if (rng.chance(0.65)) {
        if (plant(biomeKind('roadside', 'bush'), targetX, targetY, true)) placed += 1;
      } else if (dropRock('smallRock', targetX, targetY)) placed += 1;
    }
    if (placed) groupPlan('roadside_line', road[0].x, road[0].y, placed);
  }

  // ---- Оправа арены: деревья по кольцу вокруг поляны -----------------------
  // Без этого арена висит в пустом поле. Кольцо из крон делает её «просветом
  // в лесу», как на нормальных боевых картах, и даёт укрытия по краям.
  // Своё ограничение по количеству, чтобы не съедать бюджет крон.
  if (arena && options.arenaRing !== false) {
    let ringPlaced = 0;
    const ringLimit = Math.max(8, Math.round(arenaRadius * 3.2));
    const ringRadius = arenaRadius + 1.4;
    const steps = Math.max(12, Math.round(ringRadius * 8));
    for (let i = 0; i < steps && ringPlaced < ringLimit; i += 1) {
      const angle = (i / steps) * Math.PI * 2 + rng.range(-0.14, 0.14);
      const distance = ringRadius + rng.range(0, 2.2);
      const x = arena.x + Math.cos(angle) * distance;
      const y = arena.y + Math.sin(angle) * distance;
      if (inArena(x, y)) continue;
      if (!rng.chance(0.8)) continue;
      const zone = zones.typeAt(Math.round(x), Math.round(y));
      const kind = rng.chance(0.7) ? biomeKind(zone, 'oak') : biomeKind(zone, 'bush');
      if (plant(kind, x, y, kind === 'bush' || kind === 'mushroom')) ringPlaced += 1;
    }
    if (ringPlaced) groupPlan('clearing_edge', arena.x, arena.y, ringPlaced);
  }

  // ---- Массы леса: не «ковёр», а группы с просветами ------------------------
  // Кроны у нас широкие (2–3 клетки), поэтому плотность ограничиваем не только
  // вероятностью, но и бюджетом: иначе карта превращается в сплошную листву.
  const area = width * height;
  // Бюджет подобран по площади кроны: при 2–3-клеточных кронах 0.035 даёт
  // ~40 % покрытия — лес читается, но остаётся место для боя.
  const canopyBudget = Math.max(options.composition ? 0 : 18, Math.round(area * 0.075 * (0.6 + settings.vegetation * 0.8) * (options.canopy ?? 1)));
  const undergrowthBudget = Math.max(options.composition ? 0 : 8, Math.round(area * 0.025 * (0.6 + settings.vegetation * 0.8) * (options.undergrowth ?? 1)));
  let canopyPlaced = 0;
  let undergrowthPlaced = 0;
  const isUndergrowth = (kind: TreeKind): boolean => kind === 'bush' || kind === 'mushroom';

  // Кластерная расстановка: лес растёт группами, а не «ковром».
  // Кластеры строятся из масс композиции (ядро + спутники) и нескольких
  // свободных групп в среднем лесу; внутри кластера есть просветы.
  interface CanopyCluster {
    x: number;
    y: number;
    radius: number;
    weight: number;
  }
  const clusters: CanopyCluster[] = [];
  for (const mass of composition.masses) {
    const subCount = 2 + Math.round(mass.strength * 2);
    for (let index = 0; index < subCount; index += 1) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = mass.radius * rng.range(0.2, 0.85);
      clusters.push({
        x: mass.x + Math.cos(angle) * distance,
        y: mass.y + Math.sin(angle) * distance,
        radius: Math.max(1.5, mass.radius * rng.range(0.3, 0.5)),
        weight: 1,
      });
    }
  }
  const freeClusters = Math.max(0, Math.round(area / 850) - clusters.length);
  for (let index = 0; index < freeClusters; index += 1) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const cx = 2 + rng.range(0, width - 4);
      const cy = 2 + rng.range(0, height - 4);
      const cellX = Math.round(cx);
      const cellY = Math.round(cy);
      const density = compositionDensity(composition, cellX, cellY, zones.densityAt(cellX, cellY));
      if (density < 0.16 || density > 0.72) continue;
      clusters.push({ x: cx, y: cy, radius: rng.range(1.5, 3.1), weight: 0.65 });
      break;
    }
  }
  const totalWeight = clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
  const canopyPerWeight = totalWeight > 0 ? canopyBudget / totalWeight : 0;

  for (const cluster of clusters) {
    if (canopyPlaced >= canopyBudget) break;
    const clusterTrees = Math.max(1, Math.round(canopyPerWeight * cluster.weight));
    // Радиус кластера выводим из числа деревьев: группе нужно место.
    const spread = Math.max(cluster.radius, Math.sqrt(clusterTrees / Math.PI) * 1.55);
    let clusterPlaced = 0;
    for (let attempt = 0; attempt < clusterTrees * 8 && clusterPlaced < clusterTrees; attempt += 1) {
      if (canopyPlaced >= canopyBudget) break;
      // Равномерная точка в круге: sqrt(r) — без сгущения к центру.
      const angle = rng.range(0, Math.PI * 2);
      const distance = spread * Math.sqrt(rng.next());
      const tx = cluster.x + Math.cos(angle) * distance;
      const ty = cluster.y + Math.sin(angle) * distance;
      const cellX = Math.round(tx);
      const cellY = Math.round(ty);
      if (cellX < 1 || cellY < 1 || cellX >= width - 1 || cellY >= height - 1) continue;
      if (inArena(cellX, cellY)) continue;
      // Просветы внутри кластера: маленькая «полянка» в ядре.
      if (distance < spread * 0.45 && rng.chance(0.18)) continue;
      const mass = compositionDensity(composition, cellX, cellY, zones.densityAt(cellX, cellY));
      if (mass < 0.12) continue;
      const zone = zones.typeAt(cellX, cellY);
      const kind = pickVegetation(rng, settings.biome, zone);
      if (!kind || isUndergrowth(kind)) continue;
      const placed = plant(kind, tx + rng.range(-0.3, 0.3), ty + rng.range(-0.3, 0.3), mass > 0.72);
      if (placed) {
        canopyPlaced += 1;
        clusterPlaced += 1;
      }
    }
    // Подлесок — по кромке кластера: связка «деревья → кусты/грибы».
    const edgeCount = Math.max(1, Math.round(clusterTrees * 0.5));
    for (let index = 0; index < edgeCount; index += 1) {
      if (undergrowthPlaced >= undergrowthBudget) break;
      const angle = rng.range(0, Math.PI * 2);
      const distance = spread * rng.range(0.8, 1.35);
      const tx = cluster.x + Math.cos(angle) * distance;
      const ty = cluster.y + Math.sin(angle) * distance;
      const cellX = Math.round(tx);
      const cellY = Math.round(ty);
      if (cellX < 1 || cellY < 1 || cellX >= width - 1 || cellY >= height - 1) continue;
      if (inArena(cellX, cellY)) continue;
      const mass = compositionDensity(composition, cellX, cellY, zones.densityAt(cellX, cellY));
      if (mass < 0.1) continue;
      const zone = zones.typeAt(cellX, cellY);
      const kind = pickVegetation(rng, settings.biome, zone);
      if (!kind || !isUndergrowth(kind)) continue;
      if (kind === 'mushroom' && !treeNearby(cellX, cellY)) continue;
      if (plant(kind, tx, ty, false)) undergrowthPlaced += 1;
    }
  }

  // ---- Камни: акценты, а не россыпь -----------------------------------------
  const rockScale = (0.2 + settings.rocks * 0.45) * (options.rocks ?? 1);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (inArena(x, y)) continue;
      const zone = zones.typeAt(x, y);
      const structural = Math.max(massInfluence(composition, x, y), transitionInfluence(composition, x, y) * 0.4);
      const probability = Math.min(0.6, structural * rockScale * (zone === 'rocky' ? 2.4 : 0.35));
      if (rng.next() >= probability) continue;
      const kind = rng.chance(zone === 'rocky' ? 0.35 : 0.14) ? 'rock' : 'smallRock';
      dropRock(kind, x + rng.range(0.1, 0.9), y + rng.range(0.1, 0.9));
    }
  }

  // ---- Анкоры и связанный декор -------------------------------------------
  // Правило патча: у крупного объекта есть причина для мелочи рядом.
  //   валун/скала → мелкие камни;  роща/дерево → грибы и кусты;
  //   руины → обломки кладки и заросли.  Бюджет мелочи ограничен сценой.
  const microBudget = Math.max(6, plan.scene?.budget.micro ?? 15);
  let microPlaced = 0;
  const decorAt = (x: number, y: number, minDensity = 0.1): boolean => {
    const cellX = Math.round(x);
    const cellY = Math.round(y);
    if (cellX < 1 || cellY < 1 || cellX >= width - 1 || cellY >= height - 1) return false;
    if (inArena(cellX, cellY)) return false;
    if (insideOpenSpace(composition, x, y, 0)) return false;
    return compositionDensity(composition, cellX, cellY, zones.densityAt(cellX, cellY)) >= minDensity;
  };
  const ringAround = (
    x: number,
    y: number,
    count: number,
    radiusFrom: number,
    radiusTo: number,
    place: (px: number, py: number) => boolean,
    minDensity = 0.1,
  ): number => {
    let placedCount = 0;
    for (let index = 0; index < count && microPlaced < microBudget; index += 1) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = rng.range(radiusFrom, radiusTo);
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      if (!decorAt(px, py, minDensity)) continue;
      if (place(px, py)) {
        microPlaced += 1;
        placedCount += 1;
      }
    }
    return placedCount;
  };
  // Крупные камни собирают вокруг себя мелочь.
  for (const anchor of rocks.filter((rock) => rock.r >= 0.42)) {
    if (microPlaced >= microBudget) break;
    const shards = anchor.r >= 0.55 ? 4 : 3;
    const placedCount = ringAround(anchor.x, anchor.y, shards, 1.0, 1.9, (px, py) => Boolean(dropRock('smallRock', px, py)), 0);
    if (placedCount >= 2) groupPlan('boulder_scene', anchor.x, anchor.y, placedCount);
  }
  // Деревья: у ствола — грибы и кусты (в грибных биомах).
  for (const tree of trees) {
    if (microPlaced >= microBudget) break;
    if (tree.kind === 'bush' || tree.kind === 'mushroom' || tree.kind === 'reed') continue;
    if (rng.next() > 0.35) continue;
    const forestFloor = settings.biome === 'forest' || settings.biome === 'swamp' || settings.biome === 'plains';
    if (!forestFloor) continue;
    ringAround(tree.x, tree.y, 2, 0.8, 1.7, (px, py) => {
      const kind: TreeKind = rng.chance(0.45) ? 'mushroom' : 'bush';
      if (kind === 'mushroom' && !treeNearby(Math.round(px), Math.round(py))) return false;
      return Boolean(plant(kind, px, py, false));
    });
  }

  plan.groups = groups;
  // Точка старта партии: у начала первой тропы, иначе у первого центра.
  const trailStart = plan.roads?.[0]?.points[0];
  const fallback = plan.poi[0] ?? { x: Math.floor(settings.width / 2), y: Math.floor(settings.height / 2) };
  plan.spawn = {
    x: Math.min(settings.width - 1, Math.max(0, Math.round(trailStart?.x ?? fallback.x))),
    y: Math.min(settings.height - 1, Math.max(0, Math.round(trailStart?.y ?? fallback.y))),
  };
  const report = validate(settings, zones, trees, rocks, road, river, plan);
  return { trees, rocks, plan, report };
}

function markCell(grid: OccupancyGrid, x: number, y: number): void {
  grid.set(x, y, 2);
}

/** Радиус POI: у поляны он больше, потому что это арена боя. */
function poiRadius(poi: Poi): number {
  return poi.radius;
}

/** POI выбираются по зонам и удалённости друг от друга, без случайных «где попало». */
function pickPois(
  settings: GenSettings,
  zones: ZoneField,
  cells: Cell[][],
  road: Point[],
  rng: SeededRandom,
  composition: MapComposition,
): Poi[] {
  const { width, height } = settings;
  const candidates: { x: number; y: number; type: Poi['type']; score: number }[] = [];
  const roadNear = new Set<number>();
  for (const point of road) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = point.x + dx;
        const y = point.y + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) roadNear.add(y * width + x);
      }
    }
  }
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 3; x < width - 3; x += 1) {
      const zone = zones.typeAt(x, y);
      const terrain = terrainAt(cells, x, y);
      if (HARD_BLOCKED.includes(terrain)) continue;
      let type: Poi['type'] | null = null;
      if (zone === 'dense_forest' || zone === 'medium_forest') type = 'grove';
      else if (zone === 'rocky') type = 'boulder_field';
      else if (zone === 'clearing' || zone === 'meadow') type = roadNear.has(y * width + x) ? 'camp' : 'clearing';
      if (!type) continue;
      // Композиция зависит от биома: в пустыне не бывает рощ, в болоте — скал.
      if (!biomePois(settings.biome).includes(type)) continue;
      candidates.push({ x, y, type, score: zones.densityAt(x, y) + rng.next() * 0.2 });
    }
  }
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);

  const wanted = biomePoiCount(settings.biome);
  const chosen: Poi[] = [];
  const minGap = 7;
  const arenaAllowed = biomePois(settings.biome).includes('clearing');
  if (arenaAllowed) {
    // Арена — главное свободное пространство из композиции, а не случайная
    // клетка: сначала проектируем место боя, потом всё остальное.
    const battle = composition.openSpaces.find((space) => space.kind === 'battle_area') ?? composition.openSpaces[0];
    if (battle) {
      chosen.push({ id: 'clearing_0', type: 'clearing', x: battle.x, y: battle.y, radius: battle.radius });
    }
    let best: { x: number; y: number; score: number } | null = null;
    const centerX = (width - 1) / 2;
    const centerY = (height - 1) / 2;
    const maxDistance = Math.hypot(centerX, centerY) || 1;
    for (let y = 3; y < height - 3; y += 1) {
      for (let x = 3; x < width - 3; x += 1) {
        const terrain = terrainAt(cells, x, y);
        if (HARD_BLOCKED.includes(terrain)) continue;
        const zone = zones.typeAt(x, y);
        if (zone !== 'clearing' && zone !== 'meadow' && zone !== 'sparse_forest') continue;
        const openness = 1 - zones.densityAt(x, y);
        const centrality = 1 - Math.hypot(x - centerX, y - centerY) / maxDistance;
        const nearRoad = roadNear.has(y * width + x) ? 0.25 : 0;
        // Небольшой хеш-шум, чтобы арена не всегда была ровно в центре.
        const jitter = ((x * 73856093) ^ (y * 19349663)) % 1000 / 1000;
        const score = openness * 1.4 + centrality * 1.1 + nearRoad + jitter * 0.35;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    if (best && chosen.length === 0) {
      chosen.push({ id: 'clearing_0', type: 'clearing', x: best.x, y: best.y, radius: 3.4 });
    }
  }
  for (const candidate of candidates) {
    if (chosen.length >= wanted) break;
    if (chosen.some((poi) => Math.hypot(poi.x - candidate.x, poi.y - candidate.y) < minGap)) continue;
    chosen.push({
      id: `${candidate.type}_${chosen.length}`,
      type: candidate.type,
      x: candidate.x,
      y: candidate.y,
      radius: candidate.type === 'grove' ? 2.2 : candidate.type === 'clearing' ? 3.4 : 2,
    });
  }
  return chosen;
}

/** Валидатор: геометрия, проходимость, плотность, композиция, читаемость. */
export function validate(
  settings: GenSettings,
  zones: ZoneField,
  trees: Tree[],
  rocks: Rock[],
  road: Point[],
  river: Point[],
  plan: GenerationPlan,
): ValidationReport {
  const { width, height } = settings;
  const problems: string[] = [];

  const outOfBounds = [...trees, ...rocks].filter(
    (object) => object.x < 0 || object.y < 0 || object.x >= width || object.y >= height,
  ).length;
  if (outOfBounds) problems.push(`вне карты: ${outOfBounds}`);

  const blocked = [...trees, ...rocks].filter((object) => {
    const x = Math.round(object.x);
    const y = Math.round(object.y);
    return x < 0 || y < 0 || x >= width || y >= height || zones.typeAt(x, y) === 'riverbank' && false;
  }).length;
  if (blocked) problems.push(`на запрещённых клетках: ${blocked}`);

  const anchors = new Set<string>();
  let duplicates = 0;
  for (const object of [...trees, ...rocks]) {
    const key = `${Math.round(object.x)}:${Math.round(object.y)}`;
    if (anchors.has(key)) duplicates += 1;
    else anchors.add(key);
  }
  if (duplicates) problems.push(`совпавшие якоря: ${duplicates}`);

  let spacing = 0;
  for (let i = 0; i < trees.length; i += 1) {
    for (let j = i + 1; j < trees.length; j += 1) {
      const dx = trees[i].x - trees[j].x;
      const dy = trees[i].y - trees[j].y;
      if (dx * dx + dy * dy < 0.36) spacing += 1;
    }
  }
  if (spacing) problems.push(`слишком близкие деревья: ${spacing}`);

  // Придорожная проходимость: стволы не должны стоять на оси дороги.
  const roadCells = new Set(road.map((point) => `${point.x}:${point.y}`));
  const onRoad = [...trees, ...rocks].filter((object) =>
    roadCells.has(`${Math.round(object.x)}:${Math.round(object.y)}`),
  ).length;
  if (onRoad) problems.push(`объекты на дороге: ${onRoad}`);

  const inWater = [...trees, ...rocks].filter((object) => {
    const x = Math.round(object.x);
    const y = Math.round(object.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return zones.typeAt(x, y) === 'riverbank' && river.some((p) => p.x === x && p.y === y);
  }).length;
  if (inWater) problems.push(`объекты в реке: ${inWater}`);

  // Плотность по блокам: если везде одинаково — композиции нет.
  const blocks = new Map<string, number>();
  for (const tree of trees) {
    const bx = Math.floor(tree.x / 6);
    const by = Math.floor(tree.y / 6);
    const key = `${bx}:${by}`;
    blocks.set(key, (blocks.get(key) ?? 0) + 1);
  }
  const counts = Array.from(blocks.values());
  const mean = counts.reduce((sum, value) => sum + value, 0) / Math.max(1, counts.length);
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, counts.length);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  if (cv < 0.45) problems.push(`плотность слишком равномерная (cv ${cv.toFixed(2)})`);

  const grouped = plan.groups.reduce((sum, group) => sum + group.placed, 0);
  const total = trees.length + rocks.length;
  const composition = total ? Math.min(1, grouped / total + 0.25) : 0;

  const zonesUsed = new Set<string>();
  for (const tree of trees) zonesUsed.add(zones.typeAt(Math.round(tree.x), Math.round(tree.y)));

  // Читаемость боевой карты: должно остаться место для манёвра, а арена —
  // быть пустой (иначе «поляна» не поляна).
  const anchorsAll = [...trees, ...rocks].map((object) => `${Math.round(object.x)}:${Math.round(object.y)}`);
  const occupiedShare = anchorsAll.length / Math.max(1, width * height);
  const openShare = 1 - occupiedShare;
  if (openShare < 0.5) problems.push(`мало открытого места для боя: свободно ${(openShare * 100).toFixed(0)} %`);
  const arenaPoi = plan.poi.find((poi) => poi.type === 'clearing');
  if (arenaPoi) {
    const radius = arenaPoi.radius - 1;
    const intruders = [...trees, ...rocks].filter(
      (object) => Math.hypot(object.x - arenaPoi.x, object.y - arenaPoi.y) < radius,
    ).length;
    if (intruders) problems.push(`арена заставлена объектами: ${intruders}`);
  }

  // Композиция: открытые пространства — игровые площадки, а не место под декор.
  const mapComposition = plan.composition;
  if (mapComposition) {
    for (const space of mapComposition.openSpaces) {
      const inside = [...trees, ...rocks].filter(
        (object) => Math.hypot(object.x - space.x, object.y - space.y) <= space.radius - 0.5,
      ).length;
      if (inside) problems.push(`открытое пространство ${space.id} заставлено объектами: ${inside}`);
    }
  }

  const report: ValidationReport = {
    connectivity: 1,
    overlap: total ? Math.max(0, 1 - duplicates / total) : 1,
    density: Math.min(1, cv),
    composition,
    diversity: Math.min(1, zonesUsed.size / 5),
    readability: Math.min(1, openShare),
    problems,
  };
  return report;
}
