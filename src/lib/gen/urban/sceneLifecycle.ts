/** Временная регистрация сцены для согласования с пост-валидацией. */
import type { CivicObject, Selection } from '../../types';
import type { FunctionalPlacement, FunctionalPlacementResult, SceneRejection } from './scenePlacement';

export interface FunctionalSceneFailure {
  plotId: number;
  zone: Selection;
  reason: SceneRejection | 'repair';
  rejections?: Record<SceneRejection, number>;
  trace?: FunctionalPlacementResult['trace'];
}

export interface FunctionalSceneGroup {
  placement: FunctionalPlacement;
  items: CivicObject[];
  trace?: FunctionalPlacementResult['trace'];
}

/** Если repair удалил хотя бы одну деталь либо занял доступ, удаляем группу целиком. */
export function reconcileFunctionalScenes(
  groups: readonly FunctionalSceneGroup[],
  survivingItems: ReadonlySet<CivicObject>,
  accessIsFree: (group: FunctionalSceneGroup) => boolean,
): { surviving: FunctionalSceneGroup[]; discarded: Set<CivicObject> } {
  const surviving: FunctionalSceneGroup[] = [];
  const discarded = new Set<CivicObject>();
  for (const group of groups) {
    if (group.items.every((item) => survivingItems.has(item)) && accessIsFree(group)) surviving.push(group);
    else for (const item of group.items) discarded.add(item);
  }
  return { surviving, discarded };
}
