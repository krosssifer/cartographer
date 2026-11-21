// Сцена карты (ScenePlan): MACRO-решения до генерации террейна.
//
// Идея патча: карта должна быть сценой, а не набором независимых слоёв.
// Поэтому ещё до высоты/влажности мы решаем:
//   • какой это архетип сцены (переправа, поляна, руины, лагерь, поворот реки);
//   • будет ли река и какой она ширины (целевое покрытие 8–22 %);
//   • будет ли дорога и откуда куда она идёт;
//   • где именно пересекаются дорога и река (crossing-first);
//   • где главное открытое пространство боя и вспомогательные поляны;
//   • где плотные массивы леса;
//   • бюджет крупных композиционных элементов.
//
// Всё решается на seeded RNG — детерминизм сохраняется.

import type { Biome, Point } from '../types';
import { SeededRandom } from './random';

export type SceneArchetype =
  | 'crossing_scene'
  | 'forest_clearing'
  | 'ruins_approach'
  | 'camp_scene'
  | 'river_bend'
  | 'plain_route';

/** Уровень важности элемента: декор не конкурирует с главным местом сцены. */
export type Importance = 'primary' | 'secondary' | 'tertiary' | 'decorative';

/** Бюджет композиции: после исчерпания новые крупные группы не создаются. */
export interface CompositionBudget {
  primary: number;
  secondary: number;
  large: number;
  medium: number;
  micro: number;
}

export const DEFAULT_BUDGET: CompositionBudget = {
  primary: 1,
  secondary: 2,
  large: 4,
  medium: 8,
  micro: 15,
};

export interface SceneRiver {
  /** Осевая линия русла в клетках: от одного края карты до соседнего. */
  path: Point[];
  /** Ширина русла в клетках (полоса 2*width-1). */
  width: number;
  /** Точка переправы — середина русла, туда ведёт дорога. */
  crossing: Point;
  /** Целевая доля площади под водой (обычно 8–22 %). */
  coverageTarget: [number, number];
}
export interface SceneRoad {
  entry: Point;
  exit: Point;
  /** Промежуточные точки, через которые обязан пройти тракт. */
  via: Point[];
}

export interface SceneOpenSpace {
  kind: 'battle' | 'clearing' | 'camp' | 'yard';
  x: number;
  y: number;
  radius: number;
  importance: Importance;
}

export interface SceneDenseSpace {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export interface ScenePlan {
  version: 1;
  archetype: SceneArchetype;
  river?: SceneRiver;
  road?: SceneRoad;
  crossing?: Point;
  openSpaces: SceneOpenSpace[];
  denseSpaces: SceneDenseSpace[];
  importance: Record<string, Importance>;
  budget: CompositionBudget;
}

export interface SceneInput {
  width: number;
  height: number;
  biome: Biome;
  river: boolean;
  road: boolean;
  structures: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const round = (value: number): number => Math.round(value);

/** Биомы, где река уместна по умолчанию. */
function riverAllowed(biome: Biome): boolean {
  return biome === 'forest' || biome === 'plains' || biome === 'swamp' || biome === 'desert' || biome === 'snow';
}

/** Вероятность реки для биома: болото и лес — чаще, пустыня/снег — реже. */
function riverChance(biome: Biome): number {
  switch (biome) {
    case 'swamp':
      return 0.85;
    case 'forest':
      return 0.72;
    case 'plains':
      return 0.55;
    case 'desert':
      return 0.34;
    case 'snow':
      return 0.42;
    default:
      return 0;
  }
}

/**
 * Строит сцену. Порядоk соответствует требованию патча:
 * archetype → river/crossing → road → open/dense spaces → budget.
 */
export function planScene(input: SceneInput, rng: SeededRandom): ScenePlan {
  const { width: w, height: h, biome } = input;
  const minSide = Math.min(w, h);
  const budget: CompositionBudget = { ...DEFAULT_BUDGET };
  const importance: Record<string, Importance> = {};

  // 1. Река: только если включена, биом подходящий и сцена этого хочет.
  const wantRiver = input.river && riverAllowed(biome) && rng.chance(riverChance(biome));

  // 2. Точка переправы выбирается ДО реки и дороги: переправа — центр сцены.
  const crossing: Point = {
    x: round(w * rng.range(0.36, 0.64)),
    y: round(h * rng.range(0.36, 0.64)),
  };

  let riverIsHorizontal = false;
  let river: SceneRiver | undefined;
  if (wantRiver) {
    // Река не делит карту пополам: она входит с одного края и уходит через
    // соседний, изгибаясь. Длина русла растёт, поэтому покрытие остаётся
    // в целевых 8–22 %, а меандр читается.
    // Только противоположные края: русло делит карту на два берега, поэтому
    // тракт обязан пересечь воду — иначе переправа (главная сцена) не нужна.
    const flows: [string, string][] = [
      ['left', 'right'],
      ['top', 'bottom'],
    ];
    const [fromEdge, toEdge] = flows[rng.int(0, flows.length - 1)];
    riverIsHorizontal = fromEdge === 'left' || fromEdge === 'right';
    const onEdge = (edge: string, t: number): Point => {
      const tt = Math.min(0.9, Math.max(0.1, t));
      switch (edge) {
        case 'left':
          return { x: 0, y: round((h - 1) * tt) };
        case 'right':
          return { x: w - 1, y: round((h - 1) * tt) };
        case 'top':
          return { x: round((w - 1) * tt), y: 0 };
        default:
          return { x: round((w - 1) * tt), y: h - 1 };
      }
    };
    const startPoint = onEdge(fromEdge, rng.range(0.2, 0.8));
    const endPoint = onEdge(toEdge, rng.range(0.2, 0.8));
    const bendAmount = minSide * rng.range(0.08, 0.18);
    const sign = rng.chance(0.5) ? 1 : -1;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const controlA: Point = {
      x: startPoint.x + dx * 0.33 + normalX * bendAmount * sign,
      y: startPoint.y + dy * 0.33 + normalY * bendAmount * sign,
    };
    const controlB: Point = {
      x: startPoint.x + dx * 0.66 - normalX * bendAmount * sign * 0.7,
      y: startPoint.y + dy * 0.66 - normalY * bendAmount * sign * 0.7,
    };
    const sampleCount = Math.max(16, round(length * 1.6));
    const path: Point[] = [];
    for (let step = 0; step <= sampleCount; step += 1) {
      const t = step / sampleCount;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      path.push({
        x: round(a * startPoint.x + b * controlA.x + c * controlB.x + d * endPoint.x),
        y: round(a * startPoint.y + b * controlA.y + c * controlB.y + d * endPoint.y),
      });
    }
    const unique: Point[] = [];
    for (const point of path) {
      const last = unique[unique.length - 1];
      if (last && last.x === point.x && last.y === point.y) continue;
      unique.push(point);
    }
    const target = rng.range(0.08, 0.14);
    const area = w * h;
    const bandCells = Math.max(3, round((target * area) / Math.max(1, unique.length)));
    const width = Math.max(1, Math.min(3, round(bandCells / 2)));
    const mid = unique[Math.floor(unique.length / 2)];
    crossing.x = mid.x;
    crossing.y = mid.y;
    river = {
      path: unique,
      width,
      crossing,
      coverageTarget: [0.08, 0.22],
    };
  }

  // 3. Дорога: она должна иметь назначение. Если есть переправа — дорога идёт
  //    ровно через неё; иначе ведёт от края к краю через середину карты.
  let road: SceneRoad | undefined;
  if (input.road) {
    if (river) {
      // Дорога идёт с берега на берег и обязана пройти через переправу.
      const horizontalRiver = riverIsHorizontal;
      // Подходы к мосту не строго вертикальны: тракт слегка изгибается,
      // иначе карта выглядит нарисованной по линейке.
      const approach = Math.max(2, round(minSide * rng.range(0.12, 0.2)));
      const driftSign = rng.chance(0.5) ? 1 : -1;
      const drift = approach * driftSign;
      const entry: Point = horizontalRiver
        ? { x: clamp(crossing.x + drift, 2, w - 3), y: 0 }
        : { x: 0, y: clamp(crossing.y + drift, 2, h - 3) };
      const exit: Point = horizontalRiver
        ? { x: clamp(crossing.x - drift, 2, w - 3), y: h - 1 }
        : { x: w - 1, y: clamp(crossing.y - drift, 2, h - 3) };
      const via: Point[] = [{ x: crossing.x, y: crossing.y }];
      road = { entry, exit, via };
    } else {
      const fromY = round(h * rng.range(0.3, 0.7));
      const toY = round(h * rng.range(0.3, 0.7));
      road = { entry: { x: 1, y: fromY }, exit: { x: w - 2, y: toY }, via: [] };
    }
  }

  // 4. Главное открытое пространство: рядом с переправой, но не на дороге.
  const battleRadius = clamp(round(minSide * 0.13), 3, 6);
  const battleOffset = river ? river.width + battleRadius + 1.5 : battleRadius + 2;
  const battleDrift = river ? Math.round(minSide * 0.12) : 0;
  // Арена ставится ПОПЕРЁК русла: для горизонтальной реки — выше/ниже неё,
  // для вертикальной — слева/справа. Иначе поляна оказывается на воде.
  const battleSide = rng.chance(0.5) ? 1 : -1;
  const battleX = river
    ? (riverIsHorizontal
        ? crossing.x + battleDrift
        : crossing.x + battleSide * battleOffset)
    : round(w * rng.range(0.35, 0.65));
  const battleY = river
    ? (riverIsHorizontal
        ? crossing.y + battleSide * battleOffset
        : crossing.y + battleDrift)
    : round(h * rng.range(0.35, 0.65));
  const battle: SceneOpenSpace = {
    kind: 'battle',
    x: clamp(battleX, battleRadius + 1, w - battleRadius - 2),
    y: clamp(battleY, battleRadius + 1, h - battleRadius - 2),
    radius: battleRadius,
    importance: 'primary',
  };
  const openSpaces: SceneOpenSpace[] = [battle];
  importance['crossing'] = river && road ? 'primary' : river ? 'secondary' : 'tertiary';
  importance['battle'] = 'primary';

  // 5. Вспомогательная поляна в стороне от главной (вторичный композиционный центр).
  if (rng.chance(0.7)) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = minSide * rng.range(0.22, 0.34);
    const clearingRadius = clamp(round(minSide * 0.09), 2.5, 4.5);
    openSpaces.push({
      kind: 'clearing',
      x: clamp(round(battle.x + Math.cos(angle) * distance), clearingRadius + 1, w - clearingRadius - 2),
      y: clamp(round(battle.y + Math.sin(angle) * distance), clearingRadius + 1, h - clearingRadius - 2),
      radius: clearingRadius,
      importance: 'secondary',
    });
    budget.secondary = Math.max(1, budget.secondary - 1);
  }

  // 6. Лагерь у дороги — третичный POI, только если есть дорога и место.
  if (road && input.structures > 0 && rng.chance(0.55)) {
    const campRadius = clamp(round(minSide * 0.07), 2, 3.5);
    openSpaces.push({
      kind: 'camp',
      x: clamp(road.entry.x + round((road.exit.x - road.entry.x) * rng.range(0.25, 0.45)) + campRadius + 1, campRadius + 1, w - campRadius - 2),
      y: clamp(road.entry.y + round((road.exit.y - road.entry.y) * rng.range(0.25, 0.45)) + campRadius + 1, campRadius + 1, h - campRadius - 2),
      radius: campRadius,
      importance: 'tertiary',
    });
  }

  // 7. Плотные массивы леса: крупные области, а не равномерная засыпка.
  const denseSpaces: SceneDenseSpace[] = [];
  const denseCount = biome === 'forest' ? 3 : biome === 'swamp' ? 2 : 2;
  for (let index = 0; index < denseCount; index += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = minSide * rng.range(0.18, 0.4);
    denseSpaces.push({
      x: clamp(round(battle.x + Math.cos(angle) * distance), 2, w - 3),
      y: clamp(round(battle.y + Math.sin(angle) * distance), 2, h - 3),
      radius: minSide * rng.range(0.14, 0.26),
      strength: rng.range(0.55, 0.95),
    });
  }

  // 8. Архетип сцены — для отчёта и будущих правил композиции.
  let archetype: SceneArchetype;
  if (river && road) archetype = 'crossing_scene';
  else if (river) archetype = 'river_bend';
  else if (input.structures > 0) archetype = 'ruins_approach';
  else archetype = biome === 'plains' ? 'plain_route' : 'forest_clearing';

  // Ограничители: открытые пространства не должны налезать друг на друга.
  for (let index = 1; index < openSpaces.length; index += 1) {
    const space = openSpaces[index];
    for (let other = 0; other < index; other += 1) {
      const prev = openSpaces[other];
      const distance = Math.hypot(space.x - prev.x, space.y - prev.y);
      const need = space.radius + prev.radius + 1.2;
      if (distance < need) {
        const angle = Math.atan2(space.y - prev.y, space.x - prev.x) || 0.7;
        space.x = clamp(round(prev.x + Math.cos(angle) * need), space.radius + 1, w - space.radius - 2);
        space.y = clamp(round(prev.y + Math.sin(angle) * need), space.radius + 1, h - space.radius - 2);
      }
    }
  }

  return {
    version: 1,
    archetype,
    river,
    road,
    crossing: river ? crossing : undefined,
    openSpaces,
    denseSpaces,
    importance,
    budget,
  };
}

/** Короткое человекочитаемое описание сцены — для отчёта генерации и UI. */
export function sceneSummary(scene: ScenePlan): string {
  const parts: string[] = [scene.archetype];
  if (scene.river) parts.push(`река шириной ${scene.river.width} (${scene.river.path.length} узлов)`);
  if (scene.crossing) parts.push(`переправа ${scene.crossing.x}:${scene.crossing.y}`);
  parts.push(`пространств ${scene.openSpaces.length}`);
  parts.push(`массивов леса ${scene.denseSpaces.length}`);
  return parts.join(' · ');
}
