import type { Cell, Point, Terrain } from '../types';
import type { GenerationPlan, Poi, ZoneType } from './plan';
import type { SeededRandom } from './random';

/**
 * Композиционный слой карты.
 *
 * Идея: сначала проектируем ПРОСТРАНСТВО (где бой, где лес, где дорога, где
 * переходы), и только потом ставим объекты. Объект, который не объясняется
 * композицией, не ставится — иначе получается процедурный шум.
 *
 * Слой независим от рендера и хранится в плане как optional-поле, поэтому
 * старые проекты и legacy-генератор остаются совместимыми.
 */

export type SpaceKind = 'battle_area' | 'clearing' | 'road_area' | 'yard' | 'landmark';

export type TacticalKind =
  | 'open_area'
  | 'cover_area'
  | 'chokepoint'
  | 'crossing'
  | 'ambush_area'
  | 'landmark_area'
  | 'transition';

/** Свободное пространство — такой же элемент карты, как спрайт. */
export interface OpenSpace {
  id: string;
  kind: SpaceKind;
  x: number;
  y: number;
  /** Радиус в клетках: внутри гарантированно нет препятствий для боя. */
  radius: number;
  /** 1 — главный визуальный центр, меньше — второстепенные. */
  importance: number;
  tactical: TacticalKind[];
}

/** Масса леса/скал: крупное плотное пространство с плавной границей. */
export interface MassRegion {
  id: string;
  kind: 'dense_forest' | 'medium_forest' | 'rocky';
  x: number;
  y: number;
  radius: number;
  /** 0..1 — насколько плотно внутри. */
  strength: number;
}

/** Переходная зона: мягкая граница между плотным и открытым пространством. */
export interface TransitionZone {
  id: string;
  kind: 'forest_edge' | 'riverbank' | 'roadside' | 'cave_edge' | 'town_edge';
  x: number;
  y: number;
  /** Внешний радиус полосы перехода. */
  radius: number;
  /** Внутренний радиус (откуда начинается разряжение). */
  inner: number;
  strength: number;
}

export interface TacticalSpace {
  kind: TacticalKind;
  x: number;
  y: number;
  radius: number;
}

export interface MapComposition {
  version: 1;
  /** Главный визуальный центр карты. */
  focal?: Point;
  openSpaces: OpenSpace[];
  masses: MassRegion[];
  transitions: TransitionZone[];
  tactical: TacticalSpace[];
}

const smoothstep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Удобный доступ к террейну без выхода за границы. */
/** Минимальный доступ к сетке террейна (композиции не нужен весь MapData). */
export interface TerrainGrid {
  width: number;
  height: number;
  cells: Cell[][];
}

const terrainOf = (map: TerrainGrid, x: number, y: number): Terrain | undefined => {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.cells[y][x].terrain;
};

const isOpenGround = (terrain: Terrain | undefined): boolean =>
  terrain === 'grass' ||
  terrain === 'darkGrass' ||
  terrain === 'dirt' ||
  terrain === 'sand' ||
  terrain === 'snow' ||
  terrain === 'mud' ||
  terrain === 'ice';

const distToPolyline = (x: number, y: number, points: Point[]): number => {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(x - points[0].x, y - points[0].y);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
};

interface CompositionInput {
  settings: { width: number; height: number; biome: string; seed: number };
  map: TerrainGrid;
  river: Point[];
  road: Point[];
  zones: {
    densityAt: (x: number, y: number) => number;
    typeAt: (x: number, y: number) => ZoneType;
    has: (x: number, y: number) => boolean;
  };
  rng: SeededRandom;
  /** Площади свободных пространств, которые уже попросил биомный планировщик. */
  requestedOpen?: OpenSpace[];
  /** Постройки и руины: вокруг каждой делаем расчищенный двор. */
  structures?: { x: number; y: number; w: number; h: number; ruin: boolean }[];
}

/**
 * Строит композицию до расстановки объектов.
 *
 * Порядок внутри: главный визуальный центр → второстепенные пространства →
 * массы леса → переходные полосы → тактические пространства.
 */
export function buildComposition(input: CompositionInput): MapComposition {
  const { settings, map, river, road, zones, rng } = input;
  const { width, height } = settings;
  const openSpaces: OpenSpace[] = [];
  const masses: MassRegion[] = [];
  const transitions: TransitionZone[] = [];
  const tactical: TacticalSpace[] = [];

  const pushSpace = (space: OpenSpace): OpenSpace => {
    openSpaces.push(space);
    return space;
  };

  // ---- 1. Главный визуальный центр ---------------------------------------
  // Ищем самое «открытое» место: низкая плотность зон, не у края, не на воде,
  // не на дороге и не на реке. Перебор грубый (шаг 3), чтобы не зависеть от шума.
  const minSide = Math.min(width, height);
  const battleRadius = Math.max(3, Math.min(6, Math.round(minSide * 0.09)));
  let bestScore = -Infinity;
  let bestPoint: Point = { x: width / 2, y: height / 2 };
  for (let y = 3; y < height - 3; y += 3) {
    for (let x = 3; x < width - 3; x += 3) {
      const terrain = terrainOf(map, x, y);
      if (!isOpenGround(terrain)) continue;
      const centrality = 1 - Math.min(1, Math.hypot(x - width / 2, y - height / 2) / (minSide * 0.75));
      const openness = 1 - zones.densityAt(x, y);
      const roadNear = road.length > 0 ? Math.max(0, 1 - distToPolyline(x, y, road) / 8) : 0;
      const riverNear = river.length > 0 ? Math.max(0, 1 - distToPolyline(x, y, river) / 6) : 0;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge < 3) continue;
      // Площадка боя не может стоять на воде, дороге или в чаще:
      // проверяем долю открытого грунта по кругу, а не только центр.
      if (spaceQuality(map, x, y, battleRadius) < 0.8) continue;
      if (road.length > 0 && distToPolyline(x, y, road) < battleRadius * 0.7) continue;
      if (river.length > 0 && distToPolyline(x, y, river) < battleRadius + 1.5) continue;
      const score = openness * 1.5 + centrality * 1.2 + roadNear * 0.35 + rng.range(0, 0.25) - riverNear * 1.4;
      if (score > bestScore) {
        bestScore = score;
        bestPoint = { x, y };
      }
    }
  }

  const battle = pushSpace({
    id: 'space_battle',
    kind: 'battle_area',
    x: bestPoint.x,
    y: bestPoint.y,
    radius: battleRadius,
    importance: 1,
    tactical: ['open_area', 'landmark_area'],
  });
  const focal: Point = { x: battle.x, y: battle.y };
  tactical.push({ kind: 'open_area', x: battle.x, y: battle.y, radius: battle.radius });
  tactical.push({ kind: 'landmark_area', x: battle.x, y: battle.y, radius: battle.radius * 0.6 });

  // ---- 2. Второстепенные открытые пространства ---------------------------
  // (а) площадка у дороги — там, где тракт делает остановку;
  if (road.length > 8) {
    const mid = road[Math.floor(road.length / 2)];
    const spot = findOpenCellAround(map, zones, mid, 3, rng);
    if (spot && Math.hypot(spot.x - battle.x, spot.y - battle.y) > battle.radius + 3) {
      pushSpace({
        id: 'space_road',
        kind: 'road_area',
        x: spot.x,
        y: spot.y,
        radius: Math.max(2, Math.round(battleRadius * 0.55)),
        importance: 0.6,
        tactical: ['transition'],
      });
    }
  }
  // (б) береговая заводь у реки — «пляж» для переправы.
  if (river.length > 6) {
    const mid = river[Math.floor(river.length / 2)];
    const spot = findOpenCellAround(map, zones, mid, 4, rng);
    if (spot) {
      const near = Math.min(...openSpaces.map((space) => Math.hypot(spot.x - space.x, spot.y - space.y)));
      if (near > 3) {
        pushSpace({
          id: 'space_river',
          kind: 'clearing',
          x: spot.x,
          y: spot.y,
          radius: Math.max(2, Math.round(battleRadius * 0.5)),
          importance: 0.5,
          tactical: ['crossing'],
        });
      }
    }
  }
  // (в) запрошенные биомом пространства (например, вторая поляна).
  // ---- 2.5. Дворы вокруг построек и руин --------------------------------
  // Двор — тоже открытое пространство: внутри не ставим растительность, а по
  // краю соберём обломки кладки. Так руина не выглядит «домом в чаще».
  const structures = input.structures ?? [];
  for (let index = 0; index < structures.length; index += 1) {
    const structure = structures[index];
    const centerX = structure.x + structure.w / 2 - 0.5;
    const centerY = structure.y + structure.h / 2 - 0.5;
    const radius = Math.max(2.4, Math.max(structure.w, structure.h) * 0.5 + (structure.ruin ? 1.6 : 1.0));
    const clashes = openSpaces.some(
      (space) => Math.hypot(space.x - centerX, space.y - centerY) < space.radius + radius * 0.4,
    );
    if (clashes) continue;
    pushSpace({
      id: `yard_${index}`,
      kind: 'yard',
      x: centerX,
      y: centerY,
      radius,
      importance: 0.55,
      tactical: ['landmark_area', 'cover_area'],
    });
  }

  for (const requested of input.requestedOpen ?? []) {
    const tooClose = openSpaces.some(
      (space) => Math.hypot(space.x - requested.x, space.y - requested.y) < space.radius + requested.radius + 1,
    );
    if (tooClose) continue;
    pushSpace(requested);
  }

  // ---- 3. Массы леса -----------------------------------------------------
  // Размещаем 2–4 плотных массива так, чтобы они не накрывали открытые
  // пространства. Границы масс плавные — по distance field, а не по клеткам.
  const massCount = Math.max(2, Math.min(4, Math.round((width * height) / 900)));
  const massRadiusBase = Math.max(4, Math.round(minSide * 0.16));
  for (let index = 0; index < massCount; index += 1) {
    let placed: MassRegion | null = null;
    for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
      const x = 3 + rng.range(0, width - 6);
      const y = 3 + rng.range(0, height - 6);
      const terrain = terrainOf(map, Math.round(x), Math.round(y));
      if (!isOpenGround(terrain) && terrain !== 'darkGrass') continue;
      const clearance = Math.min(
        ...openSpaces.map((space) => Math.hypot(space.x - x, space.y - y) - space.radius),
        Infinity,
      );
      if (clearance < 2) continue;
      const radius = massRadiusBase * rng.range(0.75, 1.25);
      // Массив леса не должен «плавать» в реке: считаем долю воды в круге.
      let waterCells = 0;
      let sampledCells = 0;
      for (let sy = Math.floor(y - radius); sy <= Math.ceil(y + radius); sy += 1) {
        for (let sx = Math.floor(x - radius); sx <= Math.ceil(x + radius); sx += 1) {
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          if (Math.hypot(sx - x, sy - y) > radius) continue;
          sampledCells += 1;
          if (terrainOf(map, sx, sy) === 'water' || terrainOf(map, sx, sy) === 'deepWater') waterCells += 1;
        }
      }
      if (sampledCells > 0 && waterCells / sampledCells > 0.15) continue;
      // И не должен лежать поперёк тракта: коридор дороги вычищает деревья,
      // поэтому ядро массива рядом с дорогой выглядит «разреженным».
      if (road.length > 0 && distToPolyline(x, y, road) < radius + 3) continue;
      if (river.length > 0 && distToPolyline(x, y, river) < radius + 2) continue;
      const tooClose = masses.some((mass) => Math.hypot(mass.x - x, mass.y - y) < (mass.radius + radius) * 0.55);
      if (tooClose) continue;
      placed = { id: `mass_${index}`, kind: 'dense_forest', x, y, radius, strength: rng.range(0.8, 1) };
    }
    if (placed) {
      masses.push(placed);
      tactical.push({ kind: 'cover_area', x: placed.x, y: placed.y, radius: placed.radius * 0.8 });
    }
  }

  // ---- 4. Переходные полосы ---------------------------------------------
  // Вокруг каждого открытого пространства и каждой массы — мягкая кайма:
  // там плотность объектов падает плавно, без «стены леса».
  for (const space of openSpaces) {
    transitions.push({
      id: `edge_${space.id}`,
      kind: 'forest_edge',
      x: space.x,
      y: space.y,
      radius: space.radius + Math.max(2.5, space.radius * 0.8),
      inner: space.radius + 0.6,
      strength: 0.7,
    });
    tactical.push({ kind: 'transition', x: space.x, y: space.y, radius: space.radius + 2.5 });
    tactical.push({ kind: 'ambush_area', x: space.x, y: space.y, radius: space.radius + Math.max(2.5, space.radius * 0.8) });
  }

  return { version: 1, focal, openSpaces, masses, transitions, tactical };
}


/** Доля открытого грунта в круге — площадка боя не может стоять на воде/дороге. */
function spaceQuality(map: TerrainGrid, x: number, y: number, radius: number): number {
  let total = 0;
  let good = 0;
  const steps = Math.max(6, Math.round(radius * 4));
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    for (let ring = 1; ring <= 3; ring += 1) {
      const distance = (ring / 3) * radius;
      const px = Math.round(x + Math.cos(angle) * distance);
      const py = Math.round(y + Math.sin(angle) * distance);
      const terrain = terrainOf(map, px, py);
      total += 1;
      if (isOpenGround(terrain)) good += 1;
    }
  }
  return total ? good / total : 0;
}

/** Ищет ближайшую открытую клетку вокруг точки (для площадок у дороги/реки). */
function findOpenCellAround(
  map: TerrainGrid,
  zones: { densityAt: (x: number, y: number) => number },
  origin: Point,
  radius: number,
  rng: SeededRandom,
): Point | null {
  let best: Point | null = null;
  let bestScore = -Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.round(origin.x) + dx;
      const y = Math.round(origin.y) + dy;
      if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) continue;
      const terrain = map.cells[y][x].terrain;
      if (!isOpenGround(terrain)) continue;
      // Площадка должна быть площадкой: проверяем не точку, а её окрестность,
      // иначе «пляж у реки» окажется наполовину в воде.
      let probeTotal = 0;
      let probeOpen = 0;
      for (let py = -1; py <= 1; py += 1) {
        for (let px = -1; px <= 1; px += 1) {
          probeTotal += 1;
          if (isOpenGround(map.cells[y + py]?.[x + px]?.terrain ?? 'void')) probeOpen += 1;
        }
      }
      if (probeOpen / probeTotal < 0.7) continue;
      const score = 1 - zones.densityAt(x, y) + rng.range(0, 0.2) - Math.hypot(dx, dy) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 1 внутри свободного пространства, 0 снаружи (с мягким краем). */
export function openSpaceInfluence(composition: MapComposition, x: number, y: number): number {
  let influence = 0;
  for (const space of composition.openSpaces) {
    const distance = Math.hypot(x - space.x, y - space.y);
    const edge = space.radius + 1.2;
    if (distance >= edge) continue;
    influence = Math.max(influence, smoothstep((edge - distance) / (edge - space.radius + 1.2)));
  }
  return influence;
}

/** Структурная маска леса: 1 в ядре массы, плавно к 0 на границе. */
export function massInfluence(composition: MapComposition, x: number, y: number): number {
  let influence = 0;
  for (const mass of composition.masses) {
    const distance = Math.hypot(x - mass.x, y - mass.y);
    const edge = mass.radius * (mass.strength * 0.35 + 0.85);
    if (distance >= edge) continue;
    const t = smoothstep(1 - distance / edge);
    influence = Math.max(influence, t);
  }
  return influence;
}

/** Полоса перехода: 1 в середине каймы, 0 вне её. */
export function transitionInfluence(composition: MapComposition, x: number, y: number): number {
  let influence = 0;
  for (const transition of composition.transitions) {
    const distance = Math.hypot(x - transition.x, y - transition.y);
    if (distance <= transition.inner || distance >= transition.radius) continue;
    const t = (distance - transition.inner) / (transition.radius - transition.inner);
    const wave = 1 - Math.abs(t * 2 - 1);
    influence = Math.max(influence, smoothstep(wave) * transition.strength);
  }
  return influence;
}

/**
 * Итоговая плотность растительности в клетке по композиции.
 * Пустое пространство всегда даёт 0 — это гарантия игровой читаемости.
 */
export function compositionDensity(
  composition: MapComposition,
  x: number,
  y: number,
  organicDensity: number,
): number {
  const open = openSpaceInfluence(composition, x, y);
  if (open > 0) return 0;
  const mass = massInfluence(composition, x, y);
  const transition = transitionInfluence(composition, x, y);
  const structural = Math.max(mass, transition * 0.55);
  if (structural <= 0) {
    // Вне масс и каймы остаётся редкая «одиночная» растительность,
    // но она не должна забивать открытые места.
    return clamp01(organicDensity * 0.22);
  }
  // Усиливаем ядро масс и приглушаем край: читаемый градиент плотности.
  return clamp01(Math.pow(structural, 1.45) * (0.5 + organicDensity * 0.6));
}

/** Внутри свободного пространства (для резервирования клеток). */
export function insideOpenSpace(composition: MapComposition, x: number, y: number, padding = 0.4): boolean {
  return composition.openSpaces.some(
    (space) => Math.hypot(x - space.x, y - space.y) <= space.radius + padding,
  );
}

/** POI-описания пространств, чтобы тропы и камера их видели. */
export function compositionPois(composition: MapComposition): Poi[] {
  return composition.openSpaces.map((space) => ({
    id: space.id,
    type: space.kind === 'battle_area' || space.kind === 'clearing' ? 'clearing' : 'grove',
    x: space.x,
    y: space.y,
    radius: space.radius,
  }));
}

/** Краткая сводка для отчёта в UI. */
export function compositionSummary(composition: MapComposition): string {
  const spaces = composition.openSpaces.length;
  const masses = composition.masses.length;
  const transitions = composition.transitions.length;
  const tactical = composition.tactical.length;
  return `${spaces} пространств · ${masses} масс · ${transitions} переходов · ${tactical} тактических зон`;
}

/** План-заглушка для legacy-генератора: пустая композиция. */
export const emptyComposition = (): MapComposition => ({
  version: 1,
  openSpaces: [],
  masses: [],
  transitions: [],
  tactical: [],
});

/** Хранится в плане, чтобы отладка и тесты могли читать композицию. */
export function attachComposition(plan: GenerationPlan, composition: MapComposition): GenerationPlan {
  return { ...plan, composition };
}

/** Входные данные для композиции пещеры: залы и водоёмы из готового террейна. */
export interface CaveChamberInput {
  x: number;
  y: number;
  radius: number;
  area: number;
}

export interface CaveCompositionInput {
  width: number;
  height: number;
  cells: Cell[][];
  chambers: CaveChamberInput[];
  pools: CaveChamberInput[];
  entrance?: Point;
}

/**
 * Композиция пещеры: залы — это открытые пространства, узкие проходы — сами
 * по себе чокпоинты. Бой в пещере должен происходить в зале, а не в щели,
 * поэтому главный зал становится `battle_area`, сталагмиты уходят на кромку,
 * а стены зала получают переходную зону.
 */
export function buildCaveComposition(input: CaveCompositionInput): MapComposition {
  const openSpaces: OpenSpace[] = [];
  const sorted = [...input.chambers].sort((a, b) => b.area - a.area);
  sorted.forEach((chamber, index) => {
    const radius = Math.min(7, Math.max(2.4, chamber.radius));
    openSpaces.push({
      id: index === 0 ? 'battle_cave' : `chamber_${index}`,
      kind: index === 0 ? 'battle_area' : 'clearing',
      x: chamber.x,
      y: chamber.y,
      radius,
      importance: index === 0 ? 1 : 0.6,
      tactical: index === 0 ? ['open_area', 'cover_area', 'landmark_area'] : ['cover_area'],
    });
  });
  for (const pool of input.pools.slice(0, 2)) {
    openSpaces.push({
      id: `pool_${openSpaces.length}`,
      kind: 'landmark',
      x: pool.x,
      y: pool.y,
      radius: Math.min(5, Math.max(1.6, pool.radius)),
      importance: 0.45,
      tactical: ['landmark_area', 'cover_area'],
    });
  }
  if (input.entrance) {
    openSpaces.push({
      id: 'gate',
      kind: 'landmark',
      x: input.entrance.x,
      y: input.entrance.y,
      radius: 1.8,
      importance: 0.7,
      tactical: ['chokepoint', 'landmark_area'],
    });
  }

  // Сталагмитовые поля — «массы камня» на кромке залов, а не по центру.
  const masses: MassRegion[] = [];
  sorted.slice(0, 3).forEach((chamber, index) => {
    const angle = (index / Math.max(1, sorted.length)) * Math.PI * 2 + 0.9;
    const distance = Math.max(1.6, chamber.radius * 0.6);
    masses.push({
      id: `rocks_${index}`,
      kind: 'rocky',
      x: chamber.x + Math.cos(angle) * distance,
      y: chamber.y + Math.sin(angle) * distance,
      radius: Math.max(1.8, chamber.radius * 0.55),
      strength: 0.6,
    });
  });

  const transitions: TransitionZone[] = openSpaces.map((space, index) => ({
    id: `edge_${index}`,
    kind: 'cave_edge',
    x: space.x,
    y: space.y,
    radius: space.radius + Math.max(1.4, space.radius * 0.5),
    inner: space.radius + 0.4,
    strength: 0.7,
  }));

  const tactical: TacticalSpace[] = [];
  if (openSpaces[0]) tactical.push({ kind: 'open_area', x: openSpaces[0].x, y: openSpaces[0].y, radius: openSpaces[0].radius });
  for (const mass of masses) tactical.push({ kind: 'cover_area', x: mass.x, y: mass.y, radius: mass.radius });
  if (input.entrance) tactical.push({ kind: 'chokepoint', x: input.entrance.x, y: input.entrance.y, radius: 1.8 });

  return {
    version: 1,
    focal: openSpaces[0] ? { x: openSpaces[0].x, y: openSpaces[0].y } : undefined,
    openSpaces,
    masses,
    transitions,
    tactical,
  };
}

/** Входные данные для композиции поселения. */
export interface SettlementCompositionInput {
  width: number;
  height: number;
  cells: Cell[][];
  plaza?: { x: number; y: number; radius: number };
  buildings: { x: number; y: number; w: number; h: number }[];
}

/**
 * Композиция поселения: площадь — арена боя, дворы — открытые пятна вокруг
 * домов, улицы связывают их. Зелень ставится по краям, а не на проезжей части.
 */
export function buildSettlementComposition(input: SettlementCompositionInput): MapComposition {
  const openSpaces: OpenSpace[] = [];
  if (input.plaza) {
    openSpaces.push({
      id: 'plaza_0',
      kind: 'battle_area',
      x: input.plaza.x,
      y: input.plaza.y,
      radius: Math.max(3, input.plaza.radius),
      importance: 1,
      tactical: ['open_area', 'landmark_area'],
    });
  }
  input.buildings.slice(0, 8).forEach((building, index) => {
    openSpaces.push({
      id: `yard_${index}`,
      kind: 'yard',
      x: building.x + building.w / 2 - 0.5,
      y: building.y + building.h / 2 - 0.5,
      radius: Math.max(2.4, Math.max(building.w, building.h) * 0.5 + 1),
      importance: 0.5,
      tactical: ['cover_area'],
    });
  });
  const transitions: TransitionZone[] = openSpaces
    .filter((space) => space.kind === 'battle_area')
    .map((space) => ({
      id: 'town_edge_0',
      kind: 'town_edge' as const,
      x: space.x,
      y: space.y,
      radius: space.radius + 2,
      inner: space.radius + 0.5,
      strength: 0.6,
    }));
  return {
    version: 1,
    focal: openSpaces[0] ? { x: openSpaces[0].x, y: openSpaces[0].y } : undefined,
    openSpaces,
    masses: [],
    transitions,
    tactical: openSpaces.map((space) => ({ kind: 'open_area' as const, x: space.x, y: space.y, radius: space.radius })),
  };
}
