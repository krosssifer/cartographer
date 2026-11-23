// Гидрология сцены: вода течёт по рельефу, а не рисуется кривой поверх него.
//
// Конвейер:
//   1) Priority-Flood+ε (Barnes, 2014): заполняем бессточные впадины так, что
//      из любой клетки есть строго убывающий путь к краю карты. Глубокие
//      впадины не засыпаем, а превращаем в озёра (уровень = заполненная высота).
//   2) Направление стока D8 по заполненной поверхности: каждая клетка отдаёт
//      воду самому низкому соседу. Реки поэтому никогда не текут в гору.
//   3) Накопление стока (flow accumulation): клетки обходятся от высоких к
//      низким, каждая передаёт свой сток получателю.
//   4) Реки — линии большого стока: главное русло прослеживается от устья
//      вверх по самому полноводному притоку; притоки — ответвления с заметным
//      стоком. Ширина растёт с накоплением, у впадения в озеро — устье.
//   5) Водоразделы — бассейны по устьям; индекс влажности (TWI) — для болот
//      и растительности.
//
// Сетка не больше 100×80, поэтому всё считается за миллисекунды.

import type { Point } from '../types';

export type WaterMode = 'none' | 'stream' | 'river' | 'river_wide' | 'lakes' | 'marsh';

export interface Lake {
  id: string;
  /** Центр масс озера. */
  x: number;
  y: number;
  /** Число клеток зеркала. */
  area: number;
  /** Уровень воды (заполненная высота). */
  level: number;
  /** Клетка, через которую озеро сбрасывает воду (-1, если сток за край). */
  outlet: number;
}

export interface RiverCourse {
  id: string;
  /** Осевая линия от истока к устью, 4-связная (без диагональных разрывов). */
  points: Point[];
  /** Ширина русла в клетках для каждой точки. */
  widths: number[];
  main: boolean;
  /** Куда впадает: за край карты, в озеро или в другую реку. */
  endsIn: 'edge' | 'lake' | 'river';
}

export interface HydrologyOptions {
  mode: WaterMode;
  /** Минимальная площадь озера в клетках (меньше — засыпается/заболачивается). */
  lakeMinArea: number;
  /** Минимальная глубина впадины, чтобы стать озером. */
  lakeMinDepth: number;
  /** Максимум притоков у главного русла. */
  maxTributaries: number;
  /** Верхняя граница ширины главного русла. */
  maxWidth: number;
  /** Осадки по клеткам (обычно влажность); null — равномерно. */
  rain?: Float32Array | null;
}

export interface HydrologyResult {
  filled: Float32Array;
  /** Индекс клетки-получателя стока или -1 (сток за край карты). */
  flowTo: Int32Array;
  accumulation: Float32Array;
  lakes: Lake[];
  /** Принадлежность клетки озеру: индекс в lakes или -1. */
  lakeOf: Int32Array;
  rivers: RiverCourse[];
  /** Номер бассейна (водосбора) клетки. */
  basins: Int32Array;
  basinCount: number;
  /** Водосборы, собирающие заметную долю осадков (для отчёта). */
  majorBasins: number;
  /** Индекс влажности 0..1 (топографический, ln(a / tan β)). */
  wetness: Float32Array;
}

const N8: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Двоичная куча по значению — без зависимостей, детерминированная. */
class IndexHeap {
  private readonly nodes: number[] = [];
  private readonly values: number[] = [];

  push(node: number, value: number): void {
    this.nodes.push(node);
    this.values.push(value);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.less(parent, index)) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop()!;
    const lastValue = this.values.pop()!;
    if (this.nodes.length) {
      this.nodes[0] = lastNode;
      this.values[0] = lastValue;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.nodes.length && !this.less(best, left)) best = left;
        if (right < this.nodes.length && !this.less(best, right)) best = right;
        if (best === index) break;
        this.swap(best, index);
        index = best;
      }
    }
    return top;
  }

  get size(): number {
    return this.nodes.length;
  }

  /** Строгий порядок: при равных значениях решает номер клетки (детерминизм). */
  private less(a: number, b: number): boolean {
    return this.values[a] < this.values[b] || (this.values[a] === this.values[b] && this.nodes[a] < this.nodes[b]);
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }
}

/** Priority-Flood+ε: возвращает заполненную поверхность без бессточных ям. */
export function priorityFlood(height: Float32Array, width: number, rows: number, epsilon = 1e-5): Float32Array {
  const filled = new Float32Array(height);
  const closed = new Uint8Array(width * rows);
  const heap = new IndexHeap();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== rows - 1) continue;
      const index = y * width + x;
      closed[index] = 1;
      heap.push(index, filled[index]);
    }
  }
  while (heap.size) {
    const current = heap.pop();
    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [dx, dy] of N8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= rows) continue;
      const next = ny * width + nx;
      if (closed[next]) continue;
      closed[next] = 1;
      filled[next] = Math.max(height[next], filled[current] + epsilon);
      heap.push(next, filled[next]);
    }
  }
  return filled;
}

/** Направление стока D8 по заполненной поверхности. */
export function flowDirections(filled: Float32Array, width: number, rows: number): Int32Array {
  const flowTo = new Int32Array(width * rows).fill(-1);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      // Клетки края сбрасывают воду за карту.
      if (x === 0 || y === 0 || x === width - 1 || y === rows - 1) continue;
      let best = -1;
      let bestDrop = 0;
      for (const [dx, dy] of N8) {
        const next = (y + dy) * width + (x + dx);
        const drop = (filled[index] - filled[next]) / (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (drop > bestDrop || (drop === bestDrop && drop > 0 && next < best)) {
          bestDrop = drop;
          best = next;
        }
      }
      flowTo[index] = best;
    }
  }
  return flowTo;
}

/** Накопление стока: обход от высоких клеток к низким. */
export function flowAccumulation(filled: Float32Array, flowTo: Int32Array, rain: Float32Array | null): Float32Array {
  const order = Array.from({ length: filled.length }, (_, index) => index);
  order.sort((a, b) => filled[b] - filled[a] || a - b);
  const accumulation = new Float32Array(filled.length);
  for (let index = 0; index < accumulation.length; index += 1) accumulation[index] = rain ? 0.4 + rain[index] * 1.2 : 1;
  for (const index of order) {
    const target = flowTo[index];
    if (target >= 0) accumulation[target] += accumulation[index];
  }
  return accumulation;
}

/**
 * Добавляет промежуточные клетки на диагональных шагах: русло 4-связно.
 * Вставленная клетка прорезается до середины между соседями по руслу —
 * это локальная правка поверхности, после которой русло монотонно.
 */
function orthogonalize(points: Point[], filled: Float32Array, width: number): Point[] {
  const out: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = out[out.length - 1];
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      const a = { x: point.x, y: previous.y };
      const b = { x: previous.x, y: point.y };
      const filler = filled[a.y * width + a.x] <= filled[b.y * width + b.x] ? a : b;
      const fillerIndex = filler.y * width + filler.x;
      const ceiling = (filled[previous.y * width + previous.x] + filled[point.y * width + point.x]) / 2;
      if (filled[fillerIndex] > ceiling) filled[fillerIndex] = ceiling;
      out.push(filler);
    }
    out.push(point);
  }
  return out;
}

export function analyzeHydrology(height: Float32Array, width: number, rows: number, options: HydrologyOptions): HydrologyResult {
  const total = width * rows;
  const filled = priorityFlood(height, width, rows);
  const flowTo = flowDirections(filled, width, rows);
  const accumulation = flowAccumulation(filled, flowTo, options.rain ?? null);

  // ---- Озёра: глубокие впадины, которые Priority-Flood «залил» -----------
  const lakeOf = new Int32Array(total).fill(-1);
  const lakes: Lake[] = [];
  const wantLakes = options.mode === 'lakes' || options.mode === 'marsh' || options.mode === 'river' || options.mode === 'river_wide';
  if (wantLakes) {
    const candidate = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) {
      if (filled[index] - height[index] > options.lakeMinDepth) candidate[index] = 1;
    }
    const seen = new Uint8Array(total);
    for (let start = 0; start < total; start += 1) {
      if (!candidate[start] || seen[start]) continue;
      const component: number[] = [start];
      seen[start] = 1;
      for (let head = 0; head < component.length; head += 1) {
        const index = component[head];
        const x = index % width;
        const y = (index - x) / width;
        for (const [dx, dy] of N8.slice(0, 4)) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= rows) continue;
          const next = ny * width + nx;
          if (!candidate[next] || seen[next]) continue;
          seen[next] = 1;
          component.push(next);
        }
      }
      if (component.length < options.lakeMinArea) continue;
      // Край озера: соседние клетки той же заполненной высоты тоже зеркало
      // (Priority-Flood выравнивает впадину до уровня перелива).
      const lakeId = lakes.length;
      let sumX = 0;
      let sumY = 0;
      let level = 0;
      for (const index of component) {
        lakeOf[index] = lakeId;
        sumX += index % width;
        sumY += Math.floor(index / width);
        level = Math.max(level, filled[index]);
      }
      // Сток озера: клетка зеркала, чей получатель лежит вне озера.
      let outlet = -1;
      let outletAcc = -1;
      for (const index of component) {
        const target = flowTo[index];
        if (target >= 0 && lakeOf[target] !== lakeId && accumulation[index] > outletAcc) {
          outletAcc = accumulation[index];
          outlet = index;
        }
      }
      lakes.push({ id: `lake_${lakeId}`, x: sumX / component.length, y: sumY / component.length, area: component.length, level, outlet });
    }
  }

  // ---- Реки ----------------------------------------------------------------
  const rivers: RiverCourse[] = [];
  const onRiver = new Int32Array(total).fill(-1);
  const maxAcc = accumulation.reduce((max, value) => (value > max ? value : max), 0);
  const donorsOf = (index: number): number[] => {
    const x = index % width;
    const y = (index - x) / width;
    const result: number[] = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= rows) continue;
      const next = ny * width + nx;
      if (flowTo[next] === index) result.push(next);
    }
    return result;
  };
  /** Прослеживает русло вверх по самому полноводному донору. */
  const traceUp = (mouth: number, minAcc: number): number[] => {
    const upstream: number[] = [mouth];
    let current = mouth;
    for (let guard = 0; guard < total; guard += 1) {
      let best = -1;
      for (const donor of donorsOf(current)) {
        if (onRiver[donor] >= 0 || lakeOf[donor] >= 0) continue;
        if (accumulation[donor] < minAcc) continue;
        if (best < 0 || accumulation[donor] > accumulation[best] || (accumulation[donor] === accumulation[best] && donor < best)) best = donor;
      }
      if (best < 0) break;
      upstream.push(best);
      current = best;
    }
    return upstream.reverse();
  };
  // Ширина растёт с долей стока; у широкой реки русло не уже двух клеток.
  const minWidth = options.mode === 'river_wide' ? 2 : 1;
  const widthFor = (acc: number, cap: number, main: boolean): number => {
    const share = acc / Math.max(1, maxAcc);
    const base = 1 + (share > 0.22 ? 1 : 0) + (share > 0.55 ? 1 : 0);
    return Math.max(main ? minWidth : 1, Math.min(cap, base));
  };
  const toPoints = (indices: number[]): Point[] => indices.map((index) => ({ x: index % width, y: Math.floor(index / width) }));
  const register = (indices: number[], main: boolean, endsIn: RiverCourse['endsIn'], cap: number): void => {
    const id = rivers.length;
    for (const index of indices) if (onRiver[index] < 0) onRiver[index] = id;
    const points = orthogonalize(toPoints(indices), filled, width);
    const widths = points.map((point) => widthFor(accumulation[point.y * width + point.x], cap, main));
    // Устье: последние клетки перед озером расширяются (эстуарий).
    if (endsIn === 'lake') for (let k = Math.max(0, widths.length - 3); k < widths.length; k += 1) widths[k] = Math.min(cap + 1, widths[k] + 1);
    rivers.push({ id: main ? 'river_main' : `river_${id}`, points, widths, main, endsIn });
  };

  const riverMode = options.mode === 'river' || options.mode === 'river_wide' || options.mode === 'stream';
  if (riverMode) {
    // Устье главной реки — клетка края с наибольшим стоком.
    let mouth = -1;
    for (let index = 0; index < total; index += 1) {
      if (flowTo[index] !== -1) continue;
      if (mouth < 0 || accumulation[index] > accumulation[mouth]) mouth = index;
    }
    if (mouth >= 0 && accumulation[mouth] >= 6) {
      const main = traceUp(mouth, Math.max(1.5, accumulation[mouth] * 0.015));
      if (main.length >= 4) {
        register(main, true, 'edge', options.maxWidth);
        // Притоки: доноры главного русла с заметным собственным стоком.
        const candidates: { from: number; acc: number }[] = [];
        for (const index of main) {
          for (const donor of donorsOf(index)) {
            if (onRiver[donor] >= 0 || lakeOf[donor] >= 0) continue;
            if (accumulation[donor] < Math.max(8, accumulation[index] * 0.16)) continue;
            candidates.push({ from: donor, acc: accumulation[donor] });
          }
        }
        candidates.sort((a, b) => b.acc - a.acc || a.from - b.from);
        let added = 0;
        for (const candidate of candidates) {
          if (added >= options.maxTributaries) break;
          if (onRiver[candidate.from] >= 0) continue;
          const branch = traceUp(candidate.from, Math.max(3, candidate.acc * 0.12));
          if (branch.length < 5) continue;
          // Приток заканчивается в клетке главного русла: добавляем точку стыка.
          const join = flowTo[candidate.from];
          register([...branch, join], false, 'river', Math.max(1, options.maxWidth - 1));
          added += 1;
        }
      }
    }
  }

  if (options.mode === 'lakes' || options.mode === 'marsh') {
    // Протоки: из каждого озера вниз по стоку до края или следующего озера.
    for (const lake of lakes) {
      if (lake.outlet < 0) continue;
      const course: number[] = [];
      let current = flowTo[lake.outlet];
      let endsIn: RiverCourse['endsIn'] = 'edge';
      for (let guard = 0; guard < total && current >= 0; guard += 1) {
        // Клетка озера входит в русло: так устье примыкает к воде, даже если
        // сток в озеро шёл по диагонали.
        if (lakeOf[current] >= 0) { course.push(current); endsIn = 'lake'; break; }
        if (onRiver[current] >= 0) { course.push(current); endsIn = 'river'; break; }
        course.push(current);
        if (flowTo[current] < 0) break;
        current = flowTo[current];
      }
      if (course.length >= 2) register(course, rivers.length === 0, endsIn, 1);
    }
    // Ручьи, питающие озёра: самый полноводный донор каждого озера.
    for (let lakeId = 0; lakeId < lakes.length; lakeId += 1) {
      let best = -1;
      for (let index = 0; index < total; index += 1) {
        const target = flowTo[index];
        if (target < 0 || lakeOf[target] !== lakeId || lakeOf[index] >= 0 || onRiver[index] >= 0) continue;
        if (best < 0 || accumulation[index] > accumulation[best]) best = index;
      }
      if (best < 0 || accumulation[best] < 6) continue;
      const feeder = traceUp(best, Math.max(3, accumulation[best] * 0.15));
      if (feeder.length >= 4) register([...feeder, flowTo[best]], false, 'lake', 1);
    }
  }

  // ---- Водоразделы: бассейн = устье, к которому стекает клетка -----------
  const basins = new Int32Array(total).fill(-1);
  let basinCount = 0;
  const outletBasin = new Map<number, number>();
  for (let start = 0; start < total; start += 1) {
    if (basins[start] >= 0) continue;
    const path: number[] = [];
    let current = start;
    while (current >= 0 && basins[current] < 0) {
      path.push(current);
      if (flowTo[current] < 0) break;
      current = flowTo[current];
    }
    let basin: number;
    if (current >= 0 && basins[current] >= 0) basin = basins[current];
    else {
      const outlet = path[path.length - 1];
      if (!outletBasin.has(outlet)) outletBasin.set(outlet, basinCount++);
      basin = outletBasin.get(outlet)!;
    }
    for (const index of path) basins[index] = basin;
  }

  // Значимые водосборы: устье собирает хотя бы 4 % осадков карты. Клетки края
  // формально — отдельные мини-бассейны, их в отчёт не считаем.
  const outletTotals = new Map<number, number>();
  let rainTotal = 0;
  for (let index = 0; index < total; index += 1) {
    if (flowTo[index] !== -1) continue;
    outletTotals.set(basins[index], accumulation[index]);
  }
  for (const value of outletTotals.values()) rainTotal += value;
  let majorBasins = 0;
  for (const value of outletTotals.values()) if (value >= rainTotal * 0.04) majorBasins += 1;

  // ---- Индекс влажности ----------------------------------------------------
  const wetness = new Float32Array(total);
  let wetMax = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const target = flowTo[index];
      const drop = target >= 0 ? Math.max(0, filled[index] - filled[target]) : 0.01;
      const value = Math.log((accumulation[index] + 1) / (drop * 40 + 0.05));
      wetness[index] = value;
      if (value > wetMax) wetMax = value;
    }
  }
  let wetMin = Infinity;
  for (let index = 0; index < total; index += 1) wetMin = Math.min(wetMin, wetness[index]);
  const wetSpan = wetMax - wetMin || 1;
  for (let index = 0; index < total; index += 1) wetness[index] = (wetness[index] - wetMin) / wetSpan;

  return { filled, flowTo, accumulation, lakes, lakeOf, rivers, basins, basinCount, majorBasins, wetness };
}

/**
 * Проверка гидрологии: русла не текут в гору и не обрываются в никуда.
 * Возвращает список нарушений (пустой — всё в порядке).
 */
export function hydrologyProblems(result: HydrologyResult, width: number, rows: number): string[] {
  const problems: string[] = [];
  for (const river of result.rivers) {
    const points = river.points;
    for (let index = 1; index < points.length; index += 1) {
      const before = result.filled[points[index - 1].y * width + points[index - 1].x];
      const after = result.filled[points[index].y * width + points[index].x];
      // Вставленные ортогональные клетки могут быть чуть выше соседей по
      // заполненной поверхности; допускаем погрешность ε-заполнения.
      if (after - before > 0.02) {
        problems.push(`${river.id}: подъём русла в ${points[index].x}:${points[index].y}`);
        break;
      }
    }
    const end = points[points.length - 1];
    const atEdge = end.x === 0 || end.y === 0 || end.x === width - 1 || end.y === rows - 1;
    const endIndex = end.y * width + end.x;
    const intoLake = result.lakeOf[endIndex] >= 0 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = end.x + dx;
      const ny = end.y + dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < rows && result.lakeOf[ny * width + nx] >= 0;
    });
    const intoRiver = river.endsIn === 'river';
    if (!atEdge && !intoLake && !intoRiver) problems.push(`${river.id}: русло обрывается в ${end.x}:${end.y}`);
  }
  return problems;
}
