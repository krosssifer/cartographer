/**
 * Реестр типов поселений, планировок улиц, исторического характера и кварталов.
 *
 * Тип задаёт «что это за место»: размер, набор кварталов, укрепления,
 * географию и характер застройки. Планировка — «как проложены улицы».
 * Исторический характер — «как и зачем город рос» (возраст, уклад, богатство).
 */
import type { Building, RoofMaterial, RoofShape, SettlementStyle } from '../types';

export const SETTLEMENT_GENERATOR_VERSION = 2;

export type SettlementTypeId =
  | 'small_village' | 'large_village' | 'trade_town' | 'craft_town' | 'fortified_town'
  | 'small_city' | 'large_city' | 'fortress' | 'port' | 'mountain' | 'frontier_outpost';
export type SettlementLayoutId = 'radial' | 'linear' | 'compact' | 'grid' | 'organic' | 'ring' | 'mixed';
export type DistrictKind = 'centre' | 'market' | 'residential' | 'craft' | 'temple' | 'noble' | 'docks' | 'garrison' | 'farms' | 'poor';
export type WallKind = 'none' | 'palisade' | 'stone';
export type Geography = 'plain' | 'coast' | 'mountain';

export type UrbanCharacterId =
  | 'young' | 'old' | 'ancient'
  | 'trade' | 'military' | 'religious'
  | 'port' | 'craft' | 'noble' | 'poor' | 'mixed';
export type UrbanCharacterSetting = 'auto' | UrbanCharacterId;

export type GrowthStage =
  | 'origin'
  | 'old_core'
  | 'first_expansion'
  | 'second_expansion'
  | 'outer_city'
  | 'suburbs';

export const GROWTH_STAGE_ORDER: readonly GrowthStage[] = [
  'origin', 'old_core', 'first_expansion', 'second_expansion', 'outer_city', 'suburbs',
];

export const GROWTH_STAGE_LABELS: Record<GrowthStage, string> = {
  origin: 'Точка основания',
  old_core: 'Старое ядро',
  first_expansion: 'Первое расширение',
  second_expansion: 'Второе расширение',
  outer_city: 'Внешний город',
  suburbs: 'Предместья и окраины',
};

export interface UrbanCharacterDef {
  id: UrbanCharacterId;
  label: string;
  description: string;
  /** Доля старого нерегулярного ядра (0..1). */
  coreShare: number;
  /** Регулярность кварталов и сетки (0 — кривые, 1 — строгие). */
  regularity: number;
  /** Смещение условного богатства (-0.3..+0.3). */
  wealthBias: number;
  /** Множитель ширины главных улиц. */
  streetScale: number;
  /** Интенсивность переулков и внутренних проходов (0..1). */
  alleyDensity: number;
  /** Вероятность исторических аномалий (старые стены, руины, тупики). */
  anomalyRate: number;
  /** Склонение к предместьям за основной чертой (0..1). */
  suburbSpread: number;
}

export const URBAN_CHARACTERS: Record<UrbanCharacterId, UrbanCharacterDef> = {
  young: {
    id: 'young', label: 'Молодой',
    description: 'Недавнее основание: прямее улицы, крупнее участки, просторные дворы и пустыри под рост.',
    coreShare: .18, regularity: .78, wealthBias: .02, streetScale: 1.08, alleyDensity: .28, anomalyRate: .1, suburbSpread: .3,
  },
  old: {
    id: 'old', label: 'Старый',
    description: 'Сложившийся исторический центр с тесными кварталами и более регулярными новыми слободами.',
    coreShare: .42, regularity: .48, wealthBias: .04, streetScale: .98, alleyDensity: .58, anomalyRate: .45, suburbSpread: .55,
  },
  ancient: {
    id: 'ancient', label: 'Древний',
    description: 'Вековой город: плотное криволинейное ядро, остатки старых оград, площади, руины и узкие переулки.',
    coreShare: .62, regularity: .28, wealthBias: .02, streetScale: .92, alleyDensity: .78, anomalyRate: .85, suburbSpread: .65,
  },
  trade: {
    id: 'trade', label: 'Торговый',
    description: 'Широкий транзитный тракт от ворот к рынку, лавки на фасадах, склады и караванные дворы.',
    coreShare: .36, regularity: .56, wealthBias: .12, streetScale: 1.14, alleyDensity: .52, anomalyRate: .35, suburbSpread: .62,
  },
  military: {
    id: 'military', label: 'Военный',
    description: 'Прямые маршевые улицы, плац, казармы, оружейные склады и дисциплинированная планировка.',
    coreShare: .28, regularity: .86, wealthBias: .0, streetScale: 1.12, alleyDensity: .26, anomalyRate: .2, suburbSpread: .25,
  },
  religious: {
    id: 'religious', label: 'Религиозный',
    description: 'Храмовый центр на возвышении, процессионная дорога, площади паломников, часовни и погост.',
    coreShare: .46, regularity: .54, wealthBias: .1, streetScale: 1.06, alleyDensity: .44, anomalyRate: .5, suburbSpread: .42,
  },
  port: {
    id: 'port', label: 'Портовый',
    description: 'Жизнь у воды: набережная, причалы, пакгаузы, таверны моряков и ступенчатый подъём к центру.',
    coreShare: .4, regularity: .46, wealthBias: .03, streetScale: 1.02, alleyDensity: .64, anomalyRate: .4, suburbSpread: .5,
  },
  craft: {
    id: 'craft', label: 'Ремесленный',
    description: 'Цеховые слободы у воды и дорог: мастерские, кузницы, печи, навесы и рабочие дворы со складами.',
    coreShare: .35, regularity: .52, wealthBias: -.04, streetScale: 1.0, alleyDensity: .62, anomalyRate: .35, suburbSpread: .6,
  },
  noble: {
    id: 'noble', label: 'Аристократический',
    description: 'Крупные усадьбы с парадными дворами и садами, широкие мощёные проспекты, фонтаны и монументы.',
    coreShare: .34, regularity: .68, wealthBias: .26, streetScale: 1.16, alleyDensity: .3, anomalyRate: .28, suburbSpread: .35,
  },
  poor: {
    id: 'poor', label: 'Бедный',
    description: 'Скученная мелкая застройка, узкие кривые улочки и тупики, лачуги в глубине кварталов и мастерские.',
    coreShare: .48, regularity: .26, wealthBias: -.26, streetScale: .86, alleyDensity: .84, anomalyRate: .65, suburbSpread: .72,
  },
  mixed: {
    id: 'mixed', label: 'Смешанный',
    description: 'Живой контраст старого центра, шумного торга, богатых особняков и ремесленных предместий.',
    coreShare: .44, regularity: .5, wealthBias: .03, streetScale: 1.0, alleyDensity: .56, anomalyRate: .48, suburbSpread: .58,
  },
};

export const URBAN_CHARACTER_IDS = Object.keys(URBAN_CHARACTERS) as UrbanCharacterId[];
export const URBAN_CHARACTER_LABELS: Record<UrbanCharacterId, string> = Object.fromEntries(
  URBAN_CHARACTER_IDS.map((id) => [id, URBAN_CHARACTERS[id].label]),
) as Record<UrbanCharacterId, string>;

export const isUrbanCharacter = (value: unknown): value is UrbanCharacterId =>
  typeof value === 'string' && URBAN_CHARACTER_IDS.includes(value as UrbanCharacterId);
export const isUrbanCharacterSetting = (value: unknown): value is UrbanCharacterSetting =>
  value === 'auto' || isUrbanCharacter(value);
export const getUrbanCharacter = (requested: unknown, type: SettlementTypeDef): UrbanCharacterDef =>
  isUrbanCharacter(requested) ? URBAN_CHARACTERS[requested] : URBAN_CHARACTERS[type.defaultCharacter];

export interface SettlementTypeDef {
  id: SettlementTypeId;
  label: string;
  description: string;
  /** Стиль построек и материалов по умолчанию (биом карты). */
  style: SettlementStyle;
  /** Допустимые планировки; первая — планировка по умолчанию. */
  layouts: readonly SettlementLayoutId[];
  /** Характер города по умолчанию (при settlementCharacter = 'auto'). */
  defaultCharacter: UrbanCharacterId;
  /** Доля площади карты под постройками при полной плотности. */
  fill: number;
  /** Радиус застроенной области в долях полуразмера карты. */
  extent: number;
  plaza: 'none' | 'small' | 'large';
  /** Веса кварталов: сколько площади застройки отдаётся каждому. */
  districts: Partial<Record<DistrictKind, number>>;
  walls: WallKind;
  /** Полуширина главной улицы в клетках. */
  street: number;
  geography: Geography;
  /** Цитадель в центре (крепость). */
  keep?: boolean;
}

export const SETTLEMENT_TYPES: readonly SettlementTypeDef[] = [
  {
    id: 'small_village', label: 'Малая деревня', style: 'village', layouts: ['linear', 'organic', 'compact'],
    defaultCharacter: 'young',
    description: 'Десяток дворов вдоль дороги, огороды и поля по краям.',
    fill: .14, extent: .7, plaza: 'none', districts: { residential: 3, farms: 3 }, walls: 'none', street: .62, geography: 'plain',
  },
  {
    id: 'large_village', label: 'Большая деревня', style: 'village', layouts: ['organic', 'radial', 'linear'],
    defaultCharacter: 'old',
    description: 'Площадь с колодцем, ремесленный край, дворы и поля.',
    fill: .2, extent: .82, plaza: 'small', districts: { centre: 1, residential: 4, farms: 2, craft: 1, temple: 1 }, walls: 'none', street: .66, geography: 'plain',
  },
  {
    id: 'trade_town', label: 'Торговый город', style: 'town', layouts: ['radial', 'mixed', 'grid'],
    defaultCharacter: 'trade',
    description: 'Большой рынок на перекрёстке трактов, лавки вдоль главных улиц.',
    fill: .3, extent: .9, plaza: 'large', districts: { centre: 1, market: 3, residential: 3, craft: 1, noble: 1, temple: 1 }, walls: 'palisade', street: .95, geography: 'plain',
  },
  {
    id: 'craft_town', label: 'Ремесленный город', style: 'town', layouts: ['grid', 'linear', 'mixed'],
    defaultCharacter: 'craft',
    description: 'Мастерские у воды и у ворот, рабочие кварталы, небольшой рынок.',
    fill: .3, extent: .88, plaza: 'small', districts: { centre: 1, craft: 4, residential: 3, market: 1, poor: 1 }, walls: 'none', street: .82, geography: 'plain',
  },
  {
    id: 'fortified_town', label: 'Укреплённый город', style: 'town', layouts: ['ring', 'radial', 'compact'],
    defaultCharacter: 'old',
    description: 'Каменная стена с воротами и башнями, плотная застройка внутри.',
    fill: .34, extent: .78, plaza: 'small', districts: { centre: 1, residential: 4, garrison: 2, market: 1, temple: 1 }, walls: 'stone', street: .8, geography: 'plain',
  },
  {
    id: 'small_city', label: 'Небольшой город', style: 'town', layouts: ['mixed', 'radial', 'grid'],
    defaultCharacter: 'mixed',
    description: 'Несколько кварталов: рынок, храм, знать, ремесленники.',
    fill: .34, extent: .92, plaza: 'large', districts: { centre: 1, market: 2, residential: 4, craft: 2, temple: 1, noble: 1 }, walls: 'stone', street: .9, geography: 'plain',
  },
  {
    id: 'large_city', label: 'Большой город', style: 'town', layouts: ['ring', 'grid', 'mixed'],
    defaultCharacter: 'ancient',
    description: 'Плотная застройка, кольцевые улицы, все виды кварталов и предместья за стеной.',
    fill: .4, extent: .98, plaza: 'large', districts: { centre: 1, market: 2, residential: 5, craft: 2, temple: 1, noble: 2, garrison: 1, poor: 2 }, walls: 'stone', street: .98, geography: 'plain',
  },
  {
    id: 'fortress', label: 'Крепость', style: 'town', layouts: ['compact', 'ring', 'grid'],
    defaultCharacter: 'military',
    description: 'Цитадель за двойной линией стен, казармы и склады, мало жилья.',
    fill: .26, extent: .62, plaza: 'small', districts: { garrison: 4, centre: 1, craft: 1, residential: 1 }, walls: 'stone', street: .8, geography: 'plain', keep: true,
  },
  {
    id: 'port', label: 'Портовый город', style: 'town', layouts: ['linear', 'grid', 'organic'],
    defaultCharacter: 'port',
    description: 'Набережная с причалами, склады и рыбный рынок у воды.',
    fill: .3, extent: .95, plaza: 'small', districts: { docks: 3, market: 2, residential: 3, craft: 1, poor: 1 }, walls: 'none', street: .86, geography: 'coast',
  },
  {
    id: 'mountain', label: 'Горное поселение', style: 'village', layouts: ['linear', 'organic', 'compact'],
    defaultCharacter: 'old',
    description: 'Террасы вдоль склона, улицы по горизонталям, скалы над домами.',
    fill: .18, extent: .85, plaza: 'small', districts: { residential: 3, craft: 2, centre: 1, temple: 1 }, walls: 'none', street: .66, geography: 'mountain',
  },
  {
    id: 'frontier_outpost', label: 'Пограничная застава', style: 'village', layouts: ['compact', 'ring', 'grid'],
    defaultCharacter: 'military',
    description: 'Частокол с воротами, казарма, склады и пара дворов.',
    fill: .2, extent: .5, plaza: 'small', districts: { garrison: 3, residential: 1, craft: 1 }, walls: 'palisade', street: .7, geography: 'plain',
  },
];

export const SETTLEMENT_TYPE_IDS = SETTLEMENT_TYPES.map((type) => type.id);
export const SETTLEMENT_LAYOUT_LABELS: Record<SettlementLayoutId, string> = {
  radial: 'Радиальная', linear: 'Линейная', compact: 'Компактная', grid: 'Сетка', organic: 'Органическая', ring: 'Кольцевая', mixed: 'Смешанная',
};
export const SETTLEMENT_LAYOUT_IDS = Object.keys(SETTLEMENT_LAYOUT_LABELS) as SettlementLayoutId[];

export const isSettlementType = (value: unknown): value is SettlementTypeId =>
  typeof value === 'string' && SETTLEMENT_TYPE_IDS.includes(value as SettlementTypeId);
export const isSettlementLayout = (value: unknown): value is SettlementLayoutId =>
  typeof value === 'string' && SETTLEMENT_LAYOUT_IDS.includes(value as SettlementLayoutId);
export const getSettlementType = (id: string | undefined): SettlementTypeDef | undefined => SETTLEMENT_TYPES.find((type) => type.id === id);

export function resolveUrbanCharacter(type: SettlementTypeDef, requested: string | undefined): UrbanCharacterDef {
  return isUrbanCharacter(requested) ? URBAN_CHARACTERS[requested] : URBAN_CHARACTERS[type.defaultCharacter];
}

export interface DistrictDef {
  label: string;
  /** Виды построек с весами. */
  kinds: readonly [Building['kind'], number][];
  /** Материалы кровли (по стилю) и формы крыш. */
  roofs: Record<SettlementStyle, readonly RoofMaterial[]>;
  shapes: readonly RoofShape[];
  /** Длина и глубина главного здания на участке. */
  length: readonly [number, number];
  depth: readonly [number, number];
  /** Ширина фасада участка вдоль улицы и глубина участка с двором. */
  plotFrontage: readonly [number, number];
  plotDepth: readonly [number, number];
  /** Зазор между домами (1 — стена к стене через проулок, 2 — дворы). */
  gap: number;
  /** Насколько охотно квартал застраивается (множитель оценки участка). */
  appeal: number;
  /** Базовое богатство квартала (0..1). */
  wealth: number;
  /** Целевая доля свободного места внутри квартала (дворы, сады, пустыри, 0..1). */
  openShare: number;
  /** Вероятность внутреннего двора при доме. */
  courtyardRate: number;
}

export const DISTRICTS: Record<DistrictKind, DistrictDef> = {
  centre: {
    label: 'Центр', kinds: [['hall', 2], ['shop', 3], ['house', 2]], shapes: ['hip', 'cross'],
    roofs: { village: [1, 0, 1], town: [2, 5, 3] }, length: [6, 9], depth: [5, 7],
    plotFrontage: [6, 10], plotDepth: [7, 11], gap: 1, appeal: 1.24, wealth: .74, openShare: .2, courtyardRate: .58,
  },
  market: {
    label: 'Рынок', kinds: [['shop', 5], ['house', 2], ['hall', 1]], shapes: ['gable', 'hip'],
    roofs: { village: [1, 0], town: [2, 2, 5, 6] }, length: [5, 7], depth: [4, 5],
    plotFrontage: [5, 8], plotDepth: [6, 10], gap: 1, appeal: 1.2, wealth: .66, openShare: .18, courtyardRate: .52,
  },
  residential: {
    label: 'Жилой квартал', kinds: [['house', 8], ['shop', 1]], shapes: ['gable', 'gable', 'hip'],
    roofs: { village: [0, 1, 0, 7], town: [2, 3, 2, 1, 6] }, length: [5, 7], depth: [4, 5],
    plotFrontage: [5, 8], plotDepth: [6, 9], gap: 1, appeal: 1.0, wealth: .48, openShare: .24, courtyardRate: .55,
  },
  craft: {
    label: 'Ремесленный квартал', kinds: [['shop', 4], ['house', 3], ['hall', 1]], shapes: ['gable', 'hip'],
    roofs: { village: [1, 7, 1], town: [3, 1, 2] }, length: [6, 8], depth: [4, 6],
    plotFrontage: [6, 9], plotDepth: [7, 11], gap: 1, appeal: .98, wealth: .4, openShare: .28, courtyardRate: .72,
  },
  temple: {
    label: 'Храмовый квартал', kinds: [['hall', 2], ['house', 2], ['tower', 1]], shapes: ['cross', 'hip'],
    roofs: { village: [6, 1], town: [4, 6, 3] }, length: [7, 10], depth: [5, 7],
    plotFrontage: [8, 12], plotDepth: [8, 12], gap: 2, appeal: 1.04, wealth: .72, openShare: .32, courtyardRate: .65,
  },
  noble: {
    label: 'Кварталы знати', kinds: [['hall', 3], ['house', 3], ['tower', 1]], shapes: ['hip', 'cross'],
    roofs: { village: [1, 6], town: [3, 4, 5] }, length: [7, 10], depth: [6, 7],
    plotFrontage: [9, 13], plotDepth: [9, 14], gap: 2, appeal: .94, wealth: .88, openShare: .38, courtyardRate: .85,
  },
  docks: {
    label: 'Порт и склады', kinds: [['hall', 3], ['shop', 3], ['house', 2]], shapes: ['gable', 'gable', 'hip'],
    roofs: { village: [1, 7], town: [3, 1, 2] }, length: [6, 10], depth: [5, 6],
    plotFrontage: [6, 10], plotDepth: [6, 10], gap: 1, appeal: 1.08, wealth: .42, openShare: .22, courtyardRate: .56,
  },
  garrison: {
    label: 'Гарнизон', kinds: [['hall', 3], ['tower', 3], ['house', 1]], shapes: ['hip', 'gable'],
    roofs: { village: [1, 7], town: [3, 3, 6] }, length: [6, 9], depth: [4, 6],
    plotFrontage: [7, 11], plotDepth: [7, 10], gap: 2, appeal: 1.02, wealth: .52, openShare: .3, courtyardRate: .6,
  },
  farms: {
    label: 'Хутора и поля', kinds: [['house', 6], ['hall', 1]], shapes: ['gable'],
    roofs: { village: [0, 0, 7, 1], town: [0, 1] }, length: [5, 6], depth: [4, 4],
    plotFrontage: [8, 12], plotDepth: [8, 13], gap: 3, appeal: .82, wealth: .3, openShare: .48, courtyardRate: .8,
  },
  poor: {
    label: 'Бедные кварталы', kinds: [['house', 9]], shapes: ['gable'],
    roofs: { village: [0, 7], town: [0, 1, 7] }, length: [4, 5], depth: [4, 4],
    plotFrontage: [4, 6], plotDepth: [4, 6], gap: 1, appeal: .88, wealth: .16, openShare: .16, courtyardRate: .28,
  },
};
