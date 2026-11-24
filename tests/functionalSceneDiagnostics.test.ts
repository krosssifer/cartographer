import { expect, it } from 'vitest';
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { DEFAULT_GEN } from '../src/lib/presets';

it('caches diagnostic and ordinary plans separately regardless of call order', () => {
  const settings = { ...DEFAULT_GEN, biome: 'town' as const, settlement: 'town' as const, settlementType: 'craft_town' as const, width: 100, height: 80, seed: 11, density: 1, urbanDressing: 1 };
  const regular = buildTypedPlan(settings, 'town', false);
  const debug = buildTypedPlan(settings, 'town', true);
  expect(debug.functionalScenes.length).toBeGreaterThan(0);
  expect(debug.functionalScenes.every(g => g.trace)).toBe(true);
  const again = buildTypedPlan(settings, 'town', false);
  expect(again.functionalScenes.every(g => !g.trace)).toBe(true);
  expect(again.functionalScenes.map(g => g.placement)).toEqual(regular.functionalScenes.map(g => g.placement));
  expect(debug.functionalScenes.map(g => g.placement)).toEqual(regular.functionalScenes.map(g => g.placement));
});

it('does not place a noble garden in the temple district even for a manor landmark', async () => {
  const { FUNCTIONAL_SCENES } = await import('../src/lib/gen/urban/scenes');
  const { functionalSceneApplies } = await import('../src/lib/gen/urban/scenePlacement');
  const settings = { ...DEFAULT_GEN, biome: 'town' as const, settlement: 'town' as const, settlementType: 'small_city' as const, settlementCharacter: 'poor', width: 100, height: 80, seed: 42, density: 1, urbanDressing: 1, river: true, publicSpaces: true };
  const plan = buildTypedPlan(settings, 'town', true);
  const rank = plan.placedPlots.findIndex((plot, i) => !plan.secondaryFlags[i] && plot?.id === 54);
  expect(rank).toBeGreaterThanOrEqual(0);
  const plot = plan.placedPlots[rank]!;
  expect(plot.districtType).toBe('temple');
  expect(plan.plots[rank].role).toBe('manor');
  const scene = FUNCTIONAL_SCENES.find(s => s.id === 'noble_garden')!;
  expect(functionalSceneApplies(plot, plan.plots[rank], scene)).toBe(false);
  expect(plan.functionalScenes.some(g => g.placement.plotId === plot.id && g.placement.sceneId === scene.id)).toBe(false);
});
