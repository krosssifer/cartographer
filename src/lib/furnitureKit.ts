import type { FurnitureFinish, FurnitureKind, Furnishing, Selection } from './types';

export type FurnitureGroup = 'living' | 'bedroom' | 'utility';

type FurnitureSpec = { label: string; group: FurnitureGroup; w: number; h: number; flat?: boolean; art?: string };

export const FURNITURE: Record<FurnitureKind, FurnitureSpec> = {
  table: { label: 'Круглый стол', group: 'living', w: 1.10, h: 1.10 },
  chair: { label: 'Стул', group: 'living', w: .44, h: .49 },
  bar: { label: 'Барная стойка', group: 'living', w: 2.78, h: .81 },
  longTable: { label: 'Обеденный стол', group: 'living', w: 1.58, h: .77 },
  bench: { label: 'Скамья', group: 'living', w: 1.26, h: .38 },
  stool: { label: 'Табурет', group: 'living', w: .39, h: .39 },
  hearth: { label: 'Камин', group: 'living', w: 1.21, h: .74 },
  rug: { label: 'Красный ковёр', group: 'living', w: 1.88, h: 1.05, flat: true },
  bed: { label: 'Кровать', group: 'bedroom', w: .79, h: 1.32 },
  wardrobe: { label: 'Шкаф', group: 'bedroom', w: .69, h: .99 },
  trunk: { label: 'Ларь', group: 'bedroom', w: .72, h: .52, art: 'chest' },
  desk: { label: 'Письменный стол', group: 'bedroom', w: 1.03, h: .57 },
  bookcase: { label: 'Книжный стеллаж', group: 'bedroom', w: .98, h: .48 },
  linen: { label: 'Зелёный ковёр', group: 'bedroom', w: 1.55, h: .91, flat: true },
  screen: { label: 'Ширма', group: 'bedroom', w: 1.01, h: .35 },
  lantern: { label: 'Фонарь', group: 'bedroom', w: .29, h: .31 },
  stove: { label: 'Кухонная печь', group: 'utility', w: 1.10, h: .77 },
  worktop: { label: 'Разделочный стол', group: 'utility', w: 1.16, h: .53 },
  cupboard: { label: 'Буфет', group: 'utility', w: 1.16, h: .42 },
  basin: { label: 'Умывальник', group: 'utility', w: .57, h: .54 },
  barrels: { label: 'Бочки', group: 'utility', w: .91, h: .86 },
  crates: { label: 'Ящики', group: 'utility', w: 1.10, h: .65 },
  jars: { label: 'Кувшины', group: 'utility', w: .65, h: .48 },
  basket: { label: 'Корзина', group: 'utility', w: .52, h: .44 },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];
export const FURNITURE_GROUPS: Record<FurnitureGroup, string> = { living: 'Зал', bedroom: 'Жильё', utility: 'Кухня и склад' };
export const furnitureArt = (kind: FurnitureKind) => FURNITURE[kind].art ?? `furniture-${kind}`;
export const FURNITURE_FINISHES: Record<FurnitureFinish, { label: string; filter: string; color: string }> = {
  oak: { label: 'Медовый дуб', filter: 'none', color: '#af8355' },
  walnut: { label: 'Тёмный орех', filter: 'saturate(.84) brightness(.72) contrast(1.13)', color: '#695044' },
  moss: { label: 'Патина', filter: 'hue-rotate(36deg) saturate(.69) brightness(.88)', color: '#79816a' },
  ash: { label: 'Светлый ясень', filter: 'saturate(.64) brightness(1.22) contrast(.88)', color: '#c4ac8e' },
};
export const FURNITURE_FINISH_KEYS = Object.keys(FURNITURE_FINISHES) as FurnitureFinish[];

export function furnitureBounds(item: Furnishing): Selection {
  const spec = item.size ?? FURNITURE[item.kind], turn = item.rotation % 180 !== 0;
  const w = turn ? spec.h : spec.w, h = turn ? spec.w : spec.h;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}