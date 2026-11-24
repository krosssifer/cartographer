import { describe, expect, it, vi } from 'vitest';
import { paintTerrain } from '../src/lib/terrainPaint';
import { DEFAULT_RENDER } from '../src/lib/presets';
import type { MapData, Terrain } from '../src/lib/types';
import { isDungeonExteriorWall } from '../src/lib/dungeonWallBackground';

const map = (biome: MapData['biome'], rows: Terrain[][]): MapData => ({ biome, width: rows[0].length, height: rows.length,
  cells: rows.map(row => row.map(terrain => ({ terrain, height: .5, moisture: .5 }))) } as MapData);

describe('dungeon exterior wall backdrop', () => {
  it('only classifies wall cells next to void, leaving the floor and internal walls alone', () => {
    const m = map('dungeon', [
      ['void', 'void', 'void', 'void', 'void'],
      ['void', 'wall', 'wall', 'wall', 'void'],
      ['void', 'wall', 'floor', 'wall', 'void'],
      ['void', 'wall', 'floor', 'wall', 'void'],
      ['void', 'wall', 'wall', 'wall', 'void'],
    ]);
    expect(isDungeonExteriorWall(m, 1, 2)).toBe(true);
    expect(isDungeonExteriorWall(m, 2, 2)).toBe(false);
    expect(isDungeonExteriorWall(m, 0, 0)).toBe(false);
    const internal = map('dungeon', [['floor', 'floor', 'floor'], ['floor', 'wall', 'floor'], ['floor', 'floor', 'floor']]);
    expect(isDungeonExteriorWall(internal, 1, 1)).toBe(false);
    const corner = map('dungeon', [['void', 'wall', 'floor'], ['wall', 'wall', 'floor'], ['floor', 'floor', 'floor']]);
    expect(isDungeonExteriorWall(corner, 1, 1)).toBe(true);
    expect(isDungeonExteriorWall({ ...m, biome: 'cave' }, 1, 2)).toBe(false);
    expect(isDungeonExteriorWall({ ...m, biome: 'village' }, 1, 2)).toBe(false);
  });
  it('treats the map edge like exterior void', () => {
    const m = map('dungeon', [['wall', 'floor'], ['floor', 'floor']]);
    expect(isDungeonExteriorWall(m, 0, 0)).toBe(true);
  });
  it('paints exterior wall backing exactly as void without changing wall terrain', () => {
    class MockImageData {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
    }
    vi.stubGlobal('ImageData', MockImageData);
    try {
      const m = map('dungeon', [
        ['void', 'void', 'void', 'void', 'void'],
        ['void', 'wall', 'wall', 'wall', 'void'],
        ['void', 'wall', 'floor', 'wall', 'void'],
        ['void', 'wall', 'water', 'wall', 'void'],
        ['void', 'void', 'void', 'void', 'void'],
      ]);
      const reference = { ...m, cells: m.cells.map((row, y) => row.map((cell, x) =>
        isDungeonExteriorWall(m, x, y) ? { ...cell, terrain: 'void' as const } : cell)) };
      for (const texture of [false, true]) for (const shading of [false, true]) {
        const rs = { ...DEFAULT_RENDER, cellSize: 16, showStructures: true, texture, shading };
        const actual = paintTerrain(m, rs, 42);
        const expected = paintTerrain(reference, rs, 42);
        for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
          if (!isDungeonExteriorWall(m, x, y)) continue;
          for (let py = y * 16; py < (y + 1) * 16; py++) for (let px = x * 16; px < (x + 1) * 16; px++) {
            const i = (py * actual.width + px) * 4;
            expect(actual.data.slice(i, i + 4)).toEqual(expected.data.slice(i, i + 4));
          }
        }
      }
      expect(m.cells[1][1].terrain).toBe('wall');
    } finally { vi.unstubAllGlobals(); }
  });

});
