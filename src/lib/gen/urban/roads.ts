import { hash2 } from '../../random';
import { modernMarket, type MarketResolution } from '../marketArchetypes';
import { resolveMarketSite, type MarketSite } from '../marketLayout';
import type { Cell, GenSettings, Point, Selection, Terrain } from '../../types';
import { rayToEdge, type UrbanSkeleton } from './nodes';
import {
  N4,
  N8,
  between,
  waterOnly,
  wet,
  type UrbanContext,
  type UrbanLane,
  type UrbanRoadLevel,
  type UrbanRouteEdge,
} from './types';

export interface RoadStroke {
  points: Point[];
  radius: number;
  surface: Terrain;
  level: UrbanRoadLevel;
  canCrossWallWater: boolean;
  reason: string;
}

export interface UrbanRoadResult {
  streets: Uint8Array;
  streetLevel: Uint8Array;
  lanes: UrbanLane[];
  edges: UrbanRouteEdge[];
  gates: Set<number>;
  gatePoints: Point[];
  towers: Point[];
  bridges: number;
  plaza?: Selection;
  plazaOk: boolean;
  subPlazas: Selection[];
  marketResolution?: MarketResolution;
  marketSite?: MarketSite;
  marketPrepaint: { i: number; terrain: Terrain }[];
  ringLaneIndex: number;
  quayPoints: Point[];
  riverQuayPoints: Point[];
  paintCell: (x: number, y: number, surface: Terrain, level: UrbanRoadLevel, cross: boolean) => boolean;
  drawStroke: (stroke: RoadStroke) => void;
}

export function buildUrbanRoadNetwork(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  s: GenSettings,
): UrbanRoadResult {
  const { width: w, height: h, seed, type, layout, character, town, small, tight, geo } = ctx;
  const { cells, slope, geography, span, length, at, crossingCandidates } = geo;
  const { origin, center, RX, RY, reach, walls, keepBox, keepFree, paradeBox, entryAngles, reserved } = skel;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const terrain = (x: number, y: number) => cells[y][x].terrain;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(terrain(x, y)) && terrain(x, y) !== 'rock' && terrain(x, y) !== 'wall';

  const streets = new Uint8Array(w * h);
  const streetLevel = new Uint8Array(w * h);
  const lanes: UrbanLane[] = [];
  const edges: UrbanRouteEdge[] = [];
  const gates = new Set<number>();
  let bridges = 0;

  // ---- 1. Выбор площадки центрального рынка/площади ДО прокладки улиц ------
  const plazaScale = character.id === 'trade' || character.id === 'religious' ? 1.12 : 1;
  const plazaSize = type.plaza === 'large'
    ? { w: between(Math.floor(w * .2 * plazaScale), tight ? 6 : 8, 14), h: between(Math.floor(h * .22 * plazaScale), tight ? 5 : 6, 10) }
    : type.plaza === 'small'
    ? { w: between(Math.floor(w * .14 * plazaScale), 5, 9), h: between(Math.floor(h * .15 * plazaScale), 4, 7) }
    : undefined;

  // В порту рынок тяготеет к цепочке: порт → набережная → рынок → центр.
  const marketAnchor = geography === 'coast'
    ? { x: Math.round((origin.x * .55 + center.x * .45)), y: Math.round((origin.y * .55 + center.y * .45)) }
    : center;

  const placedMarket = plazaSize && s.publicSpaces && !keepFree && modernMarket(s.marketArchetype)
    ? resolveMarketSite(
        s.marketArchetype,
        {
          style: type.style,
          settlementType: type.id,
          water: geography === 'coast' ? 'coast' : geo.river.length ? 'river' : 'none',
          width: w,
          height: h,
          seed,
        },
        {
          width: w,
          height: h,
          cells,
          anchor: marketAnchor,
          scale: type.plaza === 'small' ? .82 : 1,
          blocked: (x, y) => reserved[id(x, y)] === 1 || (walls.walled && walls.wallAt(walls.wallRings[0], x, y) > .84),
        },
      )
    : undefined;

  const marketResolution = placedMarket?.resolution;
  const marketSite = placedMarket?.site;
  if (marketResolution && !marketSite) {
    ctx.notes.push('рынок не поместился на ровной сухой земле: прежняя площадь');
  }

  const plaza: Selection | undefined = marketSite
    ? { ...marketSite.bounds }
    : plazaSize && s.publicSpaces && !keepFree
    ? {
        x: between(center.x - Math.floor(plazaSize.w / 2), 2, w - plazaSize.w - 2),
        y: between(center.y - Math.floor(plazaSize.h / 2), 2, h - plazaSize.h - 2),
        w: plazaSize.w,
        h: plazaSize.h,
      }
    : undefined;

  const plazaOk = Boolean(plaza && (marketSite ? true : (() => {
    let dry = 0;
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) {
      for (let x = plaza.x; x < plaza.x + plaza.w; x++) if (usable(x, y)) dry++;
    }
    return dry >= plaza.w * plaza.h * .85;
  })()));
  if (plaza && !plazaOk) ctx.notes.push('площадь не поместилась на сухой земле');

  if (plaza && plazaOk) {
    skel.nodes.push({
      id: 'plaza',
      kind: marketSite ? 'market' : 'plaza',
      x: plaza.x + Math.floor(plaza.w / 2),
      y: plaza.y + Math.floor(plaza.h / 2),
      priority: 10,
      label: marketSite ? 'Рыночная площадь' : 'Главная площадь',
    });
    skel.reservations.push({
      id: 'res_plaza',
      kind: 'market_plaza',
      bounds: { ...plaza },
      cells: plaza.w * plaza.h,
    });
  }

  // ---- 2. Функции покраски улиц с учётом иерархии --------------------------
  function paintCell(x: number, y: number, surface: Terrain, level: UrbanRoadLevel, cross: boolean): boolean {
    if (!inside(x, y) || (keepFree && reserved[id(x, y)])) return false;
    const t = terrain(x, y);
    if (t === 'rock') return false;
    // Избегаем заливки крутых уступов второстепенными улочками.
    if (!cross && level >= 3 && slope[id(x, y)] > .24) return false;
    if (t === 'wall') {
      if (!cross) return false;
      gates.add(id(x, y));
    }
    if (wet(t)) {
      if (!cross) return false;
      if (t !== 'bridge') bridges++;
      cells[y][x].terrain = 'bridge';
    } else if (t !== 'plaza' || surface === 'plaza') {
      cells[y][x].terrain = surface;
    }
    const idx = id(x, y);
    streets[idx] = 1;
    if (streetLevel[idx] === 0 || level < streetLevel[idx]) {
      streetLevel[idx] = level;
    }
    return true;
  }

  function drawStroke({ points, radius, surface, level, canCrossWallWater, reason }: RoadStroke): void {
    if (points.length < 2) return;
    const centreline: Point[] = [];
    const record = (x: number, y: number) => {
      const cx = Math.round(x), cy = Math.round(y);
      const last = centreline[centreline.length - 1];
      if (!inside(cx, cy) || (last && last.x === cx && last.y === cy)) return;
      centreline.push({ x: cx, y: cy });
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[Math.max(0, i - 2)];
      const b = points[i - 1];
      const c = points[i];
      const d = points[Math.min(points.length - 1, i + 1)];
      const samples = Math.max(4, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) * 3));
      const curve = (p: number, q: number, r: number, z: number, t: number) =>
        .5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - z) * t * t + (3 * q - p - 3 * r + z) * t * t * t);
      for (let j = 0; j <= samples; j++) {
        const t = j / samples;
        const x = curve(a.x, b.x, c.x, d.x, t);
        const y = curve(a.y, b.y, c.y, d.y, t);
        let painted = false;
        if (radius <= 0.55) {
          // Узкий переулок (1 клетка): красим строго центральную клетку с 4-связным шагом.
          const cx = Math.round(x), cy = Math.round(y);
          const prev = centreline[centreline.length - 1];
          if (prev && Math.abs(cx - prev.x) === 1 && Math.abs(cy - prev.y) === 1) {
            paintCell(cx, prev.y, surface, level, canCrossWallWater);
          }
          if (paintCell(cx, cy, surface, level, canCrossWallWater)) painted = true;
        } else {
          for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) {
            for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) {
              if (Math.hypot(x - xx, y - yy) <= radius && paintCell(xx, yy, surface, level, canCrossWallWater)) {
                painted = true;
              }
            }
          }
        }
        if (painted) record(x, y);
      }
    }
    if (centreline.length >= 2) {
      lanes.push({
        points: centreline,
        width: radius <= 0.55 ? 1 : Math.max(1, Math.round(radius * 2)),
        surface: surface === 'plaza' ? 'plaza' : 'road',
        level,
        reason,
      });
    }
  }

  // ---- 3. Геометрический маршрутизатор: изгиб из-за рельефа, воды и узлов --
  function terrainBend(a: Point, b: Point, baseCurve: number, salt: number, respectBridge = true): Point[] {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 5) return [a, b];

    // Если отрезок пересекает реку, направляем его через ближайшую удобную переправу!
    if (respectBridge && crossingCandidates.length) {
      const mx = Math.round((a.x + b.x) / 2), my = Math.round((a.y + b.y) / 2);
      const qx = Math.round(a.x * .3 + b.x * .7), qy = Math.round(a.y * .3 + b.y * .7);
      const crossesRiver = (inside(mx, my) && waterOnly(terrain(mx, my)))
        || (inside(qx, qy) && waterOnly(terrain(qx, qy)));
      if (crossesRiver) {
        const bestBridge = crossingCandidates.reduce((best, p) =>
          Math.hypot(p.x - mx, p.y - my) < Math.hypot(best.x - mx, best.y - my) ? p : best,
        crossingCandidates[0]);
        if (Math.hypot(bestBridge.x - mx, bestBridge.y - my) < Math.min(w, h) * .35) {
          return [a, bestBridge, b];
        }
      }
    }

    const steps = dist > 22 ? 2 : 1;
    const pts: Point[] = [a];
    const nx = -(b.y - a.y) / dist;
    const ny = (b.x - a.x) / dist;

    for (let k = 1; k <= steps; k++) {
      const t = k / (steps + 1);
      const bx = a.x + (b.x - a.x) * t;
      const by = a.y + (b.y - a.y) * t;

      // Ищем смещение вдоль нормали с минимальным уклоном и вдали от скал/воды.
      const organicJitter = (hash2(Math.round(a.x * 3 + k), Math.round(b.y * 3 + salt), seed + salt) - .5)
        * baseCurve * (1.15 - character.regularity * .75) * dist;

      let bestOff = organicJitter;
      let bestCost = Infinity;
      const maxSearch = Math.min(6, Math.max(2, dist * .18));
      for (const delta of [0, -2, 2, -4, 4]) {
        const candOff = between(organicJitter + delta, -maxSearch, maxSearch);
        const px = Math.round(bx + nx * candOff);
        const py = Math.round(by + ny * candOff);
        if (!inside(px, py)) continue;
        const tr = terrain(px, py);
        const obstaclePenalty = tr === 'rock' ? 20 : waterOnly(tr) ? 8 : 0;
        const slopePenalty = slope[id(px, py)] * 16;
        const keepPenalty = keepBox && keepFree
          && px >= keepBox.x - 1 && px <= keepBox.x + keepBox.w
          && py >= keepBox.y - 1 && py <= keepBox.y + keepBox.h ? 25 : 0;
        const devPenalty = Math.abs(delta) * .28;
        const cost = obstaclePenalty + slopePenalty + keepPenalty + devPenalty;
        if (cost < bestCost) {
          bestCost = cost;
          bestOff = candOff;
        }
      }
      pts.push({ x: bx + nx * bestOff, y: by + ny * bestOff });
    }
    pts.push(b);
    return pts;
  }

  // ---- 4. Построение иерархии улиц по схеме планировки ---------------------
  const mainSurface: Terrain = town ? 'plaza' : 'road';
  const R = type.street * character.streetScale * (tight ? .76 : 1);
  const rArterial = between(R * 1.06, .62, 1.35);
  const rPrimary = between(R * .86, .56, 1.05);
  const rDistrict = between(R * .68, .5, .86);

  const strokes: RoadStroke[] = [];
  const hub = plaza && plazaOk
    ? { x: plaza.x + Math.floor(plaza.w / 2), y: plaza.y + Math.floor(plaza.h / 2) }
    : center;

  const axisAlongEdge = geography !== 'plain';
  const horizontal = axisAlongEdge ? geo.side <= 1 : w >= h;
  const edgeReach = Math.max(w / RX, h / RY) * 1.05;

  const ellipseRing = (k: number, jitter: number, salt: number): Point[] => {
    const n = 16;
    const effJitter = jitter * (1.2 - character.regularity * .7);
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = k * (1 + (hash2(i, salt, seed + 0x2a) - .5) * effJitter);
      return { x: center.x + Math.cos(a) * RX * r, y: center.y + Math.sin(a) * RY * r };
    });
    return [...pts, pts[0], pts[1]];
  };

  // Слегка отклонённая историческая сетка (не идеально математическая: ±3..6° + разрывы).
  const gridSkew = layout === 'grid' || layout === 'mixed'
    ? (hash2(seed, 14, 0x91d) - .5) * .11 * (1.15 - character.regularity * .6)
    : 0;
  const cosS = Math.cos(gridSkew), sinS = Math.sin(gridSkew);
  const gridPoint = (alongU: number, acrossV: number): Point => {
    const lx = horizontal ? alongU * RX : acrossV * RX;
    const ly = horizontal ? acrossV * RY : alongU * RY;
    return {
      x: center.x + lx * cosS - ly * sinS,
      y: center.y + lx * sinS + ly * cosS,
    };
  };

  const axisLine = (offset: number, fromU: number, toU: number, wobble: number, salt: number): Point[] => {
    const pts: Point[] = [];
    const n = 6;
    const effWobble = wobble * (1.2 - character.regularity * .75);
    for (let i = 0; i <= n; i++) {
      const u = fromU + ((toU - fromU) * i) / n;
      const v = offset + (hash2(i, salt, seed + 0x3b) - .5) * effWobble;
      const base = gridPoint(u, v);
      // На горном склоне слегка подстраиваем линию вдоль горизонтали.
      if (geography === 'mountain' && inside(Math.round(base.x), Math.round(base.y))) {
        pts.push(base);
      } else {
        pts.push(base);
      }
    }
    return pts;
  };

  const crossLine = (atU: number, fromV: number, toV: number, wobble: number, salt: number): Point[] => {
    const pts: Point[] = [];
    const n = 4;
    const effWobble = wobble * (1.2 - character.regularity * .75);
    for (let i = 0; i <= n; i++) {
      const v = fromV + ((toV - fromV) * i) / n;
      const u = atU + (hash2(i, salt, seed + 0x4c) - .5) * effWobble;
      pts.push(gridPoint(u, v));
    }
    return pts;
  };

  const buildGridStreets = (coreHole: number) => {
    // Уровень 1 (PRIMARY ROAD): две главные исторические оси (Cardo и Decumanus), связывающие ворота, ядро и площадь.
    strokes.push({
      points: axisLine(0, -edgeReach, edgeReach, .045, 1),
      radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true, reason: 'главная продольная магистраль',
    });
    strokes.push({
      points: crossLine(0, -edgeReach, edgeReach, .045, 2),
      radius: rArterial * .94, surface: mainSurface, level: 1, canCrossWallWater: true, reason: 'главная поперечная магистраль',
    });

    // Шаг кварталов компактнее в ядре и просторнее к окраинам; внутри стен не прижимаем улицы вплотную к стене!
    const alongRadius = horizontal ? RX : RY;
    const acrossRadius = horizontal ? RY : RX;
    const baseAlong = (town ? 8.2 : 9.8) / alongRadius;
    const baseAcross = (town ? 7.6 : 9.2) / acrossRadius;
    const maxGridCursor = walls.walled ? .74 : .90;

    for (const sign of [-1, 1]) {
      let cursor = 0;
      for (let k = 1; k <= 14; k++) {
        cursor += baseAcross * (.84 + Math.min(k, 4) * .10 + (hash2(k, sign + 5, seed + 0x61) - .5) * .16);
        if (cursor >= maxGridCursor) break;
        const o = sign * cursor;
        if (Math.abs(o) < coreHole) continue;
        const ext = Math.sqrt(Math.max(.12, .92 - o * o * .92));
        const modeRoll = hash2(k, 11, seed + 0x72 + sign * 3);
        const lvl: UrbanRoadLevel = k <= 2 ? 2 : 3;
        if (k >= 2 && modeRoll < .38) {
          // Т-образное соединение: улица идёт только в одном полушарии от главной оси!
          const leftHalf = hash2(k, 12, seed + 0x73 + sign) > .5;
          strokes.push({
            points: axisLine(o, leftHalf ? -ext : 0, leftHalf ? 0 : ext, .04, 10 + k * sign),
            radius: lvl === 2 ? rPrimary : rDistrict * .88,
            surface: 'road',
            level: lvl,
            canCrossWallWater: false,
            reason: 'Т-образная районная улица',
          });
        } else if (k >= 2 && modeRoll < .68) {
          // Смещённый перекрёсток (staggered T-junctions через главную улицу) — ломает монотонную сетку!
          const shift = sign * baseAcross * .22;
          strokes.push({
            points: axisLine(o, -ext * .9, 0, .04, 14 + k * sign),
            radius: rDistrict, surface: 'road', level: lvl, canCrossWallWater: false, reason: 'смещённая улица сетки',
          });
          strokes.push({
            points: axisLine(o + shift, 0, ext * .88, .04, 18 + k * sign),
            radius: rDistrict, surface: 'road', level: lvl, canCrossWallWater: false, reason: 'смещённое продолжение улицы',
          });
        } else {
          strokes.push({
            points: axisLine(o, -ext, ext, .038, 10 + k * sign),
            radius: lvl === 2 ? rPrimary : rDistrict,
            surface: lvl === 2 && town && character.id === 'noble' ? 'plaza' : 'road',
            level: lvl,
            canCrossWallWater: false,
            reason: lvl === 2 ? 'районная улица' : 'квартальная улочка',
          });
        }
      }
    }

    for (const sign of [-1, 1]) {
      let cursor = 0;
      for (let k = 1; k <= 14; k++) {
        cursor += baseAlong * (.84 + Math.min(k, 4) * .10 + (hash2(k, sign + 9, seed + 0x63) - .5) * .18);
        if (cursor >= maxGridCursor) break;
        const o = sign * cursor;
        if (Math.abs(o) < coreHole) continue;
        const ext = Math.sqrt(Math.max(.12, .92 - o * o * .92));
        const modeRoll = hash2(k, 3, seed + 0x74 + sign * 5);
        const lvl: UrbanRoadLevel = k <= 2 ? 2 : 3;
        if (k >= 2 && modeRoll < .42) {
          // Т-образная поперечная улица или короткий тупик вглубь квартала.
          const topHalf = hash2(k, 19, seed + 0x75 + sign) > .5;
          const spanEnd = modeRoll < .18 ? ext * .55 : ext;
          strokes.push({
            points: crossLine(o, topHalf ? -spanEnd : 0, topHalf ? 0 : spanEnd, .04, 30 + k * sign),
            radius: modeRoll < .18 ? .5 : rDistrict,
            surface: 'road',
            level: modeRoll < .18 ? 3 : lvl,
            canCrossWallWater: false,
            reason: modeRoll < .18 ? 'тупиковый переулок' : 'Т-образная поперечная улица',
          });
        } else if (k >= 2 && modeRoll < .72) {
          // Смещённый разрыв с изломом вокруг квартала.
          strokes.push({
            points: crossLine(o, -ext, 0, .038, 30 + k * sign),
            radius: rDistrict, surface: 'road', level: lvl, canCrossWallWater: false, reason: 'поперечная улица со смещением',
          });
          strokes.push({
            points: crossLine(o + sign * baseAlong * .22, 0, ext * .9, .038, 50 + k * sign),
            radius: rDistrict, surface: 'road', level: lvl, canCrossWallWater: false, reason: 'продолжение поперечной улицы',
          });
        } else {
          strokes.push({
            points: crossLine(o, -ext, ext, .038, 30 + k * sign),
            radius: lvl === 2 ? rPrimary : rDistrict, surface: 'road', level: lvl, canCrossWallWater: false,
            reason: 'поперечная районная улица',
          });
        }
      }
    }

    // В старом ядре — изогнутое историческое полукольцо и косой дорегулярный тракт,
    // чтобы центр города отличался геометрией от внешних регулярных кварталов!
    if (!small && character.regularity < .78 && coreHole === 0) {
      const coreArc = ellipseRing(.28, .22, 17).slice(0, 10);
      strokes.push({
        points: coreArc, radius: .54, surface: 'road', level: 3, canCrossWallWater: false,
        reason: 'узкая дуга старого ядра',
      });
    }
    if (!small && character.coreShare > .28 && coreHole === 0) {
      const diagAngle = entryAngles[0] ?? .55;
      const diagEnd = {
        x: center.x + Math.cos(diagAngle) * RX * .82,
        y: center.y + Math.sin(diagAngle) * RY * .82,
      };
      strokes.push({
        points: terrainBend(origin, diagEnd, .16, 88),
        radius: rPrimary, surface: mainSurface, level: 2, canCrossWallWater: false, reason: 'старый дорегулярный тракт',
      });
    }
  };

  const buildOrganicWeb = (radiusScale: number, baseNodeBudget: number, withExits: boolean) => {
    // Направленный органический рост от точки основания (origin) и центра (center) вдоль рельефа.
    // На крупных картах (Large/Epic) число узлов растёт пропорционально корню площади ядра,
    // чтобы кварталы оставались человеческого средневекового масштаба, а не растягивались.
    const scaleFactor = Math.max(1, Math.sqrt((RX * RY * radiusScale * radiusScale) / (34 * 26)));
    const nodeBudget = Math.min(44, Math.round(baseNodeBudget * scaleFactor));
    const growthAxis = entryAngles[0] ?? 0;
    const nodes: Point[] = [{ ...hub }];
    if (Math.hypot(origin.x - hub.x, origin.y - hub.y) >= 4) nodes.push({ ...origin });

    const baseCellSpacing = between(Math.min(RX, RY) * radiusScale * .28, 7.5, 13.5);
    for (let attempt = 0; attempt < nodeBudget * 32 && nodes.length < nodeBudget + 1; attempt++) {
      const dirBias = (hash2(attempt, 4, seed + 0x5d) - .5) * 1.6;
      const a = hash2(attempt, 1, seed + 0x5d) < .45
        ? growthAxis + dirBias
        : hash2(attempt, 1, seed + 0x5d) * Math.PI * 2;
      const r = Math.pow(hash2(attempt, 2, seed + 0x5d), .62) * radiusScale;
      const p = { x: center.x + Math.cos(a) * RX * r, y: center.y + Math.sin(a) * RY * r };
      const rx = Math.round(p.x), ry = Math.round(p.y);
      if (!inside(rx, ry) || !usable(rx, ry) || slope[id(rx, ry)] > .2) continue;
      const localCellSpacing = baseCellSpacing * (r < .45 ? .82 : 1.04);
      if (nodes.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < localCellSpacing)) continue;
      nodes.push(p);
    }

    // Остов направленного роста (учитывает не только длину, но и перепад высот!).
    const linked = [0];
    const rest = nodes.map((_, i) => i).slice(1);
    const treeEdges: [number, number, number][] = []; // [from, to, depth]
    const nodeDepth = new Uint8Array(nodes.length);

    while (rest.length) {
      let best: [number, number, number] | undefined;
      for (const a of linked) {
        for (const b of rest) {
          const geomD = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          const dh = Math.abs(
            cells[Math.round(nodes[a].y)][Math.round(nodes[a].x)].height
            - cells[Math.round(nodes[b].y)][Math.round(nodes[b].x)].height,
          );
          const cost = geomD * (1 + dh * 3.2) + nodeDepth[a] * 1.4;
          if (!best || cost < best[2]) best = [a, b, cost];
        }
      }
      if (!best) break;
      nodeDepth[best[1]] = nodeDepth[best[0]] + 1;
      treeEdges.push([best[0], best[1], nodeDepth[best[1]]]);
      linked.push(best[1]);
      rest.splice(rest.indexOf(best[1]), 1);
    }

    // Короткие поперечные замыкания кварталов (чтобы не было дерева одних тупиков).
    for (let i = 1; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (
          d < Math.min(RX, RY) * radiusScale * .52
          && hash2(i, j, seed + 0x6e) < .34
          && !treeEdges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))
        ) {
          treeEdges.push([i, j, Math.max(nodeDepth[i], nodeDepth[j]) + 1]);
        }
      }
    }

    treeEdges.forEach(([a, b, depth], index) => {
      const lvl: UrbanRoadLevel = depth <= 1 ? 2 : 3;
      strokes.push({
        points: terrainBend(nodes[a], nodes[b], .24, 70 + index, false),
        radius: lvl === 2 ? rPrimary : rDistrict,
        surface: lvl === 2 && town && depth === 1 ? mainSurface : 'road',
        level: lvl,
        canCrossWallWater: false,
        reason: lvl === 2 ? 'главная органическая улица' : 'органическая улочка квартала',
      });
    });

    if (withExits) {
      entryAngles.forEach((angle, idx) => {
        const end = rayToEdge(hub, angle, w, h);
        const pts = terrainBend(hub, end, .15, 190 + idx, true);
        strokes.push({
          points: pts, radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true,
          reason: 'главный въездной тракт',
        });
        edges.push({ from: 'center', to: `gate_${idx}`, level: 1, points: pts });
      });
    }
  };

  if (s.road || layout !== 'linear') {
    switch (layout) {
      case 'radial': {
        // Уровень 1: главные радиальные тракты к воротам/краям.
        entryAngles.forEach((angle, idx) => {
          const end = rayToEdge(hub, angle, w, h);
          const pts = terrainBend(hub, end, .12, 100 + idx, true);
          strokes.push({
            points: pts, radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true,
            reason: 'главный радиальный тракт',
          });
          edges.push({ from: 'center', to: `gate_${idx}`, level: 1, points: pts });
        });
        // Уровень 2: вторичные радиальные лучи между главными (масштабируются на Large/Epic).
        const minR = Math.min(RX, RY);
        const extraSpokes = minR >= 44 ? (town ? 6 : 4) : minR >= 32 ? (town ? 4 : 3) : (town ? 3 : 2);
        for (let i = 0; i < extraSpokes; i++) {
          const baseA = entryAngles[i % entryAngles.length] ?? 0;
          const nextA = entryAngles[(i + 1) % entryAngles.length] ?? (baseA + Math.PI * .7);
          const frac = extraSpokes > entryAngles.length && i >= entryAngles.length ? .34 : .5;
          const midA = baseA + ((nextA - baseA + Math.PI * 2) % (Math.PI * 2)) * frac
            + (hash2(i, 7, seed + 0x91) - .5) * .2;
          const stopR = walls.walled ? .86 : .96;
          const end = { x: center.x + Math.cos(midA) * RX * stopR, y: center.y + Math.sin(midA) * RY * stopR };
          strokes.push({
            points: terrainBend(hub, end, .14, 130 + i, false),
            radius: rPrimary, surface: 'road', level: 2, canCrossWallWater: false,
            reason: 'вторичный луч',
          });
        }
        // Уровень 3: дуговые и кольцевые связки разных радиусов между лучами.
        strokes.push({
          points: ellipseRing(minR >= 42 ? .38 : .46, .14, 1), radius: rPrimary * .9, surface: 'road', level: 2, canCrossWallWater: false,
          reason: 'внутреннее кольцо старого города',
        });
        if (town && minR >= 42) {
          strokes.push({
            points: ellipseRing(.61, .11, 5), radius: rDistrict, surface: 'road', level: 2, canCrossWallWater: false,
            reason: 'среднее бульварное кольцо',
          });
        }
        if (town && !small) {
          strokes.push({
            points: ellipseRing(walls.walled ? .78 : .82, .1, 2),
            radius: rDistrict, surface: 'road', level: 3, canCrossWallWater: false,
            reason: 'внешняя поясная улица',
          });
        }
        break;
      }

      case 'ring': {
        // Уровень 1: транзитные оси через ворота.
        const ringAngles = entryAngles.length >= 3 ? entryAngles : [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a, i) => a + (hash2(i, 3, seed + 0x92) - .5) * .3);
        ringAngles.forEach((angle, idx) => {
          const end = rayToEdge(hub, angle, w, h);
          const pts = terrainBend(hub, end, .09, 120 + idx, true);
          strokes.push({
            points: pts, radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true,
            reason: 'осевая улица к воротам',
          });
          edges.push({ from: 'center', to: `gate_${idx}`, level: 1, points: pts });
        });
        // Соразмерные концентрические кольца: между кольцами и стеной всегда остаётся >= 7–9 клеток под застройку и дворы!
        if (Math.min(RX, RY) >= 26) {
          strokes.push({
            points: ellipseRing(.40, .08, 3), radius: rPrimary, surface: mainSurface, level: 2, canCrossWallWater: false,
            reason: 'кольцо старого ядра',
          });
          strokes.push({
            points: ellipseRing(walls.walled ? .70 : .78, .07, 4), radius: rDistrict, surface: 'road', level: 2, canCrossWallWater: false,
            reason: 'внешнее кольцо кварталов',
          });
        } else if (Math.min(RX, RY) >= 14) {
          strokes.push({
            points: ellipseRing(walls.walled ? .52 : .58, .08, 3), radius: rPrimary, surface: mainSurface, level: 2, canCrossWallWater: false,
            reason: 'опорное бульварное кольцо',
          });
        }
        break;
      }

      case 'grid': {
        buildGridStreets(0);
        break;
      }

      case 'mixed': {
        // Органическое историческое ядро + регулярная сетка нового города снаружи!
        buildOrganicWeb(.5, town ? 7 : 5, false);
        strokes.push({
          points: ellipseRing(.46, .1, 8), radius: rPrimary, surface: 'road', level: 2, canCrossWallWater: false,
          reason: 'бульвар по бывшей границе старого ядра',
        });
        buildGridStreets(.44);
        break;
      }

      case 'organic': {
        buildOrganicWeb(.95, town ? 14 : 9, true);
        break;
      }

      case 'compact': {
        // Плотный сгруппированный узел вокруг центра/крепости.
        strokes.push({
          points: axisLine(0, -edgeReach, edgeReach, .06, 1),
          radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true, reason: 'главный тракт',
        });
        strokes.push({
          points: crossLine(0, -edgeReach, edgeReach, .06, 2),
          radius: rArterial * .9, surface: mainSurface, level: 1, canCrossWallWater: true, reason: 'поперечный тракт',
        });
        if (Math.min(RX, RY) >= 15) {
          strokes.push({
            points: ellipseRing(.54, .12, 6),
            radius: rPrimary * .85, surface: 'road', level: 2, canCrossWallWater: false, reason: 'внутренний обход',
          });
        }
        const sideBranches = Math.min(RX, RY) < 15 ? 2 : town ? 8 : 5;
        for (let i = 0; i < sideBranches; i++) {
          const t = (.28 + hash2(i, 1, seed + 0xa3) * .38) * (i % 2 === 0 ? 1 : -1);
          const sign = hash2(i, 2, seed + 0xa3) > .5 ? 1 : -1;
          const onAxis = i % 2 === 0;
          const start = onAxis ? gridPoint(t, 0) : gridPoint(0, t);
          const len = .32 + hash2(i, 3, seed + 0xa3) * .24;
          const end = onAxis ? gridPoint(t, sign * len) : gridPoint(sign * len, t);
          strokes.push({
            points: terrainBend(start, end, .12, 160 + i, false),
            radius: rDistrict * .9, surface: 'road', level: 3, canCrossWallWater: false, reason: 'короткая боковая улица',
          });
        }
        break;
      }

      case 'linear': {
        // Вытянутый город вдоль дороги, реки, берега или горной террасы.
        strokes.push({
          points: axisLine(0, -edgeReach, edgeReach, geography === 'mountain' ? .12 : .16, 1),
          radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true,
          reason: geography === 'coast' ? 'береговой тракт' : geography === 'mountain' ? 'террасная дорога' : 'главный тракт',
        });
        if (!small && (town || geography === 'mountain')) {
          const backSign = geography !== 'plain' ? (geo.side === 0 || geo.side === 2 ? -1 : 1) : (hash2(seed, 5, 0x94) > .5 ? 1 : -1);
          strokes.push({
            points: axisLine(backSign * .46, -.85, .85, .1, 3),
            radius: rPrimary, surface: 'road', level: 2, canCrossWallWater: false,
            reason: geography === 'mountain' ? 'верхняя террасная улица' : 'параллельная задняя улица',
          });
        }
        const step = (town ? 8.5 : 10.5) / (horizontal ? RX : RY);
        for (let k = -Math.floor(1 / step); k <= Math.floor(1 / step); k++) {
          if (k === 0) {
            // Главный поперечный спуск к воде / въезд в середине линейного поселения.
            strokes.push({
              points: crossLine(0, -edgeReach, edgeReach, .08, 39),
              radius: rPrimary, surface: 'road', level: 1, canCrossWallWater: true,
              reason: 'поперечный выезд / спуск к переправе',
            });
            continue;
          }
          const reachNeg = .48 + hash2(k, 1, seed + 0x95) * .38;
          const reachPos = .48 + hash2(k, 2, seed + 0x95) * .38;
          strokes.push({
            points: crossLine(k * step, -reachNeg, reachPos, .06, 40 + k),
            radius: rDistrict, surface: 'road', level: 3, canCrossWallWater: false,
            reason: 'поперечный съезд',
          });
        }
        break;
      }
    }
  }

  // Дополнительная связь в порту: прямая торговая улица от гавани к рынку и центру!
  const portNode = skel.nodes.find((n) => n.kind === 'port');
  if (portNode && s.road) {
    const portLink = terrainBend(portNode, hub, .1, 211, false);
    strokes.unshift({
      points: portLink, radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: false,
      reason: 'главный подъём от гавани к рынку',
    });
    edges.push({ from: portNode.id, to: 'center', level: 1, points: portLink });
  }

  // Закраска главной площади и плаца крепости.
  if (plaza && plazaOk && (!marketResolution || marketResolution.archetype.surface === 'square')) {
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) {
      for (let x = plaza.x; x < plaza.x + plaza.w; x++) paintCell(x, y, 'plaza', 1, false);
    }
  }
  if (paradeBox) {
    for (let y = paradeBox.y; y < paradeBox.y + paradeBox.h; y++) {
      for (let x = paradeBox.x; x < paradeBox.x + paradeBox.w; x++) paintCell(x, y, 'plaza', 2, false);
    }
  }

  // На тесной карте ограничиваем второстепенные улицы, чтобы сохранить место под кварталы.
  const mainStrokes = strokes.filter((st) => st.level <= 2 && st.canCrossWallWater);
  const otherStrokes = strokes.filter((st) => !(st.level <= 2 && st.canCrossWallWater));
  const drawn = tight ? [...mainStrokes, ...otherStrokes.slice(0, 3)] : strokes;
  if (tight && drawn.length < strokes.length) {
    ctx.notes.push(`тесная карта: проложено ${drawn.length} улиц из ${strokes.length}`);
  }
  for (const stroke of drawn) drawStroke(stroke);

  // Временная подложка под грунтовый рынок (чтобы сеть не распадалась до планировки рынка).
  const marketPrepaint: { i: number; terrain: Terrain }[] = [];
  if (marketSite && marketResolution && marketResolution.archetype.surface !== 'square') {
    const { x: mx, y: my, w: mw, h: mh } = marketSite.bounds;
    for (let y = my; y < my + mh; y++) {
      for (let x = mx; x < mx + mw; x++) {
        if (streets[id(x, y)] || !usable(x, y)) continue;
        marketPrepaint.push({ i: id(x, y), terrain: terrain(x, y) });
        paintCell(x, y, 'road', 2, false);
      }
    }
  }

  // Кольцевая улица вокруг рынка.
  let ringLaneIndex = -1;
  if (marketSite && marketResolution?.archetype.ringRoad && s.road) {
    const { x, y, w: mw, h: mh } = marketSite.bounds;
    const ring: Point[] = [];
    for (let xx = x - 1; xx <= x + mw; xx++) ring.push({ x: xx, y: y - 1 });
    for (let yy = y; yy <= y + mh; yy++) ring.push({ x: x + mw, y: yy });
    for (let xx = x + mw - 1; xx >= x - 1; xx--) ring.push({ x: xx, y: y + mh });
    for (let yy = y + mh - 1; yy >= y - 1; yy--) ring.push({ x: x - 1, y: yy });
    const painted = ring.filter((p) => paintCell(p.x, p.y, 'road', 2, false));
    if (painted.length) {
      ringLaneIndex = lanes.length;
      lanes.push({ points: ring, width: 1, surface: 'road', level: 2, reason: 'обход рыночной площади' });
    }
  }

  // Кольцевой двор-обход вокруг цитадели.
  if (keepBox && keepFree) {
    const { x, y, w: kw, h: kh } = keepBox;
    const ring: Point[] = [];
    for (let xx = x - 1; xx <= x + kw; xx++) ring.push({ x: xx, y: y - 1 });
    for (let yy = y; yy <= y + kh; yy++) ring.push({ x: x + kw, y: yy });
    for (let xx = x + mwOr(kw) - 1 + x - x; xx >= x - 1; xx--) { void xx; break; }
    // Точный контур вокруг цитадели:
    ring.length = 0;
    for (let xx = x - 1; xx <= x + kw; xx++) ring.push({ x: xx, y: y - 1 });
    for (let yy = y; yy <= y + kh; yy++) ring.push({ x: x + kw, y: yy });
    for (let xx = x + kw - 1; xx >= x - 1; xx--) ring.push({ x: xx, y: y + kh });
    for (let yy = y + kh - 1; yy >= y - 1; yy--) ring.push({ x: x - 1, y: yy });
    for (const p of ring) paintCell(p.x, p.y, mainSurface, 2, false);
    lanes.push({
      points: ring, width: 1, surface: mainSurface === 'plaza' ? 'plaza' : 'road', level: 2,
      reason: 'обход цитадели',
    });
  }

  // Набережная вдоль берега моря (Уровень 2).
  let quayPoints: Point[] = [];
  if (geography === 'coast') {
    for (let a = 0; a < length; a++) {
      for (let d = 0; d < span; d++) {
        const p = at(a, d);
        if (!inside(p.x, p.y)) break;
        if (usable(p.x, p.y)) {
          const q = at(a, d + 1);
          if (inside(q.x, q.y) && usable(q.x, q.y) && reach(q.x, q.y) < 1.18) quayPoints.push(q);
          break;
        }
      }
    }
    const sampledQuay = quayPoints.filter((_, i) => i % 3 === 0);
    if (sampledQuay.length >= 2) {
      drawStroke({
        points: sampledQuay, radius: Math.max(.68, rPrimary * .88), surface: town ? 'plaza' : 'road',
        level: 2, canCrossWallWater: false, reason: 'портовая набережная',
      });
      // Гарантируем связку набережной с центром/рынком.
      const midQuay = sampledQuay[Math.floor(sampledQuay.length / 2)];
      drawStroke({
        points: terrainBend(midQuay, hub, .08, 233, false),
        radius: rPrimary, surface: mainSurface, level: 1, canCrossWallWater: false,
        reason: 'подъём с набережной к центру',
      });
    }
  }

  // ---- Речная интеграция: функциональная городская набережная и мостовой узел (Section 13)
  const riverQuayPoints: Point[] = [];
  if (geo.river.length > 0 && s.road && !small) {
    // Строим набережную ТОЛЬКО вдоль активного городского участка реки (не вдоль всей реки через поля!).
    const citySignX = Math.sign(center.x - geo.river[Math.floor(geo.river.length / 2)].x) || 1;
    const citySignY = Math.sign(center.y - geo.river[Math.floor(geo.river.length / 2)].y) || 1;
    for (let i = 0; i < geo.river.length; i += 2) {
      const rp = geo.river[i];
      if (skel.footprintAt(rp.x, rp.y) > .88) continue;
      // Ищем сухую береговую клетку на стороне города в 2–4 клетках от воды.
      for (let d = 2; d <= 5; d++) {
        const candidates = [
          { x: rp.x + citySignX * d, y: rp.y },
          { x: rp.x, y: rp.y + citySignY * d },
        ];
        const found = candidates.find((q) =>
          inside(q.x, q.y)
          && usable(q.x, q.y)
          && skel.walls.insideWalls(q.x, q.y)
          && geo.waterDist[id(q.x, q.y)] >= 2
          && geo.waterDist[id(q.x, q.y)] <= 4,
        );
        if (found) {
          riverQuayPoints.push(found);
          break;
        }
      }
    }
    if (riverQuayPoints.length >= 3 && (town || type.id === 'large_village')) {
      const sampledRQuay = riverQuayPoints.filter((_, idx) => idx % 2 === 0);
      if (sampledRQuay.length >= 2) {
        drawStroke({
          points: sampledRQuay,
          radius: .62,
          surface: town && character.id === 'trade' ? 'plaza' : 'road',
          level: 2,
          canCrossWallWater: false,
          reason: 'городская речная набережная',
        });
        const midRQ = sampledRQuay[Math.floor(sampledRQuay.length / 2)];
        drawStroke({
          points: terrainBend(midRQ, hub, .1, 244, false),
          radius: rPrimary * .9,
          surface: 'road',
          level: 2,
          canCrossWallWater: false,
          reason: 'связка речной набережной с центром',
        });
      }
    }
    // Мостовой узел: если река проходит рядом с пятном города, гарантируем полноценный мост,
    // соединённый с обеих сторон с реальной уличной сетью.
    const mainBridge = crossingCandidates[0];
    if (mainBridge && skel.footprintAt(mainBridge.x, mainBridge.y) <= 1.28) {
      const vx = mainBridge.x - hub.x;
      const vy = mainBridge.y - hub.y;
      const len = Math.max(1, Math.hypot(vx, vy));
      const farBank = {
        x: between(Math.round(mainBridge.x + (vx / len) * 9), 2, w - 3),
        y: between(Math.round(mainBridge.y + (vy / len) * 9), 2, h - 3),
      };
      if (usable(farBank.x, farBank.y)) {
        const bridgePts = [hub, mainBridge, farBank];
        drawStroke({
          points: bridgePts,
          radius: rArterial * .92,
          surface: mainSurface,
          level: 1,
          canCrossWallWater: true,
          reason: 'мостовая магистраль через реку',
        });
        edges.push({ from: 'center', to: 'bridge_0', level: 1, points: [hub, mainBridge] });
      }
    }
  }

  // ---- Малые районные площади на узлах улиц (Section 14) --------------------
  const subPlazas: Selection[] = [];
  if (s.publicSpaces !== false && !small && !tight) {
    const targetSubPlazas = type.id === 'large_city' ? 3 : town ? 2 : type.id === 'large_village' ? 1 : 0;
    for (let y = 5; y < h - 6 && subPlazas.length < targetSubPlazas; y += 2) {
      for (let x = 5; x < w - 6 && subPlazas.length < targetSubPlazas; x += 2) {
        const idx = id(x, y);
        if (!streets[idx] || streetLevel[idx] > 2) continue;
        if (skel.footprintAt(x, y) > .82 || !skel.walls.insideWalls(x, y)) continue;
        // Должен быть реальный перекрёсток (>= 3 направлений улиц на расстоянии 2 клеток).
        let branches = 0;
        for (const [dx, dy] of N4) {
          if (inside(x + dx * 2, y + dy * 2) && streets[id(x + dx * 2, y + dy * 2)]) branches++;
        }
        if (branches < 3) continue;
        if (plaza && Math.hypot(x - (plaza.x + plaza.w / 2), y - (plaza.y + plaza.h / 2)) < 11) continue;
        if (keepBox && Math.hypot(x - (keepBox.x + keepBox.w / 2), y - (keepBox.y + keepBox.h / 2)) < 10) continue;
        if (subPlazas.some((sp) => Math.hypot(x - (sp.x + sp.w / 2), y - (sp.y + sp.h / 2)) < 12)) continue;

        const sw = hash2(x, y, seed + 0x5b1) > .5 ? 4 : 3;
        const sh = 3;
        const box: Selection = { x: x - 1, y: y - 1, w: sw, h: sh };
        let ok = true;
        for (let yy = box.y; yy < box.y + box.h && ok; yy++) {
          for (let xx = box.x; xx < box.x + box.w; xx++) {
            const tr = terrain(xx, yy);
            if (wet(tr) || tr === 'wall' || tr === 'rock' || reserved[id(xx, yy)]) { ok = false; break; }
            if (geo.waterDist[id(xx, yy)] < 2) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let yy = box.y; yy < box.y + box.h; yy++) {
          for (let xx = box.x; xx < box.x + box.w; xx++) {
            paintCell(xx, yy, town ? 'plaza' : 'road', 2, false);
          }
        }
        subPlazas.push(box);
      }
    }
  }

  // Если поселение укреплённое, но ни одна улица ещё не пробила внешнюю стену (например, при выключенной дороге),
  // прокладываем короткий выезд от центра через ближайшую сухую точку стены, чтобы город не был замурован.
  if (walls.walled && gates.size === 0 && s.road) {
    const r = walls.wallRadii(walls.wallRings[0]);
    for (let k = 0; k < 8 && gates.size === 0; k++) {
      const a = (entryAngles[0] ?? 0) + (k * Math.PI) / 4;
      const target = { x: center.x + Math.cos(a) * (r.x + 3), y: center.y + Math.sin(a) * (r.y + 3) };
      drawStroke({
        points: [hub, target], radius: rArterial, surface: mainSurface, level: 1, canCrossWallWater: true,
        reason: 'гарантированный выезд через ворота',
      });
    }
  }

  // Убираем 1–2-клеточные тупиковые обрубки дороги, упирающиеся прямо в воду без моста!
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = id(x, y);
        if (!streets[idx] || terrain(x, y) === 'bridge' || gates.has(idx)) continue;
        let streetN = 0;
        let touchesRawWater = false;
        let touchesBridge = false;
        for (const [dx, dy] of N4) {
          const tr = terrain(x + dx, y + dy);
          if (streets[id(x + dx, y + dy)]) streetN++;
          if (waterOnly(tr)) touchesRawWater = true;
          if (tr === 'bridge') touchesBridge = true;
        }
        if (touchesRawWater && !touchesBridge && streetN <= 1) {
          streets[idx] = 0;
          streetLevel[idx] = 0;
          cells[y][x].terrain = 'grass';
        }
      }
    }
  }

  // ---- 5. Гарантия единой связной уличной сети ------------------------------
  // Вместо простого удаления важных оторванных кусков внутри города сначала соединяем
  // крупные внутренние фрагменты коротким проулком, а мелкие обрывки убираем.
  unifyStreetComponents(w, h, cells, streets, streetLevel, gates, keepFree ? reserved : undefined);

  // ---- 6. Ворота и сторожевые башни -----------------------------------------
  const towers: Point[] = [];
  const gatePoints: Point[] = [];
  {
    const seen = new Set<number>();
    for (const g of gates) {
      if (seen.has(g)) continue;
      const stack = [g];
      seen.add(g);
      const group: number[] = [];
      while (stack.length) {
        const c = stack.pop()!;
        group.push(c);
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N8) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const n = id(nx, ny);
          if (gates.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      // Центр проёма ворот для узлов и приключенческих цепочек.
      const gx = Math.round(group.reduce((acc, c) => acc + (c % w), 0) / group.length);
      const gy = Math.round(group.reduce((acc, c) => acc + Math.floor(c / w), 0) / group.length);
      gatePoints.push({ x: gx, y: gy });

      // Фланговые башни строго на соседних клетках стены (никогда не на самой дороге!).
      for (const c of group) {
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N4) {
          const tx = x + dx, ty = y + dy;
          if (inside(tx, ty) && terrain(tx, ty) === 'wall' && !streets[id(tx, ty)] && !towers.some((t) => t.x === tx && t.y === ty)) {
            towers.push({ x: tx, y: ty });
          }
        }
      }
    }

    for (let rIdx = 0; rIdx < walls.wallRings.length; rIdx++) {
      if (walls.hasRemnantWall && rIdx === 1) continue; // На руинах старой стены регулярные башни не ставим.
      const ring = walls.wallRings[rIdx];
      const n = Math.max(6, Math.round((RX + RY) * ring * .45));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = walls.wallRadii(ring);
        const p = { x: Math.round(center.x + Math.cos(a) * r.x), y: Math.round(center.y + Math.sin(a) * r.y) };
        let best: Point | undefined;
        let bd = Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = p.x + dx, y = p.y + dy;
            if (inside(x, y) && terrain(x, y) === 'wall' && !streets[id(x, y)] && Math.hypot(dx, dy) < bd) {
              bd = Math.hypot(dx, dy);
              best = { x, y };
            }
          }
        }
        if (best && !towers.some((t) => Math.abs(t.x - best!.x) + Math.abs(t.y - best!.y) < 3)) {
          towers.push(best);
        }
      }
    }
  }
  if (walls.walled && !gatePoints.length) ctx.notes.push('нет ворот: улицы не пересекли стену');

  return {
    streets,
    streetLevel,
    lanes,
    edges,
    gates,
    gatePoints,
    towers,
    bridges,
    plaza,
    plazaOk,
    subPlazas,
    marketResolution,
    marketSite,
    marketPrepaint,
    ringLaneIndex,
    quayPoints,
    riverQuayPoints,
    paintCell,
    drawStroke,
  };
}

function mwOr(v: number): number {
  return v;
}

/**
 * Находит компоненты связности улиц. Коротко оторванные участки на суше (до 4 клеток разрыва)
 * подсоединяет переулком к главной сети, а недостижимые через воду/стену мелкие обрывки очищает.
 */
export function unifyStreetComponents(
  w: number,
  h: number,
  cells: Cell[][],
  streets: Uint8Array,
  streetLevel: Uint8Array,
  gates: Set<number>,
  reserved?: Uint8Array,
): void {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;

  const findComponents = () => {
    const comp = new Int32Array(w * h).fill(-1);
    const groups: number[][] = [];
    for (let i = 0; i < w * h; i++) {
      if (!streets[i] || comp[i] >= 0) continue;
      const label = groups.length;
      const stack = [i];
      comp[i] = label;
      const members: number[] = [];
      while (stack.length) {
        const c = stack.pop()!;
        members.push(c);
        const x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const n = id(nx, ny);
          if (streets[n] && comp[n] < 0) {
            comp[n] = label;
            stack.push(n);
          }
        }
      }
      groups.push(members);
    }
    return { comp, groups };
  };

  let { comp, groups } = findComponents();
  if (groups.length <= 1) return;

  let mainIdx = 0;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].length > groups[mainIdx].length) mainIdx = i;
  }

  // Пытаемся подсоединить содержательные сухопутные фрагменты (>= 5 клеток), лежащие в <= 5 клетках от главной сети.
  const mainSet = new Set<number>(groups[mainIdx]);
  for (let g = 0; g < groups.length; g++) {
    if (g === mainIdx || groups[g].length < 5) continue;
    // Короткий BFS от фрагмента к mainSet по сухой свободной земле без стен и скал.
    const parent = new Int32Array(w * h).fill(-2);
    const dist = new Uint8Array(w * h).fill(255);
    const queue: number[] = [];
    for (const c of groups[g]) {
      parent[c] = -1;
      dist[c] = 0;
      queue.push(c);
    }
    let hit = -1;
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      if (dist[c] >= 5) continue;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const n = id(nx, ny);
        if (mainSet.has(n)) {
          parent[n] = c;
          hit = n;
          break;
        }
        if (dist[n] !== 255) continue;
        const t = cells[ny][nx].terrain;
        if (wet(t) || t === 'rock' || t === 'wall' || reserved?.[n]) continue;
        dist[n] = dist[c] + 1;
        parent[n] = c;
        queue.push(n);
      }
      if (hit >= 0) break;
    }
    if (hit >= 0) {
      let cur = parent[hit];
      while (cur >= 0 && parent[cur] >= 0) {
        const x = cur % w, y = (cur - x) / w;
        cells[y][x].terrain = 'road';
        streets[cur] = 1;
        if (!streetLevel[cur]) streetLevel[cur] = 3;
        mainSet.add(cur);
        cur = parent[cur];
      }
      for (const c of groups[g]) mainSet.add(c);
    }
  }

  // Пересчитываем и удаляем оставшиеся изолированные обрывки.
  ({ comp, groups } = findComponents());
  if (groups.length <= 1) return;
  mainIdx = 0;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].length > groups[mainIdx].length) mainIdx = i;
  }
  for (let i = 0; i < w * h; i++) {
    if (streets[i] && comp[i] !== mainIdx) {
      const x = i % w, y = (i - x) / w;
      streets[i] = 0;
      streetLevel[i] = 0;
      cells[y][x].terrain = gates.has(i) ? 'wall' : cells[y][x].terrain === 'bridge' ? 'water' : 'dirt';
      gates.delete(i);
    }
  }
}
