import { describe, expect, it } from 'vitest';
import fixture from './fixtures/functional-scene-problems.json';
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import { FUNCTIONAL_SCENES } from '../src/lib/gen/urban/scenes';
import type { SettlementTypeId } from '../src/lib/gen/settlementTypes';
import type { SettlementStyle } from '../src/lib/types';

describe('reproducible scene placement problems', () => {
  for (const c of fixture.cases) it(c.id, () => {
    const style = c.style as SettlementStyle;
    const settings = { ...DEFAULT_GEN, ...fixture.settings, biome: style, settlement: style, settlementType: c.settlementType as SettlementTypeId, seed: c.seed };
    const plan = buildTypedPlan(settings, style, true);
    const map = generateMap(settings);
    expect(map.plan?.settlement?.dressing?.scenesPlaced).toBe(0);
    const index = plan.placedPlots.findIndex((p) => p?.id === c.plotId);
    const plot = plan.placedPlots[index]!;
    expect(plan.plots[index].role).toBe(c.buildingRole);
    expect(plot.fn).toBe(c.plotFunction);
    expect(plot.yardRect).toEqual(c.yard);
    expect(FUNCTIONAL_SCENES.find((scene) => scene.id === c.scene)?.variants.map((variant) => variant.id)).toEqual(c.variants);
    const failure = plan.report.debug?.sceneFailures?.find((item) => item.plotId === c.plotId)!;
    expect(failure.reason).toBe(c.reason);
    const rows = failure.trace?.rotations.filter((rotation) => rotation.sceneId === c.scene) ?? [];
    expect(rows).toHaveLength(c.variants.length * 4);
    expect(rows.reduce((sum, row) => sum + row.positions, 0)).toBe(c.attemptedPositions);
    expect(rows.reduce((sum, row) => sum + row.geometricallyValid, 0)).toBe(0);
    expect(rows.every((row) => Object.values(row.reasons).reduce((sum, n) => sum + n, 0) === (row.positions || 1))).toBe(true);
    const withoutDecor = buildTypedPlan({ ...settings, urbanDressing: 0 }, style);
    expect(withoutDecor.functionalScenes).toHaveLength(0);
    const geometry = (p: typeof plan) => p.plots.map(({ x, y, w, h, door, role }) => ({ x, y, w, h, door, role }));
    expect(geometry(withoutDecor)).toEqual(geometry(plan));
    expect(withoutDecor.road).toEqual(plan.road);
    expect(withoutDecor.market?.plan).toEqual(plan.market?.plan);
  }, 20000);
});
