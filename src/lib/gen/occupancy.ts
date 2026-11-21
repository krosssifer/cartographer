import type { ObjectKind, SpriteCatalogEntry } from './catalog';
import { SPRITE_CATALOG } from './catalog';

export const CELL_FREE = 0;
/** Мягкая занятость: объект можно перекрыть декором или группой. */
export const CELL_SOFT = 1;
/** Жёсткая занятость: сюда ставить нельзя (дорога, вода, постройка, ствол). */
export const CELL_BLOCKED = 2;

/**
 * Сетка занятости пространства. Базовый механизм размещения: решение «можно ли
 * поставить объект» принимается здесь, а не в разрозненных if-ах по коду.
 */
export class OccupancyGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  level(x: number, y: number): number {
    if (!this.inBounds(x, y)) return CELL_BLOCKED;
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, level: number): void {
    if (!this.inBounds(x, y)) return;
    const index = y * this.width + x;
    if (level > this.cells[index]) this.cells[index] = level;
  }

  /** Все клетки прямоугольника свободны (или допускают мягкое перекрытие). */
  rectFree(x: number, y: number, w: number, h: number, allowSoft = false): boolean {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const level = this.level(x + dx, y + dy);
        if (level === CELL_BLOCKED || (level === CELL_SOFT && !allowSoft)) return false;
      }
    }
    return true;
  }

  /** Занять прямоугольник под объект. */
  reserveRect(x: number, y: number, w: number, h: number, level = CELL_BLOCKED): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, level);
    }
  }

  /**
   * Проверка размещения объекта по каталогу: клетка якоря + footprint.
   * Для крупных объектов с чётным footprint якорь ставится в его центр.
   */
  canPlace(entry: SpriteCatalogEntry, cellX: number, cellY: number, allowSoft = false): boolean {
    const { width, height } = entry.footprint;
    const x = cellX - Math.floor(width / 2);
    const y = cellY - Math.floor(height / 2);
    if (!this.rectFree(x, y, width, height, allowSoft)) return false;
    return true;
  }

  place(entry: SpriteCatalogEntry, cellX: number, cellY: number): void {
    const { width, height } = entry.footprint;
    const x = cellX - Math.floor(width / 2);
    const y = cellY - Math.floor(height / 2);
    this.reserveRect(x, y, width, height, CELL_SOFT);
  }

  /** Полная блокировка (дорога/вода/постройка) из карты террейна. */
  static fromMap(
    width: number,
    height: number,
    terrainAt: (x: number, y: number) => string,
    isBlocked: (terrain: string) => boolean,
  ): OccupancyGrid {
    const grid = new OccupancyGrid(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (isBlocked(terrainAt(x, y))) grid.set(x, y, CELL_BLOCKED);
      }
    }
    return grid;
  }
}

interface PlacedPoint {
  x: number;
  y: number;
  kind: ObjectKind;
  radius: number;
}

/**
 * Пространственный хэш уже поставленных объектов: проверка minDistance без
 * перебора всех объектов на каждую клетку.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, PlacedPoint[]>();

  constructor(cellSize = 2) {
    this.cellSize = Math.max(1, cellSize);
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }

  add(point: PlacedPoint): void {
    const key = this.key(point.x, point.y);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  /** Есть ли объект того же класса ближе minDistance клеток. */
  tooClose(x: number, y: number, kind: ObjectKind, minDistance: number): boolean {
    const reach = Math.ceil((minDistance + 1.2) / this.cellSize) + 1;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    for (let gy = cy - reach; gy <= cy + reach; gy += 1) {
      for (let gx = cx - reach; gx <= cx + reach; gx += 1) {
        const bucket = this.buckets.get(`${gx}:${gy}`);
        if (!bucket) continue;
        for (const point of bucket) {
          if (point.kind !== kind) continue;
          const dx = point.x - x;
          const dy = point.y - y;
          const min = Math.max(minDistance, point.radius);
          if (dx * dx + dy * dy < min * min) return true;
        }
      }
    }
    return false;
  }

  count(): number {
    let total = 0;
    this.buckets.forEach((bucket) => {
      total += bucket.length;
    });
    return total;
  }
}

export const catalogEntry = (kind: ObjectKind): SpriteCatalogEntry => SPRITE_CATALOG[kind];
