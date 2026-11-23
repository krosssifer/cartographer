import { hash2 } from '../../random';
import { CIVIC_KIT, contains, intersects } from '../../settlementKit';
import { DISTRICTS, type DistrictKind } from '../settlementTypes';
import { facesMarket, type MarketOutcome } from '../marketLayout';
import type {
  Building,
  BuildingAnnex,
  BuildingRole,
  ChestRotation,
  CivicKind,
  CivicObject,
  Point,
  RoofMaterial,
  RoofShape,
  Selection,
  SettlementStyle,
} from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { UrbanSkeleton } from './nodes';
import type { PlotSubdivisionResult } from './plots';
import type { UrbanRoadResult } from './roads';
import {
  N4,
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
} from './types';

export interface BuildingsAndLandmarksResult {
  buildings: Building[];
  plotDistrict: number[];
  rankedCivic: RankedCivic[];
  landmarks: UrbanLandmark[];
  chains: AdventureChain[];
  piers: number;
  courtyardCount: number;
}

const CARGO_GOODS: readonly CivicKind[] = [
  'marketCrates', 'marketBarrels', 'marketSacks', 'marketBarrelPair', 'marketRope',
];

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
): BuildingsAndLandmarksResult {
  const { width: w, height: h, seed, type, character, town, geo } = ctx;
  const { cells, waterDist, geography, length, span, at } = geo;
  const { RX, RY, reach, walls, keepBox, keepFree, reserved } = skel;
  const { streets, gates, gatePoints, plaza, plazaOk, marketResolution } = roadNet;
  const { districts, districtAt, blocks } = distLayout;
  const { plots: urbanPlots, distanceToStreet, nearWall } = plotSub;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  const rankedCivic: RankedCivic[] = baseCivic.map((item) => ({ item, plotRank: -1 }));
  const landmarks: UrbanLandmark[] = [];
  const chains: AdventureChain[] = [];

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
        if (kind !== 'square' && reserved[id(xx, yy)]) return false;
      }
    }
    const probe = { x, y, w: w1, h: h1 };
    if (rankedCivic.some(({ item: other }) => other.kind !== 'square' && kind !== 'square' && intersects(other, probe))) {
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
    for (let yy = y; yy < y + h1; yy++) {
      for (let xx = x; xx < x + w1; xx++) {
        reserved[id(xx, yy)] = 1;
        if (kind === 'garden' && plotRank < 0 && !streets[id(xx, yy)]) {
          cells[yy][xx].terrain = 'dirt';
        }
      }
    }
    return true;
  }

  // ---- 1. Портовые причалы и набережные грузы -------------------------------
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
      if (!dockDistricts.some((d) => Math.hypot(d.x - head.x, d.y - head.y) < Math.max(RX, RY) * .78)) continue;
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
      // Соединяем причал с набережной 4-связной дорожкой!
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

  // ---- 2. Малые скверы, колодцы на развилках и телеги у ворот ---------------
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
          x: cx, y: cy,
          bounds: { x: cx, y: cy, w: sz, h: sz },
          district: block.districtKind,
          accessible: true,
        });
      }
    }
  }

  // Регистрируем ворота и главную площадь как landmarks.
  gatePoints.forEach((gp, idx) => {
    const dIdx = districtAt[id(between(gp.x, 0, w - 1), between(gp.y, 0, h - 1))];
    landmarks.push({
      id: `gate_${idx}`,
      kind: 'gate',
      label: `Городские ворота ${idx + 1}`,
      x: gp.x, y: gp.y,
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

  // Телеги у ворот.
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

  // ---- 3. Подготовка кандидатов зданий из участков (Plots) + Infill ---------
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
      return roll < .58 ? 'awning' : undefined;
    }
    if (kind === 'hall' || role === 'town_hall' || role === 'temple' || role === 'manor') {
      return roll < .52 ? 'porch' : bRect.w >= 7 && bRect.h >= 5 && roll < .82 ? 'wing' : undefined;
    }
    if (wealth > .62 && bRect.w >= 6 && roll < .42) return 'dormer';
    if (roll > .84 && bRect.w >= 6 && bRect.h >= 5) return 'wing';
    return undefined;
  }

  // 3A. Здания непосредственно по размеченным участкам (UrbanPlot).
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

    const dist = distanceToStreet[id(out.x, out.y)];
    const score = (marketFront ? 2.4 : 0)
      + (5 - plot.roadLevel) * .55
      + dDef.appeal * 1.8
      - reach(bRect.x + bRect.w / 2, bRect.y + bRect.h / 2) * (town ? 1.15 : 2.1)
      - (streets.some(Boolean) ? dist * .42 : 0)
      + hash2(bRect.x, bRect.y, seed + 6501) * 1.4;

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
      score,
      plot,
      roadLvl: plot.roadLevel,
      marketFront,
    });
  }

  // 3B. Запасные кандидаты для узких/клиновидных кварталов и малых карт,
  // чтобы кривые улицы никогда не оставляли кварталы пустыми.
  const maxFallbackDist = town ? 6 : 8;
  const hasAnyRoad = roadNet.lanes.length > 0;
  const scanStep = ctx.tight || type.extent < .65 ? 1 : 2;
  for (let y = 1; y < h - 4; y += scanStep) {
    for (let x = 1; x < w - 4; x += scanStep) {
      const home = districtAt[id(x, y)];
      if (home < 0) continue;
      const dDef = DISTRICTS[districts[home].kind];
      for (let option = 0; option < 2; option++) {
        const len = option === 0 ? Math.max(4, dDef.length[0]) : 4;
        const dep = option === 0 ? Math.max(4, dDef.depth[0]) : 4;
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
        };
        const score = (mFront ? 2.0 : 0) + dDef.appeal * 1.2 - reach(hx, hy) * 1.6 - (hasAnyRoad ? dist * .48 : 0)
          + hash2(x, y, seed + 6509 + option) * .9 - .8; // Чуть ниже приоритет, чем у межевых участков.
        candidates.push({
          lot, out: entry.out, district: home, score, roadLvl: dist <= 1 ? 3 : 4, marketFront: mFront,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.lot.y - b.lot.y || a.lot.x - b.lot.x);

  // ---- 4. Размещение городских ЛАНДМАРКОВ по условиям (Section 12) ----------
  const placed: Building[] = [];
  const placedOut: Point[] = [];
  const plotDistrict: number[] = [];
  const placedPlots: (UrbanPlot | undefined)[] = [];

  const canAcceptBuilding = (lot: Building, out: Point, gap: number): boolean =>
    !placed.some((other) => intersects(lot, other, gap) || contains(other, out.x, out.y))
    && !placedOut.some((p) => contains(lot, p.x, p.y));

  const commitBuilding = (
    cand: Candidate,
    override: Partial<Building>,
    landmarkInfo?: { kind: LandmarkKind; label: string },
  ): number => {
    const finalLot: Building = { ...cand.lot, ...override };
    const idx = placed.length;
    placed.push(finalLot);
    placedOut.push(cand.out);
    plotDistrict.push(cand.district);
    placedPlots.push(cand.plot);
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

  // 4.1 Цитадель крепости (всегда первая!).
  if (keepBox && keepFree) {
    const door = { x: keepBox.x + Math.floor(keepBox.w / 2), y: keepBox.y + keepBox.h - 1 };
    const out = { x: door.x, y: door.y + 1 };
    const dIdx = Math.max(0, districtAt[id(door.x, door.y)]);
    placed.push({
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
    });
    placedOut.push(out);
    plotDistrict.push(dIdx);
    placedPlots.push(undefined);
    landmarks.push({
      id: 'citadel_0', kind: 'citadel', label: 'Цитадель',
      x: keepBox.x + Math.floor(keepBox.w / 2), y: keepBox.y + Math.floor(keepBox.h / 2),
      bounds: { ...keepBox }, district: districts[dIdx]?.kind ?? 'garrison', accessible: true,
    });
  } else if (type.keep) {
    ctx.notes.push('цитадель не поместилась');
  }

  // 4.2 Главная таверна / постоялый двор (на площади, главной дороге или набережной).
  let tavernIdx = -1;
  if (type.style === 'town' || type.id === 'large_village') {
    const tavernFits = (c: Candidate) =>
      c.lot.w * c.lot.h >= 28 && Math.min(c.lot.w, c.lot.h) >= 5
      && ['centre', 'market', 'residential', 'docks'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1);
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

  // 4.3 Ратуша (Town Hall) — в центральном районе или у площади для городов.
  if (town && !type.keep && ['trade_town', 'fortified_town', 'small_city', 'large_city', 'port', 'craft_town'].includes(type.id)) {
    const hallCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 30
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

  // 4.4 Главный храм (Main Temple) — в храмовом или центральном квартале, на возвышении/площади.
  if (type.districts.temple || character.id === 'religious' || type.id === 'large_city' || type.id === 'small_city') {
    const templeCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 28
      && ['temple', 'centre', 'noble'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 2),
    );
    if (templeCand) {
      commitBuilding(
        templeCand,
        { kind: 'hall', roof: style === 'town' ? 4 : 6, shape: 'cross', role: 'temple', annex: 'porch' },
        { kind: 'main_temple', label: 'Главный храм' },
      );
    }
  }

  // 4.5 Казармы и тюрьма — рядом с крепостью, воротами или стеной.
  if (type.districts.garrison || walls.walled || character.id === 'military') {
    const barrackCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 24
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

  // 4.6 Большой склад (Warehouse) — у порта или торгового квартала.
  let warehouseIdx = -1;
  if (type.districts.docks || type.districts.market || character.id === 'trade' || character.id === 'port') {
    const whCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 24
      && ['docks', 'market', 'craft'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (whCand) {
      warehouseIdx = commitBuilding(
        whCand,
        { kind: 'hall', roof: style === 'town' ? 1 : 7, shape: 'gable', role: 'warehouse' },
        { kind: 'warehouse', label: 'Городской склад' },
      );
    }
  }

  // 4.7 Кузница (Smithy) — в ремесленном районе или гарнизоне.
  if (type.districts.craft || type.districts.garrison || type.id === 'mountain') {
    const smithCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 20
      && ['craft', 'garrison', 'residential'].includes(districts[c.district].kind)
      && canAcceptBuilding(c.lot, c.out, 1),
    );
    if (smithCand) {
      commitBuilding(
        smithCand,
        { kind: 'shop', roof: style === 'town' ? 3 : 1, shape: 'gable', role: 'smithy', annex: 'awning' },
        { kind: 'smithy', label: 'Кузница' },
      );
    }
  }

  // 4.8 Мельница (Mill) — у реки или на открытой окраине/полях.
  if ((geo.river.length || type.districts.farms || type.id === 'large_village') && !ctx.small) {
    const millCand = candidates.find((c) => {
      if (c.lot.w > 6 || c.lot.h > 6 || !canAcceptBuilding(c.lot, c.out, 2)) return false;
      const wd = waterDist[id(c.lot.x, c.lot.y)];
      const onOutskirt = ['farms', 'craft', 'poor'].includes(districts[c.district].kind) || reach(c.lot.x, c.lot.y) > .72;
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
        if (doorClear(out) && canAcceptBuilding({ ...millCand.lot, ...mRect, door }, out, 2)) {
          commitBuilding(
            { ...millCand, lot: { ...millCand.lot, ...mRect, door }, out },
            { kind: 'tower', roof: style === 'town' ? 1 : 0, shape: 'hip', role: 'mill' },
            { kind: 'mill', label: waterDist[id(mRect.x, mRect.y)] <= 6 ? 'Водяная мельница' : 'Ветряная мельница' },
          );
        }
      }
    }
  }

  // 4.9 Общественные бани (в крупных/средних городах у воды или центра).
  if ((type.id === 'large_city' || type.id === 'small_city' || character.id === 'noble') && !ctx.small) {
    const bathCand = candidates.find((c) =>
      c.lot.w * c.lot.h >= 24
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

  // ---- 5. Заполнение участков по бюджету кварталов (не на 100%!) ------------
  const totalDistrictWeight = Object.values(type.districts).reduce((s, v) => s + (v ?? 0), 0) || 1;
  let usableLandCount = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (usable(x, y)) usableLandCount++;
  const usableShare = usableLandCount / Math.max(1, (w - 4) * (h - 4));
  // Бюджет площади под крышами не превышает разумный предел: дворы, сады и проходы сохраняются!
  const cap = Math.max(ctx.small ? 80 : 235, Math.floor(w * h * type.fill * between(usableShare, .68, 1)));
  const budgets = new Array<number>(districts.length).fill(0);
  placed.forEach((b, i) => {
    if (plotDistrict[i] >= 0) budgets[plotDistrict[i]] += b.w * b.h;
  });

  const shareOf = (dIdx: number) => {
    const kind = districts[dIdx].kind;
    const siblings = Math.max(1, districts.filter((d) => d.kind === kind).length);
    return ((type.districts[kind] ?? 1) / totalDistrictWeight) / siblings;
  };

  let usedArea = placed.reduce((sum, b) => sum + b.w * b.h, 0);
  for (let round = 0; round < 2; round++) {
    for (const cand of candidates) {
      const { lot, out, district } = cand;
      if (usedArea + lot.w * lot.h > cap) continue;
      if (round === 0 && budgets[district] > cap * shareOf(district) * 1.08) continue;
      const gap = round === 1 && (ctx.tight || type.extent < .65) ? 1 : DISTRICTS[districts[district].kind].gap;
      if (!canAcceptBuilding(lot, out, gap)) continue;

      commitBuilding(cand, {});
      usedArea += lot.w * lot.h;
      budgets[district] += lot.w * lot.h;
    }
  }

  // ---- 6. Внутренние дворы, мастерские, конюшни и окраины (Sections 11, 19, 25)
  // Все дворовые объекты привязаны к индексу своего дома (plotRank = idx), чтобы при низкой
  // плотности на месте ещё не построенного дома не оставались сиротливые бочки!
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
  const notInsideAnyHouse = (x: number, y: number, w1: number, h1: number) =>
    !placed.some((b) => intersects(b, { x, y, w: w1, h: h1 }));

  let courtyardCount = 0;

  for (let idx = 0; idx < placed.length; idx++) {
    const b = placed[idx];
    const plot = placedPlots[idx];
    const yard = plot?.yardRect;
    if (!yard || yard.w < 2 || yard.h < 2) continue;
    if (!notInsideAnyHouse(yard.x, yard.y, yard.w, yard.h)) continue;

    courtyardCount++;
    const dKind: DistrictKind = districts[plotDistrict[idx]]?.kind ?? 'residential';
    const roll = hash2(yard.x, yard.y, seed + 0x8801 + idx);

    if (b.kind === 'tavern' || b.role === 'tavern') {
      // Двор постоялого двора: стол со скамьёй, конюшня/телега и сено.
      if (yard.w >= 3 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 3, 2)) {
        addRankedCivic(idx, 'marketWagon', yard.x, yard.y, 3, 2, idx);
      } else if (yard.w >= 2 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 2, 2)) {
        addRankedCivic(idx, 'marketHay', yard.x, yard.y, 2, 2, idx);
      }
      if (yard.w >= 5 && yard.h >= 2 && notNearAnyDoor(yard.x + yard.w - 2, yard.y, 2, 1)) {
        addRankedCivic(idx, 'marketBench', yard.x + yard.w - 2, yard.y, 2, 1, idx);
      }
    } else if (dKind === 'noble' || b.role === 'manor') {
      // Усадьба знати: ухоженный сад, фонтан или скамья, ограда.
      if (yard.w >= 3 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 3, 2)) {
        addRankedCivic(idx, 'garden', yard.x, yard.y, 3, 2, idx);
      }
      if (yard.w >= 5 && yard.h >= 3 && roll > .45 && notNearAnyDoor(yard.x + yard.w - 2, yard.y, 2, 2)) {
        addRankedCivic(idx, 'fountain', yard.x + yard.w - 2, yard.y, 2, 2, idx);
      }
    } else if (dKind === 'craft' || b.role === 'workshop' || b.role === 'smithy') {
      // Двор мастерской: навес, бочки, ящики, тачка с рудой/камнем.
      const toolKind: CivicKind = b.role === 'smithy'
        ? 'marketWheelbarrowStone'
        : roll < .35 ? 'marketBarrels' : roll < .7 ? 'marketCrates' : 'marketTentCanopy';
      const spec = CIVIC_KIT[toolKind];
      if (yard.w >= spec.w && yard.h >= spec.h && notNearAnyDoor(yard.x, yard.y, spec.w, spec.h)) {
        addRankedCivic(idx, toolKind, yard.x, yard.y, spec.w, spec.h, idx);
      }
    } else if (dKind === 'docks' || b.role === 'warehouse') {
      // Двор склада: мешки, ящики, канаты.
      const cargo: CivicKind = roll < .4 ? 'marketSacks' : roll < .8 ? 'marketCrates' : 'marketRope';
      const spec = CIVIC_KIT[cargo];
      if (yard.w >= spec.w && yard.h >= spec.h && notNearAnyDoor(yard.x, yard.y, spec.w, spec.h)) {
        addRankedCivic(idx, cargo, yard.x, yard.y, spec.w, spec.h, idx);
      }
    } else if (dKind === 'farms') {
      // Хуторской двор: огород и стог сена.
      if (yard.w >= 3 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 3, 2)) {
        addRankedCivic(idx, 'garden', yard.x, yard.y, 3, 2, idx);
      } else if (yard.w >= 2 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 2, 2)) {
        addRankedCivic(idx, 'marketHayLarge', yard.x, yard.y, 2, 2, idx);
      }
    } else if (roll < .38 && yard.w >= 3 && yard.h >= 2 && notNearAnyDoor(yard.x, yard.y, 3, 2)) {
      // Обычный жилой дворик: небольшой огород или пара бочек/колодец.
      addRankedCivic(idx, 'garden', yard.x, yard.y, 3, 2, idx);
    } else if (roll > .78 && notNearAnyDoor(yard.x, yard.y, 1, 1)) {
      addRankedCivic(idx, 'well', yard.x, yard.y, 1, 1, idx);
    }
  }

  // ---- 7. Окраины: огороды, кладбище, горные штольни/руда, караванная стоянка
  // 7.1 Огороды на свободных садовых участках окраин и усадеб.
  for (const plot of urbanPlots) {
    if (plot.fn !== 'garden' || !plot.yardRect) continue;
    const yr = plot.yardRect;
    if (yr.w >= 3 && yr.h >= 2 && notInsideAnyHouse(yr.x, yr.y, 3, 2) && notNearAnyDoor(yr.x, yr.y, 3, 2)) {
      addRankedCivic(-1, 'garden', yr.x, yr.y, 3, 2, plot.id);
    }
  }

  // 7.2 Кладбище на окраине или рядом с храмовым кварталом (Section 12 & 19).
  if (!ctx.small && (town || type.id === 'large_village' || character.id === 'religious')) {
    const cemPlot = urbanPlots.find((p) =>
      (p.fn === 'empty' || p.fn === 'courtyard' || p.fn === 'garden')
      && p.bounds.w >= 5 && p.bounds.h >= 4
      && (p.age === 'suburbs' || p.age === 'outer_city' || p.districtType === 'temple')
      && notInsideAnyHouse(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h)
      && notNearAnyDoor(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h),
    );
    if (cemPlot) {
      const { x: cx, y: cy, w: cw, h: ch } = cemPlot.bounds;
      // Ограда погоста + сухое дерево + аккуратные ряды надгробных камней.
      addRankedCivic(-1, 'marketFence', cx, cy, 2, 1, 0);
      ctx.trees.push({ x: cx + cw - 1.2, y: cy + 1.2, r: .38, kind: 'dead', v: .5 });
      for (let gy = cy + 1; gy < cy + ch - 0.5; gy += 1.4) {
        for (let gx = cx + 0.8; gx < cx + cw - 1.5; gx += 1.3) {
          const rx = Math.round(gx), ry = Math.round(gy);
          if (inside(rx, ry) && usable(rx, ry) && !streets[id(rx, ry)]) {
            const r = .16;
            ctx.rocks.push({
              x: gx, y: gy, r, v: .8,
              pts: [[-r, -r * .6], [r, -r * .6], [r, r * .7], [-r, r * .7]],
            });
          }
        }
      }
      landmarks.push({
        id: 'cemetery_0', kind: 'cemetery', label: 'Старое кладбище',
        x: cx + Math.floor(cw / 2), y: cy + Math.floor(ch / 2),
        bounds: { ...cemPlot.bounds }, district: cemPlot.districtType, accessible: true,
      });
    }
  }

  // 7.3 Горный город: склады руды и тачки с породой у скального склона (Section 24).
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

  // 7.4 Караванная стоянка за воротами для торговых и больших городов (Section 19).
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

  // ---- 8. Приключенческие узлы для D&D (Section 27) -------------------------
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

  return {
    buildings: placed,
    plotDistrict,
    rankedCivic,
    landmarks,
    chains,
    piers,
    courtyardCount,
  };
}
