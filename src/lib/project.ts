import type { ChestRotation, EditorSettings, GenSettings, MapData, RenderSettings } from './types';
import { BIOME_LABELS } from './presets';
import { TERRAIN_LABELS } from './palette';
import { CHEST_ROTATIONS } from './edits';
import { CIVIC_KINDS, DEFAULT_EDITOR, ROOF_KIT, ROOF_SHAPES } from './settlementKit';
import { FURNITURE_FINISH_KEYS, FURNITURE_KINDS } from './furnitureKit';
import { CRYPT, CRYPT_KINDS, CRYPT_THEMES } from './cryptKit';
import { MAX_SPRITES, MAX_SPRITE_DATA, SPRITE_DATA_PATTERN } from './furnitureImport';
import { DEFAULT_GEN, DEFAULT_RENDER } from './presets';
import { isMarketArchetypeSetting } from './gen/marketArchetypes';
import { CHEST_KINDS } from './chests';
import { validSize } from './objectGeometry';
import { isArchetypeId } from './gen/archetypes';
import { MAX_DUNGEON_LEVELS } from './gen/dungeonArchitect';
import { DOOR_KINDS } from './doors';
import { isComplexArchetype, isGeometrySetting, isTopologySetting } from './gen/complex/registry';
import { FLOOR_CODE_PATTERN, isConditionSetting, isStyleSetting } from './gen/complex/styles';
import { isSettlementLayout, isSettlementType, isUrbanCharacterSetting } from './gen/settlementTypes';
import { detectMapSizeProfile, isMapSizeProfile, isValidMapDimensions } from './mapDimensions';
import { isCastleWallMaterialSetting, isRoadMaterialSetting } from './roadMaterials';
import type { DoorKind, ObjectDimensions } from './types';

export interface Project {
  version: 1;
  gen: GenSettings;
  render: RenderSettings;
  map: MapData | null;
  editor?: EditorSettings;
}

type NewEditorFields = 'roofMaterial' | 'roofShape' | 'civicKind' | 'stampRotation' | 'buildingSize' | 'civicSize' | 'chestRotation' | 'furnitureKind' | 'furnitureErase'
  | 'furnitureFinish' | 'furnitureSprite' | 'cryptKind' | 'cryptErase' | 'cryptConceal' | 'chestKind' | 'objectSizes' | 'sizeLock' | 'sizeUnit';
type NewRenderFields = 'showChests' | 'showRoofs' | 'showCivic' | 'showCrypt' | 'showSecrets' | 'wallThickness';
type NewGenFields = 'density' | 'settlement' | 'publicSpaces' | 'marketStyle' | 'marketRichness' | 'cryptDetail' | 'cryptTraps' | 'cryptChasms' | 'cryptArchetype' | 'urbanDressing' | 'cityCondition';
type ImportProject = Omit<Project, 'gen' | 'map' | 'render' | 'editor'> & {
  gen: Omit<GenSettings, NewGenFields> & Partial<Pick<GenSettings, NewGenFields>>;
  map: (Omit<MapData, 'chests'> & { chests?: MapData['chests'] }) | null;
  render: Omit<RenderSettings, NewRenderFields> & Partial<Pick<RenderSettings, NewRenderFields>>;
  editor?: Omit<EditorSettings, NewEditorFields> & Partial<Pick<EditorSettings, NewEditorFields>>;
};

const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number) => finite(v, min, max) && Number.isInteger(v);
const bool = (v: unknown) => typeof v === 'boolean';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shape = (v: unknown) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROOF_SHAPES, v);
const spriteKey = (v: unknown) => typeof v === 'string' && /^asset-[a-z0-9-]{8,64}$/.test(v);
const dimension = (v: unknown) => record(v) && validSize(v as unknown as ObjectDimensions);
const optionalSize = (v: Record<string, unknown>) => v.size === undefined || dimension(v.size);

export function validateProject(v: unknown): v is ImportProject {
  if (!record(v) || v.version !== 1 || !record(v.gen) || !record(v.render)) return false;
  const g = v.gen, r = v.render;
  if (!integer(g.seed, 0, 4294967295) || typeof g.biome !== 'string' || !Object.prototype.hasOwnProperty.call(BIOME_LABELS, g.biome)) return false;
  if (!isValidMapDimensions(g.width, g.height)) return false;
  if (g.mapSizeProfile !== undefined && !isMapSizeProfile(g.mapSizeProfile)) return false;
  if (!finite(g.roughness, 0, 1) || !finite(g.waterLevel, 0, 0.7) || !finite(g.vegetation, 0, 1) || !finite(g.rocks, 0, 1)) return false;
  if (!integer(g.structures, 0, 6) || !integer(g.rooms, 2, 14) || !finite(g.caveOpenness, 0, 1)) return false;
  if (g.density !== undefined && !finite(g.density, 0, 1)) return false;
  if (g.settlement !== undefined && !['village', 'town'].includes(String(g.settlement))) return false;
  if (![g.ruined, g.river, g.road].every(bool)) return false;
  if (g.publicSpaces !== undefined && !bool(g.publicSpaces)) return false;
  if (g.marketStyle !== undefined && !['auto', 'rows', 'ring', 'fair'].includes(String(g.marketStyle))) return false;
  if (g.marketRichness !== undefined && !finite(g.marketRichness, 0, 1)) return false;
  if (g.marketArchetype !== undefined && !isMarketArchetypeSetting(g.marketArchetype)) return false;
  if (g.urbanDressing !== undefined && !finite(g.urbanDressing, 0, 1)) return false;
  if (g.cityCondition !== undefined && g.cityCondition !== 'pristine' && g.cityCondition !== 'lived_in' && g.cityCondition !== 'worn') return false;
  if (g.cryptDetail !== undefined && !finite(g.cryptDetail, 0, 1)) return false;
  if (g.cryptArchetype !== undefined && !['tomb', 'catacombs', 'temple', 'archive', 'prison'].includes(String(g.cryptArchetype))) return false;
  if (![g.cryptTraps, g.cryptChasms].every((v) => v === undefined || bool(v))) return false;
  if (g.dungeonLayout !== undefined && g.dungeonLayout !== 'classic' && g.dungeonLayout !== 'varied') return false;
  if (g.dungeonLevels !== undefined && !integer(g.dungeonLevels, 1, MAX_DUNGEON_LEVELS)) return false;
  if (g.dungeonLevel !== undefined && !integer(g.dungeonLevel, 0, MAX_DUNGEON_LEVELS - 1)) return false;
  // Архитектурный комплекс: архетип и необязательные уточнения ('auto' — выбор по архетипу).
  if (g.dungeonArchetype !== undefined && !isComplexArchetype(g.dungeonArchetype)) return false;
  if (g.dungeonTopology !== undefined && !isTopologySetting(g.dungeonTopology)) return false;
  if (g.dungeonGeometry !== undefined && !isGeometrySetting(g.dungeonGeometry)) return false;
  if (g.dungeonStyle !== undefined && !isStyleSetting(g.dungeonStyle)) return false;
  if (g.dungeonCondition !== undefined && !isConditionSetting(g.dungeonCondition)) return false;
  if (g.settlementType !== undefined && g.settlementType !== 'classic' && !isSettlementType(g.settlementType)) return false;
  if (g.settlementLayout !== undefined && !isSettlementLayout(g.settlementLayout)) return false;
  if (g.settlementCharacter !== undefined && !isUrbanCharacterSetting(g.settlementCharacter)) return false;
  if (g.sceneArchetype !== undefined && g.sceneArchetype !== 'auto' && !isArchetypeId(g.sceneArchetype)) return false;
  if (g.generationEngine !== undefined && g.generationEngine !== 'legacy' && g.generationEngine !== 'structured') return false;
  if (!integer(r.cellSize, 16, 72) || !finite(r.gridOpacity, 0, 1) || typeof r.gridColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(r.gridColor)) return false;
  if (!['square', 'hex'].includes(String(r.gridType))) return false;
  if (![r.showGrid, r.shading, r.texture, r.showTrees, r.showRocks, r.showStructures, r.vignette].every(bool)) return false;
  if (![r.showChests, r.showCivic, r.showRoofs, r.showCrypt, r.showSecrets, r.showDebug, r.showDecor].every((value) => value === undefined || bool(value))) return false;
  if (r.timeOfDay !== undefined && !['day', 'dusk', 'night'].includes(String(r.timeOfDay))) return false;
  if (r.settlementDebug !== undefined && (!record(r.settlementDebug) || !Object.entries(r.settlementDebug).every(([k, v]) =>
    [
      'footprint', 'density', 'districts', 'blocks', 'plots', 'roadHierarchy',
      'frontage', 'courtyards', 'emptyAreas', 'accessibility', 'riverInfluence',
      'terrainInfluence', 'districtLabels', 'primaryRoads', 'secondaryRoads',
      'footprints', 'landmarks', 'urbanAge', 'market', 'activity', 'anchors', 'lighting', 'scenes',
    ].includes(k)
    && (v === undefined || bool(v))))) return false;
  if (r.wallThickness !== undefined && !finite(r.wallThickness, 0.15, 1.2)) return false;
  if (r.roadMaterial !== undefined && !isRoadMaterialSetting(r.roadMaterial)) return false;
  if (r.castleWallMaterial !== undefined && !isCastleWallMaterialSetting(r.castleWallMaterial)) return false;
  if (v.map !== null) {
    const m = v.map;
    if (!record(m) || m.width !== g.width || m.height !== g.height || m.biome !== g.biome) return false;
    if (!Array.isArray(m.cells) || m.cells.length !== m.height || !m.cells.every((row) => Array.isArray(row) && row.length === m.width && row.every((c: unknown) => record(c) && typeof c.terrain === 'string' && Object.prototype.hasOwnProperty.call(TERRAIN_LABELS, c.terrain) && finite(c.height, -2, 2) && finite(c.moisture, -2, 2)))) return false;
    if (!Array.isArray(m.trees) || m.trees.length > 32000 || !m.trees.every((t: unknown) => record(t) && optionalSize(t) && finite(t.x, -2, m.width as number + 2) && finite(t.y, -2, m.height as number + 2) && finite(t.r, 0.01, 5) && finite(t.v, 0, 1) && ['oak', 'pine', 'bush', 'dead', 'cactus', 'mushroom', 'reed'].includes(String(t.kind)))) return false;
    if (!Array.isArray(m.rocks) || m.rocks.length > 32000 || !m.rocks.every((r: unknown) => record(r) && optionalSize(r) && finite(r.x, -2, m.width as number + 2) && finite(r.y, -2, m.height as number + 2) && finite(r.r, 0.01, 5) && finite(r.v, 0, 1) && Array.isArray(r.pts) && r.pts.length >= 3 && r.pts.length <= 20 && r.pts.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => finite(n, -5, 5))))) return false;
    if (!Array.isArray(m.structures) || m.structures.length > 4000 || !m.structures.every((s: unknown) => record(s)
      && integer(s.x, 0, Number(g.width) - 1) && integer(s.y, 0, Number(g.height) - 1)
      && integer(s.w, 1, Number(g.width) - Number(s.x)) && integer(s.h, 1, Number(g.height) - Number(s.y)) && bool(s.ruin))) return false;
    if (![m.river, m.road].every((p) => Array.isArray(p) && p.length <= Number(g.width) * Number(g.height) * 2 && p.every((pt: unknown) => record(pt)
      && integer(pt.x, 0, Number(g.width) - 1) && integer(pt.y, 0, Number(g.height) - 1)))) return false;
    const spriteIds = new Set<string>();
    if (m.furnitureSprites !== undefined) {
      if (!Array.isArray(m.furnitureSprites) || m.furnitureSprites.length > MAX_SPRITES) return false;
      for (const p of m.furnitureSprites) {
        if (!record(p) || typeof p.id !== 'string' || !spriteKey(p.id) || spriteIds.has(p.id) || typeof p.label !== 'string' || p.label.length < 1 || p.label.length > 60
          || !FURNITURE_KINDS.includes(p.kind as EditorSettings['furnitureKind']) || !finite(p.ratio, .12, 8)
          || typeof p.data !== 'string' || p.data.length > MAX_SPRITE_DATA || !SPRITE_DATA_PATTERN.test(p.data)) return false;
        spriteIds.add(p.id);
      }
    }
    if (m.buildings !== undefined && (!Array.isArray(m.buildings) || m.buildings.length > 6000 || !m.buildings.every((b: unknown) => record(b)
      && integer(b.x, 0, Number(g.width) - 1) && integer(b.y, 0, Number(g.height) - 1)
      && integer(b.w, 1, Number(g.width) - Number(b.x)) && integer(b.h, 1, Number(g.height) - Number(b.y))
      && ['village', 'town'].includes(String(b.style)) && ['house', 'hall', 'tower', 'shop', 'tavern'].includes(String(b.kind))
      && integer(b.roof, 0, ROOF_KIT.length - 1) && (b.shape === undefined || shape(b.shape)) && (b.source === undefined || b.source === 'layout' || b.source === 'manual')
      && (b.facing === undefined || CHEST_ROTATIONS.includes(b.facing as ChestRotation))
      && (b.annex === undefined || ['porch', 'wing', 'awning', 'dormer', 'battlement'].includes(String(b.annex)))
      && (b.role === undefined || [
        'house', 'workshop', 'shop', 'warehouse', 'tavern', 'town_hall', 'temple',
        'minor_temple', 'citadel', 'barracks', 'prison', 'smithy', 'mill', 'baths',
        'stable', 'manor', 'shed', 'barn', 'guildhall', 'shrine',
      ].includes(String(b.role)))
      && (b.furniture === undefined || Array.isArray(b.furniture) && b.furniture.length <= 4000 && b.furniture.every((f: unknown) => record(f)
        && optionalSize(f) && FURNITURE_KINDS.includes(f.kind as EditorSettings['furnitureKind']) && finite(f.x, 0, Number(b.w)) && finite(f.y, 0, Number(b.h))
        && CHEST_ROTATIONS.includes(f.rotation as ChestRotation) && (f.finish === undefined || FURNITURE_FINISH_KEYS.includes(f.finish as EditorSettings['furnitureFinish']))
        && (f.sprite === undefined || typeof f.sprite === 'string' && spriteIds.has(f.sprite))))
      && (b.attachments === undefined || Array.isArray(b.attachments) && b.attachments.length <= 16 && b.attachments.every((att: unknown) => record(att)
        && ['shop_sign', 'tavern_sign', 'awning', 'wall_lantern', 'flower_box', 'banner', 'cargo_winch', 'shrine_niche'].includes(String(att.kind))
        && CHEST_ROTATIONS.includes(att.side as ChestRotation) && finite(att.offset, -0.5, 0.5)
        && (att.variant === undefined || integer(att.variant, 0, 7))
        && (att.emitsLight === undefined || bool(att.emitsLight))))
      && (b.patina === undefined || record(b.patina) && finite(b.patina.age, 0, 1) && finite(b.patina.wealth, 0, 1) && finite(b.patina.maintenance, 0, 1))
      && record(b.door) && integer(b.door.x, Number(b.x), Number(b.x) + Number(b.w) - 1) && integer(b.door.y, Number(b.y), Number(b.y) + Number(b.h) - 1)))) return false;
    if (m.lights !== undefined && (!Array.isArray(m.lights) || m.lights.length > 8000 || !m.lights.every((lt: unknown) => record(lt)
      && finite(lt.x, 0, Number(g.width)) && finite(lt.y, 0, Number(g.height))
      && finite(lt.radius, 0.5, 32) && finite(lt.intensity, 0, 2)
      && typeof lt.color === 'string' && lt.color.length <= 32
      && ['street_lantern', 'brazier', 'wall_sconce', 'window_glow', 'gate_torch', 'pier_lantern', 'shrine_flame'].includes(String(lt.kind))))) return false;
    if (m.civic !== undefined && (!Array.isArray(m.civic) || m.civic.length > Number(g.width) * Number(g.height) || !m.civic.every((p: unknown) => record(p)
      && finite(p.x, 0, Number(g.width) - .15) && finite(p.y, 0, Number(g.height) - .15)
      && finite(p.w, .15, p.kind === 'square' ? Number(g.width) - Number(p.x) : Math.min(24, Number(g.width) - Number(p.x)))
      && finite(p.h, .15, p.kind === 'square' ? Number(g.height) - Number(p.y) : Math.min(24, Number(g.height) - Number(p.y)))
      && CIVIC_KINDS.includes(p.kind as EditorSettings['civicKind']) && CHEST_ROTATIONS.includes(p.rotation as ChestRotation)
      && integer(p.variant, 0, 7) && (p.source === 'layout' || p.source === 'manual')))) return false;
    const rectangle = (p: Record<string, unknown>) => finite(p.x, 0, Number(g.width) - .15) && finite(p.y, 0, Number(g.height) - .15)
      && finite(p.w, .15, Number(g.width) - Number(p.x)) && finite(p.h, .15, Number(g.height) - Number(p.y));
    if (m.cryptRooms !== undefined && (!Array.isArray(m.cryptRooms) || m.cryptRooms.length > 100 || !m.cryptRooms.every((p: unknown) => record(p) && rectangle(p)
      && typeof p.theme === 'string' && Object.prototype.hasOwnProperty.call(CRYPT_THEMES, p.theme)))) return false;
    if (m.crypt !== undefined && (!Array.isArray(m.crypt) || m.crypt.length > Math.min(Number(g.width) * Number(g.height) * 2, 4000) || !m.crypt.every((p: unknown) => record(p) && rectangle(p)
      && CRYPT_KINDS.includes(p.kind as EditorSettings['cryptKind']) && finite(p.w, .15, 20) && finite(p.h, .15, 20) && CHEST_ROTATIONS.includes(p.rotation as ChestRotation)
      && integer(p.variant, 0, 3) && (p.source === 'layout' || p.source === 'manual')
      && (p.hidden === undefined || bool(p.hidden) && (!p.hidden || p.kind === 'chest' || CRYPT[p.kind as EditorSettings['cryptKind']].secret))
      && (p.unlit === undefined || bool(p.unlit))))) return false;
    // Покрытие пола комплекса: по букве на клетку, орнаменты внутри карты.
    if (m.floorLayer !== undefined) {
      const f = m.floorLayer;
      if (!record(f) || typeof f.codes !== 'string' || f.codes.length !== Number(g.width) * Number(g.height) || !FLOOR_CODE_PATTERN.test(f.codes)) return false;
      if (!Array.isArray(f.ornaments) || f.ornaments.length > 200 || !f.ornaments.every((o: unknown) => record(o)
        && finite(o.x, 0, Number(g.width)) && finite(o.y, 0, Number(g.height)) && finite(o.r, .5, 6)
        && ['rosette', 'star', 'ring', 'sun'].includes(String(o.kind)))) return false;
    }
    // Виды дверей: только на клетках-дверях, без повторов; 'normal' не хранится.
    if (m.doors !== undefined) {
      if (!Array.isArray(m.doors) || m.doors.length > Number(g.width) * Number(g.height)) return false;
      const seenDoors = new Set<number>();
      for (const d of m.doors as unknown[]) {
        if (!record(d) || !integer(d.x, 0, Number(g.width) - 1) || !integer(d.y, 0, Number(g.height) - 1) || !DOOR_KINDS.includes(d.kind as DoorKind) || d.kind === 'normal') return false;
        const key = Number(d.y) * Number(g.width) + Number(d.x);
        const cell = (m.cells as Array<Array<{ terrain: string }>>)[Number(d.y)][Number(d.x)];
        if (seenDoors.has(key) || cell.terrain !== 'door') return false;
        seenDoors.add(key);
      }
    }
    if (m.chests !== undefined && (!Array.isArray(m.chests) || m.chests.length > Number(g.width) * Number(g.height) || !m.chests.every((c: unknown) => record(c)
      && finite(c.x, 0, Number(g.width)) && c.x !== g.width && finite(c.y, 0, Number(g.height)) && c.y !== g.height
      && optionalSize(c) && (c.kind === undefined || CHEST_KINDS.includes(c.kind as EditorSettings['chestKind'])) && CHEST_ROTATIONS.includes(c.rotation as ChestRotation)))) return false;
  }
  if (v.editor !== undefined) {
    const e = v.editor;
    if (!record(e) || !['brush', 'eraser', 'fill', 'rect', 'select', 'hand', 'tree', 'rock', 'structure', 'pick', 'paste', 'chest', 'building', 'roof', 'civic', 'furniture', 'crypt'].includes(String(e.tool))) return false;
    if (typeof e.terrain !== 'string' || !Object.prototype.hasOwnProperty.call(TERRAIN_LABELS, e.terrain) || !integer(e.brushSize, 1, 12) || !['round', 'square'].includes(String(e.brushShape))) return false;
    if (!['oak', 'pine', 'bush', 'dead', 'cactus', 'mushroom', 'reed'].includes(String(e.treeKind)) || !bool(e.snap)) return false;
    if (e.chestRotation !== undefined && !CHEST_ROTATIONS.includes(e.chestRotation as ChestRotation)) return false;
    if (e.stampRotation !== undefined && !CHEST_ROTATIONS.includes(e.stampRotation as ChestRotation)) return false;
    if (e.roofMaterial !== undefined && !integer(e.roofMaterial, 0, ROOF_KIT.length - 1)) return false;
    if (e.roofShape !== undefined && !shape(e.roofShape)) return false;
    if (e.civicKind !== undefined && !CIVIC_KINDS.includes(e.civicKind as EditorSettings['civicKind'])) return false;
    if (e.buildingSize !== undefined && !integer(e.buildingSize, 0, 3)) return false;
    if (e.civicSize !== undefined && !integer(e.civicSize, 0, 2)) return false;
    if (e.furnitureKind !== undefined && !FURNITURE_KINDS.includes(e.furnitureKind as EditorSettings['furnitureKind'])) return false;
    if (e.furnitureErase !== undefined && !bool(e.furnitureErase)) return false;
    if (e.furnitureFinish !== undefined && !FURNITURE_FINISH_KEYS.includes(e.furnitureFinish as EditorSettings['furnitureFinish'])) return false;
    if (e.furnitureSprite !== undefined && e.furnitureSprite !== '' && !spriteKey(e.furnitureSprite)) return false;
    if (e.cryptKind !== undefined && !CRYPT_KINDS.includes(e.cryptKind as EditorSettings['cryptKind'])) return false;
    if (![e.cryptErase, e.cryptConceal].every((value) => value === undefined || bool(value))) return false;
    if (e.doorKind !== undefined && !DOOR_KINDS.includes(e.doorKind as DoorKind)) return false;
    if (e.chestKind !== undefined && !CHEST_KINDS.includes(e.chestKind as EditorSettings['chestKind'])) return false;
    if (e.sizeLock !== undefined && !bool(e.sizeLock)) return false;
    if (e.sizeUnit !== undefined && e.sizeUnit !== 'cells' && e.sizeUnit !== 'feet') return false;
    if (e.objectSizes !== undefined && (!record(e.objectSizes) || Object.keys(e.objectSizes).length > 256
      || !Object.entries(e.objectSizes).every(([key, value]) => key.length <= 160 && key !== '__proto__' && key !== 'constructor' && dimension(value)))) return false;
  }
  return true;
}

export function parseProject(value: unknown): Project | null {
  if (!validateProject(value)) return null;
  return {
    version: 1,
    gen: {
      cryptDetail: DEFAULT_GEN.cryptDetail, cryptTraps: true, cryptChasms: true, cryptArchetype: 'tomb',
    urbanDressing: DEFAULT_GEN.urbanDressing, cityCondition: DEFAULT_GEN.cityCondition,
      ...value.gen,
      settlement: value.gen.settlement ?? (value.gen.biome === 'town' ? 'town' : 'village'),
      density: value.gen.density ?? 0.42,
      publicSpaces: value.gen.publicSpaces ?? true,
      marketStyle: value.gen.marketStyle ?? 'auto',
      marketRichness: value.gen.marketRichness ?? 0.62,
      mapSizeProfile: value.gen.mapSizeProfile ?? detectMapSizeProfile(value.gen.width, value.gen.height),
    },
    map: value.map ? { ...value.map, chests: value.map.chests ?? [] } : null,
    render: { showRoofs: true, showCivic: true, showChests: true, showCrypt: true, showSecrets: true, wallThickness: DEFAULT_RENDER.wallThickness, ...value.render },
    editor: value.editor ? { ...DEFAULT_EDITOR, ...value.editor, tool: value.editor.tool === 'paste' ? 'brush' : value.editor.tool } : undefined,
  };
}

const STORAGE_KEY = 'battlemap-studio-project-v1';
/** Ключ, куда откладывается повреждённая сессия до первой перезаписи. */
export const CORRUPT_SESSION_KEY = `${STORAGE_KEY}.corrupt`;
let quarantined = false;

/**
 * Читает автосохранение. Если запись есть, но не проходит разбор/валидацию,
 * её исходный текст копируется в CORRUPT_SESSION_KEY: следующее автосохранение
 * перезапишет основной ключ, и без копии работа пользователя пропала бы молча.
 */
export function readSession(): Project | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const project = parseProject(JSON.parse(raw));
    if (project) return project;
  } catch { /* разбор не удался — ниже откладываем копию */ }
  if (raw) {
    try {
      if (localStorage.getItem(CORRUPT_SESSION_KEY) !== raw) localStorage.setItem(CORRUPT_SESSION_KEY, raw);
      quarantined = true;
    } catch { /* хранилище недоступно или переполнено — копию сделать нельзя */ }
  }
  return null;
}

/** Была ли при последнем чтении отложена повреждённая сессия. */
export function sessionWasQuarantined(): boolean {
  return quarantined;
}
export function saveSession(p: Project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
export function downloadJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `battlemap-${p.gen.biome}-${p.gen.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
