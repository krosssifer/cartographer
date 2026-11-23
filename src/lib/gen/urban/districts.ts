import { hash2 } from '../../random';
import {
  DISTRICTS,
  GROWTH_STAGE_ORDER,
  type DistrictKind,
} from '../settlementTypes';
import type { Point } from '../../types';
import type { UrbanSkeleton } from './nodes';
import type { UrbanRoadResult } from './roads';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  wet,
  type UrbanBlock,
  type UrbanContext,
  type UrbanDistrict,
} from './types';

export interface DistrictLayoutResult {
  districts: UrbanDistrict[];
  districtAt: Int16Array;
  blockAt: Int16Array;
  growthStageAt: Uint8Array;
  blocks: UrbanBlock[];
  alleyCount: number;
}

export function buildDistrictsAndBlocks(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  marketArea?: Uint8Array,
): DistrictLayoutResult {
  const { width: w, height: h, seed, type, character, town, geo } = ctx;
  const { cells, waterDist, slope } = geo;
  const { origin, center, RX, RY, reach, walls, reserved } = skel;
  const { streets, streetLevel, gates, plaza, plazaOk } = roadNet;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usableLand = (x: number, y: number) =>
    inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  // ---- 1. Карта расстояний до ворот, стен и главных улиц --------------------
  const bfsDist = (source: (x: number, y: number) => boolean): Uint16Array => {
    const dist = new Uint16Array(w * h).fill(999);
    const q: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (source(x, y)) {
          dist[id(x, y)] = 0;
          q.push(id(x, y));
        }
      }
    }
    for (let head = 0; head < q.length; head++) {
      const c = q[head];
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const n = id(nx, ny);
        if (dist[n] <= dist[c] + 1) continue;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    return dist;
  };

  const toWall = bfsDist((x, y) => terrain(x, y) === 'wall' || gates.has(id(x, y)));
  const toGate = bfsDist((x, y) => gates.has(id(x, y)));
  const toArterial = bfsDist((x, y) => streets[id(x, y)] === 1 && streetLevel[id(x, y)] <= 2);

  // ---- 2. Стадии исторического роста (ORIGIN → SUBURBS) ---------------------
  // Рост идёт быстрее вдоль главных дорог и воды, медленнее в гору и за стеной.
  const growthStageAt = new Uint8Array(w * h).fill(5);
  const coreScale = .65 + character.coreShare * .85;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = id(x, y);
      const dOrigin = Math.hypot((x - origin.x) / RX, (y - origin.y) / RY);
      const dCenter = reach(x, y);
      let g = Math.min(dOrigin * .85 + dCenter * .25, dCenter);
      // Вдоль главных улиц и ворот город вытягивался раньше («ленточный рост»).
      if (toArterial[idx] <= 4) g -= (5 - toArterial[idx]) * .035;
      if (walls.walled && !walls.insideWalls(x, y)) {
        g = Math.max(g, toGate[idx] <= 7 ? .92 : 1.12);
      }
      g += (hash2(x >> 1, y >> 1, seed + 0x4a6e) - .5) * .08 * (1.2 - character.regularity);

      const stage: number =
        g < .18 * coreScale ? 0 // origin
        : g < .42 * coreScale ? 1 // old_core
        : g < .66 ? 2 // first_expansion
        : g < .88 ? 3 // second_expansion
        : g < 1.08 ? 4 // outer_city
        : 5; // suburbs
      growthStageAt[idx] = stage;
    }
  }

  // ---- 3. Семена функциональных районов -------------------------------------
  const landCount = (() => {
    let cnt = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (usableLand(x, y)) cnt++;
    return cnt;
  })();

  const kinds = (Object.entries(type.districts) as [DistrictKind, number][]).filter(
    ([kind]) => kind !== 'centre' || (plaza && plazaOk) || type.keep,
  );
  const totalWeight = kinds.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const seedBudget = between(Math.round(landCount / (town ? 235 : 310)), Math.min(kinds.length, 3), 15);

  const scoreSeed: Record<DistrictKind, (x: number, y: number, r: number, idx: number) => number> = {
    centre: (_x, _y, r) => r * 3.2,
    market: (x, y, r, idx) =>
      Math.abs(r - .28) * 2.4 + Math.min(toArterial[idx], 8) * .12
      - (plaza && plazaOk ? Math.max(0, 1 - Math.hypot(x - (plaza.x + plaza.w / 2), y - (plaza.y + plaza.h / 2)) / 12) : 0),
    temple: (x, y, r) =>
      Math.abs(r - (character.id === 'religious' ? .18 : .34)) * 2.0 - cells[y][x].height * 1.4,
    noble: (x, y, r, idx) =>
      Math.abs(r - .52) * 1.6 - cells[y][x].height * 2.1 + (waterDist[idx] < 4 ? .9 : 0)
      + (walls.walled && !walls.insideWalls(x, y) ? 2.5 : 0),
    residential: (_x, _y, r) => Math.abs(r - .62) * 1.25,
    craft: (x, y, r, idx) =>
      (waterDist[idx] < 999 ? Math.min(waterDist[idx], 12) / 5.5 : Math.abs(r - .76) * 1.9)
      + (walls.walled ? Math.min(toGate[idx], 18) / 18 : Math.min(toArterial[idx], 10) / 16)
      + (walls.walled && !walls.insideWalls(x, y) && toGate[idx] <= 8 ? -.25 : 0),
    docks: (_x, _y, _r, idx) => Math.min(waterDist[idx], 30) / 2.6,
    garrison: (x, y, r, idx) =>
      type.keep
        ? r * 1.9
        : Math.min(toGate[idx] < 999 ? toGate[idx] : toWall[idx] < 999 ? toWall[idx] : 36, 36) / 5.5
          + Math.abs(r - .78) + (walls.walled && !walls.insideWalls(x, y) ? 2.2 : 0),
    farms: (x, y, r) => Math.abs(r - 1.12) * 1.9 + (walls.walled && walls.insideWalls(x, y) ? 1.8 : 0),
    poor: (x, y, r, idx) =>
      (walls.walled ? (walls.insideWalls(x, y) ? 1.35 : -.15) + Math.abs(r - 1.0) : Math.abs(r - .88) * 1.5)
      + (waterDist[idx] < 6 ? -.25 : 0),
  };

  const plannedKinds: DistrictKind[] = [];
  for (const [kind, weight] of kinds) {
    const count = kind === 'centre' ? 1 : Math.max(1, Math.round((weight / totalWeight) * seedBudget));
    for (let i = 0; i < count; i++) plannedKinds.push(kind);
  }

  const candidatePts: Point[] = [];
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      if (usableLand(x, y) && !streets[id(x, y)] && skel.footprintAt(x, y) < 1.28) candidatePts.push({ x, y });
    }
  }

  const districts: UrbanDistrict[] = [];
  const spacing = Math.min(RX, RY) * .38;
  for (const kind of plannedKinds) {
    let best: Point | undefined;
    let bestScore = Infinity;
    for (const p of candidatePts) {
      if (districts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < spacing * (d.kind === kind ? 1.32 : .92))) continue;
      const idx = id(p.x, p.y);
      if (kind === 'docks' && waterDist[idx] > 9) continue;
      const val = scoreSeed[kind](p.x, p.y, reach(p.x, p.y), idx)
        + hash2(p.x, p.y, seed + kind.length * 131 + districts.length * 17) * .34;
      if (val < bestScore) {
        bestScore = val;
        best = p;
      }
    }
    // Если строгое расстояние не пустило обязательный вид квартала, ослабляем интервал.
    if (!best && !districts.some((d) => d.kind === kind) && kind !== 'docks') {
      for (const p of candidatePts) {
        if (districts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 4)) continue;
        const idx = id(p.x, p.y);
        const val = scoreSeed[kind](p.x, p.y, reach(p.x, p.y), idx);
        if (val < bestScore) {
          bestScore = val;
          best = p;
        }
      }
    }
    if (best) {
      const idx = id(best.x, best.y);
      const age = GROWTH_STAGE_ORDER[growthStageAt[idx]] ?? 'first_expansion';
      const baseWealth = DISTRICTS[kind].wealth + character.wealthBias
        + (cells[best.y][best.x].height - .5) * .12
        + (hash2(best.x, best.y, seed + 0x77e) - .5) * .08;
      districts.push({
        index: districts.length,
        kind,
        label: DISTRICTS[kind].label,
        x: best.x,
        y: best.y,
        wealth: between(baseWealth, .05, .98),
        age,
        area: 0,
        plotCount: 0,
      });
    } else if (kind === 'docks' && !districts.some((d) => d.kind === 'docks')) {
      ctx.notes.push('порт без причалов: нет воды рядом с застройкой');
    }
  }

  // Fallback: хотя бы один район обязан существовать.
  if (!districts.length) {
    const fallbackKind = kinds[0]?.[0] ?? 'residential';
    districts.push({
      index: 0, kind: fallbackKind, label: DISTRICTS[fallbackKind].label,
      x: center.x, y: center.y, wealth: .45, age: 'old_core', area: 0, plotCount: 0,
    });
  }

  // ---- 4. Геодезическое разбиение кварталов с барьерами (стены, реки, проспекты)
  // Благодаря стоимости пересечения стен/рек/главных улиц границы районов идут ПО улицам и стенам!
  const districtAt = new Int16Array(w * h).fill(-1);
  const bestCost = new Uint32Array(w * h).fill(0xffffffff);
  // Bucket queue (шаг стоимости 1..150, макс стоимость ~4000).
  const maxBucket = 4096;
  const buckets: number[][] = Array.from({ length: maxBucket }, () => []);

  districts.forEach((d, dIdx) => {
    const start = id(d.x, d.y);
    bestCost[start] = 0;
    districtAt[start] = dIdx;
    buckets[0].push(start);
  });

  for (let cost = 0; cost < maxBucket; cost++) {
    const bucket = buckets[cost];
    for (let k = 0; k < bucket.length; k++) {
      const c = bucket[k];
      if (cost > bestCost[c]) continue;
      const dIdx = districtAt[c];
      const dKind = districts[dIdx].kind;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const n = id(nx, ny);
        const tr = terrain(nx, ny);
        if (tr === 'rock') continue;
        let step = dKind === 'farms' ? 8 : 10;
        if (tr === 'wall') step = 95;
        else if (wet(tr)) step = tr === 'bridge' ? 28 : 150;
        else if (streets[n]) step = streetLevel[n] <= 1 ? 26 : streetLevel[n] === 2 ? 19 : 14;
        step += Math.round(slope[n] * 25);
        const nextCost = cost + step;
        if (nextCost >= maxBucket || nextCost >= bestCost[n]) continue;
        bestCost[n] = nextCost;
        districtAt[n] = dIdx;
        buckets[nextCost].push(n);
      }
    }
  }

  // Ограничиваем застройку контуром City Footprint и переходной зоной предместий!
  const suburbBonus = character.suburbSpread * .14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = id(x, y);
      const dIdx = districtAt[idx];
      if (dIdx < 0 || !usableLand(x, y)) {
        districtAt[idx] = -1;
        continue;
      }
      const dKind = districts[dIdx].kind;
      const fp = skel.footprintAt(x, y);
      const limit = dKind === 'farms' ? 1.34 + suburbBonus
        : dKind === 'poor' || dKind === 'craft' ? 1.12 + suburbBonus * .8
        : .98 + suburbBonus * .4;
      // Вдоль главных выездных дорог (Уровень 1) разрешаем ленточные предместья!
      const ribbonBoost = toArterial[idx] <= 4 ? .22 : 0;
      if (fp > limit + ribbonBoost) {
        districtAt[idx] = -1;
      } else {
        districts[dIdx].area++;
      }
    }
  }

  // ---- 5. Разбиение слишком крупных кварталов сквозными и Т-образными переулками (Level 3 — ALLEY)
  // Старый центр получает мелкие неправильные кварталы, жилые районы — средние, окраины — просторные!
  let alleyCount = 0;
  const splitOversizedBlocks = () => {
    for (let pass = 0; pass < 2; pass++) {
      const distToStreet = new Uint16Array(w * h).fill(999);
      const q: number[] = [];
      for (let i = 0; i < w * h; i++) {
        if (streets[i]) {
          distToStreet[i] = 0;
          q.push(i);
        }
      }
      for (let head = 0; head < q.length; head++) {
        const c = q[head];
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const n = id(nx, ny);
          if (distToStreet[n] <= distToStreet[c] + 1 || !usableLand(nx, ny)) continue;
          distToStreet[n] = distToStreet[c] + 1;
          q.push(n);
        }
      }

      const seen = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (seen[i] || streets[i] || reserved[i] || marketArea?.[i] || districtAt[i] < 0) continue;
        const x0 = i % w, y0 = (i - x0) / w;
        if (!usableLand(x0, y0)) continue;

        const stack = [i];
        seen[i] = 1;
        const comp: number[] = [];
        let deepest = i;
        let maxD = 0;
        let minX = x0, maxX = x0, minY = y0, maxY = y0;

        while (stack.length) {
          const c = stack.pop()!;
          comp.push(c);
          const x = c % w, y = (c - x) / w;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (distToStreet[c] > maxD && distToStreet[c] < 999) {
            maxD = distToStreet[c];
            deepest = c;
          }
          for (const [dx, dy] of N4) {
            const nx = x + dx, ny = y + dy;
            if (!inside(nx, ny)) continue;
            const n = id(nx, ny);
            if (seen[n] || streets[n] || reserved[n] || marketArea?.[n] || districtAt[n] < 0 || !usableLand(nx, ny)) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }

        const dKind = districts[districtAt[deepest]]?.kind ?? 'residential';
        if (dKind === 'farms') continue;
        const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[deepest]] ?? 'residential';
        const maxBlockArea = zone === 'old_core' ? 68 : zone === 'inner_city' ? 98 : zone === 'residential' ? 138 : 195;
        const maxDepth = zone === 'old_core' ? 4 : zone === 'inner_city' ? 5 : 6;
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;

        // 1) Сквозное деление длинного или слишком крупного квартала поперечным переулком!
        if (comp.length > maxBlockArea && Math.max(bw, bh) >= 12 && Math.min(bw, bh) >= 6) {
          const splitVert = bw >= bh;
          const midCoord = splitVert
            ? Math.round((minX + maxX) / 2 + (hash2(minX, minY, seed + 0xb10 + pass) - .5) * 2.2)
            : Math.round((minY + maxY) / 2 + (hash2(minX, minY, seed + 0xb20 + pass) - .5) * 2.2);

          const alleyPts: Point[] = [];
          let touchesStart = false;
          let touchesEnd = false;

          if (splitVert) {
            const wobble = zone === 'old_core' && hash2(minX, maxY, seed + 0xb30) > .45 ? 1 : 0;
            const midY = Math.floor((minY + maxY) / 2);
            for (let yy = minY - 1; yy <= maxY + 1; yy++) {
              const xx = between(midCoord + (yy > midY ? wobble : 0), 1, w - 2);
              if (!inside(xx, yy)) continue;
              const n = id(xx, yy);
              if (reserved[n] || marketArea?.[n]) { alleyPts.length = 0; break; }
              if (streets[n]) {
                if (yy <= minY + 1) touchesStart = true;
                if (yy >= maxY - 1) touchesEnd = true;
                alleyPts.push({ x: xx, y: yy });
              } else if (usableLand(xx, yy) && slope[n] < .22) {
                if (wobble && yy === midY + 1) {
                  const prevX = between(midCoord, 1, w - 2);
                  if (usableLand(prevX, yy)) alleyPts.push({ x: prevX, y: yy });
                }
                alleyPts.push({ x: xx, y: yy });
              } else {
                break;
              }
            }
          } else {
            const wobble = zone === 'old_core' && hash2(maxX, minY, seed + 0xb40) > .45 ? 1 : 0;
            const midX = Math.floor((minX + maxX) / 2);
            for (let xx = minX - 1; xx <= maxX + 1; xx++) {
              const yy = between(midCoord + (xx > midX ? wobble : 0), 1, h - 2);
              if (!inside(xx, yy)) continue;
              const n = id(xx, yy);
              if (reserved[n] || marketArea?.[n]) { alleyPts.length = 0; break; }
              if (streets[n]) {
                if (xx <= minX + 1) touchesStart = true;
                if (xx >= maxX - 1) touchesEnd = true;
                alleyPts.push({ x: xx, y: yy });
              } else if (usableLand(xx, yy) && slope[n] < .22) {
                if (wobble && xx === midX + 1) {
                  const prevY = between(midCoord, 1, h - 2);
                  if (usableLand(xx, prevY)) alleyPts.push({ x: xx, y: prevY });
                }
                alleyPts.push({ x: xx, y: yy });
              } else {
                break;
              }
            }
          }

          if (alleyPts.length >= 4 && (touchesStart || touchesEnd)) {
            // Если это Т-образный тупиковый переулок (не сквозной), обрезаем на 70%, чтобы оставить двор в конце!
            const finalPts = touchesStart && touchesEnd
              ? alleyPts
              : touchesStart
              ? alleyPts.slice(0, Math.max(4, Math.round(alleyPts.length * .72)))
              : alleyPts.slice(Math.floor(alleyPts.length * .28));
            if (finalPts.some((pt) => streets[id(pt.x, pt.y)])) {
              for (const pt of finalPts) roadNet.paintCell(pt.x, pt.y, 'road', 3, false);
              roadNet.lanes.push({
                points: finalPts,
                width: 1,
                surface: 'road',
                level: 3,
                reason: touchesStart && touchesEnd ? 'сквозной переулок квартала' : 'тупиковый переулок двора',
              });
              alleyCount++;
              continue;
            }
          }
        }

        // 2) Если квартал глубокий внутри, пробиваем короткий переулок от ближайшей улицы к ядру квартала.
        if (comp.length >= 42 && maxD >= maxDepth) {
          const path: Point[] = [];
          let cur = deepest;
          let guard = 0;
          while (distToStreet[cur] > 0 && guard++ < 30) {
            const cx = cur % w, cy = (cur - cx) / w;
            path.push({ x: cx, y: cy });
            let next = -1;
            let bestNextD = distToStreet[cur];
            for (const [dx, dy] of N4) {
              const nx = cx + dx, ny = cy + dy;
              if (!inside(nx, ny)) continue;
              const n = id(nx, ny);
              if (reserved[n] || marketArea?.[n]) continue;
              if (distToStreet[n] < bestNextD && (streets[n] || usableLand(nx, ny))) {
                bestNextD = distToStreet[n];
                next = n;
              }
            }
            if (next < 0) break;
            cur = next;
            if (streets[cur]) {
              path.push({ x: cur % w, y: Math.floor(cur / w) });
              break;
            }
          }

          if (path.length >= 3 && streets[id(path[path.length - 1].x, path[path.length - 1].y)]) {
            path.reverse();
            for (const pt of path) roadNet.paintCell(pt.x, pt.y, 'road', 3, false);
            roadNet.lanes.push({
              points: path,
              width: 1,
              surface: 'road',
              level: 3,
              reason: 'внутриквартальный переулок',
            });
            alleyCount++;
          }
        }
      }
    }
  };

  if (ctx.geo.width >= 26 && roadNet.lanes.length > 0) {
    splitOversizedBlocks();
  }

  // ---- 6. Финальная сборка кварталов (UrbanBlock[]), их форм и исторических аномалий
  const blocks: UrbanBlock[] = [];
  const blockAt = new Int16Array(w * h).fill(-1);
  {
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || streets[i] || reserved[i] || marketArea?.[i] || districtAt[i] < 0) continue;
      const x0 = i % w, y0 = (i - x0) / w;
      if (!usableLand(x0, y0)) continue;

      const stack = [i];
      seen[i] = 1;
      const bCells: number[] = [];
      let minX = x0, maxX = x0, minY = y0, maxY = y0;
      const dCounts = new Map<number, number>();

      while (stack.length) {
        const c = stack.pop()!;
        bCells.push(c);
        const x = c % w, y = (c - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const d = districtAt[c];
        if (d >= 0) dCounts.set(d, (dCounts.get(d) ?? 0) + 1);

        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const n = id(nx, ny);
          if (seen[n] || streets[n] || reserved[n] || marketArea?.[n] || districtAt[n] < 0 || !usableLand(nx, ny)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }

      if (bCells.length < 9) continue;

      let dominantDistrict = districtAt[i];
      let bestCnt = 0;
      for (const [d, cnt] of dCounts) {
        if (cnt > bestCnt) {
          bestCnt = cnt;
          dominantDistrict = d;
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      const fillRatio = bCells.length / Math.max(1, bw * bh);
      const irregularity = between(1 - fillRatio, 0, 1);
      const midCell = bCells[Math.floor(bCells.length / 2)];
      const age = GROWTH_STAGE_ORDER[growthStageAt[midCell]] ?? 'first_expansion';
      const zone = URBAN_ZONE_ORDER[skel.urbanZoneAt[midCell]] ?? 'residential';
      const roll = hash2(minX + blocks.length, minY, seed + 0xa401);

      const shape: UrbanBlock['shape'] = bCells.length <= 32 && fillRatio < .62
        ? 'triangular'
        : bCells.length <= 42 && aspect < 1.5
        ? 'corner'
        : aspect >= 2.15
        ? 'elongated'
        : fillRatio >= .84
        ? 'rectangular'
        : fillRatio >= .66
        ? 'trapezoid'
        : 'irregular';

      let anomaly: UrbanBlock['anomaly'];
      if (ctx.geo.geography === 'mountain' && slope[midCell] > .06) {
        anomaly = 'terrace';
      } else if (shape === 'triangular' && bCells.length >= 14 && roll < .55) {
        anomaly = 'pocket_green';
      } else if ((age === 'origin' || age === 'old_core') && roll < character.anomalyRate * .35) {
        anomaly = 'old_enclave';
      } else if ((age === 'suburbs' || districts[dominantDistrict].kind === 'poor') && roll > 1 - character.anomalyRate * .18) {
        anomaly = 'ruined_lot';
      }

      const bId = blocks.length;
      for (const c of bCells) blockAt[c] = bId;

      blocks.push({
        id: bId,
        cells: bCells,
        bounds: { x: minX, y: minY, w: bw, h: bh },
        districtIndex: dominantDistrict,
        districtKind: districts[dominantDistrict].kind,
        zone,
        shape,
        wealth: districts[dominantDistrict].wealth,
        age,
        irregularity,
        anomaly,
      });
    }
  }

  return {
    districts,
    districtAt,
    blockAt,
    growthStageAt,
    blocks,
    alleyCount,
  };
}
