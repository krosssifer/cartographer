import { hash2 } from '../../random';
import type { Point, Selection } from '../../types';
import {
  N4,
  between,
  unit,
  waterOnly,
  wet,
  type UrbanContext,
  type UrbanNode,
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
  reach: (x: number, y: number) => number;
  walls: WallSetup;
  keepBox?: Selection;
  keepFree: boolean;
  paradeBox?: Selection;
  entryAngles: number[];
  nodes: UrbanNode[];
  reserved: Uint8Array;
}

export function buildUrbanSkeleton(ctx: UrbanContext): UrbanSkeleton {
  const { width: w, height: h, seed, type, character, geo, small } = ctx;
  const { cells, waterDist, slope, geography, shoreDepth, span, length, at, crossingCandidates } = geo;

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const usable = (x: number, y: number) =>
    inside(x, y) && !wet(cells[y][x].terrain) && cells[y][x].terrain !== 'rock' && cells[y][x].terrain !== 'wall';

  const marginX = Math.max(3, Math.round(w * .14));
  const marginY = Math.max(3, Math.round(h * .14));
  const land: Point[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (usable(x, y)) land.push({ x, y });
    }
  }

  // ---- 1. Точка основания (ORIGIN) ------------------------------------------
  let origin: Point = { x: Math.round(w / 2), y: Math.round(h / 2) };
  let bestOriginScore = -Infinity;

  const targetCoast = geography === 'coast'
    ? at(length * (.42 + hash2(seed, 1, 0xce) * .16), shoreDepth + Math.max(3, (span - shoreDepth) * .18))
    : undefined;
  const targetMountain = geography === 'mountain'
    ? at(length * (.38 + hash2(seed, 2, 0xce) * .24), geo.terraceShelves[0] ?? Math.round(span * .44))
    : undefined;
  const bridgeAnchor = crossingCandidates[0];

  for (let y = marginY; y < h - marginY; y += 2) {
    for (let x = marginX; x < w - marginX; x += 2) {
      if (!usable(x, y)) continue;
      const idx = id(x, y);
      const sl = slope[idx];
      if (sl > .18) continue;
      const centerBias = 1 - Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) * .55;
      let sc = centerBias * 1.4 - sl * 4 + (hash2(x, y, seed + 0x51a) - .5) * .28;

      if (geography === 'coast' && targetCoast) {
        const wd = waterDist[idx];
        sc += wd >= 2 && wd <= 7 ? 2.2 - Math.abs(wd - 4) * .25 : -Math.abs(wd - 5) * .2;
        sc -= Math.hypot(x - targetCoast.x, y - targetCoast.y) / Math.max(w, h) * 1.6;
      } else if (geography === 'mountain' && targetMountain) {
        sc -= Math.hypot(x - targetMountain.x, y - targetMountain.y) / Math.max(w, h) * 2.1;
        sc += (1 - sl * 6) * .8;
      } else if (type.keep || character.id === 'military' || character.id === 'religious') {
        sc += cells[y][x].height * 1.8;
      } else if (bridgeAnchor && (type.id === 'trade_town' || type.id === 'craft_town' || character.id === 'trade')) {
        const dBridge = Math.hypot(x - bridgeAnchor.x, y - bridgeAnchor.y);
        sc += wdScore(waterDist[idx], 4, 11) + Math.max(0, 1.4 - dBridge / (Math.min(w, h) * .35));
      } else if (waterDist[idx] < 999) {
        sc += wdScore(waterDist[idx], 5, 14) * .65;
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

  // ---- 2. Городской центр (CENTER) ------------------------------------------
  // В порту точка основания у самой набережной, а административно-торговый
  // центр сдвигается чуть вглубь суши (порт → набережная → рынок → площадь → центр).
  // На равнине с рекой у края центр держится на основном сухом берегу.
  const preferredCenter: Point = (() => {
    if (geography === 'coast') {
      const inland = at(
        geo.along(origin.x, origin.y),
        Math.min(span - 5, Math.max(shoreDepth + Math.round((span - shoreDepth) * .36), geo.fromEdge(origin.x, origin.y) + 4)),
      );
      return { x: between(Math.round(inland.x), 4, w - 5), y: between(Math.round(inland.y), 4, h - 5) };
    }
    if (geography === 'mountain') {
      const shelf = geo.terraceShelves[Math.min(1, geo.terraceShelves.length - 1)] ?? Math.round(span * .46);
      const p = at(geo.along(origin.x, origin.y), shelf);
      return { x: between(Math.round((origin.x + p.x) / 2), 4, w - 5), y: between(Math.round((origin.y + p.y) / 2), 4, h - 5) };
    }
    // Для укреплённого города держим центр ближе к середине суши, чтобы кольцо стен не прижималось к краю.
    const pull = type.walls !== 'none' ? .55 : .32;
    const riverShiftX = geo.river.length && geo.river[0].x > w * .6 ? w * .43 : geo.river.length && geo.river[0].x < w * .4 ? w * .57 : w * .5;
    return {
      x: Math.round(origin.x * (1 - pull) + riverShiftX * pull),
      y: Math.round(origin.y * (1 - pull) + (h * .5) * pull),
    };
  })();

  let center = { x: preferredCenter.x, y: preferredCenter.y };
  if (!usable(center.x, center.y) && land.length) {
    center = land.reduce((best, p) =>
      Math.hypot(p.x - preferredCenter.x, p.y - preferredCenter.y)
      < Math.hypot(best.x - preferredCenter.x, best.y - preferredCenter.y) ? p : best,
    land[0]);
  }

  // Радиусы застроенной области.
  const minRX = type.walls !== 'none' ? Math.min(w / 2 - 2, 11) : 5;
  const minRY = type.walls !== 'none' ? Math.min(h / 2 - 2, 9) : 4;
  const RX = Math.max(minRX, (w / 2) * type.extent);
  const RY = Math.max(minRY, (h / 2) * type.extent);
  const reach = (x: number, y: number) => Math.hypot((x - center.x) / RX, (y - center.y) / RY);

  // ---- 3. Стены и укрепления ------------------------------------------------
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
    wallRings.push(.92);
    const innerKeep = type.keep && Math.min(RX, RY) >= 12;
    if (innerKeep) {
      wallRings.push(.46);
    } else if (
      !ctx.tight
      && Math.min(RX, RY) >= 16
      && (character.id === 'ancient' || (type.id === 'large_city' && character.anomalyRate >= .45))
    ) {
      // Историческая аномалия: фрагменты старой внутренней стены вокруг древнего ядра!
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
          // Оставляем лишь 2 короткие дуги старой стены (~30% окружности), чтобы не мешать застройке.
          const ang = Math.atan2(y - center.y, x - center.x);
          const wave = Math.cos((ang - arcPhase) * 2);
          if (wave < .58) continue;
        }
        cells[y][x].terrain = 'wall';
      }
    }
  }

  const insideWalls = (x: number, y: number) => !walled || wallAt(wallRings[0], x, y) < 1;

  // ---- 4. Цитадель и плац (для крепости) ------------------------------------
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
    // Плац перед входом в цитадель (южная или северная сторона, где есть место).
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

  // ---- 5. Главные внешние направления (Уровень 1: въезды/тракты) ------------
  // Выбираем углы въездов с учётом географии: не ведём сухопутный тракт прямо в открытое море или скальный гребень.
  const desiredExits = type.id === 'small_village' ? 2
    : type.id === 'frontier_outpost' || type.id === 'fortress' ? (small ? 2 : 3)
    : ctx.town ? (type.id === 'large_city' ? 4 : 3 + (hash2(seed, 7, 0xe1) > .55 ? 1 : 0))
    : 3;

  const candidateAngles: { angle: number; score: number }[] = [];
  const samples = 16;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2 + (hash2(i, 3, seed + 0x77) - .5) * .16;
    const edgePt = rayToEdge(center, a, w, h);
    const ex = between(Math.round(edgePt.x), 1, w - 2);
    const ey = between(Math.round(edgePt.y), 1, h - 2);
    const midX = between(Math.round((center.x + ex) / 2), 1, w - 2);
    const midY = between(Math.round((center.y + ey) / 2), 1, h - 2);

    // Море и скальная стена на краю блокируют внешний тракт.
    if (geography === 'coast' && waterOnly(cells[ey][ex].terrain)) continue;
    if (cells[ey][ex].terrain === 'rock' && cells[midY][midX].terrain === 'rock') continue;

    let sc = 1.0;
    // Тяготение к переправам через реку: дорога идёт через мост!
    if (crossingCandidates.length) {
      const bridgeAngle = Math.atan2(crossingCandidates[0].y - center.y, crossingCandidates[0].x - center.x);
      const diff = Math.abs(angleDiff(a, bridgeAngle));
      if (diff < .42) sc += 1.5 - diff;
    }
    // В линейных/прибрежных/горных поселениях главные въезды идут вдоль горизонтали/берега.
    if (geography !== 'plain') {
      const alongAngle = geo.side <= 1 ? 0 : Math.PI / 2;
      const d1 = Math.abs(angleDiff(a, alongAngle));
      const d2 = Math.abs(angleDiff(a, alongAngle + Math.PI));
      if (Math.min(d1, d2) < .45) sc += 1.3;
    } else if (ctx.layout === 'grid' || character.id === 'military') {
      // Военные и сеточные города предпочитают кардинальные оси.
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
  // Fallback если берег/горы сильно ограничили углы.
  if (entryAngles.length < 2) {
    for (const cand of candidateAngles) {
      if (entryAngles.length >= 2) break;
      if (entryAngles.some((other) => Math.abs(angleDiff(cand.angle, other)) < .65)) continue;
      entryAngles.push(cand.angle);
    }
  }

  // ---- 6. Граф городских узлов (URBAN NODES) --------------------------------
  const nodes: UrbanNode[] = [
    { id: 'origin', kind: 'origin', x: origin.x, y: origin.y, priority: 10, label: 'Основание' },
  ];
  if (Math.hypot(center.x - origin.x, center.y - origin.y) >= 3) {
    nodes.push({ id: 'center', kind: 'center', x: center.x, y: center.y, priority: 10, label: 'Центр города' });
  } else {
    nodes[0] = { id: 'center', kind: 'center', x: center.x, y: center.y, priority: 10, label: 'Старый центр' };
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
    nodes.push({ id: `bridge_${idx}`, kind: 'bridge', x: bp.x, y: bp.y, priority: 9 - idx, label: 'Переправа' });
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
  if (d >= idealLo && d <= idealHi) return 1.1;
  if (d < idealLo) return -0.4 * (idealLo - d);
  return Math.max(0, 1.1 - (d - idealHi) * 0.08);
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rayToEdge(from: Point, angle: number, w: number, h: number): Point {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const tx = dx > 0 ? (w + 1 - from.x) / dx : dx < 0 ? (-2 - from.x) / dx : Infinity;
  const ty = dy > 0 ? (h + 1 - from.y) / dy : dy < 0 ? (-2 - from.y) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: from.x + dx * t, y: from.y + dy * t };
}
