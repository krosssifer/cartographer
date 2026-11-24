/** Inspect whether selected real plots satisfy the catalogue lists. */
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { DEFAULT_GEN } from '../src/lib/presets';
import { SETTLEMENT_TYPES, type SettlementTypeId } from '../src/lib/gen/settlementTypes';
import { FUNCTIONAL_SCENES } from '../src/lib/gen/urban/scenes';
import { functionalSceneApplies } from '../src/lib/gen/urban/scenePlacement';
const cases: Array<{name: string; type: SettlementTypeId; character?: string; seeds?: number[]}> = [
  { name: 'small_village', type: 'small_village' }, { name: 'medium_village', type: 'large_village' },
  { name: 'large_city', type: 'large_city' }, { name: 'port', type: 'port' }, { name: 'craft', type: 'craft_town' },
  { name: 'noble', type: 'small_city', character: 'noble' }, { name: 'poor', type: 'small_city', character: 'poor' },
  { name: 'mixed', type: 'large_city', character: 'mixed' }, { name: 'port-extra', type: 'port', seeds: [1, 6] },
];
const rows = [];
const counts = [];
for (const scenario of cases) for (const seed of scenario.seeds ?? [11, 42, 87]) {
  const style = SETTLEMENT_TYPES.find(t => t.id === scenario.type)!.style;
  const settings = { ...DEFAULT_GEN, biome: style, settlement: style, settlementType: scenario.type, settlementCharacter: scenario.character ?? 'auto', width: 100, height: 80, seed, density: 1, urbanDressing: 1, river: true, publicSpaces: true };
  const plan = buildTypedPlan(settings, style, true);
  const attempts = [...plan.functionalScenes.map(group => group.trace), ...(plan.report.debug?.sceneFailures ?? []).map(failure => failure.trace)];
  for (const scene of FUNCTIONAL_SCENES) {
    const eligible = plan.placedPlots.filter((plot, rank) => plot?.yardRect && !plan.secondaryFlags[rank] && functionalSceneApplies(plot, plan.plots[rank], scene)).length;
    const rotations = attempts.flatMap(trace => trace?.rotations.filter(row => row.sceneId === scene.id) ?? []);
    const reasons: Record<string, number> = {};
    for (const row of rotations) for (const [reason, n] of Object.entries(row.reasons)) reasons[reason] = (reasons[reason] ?? 0) + (n ?? 0);
    counts.push({ scenario: scenario.name, seed, id: scene.id, eligible, orientations: rotations.length,
      positions: rotations.reduce((sum, r) => sum + r.positions, 0), geometric: rotations.reduce((sum, r) => sum + r.geometricallyValid, 0), reasons });
  }
  for (const group of plan.functionalScenes) {
    const scene = FUNCTIONAL_SCENES.find(s => s.id === group.placement.sceneId)!;
    const rank = plan.placedPlots.findIndex((p, i) => !plan.secondaryFlags[i] && p?.id === group.placement.plotId);
    const plot = plan.placedPlots[rank]!;
    rows.push({ scenario: scenario.name, seed, id: scene.id, variant: group.placement.variantId, plotId: plot.id,
      role: plan.plots[rank].role, fn: plot.fn, district: plot.districtType, courtyard: plot.courtyardKind,
      matchesDeclaredFunction: scene.plotFunctions.includes(plot.fn), matchesDeclaredDistrict: scene.districts.includes(plot.districtType),
      matchesDeclaredCourtyard: !!plot.courtyardKind && scene.courtyardKinds.includes(plot.courtyardKind) });
  }
}
console.log(JSON.stringify({ rows, counts }, null, 2));
