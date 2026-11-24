import { hash2 } from '../../random';
import { DISTRICTS, GROWTH_STAGE_ORDER } from '../settlementTypes';
import { facesMarket, type MarketOutcome } from '../marketLayout';
import type { ChestRotation, CivicObject, Point, Selection } from '../../types';
import { contains } from '../../settlementKit';
import type { DistrictLayoutResult } from './districts';
import type { UrbanSkeleton } from './nodes';
import type { UrbanRoadResult } from './roads';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  facingVector,
  pickWeighted,
  rectPolygon,
  wet,
  type CourtyardKind,
  type PlotFunction,
  type UrbanContext,
  type UrbanPlot,
  type UrbanRoadLevel,
  type UrbanZone,
} from './types';

export interface PlotSubdivisionResult {
  plots: UrbanPlot[];
  plotAt: Int32Array;
  distanceToStreet: Uint16Array;
  nearWall: Uint8Array;
}

function chooseCourtyardKind(
  fn: PlotFunction,
  dKind: UrbanPlot['districtType'],
  zone: UrbanZone,
  roll: number,
): CourtyardKind {
  if (fn === 'noble_villa' || dKind === 'noble') return 'private_garden';
  if (dKind === 'temple') return 'temple_courtyard';
  if (fn === 'warehouse' || dKind === 'docks' || dKind === 'market') return 'trade_courtyard';
  if (fn === 'workshop' || dKind === 'craft') return 'workshop_yard';
  if (fn === 'shop' && roll > .48) return 'inn_yard';
  if (fn === 'farm' || dKind === 'farms' || zone === 'suburbs' || zone === 'outer_city') {
    return 'garden_yard';
  }
  return roll > .72 ? 'garden_yard' : 'enclosed_courtyard';
}

export function subdivideIntoPlots(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  distLayout: DistrictLayoutResult,
  civic: CivicObject[],
  market?: MarketOutcome,
): PlotSubdivisionResult {
  const { width: w, height: h, seed, character, town, geo } = ctx;
  const { cells, slope } = geo;
  const { reserved } = skel;
  const { streets, streetLevel } = roadNet;
  const { districts, districtAt, blockAt, growthStageAt } = distLayout;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  // Расстояние по суше до ближайшей уличной клетки.
  const distanceToStreet = new Uint16Array(w * h).fill(999);
  const queue: number[] = [];
  let hasStreets = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (streets[id(x, y)]) {
        hasStreets = true;
        distanceToStreet[id(x, y)] = 0;
        queue.push(id(x, y));
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const x = c % w, y = (c - x) / w;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const n = id(nx, ny);
      if (distanceToStreet[n] < 999 || !usable(nx, ny)) continue;
      distanceToStreet[n] = distanceToStreet[c] + 1;
      queue.push(n);
    }
  }

  // Буфер 1 клетки у городской стены (боевой проход вдоль стены — Section 15).
  const nearWall = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (terrain(x, y) === 'wall') {
        for (const [dx, dy] of N4) {
          if (inside(x + dx, y + dy)) nearWall[id(x + dx, y + dy)] = 1;
        }
      }
    }
  }

  const plotClaimed = new Uint8Array(w * h);
  const plotAt = new Int32Array(w * h).fill(-1);
  const maxBuildSlope = ctx.geo.geography === 'mountain' ? .26 : .2;

  const cellFreeForPlot = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
    const idx = id(x, y);
    if (plotClaimed[idx] || streets[idx] || reserved[idx] || nearWall[idx]) return false;
    if (districtAt[idx] < 0 || !usable(x, y)) return false;
    if (slope[idx] > maxBuildSlope) return false;
    return true;
  };

  const rectFree = (r: Selection): boolean => {
    if (r.x < 1 || r.y < 1 || r.x + r.w > w - 1 || r.y + r.h > h - 1) return false;
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        if (!cellFreeForPlot(xx, yy)) return false;
      }
    }
    return true;
  };

  const exitClear = (p: Point): boolean =>
    inside(p.x, p.y)
    && usable(p.x, p.y)
    && !civic.some((item) => item.kind !== 'square' && contains(item, p.x, p.y))
    && !(market && market.occupied[id(p.x, p.y)]);

  const onMarketFront = (p: Point): boolean =>
    market !== undefined && facesMarket(market.plan, p.x, p.y, streets);

  // ---- 1. Упорядоченный сбор уличного периметра по кварталам ----------------
  // Вместо хаотичной расстановки штампов идём вдоль каждого фасада квартала по порядку (x / y),
  // чтобы участки в ядре и внутренней части города стыковались в сплошной уличный фронт!
  type FrontAnchor = {
    x: number;
    y: number;
    blockId: number;
    orientation: ChestRotation;
    roadPt: Point;
    roadLvl: UrbanRoadLevel;
    marketFace: boolean;
    tier: number;
    along: number;
  };

  const anchors: FrontAnchor[] = [];
  const ORIENTATIONS: { facing: ChestRotation; dx: number; dy: number }[] = [
    { facing: 0, dx: 0, dy: 1 },
    { facing: 180, dx: 0, dy: -1 },
    { facing: 90, dx: -1, dy: 0 },
    { facing: 270, dx: 1, dy: 0 },
  ];

  if (hasStreets) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!cellFreeForPlot(x, y)) continue;
        const idx = id(x, y);
        for (const { facing, dx, dy } of ORIENTATIONS) {
          const rx = x + dx, ry = y + dy;
          if (!inside(rx, ry)) continue;
          const rIdx = id(rx, ry);
          if (!streets[rIdx]) continue;
          if (!exitClear({ x: rx, y: ry })) continue;
          const lvl = (streetLevel[rIdx] || 3) as UrbanRoadLevel;
          const mFace = onMarketFront({ x: rx, y: ry });
          // Приоритет фронта: рыночная площадь -> главные улицы (1) -> районные улицы (2) -> переулки (3..4).
          const tier = mFace ? 0 : lvl;
          const along = facing === 0 || facing === 180 ? x : y;
          anchors.push({
            x,
            y,
            blockId: blockAt[idx],
            orientation: facing,
            roadPt: { x: rx, y: ry },
            roadLvl: lvl,
            marketFace: mFace,
            tier,
            along,
          });
        }
      }
    }
    anchors.sort((a, b) =>
      a.tier - b.tier
      || a.blockId - b.blockId
      || a.orientation - b.orientation
      || a.along - b.along,
    );
  } else {
    for (let y = 2; y < h - 4; y += 2) {
      for (let x = 2; x < w - 4; x += 2) {
        if (!cellFreeForPlot(x, y)) continue;
        const facing = ([0, 90, 180, 270] as const)[Math.floor(hash2(x, y, seed + 0x331) * 4)];
        const [dx, dy] = facingVector(facing);
        if (!exitClear({ x: x + dx, y: y + dy })) continue;
        anchors.push({
          x,
          y,
          blockId: blockAt[id(x, y)],
          orientation: facing,
          roadPt: { x: x + dx, y: y + dy },
          roadLvl: 3,
          marketFace: false,
          tier: Math.round(skel.footprintAt(x, y) * 10),
          along: x + y * w,
        });
      }
    }
    anchors.sort((a, b) => a.tier - b.tier || a.along - b.along);
  }

  const plots: UrbanPlot[] = [];

  function classifyPlot(
    dKind: typeof districts[number]['kind'],
    zone: UrbanZone,
    wealth: number,
    age: typeof GROWTH_STAGE_ORDER[number],
    roadLvl: UrbanRoadLevel,
    marketFace: boolean,
    area: number,
    roll: number,
    openRoll: number,
  ): PlotFunction {
    // В старом центре и на главных улицах открытых пустых участков почти нет — фронт плотный!
    const openTarget = DISTRICTS[dKind].openShare
      * (zone === 'old_core' ? .18 : zone === 'inner_city' ? .38 : zone === 'suburbs' ? 1.3 : .75);
    if (!marketFace && roadLvl >= 3 && zone !== 'old_core' && openRoll < openTarget * .35) {
      if (dKind === 'noble' || dKind === 'farms' || zone === 'suburbs') return 'garden';
      return 'courtyard';
    }

    if (marketFace) {
      return pickWeighted([['shop', 6], ['workshop', 2], ['warehouse', 1], ['large_residential', 1]], roll);
    }

    switch (dKind) {
      case 'centre':
        return roadLvl <= 2
          ? pickWeighted([['shop', 5], ['large_residential', 3], ['workshop', 1], ['noble_villa', 1]], roll)
          : pickWeighted([['large_residential', 4], ['small_residential', 2], ['shop', 2], ['workshop', 1]], roll);
      case 'market':
        return pickWeighted([['shop', 5], ['warehouse', 2], ['workshop', 2], ['small_residential', 1]], roll);
      case 'craft':
        return roadLvl <= 2
          ? pickWeighted([['workshop', 5], ['shop', 3], ['warehouse', 2], ['small_residential', 1]], roll)
          : pickWeighted([['workshop', 5], ['small_residential', 3], ['warehouse', 2]], roll);
      case 'docks':
        return pickWeighted([['warehouse', 5], ['shop', 3], ['workshop', 2], ['small_residential', 2]], roll);
      case 'noble':
        return area >= 44 && wealth > .62
          ? pickWeighted([['noble_villa', 6], ['large_residential', 3], ['garden', 1]], roll)
          : pickWeighted([['large_residential', 6], ['noble_villa', 2]], roll);
      case 'temple':
        return pickWeighted([['large_residential', 4], ['noble_villa', 2], ['garden', 1], ['small_residential', 2]], roll);
      case 'garrison':
        return pickWeighted([['garrison', 5], ['warehouse', 2], ['stable', 2], ['small_residential', 1]], roll);
      case 'farms':
        return pickWeighted([['farm', 6], ['stable', 2], ['garden', 2]], roll);
      case 'poor':
        return pickWeighted([['small_residential', 7], ['workshop', 2], ['empty', age === 'suburbs' ? 1 : 0]], roll);
      case 'residential':
      default:
        if (roadLvl === 1 && (town || zone === 'old_core' || zone === 'inner_city')) {
          return pickWeighted([['shop', 5], ['large_residential', 4], ['workshop', 2], ['small_residential', 1]], roll);
        }
        return wealth > .56
          ? pickWeighted([['large_residential', 5], ['small_residential', 3], ['shop', 1]], roll)
          : pickWeighted([['small_residential', 6], ['large_residential', 3], ['workshop', 1]], roll);
    }
  }

  // ---- 2. Нарезка фасадных участков: сплошной фронт + задний двор + вторичные постройки
  let rowCounter = 0;
  let lastEdgeKey = '';

  for (const anchor of anchors) {
    if (!cellFreeForPlot(anchor.x, anchor.y)) continue;
    const cellIdx = id(anchor.x, anchor.y);
    const dIdx = districtAt[cellIdx];
    if (dIdx < 0) continue;
    const district = districts[dIdx];
    const dDef = DISTRICTS[district.kind];
    const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[cellIdx]] ?? 'residential';
    const age = GROWTH_STAGE_ORDER[growthStageAt[cellIdx]] ?? 'first_expansion';

    const edgeKey = `${anchor.blockId}:${anchor.orientation}`;
    if (edgeKey !== lastEdgeKey) {
      lastEdgeKey = edgeKey;
      rowCounter = 0;
    }

    // Габариты участка зависят от исторической зоны (Section 7):
    // старое ядро — узкий фасад (4–6) и глубокий двор; окраины — широкие усадьбы!
    const zoneFrontScale = zone === 'old_core' ? .82 : zone === 'inner_city' ? .92 : zone === 'suburbs' ? 1.16 : 1.0;
    const wealthScale = .9 + district.wealth * .22;
    const r1 = hash2(anchor.x, anchor.y, seed + 0x5101);
    const r2 = hash2(anchor.x, anchor.y, seed + 0x5102);

    const targetFront = between(
      Math.round((dDef.length[0] + r1 * (dDef.length[1] - dDef.length[0])) * zoneFrontScale * wealthScale),
      4,
      zone === 'old_core' ? 6 : 9,
    );
    const buildDepth = between(
      Math.round(dDef.depth[0] + r2 * (dDef.depth[1] - dDef.depth[0])),
      4,
      zone === 'old_core' ? 6 : 7,
    );

    // Дворы позади фасадных домов — обязательный элемент средневекового квартала!
    const courtyardChance = Math.min(.92, dDef.courtyardRate + (zone === 'old_core' || zone === 'inner_city' ? .22 : .12));
    const wantsYard = hash2(anchor.x, anchor.y, seed + 0x5103) < courtyardChance;
    const yardExtra = wantsYard
      ? (district.kind === 'noble' || district.kind === 'farms' || zone === 'suburbs'
        ? 5
        : district.kind === 'craft' || district.kind === 'docks' || hash2(anchor.x, anchor.y, seed + 0x5104) > .38
        ? 4
        : 3)
      : 0;

    let placedPlot: UrbanPlot | undefined;

    const plotSizes: [number, number, number][] = [
      [targetFront, buildDepth, yardExtra],
      [Math.max(4, targetFront - 1), buildDepth, yardExtra >= 3 ? 3 : yardExtra],
      [5, 4, 3],
      [4, 4, 3],
      [targetFront, Math.max(4, buildDepth - 1), Math.max(0, yardExtra - 1)],
      [5, 4, 2],
      [4, 4, 2],
      [5, 4, 0],
      [4, 4, 0],
    ];
    if (zone === 'old_core' || zone === 'inner_city') {
      plotSizes.push([4, 3, 2], [4, 3, 0], [3, 4, 0]);
    }

    for (const [fTry, bDepthTry, yDepthTry] of plotSizes) {
      const totalDepth = bDepthTry + yDepthTry;
      const sideways = anchor.orientation === 90 || anchor.orientation === 270;
      const pw = sideways ? totalDepth : fTry;
      const ph = sideways ? fTry : totalDepth;

      // Пробуем привязку к переднему углу и небольшие сдвиги вдоль кривой улицы,
      // чтобы на диагональных и кольцевых улицах участки вставали плотно без пропусков!
      let baseX = anchor.x;
      let baseY = anchor.y;
      if (anchor.orientation === 0) baseY = anchor.y - ph + 1;
      else if (anchor.orientation === 270) baseX = anchor.x - pw + 1;

      let bounds: Selection | undefined;
      let px = baseX;
      let py = baseY;
      for (const shift of [0, -1, 1, -Math.floor(fTry / 2)]) {
        const tryX = sideways ? baseX : baseX + shift;
        const tryY = sideways ? baseY + shift : baseY;
        const candBounds = { x: tryX, y: tryY, w: pw, h: ph };
        if (rectFree(candBounds)) {
          bounds = candBounds;
          px = tryX;
          py = tryY;
          break;
        }
      }
      if (!bounds) continue;

      const fn = classifyPlot(
        district.kind,
        zone,
        district.wealth,
        age,
        anchor.roadLvl,
        anchor.marketFace,
        pw * ph,
        hash2(px, py, seed + 0x5201),
        hash2(px, py, seed + 0x5202),
      );

      const courtRoll = hash2(px, py, seed + 0x5209);
      const canFitPassageHouse = (fTry >= 5 && bDepthTry >= 3) || (fTry === 4 && bDepthTry >= 4);
      const wantsSecondary = yDepthTry >= 3
        && canFitPassageHouse
        && fn !== 'garden'
        && fn !== 'courtyard'
        && fn !== 'empty'
        && courtRoll < (
          district.kind === 'craft' || district.kind === 'docks' || district.kind === 'farms'
            ? .82
            : zone === 'old_core' || zone === 'inner_city'
            ? .64
            : .48
        );

      // Оставляем 1-клеточный арочный/боковой проход во двор с улицы, если во дворе стоит флигель/мастерская
      // или каждые 3 сплошных дома в плотном ряду (тактические проходы D&D + 100% связность построек!).
      const needsPassage = canFitPassageHouse && yDepthTry >= 2 && (wantsSecondary || rowCounter % 3 === 2);
      const bFront = needsPassage ? fTry - 1 : fTry;

      let buildRect: Selection | undefined;
      let yardRect: Selection | undefined;
      let secondaryRect: Selection | undefined;
      let courtyardKind: CourtyardKind | undefined;

      if (fn !== 'garden' && fn !== 'courtyard' && fn !== 'empty') {
        if (yDepthTry > 0) {
          courtyardKind = chooseCourtyardKind(fn, district.kind, zone, courtRoll);
          if (anchor.orientation === 0) {
            buildRect = { x: px, y: py + yDepthTry, w: bFront, h: bDepthTry };
            yardRect = { x: px, y: py, w: pw, h: yDepthTry };
            if (wantsSecondary && yDepthTry >= 3 && pw >= 4) {
              const sw = Math.min(4, Math.max(3, pw - 1));
              const sh = Math.min(3, yDepthTry);
              secondaryRect = { x: px, y: py, w: Math.min(sw, pw - 1), h: sh };
            }
          } else if (anchor.orientation === 180) {
            buildRect = { x: px, y: py, w: bFront, h: bDepthTry };
            yardRect = { x: px, y: py + bDepthTry, w: pw, h: yDepthTry };
            if (wantsSecondary && yDepthTry >= 3 && pw >= 4) {
              const sw = Math.min(4, Math.max(3, pw - 1));
              const sh = Math.min(3, yDepthTry);
              secondaryRect = { x: px, y: py + ph - sh, w: Math.min(sw, pw - 1), h: sh };
            }
          } else if (anchor.orientation === 90) {
            buildRect = { x: px, y: py, w: bDepthTry, h: bFront };
            yardRect = { x: px + bDepthTry, y: py, w: yDepthTry, h: ph };
            if (wantsSecondary && yDepthTry >= 3 && ph >= 4) {
              const sw = Math.min(3, yDepthTry);
              const sh = Math.min(4, Math.max(3, ph - 1));
              secondaryRect = { x: px + pw - sw, y: py, w: sw, h: Math.min(sh, ph - 1) };
            }
          } else {
            buildRect = { x: px + yDepthTry, y: py, w: bDepthTry, h: bFront };
            yardRect = { x: px, y: py, w: yDepthTry, h: ph };
            if (wantsSecondary && yDepthTry >= 3 && ph >= 4) {
              const sw = Math.min(3, yDepthTry);
              const sh = Math.min(4, Math.max(3, ph - 1));
              secondaryRect = { x: px, y: py, w: sw, h: Math.min(sh, ph - 1) };
            }
          }
        } else {
          buildRect = { ...bounds };
        }
      } else {
        yardRect = { ...bounds };
        courtyardKind = fn === 'garden' ? 'private_garden' : 'enclosed_courtyard';
      }

      // Проверяем чистый выход на улицу перед главным зданием И проходимость бокового прохода!
      const [fx, fy] = facingVector(anchor.orientation);
      const refBox = buildRect ?? bounds;
      const doorFrontX = anchor.orientation === 90 ? refBox.x
        : anchor.orientation === 270 ? refBox.x + refBox.w - 1
        : refBox.x + Math.floor(refBox.w / 2);
      const doorFrontY = anchor.orientation === 180 ? refBox.y
        : anchor.orientation === 0 ? refBox.y + refBox.h - 1
        : refBox.y + Math.floor(refBox.h / 2);
      const accessPt = { x: doorFrontX + fx, y: doorFrontY + fy };
      if (!exitClear(accessPt)) continue;
      if (hasStreets && distanceToStreet[id(accessPt.x, accessPt.y)] > 1) continue;

      if (needsPassage && secondaryRect) {
        const passPt = anchor.orientation === 0 ? { x: px + pw - 1, y: py + ph }
          : anchor.orientation === 180 ? { x: px + pw - 1, y: py - 1 }
          : anchor.orientation === 90 ? { x: px - 1, y: py + ph - 1 }
          : { x: px + pw, y: py + ph - 1 };
        if (!exitClear(passPt) || (hasStreets && distanceToStreet[id(passPt.x, passPt.y)] > 2)) {
          secondaryRect = undefined;
        }
      }

      placedPlot = {
        id: plots.length,
        polygon: rectPolygon(bounds),
        bounds,
        buildRect,
        yardRect,
        secondaryRect,
        courtyardKind,
        needsPassage,
        districtIndex: dIdx,
        districtType: district.kind,
        zone,
        size: pw * ph,
        frontage: fTry,
        depth: totalDepth,
        orientation: anchor.orientation,
        roadAccess: accessPt,
        roadLevel: anchor.roadLvl,
        wealth: between(district.wealth + (anchor.roadLvl === 1 ? .08 : anchor.roadLvl >= 3 ? -.06 : 0), .05, .98),
        age,
        fn,
      };
      break;
    }

    if (placedPlot) {
      const { x: bx, y: by, w: bw, h: bh } = placedPlot.bounds;
      // В центре и внутреннем городе фронт сплошной (pad = 0); в знатных/пригородных усадьбах — разрыв 1–2 клетки!
      const pad = placedPlot.zone === 'suburbs' || dDef.gap >= 4
        ? 2
        : placedPlot.zone === 'outer_city' && dDef.gap >= 2
        ? 1
        : district.kind === 'noble'
        ? 1
        : 0;
      for (let yy = Math.max(0, by - pad); yy < Math.min(h, by + bh + pad); yy++) {
        for (let xx = Math.max(0, bx - pad); xx < Math.min(w, bx + bw + pad); xx++) {
          const cIdx = id(xx, yy);
          if (xx >= bx && xx < bx + bw && yy >= by && yy < by + bh) {
            plotClaimed[cIdx] = 1;
            plotAt[cIdx] = placedPlot.id;
          } else if (pad > 0 && !streets[cIdx]) {
            plotClaimed[cIdx] = 1;
          }
        }
      }
      districts[placedPlot.districtIndex].plotCount++;
      plots.push(placedPlot);
      rowCounter++;
    }
  }

  // ---- 3. Внутренняя застройка глубоких кварталов и оформление дворов --------
  // Оставшееся место внутри кварталов размечается под задние домики ремесленников/бедноты
  // либо под осмысленные внутриквартальные дворы, сады и огороды — без «ничейной травы»!
  const maxSecondDepth = town ? 5 : 7;
  for (let y = 2; y < h - 5; y++) {
    for (let x = 2; x < w - 5; x++) {
      if (!cellFreeForPlot(x, y)) continue;
      const dIdx = districtAt[id(x, y)];
      if (dIdx < 0) continue;
      const district = districts[dIdx];
      const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[id(x, y)]] ?? 'residential';
      const dist = distanceToStreet[id(x, y)];
      if (hasStreets && dist > maxSecondDepth) continue;

      const isBackDwelling = (
        district.kind === 'poor'
        || district.kind === 'craft'
        || character.id === 'poor'
        || ((zone === 'old_core' || zone === 'inner_city') && dist <= 3 && hash2(x, y, seed + 0x611) < .58)
        || !hasStreets
      );

      let placedBack = false;
      for (const [pw, ph] of [[5, 4], [4, 4]] as const) {
        const bounds: Selection = { x, y, w: pw, h: ph };
        if (!rectFree(bounds)) continue;

        const cx = x + Math.floor(pw / 2), cy = y + Math.floor(ph / 2);
        const candidates = ([
          { facing: 0 as ChestRotation, out: { x: cx, y: y + ph } },
          { facing: 180 as ChestRotation, out: { x: cx, y: y - 1 } },
          { facing: 90 as ChestRotation, out: { x: x - 1, y: cy } },
          { facing: 270 as ChestRotation, out: { x: x + pw, y: cy } },
        ]).filter((c) => exitClear(c.out) && (!plotClaimed[id(c.out.x, c.out.y)] || streets[id(c.out.x, c.out.y)]));

        candidates.sort((a, b) => distanceToStreet[id(a.out.x, a.out.y)] - distanceToStreet[id(b.out.x, b.out.y)]);
        const bestDir = candidates[0];
        if (!bestDir) continue;
        if (hasStreets && distanceToStreet[id(bestDir.out.x, bestDir.out.y)] > maxSecondDepth) continue;

        const age = GROWTH_STAGE_ORDER[growthStageAt[id(x, y)]] ?? 'second_expansion';
        const fn: PlotFunction = isBackDwelling
          ? (district.kind === 'craft' && hash2(x, y, seed + 0x613) > .5 ? 'workshop' : 'small_residential')
          : district.kind === 'noble' || district.kind === 'farms' || district.kind === 'temple' || zone === 'outer_city'
          ? 'garden'
          : 'courtyard';

        const pId = plots.length;
        for (let yy = y; yy < y + ph; yy++) {
          for (let xx = x; xx < x + pw; xx++) {
            const cIdx = id(xx, yy);
            plotClaimed[cIdx] = 1;
            plotAt[cIdx] = pId;
          }
        }

        const hasBuild = fn === 'small_residential' || fn === 'workshop';
        plots.push({
          id: pId,
          polygon: rectPolygon(bounds),
          bounds,
          buildRect: hasBuild ? { ...bounds } : undefined,
          yardRect: hasBuild ? undefined : { ...bounds },
          courtyardKind: hasBuild ? undefined : (fn === 'garden' ? 'garden_yard' : 'enclosed_courtyard'),
          districtIndex: dIdx,
          districtType: district.kind,
          zone,
          size: pw * ph,
          frontage: bestDir.facing % 180 === 0 ? pw : ph,
          depth: bestDir.facing % 180 === 0 ? ph : pw,
          orientation: bestDir.facing,
          roadAccess: bestDir.out,
          roadLevel: 3,
          wealth: Math.max(.05, district.wealth - .1),
          age,
          fn,
        });
        district.plotCount++;
        placedBack = true;
        break;
      }
      void placedBack;
    }
  }

  return {
    plots,
    plotAt,
    distanceToStreet,
    nearWall,
  };
}
