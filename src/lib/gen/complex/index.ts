/**
 * Генератор архитектурных комплексов подземелий (gen.dungeonArchetype).
 *
 * Конвейер одного уровня:
 *   1. профиль уровня: архетип, топология, геометрия, стиль, состояние;
 *   2. логический граф (graph.ts) — ярусы, связи, назначения;
 *   3. раскладка залов (embed.ts) и их геометрия (shapes.ts);
 *   4. двери и коридоры по роли ребра (corridors.ts);
 *   5. вода, проломы, затопление; клетки карты; покрытие пола;
 *   6. «хребет» проходов — по нему ничего не ставится, связность гарантирована;
 *   7. архитектура (колонны, ниши, лестницы), сцены по назначению,
 *      свет по стилю, механизмы, следы состояния;
 *   8. прежний декоратор склепа добирает мелочи по темам залов;
 *   9. проверка связности и отчёт.
 *
 * Потоки случайности разделены (структура, геометрия, коридоры, декор, свет,
 * разрушение): смена состояния не двигает залы, смена стиля — коридоры.
 */
import { Perlin } from '../../noise';
import { hash2, mulberry32, type Rng } from '../../random';
import { CRYPT } from '../../cryptKit';
import { canPlaceCrypt, cryptStamp, cryptWalkable, decorateCrypt, dungeonLevelSeed, wallOffBlockedDoors } from '../../cryptLayout';
import { cryptCompositionPlan, furnishByPurpose, placeCorridorTraps } from '../cryptplan';
import { effectiveLevels, levelLinks, stairFootprint } from '../dungeonArchitect';
import type { Cell, ChestRotation, CryptKind, CryptObject, CryptTheme, DoorKind, DoorMark, FloorOrnament, GenSettings, MapData, Point, Rock, Structure, Tree } from '../../types';
import type { DungeonLayoutReport, DungeonRoom, GenerationPlan, RoadGraphEdge, RoomShape } from '../plan';
import { buildGraph, type ComplexGraph, type EdgeRole } from './graph';
import { embedGraph } from './embed';
import { carveCorridor, corridorWidth, routeCorridor, type RouteField } from './corridors';
import {
  COMPLEX_GENERATOR_VERSION, CORRIDOR_LABELS, PURPOSES, TIER_LABELS, TOPOLOGIES, getComplexArchetype,
  type ComplexArchetype, type ComplexPurpose, type CorridorKind, type GeometryMode, type NodeTier, type Topology,
} from './registry';
import { SCENES, type SceneKind, type ScenePart } from './scenes';
import { FLOOR_CODES, floorFor, getCondition, getStyle, type DungeonCondition, type DungeonStyle } from './styles';

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export type LinkKind = 'stairs' | 'spiral' | 'lift' | 'collapse';
export const LINK_LABELS: Record<LinkKind, string> = { stairs: 'лестница', spiral: 'винтовая лестница', lift: 'подъёмник в шахте', collapse: 'провал в своде' };
export type LevelRole = 'upper' | 'middle' | 'deep' | 'caves';
export const LEVEL_ROLE_LABELS: Record<LevelRole, string> = { upper: 'верхний ярус', middle: 'средний ярус', deep: 'глубокий ярус', caves: 'пещерный ярус' };

/** Что построил генератор комплекса: читается в UI и тестах. */
export interface ComplexReport {
  generator: number;
  archetype: string;
  label: string;
  topology: Topology;
  geometry: GeometryMode;
  style: string;
  condition: string;
  levelRole: LevelRole;
  tiers: Partial<Record<NodeTier, number>>;
  purposes: Partial<Record<ComplexPurpose, number>>;
  corridors: Partial<Record<CorridorKind, number>>;
  /** Клеток пола по ширине коридора (осевая линия). */
  widths: Record<string, number>;
  /** Доля природного пола. */
  naturalShare: number;
  breaches: number;
  composite: number;
  scenes: string[];
  lights: { lit: number; unlit: number };
  mechanisms: string[];
  links: { kind: LinkKind; dir: 'up' | 'down'; x: number; y: number }[];
  /** Главный зал не у края карты: минимальный отступ его центра в долях стороны. */
  mainMargin: number;
  /** Узлы, для которых не нашлось места. */
  dropped: number;
}

function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const value of parts) { h ^= value | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}

function weighted<T>(rng: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = rng() * total;
  for (const [value, w] of options) { roll -= Math.max(0, w); if (roll < 0) return value; }
  return options[options.length - 1][0];
}

const count = <K extends string>(values: K[]) => values.reduce<Partial<Record<K, number>>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

/** Вид связи между уровнями k и k+1 по архетипу. Зависит только от архетипа и k — совпадает на обоих уровнях. */
export function linkKindFor(archetype: string, k: number): LinkKind {
  switch (archetype) {
    case 'fortress': return k % 2 ? 'spiral' : 'stairs';
    case 'mine': return 'lift';
    case 'sewer': case 'laboratory': case 'prison': return 'spiral';
    case 'cavern': return 'collapse';
    case 'ruins': case 'hybrid': return k === 0 ? 'stairs' : 'collapse';
    default: return 'stairs';
  }
}

const LINK_OBJECTS: Record<LinkKind, { down: CryptKind; up: CryptKind }> = {
  stairs: { down: 'stairsDown', up: 'stairsUp' },
  spiral: { down: 'spiralStairs', up: 'spiralStairs' },
  lift: { down: 'liftPlatform', up: 'liftPlatform' },
  collapse: { down: 'stairsDown', up: 'stairsUp' },
};

/** Топологии, которым хватает залов. */
function feasible(topology: Topology, n: number): boolean {
  if (topology === 'ring' || topology === 'maze') return n >= 6;
  if (topology === 'multihub') return n >= 7;
  if (topology === 'central' || topology === 'mixed') return n >= 5;
  return true;
}

export interface ComplexProfile {
  archetype: ComplexArchetype;
  topology: Topology;
  geometry: GeometryMode;
  style: DungeonStyle;
  condition: DungeonCondition;
  role: LevelRole;
  natural: number;
}

/** Профиль уровня: всё, что решается до графа. */
export function complexProfile(s: GenSettings, level: number, levels: number, rooms: number): ComplexProfile {
  const archetype = getComplexArchetype(s.dungeonArchetype ?? 'fortress');
  const levelSeed = dungeonLevelSeed(s.seed, level);
  const pick = mulberry32(mix(levelSeed, 0x7091));
  const options = archetype.topology.filter(([t]) => feasible(t, rooms));
  const asked = s.dungeonTopology;
  const topology: Topology = asked && asked !== 'auto' && TOPOLOGIES.includes(asked as Topology)
    ? (feasible(asked as Topology, rooms) ? asked as Topology : 'branching')
    : options.length ? weighted(pick, options) : rooms >= 4 ? 'branching' : 'linear';
  const geometry: GeometryMode = s.dungeonGeometry === 'regular' || s.dungeonGeometry === 'varied' || s.dungeonGeometry === 'organic'
    ? s.dungeonGeometry
    : archetype.id === 'ruins' || archetype.id === 'cavern' || archetype.id === 'hybrid' ? 'organic'
      : archetype.id === 'fortress' || archetype.id === 'prison' || archetype.id === 'laboratory' || archetype.id === 'sewer' ? 'regular' : 'varied';
  // Стиль един для всего комплекса (seed без уровня).
  const style = getStyle(s.dungeonStyle && s.dungeonStyle !== 'auto' ? s.dungeonStyle : archetype.style);
  const deepest = levels >= 3 && level === levels - 1 && (archetype.id === 'mine' || archetype.id === 'hybrid' || archetype.id === 'ruins');
  const role: LevelRole = level === 0 ? 'upper' : deepest ? 'caves' : level === levels - 1 ? 'deep' : 'middle';
  let condition: DungeonCondition;
  if (s.dungeonCondition && s.dungeonCondition !== 'auto') condition = getCondition(s.dungeonCondition);
  else {
    // Состояние по умолчанию: верхний ярус — по архетипу, глубже — запущеннее.
    const weights = archetype.condition.map(([id, w]): [string, number] => {
      const worse = id === 'ruined' || id === 'flooded' || id === 'overgrown' || id === 'damaged';
      return [id, w * (worse ? 1 + level * .6 : Math.max(.3, 1 - level * .3))];
    });
    condition = getCondition(weighted(mulberry32(mix(level === 0 ? s.seed : levelSeed, 0xc0d)), weights));
  }
  const natural = Math.min(1, archetype.natural + level * (archetype.natural > 0 ? .1 : .03) + (role === 'caves' ? .4 : 0));
  return { archetype, topology, geometry, style, condition, role, natural };
}

interface Link { a: number; b: number; role: EdgeRole; doorA: number; doorB: number; kind: CorridorKind; width: number; length: number; path: number[] }

/** Генерирует один уровень архитектурного комплекса. */
/**
 * Локальная починка после расстановки: если блокирующие предметы отрезали карман
 * пола от входа, убирается самый мелкий предмет на границе кармана и достижимой
 * части. Повторяется, пока карманов нет; связные с входом клетки не трогаются.
 */
function freePockets(map: MapData, start: number | undefined, blocked: Set<number>): { crypt: CryptObject[]; removed: number } {
  const W = map.width, H = map.height;
  let crypt = map.crypt ?? [];
  if (start === undefined) return { crypt, removed: 0 };
  const owner = new Int32Array(W * H).fill(-1);
  const index = () => {
    owner.fill(-1);
    crypt.forEach((item, k) => {
      if (!CRYPT[item.kind].blocks || item.source !== 'layout') return;
      for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) if (x >= 0 && y >= 0 && x < W && y < H) owner[y * W + x] = k;
    });
  };
  const floorAt = (cell: number) => { const t = map.cells[Math.floor(cell / W)][cell % W].terrain; return t === 'floor' || t === 'door'; };
  let removed = 0;
  const walk = new Uint8Array(W * H);
  const refresh = (x0: number, y0: number, x1: number, y1: number) => {
    const probe: MapData = { ...map, crypt };
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1) for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const c = y * W + x;
      walk[c] = floorAt(c) && !blocked.has(c) && cryptWalkable(probe, x, y) ? 1 : 0;
    }
  };
  refresh(0, 0, W, H);
  for (let round = 0; round < 40; round += 1) {
    index();
    if (!walk[start]) return { crypt, removed };
    const seen = new Uint8Array(W * H);
    const queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length; q += 1) {
      const x = queue[q] % W, y = (queue[q] - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, c = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[c] || !walk[c]) continue;
        seen[c] = 1;
        queue.push(c);
      }
    }
    // Кандидаты: блокирующий предмет, касающийся и кармана, и достижимой клетки.
    const candidates = new Map<number, number>();
    for (let c = 0; c < W * H; c += 1) {
      if (!walk[c] || seen[c]) continue;
      const x = c % W, y = (c - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, n = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || owner[n] < 0) continue;
        const item = crypt[owner[n]];
        let touches = false;
        for (let yy = item.y - 1; yy <= item.y + item.h && !touches; yy += 1) for (let xx = item.x - 1; xx <= item.x + item.w && !touches; xx += 1) {
          const inside = xx >= item.x && xx < item.x + item.w && yy >= item.y && yy < item.y + item.h;
          if (!inside && xx >= 0 && yy >= 0 && xx < W && yy < H && seen[yy * W + xx]) touches = true;
        }
        if (touches) candidates.set(owner[n], item.w * item.h);
      }
    }
    if (!candidates.size) return { crypt, removed };
    // За раунд — по одному предмету на карман: самый мелкий, при равенстве первый по порядку.
    const drop = [...candidates.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    const gone = crypt[drop];
    crypt = crypt.filter((_, k) => k !== drop);
    refresh(gone.x, gone.y, gone.x + gone.w, gone.y + gone.h);
    removed += 1;
  }
  return { crypt, removed };
}

export function generateComplexDungeon(s: GenSettings): MapData {
  const levels = effectiveLevels(s);
  const level = Math.max(0, Math.min(levels - 1, Math.round(s.dungeonLevel ?? 0)));
  const minimum = level > 0 || level < levels - 1 ? 3 : 2;
  const capacity = Math.max(3, Math.floor((s.width * s.height) / 115));
  const requested = Math.max(minimum, Math.min(s.rooms, capacity));
  // Если на тесной карте зал не удалось связать даже запасным ходом, граф строится
  // заново на один узел меньше: лучше меньше залов, чем зал без входа.
  for (let budget = requested; ; budget -= 1) {
    const map = buildComplex(s, budget, requested, budget <= minimum);
    if (map) return map;
  }
}

function buildComplex(s: GenSettings, budget: number, requested: number, final: boolean): MapData | undefined {
  const W = s.width, H = s.height;
  const levels = effectiveLevels(s);
  const level = Math.max(0, Math.min(levels - 1, Math.round(s.dungeonLevel ?? 0)));
  const links = levelLinks(s);
  const levelSeed = dungeonLevelSeed(s.seed, level);
  const id = (x: number, y: number) => y * W + x;
  const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  const up = level > 0 ? links[level - 1] : undefined;
  const down = level < levels - 1 ? links[level] : undefined;
  const profile = complexProfile(s, level, levels, budget);
  const { archetype, style, condition } = profile;
  const stream = (salt: number) => mulberry32(mix(levelSeed, salt));

  // ---- 1–3. Граф и раскладка ----------------------------------------------
  const graph: ComplexGraph = buildGraph({ archetype, topology: profile.topology, count: budget, natural: profile.natural, landing: Boolean(down), fromAbove: Boolean(up), rng: stream(0x5712) });
  const scale = archetype.scale * Math.max(.72, Math.min(1.15, Math.sqrt((W * H) / (budget * 175))));
  const { rooms, dropped } = embedGraph({ graph, archetype, geometry: profile.geometry, W, H, seed: mix(levelSeed, 0x9e0), up, down, scale });
  const roomOf = new Map(rooms.map((room, index) => [room.node, index]));
  const nodeOf = (index: number) => graph.nodes[rooms[index].node];

  const owner = new Int16Array(W * H).fill(-1);
  const floorCells: Set<number>[] = rooms.map(() => new Set());
  const pillarCells = new Set<number>();
  const roomWater = new Set<number>();
  const roomDeep = new Set<number>();
  const nicheCells: { cell: number; room: number }[] = [];
  rooms.forEach((room, index) => {
    const { rect, geometry } = room;
    geometry.mask.forEach((row, y) => row.forEach((on, x) => {
      if (!on) return;
      const cell = id(rect.x + x, rect.y + y);
      owner[cell] = index;
      floorCells[index].add(cell);
    }));
    for (const p of geometry.pillars) pillarCells.add(id(rect.x + p.x, rect.y + p.y));
    for (const p of geometry.water) roomWater.add(id(rect.x + p.x, rect.y + p.y));
    for (const p of geometry.deep) roomDeep.add(id(rect.x + p.x, rect.y + p.y));
    for (const p of geometry.niches) nicheCells.push({ cell: id(rect.x + p.x, rect.y + p.y), room: index });
  });
  const ring = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (owner[id(x, y)] >= 0) continue;
    if (AROUND.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && owner[id(nx, ny)] >= 0; })) ring[id(x, y)] = 1;
  }

  // Рёбра между размещёнными залами; соседи выпавших узлов связываются между собой.
  const edges: { a: number; b: number; role: EdgeRole }[] = [];
  const hasEdge = (a: number, b: number) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (const e of graph.edges) {
    const a = roomOf.get(e.a), b = roomOf.get(e.b);
    if (a !== undefined && b !== undefined && !hasEdge(a, b)) edges.push({ a, b, role: e.role });
  }
  for (const lost of dropped) {
    const near = graph.edges.filter((e) => e.a === lost || e.b === lost).map((e) => roomOf.get(e.a === lost ? e.b : e.a)).filter((v): v is number => v !== undefined);
    for (let i = 1; i < near.length; i += 1) if (!hasEdge(near[0], near[i])) edges.push({ a: near[0], b: near[i], role: 'side' });
  }
  const centre = (index: number): Point => ({ x: rooms[index].rect.x + Math.floor(rooms[index].rect.w / 2), y: rooms[index].rect.y + Math.floor(rooms[index].rect.h / 2) });
  const dist = (a: number, b: number) => { const p = centre(a), q = centre(b); return Math.hypot(p.x - q.x, p.y - q.y); };
  // Связность графа после выпадений: компоненты сшиваются ближайшими залами.
  for (;;) {
    const comp = new Int32Array(rooms.length).fill(-1);
    let k = 0;
    for (let i = 0; i < rooms.length; i += 1) {
      if (comp[i] >= 0) continue;
      const queue = [i];
      comp[i] = k;
      for (let q = 0; q < queue.length; q += 1) for (const e of edges) {
        const next = e.a === queue[q] ? e.b : e.b === queue[q] ? e.a : -1;
        if (next >= 0 && comp[next] < 0) { comp[next] = k; queue.push(next); }
      }
      k += 1;
    }
    if (k <= 1) break;
    let best: [number, number] | undefined, bestD = Infinity;
    for (let i = 0; i < rooms.length; i += 1) for (let j = 0; j < rooms.length; j += 1) {
      if (comp[i] !== 0 || comp[j] === 0) continue;
      const d = dist(i, j);
      if (d < bestD) { bestD = d; best = [i, j]; }
    }
    if (!best) break;
    edges.push({ a: best[0], b: best[1], role: 'side' });
  }

  // ---- 4. Двери и коридоры ---------------------------------------------------
  const field: RouteField = { W, H, owner, ring, corridor: new Uint8Array(W * H), seed: mix(levelSeed, 0xc0f) };
  const carved = new Uint8Array(W * H);
  const natural = new Uint8Array(W * H);
  const corridorWater = new Set<number>();
  const corridorPillars = new Set<number>();
  const corridorNiches: number[] = [];
  rooms.forEach((room, index) => {
    for (const cell of floorCells[index]) { carved[cell] = 1; if (room.natural) natural[cell] = 1; }
  });
  const nicheSet = new Set(nicheCells.map((n) => n.cell));
  interface Port { door: number; out: number }
  const portsOf = rooms.map((_, index): Port[] => {
    const ports: Port[] = [];
    for (const cell of floorCells[index]) {
      if (pillarCells.has(cell) || roomWater.has(cell) || nicheSet.has(cell)) continue;
      const x = cell % W, y = (cell - x) / W;
      for (const [dx, dy] of DIRS) {
        const ox = x + dx, oy = y + dy, nx = ox + dx, ny = oy + dy;
        if (!inner(ox, oy) || !inner(nx, ny) || owner[id(ox, oy)] >= 0) continue;
        if (!rooms[index].natural && (owner[id(ox + dy, oy + dx)] === index || owner[id(ox - dy, oy - dx)] === index)) continue;
        if (AROUND.some(([ax, ay]) => { const o = owner[id(ox + ax, oy + ay)]; return o >= 0 && o !== index; })) continue;
        if (owner[id(nx, ny)] >= 0 || ring[id(nx, ny)]) continue;
        ports.push({ door: id(ox, oy), out: id(nx, ny) });
      }
    }
    return ports;
  });
  const doorsOf: number[][] = rooms.map(() => []);
  const portOut = new Map<number, number>();
  const choosePort = (index: number, target: Point, salt: number, fresh: boolean): Port | undefined => {
    const scored = portsOf[index]
      .filter((p) => !doorsOf[index].some((d) => d !== p.door && Math.max(Math.abs((d % W) - (p.door % W)), Math.abs(Math.floor(d / W) - Math.floor(p.door / W))) <= 2))
      .map((p) => ({ p, score: Math.hypot((p.out % W) - target.x, Math.floor(p.out / W) - target.y) + hash2(p.door, salt, levelSeed + 0x90e) * 1.6 }))
      .sort((a, b) => a.score - b.score || a.p.door - b.p.door);
    const best = scored[0];
    if (!best) return undefined;
    if (!fresh) {
      const reuse = doorsOf[index].map((door) => ({ door, out: portOut.get(door)! }))
        .map((p) => ({ p, score: Math.hypot((p.out % W) - target.x, Math.floor(p.out / W) - target.y) }))
        .sort((a, b) => a.score - b.score)[0];
      if (reuse && reuse.score <= best.score + 3) return reuse.p;
    }
    return best.p;
  };
  const corridorOf = (e: { a: number; b: number; role: EdgeRole }): { kind: CorridorKind; width: number; naturalFrom: number; naturalAtStart: boolean } => {
    const na = rooms[e.a].natural, nb = rooms[e.b].natural;
    const c = archetype.corridors;
    const salt = mix(e.a, e.b);
    if (e.role === 'hidden') return { kind: 'tunnel', width: 1, naturalFrom: 1, naturalAtStart: false };
    if (na && nb) return { kind: 'natural', width: corridorWidth(c.sideWidth, levelSeed, salt) + 1, naturalFrom: 0, naturalAtStart: false };
    const main = e.role === 'main' || e.role === 'loop' && nodeOf(e.a).major && nodeOf(e.b).major;
    let kind: CorridorKind = main ? c.main : e.role === 'service' ? c.service : c.side;
    let width = corridorWidth(main ? c.mainWidth : c.sideWidth, levelSeed, salt);
    // Водосток нужен на главных линиях; служебные ходы канализации — сухие тоннели.
    if (kind === 'channel' && width < 3) kind = 'tunnel';
    if (kind === 'colonnade' && width < 3) kind = 'straight';
    if (kind === 'natural' && !na && !nb) kind = 'winding';
    if (na || nb) { width = Math.max(width, 2); return { kind: kind === 'channel' ? 'tunnel' : kind, width, naturalFrom: .35 + hash2(salt, 3, levelSeed) * .25, naturalAtStart: na }; }
    return { kind, width, naturalFrom: 1, naturalAtStart: false };
  };
  const routed: Link[] = [];
  const rank = (role: EdgeRole) => ({ main: 0, side: 1, service: 2, natural: 1, loop: 3, hidden: 4 } as Record<EdgeRole, number>)[role];
  const order = edges.map((e, i) => ({ e, i })).sort((p, q) => rank(p.e.role) - rank(q.e.role) || dist(p.e.a, p.e.b) - dist(q.e.a, q.e.b) || p.i - q.i);
  const widths: Record<string, number> = {};
  const tryLink = (e: { a: number; b: number; role: EdgeRole }, i: number): boolean => {
    const fresh = e.role === 'hidden' || nodeOf(e.a).tier === 'hidden' || nodeOf(e.b).tier === 'hidden';
    const pa = choosePort(e.a, centre(e.b), i * 2, fresh);
    const pb = choosePort(e.b, centre(e.a), i * 2 + 1, fresh);
    if (!pa || !pb) return false;
    const plan = corridorOf(e);
    const path = routeCorridor(field, pa.out, pb.out, plan.kind, true) ?? routeCorridor(field, pa.out, pb.out, plan.kind, false);
    if (!path) return false;
    const carve = carveCorridor(field, { path, kind: plan.kind, width: plan.width, naturalFrom: plan.naturalFrom, naturalAtStart: plan.naturalAtStart, seed: mix(levelSeed, i, 0xca7) });
    for (const port of [pa, pb]) { carved[port.door] = 1; portOut.set(port.door, port.out); }
    if (!doorsOf[e.a].includes(pa.door)) doorsOf[e.a].push(pa.door);
    if (!doorsOf[e.b].includes(pb.door)) doorsOf[e.b].push(pb.door);
    for (const [cell, isNatural] of carve.cells) {
      carved[cell] = 1;
      field.corridor[cell] = 1;
      if (isNatural) natural[cell] = 1;
    }
    for (const cell of carve.water) corridorWater.add(cell);
    for (const cell of carve.pillars) corridorPillars.add(cell);
    corridorNiches.push(...carve.niches);
    widths[String(plan.width)] = (widths[String(plan.width)] ?? 0) + path.length;
    routed.push({ a: e.a, b: e.b, role: e.role, doorA: pa.door, doorB: pb.door, kind: plan.kind, width: plan.width, length: path.length, path });
    return true;
  };
  for (const { e, i } of order) tryLink(e, i);
  // Локальная починка: зал, все рёбра которого не проложились (тесная карта),
  // подключается к ближайшему уже связанному залу запасным ходом.
  for (let attempt = 0; attempt < rooms.length; attempt += 1) {
    const linked = new Set<number>([roomOf.get(graph.entry) ?? 0]);
    for (let grew = true; grew;) {
      grew = false;
      for (const link of routed) if (linked.has(link.a) !== linked.has(link.b)) { linked.add(link.a); linked.add(link.b); grew = true; }
    }
    const lonely = rooms.map((_, index) => index).filter((index) => !linked.has(index));
    if (!lonely.length) break;
    let fixed = false;
    for (const index of lonely) {
      const targets = [...linked].sort((p, q) => dist(index, p) - dist(index, q) || p - q);
      for (const target of targets.slice(0, 4)) if (tryLink({ a: target, b: index, role: 'side' }, edges.length + attempt * 31 + index)) { fixed = true; break; }
      if (fixed) break;
    }
    if (!fixed) {
      if (!final) return undefined;
      break;
    }
  }
  // Колонна одного коридора не должна встать на ось другого.
  for (const link of routed) for (const cell of link.path) corridorPillars.delete(cell);
  // Запасной маршрут A* через чужой зал: проход в зал становится аркой, а не дырой.
  const doorCells = new Set<number>(routed.flatMap((link) => [link.doorA, link.doorB]));
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const cell = id(x, y);
    if (!field.corridor[cell] || owner[cell] >= 0) continue;
    if (DIRS.some(([dx, dy]) => owner[id(x + dx, y + dy)] >= 0)) doorCells.add(cell);
  }
  // Проём в природный зал — без двери: пол пещеры сразу за порогом.
  const openings = new Set<number>();
  for (const door of doorCells) {
    const x = door % W, y = (door - x) / W;
    const into = DIRS.map(([dx, dy]) => owner[id(x + dx, y + dy)]).filter((o) => o >= 0);
    if (into.length && into.every((o) => rooms[o].natural)) { openings.add(door); natural[door] = 1; }
  }
  for (const cell of openings) doorCells.delete(cell);

  // ---- Виды дверей по смыслу ------------------------------------------------
  const PRIORITY: Record<DoorKind, number> = { secret: 9, portcullis: 8, gate: 7, blocked: 6, double: 5, arch: 4, broken: 3, normal: 1 };
  const wanted = new Map<number, DoorKind>();
  const want = (door: number, kind: DoorKind) => { if (!doorCells.has(door)) return; const cur = wanted.get(door); if (!cur || PRIORITY[kind] > PRIORITY[cur]) wanted.set(door, kind); };
  const entryIndex = roomOf.get(graph.entry) ?? 0;
  const styleDoors = Object.entries(style.doors) as [DoorKind, number][];
  const brokenShare = condition.debris * .35;
  const uses = new Map<number, Link[]>();
  for (const link of routed) for (const door of [link.doorA, link.doorB]) uses.set(door, [...(uses.get(door) ?? []), link]);
  let entryGate = false;
  for (const link of routed) {
    for (const [door, self, other] of [[link.doorA, link.a, link.b], [link.doorB, link.b, link.a]] as const) {
      const me = nodeOf(self), them = nodeOf(other);
      if (them.tier === 'hidden') want(door, 'secret');
      else if (me.tier === 'hidden') want(door, 'normal');
      else if ((me.purpose === 'treasury' || me.purpose === 'cell') && !rooms[self].natural) want(door, archetype.doors.guarded === 'secret' ? 'portcullis' : archetype.doors.guarded);
      else if (self === entryIndex && level === 0 && !entryGate && link.role === 'main') { want(door, archetype.doors.main); entryGate = true; }
      else if ((me.tier === 'main' || me.tier === 'final') && link.width >= 2) want(door, archetype.doors.main === 'gate' || archetype.doors.main === 'portcullis' ? 'double' : archetype.doors.main);
      else if (link.kind === 'natural' || rooms[other].natural) want(door, hash2(door, 5, levelSeed) < .5 ? 'broken' : 'arch');
      else {
        const roll = hash2(door, self, levelSeed + 0xd00);
        if (roll < brokenShare) want(door, 'broken');
        else want(door, roll < brokenShare + .45 ? archetype.doors.side : weighted(mulberry32(mix(door, levelSeed)), styleDoors.length ? styleDoors : [['normal', 1]]));
      }
    }
  }
  for (const door of doorCells) if (!wanted.has(door)) wanted.set(door, 'arch');
  // Один завал — на кольцевом маршруте в повреждённом комплексе; связность сохраняется.
  if (condition.debris >= .5) {
    const loop = routed.find((link) => link.role === 'loop' && (uses.get(link.doorB)?.length ?? 0) === 1 && wanted.get(link.doorB) !== 'secret');
    if (loop) wanted.set(loop.doorB, 'blocked');
  }

  // ---- 5. Проломы, вода, клетки ----------------------------------------------
  const ruin = stream(0x2a1);
  const breachCells: number[] = [];
  {
    // Пролом — одна клетка стены между полом зала и полом за стеной.
    const candidates: { cell: number; score: number; toNature: boolean }[] = [];
    for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) {
      const cell = id(x, y);
      if (carved[cell] || !ring[cell]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const a = id(x - dx, y - dy), b = id(x + dx, y + dy);
        if (!carved[a] || !carved[b]) continue;
        const ra = owner[a], rb = owner[b];
        const roomSide = ra >= 0 && !rooms[ra].natural ? ra : rb >= 0 && !rooms[rb].natural ? rb : -1;
        if (roomSide < 0 || (ra >= 0 && rb >= 0 && ra === rb)) continue;
        const other = roomSide === ra ? b : a;
        if (owner[other] === roomSide) continue;
        if ([...doorCells, ...openings].some((d) => Math.abs((d % W) - x) + Math.abs(Math.floor(d / W) - y) <= 2)) continue;
        // Стена пролома должна быть ровной: по бокам — тоже стена, не пол.
        if (carved[id(x + dy, y + dx)] || carved[id(x - dy, y - dx)]) continue;
        const toNature = natural[other] === 1;
        candidates.push({ cell, toNature, score: hash2(x, y, levelSeed + 0xb4e) });
      }
    }
    candidates.sort((p, q) => Number(q.toNature) - Number(p.toNature) || p.score - q.score);
    const hybrid = profile.natural > .15 && profile.natural < .95;
    const budget = Math.min(4, Math.round(candidates.filter((c) => c.toNature).length * (condition.breaches + (hybrid ? .35 : 0)) + candidates.filter((c) => !c.toNature).length * condition.breaches * .15));
    for (const c of candidates) {
      if (breachCells.length >= budget) break;
      if (breachCells.some((b) => Math.abs((b % W) - (c.cell % W)) + Math.abs(Math.floor(b / W) - Math.floor(c.cell / W)) < 6)) continue;
      breachCells.push(c.cell);
      carved[c.cell] = 1;
      natural[c.cell] = c.toNature ? 1 : 0;
    }
  }

  const ink = new Perlin(levelSeed);
  const cells: Cell[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x): Cell => ({
    terrain: 'void', height: ink.fbm(x * .1, y * .1, 2), moisture: ink.fbm(x * .07 + 30, y * .07 + 30, 2),
  })));
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const cell = id(x, y);
    if (carved[cell]) cells[y][x].terrain = doorCells.has(cell) ? 'door' : roomDeep.has(cell) ? 'deepWater' : roomWater.has(cell) || corridorWater.has(cell) ? 'water' : 'floor';
    else if (AROUND.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && carved[id(nx, ny)]; })) cells[y][x].terrain = 'wall';
  }

  // ---- 6. Хребет проходов ----------------------------------------------------
  // Кратчайшие пути от опорной клетки каждого зала до каждой его двери плюс
  // осевые линии коридоров. Эти клетки остаются сухими и свободными.
  const walk = (cell: number) => { const t = cells[Math.floor(cell / W)][cell % W].terrain; return (t === 'floor' || t === 'door') && !pillarCells.has(cell) && !corridorPillars.has(cell); };
  const anchors: number[] = rooms.map((_, index) => {
    const c = centre(index);
    let best = -1, bestD = Infinity;
    for (const cell of floorCells[index]) {
      if (!walk(cell)) continue;
      const d = Math.hypot((cell % W) - c.x, Math.floor(cell / W) - c.y);
      if (d < bestD) { bestD = d; best = cell; }
    }
    return best >= 0 ? best : [...floorCells[index]][0] ?? id(c.x, c.y);
  });
  const spine = new Set<number>();
  const pathWithin = (from: number, targets: Set<number>, allowed: (cell: number) => boolean): void => {
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    const found: number[] = [];
    for (let q = 0; q < queue.length && found.length < targets.size; q += 1) {
      const at = queue[q];
      if (targets.has(at)) found.push(at);
      const x = at % W, y = (at - x) / W;
      for (const [dx, dy] of DIRS) {
        const next = id(x + dx, y + dy);
        if (prev.has(next) || !inner(x + dx, y + dy) || !(allowed(next) || targets.has(next))) continue;
        prev.set(next, at);
        queue.push(next);
      }
    }
    for (const end of found) for (let at = end; at >= 0; at = prev.get(at) ?? -1) spine.add(at);
  };
  rooms.forEach((_, index) => {
    const doors = new Set<number>();
    for (const cell of floorCells[index]) {
      const x = cell % W, y = (cell - x) / W;
      for (const [dx, dy] of DIRS) {
        const n = id(x + dx, y + dy);
        if (owner[n] !== index && carved[n] && (doorCells.has(n) || openings.has(n) || breachCells.includes(n) || field.corridor[n])) doors.add(cell);
      }
    }
    pathWithin(anchors[index], doors, (cell) => owner[cell] === index && walk(cell));
  });
  for (const link of routed) for (const cell of link.path) spine.add(cell);
  for (const cell of [...doorCells, ...openings, ...breachCells]) spine.add(cell);
  // Клетки связей уровней не затапливаются и не заставляются.
  for (const link of [up, down]) if (link) { const at = stairFootprint(link); for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) spine.add(id(at.x + x, at.y + y)); }

  // Затопление по состоянию: низины вне хребта, не у дверей.
  // Ползунки «Затопленность», «Обломки», «Грибы» масштабируют состояние; при значениях
  // по умолчанию (0.35 / 0.4 / 0.6) множители равны 1.
  const waterK = Math.max(0, s.waterLevel ?? .35) / .35;
  const debrisK = .3 + 1.75 * (s.rocks ?? .4), growthK = .3 + 1.17 * (s.vegetation ?? .6);
  const floodLine = (condition.flood > 0 ? condition.flood * .75 * waterK + (archetype.water === 'channels' ? .1 : 0) : 0) + Math.max(0, (s.waterLevel ?? .35) - .35) * .6;
  if (floodLine > 0) {
    const values: number[] = [];
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (cells[y][x].terrain === 'floor') values.push(cells[y][x].height);
    values.sort((a, b) => a - b);
    const threshold = values[Math.floor(values.length * Math.min(.5, floodLine))] ?? -Infinity;
    for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
      const cell = id(x, y);
      if (cells[y][x].terrain !== 'floor' || spine.has(cell) || pillarCells.has(cell) || corridorPillars.has(cell) || cells[y][x].height > threshold) continue;
      if (AROUND.some(([dx, dy]) => cells[y + dy][x + dx].terrain === 'door')) continue;
      cells[y][x].terrain = 'water';
    }
  }

  // ---- Покрытие пола ---------------------------------------------------------
  const codes = new Array<string>(W * H).fill('.');
  const wear = new Perlin(mix(levelSeed, 0x3ea));
  const roomMaterial = rooms.map((room, index) => FLOOR_CODES[floorFor(style, PURPOSES[nodeOf(index).purpose].category, nodeOf(index).major || nodeOf(index).tier === 'final', room.natural)]);
  const bordered = rooms.map((room, index) => style.border && !room.natural && (nodeOf(index).major || PURPOSES[nodeOf(index).purpose].category === 'religious' || room.shape === 'composite'));
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const cell = id(x, y);
    const t = cells[y][x].terrain;
    if (t !== 'floor' && t !== 'door') continue;
    if (natural[cell]) { codes[cell] = FLOOR_CODES.natural; continue; }
    const o = owner[cell];
    let code = o >= 0 ? roomMaterial[o] : FLOOR_CODES[style.floors.corridor];
    if (o >= 0 && bordered[o] && AROUND.some(([dx, dy]) => owner[id(x + dx, y + dy)] !== o)) code = code.toUpperCase();
    // Изношенное покрытие: пятна по шуму, чаще у проломов и в коридорах.
    if (condition.wornFloors > 0 && wear.fbm(x * .22, y * .22, 3) < condition.wornFloors * .5 - (o < 0 ? 0 : .05)) code = FLOOR_CODES.worn;
    codes[cell] = code;
  }
  const ornaments: FloorOrnament[] = [];
  if (style.ornament) rooms.forEach((room, index) => {
    const node = nodeOf(index);
    if (room.natural || !(node.major || node.tier === 'final' || PURPOSES[node.purpose].category === 'religious')) return;
    if (Math.min(room.rect.w, room.rect.h) < 7) return;
    const f = room.shape === 'composite' ? { x: room.rect.x + Math.floor(room.rect.w / 2), y: room.rect.y + Math.floor(room.rect.h / 2) } : centre(index);
    const r = Math.min(3, Math.max(1.2, Math.min(room.rect.w, room.rect.h) / 2 - 2.2));
    // Орнамент только на сухом полу зала целиком.
    for (let y = Math.floor(f.y - r); y <= Math.ceil(f.y + r); y += 1) for (let x = Math.floor(f.x - r); x <= Math.ceil(f.x + r); x += 1) {
      if (Math.hypot(x - f.x, y - f.y) <= r && (owner[id(x, y)] !== index || cells[y]?.[x]?.terrain !== 'floor')) return;
    }
    ornaments.push({ x: f.x + .5, y: f.y + .5, r, kind: style.ornament! });
  });
  const ornamentCells = new Set<number>();
  for (const o of ornaments) for (let y = Math.floor(o.y - o.r); y <= Math.ceil(o.y + o.r); y += 1) for (let x = Math.floor(o.x - o.r); x <= Math.ceil(o.x + o.r); x += 1) {
    if (Math.hypot(x + .5 - o.x, y + .5 - o.y) <= o.r) ornamentCells.add(id(x, y));
  }

  // ---- 7. Архитектура и сцены ------------------------------------------------
  const sortedArt = rooms.map((_, i) => i).filter((i) => !rooms[i].natural)
    .sort((p, q) => centre(q).y - centre(p).y || rooms[p].rect.x - rooms[q].rect.x);
  const naturalRooms = rooms.map((_, i) => i).filter((i) => rooms[i].natural);
  const doorMarks: DoorMark[] = [...wanted].filter(([, kind]) => kind !== 'normal')
    .map(([cell, kind]) => ({ x: cell % W, y: Math.floor(cell / W), kind })).sort((p, q) => p.y - q.y || p.x - q.x);
  const structures: Structure[] = [...sortedArt, ...naturalRooms].map((i) => rooms[i].rect);
  const bare: MapData = { width: W, height: H, biome: 'dungeon', cells, trees: [], rocks: [], structures, chests: [], river: [], road: [], doors: doorMarks };
  const walled = wallOffBlockedDoors(bare);
  const placed: CryptObject[] = [];
  let probe: MapData = { ...walled, crypt: placed };
  const nearDoor = (x: number, y: number) => DIRS.some(([dx, dy]) => { const t = cells[y + dy]?.[x + dx]?.terrain; return t === 'door'; }) || DIRS.some(([dx, dy]) => openings.has(id(x + dx, y + dy)));
  const decor = stream(0xdec);
  const lightRng = stream(0x119);
  let lit = 0, unlit = 0;
  const mechanisms: string[] = [];
  const sceneLog: string[] = [];
  const LIGHTS = new Set<CryptKind>(['wallTorch', 'magicLamp', 'chandelier', 'brazier', 'brazierStand', 'candleStand', 'candles', 'candleHolder', 'candleWheel', 'oilLamp', 'pyre']);
  /** Ставит предмет: проверка клеток, хребта и дверей. Светильники гаснут по состоянию. */
  const put = (kind: CryptKind, at: Point, rotation: ChestRotation = 0, opts: { room?: number; free?: boolean } = {}): CryptObject | undefined => {
    const spec = CRYPT[kind];
    const item: CryptObject = { ...cryptStamp(at, kind, rotation, false, Math.floor(hash2(at.x, at.y, levelSeed + 0x7a) * 4)), source: 'layout' };
    if (!canPlaceCrypt(probe, item)) return undefined;
    for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) {
      const cell = id(x, y);
      if (spec.placement === 'wallFace') { if (nearDoor(x, y)) return undefined; continue; }
      if (opts.room !== undefined && owner[cell] !== opts.room) return undefined;
      if (pillarCells.has(cell) && kind !== style.column && kind !== 'stalagmites' && kind !== 'rubble') return undefined;
      if (!opts.free && !spec.flat && (spine.has(cell) || nearDoor(x, y))) return undefined;
      if (!opts.free && spec.blocks && ornamentCells.has(cell)) return undefined;
    }
    if (LIGHTS.has(kind)) {
      if (lightRng() > condition.lit) { item.unlit = true; unlit += 1; } else lit += 1;
    }
    placed.push(item);
    probe = { ...walled, crypt: placed };
    return item;
  };

  // Связи уровней.
  const linkReport: ComplexReport['links'] = [];
  const linkKinds: [Point, LinkKind, 'up' | 'down'][] = [];
  if (up) linkKinds.push([up, linkKindFor(archetype.id, level - 1), 'up']);
  if (down) linkKinds.push([down, linkKindFor(archetype.id, level), 'down']);
  let stairsUp: Point | undefined, stairsDown: Point | undefined;
  for (const [point, kind, dir] of linkKinds) {
    const at = stairFootprint(point);
    const object = LINK_OBJECTS[kind][dir];
    if (put(object, at, 0, { free: true })) {
      linkReport.push({ kind, dir, x: at.x, y: at.y });
      if (dir === 'up') stairsUp = at; else stairsDown = at;
      // Обвязка связи: лебёдка у подъёмника, осыпь у провала.
      const host = owner[id(at.x, at.y)];
      if (kind === 'lift') for (const p of [{ x: at.x + 2, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x, y: at.y + 2 }]) if (put('winch', p, 0, { room: host })) break;
      if (kind === 'collapse') for (const p of [{ x: at.x + 2, y: at.y + 1 }, { x: at.x - 1, y: at.y }, { x: at.x + 1, y: at.y + 2 }, { x: at.x, y: at.y - 1 }]) put('rubblePile', p, 0, { room: host });
    }
  }
  if (!up) {
    // Верхний ярус: выход на поверхность в зале входа.
    const room = entryIndex;
    const c = centre(room);
    const spots = [...floorCells[room]].map((cell) => ({ x: cell % W, y: Math.floor(cell / W) }))
      .sort((p, q) => Math.hypot(p.x - c.x + 1.5, p.y - c.y + 1.5) - Math.hypot(q.x - c.x + 1.5, q.y - c.y + 1.5) || p.y - q.y || p.x - q.x);
    for (const spot of spots) if (put('stairsUp', spot, 0, { room })) { stairsUp = spot; break; }
  }

  // Колонны залов и колоннад: вид колонны — по стилю, обломки — по состоянию.
  const column: CryptKind = style.column === 'rockSpire' ? 'stalagmites' : style.column;
  const columnAt = (cell: number, roomIndex?: number) => {
    const p = { x: cell % W, y: Math.floor(cell / W) };
    const broken = ruin() < condition.brokenColumns;
    const kind: CryptKind = roomIndex !== undefined && rooms[roomIndex].natural ? 'stalagmites' : broken ? 'rubble' : column;
    put(kind, p, 0, { free: true });
  };
  for (const cell of [...pillarCells].sort((a, b) => a - b)) columnAt(cell, owner[cell]);
  for (const cell of [...corridorPillars].sort((a, b) => a - b)) if (cells[Math.floor(cell / W)][cell % W].terrain === 'floor') columnAt(cell);

  // Ниши: по теме зала (погребения, свитки, статуи стиля).
  const NICHE: Partial<Record<CryptTheme, CryptKind[]>> = {
    burial: ['wrappedBody', 'burialUrn', 'skeletonPile'], ossuary: ['bonePile', 'skull', 'skeletonPile'],
    archive: ['scrollRack', 'bookcase'], quarters: ['shelf', 'urns'], sanctum: [style.statues[0], 'candleStand'], watch: ['toolRack', 'banner' as CryptKind],
  };
  for (const { cell, room } of nicheCells) {
    const pool = NICHE[PURPOSES[nodeOf(room).purpose].theme] ?? ['urns', style.statues[0]];
    put(pool[Math.floor(hash2(cell, room, levelSeed + 0x41c) * pool.length)], { x: cell % W, y: Math.floor(cell / W) }, 0, { room });
  }
  for (const cell of corridorNiches) {
    const pool: CryptKind[] = archetype.id === 'catacombs' || archetype.id === 'tomb' ? ['burialNiche', 'wrappedBody', 'burialUrn'] : [style.statues[0], 'urns'];
    if (!spine.has(cell)) put(pool[Math.floor(hash2(cell, 9, levelSeed + 0x41d) * pool.length)], { x: cell % W, y: Math.floor(cell / W) }, 0);
  }

  // Сцены по назначению.
  const resolve = (kind: SceneKind, salt: number): CryptKind => {
    if (kind === '@statue') return style.statues[salt % style.statues.length];
    if (kind === '@hall') return style.lights.hall;
    if (kind === '@stand') return style.lights.stand;
    if (kind === '@ritual') return style.lights.ritual;
    if (kind === '@wall') return style.wall[salt % style.wall.length];
    return kind;
  };
  const roomCellsList = rooms.map((_, i) => [...floorCells[i]].sort((a, b) => a - b));
  const wallFloor = (cell: number, index: number) => { const x = cell % W, y = (cell - x) / W; return DIRS.filter(([dx, dy]) => owner[id(x + dx, y + dy)] !== index).length; };
  const faceCells = (index: number): number[] => {
    const out = new Set<number>();
    for (const cell of floorCells[index]) {
      const x = cell % W, y = (cell - x) / W;
      for (const [dx, dy] of DIRS) { const n = id(x + dx, y + dy); if (cells[Math.floor(n / W)][n % W].terrain === 'wall') out.add(n); }
    }
    return [...out].sort((a, b) => hash2(a, index, levelSeed + 0xfa) - hash2(b, index, levelSeed + 0xfa) || a - b);
  };
  const placePart = (part: ScenePart, index: number, salt: number): number => {
    const room = rooms[index];
    const rect = room.rect;
    const focus = { x: rect.x + room.geometry.focus.x, y: rect.y + room.geometry.focus.y };
    const c = centre(index);
    // Ось зала: от фокуса к входу.
    const axis: Point = room.facing === 0 ? { x: 1, y: 0 } : room.facing === 1 ? { x: -1, y: 0 } : room.facing === 2 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const kindAt = (k: number) => resolve(part.kind, salt + k);
    const wanted = part.count ?? 1;
    let made = 0;
    const rotations: ChestRotation[] = room.facing >= 2 ? [0, 90] : [90, 0];
    const tryCells = (list: Point[], kind: CryptKind) => {
      for (const p of list) for (const r of CRYPT[kind].w === CRYPT[kind].h ? [0 as ChestRotation] : rotations) {
        if (put(kind, p, r, { room: index })) return true;
      }
      return false;
    };
    const pts = (cellsList: number[]) => cellsList.map((cell) => ({ x: cell % W, y: Math.floor(cell / W) }));
    const byDistance = (target: Point) => pts(roomCellsList[index]).sort((p, q) => Math.hypot(p.x - target.x, p.y - target.y) - Math.hypot(q.x - target.x, q.y - target.y) || p.y - q.y || p.x - q.x);
    if (part.slot === 'face') {
      for (const cell of faceCells(index)) {
        if (made >= wanted) break;
        if (put(kindAt(made), { x: cell % W, y: Math.floor(cell / W) }, 0)) made += 1;
      }
      return made;
    }
    if (part.slot === 'flank') {
      const side = { x: axis.y, y: axis.x };
      for (const d of [2, 3, 1]) {
        if (made >= 2) break;
        const pair = [{ x: focus.x + side.x * d + axis.x, y: focus.y + side.y * d + axis.y }, { x: focus.x - side.x * d + axis.x, y: focus.y - side.y * d + axis.y }];
        if (pair.every((p) => owner[id(p.x, p.y)] === index && !spine.has(id(p.x, p.y)))) {
          for (const p of pair) if (put(kindAt(made), p, 0, { room: index })) made += 1;
        }
      }
      return made;
    }
    if (part.slot === 'row') {
      // Ряд вдоль самой длинной прямой стены зала, шаг 2.
      const lines = new Map<string, Point[]>();
      for (const cell of roomCellsList[index]) {
        const x = cell % W, y = (cell - x) / W;
        for (const [dx, dy] of DIRS) {
          if (owner[id(x + dx, y + dy)] === index) continue;
          const key = dx !== 0 ? `x${x}:${dx}` : `y${y}:${dy}`;
          lines.set(key, [...(lines.get(key) ?? []), { x, y }]);
        }
      }
      const ordered = [...lines.entries()].sort((p, q) => q[1].length - p[1].length || (hash2(p[0].length, salt, levelSeed) - hash2(q[0].length, salt, levelSeed)));
      for (const [, line] of ordered.slice(0, 2)) {
        line.sort((p, q) => p.x - q.x || p.y - q.y);
        for (let k = 1; k < line.length - 1 && made < wanted; k += 2) if (tryCells([line[k]], kindAt(made))) made += 1;
        if (made >= wanted) break;
      }
      return made;
    }
    for (let k = 0; k < wanted; k += 1) {
      const kind = kindAt(k);
      let list: Point[];
      if (part.slot === 'focus') list = byDistance(focus).slice(0, 10);
      else if (part.slot === 'front') list = byDistance({ x: focus.x + axis.x * 2, y: focus.y + axis.y * 2 }).slice(0, 8);
      else if (part.slot === 'center') list = byDistance(c).slice(0, 14);
      else if (part.slot === 'corner') list = pts(roomCellsList[index].filter((cell) => wallFloor(cell, index) >= 2)).sort((p, q) => hash2(p.x, p.y, salt + k) - hash2(q.x, q.y, salt + k));
      else if (part.slot === 'wall') list = pts(roomCellsList[index].filter((cell) => wallFloor(cell, index) >= 1)).sort((p, q) => hash2(p.x, p.y, salt + k * 7) - hash2(q.x, q.y, salt + k * 7));
      else list = pts(roomCellsList[index]).sort((p, q) => hash2(p.x, p.y, salt + k * 13) - hash2(q.x, q.y, salt + k * 13));
      if (tryCells(list, kind)) made += 1;
    }
    return made;
  };
  rooms.forEach((room, index) => {
    const node = nodeOf(index);
    const variants = SCENES[node.purpose];
    if (!variants?.length) return;
    const variant = variants[Math.floor(hash2(node.id, room.rect.x * 31 + room.rect.y, levelSeed + 0x5ce) * variants.length)];
    let total = 0;
    variant.parts.forEach((part, k) => {
      if (part.optional && decor() > .55 + (s.cryptDetail ?? .67) * .3) return;
      total += placePart(part, index, mix(index, k, 0x5c));
    });
    if (total > 0) sceneLog.push(`${PURPOSES[node.purpose].label}: ${variant.label}`);
  });

  // Свет по стилю: настенные светильники по периметру (шаг ~7 клеток стены),
  // в главных залах — центральный светильник, в природных — грибы и кристаллы.
  rooms.forEach((room, index) => {
    const node = nodeOf(index);
    if (room.natural) {
      const glowCount = Math.round((1 + floorCells[index].size / 30) * (.4 + condition.growth) * growthK);
      const corners = roomCellsList[index].filter((cell) => wallFloor(cell, index) >= 1 && !spine.has(cell)).sort((a, b) => hash2(a, 3, levelSeed + 0x6e) - hash2(b, 3, levelSeed + 0x6e));
      let made = 0;
      for (const cell of corners) {
        if (made >= glowCount) break;
        if (put(decor() < .6 ? 'glowingMushroom' : 'crystalCluster', { x: cell % W, y: Math.floor(cell / W) }, 0, { room: index })) made += 1;
      }
      return;
    }
    const faces = faceCells(index);
    const step = node.major ? 5 : 7;
    const want2 = Math.max(node.tier === 'service' ? 0 : 1, Math.round(faces.length / step));
    const wallLight = style.lights.wall;
    let made = 0;
    if (CRYPT[wallLight].placement === 'wallFace') {
      const chosen: number[] = [];
      for (const cell of faces) {
        if (made >= want2) break;
        if (chosen.some((other) => Math.abs((other % W) - (cell % W)) + Math.abs(Math.floor(other / W) - Math.floor(cell / W)) < 4)) continue;
        if (put(wallLight, { x: cell % W, y: Math.floor(cell / W) }, 0)) { chosen.push(cell); made += 1; }
      }
    } else {
      const spots = roomCellsList[index].filter((cell) => wallFloor(cell, index) >= 1).sort((a, b) => hash2(a, 4, levelSeed) - hash2(b, 4, levelSeed));
      for (const cell of spots) { if (made >= Math.ceil(want2 / 2)) break; if (put(wallLight, { x: cell % W, y: Math.floor(cell / W) }, 0, { room: index })) made += 1; }
    }
    if (node.major && Math.min(room.rect.w, room.rect.h) >= 7) {
      const c = centre(index);
      const hall = style.lights.hall;
      // Люстра висит над центром (плоская), жаровни — по бокам оси.
      if (CRYPT[hall].flat) put(hall, { x: c.x - 1, y: c.y - 1 }, 0, { room: index, free: true });
      else for (const p of [{ x: c.x - 2, y: c.y }, { x: c.x + 2, y: c.y }]) put(hall, p, 0, { room: index });
    }
  });
  // Коридоры: светильники вдоль главных линий.
  for (const link of routed) {
    if (link.role !== 'main' || link.kind === 'natural') continue;
    const wallLight = style.lights.wall;
    if (CRYPT[wallLight].placement !== 'wallFace') continue;
    for (let k = 4; k < link.path.length - 4; k += 9) {
      const cell = link.path[k];
      const x = cell % W, y = (cell - x) / W;
      for (const [dx, dy] of DIRS) {
        let o = 1;
        while (carved[id(x + dx * o, y + dy * o)] && o < 4) o += 1;
        if (cells[y + dy * o]?.[x + dx * o]?.terrain === 'wall' && put(wallLight, { x: x + dx * o, y: y + dy * o }, 0)) break;
      }
    }
  }

  // Механизмы и ловушки — только там, где их подразумевает архетип.
  const mech = new Set(archetype.mechanisms);
  // «Автоматические ловушки» выключены: ловушечные коридоры не строятся, механизмы дверей и машины остаются.
  if (s.cryptTraps === false) mech.delete('trapCorridor');
  const wallNear = (cell: number, radius: number): Point | undefined => {
    const x0 = cell % W, y0 = Math.floor(cell / W);
    for (let r = 1; r <= radius; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx, y = y0 + dy;
      if (cells[y]?.[x]?.terrain !== 'wall' || nearDoor(x, y)) continue;
      if (!DIRS.some(([ax, ay]) => field.corridor[id(x + ax, y + ay)])) continue;
      return { x, y };
    }
    return undefined;
  };
  if (mech.has('levers') || mech.has('vault')) {
    for (const [door, kind] of wanted) {
      if (kind !== 'portcullis' && kind !== 'gate') continue;
      const spot = wallNear(door, 3);
      if (spot && put('lever', spot, 0)) { mechanisms.push(`рычаг у двери (${kind === 'gate' ? 'ворота' : 'решётка'})`); if (mechanisms.length > 3) break; }
    }
  }
  if (mech.has('hiddenPassage')) {
    for (const [door, kind] of wanted) {
      if (kind !== 'secret') continue;
      const x = door % W, y = Math.floor(door / W);
      const host = DIRS.map(([dx, dy]) => owner[id(x + dx, y + dy)]).find((o) => o >= 0 && nodeOf(o).tier !== 'hidden');
      if (host === undefined) continue;
      for (const cell of faceCells(host)) {
        if (Math.abs((cell % W) - x) + Math.abs(Math.floor(cell / W) - y) > 4) continue;
        if (put('buttonPanel', { x: cell % W, y: Math.floor(cell / W) }, 0)) { mechanisms.push('потайная панель у тайной двери'); break; }
      }
    }
  }
  if (mech.has('trapCorridor')) {
    // Связанная серия: плиты на оси коридора и отверстия дротиков в стенах.
    const target = [...routed].filter((link) => link.role === 'main' && link.length >= 10).sort((p, q) => q.length - p.length)[0];
    if (target) {
      const mid = Math.floor(target.path.length / 2);
      let plates = 0;
      for (const k of [mid - 2, mid, mid + 2]) {
        const cell = target.path[k];
        if (put('pressurePlate', { x: cell % W, y: Math.floor(cell / W) }, 0, { free: true })) plates += 1;
      }
      const cell = target.path[mid];
      const x = cell % W, y = Math.floor(cell / W);
      let holes = 0;
      for (const [dx, dy] of DIRS) {
        let o = 1;
        while (carved[id(x + dx * o, y + dy * o)] && o < 4) o += 1;
        if (cells[y + dy * o]?.[x + dx * o]?.terrain === 'wall' && put('dartHoleWall', { x: x + dx * o, y: y + dy * o }, 0)) holes += 1;
      }
      if (plates) mechanisms.push(`ловушечный коридор: ${plates} плиты, ${holes} отверстия`);
    }
  }
  if (mech.has('machine')) {
    // Рельсы по осевой линии главной штольни, вагонетка в конце.
    const tunnel = [...routed].filter((link) => link.role === 'main' && link.kind !== 'natural').sort((p, q) => q.length - p.length)[0];
    if (tunnel) {
      let rails = 0;
      for (let k = 2; k < tunnel.path.length - 3; k += 2) {
        const a = tunnel.path[k], b = tunnel.path[k + 1];
        const horizontal = Math.abs((b % W) - (a % W)) === 1;
        const p = { x: Math.min(a % W, b % W), y: Math.min(Math.floor(a / W), Math.floor(b / W)) };
        if (put('mineRails', p, horizontal ? 0 : 90, { free: true })) rails += 1;
      }
      if (rails) mechanisms.push(`рельсы в штольне: ${rails}`);
    }
  }
  if (mech.has('sluice')) {
    let grates = 0;
    for (const link of routed) {
      if (link.kind !== 'channel') continue;
      const cell = link.path[Math.floor(link.path.length / 2)];
      const x = cell % W, y = Math.floor(cell / W);
      const horizontal = DIRS.some(([dx, dy]) => dy === 0 && link.path.includes(id(x + dx, y + dy)));
      if (put('sewerGrate', { x, y }, horizontal ? 0 : 90, { free: true }) || put('drain', wallNear(cell, 2) ?? { x, y }, 0)) grates += 1;
      const spot = wallNear(cell, 3);
      if (spot) put('lever', spot, 0);
    }
    if (grates) mechanisms.push(`шлюзовые решётки: ${grates}`);
  }
  if (mech.has('statue')) {
    const main = roomOf.get(graph.main);
    if (main !== undefined && !rooms[main].natural) {
      const door = doorsOf[main][0];
      if (door !== undefined) {
        const x = door % W, y = Math.floor(door / W);
        const inside = DIRS.map(([dx, dy]) => ({ x: x + dx, y: y + dy, dx, dy })).find((p) => owner[id(p.x, p.y)] === main);
        if (inside) {
          let made = 0;
          for (const side of [1, -1]) {
            const p = { x: inside.x + inside.dx + inside.dy * side * 2, y: inside.y + inside.dy + inside.dx * side * 2 };
            if (put(style.statues[0], p, 0, { room: main })) made += 1;
          }
          if (made) mechanisms.push('статуи-стражи у входа в главный зал');
        }
      }
    }
  }

  // Следы состояния: трещины, обломки у проломов, паутина, мох, корни.
  for (const cell of breachCells) {
    const x = cell % W, y = Math.floor(cell / W);
    let made = 0;
    for (const [dx, dy] of AROUND) { if (made >= 2) break; if (put(made ? 'rubble' : 'rubblePile', { x: x + dx, y: y + dy }, 0, {})) made += 1; }
  }
  const floorList: number[] = [];
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) if (cells[y][x].terrain === 'floor') floorList.push(id(x, y));
  const scatter = (kinds: CryptKind[], share: number, filter: (cell: number) => boolean, salt: number) => {
    const target = Math.round(floorList.length * share);
    let made = 0;
    const list = floorList.filter(filter).sort((a, b) => hash2(a, salt, levelSeed) - hash2(b, salt, levelSeed));
    for (const cell of list) {
      if (made >= target) break;
      if (put(kinds[Math.floor(hash2(cell, salt + 1, levelSeed) * kinds.length)], { x: cell % W, y: Math.floor(cell / W) }, 0, {})) made += 1;
    }
  };
  const walled2 = (cell: number) => DIRS.some(([dx, dy]) => { const t = cells[Math.floor(cell / W) + dy]?.[(cell % W) + dx]?.terrain; return t === 'wall' || t === 'void'; });
  scatter(['cracks', 'crackedFloor'], condition.debris * .012 * debrisK, (cell) => !natural[cell], 0x31);
  scatter(['rubble', 'rubblePile'], condition.debris * .01 * debrisK, (cell) => walled2(cell) && !natural[cell], 0x32);
  scatter(['web'], condition.neglect * .008, (cell) => walled2(cell), 0x33);
  scatter(['mossPatch', 'lichen', 'roots'], condition.growth * .025 * growthK, () => true, 0x34);
  scatter(['puddleMud', 'puddleBlue'], condition.flood * .01, (cell) => !spine.has(cell), 0x35);
  // Обвалы: осыпи у стен (проходы не перекрываются — put уважает ось маршрутов).
  if (condition.rockfall > 0) scatter(['rockFall', 'rockPile', 'rubblePile'], condition.rockfall * .012 * debrisK, (cell) => walled2(cell) && !spine.has(cell), 0x36);
  // Повторное заселение: припасы и баррикады у дверей залов, со стороны зала.
  if (condition.occupied > 0) {
    let stock = 0;
    const limit = Math.round(condition.occupied * (4 + sortedArt.length * .8));
    for (const cell of doorCells) {
      if (stock >= limit) break;
      const x = cell % W, y = Math.floor(cell / W);
      if (hash2(x, y, levelSeed + 0x0cc) > .6) continue;
      // Клетки в двух шагах от двери, не на самом проходе.
      for (const [dx, dy] of [[2, 1], [-2, 1], [1, 2], [-1, 2], [2, -1], [-2, -1], [1, -2], [-1, -2]]) {
        const at = { x: x + dx, y: y + dy };
        const kind: CryptKind = hash2(at.y, at.x, levelSeed) < .5 ? 'crateStack' : hash2(at.x, at.y, levelSeed + 3) < .5 ? 'barrelStack' : 'sackPile';
        if (put(kind, at, 0, {})) { stock += 1; break; }
      }
    }
    scatter(['oilLamp', 'bucket', 'sackPile'], condition.occupied * .004, (cell) => walled2(cell) && !natural[cell], 0x37);
  }
  if (condition.growth > .3) {
    let ivy = 0;
    for (const index of sortedArt) for (const cell of faceCells(index)) {
      if (ivy >= Math.round(condition.growth * 12)) break;
      if (hash2(cell, 0x1f, levelSeed) < condition.growth * .25 && put('ivyWall', { x: cell % W, y: Math.floor(cell / W) }, 0)) ivy += 1;
    }
  }
  // Природные залы и тоннели: сталагмиты, камни, грибы — не по хребту.
  const rocks: Rock[] = [];
  const trees: Tree[] = [];
  for (const index of naturalRooms) {
    const n = Math.round(floorCells[index].size / 22);
    let made = 0;
    for (const cell of roomCellsList[index].slice().sort((a, b) => hash2(a, 0x51a, levelSeed) - hash2(b, 0x51a, levelSeed))) {
      if (made >= n) break;
      if (put(decor() < .7 ? 'stalagmites' : 'pebbles', { x: cell % W, y: Math.floor(cell / W) }, 0, { room: index })) made += 1;
    }
  }
  const occupied = new Set<number>();
  for (const item of placed) for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) occupied.add(id(x, y));
  for (const cell of floorList) {
    if (!natural[cell] || spine.has(cell) || occupied.has(cell)) continue;
    const x = cell % W, y = Math.floor(cell / W);
    if (cells[y + 1]?.[x + 1]?.terrain !== 'floor') continue;
    const roll = hash2(x, y, levelSeed + 0xdeb);
    if (roll < .05 + condition.debris * .04) {
      const r = .14 + hash2(y, x, levelSeed) * .2;
      const pts: [number, number][] = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2; const rr = r * (.7 + hash2(k, cell, levelSeed) * .3); return [Math.cos(a) * rr, Math.sin(a) * rr]; });
      rocks.push({ x: x + .5, y: y + .5, r, pts, v: hash2(cell, 2, levelSeed) });
    } else if (roll < .05 + condition.debris * .04 + condition.growth * .05) {
      trees.push({ x: x + .5, y: y + .5, r: .15 + hash2(cell, 3, levelSeed) * .1, kind: 'mushroom', v: hash2(cell, 4, levelSeed) });
    }
  }

  // ---- 8. Прежний конвейер склепа по рукотворным залам ------------------------
  const themes = sortedArt.map((i) => PURPOSES[nodeOf(i).purpose].theme);
  const depth = new Array<number>(rooms.length).fill(-1);
  depth[entryIndex] = 0;
  const queue = [entryIndex];
  for (let q = 0; q < queue.length; q += 1) for (const link of routed) {
    const at = queue[q];
    const next = link.a === at ? link.b : link.b === at ? link.a : -1;
    if (next < 0 || depth[next] >= 0) continue;
    depth[next] = depth[at] + 1;
    queue.push(next);
  }
  const planRoom = (i: number, k: number): DungeonRoom => ({
    id: `room-${k}`, purpose: nodeOf(i).purpose, bounds: { x: rooms[i].rect.x, y: rooms[i].rect.y, w: rooms[i].rect.w, h: rooms[i].rect.h },
    depth: Math.max(0, depth[i]), shape: rooms[i].shape, features: rooms[i].features.length ? [...rooms[i].features] : undefined, category: PURPOSES[nodeOf(i).purpose].category,
  });
  const artRooms = sortedArt.map((i, k) => planRoom(i, k));
  const artBase: MapData = { ...walled, structures: sortedArt.map((i) => rooms[i].rect), rocks, trees };
  const basePlan: GenerationPlan = { version: 1, engine: 'structured', zones: [], poi: [], groups: [], rooms: artRooms, graph: [] };
  const furnished = furnishByPurpose({ ...artBase, crypt: placed }, basePlan);
  const detail = Math.max(0, Math.min(1, (s.cryptDetail ?? .67) * .55));
  const decorSettings: GenSettings = { ...s, seed: levelSeed, cryptDetail: detail, cryptChasms: condition.debris >= .5 && (s.cryptChasms ?? true) };
  const decorated = artRooms.length ? decorateCrypt(artBase, decorSettings, furnished.map.crypt ?? placed, themes, new Set([...spine, ...ornamentCells])) : { ...artBase, crypt: furnished.map.crypt ?? placed, cryptRooms: [] };
  const composed = cryptCompositionPlan(decorated, furnished.plan);
  const trapped = mech.has('trapCorridor') ? placeCorridorTraps({ ...decorated, plan: composed }, composed) : { map: decorated, plan: composed };
  const onBlocked = (item: CryptObject) => doorMarks.some((d) => d.kind === 'blocked' && d.x >= item.x && d.x < item.x + item.w && d.y >= item.y && d.y < item.y + item.h);
  // Погасшие светильники декоратора: та же доля, что и у расставленных выше.
  const crypt = (trapped.map.crypt ?? []).filter((item) => !onBlocked(item)).map((item) => {
    if (item.source !== 'layout' || item.unlit !== undefined || !LIGHTS.has(item.kind) || placed.includes(item)) return item;
    if (hash2(item.x, item.y, levelSeed + 0x11c) > condition.lit) { unlit += 1; return { ...item, unlit: true }; }
    lit += 1;
    return item;
  });
  const freed = freePockets({ ...decorated, cells, structures, crypt }, anchors[entryIndex], new Set(doorMarks.filter((d) => d.kind === 'blocked').map((d) => id(d.x, d.y))));
  const finalMap: MapData = { ...decorated, cells, structures, crypt: freed.crypt, floorLayer: { codes: codes.join(''), ornaments } };

  // ---- 9. Проверка связности и отчёт ----------------------------------------
  const blocked = new Set(doorMarks.filter((d) => d.kind === 'blocked').map((d) => id(d.x, d.y)));
  const start = anchors[entryIndex];
  const seen = new Uint8Array(W * H);
  if (start !== undefined && cryptWalkable(finalMap, start % W, Math.floor(start / W))) {
    const bfs = [start];
    seen[start] = 1;
    for (let q = 0; q < bfs.length; q += 1) {
      const x = bfs[q] % W, y = (bfs[q] - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, cell = id(nx, ny);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[cell] || blocked.has(cell) || !cryptWalkable(finalMap, nx, ny)) continue;
        seen[cell] = 1;
        bfs.push(cell);
      }
    }
  }
  const order2 = [...sortedArt, ...naturalRooms];
  const pos2 = new Map(order2.map((original, k) => [original, k]));
  const planRooms: DungeonRoom[] = [...(trapped.plan.rooms ?? artRooms), ...naturalRooms.map((i, k) => planRoom(i, sortedArt.length + k))];
  const roadGraph: RoadGraphEdge[] = routed.map((link) => ({ from: `room-${pos2.get(link.a)}`, to: `room-${pos2.get(link.b)}`, length: link.length }));
  const mainRoom = roomOf.get(graph.main);
  const mainMargin = mainRoom !== undefined ? Math.min(centre(mainRoom).x / W, (W - centre(mainRoom).x) / W, centre(mainRoom).y / H, (H - centre(mainRoom).y) / H) : 0;
  const naturalCount = floorList.filter((cell) => natural[cell]).length;
  const complex: ComplexReport = {
    generator: COMPLEX_GENERATOR_VERSION,
    archetype: archetype.id,
    label: archetype.label,
    topology: profile.topology,
    geometry: profile.geometry,
    style: style.id,
    condition: condition.id,
    levelRole: profile.role,
    tiers: count(rooms.map((_, i) => nodeOf(i).tier)),
    purposes: count(rooms.map((_, i) => nodeOf(i).purpose)),
    corridors: count(routed.map((link) => link.kind)),
    widths,
    naturalShare: floorList.length ? Math.round((naturalCount / floorList.length) * 100) / 100 : 0,
    breaches: breachCells.length,
    composite: rooms.filter((room) => room.shape === 'composite').length,
    scenes: sceneLog,
    lights: { lit, unlit },
    mechanisms,
    links: linkReport,
    mainMargin: Math.round(mainMargin * 100) / 100,
    dropped: dropped.length + requested - budget,
  };
  const degree = new Array<number>(rooms.length).fill(0);
  for (const link of routed) { degree[link.a] += 1; degree[link.b] += 1; }
  const intendedEnd = (i: number) => ['entry', 'hidden', 'landing', 'final', 'service'].includes(nodeOf(i).tier) || nodeOf(i).purpose === 'treasury' || nodeOf(i).purpose === 'cell';
  const report: DungeonLayoutReport = {
    generator: COMPLEX_GENERATOR_VERSION,
    level,
    levels,
    requested,
    placed: rooms.length,
    shapes: count(rooms.map((room) => room.shape as RoomShape)),
    features: count(rooms.flatMap((room) => room.features)),
    doors: count([...wanted.values()]),
    loops: routed.filter((link) => link.role === 'loop').length,
    deadEnds: rooms.filter((_, i) => !intendedEnd(i) && degree[i] <= 1).length,
    corridorWidths: { 1: widths['1'] ?? 0, 2: widths['2'] ?? 0, 3: (widths['3'] ?? 0) + (widths['4'] ?? 0) },
    secretRooms: rooms.filter((_, i) => nodeOf(i).tier === 'hidden').length,
    stairsUp,
    stairsDown,
    connected: anchors.every((cell) => seen[cell] === 1),
    complex,
  };
  const spawn = stairsUp ? { x: stairsUp.x, y: stairsUp.y + 2 <= H - 1 && cryptWalkable(finalMap, stairsUp.x, stairsUp.y + 2) ? stairsUp.y + 2 : stairsUp.y } : { x: start % W, y: Math.floor(start / W) };
  const actions = [...(trapped.plan.actions ?? [])];
  if (dropped.length || budget < requested) actions.push(`не поместилось залов: ${dropped.length + requested - budget} из ${requested}`);
  return { ...finalMap, plan: { ...trapped.plan, rooms: planRooms, graph: roadGraph, spawn, dungeon: report, actions } };
}

/** Подписи для отчёта UI. */
export const describeTier = (tier: NodeTier) => TIER_LABELS[tier];
export const describeCorridor = (kind: CorridorKind) => CORRIDOR_LABELS[kind];
