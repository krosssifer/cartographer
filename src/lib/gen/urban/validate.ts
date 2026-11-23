import { contains } from '../../settlementKit';
import type { Building, ChestRotation, Point, Terrain } from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { BuildingsAndLandmarksResult } from './landmarks';
import type { UrbanSkeleton } from './nodes';
import type { PlotSubdivisionResult } from './plots';
import { unifyStreetComponents, type UrbanRoadResult } from './roads';
import {
  N4,
  between,
  facingVector,
  type RankedCivic,
  type SettlementQualityReport,
  type UrbanContext,
} from './types';

const STREET_SET: ReadonlySet<Terrain> = new Set<Terrain>(['road', 'plaza', 'bridge']);
const BLOCKED_SET: ReadonlySet<Terrain> = new Set<Terrain>(['wall', 'water', 'deepWater', 'rock']);

export function validateAndRepairUrbanPlan(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  distLayout: DistrictLayoutResult,
  plotSub: PlotSubdivisionResult,
  built: BuildingsAndLandmarksResult,
  marketArea?: Uint8Array,
): SettlementQualityReport {
  const { width: w, height: h, type, geo } = ctx;
  const { cells, slope } = geo;
  const { streets, streetLevel, gates } = roadNet;
  const repairs: string[] = [];

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;

  // ---- 1. Локальная починка связности дорог и башен у ворот -----------------
  // Синхронизируем маску streets строго с реальным уличным террейном (и контуром рынка, если он грунтовый).
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
  // Если грунтовый рынок разделил два подхода road/plaza, соединяем меньшие ветви по краю или убираем сиротские хвосты,
  // чтобы сама сеть клеток road|plaza|bridge тоже оставалась единой (>= 98%).
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
  // Повторно синхронизируем клетки, которые должны считаться улицей по террейну.
  let streetTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (STREET_SET.has(cells[y][x].terrain)) streetTotal++;
    }
  }
  if (Math.abs(beforeStreetCells - streetTotal) > 3) {
    repairs.push('связность уличной сети локально выровнена');
  }

  // Убираем башни, если клетка перестала быть стеной или попала на проезд ворот.
  const validTowers = roadNet.towers.filter((t) => inside(t.x, t.y) && cells[t.y][t.x].terrain === 'wall' && !streets[id(t.x, t.y)]);
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
  let rankedCivic: RankedCivic[] = built.rankedCivic
    .filter((rc) => rc.plotRank < 0 || oldToNew[rc.plotRank] >= 0)
    .map((rc) => ({ item: rc.item, plotRank: rc.plotRank < 0 ? -1 : oldToNew[rc.plotRank] }));

  // Проверяем каждую дверь: выход не должен быть перекрыт другим домом, стеной, водой или предметом.
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const isExitWalkable = (p: Point) =>
      inside(p.x, p.y)
      && !occupied[id(p.x, p.y)]
      && (!BLOCKED_SET.has(cells[p.y][p.x].terrain) || cells[p.y][p.x].terrain === 'bridge');

    const [fx, fy] = facingVector(b.facing ?? 0);
    let out = { x: b.door.x + fx, y: b.door.y + fy };

    if (!isExitWalkable(out)) {
      // Переориентируем дверь на свободную сторону дома.
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

    // Если мелкий предмет перекрыл клетку перед дверью — убираем предмет!
    const beforeLen = rankedCivic.length;
    rankedCivic = rankedCivic.filter(({ item }) => item.kind === 'square' || !contains(item, out.x, out.y));
    if (rankedCivic.length !== beforeLen) {
      repairs.push(`освобождён вход дома (${b.x},${b.y}) от уличного объекта`);
    }
  }

  // ---- 3. Проверка пешей достижимости всех домов от главной улицы -----------
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
        const sc = -Math.hypot(x - w / 2, y - h / 2);
        if (sc > bestScore || start < 0) {
          bestScore = sc;
          start = id(x, y);
        }
      }
    }
    if (start < 0) {
      // Если улицы выключены (s.road = false), стартуем с ближайшей проходимой клетки центра.
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

  // Если дом отрезан тонкой скальной перемычкой или старой внутренней стеной (до 3 клеток),
  // пробиваем аккуратную калитку/тропу; иначе исключаем недоступный участок!
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
          // Проверяем, можно ли пройти по промежуточным клеткам (только скала/внутренняя стена, не глубокая вода и не другой дом).
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

  // Удаляем дома, которые оказались на отрезанном водой островке без моста.
  const finalIndices: number[] = [];
  const remap2 = new Int32Array(buildings.length).fill(-1);
  for (let i = 0; i < buildings.length; i++) {
    if (houseIsReachable(buildings[i], reachable)) {
      remap2[i] = finalIndices.length;
      finalIndices.push(i);
    } else {
      repairs.push(`исключён отрезанный водой участок (${buildings[i].x},${buildings[i].y})`);
    }
  }
  if (finalIndices.length !== buildings.length) {
    buildings = finalIndices.map((i) => buildings[i]);
    plotDistrict = finalIndices.map((i) => plotDistrict[i]);
    rankedCivic = rankedCivic
      .filter((rc) => rc.plotRank < 0 || remap2[rc.plotRank] >= 0)
      .map((rc) => ({ item: rc.item, plotRank: rc.plotRank < 0 ? -1 : remap2[rc.plotRank] }));
  }

  built.buildings = buildings;
  built.plotDistrict = plotDistrict;
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

  // ---- 4. Расчёт settlementQualityScore (0..100, Section 29) ----------------
  const connectivity = computeLargestStreetShare(w, h, cells);

  // 1) Road connectivity (0..20)
  const gateBonus = skel.walls.walled ? (roadNet.gatePoints.length >= 1 ? 1 : .3) : 1;
  const roadConnectivity = Math.round(between(connectivity * 16 + gateBonus * 4, 0, 20) * 10) / 10;

  // 2) District coherence (0..15)
  const activeDistricts = distLayout.districts.filter((d) => d.area > 0);
  const connectedDistricts = activeDistricts.filter((d) =>
    reachable[id(d.x, d.y)] || buildings.some((_, bi) => plotDistrict[bi] === d.index),
  );
  const districtRatio = activeDistricts.length ? connectedDistricts.length / activeDistricts.length : 1;
  const districtCoherence = Math.round(between(districtRatio * 15, 0, 15) * 10) / 10;

  // 3) Landmark placement (0..15)
  const accessibleLandmarks = built.landmarks.filter((l) => l.accessible).length;
  const lmAccessRatio = built.landmarks.length ? accessibleLandmarks / built.landmarks.length : 1;
  const expectedLandmarks = type.id === 'small_village' ? 0 : ctx.small ? 1 : 3;
  const lmCountRatio = expectedLandmarks === 0 ? 1 : Math.min(1, built.landmarks.length / expectedLandmarks);
  const landmarkPlacement = Math.round(between((lmAccessRatio * .6 + lmCountRatio * .4) * 15, 0, 15) * 10) / 10;

  // 4) Terrain adaptation (0..15)
  let slopeSum = 0;
  for (const b of buildings) {
    slopeSum += slope[id(b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2))];
  }
  const avgBuildSlope = buildings.length ? slopeSum / buildings.length : 0;
  const maxRef = geo.geography === 'mountain' ? .26 : .18;
  const terrainFit = between(1 - Math.max(0, avgBuildSlope - .04) / maxRef, .5, 1);
  const terrainAdaptation = Math.round(terrainFit * 15 * 10) / 10;

  // 5) Plot quality (0..10) — доля зданий с прямым фасадом к улице (<= 2 клеток).
  let directFrontage = 0;
  for (const b of buildings) {
    const [fx, fy] = facingVector(b.facing ?? 0);
    const out = { x: b.door.x + fx, y: b.door.y + fy };
    if (inside(out.x, out.y) && plotSub.distanceToStreet[id(out.x, out.y)] <= 2) directFrontage++;
  }
  const frontageRatio = buildings.length ? directFrontage / buildings.length : 1;
  const plotQuality = Math.round(between(frontageRatio * 10, 3, 10) * 10) / 10;

  // 6) Building accessibility (0..10)
  const reachableCount = buildings.filter((b) => houseIsReachable(b, reachable)).length;
  const accessibility = buildings.length ? reachableCount / buildings.length : 1;
  const buildingAccessibility = Math.round(accessibility * 10 * 10) / 10;

  // 7) Urban hierarchy (0..10) — наличие разных уровней улиц (артерии, районные, переулки/дворы).
  const presentLevels = new Set(roadNet.lanes.map((l) => l.level));
  const hierarchyScore = roadNet.lanes.length === 0
    ? 6
    : Math.min(10, presentLevels.size * 3 + (built.courtyardCount > 0 ? 2 : 0));
  const urbanHierarchy = Math.round(hierarchyScore * 10) / 10;

  // 8) Visual variation (0..5) — разнообразие размеров, ориентаций и крыш.
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

  return {
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
    repairs,
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
