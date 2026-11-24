import type { CryptKind } from '../../types';

export type DungeonClusterType = 'burial' | 'collapse' | 'water' | 'web' | 'activity';
export interface ClusterCondition { debris: number; flood: number; neglect: number; occupied: number }
export interface ClusterRule { type: DungeonClusterType; kinds: readonly CryptKind[]; strength: number }

/** A cluster is only appropriate when its source and the site's state justify it. */
export function clusterRule(kind: CryptKind, condition: ClusterCondition): ClusterRule | undefined {
  if (['coffin', 'openCoffin', 'tomb', 'ossuaryShelf', 'bonePile', 'skeletonPile'].includes(kind))
    return { type: 'burial', kinds: ['skull', 'femurs', 'graveCandle'], strength: .45 + condition.neglect * .35 };
  if (['rubblePile', 'rockFall', 'rockPile'].includes(kind) && condition.debris >= .25)
    return { type: 'collapse', kinds: ['pebbles', 'crackedFloor', 'rubble'], strength: condition.debris };
  if (['puddleMud', 'puddleBlue', 'drain'].includes(kind) && condition.flood >= .15)
    return { type: 'water', kinds: ['mossPatch', 'lichen'], strength: condition.flood };
  if (kind === 'web' && condition.neglect >= .3)
    return { type: 'web', kinds: ['web', 'bones'], strength: condition.neglect };
  if (['workbench', 'forge', 'mapTable'].includes(kind) && condition.occupied >= .3)
    return { type: 'activity', kinds: ['bucket', 'rope', 'oilLamp'], strength: condition.occupied };
  return undefined;
}
