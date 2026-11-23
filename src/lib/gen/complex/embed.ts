/**
 * Физическая раскладка логического графа — второй этап.
 *
 * Опорные точки топологии переносятся на карту с поворотом/отражением по seed
 * (направление главной оси меняется от карты к карте). Залы ставятся по
 * важности: якорные (лестницы между уровнями) → главный зал → узлы →
 * остальные рядом с родителем, в сторону от входа. Между залами остаётся
 * минимум 3 клетки (стена + коридор + стена). Форма выбирается по
 * назначению, режиму геометрии и тому, что влезает в рамку; зал
 * разворачивается «лицом» ко входу комплекса.
 */
import { mulberry32, type Rng } from '../../random';
import type { Point, Structure } from '../../types';
import type { RoomFeature, RoomShape } from '../plan';
import type { ComplexGraph } from './graph';
import { PURPOSES, type ComplexArchetype, type GeometryMode } from './registry';
import { roomGeometry, shapeFits, type RoomGeometry } from './shapes';

export interface PlacedRoom {
  node: number;
  rect: Structure;
  shape: RoomShape;
  features: RoomFeature[];
  facing: 0 | 1 | 2 | 3;
  geometry: RoomGeometry;
  natural: boolean;
  anchored: boolean;
}

export interface EmbedRequest {
  graph: ComplexGraph;
  archetype: ComplexArchetype;
  geometry: GeometryMode;
  W: number;
  H: number;
  seed: number;
  up?: Point;
  down?: Point;
  /** Масштаб залов: под площадь карты и число залов. */
  scale: number;
}

const rectGap = (a: Structure, b: Structure) => Math.max(
  Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)),
  Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)),
);

function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const value of parts) { h ^= value | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}

function weighted<T>(rng: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, w] of options) { roll -= w; if (roll < 0) return value; }
  return options[options.length - 1][0];
}

/** Веса форм по режиму геометрии: прямоугольная, разнообразная, органическая. */
function shapeWeights(base: [RoomShape, number][], mode: GeometryMode, natural: boolean): [RoomShape, number][] {
  if (natural) return [['organic', 1]];
  return base.map(([shape, w]): [RoomShape, number] => {
    if (mode === 'regular') return [shape, w * (shape === 'rect' || shape === 'square' ? 3 : shape === 'composite' || shape === 'partitioned' || shape === 'niched' ? .7 : .15)];
    if (mode === 'organic') return [shape, w * (shape === 'irregular' || shape === 'circle' || shape === 'oval' || shape === 'hexagon' ? 2.5 : shape === 'rect' || shape === 'square' ? .35 : 1)];
    return [shape, w];
  }).concat(mode === 'organic' ? [['irregular', 1.5] as [RoomShape, number]] : []);
}

export function embedGraph(req: EmbedRequest): { rooms: PlacedRoom[]; dropped: number[] } {
  const { graph, W, H, archetype } = req;
  const rng = mulberry32(mix(req.seed, 0xe3b));
  // Поворот композиции: отражения и транспонирование нормированных точек.
  let transform = Math.floor(rng() * 8);
  const apply = (t: number, p: { x: number; y: number }) => {
    let { x, y } = p;
    if (t & 4) [x, y] = [y, x];
    if (t & 1) x = 1 - x;
    if (t & 2) y = 1 - y;
    return { x, y };
  };
  // Вход с верхнего уровня: берём поворот, при котором опора входа ближе к лестнице.
  const entrySlot = graph.nodes[graph.entry].slot;
  if (req.up && entrySlot) {
    let best = Infinity;
    for (let t = 0; t < 8; t += 1) {
      const p = apply(t, entrySlot);
      const d = Math.hypot(p.x * W - req.up.x, p.y * H - req.up.y) + (t === transform ? -.01 : 0);
      if (d < best) { best = d; transform = t; }
    }
  }
  const target = (id: number): Point | undefined => {
    const slot = graph.nodes[id].slot;
    if (!slot) return undefined;
    const p = apply(transform, slot);
    return { x: Math.round(p.x * W), y: Math.round(p.y * H) };
  };

  const placed: PlacedRoom[] = [];
  const byNode = new Map<number, PlacedRoom>();
  const dropped: number[] = [];
  const valid = (r: Structure) => r.x >= 2 && r.y >= 2 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2 && placed.every((o) => rectGap(r, o.rect) >= 3);
  const centre = (r: Structure) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  // Порядок: якоря, главный зал, узлы, финал, затем по глубине остова.
  const order = graph.nodes.map((n) => n.id).sort((a, b) => {
    const pa = prio(graph, a, req), pb = prio(graph, b, req);
    return pa - pb || graph.nodes[a].depth - graph.nodes[b].depth || a - b;
  });
  for (const id of order) {
    const node = graph.nodes[id];
    const spec = PURPOSES[node.purpose];
    const natural = node.tier === 'natural' || spec.natural === true || (archetype.natural >= .95 && node.tier !== 'hidden');
    const nodeRng = mulberry32(mix(req.seed, id, 0x51e));
    let rect: Structure | undefined;
    const anchor = node.tier === 'entry' && req.up ? req.up : node.tier === 'landing' ? req.down : undefined;
    if (anchor) {
      const fixed = { x: anchor.x - 3, y: anchor.y - 3, w: 6, h: 6, ruin: false };
      if (valid(fixed)) rect = fixed;
    }
    if (!rect) {
      const grow = node.tier === 'main' ? 1.25 : node.tier === 'hub' || node.tier === 'final' ? 1.08 : node.tier === 'service' ? .85 : 1;
      const span = (range: [number, number]) => {
        // Предел — доля меньшей стороны карты: главный зал крупный, но не поглощает план.
        const cap = Math.max(5, Math.round(Math.min(W, H) * .36));
        const lo = Math.min(cap, Math.max(3, Math.round(range[0] * req.scale * grow))), hi = Math.min(cap, Math.max(lo, Math.round(range[1] * req.scale * grow)));
        return lo + Math.floor(nodeRng() * (hi - lo + 1));
      };
      let w = span(spec.w), h = span(spec.h);
      // Длинные залы вдоль оси «вход — зал»: тронный зал вытянут к входу.
      if (node.tier !== 'entry' && node.tier !== 'landing' && nodeRng() < .5) [w, h] = [h, w];
      if (spec.shapes.every(([s]) => s === 'square')) h = w;
      const parent = node.parent >= 0 ? byNode.get(node.parent) : undefined;
      let goal = target(id);
      if (!goal && parent) {
        // Без опорной точки: рядом с родителем, в сторону от входа (или от «деда»).
        const pc = centre(parent.rect);
        const grand = graph.nodes[node.parent].parent >= 0 ? byNode.get(graph.nodes[node.parent].parent) : byNode.get(graph.entry);
        const away = grand && grand !== parent ? Math.atan2(pc.y - centre(grand.rect).y, pc.x - centre(grand.rect).x) : nodeRng() * Math.PI * 2;
        const angle = away + (nodeRng() - .5) * 2.2;
        const dist = (Math.max(parent.rect.w, parent.rect.h) + Math.max(w, h)) / 2 + 4 + nodeRng() * 3;
        goal = { x: Math.round(pc.x + Math.cos(angle) * dist), y: Math.round(pc.y + Math.sin(angle) * dist) };
      }
      goal ??= { x: Math.round(W / 2), y: Math.round(H / 2) };
      for (let attempt = 0; attempt < 6 && !rect; attempt += 1) {
        let best: Structure | undefined, bestScore = Infinity;
        for (let k = 0; k < 90; k += 1) {
          const radius = 1 + k * .45;
          const angle = nodeRng() * Math.PI * 2;
          const cx = goal.x + Math.cos(angle) * radius * nodeRng(), cy = goal.y + Math.sin(angle) * radius * nodeRng();
          const r: Structure = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, ruin: false };
          if (!valid(r)) continue;
          const c = centre(r);
          let score = Math.hypot(c.x - goal.x, c.y - goal.y);
          if (parent) score += rectGap(r, parent.rect) * .35;
          if (score < bestScore) { bestScore = score; best = r; }
        }
        rect = best;
        if (!rect) { if (attempt % 2 === 0) w = Math.max(3, w - 1); else h = Math.max(3, h - 1); }
      }
      // Тесная карта: полный перебор позиций, ближайшая к замыслу свободная рамка.
      for (let shrink = 0; shrink < 3 && !rect; shrink += 1) {
        const tw = Math.max(3, w - shrink), th = Math.max(3, h - shrink);
        let bestScore = Infinity;
        for (let y = 2; y + th <= H - 2; y += 1) for (let x = 2; x + tw <= W - 2; x += 1) {
          const r: Structure = { x, y, w: tw, h: th, ruin: false };
          const score = Math.hypot(x + tw / 2 - goal.x, y + th / 2 - goal.y);
          if (score < bestScore && valid(r)) { bestScore = score; rect = r; }
        }
      }
    }
    if (!rect) { dropped.push(id); continue; }
    // Лицом ко входу: сторона рамки, обращённая к залу входа (для входа — к центру).
    const entryRoom = byNode.get(graph.entry);
    const c = centre(rect);
    const toward = entryRoom && entryRoom.node !== id ? centre(entryRoom.rect) : { x: W / 2, y: H / 2 };
    const dx = toward.x - c.x, dy = toward.y - c.y;
    const facing: 0 | 1 | 2 | 3 = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3);
    let shape = weighted(nodeRng, shapeWeights(spec.shapes, req.geometry, natural));
    if (!shapeFits(shape, rect.w, rect.h)) shape = natural ? 'organic' : rect.w === rect.h ? 'square' : 'rect';
    if (shape === 'organic' && Math.min(rect.w, rect.h) < 5) shape = 'rect';
    if (shape === 'square' && rect.w !== rect.h) shape = 'rect';
    const features: RoomFeature[] = [];
    for (const [feature, chance] of spec.features) {
      const exclusive = (f: RoomFeature) => f === 'rotunda' || f === 'pool' || f === 'pillars';
      if (exclusive(feature) && features.some(exclusive)) continue;
      if (nodeRng() < chance) features.push(feature);
    }
    if (archetype.water === 'none') { const i = features.indexOf('pool'); if (i >= 0 && node.purpose !== 'collector' && node.purpose !== 'cistern') features.splice(i, 1); }
    if (anchor) {
      // Лестничный зал: форма простая, колонн и купели нет.
      if (shape !== 'organic' && shape !== 'octagon') shape = 'square';
      features.length = 0;
    }
    const geometry = roomGeometry({ shape, features, w: rect.w, h: rect.h, facing, seed: req.seed, origin: rect, rng: nodeRng });
    if (anchor) {
      // Клетки лестницы (2×2 к северо-западу от центра) и путь к центру — всегда пол:
      // связь уровней совпадает клетка в клетку при любой форме зала.
      for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) geometry.mask[y][x] = true;
      const keep = (p: Point) => p.x < 1 || p.x > 3 || p.y < 1 || p.y > 3;
      geometry.pillars = geometry.pillars.filter(keep);
      geometry.water = geometry.water.filter(keep);
      geometry.deep = geometry.deep.filter(keep);
    }
    const room: PlacedRoom = { node: id, rect, shape, features, facing, geometry, natural, anchored: Boolean(anchor) };
    placed.push(room);
    byNode.set(id, room);
  }
  return { rooms: placed, dropped };
}

function prio(graph: ComplexGraph, id: number, req: EmbedRequest): number {
  const tier = graph.nodes[id].tier;
  if (tier === 'entry' && req.up) return 0;
  if (tier === 'landing') return 1;
  if (tier === 'entry') return 2;
  if (tier === 'main') return 3;
  if (tier === 'hub' || tier === 'transit') return 4;
  if (tier === 'final') return 5;
  if (graph.nodes[id].slot) return 6;
  if (tier === 'hidden') return 9;
  return 7;
}
