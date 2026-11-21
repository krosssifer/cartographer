import { mulberry32, hash2, pick, randInt, type Rng } from '../random';

/**
 * Обёртка над mulberry32: вся структурная генерация получает случайность только
 * отсюда. Никаких Math.random()/Date.now() — иначе сломается детерминизм и
 * layout-test (повторная генерация обязана совпадать через deepEqual).
 */
export class SeededRandom {
  private readonly rng: Rng;

  constructor(seed: number, salt = 0) {
    this.rng = mulberry32((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
  }

  next(): number {
    return this.rng();
  }

  /** Случайное целое в [min, max]. */
  int(min: number, max: number): number {
    return randInt(this.rng, min, max);
  }

  /** Случайное число в [min, max). */
  range(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  chance(probability: number): boolean {
    return this.rng() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return pick(this.rng, items.slice());
  }

  /** Детерминированная перестановка (Fisher–Yates). */
  shuffle<T>(items: T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /** Пространственный хэш-бросок: не двигает общий поток, удобен для клеток. */
  spatial(x: number, y: number, salt = 0): number {
    return hash2(x, y, (salt ^ 0x51ed270b) >>> 0);
  }
}
