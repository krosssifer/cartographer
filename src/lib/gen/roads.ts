/**
 * Структурный планировщик дорожной сети.
 *
 * Дорога — не «линия в одну клетку», а объект:
 *   узлы (входы с карты, перекрёстки, точки интереса) → путь по cost-field →
 *   сглаживание осевой → проектирование переправ → укладка полотна нужной
 *   ширины → утоптанные обочины → осмысленный конец пути.
 *
 * Все шаги детерминированы: единственный источник случайности — SeededRandom.
 */

import type { Cell, GenSettings, Point, Terrain } from '../types';
import type { Bridge, RoadNetwork, RoadNode, RoadPath } from './plan';
import type { SeededRandom } from './random';

const WALKABLE_COST: Partial<Record<Terrain, number>> = {
  road: 0.7,
  bridge: 0.8,
  grass: 1,
  darkGrass: 1.05,
  dirt: 1.1,
  sand: 1.25,
  snow: 1.5,
  ice: 2.4,
  mud: 2.4,
  rock: 2.9,
  caveFloor: 1.4,
  floor: 1.2,
  water: 6.5,
  deepWater: 9,
};

/** Клетки, через которые дорогу прорубать нельзя даже за большую цену. */
const BLOCKED: ReadonlySet<Terrain> = new Set<Terrain>([
  'wall', 'void', 'caveWall', 'buildingWall', 'roof', 'floor', 'door', 'buildingFloor',
]);

const isWater = (terrain: Terrain): boolean => terrain === 'water' || terrain === 'deepWater';
const isBlocked = (terrain: Terrain): boolean => BLOCKED.has(terrain);
const cellCost = (terrain: Terrain): number => WALKABLE_COST[terrain] ?? 12;

/** Направления обхода: 4 прямых + 4 диагональных (диагональ требует свободных углов). */
const STEPS: ReadonlyArray<readonly [number, number, number, boolean]> = [
  [1, 0, 1, false],
  [-1, 0, 1, false],
  [0, 1, 1, false],
  [0, -1, 1, false],
  [1, 1, 1.42, true],
  [1, -1, 1.42, true],
  [-1, 1, 1.42, true],
  [-1, -1, 1.42, true],
];

interface HeapEntry {
  at: number;
  cost: number;
}

/** Минимальная двоичная куча для Dijkstra (карты небольшие — хватает с запасом). */
class MinHeap {
  private readonly items: HeapEntry[] = [];

  push(entry: HeapEntry): void {
    this.items.push(entry);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].cost <= this.items[index].cost) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): HeapEntry | undefined {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && this.items[left].cost < this.items[best].cost) best = left;
        if (right < this.items.length && this.items[right].cost < this.items[best].cost) best = right;
        if (best === index) break;
        [this.items[best], this.items[index]] = [this.items[index], this.items[best]];
        index = best;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

/**
 * Кратчайший путь по cost-field с диагональными шагами.
 *
 * Диагонали важны: без них дорога превращается в «лесенку» из прямых углов.
 * Диагональный шаг разрешён только когда оба прямых соседа не заблокированы —
 * иначе полотно прорезало бы угол скалы или здания.
 */
function findPath(
  cells: Cell[][],
  width: number,
  height: number,
  from: Point,
  to: Point,
  multiplier: (terrain: Terrain) => number,
): Point[] | null {
  const total = width * height;
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const best = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const heap = new MinHeap();

  best[start] = 0;
  heap.push({ at: start, cost: 0 });

  while (heap.size) {
    const current = heap.pop()!;
    if (current.cost > best[current.at]) continue;
    if (current.at === goal) break;

    const cx = current.at % width;
    const cy = Math.floor(current.at / width);
    for (const [dx, dy, weight, diagonal] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const terrain = cells[ny][nx].terrain;
      if (isBlocked(terrain)) continue;
      if (diagonal) {
        const sideA = cells[cy][nx].terrain;
        const sideB = cells[ny][cx].terrain;
        if (isBlocked(sideA) || isBlocked(sideB)) continue;
      }
      const count = ny * width + nx;
      const cost = cellCost(terrain) * multiplier(terrain) * weight;
      const next = current.cost + cost;
      if (next < best[count]) {
        best[count] = next;
        prev[count] = current.at;
        heap.push({ at: count, cost: next });
      }
    }
  }

  if (best[goal] === Infinity) return null;

  const path: Point[] = [];
  let at = goal;
  while (at !== -1) {
    path.push({ x: at % width, y: Math.floor(at / width) });
    if (at === start) break;
    at = prev[at];
  }
  return path.reverse();
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Шаг между клетками: прямой или диагональный. */
const isDiagonal = (a: Point, b: Point): boolean => a.x !== b.x && a.y !== b.y;

/**
 * Сглаживание осевой линии.
 *
 * 1) выбрасываем повторяющиеся и коллинеарные точки;
 * 2) убираем мелкие «ступеньки»: одиночный прямой шаг между двумя
 *    диагональными, если он не создаёт разрыва и не выводит с карты;
 * 3) выпрямляем участки около переправ (перед мостом и после него дорога
 *    должна подходить по прямой, иначе настил стоит под углом к тракту).
 */
function smoothPath(points: Point[], cells: Cell[][]): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (samePoint(result[result.length - 1], point)) continue;
    result.push(point);
  }

  // Убираем одиночные прямые шаги между диагоналями (это и есть «ступеньки»).
  for (let pass = 0; pass < 2; pass += 1) {
    const cleaned: Point[] = [result[0]];
    for (let index = 1; index < result.length - 1; index += 1) {
      const previous = cleaned[cleaned.length - 1];
      const current = result[index];
      const next = result[index + 1];
      const straightStep = !isDiagonal(previous, current) && !isDiagonal(current, next);
      const diagonalBridge = isDiagonal(previous, next) || samePoint(previous, next);
      if (straightStep && diagonalBridge && !isDiagonal(previous, current)) {
        // Проверяем, что «срез» не задевает заблокированные клетки.
        const cutA = cells[current.y]?.[next.x];
        const cutB = cells[next.y]?.[current.x];
        if (cutA && cutB && !isBlocked(cutA.terrain) && !isBlocked(cutB.terrain)) continue;
      }
      cleaned.push(current);
    }
    cleaned.push(result[result.length - 1]);
    result.length = 0;
    result.push(...cleaned);
  }

  return result;
}

/**
 * Выпрямление подходов к переправе.
 *
 * Для каждого участка воды длиной 1–4 клетки ось моста — направление дороги
 * между берегами. Чтобы это направление было настоящим (а не «по диагонали
 * через две клетки»), заменяем участок `start-2..end+2` прямой линией между
 * берегами, если эта линия не пересекает заблокированные клетки.
 */
function straightenCrossings(
  points: Point[],
  cells: Cell[][],
  width: number,
  height: number,
): Point[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const wet = point.y >= 0 && point.y < height && point.x >= 0 && point.x < width
      && isWater(cells[point.y][point.x].terrain);
    if (wet && start < 0) start = index;
    if (!wet && start >= 0) {
      runs.push({ start, end: index - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: points.length - 1 });

  if (!runs.length) return points;

  const result: Point[] = [];
  let cursor = 0;
  for (const run of runs) {
    const length = run.end - run.start + 1;
    if (length < 1 || length > 4) continue;
    const from = Math.max(cursor, run.start - 2);
    const to = Math.min(points.length - 1, run.end + 2);
    if (from <= cursor) continue;
    // Сохраняем всё до начала выпрямляемого участка.
    for (let index = cursor; index < from; index += 1) result.push(points[index]);
    const a = points[from];
    const b = points[to];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    let blocked = false;
    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 0 : step / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      const terrain = cells[y]?.[x]?.terrain;
      if (!terrain || isBlocked(terrain)) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      for (let index = from; index < to; index += 1) result.push(points[index]);
    } else {
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        result.push({
          x: Math.round(a.x + (b.x - a.x) * t),
          y: Math.round(a.y + (b.y - a.y) * t),
        });
      }
    }
    cursor = to;
  }
  for (let index = cursor; index < points.length; index += 1) result.push(points[index]);
  return dedupe(result);
}

function dedupe(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (!result.length || !samePoint(result[result.length - 1], point)) result.push(point);
  }
  return result;
}

/**
 * Укладка полотна: полоса нужной ширины с заливкой углов на диагоналях.
 *
 * При ширине 2 диагональный шаг закрашивает и «угловые» клетки, иначе дорога
 * распадается на отдельные квадраты.
 */
function carveRun(
  cells: Cell[][],
  width: number,
  height: number,
  points: Point[],
  roadWidth: number,
): RoadPath['bridges'] {
  let bridges = 0;
  let previousWasWater = false;

  const paint = (cell: Point): boolean => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) return false;
    const target = cells[cell.y][cell.x];
    if (isBlocked(target.terrain)) return false;
    if (isWater(target.terrain)) {
      target.terrain = 'bridge';
      return true;
    }
    if (target.terrain !== 'bridge') target.terrain = 'road';
    return false;
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];

    const lanes: Point[] = [point];
    if (roadWidth >= 2) {
      // Направление движения по осевой (на краях пути берём соседнюю точку).
      const sx = Math.sign(point.x - previous.x) || Math.sign(next.x - point.x);
      const sy = Math.sign(point.y - previous.y) || Math.sign(next.y - point.y);
      if (sx !== 0 && sy !== 0) {
        // Диагональ: добавляем оба «угла», иначе полотно рвётся на квадраты.
        lanes.push({ x: point.x + sx, y: point.y });
        lanes.push({ x: point.x, y: point.y + sy });
      } else if (sx !== 0) {
        lanes.push({ x: point.x, y: point.y + 1 });
      } else if (sy !== 0) {
        lanes.push({ x: point.x + 1, y: point.y });
      }
    }

    let wet = false;
    for (const lane of lanes) {
      if (paint(lane)) wet = true;
    }
    if (wet && !previousWasWater) bridges += 1;
    previousWasWater = wet;
  }

  return bridges;
}

/**
 * Обочины: вокруг полотна трава превращается в утоптанную землю.
 *
 * Обочина — РОВНО одна клетка по краю полотна. Раньше сюда попадало и кольцо
 * радиусом 2, из-за чего дорога расползалась в широкое коричневое поле (до
 * 6 клеток шириной) и съедала заметную часть карты. Часть клеток оставляем
 * травой (12 %), чтобы край не выглядел прочерченным линейкой.
 */
function carveShoulders(cells: Cell[][], width: number, height: number, rng: SeededRandom): void {
  const candidates: Terrain[] = ['grass', 'darkGrass', 'mud', 'sand'];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = cells[y][x].terrain;
      if (!candidates.includes(terrain)) continue;
      let touchesPavement = false;
      for (let dy = -1; dy <= 1 && !touchesPavement; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbour = cells[y + dy]?.[x + dx]?.terrain;
          if (neighbour === 'road' || neighbour === 'bridge') {
            touchesPavement = true;
            break;
          }
        }
      }
      if (!touchesPavement) continue;
      if (rng.chance(0.88)) cells[y][x].terrain = 'dirt';
    }
  }
}

/**
 * Переправы: сначала находим участки воды на пути, потом проектируем мост.
 *
 * Ось настила = направление дороги между берегами (а не «как получилось»),
 * поэтому мост всегда ориентирован по тракту. Слишком длинные броды (>4 клеток)
 * не получают мост — там дорога ищет обход.
 */
function collectCrossings(
  cells: Cell[][],
  width: number,
  height: number,
  points: Point[],
  pathId: string,
  roadWidth: number,
  maxRun = 4,
): Bridge[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const wet = point.y >= 0 && point.y < height && point.x >= 0 && point.x < width
      && isWater(cells[point.y][point.x].terrain);
    if (wet && start < 0) start = index;
    if (!wet && start >= 0) {
      runs.push({ start, end: index - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: points.length - 1 });

  const bridges: Bridge[] = [];
  runs.forEach((run, index) => {
    const length = run.end - run.start + 1;
    if (length < 1 || length > maxRun) return;
    const before = points[Math.max(0, run.start - 1)];
    const after = points[Math.min(points.length - 1, run.end + 1)];
    const angle = Math.atan2(after.y - before.y, after.x - before.x);
    const wetCells = points.slice(run.start, run.end + 1);
    const x = wetCells.reduce((sum, cell) => sum + cell.x, 0) / wetCells.length + 0.5;
    const y = wetCells.reduce((sum, cell) => sum + cell.y, 0) / wetCells.length + 0.5;
    bridges.push({
      id: `${pathId}_bridge_${index}`,
      x,
      y,
      angle,
      // Настил чуть длиннее водного пробега: он должен накрывать кромку
      // клеточного настила, иначе по краям видны обрезки текстур.
      length: length + 2.2,
      width: Math.max(1, roadWidth),
      cells: wetCells,
      pathId,
    });
  });
  return bridges;
}


/**
 * Расстояние между осями двух настилов (отрезки «центр ± полдлины»).
 * Нужно, чтобы понять, накладываются ли настилы, а не только их центры.
 */
function deckDistance(a: Bridge, b: Bridge): number {
  const ax = Math.cos(a.angle) * (a.length / 2);
  const ay = Math.sin(a.angle) * (a.length / 2);
  const bx = Math.cos(b.angle) * (b.length / 2);
  const by = Math.sin(b.angle) * (b.length / 2);
  const a1 = { x: a.x - ax, y: a.y - ay };
  const a2 = { x: a.x + ax, y: a.y + ay };
  const b1 = { x: b.x - bx, y: b.y - by };
  const b2 = { x: b.x + bx, y: b.y + by };
  const pointSegment = (p: { x: number; y: number }, s1: { x: number; y: number }, s2: { x: number; y: number }): number => {
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / lengthSq));
    return Math.hypot(p.x - (s1.x + dx * t), p.y - (s1.y + dy * t));
  };
  const segmentsCross = (): boolean => {
    const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number): number =>
      (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    const d1 = cross(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y);
    const d2 = cross(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y);
    const d3 = cross(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y);
    const d4 = cross(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  if (segmentsCross()) return 0;
  return Math.min(
    pointSegment(a1, b1, b2),
    pointSegment(a2, b1, b2),
    pointSegment(b1, a1, a2),
    pointSegment(b2, a1, a2),
  );
}

/**
 * На одну переправу — один настил. Магистраль и ответвление могут пересекать
 * одну протоку рядом (или один рукав дважды), и тогда несколько повёрнутых
 * настилов ложатся друг на друга — получается «нагромождение текстур».
 * Оставляем самый длинный настил, остальные отбрасываем, если их полотно
 * реально пересекается/касается уже принятого.
 */
function dedupeBridges(bridges: Bridge[]): Bridge[] {
  const sorted = [...bridges].sort((a, b) => b.length - a.length);
  const kept: Bridge[] = [];
  for (const bridge of sorted) {
    const overlap = kept.some((other) => {
      const clearance = Math.max(1.4, (other.width + bridge.width) * 0.75);
      return deckDistance(other, bridge) < clearance;
    });
    if (overlap) continue;
    kept.push(bridge);
  }
  return kept;
}

export interface RoadPlannerResult {
  network: RoadNetwork;
  /** Мосты, спроектированные до укладки: ось совпадает с дорогой. */
  bridges: Bridge[];
  /** Центральная линия главного тракта — для зон, обочин и легаси-поля road. */
  centerline: Point[];
}

/**
 * Основной вход: строит узлы и пути, укладывает полотно.
 *
 * Магистраль идёт от одного края карты к другому, затем от неё отходит
 * ответвление к глубинной точке (лес/скалы), если карта достаточно большая.
 * Конец ответвления расчищается — дорога не обрывается в траве, а входит
 * в небольшой «дворик».
 */
/** Точки, заданные сценой: вход/выход и обязательные waypoint-ы (переправа). */
export interface RoadPlannerOptions {
  entry?: Point;
  exit?: Point;
  waypoints?: Point[];
}

export function planRoadNetwork(
  settings: GenSettings,
  cells: Cell[][],
  rng: SeededRandom,
  options: RoadPlannerOptions = {},
): RoadPlannerResult {
  const width = settings.width;
  const height = settings.height;

  const edgeY = () => rng.int(2, Math.max(3, height - 3));

  const nodes: RoadNode[] = [];
  const entry = options.entry ? { x: options.entry.x, y: options.entry.y } : { x: 1, y: edgeY() };
  const exit = options.exit ? { x: options.exit.x, y: options.exit.y } : { x: width - 2, y: edgeY() };
  nodes.push({ id: 'entry', kind: 'entrance', ...entry });
  nodes.push({ id: 'exit', kind: 'entrance', ...exit });

  // Глубинная точка: тянем ответвление к середине карты, смещённой по сиду.
  const inland = {
    x: rng.int(Math.floor(width * 0.35), Math.max(Math.floor(width * 0.35) + 1, Math.floor(width * 0.65))),
    y: rng.int(Math.floor(height * 0.3), Math.max(Math.floor(height * 0.3) + 1, Math.floor(height * 0.7))),
  };
  const wantBranch = width * height > 500;
  if (wantBranch) nodes.push({ id: 'junction', kind: 'junction', ...inland, x: inland.x, y: inland.y });
  nodes[nodes.length - 1].kind = wantBranch ? 'junction' : 'entrance';

  const paths: RoadPath[] = [];
  const graph: RoadNetwork['graph'] = [];

  // Магистраль: слегка «избегаем» воды, но не запрещаем её (мост допустим).
  // Если сцена задала waypoint-ы (переправа), путь собирается из сегментов
  // entry → via[0] → … → exit: так дорога гарантированно проходит через сцену.
  const legCost = (terrain: Terrain): number => (isWater(terrain) ? 1.15 : 1);
  const waypoints = (options.waypoints ?? []).filter(
    (point) => point.x > 0 && point.y > 0 && point.x < width - 1 && point.y < height - 1,
  );
  const stops: Point[] = [entry, ...waypoints, exit];
  const rawHighway: Point[] = [];
  let highwayBroken = false;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const leg = findPath(cells, width, height, stops[index], stops[index + 1], legCost);
    if (!leg) {
      highwayBroken = true;
      break;
    }
    // Стык сегментов дедуплицируем: точка стыка уже есть в конце предыдущего.
    for (const point of leg) {
      const last = rawHighway[rawHighway.length - 1];
      if (last && last.x === point.x && last.y === point.y) continue;
      rawHighway.push(point);
    }
  }
  if (highwayBroken || rawHighway.length === 0) {
    return { network: { nodes, paths, graph }, bridges: [], centerline: [] };
  }
  const highway = smoothPath(rawHighway, cells);
  // Тракт обязан начинаться и заканчиваться у края карты, а не в шаге от него:
  // иначе на схеме висит «обрубок» дороги. Продлеваем полотно на граничные клетки.
  // Тракт обязан начинаться и заканчиваться у края карты, а не в шаге от него.
  // Продлеваем к БЛИЖАЙШЕМУ краю (диагональный тракт входит в карту углом),
  // иначе на схеме висит оторванный «обрубок».
  const extendToBorder = (point: Point): Point => {
    const distances: [number, Point][] = [
      [point.x, { x: 0, y: point.y }],
      [width - 1 - point.x, { x: width - 1, y: point.y }],
      [point.y, { x: point.x, y: 0 }],
      [height - 1 - point.y, { x: point.x, y: height - 1 }],
    ];
    let best = distances[0];
    for (const candidate of distances) if (candidate[0] < best[0]) best = candidate;
    return best[0] <= 2 ? best[1] : point;
  };
  const headPoint = highway[0];
  const tailPoint = highway[highway.length - 1];
  const headExtended = extendToBorder(headPoint);
  const tailExtended = extendToBorder(tailPoint);
  if (headExtended.x !== headPoint.x || headExtended.y !== headPoint.y) highway.unshift(headExtended);
  if (tailExtended.x !== tailPoint.x || tailExtended.y !== tailPoint.y) highway.push(tailExtended);

  const straightHighway = straightenCrossings(highway, cells, width, height);
  const bridges: Bridge[] = collectCrossings(cells, width, height, straightHighway, 'highway', 2, 12);
  const highwayBridges = carveRun(cells, width, height, straightHighway, 2);
  paths.push({ id: 'highway', type: 'main', width: 2, points: straightHighway, bridges: highwayBridges });
  graph.push({ from: 'entry', to: 'exit', length: straightHighway.length });

  if (wantBranch) {
    // Ответвление: от ближайшей к глубинной точке клетки магистрали.
    let anchor = straightHighway[0];
    let anchorDistance = Infinity;
    for (const point of straightHighway) {
      const distance = Math.abs(point.x - inland.x) + Math.abs(point.y - inland.y);
      if (distance < anchorDistance) {
        anchorDistance = distance;
        anchor = point;
      }
    }
    // Двигаем узел перекрёстка к фактической точке ответвления.
    for (const node of nodes) {
      if (node.kind === 'junction') {
        node.x = anchor.x;
        node.y = anchor.y;
      }
    }
    // Цель ответвления — ближайшая СУХАЯ проходимая клетка к глубинной точке:
    // дорога не должна заканчиваться посреди реки.
    let target = inland;
    for (let radius = 0; radius <= 8; radius += 1) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = inland.x + dx;
          const y = inland.y + dy;
          if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
          const terrain = cells[y][x].terrain;
          if (isBlocked(terrain) || isWater(terrain)) continue;
          target = { x, y };
          found = true;
          break;
        }
      }
      if (found) break;
    }
    const rawBranch = findPath(cells, width, height, anchor, target, (terrain) => (isWater(terrain) ? 1.35 : 1));
    if (rawBranch && rawBranch.length > 4) {
      const branch = straightenCrossings(smoothPath(rawBranch, cells), cells, width, height);
      // Путь не должен заканчиваться в воде: обрезаем хвост до последней суши.
      while (branch.length > 4 && isWater(cells[branch[branch.length - 1].y]?.[branch[branch.length - 1].x]?.terrain ?? 'void')) {
        branch.pop();
      }
      bridges.push(...collectCrossings(cells, width, height, branch, 'branch', 1));
      const bridgeCount = carveRun(cells, width, height, branch, 1);
      paths.push({ id: 'branch', type: 'trail', width: 1, points: branch, bridges: bridgeCount });
      graph.push({ from: 'junction', to: 'inland', length: branch.length });
      nodes.push({ id: 'inland', kind: 'poi', x: branch[branch.length - 1].x, y: branch[branch.length - 1].y });
      // Осмысленный конец: небольшая утоптанная площадка, а не обрубок в траве.
      // Если ответвление упирается в воду, площадку ставим на последней сухой
      // клетке тракта — иначе конец остаётся «обрубком в траве».
      let endIndex = branch.length - 1;
      while (endIndex > 1) {
        const candidate = cells[branch[endIndex].y]?.[branch[endIndex].x]?.terrain;
        if (candidate && !isWater(candidate) && candidate !== 'bridge' && !isBlocked(candidate)) break;
        endIndex -= 1;
      }
      const end = branch[endIndex];
      const endTerrain = cells[end.y]?.[end.x]?.terrain;
      if (endTerrain !== 'bridge' && endTerrain && !isWater(endTerrain)) {
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const cell = cells[end.y + dy]?.[end.x + dx];
            if (!cell || isBlocked(cell.terrain) || isWater(cell.terrain) || cell.terrain === 'bridge') continue;
            if (dx === 0 && dy === 0) cell.terrain = 'road';
            else if (cell.terrain !== 'road') cell.terrain = 'dirt';
          }
        }
      }
    } else {
      nodes.pop();
    }
  }

  carveShoulders(cells, width, height, rng);

  return { network: { nodes, paths, graph }, bridges: dedupeBridges(bridges), centerline: straightHighway };
}
