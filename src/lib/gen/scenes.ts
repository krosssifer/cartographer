// Генерация карты по сцене-архетипу.
//
// Порядок слоёв:
//   1. рельеф и вода (landscape.ts) — по профилю архетипа;
//   2. главный визуальный центр (фокус) — по правилу архетипа: центр, трети,
//      ось долины, переправа, подножие скал, дорога;
//   3. дорога — сквозной тракт вдоль оси сцены, ответвление ведёт к фокусу;
//   4. композиция: фокус, второстепенные пространства неравного размера,
//      массы леса с асимметричным балансом (тяжёлая масса напротив фокуса);
//   5. сюжетные постройки архетипа (features.ts) — до растительности, чтобы
//      лес их обходил;
//   6. структурная растительность (forest.ts) по готовой композиции и
//      плодородию рельефа.
//
// Всё детерминировано: каждый слой берёт свой поток SeededRandom.

import type { Cell, GenSettings, MapData, Point, Terrain } from '../types';
import type { ArchetypeResolution, SceneArchetypeDef } from './archetypes';
import type { MapComposition, MassRegion, OpenSpace, TacticalSpace, TransitionZone } from './composition';
import { placeSceneFeatures } from './features';
import type { FeatureSite } from './features';
import { generateStructuredVegetation } from './forest';
import { buildLandscape, sceneUV } from './landscape';
import type { LandscapeResult } from './landscape';
import type { ArchetypeReport, Bridge, RoadNetwork } from './plan';
import { SeededRandom } from './random';
import { planRoadNetwork } from './roads';

/** Версия алгоритма сцен: меняется, если тот же сид начинает давать другую карту. */
export const SCENE_GENERATOR_VERSION = 1;

const OPEN_GROUND: ReadonlySet<Terrain> = new Set<Terrain>(['grass', 'darkGrass', 'dirt', 'sand', 'snow', 'mud', 'ice']);
const isWater = (terrain: Terrain | undefined): boolean => terrain === 'water' || terrain === 'deepWater';

interface Grid {
  width: number;
  height: number;
  cells: Cell[][];
}

const terrainOf = (grid: Grid, x: number, y: number): Terrain | undefined => grid.cells[y]?.[x]?.terrain;

/** Доля проходимого открытого грунта в круге (дорога засчитывается по флагу). */
function openness(grid: Grid, x: number, y: number, radius: number, roadIsOpen: boolean): number {
  let total = 0;
  let good = 0;
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      total += 1;
      const terrain = terrainOf(grid, Math.round(x) + dx, Math.round(y) + dy);
      if (terrain && (OPEN_GROUND.has(terrain) || (roadIsOpen && (terrain === 'road' || terrain === 'bridge')))) good += 1;
    }
  }
  return total ? good / total : 0;
}

/** Доля скалы в кольце [inner, outer] — «стена» за спиной фокуса. */
function rockRing(grid: Grid, x: number, y: number, inner: number, outer: number): number {
  let total = 0;
  let rock = 0;
  const reach = Math.ceil(outer);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const distance = Math.hypot(dx, dy);
      if (distance < inner || distance > outer) continue;
      total += 1;
      if (terrainOf(grid, Math.round(x) + dx, Math.round(y) + dy) === 'rock') rock += 1;
    }
  }
  return total ? rock / total : 0;
}

function distToPolyline(x: number, y: number, points: Point[]): number {
  if (!points.length) return Infinity;
  let best = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[Math.min(points.length - 1, index + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

function nearestOnPolyline(points: Point[], x: number, y: number): Point | null {
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/** Ближайший край карты как направление «подхода» (рад). */
function edgeApproach(width: number, height: number, x: number, y: number): number {
  const options: [number, number][] = [
    [width - 1 - x, 0],
    [height - 1 - y, Math.PI / 2],
    [x, Math.PI],
    [y, -Math.PI / 2],
  ];
  options.sort((a, b) => a[0] - b[0]);
  return options[0][1];
}

interface FocalChoice {
  /** Центр главного открытого пространства. */
  space: Point;
  /** Смысловая точка фокуса (у переправы — сама переправа). */
  anchor: Point;
  radius: number;
}

/**
 * Выбор главного визуального центра. Цель задаётся правилом архетипа, затем
 * ищется ближайшее к цели место с открытым грунтом нужного радиуса. Асимметрия
 * сдвигает цель от геометрического центра — сцена не выглядит «по линейке».
 */
function chooseFocal(
  archetype: SceneArchetypeDef,
  grid: Grid,
  land: LandscapeResult,
  road: Point[],
  rng: SeededRandom,
): FocalChoice {
  const { width, height } = grid;
  const minSide = Math.min(width, height);
  // Фокус на дороге — узкое место: лес подступает к самой обочине.
  const minRadius = archetype.composition.focal === 'road' ? 2 : 3;
  const radius = Math.max(minRadius, Math.min(8, Math.round(minSide * archetype.composition.focalRadius)));
  const asymmetry = archetype.composition.asymmetry;
  const angle = rng.range(0, Math.PI * 2);
  const center = { x: (width - 1) / 2, y: (height - 1) / 2 };
  let target: Point = {
    x: center.x + Math.cos(angle) * asymmetry * minSide * 0.24,
    y: center.y + Math.sin(angle) * asymmetry * minSide * 0.24,
  };
  let anchor: Point | null = null;
  let roadIsOpen = false;
  let preferLow = false;
  let preferCliff = false;
  const along = rng.chance(0.5) ? 1 : -1;

  switch (archetype.composition.focal) {
    case 'thirds': {
      const tx = rng.chance(0.5) ? 1 / 3 : 2 / 3;
      const ty = rng.chance(0.5) ? 1 / 3 : 2 / 3;
      target = { x: width * tx + rng.range(-1.5, 1.5), y: height * ty + rng.range(-1.5, 1.5) };
      break;
    }
    case 'axis': {
      // Ось сцены: середина долины/перевала со сдвигом вдоль оси.
      const u = 0.5 + along * asymmetry * 0.22;
      target = land.frame.horizontal ? { x: (width - 1) * u, y: center.y } : { x: center.x, y: (height - 1) * u };
      preferLow = true;
      break;
    }
    case 'crossing': {
      const river = land.mainRiver?.points ?? [];
      if (river.length > 4) {
        const from = Math.floor(river.length * 0.3);
        const to = Math.max(from + 1, Math.ceil(river.length * 0.7));
        let best = river[from];
        let bestDistance = Infinity;
        for (let index = from; index < to; index += 1) {
          const distance = Math.hypot(river[index].x - target.x, river[index].y - target.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = river[index];
          }
        }
        anchor = best;
        target = best;
      }
      break;
    }
    case 'cliff':
      preferCliff = true;
      break;
    case 'road': {
      if (road.length > 6) {
        const index = Math.floor(road.length * (0.5 + along * asymmetry * 0.18));
        anchor = road[Math.max(0, Math.min(road.length - 1, index))];
        target = anchor;
        roadIsOpen = true;
      }
      break;
    }
    case 'center':
      break;
  }

  let best: Point = { x: Math.round(target.x), y: Math.round(target.y) };
  let bestScore = -Infinity;
  const margin = radius + 1;
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const terrain = terrainOf(grid, x, y);
      if (!terrain || isWater(terrain) || terrain === 'rock') continue;
      const quality = openness(grid, x, y, radius, roadIsOpen);
      if (quality < 0.55) continue;
      const distance = Math.hypot(x - target.x, y - target.y) / minSide;
      let score = quality * 1.6 - distance * 2.4 + rng.range(0, 0.12);
      if (preferLow) score += (1 - land.heights[y * width + x]) * 0.8;
      if (preferCliff) score += rockRing(grid, x, y, radius, radius + 3.5) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return { space: best, anchor: anchor ?? best, radius };
}

/** Края, через которые тракт входит и выходит: вдоль оси сцены, по низким местам. */
function roadEnds(grid: Grid, land: LandscapeResult, rng: SeededRandom, avoid: Point | null): { entry: Point; exit: Point } {
  // Тракт обходит место сцены стороной: к нему ведёт ответвление, а не магистраль.
  const avoidV = avoid ? sceneUV(land, grid.width, grid.height, avoid.x, avoid.y).v : null;
  const { width, height } = grid;
  const pick = (fixed: number, horizontalAxis: boolean): Point => {
    let best: Point = horizontalAxis ? { x: fixed, y: Math.floor(height / 2) } : { x: Math.floor(width / 2), y: fixed };
    let bestCost = Infinity;
    const span = horizontalAxis ? height : width;
    for (let k = 2; k < span - 2; k += 1) {
      const x = horizontalAxis ? fixed : k;
      const y = horizontalAxis ? k : fixed;
      const terrain = terrainOf(grid, x, y);
      const { v } = sceneUV(land, width, height, x, y);
      const cost = land.heights[y * width + x]
        + (isWater(terrain) ? 1.2 : 0)
        + (terrain === 'rock' ? 0.6 : 0)
        + Math.abs(v - 0.5) * 0.5
        + (avoidV === null ? 0 : Math.max(0, 1 - Math.abs(v - avoidV) * 3) * 0.7)
        + rng.range(0, 0.08);
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, y };
      }
    }
    return best;
  };
  const horizontal = land.frame.horizontal;
  const a = pick(1, horizontal);
  const b = pick(horizontal ? width - 2 : height - 2, horizontal);
  return rng.chance(0.5) ? { entry: a, exit: b } : { entry: b, exit: a };
}

interface CompositionParts {
  composition: MapComposition;
  secondary: OpenSpace[];
}

/**
 * Композиция сцены: фокус → второстепенные пространства → массы → каймы.
 * Второстепенные пространства неравны по размеру и стоят на разных
 * расстояниях; массы тяготеют к стороне, противоположной смещению фокуса —
 * асимметричный, но уравновешенный кадр.
 */
function composeScene(
  archetype: SceneArchetypeDef,
  grid: Grid,
  land: LandscapeResult,
  focal: FocalChoice,
  road: Point[],
  rng: SeededRandom,
): CompositionParts {
  const { width, height } = grid;
  const minSide = Math.min(width, height);
  const area = width * height;
  const openSpaces: OpenSpace[] = [];
  const masses: MassRegion[] = [];
  const transitions: TransitionZone[] = [];
  const tactical: TacticalSpace[] = [];

  const focalSpace: OpenSpace = {
    id: 'space_battle',
    kind: 'battle_area',
    x: focal.space.x,
    y: focal.space.y,
    radius: focal.radius,
    importance: 1,
    tactical: ['open_area', 'landmark_area'],
  };
  openSpaces.push(focalSpace);
  tactical.push({ kind: 'open_area', x: focalSpace.x, y: focalSpace.y, radius: focalSpace.radius });

  // ---- второстепенные пространства --------------------------------------
  const wanted = Math.max(0, Math.round(archetype.composition.secondary * Math.min(1.8, Math.max(0.7, Math.sqrt(area / 800)))));
  const secondary: OpenSpace[] = [];
  for (let index = 0; index < wanted; index += 1) {
    const radius = Math.max(2, Math.round(focal.radius * rng.range(0.4, 0.72)));
    let best: OpenSpace | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const x = Math.round(radius + 1 + rng.range(0, width - 2 * radius - 2));
      const y = Math.round(radius + 1 + rng.range(0, height - 2 * radius - 2));
      const terrain = terrainOf(grid, x, y);
      if (!terrain || !OPEN_GROUND.has(terrain)) continue;
      const clearance = Math.min(...openSpaces.map((space) => Math.hypot(space.x - x, space.y - y) - space.radius - radius));
      if (clearance < 2) continue;
      const quality = openness(grid, x, y, radius, false);
      if (quality < 0.7) continue;
      // Не «по сетке»: награда за удалённость насыщается, остальное решает шум.
      const score = quality + Math.min(clearance, minSide * 0.35) / minSide + rng.range(0, 0.35)
        - (road.length && distToPolyline(x, y, road) < radius ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { id: `space_${index}`, kind: 'clearing', x, y, radius, importance: rng.range(0.35, 0.6), tactical: ['transition'] };
      }
    }
    if (best) {
      openSpaces.push(best);
      secondary.push(best);
    }
  }

  // ---- массы -------------------------------------------------------------
  const massCount = archetype.composition.masses > 0
    ? Math.max(1, Math.round(archetype.composition.masses * Math.min(2.2, Math.max(0.8, Math.sqrt(area / 800)))))
    : 0;
  const massBase = Math.max(3, minSide * 0.16) * archetype.composition.massScale;
  const offsetX = focal.space.x - (width - 1) / 2;
  const offsetY = focal.space.y - (height - 1) / 2;
  const offsetLength = Math.hypot(offsetX, offsetY) || 1;
  const hugRoad = archetype.composition.focal === 'road';
  // Тракт, сжатый лесом: две массы по разные стороны дороги у фокуса,
  // разного размера и со сдвигом вдоль полотна — не зеркальные.
  if (hugRoad && road.length > 4 && massCount > 0) {
    let at = 0;
    for (let index = 1; index < road.length; index += 1) {
      if (Math.hypot(road[index].x - focal.anchor.x, road[index].y - focal.anchor.y) < Math.hypot(road[at].x - focal.anchor.x, road[at].y - focal.anchor.y)) at = index;
    }
    const before = road[Math.max(0, at - 3)];
    const after = road[Math.min(road.length - 1, at + 3)];
    const angle = Math.atan2(after.y - before.y, after.x - before.x);
    const shift = rng.range(1.5, 3.5) * (rng.chance(0.5) ? 1 : -1);
    for (const side of [1, -1]) {
      const radius = massBase * rng.range(0.75, 1.15);
      const offset = radius * 0.75 + 2.2;
      const along = side === 1 ? shift : -shift * rng.range(0.3, 0.8);
      masses.push({
        id: `mass_flank_${side === 1 ? 'a' : 'b'}`,
        kind: 'dense_forest',
        x: Math.max(1, Math.min(width - 2, focal.anchor.x - Math.sin(angle) * offset * side + Math.cos(angle) * along)),
        y: Math.max(1, Math.min(height - 2, focal.anchor.y + Math.cos(angle) * offset * side + Math.sin(angle) * along)),
        radius,
        strength: rng.range(0.9, 1),
      });
    }
  }
  for (let index = masses.length; index < massCount; index += 1) {
    const radius = massBase * rng.range(0.7, 1.3);
    let best: MassRegion | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = 2 + rng.range(0, width - 4);
      const y = 2 + rng.range(0, height - 4);
      const cx = Math.round(x);
      const cy = Math.round(y);
      const terrain = terrainOf(grid, cx, cy);
      if (!terrain || isWater(terrain)) continue;
      const clearance = Math.min(...openSpaces.map((space) => Math.hypot(space.x - x, space.y - y) - space.radius));
      if (clearance < radius * 0.55 + 1) continue;
      let fertility = 0;
      let samples = 0;
      for (let dy = -2; dy <= 2; dy += 2) {
        for (let dx = -2; dx <= 2; dx += 2) {
          const sx = cx + dx;
          const sy = cy + dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          fertility += land.fertility[sy * width + sx];
          samples += 1;
        }
      }
      fertility = samples ? fertility / samples : 0;
      // Первая (самая тяжёлая) масса — напротив смещения фокуса.
      const opposite = -((x - (width - 1) / 2) * offsetX + (y - (height - 1) / 2) * offsetY) / offsetLength / minSide;
      const spread = masses.length ? Math.min(...masses.map((mass) => Math.hypot(mass.x - x, mass.y - y))) / minSide : 0.5;
      const roadTerm = road.length ? distToPolyline(x, y, road) : Infinity;
      let score = fertility * 1.2 + spread * 0.9 + rng.range(0, 0.4) + (index === 0 ? opposite * 1.4 : opposite * 0.3);
      if (hugRoad && roadTerm < Infinity) score += Math.max(0, 1 - Math.abs(roadTerm - radius * 0.8) / (radius + 2)) * 1.2;
      if (roadTerm < 1.5) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        best = {
          id: `mass_${index}`,
          kind: index === 0 || rng.chance(0.55) ? 'dense_forest' : 'medium_forest',
          x,
          y,
          radius: index === 0 ? radius * 1.15 : radius,
          strength: rng.range(0.75, 1),
        };
      }
    }
    if (best) {
      masses.push(best);
      tactical.push({ kind: 'cover_area', x: best.x, y: best.y, radius: best.radius * 0.8 });
    }
  }

  for (const space of openSpaces) {
    transitions.push({
      id: `edge_${space.id}`,
      kind: 'forest_edge',
      x: space.x,
      y: space.y,
      radius: space.radius + Math.max(2.5, space.radius * 0.8),
      inner: space.radius + 0.6,
      strength: space === focalSpace ? 0.75 : rng.range(0.45, 0.7),
    });
    tactical.push({ kind: 'transition', x: space.x, y: space.y, radius: space.radius + 2.5 });
  }
  if (archetype.composition.focal === 'crossing') tactical.push({ kind: 'crossing', x: focal.anchor.x, y: focal.anchor.y, radius: 2 });
  if (archetype.composition.focal === 'road') tactical.push({ kind: 'chokepoint', x: focal.anchor.x, y: focal.anchor.y, radius: focal.radius });

  return {
    composition: { version: 1, focal: { ...focal.anchor }, openSpaces, masses, transitions, tactical },
    secondary,
  };
}

/**
 * Карта по архетипу. Вызывается из generator.ts для открытых биомов, когда
 * в настройках выбран архетип (иначе работает прежний генератор).
 */
export function generateSceneMap(settings: GenSettings, resolution: ArchetypeResolution): MapData {
  const { archetype } = resolution;
  const { width, height, biome } = settings;

  // 1. Рельеф и вода.
  const land = buildLandscape(
    { width, height, biome, seed: settings.seed, roughness: settings.roughness, waterLevel: settings.waterLevel },
    {
      relief: archetype.relief,
      water: archetype.water,
      course: archetype.course,
      // Эрозия заметна только на крупных картах; на мелких лишь тратит время.
      erosion: width * height >= 1600,
      cliffs: archetype.cliffs,
      wetlands: archetype.wetlands,
    },
  );
  const cells = land.cells;
  const grid: Grid = { width, height, cells };

  // 2–3. Дорога и фокус. Для фокуса «на дороге» тракт нужен раньше фокуса;
  // в остальных случаях ответвление тракта ведёт к уже выбранному фокусу.
  const wantsRoad = archetype.road === 'through' || archetype.road === 'track' || (archetype.road === 'optional' && settings.road);
  const focalRng = new SeededRandom(settings.seed, 0x5ce7e);
  const roadRng = new SeededRandom(settings.seed, 5171);
  let network: RoadNetwork | null = null;
  let roadBridges: Bridge[] = [];
  let centerline: Point[] = [];
  let focal: FocalChoice;
  if (wantsRoad) {
    if (archetype.composition.focal === 'road') {
      const ends = roadEnds(grid, land, new SeededRandom(settings.seed, 0x7a11), null);
      const planned = planRoadNetwork(settings, cells, roadRng, { entry: ends.entry, exit: ends.exit, branch: false });
      network = planned.network;
      roadBridges = planned.bridges;
      centerline = planned.centerline;
      focal = chooseFocal(archetype, grid, land, centerline, focalRng);
    } else {
      focal = chooseFocal(archetype, grid, land, [], focalRng);
      const avoid = archetype.composition.focal === 'crossing' ? null : focal.space;
      const ends = roadEnds(grid, land, new SeededRandom(settings.seed, 0x7a11), avoid);
      // Ответвление подводим к краю фокуса со стороны тракта, а не в центр:
      // середина сцены остаётся свободной для построек.
      const mid = { x: (ends.entry.x + ends.exit.x) / 2, y: (ends.entry.y + ends.exit.y) / 2 };
      const toward = Math.atan2(mid.y - focal.space.y, mid.x - focal.space.x);
      const inland = {
        x: focal.space.x + Math.cos(toward) * (focal.radius + 1),
        y: focal.space.y + Math.sin(toward) * (focal.radius + 1),
      };
      const crossing = archetype.composition.focal === 'crossing' && focal.anchor !== focal.space;
      const planned = planRoadNetwork(settings, cells, roadRng, {
        entry: ends.entry,
        exit: ends.exit,
        waypoints: crossing ? [focal.anchor] : [],
        inland,
        branch: !crossing && distToPolylineEnds(ends, focal.space) > focal.radius + 3,
      });
      network = planned.network;
      roadBridges = planned.bridges;
      centerline = planned.centerline;
    }
    if (archetype.road === 'track') {
      // Заросшая колея: полотно — утоптанная земля, мосты остаются.
      for (const path of network.paths) {
        for (const point of path.points) {
          const cell = cells[point.y]?.[point.x];
          if (cell && cell.terrain === 'road') cell.terrain = 'dirt';
        }
      }
    }
  } else {
    focal = chooseFocal(archetype, grid, land, [], focalRng);
  }

  // 4. Композиция.
  const { composition, secondary } = composeScene(archetype, grid, land, focal, centerline, new SeededRandom(settings.seed, 0xc0b0));

  // 5. Сюжетные постройки.
  const roadPoint = centerline.length ? nearestOnPolyline(centerline, focal.space.x, focal.space.y) : null;
  const approach = roadPoint && Math.hypot(roadPoint.x - focal.space.x, roadPoint.y - focal.space.y) > 0.5
    ? Math.atan2(roadPoint.y - focal.space.y, roadPoint.x - focal.space.x)
    : edgeApproach(width, height, focal.space.x, focal.space.y);
  const site = (space: { x: number; y: number; radius: number }): FeatureSite => ({ x: space.x, y: space.y, radius: space.radius });
  const features = placeSceneFeatures(archetype.features, {
    width,
    height,
    biome,
    cells,
    rng: new SeededRandom(settings.seed, 0xfea7),
    focal: site({ x: focal.space.x, y: focal.space.y, radius: focal.radius }),
    secondary: secondary.map(site),
    approach,
    road: centerline,
    bridges: roadBridges,
  });
  // Деревья построек (гигантское дерево, сухостой) стоят внутри пространств:
  // такие пространства — ориентиры, а не арена, и починка их не вычищает.
  for (const space of composition.openSpaces) {
    const holdsTree = features.trees.some((tree) => Math.hypot(tree.x - space.x, tree.y - space.y) <= space.radius * 0.75);
    if (holdsTree && (space.kind === 'battle_area' || space.kind === 'clearing')) space.kind = 'landmark';
  }
  const reserved = [
    ...features.footprints,
    ...features.trees.map((tree) => ({ x: Math.floor(tree.x - tree.r), y: Math.floor(tree.y - tree.r), w: Math.ceil(tree.r * 2) + 1, h: Math.ceil(tree.r * 2) + 1 })),
  ];

  // 6. Растительность по композиции и плодородию.
  const riverLine = land.mainRiver?.points ?? [];
  const vegetation = generateStructuredVegetation(settings, cells, riverLine, centerline, [], {
    composition,
    canopy: archetype.vegetation.canopy,
    undergrowth: archetype.vegetation.undergrowth,
    rocks: archetype.vegetation.rocks,
    fertility: land.fertility,
    arenaRing: archetype.category === 'natural' && features.trees.length === 0,
    reserved,
    // Тропы к случайным POI рисовали прямые полосы к краю карты; у сцены
    // путь к месту действия уже проложен ответвлением тракта.
    trails: false,
  });

  const report: ArchetypeReport = {
    generator: SCENE_GENERATOR_VERSION,
    id: archetype.id,
    label: archetype.label,
    requested: resolution.requested?.id,
    chain: resolution.chain,
    focal: { x: focal.anchor.x, y: focal.anchor.y },
    focalRadius: focal.radius,
    secondary: secondary.length,
    masses: composition.masses.length,
    features: features.notes,
    landscape: {
      waterShare: land.report.waterShare,
      rockShare: land.report.rockShare,
      lakes: land.report.lakes,
      rivers: land.report.rivers,
      basins: land.report.basins,
      checks: land.report.checks.map((check) => ({ id: check.id, label: check.label, ok: check.ok, fixed: check.fixed })),
    },
  };

  return {
    width,
    height,
    biome,
    cells,
    trees: [...vegetation.trees, ...features.trees],
    rocks: vegetation.rocks,
    structures: features.structures,
    ...(features.buildings.length ? { buildings: features.buildings } : {}),
    ...(features.civic.length ? { civic: features.civic } : {}),
    ...(features.crypt.length ? { crypt: features.crypt } : {}),
    chests: features.chests,
    river: riverLine.map((point) => ({ x: point.x, y: point.y })),
    road: centerline,
    plan: {
      ...vegetation.plan,
      roads: [...(network?.paths ?? []), ...(vegetation.plan.roads ?? [])],
      roadGraph: network?.graph ?? [],
      bridges: features.bridges,
      river: riverLine,
      riverWidth: land.mainRiver?.width ?? 1,
      archetype: report,
      actions: [...(vegetation.plan.actions ?? []), ...land.report.actions],
    },
  };
}

/** Расстояние от точки до отрезка «вход — выход» тракта. */
function distToPolylineEnds(ends: { entry: Point; exit: Point }, point: Point): number {
  return distToPolyline(point.x, point.y, [ends.entry, ends.exit]);
}
