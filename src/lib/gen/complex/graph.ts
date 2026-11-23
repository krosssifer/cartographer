/**
 * Логическая структура комплекса — первый из двух этапов.
 *
 * Граф строится без координат карты: узлы с ярусом (вход, главный зал,
 * узел, второстепенное, галерея, служебное, скрытое, природное, финал,
 * спуск), рёбра с ролью (главное, боковое, кольцо, служебное, тайное,
 * природное) и «опорные точки» (slot) в нормированных координатах [0,1]² —
 * замысел композиции, по которому embed.ts раскладывает залы на карте.
 *
 * Назначения залов раздаются после топологии с учётом функциональных связей
 * (AFFINITY): казарма тянется к караульной, архив — к библиотеке.
 */
import type { Rng } from '../../random';
import { AFFINITY, PURPOSES, type ComplexArchetype, type ComplexPurpose, type NodeTier, type Topology } from './registry';

export type EdgeRole = 'main' | 'side' | 'loop' | 'service' | 'hidden' | 'natural';

export interface GraphNode {
  id: number;
  tier: NodeTier;
  purpose: ComplexPurpose;
  /** Родитель в остове (−1 у входа). */
  parent: number;
  /** Крыло или кластер: залы одного крыла держатся вместе. */
  wing: number;
  /** Рёбер остова от входа. */
  depth: number;
  /** Главное пространство: крупнее, богаче, на композиционной оси. */
  major: boolean;
  /** Опорная точка в нормированных координатах (если топология её задаёт). */
  slot?: { x: number; y: number };
}

export interface GraphEdge { a: number; b: number; role: EdgeRole }

export interface ComplexGraph {
  topology: Topology;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entry: number;
  main: number;
  final: number;
  landing: number;
}

export interface GraphRequest {
  archetype: ComplexArchetype;
  topology: Topology;
  /** Залов всего, включая вход, скрытые и спуск. */
  count: number;
  /** Доля природных узлов. */
  natural: number;
  /** Нужен зал-спуск на нижний уровень. */
  landing: boolean;
  /** Вход — лестница с верхнего уровня (не край карты). */
  fromAbove: boolean;
  rng: Rng;
}

function weighted<T>(rng: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = rng() * total;
  for (const [value, w] of options) {
    roll -= Math.max(0, w);
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

class Builder {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  add(tier: NodeTier, parent: number, wing: number, slot?: { x: number; y: number }, role: GraphEdge['role'] = 'main'): number {
    const id = this.nodes.length;
    const depth = parent >= 0 ? this.nodes[parent].depth + 1 : 0;
    this.nodes.push({ id, tier, purpose: 'storage', parent, wing, depth, major: tier === 'main' || tier === 'hub', slot });
    if (parent >= 0) this.edges.push({ a: parent, b: id, role });
    return id;
  }
  link(a: number, b: number, role: GraphEdge['role']) {
    if (a === b || this.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
    this.edges.push({ a, b, role });
  }
  leaves(): number[] {
    return this.nodes.filter((n) => !this.nodes.some((m) => m.parent === n.id)).map((n) => n.id);
  }
}

/** Точка на отрезке с поперечным сдвигом: оси композиции не по линейке. */
const along = (t: number, sway: number, rng: Rng) => ({ x: .1 + t * .8, y: .5 + (rng() - .5) * sway });

/** Цепочка из n узлов от родителя по направлению (dx, dy) в нормированных координатах. */
function chain(b: Builder, from: number, n: number, wing: number, dir: [number, number], step: number, tier: NodeTier = 'secondary'): number[] {
  const out: number[] = [];
  let at = from;
  for (let i = 0; i < n; i += 1) {
    const base = b.nodes[at].slot;
    const slot = base ? { x: clamp01(base.x + dir[0] * step), y: clamp01(base.y + dir[1] * step) } : undefined;
    at = b.add(tier, at, wing, slot, 'side');
    out.push(at);
  }
  return out;
}
const clamp01 = (v: number) => Math.max(.06, Math.min(.94, v));

// ---------------------------------------------------------------------------
// Топологии: каждая даёт свой замысел композиции, а не только число рёбер.
// ---------------------------------------------------------------------------

function linear(b: Builder, n: number, rng: Rng) {
  // Парадная ось: вход — анфилада — главный зал — финал; редкие боковые залы.
  const sides = Math.floor((n - 3) * .25);
  const axis = Math.max(3, n - sides);
  const mainAt = Math.max(1, Math.min(axis - 2, Math.round(axis * (.45 + rng() * .2))));
  let at = b.add('entry', -1, 0, along(0, .1, rng));
  const spine = [at];
  for (let i = 1; i < axis; i += 1) {
    const tier: NodeTier = i === mainAt ? 'main' : i === axis - 1 ? 'final' : 'transit';
    at = b.add(tier, at, 0, along(i / (axis - 1), .22, rng));
    spine.push(at);
  }
  for (let i = 0; i < sides; i += 1) {
    const host = spine[1 + Math.floor(rng() * (axis - 2))];
    const s = b.nodes[host].slot!;
    b.add('secondary', host, i + 1, { x: s.x, y: clamp01(s.y + (rng() < .5 ? -.3 : .3)) }, 'side');
  }
}

function branching(b: Builder, n: number, rng: Rng) {
  // Ствол через карту; от узлов ствола — ветви, финал в конце самой длинной.
  const trunk = Math.max(3, Math.round(n * .38));
  let at = b.add('entry', -1, 0, along(0, .15, rng));
  const stem = [at];
  const mainAt = Math.max(1, Math.round(trunk * .5));
  for (let i = 1; i < trunk; i += 1) {
    at = b.add(i === mainAt ? 'main' : 'hub', at, 0, along(i / (trunk - 1) * .85, .3, rng));
    stem.push(at);
  }
  let left = n - trunk, wing = 1, longest: number[] = [];
  while (left > 0) {
    const host = stem[1 + Math.floor(rng() * (stem.length - 1))];
    const length = Math.min(left, 1 + Math.floor(rng() * 3));
    const up = rng() < .5 ? -1 : 1;
    const branch = chain(b, host, length, wing, [rng() * .12 - .02, up], .26);
    if (branch.length > longest.length) longest = branch;
    left -= length;
    wing += 1;
  }
  const end = longest.length ? longest[longest.length - 1] : stem[stem.length - 1];
  b.nodes[end].tier = 'final';
}

function central(b: Builder, n: number, rng: Rng) {
  // Большой центральный зал; крылья расходятся лучами под разными углами.
  const entry = b.add('entry', -1, 0, { x: .5 + (rng() - .5) * .2, y: .9 });
  const hub = b.add('main', entry, 0, { x: .5 + (rng() - .5) * .1, y: .5 + (rng() - .5) * .1 });
  const spokes = Math.max(2, Math.min(5, Math.round((n - 2) / 2)));
  const ends: number[] = [];
  let left = n - 2;
  const base = rng() * Math.PI * 2;
  for (let k = 0; k < spokes && left > 0; k += 1) {
    // Луч не идёт обратно ко входу (вход внизу, угол π/2).
    let angle = base + (k / spokes) * Math.PI * 2;
    if (Math.abs(Math.sin(angle) - 1) < .25) angle += .9;
    const length = Math.max(1, Math.min(left, Math.round(left / (spokes - k)) + (rng() < .3 ? 1 : 0)));
    const nodes = chain(b, hub, length, k + 1, [Math.cos(angle), Math.sin(angle)], .2);
    ends.push(nodes[nodes.length - 1]);
    left -= length;
  }
  const far = ends.reduce((best, id) => (b.nodes[id].depth > b.nodes[best].depth ? id : best), ends[0]);
  b.nodes[far].tier = 'final';
  // Обход между соседними лучами — второй путь вокруг центра.
  if (ends.length >= 3 && rng() < .6) b.link(ends[0], ends[1], 'loop');
}

function ring(b: Builder, n: number, rng: Rng) {
  // Кольцо залов вокруг центра; вход снаружи, главный зал — напротив входа.
  const size = Math.max(4, Math.min(8, Math.round(n * .55)));
  const entry = b.add('entry', -1, 0, { x: .5, y: .93 });
  const start = Math.PI / 2;
  const rx = .3 + rng() * .08, ry = .28 + rng() * .06;
  const ringIds: number[] = [];
  for (let k = 0; k < size; k += 1) {
    const angle = start + (k / size) * Math.PI * 2;
    const tier: NodeTier = k === Math.round(size / 2) ? 'main' : k === 0 ? 'hub' : 'secondary';
    const parent = k === 0 ? entry : ringIds[k - 1];
    ringIds.push(b.add(tier, parent, 0, { x: .5 + Math.cos(angle) * rx, y: .5 + Math.sin(angle) * ry }, 'main'));
  }
  b.link(ringIds[size - 1], ringIds[0], 'loop');
  let left = n - size - 1;
  const main = ringIds[Math.round(size / 2)];
  if (left > 0) {
    const s = b.nodes[main].slot!;
    b.add('final', main, 1, { x: .5 + (s.x - .5) * .25, y: .5 + (s.y - .5) * .25 }, 'side');
    left -= 1;
  } else b.nodes[main].tier = 'main';
  for (let i = 0; left > 0; i += 1, left -= 1) {
    const host = ringIds[1 + Math.floor(rng() * (size - 1))];
    const s = b.nodes[host].slot!;
    b.add('secondary', host, i + 2, { x: clamp01(.5 + (s.x - .5) * 1.55), y: clamp01(.5 + (s.y - .5) * 1.55) }, 'side');
  }
}

function multihub(b: Builder, n: number, rng: Rng) {
  // Несколько комплексов, связанных галереями-переходами.
  const hubs = n >= 9 ? 3 : 2;
  const spots = hubs === 3
    ? [{ x: .2, y: .3 + rng() * .4 }, { x: .5, y: .3 + rng() * .4 }, { x: .8, y: .3 + rng() * .4 }]
    : [{ x: .27, y: .3 + rng() * .4 }, { x: .73, y: .3 + rng() * .4 }];
  const entry = b.add('entry', -1, 0, { x: spots[0].x, y: spots[0].y > .5 ? .08 : .92 });
  const hubIds: number[] = [];
  let prev = entry;
  spots.forEach((spot, k) => {
    if (k > 0) prev = b.add('transit', prev, k, { x: (spots[k - 1].x + spot.x) / 2, y: (spots[k - 1].y + spot.y) / 2 }, 'main');
    prev = b.add(k === Math.floor(hubs / 2) ? 'main' : 'hub', prev, k, spot, 'main');
    hubIds.push(prev);
  });
  let left = n - 1 - hubs * 2 + 1;
  const last = hubIds[hubIds.length - 1];
  let final = -1;
  const firstOf = new Map<number, number>();
  for (let i = 0; left > 0; i += 1) {
    const k = i % hubs;
    const host = hubIds[(k + 1) % hubs === 0 ? hubs - 1 : k];
    const angle = rng() * Math.PI * 2;
    const length = Math.min(left, rng() < .35 ? 2 : 1);
    const nodes = chain(b, host, length, (k + 1) * 10 + i, [Math.cos(angle), Math.sin(angle)], .17);
    if (!firstOf.has(host)) firstOf.set(host, nodes[0]);
    if (host === last) final = nodes[nodes.length - 1];
    left -= length;
  }
  b.nodes[final >= 0 ? final : last].tier = final >= 0 ? 'final' : b.nodes[last].tier;
  // Комплексы сообщаются не только через переход: второй путь — кольцо между крыльями
  // соседних узлов (или прямая галерея между крайними узлами при трёх узлах).
  if (hubs === 3 && rng() < .5) b.link(hubIds[0], hubIds[2], 'loop');
  else {
    const a = firstOf.get(hubIds[0]), c = firstOf.get(hubIds[1]);
    if (a !== undefined && c !== undefined && a !== final && c !== final) b.link(a, c, 'loop');
    else if (hubs === 3) b.link(hubIds[0], hubIds[2], 'loop');
  }
}

function maze(b: Builder, n: number, rng: Rng) {
  // Решётка ячеек: остов — случайный обход в глубину, плюс много колец.
  const gx = Math.max(2, Math.round(Math.sqrt(n * 1.4))), gy = Math.max(2, Math.ceil(n / gx));
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < gy; y += 1) for (let x = 0; x < gx; x += 1) cells.push({ x, y });
  const take = cells.slice(0, n);
  const slot = (c: { x: number; y: number }) => ({ x: .1 + (c.x + .5) / gx * .8 + (rng() - .5) * .06, y: .1 + (c.y + .5) / gy * .8 + (rng() - .5) * .06 });
  const index = new Map(take.map((c, i) => [`${c.x},${c.y}`, i]));
  const ids = new Array<number>(take.length).fill(-1);
  ids[0] = b.add('entry', -1, 0, slot(take[0]));
  const stack = [0];
  while (stack.length) {
    const at = stack[stack.length - 1];
    const c = take[at];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => index.get(`${c.x + dx},${c.y + dy}`))
      .filter((i): i is number => i !== undefined && ids[i] < 0);
    if (!next.length) { stack.pop(); continue; }
    const pick = next[Math.floor(rng() * next.length)];
    ids[pick] = b.add('secondary', ids[at], Math.floor(take[pick].x / 2) + Math.floor(take[pick].y / 2) * 7, slot(take[pick]), 'main');
    stack.push(pick);
  }
  // Кольца: четверть оставшихся соседств решётки.
  for (let i = 0; i < take.length; i += 1) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const j = index.get(`${take[i].x + dx},${take[i].y + dy}`);
    if (j !== undefined && rng() < .3) b.link(ids[i], ids[j], 'loop');
  }
  const far = b.nodes.reduce((best, node) => (node.depth > best.depth ? node : best), b.nodes[0]);
  far.tier = 'final';
  const middle = b.nodes.filter((node) => node.tier === 'secondary')
    .sort((p, q) => Math.hypot(p.slot!.x - .5, p.slot!.y - .5) - Math.hypot(q.slot!.x - .5, q.slot!.y - .5))[0];
  if (middle) { middle.tier = 'main'; middle.major = true; }
}

function mixed(b: Builder, n: number, rng: Rng) {
  // Центр с двумя крыльями: одно — малое кольцо, другое — ветвление.
  const entry = b.add('entry', -1, 0, { x: .1 + rng() * .1, y: .5 + (rng() - .5) * .4 });
  const hub = b.add('main', entry, 0, { x: .42 + rng() * .1, y: .5 + (rng() - .5) * .2 });
  let left = n - 2;
  // Кольцо из 3–4 залов в одной половине.
  const loopSize = Math.min(left, n >= 8 ? 4 : 3);
  const up = rng() < .5 ? -1 : 1;
  const ringIds: number[] = [];
  const centre = { x: .74, y: .5 + up * .2 };
  for (let k = 0; k < loopSize; k += 1) {
    const angle = Math.PI + (k / loopSize) * Math.PI * 2;
    ringIds.push(b.add(k === 0 ? 'hub' : 'secondary', k === 0 ? hub : ringIds[k - 1], 1,
      { x: clamp01(centre.x + Math.cos(angle) * .17), y: clamp01(centre.y + Math.sin(angle) * .17) }, k === 0 ? 'main' : 'side'));
  }
  if (ringIds.length >= 3) b.link(ringIds[ringIds.length - 1], ringIds[0], 'loop');
  left -= ringIds.length;
  if (ringIds.length) b.nodes[ringIds[Math.floor(ringIds.length / 2)]].tier = 'final';
  // Ветвление в другой половине.
  let wing = 2;
  while (left > 0) {
    const length = Math.min(left, 1 + Math.floor(rng() * 2));
    chain(b, hub, length, wing, [.25 + rng() * .5, -up], .22);
    left -= length;
    wing += 1;
  }
}

const BUILDERS: Record<Topology, (b: Builder, n: number, rng: Rng) => void> = { linear, branching, central, ring, multihub, maze, mixed };

/** Строит логический граф комплекса и раздаёт назначения. */
export function buildGraph(req: GraphRequest): ComplexGraph {
  const { archetype, rng } = req;
  const hidden = req.count >= 6 ? 1 : 0;
  const core = Math.max(2, req.count - hidden - (req.landing ? 1 : 0));
  const b = new Builder();
  BUILDERS[req.topology](b, core, rng);
  // Подстраховка: у каждой топологии ровно один финал и один главный зал.
  if (!b.nodes.some((n) => n.tier === 'main')) {
    const pick = b.nodes.find((n) => n.tier !== 'entry' && n.tier !== 'final') ?? b.nodes[b.nodes.length - 1];
    pick.tier = 'main'; pick.major = true;
  }
  if (!b.nodes.some((n) => n.tier === 'final')) {
    const deepest = b.nodes.filter((n) => n.tier !== 'main' && n.tier !== 'entry').sort((p, q) => q.depth - p.depth)[0];
    if (deepest) deepest.tier = 'final';
  }
  // Листья на ветвях — служебные (кладовая у узла, каморка у караульной).
  for (const leaf of b.leaves()) if (b.nodes[leaf].tier === 'secondary' && rng() < .35) b.nodes[leaf].tier = 'service';
  // Природные участки: дальние второстепенные и служебные залы.
  const candidates = b.nodes.filter((n) => n.tier === 'secondary' || n.tier === 'service' || (req.natural >= .95 && n.tier !== 'entry'))
    .sort((p, q) => q.depth - p.depth || q.id - p.id);
  const naturalCount = Math.round(candidates.length * req.natural);
  for (const node of candidates.slice(0, naturalCount)) {
    if (node.tier === 'main' || node.tier === 'hub' || node.tier === 'final') { node.major = node.tier !== 'final'; continue; }
    node.tier = 'natural';
  }
  // Спуск на нижний уровень — в глубине, у узла или главного зала.
  let landing = -1;
  if (req.landing) {
    const host = b.nodes.filter((n) => n.tier === 'hub' || n.tier === 'main' || n.tier === 'transit' || n.tier === 'secondary')
      .sort((p, q) => q.depth - p.depth || p.id - q.id)[0] ?? b.nodes[0];
    landing = b.add('landing', host.id, host.wing, undefined, 'side');
  }
  if (hidden) {
    const host = b.nodes.filter((n) => n.tier === 'final' || n.tier === 'secondary' || n.tier === 'main').sort((p, q) => q.depth - p.depth)[0] ?? b.nodes[0];
    b.add('hidden', host.id, host.wing, undefined, 'hidden');
  }
  // Природные рёбра: если хотя бы один конец — пещера.
  for (const e of b.edges) {
    const natural = b.nodes[e.a].tier === 'natural' || b.nodes[e.b].tier === 'natural';
    if (natural && e.role !== 'hidden') e.role = 'natural';
    else if (e.role === 'side' && (b.nodes[e.b].tier === 'service')) e.role = 'service';
  }
  assignPurposes(b.nodes, b.edges, archetype, rng);
  const entry = b.nodes.find((n) => n.tier === 'entry')!.id;
  const main = b.nodes.find((n) => n.tier === 'main')!.id;
  const final = b.nodes.find((n) => n.tier === 'final')?.id ?? main;
  return { topology: req.topology, nodes: b.nodes, edges: b.edges, entry, main, final, landing };
}

/** Назначения: ярус → кандидаты; второстепенные — по программе и связям с соседями. */
function assignPurposes(nodes: GraphNode[], edges: GraphEdge[], archetype: ComplexArchetype, rng: Rng) {
  const neighbours = (id: number) => edges.filter((e) => e.a === id || e.b === id).map((e) => (e.a === id ? e.b : e.a));
  const used = new Map<ComplexPurpose, number>();
  const set = (node: GraphNode, purpose: ComplexPurpose) => { node.purpose = purpose; used.set(purpose, (used.get(purpose) ?? 0) + 1); };
  const pickFrom = (list: ComplexPurpose[]) => list[Math.floor(rng() * list.length)];
  /** Узлы и переходы: сначала ещё не использованные назначения — без трёх «главных залов» подряд. */
  const fresh = (list: ComplexPurpose[]) => {
    const unused = list.filter((p) => !used.has(p));
    return pickFrom(unused.length ? unused : list);
  };
  const naturalPool: ComplexPurpose[] = archetype.id === 'mine' ? ['mining', 'mining', 'cave'] : archetype.water === 'lake' ? ['cave', 'cave', 'lake'] : ['cave'];
  // Сначала главные ярусы — они задают «смысл» соседям.
  const order = [...nodes].sort((p, q) => rank(p.tier) - rank(q.tier) || p.depth - q.depth || p.id - q.id);
  let lakes = 0;
  for (const node of order) {
    if (node.tier === 'entry') set(node, 'entrance');
    else if (node.tier === 'landing') set(node, 'landing');
    else if (node.tier === 'main') set(node, pickFrom(archetype.main));
    else if (node.tier === 'final') {
      const options = archetype.final.filter((p) => p !== nodes.find((n) => n.tier === 'main')?.purpose || archetype.final.length === 1);
      set(node, pickFrom(options.length ? options : archetype.final));
    } else if (node.tier === 'hub') set(node, fresh(archetype.hub));
    else if (node.tier === 'transit') set(node, (used.get('gallery') ?? 0) < 1 && rng() < .5 ? 'gallery' : fresh([...archetype.hub.filter((p) => p !== 'gallery'), ...archetype.pool.slice(0, 2).map(([p]) => p)] as ComplexPurpose[]));
    else if (node.tier === 'hidden') set(node, pickFrom(archetype.hidden));
    else if (node.tier === 'natural') {
      let purpose = pickFrom(naturalPool);
      if (purpose === 'lake' && lakes >= 1) purpose = 'cave';
      if (purpose === 'lake') lakes += 1;
      set(node, purpose);
    } else {
      const near = neighbours(node.id).map((id) => nodes[id].purpose);
      const pool = archetype.pool.filter(([p]) => !PURPOSES[p].natural || node.tier === 'service')
        .map(([p, w]): [ComplexPurpose, number] => {
          let weight = w / (1 + (used.get(p) ?? 0) * .7);
          for (const [x, y, bonus] of AFFINITY) if ((x === p && near.includes(y)) || (y === p && near.includes(x))) weight *= 1 + bonus;
          if (node.tier === 'service' && PURPOSES[p].category !== 'utility' && PURPOSES[p].category !== 'defense') weight *= .4;
          return [p, weight];
        });
      set(node, weighted(rng, pool.length ? pool : archetype.pool));
    }
  }
}

const rank = (tier: NodeTier) => ({ entry: 0, main: 1, final: 2, hub: 3, transit: 4, landing: 5, hidden: 6, natural: 7, secondary: 8, service: 9, special: 8 } as Record<NodeTier, number>)[tier];

/** Связность графа (для тестов и проверки). */
export function graphConnected(graph: Pick<ComplexGraph, 'nodes' | 'edges'>): boolean {
  if (!graph.nodes.length) return true;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of graph.edges) {
      const next = e.a === at ? e.b : e.b === at ? e.a : -1;
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === graph.nodes.length;
}
