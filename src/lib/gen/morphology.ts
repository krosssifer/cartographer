import type { Cell, MapData, Terrain } from '../types';
import { insideOpenSpace } from './composition';
import type { MapComposition } from './composition';

/**
 * Морфологическое сглаживание террейна.
 *
 * Проблема: классификация клеток по порогам шума даёт «ступеньки» и
 * одноклеточные островки — полянка из одного кустика травы посреди песка,
 * вода с рваной кромкой, граница травы/тёмной травы лестницей. Для карты
 * боя это читается как «лего», а не как природный рельеф.
 *
 * Решение — две операции морфологии (открытие/закрытие) на уровне сетки:
 *  - `despeckle` убирает одноклеточные вкрапления чужого грунта;
 *  - `softenWaterEdges` залечивает одиночные выступы воды и одиночные
 *    «островки» суши в воде;
 *  - `smoothGround` перекрашивает клетки на стыке двух вариантов одного
 *    грунта (трава ↔ тёмная трава, песок ↔ трава) по большинству соседей.
 *
 * Всё работает детерминированно: порядок обхода фиксирован, «ничьи» решаются
 * сравнением координат, без обращений к rng.
 */

/** Грунты, которые можно свободно «пересаживать» при сглаживании. */
const GROUND: ReadonlySet<Terrain> = new Set<Terrain>([
  'grass',
  'darkGrass',
  'dirt',
  'sand',
  'mud',
  'snow',
  'ice',
  'rock',
]);

/** То, что сглаживание не трогает никогда. */
const PROTECTED: ReadonlySet<Terrain> = new Set<Terrain>([
  'wall',
  'caveWall',
  'buildingWall',
  'buildingFloor',
  'floor',
  'plaza',
  'roof',
  'void',
  'water',
  'deepWater',
  'road',
  'bridge',
  'door',
]);

const isGround = (terrain: Terrain): boolean => GROUND.has(terrain);
const isProtected = (terrain: Terrain): boolean => PROTECTED.has(terrain);
const isWater = (terrain: Terrain): boolean => terrain === 'water' || terrain === 'deepWater';

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const terrainAt = (cells: Cell[][], x: number, y: number): Terrain | undefined =>
  cells[y]?.[x]?.terrain;

/** Считает, сколько из 8 соседей удовлетворяют предикату. */
function countNeighbours(
  cells: Cell[][],
  x: number,
  y: number,
  match: (terrain: Terrain | undefined) => boolean,
): number {
  let count = 0;
  for (const [dx, dy] of OFFSETS) {
    if (match(terrainAt(cells, x + dx, y + dy))) count += 1;
  }
  return count;
}

/** Самое частое значение террейна среди 8 соседей (детерминированно). */
function majorityNeighbour(
  cells: Cell[][],
  x: number,
  y: number,
  allowed: (terrain: Terrain) => boolean,
): Terrain | null {
  const counts = new Map<Terrain, number>();
  let available = 0;
  for (const [dx, dy] of OFFSETS) {
    const terrain = terrainAt(cells, x + dx, y + dy);
    if (!terrain) continue;
    if (!allowed(terrain)) continue;
    available += 1;
    counts.set(terrain, (counts.get(terrain) ?? 0) + 1);
  }
  let best: Terrain | null = null;
  let bestCount = 0;
  for (const [terrain, count] of counts) {
    if (count > bestCount) {
      best = terrain;
      bestCount = count;
    }
  }
  // У края карты соседей меньше — порог считаем от доступных клеток,
  // иначе одиночные вкрапления у рамки никогда не сглаживаются.
  const needed = Math.max(3, Math.ceil(available * 0.6));
  return bestCount >= needed ? best : null;
}

function baseGroundFor(biome: MapData['biome']): Terrain {
  switch (biome) {
    case 'desert':
      return 'sand';
    case 'snow':
      return 'snow';
    case 'swamp':
      return 'mud';
    case 'cave':
    case 'dungeon':
      return 'caveFloor';
    default:
      return 'grass';
  }
}

/** Убирает одноклеточные островки грунта, окружённые другим грунтом. */
function despeckle(
  cells: Cell[][],
  width: number,
  height: number,
  biome: MapData['biome'],
): void {
  const ground = baseGroundFor(biome);
  const snapshot = cells.map((row) => row.map((cell) => cell.terrain));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = snapshot[y][x];
      if (!isGround(terrain)) continue;
      // Утоптанную землю у полотна не трогаем: это обочина и площадки у
      // концов тракта, они должны оставаться dirt даже среди травы.
      if (terrain === 'dirt' || terrain === 'mud') {
        let nearRoad = false;
        for (let dy = -2; dy <= 2 && !nearRoad; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const near = terrainAt(cells, x + dx, y + dy);
            if (near === 'road' || near === 'bridge') { nearRoad = true; break; }
          }
        }
        if (nearRoad) continue;
      }
      let same = 0;
      for (const [dx, dy] of OFFSETS) {
        if (snapshot[y + dy]?.[x + dx] === terrain) same += 1;
      }
      // Одиночка: своего грунта нет ни у одного соседа.
      if (same > 0) continue;
      const water = countNeighbours(
        cells,
        x,
        y,
        (neighbour) => neighbour !== undefined && isWater(neighbour),
      );
      if (water >= 4) {
        cells[y][x] = { ...cells[y][x], terrain: 'water' };
        continue;
      }
      const replacement =
        majorityNeighbour(cells, x, y, (neighbour) => isGround(neighbour)) ?? ground;
      cells[y][x] = { ...cells[y][x], terrain: replacement };
    }
  }
}

/** Залечивает одиночные выступы воды и «островки» суши в воде. */
function softenWaterEdges(cells: Cell[][], width: number, height: number, biome: MapData['biome'], composition?: MapComposition): void {
  const ground = baseGroundFor(biome);
  const snapshot = cells.map((row) => row.map((cell) => cell.terrain));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const terrain = snapshot[y][x];
      if (isProtected(terrain) && !isWater(terrain)) continue;
      // Открытые пространства композиции не топим: поляна у реки должна остаться
      // поляной, даже если морфология «видит» вокруг неё много воды.
      if (composition && insideOpenSpace(composition, x + 0.5, y + 0.5, 0)) continue;
      const waterNeighbours = countNeighbours(cells, x, y, (neighbour) => neighbour !== undefined && isWater(neighbour));
      if (isWater(terrain)) {
        // Вода, у которой 6+ соседей — суша, это выступ: заливаем грунтом.
        if (waterNeighbours <= 2) cells[y][x] = { ...cells[y][x], terrain: ground };
      } else if (isGround(terrain)) {
        // Грунт, полностью окружённый водой, — случайный островок: топим.
        if (waterNeighbours >= 7) cells[y][x] = { ...cells[y][x], terrain: 'water' };
      }
    }
  }
}

/** Сглаживает стык двух вариантов одного грунта (трава ↔ тёмная трава и т.п.). */
function smoothGround(cells: Cell[][], width: number, height: number): void {
  const snapshot = cells.map((row) => row.map((cell) => cell.terrain));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const terrain = snapshot[y][x];
      if (terrain !== 'grass' && terrain !== 'darkGrass') continue;
      const other: Terrain = terrain === 'grass' ? 'darkGrass' : 'grass';
      if (countNeighbours(cells, x, y, (neighbour) => neighbour === other) >= 6) {
        cells[y][x] = { ...cells[y][x], terrain: other };
      }
    }
  }
}

/**
 * Убирает островки суши, застрявшие внутри русла: клетки грунта, окружённые
 * водой, читаются как случайные «палки» поперёк реки. Компоненты меньше
 * ISLAND_LIMIT клеток, у которых больше половины соседей — вода, заливаются.
 */
/**
 * Закрывает узкие перемычки суши внутри воды: клетка грунта, у которой вода
 * слева и справа (или сверху и снизу), читается как «полоска» поперёк русла.
 */
function closeNarrowLand(cells: Cell[][], width: number, height: number): void {
  const isWater = (terrain: Terrain): boolean => terrain === 'water' || terrain === 'deepWater';
  const snapshot = cells.map((row) => row.map((cell) => cell.terrain));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const terrain = snapshot[y][x];
      if (!GROUND.has(terrain)) continue;
      const horizontal = isWater(snapshot[y][x - 1]) && isWater(snapshot[y][x + 1]);
      const vertical = isWater(snapshot[y - 1][x]) && isWater(snapshot[y + 1][x]);
      if (!horizontal && !vertical) continue;
      cells[y][x] = { ...cells[y][x], terrain: 'water' };
    }
  }
}

const ISLAND_LIMIT = 12;

function fillWaterIslands(cells: Cell[][], width: number, height: number): void {
  const isWater = (terrain: Terrain): boolean => terrain === 'water' || terrain === 'deepWater';
  const seen = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (seen.has(index)) continue;
      if (!GROUND.has(cells[y][x].terrain)) continue;
      // Собираем 4-связную компоненту грунта.
      const component: { x: number; y: number }[] = [];
      const queue: { x: number; y: number }[] = [{ x, y }];
      seen.add(index);
      while (queue.length) {
        const current = queue.pop()!;
        component.push(current);
        for (const offset of OFFSETS) {
          const nx = current.x + offset[0];
          const ny = current.y + offset[1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nextIndex = ny * width + nx;
          if (seen.has(nextIndex)) continue;
          if (!GROUND.has(cells[ny][nx].terrain)) continue;
          seen.add(nextIndex);
          queue.push({ x: nx, y: ny });
        }
      }
      if (component.length > ISLAND_LIMIT) continue;
      // Доля воды вокруг компоненты.
      let waterNeighbours = 0;
      let totalNeighbours = 0;
      for (const cell of component) {
        for (const offset of OFFSETS) {
          const nx = cell.x + offset[0];
          const ny = cell.y + offset[1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          totalNeighbours += 1;
          if (isWater(cells[ny][nx].terrain)) waterNeighbours += 1;
        }
      }
      if (!totalNeighbours) continue;
      if (waterNeighbours / totalNeighbours < 0.42) continue;
      for (const cell of component) {
        cells[cell.y][cell.x] = { ...cells[cell.y][cell.x], terrain: 'water' };
      }
    }
  }
}

export interface MorphologyOptions {
  /** Сколько проходов сглаживания делать (1–3 достаточно для карт 100×80). */
  iterations?: number;
}

/**
 * Применяет морфологию к клеткам карты. Возвращает НОВУЮ карту: исходный
 * объект не мутируется, чтобы не ломать кэш поселений и сравнения в тестах.
 */
export function smoothTerrain(map: MapData, options: MorphologyOptions = {}): MapData {
  const iterations = Math.max(1, Math.min(3, options.iterations ?? 2));
  const { width, height } = map;
  const cells: Cell[][] = map.cells.map((row) => row.map((cell) => ({ ...cell })));

  for (let pass = 0; pass < iterations; pass += 1) {
    despeckle(cells, width, height, map.biome);
    closeNarrowLand(cells, width, height);
    softenWaterEdges(cells, width, height, map.biome, map.plan?.composition);
    fillWaterIslands(cells, width, height);
    smoothGround(cells, width, height);
  }

  return { ...map, cells };
}
