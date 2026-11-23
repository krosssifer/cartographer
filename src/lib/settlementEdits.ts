import { BUILDING_SIZES, CIVIC_KIT, CIVIC_SIZES, contains, intersects, isSettlement } from './settlementKit';
import { FURNITURE, furnitureBounds } from './furnitureKit';
import { canFurnish, interiorOf } from './interiors';
import { footprintCells, rectOnGrid, rotatedSize, stampDimensions } from './objectGeometry';
import type { Building, CivicObject, EditorSettings, Furnishing, MapData, Point, Selection, Terrain } from './types';

const blocked = (tile: Terrain) => ['water', 'deepWater', 'void', 'wall', 'caveWall', 'bridge', 'buildingWall', 'roof', 'door'].includes(tile);

export function buildingAt(map: MapData, point: Point) {
  return map.buildings?.find((b) => contains(b, point.x, point.y));
}

export function buildingStamp(map: MapData, point: Point, editor: EditorSettings): Building {
  const defaults = BUILDING_SIZES[editor.buildingSize] ?? BUILDING_SIZES[1];
  const requested = stampDimensions(editor, defaults);
  const long = Math.max(4, Math.round(requested.w)), short = Math.max(4, Math.round(requested.h));
  const rotation = editor.stampRotation;
  const [w, h] = rotation % 180 === 0 ? [long, short] : [short, long];
  const { x, y } = rectOnGrid(point, { w, h });
  const tavern = editor.buildingSize === 3;
  const doorPos = tavern ? .31 : .5;
  const door = rotation === 0 ? { x: x + Math.floor(w * doorPos), y: y + h - 1 }
    : rotation === 90 ? { x, y: y + Math.floor(h * doorPos) }
      : rotation === 180 ? { x: x + w - 1 - Math.floor(w * doorPos), y }
        : { x: x + w - 1, y: y + h - 1 - Math.floor(h * doorPos) };
  const style = isSettlement(map.biome) ? map.biome : editor.roofMaterial < 2 || editor.roofMaterial === 7 ? 'village' : 'town';
  return { x, y, w, h, style, door, facing: rotation, roof: editor.roofMaterial, shape: editor.roofShape, kind: tavern ? 'tavern' : editor.buildingSize === 2 ? 'hall' : 'house', source: 'manual' };
}

function usableGround(map: MapData, rect: Selection) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > map.width || rect.y + rect.h > map.height) return false;
  return footprintCells(rect, (x, y) => !blocked(map.cells[y][x].terrain));
}

export function canPlaceBuilding(map: MapData, b: Building) {
  return usableGround(map, b) && !map.buildings?.some((other) => intersects(other, b))
    && !map.structures.some((other) => intersects(other, b)) && !map.civic?.some((other) => intersects(other, b))
    && !map.chests.some((chest) => contains(b, chest.x, chest.y));
}

export function addBuilding(map: MapData, building: Building): MapData {
  if (!canPlaceBuilding(map, building)) return map;
  return { ...map, buildings: [...(map.buildings ?? []), building] };
}

export function changeRoof(map: MapData, building: Building, editor: Pick<EditorSettings, 'roofMaterial' | 'roofShape'>): MapData {
  if (building.roof === editor.roofMaterial && (building.shape ?? 'gable') === editor.roofShape) return map;
  return { ...map, buildings: map.buildings?.map((b) => b === building ? { ...b, roof: editor.roofMaterial, shape: editor.roofShape, source: 'manual' } : b) };
}

export function addFurnishing(map: MapData, building: Building, item: Furnishing): MapData {
  const objects = interiorOf(building).furnishings;
  if (objects.length >= 400 || !canFurnish(building, item)) return map;
  return { ...map, buildings: map.buildings?.map((b) => b === building ? { ...b, source: 'manual', furniture: [...objects, item] } : b) };
}

export function furnishingAt(building: Building, point: Point) {
  const items = interiorOf(building).furnishings.filter((item) => contains(furnitureBounds(item), point.x - building.x, point.y - building.y));
  return items.slice().reverse().find((item) => !FURNITURE[item.kind].flat) ?? items[items.length - 1];
}

export function removeFurnishing(map: MapData, building: Building, item: Furnishing): MapData {
  return { ...map, buildings: map.buildings?.map((b) => b === building ? { ...b, source: 'manual', furniture: interiorOf(b).furnishings.filter((p) => p !== item) } : b) };
}

export function civicStamp(map: MapData, point: Point, editor: EditorSettings): CivicObject {
  const kind = editor.civicKind;
  const defaults = kind === 'market' || kind === 'square' ? CIVIC_SIZES[kind][editor.civicSize] : CIVIC_KIT[kind];
  const dimensions = stampDimensions(editor, defaults);
  const rotation = editor.stampRotation;
  const { w, h } = rotatedSize(dimensions, rotation);
  const { x, y } = rectOnGrid(point, { w, h });
  const variant = kind === 'market' ? (map.civic ?? []).filter((p) => p.kind === 'market').length % 2 : 0;
  return { x, y, w, h, kind, rotation, variant, source: 'manual' };
}

export function canPlaceCivic(map: MapData, item: CivicObject) {
  return usableGround(map, item) && !map.structures.some((other) => intersects(other, item))
    && !map.buildings?.some((other) => intersects(other, item))
    && !map.civic?.some((other) => (other.kind === item.kind || other.kind !== 'square' && item.kind !== 'square') && intersects(other, item))
    && (item.kind === 'square' || !map.chests.some((c) => contains(item, c.x, c.y)));
}

export function addCivic(map: MapData, item: CivicObject): MapData {
  if (!canPlaceCivic(map, item)) return map;
  return { ...map, civic: [...(map.civic ?? []), item] };
}

export function replanSettlement(current: MapData, oldPlan: MapData, newPlan: MapData): MapData {
  if (current === oldPlan) return newPlan;
  const manual = (current.buildings ?? []).filter((b) => b.source === 'manual');
  const oldHouses = (current.buildings ?? []).filter((b) => b.source !== 'manual');
  const details = (current.civic ?? []).filter((p) => p.source === 'manual');
  const legacy = oldHouses.filter((b) => b.source === undefined);
  const structures = current.structures.filter((s) => !legacy.some((b) => s.x === b.x && s.y === b.y && s.w === b.w && s.h === b.h));
  const sameGround = oldPlan.cells === newPlan.cells && !legacy.length;
  const cells = sameGround ? current.cells : current.cells.map((row, y) => row.map((c, x) => {
    const fromOldHouse = ['buildingWall', 'buildingFloor', 'door'].includes(c.terrain) && legacy.some((b) => contains(b, x, y));
    if (fromOldHouse || c.terrain === oldPlan.cells[y][x].terrain) return newPlan.cells[y][x];
    return c;
  }));

  let map: MapData = { ...current, cells, road: newPlan.road, river: newPlan.river, buildings: manual, structures, civic: details };
  // Поселение по типу: отчёт (кварталы, укрепления) берём из нового плана.
  if (newPlan.plan?.settlement) map = { ...map, plan: newPlan.plan };
  for (const item of newPlan.civic ?? []) if (canPlaceCivic(map, item)) map = { ...map, civic: [...map.civic!, item] };
  for (const house of newPlan.buildings ?? []) {
    if (house.kind === 'tavern' && map.buildings?.some((b) => b.kind === 'tavern')) continue;
    const candidate = canPlaceBuilding(map, house) ? house : house.kind === 'tavern' ? relocateTavern(map, house) : undefined;
    if (candidate) map = { ...map, buildings: [...map.buildings!, candidate] };
  }

  const signature = ({ x, y, r }: { x: number; y: number; r: number }) => `${x}:${y}:${r}`;
  function merge<T extends { x: number; y: number; r: number }>(existing: T[], old: T[], planned: T[]) {
    const oldKeys = new Set(old.map(signature)), currentKeys = new Set(existing.map(signature));
    const handmade = existing.filter((item) => !oldKeys.has(signature(item)));
    return [...handmade, ...planned.filter((item) => (!oldKeys.has(signature(item)) || currentKeys.has(signature(item)))
      && !map.buildings?.some((house) => contains(house, item.x, item.y)) && !map.civic?.some((p) => contains(p, item.x, item.y)))];
  }
  return { ...map, trees: merge(current.trees, oldPlan.trees, newPlan.trees), rocks: merge(current.rocks, oldPlan.rocks, newPlan.rocks) };
}

function relocateTavern(map: MapData, planned: Building) {
  const streets = new Set(map.road.map(({ x, y }) => y * map.width + x));
  for (const [w, h] of [[planned.w, planned.h], [9, 7], [8, 6], [7, 6]]) {
    let nearest: Building | undefined, best = Infinity;
    for (let y = 1; y + h < map.height; y++) for (let x = 1; x + w < map.width; x++) {
      const door = { x: x + Math.floor(w * .31), y: y + h - 1 };
      const outside = { x: door.x, y: door.y + 1, w: 1, h: 1 };
      const next = { ...planned, x, y, w, h, door };
      const distance = Math.hypot(planned.x - x, planned.y - y);
      if (distance >= best || !usableGround(map, outside) || map.buildings?.some((b) => intersects(b, outside)) || !canPlaceBuilding(map, next)) continue;
      let roadCells = 0;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (streets.has(yy * map.width + xx)) roadCells++;
      const score = distance + roadCells * 1.7 - (streets.has(outside.y * map.width + outside.x) ? .8 : 0);
      if (score < best) { best = score; nearest = next; }
    }
    if (nearest) return nearest;
  }
}