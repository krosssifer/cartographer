/**
 * Планировщик поселений по типу и планировке (P4).
 *
 * Включается полем GenSettings.settlementType; без него работает прежний
 * buildPlan из settlement.ts (золотые карты не меняются). Конвейер:
 *   1. грунт и география: берег моря (порт), склон со скалами (горы), река;
 *   2. центр и застроенная область, стены с воротами и башнями;
 *   3. улицы по планировке (радиальная, кольцевая, сетка, линейная,
 *      компактная, органическая, смешанная) — главные улицы пробивают ворота
 *      и пересекают воду мостами, второстепенные упираются в стену и берег;
 *   4. площадь и рынок, причалы, сады, телеги у ворот;
 *   5. кварталы: семена по правилам квартала (рынок у площади, порт у воды,
 *      гарнизон у стен, знать на возвышенности, бедняки за стеной) и
 *      разбиение Вороного;
 *   6. участки: размеры, виды построек, кровли и формы крыш — от квартала;
 *      бюджет площади делится между кварталами вместо четырёх квадрантов.
 * Порядок участков не зависит от плотности: плотность берёт префикс списка.
 */
import { Perlin } from '../noise';
import { hash2, mulberry32 } from '../random';
import { CIVIC_KIT, contains, intersects } from '../settlementKit';
import { modernMarket } from './marketArchetypes';
import { facesMarket, applyMarketGround, finishMarket, marketWaterfront, planMarket, resolveMarketSite, type MarketOutcome } from './marketLayout';
import type { Building, Cell, ChestRotation, CivicKind, CivicObject, GenSettings, Point, Selection, SettlementStyle, Terrain, Tree } from '../types';
import {
  DISTRICTS,
  SETTLEMENT_GENERATOR_VERSION,
  getSettlementType,
  isSettlementLayout,
  type DistrictKind,
  type Geography,
  type SettlementLayoutId,
  type SettlementTypeDef,
  type SettlementTypeId,
  type WallKind,
} from './settlementTypes';

export interface SettlementDistrictReport {
  kind: DistrictKind;
  label: string;
  x: number;
  y: number;
  /** Сколько построек квартала стоит на карте (после плотности). */
  buildings: number;
}

/** Отчёт планировщика: читается панелью поселения и тестами. */
export interface SettlementReport {
  generator: number;
  type: SettlementTypeId;
  label: string;
  layout: SettlementLayoutId;
  geography: Geography;
  river: boolean;
  walls: WallKind;
  gates: number;
  towers: number;
  streets: number;
  bridges: number;
  piers: number;
  districts: SettlementDistrictReport[];
  buildings: Partial<Record<Building['kind'], number>>;
  notes: string[];
  /** Геометрия укреплений для отрисовки: кольца стены (центр и радиусы в клетках) и башни. */
  fortification?: TownFortification;
}

export interface TownFortification {
  kind: Exclude<WallKind, 'none'>;
  rings: { cx: number; cy: number; rx: number; ry: number }[];
  towers: Point[];
}

export interface TypedSettlementPlan {
  cells: Cell[][];
  plots: Building[];
  /** Индекс квартала для каждого участка (в districts). */
  plotDistrict: number[];
  civic: CivicObject[];
  road: Point[];
  river: Point[];
  lanes: { points: Point[]; width: number; surface: 'road' | 'plaza' }[];
  /** Клетки башен стены (центры) — для отрисовки. */
  towers: Point[];
  /** Новый рынок (marketArchetype задан): план, проверка и отчёт. */
  market?: MarketOutcome;
  /** Дерево в центре площади рынка (обычное дерево слоя деревьев). */
  marketTrees?: Tree[];
  report: Omit<SettlementReport, 'buildings' | 'districts'> & { districts: Omit<SettlementDistrictReport, 'buildings'>[] };
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const between = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wet = (t: Terrain) => t === 'water' || t === 'deepWater' || t === 'bridge';
const TENTS: CivicKind[] = ['marketTentStripe', 'marketTentRound', 'marketTentAwning', 'marketTentCanopy', 'marketTentPatch', 'marketTentTarp'];
const STALLS: CivicKind[] = ['marketStallProduce', 'marketStallBread', 'marketStallFruit', 'marketStallFish', 'marketStallMeat', 'marketStallPottery', 'marketStallFabric', 'marketStallTools'];
const GOODS: CivicKind[] = ['marketCrates', 'marketBarrels', 'marketSacks', 'marketBarrelPair', 'marketRope'];

function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const value of parts) {
    h ^= value | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

let cached: { key: string; value: TypedSettlementPlan } | undefined;

/** Планировка, которой будет построено поселение: явная или по умолчанию для типа. */
export function resolveSettlementLayout(type: SettlementTypeDef, requested: string | undefined): SettlementLayoutId {
  return isSettlementLayout(requested) ? requested : type.layouts[0];
}

export function buildTypedPlan(s: GenSettings, style: SettlementStyle): TypedSettlementPlan {
  const type = getSettlementType(s.settlementType)!;
  const layout = resolveSettlementLayout(type, s.settlementLayout);
  const { width: w, height: h, seed } = s;
  const key = `${type.id}:${layout}:${style}:${seed}:${w}:${h}:${s.road}:${s.river}:${s.publicSpaces}:${s.marketRichness}:${s.marketStyle}:${s.marketArchetype}`;
  if (cached?.key === key) return cached.value;

  const rng = mulberry32(mix(seed, 0x5e771e));
  const ink = new Perlin(seed + 3801);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const town = type.style === 'town';
  const small = Math.min(w, h) < 24;
  const notes: string[] = [];
  const cells = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x): Cell => {
    const moisture = ink.fbm(x * .088 + 18, y * .088 + 8, 3);
    return {
      terrain: moisture > .61 ? 'darkGrass' : moisture < .34 ? 'dirt' : 'grass',
      height: .49 + (ink.fbm(x * .13, y * .13, 3) - .5) * .32,
      moisture,
    };
  }));
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usable = (x: number, y: number) => inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  // ---- 1. География ---------------------------------------------------------
  // Сторона «вглубь» (берег/склон): 0 — юг, 1 — север, 2 — восток, 3 — запад.
  const geography = type.geography;
  const wantsRiver = s.river && !small;
  const side = geography === 'coast' && wantsRiver ? (hash2(seed, 3, 0x51de) > .5 ? 0 : 1) : Math.floor(hash2(seed, 5, 0x51de) * 4);
  /** Глубина клетки от выбранного края карты, 0 — у самого края. */
  const fromEdge = (x: number, y: number) => side === 0 ? h - 1 - y : side === 1 ? y : side === 2 ? w - 1 - x : x;
  const along = (x: number, y: number) => side <= 1 ? x : y;
  const span = side <= 1 ? h : w;
  const length = side <= 1 ? w : h;
  /** Обратное преобразование: точка по (вдоль края, глубина от края). */
  const at = (a: number, d: number): Point => side === 0 ? { x: a, y: h - 1 - d } : side === 1 ? { x: a, y: d } : side === 2 ? { x: w - 1 - d, y: a } : { x: d, y: a };
  const river: Point[] = [];
  let shore = 0;
  if (geography === 'coast') {
    // Море вдоль края: изрезанная береговая линия, мелководье и пляж.
    shore = Math.max(4, Math.round(span * .2));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const line = shore + ink.noise(along(x, y) * .09, 77) * span * .06 + Math.sin(along(x, y) / length * 5.2 + seed % 7) * 1.2;
      const d = fromEdge(x, y);
      if (d < line * .55) cells[y][x].terrain = 'deepWater';
      else if (d < line) cells[y][x].terrain = 'water';
      else if (d < line + 1.2) cells[y][x].terrain = 'sand';
      cells[y][x].height = between(.2 + (d - line) / span * .7, 0, 1);
    }
  } else if (geography === 'mountain') {
    // Склон: высота растёт к выбранному краю, верх — скальный гребень с осыпями.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const rise = 1 - fromEdge(x, y) / Math.max(1, span - 1);
      const lift = rise + (ink.fbm(x * .07 + 40, y * .07 + 9, 3) - .5) * .28;
      cells[y][x].height = between(.25 + lift * .7, 0, 1);
      if (lift > .8) cells[y][x].terrain = 'rock';
      else if (lift > .62 && ink.noise(x * .21, y * .21 + 50) > .38) cells[y][x].terrain = 'rock';
      else if (lift > .55 && cells[y][x].terrain === 'darkGrass') cells[y][x].terrain = 'grass';
    }
  }
  if (wantsRiver) {
    // Река: в горах — по долине вдоль подножия, у моря — к устью, иначе — с севера на юг у края.
    const valley = geography === 'mountain';
    const base = valley ? (side === 0 ? h * .22 : side === 1 ? h * .78 : side === 2 ? w * .22 : w * .78)
      : geography === 'coast' ? (side <= 1 ? w * (.62 + hash2(seed, 9, 0x71) * .2) : h * .7) : w * .84;
    const vertical = valley ? side >= 2 : geography === 'coast' ? side <= 1 : true;
    const n = vertical ? h : w;
    const cross = vertical ? w : h;
    const offset = rng();
    const widthOf = between(cross * .085, 2.6, 6.5);
    for (let t = 0; t < n; t++) {
      const centre = base + Math.sin(t / n * 4.2 + .5) * Math.min(3.4, cross * .07) + (offset - .5) * 3;
      const width = widthOf + ink.noise(t * .15, 31) * .65;
      river.push(vertical ? { x: between(Math.floor(centre), 0, w - 1), y: t } : { x: t, y: between(Math.floor(centre), 0, h - 1) });
      for (let c = 0; c < cross; c++) {
        const x = vertical ? c : t, y = vertical ? t : c;
        if (terrain(x, y) === 'deepWater') continue;
        const dist = Math.abs(c + .5 - centre);
        if (dist < width / 2) cells[y][x].terrain = dist < width * .22 ? 'deepWater' : 'water';
        else if (dist < width / 2 + .9 + ink.noise(x * .45, y * .4) * .25 && terrain(x, y) !== 'rock') cells[y][x].terrain = 'sand';
      }
    }
  } else if (s.river && small) notes.push('река не проводится: карта меньше 24 клеток');

  // ---- 2. Центр и застроенная область --------------------------------------
  const land: Point[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (usable(x, y)) land.push({ x, y });
  const preferred = (() => {
    if (geography === 'coast') return at(length * (.42 + hash2(seed, 1, 0xce) * .16), shore + (span - shore) * .38);
    if (geography === 'mountain') return at(length * (.4 + hash2(seed, 1, 0xce) * .2), span * .45);
    return { x: w * (wantsRiver && river.length && river[0].x > w / 2 ? .44 : .5) + (hash2(seed, 2, 0xce) - .5) * 3, y: h * .5 + (hash2(seed, 3, 0xce) - .5) * 2 };
  })();
  let centre = { x: Math.round(preferred.x), y: Math.round(preferred.y) };
  if (!usable(centre.x, centre.y) && land.length) {
    centre = land.reduce((best, p) => Math.hypot(p.x - preferred.x, p.y - preferred.y) < Math.hypot(best.x - preferred.x, best.y - preferred.y) ? p : best, land[0]);
  }
  // Обнесённому стеной поселению нужен минимальный двор, иначе на малой карте
  // внутри кольца помещаются одни улицы.
  const minRX = type.walls !== 'none' ? Math.min(w / 2 - 2, 11) : 5, minRY = type.walls !== 'none' ? Math.min(h / 2 - 2, 9) : 4;
  const RX = Math.max(minRX, w / 2 * type.extent), RY = Math.max(minRY, h / 2 * type.extent);
  /** Нормированное расстояние до центра (1 — край застроенной области). */
  const reach = (x: number, y: number) => Math.hypot((x - centre.x) / RX, (y - centre.y) / RY);

  const streets = new Uint8Array(w * h), reserved = new Uint8Array(w * h);
  const civic: CivicObject[] = [];
  const lanes: TypedSettlementPlan['lanes'] = [];
  const gates = new Set<number>();
  let bridges = 0;

  // ---- 3. Стены -------------------------------------------------------------
  const wallRings: number[] = [];
  const walled = type.walls !== 'none' && Math.min(w, h) >= 24;
  if (type.walls !== 'none' && !walled) notes.push('стены не строятся: карта меньше 24 клеток');
  // Кольцо стены не выходит за карту: иначе у края остаётся дыра и ворота не нужны.
  const wallRadii = (ring: number) => ({
    x: Math.max(3, Math.min(RX * ring, centre.x - 2, w - 3 - centre.x)),
    y: Math.max(3, Math.min(RY * ring, centre.y - 2, h - 3 - centre.y)),
  });
  const wallAt = (ring: number, x: number, y: number) => {
    const r = wallRadii(ring);
    return Math.hypot((x - centre.x) / r.x, (y - centre.y) / r.y);
  };
  if (walled) {
    // Внутреннее кольцо цитадели — только если в нём поместятся башня и обход.
    const inner = type.keep && Math.min(RX, RY) >= 12;
    wallRings.push(.92);
    if (inner) wallRings.push(.46);
  }
  for (const ring of wallRings) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (wallAt(ring, x, y) > 1 || !usable(x, y)) continue;
      if (NEIGHBOURS.some(([dx, dy]) => wallAt(ring, x + dx, y + dy) > 1)) cells[y][x].terrain = 'wall';
    }
  }

  // Цитадель крепости — в центре, её место закрыто для улиц заранее; вокруг —
  // двор-обход, через который сходятся все улицы.
  const keepSize = between(Math.round(Math.min(RX, RY) * .38), 5, 8);
  const keepBox: Selection | undefined = type.keep ? {
    x: between(centre.x - Math.floor(keepSize / 2), 2, w - keepSize - 2),
    y: between(centre.y - Math.floor(keepSize / 2), 2, h - keepSize - 2),
    w: keepSize, h: keepSize,
  } : undefined;
  const keepFree = keepBox && (() => {
    for (let y = keepBox.y - 1; y <= keepBox.y + keepBox.h; y++) for (let x = keepBox.x - 1; x <= keepBox.x + keepBox.w; x++) if (!usable(x, y)) return false;
    return true;
  })();
  if (keepBox && keepFree) for (let y = keepBox.y; y < keepBox.y + keepBox.h; y++) for (let x = keepBox.x; x < keepBox.x + keepBox.w; x++) reserved[id(x, y)] = 1;

  // ---- Улицы: покраска полос ----------------------------------------------
  type Stroke = { points: Point[]; radius: number; surface: Terrain; main: boolean };
  function paint(x: number, y: number, surface: Terrain, main: boolean) {
    if (!inside(x, y) || keepFree && reserved[id(x, y)]) return false;
    const t = terrain(x, y);
    if (t === 'rock') return false;
    if (t === 'wall') {
      if (!main) return false;
      gates.add(id(x, y));
    }
    if (wet(t)) {
      if (!main) return false;
      if (t !== 'bridge') bridges++;
      cells[y][x].terrain = 'bridge';
    } else if (t !== 'plaza' || surface === 'plaza') cells[y][x].terrain = surface;
    streets[id(x, y)] = 1;
    return true;
  }
  function lane({ points, radius, surface, main }: Stroke) {
    const centreline: Point[] = [];
    const record = (x: number, y: number) => {
      const cx = Math.round(x), cy = Math.round(y);
      const last = centreline[centreline.length - 1];
      if (!inside(cx, cy) || last && last.x === cx && last.y === cy) return;
      centreline.push({ x: cx, y: cy });
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[Math.max(0, i - 2)], b = points[i - 1], c = points[i], d = points[Math.min(points.length - 1, i + 1)];
      const samples = Math.max(4, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) * 3));
      const curve = (p: number, q: number, r: number, z: number, t: number) =>
        .5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - z) * t * t + (3 * q - p - 3 * r + z) * t * t * t);
      for (let j = 0; j <= samples; j++) {
        const t = j / samples, x = curve(a.x, b.x, c.x, d.x, t), y = curve(a.y, b.y, c.y, d.y, t);
        let painted = false;
        for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) {
          if (Math.hypot(x - xx, y - yy) <= radius && paint(xx, yy, surface, main)) painted = true;
        }
        if (painted) record(x, y);
      }
    }
    if (centreline.length >= 2) lanes.push({ points: centreline, width: Math.max(1, Math.round(radius * 2)), surface: surface === 'plaza' ? 'plaza' : 'road' });
  }

  // ---- Площадь ---------------------------------------------------------------
  const tight = Math.min(w, h) < 36;
  const plazaSize = type.plaza === 'large' ? { w: between(Math.floor(w * .2), tight ? 6 : 8, 14), h: between(Math.floor(h * .22), tight ? 5 : 6, 10) }
    : type.plaza === 'small' ? { w: between(Math.floor(w * .14), 5, 8), h: between(Math.floor(h * .15), 4, 6) } : undefined;
  // Новый рынок: архетип и место — до улиц, чтобы улицы входили в площадь.
  // Тип поселения без площади (хутор) и крепость (двор цитадели) рынка не получают.
  const placedMarket = plazaSize && s.publicSpaces && !keepFree && modernMarket(s.marketArchetype)
    ? resolveMarketSite(s.marketArchetype, { style: type.style, settlementType: type.id, water: geography === 'coast' ? 'coast' : river.length ? 'river' : 'none', width: w, height: h, seed }, {
      width: w, height: h, cells, anchor: centre, scale: type.plaza === 'small' ? .8 : 1,
      // Внутри стены и не вплотную к ней: у стены — обход и башни.
      blocked: (x, y) => reserved[id(x, y)] === 1 || walled && wallAt(wallRings[0], x, y) > .84,
    })
    : undefined;
  const marketResolution = placedMarket?.resolution, marketSite = placedMarket?.site;
  if (marketResolution && !marketSite) notes.push('рынок не поместился на ровной сухой земле: прежняя площадь');
  // У крепости роль площади играет двор вокруг цитадели.
  const plaza: Selection | undefined = marketSite ? { ...marketSite.bounds } : plazaSize && s.publicSpaces && !keepFree ? {
    x: between(centre.x - Math.floor(plazaSize.w / 2), 1, w - plazaSize.w - 1),
    y: between(centre.y - Math.floor(plazaSize.h / 2), 1, h - plazaSize.h - 1),
    w: plazaSize.w, h: plazaSize.h,
  } : undefined;
  const plazaOk = plaza && (marketSite ? true : (() => {
    let dry = 0;
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) for (let x = plaza.x; x < plaza.x + plaza.w; x++) if (usable(x, y)) dry++;
    return dry >= plaza.w * plaza.h * .85;
  })());
  if (plaza && !plazaOk) notes.push('площадь не поместилась на сухой земле');

  // ---- 4. Улицы по планировке ---------------------------------------------
  const main = town ? 'plaza' as Terrain : 'road' as Terrain;
  // На тесной карте улицы уже: иначе кварталы между ними не вмещают домов.
  const R = type.street * (tight ? .78 : 1);
  const strokes: Stroke[] = [];
  /** Точка на краю карты по направлению из центра. */
  const toEdge = (angle: number): Point => {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const tx = dx > 0 ? (w + 1 - centre.x) / dx : dx < 0 ? (-2 - centre.x) / dx : Infinity;
    const ty = dy > 0 ? (h + 1 - centre.y) / dy : dy < 0 ? (-2 - centre.y) / dy : Infinity;
    const t = Math.min(tx, ty);
    return { x: centre.x + dx * t, y: centre.y + dy * t };
  };
  const ellipse = (k: number, jitter: number, salt: number): Point[] => {
    const n = 14;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = k * (1 + (hash2(i, salt, seed + 0x2a) - .5) * jitter);
      return { x: centre.x + Math.cos(a) * RX * r, y: centre.y + Math.sin(a) * RY * r };
    });
    return [...pts, pts[0], pts[1]];
  };
  const bend = (a: Point, b: Point, amount: number, salt: number): Point[] => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const off = (hash2(Math.round(a.x * 3 + b.x), Math.round(a.y * 3 + b.y), seed + salt) - .5) * amount * len;
    return [a, { x: mx - (b.y - a.y) / len * off, y: my + (b.x - a.x) / len * off }, b];
  };
  const spokes = (count: number, start: number, mainCount: number, salt: number) => {
    for (let i = 0; i < count; i++) {
      const angle = start + (i / count) * Math.PI * 2 + (hash2(i, salt, seed) - .5) * .35;
      const end = toEdge(angle);
      strokes.push({ points: bend(centre, end, .12, salt + i), radius: i < mainCount ? R : R * .82, surface: i < mainCount ? main : 'road', main: i < mainCount });
    }
  };
  // Ось «вдоль» поселения: у моря и на склоне — по горизонтали, иначе по длинной стороне.
  const axisAlongEdge = geography !== 'plain';
  const horizontal = axisAlongEdge ? side <= 1 : w >= h;
  const axisLine = (offset: number, extent: number, wobble: number, salt: number): Point[] => {
    const pts: Point[] = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = -extent + (2 * extent * i) / n;
      const o = offset + (hash2(i, salt, seed + 0x3b) - .5) * wobble;
      pts.push(horizontal ? { x: centre.x + t * RX, y: centre.y + o * RY } : { x: centre.x + o * RX, y: centre.y + t * RY });
    }
    return pts;
  };
  const crossLine = (at0: number, from: number, to: number, salt: number): Point[] => {
    const pts: Point[] = [];
    for (let i = 0; i <= 3; i++) {
      const t = from + ((to - from) * i) / 3;
      const o = at0 + (hash2(i, salt, seed + 0x4c) - .5) * .05;
      pts.push(horizontal ? { x: centre.x + o * RX, y: centre.y + t * RY } : { x: centre.x + t * RX, y: centre.y + o * RY });
    }
    return pts;
  };
  const edgeReach = Math.max(w / RX, h / RY);
  const grid = (core: number) => {
    // Главные оси до краёв карты, остальное — решётка кварталов внутри области.
    strokes.push({ points: axisLine(0, edgeReach, .04, 1), radius: R, surface: main, main: true });
    strokes.push({ points: crossLine(0, -edgeReach, edgeReach, 2), radius: R, surface: main, main: true });
    const bx = (town ? 9.5 : 12) / RX, by = (town ? 8.5 : 11) / RY;
    const stepAlong = horizontal ? bx : by, stepAcross = horizontal ? by : bx;
    for (let k = 1; k * stepAcross < 1.02; k++) for (const sign of [-1, 1]) {
      const o = sign * k * stepAcross;
      if (Math.abs(o) < core) continue;
      strokes.push({ points: axisLine(o, Math.sqrt(Math.max(.05, 1 - o * o)), .03, 10 + k * sign), radius: R * .7, surface: 'road', main: false });
    }
    for (let k = 1; k * stepAlong < 1.02; k++) for (const sign of [-1, 1]) {
      const o = sign * k * stepAlong;
      if (Math.abs(o) < core) continue;
      const extent = Math.sqrt(Math.max(.05, 1 - o * o));
      strokes.push({ points: crossLine(o, -extent, extent, 30 + k * sign), radius: R * .7, surface: 'road', main: false });
    }
  };
  const organic = (radius: number, count: number, exits: number) => {
    const nodes: Point[] = [{ ...centre }];
    for (let attempt = 0; attempt < count * 30 && nodes.length < count + 1; attempt++) {
      const a = hash2(attempt, 1, seed + 0x5d) * Math.PI * 2, r = Math.sqrt(hash2(attempt, 2, seed + 0x5d)) * radius;
      const p = { x: centre.x + Math.cos(a) * RX * r, y: centre.y + Math.sin(a) * RY * r };
      if (!inside(Math.round(p.x), Math.round(p.y)) || !usable(Math.round(p.x), Math.round(p.y))) continue;
      if (nodes.some((q) => Math.hypot((q.x - p.x) / RX, (q.y - p.y) / RY) < radius * .3)) continue;
      nodes.push(p);
    }
    // Остов (Прим) + несколько коротких колец.
    const linked = [0], rest = nodes.map((_, i) => i).slice(1), edges: [number, number][] = [];
    while (rest.length) {
      let best: [number, number, number] | undefined;
      for (const a of linked) for (const b of rest) {
        const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
        if (!best || d < best[2]) best = [a, b, d];
      }
      edges.push([best![0], best![1]]);
      linked.push(best![1]);
      rest.splice(rest.indexOf(best![1]), 1);
    }
    for (let i = 1; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < Math.min(RX, RY) * radius * .55 && hash2(i, j, seed + 0x6e) < .3 && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
    }
    edges.forEach(([a, b], index) => strokes.push({ points: bend(nodes[a], nodes[b], .25, 70 + index), radius: R * (a === 0 || b === 0 ? .9 : .66), surface: 'road', main: false }));
    // Выезды: главные улицы от центра к краям.
    spokes(exits, hash2(seed, 4, 0x7f) * Math.PI * 2, exits, 90);
  };

  if (s.road || layout !== 'linear') {
    switch (layout) {
      case 'radial': {
        spokes(town ? 6 + Math.floor(hash2(seed, 1, 0x91) * 2) : 4 + Math.floor(hash2(seed, 1, 0x91) * 2), hash2(seed, 2, 0x91) * Math.PI * 2, town ? 3 : 2, 100);
        strokes.push({ points: ellipse(.5, .12, 1), radius: R * .72, surface: 'road', main: false });
        if (town && !small) strokes.push({ points: ellipse(.8, .08, 2), radius: R * .66, surface: 'road', main: false });
        break;
      }
      case 'ring': {
        strokes.push({ points: ellipse(.36, .1, 3), radius: R * .8, surface: main, main: false });
        strokes.push({ points: ellipse(.66, .08, 4), radius: R * .72, surface: 'road', main: false });
        if (!small && (type.id === 'large_city' || type.extent > .9)) strokes.push({ points: ellipse(walled ? .8 : .95, .05, 5), radius: R * .66, surface: 'road', main: false });
        spokes(4, Math.PI / 4 + (hash2(seed, 3, 0x92) - .5) * .5, 4, 120);
        break;
      }
      case 'grid': grid(0); break;
      case 'mixed': {
        organic(.5, town ? 7 : 5, 0);
        grid(.42);
        break;
      }
      case 'organic': organic(.95, town ? 13 : 8, town ? 3 : 2); break;
      case 'compact': {
        strokes.push({ points: axisLine(0, edgeReach, .05, 1), radius: R, surface: main, main: true });
        strokes.push({ points: crossLine(0, -edgeReach, edgeReach, 2), radius: R * .9, surface: main, main: true });
        strokes.push({ points: ellipse(.5, .15, 6), radius: R * .55, surface: 'road', main: false });
        // Короткие переулки от главных улиц.
        for (let i = 0; i < (town ? 10 : 6); i++) {
          const t = (hash2(i, 1, seed + 0xa3) - .5) * 1.4, sign = hash2(i, 2, seed + 0xa3) > .5 ? 1 : -1;
          const onAxis = i % 2 === 0;
          const start = onAxis === horizontal ? { x: centre.x + t * RX, y: centre.y } : { x: centre.x, y: centre.y + t * RY };
          const len = .35 + hash2(i, 3, seed + 0xa3) * .3;
          const end = onAxis === horizontal ? { x: start.x, y: start.y + sign * len * RY } : { x: start.x + sign * len * RX, y: start.y };
          strokes.push({ points: [start, end], radius: R * .52, surface: 'road', main: false });
        }
        break;
      }
      case 'linear': {
        // Главная улица вдоль берега/склона/длинной стороны, поперечные проулки.
        strokes.push({ points: axisLine(0, edgeReach, .18, 1), radius: R, surface: main, main: true });
        if (!small && town) strokes.push({ points: axisLine(hash2(seed, 5, 0x94) > .5 ? .5 : -.5, .8, .1, 3), radius: R * .7, surface: 'road', main: false });
        const step = (town ? 9 : 11) / (horizontal ? RX : RY);
        for (let k = -Math.floor(1 / step); k <= Math.floor(1 / step); k++) {
          if (k === 0) continue;
          const reachAcross = .55 + hash2(k, 1, seed + 0x95) * .35;
          strokes.push({ points: crossLine(k * step, -reachAcross, reachAcross, 40 + k), radius: R * .62, surface: 'road', main: false });
        }
        break;
      }
    }
  }
  // Мощёная площадь закрашивается заранее; грунт и луг нового рынка красит
  // планировщик рынка по своему контуру (углы неровного пятна остаются улицами/травой).
  if (plaza && plazaOk && (!marketResolution || marketResolution.archetype.surface === 'square'))
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) for (let x = plaza.x; x < plaza.x + plaza.w; x++) paint(x, y, 'plaza', false);
  // Тесная карта: главные улицы и не больше двух второстепенных — иначе вся
  // площадь внутри стен уходит под мостовую.
  const secondary = strokes.filter((stroke) => !stroke.main);
  const drawn = tight ? [...strokes.filter((stroke) => stroke.main), ...secondary.slice(0, 2)] : strokes;
  if (tight && drawn.length < strokes.length) notes.push(`тесная карта: проложено ${drawn.length} улиц из ${strokes.length}`);
  for (const stroke of drawn) lane(stroke);
  // Грунтовый рынок временно закрашивается дорогой целиком: улицы сходятся к
  // нему и не должны распасться на куски до планировки рынка. После планировки
  // клетки прямоугольника вне контура рынка возвращаются к прежнему грунту.
  const marketPrepaint: { i: number; terrain: Terrain }[] = [];
  if (marketSite && marketResolution && marketResolution.archetype.surface !== 'square') {
    const { x: mx, y: my, w: mw, h: mh } = marketSite.bounds;
    for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) {
      if (streets[id(x, y)] || !usable(x, y)) continue;
      marketPrepaint.push({ i: id(x, y), terrain: terrain(x, y) });
      paint(x, y, 'road', false);
    }
  }
  /**
   * Возвращает прежний грунт клеткам временной заливки вне контура рынка.
   * Остаются дорогой только клетки, по которым улица снаружи доходит до рынка
   * (кратчайший путь от площади к соседней улице) и клетки улиц у входов.
   */
  function restorePrepaint(area: Uint8Array, keepCells: number[]) {
    const pre = new Map(marketPrepaint.filter(({ i }) => !area[i]).map(({ i, terrain: t }) => [i, t]));
    if (!pre.size) return;
    const keep = new Set(keepCells.filter((i) => pre.has(i)));
    const parent = new Map<number, number>();
    const queue: number[] = [];
    for (let i = 0; i < w * h; i++) if (area[i]) { parent.set(i, -1); queue.push(i); }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k], x = c % w, y = (c - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy, n = id(nx, ny);
        if (!inside(nx, ny) || parent.has(n)) continue;
        if (pre.has(n)) { parent.set(n, c); queue.push(n); continue; }
        // Настоящая улица снаружи у залитой клетки: путь от неё к площади сохраняем.
        if (pre.has(c) && streets[n] && !area[n]) for (let p = c; p >= 0 && pre.has(p); p = parent.get(p) ?? -1) keep.add(p);
      }
    }
    for (const [i, before] of pre) if (!keep.has(i)) {
      cells[(i - i % w) / w][i % w].terrain = before;
      streets[i] = 0;
    }
  }
  /** Индекс кольцевой улицы вокруг рынка в lanes (−1 — её нет). */
  let ringLane = -1;
  if (marketSite && marketResolution?.archetype.ringRoad && s.road) {
    const { x, y, w: mw, h: mh } = marketSite.bounds;
    // Явное кольцо клеток (сплайн по углам прямоугольника вылетает наружу).
    const ring: Point[] = [];
    for (let xx = x - 1; xx <= x + mw; xx++) ring.push({ x: xx, y: y - 1 });
    for (let yy = y; yy <= y + mh; yy++) ring.push({ x: x + mw, y: yy });
    for (let xx = x + mw - 1; xx >= x - 1; xx--) ring.push({ x: xx, y: y + mh });
    for (let yy = y + mh - 1; yy >= y - 1; yy--) ring.push({ x: x - 1, y: yy });
    const painted = ring.filter((p) => paint(p.x, p.y, 'road', false));
    if (painted.length) { ringLane = lanes.length; lanes.push({ points: ring, width: 1, surface: 'road' }); }
  }
  if (keepBox && keepFree) {
    // Обход — ровное кольцо клеток (сплайн по углам прямоугольника вылетает наружу).
    const { x, y, w: kw, h: kh } = keepBox;
    const ring: Point[] = [];
    for (let xx = x - 1; xx <= x + kw; xx++) ring.push({ x: xx, y: y - 1 });
    for (let yy = y; yy <= y + kh; yy++) ring.push({ x: x + kw, y: yy });
    for (let xx = x + kw - 1; xx >= x - 1; xx--) ring.push({ x: xx, y: y + kh });
    for (let yy = y + kh - 1; yy >= y - 1; yy--) ring.push({ x: x - 1, y: yy });
    for (const p of ring) paint(p.x, p.y, main, false);
    lanes.push({ points: ring, width: 1, surface: main === 'plaza' ? 'plaza' : 'road' });
  }

  // Набережная у моря: вдоль берега, на суше.
  let quay: Point[] = [];
  if (geography === 'coast') {
    for (let a = 0; a < length; a++) {
      for (let d = 0; d < span; d++) {
        const p = at(a, d);
        if (!inside(p.x, p.y)) break;
        if (usable(p.x, p.y)) {
          const q = at(a, d + 1);
          if (inside(q.x, q.y) && usable(q.x, q.y) && reach(q.x, q.y) < 1.15) quay.push(q);
          break;
        }
      }
    }
    quay = quay.filter((_, i) => i % 3 === 0);
    if (quay.length >= 2) lane({ points: quay, radius: .7, surface: 'road', main: false });
  }

  // Связность сети: оставляем компоненту, где центр/площадь, остальные убираем.
  {
    const comp = new Int32Array(w * h).fill(-1);
    const sizes: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!streets[i] || comp[i] >= 0) continue;
      const label = sizes.length, stack = [i];
      comp[i] = label;
      let size = 0;
      while (stack.length) {
        const c = stack.pop()!, x = c % w, y = (c - x) / w;
        size++;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx, ny = y + dy, n = id(nx, ny);
          if (inside(nx, ny) && streets[n] && comp[n] < 0) { comp[n] = label; stack.push(n); }
        }
      }
      sizes.push(size);
    }
    const keep = sizes.indexOf(Math.max(...sizes, 0));
    for (let i = 0; i < w * h; i++) if (streets[i] && comp[i] !== keep) {
      const x = i % w, y = (i - x) / w;
      streets[i] = 0;
      cells[y][x].terrain = gates.has(i) ? 'wall' : cells[y][x].terrain === 'bridge' ? 'water' : 'dirt';
      gates.delete(i);
    }
  }

  // Ворота и башни: группы пробитых стен; башни — по обе стороны ворот и по кругу.
  const towers: Point[] = [];
  let gateCount = 0;
  {
    const seen = new Set<number>();
    for (const g of gates) {
      if (seen.has(g)) continue;
      gateCount++;
      const stack = [g];
      seen.add(g);
      const group: number[] = [];
      while (stack.length) {
        const c = stack.pop()!;
        group.push(c);
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const n = id(x + dx, y + dy);
          if (gates.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      for (const c of group) {
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of NEIGHBOURS) if (inside(x + dx, y + dy) && terrain(x + dx, y + dy) === 'wall' && !towers.some((t) => t.x === x + dx && t.y === y + dy)) towers.push({ x: x + dx, y: y + dy });
      }
    }
    for (const ring of wallRings) {
      const n = Math.max(6, Math.round((RX + RY) * ring * .45));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = wallRadii(ring);
        const p = { x: Math.round(centre.x + Math.cos(a) * r.x), y: Math.round(centre.y + Math.sin(a) * r.y) };
        let best: Point | undefined, bd = Infinity;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = p.x + dx, y = p.y + dy;
          if (inside(x, y) && terrain(x, y) === 'wall' && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); best = { x, y }; }
        }
        if (best && !towers.some((t) => Math.abs(t.x - best!.x) + Math.abs(t.y - best!.y) < 3)) towers.push(best);
      }
    }
  }
  if (walled && !gateCount) notes.push('нет ворот: улицы не пересекли стену');

  // ---- 5. Площадь, рынок и мелочи -------------------------------------------
  let marketArea: Uint8Array | undefined;
  function add(kind: CivicKind, x: number, y: number, w1 = CIVIC_KIT[kind].w, h1 = CIVIC_KIT[kind].h, variant = 0, rotation: ChestRotation = 0) {
    const item: CivicObject = { x, y, w: w1, h: h1, kind, variant: variant % 2, rotation, source: 'layout' };
    for (let yy = y; yy < y + h1; yy++) for (let xx = x; xx < x + w1; xx++) {
      if (!inside(xx, yy) || wet(terrain(xx, yy)) || terrain(xx, yy) === 'rock' || terrain(xx, yy) === 'wall') return false;
      // Клетки нового рынка зарезервированы под площадь, но предметы рынка на них ставятся.
      if (kind !== 'square' && reserved[id(xx, yy)] && !marketArea?.[id(xx, yy)]) return false;
    }
    if (civic.some((other) => other.kind !== 'square' && kind !== 'square' && intersects(other, item))) return false;
    civic.push(item);
    for (let yy = y; yy < y + h1; yy++) for (let xx = x; xx < x + w1; xx++) {
      reserved[id(xx, yy)] = 1;
      if (kind === 'garden' && !streets[id(xx, yy)]) cells[yy][xx].terrain = 'dirt';
    }
    return true;
  }
  const richness = between(s.marketRichness ?? .62, 0, 1);
  let market: MarketOutcome | undefined, marketPiers = 0;
  const marketTrees: Tree[] = [];
  if (plaza && marketSite && marketResolution) {
    // Новый рынок: тот же планировщик, что и у классического поселения.
    const plan = planMarket({
      width: w, height: h, cells, seed, resolution: marketResolution, style: s.marketStyle ?? 'auto', richness,
      town, bounds: marketSite.bounds, shore: marketSite.shore, streets, ring: ringLane >= 0,
      lanes: lanes.filter((_, index) => index !== ringLane),
      blocked: (x, y) => reserved[id(x, y)] === 1,
    });
    market = finishMarket(plan, marketResolution.archetype, streets);
    marketArea = plan.area;
    market.report.notes.unshift(...marketSite.notes);
    if (plan.surface === 'square') add('square', plaza.x, plaza.y, plaza.w, plaza.h, town ? 0 : 1);
    applyMarketGround(plan, cells);
    restorePrepaint(plan.area, plan.entrances.map((e) => id(e.street.x, e.street.y)));
    // Вся площадь — общественное место: дома к ней выходят, но не строятся на ней.
    for (let i = 0; i < w * h; i++) if (plan.area[i]) { reserved[i] = 1; streets[i] = 1; }
    for (const path of plan.paths) if (plan.surface !== 'square') lanes.push({ points: path.points, width: path.width, surface: 'road' });
    const waterfront = marketWaterfront(plan, { width: w, height: h, cells, blocked: (x, y) => reserved[id(x, y)] === 1 }, seed);
    for (const p of waterfront.quay) paint(p.x, p.y, 'road', false);
    for (const p of waterfront.pier) { cells[p.y][p.x].terrain = 'bridge'; streets[id(p.x, p.y)] = 1; }
    if (waterfront.pier.length) { lanes.push({ points: [...waterfront.quay.slice(-1), ...waterfront.pier], width: 1, surface: 'road' }); marketPiers++; }
    for (const it of waterfront.cargo) if (it.threshold <= plan.richness + 1e-9) add(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation);
    for (const it of plan.items) if (!add(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation)) market.report.notes.push(`не поставлен ${it.kind} (${it.x},${it.y})`);
    marketTrees.push(...plan.trees);
  } else if (plaza && plazaOk) {
    add('square', plaza.x, plaza.y, plaza.w, plaza.h, town ? 0 : 1);
    const cx = plaza.x + Math.floor(plaza.w / 2), cy = plaza.y + Math.floor(plaza.h / 2);
    add(type.plaza === 'large' && town ? 'fountain' : 'marketWell', cx - 1, cy - 1, 2, 2, 0);
    // Ряды торговцев по краям площади; середина и подходы свободны.
    const marketWeight = (type.districts.market ?? 0) + (type.districts.docks ?? 0) * .5;
    const limit = Math.round((2 + marketWeight * 1.6) * (.4 + richness));
    let placed = 0;
    const slots: Point[] = [];
    for (let x = plaza.x + 1; x + 2 <= plaza.x + plaza.w - 1; x += 3) slots.push({ x, y: plaza.y + 1 }, { x, y: plaza.y + plaza.h - 3 });
    for (const p of slots) {
      if (placed >= limit || plaza.h < 6) break;
      if (Math.abs(p.x + 1 - cx) < 2) continue;
      const pool = (p.x + p.y) % 2 ? TENTS : STALLS;
      if (add(pool[Math.floor(hash2(p.x, p.y, seed + 0xb1) * pool.length)], p.x, p.y, 2, 2, p.x)) placed++;
    }
    if (richness > .3) add('marketNoticeBoard', plaza.x, plaza.y + Math.floor(plaza.h / 2), 1, 1, 0);
    if (richness > .5) add('cart', plaza.x + plaza.w - 2, plaza.y + plaza.h - 1, 1, 1, 0);
  }

  // ---- 6. Кварталы ------------------------------------------------------------
  const kinds = (Object.entries(type.districts) as [DistrictKind, number][]).filter(([kind]) => kind !== 'centre' || (plaza && plazaOk) || type.keep);
  const totalWeight = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  const area = land.length;
  const seedCount = between(Math.round(area / (town ? 260 : 340)), Math.min(kinds.length, 3), 14);
  // Расстояние до воды/стены/главной улицы — для правил кварталов.
  const distanceFrom = (source: (x: number, y: number) => boolean) => {
    const dist = new Uint16Array(w * h).fill(999);
    const queue: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (source(x, y)) { dist[id(x, y)] = 0; queue.push(id(x, y)); }
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i], x = c % w, y = (c - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const n = id(x + dx, y + dy);
        if (!inside(x + dx, y + dy) || dist[n] <= dist[c] + 1) continue;
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
    return dist;
  };
  const toWater = distanceFrom((x, y) => wet(terrain(x, y)) && terrain(x, y) !== 'bridge');
  const toWall = distanceFrom((x, y) => terrain(x, y) === 'wall' || gates.has(id(x, y)));
  const toGate = distanceFrom((x, y) => gates.has(id(x, y)));
  const insideWalls = (x: number, y: number) => !walled || wallAt(wallRings[0], x, y) < 1;
  const score: Record<DistrictKind, (x: number, y: number, r: number) => number> = {
    centre: (_x, _y, r) => r * 3,
    market: (_x, _y, r) => Math.abs(r - .3) * 2.5,
    temple: (x, y, r) => Math.abs(r - .35) * 2 - cells[y][x].height,
    noble: (x, y, r) => Math.abs(r - .55) * 1.5 - cells[y][x].height * 2 + (toWater[id(x, y)] < 4 ? .8 : 0),
    residential: (_x, _y, r) => Math.abs(r - .65) * 1.2,
    craft: (x, y, r) => (toWater[id(x, y)] < 999 ? Math.min(toWater[id(x, y)], 12) / 6 : Math.abs(r - .8) * 2) + (walled ? Math.min(toGate[id(x, y)], 20) / 20 : 0),
    docks: (x, y) => Math.min(toWater[id(x, y)], 30) / 3,
    garrison: (x, y, r) => type.keep ? r * 2 : Math.min(toGate[id(x, y)] < 999 ? toGate[id(x, y)] : toWall[id(x, y)] < 999 ? toWall[id(x, y)] : 40, 40) / 6 + Math.abs(r - .8),
    farms: (_x, _y, r) => Math.abs(r - 1.1) * 2,
    poor: (x, y, r) => (walled ? (insideWalls(x, y) ? 1.5 : 0) + Math.abs(r - 1.02) : Math.abs(r - .9) * 1.5) + (toWater[id(x, y)] < 6 ? -.3 : 0),
  };
  const plannedSeeds: DistrictKind[] = [];
  for (const [kind, weight] of kinds) {
    const count = kind === 'centre' ? 1 : Math.max(1, Math.round((weight / totalWeight) * seedCount));
    for (let i = 0; i < count; i++) plannedSeeds.push(kind);
  }
  const candidatesAt: Point[] = [];
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) if (usable(x, y) && reach(x, y) < 1.3) candidatesAt.push({ x, y });
  const districts: { kind: DistrictKind; x: number; y: number }[] = [];
  const spacing = Math.min(RX, RY) * .42;
  for (const kind of plannedSeeds) {
    let best: Point | undefined, bestScore = Infinity;
    for (const p of candidatesAt) {
      if (districts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < spacing * (d.kind === kind ? 1.4 : 1))) continue;
      if (kind === 'docks' && toWater[id(p.x, p.y)] > 8) continue;
      const value = score[kind](p.x, p.y, reach(p.x, p.y)) + hash2(p.x, p.y, seed + kind.length * 131) * .35;
      if (value < bestScore) { bestScore = value; best = p; }
    }
    if (best) districts.push({ kind, ...best });
    else if (kind === 'docks') notes.push('порт без причалов: нет воды рядом с застройкой');
  }
  const districtAt = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!usable(x, y)) continue;
    let best = -1, bd = Infinity;
    districts.forEach((d, index) => {
      const dd = Math.hypot(d.x - x, d.y - y) / (d.kind === 'farms' ? 1.3 : 1);
      if (dd < bd) { bd = dd; best = index; }
    });
    const limit = best >= 0 && districts[best].kind === 'farms' ? 1.45 : best >= 0 && districts[best].kind === 'poor' ? 1.25 : 1.12;
    if (best >= 0 && reach(x, y) <= limit) districtAt[id(x, y)] = best;
  }

  // Причалы: от набережной в воду в портовом квартале.
  let piers = marketPiers;
  if (geography === 'coast' && districts.some((d) => d.kind === 'docks')) {
    const docks = districts.filter((d) => d.kind === 'docks');
    const pierCount = between(Math.round(length / 14), 2, 5);
    for (let i = 0; i < pierCount; i++) {
      const a = Math.round(length * (.12 + (.76 * (i + .5)) / pierCount) + (hash2(i, 1, seed + 0xc4) - .5) * 4);
      let landD = -1;
      for (let d = 0; d < span; d++) { const p = at(a, d); if (inside(p.x, p.y) && usable(p.x, p.y)) { landD = d; break; } }
      if (landD < 2) continue;
      const head = at(a, landD);
      if (!docks.some((d) => Math.hypot(d.x - head.x, d.y - head.y) < Math.max(RX, RY) * .7)) continue;
      const len = between(Math.round(landD * .6), 2, 7);
      for (let k = 1; k <= len; k++) {
        const p = at(a, landD - k);
        if (!inside(p.x, p.y) || !wet(terrain(p.x, p.y))) break;
        cells[p.y][p.x].terrain = 'bridge';
        streets[id(p.x, p.y)] = 1;
      }
      // Связь причала с набережной и груз на берегу.
      for (let k = 0; k <= 2; k++) { const p = at(a, landD + k); if (inside(p.x, p.y) && usable(p.x, p.y)) paint(p.x, p.y, 'road', false); }
      const goods = at(a + 2, landD + 1);
      add(GOODS[i % GOODS.length], goods.x, goods.y, 1, 1, i);
      piers++;
    }
  }

  // Сады при хуторах и усадьбах.
  for (let i = 0; i < 40; i++) {
    const x = 2 + Math.floor(hash2(i, 1, seed + 0xd5) * (w - 6)), y = 2 + Math.floor(hash2(i, 2, seed + 0xd5) * (h - 5));
    const d = districtAt[id(x, y)];
    if (d < 0 || (districts[d].kind !== 'farms' && districts[d].kind !== 'noble') || streets[id(x, y)]) continue;
    if (hash2(i, 3, seed + 0xd5) > (districts[d].kind === 'farms' ? .6 : .35)) continue;
    let clear = true;
    for (let yy = y; yy < y + 2 && clear; yy++) for (let xx = x; xx < x + 3; xx++) if (!usable(xx, yy) || streets[id(xx, yy)]) { clear = false; break; }
    if (clear) add('garden', x, y, 3, 2, i);
  }
  // Телеги у ворот изнутри.
  {
    let carts = 0;
    for (const g of gates) {
      if (carts >= 3) break;
      const x = g % w, y = (g - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx * 2, ny = y + dy * 2;
        if (inside(nx, ny) && usable(nx, ny) && !streets[id(nx, ny)] && insideWalls(nx, ny) && add('cart', nx, ny, 1, 1, carts)) { carts++; break; }
      }
    }
  }

  // ---- 7. Участки ------------------------------------------------------------
  const road: Point[] = [], queue: number[] = [];
  const distance = new Uint16Array(w * h).fill(999);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (streets[id(x, y)]) {
    road.push({ x, y });
    distance[id(x, y)] = 0;
    queue.push(id(x, y));
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i], x = c % w, y = (c - x) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy, n = id(nx, ny);
      if (!inside(nx, ny) || distance[n] < 999 || !usable(nx, ny)) continue;
      distance[n] = distance[c] + 1;
      queue.push(n);
    }
  }
  // Стена рисуется лентой шире клетки: дома держим на клетку от неё.
  const nearWall = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (terrain(x, y) === 'wall') {
    for (const [dx, dy] of NEIGHBOURS) if (inside(x + dx, y + dy)) nearWall[id(x + dx, y + dy)] = 1;
  }
  const fits = (r: Selection) => {
    if (r.x < 1 || r.y < 1 || r.x + r.w > w - 1 || r.y + r.h > h - 1) return false;
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
      if (streets[id(xx, yy)] || reserved[id(xx, yy)] || !usable(xx, yy) || districtAt[id(xx, yy)] < 0 || nearWall[id(xx, yy)]) return false;
    }
    return true;
  };
  const pickWeighted = <T,>(options: readonly [T, number][], roll: number): T => {
    const total = options.reduce((sum, [, weight]) => sum + weight, 0);
    let value = roll * total;
    for (const [option, weight] of options) { value -= weight; if (value < 0) return option; }
    return options[options.length - 1][0];
  };
  const candidates: { lot: Building; out: Point; score: number; district: number }[] = [];
  const onMarket = (p: Point) => market !== undefined && facesMarket(market.plan, p.x, p.y, streets);
  const maxDist = town ? 6 : 8;
  for (let y = 1; y < h - 2; y++) for (let x = 1; x < w - 2; x++) {
    const home = districtAt[id(x, y)];
    if (home < 0) continue;
    const def = DISTRICTS[districts[home].kind];
    // Три варианта по меркам квартала и два ужатых — для тесных кварталов между улицами.
    for (let option = 0; option < 5; option++) {
      const taste = hash2(x, y, seed + 7191 + option * 71), turn = hash2(x, y, seed + 3421 + option * 74);
      const tight = option >= 3 ? option - 2 : 0;
      const len = Math.max(4, def.length[0] + Math.floor(taste * (def.length[1] - def.length[0] + 1)) - tight * 2);
      const dep = Math.max(3, def.depth[0] + Math.floor(hash2(x, y, seed + 5003 + option) * (def.depth[1] - def.depth[0] + 1)) - tight);
      const kind = pickWeighted(def.kinds, hash2(x, y, seed + 9001 + option * 13));
      const square = kind === 'tower' ? Math.min(len, dep, 5) : 0;
      const plan = square ? { x, y, w: square, h: square } : { x, y, w: turn > .5 ? dep : len, h: turn > .5 ? len : dep };
      if (!fits(plan)) continue;
      const hx = x + Math.floor(plan.w / 2), hy = y + Math.floor(plan.h / 2);
      const edges = [
        { door: { x: hx, y }, out: { x: hx, y: y - 1 }, facing: 180 },
        { door: { x: hx, y: y + plan.h - 1 }, out: { x: hx, y: y + plan.h }, facing: 0 },
        { door: { x, y: hy }, out: { x: x - 1, y: hy }, facing: 90 },
        { door: { x: x + plan.w - 1, y: hy }, out: { x: x + plan.w, y: hy }, facing: 270 },
      ].filter(({ out }) => inside(out.x, out.y) && usable(out.x, out.y) && !civic.some((item) => item.kind !== 'square' && contains(item, out.x, out.y))
        && !(market && market.occupied[id(out.x, out.y)]));
      // Дом у рынка смотрит дверью на площадь (лавка, мастерская, склад).
      const entry = edges.sort((a, b) => (Number(onMarket(b.out)) - Number(onMarket(a.out))) * 100 + distance[id(a.out.x, a.out.y)] - distance[id(b.out.x, b.out.y)])[0];
      if (!entry) continue;
      const dist = distance[id(entry.out.x, entry.out.y)];
      if (road.length && dist > maxDist) continue;
      const roofs = def.roofs[style];
      const frontage = market && marketResolution && onMarket(entry.out) ? marketResolution.archetype.frontage : undefined;
      const lotKind = frontage && kind !== 'tower' ? pickWeighted(frontage as [Building['kind'], number][], hash2(x, y, seed + 0x6f17 + option)) : kind;
      const lot: Building = {
        ...plan, style, kind: lotKind, roof: roofs[Math.floor(hash2(x, y, seed + 2428 + option) * roofs.length)],
        shape: kind === 'tower' ? 'hip' : def.shapes[Math.floor(hash2(x, y, seed + 2611 + option) * def.shapes.length)],
        source: 'layout', door: entry.door, facing: entry.facing as ChestRotation,
      };
      const r = reach(hx, hy);
      const value = hash2(x, y, seed + option * 577 + 6501) * 2.4 * def.appeal - r * (town ? 1.3 : 2.4) - (road.length ? dist * .5 : 0) + (dist <= 1 ? .5 : 0)
        + (kind === 'hall' ? .2 : 0) + (frontage ? .6 : 0);
      candidates.push({ lot, out: entry.out, score: value, district: home });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.lot.y - b.lot.y || a.lot.x - b.lot.x);

  const plots: Building[] = [], plotDistrict: number[] = [], exits: Point[] = [];
  // Цитадель крепости и таверна — первыми: они есть при любой плотности.
  if (keepBox && keepFree) {
    const door = { x: keepBox.x + Math.floor(keepBox.w / 2), y: keepBox.y + keepBox.h - 1 };
    plots.push({ ...keepBox, style, kind: 'tower', roof: style === 'town' ? 3 : 1, shape: 'hip', source: 'layout', door, facing: 0 });
    exits.push({ x: door.x, y: door.y + 1 });
    plotDistrict.push(districtAt[id(door.x, door.y)]);
  } else if (type.keep) notes.push('цитадель не поместилась');
  if (type.style === 'town' || type.id === 'large_village') {
    const tavernFits = ({ lot, district }: typeof candidates[number]) => lot.w * lot.h >= 30 && Math.min(lot.w, lot.h) >= 5
      && ['centre', 'market', 'residential', 'docks'].includes(districts[district].kind);
    // При новом рынке таверна выходит на площадь, если есть такой участок.
    const tavern = (market ? candidates.find((c) => tavernFits(c) && onMarket(c.out)) : undefined) ?? candidates.find(tavernFits);
    if (tavern && !plots.some((other) => intersects(tavern.lot, other, 1))) {
      plots.push({ ...tavern.lot, kind: 'tavern', roof: 5, shape: 'hip' });
      exits.push(tavern.out);
      plotDistrict.push(tavern.district);
    }
  }
  const usableShare = area / Math.max(1, (w - 4) * (h - 4));
  const cap = Math.max(4, Math.floor(w * h * type.fill * between(usableShare, .35, 1)));
  const budgets = new Array<number>(districts.length).fill(0);
  const shareOf = (index: number) => {
    const kind = districts[index].kind;
    const siblings = districts.filter((d) => d.kind === kind).length;
    return ((type.districts[kind] ?? 1) / totalWeight) / siblings;
  };
  let used = plots.reduce((sum, b) => sum + b.w * b.h, 0);

  for (let round = 0; round < 2; round++) {
    for (const { lot, out, district } of candidates) {
      if (used + lot.w * lot.h > cap || round === 0 && budgets[district] > cap * shareOf(district) * 1.05) continue;
      const gap = DISTRICTS[districts[district].kind].gap;
      if (plots.some((other) => other === lot || intersects(lot, other, gap) || contains(other, out.x, out.y)) || exits.some((p) => contains(lot, p.x, p.y))) continue;
      plots.push(lot);
      exits.push(out);
      plotDistrict.push(district);
      used += lot.w * lot.h;
      budgets[district] += lot.w * lot.h;
    }
  }


  // Поселение без улиц (дорога выключена) всё равно получает хотя бы тропу к центру.
  if (!road.length) notes.push('улицы выключены: дома расставлены по кварталам без сети');

  // Мосты — связные группы настила, не считая причалов.
  {
    const seen = new Uint8Array(w * h);
    let groups = 0;
    for (let i = 0; i < w * h; i++) {
      const x0 = i % w, y0 = (i - x0) / w;
      if (seen[i] || terrain(x0, y0) !== 'bridge') continue;
      groups++;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!, x = c % w, y = (c - x) / w;
        for (const [dx, dy] of NEIGHBOURS) {
          const n = id(x + dx, y + dy);
          if (inside(x + dx, y + dy) && !seen[n] && terrain(x + dx, y + dy) === 'bridge') { seen[n] = 1; stack.push(n); }
        }
      }
    }
    bridges = Math.max(0, groups - piers);
  }
  // Мощёные улицы рисуются поверх грунтовых: перекрёсток не рвёт главную улицу.
  lanes.sort((a, b) => Number(a.surface === 'plaza') - Number(b.surface === 'plaza'));
  const report: TypedSettlementPlan['report'] = {
    generator: SETTLEMENT_GENERATOR_VERSION,
    type: type.id,
    label: type.label,
    layout,
    geography,
    river: river.length > 0,
    walls: walled ? type.walls : 'none',
    gates: gateCount,
    towers: towers.length,
    streets: lanes.length,
    bridges,
    piers,
    districts: districts.map((d) => ({ kind: d.kind, label: DISTRICTS[d.kind].label, x: d.x, y: d.y })),
    notes,
    ...(walled && type.walls !== 'none' ? {
      fortification: {
        kind: type.walls,
        rings: wallRings.map((ring) => {
          const r = wallRadii(ring);
          return { cx: centre.x + .5, cy: centre.y + .5, rx: r.x - .5, ry: r.y - .5 };
        }),
        towers: towers.map((t) => ({ ...t })),
      },
    } : {}),
  };
  const value: TypedSettlementPlan = { cells, plots, plotDistrict, civic, road, river, lanes, towers, report, ...(market ? { market, marketTrees } : {}) };
  cached = { key, value };
  return value;
}
