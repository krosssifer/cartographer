/**
 * Единые ограничения и профили размеров карты (Urban Generation 2.0 — Phase 1).
 *
 * Все точки входа — UI, пресеты, генератор и сериализация проектов — используют
 * эти функции, чтобы ограничение `width * height <= 32000` соблюдалось везде.
 */

export type MapSizeProfile = 'standard' | 'large' | 'epic' | 'custom';

export const MIN_MAP_DIM = 10;
export const MAX_MAP_WIDTH = 320;
export const MAX_MAP_HEIGHT = 320;
export const MAX_CUSTOM_SLIDER_WIDTH = 240;
export const MAX_CUSTOM_SLIDER_HEIGHT = 200;
export const MAX_MAP_CELLS = 32_000;

/** Безопасный предел пикселей холста при экспорте PNG (~64 Мпкс ≈ 256 МБ RGBA). */
export const EXPORT_PIXEL_BUDGET = 64_000_000;

export interface MapSizeProfileSpec {
  id: Exclude<MapSizeProfile, 'custom'>;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  cells: number;
}

export const MAP_SIZE_PROFILES: Record<Exclude<MapSizeProfile, 'custom'>, MapSizeProfileSpec> = {
  standard: {
    id: 'standard',
    label: 'Standard (100 × 80)',
    shortLabel: 'Standard',
    width: 100,
    height: 80,
    cells: 8_000,
  },
  large: {
    id: 'large',
    label: 'Large (160 × 120)',
    shortLabel: 'Large',
    width: 160,
    height: 120,
    cells: 19_200,
  },
  epic: {
    id: 'epic',
    label: 'Epic (200 × 160)',
    shortLabel: 'Epic',
    width: 200,
    height: 160,
    cells: 32_000,
  },
};

export const MAP_SIZE_PROFILE_ORDER: readonly MapSizeProfile[] = ['standard', 'large', 'epic', 'custom'];

export const MAP_SIZE_PROFILE_LABELS: Record<MapSizeProfile, string> = {
  standard: MAP_SIZE_PROFILES.standard.label,
  large: MAP_SIZE_PROFILES.large.label,
  epic: MAP_SIZE_PROFILES.epic.label,
  custom: 'Custom (произвольный)',
};

export function isMapSizeProfile(value: unknown): value is MapSizeProfile {
  return value === 'standard' || value === 'large' || value === 'epic' || value === 'custom';
}

export function detectMapSizeProfile(width: number, height: number): MapSizeProfile {
  if (width === 100 && height === 80) return 'standard';
  if (width === 160 && height === 120) return 'large';
  if (width === 200 && height === 160) return 'epic';
  return 'custom';
}

export function isValidMapDimensions(width: unknown, height: unknown): boolean {
  if (typeof width !== 'number' || typeof height !== 'number') return false;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < MIN_MAP_DIM || width > MAX_MAP_WIDTH) return false;
  if (height < MIN_MAP_DIM || height > MAX_MAP_HEIGHT) return false;
  return width * height <= MAX_MAP_CELLS;
}

/**
 * Приводит произвольные `width` и `height` к допустимым целым размерам
 * с гарантией `width * height <= 32000`.
 *
 * - При изменении конкретной оси (`changedAxis = 'width' | 'height'`) эта ось
 *   сохраняет приоритет, а парная поджимается до `floor(32000 / primary)`.
 * - Без `changedAxis` обе стороны масштабируются пропорционально с сохранением пропорций.
 */
export function clampMapDimensions(
  rawWidth: number,
  rawHeight: number,
  changedAxis?: 'width' | 'height',
): { width: number; height: number } {
  let width = Math.max(
    MIN_MAP_DIM,
    Math.min(MAX_MAP_WIDTH, Math.round(Number.isFinite(rawWidth) ? rawWidth : 100)),
  );
  let height = Math.max(
    MIN_MAP_DIM,
    Math.min(MAX_MAP_HEIGHT, Math.round(Number.isFinite(rawHeight) ? rawHeight : 80)),
  );

  if (width * height <= MAX_MAP_CELLS) {
    return { width, height };
  }

  if (changedAxis === 'width') {
    height = Math.max(MIN_MAP_DIM, Math.min(MAX_MAP_HEIGHT, Math.floor(MAX_MAP_CELLS / width)));
    if (width * height > MAX_MAP_CELLS) {
      width = Math.max(MIN_MAP_DIM, Math.floor(MAX_MAP_CELLS / height));
    }
    return { width, height };
  }

  if (changedAxis === 'height') {
    width = Math.max(MIN_MAP_DIM, Math.min(MAX_MAP_WIDTH, Math.floor(MAX_MAP_CELLS / height)));
    if (width * height > MAX_MAP_CELLS) {
      height = Math.max(MIN_MAP_DIM, Math.floor(MAX_MAP_CELLS / width));
    }
    return { width, height };
  }

  const scale = Math.sqrt(MAX_MAP_CELLS / (width * height));
  width = Math.max(MIN_MAP_DIM, Math.min(MAX_MAP_WIDTH, Math.floor(width * scale)));
  height = Math.max(MIN_MAP_DIM, Math.min(MAX_MAP_HEIGHT, Math.floor(height * scale)));
  while (width * height > MAX_MAP_CELLS) {
    if (width >= height && width > MIN_MAP_DIM) width -= 1;
    else if (height > MIN_MAP_DIM) height -= 1;
    else break;
  }
  return { width, height };
}

/** Безопасный cellSize для экспорта PNG без переполнения памяти холста на Epic-картах. */
export function safeExportCellSize(
  mapWidth: number,
  mapHeight: number,
  desiredCellSize: number,
  budget = EXPORT_PIXEL_BUDGET,
): number {
  const cells = Math.max(1, mapWidth * mapHeight);
  const maxCellSize = Math.max(12, Math.floor(Math.sqrt(budget / cells)));
  return Math.max(12, Math.min(Math.round(desiredCellSize), maxCellSize));
}
