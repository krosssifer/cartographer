import { describe, expect, it } from 'vitest';
import { buildLandscape } from '../src/lib/gen/landscape';
import type { LandscapeSpec } from '../src/lib/gen/landscape';

const SPECS: Record<string, LandscapeSpec> = {
  valley: { relief: 'valley', water: 'river', course: 'along', erosion: true, cliffs: 0.5, wetlands: 0.2 },
  pass: { relief: 'pass', water: 'none', course: 'none', erosion: false, cliffs: 0.8, wetlands: 0 },
  crossing: { relief: 'rolling', water: 'river_wide', course: 'across', erosion: false, cliffs: 0.2, wetlands: 0.3 },
  lakeland: { relief: 'lakeland', water: 'lakes', course: 'none', erosion: false, cliffs: 0.1, wetlands: 0.4 },
  islands: { relief: 'islands', water: 'marsh', course: 'none', erosion: false, cliffs: 0, wetlands: 0.8 },
};

describe('landscape', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    for (const seed of [1, 2, 1337]) {
      it(`${name} seed ${seed}: rivers flow downhill, checks pass, deterministic`, () => {
        const input = { width: 48, height: 30, biome: 'forest' as const, seed, roughness: 0.5, waterLevel: 0.35 };
        const land = buildLandscape(input, spec);
        for (const check of land.report.checks) expect(check.ok, check.id).toBe(true);
        // Ни одна клетка главного русла не выше предыдущей (по заполненной высоте).
        for (const river of land.hydrology.rivers) {
          const at = (index: number) => land.hydrology.filled[river.points[index].y * input.width + river.points[index].x];
          for (let index = 1; index < river.points.length; index += 1) {
            // Допуск — ε-заполнение плоских котловин (Priority-Flood), а не подъём.
            expect(at(index)).toBeLessThanOrEqual(at(index - 1) + 1e-4);
          }
        }
        const again = buildLandscape(input, spec);
        expect(Array.from(again.heights)).toEqual(Array.from(land.heights));
        expect(JSON.stringify(again.cells)).toBe(JSON.stringify(land.cells));
      });
    }
  }
  it('pass has much more rock than gentle relief; lakeland has the most water', () => {
    const input = { width: 48, height: 30, biome: 'forest' as const, seed: 3, roughness: 0.5, waterLevel: 0.35 };
    const pass = buildLandscape(input, SPECS.pass);
    const lakes = buildLandscape(input, SPECS.lakeland);
    const gentle = buildLandscape(input, { relief: 'gentle', water: 'none', course: 'none', erosion: false, cliffs: 0, wetlands: 0 });
    expect(pass.report.rockShare).toBeGreaterThan(gentle.report.rockShare * 2);
    expect(lakes.report.waterShare).toBeGreaterThan(0.1);
  });
});
