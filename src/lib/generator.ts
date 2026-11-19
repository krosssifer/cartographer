import { Perlin } from './noise';
import { cryptBlueprint, decorateCrypt } from './cryptLayout';
import { generateSettlement } from './settlement';
import { mulberry32, randInt, pick, type Rng } from './random';
import type {
  Biome,
  Cell,
  GenSettings,
  MapData,
  Point,
  Rock,
  Structure,
  Terrain,
  Tree,
  TreeKind,
} from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const WATER: Terrain[] = ['water', 'deepWater'];
const isWater = (t: Terrain) => WATER.includes(t);
const isBuilding = (t: Terrain) => t === 'floor' || t === 'wall' || t === 'door';

export function generateMap(s: GenSettings): MapData {
  if (s.biome === 'cave') return generateCave(s);
  if (s.biome === 'dungeon') return generateDungeon(s);
  if (s.biome === 'village' || s.biome === 'town') return generateSettlement(s);
  return generateOverland(s);
}

// ---------- Вспомогательные функции ----------

function emptyCells(w: number, h: number, terrain: Terrain): Cell[][] {
  const cells: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) row.push({ terrain, height: 0.5, moisture: 0.5 });
    cells.push(row);
  }
  return cells;
}

function inBounds(x: number, y: number, w: number, h: number) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

// Извилистый путь от одного края до противоположного с шумовым смещением
function wavyPath(
  rng: Rng,
  noise: Perlin,
  w: number,
  h: number,
  horizontal: boolean,
  amplitude: number,
  continuous = true,
): Point[] {
  const pts: Point[] = [];
  const len = horizontal ? w : h;
  const span = horizontal ? h : w;
  const start = span * (0.25 + rng() * 0.5);
  const end = span * (0.25 + rng() * 0.5);
  const off = rng() * 1000;
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1);
    const base = start + (end - start) * t;
    const n = (noise.fbm(i * 0.08 + off, off, 3) - 0.5) * 2 * amplitude;
    const p = clamp(Math.round(base + n), 1, span - 2);
    pts.push(horizontal ? { x: i, y: p } : { x: p, y: i });
  }
  return continuous ? connectPath(pts, horizontal) : pts;
}

function connectPath(pts: Point[], horizontal: boolean): Point[] {
  const full: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) {
      const prev = pts[i - 1];
      const d = horizontal ? p.y - prev.y : p.x - prev.x;
      const step = Math.sign(d);
      for (let k = 1; k <= Math.abs(d); k++) {
        full.push(horizontal ? { x: prev.x, y: prev.y + step * k } : { x: prev.x + step * k, y: prev.y });
      }
    }
    full.push(p);
  }
  return full;
}

function routeRoad(cells: Cell[][], samples: Point[], horizontal: boolean, span: number) {
  const along = (i: number, lane: number) => horizontal ? { x: i, y: lane } : { x: lane, y: i };
  const laneOf = (p: Point) => horizontal ? p.y : p.x;
  const inWater = (p: Point) => isWater(cells[p.y][p.x].terrain);
  const base = connectPath(samples, horizontal);
  const wet = base.filter(inWater);
  if (!wet.length) return base;

  const crossing = wet[Math.floor(wet.length / 2)];
  let best = base, bestScore = Infinity;
  // Route the approach curves around a straight bridge instead of bending the deck through the water.
  for (let lane = 1; lane < span - 1; lane++) {
    if (Math.abs(lane - laneOf(crossing)) > Math.max(5, span * 0.3)) continue;
    const river = samples.flatMap((_, i) => inWater(along(i, lane)) ? [i] : []);
    const middle = horizontal ? crossing.x : crossing.y;
    const start = river.length ? river[0] - 2 : middle - 2;
    const end = river.length ? river[river.length - 1] + 2 : middle + 2;
    const points = samples.map((p, i) => {
      const ease = clamp(Math.max(start - i, i - end, 0) / 8, 0, 1);
      return along(i, Math.round(lane + (laneOf(p) - lane) * ease * ease * (3 - 2 * ease)));
    });
    const path = connectPath(points, horizontal);
    let bridges = 0, wetTiles = 0, wetBends = 0, turns = 0;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], next = path[i + 1];
      const water = inWater(p);
      if (water) {
        if (!i || !inWater(path[i - 1])) bridges++;
        wetTiles++;
      }
      if (next && laneOf(next) !== laneOf(p)) {
        turns++;
        if (water || inWater(next)) wetBends++;
      }
    }
    const deviation = points.reduce((sum, p, i) => sum + Math.abs(laneOf(p) - laneOf(samples[i])), 0) / points.length;
    const score = wetTiles * 0.27 + Math.max(0, bridges - 1) * 8 + wetBends * 18 + turns * 0.12 + deviation * 1.16 + Math.abs(lane - laneOf(crossing)) * 0.18;
    if (score < bestScore) { best = path; bestScore = score; }
  }
  return best;
}

function rockPolygon(rng: Rng, r: number): [number, number][] {
  const n = randInt(rng, 5, 8);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rng() * 0.4);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]);
  }
  return pts;
}

// ---------- Открытая местность ----------

function classify(biome: Biome, h: number, m: number, wl: number): Terrain {
  switch (biome) {
    case 'forest':
      if (h < wl - 0.1) return 'deepWater';
      if (h < wl) return 'water';
      if (h < wl + 0.04) return 'sand';
      if (h > 0.82) return 'rock';
      if (m > 0.58) return 'darkGrass';
      if (m < 0.3) return 'dirt';
      return 'grass';
    case 'plains':
      if (h < wl - 0.1) return 'deepWater';
      if (h < wl) return 'water';
      if (h < wl + 0.04) return 'sand';
      if (h > 0.86) return 'rock';
      if (m < 0.33) return 'dirt';
      if (m > 0.68) return 'darkGrass';
      return 'grass';
    case 'swamp':
      if (h < wl - 0.12) return 'deepWater';
      if (h < wl) return 'water';
      if (h < wl + 0.09) return 'mud';
      if (h > 0.85) return 'rock';
      if (m > 0.45) return 'darkGrass';
      return 'grass';
    case 'desert':
      if (h < wl - 0.2) return 'water';
      if (h > 0.8) return 'rock';
      if (m < 0.3) return 'dirt';
      return 'sand';
    case 'snow':
      if (h < wl - 0.1) return 'deepWater';
      if (h < wl) return 'ice';
      if (h > 0.8) return 'rock';
      if (m < 0.3 && h > 0.6) return 'rock';
      return 'snow';
    default:
      return 'grass';
  }
}

function generateOverland(s: GenSettings): MapData {
  const { width: w, height: h, biome } = s;
  const rng = mulberry32(s.seed);
  const hn = new Perlin(s.seed);
  const mn = new Perlin(s.seed + 7919);
  const cells = emptyCells(w, h, 'grass');

  const scale = 0.035 + s.roughness * 0.1;
  const octaves = 2 + Math.round(s.roughness * 3);
  const wl = biome === 'desert' ? s.waterLevel * 0.8 : s.waterLevel;

  // Слой 1–2: высота и влажность
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hv = hn.fbm(x * scale, y * scale, octaves);
      const mv = mn.fbm(x * 0.06 + 100, y * 0.06 + 100, 3);
      cells[y][x] = { terrain: classify(biome, hv, mv, wl), height: hv, moisture: mv };
    }
  }

  // Слой 3: река
  const river: Point[] = [];
  const riverHorizontal = rng() > 0.5;
  if (s.river) {
    const path = wavyPath(rng, hn, w, h, riverHorizontal, h * 0.25);
    const wide = w * h > 600;
    for (const p of path) {
      river.push(p);
      const cells2: Point[] = [p];
      if (wide) cells2.push(riverHorizontal ? { x: p.x, y: p.y + 1 } : { x: p.x + 1, y: p.y });
      for (const c of cells2) {
        if (!inBounds(c.x, c.y, w, h)) continue;
        cells[c.y][c.x].terrain = 'water';
        cells[c.y][c.x].height = Math.min(cells[c.y][c.x].height, wl - 0.02);
      }
      // Берег
      for (let dy = -1; dy <= (wide ? 2 : 1); dy++) {
        for (let dx = -1; dx <= (wide ? 2 : 1); dx++) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          if (!inBounds(nx, ny, w, h)) continue;
          const c = cells[ny][nx];
          if (!isWater(c.terrain) && c.terrain !== 'rock') {
            c.terrain = biome === 'swamp' ? 'mud' : biome === 'snow' ? 'snow' : 'sand';
          }
        }
      }
    }
  }

  // Слой 4: дорога (перпендикулярно реке по возможности)
  const road: Point[] = [];
  if (s.road) {
    const horizontal = s.river ? !riverHorizontal : rng() > 0.5;
    const path = routeRoad(cells, wavyPath(rng, mn, w, h, horizontal, h * 0.15, false), horizontal, horizontal ? h : w);
    for (const p of path) {
      road.push(p);
      const c = cells[p.y][p.x];
      c.terrain = isWater(c.terrain) ? 'bridge' : 'road';
    }
  }

  // Слой 5: постройки
  const structures: Structure[] = [];
  let attempts = 0;
  while (structures.length < s.structures && attempts < 200) {
    attempts++;
    const sw = randInt(rng, 4, Math.min(9, Math.floor(w / 3)));
    const sh = randInt(rng, 4, Math.min(8, Math.floor(h / 3)));
    const sx = randInt(rng, 1, w - sw - 2);
    const sy = randInt(rng, 1, h - sh - 2);
    let ok = true;
    for (let y = sy - 1; y <= sy + sh && ok; y++) {
      for (let x = sx - 1; x <= sx + sw && ok; x++) {
        if (!inBounds(x, y, w, h)) { ok = false; break; }
        const t = cells[y][x].terrain;
        if (isWater(t) || t === 'road' || t === 'bridge' || t === 'rock' || isBuilding(t)) ok = false;
      }
    }
    if (!ok) continue;
    const ruin = s.ruined;
    structures.push({ x: sx, y: sy, w: sw, h: sh, ruin });
    for (let y = sy; y < sy + sh; y++) {
      for (let x = sx; x < sx + sw; x++) {
        const border = x === sx || y === sy || x === sx + sw - 1 || y === sy + sh - 1;
        cells[y][x].terrain = border ? 'wall' : 'floor';
      }
    }
    // Дверь на случайной стороне
    const side = randInt(rng, 0, 3);
    let dx = sx, dy = sy;
    if (side === 0) { dy = sy; dx = sx + randInt(rng, 1, sw - 2); }
    if (side === 1) { dy = sy + sh - 1; dx = sx + randInt(rng, 1, sw - 2); }
    if (side === 2) { dx = sx; dy = sy + randInt(rng, 1, sh - 2); }
    if (side === 3) { dx = sx + sw - 1; dy = sy + randInt(rng, 1, sh - 2); }
    cells[dy][dx].terrain = 'door';
    // Руины: разрушаем часть стен и пола
    if (ruin) {
      for (let y = sy; y < sy + sh; y++) {
        for (let x = sx; x < sx + sw; x++) {
          const c = cells[y][x];
          const corner = (x === sx || x === sx + sw - 1) && (y === sy || y === sy + sh - 1);
          if (c.terrain === 'wall' && !corner && rng() < 0.35) c.terrain = 'floor';
          else if (c.terrain === 'floor' && rng() < 0.25) c.terrain = biome === 'desert' ? 'sand' : biome === 'snow' ? 'snow' : 'grass';
        }
      }
    }
  }

  // Слой 6: растительность
  const trees: Tree[] = [];
  const rocks: Rock[] = [];
  const treeKinds: Record<Biome, TreeKind[]> = {
    forest: ['oak', 'oak', 'pine', 'bush'],
    plains: ['oak', 'bush', 'bush'],
    swamp: ['dead', 'dead', 'reed', 'mushroom', 'bush'],
    desert: ['cactus', 'cactus', 'dead', 'bush'],
    snow: ['pine', 'pine', 'dead'],
    cave: ['mushroom'],
    dungeon: [],
    village: ['oak', 'bush', 'pine'],
    town: ['oak', 'bush'],
  };
  const vegMul: Record<Biome, number> = { forest: 0.55, plains: 0.18, swamp: 0.35, desert: 0.12, snow: 0.3, cave: 0, dungeon: 0, village: 0.2, town: 0.1 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cells[y][x];
      const t = c.terrain;
      const plantable = t === 'grass' || t === 'darkGrass' || t === 'dirt' || t === 'snow' || t === 'sand' || (t === 'mud' && biome === 'swamp');
      if (plantable) {
        // Сгущение по влажности, чтобы получались рощи
        const cluster = biome === 'desert' ? 1 - c.moisture : c.moisture;
        const p = s.vegetation * vegMul[biome] * (0.4 + cluster * 1.2) * (t === 'sand' && biome !== 'desert' ? 0.2 : 1);
        if (rng() < p) {
          let kind = pick(rng, treeKinds[biome]);
          if (biome === 'swamp' && t === 'mud') kind = rng() < 0.6 ? 'reed' : 'dead';
          const r = kind === 'bush' || kind === 'mushroom' || kind === 'reed' ? 0.24 + rng() * 0.16 : 0.38 + rng() * 0.3;
          trees.push({ x: x + 0.3 + rng() * 0.4, y: y + 0.3 + rng() * 0.4, r, kind, v: rng() });
        }
      }
      const rockable = t === 'rock' || t === 'dirt' || t === 'grass' || t === 'sand' || t === 'snow' || t === 'darkGrass';
      if (rockable) {
        const p = s.rocks * (t === 'rock' ? 0.35 : 0.04);
        if (rng() < p) {
          const r = 0.2 + rng() * 0.3;
          rocks.push({ x: x + 0.5 + (rng() - 0.5) * 0.4, y: y + 0.5 + (rng() - 0.5) * 0.4, r, pts: rockPolygon(rng, r), v: rng() });
        }
      }
    }
  }

  return { width: w, height: h, biome, cells, trees, rocks, structures, chests: [], river, road };
}

// ---------- Пещера (клеточные автоматы) ----------

function generateCave(s: GenSettings): MapData {
  const { width: w, height: h } = s;
  const rng = mulberry32(s.seed);
  const hn = new Perlin(s.seed);
  let grid: boolean[][] = []; // true = стена
  const fill = 0.58 - s.caveOpenness * 0.25;
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      row.push(edge || rng() < fill);
    }
    grid.push(row);
  }
  const iterations = 4 + Math.round(s.roughness * 2);
  for (let it = 0; it < iterations; it++) {
    const next: boolean[][] = grid.map((r) => r.slice());
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!(dx === 0 && dy === 0) && grid[y + dy][x + dx]) n++;
        next[y][x] = n > 4 || (it < 2 && n < 1);
      }
    }
    grid = next;
  }
  // Оставляем только самый крупный регион
  const visited = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  let best: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] || visited[y][x]) continue;
      const region: Point[] = [];
      const stack: Point[] = [{ x, y }];
      visited[y][x] = true;
      while (stack.length) {
        const p = stack.pop()!;
        region.push(p);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = p.x + dx, ny = p.y + dy;
          if (inBounds(nx, ny, w, h) && !grid[ny][nx] && !visited[ny][nx]) {
            visited[ny][nx] = true;
            stack.push({ x: nx, y: ny });
          }
        }
      }
      if (region.length > best.length) best = region;
    }
  }
  const keep = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  for (const p of best) keep[p.y][p.x] = true;

  const cells = emptyCells(w, h, 'caveWall');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hv = hn.fbm(x * 0.09, y * 0.09, 3);
      const mv = hn.fbm(x * 0.05 + 50, y * 0.05 + 50, 2);
      let t: Terrain = keep[y][x] ? 'caveFloor' : 'caveWall';
      if (t === 'caveFloor' && hv < s.waterLevel * 0.7) t = 'water';
      cells[y][x] = { terrain: t, height: hv, moisture: mv };
    }
  }
  // Убираем воду у самых стен, чтобы берег читался
  const trees: Tree[] = [];
  const rocks: Rock[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = cells[y][x];
      if (c.terrain !== 'caveFloor') continue;
      if (rng() < s.rocks * 0.08) {
        const r = 0.18 + rng() * 0.28;
        rocks.push({ x: x + 0.5 + (rng() - 0.5) * 0.5, y: y + 0.5 + (rng() - 0.5) * 0.5, r, pts: rockPolygon(rng, r), v: rng() });
      } else if (rng() < s.vegetation * 0.08 * c.moisture * 2) {
        trees.push({ x: x + 0.3 + rng() * 0.4, y: y + 0.3 + rng() * 0.4, r: 0.18 + rng() * 0.15, kind: 'mushroom', v: rng() });
      }
    }
  }
  return { width: w, height: h, biome: 'cave', cells, trees, rocks, structures: [], chests: [], river: [], road: [] };
}

// ---------- Подземелье (комнаты + коридоры) ----------

function generateDungeon(s: GenSettings): MapData {
  const { width: w, height: h } = s;
  const rng = mulberry32(s.seed);
  const hn = new Perlin(s.seed);
  const cells = emptyCells(w, h, 'void');
  const rooms = cryptBlueprint(s);
  const carved = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const roomCell = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { carved[y][x] = true; roomCell[y][x] = true; }
  }
  // Соединяем комнаты L-образными коридорами по порядку, плюс пара случайных петель
  const corridor: Point[] = [];
  const connect = (a: Structure, b: Structure) => {
    const ax = Math.floor(a.x + a.w / 2), ay = Math.floor(a.y + a.h / 2);
    const bx = Math.floor(b.x + b.w / 2), by = Math.floor(b.y + b.h / 2);
    const horizFirst = rng() > 0.5;
    const pts: Point[] = [];
    if (horizFirst) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) pts.push({ x, y: ay });
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) pts.push({ x: bx, y });
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) pts.push({ x: ax, y });
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) pts.push({ x, y: by });
    }
    for (const p of pts) {
      if (inBounds(p.x, p.y, w, h)) { carved[p.y][p.x] = true; corridor.push(p); }
    }
  };
  const linked = rooms.slice(0, 1), remain = rooms.slice(1);
  const gap = (a: Structure, b: Structure) => Math.abs(a.x + a.w / 2 - b.x - b.w / 2) + Math.abs(a.y + a.h / 2 - b.y - b.h / 2);
  while (remain.length) {
    let nearest = Infinity, edge = 0, entrance = linked[0];
    linked.forEach((a) => remain.forEach((b, i) => {
      const d = gap(a, b);
      if (d < nearest) { nearest = d; entrance = a; edge = i; }
    }));
    const wing = remain.splice(edge, 1)[0];
    connect(entrance, wing); linked.push(wing);
  }
  if (rooms.length > 5) connect(rooms[1], rooms[rooms.length - 2]);

  // Стены: слой клеток вплотную к полу. Внутренний слой двойной стены убираем,
  // чтобы между комнатами оставалась одна перегородка, а не две в ряд.
  const wallNear = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const innerWall = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const floorAt = (x: number, y: number) => inBounds(x, y, w, h) && carved[y][x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (carved[y][x]) continue;
    if (floorAt(x - 1, y) || floorAt(x + 1, y) || floorAt(x, y - 1) || floorAt(x, y + 1)) wallNear[y][x] = true;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!wallNear[y][x]) continue;
    const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of sides) {
      const nx = x + dx, ny = y + dy;
      if (!wallNear[ny]?.[nx]) continue;
      if (floorAt(x - dx, y - dy)) { innerWall[ny][nx] = true; break; }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hv = hn.fbm(x * 0.1, y * 0.1, 2);
      cells[y][x].height = hv;
      cells[y][x].moisture = hn.fbm(x * 0.07 + 30, y * 0.07 + 30, 2);
      if (carved[y][x]) {
        cells[y][x].terrain = 'floor';
        continue;
      }
      cells[y][x].terrain = wallNear[y][x] && !innerWall[y][x] ? 'wall' : 'void';
    }
  }
  // Двери: коридорная клетка, примыкающая к комнате, но не внутри неё
  const carvedAt = (x: number, y: number) => inBounds(x, y, w, h) && carved[y][x];
  const roomAt = (x: number, y: number) => inBounds(x, y, w, h) && roomCell[y][x];
  for (const p of corridor) {
    if (roomCell[p.y][p.x] || cells[p.y][p.x].terrain === 'door') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // Вход в комнату: впереди комната, сзади коридор, по бокам стены
      const entering = roomAt(p.x + dx, p.y + dy) && carvedAt(p.x - dx, p.y - dy) && !carvedAt(p.x + dy, p.y + dx) && !carvedAt(p.x - dy, p.y - dx);
      if (!entering) continue;
      const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => inBounds(p.x + ox, p.y + oy, w, h) && cells[p.y + oy][p.x + ox].terrain === 'door');
      if (!nearDoor && rng() < 0.85) {
        cells[p.y][p.x].terrain = 'door';
        break;
      }
    }
  }
  // Гарантирующий проход: эвристика выше может промахнуться (дверь ставится с
  // вероятностью 85% и только при удобной геометрии входа), поэтому каждый зал
  // остаётся с проёмом: ищем клетку вырубленного коридора снаружи зала, примыкающую
  // к его полу, и ставим дверь туда. Случайных чисел здесь нет, а порядок обхода
  // (y, затем x) делает выбор детерминированным.
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const roomHasDoor = (room: Structure) => {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny, w, h) && cells[ny][nx].terrain === 'door') return true;
        }
      }
    }
    return false;
  };
  // Стена или пустота: по таким сторонам проём читается как дверной проход.
  const solid = (x: number, y: number) => inBounds(x, y, w, h) && (cells[y][x].terrain === 'wall' || cells[y][x].terrain === 'void');
  for (const room of rooms) {
    if (roomHasDoor(room)) continue;
    let plain: Point | undefined;
    let framed: Point | undefined;
    // Кольцо клеток вокруг зала: снаружи, но вплотную к его полу.
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        if (!inBounds(x, y, w, h) || roomCell[y][x]) continue;
        if (cells[y][x].terrain !== 'floor') continue;
        const side = dirs.find(([dx, dy]) =>
          x + dx >= room.x && x + dx < room.x + room.w && y + dy >= room.y && y + dy < room.y + room.h);
        if (!side) continue;
        if (!plain) plain = { x, y };
        if (!framed && solid(x - side[1], y + side[0]) && solid(x + side[1], y - side[0])) framed = { x, y };
      }
    }
    // Предпочитаем проём со стенами по бокам; если такого нет — первый по (y, x).
    const door = framed ?? plain;
    if (door) cells[door.y][door.x].terrain = 'door';
  }
  // Лужи и обломки
  const rocks: Rock[] = [];
  const trees: Tree[] = [];
  // Вода собирается в низинах залов: клетки строго внутри зала, с отступом от стен,
  // не на коридоре и не у двери, где шум ниже уровня воды. Бюджет — доля площади зала.
  if (s.waterLevel > 0.3) {
    const corridorCells = new Set(corridor.map((p) => p.y * w + p.x));
    const nearDoor = (x: number, y: number) => dirs.some(([dx, dy]) => inBounds(x + dx, y + dy, w, h) && cells[y + dy][x + dx].terrain === 'door');
    for (const r of rooms) {
      if (r.w * r.h < 12) continue;
      const low: { x: number; y: number; height: number }[] = [];
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
          const c = cells[y][x];
          if (c.terrain !== 'floor' || c.height >= s.waterLevel * 0.45) continue;
          if (corridorCells.has(y * w + x) || nearDoor(x, y)) continue;
          low.push({ x, y, height: c.height });
        }
      }
      low.sort((a, b) => a.height - b.height || a.y - b.y || a.x - b.x);
      const budget = Math.min(low.length, Math.max(1, Math.round(r.w * r.h * 0.03)));
      for (let i = 0; i < budget; i++) cells[low[i].y][low[i].x].terrain = 'water';
    }
  }
  // Обломки и грибы — только на оставшемся полу: лужи не зарастают камнями и грибами.
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (cells[y][x].terrain !== 'floor') continue;
        if (rng() < s.rocks * 0.06) {
          const rr = 0.15 + rng() * 0.2;
          rocks.push({ x: x + 0.5 + (rng() - 0.5) * 0.5, y: y + 0.5 + (rng() - 0.5) * 0.5, r: rr, pts: rockPolygon(rng, rr), v: rng() });
        } else if (rng() < s.vegetation * 0.03) {
          trees.push({ x: x + 0.5, y: y + 0.5, r: 0.15 + rng() * 0.1, kind: 'mushroom', v: rng() });
        }
      }
    }
  }
  return decorateCrypt({ width: w, height: h, biome: 'dungeon', cells, trees, rocks, structures: rooms, chests: [], river: [], road: [] }, s);
}
