import type { MapData, Terrain } from './types';

/** Produce an editable architectural shell without modifying the input map. */
export function dungeonWallsOnly(map: MapData): MapData {
  const cells = map.cells.map((row) => row.map((cell) => {
    const terrain: Terrain = cell.terrain === 'wall' || cell.terrain === 'void' ? cell.terrain : 'floor';
    return terrain === cell.terrain ? cell : { ...cell, terrain };
  }));
  const dungeon = map.plan?.dungeon;
  const complex = dungeon?.complex;
  const plan = map.plan ? {
    ...map.plan,
    groups: [], actions: [], dungeonDressingDebug: undefined,
    roads: undefined, bridges: undefined, river: undefined, riverWidth: undefined,
    report: undefined,
    dungeon: dungeon ? {
      ...dungeon, doors: {}, stairsUp: undefined, stairsDown: undefined,
      complex: complex ? { ...complex, scenes: [], mechanisms: [], lights: { lit: 0, unlit: 0 }, links: [] } : undefined,
    } : undefined,
  } : undefined;
  return { ...map, cells, dungeonWallsOnly: true, trees: [], rocks: [], chests: [], crypt: [],
    buildings: [], civic: [], lights: [], furnitureSprites: [], doors: [], road: [], river: [], floorLayer: undefined, plan };
}
