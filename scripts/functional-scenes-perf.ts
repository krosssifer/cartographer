/** Coarse timings only; scene search includes enumeration, checking and scoring.
 * npx esbuild scripts/functional-scenes-perf.ts --bundle --platform=node --outfile=.tmp/functional-scenes-perf.cjs
 * node .tmp/functional-scenes-perf.cjs > artifacts/functional-scenes-test/performance.json
 */
import { performance } from 'node:perf_hooks';
import { FUNCTIONAL_SCENES } from '../src/lib/gen/urban/scenes';
import { findFunctionalPlacement } from '../src/lib/gen/urban/scenePlacement';
import type { UrbanPlot } from '../src/lib/gen/urban/types';
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { DEFAULT_GEN } from '../src/lib/presets';

const measurements = FUNCTIONAL_SCENES.map(scene => {
  const plot: UrbanPlot = { id: 17, polygon: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 14 }, { x: 0, y: 14 }],
    bounds: { x: 0, y: 0, w: 16, h: 14 }, yardRect: { x: 2, y: 2, w: 12, h: 10 }, courtyardKind: scene.courtyardKinds[0], districtType: scene.districts[0], districtIndex: 0,
    zone: 'residential', size: 224, frontage: 16, depth: 14, orientation: 0, roadLevel: 2, wealth: .5, age: 'inner_city', fn: scene.plotFunctions[0] };
  let checks = 0, checkMs = 0, attempts = 0;
  const start = performance.now();
  for (let seed = 1; seed <= 20; seed++) {
    const result = findFunctionalPlacement({ seed, plot, zone: plot.yardRect!, scenes: [scene], check: () => {
      const t = performance.now(); checks++; const result = null; checkMs += performance.now() - t; return result;
    } });
    attempts += result.attempted;
  }
  return { scene: scene.id, runs: 20, attempts, checks, totalMs: performance.now() - start, callbackMs: checkMs };
});
const generation = [];
for (const [width, height] of [[64, 48], [100, 80], [200, 160]] as const) {
  const settings = { ...DEFAULT_GEN, biome: 'town' as const, settlement: 'town' as const, settlementType: 'trade_town' as const,
    width, height, density: 1, seed: 42, river: true, publicSpaces: true };
  // Alternate on/off on every measurement to miss the single-entry plan cache.
  const times = [[], []] as number[][];
  const plans = [] as ReturnType<typeof buildTypedPlan>[];
  for (let i = 0; i < 3; i++) for (const density of [0, 1]) {
    const start = performance.now(); plans[density] = buildTypedPlan({ ...settings, urbanDressing: density }, 'town');
    times[density].push(performance.now() - start);
  }
  const results = plans.map((plan, density) => ({ density, times: times[density], scenes: plan.functionalScenes.length, buildings: plan.plots.length,
    buildingsGeometry: JSON.stringify(plan.plots.map(({ x,y,w,h,door,role }) => ({ x,y,w,h,door,role }))), road: JSON.stringify(plan.road), market: JSON.stringify(plan.market?.plan) }));
  generation.push({ width, height, offMs: results[0].times, onMs: results[1].times, scenes: results[1].scenes, buildings: results[1].buildings,
    sameBuildings: results[0].buildingsGeometry === results[1].buildingsGeometry, sameRoad: results[0].road === results[1].road, sameMarket: results[0].market === results[1].market });
}
console.log(JSON.stringify({ note: 'One process, sequential, unisolated wall-clock; callback instrumentation overhead included. total search includes selection, coordinates, geometry and scoring, not individual phase timings. urbanDressing controls all dressing, not only scenes; each run alternates settings to avoid plan-cache hits.', measurements, generation }, null, 2));
