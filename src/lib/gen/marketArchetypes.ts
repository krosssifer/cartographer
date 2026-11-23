/**
 * Реестр архетипов рыночной площади.
 *
 * Архетип — это «что за рынок»: назначение, характер, специализация торговцев,
 * центр площади, число входов, плотность, предпочтительные постройки и декор.
 * Схема рядов (`marketStyle`: ряды / вокруг центра / ярмарка) — отдельное
 * измерение: «как проложены проходы». Планировщик (marketLayout.ts) читает
 * только эти данные, поэтому новый архетип — новая запись здесь, без правки
 * алгоритма. По устройству реестр повторяет сцены-архетипы (gen/archetypes.ts):
 * id, подпись, описание, совместимость и цепочка `fallback`.
 *
 * Архетипы управляют только визуальной композицией и пространственной
 * раскладкой; игровых параметров здесь нет намеренно.
 */
import type { Building, CivicKind, MarketStyle, SettlementStyle } from '../types';

export const MARKET_GENERATOR_VERSION = 1;

export type MarketArchetypeId = 'village' | 'city' | 'port' | 'caravan' | 'bazaar' | 'fair';
/** Значение поля GenSettings.marketArchetype: 'classic' (или отсутствие) — прежний рынок. */
export type MarketArchetypeSetting = 'classic' | 'auto' | MarketArchetypeId;
export type MarketLayoutStyle = Exclude<MarketStyle, 'auto'>;
export type MarketZoneKind = 'food' | 'craft' | 'special' | 'infra';
/** Центр площади. `tree` — дерево из слоя деревьев, `open` — свободная площадка для событий. */
export type MarketCentreKind = 'well' | 'smallWell' | 'fountain' | 'board' | 'tree' | 'open';
/** Где рынок держит место под разгрузку: у воды, у главного въезда, у края или нигде. */
export type MarketService = 'none' | 'water' | 'gate' | 'edge';
/** Главная постройка торгового места. */
export type MarketStructure = 'stall' | 'shade' | 'covered' | 'pavilion' | 'wagon';

export type MarketSpecialityId =
  | 'produce' | 'fruit' | 'bread' | 'grain' | 'meat' | 'fish' | 'cheese' | 'sweets'
  | 'pottery' | 'fabric' | 'tools' | 'potion'
  | 'show' | 'caravan' | 'livestock' | 'storage' | 'unload' | 'rest';

export interface MarketSpecialityDef {
  id: MarketSpecialityId;
  label: string;
  zone: MarketZoneKind;
  /** Прилавки этой торговли (открытый стол с товаром). */
  stalls: readonly CivicKind[];
  /** Запас: большие (2×2), длинные (2×1) и мелкие (1×1) вещи за прилавком. */
  stock22: readonly CivicKind[];
  stock21: readonly CivicKind[];
  stock11: readonly CivicKind[];
  /** Состав кластера, если он не «прилавок»: склад, загон, отдых, разгрузка, караван. */
  template?: 'storage' | 'livestock' | 'rest' | 'unload' | 'caravan' | 'pavilion';
}

const FOOD_STOCK21: readonly CivicKind[] = ['marketBaskets', 'marketBarrelPair'];

export const MARKET_SPECIALITIES: Record<MarketSpecialityId, MarketSpecialityDef> = {
  produce: { id: 'produce', label: 'Овощи', zone: 'food', stalls: ['marketStallProduce'], stock22: ['marketCrates'], stock21: ['marketBaskets', 'marketWheelbarrow'], stock11: ['marketChestOpen', 'marketBarrelLying'] },
  fruit: { id: 'fruit', label: 'Фрукты', zone: 'food', stalls: ['marketStallFruit'], stock22: ['marketCrates'], stock21: ['marketBaskets'], stock11: ['marketChestOpen'] },
  bread: { id: 'bread', label: 'Хлеб', zone: 'food', stalls: ['marketStallBread'], stock22: ['marketSacks'], stock21: ['marketBaskets'], stock11: ['marketChest'] },
  grain: { id: 'grain', label: 'Зерно', zone: 'food', stalls: ['marketStallGrain'], stock22: ['marketSacks', 'marketHay'], stock21: ['marketWheelbarrow'], stock11: ['marketRope'] },
  meat: { id: 'meat', label: 'Мясо', zone: 'food', stalls: ['marketStallMeat'], stock22: ['marketBarrels'], stock21: ['marketBarrelPair'], stock11: ['marketBarrelLying'] },
  fish: { id: 'fish', label: 'Рыба', zone: 'food', stalls: ['marketStallFish'], stock22: ['marketBarrels', 'marketCrates'], stock21: ['marketBarrelPair'], stock11: ['marketBarrelLying', 'marketRope'] },
  cheese: { id: 'cheese', label: 'Сыры', zone: 'food', stalls: ['marketStallCheese'], stock22: ['marketBarrels'], stock21: FOOD_STOCK21, stock11: ['marketChestOpen'] },
  sweets: { id: 'sweets', label: 'Сладости', zone: 'food', stalls: ['marketStallSweets'], stock22: ['marketCrates'], stock21: ['marketBaskets'], stock11: ['marketChest'] },
  pottery: { id: 'pottery', label: 'Гончар', zone: 'craft', stalls: ['marketStallPottery'], stock22: ['marketHay', 'marketCrates'], stock21: ['marketBaskets'], stock11: ['marketChestOpen'] },
  fabric: { id: 'fabric', label: 'Ткани', zone: 'craft', stalls: ['marketStallFabric', 'marketStallTextiles'], stock22: ['marketCrates'], stock21: ['marketBaskets'], stock11: ['marketChest', 'marketChestOpen'] },
  tools: { id: 'tools', label: 'Кузнец и инструмент', zone: 'craft', stalls: ['marketStallTools'], stock22: ['marketCrates'], stock21: ['marketWheelbarrowStone'], stock11: ['marketChest', 'marketBarrelLying'] },
  potion: { id: 'potion', label: 'Зелья и травы', zone: 'special', stalls: ['marketStallPotion'], stock22: ['marketCrates'], stock21: ['marketBaskets'], stock11: ['marketChest', 'marketChestOpen'] },
  show: { id: 'show', label: 'Шатёр зрелищ', zone: 'special', stalls: [], stock22: ['marketBarrels'], stock21: ['marketBench'], stock11: ['marketBarrelLying'], template: 'pavilion' },
  caravan: { id: 'caravan', label: 'Караванщик', zone: 'infra', stalls: [], stock22: ['marketCrates', 'marketSacks', 'marketBarrels'], stock21: ['marketBarrelPair'], stock11: ['marketChest', 'marketRope'], template: 'caravan' },
  livestock: { id: 'livestock', label: 'Скот и сено', zone: 'infra', stalls: [], stock22: ['marketHayLarge', 'marketHay'], stock21: ['marketFence'], stock11: ['marketRope'], template: 'livestock' },
  storage: { id: 'storage', label: 'Склад', zone: 'infra', stalls: [], stock22: ['marketCrates', 'marketBarrels', 'marketSacks'], stock21: ['marketBarrelPair'], stock11: ['marketBarrelLying', 'marketRope'], template: 'storage' },
  unload: { id: 'unload', label: 'Разгрузка', zone: 'infra', stalls: [], stock22: ['marketCrates', 'marketBarrels'], stock21: ['marketBarrelPair'], stock11: ['marketRope', 'marketBarrelLying'], template: 'unload' },
  rest: { id: 'rest', label: 'Отдых', zone: 'special', stalls: [], stock22: [], stock21: ['marketBench'], stock11: ['marketBarrelLying'], template: 'rest' },
};

/** Шатры: крытые прилавки (стол под навесом) и закрытые павильоны. */
export const COVERED_TENTS: readonly CivicKind[] = ['marketTentAwning', 'marketTentCanopy', 'marketTentPatch', 'marketTentTarp', 'marketTentBurlap'];
export const PAVILIONS: readonly CivicKind[] = ['marketTentStripe', 'marketTentRound', 'marketTentBrown'];

export interface MarketArchetypeDef {
  id: MarketArchetypeId;
  label: string;
  description: string;
  /** Схемы рядов в порядке предпочтения; при marketStyle = 'auto' берётся первая подходящая по форме. */
  layouts: readonly MarketLayoutStyle[];
  /** Размер площади: доли карты и пределы в клетках. */
  size: { share: readonly [number, number]; w: readonly [number, number]; h: readonly [number, number] };
  /** Контур: прямоугольник, скруглённый или неровное пятно. */
  shape: 'rect' | 'rounded' | 'blob';
  /** Покрытие: мощёная площадь, утоптанная земля, луг с тропами. */
  surface: 'square' | 'ground' | 'meadow';
  /** Кольцевая улица вокруг площади (даёт доступ со всех сторон). */
  ringRoad: boolean;
  centre: readonly (readonly [MarketCentreKind, number])[];
  /** Сколько входов нужно; недостающие пробиваются к кольцевой улице. */
  entrances: readonly [number, number];
  /** Ширина главных и боковых проходов; глубина торгового места; шаг поперечных проходов. */
  aisle: { main: number; side: number; depth: 2 | 3; cross: readonly [number, number] };
  /** Доля торговых мест, которые остаются при насыщенности 0 (скелет рынка). */
  skeleton: number;
  /** Вероятность разрыва между соседними местами в ряду. */
  gap: number;
  /** Неровность: изломы проходов и разброс мест (0 — строго, 1 — вольно). */
  irregular: number;
  zones: Readonly<Record<MarketZoneKind, number>>;
  specialities: Readonly<Partial<Record<MarketSpecialityId, number>>>;
  structures: Readonly<Record<MarketStructure, number>>;
  /** Декор: скамьи у центра, доска объявлений, место отдыха, сено, предел числа. */
  decor: { seats: number; board: boolean; rest: boolean; hay: number; max: number };
  service: MarketService;
  /** Открытые «карманы» среди рядов (крытый базар). */
  pockets: number;
  /**
   * Запас позади мест: вероятность, что место займёт ещё один ряд клеток за
   * своей спиной (если он свободен целиком) и заполнит его своим товаром.
   * Базар — плотно, город и порт — частично, деревня и ярмарка — почти нет.
   */
  backfill: number;
  /** Радиус открытого центра как доля меньшей стороны площади (центр 'open'). */
  openShare: number;
  /** Совместимые стили поселения. */
  settlement: readonly SettlementStyle[];
  /** Нужна вода (порт). */
  needsWater?: boolean;
  /** Чем застраивается периметр площади. */
  frontage: readonly (readonly [Building['kind'], number])[];
  fallback: MarketArchetypeId;
}

export const MARKET_ARCHETYPES: readonly MarketArchetypeDef[] = [
  {
    id: 'village', label: 'Деревенский', description: 'Несколько прилавков вразброс, телеги, овощи и зерно, колодец или старое дерево, много свободного места.',
    layouts: ['fair', 'ring'], size: { share: [.2, .24], w: [7, 11], h: [6, 9] }, shape: 'blob', surface: 'ground', ringRoad: false,
    centre: [['well', 4], ['tree', 3], ['smallWell', 2]], entrances: [2, 3],
    aisle: { main: 1, side: 1, depth: 3, cross: [3, 5] }, skeleton: .45, gap: .55, irregular: .85,
    zones: { food: 5, craft: 1.5, special: .4, infra: 2 },
    specialities: { produce: 5, grain: 3, bread: 2, fruit: 2, cheese: 1.5, meat: 1, pottery: 1.2, tools: .8, livestock: 2, storage: .8 },
    structures: { stall: 6, shade: .6, covered: 2, pavilion: 0, wagon: 2 },
    decor: { seats: 1, board: false, rest: false, hay: 3, max: .7 }, service: 'edge', pockets: 0, backfill: .1, openShare: .2,
    settlement: ['village', 'town'], frontage: [['house', 4], ['shop', 1]], fallback: 'fair',
  },
  {
    id: 'city', label: 'Городской', description: 'Постоянные прилавки по секциям, несколько специализаций, доска объявлений, фонтан или колодец, скамьи и лавки по периметру.',
    layouts: ['rows', 'ring'], size: { share: [.28, .3], w: [10, 17], h: [8, 13] }, shape: 'rect', surface: 'square', ringRoad: true,
    centre: [['fountain', 5], ['well', 2], ['board', .6]], entrances: [3, 6],
    aisle: { main: 2, side: 1, depth: 3, cross: [4, 7] }, skeleton: .4, gap: .18, irregular: .3,
    zones: { food: 4, craft: 3, special: 1.5, infra: .8 },
    specialities: { produce: 2, fruit: 2, bread: 2, meat: 2, cheese: 1.5, sweets: 1, fish: 1, pottery: 1.5, fabric: 2, tools: 1.5, potion: 1.2, storage: 1, rest: .8 },
    structures: { stall: 5, shade: 2.5, covered: 2, pavilion: .6, wagon: .2 },
    decor: { seats: 4, board: true, rest: true, hay: 0, max: .55 }, service: 'edge', pockets: 0, backfill: .45, openShare: .2,
    settlement: ['town'], frontage: [['shop', 6], ['hall', 1], ['house', 1]], fallback: 'village',
  },
  {
    id: 'port', label: 'Портовый', description: 'Рыбные ряды и бочки у набережной, место для разгрузки, склады; рынок развёрнут к воде.',
    layouts: ['rows', 'ring'], size: { share: [.26, .3], w: [10, 16], h: [9, 13] }, shape: 'rect', surface: 'square', ringRoad: true,
    centre: [['board', 2], ['well', 2], ['open', 1]], entrances: [2, 5],
    aisle: { main: 2, side: 1, depth: 3, cross: [4, 6] }, skeleton: .4, gap: .22, irregular: .35,
    zones: { food: 4, craft: 1.5, special: .6, infra: 3 },
    specialities: { fish: 7, produce: 1.2, bread: 1, cheese: 1, fabric: 1, tools: 1.2, pottery: .8, storage: 3, unload: 3, rest: .6 },
    structures: { stall: 6, shade: 1.5, covered: 1.5, pavilion: 0, wagon: .6 },
    decor: { seats: 1, board: true, rest: true, hay: 0, max: .5 }, service: 'water', pockets: 0, backfill: .6, openShare: .12,
    settlement: ['town', 'village'], needsWater: true, frontage: [['hall', 3], ['shop', 3], ['house', 1]], fallback: 'city',
  },
  {
    id: 'caravan', label: 'Караванный', description: 'Крытые фургоны и шатры на перекрёстке трактов, большие запасы, склад и место для разгрузки.',
    layouts: ['ring', 'fair'], size: { share: [.3, .32], w: [11, 17], h: [9, 13] }, shape: 'rounded', surface: 'ground', ringRoad: false,
    centre: [['open', 3], ['well', 2], ['board', 1]], entrances: [2, 4],
    aisle: { main: 2, side: 1, depth: 3, cross: [4, 7] }, skeleton: .45, gap: .35, irregular: .6,
    zones: { food: 1.5, craft: 2, special: 1.5, infra: 4 },
    specialities: { caravan: 6, storage: 3, unload: 2, fabric: 2, potion: 1.2, tools: 1, grain: 1.2, sweets: .8, livestock: 1.5, rest: 1 },
    structures: { stall: 2, shade: 1, covered: 2, pavilion: 2.5, wagon: 4 },
    decor: { seats: 1, board: true, rest: true, hay: 2, max: .6 }, service: 'gate', pockets: 0, backfill: .35, openShare: .22,
    settlement: ['town', 'village'], frontage: [['hall', 2], ['shop', 2], ['house', 1]], fallback: 'fair',
  },
  {
    id: 'bazaar', label: 'Крытый базар', description: 'Длинные тесные ряды под навесами, узкие боковые проходы и маленькие открытые карманы.',
    layouts: ['rows'], size: { share: [.3, .32], w: [12, 18], h: [9, 14] }, shape: 'rect', surface: 'square', ringRoad: true,
    centre: [['smallWell', 2], ['fountain', 1], ['open', 1]], entrances: [2, 4],
    aisle: { main: 1, side: 1, depth: 2, cross: [5, 8] }, skeleton: .5, gap: .05, irregular: .2,
    zones: { food: 2.5, craft: 3, special: 2.5, infra: .4 },
    specialities: { fabric: 3, sweets: 2, potion: 2, pottery: 2, tools: 1.5, cheese: 1.2, fruit: 1.2, bread: 1, meat: .8, storage: .5 },
    structures: { stall: 1.5, shade: 1.5, covered: 6, pavilion: .5, wagon: 0 },
    decor: { seats: 0, board: false, rest: false, hay: 0, max: .35 }, service: 'none', pockets: 2, backfill: .95, openShare: .1,
    settlement: ['town'], frontage: [['shop', 8], ['hall', 1]], fallback: 'city',
  },
  {
    id: 'fair', label: 'Ярмарка', description: 'Много шатров в несколько рядов, большая площадка в центре, места отдыха, вольная композиция.',
    layouts: ['fair', 'ring'], size: { share: [.32, .34], w: [12, 19], h: [10, 14] }, shape: 'blob', surface: 'meadow', ringRoad: false,
    centre: [['open', 5], ['tree', 1], ['well', 1]], entrances: [2, 4],
    aisle: { main: 2, side: 1, depth: 3, cross: [4, 7] }, skeleton: .4, gap: .4, irregular: .75,
    zones: { food: 3, craft: 2, special: 2.5, infra: 1 },
    specialities: { show: 3, sweets: 2, bread: 1.5, fruit: 1.5, cheese: 1, meat: 1, pottery: 1.2, fabric: 1.5, potion: 1.2, tools: .8, rest: 2, livestock: 1 },
    structures: { stall: 2, shade: 1.5, covered: 3, pavilion: 4, wagon: .8 },
    decor: { seats: 3, board: false, rest: true, hay: 1, max: .7 }, service: 'edge', pockets: 0, backfill: .15, openShare: .26,
    settlement: ['village', 'town'], frontage: [['house', 2], ['shop', 2]], fallback: 'village',
  },
];

export const MARKET_ARCHETYPE_IDS = MARKET_ARCHETYPES.map((a) => a.id);
export const MARKET_ARCHETYPE_OPTIONS: readonly { id: MarketArchetypeSetting; label: string }[] = [
  { id: 'auto', label: 'Автоматически' },
  ...MARKET_ARCHETYPES.map((a) => ({ id: a.id, label: a.label })),
  { id: 'classic', label: 'Прежний рынок' },
];

export const isMarketArchetypeId = (value: unknown): value is MarketArchetypeId =>
  typeof value === 'string' && (MARKET_ARCHETYPE_IDS as string[]).includes(value);
export const isMarketArchetypeSetting = (value: unknown): value is MarketArchetypeSetting =>
  value === 'classic' || value === 'auto' || isMarketArchetypeId(value);
/** Новая раскладка рынка включена (не 'classic' и не отсутствует). */
export const modernMarket = (value: unknown): boolean => value === 'auto' || isMarketArchetypeId(value);
export const getMarketArchetype = (id: unknown): MarketArchetypeDef | undefined => MARKET_ARCHETYPES.find((a) => a.id === id);

/** Условия, по которым архетип выбирается автоматически и проверяется совместимость. */
export interface MarketContext {
  style: SettlementStyle;
  /** Тип поселения из gen/settlementTypes.ts, если задан. */
  settlementType?: string;
  /** Вода рядом с центром: море, река или нет. */
  water: 'coast' | 'river' | 'none';
  width: number;
  height: number;
  seed: number;
}

export interface MarketResolution {
  archetype: MarketArchetypeDef;
  /** Запрошенный архетип, если он был заменён. */
  requested?: MarketArchetypeId;
  /** Цепочка замен: запрошенный → … → выбранный. */
  chain: MarketArchetypeId[];
  /** Почему выбран именно этот архетип (для отчёта). */
  reason: string;
}

const supports = (a: MarketArchetypeDef, ctx: MarketContext) => a.settlement.includes(ctx.style) && (!a.needsWater || ctx.water !== 'none');

/** Веса автоматического выбора: тип поселения, вода, размер карты. */
function autoWeights(ctx: MarketContext): [MarketArchetypeId, number][] {
  const big = ctx.width * ctx.height >= 3600;
  const type = ctx.settlementType;
  if (ctx.style === 'village') {
    if (ctx.water === 'coast') return [['port', 3], ['village', 2]];
    return [['village', 6], ['fair', big ? 2.5 : 1], ['caravan', type === 'frontier_outpost' ? 3 : .4], ['port', ctx.water === 'river' ? .8 : 0]];
  }
  if (type === 'port' || ctx.water === 'coast') return [['port', 6], ['city', 1]];
  if (type === 'trade_town') return [['caravan', 3], ['city', 2], ['bazaar', 2], ['fair', 1]];
  if (type === 'large_city') return [['bazaar', 3], ['city', 3]];
  if (type === 'craft_town') return [['city', 4], ['bazaar', 1], ['port', ctx.water === 'river' ? 1.5 : 0]];
  if (type === 'fortified_town' || type === 'small_city') return [['city', 5], ['bazaar', 1.5], ['caravan', 1]];
  if (type === 'frontier_outpost') return [['caravan', 4], ['village', 1]];
  return [['city', 5], ['port', ctx.water === 'river' ? 2.5 : 0], ['bazaar', big ? 1.5 : .6], ['caravan', 1], ['fair', big ? 1 : .4]];
}

function hashPick(options: [MarketArchetypeId, number][], seed: number): MarketArchetypeId {
  const usable = options.filter(([, w]) => w > 0);
  const total = usable.reduce((s, [, w]) => s + w, 0);
  let h = Math.imul(seed ^ 0x6a2c3b, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  let roll = ((h ^ (h >>> 13)) >>> 0) / 4294967296 * total;
  for (const [id, w] of usable) { roll -= w; if (roll < 0) return id; }
  return usable[usable.length - 1][0];
}

/**
 * Определяет архетип: 'auto' — по поселению, воде и размеру карты; явный
 * выбор проверяется на совместимость, несовместимый уходит по цепочке fallback.
 */
export function resolveMarketArchetype(setting: unknown, ctx: MarketContext): MarketResolution {
  if (!isMarketArchetypeId(setting)) {
    const options = autoWeights(ctx).filter(([id]) => supports(getMarketArchetype(id)!, ctx));
    const id = options.length ? hashPick(options, ctx.seed) : ctx.style === 'village' ? 'village' : 'city';
    const why = ctx.water === 'coast' ? 'у моря' : ctx.water === 'river' ? 'у реки' : 'без воды';
    return { archetype: getMarketArchetype(id)!, chain: [id], reason: `авто: ${ctx.style === 'town' ? 'город' : 'деревня'}${ctx.settlementType ? ` (${ctx.settlementType})` : ''}, ${why}` };
  }
  const requested = getMarketArchetype(setting)!;
  if (supports(requested, ctx)) return { archetype: requested, chain: [requested.id], reason: 'выбран вручную' };
  const chain: MarketArchetypeId[] = [requested.id];
  let current = requested;
  for (;;) {
    const next = getMarketArchetype(current.fallback)!;
    if (chain.includes(next.id)) break;
    chain.push(next.id);
    if (supports(next, ctx)) {
      const why = requested.needsWater && ctx.water === 'none' ? 'нет воды рядом' : `не подходит для ${ctx.style === 'town' ? 'города' : 'деревни'}`;
      return { archetype: next, requested: requested.id, chain, reason: `${requested.label}: ${why}` };
    }
    current = next;
  }
  const any = MARKET_ARCHETYPES.find((a) => supports(a, ctx)) ?? MARKET_ARCHETYPES[0];
  chain.push(any.id);
  return { archetype: any, requested: requested.id, chain, reason: `${requested.label}: нет совместимой замены` };
}
