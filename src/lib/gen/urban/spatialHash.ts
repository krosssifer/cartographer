import { intersects } from '../../settlementKit';
import type { Selection } from '../../types';

interface SpatialEntry<T> {
  id: number;
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/**
 * Пространственный хеш 2D (SpatialHash) для O(1) проверок пересечений,
 * минимальных дистанций (minSpacing) и выборки соседних объектов на картах до 200×160.
 * Не выделяет временных Set на каждый запрос благодаря счётчику поколений (stamp).
 */
export class SpatialHash<T> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly buckets: SpatialEntry<T>[][];
  private seenStamp: Int32Array;
  private currentStamp = 1;
  private nextId = 0;

  constructor(width: number, height: number, cellSize = 8) {
    this.cellSize = Math.max(2, cellSize);
    this.cols = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    this.seenStamp = new Int32Array(256);
  }

  private bumpStamp(): number {
    this.currentStamp += 1;
    if (this.currentStamp >= 0x7ffffff0) {
      this.seenStamp.fill(0);
      this.currentStamp = 1;
    }
    return this.currentStamp;
  }

  private ensureCapacity(id: number): void {
    if (id < this.seenStamp.length) return;
    let nextLen = this.seenStamp.length;
    while (nextLen <= id) nextLen *= 2;
    const grown = new Int32Array(nextLen);
    grown.set(this.seenStamp);
    this.seenStamp = grown;
  }

  private colRange(x0: number, x1: number): [number, number] {
    const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor(x0 / this.cellSize)));
    const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor(x1 / this.cellSize)));
    return [c0, c1];
  }

  private rowRange(y0: number, y1: number): [number, number] {
    const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor(y0 / this.cellSize)));
    const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor(y1 / this.cellSize)));
    return [r0, r1];
  }

  insert(item: T, x: number, y: number, w = 0, h = 0): number {
    const id = this.nextId++;
    this.ensureCapacity(id);
    const entry: SpatialEntry<T> = {
      id,
      item,
      x,
      y,
      w,
      h,
      cx: x + w * 0.5,
      cy: y + h * 0.5,
    };
    const [c0, c1] = this.colRange(x, x + (w > 0 ? Math.max(0, w - 0.001) : 0));
    const [r0, r1] = this.rowRange(y, y + (h > 0 ? Math.max(0, h - 0.001) : 0));
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c += 1) {
        this.buckets[base + c].push(entry);
      }
    }
    return id;
  }

  remove(predicate: (item: T) => boolean): number {
    let removedIds = new Set<number>();
    for (const bucket of this.buckets) {
      for (let i = bucket.length - 1; i >= 0; i -= 1) {
        if (predicate(bucket[i].item)) {
          removedIds.add(bucket[i].id);
          bucket.splice(i, 1);
        }
      }
    }
    return removedIds.size;
  }

  /** Быстрая проверка пересечения прямоугольника с учётом зазора `gap` без аллокаций массива. */
  hasOverlap(
    rect: Selection,
    gap = 0,
    predicate?: (item: T) => boolean,
  ): boolean {
    const [c0, c1] = this.colRange(rect.x - gap, rect.x + rect.w + gap - 0.001);
    const [r0, r1] = this.rowRange(rect.y - gap, rect.y + rect.h + gap - 0.001);
    const stamp = this.bumpStamp();
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c += 1) {
        const bucket = this.buckets[base + c];
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i];
          if (this.seenStamp[entry.id] === stamp) continue;
          this.seenStamp[entry.id] = stamp;
          if (intersects(rect, entry, gap)) {
            if (!predicate || predicate(entry.item)) return true;
          }
        }
      }
    }
    return false;
  }

  /** Проверка наличия объекта в радиусе `radius` от точки `(cx, cy)`. */
  hasWithinRadius(
    cx: number,
    cy: number,
    radius: number,
    predicate?: (item: T) => boolean,
  ): boolean {
    if (radius <= 0) return false;
    const r2 = radius * radius;
    const [c0, c1] = this.colRange(cx - radius, cx + radius);
    const [r0, r1] = this.rowRange(cy - radius, cy + radius);
    const stamp = this.bumpStamp();
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c += 1) {
        const bucket = this.buckets[base + c];
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i];
          if (this.seenStamp[entry.id] === stamp) continue;
          this.seenStamp[entry.id] = stamp;
          const dx = entry.cx - cx;
          const dy = entry.cy - cy;
          if (dx * dx + dy * dy <= r2) {
            if (!predicate || predicate(entry.item)) return true;
          }
        }
      }
    }
    return false;
  }

  /** Возвращает уникальные элементы, чьи ячейки пересекают заданный прямоугольник. */
  queryRect(x: number, y: number, w: number, h: number): T[] {
    const [c0, c1] = this.colRange(x, x + Math.max(0, w - 0.001));
    const [r0, r1] = this.rowRange(y, y + Math.max(0, h - 0.001));
    const stamp = this.bumpStamp();
    const out: T[] = [];
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c += 1) {
        const bucket = this.buckets[base + c];
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i];
          if (this.seenStamp[entry.id] === stamp) continue;
          this.seenStamp[entry.id] = stamp;
          if (intersects({ x, y, w, h }, entry, 0)) {
            out.push(entry.item);
          }
        }
      }
    }
    return out;
  }

  /** Возвращает уникальные элементы в радиусе `radius` от `(cx, cy)`. */
  queryRadius(cx: number, cy: number, radius: number): T[] {
    if (radius <= 0) return [];
    const r2 = radius * radius;
    const [c0, c1] = this.colRange(cx - radius, cx + radius);
    const [r0, r1] = this.rowRange(cy - radius, cy + radius);
    const stamp = this.bumpStamp();
    const out: T[] = [];
    for (let r = r0; r <= r1; r += 1) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c += 1) {
        const bucket = this.buckets[base + c];
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i];
          if (this.seenStamp[entry.id] === stamp) continue;
          this.seenStamp[entry.id] = stamp;
          const dx = entry.cx - cx;
          const dy = entry.cy - cy;
          if (dx * dx + dy * dy <= r2) {
            out.push(entry.item);
          }
        }
      }
    }
    return out;
  }
}
