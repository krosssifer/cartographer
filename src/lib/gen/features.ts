// Сюжетные постройки сцен-архетипов: лагерь, руины, кладбище, вход в пещеру…
//
// Каждая постройка собирается из уже существующих объектов редактора —
// предметов склепа (cryptKit), городских объектов (settlementKit), зданий,
// руин-структур и сундуков. Поэтому всё сгенерированное здесь остаётся
// обычными редактируемыми объектами: их можно двигать, удалять, менять размер.
//
// Правила композиции внутри постройки: ни одного равномерного шага — углы,
// отступы и пропуски берутся с джиттером; одна сторона (подход) остаётся
// открытой; крупное ставится раньше мелкого, мелочь — у крупного.

import { CRYPT } from '../cryptKit';
import { CIVIC_KIT, intersects } from '../settlementKit';
import { rotatedSize } from '../objectGeometry';
import type {
  Biome,
  Building,
  Cell,
  Chest,
  ChestRotation,
  CivicKind,
  CivicObject,
  CryptKind,
  CryptObject,
  Point,
  RoofMaterial,
  Selection,
  Structure,
  Terrain,
  Tree,
} from '../types';
import type { FeatureId } from './archetypes';
import type { Bridge } from './plan';
import type { SeededRandom } from './random';

export interface FeatureSite {
  x: number;
  y: number;
  radius: number;
}

export interface FeatureContext {
  width: number;
  height: number;
  biome: Biome;
  cells: Cell[][];
  rng: SeededRandom;
  focal: FeatureSite;
  secondary: FeatureSite[];
  /** Направление (рад) от фокуса к подходу: дорога или ближайший край. */
  approach: number;
  /** Осевая линия дороги (может быть пустой). */
  road: Point[];
  bridges: Bridge[];
}

export interface FeatureResult {
  structures: Structure[];
  buildings: Building[];
  civic: CivicObject[];
  crypt: CryptObject[];
  chests: Chest[];
  /** Деревья, которые постройка добавляет сама (гигантское дерево, сухостой). */
  trees: Tree[];
  bridges: Bridge[];
  /** Прямоугольники, где растительность не нужна (постройки и их обвязка). */
  footprints: Selection[];
  notes: string[];
}

const ROTATIONS: ChestRotation[] = [0, 90, 180, 270];
const HARD: ReadonlySet<Terrain> = new Set<Terrain>(['water', 'deepWater', 'rock', 'wall', 'door', 'void', 'caveWall', 'buildingWall', 'roof', 'bridge', 'ice']);
const PAVED: ReadonlySet<Terrain> = new Set<Terrain>(['road', 'bridge']);

interface PlaceOptions {
  /** Разрешить ставить на полотно дороги (обломки каравана, бревно поперёк). */
  road?: boolean;
  /** Разрешить скалу под объектом (вход в пещеру, осыпь у обрыва). */
  rock?: boolean;
  /** Отступ от других объектов в клетках. */
  gap?: number;
}

/** Набор операций размещения с проверкой занятости и грунта. */
function createStamper(ctx: FeatureContext, out: FeatureResult) {
  const { width, height, cells, rng } = ctx;
  const ground: Terrain = ctx.biome === 'desert' ? 'sand' : ctx.biome === 'snow' ? 'snow' : ctx.biome === 'swamp' ? 'mud' : 'grass';
  const taken: Selection[] = [];

  const terrainAt = (x: number, y: number): Terrain | undefined => cells[y]?.[x]?.terrain;
  const inside = (rect: Selection): boolean => rect.x >= 1 && rect.y >= 1 && rect.x + rect.w <= width - 1 && rect.y + rect.h <= height - 1;
  const groundOk = (rect: Selection, options: PlaceOptions, wallFace = false): boolean => {
    for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y += 1) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x += 1) {
        const terrain = terrainAt(x, y);
        if (terrain === undefined) return false;
        if (wallFace) {
          if (terrain !== 'wall') return false;
          continue;
        }
        if (terrain === 'rock' && options.rock) continue;
        if (PAVED.has(terrain) && options.road && terrain !== 'bridge') continue;
        if (HARD.has(terrain) || PAVED.has(terrain)) return false;
      }
    }
    return true;
  };
  const free = (rect: Selection, options: PlaceOptions = {}, wallFace = false): boolean =>
    inside(rect) && groundOk(rect, options, wallFace) && !taken.some((other) => intersects(other, rect, options.gap ?? 0));
  const reserve = (rect: Selection): void => {
    taken.push(rect);
    out.footprints.push(rect);
  };

  const crypt = (kind: CryptKind, cx: number, cy: number, rotation: ChestRotation = 0, options: PlaceOptions = {}): boolean => {
    const spec = CRYPT[kind];
    const { w, h } = rotatedSize(spec, rotation);
    const rect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
    if (!free(rect, options, spec.placement === 'wallFace')) return false;
    // Осыпь у обрыва стоит на щебне, а не на самой скале: предметы склепа под
    // открытым небом допустимы только на грунте (cryptGround).
    if (options.rock) {
      for (let y = rect.y; y < rect.y + h; y += 1) for (let x = rect.x; x < rect.x + w; x += 1) if (terrainAt(x, y) === 'rock') paint(x, y, 'dirt', true);
    }
    out.crypt.push({ ...rect, kind, rotation, variant: rng.int(0, 3), source: 'layout' });
    reserve(rect);
    return true;
  };

  const civic = (kind: CivicKind, cx: number, cy: number, rotation: ChestRotation = 0, options: PlaceOptions = {}): boolean => {
    const { w, h } = rotatedSize(CIVIC_KIT[kind], rotation);
    const rect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
    if (!free(rect, options)) return false;
    out.civic.push({ ...rect, kind, rotation, variant: 0, source: 'layout' });
    reserve(rect);
    return true;
  };

  const chest = (cx: number, cy: number, kind: Chest['kind'] = 'wooden'): boolean => {
    const rect = { x: Math.floor(cx), y: Math.floor(cy), w: 1, h: 1 };
    if (!free(rect)) return false;
    out.chests.push({ x: rect.x + 0.5, y: rect.y + 0.5, rotation: ROTATIONS[rng.int(0, 3)], kind });
    reserve(rect);
    return true;
  };

  const paint = (x: number, y: number, terrain: Terrain, force = false): void => {
    const cell = cells[y]?.[x];
    if (!cell) return;
    if (!force && (HARD.has(cell.terrain) || PAVED.has(cell.terrain))) return;
    cell.terrain = terrain;
  };

  /** Пятно грунта неправильной формы (вытоптанная земля, воронка, площадка). */
  const blob = (cx: number, cy: number, radius: number, terrain: Terrain, roughness = 0.35): void => {
    const phase = rng.range(0, Math.PI * 2);
    const lobes = rng.int(3, 5);
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y += 1) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
        const angle = Math.atan2(y - cy, x - cx);
        const edge = radius * (1 + Math.sin(angle * lobes + phase) * roughness * 0.5 + (rng.next() - 0.5) * roughness * 0.3);
        if (Math.hypot(x - cx, y - cy) <= edge) paint(x, y, terrain);
      }
    }
  };

  /**
   * Руина-структура: стены по периметру, пол внутри, затем осыпание — стены
   * рушатся (кроме углов), пол зарастает. Возвращает false, если не влезла.
   */
  /**
   * Ближайшее к желаемому место, куда влезает прямоугольник: точка, затем
   * кольца сдвигов до `reach` клеток. Постройка смещается, а не пропадает.
   */
  const fit = (x: number, y: number, w: number, h: number, reach: number): { x: number; y: number } | null => {
    for (let ring = 0; ring <= reach; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const rect = { x: x + dx, y: y + dy, w, h };
          if (inside(rect) && groundOk(rect, {}) && !taken.some((other) => intersects(other, rect, 1))) return { x: rect.x, y: rect.y };
        }
      }
    }
    return null;
  };

  const ruin = (wantX: number, wantY: number, w: number, h: number, decay: number, options: { keepDoor?: boolean; floor?: Terrain } = {}): boolean => {
    const spot = fit(wantX, wantY, w, h, 3);
    if (!spot) return false;
    const { x, y } = spot;
    const rect = { x, y, w, h };
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const border = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
        const corner = (xx === x || xx === x + w - 1) && (yy === y || yy === y + h - 1);
        if (border) {
          if (!corner && rng.chance(decay * 0.75)) paint(xx, yy, rng.chance(0.5) ? 'dirt' : ground, true);
          else paint(xx, yy, 'wall', true);
        } else {
          paint(xx, yy, rng.chance(decay * 0.55) ? (rng.chance(0.5) ? 'dirt' : ground) : options.floor ?? 'floor', true);
        }
      }
    }
    if (options.keepDoor) {
      // Проём со стороны подхода: стена на этой стороне получает дверь-пролом.
      const side = Math.round(((ctx.approach + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
      const door = side === 0 ? { x: x + w - 1, y: y + Math.floor(h / 2) }
        : side === 1 ? { x: x + Math.floor(w / 2), y: y + h - 1 }
          : side === 2 ? { x, y: y + Math.floor(h / 2) }
            : { x: x + Math.floor(w / 2), y };
      paint(door.x, door.y, 'dirt', true);
    }
    out.structures.push({ x, y, w, h, ruin: true });
    reserve(rect);
    return true;
  };

  /** Здание с крышей (целое): дом торговца, казарма. */
  const building = (kind: Building['kind'], wantX: number, wantY: number, w: number, h: number, facing: ChestRotation, roof: RoofMaterial): boolean => {
    const spot = fit(wantX, wantY, w, h, 5);
    if (!spot) return false;
    const { x, y } = spot;
    const rect = { x, y, w, h };
    const door = facing === 0 ? { x: x + Math.floor(w / 2), y: y + h - 1 }
      : facing === 90 ? { x, y: y + Math.floor(h / 2) }
        : facing === 180 ? { x: x + w - 1 - Math.floor(w / 2), y }
          : { x: x + w - 1, y: y + h - 1 - Math.floor(h / 2) };
    out.buildings.push({ x, y, w, h, style: roof < 2 || roof === 7 ? 'village' : 'town', kind, roof, shape: rng.chance(0.6) ? 'gable' : 'hip', source: 'layout', door, facing });
    reserve(rect);
    return true;
  };

  /** Перебор точек по дуге с джиттером: ни одного равного шага. */
  const arc = (cx: number, cy: number, count: number, radius: [number, number], start: number, spread: number, place: (x: number, y: number, angle: number) => boolean, tries = 3): number => {
    let placed = 0;
    const step = spread / Math.max(1, count);
    for (let index = 0; index < count; index += 1) {
      for (let attempt = 0; attempt < tries; attempt += 1) {
        const angle = start + step * (index + 0.5) + rng.range(-step * 0.38, step * 0.38);
        const distance = rng.range(radius[0], radius[1]);
        if (place(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, angle)) {
          placed += 1;
          break;
        }
      }
    }
    return placed;
  };

  /** Россыпь вокруг точки (мелочь у крупного объекта). */
  const scatter = (cx: number, cy: number, count: number, radius: [number, number], place: (x: number, y: number) => boolean, tries = 4): number => {
    let placed = 0;
    for (let index = 0; index < count * tries && placed < count; index += 1) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = rng.range(radius[0], radius[1]);
      if (place(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance)) placed += 1;
    }
    return placed;
  };

  return { ground, terrainAt, free, reserve, crypt, civic, chest, paint, blob, ruin, building, arc, scatter };
}

type Stamper = ReturnType<typeof createStamper>;

/** Поворот объекта, чтобы длинная сторона шла по направлению angle. */
const alongRotation = (angle: number): ChestRotation => (Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? 0 : 90);
const acrossRotation = (angle: number): ChestRotation => (alongRotation(angle) === 0 ? 90 : 0);

/** Ближайшая точка дороги и направление полотна в ней. */
function roadNear(road: Point[], x: number, y: number): { point: Point; index: number; angle: number } | null {
  if (road.length < 3) return null;
  let index = 0;
  let best = Infinity;
  road.forEach((point, i) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < best) {
      best = distance;
      index = i;
    }
  });
  const before = road[Math.max(0, index - 3)];
  const after = road[Math.min(road.length - 1, index + 3)];
  return { point: road[index], index, angle: Math.atan2(after.y - before.y, after.x - before.x) };
}

/** Прямоугольник ограды из сегментов marketFence с проёмом в сторону angle. */
function fenceRing(s: Stamper, ctx: FeatureContext, x: number, y: number, w: number, h: number, gateAngle: number, missing: number): number {
  const segments: { cx: number; cy: number; rotation: ChestRotation; side: number }[] = [];
  for (let sx = x; sx + 2 <= x + w; sx += 2) {
    segments.push({ cx: sx + 1, cy: y + 0.5, rotation: 0, side: 3 });
    segments.push({ cx: sx + 1, cy: y + h - 0.5, rotation: 0, side: 1 });
  }
  for (let sy = y + 1; sy + 2 <= y + h - 1; sy += 2) {
    segments.push({ cx: x + 0.5, cy: sy + 1, rotation: 90, side: 2 });
    segments.push({ cx: x + w - 0.5, cy: sy + 1, rotation: 90, side: 0 });
  }
  const gateSide = Math.round(((gateAngle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  let placed = 0;
  for (const segment of segments) {
    // Ворота: середина стороны подхода остаётся открытой.
    if (segment.side === gateSide && Math.hypot(segment.cx - (gateSide % 2 === 0 ? segment.cx : centerX), segment.cy - (gateSide % 2 === 0 ? centerY : segment.cy)) < 2.2) continue;
    if (ctx.rng.chance(missing)) continue;
    if (s.civic('marketFence', segment.cx, segment.cy, segment.rotation)) placed += 1;
  }
  return placed;
}

/** Стена из клеток wall по периметру прямоугольника, с проломами и воротами. */
function wallRing(s: Stamper, ctx: FeatureContext, x: number, y: number, w: number, h: number, breaches: number, gateAngle: number): Point {
  const perimeter: Point[] = [];
  for (let xx = x; xx < x + w; xx += 1) perimeter.push({ x: xx, y }, { x: xx, y: y + h - 1 });
  for (let yy = y + 1; yy < y + h - 1; yy += 1) perimeter.push({ x, y: yy }, { x: x + w - 1, y: yy });
  for (const point of perimeter) s.paint(point.x, point.y, 'wall', true);
  // Угловые башни 3×3: стены с полом внутри.
  const corners: Point[] = [{ x: x - 1, y: y - 1 }, { x: x + w - 2, y: y - 1 }, { x: x - 1, y: y + h - 2 }, { x: x + w - 2, y: y + h - 2 }];
  for (const corner of corners) {
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const px = corner.x + dx;
        const py = corner.y + dy;
        if (px < 0 || py < 0 || px >= ctx.width || py >= ctx.height) continue;
        s.paint(px, py, dx === 1 && dy === 1 ? 'floor' : 'wall', true);
      }
    }
  }
  // Ворота — в середине стороны подхода, ширина 2.
  const side = Math.round(((gateAngle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
  const gate = side === 0 ? { x: x + w - 1, y: y + Math.floor(h / 2) - 1 }
    : side === 1 ? { x: x + Math.floor(w / 2) - 1, y: y + h - 1 }
      : side === 2 ? { x, y: y + Math.floor(h / 2) - 1 }
        : { x: x + Math.floor(w / 2) - 1, y };
  const vertical = side === 0 || side === 2;
  for (let k = 0; k < 2; k += 1) s.paint(gate.x + (vertical ? 0 : k), gate.y + (vertical ? k : 0), 'dirt', true);
  // Проломы: 1–3 клетки, не у ворот и не у углов, на разных сторонах.
  for (let index = 0; index < breaches; index += 1) {
    const point = perimeter[ctx.rng.int(0, perimeter.length - 1)];
    const nearCorner = (point.x - x < 3 || x + w - 1 - point.x < 3) && (point.y - y < 3 || y + h - 1 - point.y < 3);
    if (nearCorner || Math.hypot(point.x - gate.x, point.y - gate.y) < 4) continue;
    const length = ctx.rng.int(1, 3);
    const horizontalSide = point.y === y || point.y === y + h - 1;
    for (let k = 0; k < length; k += 1) s.paint(point.x + (horizontalSide ? k : 0), point.y + (horizontalSide ? 0 : k), 'dirt', true);
    s.crypt('rubblePile', point.x + (horizontalSide ? 0 : (point.x === x ? 1.5 : -0.5)) + 0.5, point.y + (horizontalSide ? (point.y === y ? 1.5 : -0.5) : 0) + 0.5);
  }
  return { x: gate.x + (vertical ? 0 : 1), y: gate.y + (vertical ? 1 : 0) };
}

/** Скальная стена у фокуса: ближайшая клетка скалы по направлению «назад». */
function cliffFace(ctx: FeatureContext): { x: number; y: number; angle: number } | null {
  let best: { x: number; y: number; angle: number; score: number } | null = null;
  const { focal } = ctx;
  for (let step = 0; step < 48; step += 1) {
    const angle = (step / 48) * Math.PI * 2;
    for (let distance = focal.radius * 0.6; distance <= focal.radius + 5; distance += 0.5) {
      const x = Math.round(focal.x + Math.cos(angle) * distance);
      const y = Math.round(focal.y + Math.sin(angle) * distance);
      const terrain = ctx.cells[y]?.[x]?.terrain;
      if (terrain === undefined) break;
      if (terrain !== 'rock') continue;
      // Глубина скалы за кромкой: вход в пещеру нужен в массиве, а не в одиночном камне.
      let depth = 0;
      for (let k = 1; k <= 4; k += 1) {
        if (ctx.cells[Math.round(y + Math.sin(angle) * k)]?.[Math.round(x + Math.cos(angle) * k)]?.terrain === 'rock') depth += 1;
      }
      const score = depth * 2 - distance * 0.3 - Math.abs(Math.cos(angle - ctx.approach - Math.PI)) * -0.5;
      if (!best || score > best.score) best = { x, y, angle, score };
      break;
    }
  }
  return best && best.score > 2 ? { x: best.x, y: best.y, angle: best.angle } : null;
}

/** Прорубает в скале ход шириной width и глубиной depth; возвращает клетки хода. */
function carveMouth(s: Stamper, ctx: FeatureContext, face: { x: number; y: number; angle: number }, width: number, depth: number, floor: Terrain): Point[] {
  const carved: Point[] = [];
  const dx = Math.cos(face.angle);
  const dy = Math.sin(face.angle);
  const nx = -dy;
  const ny = dx;
  for (let k = -1; k < depth; k += 1) {
    for (let w = 0; w < width; w += 1) {
      const offset = w - (width - 1) / 2;
      const x = Math.round(face.x + dx * k + nx * offset);
      const y = Math.round(face.y + dy * k + ny * offset);
      if (x < 1 || y < 1 || x >= ctx.width - 1 || y >= ctx.height - 1) continue;
      s.paint(x, y, floor, true);
      carved.push({ x, y });
    }
  }
  return carved;
}

// ---------------------------------------------------------------------------
// Постройки
// ---------------------------------------------------------------------------

type FeatureBuilder = (s: Stamper, ctx: FeatureContext, out: FeatureResult) => void;

const FEATURES: Record<FeatureId, FeatureBuilder> = {
  ambush_cover(s, ctx, out) {
    // Укрытия у обочины по обе стороны, несимметрично: с одной стороны больше.
    const near = roadNear(ctx.road, ctx.focal.x, ctx.focal.y);
    if (!near) return;
    const heavySide = ctx.rng.chance(0.5) ? 1 : -1;
    let placed = 0;
    for (let index = 0; index < 7; index += 1) {
      const side = ctx.rng.chance(0.68) ? heavySide : -heavySide;
      const along = ctx.rng.range(-ctx.focal.radius * 1.1, ctx.focal.radius * 1.1);
      const offset = ctx.rng.range(2.6, 4.2) * side;
      const nx = -Math.sin(near.angle);
      const ny = Math.cos(near.angle);
      const x = near.point.x + Math.cos(near.angle) * along + nx * offset;
      const y = near.point.y + Math.sin(near.angle) * along + ny * offset;
      const kind: CryptKind = ctx.rng.chance(0.4) ? 'boulder' : ctx.rng.chance(0.5) ? 'logs' : 'bushPatch';
      if (s.crypt(kind, x, y, alongRotation(near.angle), { gap: 1 })) placed += 1;
    }
    out.notes.push(`засада: укрытий у обочины ${placed}`);
  },

  fallen_trees(s, ctx, out) {
    const near = roadNear(ctx.road, ctx.focal.x, ctx.focal.y);
    let placed = 0;
    if (near) {
      // Один ствол поперёк полотна — дорога перекрыта, но обходится по обочине.
      const index = Math.min(ctx.road.length - 1, near.index + ctx.rng.int(-4, 4));
      const point = ctx.road[index];
      if (s.crypt('logs', point.x + 0.5, point.y + 0.5, acrossRotation(near.angle), { road: true })) placed += 1;
    }
    placed += s.scatter(ctx.focal.x, ctx.focal.y, 2, [ctx.focal.radius * 0.9, ctx.focal.radius + 3], (x, y) =>
      s.crypt('logs', x, y, ctx.rng.chance(0.5) ? 0 : 90, { gap: 1 }));
    out.notes.push(`поваленных стволов: ${placed}`);
  },

  giant_tree(s, ctx, out) {
    // Исполинский дуб в центре и корни, расходящиеся лучами (не по кругу).
    const { focal } = ctx;
    const x = focal.x + ctx.rng.range(-0.6, 0.6);
    const y = focal.y + ctx.rng.range(-0.6, 0.6);
    const kind = ctx.biome === 'snow' ? 'pine' : 'oak';
    const r = Math.min(1.9, Math.max(1.2, focal.radius * 0.32));
    out.trees.push({ x, y, r, kind, v: ctx.rng.next() });
    s.reserve({ x: Math.floor(x - 1), y: Math.floor(y - 1), w: 3, h: 3 });
    const roots = s.arc(x, y, ctx.rng.int(4, 6), [r * 1.6, r * 2.4], ctx.rng.range(0, Math.PI * 2), Math.PI * 2, (px, py) => s.crypt('roots', px, py));
    s.scatter(x, y, 3, [r * 2, r * 3.2], (px, py) => s.crypt('mossPatch', px, py));
    out.notes.push(`гигантское дерево, корней: ${roots}`);
  },

  flower_meadow(s, ctx, out) {
    // Разнотравье: пятна тёмной травы и кустики, гуще к краю поляны.
    const { focal } = ctx;
    for (let index = 0; index < 4; index += 1) {
      const angle = ctx.rng.range(0, Math.PI * 2);
      const distance = ctx.rng.range(0.2, 0.8) * focal.radius;
      s.blob(focal.x + Math.cos(angle) * distance, focal.y + Math.sin(angle) * distance, ctx.rng.range(1.2, 2.4), ctx.biome === 'snow' ? 'snow' : 'darkGrass');
    }
    const bushes = s.scatter(focal.x, focal.y, ctx.rng.int(4, 7), [focal.radius * 0.45, focal.radius * 1.05], (x, y) => s.crypt('bushPatch', x, y, 0, { gap: 1 }));
    const logs = s.scatter(focal.x, focal.y, 1, [focal.radius * 0.5, focal.radius * 0.9], (x, y) => s.crypt('logs', x, y, ctx.rng.chance(0.5) ? 0 : 90));
    out.notes.push(`разнотравье: кустов ${bushes}, брёвен ${logs}`);
  },

  boulder_field(s, ctx, out) {
    // Валуны группой у края фокуса (не в центре), мелочь — у крупных.
    const { focal } = ctx;
    const side = ctx.rng.range(0, Math.PI * 2);
    let placed = s.arc(focal.x, focal.y, ctx.rng.int(3, 5), [focal.radius * 0.75, focal.radius + 2.5], side, Math.PI * 0.9, (x, y) =>
      s.crypt(ctx.rng.chance(0.35) ? 'rockPile' : ctx.rng.chance(0.5) ? 'boulder' : 'scree', x, y, ctx.rng.chance(0.5) ? 0 : 90, { gap: 1, rock: true }));
    placed += s.scatter(focal.x + Math.cos(side) * focal.radius, focal.y + Math.sin(side) * focal.radius, 3, [1, 3], (x, y) => s.crypt('pebbles', x, y));
    out.notes.push(`валунов и осыпей: ${placed}`);
  },

  cave_mouth(s, ctx, out) {
    const face = cliffFace(ctx);
    if (!face) {
      out.notes.push('вход в пещеру: подходящей скальной стены нет');
      return;
    }
    const mouth = carveMouth(s, ctx, face, 3, 5, 'caveFloor');
    const back = { x: face.x + Math.cos(face.angle) * 3, y: face.y + Math.sin(face.angle) * 3 };
    s.crypt('stalagmites', back.x + 0.5, back.y + 0.5);
    s.crypt('bones', face.x + 0.5 - Math.cos(face.angle) * 1.5, face.y + 0.5 - Math.sin(face.angle) * 1.5);
    const nx = -Math.sin(face.angle);
    const ny = Math.cos(face.angle);
    for (const side of [-1, 1]) {
      s.crypt(ctx.rng.chance(0.5) ? 'scree' : 'rockPile', face.x + 0.5 - Math.cos(face.angle) * 1.2 + nx * side * 2.6, face.y + 0.5 - Math.sin(face.angle) * 1.2 + ny * side * 2.6, 0, { rock: true, gap: 0 });
    }
    s.reserve({ x: Math.min(...mouth.map((p) => p.x)), y: Math.min(...mouth.map((p) => p.y)), w: 1 + Math.max(...mouth.map((p) => p.x)) - Math.min(...mouth.map((p) => p.x)), h: 1 + Math.max(...mouth.map((p) => p.y)) - Math.min(...mouth.map((p) => p.y)) });
    out.notes.push(`зев пещеры прорублен на ${mouth.length} кл.`);
  },

  mine_entrance(s, ctx, out) {
    const face = cliffFace(ctx);
    if (!face) {
      out.notes.push('шахта: подходящей скальной стены нет');
      return;
    }
    const mouth = carveMouth(s, ctx, face, 2, 5, 'dirt');
    const fx = -Math.cos(face.angle);
    const fy = -Math.sin(face.angle);
    const nx = -Math.sin(face.angle);
    const ny = Math.cos(face.angle);
    // Крепь по бокам устья, рельсы выходят наружу, вагонетка у отвала.
    s.crypt('beamSupport', face.x + 0.5 + nx * 1.6, face.y + 0.5 + ny * 1.6, 0, { rock: true });
    s.crypt('beamSupport', face.x + 0.5 - nx * 1.4, face.y + 0.5 - ny * 1.4, 0, { rock: true });
    let rails = 0;
    for (let k = 1; k <= 6; k += 2) {
      if (s.crypt('mineRails', face.x + 0.5 + fx * k, face.y + 0.5 + fy * k, alongRotation(face.angle + Math.PI), { gap: 0 })) rails += 1;
    }
    s.crypt('mineCart', face.x + 0.5 + fx * 7.5 + nx * 1.5, face.y + 0.5 + fy * 7.5 + ny * 1.5, alongRotation(face.angle));
    // Отвалы породы в стороне, развалины сарая — с другой стороны.
    s.scatter(face.x + fx * 4 + nx * 4, face.y + fy * 4 + ny * 4, 3, [0, 2.2], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'rockPile' : 'scree', x, y, 0, { gap: 0 }));
    const shedX = Math.round(face.x + fx * 4 - nx * 6 - 2);
    const shedY = Math.round(face.y + fy * 4 - ny * 6 - 1);
    s.ruin(shedX, shedY, 4, 3, 0.45);
    s.scatter(face.x + fx * 3, face.y + fy * 3, 3, [1.5, 4], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'crateStack' : 'barrelStack', x, y));
    s.crypt('winch', face.x + 0.5 + fx * 2 - nx * 2.5, face.y + 0.5 + fy * 2 - ny * 2.5);
    out.notes.push(`штольня ${mouth.length} кл., рельсов ${rails}`);
  },

  dungeon_portal(s, ctx, out) {
    const face = cliffFace(ctx);
    if (!face) {
      out.notes.push('портал: подходящего склона нет');
      return;
    }
    const mouth = carveMouth(s, ctx, face, 3, 4, 'floor');
    const fx = -Math.cos(face.angle);
    const fy = -Math.sin(face.angle);
    const nx = -Math.sin(face.angle);
    const ny = Math.cos(face.angle);
    // Мощёная площадка перед порталом, колонны по бокам, ступени вниз в глубине.
    for (let k = 1; k <= 4; k += 1) {
      for (let w = -2; w <= 2; w += 1) {
        if (Math.abs(w) === 2 && k === 4) continue;
        const x = Math.round(face.x + fx * k + nx * w);
        const y = Math.round(face.y + fy * k + ny * w);
        if (ctx.rng.chance(0.82)) s.paint(x, y, 'floor');
      }
    }
    const inner = { x: face.x - fx * 2.5, y: face.y - fy * 2.5 };
    s.crypt('steps', inner.x + 0.5, inner.y + 0.5, alongRotation(face.angle) === 0 ? 90 : 0);
    for (const side of [-1, 1]) {
      s.crypt('pillar', face.x + 0.5 + fx * 0.6 + nx * side * 2, face.y + 0.5 + fy * 0.6 + ny * side * 2, 0, { rock: true });
      s.crypt(side < 0 ? 'pedestalStatue' : ctx.rng.chance(0.5) ? 'pedestalStatue' : 'rubble', face.x + 0.5 + fx * 3.5 + nx * side * 3, face.y + 0.5 + fy * 3.5 + ny * side * 3);
    }
    s.scatter(face.x + fx * 3, face.y + fy * 3, 3, [1, 3.5], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'crackedFloor' : 'rubble', x, y));
    out.notes.push(`портал подземелья: проход ${mouth.length} кл.`);
  },

  ruin_cluster(s, ctx, out) {
    const { focal } = ctx;
    // 2–3 руины разного размера вокруг двора; одна крупнее и ближе к центру.
    const count = ctx.rng.int(2, 3);
    let placed = 0;
    const base = ctx.rng.range(0, Math.PI * 2);
    for (let index = 0; index < count; index += 1) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const big = index === 0;
        const w = big ? ctx.rng.int(5, 7) : ctx.rng.int(3, 5);
        const h = big ? ctx.rng.int(4, 6) : ctx.rng.int(3, 4);
        const angle = base + index * ctx.rng.range(1.6, 2.6) + ctx.rng.range(-0.3, 0.3);
        const distance = big ? focal.radius * ctx.rng.range(0.2, 0.5) : focal.radius * ctx.rng.range(0.7, 1.1);
        const x = Math.round(focal.x + Math.cos(angle) * distance - w / 2);
        const y = Math.round(focal.y + Math.sin(angle) * distance - h / 2);
        if (s.ruin(x, y, w, h, big ? 0.35 : 0.55, { keepDoor: big })) {
          placed += 1;
          s.scatter(x + w / 2, y + h / 2, 3, [Math.max(w, h) * 0.5 + 0.6, Math.max(w, h) * 0.5 + 2], (px, py) => s.crypt(ctx.rng.chance(0.6) ? 'rubble' : 'rubblePile', px, py));
          break;
        }
      }
    }
    s.scatter(focal.x, focal.y, 2, [1, focal.radius * 0.8], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'pillar' : 'bust', x, y));
    out.notes.push(`руин: ${placed}`);
  },

  village_ruins(s, ctx, out) {
    const { focal } = ctx;
    const near = roadNear(ctx.road, focal.x, focal.y);
    const axis = near ? near.angle : ctx.approach + Math.PI / 2;
    const nx = -Math.sin(axis);
    const ny = Math.cos(axis);
    // Дома вдоль улицы с разными отступами, разной ширины, с пропусками.
    let houses = 0;
    let along = -focal.radius * 1.4;
    while (along < focal.radius * 1.4 && houses < 7) {
      const side = houses % 2 === 0 ? 1 : -1;
      const w = ctx.rng.int(4, 6);
      const h = ctx.rng.int(4, 5);
      const setback = ctx.rng.range(3.4, 5.2);
      const cx = focal.x + Math.cos(axis) * along + nx * side * (setback + h / 2);
      const cy = focal.y + Math.sin(axis) * along + ny * side * (setback + h / 2);
      if (!ctx.rng.chance(0.15) && s.ruin(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, ctx.rng.range(0.35, 0.65), { keepDoor: true })) {
        houses += 1;
        if (ctx.rng.chance(0.6)) s.scatter(cx, cy, 2, [3, 4.5], (x, y) => s.civic('marketFence', x, y, ctx.rng.chance(0.5) ? 0 : 90));
      }
      along += ctx.rng.range(3.5, 6.5);
    }
    s.civic('well', focal.x + nx * 1.5, focal.y + ny * 1.5);
    s.civic('cart', focal.x - Math.cos(axis) * 3 - nx * 2.2, focal.y - Math.sin(axis) * 3 - ny * 2.2, alongRotation(axis));
    s.scatter(focal.x, focal.y, 2, [2, focal.radius], (x, y) => s.civic(ctx.rng.chance(0.5) ? 'marketHay' : 'marketBarrelLying', x, y));
    out.notes.push(`разрушенных домов: ${houses}`);
  },

  fortress_ruin(s, ctx, out) {
    const { focal } = ctx;
    const w = Math.max(9, Math.round(focal.radius * 2 + ctx.rng.int(0, 2)));
    const h = Math.max(8, Math.round(focal.radius * 1.7 + ctx.rng.int(0, 2)));
    const x = Math.round(focal.x - w / 2);
    const y = Math.round(focal.y - h / 2);
    if (x < 2 || y < 2 || x + w > ctx.width - 2 || y + h > ctx.height - 2) {
      out.notes.push('крепость не помещается — оставлен двор');
      return;
    }
    for (let yy = y + 1; yy < y + h - 1; yy += 1) for (let xx = x + 1; xx < x + w - 1; xx += 1) s.paint(xx, yy, ctx.rng.chance(0.4) ? 'dirt' : s.ground, true);
    wallRing(s, ctx, x, y, w, h, ctx.rng.int(2, 4), ctx.approach);
    out.structures.push({ x, y, w, h, ruin: true });
    // Донжон — внутри, смещён от центра к задней стене.
    const back = { x: -Math.cos(ctx.approach), y: -Math.sin(ctx.approach) };
    const kw = ctx.rng.int(4, 5);
    const kh = ctx.rng.int(3, 4);
    s.ruin(Math.round(focal.x + back.x * (w / 2 - kw) - kw / 2), Math.round(focal.y + back.y * (h / 2 - kh) - kh / 2), kw, kh, 0.4, { keepDoor: true });
    s.scatter(focal.x, focal.y, 4, [1, Math.min(w, h) / 2 - 1.5], (px, py) => s.crypt(ctx.rng.chance(0.5) ? 'rubble' : 'collapse', px, py));
    s.reserve({ x, y, w, h });
    out.notes.push(`крепостные стены ${w}×${h}`);
  },

  temple_ruin(s, ctx, out) {
    const { focal } = ctx;
    const along = Math.abs(Math.cos(ctx.approach)) >= Math.abs(Math.sin(ctx.approach));
    const long = Math.max(8, Math.round(focal.radius * 2));
    const short = Math.max(6, Math.round(focal.radius * 1.3));
    const w = along ? long : short;
    const h = along ? short : long;
    const x = Math.round(focal.x - w / 2);
    const y = Math.round(focal.y - h / 2);
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) if (ctx.rng.chance(0.86)) s.paint(xx, yy, 'floor');
    // Колоннада по длинным сторонам: шаг 2, но часть колонн обрушена.
    let pillars = 0;
    const back = { x: -Math.cos(ctx.approach), y: -Math.sin(ctx.approach) };
    for (let k = 1; k < long - 1; k += 2) {
      for (const side of [0, 1]) {
        const px = along ? x + k : side ? x + w - 1 : x;
        const py = along ? (side ? y + h - 1 : y) : y + k;
        if (ctx.rng.chance(0.28)) {
          s.crypt('rubble', px + 0.5, py + 0.5);
          continue;
        }
        if (s.crypt('pillar', px + 0.5, py + 0.5)) pillars += 1;
      }
    }
    // Святилище: алтарь у задней стороны, жаровни по бокам, ступени у входа.
    const altar = { x: focal.x + back.x * (long / 2 - 2), y: focal.y + back.y * (long / 2 - 2) };
    s.crypt('altar', altar.x, altar.y, along ? 90 : 0);
    s.crypt('brazier', altar.x + (along ? 0 : 2), altar.y + (along ? 2 : 0));
    s.crypt('brazier', altar.x - (along ? 0 : 2), altar.y - (along ? 2 : 0));
    s.crypt('candles', altar.x - back.x * 1.5, altar.y - back.y * 1.5);
    const front = { x: focal.x - back.x * (long / 2 + 0.5), y: focal.y - back.y * (long / 2 + 0.5) };
    s.crypt('steps', front.x, front.y, along ? 0 : 90);
    s.scatter(focal.x, focal.y, 3, [1, short / 2], (px, py) => s.crypt(ctx.rng.chance(0.5) ? 'statue' : 'bust', px, py));
    s.reserve({ x, y, w, h });
    out.notes.push(`храм ${w}×${h}, колонн ${pillars}`);
  },

  broken_bridge(s, ctx, out) {
    const bridge = ctx.bridges[0];
    if (!bridge || bridge.cells.length < 1) {
      out.notes.push('разрушенный мост: переправы нет');
      return;
    }
    // Настил режем посередине: два обломанных пролёта у берегов.
    const dx = Math.cos(bridge.angle);
    const dy = Math.sin(bridge.angle);
    const projections = bridge.cells.map((cell) => (cell.x + 0.5 - bridge.x) * dx + (cell.y + 0.5 - bridge.y) * dy);
    const min = Math.min(...projections);
    const max = Math.max(...projections);
    // Короткая переправа рушится целиком: от моста остаются причалы-обломки
    // на берегах. Длинная — теряет средний пролёт.
    const gapHalf = max - min >= 2 ? Math.max(0.6, (max - min) * 0.2) : (max - min) / 2 + 0.6;
    const keepA = bridge.cells.filter((_, index) => projections[index] < -gapHalf);
    const keepB = bridge.cells.filter((_, index) => projections[index] > gapHalf);
    bridge.cells.forEach((cell, index) => {
      if (Math.abs(projections[index]) <= gapHalf) s.paint(cell.x, cell.y, 'water', true);
    });
    const stub = (cells: Point[], sign: number): Bridge => {
      const reach = (bridge.length / 2 - gapHalf);
      const length = Math.max(1.2, reach);
      const center = sign * (gapHalf + length / 2);
      return { ...bridge, id: `${bridge.id}_${sign < 0 ? 'a' : 'b'}`, x: bridge.x + dx * center, y: bridge.y + dy * center, length, cells };
    };
    const stubs = [stub(keepA, -1), stub(keepB, 1)];
    out.bridges.splice(out.bridges.indexOf(bridge), 1, ...stubs);
    // Обломки на берегах.
    for (const sign of [-1, 1]) {
      const bx = bridge.x + dx * sign * (bridge.length / 2 + 1.2);
      const by = bridge.y + dy * sign * (bridge.length / 2 + 1.2);
      s.scatter(bx, by, 2, [1, 2.5], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'logs' : 'rubble', x, y, alongRotation(bridge.angle)));
    }
    out.notes.push(`мост разрушен: пролом ${Math.round(gapHalf * 2)} кл.`);
  },

  boardwalks(s, ctx, out) {
    // Гати: соединяем крупные острова кратчайшими перемычками над мелководьем.
    const { width, height, cells } = ctx;
    const land = new Int32Array(width * height).fill(-1);
    const islands: Point[][] = [];
    for (let start = 0; start < width * height; start += 1) {
      const sx = start % width;
      const sy = (start - sx) / width;
      const terrain = cells[sy][sx].terrain;
      if (land[start] >= 0 || terrain === 'water' || terrain === 'deepWater') continue;
      const part: Point[] = [{ x: sx, y: sy }];
      land[start] = islands.length;
      for (let head = 0; head < part.length; head += 1) {
        const { x, y } = part[head];
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          const t = cells[ny][nx].terrain;
          if (land[next] >= 0 || t === 'water' || t === 'deepWater') continue;
          land[next] = islands.length;
          part.push({ x: nx, y: ny });
        }
      }
      islands.push(part);
    }
    const big = islands.map((part, id) => ({ part, id })).filter((item) => item.part.length >= 6).sort((a, b) => b.part.length - a.part.length).slice(0, 8);
    if (big.length < 2) return;
    // Прим: присоединяем ближайший остров к уже связанным.
    const linked = [big[0]];
    const rest = big.slice(1);
    let walks = 0;
    while (rest.length) {
      let best: { from: Point; to: Point; distance: number; index: number } | null = null;
      for (let index = 0; index < rest.length; index += 1) {
        for (const a of linked) {
          for (let i = 0; i < a.part.length; i += 2) {
            for (let j = 0; j < rest[index].part.length; j += 2) {
              const p = a.part[i];
              const q = rest[index].part[j];
              if (p.x !== q.x && p.y !== q.y) continue;
              const distance = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
              if (!best || distance < best.distance) best = { from: p, to: q, distance, index };
            }
          }
        }
      }
      if (!best) break;
      const target = rest.splice(best.index, 1)[0];
      linked.push(target);
      if (best.distance > 9) continue;
      const stepX = Math.sign(best.to.x - best.from.x);
      const stepY = Math.sign(best.to.y - best.from.y);
      for (let k = 1; k < best.distance; k += 1) {
        const x = best.from.x + stepX * k;
        const y = best.from.y + stepY * k;
        const terrain = cells[y][x].terrain;
        if (terrain === 'water' || terrain === 'deepWater') s.paint(x, y, 'bridge', true);
      }
      walks += 1;
    }
    out.notes.push(`гатей между островами: ${walks}`);
  },

  camp_tents(s, ctx, out) {
    const { focal } = ctx;
    // Кострище со смещением от центра, шатры дугой с открытой стороной к подходу.
    const fire = { x: focal.x + ctx.rng.range(-1, 1), y: focal.y + ctx.rng.range(-1, 1) };
    s.blob(fire.x, fire.y, Math.max(1.6, focal.radius * 0.45), 'dirt', 0.5);
    s.crypt('pyre', fire.x, fire.y);
    s.arc(fire.x, fire.y, 3, [1.6, 2.2], ctx.rng.range(0, Math.PI * 2), Math.PI * 2, (x, y, angle) => s.crypt('logs', x, y, acrossRotation(angle)));
    const tents: CivicKind[] = ['marketTentRound', 'marketTentPatch', 'marketTentBurlap', 'marketTentCanopy', 'marketTentBrown'];
    const opening = ctx.rng.range(1.1, 1.6);
    const placed = s.arc(fire.x, fire.y, ctx.rng.int(3, 5), [focal.radius * 0.62, focal.radius * 0.95], ctx.approach + opening / 2, Math.PI * 2 - opening, (x, y) =>
      s.civic(tents[ctx.rng.int(0, tents.length - 1)], x, y, ROTATIONS[ctx.rng.int(0, 3)], { gap: 0 }), 5);
    // Добыча — кучей у одного из шатров, а не вразброс.
    const loot = { x: fire.x - Math.cos(ctx.approach) * focal.radius * 0.5, y: fire.y - Math.sin(ctx.approach) * focal.radius * 0.5 };
    s.scatter(loot.x, loot.y, 3, [0.6, 2], (x, y) => s.crypt(ctx.rng.chance(0.4) ? 'crateStack' : ctx.rng.chance(0.5) ? 'barrelStack' : 'sackPile', x, y));
    s.scatter(loot.x, loot.y, 1, [0.8, 2.2], (x, y) => s.chest(x, y, 'wooden'));
    out.notes.push(`лагерь: шатров ${placed}`);
  },

  palisade(s, ctx, out) {
    const { focal } = ctx;
    const w = Math.max(8, Math.round(focal.radius * 2.3 / 2) * 2);
    const h = Math.max(6, Math.round(focal.radius * 1.9 / 2) * 2);
    const x = Math.round(focal.x - w / 2);
    const y = Math.round(focal.y - h / 2);
    const placed = fenceRing(s, ctx, x, y, w, h, ctx.approach, 0.06);
    // Дозорный пост у ворот.
    const gate = { x: focal.x + Math.cos(ctx.approach) * (Math.min(w, h) / 2 - 1.5), y: focal.y + Math.sin(ctx.approach) * (Math.min(w, h) / 2 - 1.5) };
    s.crypt('brazierStand', gate.x + 1.5, gate.y + 0.5);
    s.civic('marketHay', focal.x - Math.cos(ctx.approach) * (h / 2 - 2), focal.y - Math.sin(ctx.approach) * (h / 2 - 2));
    out.notes.push(`частокол: секций ${placed}`);
  },

  trading_post(s, ctx, out) {
    const { focal } = ctx;
    const near = roadNear(ctx.road, focal.x, focal.y);
    const axis = near ? near.angle : 0;
    const nx = -Math.sin(axis);
    const ny = Math.cos(axis);
    const side = ctx.rng.chance(0.5) ? 1 : -1;
    // Дом торговца — с одной стороны тракта, дверью к дороге.
    const roadPoint = near?.point ?? { x: focal.x, y: focal.y };
    const horizontalRoad = Math.abs(Math.cos(axis)) >= Math.abs(Math.sin(axis));
    const w = horizontalRoad ? 7 : 5;
    const h = horizontalRoad ? 5 : 7;
    const hx = roadPoint.x + nx * side * (3.2 + (horizontalRoad ? h : w) / 2);
    const hy = roadPoint.y + ny * side * (3.2 + (horizontalRoad ? h : w) / 2);
    const facing: ChestRotation = horizontalRoad ? (ny * side > 0 ? 180 : 0) : (nx * side > 0 ? 90 : 270);
    const roof = ctx.rng.chance(0.5) ? 0 : 1;
    const house = s.building('hall', Math.round(hx - w / 2), Math.round(hy - h / 2), w, h, facing, roof as RoofMaterial);
    // Загон с сеном — дальше по дороге, ограда без одной секции.
    const pen = { x: roadPoint.x + Math.cos(axis) * 7 + nx * side * 4.5, y: roadPoint.y + Math.sin(axis) * 7 + ny * side * 4.5 };
    fenceRing(s, ctx, Math.round(pen.x - 3), Math.round(pen.y - 2), 6, 4, axis + Math.PI, 0.12);
    s.civic('marketHayLarge', pen.x, pen.y);
    // Прилавки и телеги — по другую сторону тракта.
    const stalls: CivicKind[] = ['marketStallProduce', 'marketStallGrain', 'marketTentCanopy', 'marketStallTools', 'marketStallPottery'];
    const stallCount = s.arc(roadPoint.x - nx * side * 4, roadPoint.y - ny * side * 4, 3, [0.5, 2.8], axis - Math.PI / 2, Math.PI, (x, y) =>
      s.civic(stalls[ctx.rng.int(0, stalls.length - 1)], x, y, 0), 4);
    s.civic('marketWagonCovered', roadPoint.x - Math.cos(axis) * 5 - nx * side * 3.6, roadPoint.y - Math.sin(axis) * 5 - ny * side * 3.6, alongRotation(axis));
    s.scatter(hx, hy, 3, [w / 2 + 1, w / 2 + 2.6], (x, y) => s.civic(ctx.rng.chance(0.5) ? 'marketCrates' : 'marketBarrels', x, y));
    s.civic('marketNoticeBoard', roadPoint.x + Math.cos(axis) * 2.5 + nx * side * 3, roadPoint.y + Math.sin(axis) * 2.5 + ny * side * 3);
    out.notes.push(`торговый пост: дом ${house ? 'есть' : 'не поместился'}, прилавков ${stallCount}`);
  },

  watchtower(s, ctx, out) {
    const { focal } = ctx;
    const size = ctx.rng.int(4, 5);
    const x = Math.round(focal.x - size / 2);
    const y = Math.round(focal.y - size / 2);
    const tower = s.ruin(x, y, size, size, 0.3, { keepDoor: true });
    if (tower) s.crypt('ladder', x + size / 2, y + size / 2);
    // Обломки частокола и осыпь — со стороны склона.
    const fences = s.arc(focal.x, focal.y, ctx.rng.int(4, 6), [size + 0.5, size + 2], ctx.rng.range(0, Math.PI * 2), Math.PI * 1.5, (px, py, angle) =>
      s.civic('marketFence', px, py, acrossRotation(angle)));
    s.scatter(focal.x, focal.y, 4, [size, size + 3.5], (px, py) => s.crypt(ctx.rng.chance(0.5) ? 'rubblePile' : 'scree', px, py, 0, { rock: true }));
    s.scatter(focal.x, focal.y, 1, [size * 0.7, size + 1], (px, py) => s.crypt('signalHorn', px, py));
    out.notes.push(`башня ${tower ? `${size}×${size}` : 'не поместилась'}, обломков частокола ${fences}`);
  },

  curtain_walls(s, ctx, out) {
    const { width, height } = ctx;
    // Двор занимает почти всю карту: стены с отступом, ворота к подходу.
    const margin = 2;
    const x = margin;
    const y = margin;
    const w = width - margin * 2;
    const h = height - margin * 2;
    for (let yy = y + 1; yy < y + h - 1; yy += 1) for (let xx = x + 1; xx < x + w - 1; xx += 1) s.paint(xx, yy, ctx.rng.chance(0.18) ? 'dirt' : 'plaza', true);
    const gate = wallRing(s, ctx, x, y, w, h, 0, ctx.approach);
    out.structures.push({ x, y, w, h, ruin: false });
    // Знамёна на стенах — неравномерно, больше у ворот.
    const banners = s.scatter(gate.x, gate.y, 4, [2, Math.max(w, h) / 2], (px, py) => {
      const wx = Math.round(px);
      const wy = Math.round(py);
      return ctx.cells[wy]?.[wx]?.terrain === 'wall' && s.crypt('banner', wx + 0.5, wy + 0.5);
    }, 30);
    // Казарма у задней стены, колодец и плац с оружейными стойками.
    const back = { x: -Math.cos(ctx.approach), y: -Math.sin(ctx.approach) };
    const horizontal = Math.abs(back.y) >= Math.abs(back.x);
    const bw = horizontal ? Math.min(10, Math.round(w * 0.35)) : 5;
    const bh = horizontal ? 5 : Math.min(10, Math.round(h * 0.4));
    const cx = width / 2 + back.x * (w / 2 - bw / 2 - 2.5) + ctx.rng.range(-2, 2);
    const cy = height / 2 + back.y * (h / 2 - bh / 2 - 2.5) + ctx.rng.range(-1, 1);
    const facing: ChestRotation = horizontal ? (back.y > 0 ? 180 : 0) : (back.x > 0 ? 90 : 270);
    s.building('hall', Math.round(cx - bw / 2), Math.round(cy - bh / 2), bw, bh, facing, 3 as RoofMaterial);
    s.civic('marketWell', width / 2 + ctx.rng.range(-3, 3) - back.y * 4, height / 2 + ctx.rng.range(-2, 2) + back.x * 4);
    const yard = { x: width / 2 + back.y * w * 0.25, y: height / 2 - back.x * h * 0.25 };
    s.blob(yard.x, yard.y, Math.min(w, h) * 0.16, 'dirt', 0.2);
    s.arc(yard.x, yard.y, 3, [Math.min(w, h) * 0.16 + 0.8, Math.min(w, h) * 0.16 + 1.8], 0, Math.PI * 2, (px, py) => s.crypt('toolRack', px, py));
    s.scatter(width / 2, height / 2, 4, [Math.min(w, h) * 0.3, Math.min(w, h) * 0.45], (px, py) => s.crypt(ctx.rng.chance(0.5) ? 'crateStack' : 'barrelStack', px, py), 8);
    s.crypt('anvil', cx + (horizontal ? bw / 2 + 2 : 0), cy + (horizontal ? 0 : bh / 2 + 2));
    out.notes.push(`двор крепости ${w}×${h}, знамён ${banners}`);
  },

  walled_square(s, ctx, out) {
    const { width, height, focal } = ctx;
    const margin = 2;
    const x = margin;
    const y = margin;
    const w = width - margin * 2;
    const h = height - margin * 2;
    for (let yy = y + 1; yy < y + h - 1; yy += 1) for (let xx = x + 1; xx < x + w - 1; xx += 1) s.paint(xx, yy, 'plaza', true);
    wallRing(s, ctx, x, y, w, h, 0, ctx.approach);
    wallRingGateOpposite(s, ctx, x, y, w, h);
    out.structures.push({ x, y, w, h, ruin: false });
    // Фонтан смещён от геометрического центра, ряды прилавков — неровные.
    const fountain = { x: focal.x + ctx.rng.range(-2, 2), y: focal.y + ctx.rng.range(-1.5, 1.5) };
    s.civic('fountain', fountain.x, fountain.y);
    s.arc(fountain.x, fountain.y, ctx.rng.int(3, 4), [2.6, 3.4], ctx.rng.range(0, Math.PI * 2), Math.PI * 2, (px, py, angle) => s.civic('marketBench', px, py, acrossRotation(angle + Math.PI / 2)));
    const stalls: CivicKind[] = ['marketStallFruit', 'marketStallBread', 'marketStallFabric', 'marketStallFish', 'marketStallMeat', 'marketStallPotion', 'marketTentStripe', 'marketTentAwning'];
    const rows = ctx.rng.int(1, 2);
    let placed = 0;
    for (let row = 0; row < rows; row += 1) {
      const rowY = row === 0 ? y + 3.2 + ctx.rng.range(0, 1) : y + h - 3.6 - ctx.rng.range(0, 1);
      let rowX = x + 3 + ctx.rng.range(0, 2);
      while (rowX < x + w - 4) {
        if (!ctx.rng.chance(0.2) && s.civic(stalls[ctx.rng.int(0, stalls.length - 1)], rowX, rowY + ctx.rng.range(-0.4, 0.4))) placed += 1;
        rowX += ctx.rng.range(2.4, 4.2);
      }
    }
    s.civic('marketNoticeBoard', fountain.x + ctx.rng.range(4, 6), fountain.y + ctx.rng.range(-2, 2));
    s.scatter(fountain.x, fountain.y, 3, [5, Math.min(w, h) / 2 - 2], (px, py) => s.civic(ctx.rng.chance(0.5) ? 'marketBarrelPair' : 'marketBaskets', px, py));
    out.notes.push(`площадь ${w}×${h}, прилавков ${placed}`);
  },

  stone_circle(s, ctx, out) {
    const { focal } = ctx;
    const center = { x: focal.x + ctx.rng.range(-0.8, 0.8), y: focal.y + ctx.rng.range(-0.8, 0.8) };
    s.blob(center.x, center.y, focal.radius * 0.75, 'dirt', 0.4);
    // Круг стоячих камней: радиус чуть «дышит», пара камней упала (пропуски).
    const radius = Math.max(3, focal.radius * 0.7);
    const stones = s.arc(center.x, center.y, ctx.rng.int(7, 9), [radius - 0.3, radius + 0.4], ctx.rng.range(0, Math.PI * 2), Math.PI * 2, (x, y) =>
      !ctx.rng.chance(0.14) && s.crypt('obelisk', x, y));
    s.crypt('runeCircle', center.x, center.y + 1.2);
    s.crypt('altar', center.x, center.y - 0.6);
    s.scatter(center.x, center.y, 4, [1.5, radius - 1], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'graveCandle' : ctx.rng.chance(0.5) ? 'bones' : 'candles', x, y));
    out.notes.push(`круг камней: ${stones}`);
  },

  caravan_wreck(s, ctx, out) {
    const { focal } = ctx;
    const near = roadNear(ctx.road, focal.x, focal.y);
    const axis = near?.angle ?? 0;
    const origin = near?.point ?? { x: focal.x, y: focal.y };
    // Повозки развёрнуты как попало, одна — поперёк полотна.
    let wagons = 0;
    const kinds: CivicKind[] = ['marketWagonCovered', 'marketWagon', 'cart'];
    for (let index = 0; index < 3; index += 1) {
      const along = ctx.rng.range(-focal.radius, focal.radius);
      const offset = ctx.rng.range(-2.6, 2.6);
      const x = origin.x + Math.cos(axis) * along - Math.sin(axis) * offset;
      const y = origin.y + Math.sin(axis) * along + Math.cos(axis) * offset;
      if (s.civic(kinds[index], x, y, index === 0 ? acrossRotation(axis) : ROTATIONS[ctx.rng.int(0, 3)], { road: true, gap: 0 })) wagons += 1;
    }
    const cargo: CivicKind[] = ['marketCrates', 'marketBarrelLying', 'marketSacks', 'marketBaskets', 'marketChestOpen'];
    s.scatter(origin.x, origin.y, 5, [1.5, focal.radius + 1], (x, y) => s.civic(cargo[ctx.rng.int(0, cargo.length - 1)], x, y, 0, { road: true }));
    s.scatter(origin.x, origin.y, 3, [1, focal.radius], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'corpse' : ctx.rng.chance(0.5) ? 'skeleton' : 'crateOpen', x, y, 0, { road: true }));
    s.scatter(origin.x, origin.y, 1, [2, focal.radius], (x, y) => s.chest(x, y, 'wooden'));
    out.notes.push(`разбитых повозок: ${wagons}`);
  },

  shrine(s, ctx, out) {
    const { focal } = ctx;
    const back = { x: -Math.cos(ctx.approach), y: -Math.sin(ctx.approach) };
    const center = { x: focal.x + back.x * focal.radius * 0.3, y: focal.y + back.y * focal.radius * 0.3 };
    // Мощёная площадка неправильной формы и идол в глубине.
    s.blob(center.x, center.y, Math.max(1.8, focal.radius * 0.45), 'plaza', 0.25);
    s.crypt(ctx.rng.chance(0.5) ? 'idol' : 'pedestalStatue', center.x + back.x, center.y + back.y);
    s.crypt('offeringBowl', center.x - back.x * 0.6 + back.y, center.y - back.y * 0.6 - back.x);
    s.scatter(center.x, center.y, 4, [1, 2.6], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'graveCandle' : ctx.rng.chance(0.5) ? 'wreath' : 'candles', x, y));
    out.notes.push('святилище с идолом');
  },

  graveyard(s, ctx, out) {
    const { focal } = ctx;
    const w = Math.max(8, Math.round(focal.radius * 2.2 / 2) * 2);
    const h = Math.max(6, Math.round(focal.radius * 1.7 / 2) * 2);
    const x = Math.round(focal.x - w / 2);
    const y = Math.round(focal.y - h / 2);
    fenceRing(s, ctx, x, y, w, h, ctx.approach, 0.18);
    // Мавзолей у задней ограды.
    const back = { x: -Math.cos(ctx.approach), y: -Math.sin(ctx.approach) };
    s.crypt('mausoleum', focal.x + back.x * (w / 2 - 2.5), focal.y + back.y * (h / 2 - 2.5));
    // Неровные ряды: шаг 2, смещение каждого ряда, пропуски, иногда склеп.
    let graves = 0;
    for (let gy = y + 2; gy < y + h - 1.5; gy += 2) {
      const shift = ctx.rng.range(0, 1.2);
      for (let gx = x + 2 + shift; gx < x + w - 1.5; gx += ctx.rng.range(1.7, 2.6)) {
        if (ctx.rng.chance(0.22)) continue;
        const roll = ctx.rng.next();
        const kind: CryptKind = roll < 0.12 ? 'tomb' : roll < 0.22 ? 'graveDirt' : roll < 0.3 ? 'nameTomb' : 'graveStone';
        if (s.crypt(kind, gx, gy + ctx.rng.range(-0.3, 0.3))) graves += 1;
      }
    }
    s.crypt('mournerStatue', focal.x + Math.cos(ctx.approach) * (h / 2 - 1.5) + 1.5, focal.y + Math.sin(ctx.approach) * (h / 2 - 1.5));
    // Сухостой у ограды — по одной-две стороны.
    let dead = 0;
    for (let index = 0; index < 4; index += 1) {
      const angle = ctx.rng.range(0, Math.PI * 2);
      const px = focal.x + Math.cos(angle) * (w / 2 + 1.2);
      const py = focal.y + Math.sin(angle) * (h / 2 + 1.2);
      if (s.free({ x: Math.floor(px), y: Math.floor(py), w: 1, h: 1 })) {
        out.trees.push({ x: px, y: py, r: ctx.rng.range(0.45, 0.6), kind: 'dead', v: ctx.rng.next() });
        dead += 1;
      }
    }
    s.reserve({ x, y, w, h });
    out.notes.push(`кладбище: могил ${graves}, сухостоя ${dead}`);
  },

  battlefield(s, ctx, out) {
    const { focal } = ctx;
    // Воронки и рытвины — разного размера, гуще в центре сражения.
    for (let index = 0; index < ctx.rng.int(4, 6); index += 1) {
      const angle = ctx.rng.range(0, Math.PI * 2);
      const distance = Math.sqrt(ctx.rng.next()) * focal.radius * 1.2;
      s.blob(focal.x + Math.cos(angle) * distance, focal.y + Math.sin(angle) * distance, ctx.rng.range(0.8, 1.8), ctx.rng.chance(0.5) ? 'mud' : 'dirt', 0.5);
    }
    const remains: CryptKind[] = ['corpse', 'skeleton', 'bones', 'skull', 'ribcage', 'crateOpen'];
    const fallen = s.scatter(focal.x, focal.y, ctx.rng.int(8, 12), [0.5, focal.radius * 1.3], (x, y) => s.crypt(remains[ctx.rng.int(0, remains.length - 1)], x, y));
    s.scatter(focal.x, focal.y, 2, [focal.radius * 0.5, focal.radius * 1.2], (x, y) => s.civic(ctx.rng.chance(0.5) ? 'cart' : 'marketWagon', x, y, ROTATIONS[ctx.rng.int(0, 3)]));
    s.scatter(focal.x, focal.y, 3, [focal.radius * 0.6, focal.radius * 1.4], (x, y) => s.crypt(ctx.rng.chance(0.5) ? 'spikeRack' : 'pyre', x, y));
    out.notes.push(`поле битвы: останков ${fallen}`);
  },
};

/** Вторые ворота площади — напротив первых (сквозной проход). */
function wallRingGateOpposite(s: Stamper, ctx: FeatureContext, x: number, y: number, w: number, h: number): void {
  const side = (Math.round(((ctx.approach + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) + 2) % 4;
  const gate = side === 0 ? { x: x + w - 1, y: y + Math.floor(h / 2) - 1 }
    : side === 1 ? { x: x + Math.floor(w / 2) - 1, y: y + h - 1 }
      : side === 2 ? { x, y: y + Math.floor(h / 2) - 1 }
        : { x: x + Math.floor(w / 2) - 1, y };
  const vertical = side === 0 || side === 2;
  for (let k = 0; k < 2; k += 1) s.paint(gate.x + (vertical ? 0 : k), gate.y + (vertical ? k : 0), 'plaza', true);
}

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** Ставит сюжетные постройки архетипа. Возвращает новые объекты и заметки. */
export function placeSceneFeatures(ids: readonly FeatureId[], ctx: FeatureContext): FeatureResult {
  const out: FeatureResult = { structures: [], buildings: [], civic: [], crypt: [], chests: [], trees: [], bridges: [...ctx.bridges], footprints: [], notes: [] };
  const stamper = createStamper({ ...ctx, bridges: out.bridges }, out);
  for (const id of ids) FEATURES[id](stamper, { ...ctx, bridges: out.bridges }, out);
  return out;
}
