// Поле высот для сцен с рельефом.
//
// Прежний генератор открытой местности брал высоту прямо из fBm Перлина и
// резал её порогами: получались «пятна», но не хребты, долины и обрывы.
// Здесь высота собирается из трёх частей:
//   1) профиль рельефа сцены (перевал, долина, котловина, плато, острова…) —
//      крупная форма, которая и делает карту «горным перевалом», а не шумом;
//   2) детальный шум: fBm с искажением координат (domain warp) — мягкие холмы
//      без сеточной регулярности; ridged multifractal — острые гребни на склонах;
//   3) эрозия: термальная (осыпи сглаживают иглы) и упрощённая гидравлическая
//      (капли прорезают ложбины вниз по склону).
// Все массивы — типизированные (Float32Array), всё детерминировано сидом.

import { Perlin } from '../noise';
import { SeededRandom } from './random';

export type ReliefKind =
  | 'gentle'
  | 'rolling'
  | 'pass'
  | 'valley'
  | 'basin'
  | 'ridge'
  | 'plateau'
  | 'islands'
  | 'cliffside'
  | 'lakeland';

export interface HeightField {
  width: number;
  height: number;
  /** Высота 0..1, индекс y * width + x. */
  data: Float32Array;
}

export interface ReliefFrame {
  /** Главная ось сцены: вдоль неё идут долина, перевал, тракт. */
  horizontal: boolean;
  /** Небольшой поворот оси (рад), чтобы долина не шла строго по сетке. */
  tilt: number;
  /** Сторона массива для cliffside: -1 — «верх/лево», 1 — «низ/право». */
  side: -1 | 1;
}

export interface ReliefOptions {
  relief: ReliefKind;
  roughness: number;
  seed: number;
  frame: ReliefFrame;
  erosion: boolean;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** fBm в диапазоне примерно [-1, 1] (Perlin.fbm отдаёт [0, 1]). */
export function signedFbm(noise: Perlin, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  return noise.fbm(x, y, octaves, lacunarity, gain) * 2 - 1;
}

/**
 * Ridged multifractal (Musgrave): острые гребни там, где шум пересекает ноль.
 * Каждая следующая октава взвешивается предыдущей — гребни ветвятся, а
 * долины между ними остаются гладкими. Результат 0..1.
 */
export function ridgedMultifractal(noise: Perlin, x: number, y: number, octaves: number, lacunarity = 2.1, gain = 2, offset = 1): number {
  let frequency = 1;
  let weight = 1;
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    let signal = offset - Math.abs(noise.noise(x * frequency, y * frequency));
    signal *= signal;
    signal *= weight;
    weight = clamp01(signal * gain);
    sum += signal * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= lacunarity;
  }
  return clamp01(sum / norm);
}

/** Domain warp: координаты сдвигаются полем шума — формы перестают быть «круглыми». */
export function warpPoint(noise: Perlin, x: number, y: number, strength: number, scale: number): [number, number] {
  const qx = signedFbm(noise, x * scale + 5.2, y * scale + 1.3, 3);
  const qy = signedFbm(noise, x * scale + 1.7, y * scale + 9.2, 3);
  return [x + qx * strength, y + qy * strength];
}

/** Террасирование: плоские ступени с крутыми уступами между ними (плато). */
function terrace(value: number, steps: number, sharpness: number): number {
  const scaled = value * steps;
  const base = Math.floor(scaled);
  const fraction = scaled - base;
  const shaped = smoothstep(0.5 - sharpness, 0.5 + sharpness, fraction);
  return (base + shaped) / steps;
}

/**
 * Координаты сцены: u — вдоль главной оси (0..1), v — поперёк (0..1).
 * Наклон оси задаётся tilt, центр — середина карты.
 */
export function frameCoords(frame: ReliefFrame, width: number, height: number, x: number, y: number): { u: number; v: number } {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(frame.tilt);
  const sin = Math.sin(frame.tilt);
  const along = frame.horizontal ? dx * cos + dy * sin : dy * cos - dx * sin;
  const across = frame.horizontal ? -dx * sin + dy * cos : dx * cos + dy * sin;
  const alongSpan = frame.horizontal ? width : height;
  const acrossSpan = frame.horizontal ? height : width;
  return { u: clamp01(along / alongSpan + 0.5), v: clamp01(across / acrossSpan + 0.5) };
}

/** Линия дна долины/перевала: плавно виляет вокруг середины. */
export function valleyCenter(noise: Perlin, u: number, amplitude: number): number {
  return 0.5 + Math.sin(u * Math.PI * 1.6 + 0.7) * amplitude * 0.6 + noise.noise(u * 2.3 + 40, 3.7) * amplitude;
}

/** Крупная форма рельефа сцены (0..1) без деталей. */
function reliefShape(kind: ReliefKind, noise: Perlin, frame: ReliefFrame, u: number, v: number, pits: { u: number; v: number; r: number }[]): number {
  switch (kind) {
    case 'gentle':
      return 0.45;
    case 'rolling':
      return 0.42 + signedFbm(noise, u * 2.2 + 11, v * 2.2 + 4, 2) * 0.18;
    case 'valley': {
      const center = valleyCenter(noise, u, 0.08);
      const distance = Math.abs(v - center);
      // U-образная долина: широкое дно, крутые, но не отвесные склоны.
      return 0.16 + smoothstep(0.12, 0.42, distance) * 0.7;
    }
    case 'pass': {
      const center = valleyCenter(noise, u, 0.05);
      const distance = Math.abs(v - center);
      // Седловина: дно поднимается к середине прохода, стены — скальные гребни.
      const saddle = 0.24 + (1 - Math.abs(u - 0.5) * 2) * 0.12;
      const walls = smoothstep(0.08, 0.24, distance);
      return saddle + walls * (0.78 - saddle) + smoothstep(0.3, 0.5, distance) * 0.12;
    }
    case 'basin': {
      const du = (u - 0.5) * 1.1;
      const dv = v - 0.5;
      const distance = Math.hypot(du, dv) * 2;
      return 0.18 + smoothstep(0.35, 1.05, distance) * 0.62;
    }
    case 'ridge': {
      const center = valleyCenter(noise, u, 0.12);
      const distance = Math.abs(v - center);
      return 0.28 + Math.exp(-(distance * distance) / 0.012) * 0.6;
    }
    case 'plateau':
      return 0.35 + signedFbm(noise, u * 1.6 + 2, v * 1.6 + 8, 2) * 0.25;
    case 'islands':
      return 0.32 + signedFbm(noise, u * 3.1 + 7, v * 3.1 + 2, 3) * 0.22;
    case 'cliffside': {
      // Массив занимает треть карты со стороны side, край — уступ с изломом.
      const across = frame.side < 0 ? v : 1 - v;
      const edge = 0.3 + noise.noise(u * 3.4 + 21, 1.9) * 0.07;
      return 0.3 + smoothstep(edge + 0.06, edge - 0.04, across) * 0.55 - across * 0.08;
    }
    case 'lakeland': {
      let value = 0.5 + signedFbm(noise, u * 1.8 + 30, v * 1.8 + 30, 2) * 0.12;
      for (const pit of pits) {
        const distance = Math.hypot((u - pit.u) * 1.2, v - pit.v);
        value -= Math.exp(-(distance * distance) / (pit.r * pit.r)) * 0.32;
      }
      return value;
    }
  }
}

/** Насколько сильно у профиля работают острые гребни (горные склоны). */
const RIDGE_WEIGHT: Record<ReliefKind, number> = {
  gentle: 0.04, rolling: 0.08, pass: 0.32, valley: 0.22, basin: 0.12, ridge: 0.3,
  plateau: 0.1, islands: 0.02, cliffside: 0.26, lakeland: 0.05,
};

/** Амплитуда мелкого рельефа для профиля. */
const DETAIL_WEIGHT: Record<ReliefKind, number> = {
  gentle: 0.22, rolling: 0.26, pass: 0.12, valley: 0.12, basin: 0.14, ridge: 0.14,
  plateau: 0.2, islands: 0.2, cliffside: 0.12, lakeland: 0.16,
};

export function buildHeightField(width: number, height: number, options: ReliefOptions): HeightField {
  const { relief, roughness, seed, frame } = options;
  const shapeNoise = new Perlin(seed ^ 0x2f6b1d);
  const detailNoise = new Perlin(seed ^ 0x51a3c9);
  const ridgeNoise = new Perlin(seed ^ 0x7c0de5);
  const rng = new SeededRandom(seed, 0x4e1f);
  const pits: { u: number; v: number; r: number }[] = [];
  if (relief === 'lakeland') {
    const count = 2 + rng.int(0, 2);
    for (let index = 0; index < count; index += 1) {
      pits.push({ u: rng.range(0.18, 0.82), v: rng.range(0.2, 0.8), r: rng.range(0.1, 0.17) });
    }
  }
  const data = new Float32Array(width * height);
  const detailScale = 0.05 + roughness * 0.07;
  const octaves = 3 + Math.round(roughness * 2);
  const ridgeWeight = RIDGE_WEIGHT[relief] * (0.6 + roughness * 0.8);
  const detailWeight = DETAIL_WEIGHT[relief] * (0.7 + roughness * 0.6);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { u, v } = frameCoords(frame, width, height, x, y);
      const shape = reliefShape(relief, shapeNoise, frame, u, v, pits);
      const [wx, wy] = warpPoint(detailNoise, x * detailScale, y * detailScale, 0.9, 0.6);
      const detail = signedFbm(detailNoise, wx, wy, octaves);
      // Гребни сильнее там, где профиль высокий: склоны гор, а не дно долины.
      const ridge = ridgedMultifractal(ridgeNoise, x * detailScale * 0.9 + 17, y * detailScale * 0.9 + 3, 4);
      const ridgeMask = smoothstep(0.35, 0.75, shape);
      let value = shape + detail * detailWeight + (ridge - 0.45) * ridgeWeight * ridgeMask;
      if (relief === 'plateau') value = terrace(clamp01(value), 4, 0.12);
      data[y * width + x] = value;
    }
  }
  normalize(data);
  if (options.erosion) {
    thermalErosion(data, width, height, 0.045, 5);
    hydraulicErosion(data, width, height, rng, Math.round(width * height * 0.7));
    normalize(data);
  }
  return { width, height, data };
}

/** Растягивает поле на 0..1 (по фактическим min/max). */
export function normalize(data: Float32Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] < min) min = data[index];
    if (data[index] > max) max = data[index];
  }
  const span = max - min || 1;
  for (let index = 0; index < data.length; index += 1) data[index] = (data[index] - min) / span;
}

const NEIGHBOURS_8: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Термальная эрозия: материал, превышающий угол осыпи (talus), сползает к
 * более низким соседям. Убирает одноклеточные иглы и даёт осыпи у обрывов.
 */
export function thermalErosion(data: Float32Array, width: number, height: number, talus: number, iterations: number): void {
  const delta = new Float32Array(data.length);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    delta.fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const here = data[index];
        let total = 0;
        let maxDiff = 0;
        for (const [dx, dy, distance] of NEIGHBOURS_8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const diff = (here - data[ny * width + nx]) / distance;
          if (diff > talus) {
            total += diff - talus;
            if (diff > maxDiff) maxDiff = diff;
          }
        }
        if (total <= 0) continue;
        const moved = 0.5 * (maxDiff - talus);
        for (const [dx, dy, distance] of NEIGHBOURS_8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const diff = (here - data[ny * width + nx]) / distance;
          if (diff <= talus) continue;
          const share = moved * ((diff - talus) / total);
          delta[index] -= share;
          delta[ny * width + nx] += share;
        }
      }
    }
    for (let index = 0; index < data.length; index += 1) data[index] += delta[index];
  }
}

/**
 * Упрощённая гидравлическая эрозия (капельная модель). Капля стекает по
 * градиенту, набирает осадок на крутых участках и откладывает на пологих.
 * На сетке 100×80 это ~5600 капель по ≤40 шагов — единицы миллисекунд.
 */
export function hydraulicErosion(data: Float32Array, width: number, height: number, rng: SeededRandom, drops: number): void {
  const inertia = 0.25;
  const capacityFactor = 3.2;
  const erodeRate = 0.25;
  const depositRate = 0.2;
  const evaporate = 0.04;
  const minSlope = 0.003;
  const sample = (x: number, y: number): number => {
    const ix = Math.max(0, Math.min(width - 2, Math.floor(x)));
    const iy = Math.max(0, Math.min(height - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - ix));
    const fy = Math.max(0, Math.min(1, y - iy));
    const a = data[iy * width + ix];
    const b = data[iy * width + ix + 1];
    const c = data[(iy + 1) * width + ix];
    const d = data[(iy + 1) * width + ix + 1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };
  for (let drop = 0; drop < drops; drop += 1) {
    let x = rng.range(1, width - 2);
    let y = rng.range(1, height - 2);
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let step = 0; step < 40; step += 1) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix < 1 || iy < 1 || ix >= width - 2 || iy >= height - 2) break;
      const here = sample(x, y);
      const gradX = sample(x + 0.5, y) - sample(x - 0.5, y);
      const gradY = sample(x, y + 0.5) - sample(x, y - 0.5);
      dirX = dirX * inertia - gradX * (1 - inertia);
      dirY = dirY * inertia - gradY * (1 - inertia);
      const length = Math.hypot(dirX, dirY);
      if (length < 1e-6) break;
      dirX /= length;
      dirY /= length;
      x += dirX;
      y += dirY;
      if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) break;
      const next = sample(x, y);
      const fall = here - next;
      const capacity = Math.max(fall, minSlope) * speed * water * capacityFactor * 0.01;
      const cell = iy * width + ix;
      if (fall < 0 || sediment > capacity) {
        // Отложение: в ямке или когда капля перегружена.
        const amount = fall < 0 ? Math.min(-fall, sediment) : (sediment - capacity) * depositRate;
        sediment -= amount;
        data[cell] += amount;
      } else {
        const amount = Math.min((capacity - sediment) * erodeRate, fall);
        sediment += amount;
        data[cell] -= amount;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + fall * 4));
      water *= 1 - evaporate;
    }
  }
}

/** Крутизна склона в клетке: максимальный перепад до 8 соседей. */
export function slopeField(field: HeightField): Float32Array {
  const { width, height, data } = field;
  const slope = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const here = data[y * width + x];
      let max = 0;
      for (const [dx, dy, distance] of NEIGHBOURS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const diff = Math.abs(here - data[ny * width + nx]) / distance;
        if (diff > max) max = diff;
      }
      slope[y * width + x] = max;
    }
  }
  return slope;
}
