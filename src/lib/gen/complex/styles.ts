/**
 * Архитектурный стиль и состояние комплекса.
 *
 * Стиль — облик: материалы полов, колонны, двери, настенное убранство,
 * статуи, светильники, орнамент центра зала. Один стиль держится по всему
 * комплексу. Состояние — сохранность: проломы, обломки, вода, растения,
 * доля горящих светильников. Оба выбора не меняют граф и геометрию залов
 * (кроме проломов), потому что работают на своих потоках случайности.
 */
import type { CryptKind, DoorKind } from '../../types';
import type { RoomCategory } from '../plan';

/** Материал пола клетки: код одной буквой в MapData.floorLayer.codes. */
export type FloorMaterial = 'rough' | 'dressed' | 'marble' | 'brick' | 'mosaic' | 'tile' | 'wood' | 'metal' | 'worn' | 'natural';
export const FLOOR_CODES: Record<FloorMaterial, string> = {
  rough: 'r', dressed: 'd', marble: 'm', brick: 'b', mosaic: 'o', tile: 't', wood: 'w', metal: 'i', worn: 'x', natural: 'n',
};
export const FLOOR_LABELS: Record<FloorMaterial, string> = {
  rough: 'грубый камень', dressed: 'тёсаный камень', marble: 'мрамор', brick: 'старый кирпич', mosaic: 'мозаика',
  tile: 'плитка', wood: 'деревянный настил', metal: 'металл', worn: 'разбитое покрытие', natural: 'природная порода',
};
/** Допустимые символы кода пола: строчная — поле зала, заглавная — бордюр, '.' — без покрытия, n — природная порода. */
export const FLOOR_CODE_PATTERN = /^[.nrdmbotwixRDMBOTWIX]*$/;
export type Ornament = 'rosette' | 'star' | 'ring' | 'sun';

export interface DungeonStyle {
  id: string;
  label: string;
  /** Пол по месту: главный зал, обычный зал, служебный, коридор. */
  floors: { main: FloorMaterial; room: FloorMaterial; service: FloorMaterial; corridor: FloorMaterial; living: FloorMaterial };
  /** Бордюр у стен главных и религиозных залов. */
  border: boolean;
  ornament: Ornament | null;
  column: CryptKind;
  statues: CryptKind[];
  wall: CryptKind[];
  lights: { wall: CryptKind; stand: CryptKind; hall: CryptKind; ritual: CryptKind };
  doors: Partial<Record<DoorKind, number>>;
}

export const DUNGEON_STYLES: readonly DungeonStyle[] = [
  {
    id: 'dwarven', label: 'Дварфийский', floors: { main: 'tile', room: 'dressed', service: 'rough', corridor: 'dressed', living: 'dressed' },
    border: true, ornament: 'star', column: 'pillar', statues: ['statue', 'bust', 'pedestalStatue'], wall: ['banner', 'gearCog', 'toolRack'],
    lights: { wall: 'wallTorch', stand: 'brazierStand', hall: 'brazier', ritual: 'brazier' }, doors: { gate: 2, double: 1, portcullis: 1 },
  },
  {
    id: 'elven', label: 'Эльфийский', floors: { main: 'marble', room: 'marble', service: 'dressed', corridor: 'marble', living: 'wood' },
    border: true, ornament: 'rosette', column: 'pillar', statues: ['mournerStatue', 'bust', 'statue'], wall: ['tapestry', 'curtain', 'mirror'],
    lights: { wall: 'magicLamp', stand: 'magicLamp', hall: 'chandelier', ritual: 'crystalCluster' }, doors: { arch: 2, double: 1 },
  },
  {
    id: 'ancient', label: 'Древний', floors: { main: 'mosaic', room: 'dressed', service: 'rough', corridor: 'dressed', living: 'dressed' },
    border: true, ornament: 'sun', column: 'pillar', statues: ['obelisk', 'idol', 'statue', 'stoneEye'], wall: ['templeMask', 'ancientSigil', 'stoneEye'],
    lights: { wall: 'wallTorch', stand: 'brazierStand', hall: 'brazier', ritual: 'brazier' }, doors: { arch: 2, double: 1 },
  },
  {
    id: 'medieval', label: 'Средневековый', floors: { main: 'dressed', room: 'brick', service: 'rough', corridor: 'brick', living: 'wood' },
    border: false, ornament: null, column: 'pillar', statues: ['statue', 'bust'], wall: ['banner', 'tapestry', 'shelf'],
    lights: { wall: 'wallTorch', stand: 'candleStand', hall: 'chandelier', ritual: 'candles' }, doors: { normal: 2, double: 1 },
  },
  {
    id: 'necromantic', label: 'Некромантический', floors: { main: 'tile', room: 'dressed', service: 'rough', corridor: 'rough', living: 'dressed' },
    border: true, ornament: 'ring', column: 'pillar', statues: ['mournerStatue', 'idol', 'obelisk'], wall: ['chains', 'templeMask', 'skull'],
    lights: { wall: 'candleHolder', stand: 'candleStand', hall: 'candleWheel', ritual: 'runeCirclePurple' }, doors: { arch: 2, gate: 1 },
  },
  {
    id: 'religious', label: 'Религиозный', floors: { main: 'marble', room: 'dressed', service: 'dressed', corridor: 'tile', living: 'wood' },
    border: true, ornament: 'rosette', column: 'pillar', statues: ['statue', 'mournerStatue', 'pedestalStatue'], wall: ['tapestry', 'banner', 'bell'],
    lights: { wall: 'wallTorch', stand: 'candleStand', hall: 'chandelier', ritual: 'candles' }, doors: { double: 2, arch: 1 },
  },
  {
    id: 'industrial', label: 'Грубый индустриальный', floors: { main: 'metal', room: 'rough', service: 'rough', corridor: 'rough', living: 'wood' },
    border: false, ornament: null, column: 'beamSupport', statues: ['bust'], wall: ['toolRack', 'pulley', 'chainPulley'],
    lights: { wall: 'oilLamp', stand: 'brazierStand', hall: 'brazier', ritual: 'brazier' }, doors: { broken: 1, normal: 1, gate: 1 },
  },
  {
    id: 'primitive', label: 'Примитивный пещерный', floors: { main: 'rough', room: 'rough', service: 'rough', corridor: 'rough', living: 'rough' },
    border: false, ornament: null, column: 'rockSpire', statues: ['idol', 'boneCharm'], wall: ['ivyWall', 'roots', 'boneCharm'],
    lights: { wall: 'glowingMushroom', stand: 'pyre', hall: 'pyre', ritual: 'crystalCluster' }, doors: { arch: 3 },
  },
];

export interface DungeonCondition {
  id: string;
  label: string;
  /** Доля горящих светильников. */
  lit: number;
  /** Сколько стен между залами и пещерами проломить (доля кандидатов). */
  breaches: number;
  /** Обломки у повреждений и трещины в полу. */
  debris: number;
  /** Мох, корни, грибы. */
  growth: number;
  /** Вода: доля низин, затопленных водой. */
  flood: number;
  /** Паутина и пыль заброшенности. */
  neglect: number;
  /** Доля колонн, ставших обломками. */
  brokenColumns: number;
  /** Доля покрытия пола, разбитого до камня. */
  wornFloors: number;
  /** Обвалы: каменные осыпи у стен залов. */
  rockfall: number;
  /** Повторное заселение: свежие припасы и баррикады у входов в залы. */
  occupied: number;
}

export const DUNGEON_CONDITIONS: readonly DungeonCondition[] = [
  { id: 'preserved', label: 'Сохранённое', lit: .95, breaches: 0, debris: .05, growth: .02, flood: 0, neglect: .05, brokenColumns: 0, wornFloors: 0, rockfall: 0, occupied: 0 },
  { id: 'abandoned', label: 'Заброшенное', lit: .35, breaches: .1, debris: .3, growth: .15, flood: 0, neglect: .6, brokenColumns: .1, wornFloors: .12, rockfall: .05, occupied: 0 },
  { id: 'damaged', label: 'Повреждённое', lit: .5, breaches: .3, debris: .55, growth: .1, flood: 0, neglect: .3, brokenColumns: .25, wornFloors: .25, rockfall: .15, occupied: 0 },
  { id: 'ruined', label: 'Разрушенное', lit: .15, breaches: .6, debris: .9, growth: .35, flood: .05, neglect: .5, brokenColumns: .5, wornFloors: .45, rockfall: .35, occupied: 0 },
  { id: 'collapsed', label: 'Обрушенное', lit: .1, breaches: .5, debris: 1, growth: .1, flood: 0, neglect: .45, brokenColumns: .6, wornFloors: .5, rockfall: 1, occupied: 0 },
  { id: 'flooded', label: 'Частично затопленное', lit: .3, breaches: .15, debris: .35, growth: .25, flood: .35, neglect: .4, brokenColumns: .15, wornFloors: .3, rockfall: .1, occupied: 0 },
  { id: 'overgrown', label: 'Захваченное природой', lit: .2, breaches: .35, debris: .45, growth: .9, flood: .05, neglect: .3, brokenColumns: .3, wornFloors: .35, rockfall: .15, occupied: 0 },
  { id: 'reclaimed', label: 'Вновь заселённое', lit: .85, breaches: .2, debris: .2, growth: .04, flood: 0, neglect: .08, brokenColumns: .25, wornFloors: .3, rockfall: .05, occupied: 1 },
];

export const STYLE_IDS = DUNGEON_STYLES.map((s) => s.id);
export const CONDITION_IDS = DUNGEON_CONDITIONS.map((c) => c.id);
export const isStyleSetting = (v: unknown): boolean => v === 'auto' || STYLE_IDS.includes(v as string);
export const isConditionSetting = (v: unknown): boolean => v === 'auto' || CONDITION_IDS.includes(v as string);
export const getStyle = (id: string): DungeonStyle => DUNGEON_STYLES.find((s) => s.id === id) ?? DUNGEON_STYLES[0];
export const getCondition = (id: string): DungeonCondition => DUNGEON_CONDITIONS.find((c) => c.id === id) ?? DUNGEON_CONDITIONS[0];

/** Пол зала по стилю, категории и роли; состояние может разбить покрытие. */
export function floorFor(style: DungeonStyle, category: RoomCategory, major: boolean, natural: boolean): FloorMaterial {
  if (natural) return 'natural';
  if (major) return style.floors.main;
  if (category === 'utility') return style.floors.service;
  if (category === 'living') return style.floors.living;
  return style.floors.room;
}
