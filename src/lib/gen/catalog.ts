import type { Biome, Terrain, TreeKind } from '../types';
import type { PoiType, ZoneType } from './plan';

/**
 * Единый каталог семантики спрайтов.
 *
 * Раньше смысл объектов был размазан по таблицам treeKinds / ART_SCALE /
 * MATERIALS / FURNITURE_FINISHES. Здесь всё в одном месте: что это за объект,
 * где он живёт, сколько места занимает, насколько близко к другим может стоять.
 * Рендер по-прежнему работает по старым именам (tree.kind = oak/pine/...),
 * поэтому каталог — надстройка, а не замена.
 */

export type ObjectKind = TreeKind | 'rock' | 'smallRock' | 'boulder';

export interface SpriteCatalogEntry {
  id: ObjectKind;
  type: 'vegetation' | 'rock';
  subtype: string;
  /** Крупный/средний/мелкий — задаёт базовый радиус для рендера. */
  scale: 'small' | 'medium' | 'large';
  /** Биомы, где объект встречается. Пустой массив = везде. */
  biomes: Biome[];
  preferredTerrain: Terrain[];
  avoid: Terrain[];
  /** Зоны, в которых объект уместен (для планировщика состава). */
  zones: ZoneType[];
  /** Занятая площадь в клетках. */
  footprint: { width: number; height: number };
  /** Минимальная дистанция до такого же класса объектов, в клетках. */
  minDistance: number;
  /** Базовый радиус r для Tree (рендер сам умножает на клетки). */
  radius: [number, number];
  drawOrder: number;
}

const entry = (e: SpriteCatalogEntry): SpriteCatalogEntry => e;

/**
 * Радиус крон в клетках: крупные деревья не должны свисать на полотно дороги.
 * Значение — минимальная дистанция (в клетках) от ствола до ближайшей дороги.
 */
const ROAD_CLEARANCE: Record<ObjectKind, number> = {
  oak: 3, pine: 3, dead: 3, cactus: 3,
  bush: 2, reed: 1, mushroom: 1,
  rock: 2, smallRock: 1, boulder: 3,
};

export const roadClearance = (kind: ObjectKind): number => ROAD_CLEARANCE[kind] ?? 0;

/**
 * Композиционный план биома: как зональная плотность переводится в объекты
 * и какие композиционные центры (POI) уместны.
 *
 * Это то, что отличает «лес» от «равнины»: в равнине лесополосы редкие и
 * собраны в рощи, в пустыне — скальные выходы и кактусы, в болоте — камыш
 * вдоль воды.
 */
export interface BiomePlan {
  density: Partial<Record<ZoneType, number>>;
  poi: PoiType[];
  poiCount: number;
}

export const BIOME_PLAN: Record<Biome, BiomePlan> = {
  forest: { density: {}, poi: ['grove', 'clearing', 'camp', 'boulder_field'], poiCount: 3 },
  plains: {
    density: { meadow: 0.5, clearing: 0.3, sparse_forest: 1.25, medium_forest: 1.1 },
    poi: ['grove', 'clearing', 'camp'],
    poiCount: 3,
  },
  swamp: {
    density: { wetland: 1.3, meadow: 0.65, clearing: 0.35 },
    poi: ['clearing', 'camp'],
    poiCount: 2,
  },
  desert: {
    density: { rocky: 1.2, clearing: 0.45, sparse_forest: 0.75 },
    poi: ['boulder_field', 'clearing', 'camp'],
    poiCount: 2,
  },
  snow: {
    density: { dense_forest: 1.15, clearing: 0.4, meadow: 0.7 },
    poi: ['grove', 'clearing', 'camp'],
    poiCount: 2,
  },
  village: { density: { meadow: 0.7, sparse_forest: 0.8 }, poi: ['clearing', 'camp'], poiCount: 1 },
  town: { density: { meadow: 0.7, sparse_forest: 0.8 }, poi: ['clearing'], poiCount: 1 },
  cave: { density: {}, poi: [], poiCount: 0 },
  dungeon: { density: {}, poi: [], poiCount: 0 },
};

export const biomeDensity = (biome: Biome, zone: ZoneType): number => BIOME_PLAN[biome]?.density[zone] ?? 1;
export const biomePois = (biome: Biome): PoiType[] => BIOME_PLAN[biome]?.poi ?? [];
export const biomePoiCount = (biome: Biome): number => BIOME_PLAN[biome]?.poiCount ?? 2;

export const SPRITE_CATALOG: Record<ObjectKind, SpriteCatalogEntry> = {
  oak: entry({
    id: 'oak', type: 'vegetation', subtype: 'broadleaf', scale: 'large',
    biomes: ['forest', 'plains', 'village', 'town'],
    preferredTerrain: ['grass', 'darkGrass', 'dirt'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'door', 'void', 'rock'],
    zones: ['dense_forest', 'medium_forest', 'sparse_forest', 'forest_edge', 'clearing'],
    // Кроны могут перекрываться — резервируем только клетку ствола.
    footprint: { width: 1, height: 1 }, minDistance: 0.85, radius: [0.55, 0.82], drawOrder: 20,
  }),
  pine: entry({
    id: 'pine', type: 'vegetation', subtype: 'conifer', scale: 'large',
    biomes: ['forest', 'snow', 'village'],
    preferredTerrain: ['grass', 'darkGrass', 'snow', 'dirt'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'void'],
    zones: ['dense_forest', 'medium_forest', 'forest_edge'],
    footprint: { width: 1, height: 1 }, minDistance: 0.8, radius: [0.5, 0.75], drawOrder: 20,
  }),
  bush: entry({
    id: 'bush', type: 'vegetation', subtype: 'shrub', scale: 'small',
    biomes: ['forest', 'plains', 'village', 'town', 'swamp', 'desert'],
    preferredTerrain: ['grass', 'darkGrass', 'dirt', 'mud', 'sand'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'void'],
    zones: ['medium_forest', 'sparse_forest', 'clearing', 'forest_edge', 'meadow', 'roadside', 'riverbank'],
    footprint: { width: 1, height: 1 }, minDistance: 0.55, radius: [0.22, 0.38], drawOrder: 22,
  }),
  dead: entry({
    id: 'dead', type: 'vegetation', subtype: 'dead_tree', scale: 'large',
    biomes: ['swamp', 'desert', 'snow', 'forest'],
    preferredTerrain: ['dirt', 'mud', 'sand', 'snow', 'darkGrass'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'void'],
    zones: ['wetland', 'rocky', 'sparse_forest', 'forest_edge'],
    footprint: { width: 1, height: 1 }, minDistance: 1.2, radius: [0.42, 0.68], drawOrder: 20,
  }),
  cactus: entry({
    id: 'cactus', type: 'vegetation', subtype: 'succulent', scale: 'medium',
    biomes: ['desert'],
    preferredTerrain: ['sand', 'dirt', 'rock'],
    avoid: ['water', 'deepWater', 'road', 'bridge'],
    zones: ['rocky', 'sparse_forest', 'clearing'],
    footprint: { width: 1, height: 1 }, minDistance: 1.3, radius: [0.34, 0.58], drawOrder: 21,
  }),
  mushroom: entry({
    id: 'mushroom', type: 'vegetation', subtype: 'fungus', scale: 'small',
    biomes: ['swamp', 'cave', 'forest', 'dungeon'],
    preferredTerrain: ['grass', 'darkGrass', 'mud', 'caveFloor', 'floor'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'void'],
    zones: ['wetland', 'medium_forest', 'dense_forest', 'forest_edge'],
    footprint: { width: 1, height: 1 }, minDistance: 0.7, radius: [0.16, 0.3], drawOrder: 24,
  }),
  reed: entry({
    id: 'reed', type: 'vegetation', subtype: 'reed', scale: 'small',
    biomes: ['swamp'],
    preferredTerrain: ['mud', 'grass', 'darkGrass'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'void'],
    zones: ['wetland', 'riverbank'],
    footprint: { width: 1, height: 1 }, minDistance: 0.7, radius: [0.2, 0.34], drawOrder: 23,
  }),
  rock: entry({
    id: 'rock', type: 'rock', subtype: 'boulder', scale: 'medium',
    biomes: ['forest', 'plains', 'swamp', 'desert', 'snow', 'cave', 'dungeon'],
    preferredTerrain: ['grass', 'dirt', 'sand', 'snow', 'rock', 'caveFloor', 'floor'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'void'],
    zones: ['rocky', 'sparse_forest', 'clearing', 'forest_edge', 'roadside'],
    footprint: { width: 1, height: 1 }, minDistance: 0.9, radius: [0.24, 0.45], drawOrder: 18,
  }),
  smallRock: entry({
    id: 'smallRock', type: 'rock', subtype: 'stone', scale: 'small',
    biomes: ['forest', 'plains', 'swamp', 'desert', 'snow', 'cave', 'dungeon'],
    preferredTerrain: ['grass', 'dirt', 'sand', 'snow', 'rock', 'caveFloor', 'floor', 'road'],
    avoid: ['water', 'deepWater', 'wall', 'void'],
    zones: ['rocky', 'sparse_forest', 'clearing', 'roadside', 'forest_edge'],
    footprint: { width: 1, height: 1 }, minDistance: 0.55, radius: [0.16, 0.3], drawOrder: 19,
  }),
  boulder: entry({
    id: 'boulder', type: 'rock', subtype: 'boulder', scale: 'large',
    biomes: ['forest', 'plains', 'swamp', 'desert', 'snow'],
    preferredTerrain: ['grass', 'dirt', 'sand', 'snow'],
    avoid: ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'void'],
    zones: ['rocky', 'clearing', 'forest_edge'],
    footprint: { width: 2, height: 2 }, minDistance: 2.2, radius: [0.6, 0.9], drawOrder: 17,
  }),
};

/** Растительность, уместная в зоне для конкретного биома. */
export function vegetationForZone(biome: Biome, zone: ZoneType): { kind: TreeKind; weight: number }[] {
  const inZone = Object.values(SPRITE_CATALOG).filter(
    (e) => e.type === 'vegetation' && e.zones.includes(zone) && e.biomes.includes(biome),
  );
  return inZone.map((e) => ({ kind: e.id as TreeKind, weight: weightFor(e, zone) }));
}

function weightFor(e: SpriteCatalogEntry, zone: ZoneType): number {
  if (zone === 'dense_forest') return e.scale === 'large' ? 3 : 1;
  if (zone === 'medium_forest') return e.scale === 'large' ? 2 : 2;
  if (zone === 'sparse_forest') return e.scale === 'large' ? 1 : 2.4;
  if (zone === 'clearing' || zone === 'meadow') return e.scale === 'small' ? 2 : 0.8;
  if (zone === 'forest_edge') return e.scale === 'small' ? 2.2 : 1.4;
  if (zone === 'roadside' || zone === 'riverbank') return e.scale === 'small' ? 2.5 : 1;
  if (zone === 'wetland') return e.subtype === 'reed' || e.subtype === 'fungus' ? 3 : 1;
  if (zone === 'rocky') return e.subtype === 'dead_tree' || e.subtype === 'succulent' ? 2 : 1;
  return 1;
}

/** Взвешенный выбор вида по зоне и биому (детерминированный). */
export function pickVegetation(
  rng: { next: () => number },
  biome: Biome,
  zone: ZoneType,
): TreeKind | null {
  const options = vegetationForZone(biome, zone);
  if (!options.length) return null;
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng.next() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.kind;
  }
  return options[options.length - 1].kind;
}
