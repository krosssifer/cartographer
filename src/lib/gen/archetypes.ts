// Реестр архетипов сцен.
//
// Архетип — это замысел карты («горный перевал», «лагерь бандитов»), который
// управляет генерацией целиком: рельефом и водой (landscape.ts), дорогой,
// главным и второстепенными пространствами, массами леса и камня, плотностью
// растительности и сюжетными постройками (features.ts). Сам реестр — только
// данные: новый архетип добавляется одной записью, без правки алгоритмов.
//
// Архетипы влияют только на визуальную композицию и пространственную
// структуру карты; тактических параметров (укрытия, линии обзора, стоимость
// движения) здесь нет намеренно.

import type { Biome } from '../types';
import type { ReliefKind } from './heightfield';
import type { WaterMode } from './hydrology';
import type { RiverCourseKind } from './landscape';

export type ArchetypeCategory = 'natural' | 'architectural' | 'special';

/** Где сцена ставит главный визуальный центр. */
export type FocalPlacement =
  /** около центра, со смещением по асимметрии */
  | 'center'
  /** в одной из третей карты (правило третей) */
  | 'thirds'
  /** на дне долины/прохода, на оси сцены */
  | 'axis'
  /** у переправы через главное русло */
  | 'crossing'
  /** у подножия скального массива (вход в пещеру/шахту) */
  | 'cliff'
  /** на дороге, в её средней трети */
  | 'road';

export type RoadMode =
  /** без дороги */
  | 'none'
  /** по переключателю «Дорога» в панели */
  | 'optional'
  /** сквозной тракт через всю карту */
  | 'through'
  /** заросшая колея: полотно — утоптанная земля, а не дорога */
  | 'track';

/** Сюжетные постройки и группы объектов, которые архетип ставит у фокуса. */
export type FeatureId =
  | 'ambush_cover'
  | 'fallen_trees'
  | 'giant_tree'
  | 'flower_meadow'
  | 'boulder_field'
  | 'cave_mouth'
  | 'mine_entrance'
  | 'dungeon_portal'
  | 'ruin_cluster'
  | 'village_ruins'
  | 'fortress_ruin'
  | 'temple_ruin'
  | 'broken_bridge'
  | 'boardwalks'
  | 'camp_tents'
  | 'palisade'
  | 'trading_post'
  | 'watchtower'
  | 'curtain_walls'
  | 'walled_square'
  | 'stone_circle'
  | 'caravan_wreck'
  | 'shrine'
  | 'graveyard'
  | 'battlefield';

export interface ArchetypeVegetation {
  /** Множитель бюджета крон (1 — как в классической генерации). */
  canopy: number;
  /** Множитель подлеска. */
  undergrowth: number;
  /** Множитель камней. */
  rocks: number;
}

export interface ArchetypeComposition {
  focal: FocalPlacement;
  /** Радиус главного пространства как доля меньшей стороны карты. */
  focalRadius: number;
  /** Число второстепенных открытых пространств. */
  secondary: number;
  /** Число плотных масс (лес/камень). */
  masses: number;
  /** Масштаб масс относительно классического. */
  massScale: number;
  /** 0..1 — сдвиг фокуса от центра: асимметричная композиция живее. */
  asymmetry: number;
}

export interface SceneArchetypeDef {
  id: string;
  category: ArchetypeCategory;
  label: string;
  description: string;
  /** Биомы, в которых сцена уместна. */
  biomes: Biome[];
  /** Архетип-замена для несовместимого биома (сам должен быть совместим шире). */
  fallback: string;
  relief: ReliefKind;
  water: WaterMode;
  course: RiverCourseKind;
  cliffs: number;
  wetlands: number;
  road: RoadMode;
  vegetation: ArchetypeVegetation;
  composition: ArchetypeComposition;
  features: FeatureId[];
}

export const OVERLAND_BIOMES: readonly Biome[] = ['forest', 'plains', 'swamp', 'desert', 'snow'];

const GREEN: Biome[] = ['forest', 'plains', 'swamp', 'snow'];
const ALL: Biome[] = ['forest', 'plains', 'swamp', 'desert', 'snow'];

const veg = (canopy: number, undergrowth: number, rocks: number): ArchetypeVegetation => ({ canopy, undergrowth, rocks });
const comp = (
  focal: FocalPlacement,
  focalRadius: number,
  secondary: number,
  masses: number,
  massScale: number,
  asymmetry: number,
): ArchetypeComposition => ({ focal, focalRadius, secondary, masses, massScale, asymmetry });

export const SCENE_ARCHETYPES: readonly SceneArchetypeDef[] = [
  // ---------------- природные ----------------
  {
    id: 'forest_ambush', category: 'natural', label: 'Лесная засада',
    description: 'Тракт сжат густым лесом с двух сторон, поваленные стволы и валуны у обочины — узкое место на дороге.',
    biomes: ['forest', 'swamp', 'snow', 'plains'], fallback: 'abandoned_forest_road',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.2, wetlands: 0.2, road: 'through',
    vegetation: veg(1.35, 1.3, 0.9), composition: comp('road', 0.1, 1, 4, 1.1, 0.4), features: ['ambush_cover', 'fallen_trees'],
  },
  {
    id: 'glade', category: 'natural', label: 'Поляна',
    description: 'Большая светлая поляна в кольце леса, цветущий луг и пара старых пней. Простор в центре, лес по краям.',
    biomes: GREEN, fallback: 'mountain_valley',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0.2, road: 'optional',
    vegetation: veg(1.2, 1, 0.5), composition: comp('center', 0.2, 1, 3, 1.2, 0.3), features: ['flower_meadow'],
  },
  {
    id: 'abandoned_forest_road', category: 'natural', label: 'Заброшенная лесная дорога',
    description: 'Старая колея зарастает: лес подступает к полотну, поперёк лежат стволы, у обочины — брошенная телега.',
    biomes: ['forest', 'swamp', 'snow', 'plains'], fallback: 'caravan_wreck',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.1, wetlands: 0.3, road: 'track',
    vegetation: veg(1.25, 1.4, 0.8), composition: comp('road', 0.12, 1, 3, 1, 0.5), features: ['fallen_trees'],
  },
  {
    id: 'mountain_pass', category: 'natural', label: 'Горный перевал',
    description: 'Седловина между скальными гребнями: тропа идёт по дну прохода, склоны — обрывы и осыпи.',
    biomes: ['snow', 'plains', 'forest', 'desert'], fallback: 'mountain_valley',
    relief: 'pass', water: 'none', course: 'none', cliffs: 0.8, wetlands: 0, road: 'through',
    vegetation: veg(0.55, 0.6, 1.6), composition: comp('axis', 0.1, 1, 2, 0.8, 0.35), features: ['boulder_field'],
  },
  {
    id: 'mountain_valley', category: 'natural', label: 'Горная долина',
    description: 'Широкое дно долины между крутыми склонами, по дну бежит ручей с притоками, на склонах — лес и скалы.',
    biomes: ALL, fallback: 'glade',
    relief: 'valley', water: 'stream', course: 'along', cliffs: 0.55, wetlands: 0.25, road: 'optional',
    vegetation: veg(0.9, 0.9, 1.2), composition: comp('axis', 0.13, 2, 3, 0.9, 0.45), features: [],
  },
  {
    id: 'river_crossing', category: 'natural', label: 'Речная переправа',
    description: 'Широкая река пересекает карту, тракт подходит к мосту. Пологие берега по обе стороны переправы.',
    biomes: ALL, fallback: 'mountain_valley',
    relief: 'rolling', water: 'river_wide', course: 'across', cliffs: 0.15, wetlands: 0.35, road: 'through',
    vegetation: veg(1, 1, 0.8), composition: comp('crossing', 0.11, 2, 3, 1, 0.4), features: [],
  },
  {
    id: 'swamp_islands', category: 'natural', label: 'Болотные острова',
    description: 'Мелководье с кочками и островами, соединёнными гатями. Мёртвые деревья и камыш у воды.',
    biomes: ['swamp', 'forest'], fallback: 'lakeland',
    relief: 'islands', water: 'marsh', course: 'none', cliffs: 0, wetlands: 1, road: 'none',
    vegetation: veg(0.8, 1.3, 0.4), composition: comp('thirds', 0.1, 2, 3, 0.8, 0.6), features: ['boardwalks'],
  },
  {
    id: 'cave_entrance', category: 'natural', label: 'Вход в пещеру',
    description: 'Скальный массив с тёмным зевом пещеры, перед входом — площадка с валунами и осыпью.',
    biomes: ALL, fallback: 'mountain_pass',
    relief: 'cliffside', water: 'none', course: 'none', cliffs: 0.9, wetlands: 0.1, road: 'optional',
    vegetation: veg(0.85, 0.9, 1.4), composition: comp('cliff', 0.11, 1, 2, 0.9, 0.3), features: ['cave_mouth', 'boulder_field'],
  },
  {
    id: 'lakeland', category: 'natural', label: 'Озёрный край',
    description: 'Несколько озёр в котловинах, соединённых протоками, с заболоченными берегами и рощами между водой.',
    biomes: ['forest', 'plains', 'snow', 'swamp'], fallback: 'river_crossing',
    relief: 'lakeland', water: 'lakes', course: 'none', cliffs: 0.1, wetlands: 0.45, road: 'optional',
    vegetation: veg(1, 1.1, 0.6), composition: comp('thirds', 0.11, 2, 3, 0.9, 0.5), features: [],
  },
  // ---------------- архитектурные ----------------
  {
    id: 'forest_ruins', category: 'architectural', label: 'Лесные руины',
    description: 'Остатки каменных построек среди деревьев: осыпавшиеся стены, обломки кладки, заросший двор.',
    biomes: ['forest', 'swamp', 'snow', 'plains'], fallback: 'ancient_temple_ruins',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.15, wetlands: 0.2, road: 'optional',
    vegetation: veg(1.15, 1.2, 0.8), composition: comp('thirds', 0.15, 1, 3, 1, 0.5), features: ['ruin_cluster'],
  },
  {
    id: 'abandoned_village', category: 'architectural', label: 'Заброшенная деревня',
    description: 'Несколько разрушенных домов вдоль заросшей улицы, колодец, сломанные ограды и брошенная телега.',
    biomes: ['forest', 'plains', 'snow', 'swamp', 'desert'], fallback: 'forest_ruins',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0.2, road: 'track',
    vegetation: veg(0.85, 1.2, 0.6), composition: comp('center', 0.18, 1, 2, 0.8, 0.35), features: ['village_ruins'],
  },
  {
    id: 'ruined_fortress', category: 'architectural', label: 'Разрушенная крепость',
    description: 'Квадрат крепостных стен с угловыми башнями, проломы и груды камня, внутренний двор.',
    biomes: ALL, fallback: 'forest_ruins',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0.1, wetlands: 0, road: 'optional',
    vegetation: veg(0.75, 0.9, 1), composition: comp('center', 0.22, 1, 2, 0.8, 0.25), features: ['fortress_ruin'],
  },
  {
    id: 'ancient_temple_ruins', category: 'architectural', label: 'Руины древнего храма',
    description: 'Каменное основание храма с колоннадой, разбитые статуи и алтарь в глубине святилища.',
    biomes: ALL, fallback: 'forest_ruins',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0.05, wetlands: 0, road: 'optional',
    vegetation: veg(0.8, 1, 0.8), composition: comp('thirds', 0.2, 1, 2, 0.9, 0.4), features: ['temple_ruin'],
  },
  {
    id: 'broken_bridge', category: 'architectural', label: 'Разрушенный мост',
    description: 'Тракт упирается в реку: от моста остались два обломанных пролёта и обломки на берегах.',
    biomes: ALL, fallback: 'river_crossing',
    relief: 'rolling', water: 'river_wide', course: 'across', cliffs: 0.2, wetlands: 0.3, road: 'through',
    vegetation: veg(0.95, 1, 0.9), composition: comp('crossing', 0.11, 2, 3, 1, 0.35), features: ['broken_bridge'],
  },
  {
    id: 'bandit_camp', category: 'architectural', label: 'Лагерь бандитов',
    description: 'Укрытый в чаще лагерь: шатры вокруг кострища, ящики с добычей, частокол с одной стороны.',
    biomes: ['forest', 'swamp', 'snow', 'plains', 'desert'], fallback: 'fortified_camp',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.15, wetlands: 0.2, road: 'optional',
    vegetation: veg(1.3, 1.3, 0.8), composition: comp('thirds', 0.14, 1, 4, 1.1, 0.55), features: ['camp_tents'],
  },
  {
    id: 'fortified_camp', category: 'architectural', label: 'Укреплённый лагерь',
    description: 'Кольцо частокола с воротами, ряды палаток внутри, коновязь и дозорный пост.',
    biomes: ALL, fallback: 'bandit_camp',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0, road: 'optional',
    vegetation: veg(0.7, 0.8, 0.6), composition: comp('center', 0.2, 1, 2, 0.8, 0.3), features: ['palisade', 'camp_tents'],
  },
  {
    id: 'trading_post', category: 'architectural', label: 'Торговый пост',
    description: 'Фактория на развилке трактов: дом торговца, загон, телеги и прилавки под навесами.',
    biomes: ALL, fallback: 'caravan_wreck',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0.1, road: 'through',
    vegetation: veg(0.65, 0.8, 0.5), composition: comp('road', 0.16, 1, 2, 0.8, 0.35), features: ['trading_post'],
  },
  {
    id: 'abandoned_watchtower', category: 'architectural', label: 'Заброшенная сторожевая башня',
    description: 'Полуразрушенная башня на возвышенности, обломки частокола и осыпь камня у подножия.',
    biomes: ALL, fallback: 'ruined_fortress',
    relief: 'ridge', water: 'none', course: 'none', cliffs: 0.45, wetlands: 0, road: 'optional',
    vegetation: veg(0.8, 0.9, 1.2), composition: comp('axis', 0.12, 1, 2, 0.9, 0.4), features: ['watchtower'],
  },
  {
    id: 'fortress_courtyard', category: 'architectural', label: 'Двор крепости',
    description: 'Внутренний двор за высокими стенами: ворота, казарма, башни по углам, колодец и плац.',
    biomes: ['plains', 'snow', 'desert', 'forest'], fallback: 'ruined_fortress',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0, road: 'none',
    vegetation: veg(0.25, 0.4, 0.3), composition: comp('center', 0.2, 2, 0, 0, 0.2), features: ['curtain_walls'],
  },
  {
    id: 'walled_square', category: 'architectural', label: 'Площадь за стенами',
    description: 'Мощёная площадь, окружённая стеной с воротами: фонтан, торговые ряды и скамьи.',
    biomes: ['plains', 'desert', 'snow', 'forest'], fallback: 'trading_post',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0, road: 'none',
    vegetation: veg(0.3, 0.4, 0.2), composition: comp('center', 0.22, 1, 0, 0, 0.15), features: ['walled_square'],
  },
  // ---------------- особые ----------------
  {
    id: 'ritual_site', category: 'special', label: 'Ритуальное место',
    description: 'Круг стоячих камней с алтарём в центре, вытоптанная земля и следы недавнего обряда.',
    biomes: ALL, fallback: 'ancient_shrine',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0.05, wetlands: 0.1, road: 'none',
    vegetation: veg(0.9, 0.9, 0.7), composition: comp('thirds', 0.17, 1, 3, 1, 0.45), features: ['stone_circle'],
  },
  {
    id: 'caravan_wreck', category: 'special', label: 'Разбитый караван',
    description: 'На тракте — опрокинутые повозки, разбросанный груз и следы нападения.',
    biomes: ALL, fallback: 'abandoned_forest_road',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.1, wetlands: 0.1, road: 'through',
    vegetation: veg(0.85, 0.9, 0.9), composition: comp('road', 0.13, 1, 3, 1, 0.45), features: ['caravan_wreck'],
  },
  {
    id: 'ancient_shrine', category: 'special', label: 'Древнее святилище',
    description: 'Маленькое святилище на мощёной площадке: идол, чаши подношений, свечи и тропа к нему.',
    biomes: ALL, fallback: 'ritual_site',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.1, wetlands: 0.1, road: 'none',
    vegetation: veg(1.1, 1.1, 0.7), composition: comp('thirds', 0.12, 1, 3, 1, 0.5), features: ['shrine'],
  },
  {
    id: 'giant_tree_glade', category: 'special', label: 'Поляна с гигантским деревом',
    description: 'В центре поляны — исполинское древнее дерево, корни расходятся по земле, вокруг — светлый луг.',
    biomes: ['forest', 'plains', 'swamp', 'snow'], fallback: 'glade',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0.2, road: 'none',
    vegetation: veg(1.15, 1, 0.5), composition: comp('center', 0.2, 1, 3, 1.1, 0.25), features: ['giant_tree', 'flower_meadow'],
  },
  {
    id: 'graveyard', category: 'special', label: 'Кладбище',
    description: 'Огороженное кладбище: неровные ряды надгробий, склепы и мавзолей, мёртвые деревья у ограды.',
    biomes: ALL, fallback: 'ritual_site',
    relief: 'gentle', water: 'none', course: 'none', cliffs: 0, wetlands: 0.1, road: 'optional',
    vegetation: veg(0.6, 0.8, 0.5), composition: comp('center', 0.2, 1, 2, 0.8, 0.3), features: ['graveyard'],
  },
  {
    id: 'battlefield', category: 'special', label: 'Поле битвы',
    description: 'Открытое поле после сражения: воронки и рытвины, брошенное оружие, разбитые повозки и павшие.',
    biomes: ['plains', 'snow', 'desert', 'forest'], fallback: 'caravan_wreck',
    relief: 'rolling', water: 'none', course: 'none', cliffs: 0.05, wetlands: 0.15, road: 'optional',
    vegetation: veg(0.4, 0.6, 0.8), composition: comp('center', 0.22, 2, 1, 0.7, 0.35), features: ['battlefield'],
  },
  {
    id: 'abandoned_mine', category: 'special', label: 'Заброшенная шахта',
    description: 'Штольня в скальном склоне с крепью, рельсы и вагонетки, отвалы породы и развалины сараев.',
    biomes: ALL, fallback: 'cave_entrance',
    relief: 'cliffside', water: 'none', course: 'none', cliffs: 0.85, wetlands: 0, road: 'track',
    vegetation: veg(0.6, 0.7, 1.4), composition: comp('cliff', 0.13, 1, 2, 0.8, 0.3), features: ['mine_entrance'],
  },
  {
    id: 'ancient_dungeon_entrance', category: 'special', label: 'Вход в древнее подземелье',
    description: 'Каменный портал в склоне холма: лестница уходит вниз, у входа — колонны, статуи стражей и обломки.',
    biomes: ALL, fallback: 'cave_entrance',
    relief: 'cliffside', water: 'none', course: 'none', cliffs: 0.7, wetlands: 0, road: 'optional',
    vegetation: veg(0.8, 0.9, 1.1), composition: comp('cliff', 0.14, 1, 2, 0.9, 0.35), features: ['dungeon_portal'],
  },
];

export const ARCHETYPE_CATEGORY_LABELS: Record<ArchetypeCategory, string> = {
  natural: 'Природные',
  architectural: 'Архитектурные',
  special: 'Особые',
};

const BY_ID = new Map(SCENE_ARCHETYPES.map((archetype) => [archetype.id, archetype]));

export const SCENE_ARCHETYPE_IDS: readonly string[] = SCENE_ARCHETYPES.map((archetype) => archetype.id);

export function getArchetype(id: string | undefined): SceneArchetypeDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isArchetypeId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

export function archetypeSupports(archetype: SceneArchetypeDef, biome: Biome): boolean {
  return archetype.biomes.includes(biome);
}

export interface ArchetypeResolution {
  archetype: SceneArchetypeDef;
  /** Что запросил пользователь (если пришлось заменить). */
  requested?: SceneArchetypeDef;
  /** Цепочка замен: «requested → … → archetype». */
  chain: string[];
}

/**
 * Совместимость с биомом и разумная замена. Идём по цепочке fallback (без
 * циклов), пока не найдём совместимый архетип; если цепочка не помогла —
 * берём первый совместимый из той же категории, затем любой совместимый.
 * Для неоткрытых биомов (пещера, подземелье, поселения) архетипы не действуют.
 */
export function resolveArchetype(id: string | undefined, biome: Biome): ArchetypeResolution | undefined {
  const requested = getArchetype(id);
  if (!requested || !OVERLAND_BIOMES.includes(biome)) return undefined;
  if (archetypeSupports(requested, biome)) return { archetype: requested, chain: [requested.id] };
  const chain = [requested.id];
  const visited = new Set<string>(chain);
  let current = requested;
  while (!visited.has(current.fallback)) {
    const next = getArchetype(current.fallback);
    if (!next) break;
    chain.push(next.id);
    visited.add(next.id);
    if (archetypeSupports(next, biome)) return { archetype: next, requested, chain };
    current = next;
  }
  const sameCategory = SCENE_ARCHETYPES.find((item) => item.category === requested.category && archetypeSupports(item, biome));
  const any = sameCategory ?? SCENE_ARCHETYPES.find((item) => archetypeSupports(item, biome));
  if (!any) return undefined;
  chain.push(any.id);
  return { archetype: any, requested, chain };
}
