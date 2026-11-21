/**
 * Структурная надстройка над подземельем.
 *
 * Генерация залов уже есть в generator.ts; здесь мы делаем из плоского списка
 * прямоугольников осмысленную структуру:
 *   граф связности залов → BFS-глубина от входа → назначение зала.
 *
 * Назначение зала — это не декор ради декора: от него зависит, что в зале
 * лежит (мебель, саркофаги, стража) и как ведёт себя валидатор.
 */

import type { Structure } from '../types';
import type { DungeonRoom, GenerationPlan, RoomPurpose, RoadGraphEdge } from './plan';

const center = (room: Structure) => ({
  x: Math.floor(room.x + room.w / 2),
  y: Math.floor(room.y + room.h / 2),
});

const gap = (a: Structure, b: Structure): number => {
  const ca = center(a);
  const cb = center(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
};

/**
 * Граф залов: минимальное остовное дерево по манхэттенскому расстоянию
 * плюс одна петля между крупными залами (чтобы подземелье не было деревом).
 */
function buildGraph(rooms: Structure[]): RoadGraphEdge[] {
  const edges: RoadGraphEdge[] = [];
  const linked = [0];
  const pending = rooms.map((_, index) => index).slice(1);

  while (pending.length) {
    let bestDistance = Infinity;
    let bestLinked = 0;
    let bestIndex = 0;
    for (const a of linked) {
      for (let i = 0; i < pending.length; i += 1) {
        const distance = gap(rooms[a], rooms[pending[i]]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLinked = a;
          bestIndex = i;
        }
      }
    }
    const to = pending.splice(bestIndex, 1)[0];
    edges.push({ from: `room-${bestLinked}`, to: `room-${to}`, length: bestDistance });
    linked.push(to);
  }

  // Петля: соединяем два крупнейших зала, если они ещё не соединены.
  if (rooms.length >= 4) {
    const byArea = rooms
      .map((room, index) => ({ index, area: room.w * room.h }))
      .sort((a, b) => b.area - a.area)
      .slice(0, 2)
      .map((entry) => entry.index);
    const [first, second] = byArea;
    const known = edges.some(
      (edge) =>
        (edge.from === `room-${first}` && edge.to === `room-${second}`) ||
        (edge.from === `room-${second}` && edge.to === `room-${first}`),
    );
    if (!known) {
      edges.push({ from: `room-${first}`, to: `room-${second}`, length: gap(rooms[first], rooms[second]) });
    }
  }

  return edges;
}

const purposeFor = (depth: number, maxDepth: number, id: string): RoomPurpose => {
  if (depth === 0) return 'entrance';
  if (depth === 1) return 'hall';
  if (depth === 2) return 'guard';
  if (depth >= maxDepth) return 'crypt';
  // Остальные залы чередуются детерминированно по идентификатору.
  const salt = Number(id.replace(/\D/g, '')) % 3;
  return salt === 0 ? 'storage' : 'treasury';
};

export interface DungeonAnalysis {
  rooms: DungeonRoom[];
  graph: RoadGraphEdge[];
  /** Доля пола в крупнейшей связной компоненте (1 — всё связано). */
  connectivity: number;
}

/** Анализ готового подземелья: граф, глубина от входа, назначения залов. */
export function analyzeDungeon(rooms: Structure[], cells: { terrain: string }[][], width: number, height: number): DungeonAnalysis {
  const graph = buildGraph(rooms);

  const neighbours = new Map<number, number[]>();
  for (const edge of graph) {
    const from = Number(edge.from.replace(/\D/g, ''));
    const to = Number(edge.to.replace(/\D/g, ''));
    if (!neighbours.has(from)) neighbours.set(from, []);
    if (!neighbours.has(to)) neighbours.set(to, []);
    neighbours.get(from)!.push(to);
    neighbours.get(to)!.push(from);
  }

  // Вход — зал, ближайший к верхнему краю карты (и левее при равенстве).
  let entrance = 0;
  for (let index = 1; index < rooms.length; index += 1) {
    const current = center(rooms[entrance]);
    const candidate = center(rooms[index]);
    if (candidate.y < current.y || (candidate.y === current.y && candidate.x < current.x)) entrance = index;
  }

  const depth = new Array<number>(rooms.length).fill(-1);
  depth[entrance] = 0;
  const queue = [entrance];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of neighbours.get(at) ?? []) {
      if (depth[next] !== -1) continue;
      depth[next] = depth[at] + 1;
      queue.push(next);
    }
  }
  const maxDepth = Math.max(...depth.filter((value) => value >= 0), 0);

  const described: DungeonRoom[] = rooms.map((room, index) => ({
    id: `room-${index}`,
    purpose: purposeFor(Math.max(0, depth[index]), maxDepth, `room-${index}`),
    bounds: { x: room.x, y: room.y, w: room.w, h: room.h },
    depth: Math.max(0, depth[index]),
  }));

  // Связность пола: BFS по проходимым клеткам.
  const walkable = (terrain: string) => terrain === 'floor' || terrain === 'door';
  const seen = new Uint8Array(width * height);
  let best = 0;
  let totalFloor = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!walkable(cells[y][x].terrain)) continue;
      totalFloor += 1;
      const start = y * width + x;
      if (seen[start]) continue;
      let size = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const at = stack.pop()!;
        size += 1;
        const cx = at % width;
        const cy = Math.floor(at / width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !walkable(cells[ny][nx].terrain)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      if (size > best) best = size;
    }
  }

  return {
    rooms: described,
    graph,
    connectivity: totalFloor ? best / totalFloor : 1,
  };
}

/** План для подземелья: залы с назначением и граф. */
export function dungeonPlan(rooms: Structure[], cells: { terrain: string }[][], width: number, height: number): GenerationPlan {
  const analysis = analyzeDungeon(rooms, cells, width, height);
  return {
    version: 1,
    engine: 'structured',
    zones: [],
    poi: [],
    groups: [],
    rooms: analysis.rooms,
    graph: analysis.graph,
  };
}
