import { describe, expect, it } from 'vitest';
import { terrainLayerKey } from '../src/lib/render';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { generateMap } from '../src/lib/generator';

describe('terrain raster cache key', () => {
  it('distinguishes terrain names with the same first letter and length', () => {
    const map = generateMap({ ...DEFAULT_GEN, width: 10, height: 10 });
    const cells = map.cells.map((row) => row.map((cell) => ({ ...cell })));
    const sand = { ...map, cells };
    cells[2][2] = { ...cells[2][2], terrain: 'sand' };
    const snow = { ...map, cells: cells.map((row) => row.map((cell) => ({ ...cell }))) };
    snow.cells[2][2].terrain = 'snow';
    expect(terrainLayerKey(sand, DEFAULT_RENDER, 1, 400, 400)).not.toBe(terrainLayerKey(snow, DEFAULT_RENDER, 1, 400, 400));
    expect(terrainLayerKey(sand, DEFAULT_RENDER, 1, 400, 400)).not.toBe(terrainLayerKey(sand, { ...DEFAULT_RENDER, texture: false }, 1, 400, 400));
    expect(terrainLayerKey(sand, DEFAULT_RENDER, 1, 400, 400)).not.toBe(terrainLayerKey(sand, DEFAULT_RENDER, 2, 400, 400));
    expect(terrainLayerKey(sand, DEFAULT_RENDER, 1, 400, 400)).not.toBe(terrainLayerKey(sand, { ...DEFAULT_RENDER, showStructures: !DEFAULT_RENDER.showStructures }, 1, 400, 400));
    const elevated = { ...sand, cells: cells.map((row) => row.map((cell) => ({ ...cell }))) };
    elevated.cells[2][2].height = cells[2][2].height + 0.0001;
    expect(terrainLayerKey(sand, DEFAULT_RENDER, 1, 400, 400)).not.toBe(terrainLayerKey(elevated, DEFAULT_RENDER, 1, 400, 400));
  });
});
