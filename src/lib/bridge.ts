import { doorAxis } from './doors';
import type { MapData, Terrain } from './types';

// Непроходимые/непрозрачные типы клеток. Остальные (floor, caveFloor,
// buildingFloor, plaza, grass, water, door и т.д.) считаются открытыми.
const BLOCKING = new Set<Terrain>(['wall', 'caveWall', 'buildingWall', 'void', 'roof']);

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function isBlocking(map: MapData, x: number, y: number): boolean {
  const t = map.cells[y]?.[x]?.terrain;
  return t === undefined || BLOCKING.has(t);
}

/** Склеивает смежные коллинеарные отрезки в более длинные линии. */
function mergeCollinear(segments: WallSegment[]): WallSegment[] {
  const horizontal = new Map<number, WallSegment[]>();
  const vertical = new Map<number, WallSegment[]>();
  for (const s of segments) {
    if (s.y1 === s.y2) {
      const arr = horizontal.get(s.y1) ?? [];
      arr.push(s);
      horizontal.set(s.y1, arr);
    } else {
      const arr = vertical.get(s.x1) ?? [];
      arr.push(s);
      vertical.set(s.x1, arr);
    }
  }
  const result: WallSegment[] = [];
  const EPS = 1e-6;
  for (const [, segs] of horizontal) {
    segs.sort((a, b) => a.x1 - b.x1);
    let cur: WallSegment | null = null;
    for (const s of segs) {
      if (!cur) cur = { ...s };
      else if (s.x1 <= cur.x2 + EPS) cur.x2 = Math.max(cur.x2, s.x2);
      else { result.push(cur); cur = { ...s }; }
    }
    if (cur) result.push(cur);
  }
  for (const [, segs] of vertical) {
    segs.sort((a, b) => a.y1 - b.y1);
    let cur: WallSegment | null = null;
    for (const s of segs) {
      if (!cur) cur = { ...s };
      else if (s.y1 <= cur.y2 + EPS) cur.y2 = Math.max(cur.y2, s.y2);
      else { result.push(cur); cur = { ...s }; }
    }
    if (cur) result.push(cur);
  }
  return result;
}

/**
 * Извлекает контур непроходимых клеток как отрезки стен (в пикселях).
 * Для каждой открытой клетки, граничащей с непроходимой, создаётся отрезок
 * вдоль этой грани. Затем смежные коллинеарные отрезки склеиваются.
 */
export function extractWalls(map: MapData, cs: number): WallSegment[] {
  const segments: WallSegment[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isBlocking(map, x, y)) continue;
      const left = x * cs;
      const right = (x + 1) * cs;
      const top = y * cs;
      const bottom = (y + 1) * cs;
      if (isBlocking(map, x, y - 1)) segments.push({ x1: left, y1: top, x2: right, y2: top });
      if (isBlocking(map, x, y + 1)) segments.push({ x1: left, y1: bottom, x2: right, y2: bottom });
      if (isBlocking(map, x - 1, y)) segments.push({ x1: left, y1: top, x2: left, y2: bottom });
      if (isBlocking(map, x + 1, y)) segments.push({ x1: right, y1: top, x2: right, y2: bottom });
    }
  }
  return mergeCollinear(segments);
}

/**
 * Извлекает двери как отрезок поперёк проёма (в центре клетки).
 * doorAxis 'horizontal' → горизонтальный отрезок (перекрывает проход север-юг);
 * 'vertical' → вертикальный отрезок (перекрывает проход запад-восток).
 */
export function extractDoors(map: MapData, cs: number): WallSegment[] {
  const doors: WallSegment[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.cells[y][x].terrain !== 'door') continue;
      const cx = (x + 0.5) * cs;
      const cy = (y + 0.5) * cs;
      if (doorAxis(map, x, y) === 'horizontal') {
        doors.push({ x1: x * cs, y1: cy, x2: (x + 1) * cs, y2: cy });
      } else {
        doors.push({ x1: cx, y1: y * cs, x2: cx, y2: (y + 1) * cs });
      }
    }
  }
  return doors;
}
