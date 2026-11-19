import { CHESTS, chestBounds, chestDimensions, canPlaceChest } from './chests';
import { CRYPT, coversHazard, hazard, isSecret } from './cryptKit';
import { canPlaceCrypt } from './cryptLayout';
import { FURNITURE, furnitureBounds } from './furnitureKit';
import { canFurnish, facingOf, interiorOf } from './interiors';
import { centeredBounds, MAX_OBJECT_SIZE, rotatedSize, roundedSize, stampDimensions, validSize } from './objectGeometry';
import { BUILDING_SIZES, CIVIC_KIT, CIVIC_SIZES, contains, encloses, intersects } from './settlementKit';
import { canPlaceBuilding, canPlaceCivic } from './settlementEdits';
import type { ChestKind, ChestRotation, EditorSettings, LayerId, MapData, ObjectDimensions, ObjectTarget, Point, RenderSettings, Rock, Tree } from './types';

export const treeDimensions = (tree: Tree): ObjectDimensions => tree.size ?? { w: tree.r * (tree.kind === 'oak' ? 4.1 : tree.kind === 'pine' ? 4.08 : tree.kind === 'bush' ? 3.54 : 2.85), h: tree.r * (tree.kind === 'pine' ? 3.74 : tree.kind === 'oak' ? 4.04 : tree.kind === 'bush' ? 3.32 : 2.6) };
export const rockDimensions = (rock: Rock): ObjectDimensions => rock.size ?? { w: rock.r * 3.05, h: rock.r * 2.71 };

export function stampDefaults(s: EditorSettings): { label: string; size: ObjectDimensions; layer: LayerId; integer?: boolean } | null {
  switch (s.tool) {
    case 'chest': return { label: `${CHESTS[s.chestKind].label} сундук`, size: CHESTS[s.chestKind], layer: 'chests' };
    case 'crypt': return s.cryptErase ? null : { label: CRYPT[s.cryptKind].label, size: CRYPT[s.cryptKind], layer: 'crypt' };
    case 'civic': return { label: CIVIC_KIT[s.civicKind].label, size: s.civicKind === 'market' || s.civicKind === 'square' ? CIVIC_SIZES[s.civicKind][s.civicSize] : CIVIC_KIT[s.civicKind], layer: 'civic' };
    case 'furniture': return s.furnitureErase ? null : { label: FURNITURE[s.furnitureKind].label, size: FURNITURE[s.furnitureKind], layer: 'structures' };
    case 'building': return { label: BUILDING_SIZES[s.buildingSize].label, size: BUILDING_SIZES[s.buildingSize], layer: 'structures', integer: true };
    case 'tree': return { label: 'Растительность', size: { w: 1.8, h: 1.8 }, layer: 'trees' };
    case 'rock': return { label: 'Камень', size: { w: 1.1, h: .9 }, layer: 'rocks' };
    default: return null;
  }
}

export function nextObjectSize(s: EditorSettings) {
  const defaultValue = stampDefaults(s);
  return defaultValue ? stampDimensions(s, defaultValue.size) : null;
}

export function objectInfo(map: MapData, target: ObjectTarget) {
  const { index, type } = target;
  switch (type) {
    case 'chest': {
      const item = map.chests[index];
      return item ? { label: `${CHESTS[item.kind ?? 'wooden'].label} сундук`, size: chestDimensions(item), bounds: chestBounds(item), layer: 'chests' as const, kind: item.kind ?? 'wooden' } : null;
    }
    case 'crypt': case 'civic': {
      const item = type === 'crypt' ? map.crypt?.[index] : map.civic?.[index];
      if (!item) return null;
      const size = rotatedSize(item, item.rotation);
      return { label: type === 'crypt' ? CRYPT[map.crypt![index].kind].label : CIVIC_KIT[map.civic![index].kind].label, size, bounds: item, layer: type };
    }
    case 'tree': case 'rock': {
      const item = type === 'tree' ? map.trees[index] : map.rocks[index];
      if (!item) return null;
      const size = type === 'tree' ? treeDimensions(map.trees[index]) : rockDimensions(map.rocks[index]);
      return { label: type === 'tree' ? 'Растительность' : 'Камень', size, bounds: centeredBounds(item, size), layer: type === 'tree' ? 'trees' as const : 'rocks' as const };
    }
    case 'building': {
      const b = map.buildings?.[index];
      return b ? { label: b.kind === 'tavern' ? 'Таверна' : 'Дом', size: { w: b.w, h: b.h }, bounds: b, layer: 'structures' as const, integer: true } : null;
    }
    case 'furniture': {
      const b = map.buildings?.[target.building], item = b && interiorOf(b).furnishings[index];
      if (!b || !item) return null;
      const local = furnitureBounds(item), size = item.size ?? FURNITURE[item.kind];
      return { label: FURNITURE[item.kind].label, size, bounds: { ...local, x: b.x + local.x, y: b.y + local.y }, layer: 'structures' as const };
    }
  }
}

export function objectAt(map: MapData, point: Point, render: RenderSettings): ObjectTarget | null {
  const match = (target: ObjectTarget) => {
    const info = objectInfo(map, target);
    return info && contains(info.bounds, point.x, point.y);
  };
  if (render.showChests) for (let index = map.chests.length - 1; index >= 0; index--) if (match({ type: 'chest', index })) return { type: 'chest', index };
  if (render.showStructures && !render.showRoofs) for (let building = 0; building < (map.buildings?.length ?? 0); building++) {
    const b = map.buildings![building];
    if (!contains(b, point.x, point.y)) continue;
    const items = interiorOf(b).furnishings;
    for (const flat of [false, true]) for (let index = items.length - 1; index >= 0; index--) {
      if (Boolean(FURNITURE[items[index].kind].flat) === flat && match({ type: 'furniture', index, building })) return { type: 'furniture', index, building };
    }
  }
  if (render.showCrypt) for (let index = (map.crypt?.length ?? 0) - 1; index >= 0; index--) {
    if ((render.showSecrets || !isSecret(map.crypt![index])) && match({ type: 'crypt', index })) return { type: 'crypt', index };
  }
  if (render.showCivic) for (let index = (map.civic?.length ?? 0) - 1; index >= 0; index--) if (match({ type: 'civic', index })) return { type: 'civic', index };
  if (render.showTrees) for (let index = map.trees.length - 1; index >= 0; index--) if (match({ type: 'tree', index })) return { type: 'tree', index };
  if (render.showRocks) for (let index = map.rocks.length - 1; index >= 0; index--) if (match({ type: 'rock', index })) return { type: 'rock', index };
  if (render.showStructures) for (let index = 0; index < (map.buildings?.length ?? 0); index++) if (match({ type: 'building', index })) return { type: 'building', index };
  return null;
}

const replace = <T,>(items: T[], index: number, next: T) => items.map((item, i) => i === index ? next : item);
const clear = <T,>(items: T[] | undefined, index: number) => items?.filter((_, i) => i !== index) ?? [];

export function resizeObject(map: MapData, target: ObjectTarget, requested: ObjectDimensions, chestKind?: ChestKind): { map: MapData; error?: string } {
  const info = objectInfo(map, target);
  const size = { w: roundedSize(requested.w), h: roundedSize(requested.h) };
  const fail = (error = 'Объект не помещается: проверьте стены, соседние предметы и края карты.') => ({ map, error });
  if (!info || !validSize(size)) return fail(`Укажите размер от 0,15 до ${MAX_OBJECT_SIZE} клеток.`);
  const { type, index } = target;
  if (type === 'chest') {
    const next = { ...map.chests[index], size, ...(chestKind ? { kind: chestKind } : {}) };
    return canPlaceChest(map, next, index) ? { map: { ...map, chests: replace(map.chests, index, next) } } : fail();
  }
  if (type === 'crypt') {
    const item = map.crypt![index], next = { ...item, ...rotatedSize(size, item.rotation), source: 'manual' as const };
    const temp = { ...map, crypt: clear(map.crypt, index) };
    return canPlaceCrypt(temp, next) ? { map: { ...map, crypt: replace(map.crypt!, index, next) } } : fail();
  }
  if (type === 'civic') {
    const item = map.civic![index], next = { ...item, ...rotatedSize(size, item.rotation), source: 'manual' as const };
    return canPlaceCivic({ ...map, civic: clear(map.civic, index) }, next) ? { map: { ...map, civic: replace(map.civic!, index, next) } } : fail();
  }
  if (type === 'tree' || type === 'rock') {
    const item = type === 'tree' ? map.trees[index] : map.rocks[index];
    const bounds = centeredBounds(item, size);
    if (!encloses({ x: 0, y: 0, w: map.width, h: map.height }, bounds)) return fail();
    return { map: type === 'tree' ? { ...map, trees: replace(map.trees, index, { ...map.trees[index], size }) } : { ...map, rocks: replace(map.rocks, index, { ...map.rocks[index], size }) } };
  }
  if (type === 'furniture') {
    const b = map.buildings![target.building], items = interiorOf(b).furnishings, item = items[index], next = { ...item, size };
    if (!canFurnish({ ...b, furniture: clear(items, index) }, next)) return fail();
    const house = { ...b, source: 'manual' as const, furniture: replace(items, index, next) };
    return { map: { ...map, buildings: replace(map.buildings!, target.building, house) } };
  }
  const b = map.buildings![index], w = Math.round(size.w), h = Math.round(size.h);
  if (w < 4 || h < 4) return fail('Для дома нужен размер не меньше 4 × 4 клеток.');
  const facing = facingOf(b), relativeX = (b.door.x - b.x + .5) / b.w, relativeY = (b.door.y - b.y + .5) / b.h;
  const door = facing === 0 || facing === 180 ? { x: b.x + Math.min(w - 2, Math.max(1, Math.floor(relativeX * w))), y: b.y + (facing === 0 ? h - 1 : 0) }
    : { x: b.x + (facing === 90 ? 0 : w - 1), y: b.y + Math.min(h - 2, Math.max(1, Math.floor(relativeY * h))) };
  let next = { ...b, w, h, door, source: 'manual' as const };
  if (b.furniture) {
    next = { ...next, furniture: [] };
    for (const original of b.furniture) {
      const item = { ...original, x: roundedSize(original.x * w / b.w), y: roundedSize(original.y * h / b.h) };
      if (!canFurnish(next, item)) return fail('Новые стены пересекают мебель. Попробуйте другой размер или сначала уберите мешающие предметы.');
      next.furniture!.push(item);
    }
  }
  if (map.structures.some((s) => s.x === b.x && s.y === b.y && s.w === b.w && s.h === b.h)) return fail('Для домов из старых проектов сохранены исходные стены. Создайте дом нового формата.');
  return canPlaceBuilding({ ...map, buildings: clear(map.buildings, index) }, next) ? { map: { ...map, buildings: replace(map.buildings!, index, next) } } : fail();
}

export function moveObject(map: MapData, target: ObjectTarget, dx: number, dy: number): { map: MapData; error?: string } {
  const info = objectInfo(map, target);
  if (!info) return { map };
  const { type, index } = target;
  const fail = (error = 'Сдвинуть не получилось: там стена, соседний предмет или край карты.') => ({ map, error });
  if (type === 'chest') {
    const next = { ...map.chests[index], x: map.chests[index].x + dx, y: map.chests[index].y + dy };
    return canPlaceChest(map, next, index) ? { map: { ...map, chests: replace(map.chests, index, next) } } : fail();
  }
  if (type === 'crypt') {
    const next = { ...map.crypt![index], x: map.crypt![index].x + dx, y: map.crypt![index].y + dy };
    const temp = { ...map, crypt: clear(map.crypt, index) };
    return canPlaceCrypt(temp, next) ? { map: { ...map, crypt: replace(map.crypt!, index, next) } } : fail();
  }
  if (type === 'civic') {
    const next = { ...map.civic![index], x: map.civic![index].x + dx, y: map.civic![index].y + dy };
    const temp = { ...map, civic: clear(map.civic, index) };
    return canPlaceCivic(temp, next) ? { map: { ...map, civic: replace(map.civic!, index, next) } } : fail();
  }
  if (type === 'tree') {
    const next: Tree = { ...map.trees[index], x: map.trees[index].x + dx, y: map.trees[index].y + dy };
    if (!encloses({ x: 0, y: 0, w: map.width, h: map.height }, centeredBounds(next, treeDimensions(next)))) return fail();
    return { map: { ...map, trees: replace(map.trees, index, next) } };
  }
  if (type === 'rock') {
    const next: Rock = { ...map.rocks[index], x: map.rocks[index].x + dx, y: map.rocks[index].y + dy };
    if (!encloses({ x: 0, y: 0, w: map.width, h: map.height }, centeredBounds(next, rockDimensions(next)))) return fail();
    return { map: { ...map, rocks: replace(map.rocks, index, next) } };
  }
  if (type === 'building') {
    const next = { ...map.buildings![index], x: map.buildings![index].x + dx, y: map.buildings![index].y + dy };
    if (map.structures.some((s) => s.x === next.x && s.y === next.y && s.w === next.w && s.h === next.h)) return fail('Дом из старого проекта нельзя сдвинуть: у него сохранены клеточные стены.');
    return canPlaceBuilding({ ...map, buildings: clear(map.buildings, index) }, next) ? { map: { ...map, buildings: replace(map.buildings!, index, next) } } : fail();
  }
  if (target.type !== 'furniture') return { map };
  const building = map.buildings![target.building], items = interiorOf(building).furnishings;
  const next = { ...items[index], x: items[index].x + dx, y: items[index].y + dy };
  if (!canFurnish({ ...building, furniture: clear(items, index) }, next)) return fail('Предмет не поместится в комнате на этом месте.');
  const house = { ...building, source: 'manual' as const, furniture: replace(items, index, next) };
  return { map: { ...map, buildings: replace(map.buildings!, target.building, house) } };
}

export function rotateObject(map: MapData, target: ObjectTarget, degrees: number): { map: MapData; error?: string } {
  const { type, index } = target;
  const step = ((degrees % 360) + 360) % 360;
  const swap = step === 90 || step === 270;
  const rotate = <T extends { rotation: ChestRotation; w?: number; h?: number }>(item: T): T => {
    const rotation = ((item.rotation + step) % 360) as ChestRotation;
    const w = item.w, h = item.h;
    return { ...item, rotation, ...(swap && w !== undefined && h !== undefined ? { w: h, h: w } : {}) };
  };
  if (type === 'chest') {
    const next = rotate(map.chests[index]);
    return canPlaceChest(map, next, index) ? { map: { ...map, chests: replace(map.chests, index, next) } } : { map, error: 'Сундук не помещается в новом положении.' };
  }
  if (type === 'crypt') {
    const next = rotate(map.crypt![index]);
    const temp = { ...map, crypt: clear(map.crypt, index) };
    return canPlaceCrypt(temp, next) ? { map: { ...map, crypt: replace(map.crypt!, index, next) } } : { map, error: 'Предмет не помещается после поворота.' };
  }
  if (type === 'civic') {
    const next = rotate(map.civic![index]);
    const temp = { ...map, civic: clear(map.civic, index) };
    return canPlaceCivic(temp, next) ? { map: { ...map, civic: replace(map.civic!, index, next) } } : { map, error: 'Объект не помещается после поворота.' };
  }
  if (type === 'furniture') {
    const building = map.buildings![target.building], items = interiorOf(building).furnishings;
    const next = rotate(items[index]);
    if (!canFurnish({ ...building, furniture: clear(items, index) }, next)) return { map, error: 'После поворота предмет пересекает стену или соседнюю мебель.' };
    const house = { ...building, source: 'manual' as const, furniture: replace(items, index, next) };
    return { map: { ...map, buildings: replace(map.buildings!, target.building, house) } };
  }
  return { map, error: 'Деревья и камни не поворачиваются.' };
}

export function removeObject(map: MapData, target: ObjectTarget): MapData {
  const { type, index } = target;
  if (type === 'chest') return { ...map, chests: clear(map.chests, index) };
  if (type === 'tree') return { ...map, trees: clear(map.trees, index) };
  if (type === 'rock') return { ...map, rocks: clear(map.rocks, index) };
  if (type === 'crypt') {
    const items = clear(map.crypt, index);
    return { ...map, crypt: items.filter((item) => !coversHazard(item.kind) || items.some((pit) => hazard(pit.kind) && intersects(pit, item))) };
  }
  if (type === 'civic') return { ...map, civic: clear(map.civic, index) };
  if (type === 'building') return { ...map, buildings: clear(map.buildings, index) };
  if (target.type !== 'furniture') return map;
  const b = map.buildings?.[target.building];
  return b ? { ...map, buildings: replace(map.buildings!, target.building, { ...b, source: 'manual', furniture: clear(interiorOf(b).furnishings, index) }) } : map;
}