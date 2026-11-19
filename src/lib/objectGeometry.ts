import type { EditorSettings, ObjectDimensions, Point, Selection } from './types';

export const MIN_OBJECT_SIZE = .15;
export const MAX_OBJECT_SIZE = 20;
export const roundedSize = (n: number) => Math.round(n * 100) / 100;
export const validSize = (size: ObjectDimensions) => [size.w, size.h].every((n) => Number.isFinite(n) && n >= MIN_OBJECT_SIZE && n <= MAX_OBJECT_SIZE);
export const rotatedSize = (size: ObjectDimensions, rotation = 0): ObjectDimensions => rotation % 180 ? { w: size.h, h: size.w } : { ...size };
export const centeredBounds = (point: Point, size: ObjectDimensions, rotation = 0): Selection => {
  const { w, h } = rotatedSize(size, rotation);
  return { x: point.x - w / 2, y: point.y - h / 2, w, h };
};
export function objectKey(settings: EditorSettings) {
  const s = settings;
  return `${s.tool}:${s.tool === 'chest' ? s.chestKind : s.tool === 'crypt' ? s.cryptKind : s.tool === 'civic' ? `${s.civicKind}:${s.civicSize}`
    : s.tool === 'furniture' ? `${s.furnitureKind}:${s.furnitureSprite}` : s.tool === 'building' ? s.buildingSize : s.tool === 'tree' ? s.treeKind : 'default'}`;
}
export function stampDimensions(settings: EditorSettings, fallback: ObjectDimensions) {
  const dimensions = settings.objectSizes?.[objectKey(settings)] ?? fallback;
  return { w: dimensions.w, h: dimensions.h };
}
export function rectOnGrid(point: Point, size: ObjectDimensions) {
  return {
    x: Math.max(0, Math.floor(point.x) - Math.floor((size.w - 1) / 2)),
    y: Math.max(0, Math.floor(point.y) - Math.floor((size.h - 1) / 2)),
    ...size,
  };
}
export function footprintCells(rect: Selection, each: (x: number, y: number) => boolean) {
  for (let y = Math.floor(rect.y + .00001); y < Math.ceil(rect.y + rect.h - .00001); y++) {
    for (let x = Math.floor(rect.x + .00001); x < Math.ceil(rect.x + rect.w - .00001); x++) if (!each(x, y)) return false;
  }
  return true;
}