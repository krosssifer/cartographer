import { hash2 } from '../../random';
import type { Point, Selection } from '../../types';
import {
  N4,
  URBAN_ZONE_ORDER,
  between,
  unit,
  waterOnly,
  wet,
  type UrbanContext,
  type UrbanNode,
  type UrbanZone,
} from './types';

export interface WallSetup {
  walled: boolean;
  wallRings: number[];
  wallRadii: (ring: number) => { x: number; y: number };
  wallAt: (ring: number, x: number, y: number) => number;
  insideWalls: (x: number, y: number) => boolean;
  hasRemnantWall: boolean;
}

export interface UrbanSkeleton {
  origin: Point;
  center: Point;
  RX: number;
  RY: number;
  /** Базовое эллиптическое расстояние (для колец стен). */
  reach: (x: number, y: number) => number;
  /** Органическое расстояние City Footprint с учётом выступов у дорог, рек, ядра и рельефа (< 1 — внутри пятна города). */
  footprintAt: (x: number, y: number) => number;
  /** Зона градиента для каждой клетки (индекс в URBAN_ZONE_ORDER: 0=old_core .. 5=wilderness). */
  urbanZoneAt: Uint8Array;
  /** Плавное поле целевой плотности застройки 0..1 от ядра к природе. */
  densityField: Float32Array;
  walls: WallSetup;
  keepBox?: Selection;
  keepFree: boolean;
  paradeBox?: Selection;
  entryAngles: number[];
  nodes: UrbanNode[];
  reserved: Uint8Array;
}

export function buildUrbanSkeleton(ctx: UrbanContext): UrbanSkeleton {
  const { width: w, height: h, seed, type, character, geo, small, tight } = ctx;
  const { cells, waterDist, slope, geography, shoreDepth, span, length, at, crossingCandidates } = geo;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(cells[y][x].terrain) && cells[y][x].terrain !== 'rock' && cells[y][x].terrain !== 'wall';

  const marginX = Math.max(4, Math.round(w * .18));
  const marginY = Math.max(4, Math.round(h * .18));
  const land: Point[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (usable(x, y)) land.push({ x, y });
    }
  }

  // ---- 1. Точка основания (ORIGIN) — не обязана совпадать с центром карты ---
  let origin: Point = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  let originReason = 'Перекрестье старых троп';
  let bestOriginScore = -Infinity;

  const targetCoast = geography === 'coast'
    ? at(length * (.38 + hash2(seed, 1, 0xce) * .24), shoreDepth + Math.max(3, (span - shoreDepth) * .16))
    : undefined;
  const targetMountain = geography === 'mountain'
    ? at(length * (.36 + hash2(seed, 2, 0xce) * .28), geo.terraceShelves[0] ?? Math.round(span * .44))
    : undefined;
  const bridgeAnchor = crossingCandidates[0];

  for (let y = marginY; y < h - marginY; y += 2) {
    for (let x = marginX; x < w - marginX; x += 2) {
      if (!usable(x, y)) continue;
      const idx = id(x, y);
      const sl = slope[idx];
      if (sl > .18) continue;
      // Мягкое смещение от геометрического центра карты, чтобы город имел живую асимметрию.
      const offX = (hash2(seed, 21, 0x51a) - .5) * w * .16;
      const offY = (hash2(seed, 22, 0x51a) - .5) * h * .16;
      const centerBias = 1 - Math.hypot((x - (w / 2 + offX)) / (w / 2), (y - (h / 2 + offY)) / (h / 2)) * .62;
      let sc = centerBias * 1.35 - sl * 4 + (hash2(x, y, seed + 0x51a) - .5) * .32;

      if (geography === 'coast' && targetCoast) {
        const wd = waterDist[idx];
        sc += wd >= 2 && wd <= 7 ? 2.4 - Math.abs(wd - 4) * .25 : -Math.abs(wd - 5) * .22;
        sc -= (Math.hypot(x - targetCoast.x, y - targetCoast.y) / Math.max(w, h)) * 1.7;
      } else if (geography === 'mountain' && targetMountain) {
        sc -= (Math.hypot(x - targetMountain.x, y - targetMountain.y) / Math.max(w, h)) * 2.1;
        sc += (1 - sl * 6) * .85;
      } else if (type.keep || character.id === 'military' || character.id === 'religious') {
        sc += cells[y][x].height * 1.9;
      } else if (bridgeAnchor) {
        const dBridge = Math.hypot(x - bridgeAnchor.x, y - bridgeAnchor.y);
        sc += wdScore(waterDist[idx], 3, 10) * 1.15 + Math.max(0, 1.65 - dBridge / (Math.min(w, h) * .34));
      } else if (waterDist[idx] < 999) {
        sc += wdScore(waterDist[idx], 4, 12) * .75;
      }

      if (sc > bestOriginScore) {
        bestOriginScore = sc;
        origin = { x, y };
      }
    }
  }
  if (!usable(origin.x, origin.y) && land.length) {
    origin = land.reduce((best, p) =>
      Math.hypot(p.x - w / 2, p.y - h / 2) < Math.hypot(best.x - w / 2, best.y - h / 2) ? p : best,
    land[0]);
  }
  if (geography === 'coast') originReason = 'Старая гавань у бухты';
  else if (geography === 'mountain') originReason = 'Укреплённая терраса на склоне';
  else if (type.keep) originReason = 'Замковый холм';
  else if (bridgeAnchor && Math.hypot(origin.x - bridgeAnchor.x, origin.y - bridgeAnchor.y) < Math.min(w, h) * .32) {
    originReason = 'Историческая переправа у реки';
  }

  // ---- 2. Городской центр (URBAN CORE CENTER) -------------------------------
  const preferredCenter: Point = (() => {
    if (geography === 'coast') {
      const inland = at(
        geo.along(origin.x, origin.y),
        Math.min(span - 5, Math.max(shoreDepth + Math.round((span - shoreDepth) * .30), geo.fromEdge(origin.x, origin.y) + 4)),
      );
      return { x: between(Math.round(inland.x), 5, w - 6), y: between(Math.round(inland.y), 5, h - 6) };
    }
    if (geography === 'mountain') {
      const shelf = geo.terraceShelves[Math.min(1, geo.terraceShelves.length - 1)] ?? Math.round(span * .46);
      const p = at(geo.along(origin.x, origin.y), shelf);
      return { x: between(Math.round((origin.x + p.x) / 2), 5, w - 6), y: between(Math.round((origin.y + p.y) / 2), 5, h - 6) };
    }
    const pull = type.walls !== 'none' ? .48 : .28;
    const riverShiftX = geo.river.length && geo.river[0].x > w * .62 ? w * .44
      : geo.river.length && geo.river[0].x < w * .38 ? w * .56
      : w * .5;
    return {
      x: between(Math.round(origin.x * (1 - pull) + riverShiftX * pull), 5, w - 6),
      y: between(Math.round(origin.y * (1 - pull) + (h * .5) * pull), 5, h - 6),
    };
  })();

  let center = { x: preferredCenter.x, y: preferredCenter.y };
  if (!usable(center.x, center.y) && land.length) {
    center = land.reduce((best, p) =>
      Math.hypot(p.x - preferredCenter.x, p.y - preferredCenter.y)
      < Math.hypot(best.x - preferredCenter.x, best.y - preferredCenter.y) ? p : best,
    land[0]);
  }

  // ---- 3. CITY FOOTPRINT — Компактное пятно города + пояс предместий и природы
  // На средних и больших картах город НЕ растягивается до краёв холста (оставляя место
  // пригородам, полям и лесу), а внутри своего контура застраивается плотно и цельно!
  const isWalled = type.walls !== 'none' && !small;
  const mapCompactFactor = small ? .94 : tight ? .88 : isWalled ? .92 : .80;
  const minExtent = isWalled ? Math.min(type.extent, .58) : .48;
  const effectiveExtent = between(type.extent * mapCompactFactor, minExtent, small ? .88 : .80);
  const minRX = isWalled ? Math.min(w / 2 - 3, 14) : 7;
  const minRY = isWalled ? Math.min(h / 2 - 3, 11) : 6;
  const RX = Math.max(minRX, (w / 2) * effectiveExtent);
  const RY = Math.max(minRY, (h / 2) * effectiveExtent);
  const reach = (x: number, y: number) => Math.hypot((x - center.x) / RX, (y - center.y) / RY);

  // ---- 4. Главные внешние направления (нужны заранее для выступов City Footprint)
  const desiredExits = type.id === 'small_village' ? 2
    : type.id === 'frontier_outpost' || type.id === 'fortress' ? (small ? 2 : 3)
    : ctx.town ? (type.id === 'large_city' ? 4 : 3 + (hash2(seed, 7, 0xe1) > .55 ? 1 : 0))
    : 3;

  const candidateAngles: { angle: number; score: number }[] = [];
  const samples = 20;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2 + (hash2(i, 3, seed + 0x77) - .5) * .14;
    const edgePt = rayToEdge(center, a, w, h);
    const ex = between(Math.round(edgePt.x), 1, w - 2);
    const ey = between(Math.round(edgePt.y), 1, h - 2);
    const midX = between(Math.round((center.x + ex) / 2), 1, w - 2);
    const midY = between(Math.round((center.y + ey) / 2), 1, h - 2);

    if (geography === 'coast' && waterOnly(cells[ey][ex].terrain)) continue;
    if (cells[ey][ex].terrain === 'rock' && cells[midY][midX].terrain === 'rock') continue;

    let sc = 1.0;
    if (crossingCandidates.length) {
      for (let ci = 0; ci < Math.min(2, crossingCandidates.length); ci++) {
        const bridgeAngle = Math.atan2(crossingCandidates[ci].y - center.y, crossingCandidates[ci].x - center.x);
        const diff = Math.abs(angleDiff(a, bridgeAngle));
        if (diff < .44) sc += (1.7 - diff) * (ci === 0 ? 1 : .75);
      }
    }
    if (geography !== 'plain') {
      const alongAngle = geo.side <= 1 ? 0 : Math.PI / 2;
      const d1 = Math.abs(angleDiff(a, alongAngle));
      const d2 = Math.abs(angleDiff(a, alongAngle + Math.PI));
      if (Math.min(d1, d2) < .45) sc += 1.35;
    } else if (ctx.layout === 'grid' || character.id === 'military') {
      const card = Math.min(...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((ca) => Math.abs(angleDiff(a, ca))));
      sc += Math.max(0, .9 - card * 1.5);
    }
    sc += hash2(i, 9, seed + 0x31) * .35;
    candidateAngles.push({ angle: a, score: sc });
  }

  candidateAngles.sort((a, b) => b.score - a.score);
  const entryAngles: number[] = [];
  const minAngleSep = Math.PI * (desiredExits >= 4 ? .38 : .52);
  for (const cand of candidateAngles) {
    if (entryAngles.length >= desiredExits) break;
    if (entryAngles.some((other) => Math.abs(angleDiff(cand.angle, other)) < minAngleSep)) continue;
    entryAngles.push(cand.angle);
  }
  if (entryAngles.length < 2) {
    for (const cand of candidateAngles) {
      if (entryAngles.length >= 2) break;
      if (entryAngles.some((other) => Math.abs(angleDiff(cand.angle, other)) < .65)) continue;
      entryAngles.push(cand.angle);
    }
  }

  // ---- 5. Стены и укрепления (согласованы с внутренним контуром города) -----
  const walled = type.walls !== 'none' && !small;
  if (type.walls !== 'none' && !walled) ctx.notes.push('стены не строятся: карта меньше 24 клеток');

  const wallRadii = (ring: number) => ({
    x: Math.max(3, Math.min(RX * ring, center.x - 2, w - 3 - center.x)),
    y: Math.max(3, Math.min(RY * ring, center.y - 2, h - 3 - center.y)),
  });
  const wallAt = (ring: number, x: number, y: number) => {
    const r = wallRadii(ring);
    return Math.hypot((x - center.x) / r.x, (y - center.y) / r.y);
  };

  const wallRings: number[] = [];
  let hasRemnantWall = false;
  if (walled) {
    wallRings.push(.94);
    const innerKeep = type.keep && Math.min(RX, RY) >= 12;
    if (innerKeep) {
      wallRings.push(.46);
    } else if (
      !tight
      && Math.min(RX, RY) >= 15
      && (character.id === 'ancient' || (type.id === 'large_city' && character.anomalyRate >= .45))
    ) {
      wallRings.push(.52);
      hasRemnantWall = true;
    }
  }

  for (let rIdx = 0; rIdx < wallRings.length; rIdx++) {
    const ring = wallRings[rIdx];
    const isRemnant = hasRemnantWall && rIdx === 1;
    const arcPhase = unit(seed, 0x99a1) * Math.PI * 2;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (wallAt(ring, x, y) > 1 || !usable(x, y)) continue;
        if (!N4.some(([dx, dy]) => wallAt(ring, x + dx, y + dy) > 1)) continue;
        if (isRemnant) {
          const ang = Math.atan2(y - center.y, x - center.x);
          const wave = Math.cos((ang - arcPhase) * 2);
          if (wave < .58) continue;
        }
        cells[y][x].terrain = 'wall';
      }
    }
  }

  const insideWalls = (x: number, y: number) => !walled || wallAt(wallRings[0], x, y) < 1;

  // ---- 6. Неправильная органическая форма City Footprint и Градиент Плотности
  const phi1 = unit(seed, 0xf001) * Math.PI * 2;
  const phi2 = unit(seed, 0xf002) * Math.PI * 2;
  const phi3 = unit(seed, 0xf003) * Math.PI * 2;
  const irregularity = 1 - character.regularity * .48;

  const contourScaleAtAngle = (angle: number): number => {
    // Многогармонический органический контур (не прямоугольник и не идеальный круг!).
    const lobes = Math.cos(angle * 2 + phi1) * .13 * irregularity
      + Math.sin(angle * 3 + phi2) * .09 * irregularity
      + Math.cos(angle * 5 + phi3) * .05 * irregularity;
    // Естественные выступы («языки» слобод) вдоль главных въездных дорог и переправ.
    let roadSalient = 0;
    for (const ea of entryAngles) {
      const da = angleDiff(angle, ea);
      roadSalient = Math.max(roadSalient, Math.exp(-(da * da) / .09) * (.22 + character.suburbSpread * .12));
    }
    // Вытягивание вдоль берега моря или горной террасы для линейных/портовых поселений.
    let geoStretch = 0;
    if (geography !== 'plain' || ctx.layout === 'linear') {
      const axis = geography !== 'plain' ? (geo.side <= 1 ? 0 : Math.PI / 2) : (w >= h ? 0 : Math.PI / 2);
      const da = Math.min(Math.abs(angleDiff(angle, axis)), Math.abs(angleDiff(angle, axis + Math.PI)));
      geoStretch = Math.cos(da) * .16;
    }
    return between(1 + lobes + roadSalient + geoStretch, .68, 1.44);
  };

  // Предвычисляем footprintDist, urbanZoneAt и плавный densityField по всей карте.
  const footprintGridF = new Float32Array(w * h);
  const urbanZoneAt = new Uint8Array(w * h).fill(5); // 5 = wilderness
  const densityField = new Float32Array(w * h);

  const typeMult = type.style === 'town'
    ? (type.id === 'large_city' ? 1.12 : type.id === 'small_city' || type.id === 'fortified_town' ? 1.05 : 1.0)
    : (type.id === 'small_village' ? .76 : .88);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = id(x, y);
      const tr = cells[y][x].terrain;
      if (waterOnly(tr) || tr === 'rock') {
        footprintGridF[idx] = 2.5;
        urbanZoneAt[idx] = 5;
        densityField[idx] = 0;
        continue;
      }

      // Расстояние до сдвоенного ядра (origin + center): старый центр тяготеет к origin!
      const dCenter = reach(x, y);
      const dOrigin = Math.hypot((x - origin.x) / RX, (y - origin.y) / RY);
      const coreDist = Math.min(dCenter, dOrigin * .92 + .06);

      const ang = Math.atan2(y - center.y, x - center.x);
      const cScale = contourScaleAtAngle(ang);
      // Рельеф и близость реки влияют на границу города.
      const slopePenalty = slope[idx] * 1.15;
      const riverPull = geo.river.length && waterDist[idx] >= 2 && waterDist[idx] <= 8 ? -.07 : 0;
      let fp = coreDist / cScale + slopePenalty + riverPull;

      // Если есть крепостная стена, стена чётко отделяет внутренний город от предместий!
      if (walled) {
        const wDist = wallAt(wallRings[0], x, y);
        if (wDist < .96) {
          fp = Math.min(fp, wDist * .86);
        } else {
          // За стеной — только внешний посад / пригороды вдоль трактов и у ворот.
          fp = Math.max(.92, fp * 1.06);
        }
      }

      footprintGridF[idx] = fp;

      let zone: UrbanZone;
      const coreLim = .30 + character.coreShare * .12;
      if (fp <= coreLim) zone = 'old_core';
      else if (fp <= .58) zone = 'inner_city';
      else if (fp <= .88) zone = 'residential';
      else if (fp <= 1.08 + character.suburbSpread * .10) zone = 'outer_city';
      else if (fp <= 1.32 + character.suburbSpread * .16) zone = 'suburbs';
      else zone = 'wilderness';

      const zIdx = URBAN_ZONE_ORDER.indexOf(zone);
      urbanZoneAt[idx] = zIdx;

      // Плавный градиент плотности: максимум в old_core -> плавный спад к suburbs -> 0 в wilderness.
      const distInfluence = fp <= .22
        ? 1.0
        : fp >= 1.38
        ? 0
        : Math.pow(between(1 - (fp - .22) / 1.16, 0, 1), 1.35);
      densityField[idx] = between(distInfluence * typeMult, 0, 1);
    }
  }

  const footprintAt = (x: number, y: number): number => {
    const cx = between(Math.round(x), 0, w - 1);
    const cy = between(Math.round(y), 0, h - 1);
    return footprintGridF[id(cx, cy)];
  };

  // ---- 7. Цитадель и плац (для крепости) ------------------------------------
  const reserved = new Uint8Array(w * h);
  const keepSize = between(Math.round(Math.min(RX, RY) * .36), 5, 8);
  const keepBox: Selection | undefined = type.keep ? {
    x: between(center.x - Math.floor(keepSize / 2), 2, w - keepSize - 2),
    y: between(center.y - Math.floor(keepSize / 2), 2, h - keepSize - 2),
    w: keepSize,
    h: keepSize,
  } : undefined;

  const keepFree = Boolean(keepBox && (() => {
    for (let y = keepBox.y - 1; y <= keepBox.y + keepBox.h; y++) {
      for (let x = keepBox.x - 1; x <= keepBox.x + keepBox.w; x++) {
        if (!usable(x, y)) return false;
      }
    }
    return true;
  })());

  let paradeBox: Selection | undefined;
  if (keepBox && keepFree) {
    for (let y = keepBox.y; y < keepBox.y + keepBox.h; y++) {
      for (let x = keepBox.x; x < keepBox.x + keepBox.w; x++) {
        reserved[id(x, y)] = 1;
      }
    }
    const pw = Math.max(4, keepBox.w);
    const ph = between(Math.round(keepBox.h * .55), 3, 5);
    const southY = keepBox.y + keepBox.h + 1;
    const northY = keepBox.y - 1 - ph;
    for (const py of [southY, northY]) {
      if (py < 2 || py + ph > h - 2) continue;
      let ok = true;
      for (let yy = py; yy < py + ph && ok; yy++) {
        for (let xx = keepBox.x; xx < keepBox.x + pw; xx++) {
          if (!usable(xx, yy) || !insideWalls(xx, yy)) { ok = false; break; }
        }
      }
      if (ok) {
        paradeBox = { x: keepBox.x, y: py, w: pw, h: ph };
        break;
      }
    }
  }

  // ---- 8. Граф городских узлов (URBAN NODES) --------------------------------
  const nodes: UrbanNode[] = [
    { id: 'origin', kind: 'origin', x: origin.x, y: origin.y, priority: 10, label: originReason },
  ];
  if (Math.hypot(center.x - origin.x, center.y - origin.y) >= 3) {
    nodes.push({ id: 'center', kind: 'center', x: center.x, y: center.y, priority: 10, label: 'Городское ядро' });
  } else {
    nodes[0] = { id: 'origin', kind: 'origin', x: center.x, y: center.y, priority: 10, label: originReason };
  }

  if (keepBox && keepFree) {
    nodes.push({
      id: 'keep', kind: 'keep',
      x: keepBox.x + Math.floor(keepBox.w / 2),
      y: keepBox.y + Math.floor(keepBox.h / 2),
      priority: 10, label: 'Цитадель',
    });
  }

  if (geography === 'coast') {
    const portPt = at(Math.round(length * .5), Math.max(2, shoreDepth + 2));
    if (inside(portPt.x, portPt.y) && usable(portPt.x, portPt.y)) {
      nodes.push({ id: 'port_hub', kind: 'port', x: portPt.x, y: portPt.y, priority: 9, label: 'Гавань' });
    }
  }

  crossingCandidates.slice(0, 2).forEach((bp, idx) => {
    nodes.push({ id: `bridge_${idx}`, kind: 'bridge', x: bp.x, y: bp.y, priority: 9 - idx, label: 'Мостовой узел' });
  });

  entryAngles.forEach((angle, idx) => {
    if (walled) {
      const r = wallRadii(wallRings[0]);
      const gx = between(Math.round(center.x + Math.cos(angle) * r.x), 2, w - 3);
      const gy = between(Math.round(center.y + Math.sin(angle) * r.y), 2, h - 3);
      nodes.push({ id: `gate_${idx}`, kind: 'gate', x: gx, y: gy, priority: 9, label: `Ворота ${idx + 1}` });
    } else {
      const ep = rayToEdge(center, angle, w, h);
      const gx = between(Math.round(ep.x), 2, w - 3);
      const gy = between(Math.round(ep.y), 2, h - 3);
      nodes.push({ id: `entry_${idx}`, kind: 'gate', x: gx, y: gy, priority: 8, label: `Въезд ${idx + 1}` });
    }
  });

  return {
    origin,
    center,
    RX,
    RY,
    reach,
    footprintAt,
    urbanZoneAt,
    densityField,
    walls: { walled, wallRings, wallRadii, wallAt, insideWalls, hasRemnantWall },
    keepBox,
    keepFree,
    paradeBox,
    entryAngles,
    nodes,
    reserved,
  };
}

function wdScore(d: number, idealLo: number, idealHi: number): number {
  if (d >= idealLo && d <= idealHi) return 1.2;
  if (d < idealLo) return -.8 * (idealLo - d);
  return Math.max(-.6, 1.2 - (d - idealHi) * .12);
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rayToEdge(from: Point, angle: number, w: number, h: number): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 1e-4) t = Math.min(t, (w - 2 - from.x) / dx);
  if (dx < -1e-4) t = Math.min(t, (1 - from.x) / dx);
  if (dy > 1e-4) t = Math.min(t, (h - 2 - from.y) / dy);
  if (dy < -1e-4) t = Math.min(t, (1 - from.y) / dy);
  return { x: from.x + dx * t, y: from.y + dy * t };
}
