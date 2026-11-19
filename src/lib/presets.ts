import type { Biome, CryptArchetype, GenSettings, RenderSettings } from './types';

export const CRYPT_ARCHETYPE_LABELS: Record<CryptArchetype, string> = {
  tomb: 'Усыпальница',
  catacombs: 'Катакомбы',
  temple: 'Храм',
  archive: 'Архив',
  prison: 'Тюрьма',
};
export const CRYPT_ARCHETYPE_IDS = Object.keys(CRYPT_ARCHETYPE_LABELS) as CryptArchetype[];

export const BIOME_LABELS: Record<Biome, string> = {
  forest: 'Лес',
  plains: 'Равнина',
  swamp: 'Болото',
  desert: 'Пустыня',
  snow: 'Снежные земли',
  cave: 'Пещера',
  dungeon: 'Подземелье',
  village: 'Деревня',
  town: 'Город',
};

export const DEFAULT_GEN: GenSettings = {
  seed: 1337,
  biome: 'forest',
  width: 36,
  height: 22,
  roughness: 0.5,
  waterLevel: 0.35,
  vegetation: 0.6,
  rocks: 0.4,
  structures: 1,
  ruined: true,
  river: true,
  road: true,
  caveOpenness: 0.5,
  rooms: 6,
  settlement: 'village',
  density: 0.42,
  publicSpaces: true,
  cryptDetail: .67,
  cryptTraps: true,
  cryptChasms: true,
  cryptArchetype: 'tomb',
};

export const STARTER_SETTLEMENT: GenSettings = { ...DEFAULT_GEN, biome: 'town', settlement: 'town', width: 48, height: 32, density: 0.58, vegetation: 0.65 };
export const STARTER_CRYPT: GenSettings = { ...DEFAULT_GEN, biome: 'dungeon', width: 44, height: 30, rooms: 8, cryptDetail: .72, rocks: .22 };

export const DEFAULT_RENDER: RenderSettings = {
  cellSize: 40,
  showGrid: true,
  gridType: 'square',
  gridOpacity: 0.38,
  gridColor: '#e5d9b9',
  shading: true,
  texture: true,
  wallThickness: 0.34,
  showTrees: true,
  showRocks: true,
  showStructures: true,
  showChests: true,
  showRoofs: true,
  showCivic: true,
  showCrypt: true,
  showSecrets: true,
  vignette: true,
};

export interface Preset {
  name: string;
  gen: Partial<GenSettings>;
}

export const PRESETS: Preset[] = [
  {
    name: 'Лесная опушка',
    gen: { biome: 'forest', roughness: 0.5, waterLevel: 0.32, vegetation: 0.7, rocks: 0.3, structures: 1, ruined: false, river: true, road: true },
  },
  {
    name: 'Развалины у дороги',
    gen: { biome: 'plains', roughness: 0.35, waterLevel: 0.25, vegetation: 0.4, rocks: 0.4, structures: 3, ruined: true, river: false, road: true },
  },
  {
    name: 'Гиблая топь',
    gen: { biome: 'swamp', roughness: 0.6, waterLevel: 0.42, vegetation: 0.7, rocks: 0.2, structures: 1, ruined: true, river: true, road: false },
  },
  {
    name: 'Оазис',
    gen: { biome: 'desert', roughness: 0.45, waterLevel: 0.45, vegetation: 0.5, rocks: 0.6, structures: 1, ruined: true, river: false, road: true },
  },
  {
    name: 'Перевал',
    gen: { biome: 'snow', roughness: 0.7, waterLevel: 0.3, vegetation: 0.5, rocks: 0.6, structures: 1, ruined: false, river: true, road: true },
  },
  {
    name: 'Грибная пещера',
    gen: { biome: 'cave', roughness: 0.5, waterLevel: 0.4, vegetation: 0.8, rocks: 0.6, caveOpenness: 0.5 },
  },
  {
    name: 'Склеп',
    gen: STARTER_CRYPT,
  },
  {
    name: 'Деревня у брода',
    gen: { biome: 'village', settlement: 'village', width: 44, height: 30, density: 0.34, vegetation: 0.7, rocks: 0.25, river: true, road: true, publicSpaces: true },
  },
  {
    name: 'Торговый город',
    gen: { ...STARTER_SETTLEMENT, width: 56, height: 38, density: 0.48 },
  },
];
