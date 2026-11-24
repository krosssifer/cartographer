/**
 * Сцены залов комплекса: главный объект, второстепенные предметы, декор и
 * свободное место. У каждого назначения — несколько вариантов, вариант
 * выбирается по seed зала, поэтому два зала одного назначения обставлены
 * по-разному.
 *
 * Слоты описывают место относительно архитектуры зала, а не координаты:
 *   focus   — композиционный фокус (апсида, помост, дальний конец);
 *   flank   — пара по бокам фокуса;
 *   front   — перед фокусом, на оси;
 *   center  — центр зала;
 *   wall    — у стены (пол);
 *   face    — на самой стене (настенный предмет);
 *   corner  — угол;
 *   row     — ряд вдоль одной стены;
 *   any     — свободное место.
 * Стилевые подстановки: '@statue', '@column', '@hall', '@stand', '@ritual',
 * '@wall' берутся из выбранного стиля (styles.ts).
 */
import type { CryptKind } from '../../types';
import type { ComplexPurpose } from './registry';

export type SceneSlot = 'focus' | 'flank' | 'front' | 'center' | 'wall' | 'face' | 'corner' | 'row' | 'any';
export type SceneKind = CryptKind | '@statue' | '@hall' | '@stand' | '@ritual' | '@wall';

export interface ScenePart { kind: SceneKind; slot: SceneSlot; count?: number; optional?: boolean }
export interface SceneVariant { id: string; label: string; parts: ScenePart[] }

const v = (id: string, label: string, parts: ScenePart[]): SceneVariant => ({ id, label, parts });
const p = (kind: SceneKind, slot: SceneSlot, count = 1, optional = false): ScenePart => ({ kind, slot, count, optional });

export const SCENES: Partial<Record<ComplexPurpose, SceneVariant[]>> = {
  entrance: [
    v('gatehouse', 'вестибюль со стражей', [p('@statue', 'flank'), p('bench', 'wall', 2), p('@wall', 'face', 2, true)]),
    v('porch', 'притвор', [p('rug', 'center'), p('@stand', 'flank'), p('urns', 'corner', 2, true)]),
  ],
  hall: [
    v('ceremonial', 'церемониальный зал', [p('altar', 'focus'), p('@stand', 'flank'), p('rug', 'front'), p('@statue', 'corner', 2), p('@wall', 'face', 3, true)]),
    v('assembly', 'зал собраний', [p('@hall', 'center'), p('bench', 'row', 4), p('banner', 'face', 3, true), p('@statue', 'flank', 1, true)]),
    v('relic', 'реликварий', [p('pedestalStatue', 'focus'), p('relicCase', 'wall', 2), p('@stand', 'flank'), p('ancientSigil', 'front', 1, true)]),
  ],
  throne: [
    v('court', 'тронный зал', [p('cryptPodium', 'focus'), p('@statue', 'flank'), p('rug', 'front'), p('banner', 'face', 4), p('@hall', 'center', 1, true)]),
    v('audience', 'зал приёмов', [p('cryptPodium', 'focus'), p('@stand', 'flank'), p('bench', 'row', 3), p('tapestry', 'face', 3, true)]),
  ],
  guard: [
    v('post', 'караульный пост', [p('mapTable', 'center'), p('toolRack', 'wall'), p('bench', 'wall'), p('signalHorn', 'wall', 1, true)]),
    v('watch', 'дежурка', [p('writingDesk', 'wall'), p('toolRack', 'wall', 2), p('barrels', 'corner', 1, true)]),
  ],
  barracks: [
    v('bunks', 'спальные места', [p('hayPile', 'row', 4), p('crates', 'wall', 2), p('toolRack', 'wall'), p('bench', 'center', 1, true)]),
    v('mess', 'казарма со столом', [p('mapTable', 'center'), p('bench', 'wall', 2), p('hayPile', 'corner', 3), p('barrels', 'wall', 1, true)]),
  ],
  dormitory: [
    v('cells', 'спальни', [p('hayPile', 'row', 5), p('sackPile', 'wall', 2), p('bucket', 'any', 1, true)]),
    v('dorm', 'общий зал', [p('hayPile', 'corner', 4), p('crates', 'wall'), p('oilLamp', 'any', 1, true)]),
  ],
  quarters: [
    v('chamber', 'покои', [p('writingDesk', 'wall'), p('chest', 'corner'), p('rug', 'center'), p('shelf', 'wall', 1, true), p('tapestry', 'face', 1, true)]),
    v('study', 'кабинет', [p('bookcase', 'wall', 2), p('writingDesk', 'wall'), p('globe', 'corner', 1, true), p('candles', 'wall', 1, true)]),
  ],
  kitchen: [
    v('hearth', 'очаг', [p('forge', 'wall'), p('cauldron', 'center'), p('barrels', 'wall', 2), p('sackPile', 'corner', 2), p('bucket', 'any', 1, true)]),
    v('larder', 'кухня-кладовая', [p('cauldron', 'center'), p('shelf', 'row', 3), p('crates', 'corner', 2)]),
  ],
  storage: [
    v('stacks', 'склад', [p('crateStack', 'row', 3), p('barrelStack', 'wall', 2), p('sackPile', 'corner', 2), p('crates', 'any', 1, true)]),
    v('shelves', 'кладовая', [p('shelf', 'row', 4), p('barrels', 'corner', 2), p('crateOpen', 'wall', 1, true)]),
  ],
  workshop: [
    v('smithy', 'кузня', [p('forge', 'wall'), p('anvil', 'center'), p('bellows', 'wall'), p('coalHeap', 'corner'), p('toolRack', 'wall', 1, true)]),
    v('joinery', 'мастерская', [p('workbench', 'row', 2), p('vise', 'wall'), p('toolbox', 'wall'), p('sawhorse', 'any', 1, true)]),
  ],
  armory: [
    v('racks', 'оружейная', [p('toolRack', 'row', 4), p('crates', 'corner', 2), p('anvil', 'center', 1, true)]),
    v('vault', 'склад оружия', [p('toolRack', 'wall', 3), p('chest', 'corner'), p('banner', 'face', 1, true)]),
  ],
  machinery: [
    v('engine', 'механизм', [p('winch', 'center'), p('gear', 'face', 2), p('gearCog', 'face', 1), p('chainPulley', 'face', 1), p('counterweight', 'wall', 1, true)]),
    v('pump', 'насосная', [p('stoneWell', 'center'), p('lever', 'face', 2), p('pulley', 'wall'), p('bucketStand', 'wall', 1, true)]),
  ],
  shrine: [
    v('altar', 'святилище', [p('altar', 'focus'), p('@ritual', 'front'), p('@stand', 'flank'), p('offeringBowl', 'any', 1, true)]),
    v('idol', 'идол', [p('idol', 'focus'), p('incense', 'flank'), p('@wall', 'face', 2, true), p('candles', 'corner', 2, true)]),
  ],
  chapel: [
    v('pews', 'часовня', [p('altar', 'focus'), p('bench', 'row', 3), p('@stand', 'flank'), p('tapestry', 'face', 1, true)]),
    v('oratory', 'молельня', [p('lectern', 'focus'), p('candles', 'flank'), p('rug', 'center'), p('bell', 'face', 1, true)]),
  ],
  ritual: [
    v('circle', 'ритуальный круг', [p('@ritual', 'center'), p('@stand', 'flank'), p('obelisk', 'corner', 2, true), p('sacrificialKnife', 'any', 1, true)]),
    v('summoning', 'зал призыва', [p('runeCirclePurple', 'center'), p('candleWheel', 'corner', 2), p('altar', 'focus', 1, true)]),
  ],
  burial: [
    v('sarcophagi', 'саркофаги', [p('coffin', 'row', 3), p('@stand', 'flank', 1, true), p('urns', 'corner', 2)]),
    v('tombs', 'гробницы', [p('tomb', 'center'), p('burialNiche', 'wall', 2), p('graveCandle', 'any', 2, true)]),
  ],
  ossuary: [
    v('bones', 'костница', [p('ossuaryShelf', 'row', 3), p('bonePile', 'corner', 2), p('skull', 'any', 2, true)]),
    v('charnel', 'склад костей', [p('skeletonPile', 'wall', 3), p('bones', 'any', 2), p('candles', 'corner', 1, true)]),
  ],
  library: [
    v('stacks', 'книгохранилище', [p('bookcase', 'row', 5), p('lectern', 'center'), p('writingDesk', 'wall', 1, true), p('globe', 'corner', 1, true)]),
    v('reading', 'читальня', [p('mapTable', 'center'), p('bookcase', 'wall', 3), p('scrollRack', 'wall', 2), p('candleStand', 'corner', 1, true)]),
  ],
  archive: [
    v('scrolls', 'архив', [p('scrollRack', 'row', 4), p('writingDesk', 'wall'), p('ledger', 'any', 1, true)]),
    v('records', 'реестр', [p('bookcase', 'row', 3), p('crates', 'corner'), p('inkwell', 'any', 1, true)]),
  ],
  laboratory: [
    v('bench', 'лабораторные столы', [p('workbench', 'row', 3), p('cauldron', 'center'), p('shelf', 'wall', 2), p('brassScale', 'any', 1, true)]),
    v('experiment', 'эксперимент', [p('runeCircleBlue', 'center'), p('workbench', 'wall', 2), p('orbRed', 'corner'), p('cage', 'corner', 1, true)]),
  ],
  alchemy: [
    v('alembic', 'алхимическая', [p('cauldron', 'center'), p('shelf', 'row', 3), p('workbench', 'wall'), p('barrels', 'corner', 1, true)]),
    v('brewery', 'перегонная', [p('forge', 'wall'), p('cauldron', 'front'), p('shelf', 'wall', 2), p('bucket', 'any', 1, true)]),
  ],
  cell: [
    v('cell', 'камера', [p('manacles', 'corner'), p('hayPile', 'corner'), p('bucket', 'any', 1, true)]),
    v('stocks', 'пыточная', [p('stocks', 'wall'), p('chains', 'corner'), p('tortureRack', 'wall', 1, true)]),
  ],
  treasury: [
    v('hoard', 'сокровищница', [p('chest', 'focus'), p('relicCase', 'wall', 2), p('pedestal', 'flank', 1, true)]),
    v('vault', 'хранилище', [p('chest', 'corner', 2), p('reliquaryUrn', 'wall', 2), p('brassScale', 'any', 1, true)]),
  ],
  secret: [
    v('stash', 'тайник', [p('chest', 'center'), p('skeleton', 'corner', 1, true)]),
  ],
  collector: [
    v('collector', 'коллектор', [p('sewerGrate', 'any', 2), p('drain', 'wall', 2), p('lever', 'face', 1, true)]),
  ],
  cistern: [
    v('cistern', 'цистерна', [p('bucketStand', 'wall'), p('drain', 'wall', 2), p('ladder', 'wall', 1, true)]),
  ],
  gallery: [
    v('gallery', 'галерея', [p('@statue', 'row', 3), p('@wall', 'face', 3, true)]),
    v('portrait', 'парадная галерея', [p('bust', 'row', 3), p('rug', 'center', 2, true)]),
  ],
  landing: [
    v('landing', 'лестничный зал', [p('@stand', 'corner', 2, true)]),
  ],
  mining: [
    v('face', 'забой', [p('mineCart', 'any'), p('crystals', 'corner', 2), p('rockPile', 'any', 1, true), p('pebbles', 'any', 2, true)]),
    v('dig', 'выработка', [p('scaffold', 'wall'), p('rope', 'corner'), p('coalHeap', 'corner', 2), p('bucket', 'any', 1, true)]),
  ],
  cave: [
    v('grotto', 'грот', [p('stalagmites', 'any', 3), p('crystalCluster', 'corner', 1, true), p('pebbles', 'any', 2, true)]),
    v('den', 'логово', [p('bonePile', 'corner'), p('nestEggs', 'corner', 1, true), p('stalagmites', 'any', 2), p('mushroomsGlow', 'any', 1, true)]),
    v('vault', 'пещерный свод', [p('rockOutcrop', 'any'), p('stalactites', 'wall', 2), p('puddleBlue', 'any', 1, true)]),
  ],
  lake: [
    v('shore', 'берег', [p('stalagmites', 'any', 2), p('fishNet', 'corner', 1, true), p('glowingMushroom', 'corner', 2, true)]),
  ],
};

/** Geometry-aware priority only; final placement is always checked against the real mask. */
export interface SceneRoomContext {
  area: number;
  free: number;
  wallCells: number;
  width: number;
  height: number;
  doors: number;
  shape: string;
  depth: number;
  style: string;
  condition: string;
}

/** Compact variants are preferable in cramped or highly connected rooms; long rows
 * need a real wall. The deterministic tie-break keeps same-context variety. */
export function rankSceneVariants(variants: readonly SceneVariant[], context: SceneRoomContext,
  footprint: (kind: SceneKind) => { w: number; h: number }, seed: number): SceneVariant[] {
  const jitter = (id: string) => {
    let h = seed >>> 0;
    for (const c of `${id}:${context.style}:${context.condition}:${context.depth}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return (h % 1000) / 1000;
  };
  const score = (v: SceneVariant) => {
    let area = 0, wall = 0, row = 0, flank = 0;
    for (const p of v.parts) {
      if (p.optional) continue;
      const spec = footprint(p.kind), n = p.count ?? 1;
      if (p.slot !== 'face') area += spec.w * spec.h * n;
      if (p.slot === 'wall' || p.slot === 'face' || p.slot === 'row') wall += n;
      if (p.slot === 'row') row = Math.max(row, n * 2 + 1);
      if (p.slot === 'flank') flank = Math.max(flank, 5);
    }
    const available = Math.max(1, context.free - context.doors * 2);
    const crowd = area / available;
    const wallDemand = wall / Math.max(1, context.wallCells);
    const longSide = Math.max(context.width, context.height);
    const narrow = Math.min(context.width, context.height);
    const geometryPenalty = Math.max(0, row - longSide) * 2 + Math.max(0, flank - narrow) * 2;
    // Irregular shapes have less useful straight wall than their bounding box.
    const irregular = context.shape === 'rect' || context.shape === 'rectangle' ? 0 : row * .015;
    return crowd * 3 + wallDemand + geometryPenalty + irregular + jitter(v.id) * .35;
  };
  return [...variants].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
}

export function scenePartRole(part: ScenePart, firstRequired: boolean): string {
  if (firstRequired) return 'anchor';
  switch (part.slot) {
    case 'flank': return 'flank';
    case 'row': return 'row';
    case 'face': return 'wall-display';
    case 'front': return 'approach';
    case 'wall': return 'wall-furnishing';
    case 'corner': return 'corner-furnishing';
    default: return part.optional ? 'accent' : 'support';
  }
}
