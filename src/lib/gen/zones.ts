import { Perlin } from '../noise';
import type { Cell, GenSettings, Point, Terrain } from '../types';
import type { Zone, ZoneType } from './plan';

export const ZONE_TYPES: ZoneType[] = [
  'dense_forest',
  'medium_forest',
  'sparse_forest',
  'clearing',
  'meadow',
  'forest_edge',
  'wetland',
  'rocky',
  'roadside',
  'riverbank',
];

const BASE_DENSITY: Record<ZoneType, number> = {
  // Пещерные зоны (используются только cave-генератором).
  chamber: 0.26,
  tunnel: 0.1,
  shore: 0.5,
  rubble: 0.62,
  dense_forest: 0.95,
  medium_forest: 0.62,
  sparse_forest: 0.3,
  clearing: 0.05,
  meadow: 0.16,
  forest_edge: 0.44,
  wetland: 0.5,
  rocky: 0.28,
  roadside: 0.14,
  riverbank: 0.32,
};

const WATER: Terrain[] = ['water', 'deepWater'];

export interface ZoneField {
  width: number;
  height: number;
  kind: Uint8Array;
  density: Float32Array;
  zones: Zone[];
  typeAt(x: number, y: number): ZoneType;
  densityAt(x: number, y: number): number;
  has(x: number, y: number): boolean;
}

function classifyBiome(settings: GenSettings, big: number, medium: number, small: number): ZoneType {
  const v = big * 0.6 + medium * 0.4;
  switch (settings.biome) {
    case 'forest':
      // Пороги подобраны по реальному распределению fbm (среднее ~0.5),
      // чтобы в лесу были и чащи, и опушки, и поляны.
      if (v > 0.56) return 'dense_forest';
      if (v > 0.47) return 'medium_forest';
      if (v > 0.39) return 'sparse_forest';
      return small > 0.52 ? 'clearing' : 'meadow';
    case 'plains':
      if (v > 0.72) return 'medium_forest';
      if (v > 0.52) return 'sparse_forest';
      if (v > 0.34) return 'meadow';
      return 'clearing';
    case 'swamp':
      if (v > 0.55) return 'wetland';
      if (v > 0.38) return 'sparse_forest';
      if (v > 0.24) return 'meadow';
      return 'clearing';
    case 'desert':
      if (v > 0.62) return 'rocky';
      if (v > 0.4) return 'sparse_forest';
      return 'clearing';
    case 'snow':
      if (v > 0.58) return 'dense_forest';
      if (v > 0.38) return 'sparse_forest';
      if (v > 0.22) return 'meadow';
      return 'clearing';
    case 'village':
    case 'town':
      if (v > 0.66) return 'medium_forest';
      if (v > 0.46) return 'sparse_forest';
      return 'meadow';
    default:
      return 'sparse_forest';
  }
}

/** Клетки в радиусе 2 от линейного объекта (дорога/река) — для придорожных зон. */
function markNear(points: Point[], width: number, height: number, radius = 2): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const point of points) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = point.x + dx;
        const y = point.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Слой зон: пространственная функция плотности вместо поклеточной вероятности.
 * Сначала крупные области (чаща/редколесье/поляна), потом линейные зоны (берег,
 * обочина), потом «опушка» на стыке плотного леса и открытого места.
 */
export function buildZoneField(
  settings: GenSettings,
  cells: Cell[][],
  river: Point[],
  road: Point[],
): ZoneField {
  const { width, height } = settings;
  const big = new Perlin((settings.seed ^ 0x1f123bb5) >>> 0);
  const medium = new Perlin((settings.seed ^ 0x51ab3c7d) >>> 0);
  const small = new Perlin((settings.seed ^ 0x2b9c81e3) >>> 0);
  const bigScale = 0.045 + settings.roughness * 0.035;
  const mediumScale = 0.1 + settings.roughness * 0.05;
  const smallScale = 0.24;

  const kind = new Uint8Array(width * height);
  const nearRoad = markNear(road, width, height, 2);
  const nearRiver = markNear(river, width, height, 2);

  const index = (type: ZoneType) => ZONE_TYPES.indexOf(type);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const terrain = cells[y][x].terrain;
      if (WATER.includes(terrain)) {
        kind[at] = index('riverbank');
        continue;
      }
      if (nearRoad[at]) {
        kind[at] = index('roadside');
        continue;
      }
      if (nearRiver[at]) {
        kind[at] = index('riverbank');
        continue;
      }
      if (terrain === 'rock' || terrain === 'ice') {
        kind[at] = index('rocky');
        continue;
      }
      if (terrain === 'mud') {
        kind[at] = index('wetland');
        continue;
      }
      const bigValue = big.fbm(x * bigScale, y * bigScale, 3);
      const mediumValue = medium.fbm(x * mediumScale + 40, y * mediumScale + 40, 3);
      const smallValue = small.fbm(x * smallScale + 17, y * smallScale + 17, 2);
      kind[at] = index(classifyBiome(settings, bigValue, mediumValue, smallValue));
    }
  }

  // Опушка: плотный лес рядом с открытым местом — переходная зона, а не обрыв.
  const open: ZoneType[] = ['clearing', 'meadow'];
  const dense: ZoneType[] = ['dense_forest', 'medium_forest'];
  const kindCopy = kind.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const type = ZONE_TYPES[kindCopy[at]];
      if (!dense.includes(type)) continue;
      const n = [kindCopy[at - 1], kindCopy[at + 1], kindCopy[at - width], kindCopy[at + width]];
      if (n.some((value) => open.includes(ZONE_TYPES[value]))) kind[at] = index('forest_edge');
    }
  }

  // Плотность: базовая функция зоны + мелкая пространственная вариация (0.8..1.2).
  const density = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const base = BASE_DENSITY[ZONE_TYPES[kind[at]]];
      const variation = 0.8 + 0.4 * small.fbm(x * 0.33 + 90, y * 0.33 + 90, 2);
      density[at] = Math.max(0, Math.min(1, base * variation));
    }
  }

  const zones = aggregateZones(width, height, kind, density);

  return {
    width,
    height,
    kind,
    density,
    zones,
    typeAt: (x, y) => ZONE_TYPES[kind[y * width + x]],
    densityAt: (x, y) => density[y * width + x],
    has: (x, y) => x >= 0 && y >= 0 && x < width && y < height,
  };
}

/** Крупные зоны для плана: доминирующая зона в блоке 1/3 карты. */
function aggregateZones(width: number, height: number, kind: Uint8Array, density: Float32Array): Zone[] {
  const blocksX = 3;
  const blocksY = 3;
  const zones: Zone[] = [];
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const x0 = Math.floor((bx * width) / blocksX);
      const x1 = Math.floor(((bx + 1) * width) / blocksX);
      const y0 = Math.floor((by * height) / blocksY);
      const y1 = Math.floor(((by + 1) * height) / blocksY);
      if (x1 <= x0 || y1 <= y0) continue;
      const counts = new Map<number, number>();
      let densitySum = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const at = y * width + x;
          counts.set(kind[at], (counts.get(kind[at]) ?? 0) + 1);
          densitySum += density[at];
          total += 1;
        }
      }
      let dominant = 0;
      let dominantCount = -1;
      counts.forEach((count, value) => {
        if (count > dominantCount) {
          dominant = value;
          dominantCount = count;
        }
      });
      zones.push({
        id: `zone_${bx}_${by}`,
        type: ZONE_TYPES[dominant],
        density: total ? densitySum / total : 0,
        bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        area: total,
      });
    }
  }
  return zones;
}
