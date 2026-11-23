/**
 * Разнообразная планировка подземелья (gen.dungeonLayout = 'varied').
 *
 * Прежний генератор (cryptBlueprint + L-коридоры) остаётся без изменений и
 * по-прежнему используется по умолчанию: золотые хэши его не замечают.
 * Здесь подземелье строится от смысла зала, а не от сетки прямоугольников:
 *
 *   роли залов (вход, главный зал, стража, покои, мастерская, святилище, …)
 *   → размер и форма по роли (круг, овал, восьмиугольник, Г, Т, крест,
 *     «природная» пещера; колонны, ниши, ротонда, купель, помост)
 *   → размещение с отступами (стена + коридор + стена)
 *   → граф: остов + кольца + подключение тупиков; сокровищница и тайник —
 *     задуманные тупики
 *   → двери на краях залов и коридоры A* с шириной 1–3, которые обходят
 *     чужие залы и сливаются в развилки
 *   → вид двери по смыслу ребра (ворота, двустворчатая, арка, решётка,
 *     тайная, сломанная, завал на кольце)
 *   → уровни: лестницы вниз и вверх стоят на одних и тех же клетках соседних
 *     уровней, поэтому уровни складываются стопкой.
 *
 * Дальше работает прежний конвейер склепа: furnishByPurpose → decorateCrypt
 * (с готовыми темами залов) → cryptCompositionPlan → placeCorridorTraps.
 */

import { Perlin } from '../noise';
import { hash2, mulberry32, type Rng } from '../random';
import { CRYPT } from '../cryptKit';
import { CRYPT_HALL_THEME, canPlaceCrypt, cryptRoomCapacity, cryptStamp, cryptWalkable, decorateCrypt, dungeonLevelSeed, processionalLanes, wallOffBlockedDoors } from '../cryptLayout';
import { cryptCompositionPlan, furnishByPurpose, placeCorridorTraps } from './cryptplan';
import type { Cell, CryptArchetype, CryptKind, CryptObject, CryptTheme, DoorKind, DoorMark, GenSettings, MapData, Point, Rock, Structure, Tree } from '../types';
import type { DungeonLayoutReport, DungeonRoom, GenerationPlan, LegacyRoomPurpose, RoadGraphEdge, RoomCategory, RoomFeature, RoomPurpose, RoomShape } from './plan';

/** Версия алгоритма: тот же seed при другой версии даёт другую карту. */
export const DUNGEON_GENERATOR_VERSION = 1;
export const MAX_DUNGEON_LEVELS = 4;

type Role = Exclude<LegacyRoomPurpose, 'crypt'>;

interface RoleSpec {
  theme: CryptTheme | 'hall';
  category: RoomCategory;
  label: string;
  w: [number, number];
  h: [number, number];
  shapes: [RoomShape, number][];
  features: [RoomFeature, number][];
}

/** Смысл зала задаёт его размер, форму, особенности и тему убранства. */
export const ROOM_ROLES: Record<Role, RoleSpec> = {
  entrance: { theme: 'entry', category: 'defense', label: 'Вход', w: [5, 8], h: [5, 7], shapes: [['rect', 3], ['octagon', 2], ['square', 1]], features: [['pillars', .3]] },
  landing: { theme: 'entry', category: 'defense', label: 'Лестничный зал', w: [6, 6], h: [6, 6], shapes: [['square', 2], ['octagon', 1]], features: [] },
  hall: { theme: 'hall', category: 'special', label: 'Главный зал', w: [9, 14], h: [7, 11], shapes: [['rect', 2], ['octagon', 2], ['circle', 1.5], ['T', 1.5], ['cross', 1], ['oval', 1]], features: [['pillars', .55], ['rotunda', .35], ['pool', .15], ['dais', .3]] },
  guard: { theme: 'watch', category: 'defense', label: 'Караульная', w: [4, 7], h: [4, 6], shapes: [['rect', 3], ['L', 2], ['square', 1]], features: [] },
  quarters: { theme: 'quarters', category: 'living', label: 'Жилые покои', w: [5, 8], h: [4, 6], shapes: [['rect', 3], ['L', 2]], features: [['niches', .25]] },
  workshop: { theme: 'forge', category: 'utility', label: 'Мастерская', w: [5, 8], h: [5, 7], shapes: [['rect', 2], ['L', 2], ['square', 1]], features: [] },
  storage: { theme: 'storage', category: 'utility', label: 'Кладовая', w: [3, 6], h: [3, 5], shapes: [['rect', 3], ['square', 2], ['L', 1]], features: [] },
  archive: { theme: 'archive', category: 'utility', label: 'Архив', w: [7, 11], h: [3, 5], shapes: [['rect', 3]], features: [['niches', .5], ['pillars', .2]] },
  shrine: { theme: 'sanctum', category: 'religious', label: 'Святилище', w: [5, 9], h: [5, 9], shapes: [['circle', 3], ['octagon', 2], ['T', 1], ['cross', 1]], features: [['dais', .5], ['rotunda', .25], ['pool', .15]] },
  burial: { theme: 'burial', category: 'religious', label: 'Усыпальница', w: [6, 10], h: [4, 6], shapes: [['rect', 3], ['oval', 1], ['T', 1]], features: [['niches', .75], ['pillars', .25]] },
  ossuary: { theme: 'ossuary', category: 'religious', label: 'Костница', w: [4, 7], h: [4, 7], shapes: [['organic', 2], ['circle', 2], ['rect', 1]], features: [['niches', .5]] },
  cell: { theme: 'cell', category: 'defense', label: 'Камера', w: [3, 4], h: [3, 4], shapes: [['square', 3], ['rect', 1]], features: [] },
  cave: { theme: 'ossuary', category: 'special', label: 'Обвальная пещера', w: [6, 10], h: [5, 8], shapes: [['organic', 1]], features: [['pool', .3]] },
  treasury: { theme: 'reliquary', category: 'special', label: 'Сокровищница', w: [4, 5], h: [4, 5], shapes: [['square', 2], ['circle', 1], ['octagon', 1]], features: [] },
  secret: { theme: 'reliquary', category: 'special', label: 'Тайник', w: [3, 4], h: [3, 4], shapes: [['square', 1]], features: [] },
};

/** Чередование служебных залов по типу склепа: тип склепа остаётся главным выбором. */
const MIX: Record<CryptArchetype, Role[]> = {
  tomb: ['burial', 'guard', 'ossuary', 'shrine', 'storage', 'burial', 'quarters', 'archive'],
  catacombs: ['burial', 'ossuary', 'cave', 'burial', 'shrine', 'ossuary', 'storage', 'cave'],
  temple: ['shrine', 'quarters', 'guard', 'archive', 'shrine', 'storage', 'burial', 'workshop'],
  archive: ['archive', 'storage', 'archive', 'quarters', 'guard', 'workshop', 'archive', 'shrine'],
  prison: ['cell', 'guard', 'cell', 'cell', 'storage', 'quarters', 'cell', 'workshop'],
};

export const SHAPE_LABELS: Record<RoomShape, string> = {
  rect: 'прямоугольник', square: 'квадрат', circle: 'круг', oval: 'овал', octagon: 'восьмиугольник',
  L: 'Г-образный', T: 'Т-образный', cross: 'крест', organic: 'пещера',
  hexagon: 'многоугольник', niched: 'с нишами', partitioned: 'с перегородками', irregular: 'неправильная', gallery: 'галерея', composite: 'составной',
};
export const FEATURE_LABELS: Record<RoomFeature, string> = {
  pillars: 'колоннада', niches: 'ниши', rotunda: 'ротонда', pool: 'купель', dais: 'помост',
};

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const value of parts) {
    h ^= value | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

function weighted<T>(rng: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

const centreOf = (r: Structure): Point => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
const rectGap = (a: Structure, b: Structure) => {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.max(dx, dy);
};

/** Сколько уровней помещается: две лестничные площадки 6×6 должны разойтись на ≥3 клетки. */
export function effectiveLevels(s: Pick<GenSettings, 'width' | 'height' | 'dungeonLevels'>): number {
  const wanted = Math.max(1, Math.min(MAX_DUNGEON_LEVELS, Math.round(s.dungeonLevels ?? 1)));
  return Math.max(s.width, s.height) >= 21 ? wanted : 1;
}

/**
 * Точки связи уровней: link[k] — центр лестничной площадки между уровнями k и k+1.
 * Зависят только от seed и размеров, поэтому каждый уровень строится отдельно,
 * но лестницы соседних уровней совпадают клетка в клетку.
 */
export function levelLinks(s: Pick<GenSettings, 'seed' | 'width' | 'height' | 'dungeonLevels'>): Point[] {
  const levels = effectiveLevels(s);
  const links: Point[] = [];
  const horizontal = s.width >= s.height;
  for (let k = 0; k < levels - 1; k += 1) {
    const along = k % 2 === 0 ? .74 : .26;
    const jitter = hash2(k, 7, s.seed + 0x1ad) - .5;
    const across = .5 + (hash2(k, 11, s.seed + 0x1ad) - .5) * .36;
    const fx = horizontal ? along + jitter * .06 : across;
    const fy = horizontal ? across : along + jitter * .06;
    links.push({
      x: Math.max(5, Math.min(s.width - 5, Math.round(s.width * fx))),
      y: Math.max(5, Math.min(s.height - 5, Math.round(s.height * fy))),
    });
  }
  return links;
}

/** Клетки лестницы для точки связи: 2×2 к северо-западу от центра площадки. */
export const stairFootprint = (link: Point): Point => ({ x: link.x - 2, y: link.y - 2 });

interface Room {
  role: Role;
  rect: Structure;
  shape: RoomShape;
  features: RoomFeature[];
  /** Пол зала в координатах карты (без колонн). */
  cells: Set<number>;
  water: Set<number>;
  anchored: boolean;
}

interface Edge { a: number; b: number; loop: boolean; width: 1 | 2 | 3 }

// ---------------------------------------------------------------------------
// Формы залов: локальная маска w×h. Центр (floor(w/2), floor(h/2)) всегда пол —
// на нём держатся проходы декоратора, проверки связности и отчёт.
// ---------------------------------------------------------------------------

export function shapeMask(shape: RoomShape, w: number, h: number, seed: number, origin: Point): boolean[][] {
  const grid = Array.from({ length: h }, () => new Array<boolean>(w).fill(true));
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const variant = Math.floor(hash2(origin.x, origin.y, seed + 0x5a9e) * 4);
  if (shape === 'circle' || shape === 'oval') {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const nx = (x + .5 - w / 2) / (w / 2), ny = (y + .5 - h / 2) / (h / 2);
      grid[y][x] = nx * nx + ny * ny <= 1.08;
    }
  } else if (shape === 'octagon') {
    const c = Math.max(1, Math.round(Math.min(w, h) * .3));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const ix = Math.min(x, w - 1 - x), iy = Math.min(y, h - 1 - y);
      grid[y][x] = ix + iy >= c;
    }
  } else if (shape === 'L') {
    const cw = Math.floor(w * .45), ch = Math.floor(h * .45);
    const right = variant % 2 === 1, bottom = variant >= 2;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const inX = right ? x >= w - cw : x < cw;
      const inY = bottom ? y >= h - ch : y < ch;
      if (inX && inY) grid[y][x] = false;
    }
  } else if (shape === 'T') {
    // Перекладина у одной стены, ножка — по центру через весь зал.
    const vertical = variant % 2 === 1;
    const along = vertical ? w : h, across = vertical ? h : w;
    const bar = Math.ceil(along * .45), stem = Math.max(2, Math.ceil(across * .4));
    const s0 = Math.floor((across - stem) / 2);
    const flip = variant >= 2;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const a = vertical ? x : y, b = vertical ? y : x;
      const inBar = flip ? a >= along - bar : a < bar;
      grid[y][x] = inBar || (b >= s0 && b < s0 + stem);
    }
  } else if (shape === 'cross') {
    const aw = Math.max(2, Math.ceil(w * .42)), ah = Math.max(2, Math.ceil(h * .42));
    const x0 = Math.floor((w - aw) / 2), y0 = Math.floor((h - ah) / 2);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      grid[y][x] = (x >= x0 && x < x0 + aw) || (y >= y0 && y < y0 + ah);
    }
  } else if (shape === 'organic') {
    const noise = new Perlin(mix(seed, origin.x, origin.y, 0x0a9));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const nx = (x + .5 - w / 2) / (w / 2), ny = (y + .5 - h / 2) / (h / 2);
      const wobble = (noise.fbm(x * .42, y * .42, 2) - .5) * .9;
      grid[y][x] = nx * nx + ny * ny + wobble <= .92;
    }
    for (let y = cy - 1; y <= cy + 1; y += 1) for (let x = cx - 1; x <= cx + 1; x += 1) if (grid[y]?.[x] !== undefined) grid[y][x] = true;
  }
  grid[cy][cx] = true;
  // Оставляем только связную с центром часть: «пещера» не распадается на островки.
  const keep = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const stack: Point[] = [{ x: cx, y: cy }];
  keep[cy][cx] = true;
  while (stack.length) {
    const p = stack.pop()!;
    for (const [dx, dy] of DIRS) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || keep[y][x] || !grid[y][x]) continue;
      keep[y][x] = true;
      stack.push({ x, y });
    }
  }
  return keep;
}

const fitsShape = (shape: RoomShape, w: number, h: number): boolean => {
  const m = Math.min(w, h);
  if (shape === 'circle' || shape === 'oval' || shape === 'octagon' || shape === 'organic') return m >= 5;
  if (shape === 'L' || shape === 'T') return m >= 6;
  if (shape === 'cross') return m >= 7;
  return true;
};

const fitsFeature = (feature: RoomFeature, shape: RoomShape, w: number, h: number): boolean => {
  const m = Math.min(w, h);
  if (feature === 'pillars') return (shape === 'rect' || shape === 'square' || shape === 'octagon') && Math.max(w, h) >= 7 && m >= 5;
  if (feature === 'rotunda') return (shape === 'circle' || shape === 'octagon' || shape === 'square' || shape === 'rect') && m >= 9;
  if (feature === 'pool') return shape !== 'L' && shape !== 'T' && m >= 7;
  if (feature === 'dais') return m >= 5;
  return Math.max(w, h) >= 5; // niches
};

// ---------------------------------------------------------------------------

export interface VariedDungeon {
  map: MapData;
}

/** Генерирует один уровень разнообразного подземелья. */
export function generateVariedDungeon(s: GenSettings): MapData {
  const W = s.width, H = s.height;
  const levels = effectiveLevels(s);
  const level = Math.max(0, Math.min(levels - 1, Math.round(s.dungeonLevel ?? 0)));
  const links = levelLinks(s);
  const archetype = s.cryptArchetype ?? 'tomb';
  const levelSeed = dungeonLevelSeed(s.seed, level);
  const rng = mulberry32(mix(levelSeed, 0xd0e));
  const id = (x: number, y: number) => y * W + x;
  const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;

  // ---- 1. Роли залов -------------------------------------------------------
  const capacity = cryptRoomCapacity(W, H);
  const requested = Math.max(1, Math.min(s.rooms, Math.max(capacity, levels > 1 ? 2 : 1)));
  const up = level > 0 ? links[level - 1] : undefined;
  const down = level < levels - 1 ? links[level] : undefined;
  const roles: Role[] = ['entrance'];
  if (down) roles.push('landing');
  if (roles.length < requested) roles.push('hall');
  const treasury = level === levels - 1 && requested >= 4;
  const secret = requested >= 6;
  const tail: Role[] = [];
  if (treasury) tail.push('treasury');
  if (secret) tail.push('secret');
  const mixRoles = MIX[archetype];
  for (let i = 0; roles.length + tail.length < requested; i += 1) roles.push(mixRoles[(i + level * 3) % mixRoles.length]);
  roles.push(...tail);

  // ---- 2. Размещение -------------------------------------------------------
  const scale = Math.max(.7, Math.min(1.3, Math.sqrt((W * H) / (requested * 95))));
  const rooms: Room[] = [];
  const placedRects: Structure[] = [];
  const diag = Math.hypot(W, H);
  const mapCentre = { x: W / 2, y: H / 2 };
  const entryTarget = (() => {
    const opposite = links[0] ?? { x: W * .74, y: H * .5 };
    return { x: W - opposite.x, y: Math.max(3, Math.min(H - 3, H - opposite.y)) };
  })();
  const valid = (r: Structure, gap: number) => r.x >= 2 && r.y >= 2 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2
    && placedRects.every((other) => rectGap(r, other) >= gap);
  const anchorRect = (link: Point): Structure => ({ x: link.x - 3, y: link.y - 3, w: 6, h: 6, ruin: false });
  let missing = 0;

  roles.forEach((role, index) => {
    const spec = ROOM_ROLES[role];
    const anchor = role === 'entrance' && up ? up : role === 'landing' ? down : undefined;
    let rect: Structure | undefined;
    if (anchor) {
      const fixed = anchorRect(anchor);
      if (valid(fixed, 3)) rect = fixed;
    } else {
      const span = (range: [number, number]) => {
        const lo = Math.max(3, Math.round(range[0] * scale)), hi = Math.max(lo, Math.round(range[1] * scale));
        return lo + Math.floor(rng() * (hi - lo + 1));
      };
      // Потолок размера от площади карты на зал: на маленьких картах все залы
      // должны влезть, на больших — не теряться.
      const cap = Math.max(3, Math.floor(Math.sqrt((W * H) / requested)) - 3) + (role === 'hall' ? 3 : 0);
      let w = Math.min(cap, span(spec.w)), h = Math.min(cap, span(spec.h));
      if (role === 'cell' || role === 'treasury' || role === 'secret' || spec.shapes.every(([shape]) => shape === 'square')) h = w;
      const entrance = placedRects[0];
      for (let shrink = 0; !rect && w >= 3 && h >= 3; shrink += 1) {
        const offers: { r: Structure; score: number }[] = [];
        for (let attempt = 0; attempt < 360 && offers.length < 28; attempt += 1) {
          const r: Structure = { x: 2 + Math.floor(rng() * Math.max(1, W - w - 3)), y: 2 + Math.floor(rng() * Math.max(1, H - h - 3)), w, h, ruin: false };
          if (!valid(r, 3)) continue;
          const c = { x: r.x + w / 2, y: r.y + h / 2 };
          const nearest = placedRects.length ? Math.min(...placedRects.map((other) => rectGap(r, other))) : 0;
          const fromEntrance = entrance ? Math.hypot(c.x - (entrance.x + entrance.w / 2), c.y - (entrance.y + entrance.h / 2)) / diag : 0;
          let score = nearest * .06 + rng() * .35;
          if (role === 'entrance') score = Math.hypot(c.x - entryTarget.x, c.y - entryTarget.y) / diag + rng() * .1;
          else if (role === 'hall') score += Math.hypot(c.x - mapCentre.x, c.y - mapCentre.y) / diag * 2.2;
          else if (role === 'guard') score += fromEntrance * 1.6;
          else if (role === 'treasury' || role === 'secret') score -= fromEntrance * 1.4;
          offers.push({ r, score });
        }
        if (offers.length) {
          offers.sort((a, b) => a.score - b.score);
          rect = offers[0].r;
        } else if (shrink % 2 === 0) w -= 1; else h -= 1;
      }
    }
    if (!rect) {
      // Без входа подземелье теряет смысл: последний шанс — любая точка на 3×3.
      if (index === 0) rect = { x: 2, y: 2, w: Math.min(5, W - 4), h: Math.min(5, H - 4), ruin: false };
      else { missing += 1; return; }
    }
    // Форма и особенности — по роли и по тому, что влезает в прямоугольник.
    const shapeRng = mulberry32(mix(levelSeed, rect.x, rect.y, 0x54a9e));
    let shape = weighted(shapeRng, spec.shapes);
    if (!fitsShape(shape, rect.w, rect.h)) shape = rect.w === rect.h ? 'square' : 'rect';
    if (shape === 'square' && rect.w !== rect.h) shape = 'rect';
    const features: RoomFeature[] = [];
    for (const [feature, chance] of spec.features) {
      if (features.some((f) => f === 'rotunda' || f === 'pool' || f === 'pillars') && (feature === 'rotunda' || feature === 'pool' || feature === 'pillars')) continue;
      if (shapeRng() < chance && fitsFeature(feature, shape, rect.w, rect.h)) features.push(feature);
    }
    placedRects.push(rect);
    rooms.push({ role, rect, shape, features, cells: new Set(), water: new Set(), anchored: Boolean(anchor) });
  });

  // ---- 3. Пол залов: форма, колонны, ротонда, купель ----------------------
  const owner = new Int16Array(W * H).fill(-1);
  const waterCells = new Set<number>();
  rooms.forEach((room, index) => {
    const { rect } = room;
    const mask = shapeMask(room.shape, rect.w, rect.h, levelSeed, rect);
    const cx = Math.floor(rect.w / 2), cy = Math.floor(rect.h / 2);
    const column = (x: number, y: number) => {
      if (x === cx && y === cy) return;
      if (mask[y]?.[x]) mask[y][x] = false;
    };
    if (room.features.includes('pillars')) {
      const horizontal = rect.w >= rect.h;
      const along = horizontal ? rect.w : rect.h, across = horizontal ? rect.h : rect.w;
      const rows = across >= 7 ? [2, across - 3] : [1, across - 2];
      for (let a = 1 + (along % 2 === 0 ? 1 : 0); a < along - 1; a += 2) for (const b of rows) {
        if (horizontal) column(a, b); else column(b, a);
      }
    }
    if (room.features.includes('rotunda')) {
      const radius = Math.max(2, Math.floor(Math.min(rect.w, rect.h) / 2) - 2);
      const count = radius >= 3 ? 8 : 6;
      for (let k = 0; k < count; k += 1) {
        const angle = (k / count) * Math.PI * 2 + Math.PI / count;
        column(Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius));
      }
    }
    // Колонны не должны отрезать часть зала: проверяем связность от центра.
    const reach = new Set<number>([cy * rect.w + cx]);
    const stack = [cy * rect.w + cx];
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % rect.w, y = (at - x) / rect.w;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= rect.w || ny >= rect.h || !mask[ny][nx] || reach.has(ny * rect.w + nx)) continue;
        reach.add(ny * rect.w + nx);
        stack.push(ny * rect.w + nx);
      }
    }
    for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) {
      if (!mask[y][x] || !reach.has(y * rect.w + x)) continue;
      const gx = rect.x + x, gy = rect.y + y;
      owner[id(gx, gy)] = index;
      room.cells.add(id(gx, gy));
    }
    if (room.features.includes('pool')) {
      // Купель вокруг сухого островка в центре зала; к островку ведёт гать —
      // центр остаётся сухим и достижимым (вода в проверках непроходима).
      const radius = Math.max(1.5, Math.min(rect.w, rect.h) / 4.2);
      const causeway = DIRS[Math.floor(hash2(rect.x, rect.y, levelSeed + 0xc0a) * 4)];
      for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) {
        if (Math.hypot(x - cx, y - cy) > radius || (x === cx && y === cy)) continue;
        const along = (x - cx) * causeway[0] + (y - cy) * causeway[1];
        const aside = (x - cx) * causeway[1] - (y - cy) * causeway[0];
        if (along > 0 && aside === 0) continue;
        const cell = id(rect.x + x, rect.y + y);
        if (room.cells.has(cell)) { room.water.add(cell); waterCells.add(cell); }
      }
    }
  });
  // Кольцо стен вокруг каждого зала: коридоры его не пересекают.
  const ring = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (owner[id(x, y)] >= 0) continue;
    if (AROUND.some(([dx, dy]) => owner[id(x + dx, y + dy)] >= 0 && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H)) ring[id(x, y)] = 1;
  }

  // ---- 4. Граф: остов, тупики-задумки, кольца ------------------------------
  const weight = (a: number, b: number) => {
    const ca = centreOf(rooms[a].rect), cb = centreOf(rooms[b].rect);
    return rectGap(rooms[a].rect, rooms[b].rect) + .25 * Math.hypot(ca.x - cb.x, ca.y - cb.y);
  };
  const special = (i: number) => rooms[i].role === 'treasury' || rooms[i].role === 'secret';
  const core = rooms.map((_, i) => i).filter((i) => !special(i));
  const edges: Edge[] = [];
  const linked = new Set<number>(core.slice(0, 1));
  while (linked.size < core.length) {
    let best: [number, number] | undefined, bestWeight = Infinity;
    for (const a of linked) for (const b of core) {
      if (linked.has(b)) continue;
      const value = weight(a, b);
      if (value < bestWeight) { bestWeight = value; best = [a, b]; }
    }
    if (!best) break;
    edges.push({ a: best[0], b: best[1], loop: false, width: 1 });
    linked.add(best[1]);
  }
  const degree = () => {
    const d = new Array<number>(rooms.length).fill(0);
    for (const e of edges) { d[e.a] += 1; d[e.b] += 1; }
    return d;
  };
  const connected = (a: number, b: number) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const hops = (from: number, to: number) => {
    const dist = new Array<number>(rooms.length).fill(-1);
    dist[from] = 0;
    const queue = [from];
    for (let i = 0; i < queue.length; i += 1) for (const e of edges) {
      const at = queue[i];
      const next = e.a === at ? e.b : e.b === at ? e.a : -1;
      if (next < 0 || dist[next] >= 0) continue;
      dist[next] = dist[at] + 1;
      queue.push(next);
    }
    return dist[to];
  };
  const treeWeights = edges.map((e) => weight(e.a, e.b)).sort((a, b) => a - b);
  const median = treeWeights[Math.floor(treeWeights.length / 2)] ?? 10;
  // Кольца: короткие рёбра между далёкими по графу залами.
  const loopShare = archetype === 'catacombs' ? .35 : archetype === 'temple' ? .2 : .25;
  const loopBudget = core.length >= 5 ? Math.max(1, Math.round(core.length * loopShare)) : core.length >= 4 ? 1 : 0;
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < core.length; i += 1) for (let j = i + 1; j < core.length; j += 1) pairs.push([core[i], core[j], weight(core[i], core[j])]);
  pairs.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  let loops = 0;
  for (const [a, b, value] of pairs) {
    if (loops >= loopBudget) break;
    if (connected(a, b) || value > median * 1.9 + 4) continue;
    if (hops(a, b) < 3) continue;
    edges.push({ a, b, loop: true, width: 1 });
    loops += 1;
  }
  // Тупики: зал с одним выходом подключаем к ближайшему соседу, если это недалеко.
  // Вход, лестничные залы, сокровищница и тайник — задуманные тупики.
  const intendedEnd = (i: number) => special(i) || rooms[i].role === 'landing' || rooms[i].role === 'entrance';
  for (const leaf of core) {
    if (intendedEnd(leaf) || degree()[leaf] !== 1) continue;
    const own = edges.find((e) => e.a === leaf || e.b === leaf)!;
    const ownWeight = weight(own.a, own.b);
    const options = core.filter((other) => other !== leaf && !connected(leaf, other)).map((other) => ({ other, value: weight(leaf, other) }))
      .sort((a, b) => a.value - b.value || a.other - b.other);
    const pick = options[0];
    if (pick && pick.value <= Math.max(ownWeight * 2, median * 1.6) + 3) {
      edges.push({ a: leaf, b: pick.other, loop: true, width: 1 });
      loops += 1;
    }
  }
  // Сокровищница и тайник — листья, подвешенные к ближайшему не-входному залу.
  for (const index of rooms.map((_, i) => i).filter(special)) {
    const hosts = core.filter((i) => rooms[i].role !== 'entrance' || core.length === 1)
      .sort((a, b) => weight(index, a) - weight(index, b) || a - b);
    if (hosts.length) edges.push({ a: hosts[0], b: index, loop: false, width: 1 });
  }
  // Ширина коридора: к главному залу — широкие галереи, на больших картах — в три клетки.
  for (const e of edges) {
    const roles2 = [rooms[e.a].role, rooms[e.b].role];
    if (special(e.a) || special(e.b)) continue;
    if (roles2.includes('hall')) {
      const grand = roles2.includes('entrance') && W * H >= 3000 && archetype !== 'catacombs';
      e.width = grand ? 3 : archetype === 'catacombs' && !roles2.includes('entrance') ? 1 : 2;
    }
  }

  // ---- 5. Двери и коридоры -------------------------------------------------
  const carved = new Uint8Array(W * H);
  for (const room of rooms) for (const cell of room.cells) carved[cell] = 1;
  const corridor = new Uint8Array(W * H);
  const doorsOf: number[][] = rooms.map(() => []);
  const centreline = new Map<1 | 2 | 3, number>([[1, 0], [2, 0], [3, 0]]);
  interface Port { door: number; out: number }
  const candidates = (index: number): Port[] => {
    const ports: Port[] = [];
    for (const cell of rooms[index].cells) {
      const x = cell % W, y = (cell - x) / W;
      for (const [dx, dy] of DIRS) {
        const ox = x + dx, oy = y + dy, nx = ox + dx, ny = oy + dy;
        if (!inner(ox, oy) || !inner(nx, ny) || owner[id(ox, oy)] >= 0) continue;
        // Дверь — в ровном участке стены: по бокам проёма не пол этого зала.
        if (owner[id(ox + dy, oy + dx)] === index || owner[id(ox - dy, oy - dx)] === index) continue;
        if (AROUND.some(([ax, ay]) => { const o = owner[id(ox + ax, oy + ay)]; return o >= 0 && o !== index; })) continue;
        if (owner[id(nx, ny)] >= 0 || ring[id(nx, ny)]) continue;
        ports.push({ door: id(ox, oy), out: id(nx, ny) });
      }
    }
    return ports;
  };
  const portCache = rooms.map((_, i) => candidates(i));
  const portOut = new Map<number, number>();
  const choosePort = (index: number, target: Point, salt: number, fresh: boolean): Port | undefined => {
    const scored = portCache[index]
      .filter((p) => !doorsOf[index].some((d) => d !== p.door && Math.max(Math.abs((d % W) - (p.door % W)), Math.abs(Math.floor(d / W) - Math.floor(p.door / W))) <= 1))
      .map((p) => ({ p, score: Math.hypot((p.out % W) - target.x, Math.floor(p.out / W) - target.y) + hash2(p.door, salt, levelSeed + 0x90e) * 1.4 }))
      .sort((a, b) => a.score - b.score || a.p.door - b.p.door);
    const best = scored[0];
    if (!best) return undefined;
    if (!fresh) {
      // Переиспользуем уже пробитую дверь, если она почти так же удобна: меньше
      // проёмов в стене, коридоры сходятся в развилки.
      const reuse = doorsOf[index].map((door) => ({ door, out: portOut.get(door)! }))
        .map((p) => ({ p, score: Math.hypot((p.out % W) - target.x, Math.floor(p.out / W) - target.y) }))
        .sort((a, b) => a.score - b.score)[0];
      if (reuse && reuse.score <= best.score + 2.5) return reuse.p;
    }
    return best.p;
  };
  const jitter = archetype === 'catacombs' ? .7 : .18;
  const route = (from: number, to: number, strict: boolean): number[] | undefined => {
    // A* по клеткам с учётом поворотов: состояние = клетка × направление.
    const total = W * H * 4;
    const g = new Float32Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const heap: number[] = [], fval: number[] = [];
    const push = (state: number, f: number) => {
      heap.push(state); fval.push(f);
      let i = heap.length - 1;
      while (i > 0) {
        const up2 = (i - 1) >> 1;
        if (fval[up2] <= fval[i]) break;
        [heap[i], heap[up2]] = [heap[up2], heap[i]]; [fval[i], fval[up2]] = [fval[up2], fval[i]];
        i = up2;
      }
    };
    const pop = () => {
      const top = heap[0];
      const lastS = heap.pop()!, lastF = fval.pop()!;
      if (heap.length) {
        heap[0] = lastS; fval[0] = lastF;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && fval[l] < fval[m]) m = l;
          if (r < heap.length && fval[r] < fval[m]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; [fval[i], fval[m]] = [fval[m], fval[i]];
          i = m;
        }
      }
      return top;
    };
    const tx = to % W, ty = Math.floor(to / W);
    const h0 = (cell: number) => Math.abs((cell % W) - tx) + Math.abs(Math.floor(cell / W) - ty);
    for (let d = 0; d < 4; d += 1) { g[from * 4 + d] = 0; push(from * 4 + d, h0(from)); }
    while (heap.length) {
      const state = pop();
      const cell = state >> 2, dir = state & 3;
      if (cell === to) {
        const path: number[] = [];
        for (let at = state; at >= 0; at = parent[at]) path.push(at >> 2);
        return path.reverse();
      }
      const x = cell % W, y = (cell - x) / W;
      for (let nd = 0; nd < 4; nd += 1) {
        const nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
        if (!inner(nx, ny)) continue;
        const next = id(nx, ny);
        let cost = 1;
        if (next !== to) {
          if (owner[next] >= 0) { if (strict) continue; cost += 60; }
          else if (ring[next]) { if (strict) continue; cost += 25; }
        }
        if (corridor[next]) cost = .4;
        else if (DIRS.some(([dx, dy]) => corridor[id(nx + dx, ny + dy)] && inner(nx + dx, ny + dy))) cost += .9;
        if (nd !== dir && cell !== from) cost += .5;
        cost += hash2(nx, ny, levelSeed + 0xa57a) * jitter;
        const ns = next * 4 + nd;
        const tentative = g[state] + cost;
        if (tentative >= g[ns]) continue;
        g[ns] = tentative;
        parent[ns] = state;
        push(ns, tentative + h0(next));
      }
    }
    return undefined;
  };
  interface Link { edge: Edge; doorA: number; doorB: number }
  const routed: Link[] = [];
  const order = edges.map((e, i) => ({ e, i, w: weight(e.a, e.b) }))
    // Обычные рёбра прокладываем первыми, тайник и сокровищницу — последними:
    // их двери не должны достаться чужим коридорам.
    .sort((p, q) => Number(special(p.e.a) || special(p.e.b)) - Number(special(q.e.a) || special(q.e.b)) || Number(p.e.loop) - Number(q.e.loop) || p.w - q.w || p.i - q.i);
  for (const { e, i } of order) {
    const fresh = special(e.a) || special(e.b);
    const pa = choosePort(e.a, centreOf(rooms[e.b].rect), i * 2, fresh);
    const pb = choosePort(e.b, centreOf(rooms[e.a].rect), i * 2 + 1, fresh);
    if (!pa || !pb) continue;
    const path = route(pa.out, pb.out, true) ?? route(pa.out, pb.out, false);
    if (!path) continue;
    for (const port of [pa, pb]) {
      carved[port.door] = 1;
      portOut.set(port.door, port.out);
    }
    if (!doorsOf[e.a].includes(pa.door)) doorsOf[e.a].push(pa.door);
    if (!doorsOf[e.b].includes(pb.door)) doorsOf[e.b].push(pb.door);
    path.forEach((cell, k) => {
      carved[cell] = 1;
      corridor[cell] = 1;
      if (e.width > 1 && k >= 2 && k < path.length - 2) {
        const x = cell % W, y = (cell - x) / W;
        const block = e.width === 2 ? [[1, 0], [0, 1], [1, 1]] : AROUND;
        for (const [dx, dy] of block) {
          const nx = x + dx, ny = y + dy;
          if (!inner(nx, ny) || owner[id(nx, ny)] >= 0 || ring[id(nx, ny)]) continue;
          carved[id(nx, ny)] = 1;
          corridor[id(nx, ny)] = 1;
        }
      }
    });
    centreline.set(e.width, (centreline.get(e.width) ?? 0) + path.length);
    routed.push({ edge: e, doorA: pa.door, doorB: pb.door });
  }

  // Любой проход в зал помимо задуманных дверей (запасной маршрут A* через
  // чужой зал) становится аркой: зал не остаётся с дырой в стене.
  const doorCells = new Set<number>(routed.flatMap((link) => [link.doorA, link.doorB]));
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const cell = id(x, y);
    if (!corridor[cell] || owner[cell] >= 0) continue;
    if (DIRS.some(([dx, dy]) => owner[id(x + dx, y + dy)] >= 0)) doorCells.add(cell);
  }

  // ---- 6. Вид дверей по смыслу ребра ---------------------------------------
  const PRIORITY: Record<DoorKind, number> = { secret: 9, portcullis: 8, gate: 7, blocked: 6, double: 5, arch: 4, broken: 3, normal: 1 };
  const wanted = new Map<number, DoorKind>();
  const uses = new Map<number, Link[]>();
  for (const link of routed) for (const door of [link.doorA, link.doorB]) uses.set(door, [...(uses.get(door) ?? []), link]);
  const want = (door: number, kind: DoorKind) => {
    const current = wanted.get(door);
    if (!current || PRIORITY[kind] > PRIORITY[current]) wanted.set(door, kind);
  };
  const entranceIndex = rooms.findIndex((room) => room.role === 'entrance');
  const firstFromEntrance = routed.filter((link) => !link.edge.loop && (link.edge.a === entranceIndex || link.edge.b === entranceIndex))
    .sort((p, q) => weight(p.edge.a, p.edge.b) - weight(q.edge.a, q.edge.b))[0];
  const brokenShare = archetype === 'catacombs' ? .2 : .12, archShare = archetype === 'catacombs' ? .45 : .3;
  let blockedOne = false;
  for (const link of routed) {
    const { a, b, loop, width } = link.edge;
    for (const [door, self, other] of [[link.doorA, a, b], [link.doorB, b, a]] as const) {
      const role = rooms[self].role, otherRole = rooms[other].role;
      if (otherRole === 'secret') want(door, 'secret');
      else if (role === 'treasury') want(door, 'portcullis');
      else if (role === 'secret') want(door, 'normal');
      else if (link === firstFromEntrance && self === entranceIndex && level === 0) want(door, 'gate');
      else if (role === 'hall') want(door, width >= 2 ? 'double' : 'arch');
      else if (role === 'shrine') want(door, 'arch');
      else if (role === 'cell') want(door, 'normal');
      else {
        const roll = hash2(door, self, levelSeed + 0xd00);
        want(door, roll < brokenShare ? 'broken' : roll < brokenShare + archShare ? 'arch' : 'normal');
      }
    }
    // Один завал на уровень — только на кольце и только если дверь не нужна
    // другому коридору: связность остаётся полной.
    if (loop && !blockedOne && (uses.get(link.doorB)?.length ?? 0) === 1 && !special(b)) {
      wanted.set(link.doorB, 'blocked');
      blockedOne = true;
    }
  }
  for (const door of doorCells) if (!wanted.has(door)) wanted.set(door, 'arch');

  // ---- 7. Ниши вдоль стен --------------------------------------------------
  const niches: { cell: number; room: number }[] = [];
  rooms.forEach((room, index) => {
    if (!room.features.includes('niches')) return;
    const limit = room.role === 'burial' ? 8 : 5;
    const horizontal = room.rect.w >= room.rect.h;
    const sides: [number, number][] = room.role === 'ossuary' ? [...DIRS] : horizontal ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    let made = 0;
    for (const [dx, dy] of sides) {
      const cellsOnSide = [...room.cells].filter((cell) => {
        const x = cell % W, y = (cell - x) / W;
        return owner[id(x + dx, y + dy)] !== index;
      }).sort((p, q) => p - q);
      cellsOnSide.forEach((cell, k) => {
        if (made >= limit || k % 2 === 0) return;
        const x = cell % W, y = (cell - x) / W;
        const ox = x + dx, oy = y + dy;
        if (!inner(ox, oy) || carved[id(ox, oy)]) return;
        if (room.water.has(cell)) return;
        const clear = AROUND.every(([ax, ay]) => {
          const nx = ox + ax, ny = oy + ay;
          if (owner[id(nx, ny)] === index) return ax === -dx || ay === -dy;
          return !carved[id(nx, ny)] && !doorCells.has(id(nx, ny));
        });
        if (!clear) return;
        carved[id(ox, oy)] = 1;
        niches.push({ cell: id(ox, oy), room: index });
        made += 1;
      });
    }
  });

  // ---- 8. Клетки карты -----------------------------------------------------
  const ink = new Perlin(levelSeed);
  const cells: Cell[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x): Cell => ({
    terrain: 'void', height: ink.fbm(x * .1, y * .1, 2), moisture: ink.fbm(x * .07 + 30, y * .07 + 30, 2),
  })));
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const cell = id(x, y);
    if (carved[cell]) cells[y][x].terrain = doorCells.has(cell) ? 'door' : waterCells.has(cell) ? 'water' : 'floor';
    else if (AROUND.some(([dx, dy]) => carved[id(x + dx, y + dy)] && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H)) cells[y][x].terrain = 'wall';
  }
  // Лужи в низинах залов (как в прежнем генераторе), но не в купели и не у дверей.
  const nearDoor = (x: number, y: number) => AROUND.some(([dx, dy]) => cells[y + dy]?.[x + dx]?.terrain === 'door');
  if (s.waterLevel > .3) for (const room of rooms) {
    if (room.cells.size < 12 || room.water.size) continue;
    // Центр зала сухой: от него считают достижимость repairMap и точка входа.
    const middle = centreOf(room.rect);
    const low = [...room.cells].map((cell) => ({ cell, x: cell % W, y: Math.floor(cell / W) }))
      .filter(({ x, y }) => cells[y][x].terrain === 'floor' && cells[y][x].height < s.waterLevel * .45 && !nearDoor(x, y)
        && (x !== middle.x || y !== middle.y))
      .sort((p, q) => cells[p.y][p.x].height - cells[q.y][q.x].height || p.cell - q.cell);
    const budget = Math.min(low.length, Math.max(1, Math.round(room.cells.size * .03)));
    for (let i = 0; i < budget; i += 1) cells[low[i].y][low[i].x].terrain = 'water';
  }
  const rocks: Rock[] = [];
  const trees: Tree[] = [];
  const debris = mulberry32(mix(levelSeed, 0xdeb));
  for (const room of rooms) for (const cell of [...room.cells].sort((p, q) => p - q)) {
    const x = cell % W, y = (cell - x) / W;
    if (cells[y][x].terrain !== 'floor') continue;
    // repairMap проверяет объект по клетке округлённых координат, поэтому
    // и центр клетки, и её правый нижний сосед должны быть полом.
    const settled = (px: number, py: number) => cells[Math.round(py)]?.[Math.round(px)]?.terrain === 'floor';
    if (debris() < s.rocks * .06) {
      const r = .15 + debris() * .2;
      const pts: [number, number][] = Array.from({ length: 6 }, (_, k) => {
        const angle = (k / 6) * Math.PI * 2;
        const radius = r * (.7 + debris() * .3);
        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
      });
      const rock = { x: x + .5 + (debris() - .5) * .5, y: y + .5 + (debris() - .5) * .5, r, pts, v: debris() };
      if (settled(rock.x, rock.y)) rocks.push(rock);
    } else if (debris() < s.vegetation * .03) {
      const tree = { x: x + .5, y: y + .5, r: .15 + debris() * .1, kind: 'mushroom' as const, v: debris() };
      if (settled(tree.x, tree.y)) trees.push(tree);
    }
  }

  // ---- 9. Порядок залов как у декоратора и план ----------------------------
  // decorateCrypt сортирует залы по центру снизу вверх; тот же порядок в
  // structures и plan.rooms держит индексы плана и cryptRooms согласованными.
  const sortedIdx = rooms.map((_, i) => i).sort((p, q) => centreOf(rooms[q].rect).y - centreOf(rooms[p].rect).y || rooms[p].rect.x - rooms[q].rect.x);
  const position = new Map(sortedIdx.map((original, k) => [original, k]));
  const structures = sortedIdx.map((i) => rooms[i].rect);
  const hallTheme = CRYPT_HALL_THEME[archetype];
  const themes = sortedIdx.map((i) => { const t = ROOM_ROLES[rooms[i].role].theme; return t === 'hall' ? hallTheme : t; });
  const depth = new Array<number>(rooms.length).fill(-1);
  if (entranceIndex >= 0) {
    depth[entranceIndex] = 0;
    const queue = [entranceIndex];
    for (let i = 0; i < queue.length; i += 1) for (const link of routed) {
      const at = queue[i];
      const next = link.edge.a === at ? link.edge.b : link.edge.b === at ? link.edge.a : -1;
      if (next < 0 || depth[next] >= 0) continue;
      depth[next] = depth[at] + 1;
      queue.push(next);
    }
  }
  const planRooms: DungeonRoom[] = sortedIdx.map((i, k) => ({
    id: `room-${k}`,
    purpose: rooms[i].role,
    bounds: { x: rooms[i].rect.x, y: rooms[i].rect.y, w: rooms[i].rect.w, h: rooms[i].rect.h },
    depth: Math.max(0, depth[i]),
    shape: rooms[i].shape,
    features: rooms[i].features.length ? [...rooms[i].features] : undefined,
    category: ROOM_ROLES[rooms[i].role].category,
  }));
  const graph: RoadGraphEdge[] = routed.map((link) => ({ from: `room-${position.get(link.edge.a)}`, to: `room-${position.get(link.edge.b)}`, length: Math.round(weight(link.edge.a, link.edge.b) * 10) / 10 }));
  const doorMarks: DoorMark[] = [...wanted].filter(([, kind]) => kind !== 'normal')
    .map(([cell, kind]) => ({ x: cell % W, y: Math.floor(cell / W), kind })).sort((p, q) => p.y - q.y || p.x - q.x);
  const bare: MapData = { width: W, height: H, biome: 'dungeon', cells, trees, rocks, structures, chests: [], river: [], road: [], doors: doorMarks };
  const basePlan: GenerationPlan = { version: 1, engine: 'structured', zones: [], poi: [], groups: [], rooms: planRooms, graph };

  // ---- 10. Архитектурное убранство: лестницы, ниши, центр зала -------------
  // Завал непроходим. Декоратор и проверки связности о видах дверей не знают,
  // поэтому на время расстановки клетка завала считается стеной: проходы и
  // блокирующие предметы раскладываются так, чтобы залы оставались достижимы
  // в обход завала. В итоговой карте клетка снова становится дверью.
  const blockedCells = doorMarks.filter((d) => d.kind === 'blocked');
  const walled = wallOffBlockedDoors(bare);
  let dressed: MapData = { ...walled, crypt: [] };
  const midpoints = sortedIdx.map((i) => centreOf(rooms[i].rect));
  const reachableMidpoints = (target: MapData) => {
    const start = midpoints[position.get(entranceIndex) ?? 0];
    if (!start || !cryptWalkable(target, start.x, start.y)) return 0;
    const seen = new Uint8Array(W * H);
    const queue = [id(start.x, start.y)];
    seen[queue[0]] = 1;
    for (let i = 0; i < queue.length; i += 1) {
      const x = queue[i] % W, y = (queue[i] - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[id(nx, ny)] || !cryptWalkable(target, nx, ny)) continue;
        seen[id(nx, ny)] = 1;
        queue.push(id(nx, ny));
      }
    }
    return midpoints.filter((p) => seen[id(p.x, p.y)]).length;
  };
  let reachable = reachableMidpoints(dressed);
  const put = (kind: CryptKind, at: Point, rotation: 0 | 90 = 0): boolean => {
    const item: CryptObject = { ...cryptStamp(at, kind, rotation, false), source: 'layout' };
    if (!canPlaceCrypt(dressed, item)) return false;
    for (let y = item.y; y < item.y + item.h; y += 1) for (let x = item.x; x < item.x + item.w; x += 1) {
      if (midpoints.some((p) => p.x === x && p.y === y) || nearDoor(x, y)) return false;
    }
    const next = { ...dressed, crypt: [...dressed.crypt!, item] };
    if (CRYPT[kind].blocks) {
      const count = reachableMidpoints(next);
      if (count < reachable) return false;
      reachable = count;
    }
    dressed = next;
    return true;
  };
  let stairsUp: Point | undefined, stairsDown: Point | undefined;
  if (up) {
    const at = stairFootprint(up);
    if (put('stairsUp', at)) stairsUp = at;
  }
  if (down) {
    const at = stairFootprint(down);
    if (put('stairsDown', at)) stairsDown = at;
  }
  if (!up && entranceIndex >= 0) {
    // Верхний уровень: выход на поверхность — в зале входа, рядом с центром.
    const room = rooms[entranceIndex];
    const c = centreOf(room.rect);
    const spots = [...room.cells].map((cell) => ({ x: cell % W, y: Math.floor(cell / W) }))
      .sort((p, q) => Math.hypot(p.x - c.x + 1.5, p.y - c.y + 1.5) - Math.hypot(q.x - c.x + 1.5, q.y - c.y + 1.5) || p.y - q.y || p.x - q.x);
    for (const spot of spots) if (put('stairsUp', spot)) { stairsUp = spot; break; }
  }
  const NICHE: Partial<Record<CryptTheme, CryptKind[]>> = {
    burial: ['wrappedBody', 'burialUrn', 'skeletonPile'], ossuary: ['bonePile', 'skull', 'skeletonPile'],
    archive: ['scrollRack', 'bookcase'], quarters: ['shelf', 'urns'], sanctum: ['mournerStatue', 'statue'],
  };
  for (const { cell, room } of niches) {
    const theme = themes[position.get(room)!];
    const pool = NICHE[theme] ?? ['urns', 'statue'];
    put(pool[Math.floor(hash2(cell, room, levelSeed + 0x41c) * pool.length)], { x: cell % W, y: Math.floor(cell / W) });
  }
  rooms.forEach((room, index) => {
    const c = centreOf(room.rect);
    const theme = themes[position.get(index)!];
    if (room.features.includes('rotunda')) {
      if (!put(theme === 'sanctum' ? 'altar' : 'statue', { x: c.x - 1, y: c.y - 1 })) put('pedestal', { x: c.x, y: c.y - 1 });
    }
    if (room.features.includes('dais')) {
      if (put('runeCircle', { x: c.x - 1, y: c.y - 1 })) {
        put('candleStand', { x: c.x - 2, y: c.y - 1 });
        put('candleStand', { x: c.x + 1, y: c.y - 1 });
      }
    }
  });

  // ---- 11. Прежний конвейер склепа -----------------------------------------
  const decorSettings: GenSettings = { ...s, seed: levelSeed };
  const furnished = furnishByPurpose(dressed, basePlan);
  const decorated = decorateCrypt(walled, decorSettings, furnished.map.crypt ?? [], themes, processionalLanes(walled, walled.structures));
  const composed = cryptCompositionPlan(decorated, furnished.plan);
  const trapped = placeCorridorTraps({ ...decorated, plan: composed }, composed);
  const onBlocked = (item: CryptObject) => blockedCells.some((d) => d.x >= item.x && d.x < item.x + item.w && d.y >= item.y && d.y < item.y + item.h);
  const finalMap: MapData = { ...decorated, cells, crypt: (trapped.map.crypt ?? []).filter((item) => !onBlocked(item)) };

  // ---- 12. Отчёт -----------------------------------------------------------
  const blocked = new Set(doorMarks.filter((d) => d.kind === 'blocked').map((d) => id(d.x, d.y)));
  const start = midpoints[position.get(entranceIndex) ?? 0];
  const seen = new Uint8Array(W * H);
  if (start && cryptWalkable(finalMap, start.x, start.y)) {
    const queue = [id(start.x, start.y)];
    seen[queue[0]] = 1;
    for (let i = 0; i < queue.length; i += 1) {
      const x = queue[i] % W, y = (queue[i] - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        const cell = id(nx, ny);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[cell] || blocked.has(cell) || !cryptWalkable(finalMap, nx, ny)) continue;
        seen[cell] = 1;
        queue.push(cell);
      }
    }
  }
  const finalDegree = new Array<number>(rooms.length).fill(0);
  for (const link of routed) { finalDegree[link.edge.a] += 1; finalDegree[link.edge.b] += 1; }
  const count = <K extends string>(values: K[]) => values.reduce<Partial<Record<K, number>>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  const report: DungeonLayoutReport = {
    generator: DUNGEON_GENERATOR_VERSION,
    level,
    levels,
    requested,
    placed: rooms.length,
    shapes: count(rooms.map((room) => room.shape)),
    features: count(rooms.flatMap((room) => room.features)),
    doors: count([...wanted.values()]),
    loops: routed.filter((link) => link.edge.loop).length,
    deadEnds: rooms.filter((_, i) => !intendedEnd(i) && finalDegree[i] <= 1).length,
    corridorWidths: { 1: centreline.get(1) ?? 0, 2: centreline.get(2) ?? 0, 3: centreline.get(3) ?? 0 },
    secretRooms: rooms.filter((room) => room.role === 'secret').length,
    stairsUp,
    stairsDown,
    connected: midpoints.every((p) => seen[id(p.x, p.y)] === 1),
  };
  const spawn = stairsUp ? { x: stairsUp.x, y: stairsUp.y + 2 <= H - 1 && cryptWalkable(finalMap, stairsUp.x, stairsUp.y + 2) ? stairsUp.y + 2 : stairsUp.y } : start;
  const actions = [...(trapped.plan.actions ?? [])];
  if (missing) actions.push(`не поместилось залов: ${missing} из ${requested}`);
  return { ...finalMap, plan: { ...trapped.plan, spawn, dungeon: report, actions } };
}

/** Короткая подпись роли для отчёта и подсказок. */
export const roleLabel = (purpose: RoomPurpose): string => (purpose === 'crypt' ? 'Крипта' : (ROOM_ROLES as Partial<Record<RoomPurpose, RoleSpec>>)[purpose]?.label ?? purpose);
