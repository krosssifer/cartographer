import { Perlin } from './noise';
import { hash2, mulberry32 } from './random';
import { SeededRandom } from './gen/random';
import type { GenerationPlan, GroupType, ObjectGroup, Poi, Zone, ZoneType } from './gen/plan';
import {
  buildSettlementComposition,
  insideOpenSpace,
  type SettlementCompositionInput,
} from './gen/composition';
import { CIVIC_KIT, contains, intersects } from './settlementKit';
import { buildTypedPlan, type SettlementReport } from './gen/settlementPlanner';
import { isSettlementType } from './gen/settlementTypes';
import { modernMarket } from './gen/marketArchetypes';
import { facesMarket, applyMarketGround, finishMarket, marketWaterfront, planMarket, resolveMarketSite, type MarketOutcome } from './gen/marketLayout';
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
  /** Осевые линии улиц: по ним рендер рисует гладкие ленты. */
  lanes: { points: Point[]; width: number; surface: 'road' | 'plaza'; hierarchy?: 1 | 2 | 3 | 4 | 5 }[];
  /** Новый рынок (marketArchetype ≠ 'classic'): план, проверка, отчёт. */
  market?: MarketOutcome;
  /** Деревья, которые ставит рынок (дерево в центре деревенской площади). */
  marketTrees?: Tree[];
}

let cached: { key: string; value: Plan } | undefined;

/** Вид дома на фасаде рынка — по весам архетипа. */
function pickFrontage(options: readonly (readonly [Building['kind'], number])[], roll: number): Building['kind'] {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let value = roll * total;
  for (const [kind, weight] of options) { value -= weight; if (value < 0) return kind; }
  return options[options.length - 1][0];
}

function buildPlan(s: GenSettings, style: SettlementStyle): Plan {
  const lanes: Plan['lanes'] = [];
  const { width: w, height: h, seed } = s;
  const key = `${style}:${seed}:${w}:${h}:${s.road}:${s.river}:${s.publicSpaces}:${s.marketStyle}:${s.marketRichness}:${s.marketArchetype}`;
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

  const hub = { x: Math.round(w * (byRiver ? .46 : .5) + (rng() - .5) * (compact ? 0 : 3)), y: Math.round(h * .51 + (rng() - .5) * 2) };
  // Новый рынок: архетип и место выбираются до улиц — улицы сходятся к рынку.
  const placedMarket = s.publicSpaces && !compact && modernMarket(s.marketArchetype)
    ? resolveMarketSite(s.marketArchetype, { style, water: byRiver ? 'river' : 'none', width: w, height: h, seed }, { width: w, height: h, cells, blocked: () => false, anchor: hub })
    : undefined;
  const marketResolution = placedMarket?.resolution, marketSite = placedMarket?.site;
  const centre = marketSite ? { x: marketSite.bounds.x + Math.floor(marketSite.bounds.w / 2), y: marketSite.bounds.y + Math.floor(marketSite.bounds.h / 2) } : hub;
  const pw = marketSite ? marketSite.bounds.w : compact ? Math.min(5, w - 2) : town ? between(Math.floor(w * .25), 9, 14) : between(Math.floor(w * .18), 6, 9);
  const ph = marketSite ? marketSite.bounds.h : compact ? Math.min(4, h - 8) : town ? between(Math.floor(h * .27), 7, 11) : between(Math.floor(h * .21), 5, 8);
  if (compact && h < 15) centre.y = h - Math.ceil(ph / 2);
  const px = marketSite ? marketSite.bounds.x : between(centre.x - Math.floor(pw / 2), 1, w - pw - 1);
  const py = marketSite ? marketSite.bounds.y : between(centre.y - Math.floor(ph / 2), compact ? 7 : 1, h - ph - 1);
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
    // Запоминаем осевую линию улицы (для гладкого рендера), сама покраска — ниже.
    const centreline: Point[] = [];
    const record = (x: number, y: number) => {
      const cellX = Math.round(x), cellY = Math.round(y);
      const last = centreline[centreline.length - 1];
      if (last && last.x === cellX && last.y === cellY) return;
      centreline.push({ x: cellX, y: cellY });
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[Math.max(0, i - 2)], b = points[i - 1], c = points[i], d = points[Math.min(points.length - 1, i + 1)];
      const samples = Math.max(4, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) * 3));
      const curve = (p: number, q: number, r: number, z: number, t: number) =>
        .5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - z) * t * t + (3 * q - p - 3 * r + z) * t * t * t);
      for (let j = 0; j <= samples; j++) {
        const t = j / samples, x = curve(a.x, b.x, c.x, d.x, t), y = curve(a.y, b.y, c.y, d.y, t);
        record(x, y);
        for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) {
          if (Math.hypot(x - xx, y - yy) <= radius) paint(xx, yy, surface, cross);
        }
      }
    }
    if (centreline.length >= 2) {
      lanes.push({ points: centreline, width: Math.max(1, Math.round(radius * 2)), surface: surface === 'plaza' ? 'plaza' : 'road' });
    }
  }

  const east = byRiver ? Math.floor(w * .77) : w - 1;
  /** Индекс кольцевой улицы вокруг площади в lanes (−1 — её нет). */
  let ringLane = -1;
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
    if (s.publicSpaces && !compact && (!marketResolution || marketResolution.archetype.ringRoad)) {
      ringLane = lanes.length;
      lane([
        { x: px - 1, y: py - 1 }, { x: px + pw, y: py - 1 }, { x: px + pw, y: py + ph },
        { x: px - 1, y: py + ph }, { x: px - 1, y: py - 1 },
      ], .55, 'road');
    }
    lane([tavernExit, { x: tavernExit.x, y: Math.min(h - 1, tavernExit.y + 1) }, { x: centre.x, y: centre.y }], .69, main);
  }

  function add(kind: CivicKind, x: number, y: number, w1 = CIVIC_KIT[kind].w, h1 = CIVIC_KIT[kind].h, variant = 0, rotation: ChestRotation = 0) {
    const item: CivicObject = { x, y, w: w1, h: h1, kind, variant: variant % 2, rotation, source: 'layout' };
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

  let market: MarketOutcome | undefined;
  const marketTrees: Tree[] = [];
  if (s.publicSpaces && marketResolution && marketSite) {
    const plan = planMarket({
      width: w, height: h, cells, seed, resolution: marketResolution, style: s.marketStyle ?? 'auto', richness: between(s.marketRichness ?? .62, 0, 1),
      town, bounds: marketSite.bounds, shore: marketSite.shore, streets, ring: ringLane >= 0,
      lanes: lanes.filter((_, index) => index !== ringLane),
      blocked: (x, y) => contains(tavern, x, y) || x === tavernExit.x && y === tavernExit.y,
    });
    market = finishMarket(plan, marketResolution.archetype, streets);
    market.report.notes.unshift(...marketSite.notes);
    if (plan.surface === 'square') add('square', px, py, pw, ph, town ? 0 : 1);
    applyMarketGround(plan, cells);
    // Вся площадь — общественное место: дома к ней выходят, но не строятся на ней.
    for (let i = 0; i < w * h; i++) if (plan.area[i]) { reserved[i] = 1; streets[i] = 1; }
    for (const path of plan.paths) if (plan.surface !== 'square') lanes.push({ points: path.points, width: path.width, surface: 'road' });
    const waterfront = marketWaterfront(plan, { width: w, height: h, cells, blocked: (x, y) => reserved[id(x, y)] === 1 || contains(tavern, x, y) }, seed);
    for (const p of waterfront.quay) paint(p.x, p.y, 'road', false);
    for (const p of waterfront.pier) { cells[p.y][p.x].terrain = 'bridge'; streets[id(p.x, p.y)] = 1; }
    if (waterfront.pier.length) lanes.push({ points: [...waterfront.quay.slice(-1), ...waterfront.pier], width: 1, surface: 'road' });
    for (const it of waterfront.cargo) if (it.threshold <= plan.richness + 1e-9) add(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation);
    for (const it of plan.items) if (!add(it.kind, it.x, it.y, it.w, it.h, it.variant, it.rotation)) market.report.notes.push(`не поставлен ${it.kind} (${it.x},${it.y})`);
    marketTrees.push(...plan.trees);
    if (!compact) for (const [x, y] of [[Math.round(w * .13), Math.round(h * .13)], [Math.round(w * .69), Math.round(h * .82)], [Math.round(w * .26), Math.round(h * .76)]]) {
      if (!streets[id(x, y)] && add('garden', x, y, 3, 2)) {
        if (!town && !streets[id(x, y + 3)]) add('garden', x, y + 3, 3, 2);
      }
    }
  } else if (s.publicSpaces) {
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
        && !civic.some((item) => item.kind !== 'square' && contains(item, out.x, out.y)) && !(market && market.occupied[id(out.x, out.y)]));
      // Дом у рынка смотрит дверью на площадь (лавка, мастерская, склад).
      const onMarket = (p: Point) => market !== undefined && facesMarket(market.plan, p.x, p.y, streets);
      const entry = edges.sort((a, b) => (Number(onMarket(b.out)) - Number(onMarket(a.out))) * 100 + distance[id(a.out.x, a.out.y)] - distance[id(b.out.x, b.out.y)])[0];
      if (!entry) continue;
      const dist = distance[id(entry.out.x, entry.out.y)];
      if (road.length && dist > (compact ? 5 : town ? 7 : 8)) continue;
      const roof = roofs[Math.floor(hash2(x, y, seed + 2428) * roofs.length)];
      const landmark = town && plan.w >= 7 && plan.h >= 5 && taste > .72 && reach < .69;
      const frontage = market && marketResolution && onMarket(entry.out) ? marketResolution.archetype.frontage : undefined;
      const frontKind = frontage ? pickFrontage(frontage, hash2(x, y, seed + 0x6f17 + option)) : undefined;
      const lot: Building = { ...plan, style, kind: frontKind ?? (landmark ? 'hall' : reach > .83 && town ? 'shop' : 'house'), roof,
        shape: landmark || reach > .79 ? 'cross' : reach > .49 ? 'hip' : 'gable', source: 'layout', door: entry.door, facing: entry.facing as ChestRotation };
      const offset = Math.hypot((hx - centre.x) / w, (hy - centre.y) / h);
      const score = hash2(x, y, seed + option * 577 + 6501) * 3.3 - offset * (town ? 1.55 : 3.7) - (road.length ? dist * .49 : 0) + (landmark ? .45 : 0) + (frontage ? .6 : 0);
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

  const result: Plan = { cells, plots, civic, road, river, lanes, market, marketTrees };
  cached = { key, value: result };
  return result;
}

/**
 * Композиция зелени для поселения: зоны вместо поклеточного шума.
 *
 * Деревья живут не «где повезёт», а по зонам: опушки по краям карты (рощи),
 * кусты вдоль улиц, редкая трава во дворах. Всё, что занято домами,
 * площадью и улицами, исключено из размещения.
 */
function settlementComposition(
  s: GenSettings,
  layout: Plan,
  buildings: Building[],
  urbanZoneAt?: Uint8Array,
): { trees: Tree[]; rocks: MapData['rocks']; plan: GenerationPlan } {
  const { width: w, height: h } = s;
  const rng = new SeededRandom(s.seed, 3301);
  const cells = layout.cells;
  const green = (terrain: Terrain): boolean => terrain === 'grass' || terrain === 'darkGrass' || terrain === 'dirt';
  const occupied = (x: number, y: number): boolean =>
    !green(cells[y][x].terrain) ||
    buildings.some((b) => contains({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, x, y)) ||
    layout.civic.some((c) => contains({ x: c.x - 1, y: c.y - 1, w: c.w + 2, h: c.h + 2 }, x, y)) ||
    (layout.market?.plan.area[y * w + x] ?? 0) === 1;

  // Расстояние до мостовой/площади — из него получаются придорожные зоны.
  const streetDist = new Int16Array(w * h).fill(99);
  const queue: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!green(cells[y][x].terrain)) {
        streetDist[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    const level = streetDist[at];
    if (level >= 4) continue;
    const x = at % w;
    const y = Math.floor(at / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const next = ny * w + nx;
      if (streetDist[next] <= level + 1) continue;
      streetDist[next] = level + 1;
      queue.push(next);
    }
  }

  const zoneOf = (x: number, y: number): ZoneType => {
    if (urbanZoneAt) {
      const uZone = urbanZoneAt[y * w + x] ?? 5;
      if (uZone >= 5) return streetDist[y * w + x] <= 1 ? 'roadside' : 'sparse_forest';
      if (streetDist[y * w + x] <= 2 && uZone >= 2) return 'roadside';
      return 'meadow';
    }
    const edge = Math.min(y, x, w - x - 1, h - y - 1);
    if (streetDist[y * w + x] <= 2) return 'roadside';
    if (edge <= 3) return 'sparse_forest';
    return 'meadow';
  };
  const DENSITY: Partial<Record<ZoneType, number>> = { roadside: 0.16, sparse_forest: 0.62, meadow: 0.1 };
  const zoneIndex = new Map<ZoneType, number>();
  const zoneList: ZoneType[] = ['roadside', 'sparse_forest', 'meadow'];
  zoneList.forEach((type, index) => zoneIndex.set(type, index));
  const zoneAt = new Uint8Array(w * h);
  const counts = new Map<ZoneType, number>();
  const bounds = new Map<ZoneType, { x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const type = zoneOf(x, y);
      zoneAt[y * w + x] = zoneIndex.get(type)!;
      counts.set(type, (counts.get(type) ?? 0) + 1);
      const box = bounds.get(type) ?? { x0: x, y0: y, x1: x, y1: y };
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      bounds.set(type, box);
    }
  }
  const zones: Zone[] = [];
  counts.forEach((area, type) => {
    const box = bounds.get(type)!;
    zones.push({ id: `${type}_0`, type, density: DENSITY[type] ?? 0, bounds: { x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 }, area });
  });

  const trees: Tree[] = [];
  const rocks: MapData['rocks'] = [];
  const groups: ObjectGroup[] = [];
  const plan: GenerationPlan = { version: 1, engine: 'structured', zones, poi: [], groups };

  // ---- Композиция поселения ----------------------------------------------
  // Площадь — арена боя, дворы вокруг домов — открытые пятна, улицы их
  // связывают. Композиция строится до растительности: внутри открытых
  // пространств деревьев не будет.
  const plazaArea = (() => {
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (cells[y][x].terrain !== 'plaza') continue;
        count += 1;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    }
    if (count < 6) return undefined;
    return { x: sx / count, y: sy / count, radius: Math.max(2.6, Math.sqrt(count / Math.PI)) };
  })();
  const compositionInput: SettlementCompositionInput = {
    width: w,
    height: h,
    cells,
    plaza: plazaArea,
    buildings: buildings.map((building) => ({ x: building.x, y: building.y, w: building.w, h: building.h })),
  };
  const composition = buildSettlementComposition(compositionInput);
  plan.composition = composition;

  const tooClose = (x: number, y: number, min: number): boolean =>
    trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < min);

  const plant = (kind: Tree['kind'], cx: number, cy: number, tight: boolean): Tree | null => {
    const x = Math.round(cx);
    const y = Math.round(cy);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return null;
    if (occupied(x, y)) return null;
    if (insideOpenSpace(composition, cx, cy, 0.2)) return null;
    if (tooClose(cx, cy, tight ? 0.75 : 1.1)) return null;
    const tree: Tree = { x: cx, y: cy, r: kind === 'bush' ? rng.range(0.26, 0.38) : rng.range(0.34, 0.52), kind, v: rng.next() };
    trees.push(tree);
    return tree;
  };

  const dropRock = (cx: number, cy: number): void => {
    const x = Math.round(cx);
    const y = Math.round(cy);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return;
    if (occupied(x, y)) return;
    if (insideOpenSpace(composition, cx, cy, 0.2)) return;
    if (rocks.some((rock) => Math.hypot(rock.x - cx, rock.y - cy) < 0.8)) return;
    const r = rng.range(0.16, 0.26);
    rocks.push({ x: cx, y: cy, r, v: rng.next(), pts: [[-r, 0], [-r * 0.2, -r], [r, -r * 0.4], [r * 0.6, r * 0.7], [-r * 0.5, r]] });
  };

  // ---- Композиционные центры: рощи на опушке и зелёная площадь ----
  const pois: Poi[] = [];
  const groveSpots: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 90 && groveSpots.length < 3; attempt += 1) {
    const x = 2 + Math.floor(rng.next() * (w - 4));
    const y = 2 + Math.floor(rng.next() * (h - 4));
    if (zoneOf(x, y) !== 'sparse_forest' || occupied(x, y)) continue;
    if (groveSpots.some((spot) => Math.hypot(spot.x - x, spot.y - y) < 8)) continue;
    groveSpots.push({ x, y });
  }
  for (const spot of groveSpots) {
    pois.push({ id: `grove_${pois.length}`, type: 'grove', x: spot.x, y: spot.y, radius: 2.4 });
  }

  const groupPlan = (type: GroupType, x: number, y: number, placed: number): void => {
    groups.push({ id: `${type}_${groups.length}`, type, x, y, placed });
  };

  for (const poi of pois) {
    let placed = 0;
    const count = 3 + Math.floor(rng.next() * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = rng.range(0.4, poi.radius);
      const kind: Tree['kind'] = rng.chance(0.15) ? 'bush' : rng.chance(0.75) ? 'oak' : 'pine';
      if (plant(kind, poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, true)) placed += 1;
    }
    groupPlan('forest_cluster', poi.x, poi.y, placed);
  }

  // ---- Кусты вдоль улиц (в старом каменном ядре дикие кусты не растут!) ----
  const streetCells: number[] = [];
  for (let at = 0; at < w * h; at += 1) {
    if (streetDist[at] === 1 && (!urbanZoneAt || urbanZoneAt[at] >= 2)) streetCells.push(at);
  }
  for (let i = 0; i < 4 && streetCells.length; i += 1) {
    const at = streetCells[Math.floor(rng.next() * streetCells.length)];
    const x = at % w;
    const y = Math.floor(at / w);
    let placed = 0;
    for (let j = 0; j < 2; j += 1) {
      if (plant('bush', x + rng.range(-1.4, 1.4), y + rng.range(-1.4, 1.4), true)) placed += 1;
    }
    if (placed > 0) groupPlan('roadside_line', x, y, placed);
  }

  // ---- Одиночные деревья по плотности зон ----
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (occupied(x, y)) continue;
      if (urbanZoneAt && urbanZoneAt[y * w + x] <= 1) continue;
      const type = zoneList[zoneAt[y * w + x]];
      const base = DENSITY[type] ?? 0;
      const zoneScale = urbanZoneAt && urbanZoneAt[y * w + x] === 2 ? 0.45 : 1;
      const chance = base * zoneScale * (0.35 + s.vegetation * 0.9);
      if (!rng.chance(chance * 0.55)) continue;
      const kind: Tree['kind'] = rng.chance(0.55) ? 'bush' : rng.chance(0.7) ? 'oak' : 'pine';
      plant(kind, x + 0.5 + rng.range(-0.35, 0.35), y + 0.5 + rng.range(-0.35, 0.35), false);
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const x = 2 + Math.floor(rng.next() * (w - 4));
    const y = 2 + Math.floor(rng.next() * (h - 4));
    if (zoneOf(x, y) === 'sparse_forest' && rng.chance(s.rocks * 0.4)) dropRock(x + rng.range(-0.3, 0.3), y + rng.range(-0.3, 0.3));
  }

  // Старт партии — на площади, если она есть, иначе в центре карты.
  let spawn: { x: number; y: number } | undefined;
  for (let y = 0; y < s.height && !spawn; y += 1) {
    for (let x = 0; x < s.width && !spawn; x += 1) {
      if (cells[y][x].terrain === 'plaza') spawn = { x, y };
    }
  }
  plan.spawn = spawn ?? { x: Math.floor(s.width / 2), y: Math.floor(s.height / 2) };
  // Улицы — такие же ленты, как тракты в дикой природе: рендер рисует их гладко.
  const streetPaths = layout.lanes.map((lane, index) => ({
    id: `street_${index}`,
    type: lane.hierarchy && lane.hierarchy >= 4 ? ('trail' as const) : ('main' as const),
    width: lane.width,
    points: lane.points,
    bridges: 0,
    surface: lane.surface,
    ...(lane.hierarchy ? { hierarchy: lane.hierarchy } : {}),
  }));
  plan.roads = [...(plan.roads ?? []), ...streetPaths];
  return { trees, rocks, plan };
}

/**
 * Полный итог планировщика рынка (план с масками, проверка, отчёт) для тех же
 * настроек, что и generateSettlement; undefined — рынок прежний или не поместился.
 */
export function settlementMarket(s: GenSettings): MarketOutcome | undefined {
  const style = s.biome === 'town' ? 'town' : 'village';
  const plan = typedSettlement(s) ? buildTypedPlan(s, style) : buildPlan(s, style);
  return plan.market;
}

/** Поселение по типу: GenSettings.settlementType задан и это не 'classic'. */
export const typedSettlement = (s: Pick<GenSettings, 'settlementType'>): boolean => isSettlementType(s.settlementType);

export function generateSettlement(s: GenSettings): MapData {
  const style = s.biome === 'town' ? 'town' : 'village';
  const typed = typedSettlement(s) ? buildTypedPlan(s, style) : undefined;
  const rawPlan: Plan = typed ?? buildPlan(s, style);
  const density = between(s.density ?? .42, 0, 1);
  const count = density === 0 ? 0 : Math.min(rawPlan.plots.length, Math.max(1, Math.round(rawPlan.plots.length * density ** 1.18)));
  const activeCivic = typed ? typed.rankedCivic.filter((rc) => rc.plotRank < count).map((rc) => rc.item) : rawPlan.civic;
  // Состояние города: изношенные дома получают дешёвую или мшистую крышу и метку износа.
  // Клонируем объекты — массив приходит из кэша buildTypedPlan и общий для всех генераций.
  const cityCondition = s.cityCondition ?? 'lived_in';
  let buildings = rawPlan.plots.slice(0, count);
  if (cityCondition === 'worn') {
    buildings = buildings.map((building) => {
      if (hash2(building.x, building.y, s.seed + 0x2101) < 0.55) return building;
      const cheap: RoofMaterial = hash2(building.x, building.y, s.seed + 0x2102) > 0.7 ? 7 : 0;
      return { ...building, roof: building.roof > 1 ? cheap : building.roof, cityCondition: 'worn' as const };
    });
  } else if (cityCondition === 'pristine') {
    buildings = buildings.map((building) => ({ ...building, cityCondition: 'pristine' as const }));
  }
  const plan: Plan = typed
    ? { ...typed, cells: typed.cells.map((row) => row.map((c) => ({ ...c }))), civic: activeCivic }
    : rawPlan;
  const { width, height, seed } = s;

  // Оформление мощения и утоптанного грунта активных городских дворов (Section 4 & 8):
  // В плотном центре и рабочих/постоялых дворах не должно быть «дикого газона»!
  if (typed && count > 0) {
    const builtMask = new Uint8Array(width * height);
    for (const b of buildings) {
      for (let yy = b.y; yy < b.y + b.h; yy++) {
        for (let xx = b.x; xx < b.x + b.w; xx++) builtMask[yy * width + xx] = 1;
      }
    }
    for (let i = 0; i < count; i++) {
      const plot = typed.placedPlots[i];
      if (!plot) continue;
      const ck = plot.courtyardKind;
      const box = plot.bounds;
      const isTrodden = plot.zone === 'old_core'
        || plot.zone === 'inner_city'
        || ck === 'temple_courtyard'
        || ck === 'enclosed_courtyard'
        || ck === 'workshop_yard'
        || ck === 'trade_courtyard'
        || ck === 'inn_yard';
      if (!isTrodden) continue;

      for (let yy = box.y; yy < box.y + box.h; yy++) {
        for (let xx = box.x; xx < box.x + box.w; xx++) {
          const idx = yy * width + xx;
          if (builtMask[idx] || typed.waterDist[idx] < 2) continue;
          const tr = plan.cells[yy][xx].terrain;
          if (tr === 'grass' || tr === 'darkGrass') {
            plan.cells[yy][xx].terrain = 'dirt';
          }
        }
      }
    }
  }

  let trees: Tree[] = [];
  let rocks: MapData['rocks'] = [];
  let generationPlan: GenerationPlan | undefined;
  if ((s.generationEngine ?? 'structured') === 'structured') {
    const composition = settlementComposition(s, plan, buildings, typed?.urbanZoneAt);
    trees = composition.trees;
    rocks = composition.rocks;
    generationPlan = composition.plan;
  } else {
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
  }

  if (typed) {
    // Добавляем тематические деревья/надгробия (например, на кладбище), избегая крыш.
    for (const ut of typed.urbanTrees) {
      if (!buildings.some((b) => contains({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, Math.floor(ut.x), Math.floor(ut.y)))) {
        trees.push(ut);
      }
    }
    for (const ur of typed.urbanRocks) {
      if (!buildings.some((b) => contains(b, Math.floor(ur.x), Math.floor(ur.y)))) {
        rocks.push(ur);
      }
    }
    // Отчёт считает только поставленные плотностью постройки.
    const placed = typed.plotDistrict.slice(0, count);
    const settlement: SettlementReport = {
      ...typed.report,
      districts: typed.report.districts.map((district, index) => ({ ...district, buildings: placed.filter((d) => d === index).length })),
      buildings: buildings.reduce<SettlementReport['buildings']>((acc, b) => ({ ...acc, [b.kind]: (acc[b.kind] ?? 0) + 1 }), {}),
      ...(typed.report.plots ? { plots: { ...typed.report.plots, built: buildings.length } } : {}),
    };
    generationPlan = { ...(generationPlan ?? { version: 1, engine: 'structured', zones: [], poi: [], groups: [] }), settlement };
  }
  if (plan.market) {
    generationPlan = { ...(generationPlan ?? { version: 1, engine: 'structured', zones: [], poi: [], groups: [] }), market: plan.market.report };
    // Дерево в центре деревенской площади — обычное дерево слоя деревьев (его можно двигать и удалять).
    trees = [...trees, ...(plan.marketTrees ?? [])];
  }
  return { width, height, biome: style, cells: plan.cells, road: plan.road, river: plan.river, trees, rocks, structures: [], buildings, civic: plan.civic, chests: [], plan: generationPlan };
}