/**
 * Коридоры комплекса как элементы планировки.
 *
 * Маршрут — A* по клеткам с учётом поворотов; стоимость зависит от вида
 * коридора (прямой держит направление, извилистый и природный петляют).
 * Затем путь «прорезается» кистью переменной ширины: профиль сужается у
 * дверей, расширяется в галереях и при переходе в пещеру, у природных
 * тоннелей ширина дышит по шуму. Колоннада ставит колонны по краям, водосток
 * — канал с дорожкой.
 */
import { Perlin } from '../../noise';
import { hash2 } from '../../random';
import type { Point } from '../../types';
import type { CorridorKind } from './registry';

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface RouteField {
  W: number;
  H: number;
  /** Владелец клетки: зал (≥0) или −1. */
  owner: Int16Array;
  /** Кольцо стен вокруг залов. */
  ring: Uint8Array;
  /** Уже прорезанные коридоры (сливаются в развилки). */
  corridor: Uint8Array;
  seed: number;
}

const TURN: Record<CorridorKind, number> = { straight: 2.2, bent: .9, winding: .15, gallery: 1.6, colonnade: 2.6, tunnel: .6, natural: .1, channel: 1.8 };
const JITTER: Record<CorridorKind, number> = { straight: .1, bent: .3, winding: 1.6, gallery: .15, colonnade: .05, tunnel: .7, natural: 2.2, channel: .2 };

/** Маршрут между клетками у дверей двух залов. strict — без захода в чужие залы и их кольца. */
export function routeCorridor(f: RouteField, from: number, to: number, kind: CorridorKind, strict: boolean): number[] | undefined {
  const { W, H, owner, ring, corridor } = f;
  const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  const total = W * H * 4;
  const g = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const heap: number[] = [], fval: number[] = [];
  const push = (state: number, value: number) => {
    heap.push(state); fval.push(value);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (fval[up] <= fval[i]) break;
      [heap[i], heap[up]] = [heap[up], heap[i]]; [fval[i], fval[up]] = [fval[up], fval[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const ls = heap.pop()!, lf = fval.pop()!;
    if (heap.length) {
      heap[0] = ls; fval[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && fval[l] < fval[m]) m = l;
        if (r < heap.length && fval[r] < fval[m]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; [fval[i], fval[m]] = [fval[m], fval[i]];
        i = m;
      }
    }
    return top;
  };
  const tx = to % W, ty = Math.floor(to / W);
  const h0 = (cell: number) => Math.abs((cell % W) - tx) + Math.abs(Math.floor(cell / W) - ty);
  const turn = TURN[kind], jitter = JITTER[kind];
  for (let d = 0; d < 4; d += 1) { g[from * 4 + d] = 0; push(from * 4 + d, h0(from)); }
  let expanded = 0;
  while (heap.length && expanded < total) {
    const state = pop();
    expanded += 1;
    const cell = state >> 2, dir = state & 3;
    if (cell === to) {
      const path: number[] = [];
      for (let at = state; at >= 0; at = parent[at]) path.push(at >> 2);
      return path.reverse();
    }
    const x = cell % W, y = (cell - x) / W;
    for (let nd = 0; nd < 4; nd += 1) {
      const nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
      if (!inner(nx, ny)) continue;
      const next = ny * W + nx;
      let cost = 1;
      if (next !== to) {
        if (owner[next] >= 0) { if (strict) continue; cost += 60; } else if (ring[next]) { if (strict) continue; cost += 25; }
      }
      if (corridor[next]) cost = .45;
      else if (DIRS.some(([dx, dy]) => inner(nx + dx, ny + dy) && corridor[(ny + dy) * W + nx + dx])) cost += .9;
      if (nd !== dir && cell !== from) cost += turn;
      cost += hash2(nx, ny, f.seed + 0xa57a) * jitter;
      const ns = next * 4 + nd;
      const tentative = g[state] + cost;
      if (tentative >= g[ns]) continue;
      g[ns] = tentative;
      parent[ns] = state;
      push(ns, tentative + h0(next));
    }
  }
  return undefined;
}

export interface CarveRequest {
  path: number[];
  kind: CorridorKind;
  width: number;
  /** Доля длины (от начала), после которой коридор становится природным (1 — никогда, 0 — весь). */
  naturalFrom: number;
  /** Природный участок у начала пути, а не у конца. */
  naturalAtStart: boolean;
  seed: number;
}

export interface CarveResult {
  /** Клетки пола коридора; true — природный пол. */
  cells: Map<number, boolean>;
  /** Клетки воды (канал водостока). */
  water: Set<number>;
  /** Колонны колоннады (клетки пола). */
  pillars: number[];
  /** Ниши вдоль коридора (клетки пола в выемке). */
  niches: number[];
  centreLength: number;
}

const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Прорезает коридор по профилю ширины. Возвращает клетки; запись в сетку — у вызывающего. */
export function carveCorridor(f: RouteField, req: CarveRequest): CarveResult {
  const { W, H, owner, ring } = f;
  const { path, kind } = req;
  const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  const cells = new Map<number, boolean>();
  const water = new Set<number>();
  const pillars: number[] = [];
  const niches: number[] = [];
  const noise = new Perlin((req.seed ^ 0x7c3a) >>> 0);
  const n = path.length;
  const allowed = (x: number, y: number) => inner(x, y) && owner[y * W + x] < 0 && !ring[y * W + x];
  for (let k = 0; k < n; k += 1) {
    const cell = path[k];
    const x = cell % W, y = (cell - x) / W;
    const t = n > 1 ? k / (n - 1) : 0;
    const fromNatural = req.naturalAtStart ? 1 - t : t;
    const natural = kind === 'natural' || fromNatural >= req.naturalFrom + (noise.fbm(x * .3, y * .3, 2) - .5) * .25;
    cells.set(cell, natural || cells.get(cell) === true);
    // Ширина: сужение у дверей (две клетки), расширение к природной части.
    const edge = Math.min(k, n - 1 - k);
    let width = req.width;
    if (kind === 'natural') width = Math.max(1, Math.round(req.width * (.55 + noise.fbm(x * .17, y * .17, 2) * .95)));
    if (kind === 'gallery' && n > 12) width += t > .3 && t < .7 ? 1 : 0;
    if (req.naturalFrom < 1) width += Math.round(2 * smooth(req.naturalFrom, 1, fromNatural));
    if (edge < 2) width = 1;
    else if (edge < 3) width = Math.min(width, 2);
    if (width <= 1) continue;
    // Направление пути в этой точке — поперёк строим кисть.
    const prev = path[Math.max(0, k - 1)], next = path[Math.min(n - 1, k + 1)];
    const horizontal = Math.abs((next % W) - (prev % W)) >= Math.abs(Math.floor(next / W) - Math.floor(prev / W));
    const offsets: number[] = [];
    for (let o = 1; o < width; o += 1) offsets.push(o % 2 === 1 ? Math.ceil(o / 2) : -Math.ceil(o / 2));
    for (const o of offsets) {
      const nx = horizontal ? x : x + o, ny = horizontal ? y + o : y;
      if (!allowed(nx, ny)) continue;
      const id = ny * W + nx;
      cells.set(id, natural || cells.get(id) === true);
      if (kind === 'channel' && o === 1) water.add(id);
      if (kind === 'colonnade' && Math.abs(o) === 1 && k % 3 === 0 && edge >= 3) pillars.push(id);
    }
  }
  // Ниши в стенах прямых коридоров (гробница, катакомбы, храм): через каждые 4–6 клеток.
  if (kind === 'straight' || kind === 'colonnade' || kind === 'tunnel') {
    for (let k = 3; k < n - 3; k += 4 + Math.floor(hash2(k, n, req.seed) * 3)) {
      const cell = path[k];
      const x = cell % W, y = (cell - x) / W;
      const prev = path[k - 1];
      const horizontal = Math.abs((cell % W) - (prev % W)) > 0;
      for (const side of [1, -1]) {
        let o = side;
        while (cells.has((horizontal ? y + o : y) * W + (horizontal ? x : x + o))) o += side;
        const nx = horizontal ? x : x + o, ny = horizontal ? y + o : y;
        if (!allowed(nx, ny)) continue;
        // Ниша — тупиковая выемка: за ней и по бокам нет пола.
        const around = DIRS.filter(([dx, dy]) => cells.has((ny + dy) * W + nx + dx)).length;
        if (around !== 1 || hash2(nx, ny, req.seed + 0x41) > .55) continue;
        cells.set(ny * W + nx, cells.get(cell) === true);
        niches.push(ny * W + nx);
        break;
      }
    }
  }
  // Осевая линия всегда сухая и свободна: по ней держится связность.
  const axis = new Set(path);
  for (const cell of axis) water.delete(cell);
  return { cells, water, pillars: pillars.filter((cell) => !axis.has(cell) && !water.has(cell)), niches, centreLength: n };
}

/** Ширина коридора по роли ребра и архетипу. */
export function corridorWidth(range: [number, number], seed: number, salt: number): number {
  const [lo, hi] = range;
  return lo + Math.floor(hash2(salt, seed, 0x91d) * (hi - lo + 1));
}

export function pointOf(cell: number, W: number): Point {
  return { x: cell % W, y: Math.floor(cell / W) };
}
