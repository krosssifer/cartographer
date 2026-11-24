import type { CivicKind, CivicObject, EditorSettings, RoofMaterial, RoofShape, Selection, SettlementStyle } from './types';

export const ROOF_KIT: { id: RoofMaterial; art: string; label: string; color: string; scale: number }[] = [
  { id: 0, art: 'thatch', label: 'Солома', color: '#b78f4d', scale: 2.8 },
  { id: 1, art: 'shingles', label: 'Дранка', color: '#7a5b3d', scale: 2.7 },
  { id: 2, art: 'terracotta', label: 'Черепица', color: '#a9593c', scale: 3.1 },
  { id: 3, art: 'slate', label: 'Сланец', color: '#596d7b', scale: 2.8 },
  { id: 4, art: 'copper', label: 'Медь', color: '#568d81', scale: 3.5 },
  { id: 5, art: 'garnet', label: 'Бордовая черепица', color: '#773e42', scale: 3.0 },
  { id: 6, art: 'limestone', label: 'Известняк', color: '#b8a076', scale: 3.1 },
  { id: 7, art: 'mossRoof', label: 'Мшистая дранка', color: '#5e6544', scale: 3.0 },
];

export const ROOF_SHAPES: Record<RoofShape, string> = { gable: 'Двускатная', hip: 'Вальмовая', cross: 'Крестовая' };

export const BUILDING_SIZES = [
  { w: 5, h: 4, label: 'Дом' }, { w: 7, h: 5, label: 'Большой дом' }, { w: 9, h: 7, label: 'Особняк' }, { w: 10, h: 7, label: 'Таверна' },
] as const;

export const CIVIC_KIT = {
  market: { label: 'Рынок', art: 'stallRed', icon: 'market', w: 2, h: 2 },
  square: { label: 'Площадь', art: 'cobbles', icon: 'grid', w: 5, h: 4 },
  well: { label: 'Колодец', art: 'well', icon: 'well', w: 1, h: 1 },
  fountain: { label: 'Фонтан', art: 'fountain', icon: 'well', w: 2, h: 2 },
  cart: { label: 'Телега', art: 'cart', icon: 'cart', w: 2, h: 1 },
  garden: { label: 'Огород', art: 'garden', icon: 'sprout', w: 3, h: 2 },
  // шатры
  marketTentStripe: { label: 'Полосатый шатёр', art: 'marketTentStripe', icon: 'market', w: 2, h: 2 },
  marketTentBrown: { label: 'Кожаный шатёр', art: 'marketTentBrown', icon: 'market', w: 2, h: 2 },
  marketTentAwning: { label: 'Полосатый навес', art: 'marketTentAwning', icon: 'market', w: 2, h: 2 },
  marketTentRound: { label: 'Круглый шатёр', art: 'marketTentRound', icon: 'market', w: 2, h: 2 },
  marketTentCanopy: { label: 'Навес', art: 'marketTentCanopy', icon: 'market', w: 2, h: 2 },
  marketTentPatch: { label: 'Латаный навес', art: 'marketTentPatch', icon: 'market', w: 2, h: 2 },
  marketTentTarp: { label: 'Тент', art: 'marketTentTarp', icon: 'market', w: 2, h: 2 },
  marketTentBurlap: { label: 'Шатёр из мешковины', art: 'marketTentBurlap', icon: 'market', w: 2, h: 2 },
  // прилавки
  marketStallProduce: { label: 'Овощной прилавок', art: 'marketStallProduce', icon: 'market', w: 2, h: 2 },
  marketStallFruit: { label: 'Фруктовый прилавок', art: 'marketStallFruit', icon: 'market', w: 2, h: 2 },
  marketStallBread: { label: 'Хлебный прилавок', art: 'marketStallBread', icon: 'market', w: 2, h: 2 },
  marketStallGrain: { label: 'Зерновой прилавок', art: 'marketStallGrain', icon: 'market', w: 2, h: 2 },
  marketStallMeat: { label: 'Мясной прилавок', art: 'marketStallMeat', icon: 'market', w: 2, h: 2 },
  marketStallPottery: { label: 'Гончарный прилавок', art: 'marketStallPottery', icon: 'market', w: 2, h: 2 },
  marketStallFabric: { label: 'Ткани', art: 'marketStallFabric', icon: 'market', w: 2, h: 2 },
  marketStallPotion: { label: 'Зелья', art: 'marketStallPotion', icon: 'market', w: 2, h: 2 },
  marketStallTools: { label: 'Инструменты', art: 'marketStallTools', icon: 'market', w: 2, h: 2 },
  marketStallFish: { label: 'Рыбный прилавок', art: 'marketStallFish', icon: 'market', w: 2, h: 2 },
  marketStallCheese: { label: 'Сырный прилавок', art: 'marketStallCheese', icon: 'market', w: 2, h: 2 },
  marketStallTextiles: { label: 'Сукно и ковры', art: 'marketStallTextiles', icon: 'market', w: 2, h: 2 },
  marketStallSweets: { label: 'Сладости', art: 'marketStallSweets', icon: 'market', w: 2, h: 2 },
  // транспорт и товары
  marketWagon: { label: 'Телега', art: 'marketWagon', icon: 'cart', w: 3, h: 2 },
  marketWagonCovered: { label: 'Крытая телега', art: 'marketWagonCovered', icon: 'cart', w: 3, h: 2 },
  marketWheelbarrow: { label: 'Тачка', art: 'marketWheelbarrow', icon: 'cart', w: 2, h: 1 },
  marketWheelbarrowStone: { label: 'Тачка с камнем', art: 'marketWheelbarrowStone', icon: 'cart', w: 2, h: 1 },
  marketCrates: { label: 'Ящики', art: 'marketCrates', icon: 'chest', w: 2, h: 2 },
  marketBarrels: { label: 'Бочки', art: 'marketBarrels', icon: 'chest', w: 2, h: 2 },
  marketSacks: { label: 'Мешки', art: 'marketSacks', icon: 'sprout', w: 2, h: 2 },
  marketRope: { label: 'Канат', art: 'marketRope', icon: 'cart', w: 1, h: 1 },
  marketChest: { label: 'Сундук', art: 'marketChest', icon: 'chest', w: 1, h: 1 },
  marketChestOpen: { label: 'Открытый сундук', art: 'marketChestOpen', icon: 'chest', w: 1, h: 1 },
  marketBaskets: { label: 'Корзины', art: 'marketBaskets', icon: 'sprout', w: 2, h: 1 },
  marketBarrelPair: { label: 'Пара бочек', art: 'marketBarrelPair', icon: 'chest', w: 2, h: 1 },
  marketNoticeBoard: { label: 'Доска объявлений', art: 'marketNoticeBoard', icon: 'grid', w: 2, h: 2 },
  marketWell: { label: 'Колодец', art: 'marketWell', icon: 'well', w: 2, h: 2 },
  marketHay: { label: 'Стог сена', art: 'marketHay', icon: 'sprout', w: 2, h: 2 },
  marketBarrelLying: { label: 'Лежачая бочка', art: 'marketBarrelLying', icon: 'chest', w: 1, h: 1 },
  // столы, лавки, ограды
  marketBench: { label: 'Лавка', art: 'marketBench', icon: 'grid', w: 2, h: 1 },
  marketTable: { label: 'Стол', art: 'marketTable', icon: 'grid', w: 3, h: 2 },
  marketTableLong: { label: 'Длинный стол', art: 'marketTableLong', icon: 'grid', w: 3, h: 1 },
  marketFence: { label: 'Ограда', art: 'marketFence', icon: 'grid', w: 2, h: 1 },
  // --- городская среда: уличная мебель, мастерские, товары ---
  urbanLamp: { label: 'Фонарь', art: 'urbanLamp', icon: 'well', w: 1, h: 1 },
  urbanSign: { label: 'Вывеска', art: 'urbanSign', icon: 'market', w: 1, h: 1 },
  urbanSignpost: { label: 'Указатель', art: 'urbanSignpost', icon: 'market', w: 1, h: 1 },
  urbanTrough: { label: 'Поилка', art: 'urbanTrough', icon: 'well', w: 2, h: 1 },
  urbanAnvil: { label: 'Наковальня', art: 'urbanAnvil', icon: 'grid', w: 1, h: 1 },
  urbanWorkbench: { label: 'Верстак', art: 'urbanWorkbench', icon: 'grid', w: 2, h: 1 },
  urbanForge: { label: 'Горн', art: 'urbanForge', icon: 'grid', w: 2, h: 2 },
  urbanWoodpile: { label: 'Дрова', art: 'urbanWoodpile', icon: 'grid', w: 2, h: 1 },
  urbanPlanks: { label: 'Доски', art: 'urbanPlanks', icon: 'grid', w: 2, h: 1 },
  urbanCoal: { label: 'Уголь', art: 'urbanCoal', icon: 'grid', w: 1, h: 1 },
  urbanHides: { label: 'Шкуры', art: 'urbanHides', icon: 'grid', w: 2, h: 1 },
  urbanPots: { label: 'Кувшины', art: 'urbanPots', icon: 'market', w: 1, h: 1 },
  marketHayLarge: { label: 'Большой стог', art: 'marketHayLarge', icon: 'sprout', w: 2, h: 2 },
  marketTableSet: { label: 'Стол со скамьёй', art: 'marketTableSet', icon: 'grid', w: 3, h: 2 },
  // --- пакет 160 городских спрайтов: уличная мебель ---
  urbanHandPump: { label: 'Водокачка', art: 'urbanHandPump', icon: 'well', w: 1, h: 1 },
  urbanHitchingPost: { label: 'Коновязь-столб', art: 'urbanHitchingPost', icon: 'grid', w: 1, h: 1 },
  urbanHitchingRail: { label: 'Коновязь', art: 'urbanHitchingRail', icon: 'grid', w: 2, h: 1 },
  urbanStoneBollard: { label: 'Каменный столбик', art: 'urbanStoneBollard', icon: 'grid', w: 1, h: 1 },
  urbanMilestone: { label: 'Верстовой камень', art: 'urbanMilestone', icon: 'grid', w: 1, h: 1 },
  urbanDrainGrate: { label: 'Ливневая решётка', art: 'urbanDrainGrate', icon: 'grid', w: 1, h: 1 },
  urbanManholeCover: { label: 'Канализационный люк', art: 'urbanManholeCover', icon: 'grid', w: 1, h: 1 },
  urbanWaterBasin: { label: 'Каменная чаша', art: 'urbanWaterBasin', icon: 'well', w: 1, h: 1 },
  urbanWashTub: { label: 'Уличная лохань', art: 'urbanWashTub', icon: 'well', w: 1, h: 1 },
  urbanBucketStand: { label: 'Стойка с вёдрами', art: 'urbanBucketStand', icon: 'well', w: 1, h: 1 },
  urbanStreetShrine: { label: 'Уличная часовенка', art: 'urbanStreetShrine', icon: 'well', w: 1, h: 1 },
  urbanStonePlanter: { label: 'Уличный вазон', art: 'urbanStonePlanter', icon: 'sprout', w: 1, h: 1 },
  urbanRoadBarrier: { label: 'Дорожная рогатка', art: 'urbanRoadBarrier', icon: 'grid', w: 2, h: 1 },
  urbanStreetBroom: { label: 'Уличная метла', art: 'urbanStreetBroom', icon: 'sprout', w: 1, h: 1 },
  // --- ремесленные дворы и мастерские ---
  urbanBellows: { label: 'Кузнечные меха', art: 'urbanBellows', icon: 'grid', w: 1, h: 1 },
  urbanToolRack: { label: 'Стойка инструментов', art: 'urbanToolRack', icon: 'grid', w: 2, h: 1 },
  urbanGrindingWheel: { label: 'Точильный круг', art: 'urbanGrindingWheel', icon: 'grid', w: 1, h: 1 },
  urbanSawhorse: { label: 'Козлы для пилки', art: 'urbanSawhorse', icon: 'grid', w: 2, h: 1 },
  urbanPotteryWheel: { label: 'Гончарный круг', art: 'urbanPotteryWheel', icon: 'grid', w: 1, h: 1 },
  urbanPotteryKiln: { label: 'Обжиговая печь', art: 'urbanPotteryKiln', icon: 'grid', w: 2, h: 2 },
  urbanDyeVat: { label: 'Чан красильщика', art: 'urbanDyeVat', icon: 'well', w: 1, h: 1 },
  urbanLoom: { label: 'Ткацкий станок', art: 'urbanLoom', icon: 'grid', w: 2, h: 1 },
  // --- уличное освещение ---
  lampStreetIron: { label: 'Кованый фонарь', art: 'lampStreetIron', icon: 'well', w: 1, h: 1 },
  lampStreetWood: { label: 'Деревянный фонарь', art: 'lampStreetWood', icon: 'well', w: 1, h: 1 },
  lampStreetStone: { label: 'Каменный фонарь', art: 'lampStreetStone', icon: 'well', w: 1, h: 1 },
  lampStreetFancy: { label: 'Парадный фонарь', art: 'lampStreetFancy', icon: 'well', w: 1, h: 1 },
  lampBrazierSquare: { label: 'Квадратная жаровня', art: 'lampBrazierSquare', icon: 'well', w: 1, h: 1 },
  lampBrazierRound: { label: 'Круглая жаровня', art: 'lampBrazierRound', icon: 'well', w: 1, h: 1 },
  lampTorchStand: { label: 'Факельная стойка', art: 'lampTorchStand', icon: 'well', w: 1, h: 1 },
  lampFireBasket: { label: 'Огненная корзина', art: 'lampFireBasket', icon: 'well', w: 1, h: 1 },
  lampOilLantern: { label: 'Масляный фонарь', art: 'lampOilLantern', icon: 'well', w: 1, h: 1 },
  lampCandleLantern: { label: 'Свечной фонарь', art: 'lampCandleLantern', icon: 'well', w: 1, h: 1 },
  lampHarborLantern: { label: 'Причальный фонарь', art: 'lampHarborLantern', icon: 'well', w: 1, h: 1 },
  lampSignalBeacon: { label: 'Сигнальный маяк', art: 'lampSignalBeacon', icon: 'well', w: 2, h: 2 },
  // --- жилые дворы и подсобное хозяйство ---
  yardLaundryLine: { label: 'Бельевая верёвка', art: 'yardLaundryLine', icon: 'grid', w: 2, h: 1 },
  yardWashTub: { label: 'Корыто для стирки', art: 'yardWashTub', icon: 'well', w: 1, h: 1 },
  yardWashboard: { label: 'Стиральная доска', art: 'yardWashboard', icon: 'grid', w: 1, h: 1 },
  yardWaterPail: { label: 'Бадья с водой', art: 'yardWaterPail', icon: 'chest', w: 1, h: 1 },
  yardChoppingBlock: { label: 'Колода с топором', art: 'yardChoppingBlock', icon: 'grid', w: 1, h: 1 },
  yardFirewoodRack: { label: 'Поленница под навесом', art: 'yardFirewoodRack', icon: 'grid', w: 2, h: 1 },
  yardBroomRake: { label: 'Грабли и метла', art: 'yardBroomRake', icon: 'sprout', w: 1, h: 1 },
  yardCompostBin: { label: 'Компостный ящик', art: 'yardCompostBin', icon: 'sprout', w: 1, h: 1 },
  yardChickenCoop: { label: 'Курятник', art: 'yardChickenCoop', icon: 'sprout', w: 2, h: 1 },
  yardFeedTrough: { label: 'Кормушка', art: 'yardFeedTrough', icon: 'sprout', w: 1, h: 1 },
  yardBeehive: { label: 'Пчелиный улей', art: 'yardBeehive', icon: 'sprout', w: 1, h: 1 },
  yardDoghouse: { label: 'Собачья будка', art: 'yardDoghouse', icon: 'grid', w: 1, h: 1 },
  yardHerbBed: { label: 'Грядка с травами', art: 'yardHerbBed', icon: 'sprout', w: 2, h: 1 },
  yardVegetableBed: { label: 'Овощная грядка', art: 'yardVegetableBed', icon: 'sprout', w: 2, h: 2 },
  yardFlowerPots: { label: 'Горшки с цветами', art: 'yardFlowerPots', icon: 'sprout', w: 1, h: 1 },
  yardOutdoorCookstove: { label: 'Дворовая печь', art: 'yardOutdoorCookstove', icon: 'grid', w: 1, h: 1 },
  // --- городское озеленение ---
  greenStonePlanterRound: { label: 'Круглая клумба', art: 'greenStonePlanterRound', icon: 'sprout', w: 1, h: 1 },
  greenStonePlanterRect: { label: 'Каменная клумба', art: 'greenStonePlanterRect', icon: 'sprout', w: 2, h: 1 },
  greenFlowerUrn: { label: 'Вазон с цветами', art: 'greenFlowerUrn', icon: 'sprout', w: 1, h: 1 },
  greenHerbPot: { label: 'Вазон с травами', art: 'greenHerbPot', icon: 'sprout', w: 1, h: 1 },
  greenTopiaryCone: { label: 'Конусный топиарий', art: 'greenTopiaryCone', icon: 'sprout', w: 1, h: 1 },
  greenTopiaryBall: { label: 'Шаровой топиарий', art: 'greenTopiaryBall', icon: 'sprout', w: 1, h: 1 },
  greenHedgeBox: { label: 'Самшитовый куст', art: 'greenHedgeBox', icon: 'sprout', w: 1, h: 1 },
  greenPottedCypress: { label: 'Кипарис в кадке', art: 'greenPottedCypress', icon: 'sprout', w: 1, h: 1 },
  greenRoseTrellis: { label: 'Шпалера с розами', art: 'greenRoseTrellis', icon: 'sprout', w: 2, h: 1 },
  greenGrapeTrellis: { label: 'Виноградная шпалера', art: 'greenGrapeTrellis', icon: 'sprout', w: 2, h: 1 },
  greenFlowerBed: { label: 'Цветочная клумба', art: 'greenFlowerBed', icon: 'sprout', w: 2, h: 1 },
  greenVegetableHerbBox: { label: 'Садовый ящик', art: 'greenVegetableHerbBox', icon: 'sprout', w: 2, h: 1 },
  greenOrnamentalShrubPot: { label: 'Декоративный куст', art: 'greenOrnamentalShrubPot', icon: 'sprout', w: 1, h: 1 },
  greenSmallGardenStatue: { label: 'Садовая статуя', art: 'greenSmallGardenStatue', icon: 'well', w: 1, h: 1 },
  // --- торговые выкладки и рыночные мелочи ---
  marketScale: { label: 'Весы торговца', art: 'marketScale', icon: 'market', w: 1, h: 1 },
  marketWeights: { label: 'Набор гирек', art: 'marketWeights', icon: 'market', w: 1, h: 1 },
  marketCoins: { label: 'Касса и монеты', art: 'marketCoins', icon: 'market', w: 1, h: 1 },
  marketLedger: { label: 'Книга учёта', art: 'marketLedger', icon: 'market', w: 1, h: 1 },
  marketSpiceBowls: { label: 'Чаши со специями', art: 'marketSpiceBowls', icon: 'market', w: 1, h: 1 },
  marketSpiceRack: { label: 'Лоток пряностей', art: 'marketSpiceRack', icon: 'market', w: 1, h: 1 },
  marketHerbBundles: { label: 'Связки трав', art: 'marketHerbBundles', icon: 'sprout', w: 1, h: 1 },
  marketHoneyJars: { label: 'Горшочки мёда', art: 'marketHoneyJars', icon: 'market', w: 1, h: 1 },
  marketSmokedFishRack: { label: 'Копчёная рыба', art: 'marketSmokedFishRack', icon: 'market', w: 2, h: 1 },
  marketMeatHooks: { label: 'Мясная стойка', art: 'marketMeatHooks', icon: 'market', w: 2, h: 1 },
  marketCheeseWheels: { label: 'Головки сыра', art: 'marketCheeseWheels', icon: 'market', w: 1, h: 1 },
  marketSaltMeasure: { label: 'Кадка с солью', art: 'marketSaltMeasure', icon: 'market', w: 1, h: 1 },
  marketGlassVials: { label: 'Склянки и флаконы', art: 'marketGlassVials', icon: 'market', w: 1, h: 1 },
  marketCandleBundles: { label: 'Связки свечей', art: 'marketCandleBundles', icon: 'market', w: 1, h: 1 },
  marketFabricBolts: { label: 'Рулоны сукна', art: 'marketFabricBolts', icon: 'market', w: 2, h: 1 },
  marketFlowerBundles: { label: 'Букеты в вёдрах', art: 'marketFlowerBundles', icon: 'sprout', w: 1, h: 1 },
} satisfies Record<CivicKind, { label: string; art: string; icon: string; w: number; h: number }>;

export const CIVIC_KINDS = Object.keys(CIVIC_KIT) as CivicKind[];
export const CIVIC_GROUPS = [
  {
    id: 'city',
    label: 'Город',
    kinds: CIVIC_KINDS.filter((kind) =>
      (!kind.startsWith('market') || kind === 'market')
      && !kind.startsWith('yard')
      && !kind.startsWith('green')),
  },
  {
    id: 'yards',
    label: 'Дворы',
    kinds: CIVIC_KINDS.filter((kind) => kind.startsWith('yard')),
  },
  {
    id: 'green',
    label: 'Зелень',
    kinds: CIVIC_KINDS.filter((kind) => kind.startsWith('green')),
  },
  {
    id: 'market',
    label: 'Рынок',
    kinds: CIVIC_KINDS.filter((kind) => kind.startsWith('market') && kind !== 'market'),
  },
] as const;
export const CIVIC_SIZES = {
  market: [{ w: 2, h: 2, label: 'Один прилавок' }, { w: 4, h: 2, label: 'Торговый ряд' }, { w: 4, h: 4, label: 'Ярмарка' }],
  square: [{ w: 5, h: 4, label: '5 × 4 клетки' }, { w: 7, h: 5, label: '7 × 5 клеток' }, { w: 9, h: 7, label: '9 × 7 клеток' }],
} as const;
export const MARKET_STYLES = [
  { id: 'auto', label: 'Автоматически' },
  { id: 'rows', label: 'Ряды прилавков' },
  { id: 'ring', label: 'Вокруг центра' },
  { id: 'fair', label: 'Ярмарка' },
] as const;
const STALL_ARTS = ['marketStallProduce', 'marketStallBread', 'marketStallFruit', 'marketStallFish', 'marketStallMeat', 'marketStallPottery', 'marketStallFabric', 'marketStallGrain', 'marketStallPotion', 'marketStallTools', 'marketStallCheese', 'marketStallTextiles', 'marketStallSweets']; 
export const isSettlement = (biome: string): biome is SettlementStyle => biome === 'town' || biome === 'village';
export const intersects = (a: Selection, b: Selection, margin = 0) =>
  a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
export const contains = (r: Selection, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const encloses = (a: Selection, b: Selection) => contains(a, b.x, b.y) && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

export function civicArt(item: Pick<CivicObject, 'kind' | 'variant'>) {
  return item.kind === 'market' && item.variant % 2 ? 'stallGreen' : CIVIC_KIT[item.kind].art;
}

export function marketStalls(w: number, h: number, variant: number) {
  const columns = w >= 4 ? 2 : 1, rows = h >= 4 ? 2 : 1;
  return Array.from({ length: columns * rows }, (_, i) => ({
    x: (i % columns - (columns - 1) / 2) * 2,
    y: (Math.floor(i / columns) - (rows - 1) / 2) * 2,
    art: STALL_ARTS[(variant + i) % STALL_ARTS.length],
  }));
}

export const DEFAULT_EDITOR: EditorSettings = {
  tool: 'brush', terrain: 'grass', brushSize: 1, brushShape: 'round', treeKind: 'oak', snap: true, chestRotation: 0,
  roofMaterial: 2, roofShape: 'gable', civicKind: 'market', stampRotation: 0, buildingSize: 1, civicSize: 0, furnitureKind: 'table', furnitureErase: false,
  furnitureFinish: 'oak', furnitureSprite: '', cryptKind: 'coffin', cryptErase: false, cryptConceal: true,
  chestKind: 'wooden', objectSizes: {}, sizeLock: true, sizeUnit: 'cells',
};