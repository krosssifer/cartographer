import { CIVIC_KIT } from '../../settlementKit';
import type { CityCondition, CivicKind, Terrain } from '../../types';
import type { DistrictKind } from '../settlementTypes';
import type { CourtyardKind, UrbanZone } from './types';

export type { CityCondition };

/** Материалы, которыми Urban Dressing имеет право «застилать» дворы и пустыри. */
export type DressingGround = Extract<Terrain, 'grass' | 'darkGrass' | 'dirt' | 'sand' | 'plaza' | 'floor'>;

export type DressingCategory =
  | 'cargo'
  | 'workshop'
  | 'inn'
  | 'market'
  | 'residential'
  | 'temple'
  | 'farm'
  | 'traffic'
  | 'green'
  | 'litter'
  | 'signs';

/**
 * Визуальный профиль района. Определяет, чем застилаются дворы, сколько
 * предметов район получает и какие категории декора в нём уместны.
 */
export interface UrbanVisualProfile {
  /** Основной материал дворов и пустырей района. */
  ground: DressingGround;
  /** Материал тротуара вдоль главных улиц (null — тротуара нет). */
  sidewalk: DressingGround | null;
  /** Общая «плотность жизни» 0..1. */
  density: number;
  /** Сколько растительности во дворах 0..1. */
  vegetation: number;
  /** Сколько предметов на единицу площади 0..1. */
  objectDensity: number;
  wealth: number;
  /** 0..1: чем выше, тем меньше мусора и «лежачих» объектов. */
  cleanliness: number;
  categories: readonly DressingCategory[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const DISTRICT_DRESSING: Record<DistrictKind, UrbanVisualProfile> = {
  centre: {
    ground: 'plaza', sidewalk: 'plaza', density: 0.92, vegetation: 0.25, objectDensity: 0.7,
    wealth: 0.8, cleanliness: 0.85, categories: ['market', 'traffic', 'signs', 'green'],
  },
  market: {
    ground: 'dirt', sidewalk: 'plaza', density: 0.96, vegetation: 0.15, objectDensity: 0.95,
    wealth: 0.55, cleanliness: 0.4, categories: ['market', 'cargo', 'traffic', 'signs', 'litter'],
  },
  residential: {
    ground: 'dirt', sidewalk: null, density: 0.62, vegetation: 0.45, objectDensity: 0.5,
    wealth: 0.45, cleanliness: 0.55, categories: ['residential', 'green', 'traffic', 'litter'],
  },
  craft: {
    ground: 'dirt', sidewalk: 'sand', density: 0.74, vegetation: 0.2, objectDensity: 0.8,
    wealth: 0.4, cleanliness: 0.3, categories: ['workshop', 'cargo', 'traffic', 'litter'],
  },
  temple: {
    ground: 'plaza', sidewalk: 'floor', density: 0.7, vegetation: 0.5, objectDensity: 0.45,
    wealth: 0.7, cleanliness: 0.85, categories: ['temple', 'green', 'signs'],
  },
  noble: {
    ground: 'floor', sidewalk: 'floor', density: 0.48, vegetation: 0.7, objectDensity: 0.4,
    wealth: 0.9, cleanliness: 0.9, categories: ['green', 'residential', 'signs', 'traffic'],
  },
  docks: {
    ground: 'sand', sidewalk: 'dirt', density: 0.76, vegetation: 0.1, objectDensity: 0.85,
    wealth: 0.35, cleanliness: 0.28, categories: ['cargo', 'traffic', 'market', 'litter'],
  },
  garrison: {
    ground: 'dirt', sidewalk: 'sand', density: 0.66, vegetation: 0.15, objectDensity: 0.5,
    wealth: 0.5, cleanliness: 0.65, categories: ['traffic', 'workshop', 'signs'],
  },
  farms: {
    ground: 'dirt', sidewalk: null, density: 0.4, vegetation: 0.65, objectDensity: 0.35,
    wealth: 0.3, cleanliness: 0.45, categories: ['farm', 'green', 'traffic'],
  },
  poor: {
    ground: 'dirt', sidewalk: null, density: 0.84, vegetation: 0.28, objectDensity: 0.55,
    wealth: 0.16, cleanliness: 0.2, categories: ['litter', 'residential', 'traffic', 'cargo'],
  },
};

/** Профиль района с учётом фактического богатства, зоны и масштаба города. */
export function districtProfile(
  kind: DistrictKind,
  wealth: number,
  zone: UrbanZone,
  town: boolean,
): UrbanVisualProfile {
  const base = DISTRICT_DRESSING[kind] ?? DISTRICT_DRESSING.residential;
  const wealthMix = clamp01(wealth * 0.55 + base.wealth * 0.45);
  const paved = wealthMix > 0.72 && (kind === 'centre' || kind === 'temple' || kind === 'noble');
  let ground: DressingGround = base.ground;
  if (paved) ground = 'plaza';
  // Пригороды и окраины «зеленеют», историческое ядро — наоборот, плотнее.
  if (zone === 'suburbs' || zone === 'outer_city') {
    ground = kind === 'noble' || kind === 'temple' ? 'floor' : wealthMix > 0.6 ? 'dirt' : 'grass';
  }
  if (zone === 'wilderness') ground = 'grass';
  return {
    ...base,
    ground,
    density: clamp01(base.density * (town ? 1 : 0.92)),
    vegetation: clamp01(base.vegetation + (zone === 'suburbs' ? 0.22 : zone === 'outer_city' ? 0.12 : 0)),
    objectDensity: clamp01(base.objectDensity * (0.7 + wealthMix * 0.45)),
    wealth: wealthMix,
    cleanliness: clamp01(base.cleanliness * 0.65 + wealthMix * 0.45),
  };
}

/** Множители от состояния города. */
export function conditionFactors(condition: CityCondition): { objects: number; litter: number; weeds: number } {
  if (condition === 'pristine') return { objects: 0.85, litter: 0.15, weeds: 0.55 };
  if (condition === 'worn') return { objects: 1.05, litter: 1.8, weeds: 1.7 };
  return { objects: 1, litter: 1, weeds: 1 };
}

/** Материал двора по его типу и профилю района. */
export function courtyardGround(kind: CourtyardKind, profile: UrbanVisualProfile, roll: number): DressingGround {
  // Мощение дворов — плиты (`floor`), а не `plaza`: площадь/тротуары остаются
  // частью уличной сети и не должны дробиться декором.
  const paved: DressingGround = 'floor';
  switch (kind) {
    case 'temple_courtyard':
      return profile.wealth > 0.6 ? paved : 'dirt';
    case 'garden_yard':
    case 'private_garden':
      return 'grass';
    case 'workshop_yard':
      return profile.ground === 'sand' ? 'sand' : 'dirt';
    case 'inn_yard':
      return profile.wealth > 0.65 ? paved : 'dirt';
    case 'trade_courtyard':
      return profile.wealth > 0.5 || roll > 0.55 ? paved : 'dirt';
    case 'enclosed_courtyard':
    default:
      return profile.ground === 'plaza' ? paved : profile.ground;
  }
}

export interface DressingProp {
  kind: CivicKind;
  w: number;
  h: number;
  weight: number;
}

const prop = (kind: CivicKind, weight = 1): DressingProp => ({
  kind,
  w: CIVIC_KIT[kind].w,
  h: CIVIC_KIT[kind].h,
  weight,
});

/** Что уместно во дворе каждого типа: крупное → среднее → мелкое. */
export const YARD_RECIPES: Record<CourtyardKind, readonly DressingProp[]> = {
  enclosed_courtyard: [
    prop('marketBarrels', 3), prop('marketCrates', 3), prop('marketBench', 2),
    prop('marketTable', 1), prop('marketBaskets', 2), prop('marketSacks', 2),
    prop('urbanWoodpile', 2), prop('urbanTrough', 1), prop('urbanPots', 1),
  ],
  garden_yard: [
    prop('garden', 3), prop('marketBench', 2), prop('marketBaskets', 2),
    prop('marketWheelbarrow', 1), prop('marketBarrelLying', 1),
  ],
  private_garden: [
    prop('garden', 3), prop('marketBench', 3), prop('marketTableSet', 1),
    prop('marketBaskets', 1), prop('marketBarrelPair', 1),
  ],
  workshop_yard: [
    prop('marketCrates', 3), prop('marketBarrels', 3), prop('cart', 1),
    prop('marketWheelbarrow', 2), prop('marketRope', 2), prop('marketSacks', 1),
    prop('urbanAnvil', 3), prop('urbanWorkbench', 2), prop('urbanCoal', 2),
    prop('urbanWoodpile', 2), prop('urbanPlanks', 2), prop('urbanPots', 1),
  ],
  inn_yard: [
    prop('marketTableSet', 3), prop('marketBench', 2), prop('marketBarrels', 2),
    prop('marketHay', 2), prop('marketCrates', 1),
  ],
  trade_courtyard: [
    prop('marketWagon', 2), prop('marketCrates', 3), prop('marketBarrels', 3),
    prop('marketSacks', 2), prop('marketBaskets', 2), prop('marketBench', 1),
    prop('urbanPlanks', 2), prop('urbanPots', 2), prop('urbanHides', 2),
    prop('urbanSign', 1), prop('urbanTrough', 1),
  ],
  temple_courtyard: [
    prop('marketBench', 3), prop('garden', 1), prop('marketBaskets', 1),
  ],
};

/** Уличная мебель, допустимая в районе (ставится у кромки улиц и на площадях). */
export const STREET_RECIPES: Record<DistrictKind, readonly DressingProp[]> = {
  centre: [prop('marketBench', 3), prop('marketNoticeBoard', 2), prop('marketTableSet', 1), prop('marketWell', 1), prop('urbanLamp', 5), prop('urbanSign', 2), prop('urbanSignpost', 2)],
  market: [prop('marketBarrels', 3), prop('marketCrates', 3), prop('marketBench', 2), prop('marketNoticeBoard', 1), prop('urbanLamp', 4), prop('urbanSign', 3), prop('urbanTrough', 2), prop('urbanPots', 2)],
  residential: [prop('marketBench', 2), prop('marketWell', 1), prop('marketBaskets', 2), prop('marketBarrels', 1), prop('urbanLamp', 3), prop('urbanSignpost', 1), prop('urbanTrough', 1), prop('urbanWoodpile', 2)],
  craft: [prop('marketCrates', 3), prop('marketBarrels', 3), prop('marketRope', 2), prop('marketWheelbarrow', 1), prop('urbanAnvil', 3), prop('urbanWoodpile', 3), prop('urbanPlanks', 2), prop('urbanCoal', 2), prop('urbanForge', 2)],
  temple: [prop('marketBench', 3), prop('garden', 1), prop('marketNoticeBoard', 1)],
  noble: [prop('marketBench', 2), prop('garden', 2), prop('marketTableSet', 1), prop('urbanLamp', 4), prop('urbanPots', 1)],
  docks: [prop('marketBarrels', 3), prop('marketCrates', 3), prop('marketRope', 3), prop('marketSacks', 2), prop('cart', 1), prop('urbanPlanks', 3), prop('urbanHides', 2), prop('urbanTrough', 1), prop('urbanLamp', 2)],
  garrison: [prop('marketCrates', 2), prop('marketBarrels', 2), prop('cart', 1), prop('urbanLamp', 2), prop('urbanTrough', 1)],
  farms: [prop('marketHay', 3), prop('marketHayLarge', 1), prop('marketCrates', 2), prop('marketWheelbarrow', 1)],
  poor: [prop('marketBarrelLying', 3), prop('marketCrates', 2), prop('marketBaskets', 2), prop('marketSacks', 2), prop('urbanWoodpile', 3), prop('urbanPots', 2)],
};

/** Мелкий мусор и «следы жизни» для грязных/изношенных районов. */
export const LITTER_PROPS: readonly DressingProp[] = [
  prop('marketBarrelLying', 3), prop('marketBaskets', 2), prop('marketSacks', 2), prop('marketCrates', 1),
];

export function pickWeightedProp(list: readonly DressingProp[], roll: number): DressingProp {
  if (!list.length) return prop('marketCrates');
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let cursor = roll * total;
  for (const item of list) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return list[list.length - 1];
}

/** Сколько предметов двор получает от Urban Dressing (в дополнение к базовому декору). */
export function yardPropCount(
  profile: UrbanVisualProfile,
  condition: CityCondition,
  globalDensity: number,
  roll: number,
): number {
  const factors = conditionFactors(condition);
  const base = 1.15 + profile.objectDensity * 2.3;
  const scaled = base * clamp01(globalDensity) * factors.objects;
  const whole = Math.floor(scaled);
  return whole + (roll < scaled - whole ? 1 : 0);
}

/** Бюджет уличной мебели на район. */
export function streetBudget(
  areaCells: number,
  profile: UrbanVisualProfile,
  condition: CityCondition,
  globalDensity: number,
): number {
  const factors = conditionFactors(condition);
  return Math.max(0, Math.min(24, Math.round((areaCells / 48) * profile.objectDensity * clamp01(globalDensity) * factors.objects)));
}

/** Сколько мусора добавляет район (0 — чистый). */
export function litterBudget(
  areaCells: number,
  profile: UrbanVisualProfile,
  condition: CityCondition,
  globalDensity: number,
): number {
  const factors = conditionFactors(condition);
  const dirt = 1 - profile.cleanliness;
  return Math.max(0, Math.min(16, Math.round((areaCells / 96) * dirt * clamp01(globalDensity) * factors.litter)));
}

/** Допустим ли материал как «подстилка» двора (не рушим дороги, воду и кладку). */
/**
 * Клетки непосредственно перед дверями зданий. Городской декор не имеет права
 * их занимать: иначе выход из дома блокируется, и карта перестаёт быть играбельной.
 */
export function doorStepCells(
  buildings: readonly { door: { x: number; y: number }; facing?: number }[],
  width: number,
  height: number,
): Set<number> {
  const cells = new Set<number>();
  for (const building of buildings) {
    const step = building.facing === 90
      ? [-1, 0]
      : building.facing === 180
        ? [0, -1]
        : building.facing === 270
          ? [1, 0]
          : [0, 1];
    const x = building.door.x + step[0];
    const y = building.door.y + step[1];
    if (x >= 0 && y >= 0 && x < width && y < height) cells.add(y * width + x);
  }
  return cells;
}

/** Перекрывает ли предмет хотя бы одну из защищённых клеток. */
export function coversCell(
  item: { x: number; y: number; w: number; h: number },
  cells: ReadonlySet<number>,
  width: number,
): boolean {
  if (cells.size === 0) return false;
  for (let y = item.y; y < item.y + item.h; y += 1) {
    for (let x = item.x; x < item.x + item.w; x += 1) {
      if (cells.has(y * width + x)) return true;
    }
  }
  return false;
}

export function isDressableGround(terrain: Terrain): boolean {
  return terrain === 'grass' || terrain === 'darkGrass' || terrain === 'dirt' || terrain === 'sand';
}
