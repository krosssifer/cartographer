import type { Point } from './types';

/**
 * Сглаживание ломаной алгоритмом Чайкина: каждая итерация заменяет отрезок
 * двумя точками на четвертях. Концы линии остаются на месте, поэтому дороги
 * и реки не «отклеиваются» от краёв карты и от точек-целей.
 */
export function chaikin(points: Point[], iterations = 2): Point[] {
  let current = points;
  for (let pass = 0; pass < Math.max(0, iterations); pass += 1) {
    if (current.length < 3) return current;
    const next: Point[] = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i];
      const b = current[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}
