// Природный ландшафт сцены: рельеф → гидрология → грунты → проверка и
// локальная починка. Используется генератором сцен-архетипов (scenes.ts);
// классический генератор открытой местности (generateOverland) не меняется,
// поэтому старые проекты с тем же сидом дают ту же карту.

import { Perlin } from '../noise';
import type { Biome, Cell, Point, Terrain } from '../types';
import { buildHeightField, frameCoords, slopeField, valleyCenter, type ReliefFrame, type ReliefKind } from './heightfield';
import { analyzeHydrology, hydrologyProblems, type HydrologyResult, type WaterMode } from './hydrology';
import { SeededRandom } from './random';

export type RiverCourseKind = 'none' | 'across' | 'along';

export interface LandscapeSpec {
  relief: ReliefKind;
  water: WaterMode;
  /** Где прорезать главное русло до расчёта стока (или не прорезать). */
  course: RiverCourseKind;
  erosion: boolean;
  /** 0..1 — насколько охотно крутые склоны становятся скальными обрывами. */
  cliffs: number;
  /** 0..1 — склонность низин к заболачиванию. */
  wetlands: number;
}

export interface LandscapeCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Состояние после локальных починок; fixed — сколько клеток исправлено. */
  fixed: number;
}

export interface LandscapeReport {
  checks: LandscapeCheck[];
  actions: string[];
  waterShare: number;
  rockShare: number;
  lakes: number;
  rivers: number;
  basins: number;
}

export interface LandscapeResult {
  cells: Cell[][];
  heights: Float32Array;
  slope: Float32Array;
  moisture: Float32Array;
  /** Плодородие 0..1: где растительности «положено» быть гуще. */
  fertility: Float32Array;
  hydrology: HydrologyResult;
  frame: ReliefFrame;
  /** Осевая линия главного русла (для ленты реки в рендере). */
  mainRiver?: { points: Point[]; width: number };
  /** 1 — вода, 2 — глубокая вода, 0 — суша. */
  water: Uint8Array;
  /** Порог крутизны, выше которого склон — обрыв. */
  cliffSlope: number;
  report: LandscapeReport;
}

interface LandscapeInput {
  width: number;
  height: number;
  biome: Biome;
  seed: number;
  roughness: number;
  /** Пользовательский «уровень воды» 0..0.7 — влияет на размер озёр и болот. */
  waterLevel: number;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const ROCK_LINE: Record<string, number> = { snow: 0.8, desert: 0.86, forest: 0.86, plains: 0.88, swamp: 0.9 };

/** Ширина и глубина прорезаемого русла для режима воды. */
function channelFor(mode: WaterMode): { half: number; depth: number } {
  if (mode === 'river_wide') return { half: 4.2, depth: 0.34 };
  if (mode === 'river') return { half: 3.4, depth: 0.3 };
  if (mode === 'stream') return { half: 2.4, depth: 0.2 };
  return { half: 0, depth: 0 };
}

/** Ось русла в клетках: поперёк главной оси сцены или вдоль неё. */
function courseLine(input: LandscapeInput, frame: ReliefFrame, kind: RiverCourseKind, relief: ReliefKind, noise: Perlin, rng: SeededRandom): Point[] {
  const { width, height } = input;
  const line: Point[] = [];
  const steps = 64;
  if (kind === 'along') {
    // Вдоль оси — по дну долины: тот же шум и та же амплитуда, что в профиле
    // рельефа (heightfield.ts), иначе русло легло бы на склон.
    const shapeNoise = new Perlin(input.seed ^ 0x2f6b1d);
    const amplitude = relief === 'pass' ? 0.05 : relief === 'valley' ? 0.08 : relief === 'ridge' ? 0.12 : 0.06;
    for (let index = 0; index <= steps; index += 1) {
      const u = index / steps;
      const v = valleyCenter(shapeNoise, u, amplitude);
      const along = (u - 0.5) * (frame.horizontal ? width : height);
      const across = (v - 0.5) * (frame.horizontal ? height : width);
      const cos = Math.cos(frame.tilt);
      const sin = Math.sin(frame.tilt);
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      const x = frame.horizontal ? cx + along * cos - across * sin : cx + across * cos - along * sin;
      const y = frame.horizontal ? cy + along * sin + across * cos : cy + along * cos + across * sin;
      line.push({ x, y });
    }
    return line;
  }
  // Поперёк оси: от одного края к противоположному с меандрами.
  const offset = rng.range(-0.12, 0.12);
  const phase = rng.range(0, Math.PI * 2);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const meander = Math.sin(t * Math.PI * 2.2 + phase) * 0.07 + noise.noise(t * 3.1 + 12, 5.5) * 0.06;
    if (frame.horizontal) line.push({ x: (0.5 + offset + meander) * (width - 1), y: -1 + t * (height + 1) });
    else line.push({ x: -1 + t * (width + 1), y: (0.5 + offset + meander) * (height - 1) });
  }
  return line;
}

/**
 * Прорезает русло в поле высот: вдоль линии дно монотонно понижается от
 * истока к устью, берега плавно поднимаются. После этого сток сам находит
 * русло, и гидрология проводит реку там, где задумала сцена.
 */
function carveCourse(data: Float32Array, width: number, height: number, line: Point[], mode: WaterMode): void {
  const { half, depth } = channelFor(mode);
  if (!half || line.length < 2) return;
  const sampleAt = (point: Point): number => {
    const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
    return data[y * width + x];
  };
  // Исток — более высокий конец линии.
  const startHeight = sampleAt(line[0]);
  const endHeight = sampleAt(line[line.length - 1]);
  const ordered = startHeight >= endHeight ? line : [...line].reverse();
  const high = Math.max(startHeight, endHeight);
  // Дно обязано падать от истока к устью хотя бы на 0.12: при почти равных
  // концах линии плоское дно распадалось на озеро и два встречных стока.
  const bottom = Math.max(0.01, Math.min(startHeight, endHeight) - depth);
  const top = Math.max(bottom + 0.12, Math.min(0.62, high - depth * 0.3));
  // Дно по точкам линии: линейный спуск, но не выше самой глубокой уже
  // пройденной низины. Иначе естественная котловина выше по течению
  // превращалась в озеро, и сток уходил в обратную сторону.
  const floors: number[] = [];
  let lowest = Infinity;
  for (let index = 0; index < ordered.length; index += 1) {
    const point = ordered[index];
    let local = Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) local = Math.min(local, sampleAt({ x: point.x + dx, y: point.y + dy }));
    }
    lowest = Math.min(lowest, local - 0.004);
    const linear = top + (bottom - top) * (index / (ordered.length - 1));
    const previous = index ? floors[index - 1] - 0.002 : Infinity;
    floors.push(Math.max(0, Math.min(linear, lowest, previous)));
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = Infinity;
      let floor = 0;
      for (let index = 1; index < ordered.length; index += 1) {
        const a = ordered[index - 1];
        const b = ordered[index];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const distance = Math.hypot(x - px, y - py);
        if (distance < best) {
          best = distance;
          floor = floors[index - 1] + (floors[index] - floors[index - 1]) * t;
        }
      }
      if (best > half * 2.6) continue;
      const bank = floor + Math.pow(best / half, 1.6) * depth * 0.55;
      const index = y * width + x;
      const blend = smoothstep(half * 2.6, half * 0.9, best);
      const carved = Math.min(data[index], bank);
      data[index] = data[index] * (1 - blend) + carved * blend;
    }
  }
}

/** Компоненты 4-связности по маске. */
function components(mask: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const parts: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const part = [start];
    seen[start] = 1;
    for (let head = 0; head < part.length; head += 1) {
      const index = part[head];
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] || seen[next]) continue;
        seen[next] = 1;
        part.push(next);
      }
    }
    parts.push(part);
  }
  return parts;
}

/** Дистанция (в клетках, 4-связно) до ближайшей клетки маски, не дальше limit. */
function distanceTo(mask: Uint8Array, width: number, height: number, limit: number): Int16Array {
  const distance = new Int16Array(mask.length).fill(limit + 1);
  const queue: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      distance[index] = 0;
      queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    if (distance[index] >= limit) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (distance[next] <= distance[index] + 1) continue;
      distance[next] = distance[index] + 1;
      queue.push(next);
    }
  }
  return distance;
}

const WATER_CAP: Record<WaterMode, number> = { none: 0.04, stream: 0.12, river: 0.2, river_wide: 0.26, lakes: 0.3, marsh: 0.42 };

export function buildLandscape(input: LandscapeInput, spec: LandscapeSpec): LandscapeResult {
  const { width, height, biome, seed } = input;
  const total = width * height;
  const rng = new SeededRandom(seed, 0x1a2d);
  const frame: ReliefFrame = {
    horizontal: width >= height ? rng.chance(0.78) : rng.chance(0.22),
    tilt: rng.range(-0.28, 0.28),
    side: rng.chance(0.5) ? -1 : 1,
  };
  const field = buildHeightField(width, height, { relief: spec.relief, roughness: input.roughness, seed, frame, erosion: spec.erosion });
  const data = field.data;
  const courseNoise = new Perlin(seed ^ 0x3c3c3c);
  let course: Point[] = [];
  if (spec.course !== 'none' && (spec.water === 'river' || spec.water === 'river_wide' || spec.water === 'stream')) {
    course = courseLine(input, frame, spec.course, spec.relief, courseNoise, rng);
    carveCourse(data, width, height, course, spec.water);
  }

  // Влажность: крупный шум, смещённый к низинам.
  const moistureNoise = new Perlin(seed + 7919);
  const baseMoisture = new Float32Array(total);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      baseMoisture[y * width + x] = clamp01(moistureNoise.fbm(x * 0.06 + 100, y * 0.06 + 100, 3) * 1.1 - (data[y * width + x] - 0.5) * 0.25);
    }
  }

  const waterLevel = Math.max(0, Math.min(0.7, input.waterLevel));
  const hydrology = analyzeHydrology(data, width, height, {
    mode: spec.water,
    lakeMinArea: spec.water === 'lakes' ? 10 : spec.water === 'marsh' ? 4 : 14,
    lakeMinDepth: spec.water === 'lakes' || spec.water === 'marsh' ? 0.012 + (0.7 - waterLevel) * 0.03 : 0.05,
    maxTributaries: spec.water === 'river_wide' ? 2 : spec.water === 'river' ? 2 : 1,
    maxWidth: spec.water === 'river_wide' ? 3 : spec.water === 'river' ? 2 : 1,
    rain: baseMoisture,
  });
  const slope = slopeField(field);

  // ---- Маска воды --------------------------------------------------------
  const water = new Uint8Array(total);
  const actions: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const lake = hydrology.lakeOf[index];
    if (lake < 0) continue;
    water[index] = hydrology.filled[index] - data[index] > 0.08 ? 2 : 1;
  }
  // Русло — полоса по нормали к течению: ширина 2 даёт ровно две клетки,
  // ширина 3 — три с глубокой серединой.
  for (const river of hydrology.rivers) {
    const points = river.points;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const riverWidth = river.widths[index];
      const before = points[Math.max(0, index - 2)];
      const after = points[Math.min(points.length - 1, index + 2)];
      const tx = after.x - before.x;
      const ty = after.y - before.y;
      const length = Math.hypot(tx, ty) || 1;
      const nx = -ty / length;
      const ny = tx / length;
      const from = -Math.floor((riverWidth - 1) / 2);
      const to = Math.ceil((riverWidth - 1) / 2);
      for (let offset = from; offset <= to; offset += 1) {
        const x = Math.round(point.x + nx * offset);
        const y = Math.round(point.y + ny * offset);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const cell = y * width + x;
        water[cell] = Math.max(water[cell], riverWidth >= 3 && offset === 0 ? 2 : 1);
      }
    }
  }
  // Болота: мелководье в самых влажных низинах.
  if (spec.water === 'marsh' || spec.wetlands > 0.6) {
    const threshold = 0.74 - waterLevel * 0.12 - (spec.water === 'marsh' ? 0.08 : 0);
    for (let index = 0; index < total; index += 1) {
      if (water[index]) continue;
      if (hydrology.wetness[index] > threshold && slope[index] < 0.045 && data[index] < 0.55) water[index] = 1;
    }
  }

  // ---- Проверка и локальная починка воды ----------------------------------
  const checks: LandscapeCheck[] = [];
  // 1) Русла: не в гору и не обрываются.
  const problems = hydrologyProblems(hydrology, width, height);
  let extended = 0;
  for (const river of hydrology.rivers) {
    const end = river.points[river.points.length - 1];
    const atEdge = end.x === 0 || end.y === 0 || end.x === width - 1 || end.y === height - 1;
    if (atEdge || river.endsIn !== 'edge') continue;
    // Локально продлеваем русло вниз по стоку до края карты или озера.
    let current = hydrology.flowTo[end.y * width + end.x];
    for (let guard = 0; guard < total && current >= 0; guard += 1) {
      const x = current % width;
      const y = (current - x) / width;
      river.points.push({ x, y });
      river.widths.push(river.widths[river.widths.length - 1]);
      water[current] = Math.max(water[current], 1);
      extended += 1;
      if (hydrology.lakeOf[current] >= 0 || hydrology.flowTo[current] < 0) break;
      current = hydrology.flowTo[current];
    }
  }
  if (extended) actions.push(`ландшафт: продлено русло до края на ${extended} кл.`);
  checks.push({ id: 'rivers_downhill', label: 'Реки текут вниз и не обрываются', ok: (extended ? hydrologyProblems(hydrology, width, height) : problems).length === 0, fixed: extended });

  // 2) Безымянные лужи: водоёмы меньше 3 клеток, не принадлежащие руслу/озеру.
  const riverCells = new Uint8Array(total);
  for (const river of hydrology.rivers) for (const point of river.points) riverCells[point.y * width + point.x] = 1;
  let dried = 0;
  for (const part of components(water, width, height)) {
    if (part.length >= 3) continue;
    if (part.some((index) => riverCells[index] || hydrology.lakeOf[index] >= 0)) continue;
    for (const index of part) water[index] = 0;
    dried += part.length;
  }
  if (dried) actions.push(`ландшафт: засыпано мелких луж: ${dried} кл.`);
  checks.push({ id: 'no_specks', label: 'Нет случайных луж', ok: true, fixed: dried });

  // 3) Одноклеточные островки посреди русла — затапливаем (кроме болот).
  let islands = 0;
  if (spec.water !== 'marsh') {
    const land = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) land[index] = water[index] ? 0 : 1;
    for (const part of components(land, width, height)) {
      if (part.length > 2) continue;
      const touchesEdge = part.some((index) => {
        const x = index % width;
        const y = (index - x) / width;
        return x === 0 || y === 0 || x === width - 1 || y === height - 1;
      });
      if (touchesEdge) continue;
      for (const index of part) water[index] = 1;
      islands += part.length;
    }
  }
  if (islands) actions.push(`ландшафт: затоплены островки-обрубки: ${islands} кл.`);
  checks.push({ id: 'no_slivers', label: 'Нет клеточных островков в русле', ok: true, fixed: islands });

  // 4) Доля воды: если озёра разлились — поднимаем дно мелководья локально.
  let waterCount = 0;
  for (let index = 0; index < total; index += 1) if (water[index]) waterCount += 1;
  const cap = WATER_CAP[spec.water] + waterLevel * 0.08;
  let shrunk = 0;
  if (waterCount / total > cap) {
    const shallow: number[] = [];
    for (let index = 0; index < total; index += 1) {
      if (water[index] === 1 && !riverCells[index]) shallow.push(index);
    }
    shallow.sort((a, b) => (hydrology.filled[a] - data[a]) - (hydrology.filled[b] - data[b]) || a - b);
    for (const index of shallow) {
      if (waterCount / total <= cap) break;
      water[index] = 0;
      waterCount -= 1;
      shrunk += 1;
    }
  }
  if (shrunk) actions.push(`ландшафт: мелководье сокращено на ${shrunk} кл. (лимит воды ${Math.round(cap * 100)} %)`);
  checks.push({ id: 'water_share', label: 'Доля воды в пределах сцены', ok: waterCount / total <= cap + 1e-9, fixed: shrunk });

  // ---- Влажность и близость воды ------------------------------------------
  const waterMask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) waterMask[index] = water[index] ? 1 : 0;
  const waterDistance = distanceTo(waterMask, width, height, 6);
  const moisture = new Float32Array(total);
  for (let index = 0; index < total; index += 1) {
    const proximity = 1 - Math.min(6, waterDistance[index]) / 6;
    moisture[index] = clamp01(baseMoisture[index] * 0.6 + hydrology.wetness[index] * 0.25 + proximity * 0.3 - 0.05);
  }

  // ---- Грунты --------------------------------------------------------------
  // Обрыв — верхние ~7 % крутизны, но не мягче абсолютного порога: на
  // пологой сцене обрывов быть не должно.
  const sortedSlope = Array.from(slope).sort((a, b) => a - b);
  const quantile = sortedSlope[Math.floor(sortedSlope.length * (0.97 - spec.cliffs * 0.09))] ?? 0.1;
  const cliffSlope = Math.max(0.11 - spec.cliffs * 0.05, quantile);
  // Линия голых скал: по биому, но выше неё не больше ~20 % карты — иначе
  // перевал превращался в сплошной камень с узкой щелью.
  const sortedHeight = Array.from(data).sort((a, b) => a - b);
  const rockLine = Math.max(ROCK_LINE[biome] ?? 0.86, sortedHeight[Math.floor(sortedHeight.length * 0.8)] ?? 0);
  const jitterNoise = new Perlin(seed ^ 0x6a09e6);
  const cells: Cell[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const h = data[index];
      const m = moisture[index];
      // Мелкий шум на порогах: границы грунтов рваные и плавные, а не по линейке.
      const jitter = jitterNoise.noise(x * 0.45 + 3, y * 0.45 + 7) * 0.08;
      let terrain: Terrain;
      if (water[index]) {
        const frozen = biome === 'snow' && hydrology.lakeOf[index] >= 0;
        terrain = frozen ? (water[index] === 2 ? 'deepWater' : 'ice') : water[index] === 2 ? 'deepWater' : 'water';
      } else if (slope[index] > cliffSlope || h > rockLine + jitter * 0.5) {
        // Обрыв — резкая граница: без джиттера.
        terrain = 'rock';
      } else {
        terrain = groundFor(biome, m + jitter, h, waterDistance[index], hydrology.wetness[index], spec.wetlands);
      }
      row.push({ terrain, height: h, moisture: m });
    }
    cells.push(row);
  }

  // 5) Скалы: одиночные клетки скалы на пологом месте — шум, а не обрыв.
  let rockFixed = 0;
  let rockCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y][x].terrain !== 'rock') continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dy) && cells[y + dy]?.[x + dx]?.terrain === 'rock') neighbours += 1;
        }
      }
      if (neighbours <= 1) {
        const index = y * width + x;
        cells[y][x].terrain = groundFor(biome, moisture[index], data[index], waterDistance[index], hydrology.wetness[index], spec.wetlands);
        rockFixed += 1;
      } else rockCount += 1;
    }
  }
  if (rockFixed) actions.push(`ландшафт: убраны одиночные скалы: ${rockFixed}`);
  checks.push({ id: 'cliff_bands', label: 'Обрывы цельные, без одиночных клеток', ok: true, fixed: rockFixed });

  // ---- Плодородие для растительности --------------------------------------
  const fertility = new Float32Array(total);
  for (let index = 0; index < total; index += 1) {
    if (water[index]) continue;
    const proximity = 1 - Math.min(6, waterDistance[index]) / 6;
    const m = moisture[index];
    let base: number;
    switch (biome) {
      case 'desert': base = 0.06 + proximity * 0.85 + m * 0.1; break;
      case 'snow': base = 0.3 + m * 0.4 - Math.max(0, data[index] - 0.6) * 0.9; break;
      case 'swamp': base = 0.35 + m * 0.5; break;
      case 'plains': base = 0.22 + m * 0.5 + proximity * 0.15; break;
      default: base = 0.32 + m * 0.62;
    }
    const slopeTerm = 1 - smoothstep(cliffSlope * 0.45, cliffSlope, slope[index]);
    const heightTerm = 1 - smoothstep(rockLine - 0.14, rockLine, data[index]);
    fertility[index] = clamp01(base * slopeTerm * heightTerm);
  }

  // Главное русло для ленты реки: самый длинный main.
  const main = hydrology.rivers.find((river) => river.main);
  const mainRiver = main && main.points.length >= 4
    ? { points: main.points, width: Math.max(1, Math.round(main.widths.reduce((sum, value) => sum + value, 0) / main.widths.length)) }
    : undefined;

  let finalWater = 0;
  for (let index = 0; index < total; index += 1) if (water[index]) finalWater += 1;
  return {
    cells,
    heights: data,
    slope,
    moisture,
    fertility,
    hydrology,
    frame,
    mainRiver,
    water,
    cliffSlope,
    report: {
      checks,
      actions,
      waterShare: finalWater / total,
      rockShare: rockCount / total,
      lakes: hydrology.lakes.length,
      rivers: hydrology.rivers.length,
      basins: hydrology.majorBasins,
    },
  };
}

/** Грунт суши по биому, влажности, высоте и близости воды. */
export function groundFor(biome: Biome, moisture: number, height: number, waterDistance: number, wetness: number, wetlands: number): Terrain {
  const wet = wetness > 0.78 - wetlands * 0.18;
  switch (biome) {
    case 'swamp':
      if (waterDistance <= 1 || wet) return 'mud';
      return moisture > 0.48 ? 'darkGrass' : 'grass';
    case 'desert':
      if (waterDistance <= 2) return moisture > 0.5 ? 'grass' : 'dirt';
      return moisture > 0.62 ? 'dirt' : 'sand';
    case 'snow':
      // Выдутые ветром сухие гребни — голый камень, но не весь склон.
      if (height > 0.76 && moisture < 0.26) return 'rock';
      return 'snow';
    case 'plains':
      if (wet && wetlands > 0.4) return 'mud';
      if (moisture < 0.3) return 'dirt';
      return moisture > 0.7 ? 'darkGrass' : 'grass';
    default:
      if (wet && wetlands > 0.4) return 'mud';
      if (moisture > 0.6) return 'darkGrass';
      if (moisture < 0.27) return 'dirt';
      return 'grass';
  }
}

/** Координаты сцены (u вдоль оси, v поперёк) — для размещения фокуса. */
export function sceneUV(result: LandscapeResult, width: number, height: number, x: number, y: number): { u: number; v: number } {
  return frameCoords(result.frame, width, height, x, y);
}
