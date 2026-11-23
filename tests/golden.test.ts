import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import type { Biome } from '../src/lib/types';

// Золотые сиды: «классическая» генерация (sceneArchetype = 'auto') обязана
// давать ту же карту, что и до появления сцен-архетипов. Хэши сняты на
// исходном коммите a50e570 для всех биомов, кроме склепа: его карта
// изменилась в f27dcf0 (исправлены ловушки и сундуки на проходах).
const GOLDEN: Record<string, string> = {
  'forest:1337': 'f746276fbb948e7a', 'forest:42': 'a90db7ce71887025',
  'plains:1337': 'f5ab43958265d803', 'plains:42': 'a73cbfd6b5d4d2c1',
  'swamp:1337': 'e346fe7255d868fc', 'swamp:42': 'a3507a78c96c9888',
  'desert:1337': '866f7edf572187ff', 'desert:42': 'fdbcb6514c95b303',
  'snow:1337': '3a626d4a4e08ad65', 'snow:42': 'c3e556d8929ce594',
  'cave:1337': '95524bb4c8d63b8a', 'cave:42': '72b07b6e9546c95f',
  'dungeon:1337': '7528431d831966a9', 'dungeon:42': 'd17d3ffe11200540',
  'village:1337': '816ac95e8022babb', 'village:42': '96fa0f17c91c7669',
  'town:1337': 'f079f79342d69b17', 'town:42': 'b6c91bb716c3abb1',
};

describe('golden seeds (classic generation)', () => {
  for (const [key, hash] of Object.entries(GOLDEN)) {
    it(key, () => {
      const [biome, seed] = key.split(':');
      // Эталоны фиксируют классическую генерацию, в том числе прежний рынок
      // (как у проектов без поля marketArchetype); новый рынок — в market.test.ts.
      const map = generateMap({ ...DEFAULT_GEN, biome: biome as Biome, seed: Number(seed), settlement: biome === 'town' ? 'town' : 'village', marketArchetype: 'classic' });
      const { plan, ...rest } = map;
      void plan;
      expect(createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 16)).toBe(hash);
    });
  }
});
