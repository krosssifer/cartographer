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
  between,
  facingVector,
  pickWeighted,
  rectPolygon,
  wet,
  type PlotFunction,
  type UrbanContext,
  type UrbanPlot,
  type UrbanRoadLevel,
} from './types';

export interface PlotSubdivisionResult {
  plots: UrbanPlot[];
  distanceToStreet: Uint16Array;
  nearWall: Uint8Array;
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
  const { districts, districtAt, growthStageAt } = distLayout;

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

  // Буфер 1 клетки у городской стены (стена рисуется лентой и имеет боевой обход).
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

  // Маска занятых под участки клеток, чтобы участки не пересекались.
  const plotClaimed = new Uint8Array(w * h);
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

  // ---- 1. Сбор кандидатов фасадного межевания вдоль улиц --------------------
  type FrontAnchor = {
    x: number;
    y: number;
    orientation: ChestRotation;
    roadPt: Point;
    roadLvl: UrbanRoadLevel;
    marketFace: boolean;
    priority: number;
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
        const dIdx = districtAt[id(x, y)];
        const dDef = DISTRICTS[districts[dIdx].kind];

        for (const { facing, dx, dy } of ORIENTATIONS) {
          const rx = x + dx, ry = y + dy;
          if (!inside(rx, ry)) continue;
          const rIdx = id(rx, ry);
          if (!streets[rIdx]) continue;
          if (!exitClear({ x: rx, y: ry })) continue;
          const lvl = (streetLevel[rIdx] || 3) as UrbanRoadLevel;
          const mFace = onMarketFront({ x: rx, y: ry });
          // Сортируем вдоль улицы по главным магистралям, рынку и привлекательности района.
          const prio = (mFace ? 40 : 0)
            + (5 - lvl) * 8
            + dDef.appeal * 4
            - skel.reach(x, y) * 2.2
            + hash2(x, y, seed + 0x2201 + facing) * 1.1;
          anchors.push({ x, y, orientation: facing, roadPt: { x: rx, y: ry }, roadLvl: lvl, marketFace: mFace, priority: prio });
        }
      }
    }
    anchors.sort((a, b) => b.priority - a.priority || a.y - b.y || a.x - b.x);
  } else {
    // Режим с выключенными улицами: сетка точек внутри кварталов.
    for (let y = 2; y < h - 4; y += 2) {
      for (let x = 2; x < w - 4; x += 2) {
        if (!cellFreeForPlot(x, y)) continue;
        const facing = ([0, 90, 180, 270] as const)[Math.floor(hash2(x, y, seed + 0x331) * 4)];
        const [dx, dy] = facingVector(facing);
        if (!exitClear({ x: x + dx, y: y + dy })) continue;
        anchors.push({
          x, y, orientation: facing,
          roadPt: { x: x + dx, y: y + dy },
          roadLvl: 3,
          marketFace: false,
          priority: 10 - skel.reach(x, y) * 3 + hash2(x, y, seed + 0x441),
        });
      }
    }
    anchors.sort((a, b) => b.priority - a.priority);
  }

  const plots: UrbanPlot[] = [];

  function classifyPlot(
    dKind: typeof districts[number]['kind'],
    wealth: number,
    age: typeof GROWTH_STAGE_ORDER[number],
    roadLvl: UrbanRoadLevel,
    marketFace: boolean,
    area: number,
    roll: number,
    openRoll: number,
  ): PlotFunction {
    // Часть участков остаётся садами/дворами/пустырями — город не застраивается на 100%!
    const openTarget = DISTRICTS[dKind].openShare * (age === 'suburbs' ? 1.35 : age === 'origin' || age === 'old_core' ? .55 : .85);
    if (!marketFace && roadLvl >= 3 && openRoll < openTarget * .42) {
      if (dKind === 'noble' || dKind === 'farms' || age === 'suburbs') return 'garden';
      return openRoll < openTarget * .2 ? 'empty' : 'courtyard';
    }

    if (marketFace) {
      return pickWeighted([['shop', 5], ['workshop', 2], ['warehouse', 1], ['large_residential', 1]], roll);
    }

    switch (dKind) {
      case 'centre':
        return roadLvl <= 2
          ? pickWeighted([['shop', 4], ['large_residential', 3], ['noble_villa', 1], ['workshop', 1]], roll)
          : pickWeighted([['large_residential', 4], ['small_residential', 2], ['shop', 2]], roll);
      case 'market':
        return pickWeighted([['shop', 5], ['warehouse', 2], ['workshop', 2], ['small_residential', 1]], roll);
      case 'craft':
        return roadLvl <= 2
          ? pickWeighted([['workshop', 5], ['shop', 2], ['warehouse', 2], ['small_residential', 1]], roll)
          : pickWeighted([['workshop', 5], ['small_residential', 3], ['warehouse', 2]], roll);
      case 'docks':
        return pickWeighted([['warehouse', 5], ['shop', 3], ['workshop', 2], ['small_residential', 2]], roll);
      case 'noble':
        return area >= 48 && wealth > .65
          ? pickWeighted([['noble_villa', 6], ['large_residential', 3], ['garden', 1]], roll)
          : pickWeighted([['large_residential', 6], ['noble_villa', 2]], roll);
      case 'temple':
        return pickWeighted([['large_residential', 4], ['noble_villa', 2], ['garden', 1], ['small_residential', 2]], roll);
      case 'garrison':
        return pickWeighted([['garrison', 5], ['warehouse', 2], ['stable', 2], ['small_residential', 1]], roll);
      case 'farms':
        return pickWeighted([['farm', 6], ['stable', 2], ['garden', 2]], roll);
      case 'poor':
        return pickWeighted([['small_residential', 7], ['workshop', 2], ['empty', 1]], roll);
      case 'residential':
      default:
        if (roadLvl === 1 && town) {
          return pickWeighted([['shop', 4], ['large_residential', 4], ['workshop', 1], ['small_residential', 2]], roll);
        }
        return wealth > .58
          ? pickWeighted([['large_residential', 5], ['small_residential', 3], ['shop', 1]], roll)
          : pickWeighted([['small_residential', 6], ['large_residential', 3], ['workshop', 1]], roll);
    }
  }

  // ---- 2. Нарезка фасадных участков с разделением «дом у улицы + двор позади»
  for (const anchor of anchors) {
    if (!cellFreeForPlot(anchor.x, anchor.y)) continue;
    const dIdx = districtAt[id(anchor.x, anchor.y)];
    if (dIdx < 0) continue;
    const district = districts[dIdx];
    const dDef = DISTRICTS[district.kind];
    const age = GROWTH_STAGE_ORDER[growthStageAt[id(anchor.x, anchor.y)]] ?? 'first_expansion';

    // В старом центре участки уже по фасаду, но глубже; в новых и богатых — шире.
    const ageFrontScale = age === 'origin' || age === 'old_core' ? .86 : age === 'suburbs' ? 1.12 : 1.0;
    const wealthScale = .88 + district.wealth * .28;
    const r1 = hash2(anchor.x, anchor.y, seed + 0x5101);
    const r2 = hash2(anchor.x, anchor.y, seed + 0x5102);

    const targetFront = Math.max(
      4,
      Math.round((dDef.length[0] + r1 * (dDef.length[1] - dDef.length[0])) * ageFrontScale * wealthScale),
    );
    const buildDepth = Math.max(
      4,
      Math.round(dDef.depth[0] + r2 * (dDef.depth[1] - dDef.depth[0])),
    );
    // Дополнительная глубина под внутренний двор/сад позади дома!
    const wantsYard = hash2(anchor.x, anchor.y, seed + 0x5103) < dDef.courtyardRate;
    const yardExtra = wantsYard
      ? (district.kind === 'noble' || district.kind === 'farms' ? 4 : district.kind === 'craft' ? 3 : 2)
      : 0;

    // Пробуем от полного участка с двором до компактного 4×4 в тесных кварталах.
    let placedPlot: UrbanPlot | undefined;

    for (const [fTry, bDepthTry, yDepthTry] of [
      [targetFront, buildDepth, yardExtra],
      [Math.max(4, targetFront - 1), buildDepth, Math.max(0, yardExtra - 1)],
      [Math.max(4, dDef.length[0]), Math.max(4, dDef.depth[0]), 0],
      [5, 4, 0],
      [4, 4, 0],
    ]) {
      const totalDepth = bDepthTry + yDepthTry;
      const sideways = anchor.orientation === 90 || anchor.orientation === 270;
      const pw = sideways ? totalDepth : fTry;
      const ph = sideways ? fTry : totalDepth;

      // Позиционируем участок так, чтобы его фасадная грань проходила через anchor и смотрела на roadPt.
      const shiftAlong = Math.floor(fTry / 2);
      const px = anchor.orientation === 90
        ? anchor.x
        : anchor.orientation === 270
        ? anchor.x - pw + 1
        : anchor.x - shiftAlong;
      const py = anchor.orientation === 180
        ? anchor.y
        : anchor.orientation === 0
        ? anchor.y - ph + 1
        : anchor.y - shiftAlong;

      const bounds: Selection = { x: px, y: py, w: pw, h: ph };
      if (!rectFree(bounds)) continue;

      // Проверяем, что выход перед центром фасада чист и выходит на улицу/проход.
      const [fx, fy] = facingVector(anchor.orientation);
      const doorFrontX = anchor.orientation === 90 ? px
        : anchor.orientation === 270 ? px + pw - 1
        : px + Math.floor(pw / 2);
      const doorFrontY = anchor.orientation === 180 ? py
        : anchor.orientation === 0 ? py + ph - 1
        : py + Math.floor(ph / 2);
      const accessPt = { x: doorFrontX + fx, y: doorFrontY + fy };
      if (!exitClear(accessPt)) continue;
      if (hasStreets && distanceToStreet[id(accessPt.x, accessPt.y)] > 1) continue;

      // Разделяем участок на пятно застройки (у фасада или с отступом для усадьбы) и двор (в глубине).
      const fn = classifyPlot(
        district.kind,
        district.wealth,
        age,
        anchor.roadLvl,
        anchor.marketFace,
        pw * ph,
        hash2(px, py, seed + 0x5201),
        hash2(px, py, seed + 0x5202),
      );

      let buildRect: Selection | undefined;
      let yardRect: Selection | undefined;

      if (fn !== 'garden' && fn !== 'courtyard' && fn !== 'empty') {
        if (yDepthTry > 0) {
          if (anchor.orientation === 0) {
            // Улица на юге (y + ph): дом на юге, двор на севере.
            buildRect = { x: px, y: py + yDepthTry, w: pw, h: bDepthTry };
            yardRect = { x: px, y: py, w: pw, h: yDepthTry };
          } else if (anchor.orientation === 180) {
            // Улица на севере (y - 1): дом на севере, двор на юге.
            buildRect = { x: px, y: py, w: pw, h: bDepthTry };
            yardRect = { x: px, y: py + bDepthTry, w: pw, h: yDepthTry };
          } else if (anchor.orientation === 90) {
            // Улица на западе (x - 1): дом на западе, двор на востоке.
            buildRect = { x: px, y: py, w: bDepthTry, h: ph };
            yardRect = { x: px + bDepthTry, y: py, w: yDepthTry, h: ph };
          } else {
            // Улица на востоке (x + pw): дом на востоке, двор на западе.
            buildRect = { x: px + yDepthTry, y: py, w: bDepthTry, h: ph };
            yardRect = { x: px, y: py, w: yDepthTry, h: ph };
          }
        } else {
          buildRect = { ...bounds };
        }
      } else {
        yardRect = { ...bounds };
      }

      placedPlot = {
        id: plots.length,
        polygon: rectPolygon(bounds),
        bounds,
        buildRect,
        yardRect,
        districtIndex: dIdx,
        districtType: district.kind,
        size: pw * ph,
        frontage: fTry,
        depth: totalDepth,
        orientation: anchor.orientation,
        roadAccess: accessPt,
        roadLevel: anchor.roadLvl,
        wealth: between(district.wealth + (anchor.roadLvl === 1 ? .08 : anchor.roadLvl >= 4 ? -.08 : 0), .05, .98),
        age,
        fn,
      };
      break;
    }

    if (placedPlot) {
      const { x: bx, y: by, w: bw, h: bh } = placedPlot.bounds;
      // Между участками знати и хуторов оставляем воздушный зазор (gap >= 2), в центре — плотнее.
      const pad = dDef.gap >= 3 ? 1 : 0;
      for (let yy = Math.max(0, by - pad); yy < Math.min(h, by + bh + pad); yy++) {
        for (let xx = Math.max(0, bx - pad); xx < Math.min(w, bx + bw + pad); xx++) {
          if (xx >= bx && xx < bx + bw && yy >= by && yy < by + bh) {
            plotClaimed[id(xx, yy)] = 1;
          } else if (pad > 0 && !streets[id(xx, yy)]) {
            plotClaimed[id(xx, yy)] = 1;
          }
        }
      }
      districts[placedPlot.districtIndex].plotCount++;
      plots.push(placedPlot);
    }
  }

  // ---- 3. Вторая линия (внутриквартальная застройка бедных слобод + дворы) ---
  // Бедные дома могут стоять глубже внутри квартала (dist 2..5 от улицы), а свободные
  // ядра кварталов оформляются как внутренние сады/дворы.
  const maxSecondDepth = town ? 5 : 7;
  for (let y = 2; y < h - 5; y += 2) {
    for (let x = 2; x < w - 5; x += 2) {
      if (!cellFreeForPlot(x, y)) continue;
      const dIdx = districtAt[id(x, y)];
      if (dIdx < 0) continue;
      const district = districts[dIdx];
      const dist = distanceToStreet[id(x, y)];
      if (hasStreets && dist > maxSecondDepth) continue;

      const isBackDwelling = district.kind === 'poor'
        || character.id === 'poor'
        || (district.kind === 'residential' && growthStageAt[id(x, y)] <= 1 && hash2(x, y, seed + 0x611) < .45)
        || !hasStreets;

      const pw = isBackDwelling ? (hash2(x, y, seed + 0x612) > .5 ? 5 : 4) : 5;
      const ph = isBackDwelling ? 4 : 4;
      const bounds: Selection = { x, y, w: pw, h: ph };
      if (!rectFree(bounds)) continue;

      // Ориентируем вход в сторону уменьшения distanceToStreet!
      const cx = x + Math.floor(pw / 2), cy = y + Math.floor(ph / 2);
      const candidates = ([
        { facing: 0 as ChestRotation, out: { x: cx, y: y + ph } },
        { facing: 180 as ChestRotation, out: { x: cx, y: y - 1 } },
        { facing: 90 as ChestRotation, out: { x: x - 1, y: cy } },
        { facing: 270 as ChestRotation, out: { x: x + pw, y: cy } },
      ]).filter((c) => exitClear(c.out) && !plotClaimed[id(c.out.x, c.out.y)]);

      candidates.sort((a, b) => distanceToStreet[id(a.out.x, a.out.y)] - distanceToStreet[id(b.out.x, b.out.y)]);
      const bestDir = candidates[0];
      if (!bestDir) continue;
      if (hasStreets && distanceToStreet[id(bestDir.out.x, bestDir.out.y)] > maxSecondDepth) continue;

      const age = GROWTH_STAGE_ORDER[growthStageAt[id(x, y)]] ?? 'second_expansion';
      const fn: PlotFunction = isBackDwelling
        ? 'small_residential'
        : district.kind === 'noble' || district.kind === 'farms' || district.kind === 'temple'
        ? 'garden'
        : hash2(x, y, seed + 0x615) > .45 ? 'courtyard' : 'empty';

      for (let yy = y; yy < y + ph; yy++) {
        for (let xx = x; xx < x + pw; xx++) plotClaimed[id(xx, yy)] = 1;
      }

      plots.push({
        id: plots.length,
        polygon: rectPolygon(bounds),
        bounds,
        buildRect: fn === 'small_residential' ? { ...bounds } : undefined,
        yardRect: fn === 'small_residential' ? undefined : { ...bounds },
        districtIndex: dIdx,
        districtType: district.kind,
        size: pw * ph,
        frontage: bestDir.facing % 180 === 0 ? pw : ph,
        depth: bestDir.facing % 180 === 0 ? ph : pw,
        orientation: bestDir.facing,
        roadAccess: bestDir.out,
        roadLevel: 4,
        wealth: Math.max(.05, district.wealth - .12),
        age,
        fn,
      });
      district.plotCount++;
    }
  }

  return {
    plots,
    distanceToStreet,
    nearWall,
  };
}
