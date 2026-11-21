import type { Point } from '../types';
/**
 * Структурный план карты.
 *
 * Генерация идёт сверху вниз: план → террейн → линейные объекты → зоны → POI →
 * группы → отдельные объекты → декор. План не зависит от рендера и хранится в
 * MapData как optional-поле, поэтому старые проекты остаются совместимыми.
 */

export type ZoneType =
  | 'dense_forest'
  | 'medium_forest'
  | 'sparse_forest'
  | 'clearing'
  | 'meadow'
  | 'forest_edge'
  | 'wetland'
  | 'rocky'
  | 'roadside'
  | 'riverbank'
  // Пещеры: залы, коридоры, берега подземных водоёмов и осыпи у стен.
  | 'chamber'
  | 'tunnel'
  | 'shore'
  | 'rubble';

export interface ZoneBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone {
  id: string;
  type: ZoneType;
  /** Целевая плотность растительности 0..1 внутри зоны. */
  density: number;
  bounds: ZoneBounds;
  /** Крупная зона может занимать десятки процентов карты. */
  area: number;
}

export type PoiType = 'ruins' | 'camp' | 'grove' | 'boulder_field' | 'clearing' | 'chamber' | 'pool' | 'entrance';

export interface Poi {
  id: string;
  type: PoiType;
  x: number;
  y: number;
  radius: number;
}

export type GroupType =
  | 'forest_cluster'
  | 'boulder_scene'
  | 'fallen_tree_scene'
  | 'clearing_edge'
  | 'roadside_line'
  // Пещеры: кольцо грибов в зале, осыпь у стены, сталагмиты.
  | 'mushroom_ring'
  | 'rubble_pile'
  | 'stalagmite_cluster'
  // Склепы: ряды саркофагов, сцена алтаря, груда сокровищ, пост стражи, хлам.
  | 'coffin_row'
  | 'altar_scene'
  | 'treasure_pile'
  | 'guard_post'
  | 'storage_clutter';

export interface ObjectGroup {
  id: string;
  type: GroupType;
  x: number;
  y: number;
  /** Сколько объектов реально поставлено (для отладки и валидатора). */
  placed: number;
}

/** Узел дорожной сети: вход с карты, перекрёсток или точка интереса. */
export interface RoadNode {
  id: string;
  kind: 'entrance' | 'junction' | 'poi';
  x: number;
  y: number;
}

/** Уложенный участок дороги: центральная линия, ширина и число мостов. */
export interface RoadPath {
  id: string;
  type: 'main' | 'trail';
  width: number;
  points: { x: number; y: number }[];
  bridges: number;
  /** Чем покрыта лента: земляной тракт или каменная площадь города. */
  surface?: 'road' | 'plaza';
}

/** Мост как объект: точка переправы, ось по дороге, длина и ширина. */
export interface Bridge {
  id: string;
  /** Центр настила в клетках. */
  x: number;
  y: number;
  /** Угол оси настила (рад), совпадает с направлением дороги на переправе. */
  angle: number;
  /** Длина настила в клетках (включая заход на берега). */
  length: number;
  width: number;
  /** Клетки русла, которые накрывает настил. */
  cells: Point[];
  pathId: string;
}

export interface RoadGraphEdge {
  from: string;
  to: string;
  length: number;
}

export interface RoadNetwork {
  nodes: RoadNode[];
  paths: RoadPath[];
  graph: RoadGraphEdge[];
}

export type RoomPurpose = 'entrance' | 'hall' | 'guard' | 'storage' | 'crypt' | 'treasury';

/** Описание зала подземелья: назначение и глубина от входа. */
export interface DungeonRoom {
  id: string;
  purpose: RoomPurpose;
  bounds: ZoneBounds;
  /** Сколько рёбер графа от входа (0 — вход). */
  depth: number;
}

export interface GenerationPlan {
  version: 1;
  engine: 'structured';
  zones: Zone[];
  poi: Poi[];
  groups: ObjectGroup[];
  /** Что именно починила авто-починка (читается в отчёте UI). */
  actions?: string[];
  /** Точка, где начинают партию игроки: вход в пещеру, первый зал, начало тракта. */
  spawn?: Point;
  /** Осевая линия реки: по ней рендер рисует гладкую ленту воды. */
  river?: Point[];
  /** Ширина русла в клетках (1 или 2). */
  riverWidth?: number;
  /** Результат валидации и починки карты после генерации. */
  report?: import('./validate').MapReport;
  /** Залы подземелья с назначением (optional — только для dungeon/crypt). */
  rooms?: DungeonRoom[];
  /** Граф связности залов. */
  graph?: RoadGraphEdge[];
  /** Композиция карты: свободные пространства, массы, переходы, тактика. */
  composition?: import('./composition').MapComposition;
  /** Сцена карты (MACRO-решения: архетип, река/переправа, дорога, пространства). */
  scene?: import('./scene').ScenePlan;
  /** Дорожная сеть как граф (optional — старые планы её не содержат). */
  roads?: RoadPath[];
  /** Мосты, спроектированные вместе с переправой (ось по дороге). */
  bridges?: Bridge[];
  roadGraph?: RoadGraphEdge[];
}

export const emptyPlan = (): GenerationPlan => ({
  version: 1,
  engine: 'structured',
  zones: [],
  poi: [],
  groups: [],
});
