import type { RoadPath } from './gen/plan';
import type { DistrictKind } from './gen/settlementTypes';
import type { MapData } from './types';

export const ROAD_MATERIAL_IDS = [
  'road_packed_dirt',
  'road_gravel',
  'road_old_cobblestone',
  'road_worn_cobblestone',
  'road_noble_paving',
  'road_damaged_stone',
] as const;

export type RoadMaterialId = (typeof ROAD_MATERIAL_IDS)[number];
export type RoadMaterialSetting = 'auto' | RoadMaterialId;

export const CASTLE_WALL_MATERIAL_IDS = [
  'castle_wall_stone',
  'castle_wall_dressed_stone',
  'castle_wall_weathered',
] as const;

export type CastleWallMaterialId = (typeof CASTLE_WALL_MATERIAL_IDS)[number];
export type CastleWallMaterialSetting = 'auto' | CastleWallMaterialId;

export function isRoadMaterialSetting(v: unknown): v is RoadMaterialSetting {
  return v === 'auto' || (typeof v === 'string' && (ROAD_MATERIAL_IDS as readonly string[]).includes(v));
}

export function isCastleWallMaterialSetting(v: unknown): v is CastleWallMaterialSetting {
  return v === 'auto' || (typeof v === 'string' && (CASTLE_WALL_MATERIAL_IDS as readonly string[]).includes(v));
}

const RURAL_VILLAGE_TYPES = new Set(['small_village', 'large_village', 'frontier_outpost']);
const GRAVEL_SETTLEMENT_TYPES = new Set(['mountain', 'fortress']);

function districtAtPoint(map: MapData, x: number, y: number): {
  kind?: DistrictKind | 'suburbs';
  wealth: number;
  stage?: string;
} {
  const districts = map.plan?.settlement?.districts;
  if (!districts || districts.length === 0) {
    return { wealth: map.biome === 'town' ? 0.52 : 0.32 };
  }
  let bestKind: DistrictKind | 'suburbs' | undefined;
  let bestWealth = 0.5;
  let bestStage: string | undefined;
  let bestScore = Infinity;
  for (const d of districts) {
    const rad = Math.max(7, Math.sqrt((d.area ?? 180) / Math.PI));
    const distNorm = Math.hypot(x - d.x, y - d.y) / rad;
    if (distNorm < bestScore) {
      bestScore = distNorm;
      bestKind = d.kind;
      bestWealth = d.wealth ?? 0.5;
      bestStage = d.age;
    }
  }
  if (bestScore > 1.55) {
    return { kind: 'suburbs', wealth: 0.32, stage: 'suburbs' };
  }
  return { kind: bestKind, wealth: bestWealth, stage: bestStage };
}

function isSettlementRuinedOrWorn(map: MapData): { ruined: boolean; worn: boolean; noble: boolean } {
  const s = map.plan?.settlement;
  const charId: string = s?.character ?? '';
  const mp = s?.materialProfile;
  const ruined = charId === 'ruined'
    || charId === 'war_torn'
    || (mp !== undefined && mp.preservation < 0.42)
    || (map.structures?.length > 0 && map.structures.every((st) => st.ruin));
  const worn = ruined
    || charId === 'poor'
    || (mp !== undefined && mp.maintenance < 0.46 && mp.age > 0.62)
    || Boolean(map.buildings?.length && map.buildings[0]?.cityCondition === 'worn');
  const noble = charId === 'noble'
    || charId === 'prosperous'
    || (mp !== undefined && mp.wealth >= 0.74 && mp.maintenance >= 0.68);
  return { ruined, worn, noble };
}

/**
 * Контекстный выбор дорожного покрытия для клетки карты (Phase 2.5):
 * учитывает биом, тип поселения, квартал, достаток, сохранность и удалённость от ядра.
 */
export function selectCellRoadMaterial(
  map: MapData,
  x: number,
  y: number,
  override?: RoadMaterialSetting,
): RoadMaterialId {
  if (override && override !== 'auto') return override;

  const { ruined, worn, noble } = isSettlementRuinedOrWorn(map);
  const s = map.plan?.settlement;

  // Открытые природные биомы вне поселений: грунтовая дорога (или разбитая каменная кладка у руин).
  if (map.biome !== 'village' && map.biome !== 'town') {
    if (ruined) {
      for (const st of map.structures ?? []) {
        if (x >= st.x - 4 && x <= st.x + st.w + 4 && y >= st.y - 4 && y <= st.y + st.h + 4) {
          return 'road_damaged_stone';
        }
      }
    }
    if (map.biome === 'cave') return 'road_gravel';
    if (map.biome === 'dungeon') return worn ? 'road_damaged_stone' : 'road_old_cobblestone';
    return 'road_packed_dirt';
  }

  // Деревни и пограничные заставы: утрамбованная земля и гравий на главной дороге.
  if (map.biome === 'village' || (s?.type && RURAL_VILLAGE_TYPES.has(s.type))) {
    if (ruined) return 'road_damaged_stone';
    const d = districtAtPoint(map, x, y);
    if (d.kind === 'market' || d.kind === 'centre') return 'road_gravel';
    return 'road_packed_dirt';
  }

  // Городские поселения (town / typed towns & cities):
  const d = districtAtPoint(map, x, y);
  if (ruined) {
    return d.stage === 'suburbs' ? 'road_packed_dirt' : 'road_damaged_stone';
  }
  if (d.kind === 'farms') {
    return 'road_packed_dirt';
  }
  if (d.kind === 'suburbs' || d.stage === 'suburbs') {
    return 'road_gravel';
  }
  if (d.kind === 'poor') {
    return 'road_damaged_stone';
  }
  if (d.kind === 'noble' || d.kind === 'temple' || (d.kind === 'centre' && (d.wealth >= 0.68 || noble))) {
    return worn ? 'road_worn_cobblestone' : 'road_noble_paving';
  }
  if (d.kind === 'market' || d.kind === 'docks') {
    return worn ? 'road_damaged_stone' : 'road_worn_cobblestone';
  }
  if (d.kind === 'garrison' || (s?.type && GRAVEL_SETTLEMENT_TYPES.has(s.type) && d.kind !== 'centre')) {
    return d.wealth >= 0.6 ? 'road_old_cobblestone' : 'road_gravel';
  }
  if (worn) return 'road_damaged_stone';
  return 'road_old_cobblestone';
}

/**
 * Контекстный выбор дорожного покрытия и мягкой обочины для векторной дорожной ленты (`RoadPath`).
 */
export function resolveLaneRoadMaterial(
  map: MapData,
  lane: RoadPath,
  override?: RoadMaterialSetting,
): { surface: RoadMaterialId; shoulder: RoadMaterialId; paved: boolean } {
  if (override && override !== 'auto') {
    const paved = override !== 'road_packed_dirt' && override !== 'road_gravel';
    return {
      surface: override,
      shoulder: paved ? 'road_gravel' : 'road_packed_dirt',
      paved,
    };
  }

  const pts = lane.points;
  const mid = pts[Math.floor(pts.length / 2)] ?? { x: map.width / 2, y: map.height / 2 };
  const base = selectCellRoadMaterial(map, mid.x, mid.y);
  const h = lane.hierarchy ?? 2;
  const { ruined, worn, noble } = isSettlementRuinedOrWorn(map);

  // Сельские карты и деревни:
  if (map.biome !== 'town') {
    if (map.biome === 'village' && h === 1 && !ruined) {
      return { surface: 'road_gravel', shoulder: 'road_packed_dirt', paved: false };
    }
    return {
      surface: base,
      shoulder: 'road_packed_dirt',
      paved: base !== 'road_packed_dirt' && base !== 'road_gravel',
    };
  }

  // Городская иерархия улиц (1 — главная артерия, 2 — районная улица, 3 — переулок, 4 — дворовый проход):
  if (h >= 4) {
    const alley: RoadMaterialId = base === 'road_noble_paving'
      ? 'road_old_cobblestone'
      : base === 'road_damaged_stone' || worn
        ? 'road_damaged_stone'
        : 'road_packed_dirt';
    return { surface: alley, shoulder: 'road_packed_dirt', paved: alley !== 'road_packed_dirt' };
  }

  if (h === 3) {
    if (base === 'road_noble_paving') {
      return { surface: 'road_old_cobblestone', shoulder: 'road_gravel', paved: true };
    }
    if (base === 'road_packed_dirt' || base === 'road_gravel') {
      return { surface: base, shoulder: 'road_packed_dirt', paved: false };
    }
    const side: RoadMaterialId = worn || base === 'road_damaged_stone' ? 'road_damaged_stone' : 'road_gravel';
    return { surface: side, shoulder: 'road_packed_dirt', paved: side !== 'road_gravel' };
  }

  if (h === 1) {
    if (ruined) return { surface: 'road_damaged_stone', shoulder: 'road_gravel', paved: true };
    if (base === 'road_noble_paving' || noble) {
      return { surface: 'road_noble_paving', shoulder: 'road_old_cobblestone', paved: true };
    }
    if (base === 'road_packed_dirt') {
      return { surface: 'road_gravel', shoulder: 'road_packed_dirt', paved: false };
    }
    return {
      surface: worn ? 'road_damaged_stone' : 'road_worn_cobblestone',
      shoulder: 'road_gravel',
      paved: true,
    };
  }

  // h === 2 (обычные городские улицы):
  const paved = base !== 'road_packed_dirt' && base !== 'road_gravel';
  return {
    surface: base,
    shoulder: paved ? 'road_gravel' : 'road_packed_dirt',
    paved,
  };
}

/**
 * Выбор варианта каменной кладки крепостной стены поселения (Phase 3.3).
 */
export function resolveCastleWallMaterial(
  map: MapData,
  override?: CastleWallMaterialSetting,
): CastleWallMaterialId {
  if (override && override !== 'auto') return override;
  const s = map.plan?.settlement;
  const charId: string = s?.character ?? '';
  const mp = s?.materialProfile;
  const wornBuildings = Boolean(map.buildings?.length && map.buildings[0]?.cityCondition === 'worn');

  if (
    wornBuildings
    || charId === 'ruined'
    || charId === 'war_torn'
    || charId === 'poor'
    || (mp !== undefined && (mp.preservation < 0.52 || (mp.age > 0.72 && mp.maintenance < 0.5)))
  ) {
    return 'castle_wall_weathered';
  }

  if (
    s?.type === 'large_city'
    || charId === 'noble'
    || charId === 'prosperous'
    || (mp !== undefined && mp.wealth >= 0.7 && mp.maintenance >= 0.65)
  ) {
    return 'castle_wall_dressed_stone';
  }

  return 'castle_wall_stone';
}
