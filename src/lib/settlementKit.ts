import type { CivicKind, CivicObject, EditorSettings, RoofMaterial, RoofShape, Selection, SettlementStyle } from './types';

export const ROOF_KIT: { id: RoofMaterial; art: string; label: string; color: string; scale: number }[] = [
  { id: 0, art: 'thatch', label: 'Солома', color: '#b78f4d', scale: 2.8 },
  { id: 1, art: 'shingles', label: 'Дранка', color: '#7a5b3d', scale: 2.7 },
  { id: 2, art: 'terracotta', label: 'Черепица', color: '#a9593c', scale: 3.1 },
  { id: 3, art: 'slate', label: 'Сланец', color: '#596d7b', scale: 2.8 },
  { id: 4, art: 'copper', label: 'Медь', color: '#568d81', scale: 3.5 },
  { id: 5, art: 'garnet', label: 'Бордовая черепица', color: '#773e42', scale: 3.0 },
  { id: 6, art: 'limestone', label: 'Известняк', color: '#b8a076', scale: 3.1 },
  { id: 7, art: 'mossRoof', label: 'Мшистая дранка', color: '#5e6544', scale: 3.0 },
];

export const ROOF_SHAPES: Record<RoofShape, string> = { gable: 'Двускатная', hip: 'Вальмовая', cross: 'Крестовая' };

export const BUILDING_SIZES = [
  { w: 5, h: 4, label: 'Дом' }, { w: 7, h: 5, label: 'Большой дом' }, { w: 9, h: 7, label: 'Особняк' }, { w: 10, h: 7, label: 'Таверна' },
] as const;

export const CIVIC_KIT = {
  market: { label: 'Рынок', art: 'stallRed', icon: 'market', w: 2, h: 2 },
  square: { label: 'Площадь', art: 'cobbles', icon: 'grid', w: 5, h: 4 },
  well: { label: 'Колодец', art: 'well', icon: 'well', w: 1, h: 1 },
  fountain: { label: 'Фонтан', art: 'fountain', icon: 'well', w: 2, h: 2 },
  cart: { label: 'Телега', art: 'cart', icon: 'cart', w: 2, h: 1 },
  garden: { label: 'Огород', art: 'garden', icon: 'sprout', w: 3, h: 2 },
} satisfies Record<CivicKind, { label: string; art: string; icon: string; w: number; h: number }>;

export const CIVIC_KINDS = Object.keys(CIVIC_KIT) as CivicKind[];
export const CIVIC_SIZES = {
  market: [{ w: 2, h: 2, label: 'Один прилавок' }, { w: 4, h: 2, label: 'Торговый ряд' }, { w: 4, h: 4, label: 'Ярмарка' }],
  square: [{ w: 5, h: 4, label: '5 × 4 клетки' }, { w: 7, h: 5, label: '7 × 5 клеток' }, { w: 9, h: 7, label: '9 × 7 клеток' }],
} as const;
export const isSettlement = (biome: string): biome is SettlementStyle => biome === 'town' || biome === 'village';
export const intersects = (a: Selection, b: Selection, margin = 0) =>
  a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
export const contains = (r: Selection, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const encloses = (a: Selection, b: Selection) => contains(a, b.x, b.y) && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

export function civicArt(item: Pick<CivicObject, 'kind' | 'variant'>) {
  return item.kind === 'market' && item.variant % 2 ? 'stallGreen' : CIVIC_KIT[item.kind].art;
}

export function marketStalls(w: number, h: number, variant: number) {
  const columns = w >= 4 ? 2 : 1, rows = h >= 4 ? 2 : 1;
  return Array.from({ length: columns * rows }, (_, i) => ({
    x: (i % columns - (columns - 1) / 2) * 2,
    y: (Math.floor(i / columns) - (rows - 1) / 2) * 2,
    art: civicArt({ kind: 'market', variant: variant + i }),
  }));
}

export const DEFAULT_EDITOR: EditorSettings = {
  tool: 'brush', terrain: 'grass', brushSize: 1, brushShape: 'round', treeKind: 'oak', snap: true, chestRotation: 0,
  roofMaterial: 2, roofShape: 'gable', civicKind: 'market', stampRotation: 0, buildingSize: 1, civicSize: 0, furnitureKind: 'table', furnitureErase: false,
  furnitureFinish: 'oak', furnitureSprite: '', cryptKind: 'coffin', cryptErase: false, cryptConceal: true,
  chestKind: 'wooden', objectSizes: {}, sizeLock: true, sizeUnit: 'cells',
};