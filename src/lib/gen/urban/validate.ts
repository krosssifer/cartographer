import { CIVIC_KIT, contains, intersects } from '../../settlementKit';
import type { Building, ChestRotation, CivicKind, Point, Selection, Terrain } from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { BuildingsAndLandmarksResult } from './landmarks';
import type { UrbanSkeleton } from './nodes';
import type { PlotSubdivisionResult } from './plots';
import { unifyStreetComponents, type UrbanRoadResult } from './roads';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  facingVector,
  rectPolygon,
  wet,
  type RankedCivic,
  type SettlementQualityReport,
  type UrbanContext,
} from './types';

const STREET_SET: ReadonlySet<Terrain> = new Set<Terrain>(['road', 'plaza', 'bridge']);
const BLOCKED_SET: ReadonlySet<Terrain> = new Set<Terrain>(['wall', 'water', 'deepWater', 'rock']);

export interface ValidationOutcome {
  quality: SettlementQualityReport;
  emptyGrid: Uint8Array;
  reachableGrid: Uint8Array;
}

export function validateAndRepairUrbanPlan(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  distLayout: DistrictLayoutResult,
  plotSub: PlotSubdivisionResult,
  built: BuildingsAndLandmarksResult,
  marketArea?: Uint8Array,
): ValidationOutcome {
  const { width: w, height: h, type, geo } = ctx;
  const { cells, slope, waterDist } = geo;
  const { streets, streetLevel, gates } = roadNet;
  const repairs: string[] = [];

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;

  // ---- 1. Локальная починка связности дорог и башен у ворот -----------------
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = id(x, y);
      if (STREET_SET.has(cells[y][x].terrain) || marketArea?.[idx]) {
        streets[idx] = 1;
        if (!streetLevel[idx]) streetLevel[idx] = 3;
      } else {
        streets[idx] = 0;
      }
    }
  }

  const beforeStreetCells = streets.reduce((a, b) => a + b, 0);
  unifyStreetComponents(w, h, cells, streets, streetLevel, gates, skel.keepFree ? skel.reserved : undefined);
  if (computeLargestStreetShare(w, h, cells) < 0.98) {
    const pureStreets = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (STREET_SET.has(cells[y][x].terrain)) pureStreets[id(x, y)] = 1;
      }
    }
    const blockMask = new Uint8Array(w * h);
    if (skel.keepFree) for (let i = 0; i < w * h; i++) if (skel.reserved[i]) blockMask[i] = 1;
    if (marketArea) for (let i = 0; i < w * h; i++) if (marketArea[i]) blockMask[i] = 1;
    for (const b of built.buildings) {
      for (let yy = b.y; yy < b.y + b.h; yy++) {
        for (let xx = b.x; xx < b.x + b.w; xx++) if (inside(xx, yy)) blockMask[id(xx, yy)] = 1;
      }
    }
    unifyStreetComponents(w, h, cells, pureStreets, streetLevel, gates, blockMask);
    for (let i = 0; i < w * h; i++) {
      streets[i] = pureStreets[i] || marketArea?.[i] ? 1 : 0;
    }
  }

  let streetTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (STREET_SET.has(cells[y][x].terrain)) streetTotal++;
    }
  }
  if (Math.abs(beforeStreetCells - streetTotal) > 3) {
    repairs.push('связность уличной сети локально выровнена');
  }

  const validTowers = roadNet.towers.filter(
    (t) => inside(t.x, t.y) && cells[t.y][t.x].terrain === 'wall' && !streets[id(t.x, t.y)],
  );
  if (validTowers.length !== roadNet.towers.length) {
    roadNet.towers.length = 0;
    roadNet.towers.push(...validTowers);
    repairs.push('убрана башня с проезда ворот');
  }

  // ---- 2. Локальная проверка и починка зданий (вода/стена/наложение/дверь) ---
  const occupied = new Uint8Array(w * h);
  const keepIndices: number[] = [];
  const oldToNew = new Int32Array(built.buildings.length).fill(-1);

  for (let i = 0; i < built.buildings.length; i++) {
    const b = built.buildings[i];
    if (b.x < 1 || b.y < 1 || b.x + b.w > w - 1 || b.y + b.h > h - 1) {
      repairs.push(`убран участок за границей карты (${b.x},${b.y})`);
      continue;
    }
    let badFootprint = false;
    for (let yy = b.y; yy < b.y + b.h && !badFootprint; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        const tr = cells[yy][xx].terrain;
        if (BLOCKED_SET.has(tr) || STREET_SET.has(tr) || occupied[id(xx, yy)]) {
          badFootprint = true;
          break;
        }
      }
    }
    if (badFootprint) {
      repairs.push(`убрано здание на недопустимом грунте (${b.x},${b.y})`);
      continue;
    }
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) occupied[id(xx, yy)] = 1;
    }
    oldToNew[i] = keepIndices.length;
    keepIndices.push(i);
  }

  let buildings = keepIndices.map((i) => built.buildings[i]);
  let plotDistrict = keepIndices.map((i) => built.plotDistrict[i]);
  let placedPlots = keepIndices.map((i) => built.placedPlots[i]);
  let secondaryFlags = keepIndices.map((i) => built.secondaryFlags[i]);
  let rankedCivic: RankedCivic[] = built.rankedCivic
    .filter((rc) => rc.plotRank < 0 || oldToNew[rc.plotRank] >= 0)
    .map((rc) => ({ item: rc.item, plotRank: rc.plotRank < 0 ? -1 : oldToNew[rc.plotRank] }));

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const isExitWalkable = (p: Point) =>
      inside(p.x, p.y)
      && !occupied[id(p.x, p.y)]
      && (!BLOCKED_SET.has(cells[p.y][p.x].terrain) || cells[p.y][p.x].terrain === 'bridge');

    const [fx, fy] = facingVector(b.facing ?? 0);
    let out = { x: b.door.x + fx, y: b.door.y + fy };

    if (!isExitWalkable(out)) {
      const hx = b.x + Math.floor(b.w / 2), hy = b.y + Math.floor(b.h / 2);
      const sides: { door: Point; out: Point; facing: ChestRotation }[] = [
        { door: { x: hx, y: b.y + b.h - 1 }, out: { x: hx, y: b.y + b.h }, facing: 0 },
        { door: { x: hx, y: b.y }, out: { x: hx, y: b.y - 1 }, facing: 180 },
        { door: { x: b.x, y: hy }, out: { x: b.x - 1, y: hy }, facing: 90 },
        { door: { x: b.x + b.w - 1, y: hy }, out: { x: b.x + b.w, y: hy }, facing: 270 },
      ];
      const validSide = sides.find((s) => isExitWalkable(s.out));
      if (validSide) {
        buildings[i] = { ...b, door: validSide.door, facing: validSide.facing };
        out = validSide.out;
        repairs.push(`переориентирован вход дома (${b.x},${b.y})`);
      }
    }

    const beforeLen = rankedCivic.length;
    rankedCivic = rankedCivic.filter(({ item }) => item.kind === 'square' || !contains(item, out.x, out.y));
    if (rankedCivic.length !== beforeLen) {
      repairs.push(`освобождён вход дома (${b.x},${b.y}) от уличного объекта`);
    }
  }

  // ---- 3. Проверка пешей достижимости всех домов (включая дворовые флигели!) -
  const computeReachableWalk = (occ: Uint8Array): Uint8Array => {
    const walk = (x: number, y: number) =>
      inside(x, y)
      && !occ[id(x, y)]
      && (!BLOCKED_SET.has(cells[y][x].terrain) || cells[y][x].terrain === 'bridge');

    let start = -1;
    let bestScore = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!STREET_SET.has(cells[y][x].terrain) || !walk(x, y)) continue;
        const sc = -Math.hypot(x - skel.center.x, y - skel.center.y);
        if (sc > bestScore || start < 0) {
          bestScore = sc;
          start = id(x, y);
        }
      }
    }
    if (start < 0) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!walk(x, y)) continue;
          const sc = -Math.hypot(x - skel.center.x, y - skel.center.y);
          if (sc > bestScore || start < 0) {
            bestScore = sc;
            start = id(x, y);
          }
        }
      }
    }

    const seen = new Uint8Array(w * h);
    if (start >= 0) {
      const q = [start];
      seen[start] = 1;
      for (let head = 0; head < q.length; head++) {
        const c = q[head];
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (walk(nx, ny) && !seen[id(nx, ny)]) {
            seen[id(nx, ny)] = 1;
            q.push(id(nx, ny));
          }
        }
      }
    }
    return seen;
  };

  let reachable = computeReachableWalk(occupied);
  const houseIsReachable = (b: Building, seen: Uint8Array): boolean => {
    for (let y = b.y - 1; y <= b.y + b.h; y++) {
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (inside(x, y) && seen[id(x, y)]) return true;
      }
    }
    return false;
  };

  let needRecalc = false;
  for (const b of buildings) {
    if (houseIsReachable(b, reachable)) continue;
    const [fx, fy] = facingVector(b.facing ?? 0);
    const out = { x: b.door.x + fx, y: b.door.y + fy };
    let bridged = false;
    for (const [dx, dy] of N4) {
      for (let step = 1; step <= 3; step++) {
        const tx = out.x + dx * step, ty = out.y + dy * step;
        if (!inside(tx, ty)) break;
        if (reachable[id(tx, ty)]) {
          let canCarve = true;
          for (let k = 0; k < step; k++) {
            const cx = out.x + dx * k, cy = out.y + dy * k;
            const tr = cells[cy][cx].terrain;
            if (occupied[id(cx, cy)] || tr === 'water' || tr === 'deepWater') {
              canCarve = false;
              break;
            }
          }
          if (canCarve) {
            for (let k = 0; k < step; k++) {
              const cx = out.x + dx * k, cy = out.y + dy * k;
              if (cells[cy][cx].terrain === 'wall') gates.add(id(cx, cy));
              cells[cy][cx].terrain = 'dirt';
            }
            bridged = true;
            needRecalc = true;
            repairs.push(`пробит проход к изолированному двору (${b.x},${b.y})`);
          }
          break;
        }
      }
      if (bridged) break;
    }
  }
  if (needRecalc) reachable = computeReachableWalk(occupied);

  const finalIndices: number[] = [];
  const remap2 = new Int32Array(buildings.length).fill(-1);
  for (let i = 0; i < buildings.length; i++) {
    if (houseIsReachable(buildings[i], reachable)) {
      remap2[i] = finalIndices.length;
      finalIndices.push(i);
    } else {
      const b = buildings[i];
      for (let yy = b.y; yy < b.y + b.h; yy++) {
        for (let xx = b.x; xx < b.x + b.w; xx++) occupied[id(xx, yy)] = 0;
      }
      repairs.push(`исключён отрезанный водой участок (${b.x},${b.y})`);
    }
  }
  if (finalIndices.length !== buildings.length) {
    buildings = finalIndices.map((i) => buildings[i]);
    plotDistrict = finalIndices.map((i) => plotDistrict[i]);
    placedPlots = finalIndices.map((i) => placedPlots[i]);
    secondaryFlags = finalIndices.map((i) => secondaryFlags[i]);
    rankedCivic = rankedCivic
      .filter((rc) => rc.plotRank < 0 || remap2[rc.plotRank] >= 0)
      .map((rc) => ({ item: rc.item, plotRank: rc.plotRank < 0 ? -1 : remap2[rc.plotRank] }));
    reachable = computeReachableWalk(occupied);
  }

  // ---- 4. Валидация пустых зон внутри кварталов и локальная починка (Section 17 & 20)
  // Любая крупная необъяснённая зелёная пустота внутри центрального или жилого квартала
  // локально оформляется как общий квартальный двор/сад с колодцем или грядками!
  const claimedOpen = new Uint8Array(w * h);
  for (const p of plotSub.plots) {
    if (p.yardRect) {
      for (let yy = p.yardRect.y; yy < p.yardRect.y + p.yardRect.h; yy++) {
        for (let xx = p.yardRect.x; xx < p.yardRect.x + p.yardRect.w; xx++) {
          if (inside(xx, yy)) claimedOpen[id(xx, yy)] = 1;
        }
      }
    }
  }
  for (const rc of rankedCivic) {
    for (let yy = rc.item.y; yy < rc.item.y + rc.item.h; yy++) {
      for (let xx = rc.item.x; xx < rc.item.x + rc.item.w; xx++) {
        if (inside(xx, yy)) claimedOpen[id(xx, yy)] = 1;
      }
    }
  }

  for (const block of distLayout.blocks) {
    if (block.zone !== 'old_core' && block.zone !== 'inner_city' && block.zone !== 'residential') continue;
    const freeCells = block.cells.filter((c) => {
      const x = c % w, y = (c - x) / w;
      return !occupied[c] && !streets[c] && !claimedOpen[c] && !wet(cells[y][x].terrain);
    });
    const maxUnclaimed = block.zone === 'old_core' ? 16 : block.zone === 'inner_city' ? 22 : 30;
    if (freeCells.length <= maxUnclaimed) continue;

    // Находим компактный прямоугольник внутри пустого ядра квартала и превращаем его в квартальный двор/сад!
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (const c of freeCells) {
      const x = c % w, y = (c - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    let repairedBox: Selection | undefined;
    for (const [rw, rh] of [[4, 3], [3, 3], [3, 2]] as const) {
      for (let yy = minY; yy <= maxY - rh + 1 && !repairedBox; yy++) {
        for (let xx = minX; xx <= maxX - rw + 1; xx++) {
          let ok = true;
          for (let cy = yy; cy < yy + rh && ok; cy++) {
            for (let cx = xx; cx < xx + rw; cx++) {
              const n = id(cx, cy);
              if (!inside(cx, cy) || occupied[n] || streets[n] || skel.reserved[n] || distLayout.blockAt[n] !== block.id) {
                ok = false;
                break;
              }
            }
          }
          if (ok) {
            repairedBox = { x: xx, y: yy, w: rw, h: rh };
            break;
          }
        }
      }
    }

    if (repairedBox) {
      const isGarden = block.districtKind === 'noble' || block.districtKind === 'temple' || block.zone === 'residential';
      const propKind: CivicKind = isGarden && repairedBox.w >= 3 && repairedBox.h >= 2 ? 'garden' : 'well';
      const spec = CIVIC_KIT[propKind];
      const itemBox = { x: repairedBox.x, y: repairedBox.y, w: spec.w, h: spec.h };
      if (!rankedCivic.some((rc) => rc.item.kind !== 'square' && intersects(rc.item, itemBox))) {
        rankedCivic.push({
          item: { ...itemBox, kind: propKind, variant: block.id % 2, rotation: 0, source: 'layout' },
          plotRank: Math.min(Math.max(0, buildings.length - 1), 3),
        });
      }
      for (let cy = repairedBox.y; cy < repairedBox.y + repairedBox.h; cy++) {
        for (let cx = repairedBox.x; cx < repairedBox.x + repairedBox.w; cx++) {
          claimedOpen[id(cx, cy)] = 1;
          if (!isGarden && waterDist[id(cx, cy)] >= 2 && !streets[id(cx, cy)]) {
            cells[cy][cx].terrain = 'dirt';
          }
        }
      }
      plotSub.plots.push({
        id: plotSub.plots.length,
        polygon: rectPolygon(repairedBox),
        bounds: repairedBox,
        yardRect: repairedBox,
        courtyardKind: isGarden ? 'garden_yard' : 'enclosed_courtyard',
        districtIndex: block.districtIndex,
        districtType: block.districtKind,
        zone: block.zone,
        size: repairedBox.w * repairedBox.h,
        frontage: repairedBox.w,
        depth: repairedBox.h,
        orientation: 0,
        roadLevel: 3,
        wealth: block.wealth,
        age: block.age,
        fn: isGarden ? 'garden' : 'courtyard',
      });
      built.courtyardCount++;
      repairs.push(`пустота квартала #${block.id} оформлена как ${isGarden ? 'сад' : 'общий двор'}`);
    }
  }

  built.buildings = buildings;
  built.plotDistrict = plotDistrict;
  built.placedPlots = placedPlots;
  built.secondaryFlags = secondaryFlags;
  built.rankedCivic = rankedCivic;

  // Обновляем статус доступности landmarks.
  for (const lm of built.landmarks) {
    let ok = false;
    for (let y = lm.bounds.y - 1; y <= lm.bounds.y + lm.bounds.h && !ok; y++) {
      for (let x = lm.bounds.x - 1; x <= lm.bounds.x + lm.bounds.w; x++) {
        if (inside(x, y) && (reachable[id(x, y)] || STREET_SET.has(cells[y][x].terrain))) {
          ok = true;
          break;
        }
      }
    }
    lm.accessible = ok;
  }

  // ---- 5. Классификация открытых пространств (Section 17) -------------------
  // 0=застроено/вода/стена, 1=street, 2=plaza, 3=courtyard, 4=garden, 5=vegetable_garden, 6=park, 7=empty_plot, 8=nature
  const emptyGrid = new Uint8Array(w * h);
  const subPlazaMask = new Uint8Array(w * h);
  if (roadNet.plaza && roadNet.plazaOk) {
    for (let yy = roadNet.plaza.y; yy < roadNet.plaza.y + roadNet.plaza.h; yy++) {
      for (let xx = roadNet.plaza.x; xx < roadNet.plaza.x + roadNet.plaza.w; xx++) {
        if (inside(xx, yy)) subPlazaMask[id(xx, yy)] = 1;
      }
    }
  }
  for (const sp of roadNet.subPlazas) {
    for (let yy = sp.y; yy < sp.y + sp.h; yy++) {
      for (let xx = sp.x; xx < sp.x + sp.w; xx++) {
        if (inside(xx, yy)) subPlazaMask[id(xx, yy)] = 1;
      }
    }
  }

  let coreLandCells = 0;
  let coreUsedCells = 0;
  let coreUnaccountedCells = 0;
  let fringeLandCells = 0;
  let fringeBuiltCells = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = id(x, y);
      const tr = cells[y][x].terrain;
      const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[idx]] ?? 'wilderness';
      const isCore = zone === 'old_core' || zone === 'inner_city';
      const isFringe = zone === 'outer_city' || zone === 'suburbs';

      if (!BLOCKED_SET.has(tr)) {
        if (isCore) coreLandCells++;
        if (isFringe) fringeLandCells++;
      }

      if (occupied[idx] || BLOCKED_SET.has(tr)) {
        emptyGrid[idx] = 0;
        if (occupied[idx] && isCore) coreUsedCells++;
        if (occupied[idx] && isFringe) fringeBuiltCells++;
        continue;
      }

      if (subPlazaMask[idx] || marketArea?.[idx] || tr === 'plaza') {
        emptyGrid[idx] = 2; // plaza
        if (isCore) coreUsedCells++;
      } else if (STREET_SET.has(tr) || streets[idx]) {
        emptyGrid[idx] = 1; // street
        if (isCore) coreUsedCells++;
      } else if (distLayout.districtAt[idx] < 0 || zone === 'wilderness') {
        emptyGrid[idx] = 8; // nature
      } else {
        const bId = distLayout.blockAt[idx];
        const blk = bId >= 0 ? distLayout.blocks[bId] : undefined;
        const pId = plotSub.plotAt[idx];
        const plt = pId >= 0 ? plotSub.plots[pId] : undefined;

        if (blk?.anomaly === 'pocket_green') {
          emptyGrid[idx] = 6; // park / pocket square
          if (isCore) coreUsedCells++;
        } else if (plt?.courtyardKind === 'private_garden' || plt?.courtyardKind === 'temple_courtyard') {
          emptyGrid[idx] = 4; // garden
          if (isCore) coreUsedCells++;
        } else if (plt?.courtyardKind === 'garden_yard' || plt?.fn === 'garden' || plt?.fn === 'farm') {
          emptyGrid[idx] = 5; // vegetable_garden
          if (isCore) coreUsedCells++;
        } else if (plt || claimedOpen[idx] || built.passageMask[idx] || plotSub.nearWall[idx]) {
          emptyGrid[idx] = 3; // courtyard / passage
          if (isCore) coreUsedCells++;
        } else {
          emptyGrid[idx] = 7; // empty_plot / unclaimed block interior
          if (isCore) coreUnaccountedCells++;
        }
      }
    }
  }

  // ---- 6. Расчёт settlementQualityScore и инвариантов (Section 20) ----------
  const connectivity = computeLargestStreetShare(w, h, cells);

  const gateBonus = skel.walls.walled ? (roadNet.gatePoints.length >= 1 ? 1 : .3) : 1;
  const roadConnectivity = Math.round(between(connectivity * 16 + gateBonus * 4, 0, 20) * 10) / 10;

  const activeDistricts = distLayout.districts.filter((d) => d.area > 0);
  const connectedDistricts = activeDistricts.filter((d) =>
    reachable[id(d.x, d.y)] || buildings.some((_, bi) => plotDistrict[bi] === d.index),
  );
  const districtRatio = activeDistricts.length ? connectedDistricts.length / activeDistricts.length : 1;
  const districtCoherence = Math.round(between(districtRatio * 15, 0, 15) * 10) / 10;

  const accessibleLandmarks = built.landmarks.filter((l) => l.accessible).length;
  const lmAccessRatio = built.landmarks.length ? accessibleLandmarks / built.landmarks.length : 1;
  const expectedLandmarks = type.id === 'small_village' ? 0 : ctx.small ? 1 : 3;
  const lmCountRatio = expectedLandmarks === 0 ? 1 : Math.min(1, built.landmarks.length / expectedLandmarks);
  const landmarkPlacement = Math.round(between((lmAccessRatio * .6 + lmCountRatio * .4) * 15, 0, 15) * 10) / 10;

  let slopeSum = 0;
  for (const b of buildings) {
    slopeSum += slope[id(b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2))];
  }
  const avgBuildSlope = buildings.length ? slopeSum / buildings.length : 0;
  const maxRef = geo.geography === 'mountain' ? .26 : .18;
  const terrainFit = between(1 - Math.max(0, avgBuildSlope - .04) / maxRef, .5, 1);
  const terrainAdaptation = Math.round(terrainFit * 15 * 10) / 10;

  // Доля основных фасадных зданий с прямым выходом к улице.
  let primaryTotal = 0;
  let directFrontage = 0;
  for (let i = 0; i < buildings.length; i++) {
    if (secondaryFlags[i]) continue;
    primaryTotal++;
    const b = buildings[i];
    const [fx, fy] = facingVector(b.facing ?? 0);
    const out = { x: b.door.x + fx, y: b.door.y + fy };
    if (inside(out.x, out.y) && plotSub.distanceToStreet[id(out.x, out.y)] <= 2) directFrontage++;
  }
  const frontageRatio = primaryTotal ? directFrontage / primaryTotal : 1;
  const plotQuality = Math.round(between(frontageRatio * 10, 3, 10) * 10) / 10;

  const reachableCount = buildings.filter((b) => houseIsReachable(b, reachable)).length;
  const accessibility = buildings.length ? reachableCount / buildings.length : 1;
  const buildingAccessibility = Math.round(accessibility * 10 * 10) / 10;

  const presentLevels = new Set(roadNet.lanes.map((l) => l.level));
  const secondaryCount = secondaryFlags.filter(Boolean).length;
  const hierarchyScore = roadNet.lanes.length === 0
    ? 6
    : Math.min(10, presentLevels.size * 2.5 + (built.courtyardCount > 0 ? 1.5 : 0) + (secondaryCount > 0 ? 1 : 0));
  const urbanHierarchy = Math.round(hierarchyScore * 10) / 10;

  const uniqueSizes = new Set(buildings.map((b) => `${b.w}x${b.h}`)).size;
  const uniqueFacings = new Set(buildings.map((b) => b.facing)).size;
  const uniqueRoofs = new Set(buildings.map((b) => `${b.roof}:${b.shape}`)).size;
  const varRatio = buildings.length <= 2
    ? .8
    : between((Math.min(uniqueSizes, 5) / 5 + Math.min(uniqueFacings, 4) / 4 + Math.min(uniqueRoofs, 4) / 4) / 3, .3, 1);
  const visualVariation = Math.round(varRatio * 5 * 10) / 10;

  const score = Math.round(
    roadConnectivity
    + districtCoherence
    + landmarkPlacement
    + terrainAdaptation
    + plotQuality
    + buildingAccessibility
    + urbanHierarchy
    + visualVariation,
  );

  const coreDensity = coreLandCells ? Math.round((coreUsedCells / coreLandCells) * 1000) / 1000 : 0;
  const fringeDensity = fringeLandCells ? Math.round((fringeBuiltCells / fringeLandCells) * 1000) / 1000 : 0;
  const unaccountedGreenShare = coreLandCells ? Math.round((coreUnaccountedCells / coreLandCells) * 1000) / 1000 : 0;

  return {
    quality: {
      score: between(score, 0, 100),
      roadConnectivity,
      districtCoherence,
      landmarkPlacement,
      terrainAdaptation,
      plotQuality,
      buildingAccessibility,
      urbanHierarchy,
      visualVariation,
      connectivity: Math.round(connectivity * 1000) / 1000,
      accessibility: Math.round(accessibility * 1000) / 1000,
      terrainFit: Math.round(terrainFit * 1000) / 1000,
      coreDensity,
      fringeDensity,
      secondaryBuildings: secondaryCount,
      unaccountedGreenShare,
      repairs,
    },
    emptyGrid,
    reachableGrid: reachable,
  };
}

function computeLargestStreetShare(w: number, h: number, cells: { terrain: Terrain }[][]): number {
  const seen = new Uint8Array(w * h);
  let total = 0;
  let best = 0;
  for (let i = 0; i < w * h; i++) {
    const x0 = i % w, y0 = (i - x0) / w;
    if (!STREET_SET.has(cells[y0][x0].terrain)) continue;
    total++;
    if (seen[i]) continue;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % w, y = (c - x) / w;
      size++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!seen[n] && STREET_SET.has(cells[ny][nx].terrain)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (size > best) best = size;
  }
  return total ? best / total : 1;
}
