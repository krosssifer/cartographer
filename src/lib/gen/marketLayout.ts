/**
 * Планировщик рыночной площади: строит модель рынка, ничего не рисует.
 *
 * Конвейер (каждый шаг читает только результат предыдущих):
 *   1. chooseMarketSite — место: ровно, сухо, не у воды (кроме порта), ближе к
 *      центру/перекрёстку/набережной; размер — по архетипу и карте;
 *   2. контур площади — прямоугольник, скруглённый или неровное пятно;
 *   3. центр — колодец, фонтан, доска, дерево или свободная площадка + зона
 *      свободного пространства вокруг;
 *   4. входы — там, где улицы поселения действительно входят на площадь;
 *      недостающие пробиваются только к кольцевой улице;
 *   5. проходы — ДО прилавков: подходы от входов к центру, ряды/кольцо/тропы
 *      по схеме, поперечные проходы, место разгрузки, карманы;
 *   6. торговые зоны — секторы «еда / ремесло / особое / служебное» от
 *      служебной стороны (вода, въезд, край);
 *   7. торговые места — кластеры «прилавок + навес + запас + тачка» вдоль
 *      фронта проходов, по рядам, с разрывами для прохода;
 *   8. декор — скамьи у центра, доска объявлений, место отдыха, сено, мелочь;
 *   9. проверка связности (недоступные места убираются) и отчёт.
 *
 * Насыщенность не меняет скелет: все места и предметы считаются для полной
 * насыщенности, у каждого есть порог; при меньшей насыщенности берутся только
 * предметы с порогом не выше неё. Поэтому набор при 0.3 — подмножество набора
 * при 0.9, а центр, проходы и главные прилавки одинаковы.
 *
 * Случайность — только детерминированные потоки mulberry32 от (seed, ключи
 * места): у каждого ряда и каждого места свой поток.
 */
import { mulberry32 } from '../random';
import { CIVIC_KIT } from '../settlementKit';
import type { Cell, ChestRotation, CivicKind, CivicObject, MarketStyle, Point, Selection, Terrain, Tree } from '../types';
import {
  COVERED_TENTS,
  MARKET_GENERATOR_VERSION,
  MARKET_SPECIALITIES,
  PAVILIONS,
  resolveMarketArchetype,
  type MarketArchetypeDef,
  type MarketArchetypeId,
  type MarketCentreKind,
  type MarketLayoutStyle,
  type MarketContext,
  type MarketResolution,
  type MarketSpecialityId,
  type MarketStructure,
  type MarketZoneKind,
} from './marketArchetypes';

/** Сторона: 0 — север (y−), 1 — восток (x+), 2 — юг (y+), 3 — запад (x−). */
export type Side = 0 | 1 | 2 | 3;
const DIRS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const N4 = DIRS;

/** Коды клеток проходов. */
export const LANE = { none: 0, main: 1, side: 2, cross: 3, ring: 4, unload: 5, centre: 6, open: 7, entry: 8, pocket: 9 } as const;
export type LaneCode = (typeof LANE)[keyof typeof LANE];
/** Насколько проход хорош как торговый фронт (выше — раньше заполняется). */
const FRONT_VALUE: Record<number, number> = { 1: 3, 2: 2, 3: 1.2, 4: 2.4, 5: 1.4, 6: 1.7, 7: 2.2, 8: 1.8, 9: 1.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wet = (t: Terrain) => t === 'water' || t === 'deepWater' || t === 'bridge';

function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}
/** Независимый поток случайных чисел для одного места/ряда. */
const stream = (seed: number, ...keys: number[]) => mulberry32(mix(seed, 0x6d61726b, ...keys));
const unit = (seed: number, ...keys: number[]) => mix(seed, 0x6d61726b, ...keys) / 4294967296;
function weighted<T>(options: readonly (readonly [T, number])[], roll: number): T {
  const usable = options.filter(([, w]) => w > 0);
  const total = usable.reduce((s, [, w]) => s + w, 0);
  let value = roll * total;
  for (const [option, w] of usable) { value -= w; if (value < 0) return option; }
  return usable[usable.length - 1][0];
}
const pickOf = <T>(items: readonly T[], roll: number): T => items[Math.min(items.length - 1, Math.floor(roll * items.length))];

// ---------------------------------------------------------------------------
// Входные данные
// ---------------------------------------------------------------------------

export interface MarketTerrain {
  width: number;
  height: number;
  cells: Cell[][];
  /** Клетка занята планировщиком поселения (стена, цитадель, таверна, крыльцо…). */
  blocked: (x: number, y: number) => boolean;
}

export interface MarketSiteRequest extends MarketTerrain {
  seed: number;
  archetype: MarketArchetypeDef;
  /** Желаемое место: центр поселения / перекрёсток. */
  anchor: Point;
  /** Множитель размера (малая площадь типа поселения — меньше 1). */
  scale?: number;
}

export interface MarketSite {
  bounds: Selection;
  /** Сторона площади, обращённая к воде (порт). */
  shore?: Side;
  /** Перепад высот внутри площади (0…1). */
  slope: number;
  notes: string[];
}

export interface MarketPlanRequest extends MarketTerrain {
  seed: number;
  resolution: MarketResolution;
  style: MarketStyle;
  richness: number;
  town: boolean;
  bounds: Selection;
  shore?: Side;
  /** Клетки улиц поселения (1 — улица) после прокладки сети. */
  streets: Uint8Array;
  /** Осевые линии улиц поселения (без кольцевой вокруг площади). */
  lanes: readonly { points: readonly Point[]; width: number }[];
  /** Вокруг площади проложена кольцевая улица. */
  ring: boolean;
}

// ---------------------------------------------------------------------------
// Модель рынка
// ---------------------------------------------------------------------------

export type MarketItemRole = 'centre' | 'main' | 'shade' | 'stock' | 'cart' | 'decor' | 'seat';

export interface MarketItem extends CivicObject {
  role: MarketItemRole;
  /** Индекс торгового места или −1 для центра/декора. */
  cluster: number;
  /** Порог насыщенности: предмет есть, если насыщенность ≥ порога. */
  threshold: number;
}

export interface MarketEntrance extends Point {
  side: Side;
  width: number;
  main: boolean;
  /** Клетка улицы за пределами площади, к которой примыкает вход. */
  street: Point;
  /** Вход пробит к кольцевой улице (а не продолжает улицу поселения). */
  ring: boolean;
}

export interface MarketCluster {
  id: number;
  speciality: MarketSpecialityId;
  zone: MarketZoneKind;
  structure: MarketStructure | 'special';
  rect: Selection;
  /** Сторона, где проход (лицо торгового места). */
  facing: Side;
  /** Клетки прохода перед местом. */
  front: Point[];
  skeleton: boolean;
  threshold: number;
}

export interface MarketZone { kind: MarketZoneKind; cells: number; x: number; y: number }

export interface MarketPlan {
  version: number;
  archetype: MarketArchetypeId;
  label: string;
  requested?: MarketArchetypeId;
  chain: MarketArchetypeId[];
  reason: string;
  layout: MarketLayoutStyle;
  surface: MarketArchetypeDef['surface'];
  bounds: Selection;
  shore?: Side;
  width: number;
  height: number;
  /** Маска площади (1 — клетка рынка), размер width × height. */
  area: Uint8Array;
  /** Коды проходов (LANE), размер width × height. */
  lanes: Uint8Array;
  /** Сектор торговой зоны для клетки (индекс в zones, −1 вне рынка). */
  zoneOf: Int8Array;
  centre: { kind: MarketCentreKind; rect: Selection; clear: Selection };
  entrances: MarketEntrance[];
  zones: MarketZone[];
  clusters: MarketCluster[];
  /** Все предметы при полной насыщенности (с порогами). */
  allItems: MarketItem[];
  /** Предметы при заданной насыщенности. */
  items: MarketItem[];
  trees: Tree[];
  /** Осевые линии проходов (для гладких троп на грунте). */
  paths: { points: Point[]; width: number }[];
  richness: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// 1. Выбор места
// ---------------------------------------------------------------------------

function waterDistance(t: MarketTerrain): Uint16Array {
  const { width: W, height: H, cells } = t;
  const dist = new Uint16Array(W * H).fill(999);
  const queue: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const terrain = cells[y][x].terrain;
    if (terrain === 'water' || terrain === 'deepWater') { dist[y * W + x] = 0; queue.push(y * W + x); }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i], x = c % W, y = (c - x) / W;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (dist[n] <= dist[c] + 1) continue;
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
  return dist;
}

const usableCell = (t: MarketTerrain, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return false;
  const terrain = t.cells[y][x].terrain;
  return !wet(terrain) && terrain !== 'rock' && terrain !== 'wall' && !t.blocked(x, y);
};

/** Ближайшая к точке сторона, где есть вода (в пределах `reach` клеток), или undefined. */
function shoreSideOf(t: MarketTerrain, toWater: Uint16Array, p: Point, reach: number): Side | undefined {
  let best: Side | undefined, bestDist = reach + 1;
  for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
    const [dx, dy] = DIRS[side];
    for (let k = 1; k <= reach; k++) {
      const x = Math.round(p.x + dx * k), y = Math.round(p.y + dy * k);
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) break;
      if (toWater[y * t.width + x] === 0) { if (k < bestDist) { bestDist = k; best = side; } break; }
    }
  }
  return best;
}

/**
 * Место под рынок: перебор прямоугольников нужного размера по карте. Отсекаются
 * вода, скалы, стены, занятые клетки и крутые склоны; штрафуются расстояние от
 * желаемой точки, перепад высот и сырая низина у воды. Порт ищет место в 2–4
 * клетках от воды. Если площадь не помещается, размер уменьшается.
 */
export function chooseMarketSite(req: MarketSiteRequest): MarketSite | undefined {
  const { width: W, height: H, cells, archetype: a } = req;
  const toWater = waterDistance(req);
  const scale = req.scale ?? 1;
  let tw = clamp(Math.round(W * a.size.share[0] * scale), a.size.w[0], a.size.w[1]);
  let th = clamp(Math.round(H * a.size.share[1] * scale), a.size.h[0], a.size.h[1]);
  tw = Math.min(tw, Math.floor(W * .45));
  th = Math.min(th, Math.floor(H * .5));
  const port = a.service === 'water';
  const anchorShore = port ? shoreSideOf(req, toWater, req.anchor, Math.max(W, H)) : undefined;
  // Порт вытянут вдоль берега.
  if (anchorShore !== undefined && (anchorShore % 2 === 1) === (tw > th)) [tw, th] = [th, tw];
  const notes: string[] = [];
  for (let shrink = 0; shrink <= 5; shrink++) {
    const w = tw - shrink, h = th - Math.round(shrink * .7);
    if (w < 7 || h < 6) break;
    let best: { rect: Selection; score: number; slope: number; minWater: number } | undefined;
    for (let y = 1; y + h <= H - 1; y++) for (let x = 1; x + w <= W - 1; x++) {
      let ok = true, lo = 1, hi = 0, flood = 0, minWater = 999;
      for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w; xx++) {
        if (!usableCell(req, xx, yy)) { ok = false; break; }
        const c = cells[yy][xx], d = toWater[yy * W + xx];
        lo = Math.min(lo, c.height); hi = Math.max(hi, c.height);
        if (d < minWater) minWater = d;
        // Порту сырость у самой воды привычна; сырой низиной считаем только береговую кромку.
        if (c.moisture > .68 && d < (port ? 3 : 6)) flood++;
      }
      if (!ok || minWater < 2 || hi - lo > .3) continue;
      const cx = x + w / 2, cy = y + h / 2;
      let score = Math.hypot(cx - req.anchor.x, cy - req.anchor.y) * .35 + (hi - lo) * 9 + flood * .25 + unit(req.seed, 11, x, y) * .6;
      if (port) score += minWater > 6 ? 60 : Math.abs(minWater - 2.5) * 4;
      if (!best || score < best.score) best = { rect: { x, y, w, h }, score, slope: hi - lo, minWater };
    }
    if (best) {
      if (shrink) notes.push(`площадь уменьшена до ${best.rect.w}×${best.rect.h}: не хватило ровного сухого места`);
      const centre = { x: best.rect.x + best.rect.w / 2, y: best.rect.y + best.rect.h / 2 };
      const shore = port ? shoreSideOf(req, toWater, centre, Math.max(best.rect.w, best.rect.h) / 2 + 6) : undefined;
      if (port && shore === undefined) notes.push('вода далеко: портовый рынок без набережной');
      return { bounds: best.rect, shore, slope: best.slope, notes };
    }
  }
  return undefined;
}

/**
 * Архетип и место вместе: если портовому рынку не нашлось берега (вода есть на
 * карте, но далеко от застройки), архетип переразрешается как «без воды» —
 * по обычной цепочке fallback — и место ищется заново.
 */
export function resolveMarketSite(setting: unknown, ctx: MarketContext, req: Omit<MarketSiteRequest, 'archetype' | 'seed'>): { resolution: MarketResolution; site?: MarketSite } {
  let resolution = resolveMarketArchetype(setting, ctx);
  let site = chooseMarketSite({ ...req, seed: ctx.seed, archetype: resolution.archetype });
  if (site && resolution.archetype.needsWater && site.shore === undefined && ctx.water !== 'none') {
    const dry = resolveMarketArchetype(setting, { ...ctx, water: 'none' });
    const drySite = chooseMarketSite({ ...req, seed: ctx.seed, archetype: dry.archetype });
    if (drySite) {
      resolution = { ...dry, reason: `${dry.reason}; у воды нет ровного места` };
      site = drySite;
    }
  }
  return { resolution, site };
}

// ---------------------------------------------------------------------------
// 2–9. План рынка
// ---------------------------------------------------------------------------

interface Part { kind: CivicKind; u: number; v: number; w: number; d: number; role: MarketItemRole; t: number }
interface Template { w: number; d: number; parts: Part[]; structure: MarketStructure | 'special' }

const MAX_SPEC: Partial<Record<MarketSpecialityId, number>> = { rest: 2, show: 4, livestock: 2, unload: 3, caravan: 8, storage: 4 };
const WAGON_FOOD: readonly MarketSpecialityId[] = ['produce', 'fruit', 'grain', 'fish', 'cheese'];

/** Варианты состава торгового места по убыванию размера: подходит первый, что влезает. */
function templatesFor(spec: MarketSpecialityId, structure: MarketStructure, rng: () => number): Template[] {
  const s = MARKET_SPECIALITIES[spec];
  const p = (kind: CivicKind, u: number, v: number, role: MarketItemRole, t: number): Part => ({ kind, u, v, w: CIVIC_KIT[kind].w, d: CIVIC_KIT[kind].h, role, t });
  const any22 = (): CivicKind => pickOf<CivicKind>(s.stock22.length ? s.stock22 : ['marketCrates'], rng());
  const any21 = (): CivicKind => pickOf<CivicKind>(s.stock21.length ? s.stock21 : ['marketBarrelPair'], rng());
  const any11 = (): CivicKind => pickOf<CivicKind>(s.stock11.length ? s.stock11 : ['marketBarrelLying'], rng());
  switch (s.template) {
    case 'storage': return [
      { w: 4, d: 3, structure: 'special', parts: [p(any22(), 0, 0, 'main', 0), p(any22(), 2, 0, 'stock', .3), p(any21(), 0, 2, 'stock', .55), p(any11(), 2, 2, 'stock', .75)] },
      { w: 4, d: 2, structure: 'special', parts: [p(any22(), 0, 0, 'main', 0), p(any22(), 2, 0, 'stock', .35)] },
      { w: 2, d: 2, structure: 'special', parts: [p(any22(), 0, 0, 'main', 0)] },
    ];
    case 'livestock': return [
      { w: 4, d: 3, structure: 'special', parts: [p('marketFence', 0, 0, 'main', 0), p('marketFence', 2, 0, 'stock', .2), p('marketHayLarge', 0, 1, 'stock', .3), p('marketHay', 2, 1, 'stock', .6)] },
      { w: 2, d: 3, structure: 'special', parts: [p('marketFence', 0, 0, 'main', 0), p('marketHayLarge', 0, 1, 'stock', .35)] },
    ];
    case 'rest': return [
      { w: 5, d: 3, structure: 'special', parts: [p(rng() > .5 ? 'marketTableSet' : 'marketTable', 0, 0, 'main', 0), p('marketBench', 0, 2, 'seat', .35), p('marketBarrelPair', 3, 0, 'stock', .5), p('marketBarrelLying', 3, 1, 'stock', .75)] },
      { w: 3, d: 3, structure: 'special', parts: [p('marketTableSet', 0, 0, 'main', 0), p('marketBench', 0, 2, 'seat', .4)] },
      { w: 3, d: 2, structure: 'special', parts: [p('marketTableSet', 0, 0, 'main', 0)] },
    ];
    case 'unload': return [
      { w: 5, d: 2, structure: 'special', parts: [p('marketWagon', 0, 0, 'cart', 0), p(any22(), 3, 0, 'stock', .3)] },
      { w: 4, d: 3, structure: 'special', parts: [p('marketWagon', 0, 0, 'cart', 0), p(any11(), 3, 0, 'stock', .4), p(any21(), 0, 2, 'stock', .55)] },
      { w: 3, d: 2, structure: 'special', parts: [p('marketWagon', 0, 0, 'cart', 0)] },
      { w: 2, d: 2, structure: 'special', parts: [p(any22(), 0, 0, 'main', 0)] },
    ];
    case 'caravan': {
      const tent = pickOf(['marketTentBrown', 'marketTentBurlap', 'marketTentPatch'] as CivicKind[], rng());
      return [
        { w: 5, d: 3, structure: 'wagon', parts: [p('marketWagonCovered', 0, 0, 'cart', 0), p(tent, 3, 0, 'shade', 0), p(any21(), 0, 2, 'stock', .3), p(any11(), 2, 2, 'stock', .5), p(any11(), 3, 2, 'stock', .8)] },
        { w: 5, d: 2, structure: 'wagon', parts: [p('marketWagonCovered', 0, 0, 'cart', 0), p(tent, 3, 0, 'shade', 0)] },
        { w: 4, d: 3, structure: 'wagon', parts: [p('marketWagonCovered', 0, 0, 'cart', 0), p(any11(), 3, 0, 'stock', .35), p(any22(), 0, 2, 'stock', .9)].filter((part) => part.v + part.d <= 3) },
        { w: 3, d: 2, structure: 'wagon', parts: [p('marketWagonCovered', 0, 0, 'cart', 0)] },
        { w: 2, d: 2, structure: 'covered', parts: [p(tent, 0, 0, 'main', 0)] },
      ];
    }
    case 'pavilion': {
      const tent = pickOf(PAVILIONS, rng());
      return [
        { w: 3, d: 3, structure: 'pavilion', parts: [p(tent, 0, 0, 'main', 0), p(any11(), 2, 0, 'stock', .4), p(any21(), 0, 2, 'seat', .6)] },
        { w: 3, d: 2, structure: 'pavilion', parts: [p(tent, 0, 0, 'main', 0), p(any11(), 2, 1, 'stock', .45)] },
        { w: 2, d: 2, structure: 'pavilion', parts: [p(tent, 0, 0, 'main', 0)] },
      ];
    }
    default: break;
  }
  const stall = pickOf(s.stalls, rng());
  const cover = pickOf(COVERED_TENTS, rng());
  const plain: Template[] = [
    { w: 3, d: 3, structure: 'stall', parts: [p(stall, 0, 0, 'main', 0), p(any21(), 0, 2, 'stock', .25), p(any11(), 2, 0, 'stock', .45), p(any11(), 2, 2, 'stock', .75)] },
    { w: 2, d: 3, structure: 'stall', parts: [p(stall, 0, 0, 'main', 0), p(any21(), 0, 2, 'stock', .3)] },
    { w: 3, d: 2, structure: 'stall', parts: [p(stall, 0, 0, 'main', 0), p(any11(), 2, 0, 'stock', .4), p(any11(), 2, 1, 'stock', .7)] },
    { w: 2, d: 2, structure: 'stall', parts: [p(stall, 0, 0, 'main', 0)] },
  ];
  if (structure === 'shade') return [
    { w: 4, d: 3, structure: 'shade', parts: [p(stall, 0, 0, 'main', 0), p(cover, 2, 0, 'shade', 0), p(any21(), 0, 2, 'stock', .3), p(any21(), 2, 2, 'stock', .6)] },
    { w: 4, d: 2, structure: 'shade', parts: [p(stall, 0, 0, 'main', 0), p(cover, 2, 0, 'shade', 0)] },
    ...plain,
  ];
  if (structure === 'covered') return [
    { w: 3, d: 3, structure: 'covered', parts: [p(cover, 0, 0, 'main', 0), p(any21(), 0, 2, 'stock', .3), p(any11(), 2, 0, 'stock', .45)] },
    { w: 2, d: 3, structure: 'covered', parts: [p(cover, 0, 0, 'main', 0), p(any21(), 0, 2, 'stock', .35)] },
    { w: 3, d: 2, structure: 'covered', parts: [p(cover, 0, 0, 'main', 0), p(any11(), 2, 0, 'stock', .45)] },
    { w: 2, d: 2, structure: 'covered', parts: [p(cover, 0, 0, 'main', 0)] },
  ];
  if (structure === 'pavilion') {
    const tent = pickOf(PAVILIONS, rng());
    return [
      { w: 3, d: 2, structure: 'pavilion', parts: [p(tent, 0, 0, 'main', 0), p(any11(), 2, 0, 'stock', .4)] },
      { w: 2, d: 2, structure: 'pavilion', parts: [p(tent, 0, 0, 'main', 0)] },
    ];
  }
  if (structure === 'wagon' && WAGON_FOOD.includes(spec)) return [
    { w: 4, d: 3, structure: 'wagon', parts: [p('marketWagon', 0, 0, 'cart', 0), p(any21(), 0, 2, 'stock', .3), p(any11(), 3, 0, 'stock', .5)] },
    { w: 3, d: 2, structure: 'wagon', parts: [p('marketWagon', 0, 0, 'cart', 0)] },
    ...plain,
  ];
  return plain;
}

/**
 * Поворот спрайта так, чтобы лицевая сторона торгового места смотрела на проход.
 * Рендер городских объектов (settlementPaint.civic) рисует спрайт с постоянной
 * «внешностью» spriteLook(7.3, 2.9, 47), у которой flipY = true: при 0° низ
 * картинки (лицо прилавка) смотрит на север. Поэтому юг — 180°, север — 0°.
 * Тест market.test.ts сторожит это допущение.
 */
export const FACING_ROTATION: Record<Side, ChestRotation> = { 0: 0, 1: 90, 2: 180, 3: 270 };

/** 4-связная цифровая линия между двумя клетками. */
function path4(a: Point, b: Point): Point[] {
  const out: Point[] = [{ x: a.x, y: a.y }];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  while (x !== b.x || y !== b.y) {
    const px = dx ? (Math.abs(x - a.x) + .5) / dx : Infinity, py = dy ? (Math.abs(y - a.y) + .5) / dy : Infinity;
    if (px <= py) x += sx; else y += sy;
    out.push({ x, y });
  }
  return out;
}

export function planMarket(req: MarketPlanRequest): MarketPlan {
  const { width: W, height: H, seed, bounds: B } = req;
  const a = req.resolution.archetype;
  const notes: string[] = [];
  const id = (x: number, y: number) => y * W + x;
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // ---- 2. Контур ------------------------------------------------------------
  const area = new Uint8Array(W * H);
  {
    const shapeRng = stream(seed, 21);
    const ph1 = shapeRng() * Math.PI * 2, ph2 = shapeRng() * Math.PI * 2, amp = .07 + a.irregular * .08;
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
      if (!usableCell(req, x, y)) continue;
      let inside = true;
      if (a.shape === 'rounded') {
        const r = 2.2, ex = Math.max(0, Math.abs(x + .5 - cx) - (B.w / 2 - r)), ey = Math.max(0, Math.abs(y + .5 - cy) - (B.h / 2 - r));
        inside = Math.hypot(ex, ey) <= r;
      } else if (a.shape === 'blob') {
        const nx = (x + .5 - cx) / (B.w / 2), ny = (y + .5 - cy) / (B.h / 2);
        const ang = Math.atan2(ny, nx);
        const radius = 1 + amp * Math.sin(3 * ang + ph1) + amp * .7 * Math.sin(5 * ang + ph2);
        inside = (Math.abs(nx) ** 2.6 + Math.abs(ny) ** 2.6) ** (1 / 2.6) <= radius * .97;
      }
      if (inside) area[id(x, y)] = 1;
    }
    // Оставляем крупнейший связный кусок: вода/стена могли отрезать угол.
    const comp = new Int32Array(W * H).fill(-1);
    let best = -1, bestSize = 0, label = 0;
    for (let i = 0; i < W * H; i++) {
      if (!area[i] || comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = label;
      let size = 0;
      while (stack.length) {
        const c = stack.pop()!, x = c % W, y = (c - x) / W;
        size++;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (inMap(nx, ny) && area[id(nx, ny)] && comp[id(nx, ny)] < 0) { comp[id(nx, ny)] = label; stack.push(id(nx, ny)); }
        }
      }
      if (size > bestSize) { bestSize = size; best = label; }
      label++;
    }
    for (let i = 0; i < W * H; i++) if (area[i] && comp[i] !== best) area[i] = 0;
  }
  const inArea = (x: number, y: number) => inMap(x, y) && area[id(x, y)] === 1;

  // ---- Схема рядов --------------------------------------------------------------
  const crossSpan = Math.min(B.w, B.h);
  const rowsFit = crossSpan >= 2 * a.aisle.depth + a.aisle.side;
  const wanted: MarketLayoutStyle = req.style === 'auto' ? a.layouts[0] : req.style;
  let layout: MarketLayoutStyle = wanted;
  if (layout === 'rows' && !rowsFit) { layout = 'ring'; notes.push('ряды не помещаются: раскладка вокруг центра'); }
  if (layout === 'ring' && crossSpan < 7) { layout = 'fair'; notes.push('кольцо не помещается: вольная раскладка'); }

  // ---- 3. Центр ----------------------------------------------------------------
  let sx = 0, sy = 0, count = 0;
  for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) if (area[id(x, y)]) { sx += x + .5; sy += y + .5; count++; }
  let ccx = Math.round(sx / Math.max(1, count)), ccy = Math.round(sy / Math.max(1, count));
  if (req.shore !== undefined) { ccx -= DIRS[req.shore][0]; ccy -= DIRS[req.shore][1]; }
  const centreRng = stream(seed, 31);
  const centreOptions = a.centre.filter(([kind]) => (kind !== 'fountain' || req.town) && (kind !== 'tree' || a.surface !== 'square'));
  const small = crossSpan < 8;
  let centreKind: MarketCentreKind = weighted(centreOptions.length ? centreOptions : [['well', 1] as const], centreRng());
  if (small && centreKind === 'open') centreKind = 'well';
  if (small && centreKind === 'fountain') centreKind = 'well';
  const centreRect: Selection = { x: ccx - 1, y: ccy - 1, w: 2, h: 2 };
  // Сдвигаем центр внутрь, если угол 2×2 вылез за контур.
  for (let tries = 0; tries < 6; tries++) {
    const bad = [[0, 0], [1, 0], [0, 1], [1, 1]].find(([dx, dy]) => !inArea(centreRect.x + dx, centreRect.y + dy));
    if (!bad) break;
    centreRect.x += bad[0] ? -1 : 1;
    centreRect.y += bad[1] ? -1 : 1;
  }
  const openRadius = centreKind === 'open' ? clamp(Math.round(crossSpan * a.openShare), 1, 4) : 0;
  const clearance = centreKind === 'open' ? openRadius : a.aisle.main >= 2 && crossSpan >= (layout === 'rows' ? 15 : 9) ? 2 : 1;
  const clear: Selection = { x: centreRect.x - clearance, y: centreRect.y - clearance, w: 2 + clearance * 2, h: 2 + clearance * 2 };
  const ctr = { x: centreRect.x + 1, y: centreRect.y + 1 };

  // ---- 4. Входы -------------------------------------------------------------------
  const lane = new Uint8Array(W * H);
  const sideOf = (x: number, y: number): Side => {
    const d = [y - B.y, B.x + B.w - 1 - x, B.y + B.h - 1 - y, x - B.x];
    return d.indexOf(Math.min(...d)) as Side;
  };
  const entrances: MarketEntrance[] = [];
  /** Улицы, упершиеся в площадь рядом с уже найденным входом: их клетка соединяется с этим входом. */
  const merged: { cell: Point; to: MarketEntrance }[] = [];
  const pushEntrance = (cell: Point, outside: Point, width: number, main: boolean, ring: boolean) => {
    const near = entrances.find((e) => Math.abs(e.x - cell.x) + Math.abs(e.y - cell.y) < 4);
    if (near) { if (near.x !== cell.x || near.y !== cell.y) merged.push({ cell, to: near }); return; }
    entrances.push({ ...cell, side: sideOf(cell.x, cell.y), width, main, street: outside, ring });
  };
  const streetAt = (x: number, y: number) => inMap(x, y) && req.streets[id(x, y)] === 1 && !area[id(x, y)];
  for (const street of req.lanes) {
    const pts = street.points;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      for (const [from, to] of [[p, q], [q, p]] as const) {
        if (inArea(from.x, from.y) || !inArea(to.x, to.y)) continue;
        // Клетка улицы снаружи, примыкающая ко входу.
        const outside = streetAt(from.x, from.y) ? from : N4.map(([dx, dy]) => ({ x: to.x + dx, y: to.y + dy })).find((c) => streetAt(c.x, c.y));
        if (outside) pushEntrance({ x: to.x, y: to.y }, outside, street.width >= 2 ? a.aisle.main : a.aisle.side, street.width >= 2, false);
      }
    }
  }
  if (req.ring) {
    // Кольцевая улица — настоящая улица: недостающие входы ставим на середины свободных сторон.
    const order = ([0, 1, 2, 3] as Side[]).sort((p, q) => unit(seed, 41, p) - unit(seed, 41, q));
    for (const side of order) {
      if (entrances.length >= a.entrances[0]) break;
      if (entrances.some((e) => e.side === side)) continue;
      const along = side % 2 === 0 ? B.x + Math.floor(B.w / 2) : B.y + Math.floor(B.h / 2);
      const jitter = Math.round((unit(seed, 42, side) - .5) * 2 * a.irregular * 2);
      for (const shift of [jitter, 0, 1, -1, 2, -2]) {
        const pos = along + shift;
        const cell = side === 0 ? { x: pos, y: B.y } : side === 1 ? { x: B.x + B.w - 1, y: pos } : side === 2 ? { x: pos, y: B.y + B.h - 1 } : { x: B.x, y: pos };
        const out = { x: cell.x + DIRS[side][0], y: cell.y + DIRS[side][1] };
        if (inArea(cell.x, cell.y) && streetAt(out.x, out.y)) { pushEntrance(cell, out, a.aisle.side, false, true); break; }
      }
    }
  }
  if (!entrances.length) {
    // Нет ни одной улицы на площади: вход у ближайшей клетки улицы.
    let best: { cell: Point; out: Point; d: number } | undefined;
    for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
      if (!inArea(x, y)) continue;
      for (const [dx, dy] of N4) if (streetAt(x + dx, y + dy)) {
        const d = Math.hypot(x - ctr.x, y - ctr.y);
        if (!best || d < best.d) best = { cell: { x, y }, out: { x: x + dx, y: y + dy }, d };
      }
    }
    if (best) pushEntrance(best.cell, best.out, a.aisle.main, true, false);
    else notes.push('к площади не подходит ни одна улица');
  }
  if (entrances.length < a.entrances[0]) notes.push(`входов ${entrances.length} из желаемых ${a.entrances[0]}: улиц к площади меньше`);
  const mainEntrance = entrances.find((e) => e.main) ?? entrances[0];

  // ---- 5. Проходы ------------------------------------------------------------------
  const paths: MarketPlan['paths'] = [];
  const PRIORITY: Record<number, number> = { 0: 0, 3: 1, 2: 2, 5: 2, 9: 3, 4: 3, 7: 4, 6: 4, 1: 5, 8: 6 };
  const mark = (x: number, y: number, code: LaneCode) => {
    if (!inArea(x, y)) return;
    if (PRIORITY[code] >= PRIORITY[lane[id(x, y)]]) lane[id(x, y)] = code;
  };
  const stroke = (points: readonly Point[], width: number, code: LaneCode, record = false) => {
    const off = -Math.floor((width - 1) / 2);
    const cells: Point[] = [];
    for (let i = 1; i < points.length; i++) cells.push(...path4(points[i - 1], points[i]));
    if (points.length === 1) cells.push(points[0]);
    for (const c of cells) for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) mark(c.x + off + dx, c.y + off + dy, code);
    if (record && points.length >= 2) paths.push({ points: points.map((p) => ({ ...p })), width });
  };
  // Центр и его свободное кольцо.
  for (let y = clear.y; y < clear.y + clear.h; y++) for (let x = clear.x; x < clear.x + clear.w; x++) {
    if (centreKind === 'open') { if (Math.hypot(x + .5 - ctr.x, y + .5 - ctr.y) <= openRadius + 1.1) mark(x, y, LANE.open); }
    else mark(x, y, LANE.centre);
  }
  // Место разгрузки.
  if (a.service === 'water' && req.shore !== undefined) {
    // Полоса вдоль стороны воды: телеги и грузчики проходят вдоль всей набережной.
    const s = req.shore;
    for (let k = 0; k < 2; k++) {
      if (s % 2 === 0) { const y = s === 0 ? B.y + k : B.y + B.h - 1 - k; for (let x = B.x; x < B.x + B.w; x++) mark(x, y, LANE.unload); }
      else { const x = s === 3 ? B.x + k : B.x + B.w - 1 - k; for (let y = B.y; y < B.y + B.h; y++) mark(x, y, LANE.unload); }
    }
  } else if ((a.service === 'gate' || a.service === 'edge') && mainEntrance) {
    // Двор у въезда (караван) или место для телеги у входа (деревня, город).
    const e = a.service === 'gate' ? mainEntrance : entrances[Math.floor(unit(seed, 61) * entrances.length)];
    const [ix, iy] = DIRS[(e.side + 2) % 4];
    const along = e.side % 2 === 0 ? [1, 0] : [0, 1];
    const sign = unit(seed, 62) > .5 ? 1 : -1;
    const yardW = a.service === 'gate' ? 4 : 3, yardD = a.service === 'gate' ? 3 : 2;
    for (let u = 0; u < yardW; u++) for (let v = 0; v < yardD; v++) {
      const x = e.x + along[0] * sign * (u + e.width) + ix * v, y = e.y + along[1] * sign * (u + e.width) + iy * v;
      mark(x, y, LANE.unload);
    }
  }
  const depth = a.aisle.depth;
  const crossRng = stream(seed, 71);
  const horizontal = req.shore !== undefined ? req.shore % 2 === 0 : B.w >= B.h;
  /** Координаты «вдоль рядов» (a) и «поперёк» (c) внутри рамки. */
  const toWorld = (u: number, c: number): Point => horizontal ? { x: B.x + u, y: B.y + c } : { x: B.x + c, y: B.y + u };
  const A = horizontal ? B.w : B.h, C = horizontal ? B.h : B.w;
  if (layout === 'rows') {
    // Полосы: [край depth] проход [двойной ряд 2·depth] проход … [край depth].
    let c0 = 0, c1 = C;
    if (req.shore !== undefined) { if (req.shore === 0 || req.shore === 3) c0 += 2; else c1 -= 2; }
    const span = c1 - c0, aw = a.aisle.side;
    // Двойной ряд внутри — спина к спине; если глубины не хватает, места мельче (2 клетки).
    let inner = depth, k = Math.max(0, Math.floor((span - 2 * depth - aw) / (2 * inner + aw)));
    if (depth === 3 && Math.floor((span - 2 * depth - aw) / (2 * 2 + aw)) > k) { inner = 2; k = Math.floor((span - 2 * depth - aw) / (2 * inner + aw)); }
    let left = span - 2 * depth - (k + 1) * aw - k * 2 * inner;
    const aisleWidths = Array.from({ length: k + 1 }, () => aw);
    const middle = Math.floor(k / 2);
    const extra = Math.max(0, Math.min(left, a.aisle.main - aw));
    aisleWidths[middle] += extra; left -= extra;
    let c = c0 + depth + Math.floor(left / 2);
    const lines: number[] = [];
    for (let i = 0; i <= k; i++) {
      lines.push(c);
      const width = aisleWidths[i];
      // Излом: проход сдвигается на клетку в случайном месте — ряды не по линейке.
      const kink = a.irregular > .25 && crossRng() < a.irregular ? Math.round(A * (.3 + crossRng() * .4)) : -1;
      const shift = crossRng() > .5 ? 1 : -1;
      const pts: Point[] = kink > 0
        ? [toWorld(0, c), toWorld(kink, c), toWorld(kink, c + shift), toWorld(A - 1, c + shift)]
        : [toWorld(0, c), toWorld(A - 1, c)];
      stroke(pts, width, i === middle ? LANE.main : LANE.side);
      c += width + 2 * inner;
    }
    // Поперечные проходы: в каждом ряду свой шаг и сдвиг (в шахматном порядке).
    const cut = (u: number, from: number, dir: 1 | -1, toEdge: boolean) => {
      const cells: Point[] = [];
      for (let cc = from; cc >= 0 && cc < C; cc += dir) {
        const p = toWorld(u, cc);
        if (!inArea(p.x, p.y)) { if (toEdge && cells.length) { for (const q of cells) mark(q.x, q.y, LANE.cross); } return; }
        if (lane[id(p.x, p.y)] && cells.length) { for (const q of cells) mark(q.x, q.y, LANE.cross); return; }
        if (!lane[id(p.x, p.y)]) cells.push(p);
      }
      if (toEdge && cells.length) for (const q of cells) mark(q.x, q.y, LANE.cross);
    };
    const bands = [...lines.map((line) => line), c1];
    for (let i = 0; i < bands.length; i++) {
      const start = i === 0 ? c0 : lines[i - 1] + aisleWidths[i - 1];
      const step = () => a.aisle.cross[0] + Math.floor(crossRng() * (a.aisle.cross[1] - a.aisle.cross[0] + 1));
      const perimeter = i === 0 || i === bands.length - 1;
      if (perimeter && !req.ring) continue;
      for (let u = step(); u < A - 2; u += step() + 2) {
        if (i === 0) cut(u, lines[0] - 1, -1, true);
        else if (i === bands.length - 1) cut(u, lines[i - 1] + aisleWidths[i - 1], 1, true);
        else cut(u, start, 1, false);
      }
    }
  } else if (layout === 'ring') {
    // Кольцо вокруг центра; внутренний ряд смотрит наружу, внешний — внутрь.
    const inset = depth;
    const rx0 = Math.max(B.x + depth, clear.x - inset - 1), ry0 = Math.max(B.y + depth, clear.y - inset - 1);
    const rx1 = Math.min(B.x + B.w - 1 - depth, clear.x + clear.w + inset), ry1 = Math.min(B.y + B.h - 1 - depth, clear.y + clear.h + inset);
    if (rx1 - rx0 >= 3 && ry1 - ry0 >= 3) {
      const chamfer = a.irregular > .45 ? 1 : 0;
      const loop: Point[] = [
        { x: rx0 + chamfer, y: ry0 }, { x: rx1 - chamfer, y: ry0 }, { x: rx1, y: ry0 + chamfer }, { x: rx1, y: ry1 - chamfer },
        { x: rx1 - chamfer, y: ry1 }, { x: rx0 + chamfer, y: ry1 }, { x: rx0, y: ry1 - chamfer }, { x: rx0, y: ry0 + chamfer }, { x: rx0 + chamfer, y: ry0 },
      ];
      stroke(loop, a.aisle.side, LANE.ring, a.surface !== 'square');
      // Проходы через внутренний ряд к центру — по сторонам без подхода.
      for (const side of [0, 1, 2, 3] as Side[]) {
        const from = side === 0 ? { x: ctr.x, y: ry0 } : side === 1 ? { x: rx1, y: ctr.y } : side === 2 ? { x: ctr.x, y: ry1 } : { x: rx0, y: ctr.y };
        const to = { x: clamp(from.x, clear.x, clear.x + clear.w - 1), y: clamp(from.y, clear.y, clear.y + clear.h - 1) };
        if (crossRng() < .75) stroke([from, to], 1, LANE.cross);
      }
      // Внешний ряд: разрывы к краю, если вокруг улица.
      if (req.ring) for (const side of [0, 1, 2, 3] as Side[]) {
        const len = side % 2 === 0 ? rx1 - rx0 : ry1 - ry0;
        for (let u = 2 + Math.floor(crossRng() * 3); u < len - 1; u += a.aisle.cross[1] + 1 + Math.floor(crossRng() * 3)) {
          const p = side === 0 ? { x: rx0 + u, y: ry0 } : side === 1 ? { x: rx1, y: ry0 + u } : side === 2 ? { x: rx0 + u, y: ry1 } : { x: rx0, y: ry0 + u };
          const [dx, dy] = DIRS[side];
          const pts: Point[] = [];
          for (let k = 1; k < depth + 4; k++) {
            const q = { x: p.x + dx * k, y: p.y + dy * k };
            if (!inArea(q.x, q.y)) break;
            pts.push(q);
          }
          if (pts.length) stroke([pts[0], pts[pts.length - 1]], 1, LANE.cross);
        }
      }
    } else notes.push('кольцо проходов не поместилось');
  } else {
    // Ярмарка: прогулочная петля вокруг центральной площадки и отростки к краям.
    const rx = Math.min(B.w / 2 - depth - 1, clear.w / 2 + depth + .5), ry = Math.min(B.h / 2 - depth - 1, clear.h / 2 + depth + .5);
    if (rx >= clear.w / 2 + 1 && ry >= clear.h / 2 + 1) {
      const n = 7 + Math.floor(crossRng() * 3);
      const loop: Point[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i % n) / n * Math.PI * 2;
        const wobble = 1 + (unit(seed, 81, i % n) - .5) * .35 * a.irregular;
        loop.push({ x: Math.round(ctr.x + Math.cos(t) * rx * wobble), y: Math.round(ctr.y + Math.sin(t) * ry * wobble) });
      }
      stroke(loop, a.aisle.side, LANE.ring, true);
      // Отростки от петли к краю между входами.
      const spurs = Math.round(1 + crossRng() * 2);
      for (let s = 0; s < spurs; s++) {
        const t = crossRng() * Math.PI * 2;
        const from = { x: Math.round(ctr.x + Math.cos(t) * rx), y: Math.round(ctr.y + Math.sin(t) * ry) };
        const to = { x: Math.round(ctr.x + Math.cos(t) * (B.w / 2 - 1.5)), y: Math.round(ctr.y + Math.sin(t) * (B.h / 2 - 1.5)) };
        if (entrances.some((e) => Math.hypot(e.x - to.x, e.y - to.y) < 4)) continue;
        if (inArea(to.x, to.y)) stroke([from, to], 1, LANE.side, true);
      }
    }
  }
  // Карманы — маленькие открытые места среди рядов (базар).
  const pockets: Point[] = [];
  if (a.pockets) {
    const candidates: Point[] = [];
    for (let y = B.y + 2; y < B.y + B.h - 2; y++) for (let x = B.x + 2; x < B.x + B.w - 2; x++) {
      const code = lane[id(x, y)];
      if (code !== LANE.side && code !== LANE.cross) continue;
      if (Math.hypot(x - ctr.x, y - ctr.y) < clear.w) continue;
      candidates.push({ x, y });
    }
    const pocketRng = stream(seed, 91);
    for (let i = 0; i < a.pockets && candidates.length; i++) {
      const p = candidates[Math.floor(pocketRng() * candidates.length)];
      if (pockets.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 6)) continue;
      pockets.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(p.x + dx, p.y + dy, LANE.pocket);
    }
  }
  // Подходы: от каждого входа — к ближайшему проходу уже проложенной сети
  // (ряды, кольцо, петля или свободная зона центра). Так вход продолжает
  // проход, а не режет ряды лишней диагональю.
  const approachRng = stream(seed, 51);
  for (const e of entrances) {
    const [ix, iy] = DIRS[(e.side + 2) % 4];
    const depthIn = Math.min(2, Math.floor((e.side % 2 ? B.w : B.h) / 5));
    const inner = { x: e.x + ix * depthIn, y: e.y + iy * depthIn };
    let target: Point | undefined, bestD = Infinity;
    for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
      const code = lane[id(x, y)];
      if (!code || code === LANE.entry || code === LANE.unload) continue;
      const d = Math.abs(x - inner.x) + Math.abs(y - inner.y);
      if (d < bestD) { bestD = d; target = { x, y }; }
    }
    target ??= { x: clamp(inner.x, clear.x, clear.x + clear.w - 1), y: clamp(inner.y, clear.y, clear.y + clear.h - 1) };
    for (let k = 0; k <= depthIn; k++) stroke([{ x: e.x + ix * k, y: e.y + iy * k }], e.width, LANE.entry);
    const points: Point[] = [{ x: e.x, y: e.y }, inner];
    if (layout === 'fair' && a.irregular > .5 && bestD > 4) {
      const mid = { x: Math.round((inner.x + target.x) / 2 + (approachRng() - .5) * 3 * a.irregular), y: Math.round((inner.y + target.y) / 2 + (approachRng() - .5) * 3 * a.irregular) };
      if (inArea(mid.x, mid.y)) points.push(mid);
    } else if (inner.x !== target.x && inner.y !== target.y) {
      // Сначала вдоль края до линии цели, затем вглубь — ряд режется один раз.
      points.push(e.side % 2 === 0 ? { x: target.x, y: inner.y } : { x: inner.x, y: target.y });
    }
    points.push(target);
    stroke(points, e.width, e.main ? LANE.main : LANE.side, true);
  }
  for (const { cell, to } of merged) stroke([cell, { x: to.x, y: to.y }], 1, LANE.entry);
  // Улица, подошедшая к площади не по осевой (вплотную к контуру), тоже получает
  // проход: клетку площади у неё соединяем с ближайшим входом.
  // С кольцевой улицей это не нужно: она сама связывает все подходы.
  if (!req.ring) for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
    if (!inArea(x, y) || lane[id(x, y)]) continue;
    if (!N4.some(([dx, dy]) => streetAt(x + dx, y + dy) && !req.blocked(x + dx, y + dy))) continue;
    const to = entrances.reduce<MarketEntrance | undefined>((best, e) => !best || Math.abs(e.x - x) + Math.abs(e.y - y) < Math.abs(best.x - x) + Math.abs(best.y - y) ? e : best, undefined);
    if (to && Math.abs(to.x - x) + Math.abs(to.y - y) <= 3) stroke([{ x, y }, { x: to.x, y: to.y }], 1, LANE.entry);
  }
  // Связность проходов: оторванные куски соединяем с основной сетью.
  {
    const reached = new Uint8Array(W * H);
    const flood = (starts: Point[]) => {
      const stack = starts.filter((p) => inArea(p.x, p.y) && lane[id(p.x, p.y)]).map((p) => id(p.x, p.y));
      for (const s of stack) reached[s] = 1;
      while (stack.length) {
        const c = stack.pop()!, x = c % W, y = (c - x) / W;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (inArea(nx, ny) && lane[id(nx, ny)] && !reached[id(nx, ny)]) { reached[id(nx, ny)] = 1; stack.push(id(nx, ny)); }
        }
      }
    };
    flood(entrances.length ? entrances : [ctr]);
    for (let guard = 0; guard < 12; guard++) {
      let orphan = -1;
      for (let i = 0; i < W * H; i++) if (lane[i] && !reached[i]) { orphan = i; break; }
      if (orphan < 0) break;
      const ox = orphan % W, oy = (orphan - ox) / W;
      let best: Point | undefined, bd = Infinity;
      for (let i = 0; i < W * H; i++) if (reached[i]) {
        const x = i % W, y = (i - x) / W, d = Math.abs(x - ox) + Math.abs(y - oy);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (!best) break;
      stroke([{ x: ox, y: oy }, best], 1, LANE.cross);
      flood([{ x: ox, y: oy }]);
    }
  }

  // ---- 6. Торговые зоны ---------------------------------------------------------
  const serviceAngle = (() => {
    if (a.service === 'water' && req.shore !== undefined) return Math.atan2(DIRS[req.shore][1], DIRS[req.shore][0]);
    const e = a.service === 'gate' ? mainEntrance : entrances.length ? entrances[Math.floor(unit(seed, 101) * entrances.length)] : undefined;
    return e ? Math.atan2(e.y - ctr.y, e.x - ctr.x) : unit(seed, 102) * Math.PI * 2;
  })();
  const zoneOrder: MarketZoneKind[] = ['infra', 'food', 'craft', 'special'];
  const zoneWeights = zoneOrder.map((kind) => a.zones[kind]);
  const totalZone = zoneWeights.reduce((s, v) => s + v, 0);
  const zoneOf = new Int8Array(W * H).fill(-1);
  const zoneStats = zoneOrder.map((kind) => ({ kind, cells: 0, x: 0, y: 0 }));
  for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
    if (!area[id(x, y)]) continue;
    // Служебный сектор центрирован на служебной стороне.
    let ang = Math.atan2(y + .5 - ctr.y, x + .5 - ctr.x) - serviceAngle + Math.PI * (a.zones.infra / totalZone);
    ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let acc = 0, zone = 0;
    for (let i = 0; i < zoneOrder.length; i++) { acc += zoneWeights[i] / totalZone * Math.PI * 2; if (ang < acc) { zone = i; break; } zone = i; }
    zoneOf[id(x, y)] = zone;
    zoneStats[zone].cells++; zoneStats[zone].x += x; zoneStats[zone].y += y;
  }
  const zones: MarketZone[] = zoneStats.filter((z) => z.cells).map((z) => ({ kind: z.kind, cells: z.cells, x: Math.round(z.x / z.cells), y: Math.round(z.y / z.cells) }));

  // ---- 7. Торговые места --------------------------------------------------------
  const occ = new Int16Array(W * H).fill(-1);
  const free = (x: number, y: number) => inArea(x, y) && lane[id(x, y)] === LANE.none && occ[id(x, y)] < 0;
  interface Run { cells: Point[]; facing: Side; value: number }
  const runs: Run[] = [];
  for (const facing of [0, 1, 2, 3] as Side[]) {
    const [fx, fy] = DIRS[facing];
    const ux = facing % 2 === 0 ? 1 : 0, uy = facing % 2 === 0 ? 0 : 1;
    const isFront = (x: number, y: number) => free(x, y) && inArea(x + fx, y + fy) && lane[id(x + fx, y + fy)] !== LANE.none;
    const lines = facing % 2 === 0 ? H : W, along = facing % 2 === 0 ? W : H;
    for (let l = 0; l < lines; l++) {
      let current: Point[] = [];
      const flush = () => {
        if (current.length >= 2) {
          const value = current.reduce((s, p) => s + (FRONT_VALUE[lane[id(p.x + fx, p.y + fy)]] ?? 1), 0) / current.length;
          const mid = current[Math.floor(current.length / 2)];
          const dist = Math.hypot(mid.x - ctr.x, mid.y - ctr.y) / Math.max(4, crossSpan);
          runs.push({ cells: current, facing, value: value - dist * 1.2 + unit(seed, 111, mid.x, mid.y, facing) * (.5 + a.irregular) });
        }
        current = [];
      };
      for (let t = 0; t < along; t++) {
        const x = ux ? t : l, y = uy ? t : l;
        if (isFront(x, y)) current.push({ x, y }); else flush();
      }
      flush();
    }
  }
  runs.sort((p, q) => q.value - p.value);
  const clusters: MarketCluster[] = [];
  const raw: { cluster: MarketCluster; parts: { rect: Selection; kind: CivicKind; role: MarketItemRole; t: number; rotation: ChestRotation }[] }[] = [];
  const used: Partial<Record<MarketSpecialityId, number>> = {};
  const specEntries = Object.entries(a.specialities) as [MarketSpecialityId, number][];
  const structureEntries = Object.entries(a.structures) as [MarketStructure, number][];
  for (const run of runs) {
    const f = run.facing, [fx, fy] = DIRS[f];
    // Ось «вдоль» (U) и «вглубь» (−F) для этой стороны; ряд упорядочен по U.
    const U: Point = { x: fy === 0 ? 0 : fy > 0 ? 1 : -1, y: fx === 0 ? 0 : fx > 0 ? -1 : 1 };
    const cells = [...run.cells].sort((p, q) => (p.x - q.x) * U.x + (p.y - q.y) * U.y);
    const rng = stream(seed, 121, cells[0].x, cells[0].y, f);
    if (rng() > .5) cells.reverse();
    const dirU = cells.length > 1 ? { x: Math.sign(cells[1].x - cells[0].x), y: Math.sign(cells[1].y - cells[0].y) } : U;
    let pos = 0, previous: MarketSpecialityId | undefined;
    while (pos < cells.length) {
      const anchor = cells[pos];
      // Клетка уже занята соседним местом из перпендикулярного ряда.
      if (!free(anchor.x, anchor.y)) { pos++; continue; }
      const front = lane[id(anchor.x + fx, anchor.y + fy)];
      const zone = zoneOrder[Math.max(0, zoneOf[id(anchor.x, anchor.y)])];
      const slotRng = stream(seed, 131, anchor.x, anchor.y, f);
      const serviceFront = front === LANE.unload || front === LANE.entry;
      const options = specEntries.filter(([spec]) => {
        if ((used[spec] ?? 0) >= (MAX_SPEC[spec] ?? 99)) return false;
        if (spec === 'unload') return serviceFront || zone === 'infra' && front === LANE.main;
        return true;
      }).map(([spec, weight]): [MarketSpecialityId, number] => {
        const def = MARKET_SPECIALITIES[spec];
        let wgt = weight * (def.zone === zone ? 1 : .08) / (1 + (used[spec] ?? 0) * .55);
        if (spec === previous) wgt *= .2;
        if (front === LANE.unload) wgt *= def.zone === 'infra' ? 4 : .3;
        return [spec, wgt];
      });
      if (!options.length) { pos++; continue; }
      const spec = weighted(options, slotRng());
      const structure = weighted(structureEntries, slotRng());
      // Сколько клеток свободно вглубь от фронта.
      const probe = (u: number) => {
        let d = 0;
        for (; d < 3; d++) {
          const x = anchor.x + dirU.x * u - fx * d, y = anchor.y + dirU.y * u - fy * d;
          if (!free(x, y)) break;
        }
        return d;
      };
      let placed = false;
      for (const tpl of templatesFor(spec, structure, slotRng)) {
        if (pos + tpl.w > cells.length) continue;
        let fits = true;
        for (let u = 0; u < tpl.w && fits; u++) {
          const c = cells[pos + u];
          if (c.x !== anchor.x + dirU.x * u || c.y !== anchor.y + dirU.y * u) fits = false;
          else if (probe(u) < tpl.d) fits = false;
        }
        if (!fits) continue;
        // Рамка места и его предметы в мировых координатах.
        const cellAt = (u: number, v: number): Point => ({ x: anchor.x + dirU.x * u - fx * v, y: anchor.y + dirU.y * u - fy * v });
        const corners = [cellAt(0, 0), cellAt(tpl.w - 1, tpl.d - 1)];
        const rect: Selection = { x: Math.min(corners[0].x, corners[1].x), y: Math.min(corners[0].y, corners[1].y), w: Math.abs(corners[0].x - corners[1].x) + 1, h: Math.abs(corners[0].y - corners[1].y) + 1 };
        const index = clusters.length;
        for (let yy = rect.y; yy < rect.y + rect.h; yy++) for (let xx = rect.x; xx < rect.x + rect.w; xx++) occ[id(xx, yy)] = index;
        const frontCells = Array.from({ length: tpl.w }, (_, u) => { const c = cellAt(u, 0); return { x: c.x + fx, y: c.y + fy }; });
        const cluster: MarketCluster = { id: index, speciality: spec, zone: MARKET_SPECIALITIES[spec].zone, structure: tpl.structure, rect, facing: f, front: frontCells, skeleton: false, threshold: 1 };
        const parts = tpl.parts.map((part) => {
          const p0 = cellAt(part.u, part.v), p1 = cellAt(part.u + part.w - 1, part.v + part.d - 1);
          return {
            rect: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p0.x - p1.x) + 1, h: Math.abs(p0.y - p1.y) + 1 },
            kind: part.kind, role: part.role, t: part.t, rotation: FACING_ROTATION[f],
          };
        });
        clusters.push(cluster);
        raw.push({ cluster, parts });
        used[spec] = (used[spec] ?? 0) + 1;
        previous = spec;
        const gap = slotRng() < a.gap ? (a.irregular > .6 && slotRng() < .35 ? 2 : 1) : 0;
        pos += tpl.w + gap;
        placed = true;
        break;
      }
      if (!placed) pos++;
    }
  }
  // Запас за спиной места: ряд клеток позади рамки, если он свободен целиком,
  // отходит этому месту и заполняется его товаром (тесные ряды базара,
  // бочки порта). Проходы не трогаются — клетки вне сетки проходов.
  for (const entry of raw) {
    const { cluster } = entry;
    const f = cluster.facing, [fx, fy] = DIRS[f];
    const fillRng = stream(seed, 125, cluster.rect.x, cluster.rect.y, f);
    if (fillRng() >= a.backfill) continue;
    const r = cluster.rect;
    // Ряд «за спиной»: смещение против фасада.
    const back: Point[] = [];
    if (fx === 0) { const y = fy > 0 ? r.y - 1 : r.y + r.h; for (let x = r.x; x < r.x + r.w; x++) back.push({ x, y }); }
    else { const x = fx > 0 ? r.x - 1 : r.x + r.w; for (let y = r.y; y < r.y + r.h; y++) back.push({ x, y }); }
    // Не прижимать запас вплотную к краю площади, если снаружи улица: там вход в ряд.
    if (!back.every((q) => free(q.x, q.y))) continue;
    const spec = MARKET_SPECIALITIES[cluster.speciality];
    const longs = spec.stock21.length ? spec.stock21 : spec.stock11;
    const smalls = spec.stock11.length ? spec.stock11 : ['marketBarrelLying' as CivicKind];
    const pieces: { rect: Selection; kind: CivicKind }[] = [];
    for (let u = 0; u < back.length;) {
      const left = back.length - u;
      if (left >= 2 && longs.length && fillRng() < .6) {
        const kind = pickOf(longs, fillRng());
        if (CIVIC_KIT[kind].w === 2 && CIVIC_KIT[kind].h === 1) {
          const a0 = back[u], a1 = back[u + 1];
          pieces.push({ rect: { x: Math.min(a0.x, a1.x), y: Math.min(a0.y, a1.y), w: Math.abs(a0.x - a1.x) + 1, h: Math.abs(a0.y - a1.y) + 1 }, kind });
          u += 2;
          continue;
        }
      }
      // Одна свободная клетка между ящиками оставляется изредка — не сплошная стена.
      if (fillRng() < .8) pieces.push({ rect: { x: back[u].x, y: back[u].y, w: 1, h: 1 }, kind: pickOf(smalls, fillRng()) });
      u++;
    }
    if (!pieces.length) continue;
    const grown: Selection = {
      x: Math.min(r.x, ...back.map((q) => q.x)), y: Math.min(r.y, ...back.map((q) => q.y)),
      w: 0, h: 0,
    };
    grown.w = Math.max(r.x + r.w, ...back.map((q) => q.x + 1)) - grown.x;
    grown.h = Math.max(r.y + r.h, ...back.map((q) => q.y + 1)) - grown.y;
    cluster.rect = grown;
    for (const q of back) occ[id(q.x, q.y)] = cluster.id;
    pieces.forEach((piece, i) => {
      // Длинные предметы поворачиваются вдоль ряда; запас — поздний слой насыщенности.
      const rotation = piece.rect.w === 1 && piece.rect.h === 2 ? 90 : FACING_ROTATION[f];
      entry.parts.push({ rect: piece.rect, kind: piece.kind, role: 'stock', t: .55 + (i / pieces.length) * .4, rotation });
    });
  }
  // Скелет: первые места по ценности фронта есть при любой насыщенности.
  const skeletonCount = Math.min(clusters.length, Math.max(Math.min(clusters.length, 2), Math.round(clusters.length * a.skeleton)));
  clusters.forEach((cluster, k) => {
    cluster.skeleton = k < skeletonCount;
    // Места заканчиваются к насыщенности ≈ .62 (значение по умолчанию): выше
    // насыщенность добавляет уже товары и мелочь, а не новые прилавки.
    cluster.threshold = cluster.skeleton ? 0 : .04 + .58 * (k - skeletonCount + 1) / (clusters.length - skeletonCount + 1);
  });

  // ---- 8. Декор ---------------------------------------------------------------------
  const allItems: MarketItem[] = [];
  const item = (kind: CivicKind, rect: Selection, rotation: ChestRotation, role: MarketItemRole, cluster: number, threshold: number): MarketItem => ({
    ...rect, kind, rotation, variant: Math.floor(unit(seed, 141, rect.x, rect.y) * 2), source: 'layout', role, cluster, threshold: Math.round(threshold * 1000) / 1000,
  });
  // Центр.
  const trees: Tree[] = [];
  if (centreKind === 'well') allItems.push(item('marketWell', centreRect, 0, 'centre', -1, 0));
  else if (centreKind === 'fountain') allItems.push(item('fountain', centreRect, 0, 'centre', -1, 0));
  else if (centreKind === 'board') allItems.push(item('marketNoticeBoard', centreRect, 0, 'centre', -1, 0));
  else if (centreKind === 'smallWell') allItems.push(item('well', { x: centreRect.x, y: centreRect.y, w: 1, h: 1 }, 0, 'centre', -1, 0));
  else if (centreKind === 'tree') trees.push({ x: ctr.x, y: ctr.y, r: .95, kind: 'oak', v: unit(seed, 151) });
  for (const { cluster, parts } of raw) {
    for (const part of parts) {
      const local = part.role === 'main' || part.role === 'shade' || part.role === 'cart' && part.t === 0 ? 0 : clamp(part.t * .8 + (unit(seed, 161, part.rect.x, part.rect.y) - .5) * .16, .05, .97);
      allItems.push(item(part.kind, part.rect, part.rotation, part.role, cluster.id, Math.max(cluster.threshold, local)));
    }
  }
  const decorLimit = Math.max(2, Math.round(clusters.length * a.decor.max));
  let decorCount = 0;
  const decorFits = (r: Selection) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!free(x, y)) return false;
    return true;
  };
  const occupyDecor = (r: Selection) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) occ[id(x, y)] = 999; };
  const addDecor = (kind: CivicKind, r: Selection, rotation: ChestRotation, role: MarketItemRole, threshold: number) => {
    if (decorCount >= decorLimit || !decorFits(r)) return false;
    occupyDecor(r);
    allItems.push(item(kind, r, rotation, role, -1, threshold));
    decorCount++;
    return true;
  };
  const decorRng = stream(seed, 171);
  // Скамьи вокруг центра: на внешнем кольце свободной зоны, не на линии подходов.
  if (a.decor.seats && centreKind !== 'open' && clearance >= 2) {
    const spots: { r: Selection; rot: ChestRotation }[] = [
      { r: { x: ctr.x - 2, y: clear.y, w: 2, h: 1 }, rot: 180 }, { r: { x: ctr.x, y: clear.y + clear.h - 1, w: 2, h: 1 }, rot: 0 },
      { r: { x: clear.x, y: ctr.y - 2, w: 1, h: 2 }, rot: 90 }, { r: { x: clear.x + clear.w - 1, y: ctr.y, w: 1, h: 2 }, rot: 270 },
      { r: { x: ctr.x, y: clear.y, w: 2, h: 1 }, rot: 180 }, { r: { x: ctr.x - 2, y: clear.y + clear.h - 1, w: 2, h: 1 }, rot: 0 },
    ];
    let seats = 0;
    for (const { r, rot } of spots) {
      if (seats >= a.decor.seats) break;
      // Скамья не перекрывает подход: соседние клетки снаружи кольца — не проход-подход.
      let ok = true;
      for (let y = r.y; y < r.y + r.h && ok; y++) for (let x = r.x; x < r.x + r.w && ok; x++) {
        if (!inArea(x, y) || lane[id(x, y)] !== LANE.centre || occ[id(x, y)] >= 0) ok = false;
        for (const [dx, dy] of N4) { const c = lane[id(x + dx, y + dy)]; if (inArea(x + dx, y + dy) && (c === LANE.main || c === LANE.side || c === LANE.entry || c === LANE.cross)) ok = false; }
      }
      if (!ok) continue;
      occupyDecor(r);
      allItems.push(item('marketBench', r, rot, 'seat', -1, .15 + seats * .17));
      seats++;
    }
  } else if (a.decor.seats && centreKind === 'open') {
    // Свободная площадка: скамьи по её краю, лицом внутрь.
    let seats = 0;
    for (let i = 0; i < 8 && seats < a.decor.seats; i++) {
      const t = (i / 8) * Math.PI * 2 + decorRng() * .3;
      const x = Math.round(ctr.x + Math.cos(t) * (openRadius + 1.6)), y = Math.round(ctr.y + Math.sin(t) * (openRadius + 1.6));
      const vertical = Math.abs(Math.cos(t)) > .7;
      const r = vertical ? { x, y: y - 1, w: 1, h: 2 } : { x: x - 1, y, w: 2, h: 1 };
      const rot: ChestRotation = vertical ? (Math.cos(t) > 0 ? 90 : 270) : (Math.sin(t) > 0 ? 180 : 0);
      if (addDecor('marketBench', r, rot, 'seat', .2 + seats * .15)) seats++;
    }
  }
  // Доска объявлений у главного входа.
  if (a.decor.board && centreKind !== 'board' && mainEntrance) {
    const [ix, iy] = DIRS[(mainEntrance.side + 2) % 4];
    let done = false;
    const along = mainEntrance.side % 2 === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    for (let k = 1; k < 5 && !done; k++) for (const s of [-1, 1]) {
      // Справа — сразу за шириной входа, слева — вплотную к нему.
      const offset = s > 0 ? mainEntrance.width : -2;
      const r = { x: mainEntrance.x + ix * k + along.x * offset, y: mainEntrance.y + iy * k + along.y * offset, w: 2, h: 2 };
      if (ix < 0) r.x -= 1;
      if (iy < 0) r.y -= 1;
      if (addDecor('marketNoticeBoard', r, FACING_ROTATION[((mainEntrance.side + 2) % 4) as Side], 'decor', .12)) { done = true; break; }
    }
  }
  // Место отдыха: стол со скамьёй у открытого места, если такого места ещё нет.
  if (a.decor.rest && !(used.rest ?? 0)) {
    let done = false;
    for (let ring = clearance + 2; ring < crossSpan && !done; ring++) {
      for (let i = 0; i < 12 && !done; i++) {
        const t = (i / 12) * Math.PI * 2;
        const x = Math.round(ctr.x + Math.cos(t) * ring) - 1, y = Math.round(ctr.y + Math.sin(t) * ring) - 1;
        if (addDecor('marketTableSet', { x, y, w: 3, h: 2 }, 0, 'seat', .4)) {
          addDecor('marketBench', { x, y: y + 2, w: 2, h: 1 }, 0, 'seat', .62);
          done = true;
        }
      }
    }
  }
  // Сено у края площади (деревня, караван, ярмарка).
  for (let i = 0, placedHay = 0; i < 60 && placedHay < a.decor.hay; i++) {
    const x = B.x + Math.floor(decorRng() * B.w), y = B.y + Math.floor(decorRng() * B.h);
    const r = { x, y, w: 2, h: 2 };
    const edge = [[-1, 0], [2, 0], [0, -1], [0, 2]].some(([dx, dy]) => !inArea(x + dx, y + dy));
    if (!edge) continue;
    if (addDecor(decorRng() > .5 ? 'marketHay' : 'marketHayLarge', r, 0, 'decor', .3 + placedHay * .2)) placedHay++;
  }
  // Карманы: колодец-поилка или бочки посреди.
  pockets.forEach((p, i) => {
    if (decorCount >= decorLimit) return;
    const kind: CivicKind = i % 2 ? 'marketBarrelLying' : 'well';
    const r = { x: p.x, y: p.y, w: 1, h: 1 };
    // Предмет в центре кармана: карман 3×3, вокруг остаётся проход.
    if (inArea(p.x, p.y)) { allItems.push(item(kind, r, 0, 'decor', -1, .2 + i * .2)); decorCount++; lane[id(p.x, p.y)] = LANE.none; occ[id(p.x, p.y)] = 999; }
  });
  // Мелочь у задних и боковых сторон мест — не на проходах.
  for (const { cluster } of raw) {
    if (decorCount >= decorLimit) break;
    const r = cluster.rect;
    const ring: Point[] = [];
    for (let x = r.x - 1; x <= r.x + r.w; x++) ring.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
    for (let y = r.y; y < r.y + r.h; y++) ring.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
    const spot = ring.find((p) => free(p.x, p.y) && unit(seed, 181, p.x, p.y) < .5);
    if (!spot) continue;
    const smalls = MARKET_SPECIALITIES[cluster.speciality].stock11;
    const pool: readonly CivicKind[] = smalls.length ? smalls : ['marketBarrelLying'];
    const kind = pickOf(pool, unit(seed, 182, spot.x, spot.y));
    addDecor(kind, { x: spot.x, y: spot.y, w: 1, h: 1 }, FACING_ROTATION[cluster.facing], 'decor', Math.max(cluster.threshold, .55 + unit(seed, 183, spot.x, spot.y) * .4));
  }

  // ---- 9. Связность: место без доступа убираем ----------------------------------------
  const blockedByItems = new Uint8Array(W * H);
  for (const it of allItems) for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) if (inMap(x, y)) blockedByItems[id(x, y)] = 1;
  const reach = new Uint8Array(W * H);
  {
    const stack = entrances.map((e) => id(e.x, e.y)).filter((i) => !blockedByItems[i]);
    for (const s of stack) reach[s] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % W, y = (c - x) / W;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy, n = id(nx, ny);
        if (inArea(nx, ny) && !reach[n] && !blockedByItems[n]) { reach[n] = 1; stack.push(n); }
      }
    }
  }
  const dropped = new Set<number>();
  if (entrances.length) for (const cluster of clusters) if (!cluster.front.some((p) => inArea(p.x, p.y) && reach[id(p.x, p.y)])) dropped.add(cluster.id);
  if (dropped.size) notes.push(`убрано мест без доступа: ${dropped.size}`);
  const finalItems = allItems.filter((it) => it.cluster < 0 || !dropped.has(it.cluster));
  const finalClusters = clusters.filter((c) => !dropped.has(c.id));
  const richness = clamp(req.richness, 0, 1);

  return {
    version: MARKET_GENERATOR_VERSION,
    archetype: a.id, label: a.label, requested: req.resolution.requested, chain: req.resolution.chain, reason: req.resolution.reason,
    layout, surface: a.surface, bounds: { ...B }, shore: req.shore, width: W, height: H,
    area, lanes: lane, zoneOf,
    centre: { kind: centreKind, rect: centreKind === 'smallWell' ? { x: centreRect.x, y: centreRect.y, w: 1, h: 1 } : centreRect, clear },
    entrances, zones, clusters: finalClusters, allItems: finalItems,
    items: finalItems.filter((it) => it.threshold <= richness + 1e-9),
    trees, paths, richness, notes,
  };
}

/** Предметы рынка при другой насыщенности (скелет тот же). */
export const marketItemsAt = (plan: MarketPlan, richness: number) => plan.allItems.filter((it) => it.threshold <= clamp(richness, 0, 1) + 1e-9);

/**
 * Покрытие площади для планировщика поселения: какие клетки перекрасить.
 * Мощёная площадь рисуется объектом «Площадь» — здесь пусто; утоптанная земля
 * и луг получают грунт и тропы по проходам.
 */
export function marketGround(plan: MarketPlan): { x: number; y: number; terrain: Terrain }[] {
  if (plan.surface === 'square') return [];
  const out: { x: number; y: number; terrain: Terrain }[] = [];
  const { width: W } = plan;
  for (let y = plan.bounds.y; y < plan.bounds.y + plan.bounds.h; y++) for (let x = plan.bounds.x; x < plan.bounds.x + plan.bounds.w; x++) {
    const i = y * W + x;
    if (!plan.area[i]) continue;
    const code = plan.lanes[i];
    // Проходы — утоптанная дорога (они же связывают улицы через рынок);
    // торговые места: на площадке — голая земля, на лугу — трава.
    if (code) out.push({ x, y, terrain: 'road' });
    else out.push({ x, y, terrain: plan.surface === 'ground' ? 'dirt' : 'grass' });
  }
  return out;
}

/**
 * Красит грунт рынка в клетки поселения. Мощёная площадь рисуется объектом
 * 'square'; на грунте и лугу проходы становятся дорогой (они же связывают
 * улицы через рынок), места — землёй, на лугу мостовая под местами — травой.
 * Вода не трогается.
 */
export function applyMarketGround(plan: MarketPlan, cells: Cell[][]) {
  for (const cell of marketGround(plan)) {
    const c = cells[cell.y][cell.x];
    if (wet(c.terrain)) continue;
    // На лугу трава не затирает естественный тёмный/сухой грунт — только мостовую.
    if (cell.terrain === 'grass' && c.terrain !== 'road' && c.terrain !== 'plaza') continue;
    c.terrain = cell.terrain;
  }
}

// ---------------------------------------------------------------------------
// Проверка
// ---------------------------------------------------------------------------

export interface MarketValidation {
  ok: boolean;
  issues: string[];
  checks: Record<'bounds' | 'overlap' | 'centre' | 'aisles' | 'access' | 'entrances' | 'goods' | 'archetype' | 'decor' | 'size' | 'carts', boolean>;
}

/**
 * Проверяет план рынка при его насыщенности: всё в пределах площади, нет
 * наложений, центр и проходы свободны, все места и центр доступны от входов,
 * каждый вход примыкает к улице, товар лежит у своего прилавка, торговля
 * соответствует архетипу, декора не больше предела, площадь по карте.
 */
export function validateMarket(plan: MarketPlan, archetype: MarketArchetypeDef, streets?: Uint8Array): MarketValidation {
  const { width: W, height: H } = plan;
  const issues: string[] = [];
  const checks: MarketValidation['checks'] = { bounds: true, overlap: true, centre: true, aisles: true, access: true, entrances: true, goods: true, archetype: true, decor: true, size: true, carts: true };
  const fail = (key: keyof MarketValidation['checks'], text: string) => { checks[key] = false; if (issues.length < 40) issues.push(text); };
  const inArea = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && plan.area[y * W + x] === 1;
  const owner = new Int32Array(W * H).fill(-1);
  plan.items.forEach((it, index) => {
    for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) {
      if (!inArea(x, y)) { fail('bounds', `${it.kind} (${it.x},${it.y}) выходит за площадь`); continue; }
      const i = y * W + x;
      if (owner[i] >= 0) fail('overlap', `${it.kind} (${it.x},${it.y}) перекрывает ${plan.items[owner[i]].kind}`);
      owner[i] = index;
      const code = plan.lanes[i];
      if (it.role === 'centre') continue;
      if (code === LANE.centre || code === LANE.open) { if (it.role !== 'seat') fail('centre', `${it.kind} (${it.x},${it.y}) занимает центр`); }
      else if (code !== LANE.none) fail('aisles', `${it.kind} (${it.x},${it.y}) стоит на проходе`);
      if ((it.kind === 'marketWagon' || it.kind === 'marketWagonCovered') && code !== LANE.none) fail('carts', `телега (${it.x},${it.y}) перекрывает проход`);
    }
  });
  // Доступность от входов по свободным клеткам.
  const reach = new Uint8Array(W * H);
  const stack = plan.entrances.map((e) => e.y * W + e.x).filter((i) => owner[i] < 0);
  for (const s of stack) reach[s] = 1;
  while (stack.length) {
    const c = stack.pop()!, x = c % W, y = (c - x) / W;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy, n = ny * W + nx;
      if (inArea(nx, ny) && !reach[n] && owner[n] < 0) { reach[n] = 1; stack.push(n); }
    }
  }
  if (!plan.entrances.length) fail('entrances', 'у площади нет входов');
  const present = new Set(plan.items.map((it) => it.cluster));
  for (const cluster of plan.clusters) {
    if (!present.has(cluster.id)) continue;
    if (!cluster.front.some((p) => inArea(p.x, p.y) && reach[p.y * W + p.x])) fail('access', `место ${cluster.id} (${MARKET_SPECIALITIES[cluster.speciality].label}) недоступно`);
    if (!(cluster.speciality in archetype.specialities)) fail('archetype', `торговля «${cluster.speciality}» не из архетипа ${archetype.id}`);
  }
  const { clear } = plan.centre;
  let centreReached = false;
  for (let y = clear.y; y < clear.y + clear.h; y++) for (let x = clear.x; x < clear.x + clear.w; x++) if (inArea(x, y) && reach[y * W + x]) centreReached = true;
  if (plan.entrances.length && !centreReached) fail('access', 'центр площади недоступен');
  for (const e of plan.entrances) {
    const out = e.street;
    const linked = streets ? streets[out.y * W + out.x] === 1 : true;
    if (!linked || inArea(out.x, out.y)) fail('entrances', `вход (${e.x},${e.y}) не связан с улицей`);
  }
  for (const it of plan.items) {
    if (it.cluster < 0 || it.role === 'main' || it.role === 'cart' && it.threshold === 0) continue;
    const cluster = plan.clusters.find((c) => c.id === it.cluster);
    if (!cluster) continue;
    const r = cluster.rect;
    if (it.x < r.x || it.y < r.y || it.x + it.w > r.x + r.w || it.y + it.h > r.y + r.h) fail('goods', `${it.kind} (${it.x},${it.y}) лежит не у своего места`);
  }
  const decor = plan.items.filter((it) => it.cluster < 0 && it.role !== 'centre').length;
  const limit = Math.max(2, Math.round(plan.clusters.length * archetype.decor.max)) + archetype.decor.seats + 1;
  if (decor > limit) fail('decor', `декора ${decor} при пределе ${limit}`);
  let cells = 0;
  for (let i = 0; i < W * H; i++) cells += plan.area[i];
  const b = plan.bounds;
  if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H || cells > W * H * .3) fail('size', `площадь ${b.w}×${b.h} не соответствует карте ${W}×${H}`);
  return { ok: issues.length === 0, issues, checks };
}

/** Краткий отчёт для панели и тестов (без масок). */
export interface MarketReport {
  generator: number;
  archetype: MarketArchetypeId;
  label: string;
  requested?: MarketArchetypeId;
  reason: string;
  layout: MarketLayoutStyle;
  surface: MarketArchetypeDef['surface'];
  bounds: Selection;
  centre: MarketCentreKind;
  entrances: number;
  shore: boolean;
  zones: MarketZone[];
  /** Торговых мест в плане / на карте при текущей насыщенности. */
  clusters: number;
  placed: number;
  skeleton: number;
  specialities: Partial<Record<MarketSpecialityId, number>>;
  objects: number;
  aisleCells: number;
  valid: boolean;
  issues: string[];
  notes: string[];
}

export function marketReport(plan: MarketPlan, validation: MarketValidation): MarketReport {
  const present = new Set(plan.items.map((it) => it.cluster));
  const placed = plan.clusters.filter((c) => present.has(c.id));
  const specialities: Partial<Record<MarketSpecialityId, number>> = {};
  for (const c of placed) specialities[c.speciality] = (specialities[c.speciality] ?? 0) + 1;
  let aisleCells = 0;
  for (let i = 0; i < plan.lanes.length; i++) if (plan.area[i] && plan.lanes[i]) aisleCells++;
  return {
    generator: plan.version, archetype: plan.archetype, label: plan.label, requested: plan.requested, reason: plan.reason,
    layout: plan.layout, surface: plan.surface, bounds: plan.bounds, centre: plan.centre.kind, entrances: plan.entrances.length,
    shore: plan.shore !== undefined, zones: plan.zones, clusters: plan.clusters.length, placed: placed.length,
    skeleton: plan.clusters.filter((c) => c.skeleton).length, specialities, objects: plan.items.length, aisleCells,
    valid: validation.ok, issues: validation.issues, notes: plan.notes,
  };
}

/**
 * Набережная и причал портового рынка: полоса суши между площадью и водой
 * (по ней идут грузчики) и короткий причал от середины стороны воды. Причал
 * не перегораживает реку: длина — не больше трети ширины воды.
 */
export function marketWaterfront(plan: MarketPlan, t: MarketTerrain, seed = 0): { quay: Point[]; pier: Point[]; cargo: MarketItem[] } {
  if (plan.shore === undefined) return { quay: [], pier: [], cargo: [] };
  const { width: W, height: H } = t;
  const [dx, dy] = DIRS[plan.shore];
  const B = plan.bounds;
  const quay: Point[] = [];
  const edge: Point[] = [];
  if (plan.shore % 2 === 0) for (let x = B.x; x < B.x + B.w; x++) edge.push({ x, y: plan.shore === 0 ? B.y : B.y + B.h - 1 });
  else for (let y = B.y; y < B.y + B.h; y++) edge.push({ x: plan.shore === 3 ? B.x : B.x + B.w - 1, y });
  // Кромка набережной: последняя сухая клетка перед водой у каждого участка.
  const brink: Point[] = [];
  for (const p of edge) {
    for (let k = 1; k <= 5; k++) {
      const x = p.x + dx * k, y = p.y + dy * k;
      if (x < 0 || y < 0 || x >= W || y >= H || !usableCell(t, x, y)) break;
      quay.push({ x, y });
      const nx = x + dx, ny = y + dy;
      if (k >= 2 && nx >= 0 && ny >= 0 && nx < W && ny < H && wet(t.cells[ny][nx].terrain)) brink.push({ x, y });
    }
  }
  const mid = edge[Math.floor(edge.length / 2)];
  let x = mid.x + dx, y = mid.y + dy;
  while (x >= 0 && y >= 0 && x < W && y < H && usableCell(t, x, y)) { x += dx; y += dy; }
  const water: Point[] = [];
  while (x >= 0 && y >= 0 && x < W && y < H && wet(t.cells[y][x].terrain) && t.cells[y][x].terrain !== 'bridge') { water.push({ x, y }); x += dx; y += dy; }
  const reachesLand = x >= 0 && y >= 0 && x < W && y < H;
  const length = Math.min(5, reachesLand ? Math.floor(water.length / 3) : water.length - 1);
  const pier = length >= 2 ? water.slice(0, length) : [];
  // Груз у воды: бочки, сундуки и бухты каната вдоль кромки, с разрывами,
  // не у корня причала (там проход). Насыщенность решает, сколько видно.
  const cargo: MarketItem[] = [];
  const rng = stream(seed, 211);
  const root = pier.length ? { x: pier[0].x - dx, y: pier[0].y - dy } : undefined;
  const CARGO: readonly CivicKind[] = ['marketBarrelLying', 'marketChest', 'marketRope', 'marketBarrelLying'];
  let skip = 0;
  for (const p of brink) {
    if (root && Math.abs(p.x - root.x) + Math.abs(p.y - root.y) <= 1) { skip = 1; continue; }
    if (skip > 0) { skip--; continue; }
    if (rng() < .45) { skip = 1 + Math.floor(rng() * 2); continue; }
    cargo.push({ kind: pickOf(CARGO, rng()), x: p.x, y: p.y, w: 1, h: 1, rotation: 0, variant: Math.floor(rng() * 2), source: 'layout', role: 'stock', cluster: -1, threshold: Math.round((.1 + rng() * .8) * 1000) / 1000 });
  }
  return { quay, pier, cargo };
}

/** Итог для планировщика поселения: план, проверка, отчёт и маска клеток предметов. */
export interface MarketOutcome {
  plan: MarketPlan;
  validation: MarketValidation;
  report: MarketReport;
  /** Клетки, занятые предметами рынка при полной насыщенности (двери домов туда не смотрят). */
  occupied: Uint8Array;
}

export function finishMarket(plan: MarketPlan, archetype: MarketArchetypeDef, streets: Uint8Array): MarketOutcome {
  const validation = validateMarket(plan, archetype, streets);
  const occupied = new Uint8Array(plan.width * plan.height);
  for (const it of plan.allItems) for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) occupied[y * plan.width + x] = 1;
  return { plan, validation, report: marketReport(plan, validation), occupied };
}

/**
 * Клетка перед дверью смотрит на рынок: она на площади, вплотную к ней или —
 * если это улица — через улицу (кольцевую) не дальше 3 клеток от площади.
 */
export function facesMarket(plan: MarketPlan, x: number, y: number, streets?: Uint8Array): boolean {
  const { width: W, height: H } = plan;
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const reach = streets?.[y * W + x] ? 3 : 1;
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    if (Math.abs(dx) + Math.abs(dy) > reach) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && plan.area[ny * W + nx] === 1) return true;
  }
  return false;
}
