/** Детерминированный подбор целой функциональной сцены без изменения карты. */
import { hash2 } from '../../random';
import type { Building, ChestRotation, CityCondition, CivicKind, Point, Selection } from '../../types';
import { functionalPartBounds, type FunctionalSceneDefinition, type FunctionalScenePart } from './scenes';
import { intersects } from '../../settlementKit';
import { facingVector, type UrbanPlot } from './types';

export type SceneRejection = 'collision' | 'bounds' | 'doorAccess' | 'insufficientSpace' | 'districtMismatch';
export type SceneObstacle = 'building' | 'passage' | 'street' | 'reservation' | 'water' | 'terrain' | 'civic' | 'scene' | 'plot' | 'door' | 'other';
export interface SceneRotationTrace {
  sceneId: string;
  variantId: string;
  rotation: ChestRotation;
  requiredWidth: number;
  requiredHeight: number;
  positions: number;
  geometricallyValid: number;
  reasons: Partial<Record<SceneRejection | SceneObstacle, number>>;
}
export type SceneCheckResult = SceneRejection | { reason: SceneRejection; obstacle: SceneObstacle } | null;


export interface PlacedFunctionalPart extends Selection {
  kind: CivicKind;
  rotation: ChestRotation;
  role: FunctionalScenePart['role'];
  required: boolean;
}

export interface FunctionalPlacement {
  sceneId: string;
  variantId: string;
  plotId: number;
  rotation: ChestRotation;
  bounds: Selection;
  anchor: PlacedFunctionalPart;
  parts: PlacedFunctionalPart[];
  access: Selection[];
  score: number;
}

export interface FunctionalPlacementInput {
  seed: number;
  plot: UrbanPlot;
  /** Только настоящая свободная зона двора, не весь bounding box участка. */
  zone: Selection;
  building?: Building;
  condition?: CityCondition;
  scenes: readonly FunctionalSceneDefinition[];
  /** Проверка внешних ограничений; функция не должна изменять карту. */
  check: (rect: Selection, purpose: 'object' | 'access') => SceneCheckResult;
  /** Optional per-variant diagnostics; never changes placement decisions. */
  trace?: boolean;
  /** Уже размещённые в том же районе сцены, для снижения повторов. */
  previous?: readonly FunctionalPlacement[];
}

export interface FunctionalPlacementResult {
  placement: FunctionalPlacement | null;
  attempted: number;
  rejected: Record<SceneRejection, number>;
  trace?: { inapplicable: string[]; rotations: SceneRotationTrace[] };
}

const ROTATIONS: readonly ChestRotation[] = [0, 90, 180, 270];
const emptyRejections = (): Record<SceneRejection, number> => ({ collision: 0, bounds: 0, doorAccess: 0, insufficientSpace: 0, districtMismatch: 0 });
const key = (text: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
};

/** Поворот прямоугольника вокруг начала координат без потери площади. */
export function rotateFunctionalRect(r: Selection, rotation: ChestRotation): Selection {
  switch (rotation) {
    case 90: return { x: -r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 180: return { x: -r.x - r.w, y: -r.y - r.h, w: r.w, h: r.h };
    case 270: return { x: r.y, y: -r.x - r.w, w: r.h, h: r.w };
    default: return { ...r };
  }
}

function translate(rect: Selection, x: number, y: number): Selection {
  return { ...rect, x: rect.x + x, y: rect.y + y };
}

/** Центры клеток граничного прямоугольника должны лежать в полигоне участка. */
function inPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function insidePlot(rect: Selection, plot: UrbanPlot): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    if (!inPolygon(x + 0.5, y + 0.5, plot.polygon)) return false;
  }
  return true;
}

export function functionalSceneApplies(plot: UrbanPlot, building: Building | undefined, scene: FunctionalSceneDefinition): boolean {
  // Landmark assignment may override the original parcel classification (e.g.
  // the tavern is placed on a shop parcel). Its actual role takes precedence;
  // it must not inherit an unrelated workshop or residential composition.
  const roleScene: Partial<Record<NonNullable<Building['role']>, string>> = {
    tavern: 'inn', smithy: 'blacksmith', warehouse: 'warehouse',
    temple: 'temple', minor_temple: 'temple', shrine: 'temple',
    stable: 'stable', manor: 'noble_garden',
  };
  const role = building?.role ?? (building?.kind === 'tavern' ? 'tavern' : undefined);
  const explicitScene = role ? roleScene[role] : undefined;
  const incompatibleLandmark = role && ['town_hall', 'guildhall', 'citadel', 'barracks', 'prison', 'mill', 'baths'].includes(role);
  {
    if (incompatibleLandmark) return false;
    if (explicitScene) return scene.id === explicitScene
      && !!plot.courtyardKind && scene.courtyardKinds.includes(plot.courtyardKind)
      && scene.districts.includes(plot.districtType);
    return scene.plotFunctions.includes(plot.fn)
      && !!plot.courtyardKind && scene.courtyardKinds.includes(plot.courtyardKind)
      && scene.districts.includes(plot.districtType);
  }
}

/**
 * Проверяет кандидаты целиком, выбирает лучший. Внешнее состояние не меняется:
 * вызывающая сторона может сначала подтвердить все части, затем единым шагом
 * добавить их и зарезервировать рабочие зоны.
 */
export function findFunctionalPlacement(input: FunctionalPlacementInput): FunctionalPlacementResult {
  const { plot, zone, building, seed } = input;
  const rejected = emptyRejections();
  const trace = input.trace ? { inapplicable: [] as string[], rotations: [] as SceneRotationTrace[] } : undefined;
  let attempted = 0;
  let best: FunctionalPlacement | null = null;
  let bestKey = '';
  const boundsOf = (rects: readonly Selection[]): Selection => {
    const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  };
  const inZone = (r: Selection) => r.x >= zone.x && r.y >= zone.y && r.x + r.w <= zone.x + zone.w && r.y + r.h <= zone.y + zone.h;
  for (const scene of input.scenes) {
    if (!functionalSceneApplies(plot, building, scene)) { rejected.districtMismatch++; trace?.inapplicable.push(scene.id); continue; }
    for (const v of scene.variants) for (const rotation of ROTATIONS) {
      // Optional details must not prevent the required composition from fitting.
      const requiredBounds = boundsOf([functionalPartBounds(v.anchor), ...v.parts.filter((part) => part.required).map(functionalPartBounds), ...v.access]);
      const local = rotateFunctionalRect(requiredBounds, rotation);
      const rotationTrace: SceneRotationTrace | undefined = trace ? { sceneId: scene.id, variantId: v.id, rotation, requiredWidth: local.w, requiredHeight: local.h, positions: 0, geometricallyValid: 0, reasons: {} } : undefined;
      if (rotationTrace) trace!.rotations.push(rotationTrace);
      if (local.w > zone.w || local.h > zone.h) { rejected.insufficientSpace++; if (rotationTrace) rotationTrace.reasons.insufficientSpace = 1; continue; }
      // Координаты translate — начало локальной системы сцены; её bounds в зоне.
      for (let top = zone.y; top <= zone.y + zone.h - local.h; top++) for (let left = zone.x; left <= zone.x + zone.w - local.w; left++) {
        attempted++;
        if (rotationTrace) rotationTrace.positions++;
        const tx = left - local.x, ty = top - local.y;
        const zones = v.access.map((area) => translate(rotateFunctionalRect(area, rotation), tx, ty));
        const buildPart = (part: FunctionalScenePart): PlacedFunctionalPart => ({
          ...translate(rotateFunctionalRect(functionalPartBounds(part), rotation), tx, ty),
          kind: part.kind, rotation: ((part.rotation + rotation) % 360) as ChestRotation,
          role: part.role, required: part.required,
        });
        const focus = buildPart(v.anchor);
        const required = v.parts.filter((p) => p.required).map(buildPart);
        const optional = v.parts.filter((p) => !p.required).map(buildPart);
        let outcome: SceneCheckResult = null;
        const checkedObjects: Selection[] = [];
        for (const rect of [focus, ...required]) {
          outcome = checkedObjects.some((other) => intersects(rect, other)) ? { reason: 'collision', obstacle: 'scene' } : !insidePlot(rect, plot) ? { reason: 'bounds', obstacle: 'plot' } : input.check(rect, 'object');
          if (outcome) break;
          checkedObjects.push(rect);
        }
        const checkedZones: Selection[] = [];
        if (!outcome) for (const rect of zones) {
          outcome = [...checkedObjects, ...checkedZones].some((other) => intersects(rect, other)) ? { reason: 'collision', obstacle: 'scene' } : !insidePlot(rect, plot) ? { reason: 'bounds', obstacle: 'plot' } : input.check(rect, 'access');
          if (outcome) break;
          checkedZones.push(rect);
        }
        if (outcome) {
          const reason = typeof outcome === 'string' ? outcome : outcome.reason;
          rejected[reason]++;
          if (rotationTrace) {
            const detail = typeof outcome === 'string' ? reason : outcome.obstacle;
            rotationTrace.reasons[detail] = (rotationTrace.reasons[detail] ?? 0) + 1;
          }
          continue;
        }
        if (rotationTrace) rotationTrace.geometricallyValid++;
        const extras: PlacedFunctionalPart[] = [];
        for (const rect of optional) {
          if (inZone(rect) && insidePlot(rect, plot) && ![...checkedObjects, ...zones, ...extras].some((other) => intersects(rect, other)) && input.check(rect, 'object') === null) extras.push(rect);
        }
        const bounds = boundsOf([focus, ...required, ...extras, ...zones]);
        const cx = focus.x + focus.w / 2, cy = focus.y + focus.h / 2;
        const distance = building ? Math.hypot(cx - (building.x + building.w / 2), cy - (building.y + building.h / 2)) : 0;
        const [fx, fy] = building ? facingVector(building.facing ?? 0) : [0, 0];
        const awayFromFront = building ? -((cx - building.door.x) * fx + (cy - building.door.y) * fy) : 0;
        const repetition = (input.previous ?? []).filter((old) => old.sceneId === scene.id).reduce((sum, old) => sum + (old.variantId === v.id ? 2 : 1), 0);
        // Независимый стабильный разброс не зависит от порядка каталога.
        const noise = hash2(plot.id + key(scene.id) % 4093 + left, top + key(v.id) % 4093, seed + rotation * 101);
        // Размер — мягкое предпочтение: даже в богатом дворе ограниченная
        // площадь и коллизии всегда важнее желаемой насыщенности.
        const room = Math.min(1, Math.max(0, (zone.w * zone.h - 20) / 100));
        const conditionBias = input.condition === 'pristine' ? 0.35 : input.condition === 'worn' ? -0.7 : 0;
        const desiredSize = Math.min(2, Math.max(0, room + plot.wealth * 0.7 + conditionBias));
        const variantSize = v.size === 'compact' ? 0 : v.size === 'standard' ? 1 : 2;
        const sizePreference = -Math.abs(desiredSize - variantSize) * 0.45;
        const score = scene.weight * 0.15 + extras.length * 0.25 - distance * 0.12 + awayFromFront * 0.08 - repetition * 0.45 + sizePreference
          + Math.min(1, bounds.w * bounds.h / Math.max(1, zone.w * zone.h)) * 0.2 + noise * 0.2;
        const placement: FunctionalPlacement = { sceneId: scene.id, variantId: v.id, plotId: plot.id, rotation, bounds, anchor: focus, parts: [...required, ...extras], access: zones, score };
        const candidateKey = `${scene.id}/${v.id}/${rotation}/${top}/${left}`;
        if (!best || score > best.score || (score === best.score && candidateKey < bestKey)) { best = placement; bestKey = candidateKey; }
      }
    }
  }
  return { placement: best, attempted, rejected, ...(trace ? { trace } : {}) };
}

/**
 * Локальная транзакционная доска сцен. Она хранит только временные данные
 * генерации, не меняя MapData. Внешние ограничения (дома, двери, рынок и т.п.)
 * задаются callback-ом; объекты и рабочие зоны уже подтверждённых сцен
 * блокируются здесь до следующего подбора.
 */
export class FunctionalSceneBoard {
  private readonly committed: FunctionalPlacement[] = [];
  get placements(): readonly FunctionalPlacement[] { return this.committed; }
  private readonly occupied: Uint8Array;

  constructor(readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid scene board dimensions');
    this.occupied = new Uint8Array(width * height);
  }

  private canReserve(rect: Selection): boolean {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) || rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1 || rect.x + rect.w > this.width || rect.y + rect.h > this.height) return false;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (this.occupied[y * this.width + x]) return false;
    return true;
  }

  /** Поиск и фиксация происходят синхронно; при отказе состояние не меняется. */
  place(input: FunctionalPlacementInput): FunctionalPlacementResult {
    const result = findFunctionalPlacement({
      ...input,
      previous: input.previous ?? this.placements,
      check: (rect, purpose) => this.canReserve(rect) ? input.check(rect, purpose) : 'collision',
    });
    if (!result.placement) return result;
    const scene = result.placement;
    // Все прямоугольники уже проверены; только здесь изменяем состояние доски.
    for (const rect of [scene.anchor, ...scene.parts, ...scene.access]) {
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) this.occupied[y * this.width + x] = 1;
    }
    this.committed.push(scene);
    return result;
  }
}
