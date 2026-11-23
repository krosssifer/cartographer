/**
 * Реестр архитектурных комплексов подземелий (gen.dungeonArchetype).
 *
 * Архетип задаёт назначение и планировку: топологию графа, программу залов,
 * функциональные связи, коридоры, долю природных участков, воду, число
 * уровней. Стиль (styles.ts) задаёт облик, состояние — сохранность. Все
 * три выбора независимы и сочетаются в любом порядке.
 *
 * Прежние генераторы (классический склеп и «разнообразная» планировка)
 * работают как раньше, пока поле dungeonArchetype не задано.
 */
import type { CryptTheme, DoorKind } from '../../types';
import type { RoomCategory, RoomFeature, RoomPurpose, RoomShape } from '../plan';

export const COMPLEX_GENERATOR_VERSION = 1;

export type Topology = 'linear' | 'branching' | 'central' | 'ring' | 'multihub' | 'maze' | 'mixed';
export type GeometryMode = 'regular' | 'varied' | 'organic';
export type CorridorKind = 'straight' | 'bent' | 'winding' | 'gallery' | 'colonnade' | 'tunnel' | 'natural' | 'channel';
export type NodeTier = 'entry' | 'main' | 'hub' | 'secondary' | 'transit' | 'service' | 'hidden' | 'natural' | 'special' | 'final' | 'landing';
export type WaterMode = 'none' | 'pools' | 'channels' | 'lake';

export const TOPOLOGY_LABELS: Record<Topology, string> = {
  linear: 'Линейная', branching: 'Разветвлённая', central: 'Центральная', ring: 'Кольцевая',
  multihub: 'Многоузловая', maze: 'Лабиринт', mixed: 'Смешанная',
};
export const GEOMETRY_LABELS: Record<GeometryMode, string> = {
  regular: 'Преимущественно прямоугольная', varied: 'Разнообразная', organic: 'Органическая',
};
export const TIER_LABELS: Record<NodeTier, string> = {
  entry: 'вход', main: 'главный зал', hub: 'узел', secondary: 'второстепенное', transit: 'галерея',
  service: 'служебное', hidden: 'скрытое', natural: 'природное', special: 'особое', final: 'финальное', landing: 'спуск',
};
export const CORRIDOR_LABELS: Record<CorridorKind, string> = {
  straight: 'прямой', bent: 'с изломом', winding: 'извилистый', gallery: 'галерея', colonnade: 'колоннада',
  tunnel: 'узкий тоннель', natural: 'природный тоннель', channel: 'водосток',
};

/** Назначение зала: размер, формы, особенности, категория и тема для редактора. */
export interface PurposeSpec {
  label: string;
  category: RoomCategory;
  theme: CryptTheme;
  w: [number, number];
  h: [number, number];
  shapes: [RoomShape, number][];
  features: [RoomFeature, number][];
  /** Природное помещение: пол пещеры, стены скалы. */
  natural?: boolean;
}

export type ComplexPurpose = Exclude<RoomPurpose, 'crypt'>;

export const PURPOSES: Record<ComplexPurpose, PurposeSpec> = {
  entrance: { label: 'Вход', category: 'defense', theme: 'entry', w: [5, 8], h: [5, 7], shapes: [['rect', 3], ['octagon', 1], ['composite', 1]], features: [['pillars', .2]] },
  landing: { label: 'Лестничный зал', category: 'special', theme: 'entry', w: [6, 6], h: [6, 6], shapes: [['square', 2], ['octagon', 1]], features: [] },
  hall: { label: 'Главный зал', category: 'special', theme: 'sanctum', w: [10, 15], h: [8, 12], shapes: [['composite', 3], ['rect', 2], ['octagon', 1.5], ['circle', 1], ['cross', 1]], features: [['pillars', .6], ['dais', .35], ['rotunda', .2]] },
  throne: { label: 'Тронный зал', category: 'special', theme: 'sanctum', w: [9, 13], h: [11, 16], shapes: [['composite', 3], ['rect', 2]], features: [['pillars', .8], ['dais', .9]] },
  guard: { label: 'Караульная', category: 'defense', theme: 'watch', w: [4, 7], h: [4, 6], shapes: [['rect', 3], ['L', 1.5], ['square', 1]], features: [] },
  barracks: { label: 'Казарма', category: 'living', theme: 'quarters', w: [7, 11], h: [5, 7], shapes: [['rect', 3], ['partitioned', 2], ['L', 1]], features: [] },
  dormitory: { label: 'Общежитие', category: 'living', theme: 'quarters', w: [6, 10], h: [5, 7], shapes: [['partitioned', 3], ['rect', 2]], features: [] },
  quarters: { label: 'Личные покои', category: 'living', theme: 'quarters', w: [5, 7], h: [4, 6], shapes: [['rect', 3], ['L', 2], ['niched', 1]], features: [['niches', .2]] },
  kitchen: { label: 'Кухня', category: 'utility', theme: 'storage', w: [5, 8], h: [4, 6], shapes: [['rect', 3], ['L', 2]], features: [] },
  storage: { label: 'Кладовая', category: 'utility', theme: 'storage', w: [4, 7], h: [3, 5], shapes: [['rect', 3], ['square', 2], ['partitioned', 1]], features: [] },
  workshop: { label: 'Мастерская', category: 'utility', theme: 'forge', w: [6, 9], h: [5, 7], shapes: [['rect', 2], ['L', 2], ['irregular', 1]], features: [] },
  armory: { label: 'Оружейная', category: 'defense', theme: 'watch', w: [5, 8], h: [4, 6], shapes: [['rect', 3], ['niched', 2]], features: [] },
  machinery: { label: 'Механический зал', category: 'utility', theme: 'forge', w: [6, 9], h: [6, 9], shapes: [['square', 2], ['octagon', 2], ['rect', 1]], features: [] },
  shrine: { label: 'Святилище', category: 'religious', theme: 'sanctum', w: [6, 9], h: [6, 9], shapes: [['circle', 3], ['hexagon', 2], ['octagon', 2], ['niched', 1]], features: [['dais', .5], ['rotunda', .25]] },
  chapel: { label: 'Часовня', category: 'religious', theme: 'sanctum', w: [5, 7], h: [6, 9], shapes: [['composite', 2], ['rect', 2], ['niched', 1]], features: [['dais', .4]] },
  ritual: { label: 'Ритуальный зал', category: 'religious', theme: 'sanctum', w: [7, 10], h: [7, 10], shapes: [['circle', 3], ['hexagon', 2], ['octagon', 1]], features: [['rotunda', .4], ['dais', .3]] },
  burial: { label: 'Погребальный зал', category: 'religious', theme: 'burial', w: [7, 11], h: [5, 7], shapes: [['niched', 3], ['rect', 2], ['gallery', 1]], features: [['niches', .6], ['pillars', .25]] },
  ossuary: { label: 'Костница', category: 'religious', theme: 'ossuary', w: [5, 7], h: [5, 7], shapes: [['irregular', 2], ['circle', 1], ['niched', 2]], features: [['niches', .4]] },
  library: { label: 'Библиотека', category: 'arcane', theme: 'archive', w: [8, 12], h: [6, 9], shapes: [['composite', 2], ['rect', 2], ['niched', 2]], features: [['pillars', .25]] },
  archive: { label: 'Архив', category: 'arcane', theme: 'archive', w: [6, 10], h: [4, 5], shapes: [['rect', 2], ['partitioned', 2], ['gallery', 1]], features: [['niches', .4]] },
  laboratory: { label: 'Лаборатория', category: 'arcane', theme: 'forge', w: [7, 10], h: [6, 8], shapes: [['L', 2], ['T', 1], ['rect', 2], ['irregular', 1]], features: [] },
  alchemy: { label: 'Алхимическая', category: 'arcane', theme: 'forge', w: [5, 7], h: [5, 7], shapes: [['square', 2], ['octagon', 2], ['rect', 1]], features: [] },
  cell: { label: 'Камера', category: 'defense', theme: 'cell', w: [3, 4], h: [3, 4], shapes: [['square', 3], ['rect', 1]], features: [] },
  treasury: { label: 'Сокровищница', category: 'special', theme: 'reliquary', w: [4, 6], h: [4, 6], shapes: [['square', 2], ['octagon', 1], ['niched', 1]], features: [] },
  secret: { label: 'Тайник', category: 'special', theme: 'reliquary', w: [3, 4], h: [3, 4], shapes: [['square', 1]], features: [] },
  cave: { label: 'Пещера', category: 'natural', theme: 'ossuary', w: [7, 12], h: [6, 10], shapes: [['organic', 1]], features: [], natural: true },
  lake: { label: 'Подземное озеро', category: 'natural', theme: 'ossuary', w: [10, 15], h: [8, 12], shapes: [['organic', 1]], features: [['pool', 1]], natural: true },
  mining: { label: 'Выработка', category: 'natural', theme: 'storage', w: [7, 11], h: [5, 8], shapes: [['organic', 2], ['irregular', 1]], features: [], natural: true },
  collector: { label: 'Коллектор', category: 'utility', theme: 'storage', w: [8, 11], h: [8, 11], shapes: [['octagon', 2], ['circle', 2], ['square', 1]], features: [['pool', .9]] },
  cistern: { label: 'Цистерна', category: 'utility', theme: 'storage', w: [8, 12], h: [6, 9], shapes: [['rect', 2]], features: [['pillars', .9], ['pool', .6]] },
  gallery: { label: 'Галерея', category: 'special', theme: 'entry', w: [10, 15], h: [3, 4], shapes: [['gallery', 1]], features: [['pillars', .5]] },
};

/** Функциональные связи: соседство этих залов в графе предпочтительно. */
export const AFFINITY: readonly [ComplexPurpose, ComplexPurpose, number][] = [
  ['barracks', 'guard', 3], ['armory', 'guard', 2.5], ['armory', 'barracks', 2], ['kitchen', 'storage', 3], ['kitchen', 'barracks', 1.5],
  ['dormitory', 'kitchen', 1.5], ['shrine', 'hall', 2], ['chapel', 'hall', 2], ['ritual', 'shrine', 2], ['treasury', 'throne', 2.5],
  ['treasury', 'guard', 1.5], ['archive', 'library', 3], ['alchemy', 'laboratory', 3], ['laboratory', 'library', 2], ['storage', 'workshop', 2],
  ['ossuary', 'burial', 2.5], ['machinery', 'collector', 2], ['cistern', 'collector', 2], ['mining', 'storage', 1.5], ['cell', 'guard', 3],
  ['quarters', 'throne', 1.5], ['workshop', 'mining', 2],
];

export interface ArchetypeCorridors {
  main: CorridorKind;
  side: CorridorKind;
  service: CorridorKind;
  /** Ширина главных и боковых ходов. */
  mainWidth: [number, number];
  sideWidth: [number, number];
}

export interface ComplexArchetype {
  id: string;
  label: string;
  hint: string;
  topology: [Topology, number][];
  /** Назначения главного зала, узлов, финала и входа. */
  main: ComplexPurpose[];
  hub: ComplexPurpose[];
  final: ComplexPurpose[];
  /** Программа второстепенных залов с весами. */
  pool: [ComplexPurpose, number][];
  /** Скрытые помещения (тайник за потайной дверью и т. п.). */
  hidden: ComplexPurpose[];
  corridors: ArchetypeCorridors;
  /** Доля природных участков (пещеры, выработки, озёра) на верхнем уровне. */
  natural: number;
  water: WaterMode;
  style: string;
  /** Состояние по умолчанию с весами. */
  condition: [string, number][];
  /** Уровней по умолчанию на большой карте. */
  levels: number;
  /** Виды дверей по смыслу. */
  doors: { main: DoorKind; side: DoorKind; guarded: DoorKind };
  /** Масштаб залов относительно базовых размеров. */
  scale: number;
  /** Механизмы и ловушки, свойственные комплексу. */
  mechanisms: ('vault' | 'trapCorridor' | 'hiddenPassage' | 'levers' | 'machine' | 'sluice' | 'statue')[];
}

export const COMPLEX_ARCHETYPES: readonly ComplexArchetype[] = [
  {
    id: 'fortress', label: 'Древняя крепость', hint: 'Оборонительные залы, казармы, оружейные, караулы у ворот, широкие внутренние галереи.',
    topology: [['central', 3], ['ring', 2], ['multihub', 2], ['branching', 1]], main: ['hall', 'throne'], hub: ['hall', 'gallery'], final: ['throne', 'treasury'],
    pool: [['barracks', 3], ['guard', 3], ['armory', 2.5], ['storage', 2.5], ['kitchen', 1.5], ['quarters', 1.5], ['workshop', 1], ['cell', 1], ['dormitory', 1], ['chapel', .6]],
    hidden: ['secret'], corridors: { main: 'gallery', side: 'straight', service: 'tunnel', mainWidth: [2, 3], sideWidth: [1, 2] },
    natural: .05, water: 'none', style: 'dwarven', condition: [['abandoned', 3], ['damaged', 2], ['preserved', 1], ['reclaimed', 1.2]], levels: 2,
    doors: { main: 'gate', side: 'normal', guarded: 'portcullis' }, scale: 1.05, mechanisms: ['vault', 'levers', 'trapCorridor'],
  },
  {
    id: 'mine', label: 'Заброшенная шахта', hint: 'Узкие штольни, широкие откаточные тоннели, выработки с минералами, склады и шахтные стволы.',
    topology: [['branching', 3], ['maze', 1], ['linear', 1]], main: ['mining'], hub: ['mining', 'storage'], final: ['mining', 'cave'],
    pool: [['mining', 4], ['storage', 2], ['workshop', 2], ['quarters', 1.5], ['dormitory', 1], ['kitchen', .8], ['cave', 2], ['machinery', 1]],
    hidden: ['cave'], corridors: { main: 'tunnel', side: 'winding', service: 'tunnel', mainWidth: [2, 2], sideWidth: [1, 1] },
    natural: .45, water: 'pools', style: 'industrial', condition: [['abandoned', 3], ['ruined', 1.5], ['flooded', 1], ['collapsed', 1]], levels: 3,
    doors: { main: 'arch', side: 'broken', guarded: 'gate' }, scale: .95, mechanisms: ['machine'],
  },
  {
    id: 'temple', label: 'Подземный храм', hint: 'Церемониальный зал на оси, алтари, колоннады, часовни, ритуальные залы, скрытые святилища и водоём.',
    topology: [['central', 3], ['linear', 2], ['ring', 1]], main: ['hall'], hub: ['hall', 'gallery'], final: ['shrine', 'ritual'],
    pool: [['chapel', 3], ['shrine', 2], ['ritual', 1.5], ['quarters', 1.5], ['library', 1], ['storage', 1], ['burial', 1], ['treasury', 1]],
    hidden: ['secret', 'shrine'], corridors: { main: 'colonnade', side: 'straight', service: 'tunnel', mainWidth: [3, 3], sideWidth: [1, 2] },
    natural: .08, water: 'lake', style: 'religious', condition: [['preserved', 2], ['abandoned', 2], ['damaged', 1]], levels: 2,
    doors: { main: 'double', side: 'arch', guarded: 'secret' }, scale: 1.1, mechanisms: ['statue', 'hiddenPassage'],
  },
  {
    id: 'sewer', label: 'Подземная канализация', hint: 'Водостоки с дорожками, коллекторы, узкие служебные ходы, решётки, дренажные и насосные камеры.',
    topology: [['maze', 2], ['ring', 2], ['multihub', 1]], main: ['collector'], hub: ['collector', 'cistern'], final: ['cistern', 'collector'],
    pool: [['machinery', 2], ['storage', 2], ['cistern', 1.5], ['collector', 1.5], ['guard', .6], ['quarters', .6]],
    hidden: ['secret'], corridors: { main: 'channel', side: 'tunnel', service: 'tunnel', mainWidth: [3, 4], sideWidth: [1, 1] },
    natural: .05, water: 'channels', style: 'medieval', condition: [['flooded', 3], ['abandoned', 2], ['damaged', 1]], levels: 2,
    doors: { main: 'arch', side: 'normal', guarded: 'portcullis' }, scale: .95, mechanisms: ['sluice', 'levers'],
  },
  {
    id: 'laboratory', label: 'Магическая лаборатория', hint: 'Экспериментальные залы, алхимические, библиотека и архив, хранилища, изолированные лаборатории и ритуальные камеры.',
    topology: [['multihub', 3], ['branching', 2], ['central', 1]], main: ['laboratory', 'library'], hub: ['library', 'hall'], final: ['ritual', 'treasury'],
    pool: [['alchemy', 3], ['laboratory', 2], ['library', 1.5], ['archive', 2], ['storage', 2], ['quarters', 1], ['cell', .8], ['machinery', .8]],
    hidden: ['secret'], corridors: { main: 'straight', side: 'bent', service: 'tunnel', mainWidth: [2, 2], sideWidth: [1, 1] },
    natural: 0, water: 'none', style: 'elven', condition: [['preserved', 2], ['abandoned', 2], ['damaged', 1]], levels: 2,
    doors: { main: 'double', side: 'normal', guarded: 'secret' }, scale: 1, mechanisms: ['levers', 'vault'],
  },
  {
    id: 'ruins', label: 'Древние руины', hint: 'Неполные залы сложной формы, обрушенные переходы, остатки колонн, природа в старой кладке.',
    topology: [['mixed', 3], ['maze', 1], ['branching', 1]], main: ['hall', 'throne'], hub: ['hall', 'gallery'], final: ['shrine', 'treasury'],
    pool: [['shrine', 1.5], ['storage', 1.5], ['quarters', 1.5], ['library', 1], ['burial', 1], ['gallery', 1], ['cave', 2], ['ossuary', 1]],
    hidden: ['secret'], corridors: { main: 'gallery', side: 'bent', service: 'natural', mainWidth: [2, 3], sideWidth: [1, 2] },
    natural: .3, water: 'pools', style: 'ancient', condition: [['ruined', 3], ['overgrown', 2], ['damaged', 1], ['collapsed', 1]], levels: 2,
    doors: { main: 'arch', side: 'broken', guarded: 'arch' }, scale: 1.05, mechanisms: ['statue'],
  },
  {
    id: 'catacombs', label: 'Катакомбы', hint: 'Сеть узких ходов с погребальными нишами, костницы и тесные залы; много кольцевых маршрутов.',
    topology: [['maze', 3], ['ring', 2]], main: ['burial'], hub: ['ossuary', 'burial'], final: ['burial', 'shrine'],
    pool: [['burial', 3], ['ossuary', 2.5], ['shrine', 1], ['storage', .6], ['cave', 1]],
    hidden: ['secret'], corridors: { main: 'straight', side: 'tunnel', service: 'tunnel', mainWidth: [1, 2], sideWidth: [1, 1] },
    natural: .12, water: 'none', style: 'necromantic', condition: [['abandoned', 3], ['damaged', 1]], levels: 2,
    doors: { main: 'arch', side: 'arch', guarded: 'gate' }, scale: .9, mechanisms: ['trapCorridor'],
  },
  {
    id: 'tomb', label: 'Королевская гробница', hint: 'Парадная ось от входа к погребальной камере, ловушечный коридор, ниши, сокровищница за механизмом.',
    topology: [['linear', 3], ['branching', 1], ['central', 1]], main: ['hall'], hub: ['gallery', 'hall'], final: ['burial', 'treasury'],
    pool: [['burial', 2], ['chapel', 1.5], ['storage', 1.5], ['shrine', 1], ['guard', 1], ['ossuary', 1]],
    hidden: ['secret', 'treasury'], corridors: { main: 'colonnade', side: 'straight', service: 'tunnel', mainWidth: [2, 3], sideWidth: [1, 1] },
    natural: .03, water: 'none', style: 'ancient', condition: [['preserved', 2], ['abandoned', 2]], levels: 2,
    doors: { main: 'double', side: 'arch', guarded: 'secret' }, scale: 1.05, mechanisms: ['trapCorridor', 'vault', 'hiddenPassage'],
  },
  {
    id: 'prison', label: 'Подземная тюрьма', hint: 'Караульный центр, блоки камер вдоль коридоров, допросная, склад и казарма охраны.',
    topology: [['central', 2], ['branching', 2], ['linear', 1]], main: ['guard', 'hall'], hub: ['guard'], final: ['cell', 'machinery'],
    pool: [['cell', 5], ['guard', 1.5], ['barracks', 1.5], ['storage', 1], ['kitchen', .8], ['armory', 1]],
    hidden: ['secret'], corridors: { main: 'straight', side: 'straight', service: 'tunnel', mainWidth: [2, 2], sideWidth: [1, 1] },
    natural: .03, water: 'none', style: 'medieval', condition: [['abandoned', 2], ['preserved', 2], ['damaged', 1], ['reclaimed', 1]], levels: 2,
    doors: { main: 'portcullis', side: 'gate', guarded: 'portcullis' }, scale: .95, mechanisms: ['levers'],
  },
  {
    id: 'cavern', label: 'Природная пещера', hint: 'Полости и тоннели без кладки, подземное озеро, минералы, грибы и сталагмиты.',
    topology: [['branching', 2], ['mixed', 2], ['maze', 1]], main: ['cave', 'lake'], hub: ['cave'], final: ['lake', 'cave'],
    pool: [['cave', 5], ['mining', .5]], hidden: ['cave'],
    corridors: { main: 'natural', side: 'natural', service: 'natural', mainWidth: [2, 3], sideWidth: [1, 2] },
    natural: 1, water: 'lake', style: 'primitive', condition: [['preserved', 1], ['overgrown', 1], ['flooded', .6]], levels: 2,
    doors: { main: 'arch', side: 'arch', guarded: 'arch' }, scale: 1.05, mechanisms: [],
  },
  {
    id: 'hybrid', label: 'Гибридный комплекс', hint: 'Каменные залы, врезанные в пещеры: коридоры переходят в тоннели, проломы ведут в полости, у озера — кладка.',
    topology: [['mixed', 3], ['multihub', 2], ['branching', 1]], main: ['hall', 'lake'], hub: ['hall', 'cave'], final: ['shrine', 'lake'],
    pool: [['cave', 3], ['shrine', 1.5], ['storage', 1.5], ['quarters', 1.5], ['workshop', 1], ['library', 1], ['guard', 1], ['mining', 1]],
    hidden: ['secret'], corridors: { main: 'gallery', side: 'bent', service: 'natural', mainWidth: [2, 3], sideWidth: [1, 2] },
    natural: .4, water: 'lake', style: 'dwarven', condition: [['abandoned', 2], ['overgrown', 1.5], ['damaged', 1]], levels: 3,
    doors: { main: 'arch', side: 'normal', guarded: 'gate' }, scale: 1.05, mechanisms: ['hiddenPassage', 'statue'],
  },
];

export const COMPLEX_ARCHETYPE_IDS = COMPLEX_ARCHETYPES.map((a) => a.id);
export const isComplexArchetype = (id: unknown): id is string => typeof id === 'string' && COMPLEX_ARCHETYPE_IDS.includes(id);
export const getComplexArchetype = (id: string): ComplexArchetype => COMPLEX_ARCHETYPES.find((a) => a.id === id) ?? COMPLEX_ARCHETYPES[0];
export const TOPOLOGIES = Object.keys(TOPOLOGY_LABELS) as Topology[];
export const GEOMETRY_MODES = Object.keys(GEOMETRY_LABELS) as GeometryMode[];
export const isTopologySetting = (v: unknown): boolean => v === 'auto' || TOPOLOGIES.includes(v as Topology);
export const isGeometrySetting = (v: unknown): boolean => v === 'auto' || GEOMETRY_MODES.includes(v as GeometryMode);

/** Размер комплекса в интерфейсе — это число залов (прежнее поле gen.rooms). */
export const COMPLEX_SIZES: readonly { id: string; label: string; rooms: number }[] = [
  { id: 'small', label: 'Небольшой', rooms: 5 },
  { id: 'medium', label: 'Средний', rooms: 8 },
  { id: 'large', label: 'Большой', rooms: 11 },
  { id: 'huge', label: 'Огромный', rooms: 14 },
];
