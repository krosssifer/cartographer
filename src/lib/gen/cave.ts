/**
 * Структурная генерация пещер.
 *
 * Террейн пещеры по-прежнему делает клеточный автомат (`generator.ts`), но
 * расстановку объектов берёт на себя этот модуль: сначала поле зон
 * (залы / коридоры / берег / осыпь), затем композиционные центры (залы и
 * водоёмы), затем группы (кольца грибов, сталагмиты, осыпи) и одиночные
 * объекты строго по плотности зоны. Проверяет результат валидатор.
 */

import type { Cell, GenSettings, Point, Rock, Terrain, Tree } from '../types';
import { catalogEntry, OccupancyGrid, SpatialHash } from './occupancy';
import { buildCaveComposition, insideOpenSpace, type CaveChamberInput } from './composition';
import type { GenerationPlan, GroupType, ObjectGroup, Poi, Zone, ZoneType } from './plan';
import { emptyPlan } from './plan';
import { SeededRandom } from './random';

const FLOOR: Terrain = 'caveFloor';
const WATER: Terrain[] = ['water', 'deepWater'];

const CAVE_ZONES: ZoneType[] = ['chamber', 'tunnel', 'shore', 'rubble'];
const CAVE_BASE_DENSITY: Partial<Record<ZoneType, number>> = {
  chamber: 0.26,
  tunnel: 0.1,
  shore: 0.5,
  rubble: 0.62,
};

/**
 * Ширина входа в пещеру соразмерно карте: на маленькой карте 2 клетки,
 * на большой — до 8. Проём всегда шире коридора, чтобы читался как «пасть».
 */
export const caveEntranceWidth = (width: number, height: number): number =>
  Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.12)));

export interface CaveField {
  width: number;
  height: number;
  zone: Uint8Array;
  density: Float32Array;
  zones: Zone[];
  typeAt(x: number, y: number): ZoneType;
  densityAt(x: number, y: number): number;
  has(x: number, y: number): boolean;
}

const idx = (x: number, y: number, width: number) => y * width + x;

export function buildCaveField(cells: Cell[][], width: number, height: number): CaveField {
  const zone = new Uint8Array(width * height);
  const density = new Float32Array(width * height);
  const counts = new Map<ZoneType, number>();
  const bounds = new Map<ZoneType, { x0: number; y0: number; x1: number; y1: number }>();

  const floorAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && cells[y][x].terrain === FLOOR;
  const waterAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && WATER.includes(cells[y][x].terrain);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = idx(x, y, width);
      if (cells[y][x].terrain !== FLOOR) {
        zone[at] = CAVE_ZONES.length; // «не зона»
        continue;
      }
      let open = 0;
      let wall = 0;
      let water = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (waterAt(nx, ny)) water += 1;
          else if (floorAt(nx, ny)) open += 1;
          else wall += 1;
        }
      }
      let type: ZoneType;
      if (water > 0) type = 'shore';
      else if (wall > 0) type = 'rubble';
      else if (open >= 7) type = 'chamber';
      else type = 'tunnel';
      zone[at] = CAVE_ZONES.indexOf(type);
      // Влажность — единственный «шумовой» вход: у воды грибов больше.
      const base = CAVE_BASE_DENSITY[type] ?? 0;
      density[at] = base * (0.7 + 0.6 * cells[y][x].moisture);
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
    zones.push({
      id: `${type}_0`,
      type,
      density: CAVE_BASE_DENSITY[type] ?? 0,
      bounds: { x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 },
      area,
    });
  });

  return {
    width,
    height,
    zone,
    density,
    zones,
    typeAt: (x, y) =>
      x >= 0 && y >= 0 && x < width && y < height && zone[idx(x, y, width)] < CAVE_ZONES.length
        ? CAVE_ZONES[zone[idx(x, y, width)]]
        : 'tunnel',
    densityAt: (x, y) => density[idx(x, y, width)] ?? 0,
    has: (x, y) => x >= 0 && y >= 0 && x < width && y < height && zone[idx(x, y, width)] < CAVE_ZONES.length,
  };
}

export interface CaveReport {
  connectivity: number;
  overlap: number;
  density: number;
  composition: boolean;
  diversity: number;
  problems: string[];
}

export interface StructuredCave {
  trees: Tree[];
  rocks: Rock[];
  plan: GenerationPlan;
  report: CaveReport;
}

const rockPolygon = (rng: SeededRandom, radius: number): [number, number][] => {
  const count = 5 + Math.floor(rng.next() * 4);
  const base = rng.range(0, Math.PI * 2);
  return Array.from({ length: count }, (_, i) => {
    const angle = base + (i / count) * Math.PI * 2;
    const r = radius * rng.range(0.78, 1.15);
    return [Math.cos(angle) * r, Math.sin(angle) * r] as [number, number];
  });
};

/**
 * Расставляет грибы, камни и сталагмиты в пещере по зонам и композиции.
 * Террейн не меняется — только объекты.
 */
export function generateStructuredCave(settings: GenSettings, cells: Cell[][], entrance?: Point, entranceWidth = 2): StructuredCave {
  const height = cells.length;
  const width = cells[0].length;
  const rng = new SeededRandom(settings.seed, 8101);
  const field = buildCaveField(cells, width, height);
  const occupancy = OccupancyGrid.fromMap(width, height, (x, y) => cells[y][x].terrain, (terrain) => terrain !== FLOOR);
  const spatial = new SpatialHash(2);
  const trees: Tree[] = [];
  const rocks: Rock[] = [];
  const plan = emptyPlan();
  plan.zones = field.zones;
  const groups: ObjectGroup[] = [];

  const groupPlan = (type: GroupType, x: number, y: number, placed: number): void => {
    groups.push({ id: `${type}_${groups.length}`, type, x, y, placed });
  };

  const clampToCell = (value: number, cell: number): number =>
    Math.min(cell + 0.45, Math.max(cell - 0.45, value));

  // Вход должен остаться свободным: иначе камень или гриб закроют единственный проход.
  const nearEntrance = (x: number, y: number): boolean =>
    !!entrance && Math.hypot(x - entrance.x, y - entrance.y) < entranceWidth + 1.6;

  const plantMushroom = (cx: number, cy: number, tight: boolean): Tree | null => {
    const entry = catalogEntry('mushroom');
    const x = Math.round(cx);
    const y = Math.round(cy);
    const jitterX = clampToCell(cx + (rng.next() - 0.5) * 0.4, x);
    const jitterY = clampToCell(cy + (rng.next() - 0.5) * 0.4, y);
    if (!field.has(x, y)) return null;
    if (nearEntrance(x, y)) return null;
    if (!occupancy.canPlace(entry, x, y, false)) return null;
    const spacing = tight ? entry.minDistance * 0.7 : entry.minDistance;
    if (spatial.tooClose(jitterX, jitterY, 'mushroom', spacing)) return null;
    const radius = rng.range(entry.radius[0], entry.radius[1]);
    const tree: Tree = { x: jitterX, y: jitterY, r: radius, kind: 'mushroom', v: rng.next() };
    trees.push(tree);
    occupancy.place(entry, x, y);
    spatial.add({ x: jitterX, y: jitterY, kind: 'mushroom', radius: radius * 1.6 });
    return tree;
  };

  const dropRock = (kind: 'rock' | 'smallRock' | 'boulder', cx: number, cy: number): Rock | null => {
    const entry = catalogEntry(kind);
    const x = Math.round(cx);
    const y = Math.round(cy);
    const jitterX = clampToCell(cx + (rng.next() - 0.5) * 0.35, x);
    const jitterY = clampToCell(cy + (rng.next() - 0.5) * 0.35, y);
    if (!field.has(x, y)) return null;
    if (nearEntrance(x, y)) return null;
    if (!occupancy.canPlace(entry, x, y, false)) return null;
    if (spatial.tooClose(jitterX, jitterY, entry.id, entry.minDistance * 0.8)) return null;
    const radius = rng.range(entry.radius[0], entry.radius[1]);
    rocks.push({
      x: jitterX,
      y: jitterY,
      r: radius,
      pts: rockPolygon(rng, radius),
      v: kind === 'smallRock' ? 0.8 + rng.next() * 0.2 : rng.next() * 0.66,
    });
    occupancy.place(entry, x, y);
    spatial.add({ x: jitterX, y: jitterY, kind: entry.id, radius: radius * 2.1 });
    return rocks[rocks.length - 1];
  };

  // ---- Водоёмы и залы как композиционные центры ---------------------------
  const flood = (passable: (x: number, y: number) => boolean): { size: number; cells: { x: number; y: number }[] }[] => {
    const seen = new Uint8Array(width * height);
    const areas: { size: number; cells: { x: number; y: number }[] }[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (seen[idx(x, y, width)] || !passable(x, y)) continue;
        const stack = [{ x, y }];
        const area: { x: number; y: number }[] = [];
        seen[idx(x, y, width)] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          area.push(p);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (seen[idx(nx, ny, width)] || !passable(nx, ny)) continue;
            seen[idx(nx, ny, width)] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
        areas.push({ size: area.length, cells: area });
      }
    }
    return areas;
  };

  const floorAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && cells[y][x].terrain === FLOOR;
  const waterAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && WATER.includes(cells[y][x].terrain);

  const pois: Poi[] = [];
  const floorAreas = flood(floorAt).filter((area) => area.size >= 12).sort((a, b) => b.size - a.size);
  for (const area of floorAreas.slice(0, 3)) {
    const cx = area.cells.reduce((sum, p) => sum + p.x, 0) / area.cells.length;
    const cy = area.cells.reduce((sum, p) => sum + p.y, 0) / area.cells.length;
    pois.push({ id: `chamber_${pois.length}`, type: 'chamber', x: Math.round(cx), y: Math.round(cy), radius: Math.min(7, Math.max(2, Math.sqrt(area.size) / 2)) });
  }
  for (const area of flood(waterAt).filter((item) => item.size >= 4).slice(0, 3)) {
    const cx = area.cells.reduce((sum, p) => sum + p.x, 0) / area.cells.length;
    const cy = area.cells.reduce((sum, p) => sum + p.y, 0) / area.cells.length;
    pois.push({ id: `pool_${pois.length}`, type: 'pool', x: Math.round(cx), y: Math.round(cy), radius: Math.min(6, Math.max(2, Math.sqrt(area.size))) });
  }
  // Вход — обязательный композиционный центр: к нему ведёт прорубленный коридор,
  // поэтому у входа не ставим крупные камни (проходимость важнее декора).
  if (entrance) {
    pois.unshift({ id: 'entrance_0', type: 'entrance', x: entrance.x, y: entrance.y, radius: 1.5 });
  }
  plan.poi = pois;

  // ---- Композиция пещеры --------------------------------------------------
  // Залы — открытые пространства (бой идёт в зале), проходы — чокпоинты,
  // сталагмиты уходят на кромку зала. Композиция строится ДО расстановки
  // объектов, чтобы центр зала остался свободным.
  const chamberInputs: CaveChamberInput[] = floorAreas.slice(0, 3).map((area) => {
    const cx = area.cells.reduce((sum, p) => sum + p.x, 0) / area.cells.length;
    const cy = area.cells.reduce((sum, p) => sum + p.y, 0) / area.cells.length;
    return { x: Math.round(cx), y: Math.round(cy), radius: Math.min(7, Math.max(2.4, Math.sqrt(area.size) / 2)), area: area.size };
  });
  const poolAreas = flood(waterAt).filter((item) => item.size >= 4).slice(0, 3);
  const poolInputs: CaveChamberInput[] = poolAreas.map((area) => {
    const cx = area.cells.reduce((sum, p) => sum + p.x, 0) / area.cells.length;
    const cy = area.cells.reduce((sum, p) => sum + p.y, 0) / area.cells.length;
    return { x: Math.round(cx), y: Math.round(cy), radius: Math.min(6, Math.max(1.6, Math.sqrt(area.size))), area: area.size };
  });
  const composition = buildCaveComposition({ width, height, cells, chambers: chamberInputs, pools: poolInputs, entrance });
  plan.composition = composition;

  // Открытые пространства композиции (зал-арена, площадки у воды) должны
  // оставаться свободными: декор уходит на кромку, не в центр боя.
  const clearRadius = (x: number, y: number): number => {
    let inner = 0;
    for (const space of composition.openSpaces) {
      if (Math.hypot(space.x - x, space.y - y) > space.radius + 2) continue;
      inner = Math.max(inner, space.radius * 0.76);
    }
    return inner;
  };

  // ---- Группы -------------------------------------------------------------
  for (const poi of pois) {
    if (poi.type === 'chamber') {
      const count = 3 + Math.floor(rng.next() * 3);
      let placed = 0;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + rng.range(-0.25, 0.25);
        const inner = clearRadius(poi.x, poi.y);
        const distance = rng.range(Math.max(poi.radius * 0.7, inner + 0.4), Math.max(poi.radius + 1.2, inner + 1.6));
        if (plantMushroom(poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, true)) placed += 1;
      }
      groupPlan('mushroom_ring', poi.x, poi.y, placed);

      let spikes = 0;
      const spikeCount = 2 + Math.floor(rng.next() * 3);
      for (let i = 0; i < spikeCount; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const inner = clearRadius(poi.x, poi.y);
        const distance = rng.range(Math.max(poi.radius * 0.6, inner + 0.3), Math.max(poi.radius + 0.6, inner + 1.4));
        const kind = rng.chance(0.3) ? 'boulder' : 'rock';
        if (dropRock(kind, poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance)) spikes += 1;
      }
      groupPlan('stalagmite_cluster', poi.x, poi.y, spikes);
    } else if (poi.type === 'pool') {
      let placed = 0;
      const count = 3 + Math.floor(rng.next() * 4);
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const distance = rng.range(0.8, poi.radius + 1.6);
        if (plantMushroom(poi.x + Math.cos(angle) * distance, poi.y + Math.sin(angle) * distance, false)) placed += 1;
      }
      groupPlan('mushroom_ring', poi.x, poi.y, placed);
    }
  }

  // ---- Осыпи у стен -------------------------------------------------------
  let rubblePiles = 0;
  for (let y = 1; y < height - 1 && rubblePiles < 24; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (field.typeAt(x, y) !== 'rubble') continue;
      if (insideOpenSpace(composition, x + 0.5, y + 0.5, 0)) continue;
      if (!rng.chance(0.05 * settings.rocks)) continue;
      let placed = 0;
      const count = 2 + Math.floor(rng.next() * 3);
      for (let i = 0; i < count; i += 1) {
        if (dropRock(rng.chance(0.6) ? 'smallRock' : 'rock', x + rng.range(-0.5, 0.5), y + rng.range(-0.5, 0.5))) placed += 1;
      }
      if (placed > 0) {
        groupPlan('rubble_pile', x, y, placed);
        rubblePiles += 1;
      }
    }
  }

  // ---- Одиночные объекты по плотности зон ---------------------------------
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!field.has(x, y)) continue;
      if (nearEntrance(x + 0.5, y + 0.5)) continue;
      if (insideOpenSpace(composition, x + 0.5, y + 0.5, 0)) continue;
      const zone = field.typeAt(x, y);
      const density = field.densityAt(x, y);
      const moisture = cells[y][x].moisture;
      // Камни: больше у стен и в залах, меньше в узких коридорах.
      const rockChance = density * (0.25 + settings.rocks * 0.4) * (zone === 'tunnel' ? 0.4 : 1);
      if (rng.chance(rockChance * 0.5)) {
        dropRock(rng.chance(0.75) ? 'smallRock' : 'rock', x + 0.5 + rng.range(-0.6, 0.6), y + 0.5 + rng.range(-0.6, 0.6));
        continue;
      }
      // Грибы: только во влажных местах и не в узких проходах.
      if (moisture < 0.4 || zone === 'tunnel') continue;
      const mushroomChance = density * (0.15 + settings.vegetation * 0.55) * moisture;
      if (rng.chance(mushroomChance * 0.35)) {
        plantMushroom(x + 0.5 + rng.range(-0.6, 0.6), y + 0.5 + rng.range(-0.6, 0.6), false);
      }
    }
  }

  plan.groups = groups;
  // Старт партии — у входа в пещеру, если он есть, иначе у первого зала.
  const entrancePoi = plan.poi.find((point) => point.type === 'entrance');
  const chamberPoi = plan.poi.find((point) => point.type === 'chamber');
  if (entrancePoi || chamberPoi) {
    plan.spawn = { x: (entrancePoi ?? chamberPoi)!.x, y: (entrancePoi ?? chamberPoi)!.y };
  }

  // ---- Валидатор ----------------------------------------------------------
  const problems: string[] = [];
  let overlap = 0;
  const occupiedCells = new Set<string>();
  for (const tree of [...trees, ...rocks]) {
    const cx = Math.round(tree.x);
    const cy = Math.round(tree.y);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      problems.push(`объект вне карты: ${cx},${cy}`);
      continue;
    }
    const terrain = cells[cy][cx].terrain;
    if (terrain !== FLOOR) problems.push(`${'kind' in tree ? tree.kind : 'rock'} стоит на ${terrain}`);
    const key = `${cx}:${cy}`;
    if (occupiedCells.has(key)) overlap += 1;
    occupiedCells.add(key);
  }
  const floorCount = cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === FLOOR).length, 0);
  const visited = new Uint8Array(width * height);
  const start = () => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (floorAt(x, y)) return { x, y };
    return null;
  };
  const first = start();
  let connectivity = 0;
  if (first) {
    const stack = [first];
    visited[idx(first.x, first.y, width)] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      connectivity += 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (visited[idx(nx, ny, width)] || !floorAt(nx, ny)) continue;
        visited[idx(nx, ny, width)] = 1;
        stack.push({ x: nx, y: ny });
      }
    }
  }
  const kinds = new Set(trees.map((tree) => tree.kind));
  const report: CaveReport = {
    connectivity: floorCount > 0 ? connectivity / floorCount : 0,
    overlap,
    density: occupiedCells.size / Math.max(1, floorCount),
    composition: groups.length > 0 && pois.length > 0,
    diversity: kinds.size,
    problems,
  };
  if (report.connectivity < 0.98) problems.push(`пол не связен: ${Math.round(report.connectivity * 100)}%`);

  return { trees, rocks, plan, report };
}
