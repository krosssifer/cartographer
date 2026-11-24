import type { Building, Point, Selection } from '../../types';
import { N4, type UrbanDistrict, type UrbanLandmark } from './types';

export interface ActivityAttractor {
  x: number;
  y: number;
  weight: number;
  kind: 'gate' | 'market' | 'harbour' | 'tavern' | 'temple' | 'civic' | 'bridge' | 'craft' | 'residential';
}

export interface UrbanActivitySummary {
  attractors: number;
  intersections: number;
  deadEnds: number;
  meanStreetActivity: number;
  peakIntensity: number;
}

export interface UrbanActivityField {
  width: number;
  height: number;
  /** Суммарная интенсивность городской жизни в клетке (0..1). */
  intensity: Float32Array;
  /** Пешеходный и транспортный трафик вдоль дорожной сети (0..1). */
  pedestrianFlow: Float32Array;
  /** Коммерческое давление у фасадов (лавки, вывески, тенты) (0..1). */
  commercialPressure: Float32Array;
  /** Тишина/уединённость (жилые дворы, храмовые сады, окраины) (0..1). */
  quietness: Float32Array;
  /** Узлы пересечения улиц (3+ ветвей) — точки притяжения фонарей, указателей, колодцев. */
  intersections: Point[];
  /** Тупики и карманы переулков — точки притяжения хозяйственной поклажи, дров и мусора. */
  deadEnds: Point[];
  attractors: ActivityAttractor[];
  summary: UrbanActivitySummary;
}

export interface ComputeActivityInput {
  width: number;
  height: number;
  streets: Uint8Array;
  streetLevel: Uint8Array;
  districts: readonly UrbanDistrict[];
  districtAt: Int16Array;
  buildings: readonly Building[];
  landmarks: readonly UrbanLandmark[];
  gatePoints: readonly Point[];
  plaza?: Selection;
  marketArea?: Uint8Array;
  riverQuayPoints?: readonly Point[];
}

/**
 * Честная графовая модель городской активности (ActivityField):
 * распространяет трафик от ворот, рынка, порта, таверн, храмов, мостов, мастерских
 * и жилых кварталов вдоль реального графа улиц с учётом иерархии дорог (streetLevel 1..3),
 * выделяет перекрёстки и тупики и формирует поля пешеходного потока, коммерции и тишины.
 */
export function computeUrbanActivityField(input: ComputeActivityInput): UrbanActivityField {
  const {
    width: w,
    height: h,
    streets,
    streetLevel,
    districts,
    districtAt,
    buildings,
    landmarks,
    gatePoints,
    plaza,
    marketArea,
    riverQuayPoints = [],
  } = input;

  const size = w * h;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;

  const attractors: ActivityAttractor[] = [];
  const pushAttractor = (x: number, y: number, weight: number, kind: ActivityAttractor['kind']) => {
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
    attractors.push({ x: cx, y: cy, weight, kind });
  };

  for (const gp of gatePoints) pushAttractor(gp.x, gp.y, 1.0, 'gate');
  if (plaza) {
    pushAttractor(plaza.x + plaza.w * 0.5, plaza.y + plaza.h * 0.5, 1.25, 'market');
  }
  for (let i = 0; i < riverQuayPoints.length; i += Math.max(1, Math.floor(riverQuayPoints.length / 6))) {
    const qp = riverQuayPoints[i];
    pushAttractor(qp.x, qp.y, 0.9, 'harbour');
  }

  for (const lm of landmarks) {
    if (lm.kind === 'tavern') pushAttractor(lm.x, lm.y, 1.05, 'tavern');
    else if (lm.kind === 'main_temple' || lm.kind === 'minor_temple') pushAttractor(lm.x, lm.y, 0.85, 'temple');
    else if (lm.kind === 'gate') pushAttractor(lm.x, lm.y, 0.95, 'gate');
    else if (lm.kind === 'warehouse') pushAttractor(lm.x, lm.y, 0.92, 'harbour');
    else if (lm.kind === 'smithy') pushAttractor(lm.x, lm.y, 0.78, 'craft');
    else if (lm.kind === 'town_hall' || lm.kind === 'citadel' || lm.kind === 'barracks' || lm.kind === 'plaza') {
      pushAttractor(lm.x, lm.y, 0.88, 'civic');
    }
  }

  // Выборка зданий: лавки и таверны генерируют коммерческий поток, жилые дома — базовый бытовой трафик.
  const stepB = Math.max(1, Math.floor(buildings.length / 48));
  for (let i = 0; i < buildings.length; i += stepB) {
    const b = buildings[i];
    if (b.kind === 'tavern') pushAttractor(b.door.x, b.door.y, 0.95, 'tavern');
    else if (b.kind === 'shop') pushAttractor(b.door.x, b.door.y, 0.8, 'craft');
    else if (b.kind === 'hall') pushAttractor(b.door.x, b.door.y, 0.75, 'civic');
    else pushAttractor(b.door.x, b.door.y, 0.42, 'residential');
  }

  // 1. Выделение перекрёстков и тупиков по графу улиц.
  // Чтобы широкие улицы (2 кл.) не давали ложные 4-связные квадраты, проверяем осевые переходы.
  const intersections: Point[] = [];
  const deadEnds: Point[] = [];
  const intersectionMask = new Uint8Array(size);

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const c = id(x, y);
      if (!streets[c]) continue;
      if (marketArea?.[c]) continue;
      let degree = 0;
      for (const [dx, dy] of N4) {
        if (streets[id(x + dx, y + dy)]) degree += 1;
      }
      if (degree === 1) {
        deadEnds.push({ x, y });
      } else if (degree >= 3) {
        // Не дублируем соседние клетки одного перекрёстка в радиусе 3 кл.
        let nearExisting = false;
        for (let dy = -3; dy <= 3 && !nearExisting; dy += 1) {
          for (let dx = -3; dx <= 3; dx += 1) {
            if (inside(x + dx, y + dy) && intersectionMask[id(x + dx, y + dy)]) {
              nearExisting = true;
              break;
            }
          }
        }
        if (!nearExisting) {
          intersectionMask[c] = 1;
          intersections.push({ x, y });
        }
      }
    }
  }

  // 2. Распространение активности по графу улиц (многоисточниковая диффузия с затуханием по уровню улицы).
  const pedestrianFlow = new Float32Array(size);
  const commercialPressure = new Float32Array(size);

  // Привязываем каждый аттрактор к ближайшей уличной клетке в радиусе 4.
  const seedStreetCell = (ax: number, ay: number): number => {
    if (streets[id(ax, ay)]) return id(ax, ay);
    for (let r = 1; r <= 4; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const nx = ax + dx;
          const ny = ay + dy;
          if (inside(nx, ny) && streets[id(nx, ny)]) return id(nx, ny);
        }
      }
    }
    return id(ax, ay);
  };

  // Bucketed Dijkstra от коммерческих/транзитных узлов и всех аттракторов:
  const maxCost = 480;
  const runGraphDecay = (
    filterFn: (a: ActivityAttractor) => number,
    decayScale: number,
    target: Float32Array,
  ) => {
    const bestCost = new Int32Array(size).fill(maxCost + 1);
    const sourceWeight = new Float32Array(size);
    const buckets: number[][] = Array.from({ length: maxCost + 2 }, () => []);

    for (const a of attractors) {
      const wgt = filterFn(a);
      if (wgt <= 0) continue;
      const start = seedStreetCell(a.x, a.y);
      bestCost[start] = 0;
      if (wgt > sourceWeight[start]) sourceWeight[start] = wgt;
      buckets[0].push(start);
    }

    if (marketArea) {
      for (let i = 0; i < size; i += 3) {
        if (!marketArea[i]) continue;
        bestCost[i] = 0;
        sourceWeight[i] = Math.max(sourceWeight[i], 1.15);
        buckets[0].push(i);
      }
    }

    for (let cost = 0; cost <= maxCost; cost += 1) {
      const bucket = buckets[cost];
      for (let k = 0; k < bucket.length; k += 1) {
        const cur = bucket[k];
        if (cost > bestCost[cur]) continue;
        const sw = sourceWeight[cur];
        const val = sw * Math.exp(-cost / decayScale);
        if (val > target[cur]) target[cur] = val;

        const cx = cur % w;
        const cy = (cur - cx) / w;
        for (const [dx, dy] of N4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inside(nx, ny)) continue;
          const ni = id(nx, ny);
          // По улицам трафик течёт легко (особенно по главным артериям level=1),
          // через прилегающие дворы/фасады — затухает в 5–7 раз быстрее.
          let step = 48;
          if (streets[ni]) {
            const lvl = streetLevel[ni] || 2;
            step = lvl === 1 ? 8 : lvl === 2 ? 12 : 18;
          }
          const nextCost = cost + step;
          if (nextCost <= maxCost && (nextCost < bestCost[ni] || sw * 0.96 > sourceWeight[ni] && nextCost <= bestCost[ni] + 8)) {
            if (nextCost < bestCost[ni]) bestCost[ni] = nextCost;
            if (sw > sourceWeight[ni]) sourceWeight[ni] = sw;
            buckets[nextCost].push(ni);
          }
        }
      }
    }
  };

  runGraphDecay((a) => a.weight, 190, pedestrianFlow);
  runGraphDecay(
    (a) => (a.kind === 'market' || a.kind === 'tavern' || a.kind === 'harbour' || a.kind === 'craft' || a.kind === 'gate' ? a.weight : 0),
    135,
    commercialPressure,
  );

  // Бонус перекрёсткам (естественные узлы концентрации пешеходов).
  for (const pt of intersections) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (!inside(pt.x + dx, pt.y + dy)) continue;
        const ci = id(pt.x + dx, pt.y + dy);
        const boost = 0.16 * Math.max(0, 1 - Math.hypot(dx, dy) / 3);
        pedestrianFlow[ci] = Math.min(1.25, pedestrianFlow[ci] + boost);
      }
    }
  }

  const intensity = new Float32Array(size);
  const quietness = new Float32Array(size);
  let streetSum = 0;
  let streetCount = 0;
  let peakIntensity = 0;

  for (let i = 0; i < size; i += 1) {
    const dIdx = districtAt[i];
    const dKind = dIdx >= 0 && districts[dIdx] ? districts[dIdx].kind : 'residential';
    const districtBias =
      dKind === 'market' || dKind === 'centre'
        ? 0.16
        : dKind === 'docks' || dKind === 'craft'
          ? 0.10
          : dKind === 'noble' || dKind === 'temple' || dKind === 'farms'
            ? -0.06
            : 0;

    const pf = Math.min(1, pedestrianFlow[i]);
    const cp = Math.min(1, commercialPressure[i]);
    pedestrianFlow[i] = pf;
    commercialPressure[i] = cp;

    const act = Math.max(0, Math.min(1, pf * 0.62 + cp * 0.38 + districtBias));
    intensity[i] = act;
    quietness[i] = Math.max(
      0,
      Math.min(
        1,
        (1 - act) * (dKind === 'noble' || dKind === 'temple' || dKind === 'residential' || dKind === 'farms' ? 1 : 0.72),
      ),
    );
    if (act > peakIntensity) peakIntensity = act;
    if (streets[i]) {
      streetSum += act;
      streetCount += 1;
    }
  }

  return {
    width: w,
    height: h,
    intensity,
    pedestrianFlow,
    commercialPressure,
    quietness,
    intersections,
    deadEnds,
    attractors,
    summary: {
      attractors: attractors.length,
      intersections: intersections.length,
      deadEnds: deadEnds.length,
      meanStreetActivity: streetCount > 0 ? Math.round((streetSum / streetCount) * 1000) / 1000 : 0,
      peakIntensity: Math.round(peakIntensity * 1000) / 1000,
    },
  };
}
