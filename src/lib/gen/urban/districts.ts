import { hash2 } from '../../random';
import {
  DISTRICTS,
  GROWTH_STAGE_ORDER,
  type DistrictKind,
  type SettlementTypeDef,
  type UrbanCharacterDef,
} from '../settlementTypes';
import type { Point } from '../../types';
import type { UrbanSkeleton } from './nodes';
import type { UrbanRoadResult } from './roads';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  wet,
  type DistrictPlacementDiagnostics,
  type DistrictPlacementFailure,
  type DistrictPlacementFailureReason,
  type UrbanBlock,
  type UrbanContext,
  type UrbanDistrict,
} from './types';

/**
 * Иерархия сущностей городского планировщика (Phase 2.2):
 * - Functional District (`UrbanDistrict`): функциональный район (рыночный, ремесленный, жилой…).
 * - Core (`origin` / `center` в `UrbanSkeleton`): историческое ядро зарождения и центр города.
 * - District Center (`(district.x, district.y)`): опорный центр функционального района для геодезического роста.
 * - Block (`UrbanBlock`): квартал, ограниченный улицами/стенами/рекой.
 * - Plot (`UrbanPlot`): отдельный земельный участок с главным домом, двором и флигелем.
 */

export interface DistrictBudgetInput {
  /** Число пригодных сухих клеток в пределах городского пятна и пояса предместий. */
  usableFootprintCells: number;
  /** Общее число пригодных сухих клеток на карте. */
  totalUsableCells: number;
  width: number;
  height: number;
  type: SettlementTypeDef;
  character: UrbanCharacterDef;
  /** Опциональная явная плотность при прямом вызове расчёта бюджета. */
  density?: number;
}

export interface DistrictSeedPlan {
  kind: DistrictKind;
  mandatory: boolean;
  stage: 1 | 2 | 3;
}

/**
 * Динамический расчёт бюджета функциональных районов (без жёсткого потолка 15).
 * Масштабируется от пригодной площади городского контура, типа поселения,
 * целевой плотности застройки (`type.fill`) и исторического характера.
 */
export function calculateDistrictBudget(input: DistrictBudgetInput): number {
  const { usableFootprintCells, totalUsableCells, type, character, density } = input;
  const town = type.style === 'town';
  const effectiveCells = Math.max(
    120,
    usableFootprintCells > 0 ? usableFootprintCells : Math.round(totalUsableCells * 0.58),
  );
  const fillFactor = 0.78 + type.fill * 0.85 + (density !== undefined ? (density - 0.5) * 0.18 : 0);
  const characterFactor = character.regularity < 0.38 ? 1.08 : character.regularity > 0.75 ? 0.94 : 1.0;
  // Средняя целевая площадь одного функционального района в клетках
  // (плавно растёт с масштабом города, чтобы на 64×48 -> 100×80 -> 160×120 -> 200×160
  // монотонно увеличивалось и число районов, и ёмкость каждого района):
  const baseDistrictArea = town
    ? (type.id === 'large_city' ? 280 : type.id === 'small_city' ? 300 : 320)
    : (type.id === 'small_village' ? 250 : 280);
  const scaleMod = Math.pow(Math.max(1, effectiveCells / 3_600), 0.14);
  const targetCellsPerDistrict = baseDistrictArea * scaleMod;

  const rawBudget = Math.round((effectiveCells / targetCellsPerDistrict) * fillFactor * characterFactor);
  const minDistricts = Math.max(2, Math.min(Object.keys(type.districts).length, town ? 4 : 2));
  const maxByTier = type.id === 'small_village' ? 14
    : type.id === 'frontier_outpost' ? 16
    : type.id === 'large_village' || type.id === 'fortress' || type.id === 'mountain' ? 28
    : type.id === 'large_city' ? 64
    : 48;
  return between(rawBudget, minDistricts, maxByTier);
}

/** Матрица функционального притяжения (< 0) и отталкивания (> 0) между районами. */
export const DISTRICT_AFFINITY: Partial<Record<DistrictKind, Partial<Record<DistrictKind, number>>>> = {
  docks: { market: -0.55, craft: -0.32, poor: -0.18, noble: 0.75, temple: 0.45 },
  market: { centre: -0.48, docks: -0.45, craft: -0.22, garrison: -0.12 },
  craft: { market: -0.24, docks: -0.28, poor: -0.20, noble: 0.68, temple: 0.48 },
  noble: { centre: -0.38, temple: -0.42, poor: 0.85, craft: 0.68, docks: 0.70, farms: 0.35 },
  temple: { centre: -0.42, noble: -0.36, poor: 0.40, docks: 0.42, craft: 0.40 },
  garrison: { centre: -0.15, market: -0.10, noble: 0.15 },
  poor: { craft: -0.22, docks: -0.20, farms: -0.18, noble: 0.85, centre: 0.45 },
  farms: { residential: -0.15, poor: -0.15, centre: 0.65, noble: 0.35 },
  residential: { market: -0.16, temple: -0.14, centre: -0.14 },
  centre: { market: -0.42, temple: -0.35, noble: -0.28 },
};

export interface DistrictLayoutResult {
  districts: UrbanDistrict[];
  districtAt: Int16Array;
  blockAt: Int16Array;
  growthStageAt: Uint8Array;
  blocks: UrbanBlock[];
  alleyCount: number;
  diagnostics: DistrictPlacementDiagnostics;
}

export function buildDistrictsAndBlocks(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  roadNet: UrbanRoadResult,
  marketArea?: Uint8Array,
): DistrictLayoutResult {
  const { width: w, height: h, seed, type, character, geo } = ctx;
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

  // ---- 3. Семена функциональных районов (многостадийное 2D-размещение) ------
  let landCount = 0;
  let footprintLandCount = 0;
  let reservedLandCount = 0;
  const suburbFootprintLimit = 1.32 + character.suburbSpread * .14;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (!usableLand(x, y)) continue;
      landCount++;
      const idx = id(x, y);
      if (reserved[idx] || marketArea?.[idx]) reservedLandCount++;
      if (skel.footprintAt(x, y) <= suburbFootprintLimit) footprintLandCount++;
    }
  }

  const kinds = (Object.entries(type.districts) as [DistrictKind, number][]).filter(
    ([kind]) => kind !== 'centre' || (plaza && plazaOk) || type.keep,
  );
  const nonCentreKinds = kinds.filter(([kind]) => kind !== 'centre');
  const totalWeight = nonCentreKinds.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const seedBudget = calculateDistrictBudget({
    usableFootprintCells: footprintLandCount,
    totalUsableCells: landCount,
    width: w,
    height: h,
    type,
    character,
  });

  // Обязательные виды районов определяются типом и характером поселения;
  // дополнительные копии и второстепенные районы помечаются как опциональные.
  const mandatorySet = new Set<DistrictKind>();
  if (kinds.some(([k]) => k === 'centre')) mandatorySet.add('centre');
  if (kinds.some(([k]) => k === 'residential')) mandatorySet.add('residential');
  if (type.id === 'trade_town' || type.id === 'small_city' || type.id === 'large_city') mandatorySet.add('market');
  if (type.id === 'craft_town' || character.id === 'craft') mandatorySet.add('craft');
  if (type.id === 'port' || character.id === 'port') {
    mandatorySet.add('docks');
    if (kinds.some(([k]) => k === 'market')) mandatorySet.add('market');
  }
  if (type.id === 'fortress' || type.id === 'fortified_town' || type.id === 'frontier_outpost' || character.id === 'military') {
    if (kinds.some(([k]) => k === 'garrison')) mandatorySet.add('garrison');
  }
  if (type.id === 'small_village' || type.id === 'large_village') {
    if (kinds.some(([k]) => k === 'farms')) mandatorySet.add('farms');
  }
  if (character.id === 'religious' && kinds.some(([k]) => k === 'temple')) mandatorySet.add('temple');
  if (character.id === 'noble' && kinds.some(([k]) => k === 'noble')) mandatorySet.add('noble');
  for (const [k, weight] of kinds) {
    if (weight >= 2) mandatorySet.add(k);
  }

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
    craft: (_x, _y, r, idx) =>
      (waterDist[idx] < 999 ? Math.min(waterDist[idx], 12) / 5.5 : Math.abs(r - .76) * 1.9)
      + (walls.walled ? Math.min(toGate[idx], 18) / 18 : Math.min(toArterial[idx], 10) / 16)
      + (walls.walled && !walls.insideWalls(_x, _y) && toGate[idx] <= 8 ? -.25 : 0),
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

  const stageOfKind = (kind: DistrictKind, isMandatory: boolean): 1 | 2 | 3 => {
    if (kind === 'centre' || kind === 'docks' || kind === 'garrison' || (isMandatory && (kind === 'market' || kind === 'temple'))) {
      return 1;
    }
    if (isMandatory) return 2;
    return 3;
  };

  const plannedSeeds: DistrictSeedPlan[] = [];
  for (const [kind, weight] of kinds) {
    const count = kind === 'centre' ? 1 : Math.max(1, Math.round((weight / totalWeight) * seedBudget));
    for (let i = 0; i < count; i++) {
      const mandatory = i === 0 && mandatorySet.has(kind);
      plannedSeeds.push({
        kind,
        mandatory,
        stage: stageOfKind(kind, mandatory),
      });
    }
  }
  // Стадия 1 (ядро и ключевые якоря) -> Стадия 2 (прочие обязательные) -> Стадия 3 (опциональное расширение).
  plannedSeeds.sort((a, b) => a.stage - b.stage);

  const candidatePts: Point[] = [];
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = id(x, y);
      if (usableLand(x, y) && !streets[idx] && !reserved[idx] && skel.footprintAt(x, y) < 1.36) {
        candidatePts.push({ x, y });
      }
    }
  }

  const districts: UrbanDistrict[] = [];
  const failures: DistrictPlacementFailure[] = [];
  const placementWarnings: string[] = [];

  // 2D-адаптивный интервал упаковки центров районов по площади городского пятна:
  // на крупных картах число районов растёт, а центры распределяются по 2D-плоскости без коллапса.
  const areaSpacing = Math.sqrt(Math.max(160, footprintLandCount) / (Math.max(3, plannedSeeds.length) * Math.PI)) * 1.08;
  const spacing = between(areaSpacing, 4.5, Math.max(9, Math.min(RX, RY) * .38));

  const affinityAdjustment = (kind: DistrictKind, x: number, y: number): number => {
    if (!districts.length) return 0;
    const rel = DISTRICT_AFFINITY[kind];
    let delta = 0;
    const refScale = Math.max(10, spacing * 1.8);
    for (const d of districts) {
      const dist = Math.hypot(d.x - x, d.y - y);
      const near = Math.max(0, 1 - dist / refScale);
      if (near <= 0) continue;
      if (d.kind === kind) {
        // Однотипные подрайоны предпочитают расходиться по разным секторам города.
        delta += near * 0.62;
      } else if (rel?.[d.kind] !== undefined) {
        delta += near * rel[d.kind]!;
      }
    }
    return delta;
  };

  for (let planIdx = 0; planIdx < plannedSeeds.length; planIdx++) {
    const { kind, mandatory } = plannedSeeds[planIdx];
    let best: Point | undefined;
    let bestScore = Infinity;
    let sawWaterCandidate = false;
    let blockedBySpacing = 0;

    for (const p of candidatePts) {
      const idx = id(p.x, p.y);
      if (kind === 'docks') {
        if (waterDist[idx] > 9) continue;
        sawWaterCandidate = true;
      }
      const minGap = spacing * (mandatory ? .86 : .94);
      if (districts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < (d.kind === kind ? minGap * 1.18 : minGap))) {
        blockedBySpacing++;
        continue;
      }
      const val = scoreSeed[kind](p.x, p.y, reach(p.x, p.y), idx)
        + affinityAdjustment(kind, p.x, p.y)
        + hash2(p.x, p.y, seed + kind.length * 131 + planIdx * 17) * .34;
      if (val < bestScore) {
        bestScore = val;
        best = p;
      }
    }

    // Стадия релаксации: если обязательный вид квартала ещё не представлен, ослабляем интервал.
    if (!best && (mandatory || !districts.some((d) => d.kind === kind)) && (kind !== 'docks' || sawWaterCandidate)) {
      const relaxedGap = Math.max(4, spacing * .48);
      for (const p of candidatePts) {
        const idx = id(p.x, p.y);
        if (kind === 'docks' && waterDist[idx] > 11) continue;
        if (districts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < relaxedGap)) continue;
        const val = scoreSeed[kind](p.x, p.y, reach(p.x, p.y), idx) + affinityAdjustment(kind, p.x, p.y);
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
        mandatory,
      });
    } else {
      const reason: DistrictPlacementFailureReason =
        kind === 'docks' && !sawWaterCandidate ? 'no_waterfront'
        : !candidatePts.length ? 'no_valid_land'
        : blockedBySpacing > 0 ? 'insufficient_spacing'
        : 'no_valid_land';
      const msg = reason === 'no_waterfront'
        ? `${DISTRICTS[kind].label}: нет судоходного берега вблизи застройки`
        : `${DISTRICTS[kind].label}: не хватило свободного пространства (${reason})`;
      failures.push({ kind, mandatory, reason, message: msg });
      if (mandatory) placementWarnings.push(msg);
      if (kind === 'docks' && !districts.some((d) => d.kind === 'docks') && !ctx.notes.includes('порт без причалов: нет воды рядом с застройкой')) {
        ctx.notes.push('порт без причалов: нет воды рядом с застройкой');
      }
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
    const passes = Math.max(w, h) >= 140 ? 4 : 2;
    for (let pass = 0; pass < passes; pass++) {
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

  const districtsByKind: Partial<Record<DistrictKind, number>> = {};
  let assignedArea = 0;
  for (const d of districts) {
    districtsByKind[d.kind] = (districtsByKind[d.kind] ?? 0) + 1;
    assignedArea += d.area;
  }
  const mandatoryPlanned = plannedSeeds.filter((s) => s.mandatory).length;
  const mandatoryPlaced = districts.filter((d) => d.mandatory).length;
  const optionalPlanned = plannedSeeds.length - mandatoryPlanned;
  const optionalPlaced = districts.length - mandatoryPlaced;
  const unassignedArea = Math.max(0, landCount - reservedLandCount - assignedArea);

  const diagnostics: DistrictPlacementDiagnostics = {
    plannedDistricts: plannedSeeds.length,
    placedDistricts: districts.length,
    omittedDistricts: Math.max(0, plannedSeeds.length - districts.length),
    mandatoryPlanned,
    mandatoryPlaced,
    optionalPlanned,
    optionalPlaced,
    districtsByKind,
    usableArea: landCount,
    reservedArea: reservedLandCount,
    assignedArea,
    unassignedArea,
    districtPlacementFailures: failures,
    placementWarnings,
  };

  return {
    districts,
    districtAt,
    blockAt,
    growthStageAt,
    blocks,
    alleyCount,
    diagnostics,
  };
}
