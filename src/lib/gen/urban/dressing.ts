import { CIVIC_KIT } from '../../settlementKit';
import type {
  Building,
  BuildingAttachment,
  ChestRotation,
  CityCondition,
  CivicKind,
  Terrain,
} from '../../types';
import type { DistrictKind, UrbanCharacterId } from '../settlementTypes';
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
    prop('marketBarrels', 2), prop('marketCrates', 2), prop('marketBench', 2),
    prop('yardLaundryLine', 3), prop('yardWashTub', 2), prop('yardWashboard', 1),
    prop('yardWaterPail', 3), prop('yardFirewoodRack', 2), prop('yardChoppingBlock', 2),
    prop('yardOutdoorCookstove', 1), prop('yardBroomRake', 1), prop('yardDoghouse', 1),
    prop('urbanHandPump', 2), prop('urbanBucketStand', 1), prop('urbanWoodpile', 2),
    prop('urbanTrough', 1), prop('urbanPots', 1),
  ],
  garden_yard: [
    prop('garden', 2), prop('yardVegetableBed', 3), prop('yardHerbBed', 3),
    prop('yardBeehive', 2), prop('yardChickenCoop', 2), prop('yardFeedTrough', 1),
    prop('yardCompostBin', 1), prop('yardWaterPail', 2), prop('yardFlowerPots', 2),
    prop('yardBroomRake', 1), prop('greenVegetableHerbBox', 2),
    prop('marketBench', 2), prop('marketWheelbarrow', 1),
  ],
  private_garden: [
    prop('garden', 2), prop('greenStonePlanterRound', 3), prop('greenStonePlanterRect', 2),
    prop('greenTopiaryCone', 2), prop('greenTopiaryBall', 2), prop('greenRoseTrellis', 2),
    prop('greenGrapeTrellis', 2), prop('greenFlowerBed', 2), prop('greenOrnamentalShrubPot', 2),
    prop('greenSmallGardenStatue', 2), prop('greenFlowerUrn', 2),
    prop('marketBench', 3), prop('marketTableSet', 1),
  ],
  workshop_yard: [
    prop('marketCrates', 2), prop('marketBarrels', 2), prop('marketWheelbarrow', 2),
    prop('urbanAnvil', 3), prop('urbanWorkbench', 2), prop('urbanForge', 2),
    prop('urbanBellows', 2), prop('urbanGrindingWheel', 2), prop('urbanToolRack', 2),
    prop('urbanSawhorse', 2), prop('urbanPotteryWheel', 2), prop('urbanPotteryKiln', 1),
    prop('urbanPots', 2), prop('urbanDyeVat', 2), prop('urbanLoom', 1),
    prop('urbanCoal', 2), prop('urbanWoodpile', 2), prop('urbanPlanks', 2),
  ],
  inn_yard: [
    prop('marketTableSet', 3), prop('marketBench', 2), prop('marketBarrels', 2),
    prop('urbanHitchingRail', 3), prop('urbanHitchingPost', 2),
    prop('urbanTrough', 2), prop('yardWaterPail', 2), prop('lampBrazierRound', 2),
    prop('lampOilLantern', 1), prop('marketHay', 2),
  ],
  trade_courtyard: [
    prop('marketWagon', 2), prop('marketCrates', 3), prop('marketBarrels', 2),
    prop('marketFabricBolts', 2), prop('marketSpiceBowls', 2), prop('marketCheeseWheels', 2),
    prop('marketHoneyJars', 2), prop('marketScale', 2), prop('marketCoins', 1),
    prop('urbanPlanks', 2), prop('urbanPots', 2), prop('urbanHides', 2),
    prop('urbanHitchingPost', 2), prop('urbanTrough', 1),
  ],
  temple_courtyard: [
    prop('marketBench', 3), prop('greenStonePlanterRound', 3), prop('greenPottedCypress', 3),
    prop('greenFlowerUrn', 2), prop('greenSmallGardenStatue', 2), prop('lampStreetStone', 3),
    prop('lampCandleLantern', 2), prop('urbanWaterBasin', 2), prop('urbanStreetShrine', 2),
  ],
};

/** Уличная мебель, допустимая в районе (ставится у кромки улиц и на площадях). */
export const STREET_RECIPES: Record<DistrictKind, readonly DressingProp[]> = {
  centre: [
    prop('marketBench', 3), prop('marketNoticeBoard', 2), prop('lampStreetFancy', 3),
    prop('lampStreetIron', 4), prop('urbanLamp', 2), prop('urbanSignpost', 2),
    prop('greenStonePlanterRound', 2), prop('urbanStonePlanter', 2), prop('urbanStoneBollard', 2),
    prop('urbanManholeCover', 1), prop('urbanWaterBasin', 2), prop('urbanStreetShrine', 1),
  ],
  market: [
    prop('marketBarrels', 2), prop('marketCrates', 2), prop('marketBench', 2),
    prop('marketScale', 2), prop('marketWeights', 1), prop('marketSpiceBowls', 2),
    prop('marketFabricBolts', 2), prop('marketSmokedFishRack', 1), prop('marketMeatHooks', 1),
    prop('marketFlowerBundles', 2), prop('lampStreetIron', 3), prop('urbanLamp', 2),
    prop('urbanSign', 2), prop('urbanHitchingPost', 2), prop('urbanTrough', 2),
    prop('urbanDrainGrate', 1), prop('urbanStreetBroom', 1),
  ],
  residential: [
    prop('marketBench', 2), prop('urbanHandPump', 3), prop('lampStreetWood', 3),
    prop('lampStreetIron', 2), prop('yardFlowerPots', 3), prop('yardWaterPail', 2),
    prop('greenHerbPot', 2), prop('greenFlowerBed', 1), prop('urbanSignpost', 1),
    prop('urbanDrainGrate', 1), prop('urbanWoodpile', 2),
  ],
  craft: [
    prop('marketCrates', 2), prop('marketBarrels', 2), prop('urbanAnvil', 3),
    prop('urbanGrindingWheel', 2), prop('urbanSawhorse', 2), prop('urbanPots', 2),
    prop('urbanDyeVat', 2), prop('urbanBellows', 2), prop('urbanBucketStand', 2),
    prop('urbanWoodpile', 2), prop('urbanPlanks', 2), prop('urbanCoal', 2),
    prop('urbanForge', 2), prop('lampFireBasket', 2),
  ],
  temple: [
    prop('marketBench', 3), prop('lampStreetStone', 3), prop('lampCandleLantern', 2),
    prop('urbanStreetShrine', 3), prop('urbanWaterBasin', 2), prop('greenPottedCypress', 3),
    prop('greenFlowerUrn', 2), prop('greenStonePlanterRound', 2),
  ],
  noble: [
    prop('marketBench', 2), prop('lampStreetFancy', 4), prop('greenTopiaryCone', 3),
    prop('greenTopiaryBall', 3), prop('greenStonePlanterRect', 2), prop('greenFlowerUrn', 3),
    prop('greenPottedCypress', 2), prop('greenHedgeBox', 2), prop('greenOrnamentalShrubPot', 2),
    prop('greenSmallGardenStatue', 2), prop('urbanStoneBollard', 2),
  ],
  docks: [
    prop('marketBarrels', 3), prop('marketCrates', 3), prop('marketRope', 3),
    prop('marketSmokedFishRack', 3), prop('marketSaltMeasure', 2), prop('lampHarborLantern', 4),
    prop('lampSignalBeacon', 1), prop('urbanStoneBollard', 2), prop('urbanPlanks', 2),
    prop('urbanHides', 2), prop('urbanWashTub', 2), prop('urbanTrough', 1),
  ],
  garrison: [
    prop('marketCrates', 2), prop('marketBarrels', 2), prop('lampBrazierSquare', 3),
    prop('lampTorchStand', 3), prop('lampFireBasket', 2), prop('lampSignalBeacon', 1),
    prop('urbanRoadBarrier', 2), prop('urbanHitchingRail', 2), prop('urbanGrindingWheel', 2),
    prop('urbanToolRack', 2), prop('urbanTrough', 2), prop('urbanMilestone', 1),
  ],
  farms: [
    prop('marketHay', 3), prop('marketHayLarge', 1), prop('yardChickenCoop', 3),
    prop('yardFeedTrough', 2), prop('yardBeehive', 2), prop('yardVegetableBed', 2),
    prop('yardChoppingBlock', 2), prop('yardFirewoodRack', 2), prop('urbanHandPump', 2),
    prop('urbanMilestone', 1),
  ],
  poor: [
    prop('marketBarrelLying', 2), prop('yardWashTub', 3), prop('yardLaundryLine', 3),
    prop('yardWaterPail', 2), prop('yardOutdoorCookstove', 1), prop('urbanHandPump', 2),
    prop('urbanWoodpile', 2), prop('lampOilLantern', 2), prop('lampStreetWood', 2),
    prop('urbanStreetBroom', 1), prop('urbanDrainGrate', 1),
  ],
};

/** Мелкий мусор и «следы жизни» для грязных/изношенных районов. */
export const LITTER_PROPS: readonly DressingProp[] = [
  prop('marketBarrelLying', 3), prop('yardWaterPail', 2),
  prop('marketBaskets', 2), prop('marketSacks', 2), prop('yardBroomRake', 1),
  prop('urbanStreetBroom', 1),
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

// ============================================================================
// ФАЗА 9: Развязанная модель износа / возраста / богатства / сохранности
// (Old ≠ Poor, Poor ≠ Ruined, Abandoned ≠ Bustling Slum)
// ============================================================================

export interface UrbanMaterialProfile {
  /** Исторический возраст застройки (0 — новая, 1 — древняя каменная/замшелая). */
  age: number;
  /** Материальный достаток квартала (0 — беднота, 1 — знать/патриции). */
  wealth: number;
  /** Сохранность конструкций (0 — руины/пробоины, 1 — целая кладка). */
  preservation: number;
  /** Населённость и бытовая активность (0 — покинутый, 1 — кипящий жизнью). */
  population: number;
  /** Текущий уход за улицами, фонарями и фасадами (0 — запущено, 1 — вычищено). */
  maintenance: number;
}

export function resolveMaterialProfile(
  condition: CityCondition,
  characterId: UrbanCharacterId | string | undefined,
  districtKind: DistrictKind,
  districtWealth: number,
  zone: UrbanZone,
): UrbanMaterialProfile {
  const baseProfile = DISTRICT_DRESSING[districtKind] ?? DISTRICT_DRESSING.residential;
  const wealth = clamp01(districtWealth * 0.6 + baseProfile.wealth * 0.4);

  // Возраст зависит от зоны (историческое ядро старше окраин) и характера города, А НЕ от бедности!
  let age =
    zone === 'old_core'
      ? 0.82
      : zone === 'inner_city'
        ? 0.62
        : zone === 'outer_city'
          ? 0.40
          : 0.25;
  if (characterId === 'ancient' || characterId === 'religious') age = clamp01(age + 0.22);
  if (characterId === 'frontier') age = clamp01(age - 0.25);
  if (districtKind === 'temple' || districtKind === 'centre' || districtKind === 'noble') {
    age = clamp01(age + 0.12);
  }

  // Населённость максимальна в жилых, рыночных, портовых и бедных кварталах; падает лишь в руинах!
  let population = clamp01(baseProfile.density * 0.85 + (districtKind === 'poor' ? 0.18 : 0));
  let preservation = condition === 'pristine' ? 0.92 : condition === 'worn' ? 0.46 : 0.76;
  let maintenance = clamp01(
    (condition === 'pristine' ? 0.90 : condition === 'worn' ? 0.34 : 0.66) * 0.65 + wealth * 0.42,
  );

  if (characterId === 'ruined' || characterId === 'war_torn') {
    preservation = clamp01(preservation - 0.34);
    population = clamp01(population - 0.48);
    maintenance = clamp01(maintenance - 0.35);
  } else if (characterId === 'prosperous' || characterId === 'noble') {
    preservation = clamp01(preservation + 0.12);
    maintenance = clamp01(maintenance + 0.16);
  }

  // Древний богатый/храмовый квартал (Old ≠ Poor): высокая сохранность и уход при большом возрасте!
  if (age > 0.7 && wealth > 0.65 && characterId !== 'ruined') {
    preservation = Math.max(preservation, 0.78);
    maintenance = Math.max(maintenance, 0.74);
  }

  // Бедный живой квартал (Poor ≠ Ruined): бедно и плотно заселено, но дома обитаемы, а не мёртвые руины!
  if (districtKind === 'poor' && characterId !== 'ruined') {
    population = Math.max(population, 0.84);
    preservation = Math.max(preservation, condition === 'worn' ? 0.42 : 0.56);
  }

  return { age, wealth, preservation, population, maintenance };
}

// ============================================================================
// ФАЗА 6: Архитектурная таксономия пропсов и система якорей (UrbanAnchor)
// ============================================================================

export type PropTaxonomyCategory =
  | 'civic'
  | 'commercial'
  | 'domestic'
  | 'industrial'
  | 'transport'
  | 'defense'
  | 'sacred'
  | 'greenery'
  | 'lighting'
  | 'signage'
  | 'waterfront'
  | 'ruins'
  | 'street_furniture'
  | 'clutter';

export type AnchorKind =
  | 'facade_front'
  | 'facade_side'
  | 'alley_back'
  | 'intersection'
  | 'plaza_edge'
  | 'gate_zone'
  | 'quayside'
  | 'courtyard';

export interface UrbanAnchor {
  x: number;
  y: number;
  kind: AnchorKind;
  facing: ChestRotation;
  districtIndex: number;
  districtKind: DistrictKind;
  activity: number;
  commercial: number;
  buildingIndex?: number;
}

export interface PropSpec {
  id: CivicKind;
  category: PropTaxonomyCategory;
  dressingCategories: readonly DressingCategory[];
  anchorTypes: readonly AnchorKind[];
  allowedDistricts?: readonly DistrictKind[];
  forbiddenZones: readonly ('main_carriageway' | 'door_front' | 'water' | 'steep_slope')[];
  footprint: { w: number; h: number };
  clearance: number;
  orientationMode: 'face_street' | 'parallel_wall' | 'random_cardinal' | 'fixed';
  densityWeight: number;
  minSpacing: number;
  clusterRule: 'solo' | 'pair' | 'cluster_2_3';
  wealthAffinity: readonly [min: number, max: number];
  conditionAffinity: readonly CityCondition[];
  attachmentCapable: boolean;
  emitsLight?: { radius: number; intensity: number; color: string };
}

const ALL_CONDITIONS: readonly CityCondition[] = ['pristine', 'lived_in', 'worn'];

const spec = (
  id: CivicKind,
  category: PropTaxonomyCategory,
  dressingCategories: readonly DressingCategory[],
  anchorTypes: readonly AnchorKind[],
  opts: Partial<Omit<PropSpec, 'id' | 'category' | 'dressingCategories' | 'anchorTypes' | 'footprint'>> = {},
): PropSpec => ({
  id,
  category,
  dressingCategories,
  anchorTypes,
  forbiddenZones: opts.forbiddenZones ?? ['main_carriageway', 'door_front', 'water', 'steep_slope'],
  footprint: { w: CIVIC_KIT[id].w, h: CIVIC_KIT[id].h },
  clearance: opts.clearance ?? 0,
  orientationMode: opts.orientationMode ?? 'face_street',
  densityWeight: opts.densityWeight ?? 1,
  minSpacing: opts.minSpacing ?? 3,
  clusterRule: opts.clusterRule ?? 'solo',
  wealthAffinity: opts.wealthAffinity ?? [0, 1],
  conditionAffinity: opts.conditionAffinity ?? ALL_CONDITIONS,
  allowedDistricts: opts.allowedDistricts,
  attachmentCapable: opts.attachmentCapable ?? false,
  emitsLight: opts.emitsLight,
});

export const PROP_TAXONOMY: readonly PropSpec[] = [
  spec('urbanLamp', 'lighting', ['traffic', 'signs', 'temple', 'market'], ['intersection', 'plaza_edge', 'facade_front', 'gate_zone', 'quayside'], {
    densityWeight: 3.4,
    minSpacing: 6,
    wealthAffinity: [0.22, 1],
    orientationMode: 'fixed',
    emitsLight: { radius: 5.5, intensity: 0.92, color: '#ffb85c' },
  }),
  spec('urbanSignpost', 'signage', ['traffic', 'signs'], ['intersection', 'gate_zone', 'plaza_edge'], {
    densityWeight: 1.8,
    minSpacing: 10,
    orientationMode: 'face_street',
  }),
  spec('urbanSign', 'signage', ['signs', 'market', 'inn'], ['facade_front', 'plaza_edge'], {
    densityWeight: 1.2,
    minSpacing: 7,
    wealthAffinity: [0.25, 0.95],
    attachmentCapable: true,
    allowedDistricts: ['centre', 'market', 'craft', 'docks'],
  }),
  spec('marketNoticeBoard', 'civic', ['signs', 'market', 'temple'], ['plaza_edge', 'intersection', 'gate_zone'], {
    densityWeight: 1.3,
    minSpacing: 12,
    wealthAffinity: [0.3, 1],
  }),
  spec('marketBench', 'street_furniture', ['traffic', 'green', 'temple', 'residential', 'inn'], ['plaza_edge', 'facade_front', 'courtyard', 'intersection'], {
    densityWeight: 2.6,
    minSpacing: 5,
    wealthAffinity: [0.25, 1],
    orientationMode: 'face_street',
  }),
  spec('well', 'civic', ['residential', 'farm', 'traffic'], ['intersection', 'courtyard', 'plaza_edge'], {
    densityWeight: 1.1,
    minSpacing: 14,
    orientationMode: 'fixed',
  }),
  spec('urbanTrough', 'transport', ['traffic', 'farm', 'inn', 'cargo'], ['gate_zone', 'facade_side', 'courtyard', 'quayside'], {
    densityWeight: 1.8,
    minSpacing: 8,
    wealthAffinity: [0.1, 0.78],
    orientationMode: 'parallel_wall',
  }),
  spec('cart', 'transport', ['cargo', 'traffic', 'farm', 'market'], ['gate_zone', 'quayside', 'alley_back', 'courtyard'], {
    densityWeight: 1.5,
    minSpacing: 9,
    wealthAffinity: [0.12, 0.82],
    orientationMode: 'parallel_wall',
  }),
  spec('marketWheelbarrow', 'transport', ['cargo', 'workshop', 'farm'], ['alley_back', 'facade_side', 'quayside', 'courtyard'], {
    densityWeight: 1.7,
    minSpacing: 6,
    wealthAffinity: [0.05, 0.7],
  }),
  spec('marketCrates', 'commercial', ['cargo', 'market', 'workshop'], ['facade_front', 'facade_side', 'quayside', 'alley_back', 'courtyard'], {
    densityWeight: 2.5,
    minSpacing: 3,
    clusterRule: 'cluster_2_3',
    wealthAffinity: [0.1, 0.85],
  }),
  spec('marketBarrels', 'commercial', ['cargo', 'inn', 'market', 'workshop'], ['facade_side', 'facade_front', 'quayside', 'courtyard', 'gate_zone'], {
    densityWeight: 2.5,
    minSpacing: 3,
    clusterRule: 'pair',
    wealthAffinity: [0.1, 0.85],
  }),
  spec('marketSacks', 'commercial', ['cargo', 'farm', 'market', 'litter'], ['facade_side', 'alley_back', 'quayside', 'courtyard'], {
    densityWeight: 2.0,
    minSpacing: 3,
    wealthAffinity: [0.05, 0.75],
  }),
  spec('marketBaskets', 'domestic', ['residential', 'market', 'farm', 'green'], ['facade_front', 'courtyard', 'plaza_edge'], {
    densityWeight: 2.0,
    minSpacing: 3,
    wealthAffinity: [0.1, 0.85],
  }),
  spec('marketRope', 'waterfront', ['cargo', 'workshop'], ['quayside', 'facade_side'], {
    densityWeight: 2.4,
    minSpacing: 4,
    allowedDistricts: ['docks', 'craft', 'market'],
  }),
  spec('urbanHides', 'industrial', ['workshop', 'cargo'], ['facade_side', 'alley_back', 'courtyard'], {
    densityWeight: 1.8,
    minSpacing: 5,
    allowedDistricts: ['craft', 'docks', 'farms'],
    wealthAffinity: [0.08, 0.68],
  }),
  spec('urbanAnvil', 'industrial', ['workshop'], ['facade_side', 'courtyard'], {
    densityWeight: 2.2,
    minSpacing: 7,
    allowedDistricts: ['craft', 'garrison'],
  }),
  spec('urbanForge', 'industrial', ['workshop'], ['courtyard', 'facade_side'], {
    densityWeight: 1.8,
    minSpacing: 9,
    allowedDistricts: ['craft', 'garrison'],
    emitsLight: { radius: 4.2, intensity: 0.8, color: '#ff7b3d' },
  }),
  spec('urbanWorkbench', 'industrial', ['workshop'], ['facade_side', 'courtyard'], {
    densityWeight: 2.1,
    minSpacing: 5,
    allowedDistricts: ['craft', 'docks', 'garrison'],
  }),
  spec('urbanCoal', 'industrial', ['workshop'], ['alley_back', 'facade_side', 'courtyard'], {
    densityWeight: 1.8,
    minSpacing: 5,
    allowedDistricts: ['craft', 'garrison'],
  }),
  spec('urbanPlanks', 'industrial', ['workshop', 'cargo'], ['alley_back', 'facade_side', 'quayside', 'courtyard'], {
    densityWeight: 2.0,
    minSpacing: 5,
    allowedDistricts: ['craft', 'docks', 'poor', 'farms'],
  }),
  spec('urbanWoodpile', 'domestic', ['residential', 'workshop', 'farm'], ['facade_side', 'alley_back', 'courtyard'], {
    densityWeight: 2.4,
    minSpacing: 4,
    wealthAffinity: [0.05, 0.78],
  }),
  spec('urbanPots', 'domestic', ['residential', 'green', 'temple', 'market'], ['facade_front', 'plaza_edge', 'courtyard'], {
    densityWeight: 2.2,
    minSpacing: 4,
    wealthAffinity: [0.2, 1],
  }),
  spec('marketHay', 'domestic', ['farm', 'inn'], ['gate_zone', 'alley_back', 'courtyard'], {
    densityWeight: 2.0,
    minSpacing: 5,
    allowedDistricts: ['farms', 'poor', 'garrison', 'market'],
  }),
  spec('marketBarrelLying', 'clutter', ['litter', 'cargo'], ['alley_back', 'quayside'], {
    densityWeight: 2.1,
    minSpacing: 3,
    wealthAffinity: [0, 0.55],
    conditionAffinity: ['lived_in', 'worn'],
  }),
  // --- Новые пропсы из пакета 160 городских спрайтов ---
  spec('lampStreetIron', 'lighting', ['traffic', 'signs', 'market', 'residential'], ['intersection', 'plaza_edge', 'facade_front', 'gate_zone'], {
    densityWeight: 3.2,
    minSpacing: 6,
    wealthAffinity: [0.3, 1],
    orientationMode: 'fixed',
    emitsLight: { radius: 5.6, intensity: 0.94, color: '#ffc168' },
  }),
  spec('lampStreetFancy', 'lighting', ['traffic', 'signs', 'green'], ['intersection', 'plaza_edge'], {
    densityWeight: 2.4,
    minSpacing: 8,
    wealthAffinity: [0.62, 1],
    allowedDistricts: ['centre', 'noble', 'temple'],
    orientationMode: 'fixed',
    emitsLight: { radius: 6.4, intensity: 1.0, color: '#ffd080' },
  }),
  spec('lampBrazierRound', 'lighting', ['traffic', 'workshop', 'signs'], ['gate_zone', 'intersection', 'plaza_edge', 'courtyard'], {
    densityWeight: 2.2,
    minSpacing: 7,
    allowedDistricts: ['garrison', 'craft', 'centre', 'temple'],
    orientationMode: 'fixed',
    emitsLight: { radius: 5.2, intensity: 0.95, color: '#ff8e42' },
  }),
  spec('lampHarborLantern', 'lighting', ['cargo', 'traffic'], ['quayside', 'intersection'], {
    densityWeight: 3.0,
    minSpacing: 6,
    allowedDistricts: ['docks'],
    orientationMode: 'fixed',
    emitsLight: { radius: 5.4, intensity: 0.88, color: '#ffb55a' },
  }),
  spec('lampStreetStone', 'lighting', ['temple', 'green'], ['plaza_edge', 'courtyard', 'facade_front'], {
    densityWeight: 2.5,
    minSpacing: 6,
    allowedDistricts: ['temple', 'noble'],
    wealthAffinity: [0.55, 1],
    orientationMode: 'fixed',
    emitsLight: { radius: 4.6, intensity: 0.82, color: '#ffe09e' },
  }),
  spec('urbanHandPump', 'civic', ['residential', 'farm', 'traffic'], ['intersection', 'courtyard', 'plaza_edge'], {
    densityWeight: 2.0,
    minSpacing: 10,
    wealthAffinity: [0.05, 0.78],
  }),
  spec('urbanHitchingPost', 'transport', ['traffic', 'market', 'cargo'], ['facade_front', 'gate_zone', 'plaza_edge'], {
    densityWeight: 2.0,
    minSpacing: 6,
    wealthAffinity: [0.15, 0.9],
  }),
  spec('urbanHitchingRail', 'transport', ['traffic', 'farm', 'market'], ['gate_zone', 'facade_side', 'courtyard'], {
    densityWeight: 1.7,
    minSpacing: 8,
    orientationMode: 'parallel_wall',
  }),
  spec('urbanStoneBollard', 'street_furniture', ['traffic', 'signs'], ['intersection', 'plaza_edge', 'gate_zone', 'quayside'], {
    densityWeight: 2.1,
    minSpacing: 4,
    wealthAffinity: [0.4, 1],
    orientationMode: 'fixed',
  }),
  spec('urbanDrainGrate', 'street_furniture', ['traffic', 'market'], ['intersection', 'facade_side', 'alley_back'], {
    densityWeight: 1.5,
    minSpacing: 8,
    wealthAffinity: [0.25, 1],
    orientationMode: 'parallel_wall',
  }),
  spec('urbanStreetShrine', 'sacred', ['temple', 'signs', 'traffic'], ['intersection', 'plaza_edge', 'facade_side'], {
    densityWeight: 1.6,
    minSpacing: 11,
    wealthAffinity: [0.2, 1],
  }),
  spec('urbanWaterBasin', 'civic', ['temple', 'green', 'traffic'], ['plaza_edge', 'courtyard', 'facade_front'], {
    densityWeight: 1.7,
    minSpacing: 9,
    wealthAffinity: [0.45, 1],
  }),
  spec('urbanBellows', 'industrial', ['workshop'], ['facade_side', 'courtyard'], {
    densityWeight: 1.9,
    minSpacing: 6,
    allowedDistricts: ['craft', 'garrison'],
  }),
  spec('urbanGrindingWheel', 'industrial', ['workshop'], ['facade_side', 'courtyard'], {
    densityWeight: 2.0,
    minSpacing: 6,
    allowedDistricts: ['craft', 'garrison'],
  }),
  spec('urbanSawhorse', 'industrial', ['workshop'], ['facade_side', 'courtyard', 'alley_back'], {
    densityWeight: 1.8,
    minSpacing: 6,
    allowedDistricts: ['craft', 'docks', 'farms'],
  }),
  spec('urbanDyeVat', 'industrial', ['workshop'], ['courtyard', 'alley_back'], {
    densityWeight: 1.7,
    minSpacing: 7,
    allowedDistricts: ['craft'],
  }),
  spec('yardWaterPail', 'domestic', ['residential', 'farm', 'workshop'], ['facade_side', 'alley_back', 'courtyard'], {
    densityWeight: 2.4,
    minSpacing: 4,
    wealthAffinity: [0.05, 0.82],
  }),
  spec('yardLaundryLine', 'domestic', ['residential', 'litter'], ['courtyard', 'alley_back'], {
    densityWeight: 2.1,
    minSpacing: 6,
    wealthAffinity: [0, 0.62],
  }),
  spec('yardFlowerPots', 'greenery', ['green', 'residential'], ['facade_front', 'plaza_edge', 'courtyard'], {
    densityWeight: 2.3,
    minSpacing: 4,
    wealthAffinity: [0.28, 1],
  }),
  spec('greenStonePlanterRound', 'greenery', ['green', 'temple', 'signs'], ['plaza_edge', 'facade_front', 'intersection', 'courtyard'], {
    densityWeight: 2.5,
    minSpacing: 5,
    wealthAffinity: [0.48, 1],
    orientationMode: 'fixed',
  }),
  spec('greenFlowerUrn', 'greenery', ['green', 'temple'], ['plaza_edge', 'facade_front', 'courtyard'], {
    densityWeight: 2.2,
    minSpacing: 5,
    wealthAffinity: [0.55, 1],
  }),
  spec('greenTopiaryCone', 'greenery', ['green'], ['plaza_edge', 'facade_front', 'courtyard'], {
    densityWeight: 2.0,
    minSpacing: 5,
    allowedDistricts: ['noble', 'temple', 'centre'],
    wealthAffinity: [0.65, 1],
  }),
  spec('greenPottedCypress', 'greenery', ['green', 'temple'], ['plaza_edge', 'facade_front', 'courtyard'], {
    densityWeight: 2.1,
    minSpacing: 5,
    allowedDistricts: ['noble', 'temple', 'centre'],
    wealthAffinity: [0.55, 1],
  }),
  spec('marketSpiceBowls', 'commercial', ['market', 'cargo'], ['facade_front', 'plaza_edge'], {
    densityWeight: 1.8,
    minSpacing: 5,
    allowedDistricts: ['market', 'centre', 'docks'],
    wealthAffinity: [0.25, 0.95],
  }),
  spec('marketFabricBolts', 'commercial', ['market', 'cargo'], ['facade_front', 'plaza_edge', 'courtyard'], {
    densityWeight: 1.7,
    minSpacing: 6,
    allowedDistricts: ['market', 'centre', 'craft'],
    wealthAffinity: [0.3, 0.95],
  }),
  spec('marketSmokedFishRack', 'waterfront', ['cargo', 'market'], ['quayside', 'facade_side'], {
    densityWeight: 2.2,
    minSpacing: 5,
    allowedDistricts: ['docks', 'market'],
  }),
];

/**
 * Выбор уместного пропса для конкретного городского якоря с проверкой:
 * - типа якоря (`anchor.kind`)
 * - разрешённых категорий `DISTRICT_DRESSING[anchor.districtKind].categories`
 * - материального профиля (богатство, уход, сохранность, населённость)
 * - поля городской активности (`anchor.activity`, `anchor.commercial`).
 */
export function selectPropForAnchor(
  anchor: UrbanAnchor,
  material: UrbanMaterialProfile,
  condition: CityCondition,
  roll: number,
): PropSpec | undefined {
  const districtCats = DISTRICT_DRESSING[anchor.districtKind]?.categories ?? ['residential'];
  const candidates: { spec: PropSpec; weight: number }[] = [];

  for (const item of PROP_TAXONOMY) {
    if (!item.anchorTypes.includes(anchor.kind)) continue;
    if (item.allowedDistricts && !item.allowedDistricts.includes(anchor.districtKind)) continue;
    if (!item.conditionAffinity.includes(condition)) continue;
    if (material.wealth < item.wealthAffinity[0] - 0.08 || material.wealth > item.wealthAffinity[1] + 0.08) continue;
    if (!item.dressingCategories.some((cat) => districtCats.includes(cat))) continue;

    let wgt = item.densityWeight;
    if (item.category === 'lighting') {
      // В богатых и ухоженных кварталах фонари частые; в бедных и запущенных — редкие (тёмные зоны!).
      wgt *= (0.25 + material.maintenance * 0.95 + material.wealth * 0.6) * (0.55 + anchor.activity * 0.8);
      if (anchor.districtKind === 'poor' || material.maintenance < 0.3) wgt *= 0.22;
    } else if (item.category === 'commercial' || item.category === 'signage') {
      wgt *= 0.35 + anchor.commercial * 1.15 + material.population * 0.35;
    } else if (item.category === 'clutter') {
      if (material.maintenance > 0.72) continue;
      wgt *= (1.15 - material.maintenance) * (0.5 + material.population * 0.7);
    } else if (item.category === 'street_furniture' || item.category === 'civic') {
      wgt *= 0.4 + material.wealth * 0.7 + anchor.activity * 0.5;
    }
    if (wgt > 0.05) candidates.push({ spec: item, weight: wgt });
  }

  if (!candidates.length) return undefined;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let cursor = roll * total;
  for (const c of candidates) {
    cursor -= c.weight;
    if (cursor <= 0) return c.spec;
  }
  return candidates[candidates.length - 1].spec;
}

// ============================================================================
// ФАЗА 7: Генерация фасадных вложений (BuildingAttachment) на стенах домов
// ============================================================================

export function buildFacadeAttachments(
  building: Building,
  districtKind: DistrictKind,
  material: UrbanMaterialProfile,
  activity: number,
  commercial: number,
  dressingDensity: number,
  rollA: number,
  rollB: number,
): BuildingAttachment[] {
  if (dressingDensity <= 0.04) return [];
  const side: ChestRotation = building.facing ?? 0;
  const attachments: BuildingAttachment[] = [];
  const role = building.role ?? (building.kind === 'tavern' ? 'tavern' : building.kind === 'shop' ? 'shop' : 'house');
  const wallSpan = side === 0 || side === 180 ? building.w : building.h;

  // 1. Вывески на кронштейнах и маркизы для лавок, мастерских, гильдий и таверн:
  if (building.kind === 'tavern' || role === 'tavern') {
    attachments.push({ kind: 'tavern_sign', side, offset: 0.28, variant: Math.floor(rollA * 4) });
    if (material.maintenance > 0.25) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.24, emitsLight: true });
    }
  } else if (building.kind === 'shop' || role === 'shop' || role === 'workshop' || role === 'smithy' || role === 'guildhall') {
    if (rollA < 0.78 * dressingDensity + commercial * 0.25) {
      attachments.push({ kind: 'shop_sign', side, offset: 0.28, variant: Math.floor(rollB * 6) });
    }
    if (wallSpan >= 3 && role !== 'smithy' && rollB < (0.55 + commercial * 0.35) * dressingDensity && material.preservation > 0.35) {
      attachments.push({ kind: 'awning', side, offset: 0, variant: Math.floor(rollA * 4) });
    }
    if (material.maintenance > 0.42 && (activity > 0.45 || material.wealth > 0.55) && rollA > 0.35) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.28, emitsLight: true });
    }
  } else if (role === 'warehouse' || (districtKind === 'docks' && building.kind === 'hall')) {
    attachments.push({ kind: 'cargo_winch', side, offset: 0.22, variant: 0 });
    if (material.maintenance > 0.38 && rollB > 0.45) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.25, emitsLight: true });
    }
  } else if (role === 'temple' || role === 'minor_temple' || role === 'shrine') {
    attachments.push({ kind: 'shrine_niche', side, offset: 0.26, variant: Math.floor(rollA * 3) });
    if (material.maintenance > 0.3) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.26, emitsLight: true });
    }
  } else if (role === 'town_hall' || role === 'citadel' || role === 'barracks' || role === 'manor' || districtKind === 'noble') {
    if (material.wealth > 0.6 && material.preservation > 0.5 && rollA < 0.72 * dressingDensity) {
      attachments.push({ kind: 'banner', side, offset: 0.28, variant: Math.floor(rollB * 4) });
    }
    if (material.maintenance > 0.45 && rollB < 0.75) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.26, emitsLight: true });
    }
    if (districtKind === 'noble' && wallSpan >= 4 && material.maintenance > 0.6 && rollA > 0.4) {
      attachments.push({ kind: 'flower_box', side, offset: 0.34, variant: Math.floor(rollB * 3) });
    }
  } else {
    // Жилой дом: цветочные ящики у ухоженных домов и редкие фасадные фонари на оживлённых улицах.
    if (wallSpan >= 3 && material.wealth > 0.48 && material.maintenance > 0.58 && rollA < 0.36 * dressingDensity) {
      attachments.push({ kind: 'flower_box', side, offset: 0.26, variant: Math.floor(rollB * 3) });
    }
    if (activity > 0.58 && material.maintenance > 0.52 && material.wealth > 0.42 && rollB < 0.32 * dressingDensity) {
      attachments.push({ kind: 'wall_lantern', side, offset: -0.24, emitsLight: true });
    }
  }

  return attachments;
}

