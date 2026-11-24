/**
 * Функциональные композиции дворов типизированного поселения.
 *
 * Координаты локальные: (0, 0) — верхний левый угол главного объекта в его
 * исходной ориентации. Части и свободные зоны поворачиваются вместе с ним.
 * Каталог не размещает объекты и не меняет генератор legacy-поселений.
 */
import { rotatedSize } from '../../objectGeometry';
import { CIVIC_KIT, intersects } from '../../settlementKit';
import type { ChestRotation, CivicKind, Selection } from '../../types';
import type { DistrictKind } from '../settlementTypes';
import type { CourtyardKind, PlotFunction } from './types';

export type FunctionalPartRole = 'anchor' | 'equipment' | 'materials' | 'storage' | 'domestic' | 'greenery' | 'ornament';
export type FunctionalVariantSize = 'compact' | 'standard' | 'extended';

export interface FunctionalScenePart {
  kind: CivicKind;
  /** Смещение относительно верхнего левого угла якоря, в клетках. */
  dx: number;
  dy: number;
  rotation: ChestRotation;
  required: boolean;
  role: FunctionalPartRole;
}

export interface FunctionalSceneVariant {
  id: string;
  size: FunctionalVariantSize;
  anchor: FunctionalScenePart;
  parts: readonly FunctionalScenePart[];
  /** Свободные рабочие/проходные зоны в тех же локальных координатах. */
  access: readonly Selection[];
}

export interface FunctionalSceneDefinition {
  id: string;
  label: string;
  plotFunctions: readonly PlotFunction[];
  courtyardKinds: readonly CourtyardKind[];
  districts: readonly DistrictKind[];
  weight: number;
  variants: readonly FunctionalSceneVariant[];
}

const anchor = (kind: CivicKind): FunctionalScenePart => ({ kind, dx: 0, dy: 0, rotation: 0, required: true, role: 'anchor' });
const part = (kind: CivicKind, dx: number, dy: number, role: FunctionalPartRole, required = true, rotation: ChestRotation = 0): FunctionalScenePart => ({ kind, dx, dy, role, required, rotation });
const access = (x: number, y: number, w = 1, h = 1): Selection => ({ x, y, w, h });
const variant = (id: string, size: FunctionalVariantSize, focus: CivicKind, parts: FunctionalScenePart[], zones: Selection[]): FunctionalSceneVariant => ({ id, size, anchor: anchor(focus), parts, access: zones });

/** Размеры объекта всегда определяются каталогом спрайтов, а не рецептом. */
export function functionalPartBounds(item: FunctionalScenePart): Selection {
  const size = rotatedSize(CIVIC_KIT[item.kind], item.rotation);
  return { x: item.dx, y: item.dy, ...size };
}

/** Габарит шаблона, включая обязательные свободные рабочие зоны. */
export function functionalVariantBounds(v: FunctionalSceneVariant): Selection {
  const rects = [functionalPartBounds(v.anchor), ...v.parts.map(functionalPartBounds), ...v.access];
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

export const FUNCTIONAL_SCENES: readonly FunctionalSceneDefinition[] = [
  {
    id: 'blacksmith', label: 'Кузнечный двор', plotFunctions: ['workshop'], courtyardKinds: ['workshop_yard'], districts: ['craft', 'garrison', 'poor', 'residential'], weight: 3,
    variants: [
      variant('compact', 'compact', 'urbanForge', [part('urbanAnvil', 3, 0, 'equipment'), part('urbanBellows', -1, 0, 'equipment'), part('urbanCoal', 0, 3, 'materials')], [access(2, 1)]),
      variant('side_store', 'standard', 'urbanForge', [part('urbanAnvil', -2, 1, 'equipment'), part('urbanBellows', 2, 0, 'equipment'), part('urbanCoal', -1, 3, 'materials'), part('urbanToolRack', 1, 3, 'equipment', false)], [access(-1, 1)]),
      variant('wide', 'extended', 'urbanForge', [part('urbanBellows', -1, 1, 'equipment'), part('urbanAnvil', 3, 1, 'equipment'), part('urbanCoal', 0, 3, 'materials'), part('urbanToolRack', 3, 3, 'equipment', false)], [access(2, 1), access(1, 2)]),
    ],
  },
  {
    id: 'carpenter', label: 'Столярный двор', plotFunctions: ['workshop'], courtyardKinds: ['workshop_yard'], districts: ['craft', 'residential', 'poor', 'farms'], weight: 3,
    variants: [
      variant('compact', 'compact', 'urbanWorkbench', [part('urbanPlanks', 0, 2, 'materials'), part('urbanSawhorse', 3, 0, 'equipment')], [access(1, 1)]),
      variant('woodpile', 'standard', 'urbanWorkbench', [part('urbanSawhorse', -3, 0, 'equipment'), part('urbanPlanks', 0, 2, 'materials'), part('urbanToolRack', 3, 2, 'equipment', false)], [access(1, 1)]),
      variant('joinery', 'extended', 'urbanWorkbench', [part('urbanSawhorse', -3, 1, 'equipment'), part('urbanPlanks', 0, 2, 'materials'), part('urbanToolRack', 3, 0, 'equipment'), part('urbanWoodpile', 3, 2, 'materials', false)], [access(-1, 0), access(1, 1)]),
    ],
  },
  {
    id: 'pottery', label: 'Гончарная мастерская', plotFunctions: ['workshop'], courtyardKinds: ['workshop_yard'], districts: ['craft', 'residential', 'poor'], weight: 2,
    variants: [
      variant('compact', 'compact', 'urbanPotteryWheel', [part('urbanPotteryKiln', 2, 0, 'equipment'), part('urbanPots', 0, 2, 'storage')], [access(1, 1)]),
      variant('side_kiln', 'standard', 'urbanPotteryWheel', [part('urbanPotteryKiln', -3, 0, 'equipment'), part('urbanPots', 1, 2, 'storage'), part('yardWaterPail', -2, 3, 'materials', false)], [access(0, 1)]),
      variant('kiln_yard', 'extended', 'urbanPotteryWheel', [part('urbanPotteryKiln', -3, 0, 'equipment'), part('urbanPots', 1, 2, 'storage'), part('yardWaterPail', -2, 3, 'materials'), part('marketCrates', 3, 2, 'storage', false)], [access(0, 1)]),
    ],
  },
  {
    id: 'warehouse', label: 'Складской двор', plotFunctions: ['warehouse'], courtyardKinds: ['trade_courtyard'], districts: ['docks', 'market', 'craft', 'centre'], weight: 3,
    variants: [
      variant('compact', 'compact', 'marketCrates', [part('marketBarrelPair', 3, 0, 'storage'), part('marketRope', 0, 3, 'equipment')], [access(2, 1)]),
      variant('loading', 'standard', 'marketCrates', [part('marketWheelbarrow', -3, 0, 'equipment'), part('marketSacks', 0, 3, 'materials'), part('marketRope', 3, 2, 'equipment', false)], [access(-1, 1)]),
      variant('dispatch', 'extended', 'marketCrates', [part('marketWheelbarrow', -3, 1, 'equipment'), part('marketSacks', 0, 3, 'materials'), part('marketBarrelPair', 3, 0, 'storage'), part('marketRope', 3, 3, 'equipment', false)], [access(-1, 0), access(2, 1)]),
    ],
  },
  {
    // Хозяйственный двор магазина, не торговый ряд и не место рынка.
    id: 'shop_store', label: 'Подсобный двор лавки', plotFunctions: ['shop'], courtyardKinds: ['trade_courtyard', 'workshop_yard', 'inn_yard', 'garden_yard', 'enclosed_courtyard'], districts: ['centre', 'market', 'docks', 'craft', 'residential', 'poor'], weight: 2,
    variants: [
      variant('goods', 'compact', 'marketCrates', [part('urbanPots', 2, 0, 'storage')], [access(2, 1)]),
      variant('restock', 'standard', 'marketCrates', [part('marketBarrelPair', 0, 3, 'storage'), part('marketRope', 3, 0, 'equipment'), part('marketBaskets', 3, 2, 'storage', false)], [access(2, 1)]),
      variant('back_store', 'extended', 'marketCrates', [part('marketWheelbarrow', -3, 1, 'equipment'), part('marketBarrelPair', 0, 3, 'storage'), part('marketSacks', 3, 0, 'storage'), part('marketRope', 3, 3, 'equipment', false)], [access(-1, 0), access(2, 1)]),
    ],
  },
  {
    id: 'inn', label: 'Двор таверны', plotFunctions: ['tavern'], courtyardKinds: ['inn_yard'], districts: ['centre', 'market', 'residential', 'docks', 'poor'], weight: 3,
    variants: [
      variant('table', 'compact', 'marketTableSet', [part('marketBarrelPair', 0, 3, 'storage')], [access(3, 1)]),
      variant('service', 'standard', 'marketBarrels', [part('marketBench', 3, 0, 'domestic'), part('yardWaterPail', 0, 3, 'domestic'), part('lampOilLantern', 3, 2, 'ornament', false)], [access(2, 1)]),
      variant('courtyard_table', 'extended', 'marketTableSet', [part('marketBench', -3, 1, 'domestic'), part('marketBarrels', 0, 3, 'storage'), part('yardWaterPail', 4, 0, 'domestic'), part('lampOilLantern', 3, 3, 'ornament', false)], [access(3, 1)]),
    ],
  },
  {
    id: 'stable', label: 'Конюшенный двор', plotFunctions: ['stable', 'farm'], courtyardKinds: ['inn_yard', 'garden_yard', 'enclosed_courtyard'], districts: ['farms', 'garrison', 'residential', 'market', 'poor'], weight: 2,
    variants: [
      variant('feeding', 'compact', 'urbanTrough', [part('marketHay', 3, 0, 'materials'), part('yardWaterPail', 0, 2, 'domestic')], [access(2, 1)]),
      variant('hitching', 'standard', 'urbanHitchingRail', [part('urbanTrough', 0, 2, 'equipment'), part('marketHay', 3, 2, 'materials'), part('yardWaterPail', -2, 2, 'domestic', false)], [access(1, 1)]),
      variant('stabling', 'extended', 'urbanTrough', [part('urbanHitchingRail', -3, 0, 'equipment'), part('marketHay', 0, 2, 'materials'), part('yardWaterPail', 3, 1, 'domestic'), part('marketRope', 3, 3, 'equipment', false)], [access(-1, 1), access(2, 0)]),
    ],
  },
  {
    id: 'residential', label: 'Жилой двор', plotFunctions: ['small_residential', 'large_residential', 'courtyard'], courtyardKinds: ['enclosed_courtyard', 'garden_yard', 'workshop_yard', 'trade_courtyard'], districts: ['residential', 'poor', 'centre', 'farms', 'craft', 'market', 'docks'], weight: 3,
    variants: [
      variant('laundry', 'compact', 'yardLaundryLine', [part('yardWashTub', 0, 2, 'domestic'), part('yardWaterPail', 2, 2, 'domestic')], [access(1, 1)]),
      variant('firewood', 'standard', 'yardFirewoodRack', [part('yardChoppingBlock', 3, 0, 'equipment'), part('yardWaterPail', 0, 2, 'domestic'), part('yardBroomRake', 3, 2, 'domestic', false)], [access(2, 1)]),
      variant('household', 'extended', 'yardLaundryLine', [part('yardWashTub', 0, 2, 'domestic'), part('yardWaterPail', 2, 2, 'domestic'), part('yardFirewoodRack', -3, 1, 'storage'), part('yardBroomRake', -3, 3, 'domestic', false)], [access(1, 1)]),
    ],
  },
  {
    id: 'vegetable_garden', label: 'Огород', plotFunctions: ['garden', 'farm', 'courtyard'], courtyardKinds: ['garden_yard', 'private_garden'], districts: ['farms', 'residential', 'poor', 'noble'], weight: 3,
    variants: [
      variant('vegetables', 'compact', 'yardVegetableBed', [part('yardWaterPail', 3, 0, 'domestic'), part('yardHerbBed', 0, 3, 'greenery')], [access(2, 1)]),
      variant('herbs', 'standard', 'yardHerbBed', [part('yardVegetableBed', 0, 2, 'greenery'), part('yardCompostBin', 3, 2, 'storage'), part('yardBroomRake', -1, 1, 'equipment', false)], [access(1, 1)]),
      variant('kitchen_garden', 'extended', 'yardVegetableBed', [part('yardHerbBed', 0, 3, 'greenery'), part('yardCompostBin', 3, 2, 'storage'), part('yardWaterPail', 3, 0, 'domestic'), part('yardBroomRake', 2, 4, 'equipment', false)], [access(2, 1)]),
    ],
  },
  {
    id: 'temple', label: 'Храмовый двор', plotFunctions: ['temple', 'courtyard'], courtyardKinds: ['temple_courtyard'], districts: ['temple', 'centre'], weight: 2,
    variants: [
      variant('shrine', 'compact', 'urbanStreetShrine', [part('greenFlowerUrn', -2, 0, 'ornament'), part('greenFlowerUrn', 2, 0, 'ornament')], [access(0, 1)]),
      variant('well', 'standard', 'marketWell', [part('marketBench', -3, 0, 'domestic'), part('greenFlowerUrn', 3, 0, 'ornament')], [access(-1, 1)]),
      variant('shrine_garden', 'extended', 'urbanStreetShrine', [part('marketBench', -3, 0, 'domestic'), part('greenFlowerUrn', 2, 0, 'ornament'), part('greenStonePlanterRect', 0, 3, 'greenery'), part('lampOilLantern', 3, 2, 'ornament', false)], [access(0, 1)]),
    ],
  },
  {
    id: 'noble_garden', label: 'Парадный сад', plotFunctions: ['noble_villa', 'garden', 'courtyard'], courtyardKinds: ['private_garden'], districts: ['noble', 'centre'], weight: 2,
    variants: [
      variant('statue', 'compact', 'greenSmallGardenStatue', [part('greenTopiaryBall', -2, 0, 'greenery'), part('greenTopiaryBall', 2, 0, 'greenery')], [access(0, 1)]),
      variant('planter', 'standard', 'greenStonePlanterRect', [part('marketBench', -3, 1, 'domestic'), part('greenFlowerUrn', 3, 0, 'ornament')], [access(1, 1)]),
      variant('garden_walk', 'extended', 'greenSmallGardenStatue', [part('greenStonePlanterRect', -3, 0, 'greenery'), part('marketBench', 2, 1, 'domestic'), part('greenFlowerUrn', 0, 3, 'ornament'), part('greenTopiaryBall', 4, 0, 'greenery', false)], [access(1, 0)]),
    ],
  },
];

/** Проверка статического каталога, пригодная и для диагностики будущих расширений. */
export function validateFunctionalScenes(scenes: readonly FunctionalSceneDefinition[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (!scene.id || ids.has(scene.id)) errors.push(`duplicate or empty scene id: ${scene.id}`);
    ids.add(scene.id);
    if (!scene.label || !(scene.weight > 0) || !scene.plotFunctions.length || !scene.courtyardKinds.length || !scene.districts.length || !scene.variants.length) errors.push(`${scene.id}: incomplete eligibility`);
    const variants = new Set<string>();
    for (const v of scene.variants) {
      const tag = `${scene.id}/${v.id}`;
      if (!v.id || variants.has(v.id)) errors.push(`${tag}: duplicate or empty variant`);
      variants.add(v.id);
      if (!v.anchor || !v.anchor.required || v.anchor.role !== 'anchor' || v.anchor.dx !== 0 || v.anchor.dy !== 0) { errors.push(`${tag}: invalid anchor`); continue; }
      const items = [v.anchor, ...v.parts];
      let valid = true;
      for (const item of items) {
        const spec = CIVIC_KIT[item.kind];
        if (!spec || !(spec.w > 0 && spec.h > 0) || !Number.isInteger(item.dx) || !Number.isInteger(item.dy) || ![0, 90, 180, 270].includes(item.rotation) || typeof item.required !== 'boolean' || !item.role) {
          errors.push(`${tag}: invalid part ${item.kind}`); valid = false;
        }
        if (item !== v.anchor && item.role === 'anchor') errors.push(`${tag}: multiple anchors`);
      }
      if (!v.parts.some((item) => item.required)) errors.push(`${tag}: no required companion`);
      if (!v.access.length || v.access.some((r) => ![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.w < 1 || r.h < 1)) { errors.push(`${tag}: invalid access area`); valid = false; }
      if (!valid) continue;
      const rects = items.map(functionalPartBounds);
      for (let i = 0; i < rects.length; i++) {
        for (let j = 0; j < i; j++) if (intersects(rects[i], rects[j])) errors.push(`${tag}: overlapping parts`);
        if (v.access.some((zone) => intersects(rects[i], zone))) errors.push(`${tag}: blocked access area`);
      }
      for (let i = 0; i < v.access.length; i++) for (let j = 0; j < i; j++) {
        if (intersects(v.access[i], v.access[j])) errors.push(`${tag}: overlapping access areas`);
      }
      const bounds = functionalVariantBounds(v);
      if (bounds.w > 12 || bounds.h > 12 || bounds.w < 1 || bounds.h < 1) errors.push(`${tag}: unreasonable bounds`);
    }
  }
  return errors;
}
