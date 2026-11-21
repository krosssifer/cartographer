import type { Terrain } from './types';

export type RGB = readonly [number, number, number];

export const TERRAIN_COLORS: Record<Terrain, RGB> = {
  deepWater: [32, 68, 73], water: [62, 111, 113], sand: [166, 144, 107],
  grass: [131, 137, 77], darkGrass: [88, 103, 60], dirt: [135, 108, 86], mud: [83, 79, 56],
  rock: [126, 124, 115], snow: [215, 224, 229], ice: [163, 190, 203],
  road: [164, 135, 97], bridge: [135, 99, 60], floor: [128, 122, 107],
  wall: [132, 122, 106], door: [130, 91, 56], caveFloor: [112, 108, 96],
  caveWall: [50, 49, 45], plaza: [177, 163, 140], buildingFloor: [145, 120, 88],
  buildingWall: [168, 157, 139], roof: [155, 109, 72], void: [24, 19, 16],
};

export const TERRAIN_LABELS: Record<Terrain, string> = {
  deepWater: 'Глубокая вода', water: 'Вода', sand: 'Песок / отмель', grass: 'Трава', darkGrass: 'Густая трава',
  dirt: 'Земля', mud: 'Топь', rock: 'Скалы', snow: 'Снег', ice: 'Лёд', road: 'Дорога', bridge: 'Мост',
  floor: 'Пол', wall: 'Стена', door: 'Дверь', caveFloor: 'Пол пещеры', caveWall: 'Порода',
  plaza: 'Площадь / улица', buildingFloor: 'Пол дома', buildingWall: 'Стены дома', roof: 'Крыша дома', void: 'Пустота',
};