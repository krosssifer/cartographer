/**
 * Процедурный градостроительный планировщик поселений (v2 — Urban Pipeline).
 *
 * Включается полем GenSettings.settlementType (кроме 'classic'); без него
 * работает прежний buildPlan из settlement.ts (золотые карты не меняются).
 *
 * Причинно-следственный конвейер (19 шагов):
 *   1–2. Рельеф, вода, террасы, переправы и карта пригодности (geography.ts);
 *   3–5. Точка зарождения (Origin), центр, укрепления, ворота и граф узлов (nodes.ts);
 *   6,8. Главная и второстепенная уличная сеть (5 уровней иерархии) + мосты (roads.ts);
 *   7.   Исторические фазы роста, районы и городские кварталы с переулками (districts.ts);
 *   9–10. Межевание кварталов на участки (Plots) и их классификация (plots.ts);
 *   11–16. Рынок, фасады зданий, внутренние дворы, доминанты (Landmarks),
 *          окраины и приключенческие цепочки для D&D (landmarks.ts);
 *   17–18. Валидация геометрии, локальная починка и расчёт settlementQualityScore (validate.ts);
 *   19.  Сборка отчёта и слоёв отладки (debug.ts).
 *
 * Порядок построек не зависит от плотности: плотность берёт префикс списка,
 * не сдвигая дороги, стены, ворота, площади и ключевые ориентиры.
 */
import { hash2 } from '../random';
import { CIVIC_KIT, intersects } from '../settlementKit';
import { applyMarketGround, finishMarket, marketWaterfront, planMarket, type MarketOutcome } from './marketLayout';
import type {
  Building,
  Cell,
  ChestRotation,
  CivicKind,
  CivicObject,
  GenSettings,
  Point,
  Rock,
  SettlementStyle,
  Tree,
} from '../types';
import {
  DISTRICTS,
  SETTLEMENT_GENERATOR_VERSION,
  getSettlementType,
  getUrbanCharacter,
  isSettlementLayout,
  isUrbanCharacter,
  type DistrictKind,
  type Geography,
  type GrowthStage,
  type SettlementLayoutId,
  type SettlementTypeDef,
  type SettlementTypeId,
  type UrbanCharacterId,
  type WallKind,
} from './settlementTypes';
import { buildGeography } from './urban/geography';
import { buildUrbanSkeleton } from './urban/nodes';
import { buildUrbanRoadNetwork } from './urban/roads';
import { buildDistrictsAndBlocks } from './urban/districts';
import { subdivideIntoPlots } from './urban/plots';
import { placeBuildingsLandmarksAndDetails } from './urban/landmarks';
import { validateAndRepairUrbanPlan } from './urban/validate';
import { buildSettlementDebugData } from './urban/debug';
import {
  between,
  wet,
  type AdventureChain,
  type RankedCivic,
  type SettlementDebugData,
  type SettlementQualityReport,
  type UrbanContext,
  type UrbanLandmark,
  type UrbanNode,
  type UrbanRouteEdge,
} from './urban/types';

export interface SettlementDistrictReport {
  kind: DistrictKind;
  label: string;
  x: number;
  y: number;
  /** Сколько построек квартала стоит на карте (после плотности). */
  buildings: number;
  area?: number;
  wealth?: number;
  age?: GrowthStage;
}

/** Отчёт планировщика: читается панелью поселения, отладкой и тестами. */
export interface SettlementReport {
  generator: number;
  type: SettlementTypeId;
  label: string;
  layout: SettlementLayoutId;
  character?: UrbanCharacterId;
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
  /** Геометрия укреплений для отрисовки: кольца стены и башни. */
  fortification?: TownFortification;
  /** Причинная точка зарождения поселения. */
  origin?: { x: number; y: number; reason: string };
  center?: Point;
  nodes?: UrbanNode[];
  routeEdges?: UrbanRouteEdge[];
  landmarks?: UrbanLandmark[];
  chains?: AdventureChain[];
  roads?: {
    totalCells: number;
    primaryLanes: number;
    secondaryLanes: number;
    alleys: number;
    bridges: number;
  };
  plots?: {
    total: number;
    built: number;
    open: number;
    courtyards: number;
  };
  quality?: SettlementQualityReport;
  debug?: SettlementDebugData;
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
  /** Ранжированные объекты дворов/улиц для монотонной плотности. */
  rankedCivic: RankedCivic[];
  urbanTrees: Tree[];
  urbanRocks: Rock[];
  road: Point[];
  river: Point[];
  lanes: { points: Point[]; width: number; surface: 'road' | 'plaza'; hierarchy?: 1 | 2 | 3 | 4 | 5 }[];
  /** Клетки башен стены (центры) — для отрисовки. */
  towers: Point[];
  /** Новый рынок (marketArchetype задан): план, проверка и отчёт. */
  market?: MarketOutcome;
  /** Дерево в центре площади рынка (обычное дерево слоя деревьев). */
  marketTrees?: Tree[];
  report: Omit<SettlementReport, 'buildings' | 'districts'> & { districts: Omit<SettlementDistrictReport, 'buildings'>[] };
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const TENTS: CivicKind[] = ['marketTentStripe', 'marketTentRound', 'marketTentAwning', 'marketTentCanopy', 'marketTentPatch', 'marketTentTarp'];
const STALLS: CivicKind[] = ['marketStallProduce', 'marketStallBread', 'marketStallFruit', 'marketStallFish', 'marketStallMeat', 'marketStallPottery', 'marketStallFabric', 'marketStallTools'];

let cached: { key: string; value: TypedSettlementPlan } | undefined;

/** Планировка, которой будет построено поселение: явная или по умолчанию для типа. */
export function resolveSettlementLayout(type: SettlementTypeDef, requested: string | undefined): SettlementLayoutId {
  return isSettlementLayout(requested) ? requested : type.layouts[0];
}

export function buildTypedPlan(s: GenSettings, style: SettlementStyle): TypedSettlementPlan {
  const type = getSettlementType(s.settlementType)!;
  const layout = resolveSettlementLayout(type, s.settlementLayout);
  const character = getUrbanCharacter(s.settlementCharacter, type);
  const { width: w, height: h, seed } = s;
  const key = `${type.id}:${layout}:${character.id}:${style}:${seed}:${w}:${h}:${s.road}:${s.river}:${s.publicSpaces}:${s.marketRichness}:${s.marketStyle}:${s.marketArchetype}`;
  if (cached?.key === key) return cached.value;

  const town = type.style === 'town';
  const small = Math.min(w, h) < 24;
  const tight = Math.min(w, h) < 36;
  const notes: string[] = [];

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;

  // ---- Шаги 1–2: Рельеф, гидрология, террасы и пригодность земли -----------
  const geo = buildGeography(s, type, notes);

  const urbanCtx: UrbanContext = {
    seed,
    width: w,
    height: h,
    type,
    layout,
    character,
    requestedCharacter: isUrbanCharacter(s.settlementCharacter) ? s.settlementCharacter : undefined,
    town,
    small,
    tight,
    geo,
    notes,
    trees: [],
    rocks: [],
  };

  // ---- Шаги 3–5: Origin, центр, стены и граф городских узлов ---------------
  const skel = buildUrbanSkeleton(urbanCtx);

  // ---- Шаг 6: Уличная сеть, ворота, мосты, набережная и башни --------------
  const roadNet = buildUrbanRoadNetwork(urbanCtx, skel, s);

  // ---- Площадь и рынок (интеграция с marketLayout.ts) ----------------------
  const { cells } = geo;
  const { reserved } = skel;
  const { streets, plaza, plazaOk, marketSite, marketResolution, ringLaneIndex } = roadNet;
  const terrain = (x: number, y: number) => cells[y][x].terrain;

  function restorePrepaint(area: Uint8Array, keepCells: number[]) {
    const pre = new Map(roadNet.marketPrepaint.filter(({ i }) => !area[i]).map(({ i, terrain: t }) => [i, t]));
    if (!pre.size) return;
    const keep = new Set(keepCells.filter((i) => pre.has(i)));
    const parent = new Map<number, number>();
    const queue: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (area[i]) {
        parent.set(i, -1);
        queue.push(i);
      }
    }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k], x = c % w, y = (c - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy, n = id(nx, ny);
        if (!inside(nx, ny) || parent.has(n)) continue;
        if (pre.has(n)) { parent.set(n, c); queue.push(n); continue; }
        if (pre.has(c) && streets[n] && !area[n]) {
          for (let p = c; p >= 0 && pre.has(p); p = parent.get(p) ?? -1) keep.add(p);
        }
      }
    }
    for (const [i, before] of pre) {
      if (!keep.has(i)) {
        cells[(i - (i % w)) / w][i % w].terrain = before;
        streets[i] = 0;
        roadNet.streetLevel[i] = 0;
      }
    }
  }

  const baseCivic: CivicObject[] = [];
  let marketArea: Uint8Array | undefined;

  function addBaseCivic(
    kind: CivicKind,
    x: number,
    y: number,
    w1 = CIVIC_KIT[kind].w,
    h1 = CIVIC_KIT[kind].h,
    variant = 0,
    rotation: ChestRotation = 0,
  ): boolean {
    const item: CivicObject = { x, y, w: w1, h: h1, kind, variant: variant % 2, rotation, source: 'layout' };
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        if (!inside(xx, yy) || wet(terrain(xx, yy)) || terrain(xx, yy) === 'rock' || terrain(xx, yy) === 'wall') {
          return false;
        }
        if (kind !== 'square' && reserved[id(xx, yy)] && !marketArea?.[id(xx, yy)]) return false;
      }
    }
    if (baseCivic.some((other) => other.kind !== 'square' && kind !== 'square' && intersects(other, item))) {
      return false;
    }
    baseCivic.push(item);
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        reserved[id(xx, yy)] = 1;
        if (kind === 'garden' && !streets[id(xx, yy)]) cells[yy][xx].terrain = 'dirt';
      }
    }
    return true;
  }

  const richness = between(s.marketRichness ?? .62, 0, 1);
  let market: MarketOutcome | undefined;
  let marketPiers = 0;
  const marketTrees: Tree[] = [];

  if (plaza && marketSite && marketResolution) {
    const laneRefs = roadNet.lanes
      .filter((_, index) => index !== ringLaneIndex)
      .map((l) => ({ points: l.points, width: l.width, surface: l.surface }));
    const mPlan = planMarket({
      width: w,
      height: h,
      cells,
      seed,
      resolution: marketResolution,
      style: s.marketStyle ?? 'auto',
      richness,
      town,
      bounds: marketSite.bounds,
      shore: marketSite.shore,
      streets,
      ring: ringLaneIndex >= 0,
      lanes: laneRefs,
      blocked: (x, y) => reserved[id(x, y)] === 1,
    });
    market = finishMarket(mPlan, marketResolution.archetype, streets);
    marketArea = mPlan.area;
    market.report.notes.unshift(...marketSite.notes);
    if (mPlan.surface === 'square') addBaseCivic('square', plaza.x, plaza.y, plaza.w, plaza.h, town ? 0 : 1);
    applyMarketGround(mPlan, cells);
    restorePrepaint(mPlan.area, mPlan.entrances.map((e) => id(e.street.x, e.street.y)));
    for (let i = 0; i < w * h; i++) {
      if (mPlan.area[i]) {
        reserved[i] = 1;
        streets[i] = 1;
        if (!roadNet.streetLevel[i]) roadNet.streetLevel[i] = 2;
      }
    }
    for (const path of mPlan.paths) {
      if (mPlan.surface !== 'square') {
        roadNet.lanes.push({ points: path.points, width: path.width, surface: 'road', level: 2, reason: 'рыночный проход' });
      }
    }
    const waterfront = marketWaterfront(mPlan, { width: w, height: h, cells, blocked: (x, y) => reserved[id(x, y)] === 1 }, seed);
    for (const p of waterfront.quay) roadNet.paintCell(p.x, p.y, 'road', 2, false);
    for (const p of waterfront.pier) {
      cells[p.y][p.x].terrain = 'bridge';
      streets[id(p.x, p.y)] = 1;
      roadNet.streetLevel[id(p.x, p.y)] = 2;
    }
    if (waterfront.pier.length) {
      roadNet.lanes.push({
        points: [...waterfront.quay.slice(-1), ...waterfront.pier],
        width: 1,
        surface: 'road',
        level: 2,
        reason: 'рыночный причал',
      });
      marketPiers++;
    }
    for (const it of waterfront.cargo) {
      if (it.threshold <= mPlan.richness + 1e-9) addBaseCivic(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation);
    }
    for (const it of mPlan.items) {
      if (!addBaseCivic(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation)) {
        market.report.notes.push(`не поставлен ${it.kind} (${it.x},${it.y})`);
      }
    }
    marketTrees.push(...mPlan.trees);
  } else if (plaza && plazaOk) {
    addBaseCivic('square', plaza.x, plaza.y, plaza.w, plaza.h, town ? 0 : 1);
    const cx = plaza.x + Math.floor(plaza.w / 2), cy = plaza.y + Math.floor(plaza.h / 2);
    addBaseCivic(type.plaza === 'large' && town ? 'fountain' : 'marketWell', cx - 1, cy - 1, 2, 2, 0);
    const marketWeight = (type.districts.market ?? 0) + (type.districts.docks ?? 0) * .5;
    const limit = Math.round((2 + marketWeight * 1.6) * (.4 + richness));
    let placed = 0;
    const slots: Point[] = [];
    for (let x = plaza.x + 1; x + 2 <= plaza.x + plaza.w - 1; x += 3) {
      slots.push({ x, y: plaza.y + 1 }, { x, y: plaza.y + plaza.h - 3 });
    }
    for (const p of slots) {
      if (placed >= limit || plaza.h < 6) break;
      if (Math.abs(p.x + 1 - cx) < 2) continue;
      const pool = (p.x + p.y) % 2 ? TENTS : STALLS;
      if (addBaseCivic(pool[Math.floor(hash2(p.x, p.y, seed + 0xb1) * pool.length)], p.x, p.y, 2, 2, p.x)) placed++;
    }
    if (richness > .3) addBaseCivic('marketNoticeBoard', plaza.x, plaza.y + Math.floor(plaza.h / 2), 1, 1, 0);
    if (richness > .5) addBaseCivic('cart', plaza.x + plaza.w - 2, plaza.y + plaza.h - 1, 1, 1, 0);
  }

  // ---- Шаги 7–8: Исторический возраст, районы, кварталы и переулки ---------
  const distLayout = buildDistrictsAndBlocks(urbanCtx, skel, roadNet, marketArea);

  // ---- Шаги 9–10: Разбиение кварталов на земельные участки (Plots) ---------
  const plotSub = subdivideIntoPlots(urbanCtx, skel, roadNet, distLayout, baseCivic, market);

  // ---- Шаги 11–16: Здания по фасаду, дворы, доминанты, окраины, D&D --------
  const built = placeBuildingsLandmarksAndDetails(
    urbanCtx,
    skel,
    roadNet,
    distLayout,
    plotSub,
    style,
    baseCivic,
    market,
    marketPiers,
  );

  // ---- Шаги 17–18: Пост-валидация, локальная починка и Quality Score -------
  const quality = validateAndRepairUrbanPlan(urbanCtx, skel, roadNet, distLayout, plotSub, built, marketArea);

  // ---- Подсчёт мостов (связные группы bridge за вычетом причалов) ----------
  let bridges = 0;
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
          if (inside(x + dx, y + dy) && !seen[n] && terrain(x + dx, y + dy) === 'bridge') {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    bridges = Math.max(0, groups - built.piers);
  }

  // ---- Шаг 19: Сборка дорожных лент (с иерархией), отчёта и слоёв отладки ---
  const lanes: TypedSettlementPlan['lanes'] = roadNet.lanes.map((l) => ({
    points: l.points,
    width: l.width,
    surface: l.surface,
    hierarchy: l.level,
  }));
  // Переулки и малые улочки рисуем первыми, главные магистрали — поверх перекрёстков.
  lanes.sort((a, b) => (b.hierarchy ?? 3) - (a.hierarchy ?? 3) || Number(a.surface === 'plaza') - Number(b.surface === 'plaza'));

  let totalStreetCells = 0;
  for (let i = 0; i < w * h; i++) {
    const tr = cells[(i - (i % w)) / w][i % w].terrain;
    if (tr === 'road' || tr === 'plaza' || tr === 'bridge') totalStreetCells++;
  }

  const debug = buildSettlementDebugData(urbanCtx, distLayout, roadNet, plotSub.plots);
  const originNode = skel.nodes.find((n) => n.kind === 'origin');

  const report: TypedSettlementPlan['report'] = {
    generator: SETTLEMENT_GENERATOR_VERSION,
    type: type.id,
    label: type.label,
    layout,
    character: character.id,
    geography: geo.geography,
    river: geo.river.length > 0,
    walls: skel.walls.walled ? type.walls : 'none',
    gates: roadNet.gatePoints.length,
    towers: roadNet.towers.length,
    streets: lanes.length,
    bridges,
    piers: built.piers,
    districts: distLayout.districts.map((d) => ({
      kind: d.kind,
      label: DISTRICTS[d.kind].label,
      x: d.x,
      y: d.y,
      area: d.area,
      wealth: Math.round(d.wealth * 100) / 100,
      age: d.age,
    })),
    notes,
    ...(skel.walls.walled && type.walls !== 'none' ? {
      fortification: {
        kind: type.walls,
        rings: skel.walls.wallRings.map((ring) => {
          const r = skel.walls.wallRadii(ring);
          return { cx: skel.center.x + .5, cy: skel.center.y + .5, rx: r.x - .5, ry: r.y - .5 };
        }),
        towers: roadNet.towers.map((t) => ({ ...t })),
      },
    } : {}),
    origin: {
      x: skel.origin.x,
      y: skel.origin.y,
      reason: originNode?.label ?? 'Точка основания',
    },
    center: skel.center,
    nodes: skel.nodes,
    routeEdges: roadNet.edges,
    landmarks: built.landmarks,
    chains: built.chains,
    roads: {
      totalCells: totalStreetCells,
      primaryLanes: roadNet.lanes.filter((l) => l.level <= 2).length,
      secondaryLanes: roadNet.lanes.filter((l) => l.level === 3).length,
      alleys: roadNet.lanes.filter((l) => l.level >= 4).length,
      bridges,
    },
    plots: {
      total: plotSub.plots.length,
      built: built.buildings.length,
      open: plotSub.plots.filter((p) => !p.buildRect).length,
      courtyards: built.courtyardCount,
    },
    quality,
    debug,
  };

  const allCivic = built.rankedCivic.map((rc) => rc.item);
  const value: TypedSettlementPlan = {
    cells,
    plots: built.buildings,
    plotDistrict: built.plotDistrict,
    civic: allCivic,
    rankedCivic: built.rankedCivic,
    urbanTrees: urbanCtx.trees,
    urbanRocks: urbanCtx.rocks,
    road: roadNet.lanes[0]?.points ?? [],
    river: geo.river,
    lanes,
    towers: roadNet.towers,
    report,
    ...(market ? { market, marketTrees } : {}),
  };
  cached = { key, value };
  return value;
}
