import type { MapData } from './types';

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Exterior rock backing is not part of the visible wall: retain the wall cells
 * for topology and editing, but paint their backing like the surrounding void. */
export function isDungeonExteriorWall(map: MapData, x: number, y: number): boolean {
  if (map.biome !== 'dungeon' || map.cells[y]?.[x]?.terrain !== 'wall') return false;
  return NEIGHBOURS.some(([dx, dy]) => {
    const terrain = map.cells[y + dy]?.[x + dx]?.terrain;
    return terrain === 'void' || terrain === undefined;
  });
}
