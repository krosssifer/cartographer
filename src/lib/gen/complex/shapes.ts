/**
 * Геометрия залов комплекса: локальная маска пола w×h и архитектурные
 * подробности (колонны, ниши, перегородки, купель, части составного зала).
 *
 * Маска — единственный источник правды о форме: по ней строятся пол, стены,
 * двери, проверки пересечений и расстановка предметов. Колонны возвращаются
 * отдельными точками и становятся объектами стиля (колонна, крепь, сталагнат),
 * поэтому их можно двигать и удалять в редакторе.
 *
 * Простые формы (прямоугольник, круг, овал, восьмиугольник, Г, Т, крест)
 * берутся из прежнего генератора (shapeMask), чтобы не дублировать код.
 */
import type { Rng } from '../../random';
import type { Point } from '../../types';
import { shapeMask } from '../dungeonArchitect';
import type { RoomFeature, RoomShape } from '../plan';

export interface RoomGeometry {
  mask: boolean[][];
  /** Колонны (локальные клетки внутри маски — пол под объектом). */
  pillars: Point[];
  /** Ниши: клетки пола в выемках стены. */
  niches: Point[];
  /** Клетки купели/озера (вода) и глубокой воды. */
  water: Point[];
  deep: Point[];
  /** Части составного зала для отчёта. */
  parts: string[];
  /** Композиционный «фокус» (апсида, помост, дальний конец) — локальная клетка. */
  focus: Point;
}

const N4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Оставляет связную с (cx, cy) часть маски. */
export function keepConnected(mask: boolean[][], cx: number, cy: number): boolean[][] {
  const h = mask.length, w = mask[0]?.length ?? 0;
  const keep = mask.map((row) => row.map(() => false));
  if (!mask[cy]?.[cx]) return keep;
  keep[cy][cx] = true;
  const stack: Point[] = [{ x: cx, y: cy }];
  while (stack.length) {
    const p = stack.pop()!;
    for (const [dx, dy] of N4) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || keep[y][x] || !mask[y][x]) continue;
      keep[y][x] = true;
      stack.push({ x, y });
    }
  }
  return keep;
}

const grid = (w: number, h: number, fill: boolean) => Array.from({ length: h }, () => new Array<boolean>(w).fill(fill));
const fillRect = (m: boolean[][], x0: number, y0: number, w: number, h: number, value = true) => {
  for (let y = Math.max(0, y0); y < Math.min(m.length, y0 + h); y += 1) for (let x = Math.max(0, x0); x < Math.min(m[0].length, x0 + w); x += 1) m[y][x] = value;
};

/** Правильный многоугольник (6 граней), вписанный в рамку. */
function polygonMask(w: number, h: number, sides: number, turn: number): boolean[][] {
  const m = grid(w, h, false);
  const pts = Array.from({ length: sides }, (_, k) => {
    const a = turn + (k / sides) * Math.PI * 2;
    return { x: w / 2 + Math.cos(a) * (w / 2 + .35), y: h / 2 + Math.sin(a) * (h / 2 + .35) };
  });
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const px = x + .5, py = y + .5;
    let inside = false;
    for (let i = 0, j = sides - 1; i < sides; j = i, i += 1) {
      const a = pts[i], b = pts[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    m[y][x] = inside;
  }
  return m;
}

/** Пещера клеточным автоматом: шум внутри эллипса, 4 сглаживания, связная часть. */
function caveMask(w: number, h: number, rng: Rng): boolean[][] {
  let m = grid(w, h, false);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const nx = (x + .5 - w / 2) / (w / 2), ny = (y + .5 - h / 2) / (h / 2);
    const r = nx * nx + ny * ny;
    m[y][x] = r < .35 || (r < 1 && rng() < .62 - r * .25);
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const next = grid(w, h, false);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let open = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (m[y + dy]?.[x + dx]) open += 1;
      next[y][x] = open >= 5 || (open >= 4 && m[y][x]);
    }
    m = next;
  }
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  fillRect(m, cx - 1, cy - 1, 3, 3);
  return keepConnected(m, cx, cy);
}

export interface GeometryRequest {
  shape: RoomShape;
  features: readonly RoomFeature[];
  w: number;
  h: number;
  /** Сторона, обращённая ко входу комплекса: 0 — восток, 1 — запад, 2 — юг, 3 — север. */
  facing: 0 | 1 | 2 | 3;
  seed: number;
  origin: Point;
  rng: Rng;
}

/** Строит геометрию зала по форме и особенностям. */
export function roomGeometry(req: GeometryRequest): RoomGeometry {
  const { w, h, rng } = req;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const pillars: Point[] = [], niches: Point[] = [], water: Point[] = [], deep: Point[] = [], parts: string[] = [];
  let focus: Point = { x: cx, y: cy };
  let mask: boolean[][];
  // Ось зала: вдоль направления на вход; «дальний» конец — фокус композиции.
  const vertical = req.facing >= 2;
  const toEntryPositive = req.facing === 0 || req.facing === 2;
  const A = vertical ? h : w, C = vertical ? w : h;
  const set = (m: boolean[][], a: number, c: number, v = true) => { const x = vertical ? c : a, y = vertical ? a : c; if (m[y]?.[x] !== undefined) m[y][x] = v; };
  const local = (a: number, c: number): Point => (vertical ? { x: c, y: a } : { x: a, y: c });
  // a=0 — дальний от входа конец.
  const far = (a: number) => (toEntryPositive ? a : A - 1 - a);

  switch (req.shape) {
    case 'hexagon':
      mask = polygonMask(w, h, 6, vertical ? Math.PI / 6 : 0);
      break;
    case 'organic':
      mask = caveMask(w, h, rng);
      break;
    case 'gallery': {
      mask = grid(w, h, true);
      parts.push('галерея');
      break;
    }
    case 'irregular': {
      mask = grid(w, h, true);
      // Выбоины по углам и краям: зал неправильной формы, но читаемый.
      const bites = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < bites; k += 1) {
        const bw = 1 + Math.floor(rng() * Math.max(1, w * .3)), bh = 1 + Math.floor(rng() * Math.max(1, h * .3));
        const corner = Math.floor(rng() * 4);
        const x0 = corner % 2 ? w - bw : 0, y0 = corner >= 2 ? h - bh : 0;
        fillRect(mask, x0, y0, bw, bh, false);
      }
      if (rng() < .5) { const e = Math.floor(rng() * (w - 2)) + 1; fillRect(mask, e, 0, Math.min(2, w - e - 1), 1, false); }
      break;
    }
    case 'partitioned': {
      // Перегородки от одной длинной стены: стойла казармы, отсеки склада.
      mask = grid(w, h, true);
      const side = rng() < .5 ? 0 : C - 1;
      const depth = Math.max(2, Math.floor(C * .55));
      const pitch = 3;
      for (let a = 2; a < A - 1; a += pitch) for (let k = 0; k < depth; k += 1) set(mask, a, side === 0 ? k : C - 1 - k, false);
      parts.push('отсеки');
      break;
    }
    case 'niched': {
      // Тело зала с отступом 1 вдоль длинных сторон и ниши через клетку.
      mask = grid(w, h, false);
      fillRect(mask, vertical ? 1 : 0, vertical ? 0 : 1, vertical ? w - 2 : w, vertical ? h : h - 2);
      for (let a = 1 + (A % 2 === 0 ? 1 : 0); a < A - 1; a += 2) for (const c of [0, C - 1]) {
        set(mask, a, c);
        niches.push(local(a, c));
      }
      parts.push('ниши');
      break;
    }
    case 'composite': {
      // Составной зал: неф, боковые нефы (крылья), апсида в дальнем конце, притвор у входа.
      mask = grid(w, h, false);
      const wing = C >= 9 ? 2 : C >= 7 ? 1 : 0;
      const apse = A >= 10 ? 3 : A >= 8 ? 2 : 0;
      const porch = A >= 11 ? 2 : 0;
      const nave0 = wing, nave1 = C - wing;
      for (let a = apse; a < A - porch; a += 1) for (let c = nave0; c < nave1; c += 1) set(mask, far(a), c);
      parts.push('неф');
      if (wing) {
        // Крылья короче нефа: с обеих сторон, по середине длины.
        const from = apse + 1, to = A - porch - 1;
        for (let a = from; a < to; a += 1) for (let c = 0; c < wing; c += 1) { set(mask, far(a), c); set(mask, far(a), C - 1 - c); }
        parts.push('крылья');
        // Колонны отделяют крылья от нефа.
        for (let a = from + 1; a < to - 1; a += 2) { pillars.push(local(far(a), nave0)); pillars.push(local(far(a), nave1 - 1)); }
      }
      if (apse) {
        // Апсида: полукруг шириной в половину нефа.
        const half = Math.max(1, Math.floor((nave1 - nave0) / 2) - 1);
        const mid = (C - 1) / 2;
        for (let a = 0; a < apse; a += 1) for (let c = 0; c < C; c += 1) {
          const dc = (c - mid) / (half + .5), da = (apse - a) / (apse + .2);
          if (dc * dc + da * da <= 1.05) set(mask, far(a), c);
        }
        parts.push('апсида');
        focus = local(far(1), Math.round(mid));
      }
      if (porch) {
        const pw = Math.max(3, Math.floor((nave1 - nave0) * .6));
        const p0 = Math.floor((C - pw) / 2);
        for (let a = A - porch; a < A; a += 1) for (let c = p0; c < p0 + pw; c += 1) set(mask, far(a), c);
        parts.push('притвор');
      }
      break;
    }
    default:
      mask = shapeMask(req.shape, w, h, req.seed, req.origin);
  }
  if (req.shape === 'gallery' || (req.shape === 'rect' && A >= C * 2)) focus = local(far(0), Math.floor(C / 2));

  // Колонны: ряды вдоль оси (зал с колоннадой) или кольцо (ротонда).
  if (req.features.includes('pillars') && req.shape !== 'composite') {
    const rows = C >= 7 ? [2, C - 3] : C >= 5 ? [1, C - 2] : C >= 4 ? [0, C - 1] : [];
    for (let a = 2; a < A - 2; a += 2) for (const c of rows) if (mask[local(a, c).y]?.[local(a, c).x]) pillars.push(local(a, c));
  }
  if (req.features.includes('rotunda') && Math.min(w, h) >= 8) {
    const radius = Math.floor(Math.min(w, h) / 2) - 2;
    const count = radius >= 3 ? 8 : 6;
    for (let k = 0; k < count; k += 1) {
      const angle = (k / count) * Math.PI * 2 + Math.PI / count;
      const p = { x: Math.round(cx + Math.cos(angle) * radius), y: Math.round(cy + Math.sin(angle) * radius) };
      if (mask[p.y]?.[p.x] && !(p.x === cx && p.y === cy)) pillars.push(p);
    }
  }
  if (req.features.includes('dais') && req.shape !== 'composite') focus = local(far(Math.min(2, A - 1)), Math.floor(C / 2));
  mask[cy][cx] = true;
  mask[focus.y][focus.x] = true;
  mask = keepConnected(mask, cx, cy);

  // Вода: купель вокруг сухого островка с гатью; озеро — глубина в центре.
  if (req.features.includes('pool')) {
    const lake = req.shape === 'organic';
    const radius = lake ? Math.min(w, h) / 2.6 : Math.max(1.5, Math.min(w, h) / 4.2);
    const causeway = N4[Math.floor(rng() * 4)];
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (!mask[y][x]) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      if (!lake) {
        if (x === cx && y === cy) continue;
        const al = (x - cx) * causeway[0] + (y - cy) * causeway[1], as = (x - cx) * causeway[1] - (y - cy) * causeway[0];
        if (al > 0 && as === 0) continue;
      } else {
        // У озера сухой берег по краю маски: вода не касается стен.
        if (N4.some(([dx, dy]) => !mask[y + dy]?.[x + dx]) || [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => !mask[y + dy]?.[x + dx])) continue;
      }
      water.push({ x, y });
      if (lake && d < radius * .55) deep.push({ x, y });
    }
  }
  // Колонны не должны отрезать часть зала и стоять на воде или в нише.
  const wet = new Set(water.map((p) => p.y * w + p.x));
  const nicheSet = new Set(niches.map((p) => p.y * w + p.x));
  const kept: Point[] = [];
  for (const p of pillars) {
    if (!mask[p.y]?.[p.x] || wet.has(p.y * w + p.x) || nicheSet.has(p.y * w + p.x) || (p.x === cx && p.y === cy) || (p.x === focus.x && p.y === focus.y)) continue;
    const test = mask.map((row) => row.slice());
    for (const q of [...kept, p]) test[q.y][q.x] = false;
    for (const q of water) test[q.y][q.x] = false;
    const reach = keepConnected(test, cx, cy);
    const total = test.flat().filter(Boolean).length;
    if (reach.flat().filter(Boolean).length === total) kept.push(p);
  }
  return { mask, pillars: kept, niches: niches.filter((p) => mask[p.y]?.[p.x]), water, deep, parts, focus };
}

/** Влезает ли форма в рамку. */
export function shapeFits(shape: RoomShape, w: number, h: number): boolean {
  const m = Math.min(w, h), M = Math.max(w, h);
  if (shape === 'composite') return m >= 7 && M >= 9;
  if (shape === 'gallery') return M >= m * 2.4 && m >= 3;
  if (shape === 'partitioned') return m >= 5 && M >= 6;
  if (shape === 'niched') return m >= 5 && M >= 5;
  if (shape === 'hexagon' || shape === 'circle' || shape === 'oval' || shape === 'octagon' || shape === 'organic') return m >= 5;
  if (shape === 'irregular' || shape === 'L' || shape === 'T') return m >= 6;
  if (shape === 'cross') return m >= 7;
  return true;
}
