/**
 * Реестр типов поселений и планировок.
 *
 * Тип задаёт «что это за место»: размер, набор кварталов, укрепления,
 * география и характер застройки. Планировка — «как проложены улицы».
 * Планировщик (settlementPlanner.ts) читает только эти данные, поэтому новый
 * тип — это новая запись здесь, без правок алгоритма.
 */
import type { Building, RoofMaterial, RoofShape, SettlementStyle } from '../types';

export const SETTLEMENT_GENERATOR_VERSION = 1;

export type SettlementTypeId =
  | 'small_village' | 'large_village' | 'trade_town' | 'craft_town' | 'fortified_town'
  | 'small_city' | 'large_city' | 'fortress' | 'port' | 'mountain' | 'frontier_outpost';
export type SettlementLayoutId = 'radial' | 'linear' | 'compact' | 'grid' | 'organic' | 'ring' | 'mixed';
export type DistrictKind = 'centre' | 'market' | 'residential' | 'craft' | 'temple' | 'noble' | 'docks' | 'garrison' | 'farms' | 'poor';
export type WallKind = 'none' | 'palisade' | 'stone';
export type Geography = 'plain' | 'coast' | 'mountain';

export interface SettlementTypeDef {
  id: SettlementTypeId;
  label: string;
  description: string;
  /** Стиль построек и материалов по умолчанию (биом карты). */
  style: SettlementStyle;
  /** Допустимые планировки; первая — планировка по умолчанию. */
  layouts: readonly SettlementLayoutId[];
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
    description: 'Десяток дворов вдоль дороги, огороды и поля по краям.',
    fill: .14, extent: .7, plaza: 'none', districts: { residential: 3, farms: 3 }, walls: 'none', street: .62, geography: 'plain',
  },
  {
    id: 'large_village', label: 'Большая деревня', style: 'village', layouts: ['organic', 'radial', 'linear'],
    description: 'Площадь с колодцем, ремесленный край, дворы и поля.',
    fill: .2, extent: .82, plaza: 'small', districts: { centre: 1, residential: 4, farms: 2, craft: 1, temple: 1 }, walls: 'none', street: .66, geography: 'plain',
  },
  {
    id: 'trade_town', label: 'Торговый город', style: 'town', layouts: ['radial', 'mixed', 'grid'],
    description: 'Большой рынок на перекрёстке трактов, лавки вдоль главных улиц.',
    fill: .3, extent: .9, plaza: 'large', districts: { centre: 1, market: 3, residential: 3, craft: 1, noble: 1, temple: 1 }, walls: 'palisade', street: .95, geography: 'plain',
  },
  {
    id: 'craft_town', label: 'Ремесленный город', style: 'town', layouts: ['grid', 'linear', 'mixed'],
    description: 'Мастерские у воды и у ворот, рабочие кварталы, небольшой рынок.',
    fill: .3, extent: .88, plaza: 'small', districts: { centre: 1, craft: 4, residential: 3, market: 1, poor: 1 }, walls: 'none', street: .82, geography: 'plain',
  },
  {
    id: 'fortified_town', label: 'Укреплённый город', style: 'town', layouts: ['ring', 'radial', 'compact'],
    description: 'Каменная стена с воротами и башнями, плотная застройка внутри.',
    fill: .34, extent: .78, plaza: 'small', districts: { centre: 1, residential: 4, garrison: 2, market: 1, temple: 1 }, walls: 'stone', street: .8, geography: 'plain',
  },
  {
    id: 'small_city', label: 'Небольшой город', style: 'town', layouts: ['mixed', 'radial', 'grid'],
    description: 'Несколько кварталов: рынок, храм, знать, ремесленники.',
    fill: .34, extent: .92, plaza: 'large', districts: { centre: 1, market: 2, residential: 4, craft: 2, temple: 1, noble: 1 }, walls: 'stone', street: .9, geography: 'plain',
  },
  {
    id: 'large_city', label: 'Большой город', style: 'town', layouts: ['ring', 'grid', 'mixed'],
    description: 'Плотная застройка, кольцевые улицы, все виды кварталов и предместья за стеной.',
    fill: .4, extent: .98, plaza: 'large', districts: { centre: 1, market: 2, residential: 5, craft: 2, temple: 1, noble: 2, garrison: 1, poor: 2 }, walls: 'stone', street: .98, geography: 'plain',
  },
  {
    id: 'fortress', label: 'Крепость', style: 'town', layouts: ['compact', 'ring', 'grid'],
    description: 'Цитадель за двойной линией стен, казармы и склады, мало жилья.',
    fill: .26, extent: .62, plaza: 'small', districts: { garrison: 4, centre: 1, craft: 1, residential: 1 }, walls: 'stone', street: .8, geography: 'plain', keep: true,
  },
  {
    id: 'port', label: 'Портовый город', style: 'town', layouts: ['linear', 'grid', 'organic'],
    description: 'Набережная с причалами, склады и рыбный рынок у воды.',
    fill: .3, extent: .95, plaza: 'small', districts: { docks: 3, market: 2, residential: 3, craft: 1, poor: 1 }, walls: 'none', street: .86, geography: 'coast',
  },
  {
    id: 'mountain', label: 'Горное поселение', style: 'village', layouts: ['linear', 'organic', 'compact'],
    description: 'Террасы вдоль склона, улицы по горизонталям, скалы над домами.',
    fill: .18, extent: .85, plaza: 'small', districts: { residential: 3, craft: 2, centre: 1, temple: 1 }, walls: 'none', street: .66, geography: 'mountain',
  },
  {
    id: 'frontier_outpost', label: 'Пограничная застава', style: 'village', layouts: ['compact', 'ring', 'grid'],
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

export interface DistrictDef {
  label: string;
  /** Виды построек с весами. */
  kinds: readonly [Building['kind'], number][];
  /** Материалы кровли (по стилю) и формы крыш. */
  roofs: Record<SettlementStyle, readonly RoofMaterial[]>;
  shapes: readonly RoofShape[];
  /** Длина и глубина участка. */
  length: readonly [number, number];
  depth: readonly [number, number];
  /** Зазор между домами (1 — стена к стене через проулок, 2 — дворы). */
  gap: number;
  /** Насколько охотно квартал застраивается (множитель оценки участка). */
  appeal: number;
}

export const DISTRICTS: Record<DistrictKind, DistrictDef> = {
  centre: {
    label: 'Центр', kinds: [['hall', 2], ['shop', 3], ['house', 2]], shapes: ['hip', 'cross'],
    roofs: { village: [1, 0, 1], town: [2, 5, 3] }, length: [6, 9], depth: [5, 7], gap: 1, appeal: 1.2,
  },
  market: {
    label: 'Рынок', kinds: [['shop', 5], ['house', 2], ['hall', 1]], shapes: ['gable', 'hip'],
    roofs: { village: [1, 0], town: [2, 2, 5, 6] }, length: [5, 7], depth: [4, 5], gap: 1, appeal: 1.15,
  },
  residential: {
    label: 'Жилой квартал', kinds: [['house', 8], ['shop', 1]], shapes: ['gable', 'gable', 'hip'],
    roofs: { village: [0, 1, 0, 7], town: [2, 3, 2, 1, 6] }, length: [5, 7], depth: [4, 5], gap: 1, appeal: 1,
  },
  craft: {
    label: 'Ремесленный квартал', kinds: [['shop', 4], ['house', 3], ['hall', 1]], shapes: ['gable', 'hip'],
    roofs: { village: [1, 7, 1], town: [3, 1, 2] }, length: [6, 8], depth: [4, 6], gap: 2, appeal: .95,
  },
  temple: {
    label: 'Храмовый квартал', kinds: [['hall', 2], ['house', 2], ['tower', 1]], shapes: ['cross', 'hip'],
    roofs: { village: [6, 1], town: [4, 6, 3] }, length: [7, 10], depth: [5, 7], gap: 2, appeal: 1,
  },
  noble: {
    label: 'Кварталы знати', kinds: [['hall', 3], ['house', 3], ['tower', 1]], shapes: ['hip', 'cross'],
    roofs: { village: [1, 6], town: [3, 4, 5] }, length: [7, 10], depth: [6, 7], gap: 3, appeal: .9,
  },
  docks: {
    label: 'Порт и склады', kinds: [['hall', 3], ['shop', 3], ['house', 2]], shapes: ['gable', 'gable', 'hip'],
    roofs: { village: [1, 7], town: [3, 1, 2] }, length: [6, 10], depth: [5, 6], gap: 1, appeal: 1.05,
  },
  garrison: {
    label: 'Гарнизон', kinds: [['hall', 3], ['tower', 3], ['house', 1]], shapes: ['hip', 'gable'],
    roofs: { village: [1, 7], town: [3, 3, 6] }, length: [6, 9], depth: [4, 6], gap: 2, appeal: 1,
  },
  farms: {
    label: 'Хутора и поля', kinds: [['house', 6], ['hall', 1]], shapes: ['gable'],
    roofs: { village: [0, 0, 7, 1], town: [0, 1] }, length: [5, 6], depth: [4, 4], gap: 3, appeal: .8,
  },
  poor: {
    label: 'Бедные кварталы', kinds: [['house', 9]], shapes: ['gable'],
    roofs: { village: [0, 7], town: [0, 1, 7] }, length: [4, 5], depth: [4, 4], gap: 1, appeal: .85,
  },
};
