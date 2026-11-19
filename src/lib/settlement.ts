import { Perlin } from './noise';
import { hash2, mulberry32 } from './random';
import { CIVIC_KIT, contains, intersects } from './settlementKit';
import type { Building, Cell, ChestRotation, CivicKind, CivicObject, GenSettings, MapData, Point, RoofMaterial, Selection, SettlementStyle, Terrain, Tree } from './types';

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const between = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wet = (t: Terrain) => t === 'water' || t === 'deepWater' || t === 'bridge';

const TENTS: CivicKind[] = ['marketTentStripe', 'marketTentRound', 'marketTentAwning', 'marketTentCanopy', 'marketTentPatch', 'marketTentTarp', 'marketTentBurlap', 'marketTentBrown'];
const STALLS: CivicKind[] = ['marketStallProduce', 'marketStallBread', 'marketStallFruit', 'marketStallFish', 'marketStallMeat', 'marketStallPottery', 'marketStallFabric', 'marketStallGrain', 'marketStallPotion', 'marketStallTools'];
const GOODS: CivicKind[] = ['marketCrates', 'marketBarrels', 'marketSacks', 'marketBaskets', 'marketBarrelPair', 'marketHay', 'marketRope', 'marketChest', 'marketBarrelLying'];
const SEATS: CivicKind[] = ['marketBench', 'marketTable', 'marketTableSet', 'marketFence'];

interface Plan {
  cells: Cell[][];
  plots: Building[];
  civic: CivicObject[];
  road: Point[];
  river: Point[];
}

let cached: { key: string; value: Plan } | undefined;

function buildPlan(s: GenSettings, style: SettlementStyle): Plan {
  const { width: w, height: h, seed } = s;
  const key = `${style}:${seed}:${w}:${h}:${s.road}:${s.river}:${s.publicSpaces}:${s.marketStyle}:${s.marketRichness}`;
  if (cached?.key === key) return cached.value;
  const town = style === 'town', compact = Math.min(w, h) < 19;
  const rng = mulberry32(seed + (town ? 9415 : 4032));
  const ink = new Perlin(seed + 3801);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const id = (x: number, y: number) => y * w + x;
  const streets = new Uint8Array(w * h), reserved = new Uint8Array(w * h);
  const cells = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x): Cell => {
    const moisture = ink.fbm(x * .088 + 18, y * .088 + 8, 3);
    return {
      terrain: moisture > .61 ? 'darkGrass' : moisture < .34 ? 'dirt' : 'grass',
      height: .49 + (ink.fbm(x * .13, y * .13, 3) - .5) * .32,
      moisture,
    };
  }));
  const river: Point[] = [], civic: CivicObject[] = [];
  const byRiver = s.river && !compact;
  const bank = (y: number) => w * .87 + Math.sin(y / h * 4.2 + .5) * Math.min(3.4, w * .07) + (rngOffset - .5) * 3;
  const rngOffset = rng();
  if (byRiver) for (let y = 0; y < h; y++) {
    const centre = bank(y), width = between(w * .09, 3.0, 7.5) + ink.noise(y * .15, 31) * .65;
    river.push({ x: between(Math.floor(centre), 0, w - 1), y });
    for (let x = 0; x < w; x++) {
      const dist = Math.abs(x + .5 - centre);
      if (dist < width / 2) cells[y][x].terrain = dist < width * .22 ? 'deepWater' : 'water';
      else if (dist < width / 2 + .9 + ink.noise(x * .45, y * .4) * .25) cells[y][x].terrain = 'sand';
    }
  }

  const centre = { x: Math.round(w * (byRiver ? .46 : .5) + (rng() - .5) * (compact ? 0 : 3)), y: Math.round(h * .51 + (rng() - .5) * 2) };
  const pw = compact ? Math.min(5, w - 2) : town ? between(Math.floor(w * .25), 9, 14) : between(Math.floor(w * .18), 6, 9);
  const ph = compact ? Math.min(4, h - 8) : town ? between(Math.floor(h * .27), 7, 11) : between(Math.floor(h * .21), 5, 8);
  if (compact && h < 15) centre.y = h - Math.ceil(ph / 2);
  const px = between(centre.x - Math.floor(pw / 2), 1, w - pw - 1), py = between(centre.y - Math.floor(ph / 2), compact ? 7 : 1, h - ph - 1);
  const plaza = { x: px, y: py, w: pw, h: ph };

  // Keep a tavern-sized plot beside the square before painting streets through the area.
  function tavernLot(): Building {
    const positions = compact ? [[8, 6], [7, 6]] : [[12, 8], [11, 8], [10, 7], [9, 7], [8, 6], [7, 6]];
    for (const [tw, th] of positions) {
      let best: Selection | undefined, rank = Infinity;
      for (let y = 1; y + th < h; y++) for (let x = 1; x + tw < w; x++) {
        const box = { x, y, w: tw, h: th };
        if (s.publicSpaces && intersects(box, plaza, compact ? 0 : .5)) continue;
        if (cells.slice(y, y + th).some((row) => row.slice(x, x + tw).some((c) => wet(c.terrain)))) continue;
        const doorX = x + Math.floor(tw * .31);
        if (wet(cells[y + th][doorX].terrain)) continue;
        const score = Math.hypot((x + tw / 2) - (centre.x - tw * .61), y + th + 1 - (s.publicSpaces ? py + 1 : centre.y)) + hash2(x, y, seed + 435) * 1.2;
        if (score < rank) { rank = score; best = box; }
      }
      if (best) return { ...best, style, kind: 'tavern', source: 'layout', roof: 5, shape: 'hip', facing: 0,
        door: { x: best.x + Math.floor(best.w * .31), y: best.y + best.h - 1 } };
    }
    const box = { x: 1, y: 1, w: 7, h: 6 };
    return { ...box, style, kind: 'tavern', source: 'layout', roof: 5, shape: 'hip', facing: 0, door: { x: 3, y: 6 } };
  }
  const tavern = tavernLot();
  const tavernExit = { x: tavern.door.x, y: tavern.door.y + 1 };

  function paint(x: number, y: number, surface: Terrain, cross: boolean) {
    if (!inside(x, y) || contains(tavern, x, y)) return;
    if (wet(cells[y][x].terrain)) {
      if (!cross) return;
      cells[y][x].terrain = 'bridge';
    } else cells[y][x].terrain = surface;
    streets[id(x, y)] = 1;
  }

  function lane(points: Point[], radius: number, surface: Terrain, cross = false) {
    for (let i = 1; i < points.length; i++) {
      const a = points[Math.max(0, i - 2)], b = points[i - 1], c = points[i], d = points[Math.min(points.length - 1, i + 1)];
      const samples = Math.max(4, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) * 3));
      const curve = (p: number, q: number, r: number, z: number, t: number) =>
        .5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - z) * t * t + (3 * q - p - 3 * r + z) * t * t * t);
      for (let j = 0; j <= samples; j++) {
        const t = j / samples, x = curve(a.x, b.x, c.x, d.x, t), y = curve(a.y, b.y, c.y, d.y, t);
        for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) {
          if (Math.hypot(x - xx, y - yy) <= radius) paint(xx, yy, surface, cross);
        }
      }
    }
  }

  const east = byRiver ? Math.floor(w * .77) : w - 1;
  const main = town ? 'plaza' : 'road';
  if (s.road) {
    const exitY = between(centre.y + Math.round((rng() - .5) * h * .27), 2, h - 3);
    lane([{ x: -1, y: Math.round(h * (town ? .67 : .58)) }, { x: w * .23, y: h * .56 }, centre, { x: w * .65, y: exitY }, { x: east, y: exitY }, { x: w + 1, y: exitY }], town && !compact ? .98 : .72, main, true);
    if (!compact || !town) lane([{ x: w * .31, y: -1 }, { x: w * .34, y: h * .24 }, centre, { x: w * .55, y: h * .71 }, { x: w * .57, y: h + 1 }], town ? .82 : .63, main);
    if (town && !compact) {
      const upper = Math.round(h * .25 + rng() * 2), lower = Math.round(h * .76 + rng() * 2);
      lane([{ x: -1, y: upper - 2 }, { x: w * .22, y: upper }, { x: w * .42, y: upper - 1.6 }, { x: east, y: upper + 1.8 }], .78, 'plaza');
      lane([{ x: -1, y: lower + 2 }, { x: w * .27, y: lower }, { x: w * .53, y: lower + 1 }, { x: east, y: lower - 2 }], .78, 'plaza');
      lane([{ x: east - 3, y: -1 }, { x: east - 3.5, y: upper }, { x: east - 5.5, y: centre.y }, { x: east - 4, y: lower }, { x: east - 2, y: h + 1 }], .7, 'plaza');
      if (w >= 38) lane([{ x: w * .17, y: upper }, { x: w * .20, y: centre.y }, { x: w * .15, y: lower + 1 }], .66, 'road');
      for (let y = upper - 12; y > 3; y -= 12) lane([{ x: 0, y: y + 1 }, { x: w * .33, y }, { x: east - 4, y: y + 2 }], .78, 'plaza');
      for (let y = lower + 11; y < h - 3; y += 11) lane([{ x: 0, y }, { x: w * .34, y: y + 2 }, { x: east - 4, y: y - 1 }], .78, 'plaza');
      for (let x = 11; x < east - 7; x += 12) if (Math.abs(x - centre.x) > 9 && w > 49) lane([{ x, y: h * .17 }, { x: x + 2, y: h * .52 }, { x: x - 1, y: h * .91 }], .74, 'road');
    } else if (!town && !compact) {
      lane([{ x: w * .17, y: h * .56 }, { x: w * .25, y: h * .72 }, { x: w * .37, y: h * .78 }, { x: w * .56, y: h * .76 }], .67, 'road');
      if (w >= 40) lane([{ x: w * .35, y: h * .21 }, { x: w * .51, y: h * .25 }, { x: east - 4, y: h * .31 }], .64, 'road');
    }
    // Кольцевая улица вокруг рыночной площади: к рынку подходят со всех сторон,
    // а дома не прижимаются к самой площади.
    if (s.publicSpaces && !compact) {
      lane([
        { x: px - 1, y: py - 1 }, { x: px + pw, y: py - 1 }, { x: px + pw, y: py + ph },
        { x: px - 1, y: py + ph }, { x: px - 1, y: py - 1 },
      ], .55, 'road');
    }
    lane([tavernExit, { x: tavernExit.x, y: Math.min(h - 1, tavernExit.y + 1) }, { x: centre.x, y: centre.y }], .69, main);
  }

  function add(kind: CivicKind, x: number, y: number, w1 = CIVIC_KIT[kind].w, h1 = CIVIC_KIT[kind].h, variant = 0) {
    const item: CivicObject = { x, y, w: w1, h: h1, kind, variant: variant % 2, rotation: 0, source: 'layout' };
    for (let yy = y; yy < y + h1; yy++) for (let xx = x; xx < x + w1; xx++) {
      if (!inside(xx, yy) || wet(cells[yy][xx].terrain)) return false;
    }
    if (intersects(tavern, item) || contains(item, tavernExit.x, tavernExit.y) && kind !== 'square'
      || civic.some((other) => other.kind !== 'square' && intersects(other, item))) return false;
    civic.push(item);
    for (let yy = y; yy < y + h1; yy++) for (let xx = x; xx < x + w1; xx++) {
      reserved[id(xx, yy)] = 1;
      if (kind === 'square') paint(xx, yy, 'plaza', false);
      else if (kind === 'garden' && !streets[id(xx, yy)]) cells[yy][xx].terrain = 'dirt';
    }
    return true;
  }

  if (s.publicSpaces) {
    add('square', px, py, pw, ph, town ? 0 : 1);
    const rich = between(s.marketRichness ?? .62, 0, 1);
    const requested = s.marketStyle ?? 'auto';
    const layout = requested === 'auto'
      ? (pw >= 10 && ph >= 8 && hash2(px, py, seed + 991) > .55 ? 'fair' : pw >= 8 && ph >= 6 ? 'ring' : 'rows')
      : requested;
    const cx = px + Math.floor(pw / 2), cy = py + Math.floor(ph / 2);
    const compactMarket = pw < 6 || ph < 5;
    const feature: CivicKind = 'marketWell';
    add(feature, cx - 1, cy - 1, 2, 2, 0);
    const blocksEntrance = (x: number, y: number, w: number, h: number) => {
      const mx = px + Math.floor(pw / 2), my = py + Math.floor(ph / 2);
      const zones = [
        { x: mx, y: py + 1, w: 1, h: 2 }, { x: mx, y: py + ph - 3, w: 1, h: 2 },
        { x: px + 1, y: my, w: 2, h: 1 }, { x: px + pw - 3, y: my, w: 2, h: 1 },
      ];
      return zones.some((zone) => x < zone.x + zone.w && x + w > zone.x && y < zone.y + zone.h && y + h > zone.y);
    };
    if (compactMarket) {
      add('market', px + 1, py + (ph > 4 ? 1 : 0), 2, 2, 0);
    } else {
      let count = 0;
      const limit = Math.max(2, Math.round(3 + rich * (layout === 'fair' ? 9 : 7)));
      const place = (kind: CivicKind, x: number, y: number, w = 2, h = 2) => {
        if (count >= limit || x < px + 1 || y < py + 1 || x + w > px + pw - 1 || y + h > py + ph - 1) return false;
        if (blocksEntrance(x, y, w, h)) return false;
        if (!add(kind, x, y, w, h, Math.floor(hash2(x, y, seed + count * 31) * 8))) return false;
        count++;
        return true;
      };
      if (layout === 'rows') {
        if (pw >= ph) {
          for (const y of [py + 1, py + ph - 3]) for (let x = px + 1; x + 1 < px + pw - 1; x += 3) {
            const set = y === py + 1 ? STALLS : TENTS;
            place(set[(x + y) % set.length], x, y);
          }
        } else {
          for (const x of [px + 1, px + pw - 3]) for (let y = py + 1; y + 1 < py + ph - 1; y += 3) {
            const set = x === px + 1 ? STALLS : TENTS;
            place(set[(x + y) % set.length], x, y);
          }
        }
      } else if (layout === 'ring') {
        const xs = [px + 1, px + Math.round(pw / 3), px + Math.round(pw * 2 / 3), px + pw - 3];
        const ys = [py + 1, py + Math.round(ph / 3), py + Math.round(ph * 2 / 3), py + ph - 3];
        xs.forEach((x, i) => {
          const top = hash2(x, py, seed + 5701 + i) > .5 ? TENTS : STALLS;
          const bottom = hash2(x, py + ph, seed + 5702 + i) > .5 ? STALLS : TENTS;
          place(top[(x + i) % top.length], x, py + 1);
          place(bottom[(x + i) % bottom.length], x, py + ph - 3);
        });
        ys.forEach((y, i) => {
          const left = hash2(px, y, seed + 5703 + i) > .5 ? TENTS : STALLS;
          const right = hash2(px + pw, y, seed + 5704 + i) > .5 ? STALLS : TENTS;
          place(left[(y + i) % left.length], px + 1, y);
          place(right[(y + i) % right.length], px + pw - 3, y);
        });
      } else {
        for (let y = py + 1; y + 1 < py + ph - 1; y += 2) for (let x = px + 1; x + 1 < px + pw - 1; x += 2) {
          if (hash2(x, y, seed + 5501) > .24 + rich * .56) continue;
          const pool = hash2(x, y, seed + 5502) > .52 ? TENTS : STALLS;
          place(pool[(x * 3 + y) % pool.length], x, y);
        }
      }
      // Телеги, товары и лавки по краям — не перекрывают центральные проходы.
      const goods = Math.round(rich * 6);
      for (let i = 0; i < goods; i++) {
        const x = px + 1 + Math.floor(hash2(i, 1, seed + 6101) * Math.max(1, pw - 3));
        const y = py + 1 + Math.floor(hash2(i, 2, seed + 6102) * Math.max(1, ph - 3));
        const w = 1 + (i % 2);
        if (blocksEntrance(x, y, w, 1)) continue;
        add(GOODS[(i + Math.floor(hash2(i, 3, seed + 6103) * GOODS.length)) % GOODS.length], x, y, w, 1, i);
      }
      if (rich > .35) {
        const seat = SEATS[Math.floor(hash2(px, py, seed + 6201) * SEATS.length)];
        const sx = px + 1, sy = Math.max(py + 2, cy - 1);
        if (!blocksEntrance(sx, sy, 2, 1)) add(seat, sx, sy, 2, 1, 0);
        if (pw >= 9 && !blocksEntrance(px + pw - 4, py + ph - 3, 3, 2)) add('marketWagon', px + pw - 4, py + ph - 3, 3, 2, 0);
      }
      // Мелкий товар раскладываем по свободным клеткам площади, чтобы рынок
      // не выглядел пустым при средней и высокой насыщенности.
      const small: CivicKind[] = ['marketRope', 'marketChest', 'marketChestOpen', 'marketBarrelLying'];
      let clutter = Math.round(rich * 5);
      for (let y = py + 1; y < py + ph - 1 && clutter > 0; y++) for (let x = px + 1; x < px + pw - 1 && clutter > 0; x++) {
        if (hash2(x, y, seed + 6301) > rich * .45) continue;
        if (blocksEntrance(x, y, 1, 1)) continue;
        const kind = small[(x * 7 + y * 3) % small.length];
        if (add(kind, x, y, 1, 1, x + y)) clutter--;
      }
    }
    if (!compact) for (const [x, y] of [[Math.round(w * .13), Math.round(h * .13)], [Math.round(w * .69), Math.round(h * .82)], [Math.round(w * .26), Math.round(h * .76)]]) {
      if (!streets[id(x, y)] && add('garden', x, y, 3, 2)) {
        if (!town && !streets[id(x, y + 3)]) add('garden', x, y + 3, 3, 2);
      }
    }
  }

  const road: Point[] = [], queue: number[] = [];
  const distance = new Uint16Array(w * h).fill(999);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (streets[id(x, y)]) {
    road.push({ x, y });
    distance[id(x, y)] = 0;
    queue.push(id(x, y));
  }
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i], x = at % w, y = Math.floor(at / w);
    for (const [dx, dy] of NEIGHBOURS) {
      const next = id(x + dx, y + dy);
      if (!inside(x + dx, y + dy) || distance[next] < 999 || wet(cells[y + dy][x + dx].terrain)) continue;
      distance[next] = distance[at] + 1;
      queue.push(next);
    }
  }

  const fits = (r: Selection) => {
    if (r.x + r.w > w - 1 || r.y + r.h > h - 1 || intersects(tavern, r, 1) || contains(r, tavernExit.x, tavernExit.y)) return false;
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
      if (streets[id(xx, yy)] || reserved[id(xx, yy)] || wet(cells[yy][xx].terrain)) return false;
    }
    return true;
  };
  const candidates: { lot: Building; out: Point; score: number; district: number }[] = [];
  const roofs: RoofMaterial[] = town ? [2, 3, 2, 3, 4, 5, 2, 6, 1] : [0, 1, 7, 0, 1, 1, 0];
  for (let y = 1; y < h - 2; y++) for (let x = 1; x < w - 2; x++) {
    for (let option = 0; option < 3; option++) {
      const taste = hash2(x, y, seed + 7191 + option * 71);
      const reach = hash2(x, y, seed + 3421 + option * 74);
      const length = 5 + (compact ? 0 : Math.floor(taste * (town ? 5 : 4)));
      const depth = 4 + (compact ? 0 : Math.floor(reach * 3));
      const plan = { x, y, w: reach > .59 ? depth : length, h: reach > .59 ? length : depth };
      if (!fits(plan)) continue;
      const hx = x + Math.floor(plan.w / 2), hy = y + Math.floor(plan.h / 2);
      const edges = [
        { door: { x: hx, y }, out: { x: hx, y: y - 1 }, facing: 180 },
        { door: { x: hx, y: y + plan.h - 1 }, out: { x: hx, y: y + plan.h }, facing: 0 },
        { door: { x, y: hy }, out: { x: x - 1, y: hy }, facing: 90 },
        { door: { x: x + plan.w - 1, y: hy }, out: { x: x + plan.w, y: hy }, facing: 270 },
      ].filter(({ out }) => inside(out.x, out.y) && !wet(cells[out.y][out.x].terrain) && !contains(tavern, out.x, out.y)
        && !civic.some((item) => item.kind !== 'square' && contains(item, out.x, out.y)));
      const entry = edges.sort((a, b) => distance[id(a.out.x, a.out.y)] - distance[id(b.out.x, b.out.y)])[0];
      if (!entry) continue;
      const dist = distance[id(entry.out.x, entry.out.y)];
      if (road.length && dist > (compact ? 5 : town ? 7 : 8)) continue;
      const roof = roofs[Math.floor(hash2(x, y, seed + 2428) * roofs.length)];
      const landmark = town && plan.w >= 7 && plan.h >= 5 && taste > .72 && reach < .69;
      const lot: Building = { ...plan, style, kind: landmark ? 'hall' : reach > .83 && town ? 'shop' : 'house', roof,
        shape: landmark || reach > .79 ? 'cross' : reach > .49 ? 'hip' : 'gable', source: 'layout', door: entry.door, facing: entry.facing as ChestRotation };
      const offset = Math.hypot((hx - centre.x) / w, (hy - centre.y) / h);
      const score = hash2(x, y, seed + option * 577 + 6501) * 3.3 - offset * (town ? 1.55 : 3.7) - (road.length ? dist * .49 : 0) + (landmark ? .45 : 0);
      const district = (x >= w * .45 ? 1 : 0) + (y >= h * .52 ? 2 : 0);
      candidates.push({ lot, out: entry.out, score, district });
    }
  }

  // The streets and the ranked parcels never depend on density. A larger value only takes a longer prefix.
  candidates.sort((a, b) => b.score - a.score);
  const plots: Building[] = [tavern], exits: Point[] = [tavernExit];
  const budgets = [0, 0, 0, 0], cap = Math.max(4, Math.floor(w * h * (town ? .39 : .23)));
  let used = tavern.w * tavern.h;
  for (let round = 0; round < 2; round++) {
    for (const { lot, out, district } of candidates) {
      if (used + lot.w * lot.h > cap || round === 0 && budgets[district] > cap * .24) continue;
      if (plots.some((other) => intersects(lot, other, 1) || contains(other, out.x, out.y)) || exits.some((p) => contains(lot, p.x, p.y))) continue;
      plots.push(lot);
      exits.push(out);
      const size = lot.w * lot.h;
      used += size; budgets[district] += size;
    }
  }

  const result = { cells, plots, civic, road, river };
  cached = { key, value: result };
  return result;
}

export function generateSettlement(s: GenSettings): MapData {
  const style = s.biome === 'town' ? 'town' : 'village';
  const plan = buildPlan(s, style);
  const density = between(s.density ?? .42, 0, 1);
  const count = density === 0 ? 0 : Math.min(plan.plots.length, Math.max(1, Math.round(plan.plots.length * density ** 1.18)));
  const buildings = plan.plots.slice(0, count);
  const { width, height, seed } = s;
  const trees: Tree[] = [], rocks: MapData['rocks'] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const terrain = plan.cells[y][x].terrain;
    if (terrain !== 'grass' && terrain !== 'darkGrass' && terrain !== 'dirt') continue;
    if (plan.civic.some((p) => contains(p, x, y)) || buildings.some((b) => contains({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, x, y))) continue;
    const v = hash2(x, y, seed + 71032), green = hash2(x, y, seed + 7345), edge = Math.min(y, x, width - x - 1, height - y - 1);
    const chance = s.vegetation * (edge <= 3 ? .24 : style === 'village' ? .10 : .071);
    if (v < chance) {
      trees.push({ x: x + .32 + green * .37, y: y + .35 + v * 1.3, v: green, r: green < .25 ? .31 : .38 + green * .19, kind: green < .25 ? 'bush' : green > .85 ? 'pine' : 'oak' });
    } else if (green < s.rocks * .031) {
      const r = .18 + .21 * v;
      rocks.push({ x: x + .5, y: y + .5, r, v, pts: [[-r, 0], [-r * .2, -r], [r, -r * .4], [r * .6, r * .7], [-r * .5, r]] });
    }
  }

  return { width, height, biome: style, cells: plan.cells, road: plan.road, river: plan.river, trees, rocks, structures: [], buildings, civic: plan.civic, chests: [] };
}