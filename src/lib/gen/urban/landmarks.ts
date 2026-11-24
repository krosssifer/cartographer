import { hash2 } from '../../random';
import { CIVIC_KIT, contains } from '../../settlementKit';
import { DISTRICTS } from '../settlementTypes';
import { facesMarket, type MarketOutcome } from '../marketLayout';
import type {
  Building,
  BuildingAnnex,
  BuildingRole,
  ChestRotation,
  CivicKind,
  CivicObject,
  LightSource,
  Point,
  RoofMaterial,
  RoofShape,
  Selection,
  SettlementStyle,
  TreeKind,
} from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { UrbanSkeleton } from './nodes';
import type { PlotSubdivisionResult } from './plots';
import type { UrbanRoadResult } from './roads';
import { SpatialHash } from './spatialHash';
import { computeUrbanActivityField, type UrbanActivityField } from './activity';
import {
  FACING_ROTATION as MARKET_FACING_ROT,
} from '../marketLayout';
import {
  buildFacadeAttachments,
  conditionFactors,
  LITTER_PROPS,
  STREET_RECIPES,
  YARD_RECIPES,
  courtyardGround,
  districtProfile,
  isDressableGround,
  litterBudget,
  pickWeightedProp,
  resolveMaterialProfile,
  selectPropForAnchor,
  streetBudget,
  yardPropCount,
  type CityCondition,
  type UrbanAnchor,
  type UrbanMaterialProfile,
  type UrbanVisualProfile,
} from './dressing';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  facingVector,
  pickWeighted,
  wet,
  type AdventureChain,
  type LandmarkKind,
  type RankedCivic,
  type UrbanContext,
  type UrbanLandmark,
  type UrbanPlot,
  type UrbanZone,
} from './types';

export interface BuildingsAndLandmarksResult {
  buildings: Building[];
  plotDistrict: number[];
  placedPlots: (UrbanPlot | undefined)[];
  secondaryFlags: boolean[];
  passageMask: Uint8Array;
  rankedCivic: RankedCivic[];
  landmarks: UrbanLandmark[];
  chains: AdventureChain[];
  piers: number;
  courtyardCount: number;
  /** Статистика Urban Dressing (для отчёта и отладки). */
  dressing?: {
    materialCells: number;
    propsPlaced: number;
    litterPlaced: number;
    treesPlaced: number;
    fencesPlaced?: number;
    scenesPlaced?: number;
    bedsPlaced?: number;
    doorClearance?: number;
    anchorsEvaluated?: number;
    anchorPropsPlaced?: number;
    attachmentsPlaced?: number;
    lightsPlaced?: number;
  };
  activityField?: UrbanActivityField;
  anchors?: UrbanAnchor[];
  lights?: LightSource[];
  materialSummary?: UrbanMaterialProfile;
}

const CARGO_GOODS: readonly CivicKind[] = [
  'marketCrates', 'marketBarrels', 'marketSacks', 'marketBarrelPair', 'marketRope',
];

/** Настройки визуального наполнения города (Urban Dressing). */
export interface UrbanDressingSettings {
  /** Насыщенность 0..1 из настроек генерации. */
  density: number;
  condition: CityCondition;
}

function pickWeightedPropDeep(
  list: readonly [CivicKind, number][],
  roll: number,
): { kind: CivicKind; w: number; h: number } {
  const total = list.reduce((sum, [, weight]) => sum + weight, 0);
  let target = roll * total;
  for (const [kind, weight] of list) {
    target -= weight;
    if (target <= 0) return { kind, w: CIVIC_KIT[kind].w, h: CIVIC_KIT[kind].h };
  }
  const last = list[list.length - 1][0];
  return { kind: last, w: CIVIC_KIT[last].w, h: CIVIC_KIT[last].h };
}

export function placeBuildingsLandmarksAndDetails(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  distLayout: DistrictLayoutResult,
  plotSub: PlotSubdivisionResult,
  style: SettlementStyle,
  baseCivic: CivicObject[],
  market?: MarketOutcome,
  marketPiers = 0,
  dressing?: UrbanDressingSettings,
): BuildingsAndLandmarksResult {
  const { width: w, height: h, seed, type, character, town, geo } = ctx;
  const { cells, waterDist, geography, length, span, at } = geo;
  const { RX, RY, walls, keepBox, keepFree, reserved } = skel;
  const { streets, gates, gatePoints, plaza, plazaOk, subPlazas, riverQuayPoints, marketResolution } = roadNet;
  const { districts, districtAt, blocks } = distLayout;
  const { plots: urbanPlots, distanceToStreet, nearWall } = plotSub;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  const rankedCivic: RankedCivic[] = baseCivic.map((item) => ({ item, plotRank: -1 }));
  const civicHash = new SpatialHash<CivicObject>(w, h, 8);
  for (const item of baseCivic) {
    if (item.kind !== 'square') civicHash.insert(item, item.x, item.y, item.w, item.h);
  }
  const landmarks: UrbanLandmark[] = [];
  const chains: AdventureChain[] = [];
  const passageMask = new Uint8Array(w * h);

  function canAddCivic(
    kind: CivicKind,
    x: number,
    y: number,
    w1: number,
    h1: number,
    allowOnStreet = false,
  ): boolean {
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        if (!inside(xx, yy)) return false;
        const tr = terrain(xx, yy);
        if (wet(tr) || tr === 'rock' || tr === 'wall') return false;
        if (!allowOnStreet && streets[id(xx, yy)]) return false;
        if (passageMask[id(xx, yy)]) return false;
        if (kind !== 'square' && reserved[id(xx, yy)]) return false;
      }
    }
    if (kind !== 'square' && civicHash.hasOverlap({ x, y, w: w1, h: h1 }, 0)) {
      return false;
    }
    return true;
  }

  function addRankedCivic(
    plotRank: number,
    kind: CivicKind,
    x: number,
    y: number,
    w1 = CIVIC_KIT[kind].w,
    h1 = CIVIC_KIT[kind].h,
    variant = 0,
    rotation: ChestRotation = 0,
    allowOnStreet = false,
  ): boolean {
    if (!canAddCivic(kind, x, y, w1, h1, allowOnStreet)) return false;
    const item: CivicObject = {
      x, y, w: w1, h: h1, kind, variant: Math.abs(variant) % 2, rotation, source: 'layout',
    };
    rankedCivic.push({ item, plotRank });
    if (kind !== 'square') civicHash.insert(item, x, y, w1, h1);
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        reserved[id(xx, yy)] = 1;
        if (kind === 'garden' && plotRank < 0 && !streets[id(xx, yy)] && waterDist[id(xx, yy)] >= 2) {
          cells[yy][xx].terrain = 'dirt';
        }
      }
    }
    return true;
  }

  // ---- 1. Морские и речные причалы, набережные грузы (Section 13) -----------
  let piers = marketPiers;
  const pierHeads: Point[] = [];
  if (geography === 'coast' && districts.some((d) => d.kind === 'docks')) {
    const dockDistricts = districts.filter((d) => d.kind === 'docks');
    const pierCount = between(Math.round(length / 13), 2, 5);
    for (let i = 0; i < pierCount; i++) {
      const a = Math.round(length * (.12 + (.76 * (i + .5)) / pierCount) + (hash2(i, 1, seed + 0xc4) - .5) * 4);
      let landD = -1;
      for (let d = 0; d < span; d++) {
        const p = at(a, d);
        if (inside(p.x, p.y) && usable(p.x, p.y)) { landD = d; break; }
      }
      if (landD < 2) continue;
      const head = at(a, landD);
      if (!dockDistricts.some((d) => Math.hypot(d.x - head.x, d.y - head.y) < Math.max(RX, RY) * .88)) continue;
      const len = between(Math.round(landD * .62), 2, 7);
      let builtCells = 0;
      for (let k = 1; k <= len; k++) {
        const p = at(a, landD - k);
        if (!inside(p.x, p.y) || !wet(terrain(p.x, p.y))) break;
        cells[p.y][p.x].terrain = 'bridge';
        streets[id(p.x, p.y)] = 1;
        roadNet.streetLevel[id(p.x, p.y)] = 2;
        builtCells++;
      }
      if (!builtCells) continue;
      for (let k = 0; k <= 3; k++) {
        const p = at(a, landD + k);
        if (inside(p.x, p.y) && usable(p.x, p.y)) {
          roadNet.paintCell(p.x, p.y, 'road', 2, false);
        }
      }
      pierHeads.push(head);
      const goods = at(between(a + 2, 1, length - 2), landD + 1);
      addRankedCivic(-1, CARGO_GOODS[i % CARGO_GOODS.length], goods.x, goods.y, 1, 1, i);
      piers++;
    }
  }

  // Речной причал на активной городской набережной (только в пределах города!).
  if (geo.river.length > 0 && riverQuayPoints.length >= 2 && (town || type.districts.docks || character.id === 'trade')) {
    const rq = riverQuayPoints[Math.floor(riverQuayPoints.length / 2)];
    for (const [dx, dy] of N4) {
      let waterStep: Point | undefined;
      const pathToWater: Point[] = [];
      for (let step = 1; step <= 4; step++) {
        const tx = rq.x + dx * step, ty = rq.y + dy * step;
        if (!inside(tx, ty)) break;
        if (wet(terrain(tx, ty))) {
          waterStep = { x: tx, y: ty };
          break;
        }
        if (!usable(tx, ty)) break;
        pathToWater.push({ x: tx, y: ty });
      }
      if (waterStep && streets[id(rq.x, rq.y)]) {
        for (const pt of pathToWater) roadNet.paintCell(pt.x, pt.y, 'road', 2, false);
        cells[waterStep.y][waterStep.x].terrain = 'bridge';
        streets[id(waterStep.x, waterStep.y)] = 1;
        roadNet.streetLevel[id(waterStep.x, waterStep.y)] = 2;
        pierHeads.push(rq);
        addRankedCivic(-1, 'marketBarrels', rq.x + (dy !== 0 ? 1 : 0), rq.y + (dx !== 0 ? 1 : 0), 1, 1, 0);
        piers++;
        break;
      }
    }
  }

  // ---- 2. Районные площади, малые скверы, колодцы и телеги у ворот (Section 14)
  subPlazas.forEach((sp, spIdx) => {
    const cx = sp.x + Math.floor(sp.w / 2);
    const cy = sp.y + Math.floor(sp.h / 2);
    const dIdx = districtAt[id(between(cx, 0, w - 1), between(cy, 0, h - 1))];
    const dKind = dIdx >= 0 ? districts[dIdx].kind : 'residential';
    const focal: CivicKind = dKind === 'noble' || dKind === 'temple'
      ? 'fountain'
      : spIdx % 2 === 0 ? 'well' : 'marketNoticeBoard';
    const fSpec = CIVIC_KIT[focal];
    if (addRankedCivic(-1, focal, cx, cy, fSpec.w, fSpec.h, spIdx, 0, true)) {
      landmarks.push({
        id: `subplaza_${spIdx}`,
        kind: focal === 'fountain' ? 'fountain' : focal === 'well' ? 'well' : 'plaza',
        label: `Малая площадь (${dKind})`,
        x: cx,
        y: cy,
        bounds: { ...sp },
        district: dKind,
        accessible: true,
      });
    }
  });

  for (const block of blocks) {
    if (block.anomaly === 'pocket_green' && block.bounds.w >= 3 && block.bounds.h >= 3) {
      const cx = block.bounds.x + Math.floor(block.bounds.w / 2);
      const cy = block.bounds.y + Math.floor(block.bounds.h / 2);
      const kind: CivicKind = block.wealth > .65 && town ? 'fountain' : 'well';
      const sz = kind === 'fountain' ? 2 : 1;
      if (addRankedCivic(-1, kind, cx, cy, sz, sz, block.id)) {
        landmarks.push({
          id: `pocket_${block.id}`,
          kind: kind === 'fountain' ? 'fountain' : 'well',
          label: kind === 'fountain' ? 'Малый фонтан' : 'Квартальный колодец',
          x: cx,
          y: cy,
          bounds: { x: cx, y: cy, w: sz, h: sz },
          district: block.districtKind,
          accessible: true,
        });
      }
    }
  }

  gatePoints.forEach((gp, idx) => {
    const dIdx = districtAt[id(between(gp.x, 0, w - 1), between(gp.y, 0, h - 1))];
    landmarks.push({
      id: `gate_${idx}`,
      kind: 'gate',
      label: `Городские ворота ${idx + 1}`,
      x: gp.x,
      y: gp.y,
      bounds: { x: gp.x, y: gp.y, w: 1, h: 1 },
      district: dIdx >= 0 ? districts[dIdx].kind : 'garrison',
      accessible: true,
    });
  });

  if (plaza && plazaOk) {
    landmarks.push({
      id: 'main_plaza',
      kind: 'plaza',
      label: market ? 'Рыночная площадь' : 'Главная площадь',
      x: plaza.x + Math.floor(plaza.w / 2),
      y: plaza.y + Math.floor(plaza.h / 2),
      bounds: { ...plaza },
      district: 'centre',
      accessible: true,
    });
  }

  {
    let carts = 0;
    for (const g of gates) {
      if (carts >= 3) break;
      const x = g % w, y = (g - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx * 2, ny = y + dy * 2;
        if (inside(nx, ny) && usable(nx, ny) && !streets[id(nx, ny)] && walls.insideWalls(nx, ny)) {
          if (addRankedCivic(-1, 'cart', nx, ny, 1, 1, carts)) {
            carts++;
            break;
          }
        }
      }
    }
  }

  // ---- 3. Кандидаты основных зданий по участкам + точечный Infill -----------
  const onMarket = (p: Point) => market !== undefined && facesMarket(market.plan, p.x, p.y, streets);
  const fitsBuilding = (r: Selection): boolean => {
    if (r.x < 1 || r.y < 1 || r.x + r.w > w - 1 || r.y + r.h > h - 1) return false;
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        const idx = id(xx, yy);
        if (streets[idx] || reserved[idx] || !usable(xx, yy) || districtAt[idx] < 0 || nearWall[idx]) return false;
      }
    }
    return true;
  };

  const doorClear = (out: Point): boolean =>
    inside(out.x, out.y)
    && usable(out.x, out.y)
    && !rankedCivic.some(({ item }) => item.kind !== 'square' && contains(item, out.x, out.y))
    && !(market && market.occupied[id(out.x, out.y)]);

  type Candidate = {
    lot: Building;
    out: Point;
    district: number;
    zone: UrbanZone;
    score: number;
    plot?: UrbanPlot;
    roadLvl: number;
    marketFront: boolean;
  };

  const candidates: Candidate[] = [];

  function chooseAnnex(
    kind: Building['kind'],
    role: BuildingRole | undefined,
    bRect: Selection,
    wealth: number,
    roll: number,
  ): BuildingAnnex | undefined {
    if (kind === 'tower') return role === 'citadel' || role === 'barracks' ? 'battlement' : undefined;
    if (kind === 'shop' || role === 'smithy' || role === 'workshop') {
      return roll < .62 ? 'awning' : undefined;
    }
    if (kind === 'hall' || role === 'town_hall' || role === 'guildhall' || role === 'temple' || role === 'manor') {
      return roll < .52 ? 'porch' : bRect.w >= 7 && bRect.h >= 5 && roll < .84 ? 'wing' : undefined;
    }
    if (wealth > .62 && bRect.w >= 6 && roll < .42) return 'dormer';
    if (roll > .82 && bRect.w >= 6 && bRect.h >= 5) return 'wing';
    return undefined;
  }

  // 3A. Фасадные и внутриквартальные здания по нарезанным участкам (UrbanPlot).
  for (const plot of urbanPlots) {
    if (!plot.buildRect) continue;
    const bRect = plot.buildRect;
    if (!fitsBuilding(bRect)) continue;

    const dKind = districts[plot.districtIndex].kind;
    const dDef = DISTRICTS[dKind];
    const [fx, fy] = facingVector(plot.orientation);
    const door: Point = plot.orientation === 0
      ? { x: bRect.x + Math.floor(bRect.w / 2), y: bRect.y + bRect.h - 1 }
      : plot.orientation === 180
      ? { x: bRect.x + Math.floor(bRect.w / 2), y: bRect.y }
      : plot.orientation === 90
      ? { x: bRect.x, y: bRect.y + Math.floor(bRect.h / 2) }
      : { x: bRect.x + bRect.w - 1, y: bRect.y + Math.floor(bRect.h / 2) };
    const out: Point = { x: door.x + fx, y: door.y + fy };
    if (!doorClear(out)) continue;

    const marketFront = onMarket(out);
    const frontagePool = marketFront && marketResolution ? marketResolution.archetype.frontage : undefined;

    let kind: Building['kind'] = plot.fn === 'shop' || plot.fn === 'workshop' ? 'shop'
      : plot.fn === 'noble_villa' || plot.fn === 'warehouse' || plot.fn === 'town_hall' || plot.fn === 'temple' ? 'hall'
      : plot.fn === 'garrison' ? (hash2(bRect.x, bRect.y, seed + 0x701) > .55 && bRect.w <= 5 && bRect.h <= 5 ? 'tower' : 'hall')
      : pickWeighted(dDef.kinds, hash2(bRect.x, bRect.y, seed + 0x702));

    if (frontagePool && kind !== 'tower') {
      kind = pickWeighted(frontagePool as [Building['kind'], number][], hash2(bRect.x, bRect.y, seed + 0x6f17));
    }
    if (kind === 'tower' && (bRect.w > 6 || bRect.h > 6)) kind = 'hall';

    const role: BuildingRole = plot.fn === 'workshop' ? 'workshop'
      : plot.fn === 'warehouse' ? 'warehouse'
      : plot.fn === 'noble_villa' ? 'manor'
      : plot.fn === 'stable' ? 'stable'
      : plot.fn === 'garrison' ? 'barracks'
      : kind === 'shop' ? 'shop'
      : 'house';

    const roofs = dDef.roofs[style];
    const roof: RoofMaterial = roofs[Math.floor(hash2(bRect.x, bRect.y, seed + 2428) * roofs.length)];
    const shape: RoofShape = kind === 'tower' ? 'hip'
      : dDef.shapes[Math.floor(hash2(bRect.x, bRect.y, seed + 2611) * dDef.shapes.length)];
    const annex = chooseAnnex(kind, role, bRect, plot.wealth, hash2(bRect.x, bRect.y, seed + 0x733));

    const cx = Math.round(bRect.x + bRect.w / 2);
    const cy = Math.round(bRect.y + bRect.h / 2);
    const dens = skel.densityField[id(between(cx, 0, w - 1), between(cy, 0, h - 1))];
    const dist = distanceToStreet[id(out.x, out.y)];
    // Сортируем строго по градиенту плотности от исторического ядра к пригородам!
    const score = dens * 5.4
      + (marketFront ? 2.8 : 0)
      + (5 - plot.roadLevel) * .68
      + dDef.appeal * 1.35
      - (streets.some(Boolean) ? dist * .42 : 0)
      + hash2(bRect.x, bRect.y, seed + 6501) * .85;

    candidates.push({
      lot: {
        ...bRect,
        style,
        kind,
        roof,
        shape,
        source: 'layout',
        door,
        facing: plot.orientation,
        ...(annex ? { annex } : {}),
        role,
      },
      out,
      district: plot.districtIndex,
      zone: plot.zone,
      score,
      plot,
      roadLvl: plot.roadLevel,
      marketFront,
    });
  }

  // 3B. Точечные кандидаты для клиновидных/узких кварталов и малых карт.
  const maxFallbackDist = town ? 5 : 7;
  const hasAnyRoad = roadNet.lanes.length > 0;
  const scanStep = 1;
  for (let y = 1; y < h - 4; y += scanStep) {
    for (let x = 1; x < w - 4; x += scanStep) {
      const home = districtAt[id(x, y)];
      if (home < 0) continue;
      const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[id(x, y)]] ?? 'residential';
      const dDef = DISTRICTS[districts[home].kind];
      const fallbackDims: [number, number][] = zone === 'old_core' || zone === 'inner_city'
        ? [[Math.max(4, dDef.length[0]), Math.max(4, dDef.depth[0])], [4, 4], [4, 3]]
        : [[Math.max(4, dDef.length[0]), Math.max(4, dDef.depth[0])], [4, 4]];
      for (let option = 0; option < fallbackDims.length; option++) {
        const [len, dep] = fallbackDims[option];
        const turn = hash2(x, y, seed + 3421 + option * 74) > .5;
        const plan: Selection = { x, y, w: turn ? dep : len, h: turn ? len : dep };
        if (!fitsBuilding(plan)) continue;
        const hx = x + Math.floor(plan.w / 2), hy = y + Math.floor(plan.h / 2);
        const edges = ([
          { door: { x: hx, y }, out: { x: hx, y: y - 1 }, facing: 180 as ChestRotation },
          { door: { x: hx, y: y + plan.h - 1 }, out: { x: hx, y: y + plan.h }, facing: 0 as ChestRotation },
          { door: { x, y: hy }, out: { x: x - 1, y: hy }, facing: 90 as ChestRotation },
          { door: { x: x + plan.w - 1, y: hy }, out: { x: x + plan.w, y: hy }, facing: 270 as ChestRotation },
        ]).filter(({ out }) => doorClear(out));
        edges.sort((a, b) =>
          (Number(onMarket(b.out)) - Number(onMarket(a.out))) * 100
          + distanceToStreet[id(a.out.x, a.out.y)] - distanceToStreet[id(b.out.x, b.out.y)],
        );
        const entry = edges[0];
        if (!entry) continue;
        const dist = distanceToStreet[id(entry.out.x, entry.out.y)];
        if (hasAnyRoad && dist > maxFallbackDist) continue;

        const mFront = onMarket(entry.out);
        const fPool = mFront && marketResolution ? marketResolution.archetype.frontage : undefined;
        const baseKind = pickWeighted(dDef.kinds, hash2(x, y, seed + 9001 + option));
        const kind = fPool && baseKind !== 'tower'
          ? pickWeighted(fPool as [Building['kind'], number][], hash2(x, y, seed + 0x6f19 + option))
          : baseKind;
        const roofs = dDef.roofs[style];
        const lot: Building = {
          ...plan,
          style,
          kind: kind === 'tower' && (plan.w > 5 || plan.h > 5) ? 'house' : kind,
          roof: roofs[Math.floor(hash2(x, y, seed + 2428 + option) * roofs.length)],
          shape: dDef.shapes[Math.floor(hash2(x, y, seed + 2611 + option) * dDef.shapes.length)],
          source: 'layout',
          door: entry.door,
          facing: entry.facing,
          role: kind === 'shop' ? 'shop' : 'house',
        };
        const dens = skel.densityField[id(between(hx, 0, w - 1), between(hy, 0, h - 1))];
        const score = dens * 4.8 + (mFront ? 2.2 : 0) + dDef.appeal * 1.1 - (hasAnyRoad ? dist * .52 : 0)
          + hash2(x, y, seed + 6509 + option) * .7 - 1.1;
        candidates.push({
          lot,
          out: entry.out,
          district: home,
          zone,
          score,
          roadLvl: dist <= 1 ? 3 : 4,
          marketFront: mFront,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.lot.y - b.lot.y || a.lot.x - b.lot.x);

  // ---- 4. Размещение городских ЛАНДМАРКОВ (Section 12) ----------------------
  const placed: Building[] = [];
  const placedOut: Point[] = [];
  const plotDistrict: number[] = [];
  const placedPlots: (UrbanPlot | undefined)[] = [];
  const secondaryFlags: boolean[] = [];
  const builtCellMask = new Uint8Array(w * h);
  const placedOutMask = new Uint8Array(w * h);
  const buildingHash = new SpatialHash<Building>(w, h, 8);

  const markBuiltRect = (r: Selection) => {
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        if (inside(xx, yy)) builtCellMask[id(xx, yy)] = 1;
      }
    }
  };

  const canAcceptBuilding = (lot: Building, out: Point, gap: number): boolean => {
    if (inside(out.x, out.y) && builtCellMask[id(out.x, out.y)]) return false;
    for (let yy = lot.y; yy < lot.y + lot.h; yy++) {
      for (let xx = lot.x; xx < lot.x + lot.w; xx++) {
        const ci = id(xx, yy);
        if (passageMask[ci] || placedOutMask[ci]) return false;
      }
    }
    return !buildingHash.hasOverlap(lot, gap);
  };

  const commitBuilding = (
    cand: Candidate,
    override: Partial<Building>,
    landmarkInfo?: { kind: LandmarkKind; label: string },
    isSecondary = false,
  ): number => {
    const finalLot: Building = { ...cand.lot, ...override };
    const idx = placed.length;
    placed.push(finalLot);
    placedOut.push(cand.out);
    if (inside(cand.out.x, cand.out.y)) placedOutMask[id(cand.out.x, cand.out.y)] = 1;
    buildingHash.insert(finalLot, finalLot.x, finalLot.y, finalLot.w, finalLot.h);
    plotDistrict.push(cand.district);
    placedPlots.push(cand.plot);
    secondaryFlags.push(isSecondary);
    markBuiltRect(finalLot);
    if (landmarkInfo) {
      landmarks.push({
        id: `${landmarkInfo.kind}_${landmarks.length}`,
        kind: landmarkInfo.kind,
        label: landmarkInfo.label,
        x: finalLot.x + Math.floor(finalLot.w / 2),
        y: finalLot.y + Math.floor(finalLot.h / 2),
        bounds: { x: finalLot.x, y: finalLot.y, w: finalLot.w, h: finalLot.h },
        district: districts[cand.district]?.kind ?? 'centre',
        accessible: true,
      });
    }
    return idx;
  };

  // 4.1 Цитадель крепости.
  if (keepBox && keepFree) {
    const door = { x: keepBox.x + Math.floor(keepBox.w / 2), y: keepBox.y + keepBox.h - 1 };
    const out = { x: door.x, y: door.y + 1 };
    const dIdx = Math.max(0, districtAt[id(door.x, door.y)]);
    const keepLot: Building = {
      ...keepBox,
      style,
      kind: 'tower',
      roof: style === 'town' ? 3 : 1,
      shape: 'hip',
      source: 'layout',
      door,
      facing: 0,
      annex: 'battlement',
      role: 'citadel',
    };
    placed.push(keepLot);
    placedOut.push(out);
    plotDistrict.push(dIdx);
    placedPlots.push(undefined);
    secondaryFlags.push(false);
    markBuiltRect(keepLot);
    landmarks.push({
      id: 'citadel_0',
      kind: 'citadel',
      label: 'Цитадель',
      x: keepBox.x + Math.floor(keepBox.w / 2),
      y: keepBox.y + Math.floor(keepBox.h / 2),
      bounds: { ...keepBox },
      district: districts[dIdx]?.kind ?? 'garrison',
      accessible: true,
    });
  } else if (type.keep) {
    ctx.notes.push('цитадель не поместилась');
  }

  // 4.2 Главная таверна / постоялый двор.
  let tavernIdx = -1;
  if (type.style === 'town' || type.id === 'large_village') {
    const tavernFits = (c: Candidate) =>
      c.lot.w * c.lot.h >= 24 && Math.min(c.lot.w, c.lot.h) >= 4
      && ['centre', 'market', 'residential', 'docks'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 0);
    const tavernCand = (market ? candidates.find((c) => tavernFits(c) && c.marketFront) : undefined)
      ?? candidates.find((c) => tavernFits(c) && c.roadLvl <= 2)
      ?? candidates.find(tavernFits);
    if (tavernCand) {
      tavernIdx = commitBuilding(
        tavernCand,
        { kind: 'tavern', roof: 5, shape: 'hip', role: 'tavern', annex: 'porch' },
        { kind: 'tavern', label: 'Постоялый двор и таверна' },
      );
    }
  }

  // 4.3 Ратуша (Town Hall).
  if (town && !type.keep && ['trade_town', 'fortified_town', 'small_city', 'large_city', 'port', 'craft_town'].includes(type.id)) {
    const hallCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 25
      && ['centre', 'market', 'noble'].includes(districts[c.district].kind)
      && c.roadLvl <= 2
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (hallCand) {
      commitBuilding(
        hallCand,
        { kind: 'hall', roof: 3, shape: 'cross', role: 'town_hall', annex: 'porch' },
        { kind: 'town_hall', label: 'Ратуша' },
      );
    }
  }

  // 4.4 Дом гильдий (Guildhall — Section 7).
  if (town && ['trade_town', 'craft_town', 'small_city', 'large_city', 'port'].includes(type.id)) {
    const guildCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 24
      && ['market', 'centre', 'craft', 'docks'].includes(districts[c.district].kind)
      && c.roadLvl <= 2
      && canAcceptBuilding(c.lot, c.out, 0),
    );
    if (guildCand) {
      commitBuilding(
        guildCand,
        { kind: 'hall', roof: 2, shape: 'cross', role: 'guildhall', annex: 'porch' },
        { kind: 'town_hall', label: 'Дом гильдий' },
      );
    }
  }

  // 4.5 Главный храм (Main Temple).
  if (type.districts.temple || character.id === 'religious' || type.id === 'large_city' || type.id === 'small_city') {
    const templeCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 24
      && ['temple', 'centre', 'noble'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (templeCand) {
      commitBuilding(
        templeCand,
        { kind: 'hall', roof: style === 'town' ? 4 : 6, shape: 'cross', role: 'temple', annex: 'porch' },
        { kind: 'main_temple', label: 'Главный храм' },
      );
    }
  }

  // 4.6 Казармы и тюрьма.
  if (type.districts.garrison || walls.walled || character.id === 'military') {
    const barrackCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 22
      && ['garrison', 'centre', 'craft'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (barrackCand) {
      commitBuilding(
        barrackCand,
        { kind: 'hall', roof: style === 'town' ? 3 : 1, shape: 'hip', role: 'barracks', annex: 'wing' },
        { kind: 'barracks', label: 'Казармы' },
      );
    }
    if ((type.id === 'fortress' || type.id === 'large_city' || type.id === 'fortified_town') && !ctx.small) {
      const prisonCand = candidates.find((c) =>
        c.lot.w <= 6 && c.lot.h <= 6 && c.lot.w * c.lot.h >= 16
        && ['garrison', 'poor'].includes(districts[c.district].kind)
        && canAcceptBuilding(c.lot, c.out, 1),
      );
      if (prisonCand) {
        commitBuilding(
          prisonCand,
          { kind: 'tower', roof: 3, shape: 'hip', role: 'prison', annex: 'battlement' },
          { kind: 'prison', label: 'Тюремный каземат' },
        );
      }
    }
  }

  // 4.7 Большой склад (Warehouse).
  let warehouseIdx = -1;
  if (type.districts.docks || type.districts.market || character.id === 'trade' || character.id === 'port') {
    const whCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 22
      && ['docks', 'market', 'craft'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 0),
    );
    if (whCand) {
      warehouseIdx = commitBuilding(
        whCand,
        { kind: 'hall', roof: style === 'town' ? 1 : 7, shape: 'gable', role: 'warehouse' },
        { kind: 'warehouse', label: 'Городской склад' },
      );
    }
  }

  // 4.8 Кузница (Smithy).
  if (type.districts.craft || type.districts.garrison || type.id === 'mountain') {
    const smithCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 18
      && ['craft', 'garrison', 'residential'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 0),
    );
    if (smithCand) {
      commitBuilding(
        smithCand,
        { kind: 'shop', roof: style === 'town' ? 3 : 1, shape: 'gable', role: 'smithy', annex: 'awning' },
        { kind: 'smithy', label: 'Кузница' },
      );
    }
  }

  // 4.9 Водяная или ветряная мельница (Section 12 & 13).
  if ((geo.river.length || type.districts.farms || type.id === 'large_village') && !ctx.small) {
    const millCand = candidates.find((c) => {
      if (c.lot.w > 6 || c.lot.h > 6 || !canAcceptBuilding(c.lot, c.out, 1)) return false;
      const wd = waterDist[id(c.lot.x, c.lot.y)];
      const onOutskirt = ['farms', 'craft', 'poor'].includes(districts[c.district].kind)
        || skel.footprintAt(c.lot.x, c.lot.y) > .78;
      return (geo.river.length && wd >= 2 && wd <= 6) || onOutskirt;
    });
    if (millCand) {
      const mSize = Math.min(millCand.lot.w, millCand.lot.h, 5);
      const mRect = { x: millCand.lot.x, y: millCand.lot.y, w: mSize, h: mSize };
      if (fitsBuilding(mRect)) {
        const [fx, fy] = facingVector(millCand.lot.facing ?? 0);
        const door: Point = (millCand.lot.facing ?? 0) === 0
          ? { x: mRect.x + Math.floor(mSize / 2), y: mRect.y + mSize - 1 }
          : (millCand.lot.facing ?? 0) === 180
          ? { x: mRect.x + Math.floor(mSize / 2), y: mRect.y }
          : (millCand.lot.facing ?? 0) === 90
          ? { x: mRect.x, y: mRect.y + Math.floor(mSize / 2) }
          : { x: mRect.x + mSize - 1, y: mRect.y + Math.floor(mSize / 2) };
        const out = { x: door.x + fx, y: door.y + fy };
        if (doorClear(out) && canAcceptBuilding({ ...millCand.lot, ...mRect, door }, out, 1)) {
          commitBuilding(
            { ...millCand, lot: { ...millCand.lot, ...mRect, door }, out },
            { kind: 'tower', roof: style === 'town' ? 1 : 0, shape: 'hip', role: 'mill' },
            { kind: 'mill', label: waterDist[id(mRect.x, mRect.y)] <= 6 ? 'Водяная мельница' : 'Ветряная мельница' },
          );
        }
      }
    }
  }

  // 4.10 Общественные бани.
  if ((type.id === 'large_city' || type.id === 'small_city' || character.id === 'noble') && !ctx.small) {
    const bathCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 22
      && ['centre', 'noble', 'residential'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (bathCand) {
      commitBuilding(
        bathCand,
        { kind: 'hall', roof: 2, shape: 'hip', role: 'baths', annex: 'porch' },
        { kind: 'public_baths', label: 'Общественные бани' },
      );
    }
  }

  // ---- 5. Заполнение уличного фронта по градиенту плотности + вторичные постройки дворов!
  const totalDistrictWeight = Object.values(type.districts).reduce((s, v) => s + (v ?? 0), 0) || 1;
  let usableLandCount = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (usable(x, y)) usableLandCount++;
  const usableShare = usableLandCount / Math.max(1, (w - 4) * (h - 4));

  // Калиброванный бюджет застройки: старое ядро и внутренний город плотные, пригороды свободные!
  const cap = Math.max(
    ctx.small ? 95 : 265,
    Math.floor(w * h * type.fill * 1.56 * between(usableShare, .72, 1)),
  );
  const budgets = new Array<number>(districts.length).fill(0);
  placed.forEach((b, i) => {
    if (plotDistrict[i] >= 0) budgets[plotDistrict[i]] += b.w * b.h;
  });

  const shareOf = (dIdx: number) => {
    const kind = districts[dIdx].kind;
    const siblings = Math.max(1, districts.filter((d) => d.kind === kind).length);
    return ((type.districts[kind] ?? 1) / totalDistrictWeight) / siblings;
  };

  // Функция допустимого зазора: в старом центре и на уличном фронте участки идут стена-к-стене (gap = 0)!
  const gapFor = (cand: Candidate, round: number): number => {
    const dKind = districts[cand.district].kind;
    if (cand.plot) {
      if (dKind === 'farms') return 2;
      if (dKind === 'noble' || dKind === 'temple') return 1;
      if (cand.zone === 'old_core' || cand.zone === 'inner_city') return 0;
      if (cand.zone === 'residential') return cand.roadLvl <= 2 ? 0 : 1;
      if (cand.zone === 'outer_city') return 1;
      return 1;
    }
    if ((cand.zone === 'old_core' || cand.zone === 'inner_city') && cand.roadLvl <= 3 && dKind !== 'noble') {
      return 0;
    }
    if (round === 1 && (ctx.tight || type.extent < .65)) return 1;
    return cand.zone === 'old_core' || cand.zone === 'inner_city' || cand.zone === 'residential'
      ? 1
      : Math.min(2, DISTRICTS[dKind].gap);
  };

  // Вспомогательная проверка и фиксация прохода от дворовой постройки до уличной сети!
  const findWalkablePassageToStreet = (start: Point): Point[] | undefined => {
    if (!inside(start.x, start.y) || !usable(start.x, start.y) || builtCellMask[id(start.x, start.y)]) {
      return undefined;
    }
    if (streets[id(start.x, start.y)]) return [start];

    const startIdx = id(start.x, start.y);
    const parent = new Int32Array(w * h).fill(-2);
    parent[startIdx] = -1;
    const bfs: number[] = [startIdx];
    let hit = -1;

    for (let head = 0; head < bfs.length && head < 140; head++) {
      const c = bfs[head];
      if (streets[c]) {
        hit = c;
        break;
      }
      const cx = c % w, cy = (c - cx) / w;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (!inside(nx, ny)) continue;
        const n = id(nx, ny);
        if (parent[n] !== -2) continue;
        if (!usable(nx, ny) || builtCellMask[n]) continue;
        if (rankedCivic.some(({ item }) => item.kind !== 'square' && contains(item, nx, ny))) continue;
        if (market && market.occupied[n] && !streets[n]) continue;
        parent[n] = c;
        bfs.push(n);
      }
    }

    if (hit < 0) return undefined;
    const path: Point[] = [];
    let cur = hit;
    while (cur >= 0) {
      path.push({ x: cur % w, y: Math.floor(cur / w) });
      cur = parent[cur];
    }
    return path;
  };

  // Пытаемся поставить вторичную дворовую постройку (сарай, мастерскую, склад, конюшню, амбар — Section 9)
  // сразу за главным домом, чтобы при любом значении ползунка плотности флигель шёл после своего главного дома!
  const tryPlaceSecondaryStructure = (parentIdx: number): number => {
    const plot = placedPlots[parentIdx];
    const sec = plot?.secondaryRect;
    if (!plot || !sec || sec.w < 3 || sec.h < 3) return 0;
    if (!fitsBuilding(sec)) return 0;

    // Ориентируем вход флигеля внутрь двора (в сторону бокового прохода!).
    const secDoorOptions: { door: Point; out: Point; facing: ChestRotation }[] = [
      {
        door: { x: sec.x + sec.w - 1, y: sec.y + Math.floor(sec.h / 2) },
        out: { x: sec.x + sec.w, y: sec.y + Math.floor(sec.h / 2) },
        facing: 270,
      },
      {
        door: { x: sec.x + Math.floor(sec.w / 2), y: sec.y + sec.h - 1 },
        out: { x: sec.x + Math.floor(sec.w / 2), y: sec.y + sec.h },
        facing: 0,
      },
      {
        door: { x: sec.x, y: sec.y + Math.floor(sec.h / 2) },
        out: { x: sec.x - 1, y: sec.y + Math.floor(sec.h / 2) },
        facing: 90,
      },
      {
        door: { x: sec.x + Math.floor(sec.w / 2), y: sec.y },
        out: { x: sec.x + Math.floor(sec.w / 2), y: sec.y - 1 },
        facing: 180,
      },
    ];

    const parentB = placed[parentIdx];
    const dKind = districts[plot.districtIndex].kind;
    const secRole: BuildingRole = parentB.role === 'tavern' || plot.fn === 'noble_villa' || dKind === 'garrison'
      ? 'stable'
      : dKind === 'craft' || parentB.role === 'workshop' || parentB.role === 'smithy'
      ? 'workshop'
      : dKind === 'docks' || parentB.role === 'warehouse' || dKind === 'market'
      ? 'warehouse'
      : dKind === 'farms' || plot.zone === 'suburbs'
      ? 'barn'
      : 'shed';
    const secKind: Building['kind'] = secRole === 'workshop' ? 'shop' : 'house';
    const secRoof: RoofMaterial = style === 'town'
      ? (secRole === 'shed' || secRole === 'barn' ? 0 : parentB.roof)
      : 0;

    for (const opt of secDoorOptions) {
      if (!doorClear(opt.out)) continue;
      const secLot: Building = {
        ...sec,
        style,
        kind: secKind,
        roof: secRoof,
        shape: 'gable',
        source: 'layout',
        door: opt.door,
        facing: opt.facing,
        role: secRole,
      };
      if (!canAcceptBuilding(secLot, opt.out, 0)) continue;
      const passage = findWalkablePassageToStreet(opt.out);
      if (!passage) continue;

      for (const p of passage) {
        if (!streets[id(p.x, p.y)]) passageMask[id(p.x, p.y)] = 1;
      }
      commitBuilding(
        {
          lot: secLot,
          out: opt.out,
          district: plot.districtIndex,
          zone: plot.zone,
          score: 0,
          plot,
          roadLvl: 4,
          marketFront: false,
        },
        {},
        undefined,
        true,
      );
      return sec.w * sec.h;
    }
    return 0;
  };

  let usedArea = placed.reduce((sum, b) => sum + b.w * b.h, 0);

  // Сначала проверяем дворовые пристройки для уже поставленных главных ориентиров (таверна, гильдия, склад!).
  const initialCount = placed.length;
  for (let i = 0; i < initialCount; i++) {
    const added = tryPlaceSecondaryStructure(i);
    if (added > 0) {
      usedArea += added;
      budgets[plotDistrict[i]] += added;
    }
  }

  for (let round = 0; round < 2; round++) {
    for (const cand of candidates) {
      const { lot, out, district } = cand;
      if (usedArea + lot.w * lot.h > cap) continue;
      if (round === 0 && budgets[district] > cap * shareOf(district) * 1.18) continue;
      const gap = gapFor(cand, round);
      if (!canAcceptBuilding(lot, out, gap)) continue;

      const bIdx = commitBuilding(cand, {});
      usedArea += lot.w * lot.h;
      budgets[district] += lot.w * lot.h;

      // В плотных и ремесленных кварталах сразу добавляем дворовый флигель/сарай/мастерскую,
      // чтобы на средней плотности (0.55–0.65) дворы центра уже имели живую вторичную застройку!
      if (usedArea + 12 <= cap && (cand.zone === 'old_core' || cand.zone === 'inner_city' || round === 1)) {
        const secArea = tryPlaceSecondaryStructure(bIdx);
        if (secArea > 0) {
          usedArea += secArea;
          budgets[district] += secArea;
        }
      }
    }
  }

  // ---- 6. Тропинки 4-го уровня (FOOTPATH) к удалённым хуторам/мельницам окраин (Section 10 & 12)
  if (roadNet.lanes.length > 0) {
    for (let i = 0; i < placed.length; i++) {
      const out = placedOut[i];
      const b = placed[i];
      if (secondaryFlags[i]) continue;
      if (streets[id(out.x, out.y)]) continue;
      const fp = skel.footprintAt(b.x + b.w / 2, b.y + b.h / 2);
      if (fp < .85 && b.role !== 'mill') continue;
      const path = findWalkablePassageToStreet(out);
      if (path && path.length >= 2 && path.length <= 10 && streets[id(path[0].x, path[0].y)]) {
        for (const pt of path) {
          if (!builtCellMask[id(pt.x, pt.y)]) {
            roadNet.paintCell(pt.x, pt.y, 'road', 4, false);
          }
        }
        roadNet.lanes.push({
          points: path,
          width: 1,
          surface: 'road',
          level: 4,
          reason: 'тропа к окраинной усадьбе',
        });
      }
    }
  }

  // ---- 7. Оформление 7 типов дворов (Section 8): ограды, навесы, колодцы, сады, поклажа
  const allDoors = new Set<number>();
  for (let i = 0; i < placed.length; i++) {
    allDoors.add(id(placed[i].door.x, placed[i].door.y));
    allDoors.add(id(placedOut[i].x, placedOut[i].y));
  }
  const notNearAnyDoor = (x: number, y: number, w1: number, h1: number) => {
    for (let yy = y - 1; yy <= y + h1; yy++) {
      for (let xx = x - 1; xx <= x + w1; xx++) {
        if (inside(xx, yy) && allDoors.has(id(xx, yy))) return false;
      }
    }
    return true;
  };
  const notInsideAnyHouse = (x: number, y: number, w1: number, h1: number) => {
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        if (!inside(xx, yy) || builtCellMask[id(xx, yy)] || passageMask[id(xx, yy)]) return false;
      }
    }
    return true;
  };

  let courtyardCount = 0;
  const dressedPlotIds = new Set<number>();

  for (let idx = 0; idx < placed.length; idx++) {
    if (secondaryFlags[idx]) continue;
    const b = placed[idx];
    const plot = placedPlots[idx];
    if (plot && dressedPlotIds.has(plot.id)) continue;
    const yard = plot?.yardRect;
    if (!yard || yard.w < 2 || yard.h < 2) continue;
    if (plot) dressedPlotIds.add(plot.id);

    // Находим свободную от флигеля часть двора для реквизита и ограды!
    let freeSpot: Selection | undefined;
    for (const [sw, sh] of [[3, 2], [2, 2], [2, 1], [1, 1]] as const) {
      for (let yy = yard.y; yy <= yard.y + yard.h - sh && !freeSpot; yy++) {
        for (let xx = yard.x; xx <= yard.x + yard.w - sw; xx++) {
          if (notInsideAnyHouse(xx, yy, sw, sh) && notNearAnyDoor(xx, yy, sw, sh)) {
            freeSpot = { x: xx, y: yy, w: sw, h: sh };
            break;
          }
        }
      }
    }
    if (!freeSpot) continue;

    courtyardCount++;
    const cKind = plot?.courtyardKind ?? 'enclosed_courtyard';
    const roll = hash2(yard.x, yard.y, seed + 0x8801 + idx);

    // Небольшой участок ограды по задней кромке двора (не перекрывая проход!).
    if (yard.w >= 4 && cKind !== 'trade_courtyard') {
      const fy = plot!.orientation === 180 ? yard.y + yard.h - 1 : yard.y;
      const fx = yard.x + 1;
      if (notInsideAnyHouse(fx, fy, 2, 1) && notNearAnyDoor(fx, fy, 2, 1)) {
        addRankedCivic(idx, 'marketFence', fx, fy, 2, 1, idx);
      }
    }

    if (b.kind === 'tavern' || b.role === 'tavern' || cKind === 'inn_yard') {
      if (freeSpot.w >= 3 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'marketWagon', freeSpot.x, freeSpot.y, 3, 2, idx);
      } else if (freeSpot.w >= 2 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'marketHay', freeSpot.x, freeSpot.y, 2, 2, idx);
      } else {
        addRankedCivic(idx, 'marketBarrels', freeSpot.x, freeSpot.y, 1, 1, idx);
      }
    } else if (cKind === 'private_garden' || b.role === 'manor') {
      if (freeSpot.w >= 3 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'garden', freeSpot.x, freeSpot.y, 3, 2, idx);
      } else if (freeSpot.w >= 2 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'fountain', freeSpot.x, freeSpot.y, 2, 2, idx);
      }
    } else if (cKind === 'temple_courtyard' || b.role === 'temple') {
      if (freeSpot.w >= 2 && freeSpot.h >= 2) {
        addRankedCivic(idx, roll > .5 ? 'fountain' : 'marketWell', freeSpot.x, freeSpot.y, 2, 2, idx);
      } else {
        addRankedCivic(idx, 'well', freeSpot.x, freeSpot.y, 1, 1, idx);
      }
    } else if (cKind === 'workshop_yard' || b.role === 'workshop' || b.role === 'smithy') {
      const toolKind: CivicKind = b.role === 'smithy'
        ? 'marketWheelbarrowStone'
        : roll < .38 ? 'marketBarrels' : roll < .75 ? 'marketCrates' : 'marketTentCanopy';
      const spec = CIVIC_KIT[toolKind];
      if (freeSpot.w >= spec.w && freeSpot.h >= spec.h) {
        addRankedCivic(idx, toolKind, freeSpot.x, freeSpot.y, spec.w, spec.h, idx);
      } else {
        addRankedCivic(idx, 'marketCrates', freeSpot.x, freeSpot.y, 1, 1, idx);
      }
    } else if (cKind === 'trade_courtyard' || b.role === 'warehouse') {
      const cargo: CivicKind = roll < .4 ? 'marketSacks' : roll < .8 ? 'marketCrates' : 'marketRope';
      const spec = CIVIC_KIT[cargo];
      if (freeSpot.w >= spec.w && freeSpot.h >= spec.h) {
        addRankedCivic(idx, cargo, freeSpot.x, freeSpot.y, spec.w, spec.h, idx);
      }
    } else if (cKind === 'garden_yard') {
      if (freeSpot.w >= 3 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'garden', freeSpot.x, freeSpot.y, 3, 2, idx);
      } else if (freeSpot.w >= 2 && freeSpot.h >= 2) {
        addRankedCivic(idx, 'marketHayLarge', freeSpot.x, freeSpot.y, 2, 2, idx);
      }
    } else {
      // Закрытый городской двор (enclosed_courtyard): колодец, бочки или скамья.
      const prop: CivicKind = roll < .35 ? 'well' : roll < .72 ? 'marketBarrels' : 'marketCrates';
      addRankedCivic(idx, prop, freeSpot.x, freeSpot.y, 1, 1, idx);
    }
  }

  // ---- 7.4. Графовое поле активности (ActivityField), материальный профиль (Phase 9) и фасадные элементы (Phase 7)
  const dressingDensity = dressing ? between(dressing.density, 0, 1) : 0.6;
  const cityCondition: CityCondition = dressing?.condition ?? 'lived_in';

  const activityField = computeUrbanActivityField({
    width: w,
    height: h,
    streets,
    streetLevel: roadNet.streetLevel,
    districts,
    districtAt,
    buildings: placed,
    landmarks,
    gatePoints,
    plaza: plaza && plazaOk ? plaza : undefined,
    marketArea: market?.plan.area,
    riverQuayPoints,
  });

  const districtMaterials: UrbanMaterialProfile[] = districts.map((d) =>
    resolveMaterialProfile(
      cityCondition,
      character.id,
      d.kind,
      d.wealth,
      skel.footprintAt(d.x, d.y) < 0.35 ? 'old_core' : skel.footprintAt(d.x, d.y) < 0.72 ? 'inner_city' : 'outer_city',
    ),
  );
  const materialSummary: UrbanMaterialProfile = districtMaterials.length
    ? {
        age: districtMaterials.reduce((s, m) => s + m.age, 0) / districtMaterials.length,
        wealth: districtMaterials.reduce((s, m) => s + m.wealth, 0) / districtMaterials.length,
        preservation: districtMaterials.reduce((s, m) => s + m.preservation, 0) / districtMaterials.length,
        population: districtMaterials.reduce((s, m) => s + m.population, 0) / districtMaterials.length,
        maintenance: districtMaterials.reduce((s, m) => s + m.maintenance, 0) / districtMaterials.length,
      }
    : resolveMaterialProfile(cityCondition, character.id, 'residential', 0.45, 'inner_city');

  let attachmentsPlaced = 0;
  for (let bi = 0; bi < placed.length; bi += 1) {
    const b = placed[bi];
    const dIdx = plotDistrict[bi] ?? 0;
    const dKind = districts[dIdx]?.kind ?? 'residential';
    const pZone = placedPlots[bi]?.zone ?? 'inner_city';
    const mat = resolveMaterialProfile(cityCondition, character.id, dKind, districts[dIdx]?.wealth ?? 0.45, pZone);
    b.patina = {
      age: Math.round(mat.age * 100) / 100,
      wealth: Math.round(mat.wealth * 100) / 100,
      maintenance: Math.round(mat.maintenance * 100) / 100,
    };
    const outPt = placedOut[bi] ?? b.door;
    const cellIdx = inside(outPt.x, outPt.y) ? id(outPt.x, outPt.y) : id(b.door.x, b.door.y);
    const act = activityField.intensity[cellIdx] ?? 0.4;
    const comm = activityField.commercialPressure[cellIdx] ?? 0.3;
    const atts = buildFacadeAttachments(
      b,
      dKind,
      mat,
      act,
      comm,
      dressingDensity,
      hash2(b.x, b.y, seed + 0x7611),
      hash2(b.door.x, b.door.y, seed + 0x7612),
    );
    if (atts.length > 0) {
      b.attachments = atts;
      attachmentsPlaced += atts.length;
    }
  }

  // ---- 7.5. URBAN DRESSING: материалы дворов, система якорей, микросцены, растительность, мусор.
  // Работает только поверх готовой геометрии: дороги, дома, участки и площадь не меняются.
  const anchors: UrbanAnchor[] = [];
  let dressingStats: BuildingsAndLandmarksResult['dressing'];
  if (dressingDensity > 0.02) {
    const plotRankOf = new Map<number, number>();
    placedPlots.forEach((p, i) => {
      if (p) plotRankOf.set(p.id, i);
    });
    const dressedCells = new Uint8Array(w * h);
    let materialCells = 0;
    let propsPlaced = 0;
    let litterPlaced = 0;
    let treesPlaced = 0;

    const profileOf = (plot: UrbanPlot): UrbanVisualProfile => {
      const district = districts[plot.districtIndex];
      const kind = district?.kind ?? 'residential';
      return districtProfile(kind, plot.wealth ?? district?.wealth ?? 0.45, plot.zone, town);
    };
    const rankOf = (plot: UrbanPlot): number => plotRankOf.get(plot.id) ?? -1;

    /** Свободная площадка под предмет: пригодный грунт или каменные плиты двора ('floor'), без дорог и построек. */
    const freeBox = (x0: number, y0: number, bw: number, bh: number, soilOnly = false): boolean => {
      for (let yy = y0; yy < y0 + bh; yy += 1) {
        for (let xx = x0; xx < x0 + bw; xx += 1) {
          if (!inside(xx, yy)) return false;
          const c = id(xx, yy);
          if (builtCellMask[c] || passageMask[c] || streets[c] || reserved[c]) return false;
          const tr = terrain(xx, yy);
          if (waterDist[c] < 2 || !(isDressableGround(tr) || (!soilOnly && tr === 'floor'))) return false;
        }
      }
      return true;
    };
    const nearStreet = (x0: number, y0: number, bw: number, bh: number, reach: number): boolean => {
      for (let yy = y0 - reach; yy < y0 + bh + reach; yy += 1) {
        for (let xx = x0 - reach; xx < x0 + bw + reach; xx += 1) {
          if (!inside(xx, yy)) continue;
          if (streets[id(xx, yy)]) return true;
        }
      }
      return false;
    };

    // (а) Материалы дворов и подворотен: двор вокруг дома получает покрытие района.
    for (const plot of urbanPlots) {
      const bounds = plot.bounds;
      if (!bounds) continue;
      const profile = profileOf(plot);
      const buildRect = plot.buildRect;
      const material = courtyardGround(
        plot.courtyardKind ?? 'enclosed_courtyard',
        profile,
        hash2(bounds.x, bounds.y, seed + 0x7711),
      );
      for (let yy = bounds.y; yy < bounds.y + bounds.h; yy += 1) {
        for (let xx = bounds.x; xx < bounds.x + bounds.w; xx += 1) {
          if (!inside(xx, yy)) continue;
          const cellId = id(xx, yy);
          if (dressedCells[cellId] || builtCellMask[cellId] || passageMask[cellId]) continue;
          if (streets[cellId] || reserved[cellId] || waterDist[cellId] < 2) continue;
          if (!isDressableGround(terrain(xx, yy))) continue;
          if (buildRect) {
            const gapX = xx < buildRect.x ? buildRect.x - xx : xx >= buildRect.x + buildRect.w ? xx - (buildRect.x + buildRect.w - 1) : 0;
            const gapY = yy < buildRect.y ? buildRect.y - yy : yy >= buildRect.y + buildRect.h ? yy - (buildRect.y + buildRect.h - 1) : 0;
            if (Math.max(gapX, gapY) > 3) continue;
          }
          const noise = hash2(xx, yy, seed + 0x7712);
          const edge = !buildRect || xx === bounds.x || yy === bounds.y || xx === bounds.x + bounds.w - 1 || yy === bounds.y + bounds.h - 1;
          if (edge && noise < 0.5) continue;
          cells[yy][xx].terrain = material;
          dressedCells[cellId] = 1;
          materialCells += 1;
        }
      }
    }

    // (а2) Утоптанная земля вокруг домов: двор читается даже там, где участок тесный.
    for (const plot of urbanPlots) {
      const rect = plot.buildRect;
      if (!rect) continue;
      const profile = profileOf(plot);
      const material = courtyardGround(plot.courtyardKind ?? 'enclosed_courtyard', profile, hash2(rect.x, rect.y, seed + 0x7718));
      for (let yy = rect.y - 2; yy < rect.y + rect.h + 2; yy += 1) {
        for (let xx = rect.x - 2; xx < rect.x + rect.w + 2; xx += 1) {
          if (xx >= rect.x && xx < rect.x + rect.w && yy >= rect.y && yy < rect.y + rect.h) continue;
          if (!inside(xx, yy)) continue;
          const cellId = id(xx, yy);
          if (dressedCells[cellId] || builtCellMask[cellId] || passageMask[cellId]) continue;
          if (streets[cellId] || reserved[cellId] || waterDist[cellId] < 2) continue;
          if (!isDressableGround(terrain(xx, yy))) continue;
          if (hash2(xx, yy, seed + 0x7719) < 0.42) continue;
          cells[yy][xx].terrain = material;
          dressedCells[cellId] = 1;
          materialCells += 1;
        }
      }
    }

    // (б) Микросцены во дворах: бочки, ящики, мешки, сено, телеги, столы по типу двора.
    for (const plot of urbanPlots) {
      const rank = rankOf(plot);
      if (rank < 0 || !plot.bounds) continue;
      const profile = profileOf(plot);
      const courtyard = plot.courtyardKind ?? 'enclosed_courtyard';
      const recipe = YARD_RECIPES[courtyard] ?? YARD_RECIPES.enclosed_courtyard;
      const count = yardPropCount(profile, cityCondition, dressingDensity, hash2(plot.bounds.x, plot.bounds.y, seed + 0x7713));
      const bounds = plot.bounds;
      for (let n = 0; n < count; n += 1) {
        const item = pickWeightedProp(recipe, hash2(bounds.x + n * 7, bounds.y + n * 3, seed + 0x7714));
        for (let attempt = 0; attempt < 18; attempt += 1) {
          const rollX = hash2(bounds.x + attempt * 13 + n * 3, bounds.y + attempt * 7, seed + 0x7716);
          const rollY = hash2(bounds.y + attempt * 11 + n * 5, bounds.x + attempt * 3, seed + 0x7717);
          const px = bounds.x + Math.floor(rollX * Math.max(1, bounds.w - item.w + 1));
          const py = bounds.y + Math.floor(rollY * Math.max(1, bounds.h - item.h + 1));
          if (!freeBox(px, py, item.w, item.h)) continue;
          if (!notNearAnyDoor(px, py, item.w, item.h)) continue;
          if (addRankedCivic(rank, item.kind, px, py, item.w, item.h, n)) {
            propsPlaced += 1;
            break;
          }
        }
      }
    }

    // (в) Уличная мебель: скамьи, колодцы, доски объявлений, поклажа у домов вдоль улиц.
    for (const district of districts) {
      const profile = districtProfile(district.kind, district.wealth, 'inner_city', town);
      const budget = streetBudget(district.area, profile, cityCondition, dressingDensity);
      const recipe = STREET_RECIPES[district.kind] ?? STREET_RECIPES.residential;
      const radius = Math.sqrt(Math.max(1, district.area)) * 0.9;
      for (let n = 0; n < budget; n += 1) {
        const item = pickWeightedProp(recipe, hash2(district.x + n * 5, district.y + n * 9, seed + 0x7720));
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const rollX = hash2(district.x + attempt * 17 + n, district.y + attempt * 3, seed + 0x7721);
          const rollY = hash2(district.y + attempt * 19 + n, district.x + attempt * 7, seed + 0x7722);
          const px = Math.round(district.x + (rollX - 0.5) * radius * 2);
          const py = Math.round(district.y + (rollY - 0.5) * radius * 2);
          if (!freeBox(px, py, item.w, item.h)) continue;
          if (!nearStreet(px, py, item.w, item.h, 2)) continue;
          if (!notNearAnyDoor(px - 1, py - 1, item.w + 2, item.h + 2)) continue;
          if (addRankedCivic(-1, item.kind, px, py, item.w, item.h, n)) {
            propsPlaced += 1;
            break;
          }
        }
      }
    }

    // (г) Мусор и следы жизни: количество зависит от состояния города.
    for (const district of districts) {
      const profile = districtProfile(district.kind, district.wealth, 'inner_city', town);
      const budget = litterBudget(district.area, profile, cityCondition, dressingDensity);
      const radius = Math.sqrt(Math.max(1, district.area)) * 0.9;
      for (let n = 0; n < budget; n += 1) {
        const item = pickWeightedProp(LITTER_PROPS, hash2(district.x + n * 3, district.y + n * 11, seed + 0x7730));
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const rollX = hash2(district.x + attempt * 23 + n, district.y + attempt * 5, seed + 0x7731);
          const rollY = hash2(district.y + attempt * 29 + n, district.x + attempt * 13, seed + 0x7732);
          const px = Math.round(district.x + (rollX - 0.5) * radius * 1.8);
          const py = Math.round(district.y + (rollY - 0.5) * radius * 1.8);
          if (!freeBox(px, py, item.w, item.h)) continue;
          if (!notNearAnyDoor(px - 1, py - 1, item.w + 2, item.h + 2)) continue;
          if (addRankedCivic(-1, item.kind, px, py, item.w, item.h, n)) {
            litterPlaced += 1;
            break;
          }
        }
      }
    }

    // (д) Растительность во дворах: кусты у жилья, деревья в зелёных районах.
    for (const plot of urbanPlots) {
      if (!plot.bounds) continue;
      const profile = profileOf(plot);
      const bounds = plot.bounds;
      const rolls = Math.round((bounds.w + bounds.h) / 5);
      const count = Math.max(0, Math.min(5, Math.round(rolls * profile.vegetation * dressingDensity * conditionFactors(cityCondition).weeds)));
      const green = plot.courtyardKind === 'private_garden' || plot.courtyardKind === 'garden_yard';
      for (let n = 0; n < count; n += 1) {
        const kind: TreeKind = green ? 'bush' : profile.vegetation > 0.55 ? 'oak' : 'bush';
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const rollX = hash2(bounds.x + attempt * 31 + n * 5, bounds.y + attempt * 7, seed + 0x7741);
          const rollY = hash2(bounds.y + attempt * 37 + n * 3, bounds.x + attempt * 11, seed + 0x7742);
          const px = bounds.x + Math.floor(rollX * bounds.w);
          const py = bounds.y + Math.floor(rollY * bounds.h);
          if (!freeBox(px, py, 1, 1, true)) continue;
          if (!notNearAnyDoor(px, py, 1, 1)) continue;
          const cellId = id(px, py);
          ctx.trees.push({
            x: px + 0.5,
            y: py + 0.5,
            r: kind === 'bush' ? 0.34 : 0.55,
            kind,
            v: rollX,
          });
          reserved[cellId] = 1;
          treesPlaced += 1;
          break;
        }
      }
    }

    // (е) Уличные деревья: зелёные аллеи вдоль улиц в жилых и храмовых районах.
    for (const district of districts) {
      const profile = districtProfile(district.kind, district.wealth, 'inner_city', town);
      const budget = Math.max(0, Math.min(18, Math.round((district.area / 110) * profile.vegetation * dressingDensity * conditionFactors(cityCondition).weeds)));
      const radius = Math.sqrt(Math.max(1, district.area)) * 0.95;
      for (let n = 0; n < budget; n += 1) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const rollX = hash2(district.x + attempt * 41 + n, district.y + attempt * 13, seed + 0x7750);
          const rollY = hash2(district.y + attempt * 43 + n, district.x + attempt * 17, seed + 0x7751);
          const px = Math.round(district.x + (rollX - 0.5) * radius * 2);
          const py = Math.round(district.y + (rollY - 0.5) * radius * 2);
          if (!freeBox(px, py, 1, 1, true)) continue;
          if (!nearStreet(px, py, 1, 1, 2)) continue;
          if (!notNearAnyDoor(px, py, 1, 1)) continue;
          ctx.trees.push({
            x: px + 0.5,
            y: py + 0.5,
            r: profile.vegetation > 0.55 ? 0.52 : 0.34,
            kind: profile.vegetation > 0.55 ? 'oak' : 'bush',
            v: rollX,
          });
          reserved[id(px, py)] = 1;
          treesPlaced += 1;
          break;
        }
      }
    }

    // (ж) Ограды участков: низкие заборы по кромке двора с разрывами у входа.
    let fencesPlaced = 0;
    for (const plot of urbanPlots) {
      if (!plot.bounds) continue;
      const bounds = plot.bounds;
      if (bounds.w < 3 || bounds.h < 3) continue;
      const rank = rankOf(plot);
      const wanted =
        plot.courtyardKind === 'private_garden' ||
        plot.courtyardKind === 'garden_yard' ||
        plot.fn === 'noble_villa' ||
        plot.fn === 'farm' ||
        plot.fn === 'stable' ||
        plot.fn === 'garden';
      const chance = wanted ? 0.9 : 0.45;
      if (hash2(bounds.x, bounds.y, seed + 0x7760) > chance * dressingDensity) continue;
      const candidates: { x: number; y: number; vertical: boolean }[] = [];
      const insets = [0, 1];
      for (const inset of insets) {
        for (let x = bounds.x + inset; x <= bounds.x + bounds.w - 2; x += 2) {
          candidates.push({ x, y: bounds.y + inset, vertical: false });
          candidates.push({ x, y: bounds.y + bounds.h - 1 - inset, vertical: false });
        }
        for (let y = bounds.y + 1 + inset; y <= bounds.y + bounds.h - 3; y += 2) {
          candidates.push({ x: bounds.x + inset, y, vertical: true });
          candidates.push({ x: bounds.x + bounds.w - 1 - inset, y, vertical: true });
        }
      }
      let placedHere = 0;
      for (const candidate of candidates) {
        if (placedHere >= 8) break;
        // Ворота/проход: часть кромки остаётся открытой.
        if (hash2(candidate.x, candidate.y, seed + 0x7761) < 0.32) continue;
        // Изношенный город: часть заборов сломана и отсутствует.
        if (cityCondition === 'worn' && hash2(candidate.x, candidate.y, seed + 0x7762) < 0.45) continue;
        const shapes: { fw: number; fh: number; rotation: ChestRotation }[] = candidate.vertical
          ? [{ fw: 1, fh: 2, rotation: 90 }, { fw: 2, fh: 1, rotation: 0 }]
          : [{ fw: 2, fh: 1, rotation: 0 }, { fw: 1, fh: 2, rotation: 90 }];
        for (const shape of shapes) {
          if (!freeBox(candidate.x, candidate.y, shape.fw, shape.fh)) continue;
          if (!notNearAnyDoor(candidate.x - 1, candidate.y - 1, shape.fw + 2, shape.fh + 2)) continue;
          if (addRankedCivic(rank, 'marketFence', candidate.x, candidate.y, shape.fw, shape.fh, 0, shape.rotation)) {
            placedHere += 1;
            fencesPlaced += 1;
            break;
          }
        }
      }
    }

    // (з) Микросцены по назначению участка: мастерская, лавка, таверна, склад, конюшня.
    const FUNCTION_SCENES: Record<string, readonly [CivicKind, number][]> = {
      workshop: [['urbanAnvil', 3], ['urbanForge', 2], ['urbanCoal', 2], ['urbanWorkbench', 2], ['urbanPlanks', 2], ['urbanWoodpile', 2]],
      shop: [['marketCrates', 3], ['marketBarrels', 3], ['urbanSign', 2], ['urbanTrough', 1], ['marketBaskets', 2]],
      tavern: [['marketBarrels', 3], ['marketBench', 2], ['urbanSign', 2], ['marketTable', 1], ['urbanTrough', 1]],
      warehouse: [['marketCrates', 4], ['marketSacks', 3], ['urbanPlanks', 3], ['urbanHides', 2], ['marketRope', 2]],
      stable: [['marketHayLarge', 3], ['urbanTrough', 2], ['cart', 1], ['marketBarrels', 2]],
      temple: [['marketBench', 2], ['urbanPots', 2], ['urbanLamp', 1]],
      noble_villa: [['urbanPots', 2], ['urbanLamp', 2], ['garden', 1]],
      farm: [['marketHay', 3], ['marketSacks', 2], ['urbanPots', 1]],
      garrison: [['marketBarrels', 2], ['urbanTrough', 1], ['marketCrates', 1]],
      courtyard: [['marketBench', 1], ['garden', 1]],
    };
    let scenesPlaced = 0;
    for (const plot of urbanPlots) {
      if (!plot.bounds) continue;
      const scene = FUNCTION_SCENES[plot.fn];
      if (!scene) continue;
      const profile = profileOf(plot);
      const budget = Math.max(0, Math.min(5, Math.round(3 * dressingDensity * (0.7 + profile.objectDensity * 0.6))));
      if (budget === 0) continue;
      const bounds = plot.bounds;
      const rank = rankOf(plot);
      for (let n = 0; n < budget; n += 1) {
        const item = pickWeightedPropDeep(scene, hash2(bounds.x + n * 7, bounds.y + n * 13, seed + 0x7770));
        if (item.w > bounds.w || item.h > bounds.h) continue;
        for (let attempt = 0; attempt < 28; attempt += 1) {
          const rollX = hash2(bounds.x + attempt * 19 + n * 3, bounds.y + attempt * 5, seed + 0x7771);
          const rollY = hash2(bounds.y + attempt * 23 + n * 5, bounds.x + attempt * 11, seed + 0x7772);
          const px = bounds.x + Math.floor(rollX * Math.max(1, bounds.w - item.w));
          const py = bounds.y + Math.floor(rollY * Math.max(1, bounds.h - item.h));
          if (!freeBox(px, py, item.w, item.h)) continue;
          if (!notNearAnyDoor(px - 1, py - 1, item.w + 2, item.h + 2)) continue;
          if (addRankedCivic(rank, item.kind, px, py, item.w, item.h, n)) {
            propsPlaced += 1;
            scenesPlaced += 1;
            break;
          }
        }
      }
    }

    // (и) Огороды и сады: грядки утоптанной земли внутри двора.
    let bedsPlaced = 0;
    for (const plot of urbanPlots) {
      if (!plot.bounds) continue;
      const bounds = plot.bounds;
      if (bounds.w < 4 || bounds.h < 3) continue;
      const farm = plot.fn === 'farm' || plot.fn === 'garden';
      const garden = plot.courtyardKind === 'private_garden' || plot.courtyardKind === 'garden_yard';
      if (!farm && !garden) continue;
      if (hash2(bounds.x, bounds.y, seed + 0x7780) > 0.85 * dressingDensity) continue;
      const rows = farm ? 3 : 2;
      for (let row = 0; row < rows; row += 1) {
        let painted = 0;
        for (let attempt = 0; attempt < 14; attempt += 1) {
          const rollX = hash2(bounds.x + attempt * 13 + row * 3, bounds.y + row * 5, seed + 0x7781);
          const rollY = hash2(bounds.y + attempt * 17 + row * 7, bounds.x + attempt * 5, seed + 0x7782);
          const bx = bounds.x + Math.floor(rollX * Math.max(1, bounds.w - 3));
          const by = bounds.y + Math.floor(rollY * Math.max(1, bounds.h - 1));
          if (!freeBox(bx, by, 3, 1)) continue;
          let ok = true;
          for (let x = bx; x < bx + 3; x += 1) {
            if (!isDressableGround(terrain(x, by))) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          for (let x = bx; x < bx + 3; x += 1) {
            cells[by][x].terrain = 'dirt';
            dressedCells[id(x, by)] = 1;
            painted += 1;
          }
          break;
        }
        if (painted > 0) {
          materialCells += painted;
          bedsPlaced += 1;
        }
      }
    }

    // (к) Якорная система размещения пропсов (Phase 6: перекрёстки, ворота, набережные, фасады, тупики)
    // с соблюдением minSpacing через SpatialHash и категорий DISTRICT_DRESSING!
    const propKindHash = new Map<CivicKind, SpatialHash<CivicKind>>();
    const hashForKind = (k: CivicKind) => {
      let sh = propKindHash.get(k);
      if (!sh) {
        sh = new SpatialHash<CivicKind>(w, h, 8);
        propKindHash.set(k, sh);
      }
      return sh;
    };
    for (const rc of rankedCivic) {
      if (rc.item.kind !== 'square') {
        hashForKind(rc.item.kind).insert(rc.item.kind, rc.item.x, rc.item.y, rc.item.w, rc.item.h);
      }
    }

    const pushVergeAnchor = (sx: number, sy: number, aKind: UrbanAnchor['kind'], buildingIndex?: number) => {
      for (const dist of [1, 2]) {
        for (const [dx, dy, side] of [[0, -1, 2], [1, 0, 3], [0, 1, 0], [-1, 0, 1]] as const) {
          const vx = sx + dx * dist;
          const vy = sy + dy * dist;
          if (!inside(vx, vy) || !freeBox(vx, vy, 1, 1) || !notNearAnyDoor(vx, vy, 1, 1)) continue;
          const ci = id(vx, vy);
          const dIdx = Math.max(0, districtAt[ci]);
          anchors.push({
            x: vx,
            y: vy,
            kind: aKind,
            facing: MARKET_FACING_ROT[side],
            districtIndex: dIdx,
            districtKind: districts[dIdx]?.kind ?? 'residential',
            activity: activityField.intensity[ci] ?? 0.5,
            commercial: activityField.commercialPressure[ci] ?? 0.3,
            buildingIndex,
          });
          return;
        }
      }
    };

    for (const pt of activityField.intersections) pushVergeAnchor(pt.x, pt.y, 'intersection');
    for (const gp of gatePoints) {
      for (let r = 2; r <= 4; r += 1) {
        pushVergeAnchor(gp.x + r, gp.y, 'gate_zone');
        pushVergeAnchor(gp.x - r, gp.y, 'gate_zone');
      }
    }
    for (let qi = 0; qi < riverQuayPoints.length; qi += 3) {
      pushVergeAnchor(riverQuayPoints[qi].x, riverQuayPoints[qi].y, 'quayside');
    }
    if (plaza && plazaOk) {
      for (let x = plaza.x; x < plaza.x + plaza.w; x += 3) {
        pushVergeAnchor(x, plaza.y, 'plaza_edge');
        pushVergeAnchor(x, plaza.y + plaza.h - 1, 'plaza_edge');
      }
    }
    for (const de of activityField.deadEnds) pushVergeAnchor(de.x, de.y, 'alley_back');

    for (let bi = 0; bi < placed.length; bi += 1) {
      const b = placed[bi];
      const outPt = placedOut[bi];
      if (outPt && inside(outPt.x, outPt.y)) {
        // Сбоку от двери у фасада (никогда не на самой клетке перед дверью!):
        const [fx, fy] = facingVector(b.facing ?? 0);
        const tx = fy !== 0 ? 1 : 0;
        const ty = fx !== 0 ? 1 : 0;
        for (const sgn of [-2, 2]) {
          const ax = outPt.x + tx * sgn;
          const ay = outPt.y + ty * sgn;
          if (inside(ax, ay) && freeBox(ax, ay, 1, 1) && notNearAnyDoor(ax, ay, 1, 1)) {
            const ci = id(ax, ay);
            const dIdx = plotDistrict[bi] ?? Math.max(0, districtAt[ci]);
            anchors.push({
              x: ax,
              y: ay,
              kind: b.kind === 'shop' || b.kind === 'tavern' ? 'facade_front' : 'facade_side',
              facing: b.facing ?? 0,
              districtIndex: dIdx,
              districtKind: districts[dIdx]?.kind ?? 'residential',
              activity: activityField.intensity[ci] ?? 0.4,
              commercial: activityField.commercialPressure[ci] ?? 0.25,
              buildingIndex: bi,
            });
            break;
          }
        }
      }
    }

    let anchorPropsPlaced = 0;
    const anchorChanceBase = 0.24 + dressingDensity * 0.46;
    for (let ai = 0; ai < anchors.length; ai += 1) {
      const anchor = anchors[ai];
      const gateRoll = hash2(anchor.x + ai * 3, anchor.y + ai * 7, seed + 0x7790);
      const localChance = anchorChanceBase * (0.55 + anchor.activity * 0.65);
      if (gateRoll > localChance) continue;
      const mat = districtMaterials[anchor.districtIndex] ?? materialSummary;
      const chosen = selectPropForAnchor(
        anchor,
        mat,
        cityCondition,
        hash2(anchor.x, anchor.y, seed + 0x7791 + ai),
      );
      if (!chosen) continue;
      const { w: pw1, h: ph1 } = chosen.footprint;
      if (!freeBox(anchor.x, anchor.y, pw1, ph1)) continue;
      if (!notNearAnyDoor(anchor.x - 1, anchor.y - 1, pw1 + 2, ph1 + 2)) continue;
      const kindHash = hashForKind(chosen.id);
      if (kindHash.hasWithinRadius(anchor.x + pw1 * 0.5, anchor.y + ph1 * 0.5, chosen.minSpacing)) continue;
      const rot: ChestRotation =
        chosen.orientationMode === 'fixed'
          ? 0
          : chosen.orientationMode === 'parallel_wall'
            ? (((anchor.facing + 90) % 360) as ChestRotation)
            : anchor.facing;
      const rank = anchor.buildingIndex ?? -1;
      if (addRankedCivic(rank, chosen.id, anchor.x, anchor.y, pw1, ph1, ai, rot)) {
        kindHash.insert(chosen.id, anchor.x, anchor.y, pw1, ph1);
        propsPlaced += 1;
        anchorPropsPlaced += 1;
        if (chosen.clusterRule !== 'solo' && pw1 === 1 && ph1 === 1) {
          for (const [cdx, cdy] of N4) {
            const nx = anchor.x + cdx;
            const ny = anchor.y + cdy;
            if (freeBox(nx, ny, 1, 1) && notNearAnyDoor(nx - 1, ny - 1, 3, 3)) {
              if (addRankedCivic(rank, 'marketBaskets', nx, ny, 1, 1, ai + 1, rot)) {
                propsPlaced += 1;
                anchorPropsPlaced += 1;
              }
              break;
            }
          }
        }
      }
    }

    // (л) Обломки/щебень ТОЛЬКО в действительно разрушенных/заброшенных зонах (Old ≠ Ruined, Poor ≠ Ruined!):
    for (let di = 0; di < districts.length; di += 1) {
      const mat = districtMaterials[di];
      if (!mat || mat.preservation >= 0.42 || mat.population >= 0.45) continue;
      const d = districts[di];
      const rubbleBudget = Math.min(8, Math.round((1 - mat.preservation) * 6 * dressingDensity));
      const rad = Math.sqrt(Math.max(4, d.area)) * 0.8;
      for (let ri = 0; ri < rubbleBudget; ri += 1) {
        const rx = Math.round(d.x + (hash2(d.x + ri * 11, d.y, seed + 0x77a1) - 0.5) * rad * 1.6);
        const ry = Math.round(d.y + (hash2(d.y + ri * 13, d.x, seed + 0x77a2) - 0.5) * rad * 1.6);
        if (freeBox(rx, ry, 1, 1) && notNearAnyDoor(rx, ry, 1, 1)) {
          const r = 0.22;
          ctx.rocks.push({
            x: rx + 0.5,
            y: ry + 0.5,
            r,
            v: 0.72,
            pts: [[-r, -r * 0.7], [r * 0.9, -r * 0.5], [r * 0.8, r * 0.8], [-r * 0.8, r * 0.6]],
          });
        }
      }
    }

    dressingStats = {
      materialCells,
      propsPlaced,
      litterPlaced,
      treesPlaced,
      fencesPlaced,
      scenesPlaced,
      bedsPlaced,
      anchorsEvaluated: anchors.length,
      anchorPropsPlaced,
      attachmentsPlaced,
    };
  }

  for (const plot of urbanPlots) {
    if (plot.fn !== 'garden' || !plot.yardRect) continue;
    const yr = plot.yardRect;
    if (yr.w >= 3 && yr.h >= 2 && notInsideAnyHouse(yr.x, yr.y, 3, 2) && notNearAnyDoor(yr.x, yr.y, 3, 2)) {
      addRankedCivic(-1, 'garden', yr.x, yr.y, 3, 2, plot.id);
    }
  }

  if (!ctx.small && (town || type.id === 'large_village' || character.id === 'religious')) {
    const cemPlot = urbanPlots.find((p) =>
      (p.fn === 'empty' || p.fn === 'courtyard' || p.fn === 'garden')
      && p.bounds.w >= 5 && p.bounds.h >= 4
      && (p.zone === 'suburbs' || p.zone === 'outer_city' || p.districtType === 'temple')
      && notInsideAnyHouse(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h)
      && notNearAnyDoor(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h),
    );
    if (cemPlot) {
      const { x: cx, y: cy, w: cw, h: ch } = cemPlot.bounds;
      addRankedCivic(-1, 'marketFence', cx, cy, 2, 1, 0);
      ctx.trees.push({ x: cx + cw - 1.2, y: cy + 1.2, r: .38, kind: 'dead', v: .5 });
      for (let gy = cy + 1; gy < cy + ch - 0.5; gy += 1.4) {
        for (let gx = cx + 0.8; gx < cx + cw - 1.5; gx += 1.3) {
          const rx = Math.round(gx), ry = Math.round(gy);
          if (inside(rx, ry) && usable(rx, ry) && !streets[id(rx, ry)]) {
            const r = .16;
            ctx.rocks.push({
              x: gx,
              y: gy,
              r,
              v: .8,
              pts: [[-r, -r * .6], [r, -r * .6], [r, r * .7], [-r, r * .7]],
            });
          }
        }
      }
      landmarks.push({
        id: 'cemetery_0',
        kind: 'cemetery',
        label: 'Старое кладбище',
        x: cx + Math.floor(cw / 2),
        y: cy + Math.floor(ch / 2),
        bounds: { ...cemPlot.bounds },
        district: cemPlot.districtType,
        accessible: true,
      });
    }
  }

  if (geography === 'mountain') {
    let oreSpots = 0;
    for (const rc of geo.retainingCells) {
      if (oreSpots >= 4) break;
      if (!inside(rc.x, rc.y) || streets[id(rc.x, rc.y)] || !notInsideAnyHouse(rc.x, rc.y, 2, 1)) continue;
      if (!notNearAnyDoor(rc.x, rc.y, 2, 1)) continue;
      if (hash2(rc.x, rc.y, seed + 0x991) > .18) continue;
      if (addRankedCivic(Math.min(placed.length - 1, 2), 'marketWheelbarrowStone', rc.x, rc.y, 2, 1, oreSpots)) {
        oreSpots++;
      }
    }
  }

  if ((character.id === 'trade' || type.id === 'trade_town' || type.id === 'large_city') && gatePoints.length > 0) {
    const gp = gatePoints[0];
    for (let dy = -5; dy <= 5; dy++) {
      let placedCamp = false;
      for (let dx = -5; dx <= 5; dx++) {
        const cx = gp.x + dx, cy = gp.y + dy;
        if (!inside(cx, cy) || walls.insideWalls(cx, cy)) continue;
        if (notInsideAnyHouse(cx, cy, 3, 2) && notNearAnyDoor(cx, cy, 3, 2)) {
          if (addRankedCivic(Math.min(placed.length - 1, 3), 'marketWagonCovered', cx, cy, 3, 2, 0)) {
            placedCamp = true;
            break;
          }
        }
      }
      if (placedCamp) break;
    }
  }

  // ---- 9. Тактические и приключенческие цепочки D&D (Section 15) ------------
  if (plaza && plazaOk && warehouseIdx >= 0) {
    const wh = placed[warehouseIdx];
    const mid = {
      x: Math.round((plaza.x + plaza.w / 2 + wh.x + wh.w / 2) / 2),
      y: Math.round((plaza.y + plaza.h / 2 + wh.y + wh.h / 2) / 2),
    };
    chains.push({
      id: 'chain_smuggler',
      kind: 'smuggler_route',
      label: 'Рынок → Переулок → Склад',
      points: [
        { x: plaza.x + Math.floor(plaza.w / 2), y: plaza.y + Math.floor(plaza.h / 2) },
        mid,
        { x: wh.door.x, y: wh.door.y },
      ],
    });
  }

  if (tavernIdx >= 0) {
    const tv = placed[tavernIdx];
    const tvPlot = placedPlots[tavernIdx];
    const backPt = tvPlot?.yardRect
      ? { x: tvPlot.yardRect.x + Math.floor(tvPlot.yardRect.w / 2), y: tvPlot.yardRect.y + Math.floor(tvPlot.yardRect.h / 2) }
      : { x: tv.x + Math.floor(tv.w / 2), y: tv.y };
    chains.push({
      id: 'chain_tavern',
      kind: 'tavern_backyard',
      label: 'Таверна → Задний двор → Переулок',
      points: [tv.door, backPt, placedOut[tavernIdx]],
    });
  }

  if (walls.walled && gatePoints.length > 0 && roadNet.towers.length > 0) {
    const gp = gatePoints[0];
    const nearTower = roadNet.towers.reduce((best, t) =>
      Math.hypot(t.x - gp.x, t.y - gp.y) < Math.hypot(best.x - gp.x, best.y - gp.y) ? t : best,
    roadNet.towers[0]);
    chains.push({
      id: 'chain_wall',
      kind: 'wall_watch',
      label: 'Городская стена → Башня → Ворота',
      points: [nearTower, gp],
    });
  }

  if (pierHeads.length > 0 && warehouseIdx >= 0) {
    const wh = placed[warehouseIdx];
    chains.push({
      id: 'chain_dock',
      kind: 'dock_warehouse',
      label: 'Причал → Набережная → Склад',
      points: [pierHeads[0], { x: wh.door.x, y: wh.door.y }],
    });
  }

  // Финальная гарантия: ни один городской предмет не перекрывает клетку
  // непосредственно перед дверью — иначе выход из дома блокируется.
  const doorStepCells = new Set<number>();
  for (const b of placed) {
    const step = b.facing === 90 ? [-1, 0] : b.facing === 180 ? [0, -1] : b.facing === 270 ? [1, 0] : [0, 1];
    const sx = b.door.x + step[0];
    const sy = b.door.y + step[1];
    if (inside(sx, sy)) doorStepCells.add(id(sx, sy));
  }
  let doorClearance = 0;
  for (let i = rankedCivic.length - 1; i >= 0; i--) {
    const item = rankedCivic[i].item;
    if (item.kind === 'square' || doorStepCells.size === 0) continue;
    let blocksDoor = false;
    for (let yy = item.y; yy < item.y + item.h && !blocksDoor; yy += 1) {
      for (let xx = item.x; xx < item.x + item.w; xx += 1) {
        if (inside(xx, yy) && doorStepCells.has(id(xx, yy))) {
          blocksDoor = true;
          break;
        }
      }
    }
    if (!blocksDoor) continue;
    for (let yy = item.y; yy < item.y + item.h; yy += 1) {
      for (let xx = item.x; xx < item.x + item.w; xx += 1) {
        if (inside(xx, yy)) reserved[id(xx, yy)] = 0;
      }
    }
    civicHash.remove((other) => other === item);
    rankedCivic.splice(i, 1);
    doorClearance += 1;
  }

  // ---- 10. Честное городское освещение (Phase 8: LightSource[]) --------------
  // Источники света следуют за уличными фонарями, кузнечными горнами, воротами,
  // причалами, настенными бра и жилыми окнами с учётом ухода (maintenance) и населённости!
  const lights: LightSource[] = [];
  for (const rc of rankedCivic) {
    const it = rc.item;
    if (it.kind !== 'urbanLamp' && it.kind !== 'urbanForge') continue;
    const ci = inside(it.x, it.y) ? id(it.x, it.y) : 0;
    const dIdx = Math.max(0, districtAt[ci]);
    const mat = districtMaterials[dIdx] ?? materialSummary;
    const dKind = districts[dIdx]?.kind ?? 'residential';
    // В бедных/запущенных кварталах часть уличных фонарей не горит -> реальные тёмные переулки!
    const workingChance = it.kind === 'urbanForge' ? 0.85 : 0.25 + mat.maintenance * 0.75;
    if (hash2(it.x, it.y, seed + 0x8801) > workingChance) continue;
    lights.push({
      x: it.x + it.w * 0.5,
      y: it.y + it.h * 0.5,
      radius: it.kind === 'urbanForge' ? 4.2 : 4.8 + mat.wealth * 1.4,
      intensity: it.kind === 'urbanForge' ? 0.82 : 0.72 + mat.maintenance * 0.24,
      color: it.kind === 'urbanForge' ? '#ff7b3d' : '#ffb85c',
      kind: it.kind === 'urbanForge' ? 'brazier' : 'street_lantern',
      district: dKind,
    });
  }
  for (const gp of gatePoints) {
    lights.push({
      x: gp.x + 0.5,
      y: gp.y + 0.5,
      radius: 5.6,
      intensity: 0.92,
      color: '#ffa64c',
      kind: 'gate_torch',
    });
  }
  for (const ph of pierHeads) {
    lights.push({
      x: ph.x + 0.5,
      y: ph.y + 0.5,
      radius: 4.8,
      intensity: 0.82,
      color: '#ffbe6b',
      kind: 'pier_lantern',
      district: 'docks',
    });
  }
  for (let bi = 0; bi < placed.length; bi += 1) {
    const b = placed[bi];
    const dIdx = plotDistrict[bi] ?? 0;
    const mat = districtMaterials[dIdx] ?? materialSummary;
    const dKind = districts[dIdx]?.kind ?? 'residential';
    // Настенные фонари на фасадах:
    if (b.attachments) {
      for (const att of b.attachments) {
        if (!att.emitsLight) continue;
        const [fx, fy] = facingVector(att.side);
        const tx = fy !== 0 ? 1 : 0;
        const ty = fx !== 0 ? 1 : 0;
        const wallSpan = att.side === 0 || att.side === 180 ? b.w : b.h;
        const cx = b.x + b.w * 0.5 + fx * (att.side === 90 || att.side === 270 ? b.w * 0.5 + 0.25 : 0) + tx * att.offset * wallSpan;
        const cy = b.y + b.h * 0.5 + fy * (att.side === 0 || att.side === 180 ? b.h * 0.5 + 0.25 : 0) + ty * att.offset * wallSpan;
        if (cx >= 0 && cy >= 0 && cx <= w && cy <= h) {
          lights.push({
            x: Math.round(cx * 100) / 100,
            y: Math.round(cy * 100) / 100,
            radius: 3.8,
            intensity: 0.72,
            color: '#ffc478',
            kind: 'wall_sconce',
            district: dKind,
          });
        }
      }
    }
    // Мягкий свет из окон обитаемых зданий (таверн, храмов, зажиточных и жилых домов):
    const litWindowChance =
      b.kind === 'tavern'
        ? 0.95
        : b.role === 'temple' || b.role === 'town_hall'
          ? 0.85
          : mat.population * (0.28 + mat.wealth * 0.35);
    if (hash2(b.x, b.y, seed + 0x8809) < litWindowChance) {
      lights.push({
        x: b.x + b.w * 0.5,
        y: b.y + b.h * 0.5,
        radius: Math.max(b.w, b.h) * 0.72 + 1.4,
        intensity: b.kind === 'tavern' ? 0.62 : 0.38,
        color: '#ffd599',
        kind: 'window_glow',
        district: dKind,
      });
    }
  }

  if (dressingStats) {
    dressingStats.doorClearance = doorClearance;
    dressingStats.lightsPlaced = lights.length;
  }

  return {
    buildings: placed,
    plotDistrict,
    placedPlots,
    secondaryFlags,
    passageMask,
    rankedCivic,
    landmarks,
    chains,
    piers,
    courtyardCount,
    dressing: dressingStats,
    activityField,
    anchors,
    lights,
    materialSummary,
  };
}
