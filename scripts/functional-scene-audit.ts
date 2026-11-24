/**
 * Generation-stage audit; it does not alter placement or treat omitted plots as
 * geometric failures. Run via esbuild, for example:
 *   npx esbuild scripts/functional-scene-audit.ts --bundle --platform=node --outfile=.tmp/scene-audit.cjs
 *   node .tmp/scene-audit.cjs > artifacts/scene-stage6/audit.json
 * Optional DENSITY overrides the default 1. All other settings are explicit.
 */
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import { SETTLEMENT_TYPES, type SettlementTypeId } from '../src/lib/gen/settlementTypes';
import { FUNCTIONAL_SCENES } from '../src/lib/gen/urban/scenes';
import { functionalSceneApplies } from '../src/lib/gen/urban/scenePlacement';
import { hash2 } from '../src/lib/random';

const density = Number(process.env.DENSITY ?? 1);
if (!Number.isFinite(density) || density < 0 || density > 1) throw new Error('DENSITY must be between 0 and 1');
const types: SettlementTypeId[] = ['small_village', 'large_village', 'craft_town', 'large_city', 'port', 'trade_town', 'fortified_town', 'mountain'];
const rows = [];
for (const settlementType of types) for (const seed of [11, 42, 87]) {
  const style = SETTLEMENT_TYPES.find((type) => type.id === settlementType)!.style;
  const settings = { ...DEFAULT_GEN, biome: style, settlement: style, settlementType, width: 100, height: 80, seed, urbanDressing: 1, density, publicSpaces: true, river: true };
  const plan = buildTypedPlan(settings, style, true);
  const map = generateMap(settings);
  const activeCount = map.buildings?.length ?? 0;
  const ranks = plan.plots.map((building, rank) => {
    const plot = plan.placedPlots[rank];
    return {
      rank, active: rank < activeCount, plotId: plot?.id,
      secondary: plan.secondaryFlags[rank],
      role: building.role, kind: building.kind,
      building: { x: building.x, y: building.y, w: building.w, h: building.h },
      plotFunction: plot?.fn, district: plot?.districtType, courtyardKind: plot?.courtyardKind,
      yard: plot?.yardRect,
    };
  });
  const eligible = plan.placedPlots.map((plot, rank) => ({ plot, rank, building: plan.plots[rank] }))
    .filter((item) => !plan.secondaryFlags[item.rank] && item.plot?.yardRect);
  const attempts = [
    ...plan.functionalScenes.map((group) => ({ plotId: group.placement.plotId, trace: group.trace })),
    ...(plan.report.debug?.sceneFailures ?? []).map((failure) => ({ plotId: failure.plotId, trace: failure.trace })),
  ];
  const stages = FUNCTIONAL_SCENES.map((scene) => {
    const matches = eligible.filter(({ plot, building }) => functionalSceneApplies(plot!, building, scene));
    const afterDecorDensity = matches.filter(({ plot }) => hash2(plot!.id, 0x51ce, seed + 0x46a1) < settings.urbanDressing);
    const relevant = attempts.flatMap(({ trace }) => trace?.rotations.filter((rotation) => rotation.sceneId === scene.id) ?? []);
    const scored = relevant.reduce((sum, row) => sum + row.geometricallyValid, 0);
    return {
      scene: scene.id,
      primaryYards: eligible.length,
      roleCompatibleYards: matches.length,
      afterDecorDensity: afterDecorDensity.length,
      afterBuildingDensity: afterDecorDensity.filter(({ rank }) => rank < activeCount).length,
      variantsExamined: relevant.length / 4,
      orientationsExamined: relevant.length,
      positionsExamined: relevant.reduce((sum, row) => sum + row.positions, 0),
      geometryPassed: scored, scored,
      plannedAfterRepair: plan.functionalScenes.filter((group) => group.placement.sceneId === scene.id).length,
      placedActive: (map.plan?.settlement?.debug?.scenes ?? []).filter((placement) => placement.sceneId === scene.id).length,
    };
  });
  const baseline = process.env.BASELINE === '1' ? buildTypedPlan({ ...settings, urbanDressing: 0 }, style) : undefined;
  const geometry = (p: typeof plan) => p.plots.map(({ x, y, w, h, door, role }) => ({ x, y, w, h, door, role }));
  rows.push({ settings, activeCount, ranks, stages, placementReport: plan.report.dressing,
    activeSceneCount: map.plan?.settlement?.dressing?.scenesPlaced,
    plannedScenes: plan.functionalScenes.map((group) => ({ placement: group.placement, trace: group.trace })),
    failures: plan.report.debug?.sceneFailures,
    ...(baseline ? { noDressingBaseline: { scenes: baseline.functionalScenes.length,
      sameBuildingGeometry: JSON.stringify(geometry(baseline)) === JSON.stringify(geometry(plan)),
      sameRoad: JSON.stringify(baseline.road) === JSON.stringify(plan.road),
      sameMarket: JSON.stringify(baseline.market?.plan) === JSON.stringify(plan.market?.plan) } } : {}),
  });
}
console.log(JSON.stringify({ note: 'Orientation counts include variants too large for the yard; geometrically valid candidates are all scored. Building-density filtering occurs after generation. BASELINE=1 disables all urban dressing for comparison.', rows }, null, 2));
