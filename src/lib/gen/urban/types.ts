import { mulberry32 } from '../../random';
import type { Building, Cell, ChestRotation, CivicObject, Point, Selection, Terrain, Tree } from '../../types';
import type {
  DistrictKind,
  Geography,
  GrowthStage,
  SettlementLayoutId,
  SettlementTypeDef,
  UrbanCharacterDef,
  UrbanCharacterId,
} from '../settlementTypes';

/** 4 основных уровня уличной иерархии (+ 5 для внутренних проходов дворов):
 * 1 = PRIMARY ROAD, 2 = SECONDARY ROAD, 3 = ALLEY, 4 = FOOTPATH, 5 = COURTYARD PASSAGE
 */
export type UrbanRoadLevel = 1 | 2 | 3 | 4 | 5;

/** Пространственные зоны градиента плотности (от старого ядра до дикой природы). */
export type UrbanZone =
  | 'old_core'
  | 'inner_city'
  | 'residential'
  | 'outer_city'
  | 'suburbs'
  | 'wilderness';

export const URBAN_ZONE_ORDER: readonly UrbanZone[] = [
  'old_core',
  'inner_city',
  'residential',
  'outer_city',
  'suburbs',
  'wilderness',
];

export type CourtyardKind =
  | 'enclosed_courtyard'
  | 'garden_yard'
  | 'workshop_yard'
  | 'inn_yard'
  | 'trade_courtyard'
  | 'private_garden'
  | 'temple_courtyard';

export type EmptySpaceKind =
  | 'street'
  | 'plaza'
  | 'courtyard'
  | 'garden'
  | 'pocket_green'
  | 'vacant_lot'
  | 'wilderness';

export const EMPTY_SPACE_ORDER: readonly EmptySpaceKind[] = [
  'street',
  'plaza',
  'courtyard',
  'garden',
  'pocket_green',
  'vacant_lot',
  'wilderness',
];

export type UrbanNodeKind =
  | 'origin'
  | 'center'
  | 'plaza'
  | 'market'
  | 'gate'
  | 'bridge'
  | 'port'
  | 'keep'
  | 'temple'
  | 'town_hall'
  | 'tavern'
  | 'caravan'
  | 'junction'
  | 'suburb';

export interface UrbanNode {
  id: string;
  kind: UrbanNodeKind;
  x: number;
  y: number;
  priority: number;
  label: string;
}

export interface UrbanRouteEdge {
  from: string;
  to: string;
  level: UrbanRoadLevel;
  points: Point[];
}

export interface UrbanLane {
  points: Point[];
  width: number;
  surface: 'road' | 'plaza';
  level: UrbanRoadLevel;
  reason: string;
}

export type PlotFunction =
  | 'small_residential'
  | 'large_residential'
  | 'noble_villa'
  | 'workshop'
  | 'shop'
  | 'warehouse'
  | 'temple'
  | 'town_hall'
  | 'tavern'
  | 'stable'
  | 'garrison'
  | 'courtyard'
  | 'garden'
  | 'empty'
  | 'farm';

export type LandmarkKind =
  | 'town_hall'
  | 'main_temple'
  | 'minor_temple'
  | 'citadel'
  | 'barracks'
  | 'prison'
  | 'smithy'
  | 'tavern'
  | 'warehouse'
  | 'mill'
  | 'public_baths'
  | 'cemetery'
  | 'plaza'
  | 'fountain'
  | 'monument'
  | 'well'
  | 'gate';

export interface UrbanLandmark {
  id: string;
  kind: LandmarkKind;
  label: string;
  x: number;
  y: number;
  bounds: Selection;
  district: DistrictKind;
  accessible: boolean;
}

export interface AdventureChain {
  id: string;
  kind: 'smuggler_route' | 'tavern_backyard' | 'wall_watch' | 'dock_warehouse' | 'temple_crypt';
  label: string;
  points: Point[];
}

export interface UrbanPlot {
  id: number;
  blockId?: number;
  /** Контур участка в клетках (углы полигона). */
  polygon: Point[];
  bounds: Selection;
  /** Место под главное здание на участке (у улицы или за парадным двором). */
  buildRect?: Selection;
  /** Внутренний двор / сад / хозяйственная зона участка. */
  yardRect?: Selection;
  /** Слот под вторичную постройку в глубине двора (сарай, мастерская, конюшня, склад). */
  secondaryRect?: Selection;
  courtyardKind?: CourtyardKind;
  districtIndex: number;
  districtType: DistrictKind;
  zone: UrbanZone;
  size: number;
  frontage: number;
  depth: number;
  orientation: ChestRotation;
  roadAccess?: Point;
  roadLevel: UrbanRoadLevel;
  /** Нужен ли явный 1-клеточный проход сбоку от дома к двору/вторичной постройке. */
  needsPassage?: boolean;
  wealth: number;
  age: GrowthStage;
  fn: PlotFunction;
  landmark?: LandmarkKind;
}

export type DistrictPlacementFailureReason =
  | 'no_waterfront'
  | 'insufficient_spacing'
  | 'no_valid_land'
  | 'outside_walls'
  | 'steep_slope'
  | 'reserved_collision';

export interface DistrictPlacementFailure {
  kind: DistrictKind;
  mandatory: boolean;
  reason: DistrictPlacementFailureReason;
  message: string;
}

export interface SpatialReservation {
  id: string;
  kind: 'keep' | 'parade_ground' | 'market_plaza' | 'port_quay' | 'gate_yard' | 'temple_precinct';
  bounds: Selection;
  cells: number;
}

export interface DistrictPlacementDiagnostics {
  plannedDistricts: number;
  placedDistricts: number;
  omittedDistricts: number;
  mandatoryPlanned: number;
  mandatoryPlaced: number;
  optionalPlanned: number;
  optionalPlaced: number;
  districtsByKind: Partial<Record<DistrictKind, number>>;
  usableArea: number;
  reservedArea: number;
  assignedArea: number;
  unassignedArea: number;
  districtPlacementFailures: DistrictPlacementFailure[];
  placementWarnings: string[];
}

export interface UrbanDistrict {
  index: number;
  kind: DistrictKind;
  label: string;
  x: number;
  y: number;
  wealth: number;
  age: GrowthStage;
  area: number;
  plotCount: number;
  mandatory?: boolean;
}

export interface UrbanBlock {
  id: number;
  cells: number[];
  bounds: Selection;
  districtIndex: number;
  districtKind: DistrictKind;
  zone: UrbanZone;
  shape: 'rectangular' | 'elongated' | 'trapezoid' | 'irregular' | 'corner' | 'triangular';
  wealth: number;
  age: GrowthStage;
  irregularity: number;
  anomaly?: 'old_enclave' | 'pocket_green' | 'ruined_lot' | 'terrace';
}

export interface RankedCivic {
  item: CivicObject;
  /** Индекс здания в plots, с которым связан предмет (-1 — городской каркас, есть при любой плотности). */
  plotRank: number;
}

export interface SettlementQualityReport {
  /** Итоговая оценка 0..100. */
  score: number;
  roadConnectivity: number;      // 0..20
  districtCoherence: number;     // 0..15
  landmarkPlacement: number;     // 0..15
  terrainAdaptation: number;     // 0..15
  plotQuality: number;           // 0..10
  buildingAccessibility: number; // 0..10
  urbanHierarchy: number;        // 0..10
  visualVariation: number;       // 0..5
  /** Доля уличных клеток в главной связной компоненте (0..1). */
  connectivity: number;
  /** Доля доступных зданий и ключевых точек (0..1). */
  accessibility: number;
  /** Приспособленность к рельефу и воде (0..1). */
  terrainFit: number;
  /** Доля крыш в старом ядре/внутреннем городе (0..1). */
  coreDensity: number;
  /** Доля крыш на окраинах/пригородах (0..1). */
  fringeDensity: number;
  /** Количество размещённых вторичных дворовых построек. */
  secondaryBuildings: number;
  /** Доля случайной незанятой травы внутри центральных кварталов (0..1, чем меньше — тем лучше). */
  unaccountedGreenShare: number;
  repairs: string[];
}

export interface SettlementDebugData {
  step: number;
  gw: number;
  gh: number;
  zoneGrid: number[];
  densityGrid: number[];
  districtGrid: number[];
  blockGrid: number[];
  ageGrid: number[];
  terrainGrid: number[];
  riverGrid: number[];
  emptyGrid: number[];
  blocks: {
    id: number;
    x: number;
    y: number;
    w: number;
    h: number;
    zone: UrbanZone;
    shape: UrbanBlock['shape'];
    district?: DistrictKind;
  }[];
  lanes: { level: UrbanRoadLevel; width: number; pts: Point[] }[];
  plots: {
    x: number;
    y: number;
    w: number;
    h: number;
    zone?: UrbanZone;
    yard?: Selection;
    secondary?: Selection;
    courtyardKind?: CourtyardKind;
    fn: PlotFunction;
    wealth: number;
    orientation: ChestRotation;
    roadAccess?: Point;
  }[];
  activityGrid?: number[];
  intersections?: Point[];
  anchors?: { x: number; y: number; kind: string }[];
}

export interface GeographyContext {
  width: number;
  height: number;
  geography: Geography;
  side: 0 | 1 | 2 | 3;
  shoreDepth: number;
  cells: Cell[][];
  river: Point[];
  slope: Float32Array;
  waterDist: Uint16Array;
  terrainInfluence: Float32Array;
  forestEdge: Float32Array;
  crossingCandidates: Point[];
  terraceShelves: number[];
  retainingCells: Point[];
  fromEdge: (x: number, y: number) => number;
  along: (x: number, y: number) => number;
  at: (alongCoord: number, depthCoord: number) => Point;
  span: number;
  length: number;
}

export interface UrbanContext {
  seed: number;
  width: number;
  height: number;
  type: SettlementTypeDef;
  layout: SettlementLayoutId;
  character: UrbanCharacterDef;
  requestedCharacter?: UrbanCharacterId;
  town: boolean;
  small: boolean;
  tight: boolean;
  geo: GeographyContext;
  notes: string[];
  trees: Tree[];
  rocks: { x: number; y: number; r: number; v: number; pts: [number, number][] }[];
}

export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export const between = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const wet = (t: Terrain): boolean => t === 'water' || t === 'deepWater' || t === 'bridge';
export const waterOnly = (t: Terrain): boolean => t === 'water' || t === 'deepWater';

export function mix(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

export const stream = (seed: number, ...keys: number[]) => mulberry32(mix(seed, 0x7572626e, ...keys));
export const unit = (seed: number, ...keys: number[]): number => mix(seed, 0x7572626e, ...keys) / 4294967296;

export function pickWeighted<T>(options: readonly (readonly [T, number])[], roll: number): T {
  const usable = options.filter(([, w]) => w > 0);
  const total = usable.reduce((sum, [, w]) => sum + w, 0);
  let value = roll * total;
  for (const [option, w] of usable) {
    value -= w;
    if (value <= 0) return option;
  }
  return (usable[usable.length - 1] ?? options[0])[0];
}

export const facingVector = (facing: ChestRotation): readonly [number, number] =>
  facing === 0 ? [0, 1] : facing === 90 ? [-1, 0] : facing === 180 ? [0, -1] : [1, 0];

export function rectPolygon(r: Selection): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.w + r.x, y: r.y },
    { x: r.w + r.x, y: r.h + r.y },
    { x: r.x, y: r.h + r.y },
  ];
}

export type BuildingCandidate = {
  lot: Building;
  out: Point;
  district: number;
  plotId: number;
  priority: number;
  isLandmark?: boolean;
};
