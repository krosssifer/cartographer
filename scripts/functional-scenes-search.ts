/** Deterministically search natural generation for particular missing scene IDs.
 * npx esbuild scripts/functional-scenes-search.ts --bundle --platform=node --outfile=.tmp/functional-scenes-search.cjs
 * node .tmp/functional-scenes-search.cjs
 */
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import type { GenSettings } from '../src/lib/types';

const target = new Set(['warehouse', 'inn']);
const types = ['trade_town', 'port', 'large_city', 'small_city', 'large_village'] as const;
const found: Record<string, unknown> = {};
let maps = 0;
outer: for (let seed = 1; seed <= 120; seed++) for (const type of types) {
  const style = type === 'large_village' ? 'village' : 'town';
  const settings: GenSettings = { ...DEFAULT_GEN, biome: style, settlement: style, settlementType: type,
    width: 100, height: 80, seed, density: 1, urbanDressing: 1, river: true, publicSpaces: true };
  const map = generateMap(settings); maps++;
  for (const scene of map.plan?.settlement?.debug?.scenes ?? []) if (target.has(scene.sceneId) && !found[scene.sceneId]) {
    found[scene.sceneId] = { settings, placement: scene };
    console.error('Found', scene.sceneId, type, seed);
  }
  if ([...target].every(id => found[id])) break outer;
}
console.log(JSON.stringify({ maps, targets: [...target], found }, null, 2));
