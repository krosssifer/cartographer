import fs from 'node:fs';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';

const out: Record<string, unknown> = {};
for (const seed of [583921, 777001, 424242]) {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
  out[String(seed)] = {
    width: map.width, height: map.height,
    rows: map.cells.map((row) => row.map((cell) => cell.terrain)),
    trees: map.trees, rocks: map.rocks,
    plan: {
      scene: map.plan?.scene ?? null,
      roads: map.plan?.roads ?? [],
      bridges: map.plan?.bridges ?? [],
      composition: map.plan?.composition ?? null,
      spawn: map.plan?.spawn ?? null,
      report: map.plan?.report ?? null,
    },
  };
}
fs.writeFileSync('.tmp/scene.json', JSON.stringify(out));
console.log('wrote .tmp/scene.json');
