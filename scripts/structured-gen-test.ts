/**
 * Тесты структурного генератора.
 *
 * Запуск (из C:\AbsoluteDND\cartographer):
 *   node node_modules\esbuild\bin\esbuild scripts\structured-gen-test.ts --bundle --platform=node --format=cjs --outfile=.tmp\structured-gen-test.cjs
 *   node .tmp\structured-gen-test.cjs
 */

import assert from 'node:assert';
import { generateMap } from '../src/lib/generator';
import { validateCompositionAcross } from '../src/lib/gen/composition-validate';
import { chaikin } from '../src/lib/pathSmooth';
import { reachableFloor, validateMap } from '../src/lib/gen/validate';
import { repairMap } from '../src/lib/gen/repair';
import { smoothTerrain } from '../src/lib/gen/morphology';
import { DEFAULT_GEN } from '../src/lib/presets';
import { validateProject } from '../src/lib/project';
import type { GenSettings, MapData, Terrain } from '../src/lib/types';

const BASE: GenSettings = {
  ...DEFAULT_GEN,
  biome: 'forest',
  width: 40,
  height: 28,
  seed: 583921,
  generationEngine: 'structured',
};

const WATER: Terrain[] = ['water', 'deepWater'];
const TREE_FORBIDDEN: Terrain[] = ['water', 'deepWater', 'road', 'bridge', 'wall', 'floor', 'door', 'void', 'caveWall'];
const ROCK_FORBIDDEN: Terrain[] = ['water', 'deepWater', 'wall', 'door', 'void', 'caveWall'];

const json = (map: MapData) => JSON.stringify(map);

const terrainOf = (map: MapData, x: number, y: number): Terrain => map.cells[y]?.[x]?.terrain ?? 'void';

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

// ---- 1. Детерминизм структурного движка -----------------------------------
check('структурная генерация детерминирована по seed', () => {
  const first = generateMap(BASE);
  const second = generateMap(BASE);
  assert.deepStrictEqual(json(first), json(second), 'два прогона с одним seed обязаны совпасть');
  assert.ok(first.plan, 'план обязан сохраняться в MapData');
  assert.ok((first.plan?.zones.length ?? 0) > 0, 'в плане должны быть зоны');
});

// ---- 2. Детерминизм legacy (обратная совместимость) -----------------------
check('legacy-движок тоже детерминирован', () => {
  const legacy: GenSettings = { ...BASE, generationEngine: 'legacy' };
  const first = generateMap(legacy);
  const second = generateMap(legacy);
  assert.deepStrictEqual(json(first), json(second));
  assert.strictEqual(first.plan, undefined, 'у legacy-карты плана нет');
});

// ---- 3. Разные seed дают разные карты -------------------------------------
check('другой seed даёт другой layout', () => {
  const a = generateMap(BASE);
  const b = generateMap({ ...BASE, seed: BASE.seed + 1 });
  assert.notStrictEqual(JSON.stringify(a.trees), JSON.stringify(b.trees), 'деревья должны отличаться');
});

// ---- 4. Границы и запрещённые клетки --------------------------------------
check('объекты внутри карты и не стоят на воде/дороге/стенах', () => {
  const map = generateMap(BASE);
  for (const tree of map.trees) {
    assert.ok(tree.x >= 0 && tree.x < map.width && tree.y >= 0 && tree.y < map.height, `дерево вне карты: ${tree.x},${tree.y}`);
    const terrain = terrainOf(map, Math.round(tree.x), Math.round(tree.y));
    assert.ok(!TREE_FORBIDDEN.includes(terrain), `дерево ${tree.kind} стоит на ${terrain}`);
  }
  for (const rock of map.rocks) {
    assert.ok(rock.x >= 0 && rock.x < map.width && rock.y >= 0 && rock.y < map.height, 'камень вне карты');
    assert.ok(Array.isArray(rock.pts) && rock.pts.length >= 3, 'у камня обязан быть полигон');
    const terrain = terrainOf(map, Math.round(rock.x), Math.round(rock.y));
    assert.ok(!ROCK_FORBIDDEN.includes(terrain), `камень стоит на ${terrain}`);
  }
  assert.ok(map.trees.length > 20, `деревьев слишком мало: ${map.trees.length}`);
});

// ---- 5. Композиция: плотность не равномерна -------------------------------
check('плотность растительности образует композицию (cv > 0.35)', () => {
  const map = generateMap({ ...BASE, width: 48, height: 32 });
  const blocks = new Map<string, number>();
  for (const tree of map.trees) {
    const key = `${Math.floor(tree.x / 6)}:${Math.floor(tree.y / 6)}`;
    blocks.set(key, (blocks.get(key) ?? 0) + 1);
  }
  const counts = Array.from(blocks.values());
  const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  assert.ok(cv > 0.35, `плотность слишком ровная, cv=${cv.toFixed(2)}`);
});

// ---- 6. Группы и POI реально ставят объекты -------------------------------
check('группы и POI создают объекты', () => {
  const map = generateMap(BASE);
  assert.ok(map.plan!.poi.length > 0, 'должны быть POI');
  assert.ok(map.plan!.groups.length > 0, 'должны быть группы');
  const placed = map.plan!.groups.reduce((sum, group) => sum + group.placed, 0);
  assert.ok(placed > 5, `группы почти ничего не поставили: ${placed}`);
});

// ---- 7. Проект сериализуется и проходит валидацию -------------------------
check('карта с планом сохраняется и проходит validateProject', () => {
  const map = generateMap(BASE);
  const project = {
    version: 1 as const,
    gen: BASE,
    render: {
      cellSize: 40, showGrid: true, gridType: 'square', gridOpacity: 0.3, gridColor: '#ffffff',
      shading: true, texture: true, showTrees: true, showRocks: true, showStructures: true,
      showChests: true, showRoofs: true, showCivic: true, showCrypt: true, showSecrets: true,
      vignette: true, wallThickness: 0.34, showDecor: true,
    },
    map,
  };
  const parsed = JSON.parse(JSON.stringify(project)) as unknown;
  assert.ok(validateProject(parsed), 'проект со структурной картой обязан проходить валидацию');
  assert.ok((parsed as { map: MapData }).map.plan, 'план должен пережить сериализацию');
});

// ---- 8. Дорожная сеть: граф, ширина, мосты, обочины ----------------------
check('дорожная сеть строится как граф и связывает входы', () => {
  const map = generateMap({ ...BASE, width: 46, height: 32 });
  const plan = map.plan!;
  assert.ok(plan.roads && plan.roads.length > 0, 'должны быть уложенные пути');
  assert.ok(plan.roadGraph && plan.roadGraph.length > 0, 'должен быть граф дорог');

  const roadCells = new Set<string>();
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const terrain = map.cells[y][x].terrain;
      if (terrain === 'road' || terrain === 'bridge') roadCells.add(`${x},${y}`);
    }
  }
  assert.ok(roadCells.size > 20, `полотно слишком короткое: ${roadCells.size}`);

  // Ширина полотна: хотя бы в одном месте две соседние клетки по вертикали.
  let wide = 0;
  for (const key of roadCells) {
    const [x, y] = key.split(',').map(Number);
    if (roadCells.has(`${x},${y + 1}`)) wide += 1;
  }
  assert.ok(wide > 5, 'магистраль должна иметь ширину 2 клетки хотя бы местами');

  // Мосты: не больше двух пересечений воды на путь.
  for (const path of plan.roads!) {
    assert.ok(path.bridges <= (path.type === 'trail' ? 4 : 2), `слишком много мостов в пути ${path.id}: ${path.bridges}`);
    for (const point of path.points) {
      assert.ok(point.x >= 0 && point.x < map.width && point.y >= 0 && point.y < map.height, 'точка пути вне карты');
    }
  }

  // Обочины: рядом с полотном есть утоптанная земля.
  let shoulders = 0;
  for (const key of roadCells) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const terrain = map.cells[y + dy]?.[x + dx]?.terrain;
      if (terrain === 'dirt') shoulders += 1;
    }
  }
  assert.ok(shoulders > 0, 'должны быть обочины (утоптанная земля вдоль дороги)');

  // Связность: обе точки входа в одном компоненте полотна.
  const start = plan.roads![0].points[0];
  const queue = [`${start.x},${start.y}`];
  const seen = new Set<string>(queue);
  while (queue.length) {
    const [x, y] = queue.shift()!.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`;
      if (roadCells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  assert.strictEqual(seen.size, roadCells.size, 'полотно обязано быть связным');
});

// ---- 10. Коридор вдоль дороги: кроны не свисают на полотно ----------------
check('вдоль дороги держится коридор без крон', () => {
  const map = generateMap(BASE);
  const { width, height } = map;
  const roadDist = new Int16Array(width * height).fill(99);
  const queue: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = terrainOf(map, x, y);
      if (terrain === 'road' || terrain === 'bridge') {
        roadDist[y * width + x] = 0;
        queue.push(y * width + x);
      }
    }
  }
  assert.ok(queue.length > 20, 'на карте должна быть дорога');
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const current = roadDist[index];
    if (current >= 6) continue;
    const px = index % width;
    const py = (index - px) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (roadDist[ni] <= current + 1) continue;
      roadDist[ni] = current + 1;
      queue.push(ni);
    }
  }
  const CLEARANCE: Record<string, number> = { oak: 3, pine: 3, dead: 3, cactus: 3, bush: 2, reed: 1, mushroom: 1 };
  for (const tree of map.trees) {
    const cellX = Math.round(tree.x);
    const cellY = Math.round(tree.y);
    const clearance = CLEARANCE[tree.kind] ?? 0;
    const distance = roadDist[cellY * width + cellX];
    assert.ok(distance >= clearance, `${tree.kind} в (${tree.x.toFixed(2)}, ${tree.y.toFixed(2)}) ближе ${clearance} клеток к дороге (${distance})`);
  }
  for (const rock of map.rocks) {
    const cellX = Math.round(rock.x);
    const cellY = Math.round(rock.y);
    assert.ok(roadDist[cellY * width + cellX] >= 1, `камень стоит на полотне дороги (${rock.x.toFixed(2)}, ${rock.y.toFixed(2)})`);
  }
});

// ---- 11. Обочина утоптана по всему контуру дороги -------------------------
check('обочина утоптана по краям полотна', () => {
  for (const seed of [583921, 777001]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const roadCells: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const terrain = map.cells[y][x].terrain;
        // Настил моста обочины не имеет по определению — проверяем только сухое полотно.
        if (terrain === 'road') roadCells.push({ x, y });
      }
    }
    if (roadCells.length < 10) throw new Error(`seed ${seed}: дорога слишком короткая`);
    let withVerge = 0;
    for (const cell of roadCells) {
      let verge = false;
      for (let dy = -2; dy <= 2 && !verge; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (map.cells[cell.y + dy]?.[cell.x + dx]?.terrain === 'dirt') {
            verge = true;
            break;
          }
        }
      }
      if (verge) withVerge += 1;
    }
    const share = withVerge / roadCells.length;
    if (share < 0.85) throw new Error(`seed ${seed}: обочина только у ${(share * 100).toFixed(0)} % полотна`);
  }
  console.log('  ok   обочина идёт вдоль полотна');
});

check('подземелье строит граф залов с назначениями и связным полом', () => {
  const map = generateMap({ ...BASE, biome: 'dungeon', width: 44, height: 30, waterLevel: 0.2 });
  const plan = map.plan!;
  assert.ok(plan.rooms && plan.rooms.length > 3, 'должны быть залы с описанием');
  assert.strictEqual(plan.rooms!.length, map.structures.length, 'каждый зал описан');

  const purposes = plan.rooms!.map((room) => room.purpose);
  assert.strictEqual(purposes.filter((value) => value === 'entrance').length, 1, 'ровно один вход');
  assert.ok(purposes.includes('hall'), 'должен быть зал рядом со входом');
  assert.ok(purposes.includes('crypt'), 'в глубине должен быть склеп');
  for (const room of plan.rooms!) {
    assert.ok(room.depth >= 0, 'глубина определена');
    assert.ok(room.bounds.w > 0 && room.bounds.h > 0, 'границы зала валидны');
  }

  assert.ok(plan.graph && plan.graph.length >= map.structures.length - 1, 'граф связывает все залы');

  // Связность пола: BFS по floor/door.
  const walkable = (x: number, y: number) => {
    const terrain = map.cells[y]?.[x]?.terrain;
    return terrain === 'floor' || terrain === 'door';
  };
  const seen = new Set<string>();
  let total = 0;
  let best = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!walkable(x, y)) continue;
      total += 1;
      if (seen.has(`${x},${y}`)) continue;
      let size = 0;
      const stack: [number, number][] = [[x, y]];
      seen.add(`${x},${y}`);
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        size += 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!walkable(nx, ny) || seen.has(`${nx},${ny}`)) continue;
          seen.add(`${nx},${ny}`);
          stack.push([nx, ny]);
        }
      }
      best = Math.max(best, size);
    }
  }
  assert.ok(best / total > 0.98, `пол должен быть связным, доля крупнейшей компоненты ${(best / total).toFixed(3)}`);
});

check('подземелье детерминировано', () => {
  const first = generateMap({ ...BASE, biome: 'dungeon', width: 36, height: 26 });
  const second = generateMap({ ...BASE, biome: 'dungeon', width: 36, height: 26 });
  assert.deepStrictEqual(json(first), json(second));
});

// ---- 12. Композиция биомов: у каждого своя растительность и POI -----------
check('биомы держат свой набор растительности', () => {
  const allowed: Record<string, string[]> = {
    desert: ['cactus', 'dead', 'bush', 'mushroom'],
    snow: ['pine', 'dead', 'bush'],
    swamp: ['reed', 'bush', 'dead', 'mushroom'],
  };
  for (const [biome, kinds] of Object.entries(allowed)) {
    const map = generateMap({ ...BASE, biome: biome as 'desert', width: 40, height: 28, vegetation: 0.7 });
    for (const tree of map.trees) {
      assert.ok(kinds.includes(tree.kind), `${biome}: неожиданное растение ${tree.kind}`);
    }
  }
});

check('биомы не ставят чужих композиционных центров', () => {
  const desert = generateMap({ ...BASE, biome: 'desert', width: 44, height: 30 });
  for (const poi of desert.plan?.poi ?? []) {
    assert.ok(['boulder_field', 'clearing', 'camp'].includes(poi.type), `пустыня: лишний POI ${poi.type}`);
  }
  const swamp = generateMap({ ...BASE, biome: 'swamp', width: 44, height: 30, waterLevel: 0.55 });
  for (const poi of swamp.plan?.poi ?? []) {
    assert.ok(['clearing', 'camp'].includes(poi.type), `болото: лишний POI ${poi.type}`);
  }
});

check('болото отличается от леса по составу', () => {
  const swamp = generateMap({ ...BASE, biome: 'swamp', width: 44, height: 30, waterLevel: 0.55, vegetation: 0.85 });
  const reeds = swamp.trees.filter((tree) => tree.kind === 'reed').length;
  const oaks = swamp.trees.filter((tree) => tree.kind === 'oak').length;
  assert.ok(reeds > oaks, `в болоте камыша больше, чем дубов (${reeds} vs ${oaks})`);
});

// ---- 12. Пещеры на структурном движке -------------------------------------
check('пещера ставит объекты только на пол', () => {
  const map = generateMap({ ...BASE, biome: 'cave', width: 44, height: 30, rocks: 0.8, vegetation: 0.8, caveOpenness: 0.55 });
  assert.ok(map.trees.length + map.rocks.length > 20, `объектов слишком мало: ${map.trees.length + map.rocks.length}`);
  for (const item of [...map.trees, ...map.rocks]) {
    const x = Math.round(item.x);
    const y = Math.round(item.y);
    assert.ok(x >= 0 && y >= 0 && x < map.width && y < map.height, 'объект вне карты');
    const terrain = map.cells[y][x].terrain;
    assert.ok(terrain === 'caveFloor', `объект на ${terrain}`);
  }
});

check('пещера строит план с зонами, POI и группами', () => {
  const map = generateMap({ ...BASE, biome: 'cave', width: 44, height: 30, caveOpenness: 0.6 });
  assert.ok((map.plan?.zones.length ?? 0) >= 2, 'в плане пещеры должна быть пара зон');
  assert.ok((map.plan?.poi.length ?? 0) >= 1, 'в плане пещеры нужен хотя бы один композиционный центр');
  assert.ok((map.plan?.groups.length ?? 0) >= 1, 'в плане пещеры нужна хотя бы одна группа');
  const zonaTypes = new Set((map.plan?.zones ?? []).map((zone) => zone.type));
  assert.ok(zonaTypes.has('chamber') || zonaTypes.has('tunnel'), 'зоны пещеры должны быть залами/коридорами');
});

check('пещера остаётся проходимой (столбы не рвут пол)', () => {
  const map = generateMap({ ...BASE, biome: 'cave', width: 44, height: 30, caveOpenness: 0.6 });
  const floor: Array<[number, number]> = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) if (map.cells[y][x].terrain === 'caveFloor') floor.push([x, y]);
  }
  const seen = new Set<string>();
  const start = floor[0];
  const stack: Array<[number, number]> = [start];
  seen.add(`${start[0]}:${start[1]}`);
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (map.cells[ny][nx].terrain !== 'caveFloor') continue;
      const key = `${nx}:${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push([nx, ny]);
    }
  }
  const share = seen.size / floor.length;
  assert.ok(share > 0.97, `проходимость пещеры ${Math.round(share * 100)}%`);
});

check('в пещере есть вход с края карты и он связан с залами', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...BASE, biome: 'cave', width: 44, height: 30, seed, caveOpenness: 0.6 });
    const borderFloor: Array<[number, number]> = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const onBorder = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
        if (onBorder && map.cells[y][x].terrain === 'caveFloor') borderFloor.push([x, y]);
      }
    }
    const expectedWidth = Math.max(2, Math.min(8, Math.round(Math.min(map.width, map.height) * 0.12)));
    assert.equal(borderFloor.length, expectedWidth, `ширина входа ${borderFloor.length}, ожидалось ${expectedWidth}`);
    const entrancePoi = (map.plan?.poi ?? []).find((poi) => poi.type === 'entrance');
    assert.ok(entrancePoi, 'в плане пещеры должен быть POI входа');
    assert.ok(
      borderFloor.some(([x, y]) => x === entrancePoi!.x && y === entrancePoi!.y),
      'POI входа должен стоять в одной из клеток проёма',
    );
    // Проём — одна непрерывная полоса на границе, а не дырки в разных местах.
    const horizontalRun = new Set(borderFloor.filter(([x]) => x === borderFloor[0][0]).map(([, y]) => y));
    const verticalRun = new Set(borderFloor.filter(([, y]) => y === borderFloor[0][1]).map(([x]) => x));
    const run = Math.max(horizontalRun.size, verticalRun.size);
    assert.ok(run >= 2, `проём должен быть непрерывным, получено ${run}`);

    // От входа должен быть проход до залов
    const seen = new Set<string>();
    const stack: Array<[number, number]> = [borderFloor[0]];
    seen.add(`${borderFloor[0][0]}:${borderFloor[0][1]}`);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (map.cells[ny][nx].terrain !== 'caveFloor') continue;
        const key = `${nx}:${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push([nx, ny]);
      }
    }
    let floorTotal = 0;
    for (const row of map.cells) for (const cell of row) if (cell.terrain === 'caveFloor') floorTotal += 1;
    assert.ok(seen.size / floorTotal > 0.97, `от входа достижимо ${Math.round((seen.size / floorTotal) * 100)}% пола`);
    // У входа пусто: крупные пропсы не должны перекрывать проход
    for (const item of [...map.trees, ...map.rocks]) {
      const distance = Math.hypot(item.x - entrancePoi!.x, item.y - entrancePoi!.y);
      assert.ok(distance > expectedWidth, `объект в ${distance.toFixed(1)} клетках от входа при ширине ${expectedWidth}`);
    }
  }
});

check('пещера детерминирована', () => {
  const a = generateMap({ ...BASE, biome: 'cave', width: 32, height: 24 });
  const b = generateMap({ ...BASE, biome: 'cave', width: 32, height: 24 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---- 13. Поселения на структурном движке ----------------------------------
check('поселение не ставит деревья на дома и улицы', () => {
  const map = generateMap({ ...BASE, biome: 'town', width: 52, height: 36, density: 0.6, vegetation: 0.8 });
  assert.ok(map.trees.length > 5, `в городе слишком мало зелени: ${map.trees.length}`);
  const buildingCells = new Set<string>();
  for (const building of map.buildings ?? []) {
    for (let y = building.y - 1; y <= building.y + building.h; y += 1) {
      for (let x = building.x - 1; x <= building.x + building.w; x += 1) buildingCells.add(`${x}:${y}`);
    }
  }
  for (const tree of map.trees) {
    const x = Math.round(tree.x);
    const y = Math.round(tree.y);
    const terrain = map.cells[y][x].terrain;
    assert.ok(['grass', 'darkGrass', 'dirt'].includes(terrain), `дерево на ${terrain}`);
    assert.ok(!buildingCells.has(`${x}:${y}`), 'дерево стоит вплотную к дому');
  }
});

check('поселение строит композиционный план зон и групп', () => {
  const map = generateMap({ ...BASE, biome: 'town', width: 52, height: 36, density: 0.6, vegetation: 0.9 });
  assert.ok((map.plan?.zones.length ?? 0) >= 2, 'в плане города должны быть зоны');
  assert.ok((map.plan?.groups.length ?? 0) >= 1, 'в плане города должна быть хотя бы одна группа');
  const types = new Set((map.plan?.zones ?? []).map((zone) => zone.type));
  assert.ok(types.has('roadside') || types.has('sparse_forest') || types.has('meadow'), 'зоны города: улицы/опушка/дворы');
});

check('поселение детерминировано', () => {
  const a = generateMap({ ...BASE, biome: 'village', width: 40, height: 28, density: 0.5 });
  const b = generateMap({ ...BASE, biome: 'village', width: 40, height: 28, density: 0.5 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---- 8. Биомы тоже работают через структурный движок ----------------------
for (const biome of ['plains', 'swamp', 'desert', 'snow'] as const) {
  check(`биом ${biome} генерируется и детерминирован`, () => {
    const settings: GenSettings = { ...BASE, biome, width: 32, height: 22 };
    const first = generateMap(settings);
    const second = generateMap(settings);
    assert.deepStrictEqual(json(first), json(second));
    assert.ok(first.trees.length > 5 || first.rocks.length > 5, 'должны быть объекты');
  });
}


// --- Валидатор и починка карт --------------------------------------------

{
  const biomes = ['forest', 'plains', 'desert', 'snow', 'swamp', 'town', 'cave', 'dungeon'] as const;
  for (const biome of biomes) {
    const map = generateMap({ ...DEFAULT_GEN, biome, width: 44, height: 30, seed: 4711, structures: 4, generationEngine: 'structured' });
    const report = validateMap(map);
    assert.ok(report.problems.length === 0, `${biome}: валидатор нашёл проблемы: ${JSON.stringify(report.problems.slice(0, 3))}`);
    assert.ok(map.plan, `${biome}: план должен быть в MapData`);
    assert.ok(map.plan?.report, `${biome}: отчёт должен попасть в план`);
  }
  console.log('  ok   валидатор чист для всех биомов (forest/plains/desert/snow/swamp/town/cave/dungeon)');

  // Починка: дерево в воде, дверь в стену, осиротевшая клетка дороги.
  const base = generateMap({ ...DEFAULT_GEN, biome: 'town', width: 40, height: 28, seed: 9091, structures: 4, generationEngine: 'structured' });
  const broken = {
    ...base,
    cells: base.cells.map((row) => row.map((cell) => ({ ...cell }))),
    trees: [...base.trees, { x: 5.5, y: 5.5, r: 0.5, kind: 'oak' as const, v: 0.5 }],
  };
  // Найдём воду и посадим туда дерево.
  let waterAt: { x: number; y: number } | undefined;
  for (let y = 0; y < broken.height && !waterAt; y += 1) {
    for (let x = 0; x < broken.width && !waterAt; x += 1) {
      if (broken.cells[y][x].terrain === 'water') waterAt = { x, y };
    }
  }
  assert.ok(waterAt, 'в городе должна быть вода');
  broken.trees.push({ x: waterAt!.x + 0.5, y: waterAt!.y + 0.5, r: 0.5, kind: 'pine' as const, v: 0.5 });
  const before = validateMap(broken).problems.filter((p) => p.kind === 'prop_on_forbidden').length;
  assert.ok(before >= 1, `валидатор должен видеть дерево в воде, найдено ${before}`);
  const repaired = repairMap(broken);
  const after = validateMap(repaired.map).problems.filter((p) => p.kind === 'prop_on_forbidden').length;
  assert.equal(after, 0, 'после починки объектов в воде быть не должно');
  assert.ok(repaired.actions.length > 0, 'починка должна сообщать о действиях');
  console.log(`  ok   починка убирает объекты из воды и отчитывается (${repaired.actions.length} действий)`);
}


// --- План склепа: залы, группы и POI ---------------------------------------

{
  const dungeon = generateMap({
    ...DEFAULT_GEN, biome: 'dungeon', width: 48, height: 32, seed: 20260101,
    rooms: 7, cryptDetail: 0.7, cryptTraps: true, cryptChasms: true,
    cryptArchetype: 'catacombs', generationEngine: 'structured',
  });
  const plan = dungeon.plan;
  assert.ok(plan, 'у подземелья должен быть план');
  assert.ok((plan?.rooms?.length ?? 0) >= 3, 'в плане должны быть залы');
  assert.ok((plan?.zones?.length ?? 0) >= (plan?.rooms?.length ?? 0), 'у каждого зала должна быть зона');
  assert.ok((plan?.groups?.length ?? 0) >= (plan?.rooms?.length ?? 0), 'у каждого зала должна быть группа');
  assert.ok((plan?.poi ?? []).some((poi) => poi.type === 'entrance'), 'в плане должен быть вход');
  const placed = (plan?.groups ?? []).reduce((sum, group) => sum + group.placed, 0);
  assert.ok(placed > 0, 'группы должны описывать реально поставленные предметы');
  assert.ok((dungeon.crypt?.length ?? 0) > 3, 'склеп должен быть обставлен');
  const report = validateMap(dungeon);
  assert.ok(report.ok, `подземелье должно проходить валидатор: ${JSON.stringify(report.problems.slice(0, 3))}`);
  assert.equal(report.problems.filter((p) => p.kind === 'crypt_blocking_door').length, 0, 'предметы не должны перекрывать двери');
  console.log(`  ok   план склепа описывает залы (${plan?.rooms?.length} залов, ${plan?.groups?.length} групп, ${placed} предметов)`);
}

check('авто-починка прорубает проход в отрезанный зал', () => {
  const map = generateMap({
    ...DEFAULT_GEN, biome: 'dungeon', width: 48, height: 32, seed: 20260101,
    rooms: 7, cryptDetail: 0.7, cryptTraps: true, cryptChasms: true,
    cryptArchetype: 'catacombs', generationEngine: 'structured',
  });
  const room = map.plan?.rooms?.[1];
  if (!room) throw new Error('нет второго зала');
  const sealed = {
    ...map,
    cells: map.cells.map((row) => row.map((cell) => ({ ...cell }))),
  };
  let sealedCount = 0;
  for (let y = room.bounds.y - 1; y <= room.bounds.y + room.bounds.h; y += 1) {
    for (let x = room.bounds.x - 1; x <= room.bounds.x + room.bounds.w; x += 1) {
      const cell = sealed.cells[y]?.[x];
      if (cell && cell.terrain === 'door') {
        cell.terrain = 'wall';
        sealedCount += 1;
      }
    }
  }
  if (sealedCount === 0) throw new Error('вокруг зала не нашлось дверей — тест непригоден');
  const repaired = repairMap(sealed);
  const entrance = (repaired.map.plan?.poi ?? []).find((poi) => poi.type === 'entrance');
  const start = entrance
    ? { x: entrance.x, y: entrance.y }
    : { x: room.bounds.x + Math.floor(room.bounds.w / 2), y: room.bounds.y + Math.floor(room.bounds.h / 2) };
  const seen = reachableFloor(repaired.map, start);
  const cx = room.bounds.x + Math.floor(room.bounds.w / 2);
  const cy = room.bounds.y + Math.floor(room.bounds.h / 2);
  if (!seen.has(cy * repaired.map.width + cx)) throw new Error('зал остался отрезанным после починки');
  console.log(`  ok   авто-починка прорубила проход (дверей замуровано: ${sealedCount}, действий: ${repaired.actions.length})`);
});

check('тропы соединяют POI с магистралью', () => {
  const map = generateMap({
    ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921,
    structures: 4, ruined: true, vegetation: 0.7, rocks: 0.5, generationEngine: 'structured',
  });
  const trails = (map.plan?.roads ?? []).filter((path) => path.type === 'trail');
  if (!trails.length) throw new Error('генератор не построил ни одной тропы');
  const touchesRoad = (point: { x: number; y: number }): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const terrain = map.cells[point.y + dy]?.[point.x + dx]?.terrain;
        if (terrain === 'road' || terrain === 'bridge') return true;
      }
    }
    return false;
  };
  for (const trail of trails) {
    const end = trail.points[trail.points.length - 1];
    if (!touchesRoad(end)) throw new Error('тропа не упирается в магистраль');
    if (trail.points.length < 4) throw new Error('слишком короткая тропа');
  }
  console.log(`  ok   троп к POI: ${trails.length} (${trails.map((t) => t.points.length).join('/')} клеток)`);
});

check('залы получают содержимое по назначению', () => {
  const map = generateMap({
    ...DEFAULT_GEN, biome: 'dungeon', width: 56, height: 36, seed: 90210,
    rooms: 8, cryptDetail: 0.8, cryptTraps: true, cryptChasms: true,
    cryptArchetype: 'catacombs', generationEngine: 'structured',
  });
  const rooms = map.plan?.rooms ?? [];
  if (rooms.length < 4) throw new Error('мало залов для проверки');
  const inside = (room: { bounds: { x: number; y: number; w: number; h: number } }, predicate: (item: { hidden?: boolean; kind: string }) => boolean): boolean =>
    (map.crypt ?? []).some((item) => predicate(item)
      && item.x >= room.bounds.x && item.y >= room.bounds.y
      && item.x + item.w <= room.bounds.x + room.bounds.w
      && item.y + item.h <= room.bounds.y + room.bounds.h);
  let checked = 0;
  for (const room of rooms) {
    if (room.purpose === 'treasury') {
      if (!inside(room, (item) => item.kind === 'chest')) throw new Error(`сокровищница ${room.id} без сундука`);
      checked += 1;
    } else if (room.purpose === 'crypt') {
      if (!inside(room, (item) => item.hidden === true)) throw new Error(`крипта ${room.id} без тайника`);
      checked += 1;
    } else if (room.purpose === 'guard') {
      const hazardKinds = ['pressureTile', 'spikeGlyph', 'runeTrap', 'fallSeal', 'pitTrap', 'bearTrap', 'trapNet'];
      if (!inside(room, (item) => hazardKinds.includes(item.kind))) throw new Error(`стража ${room.id} без ловушки`);
      checked += 1;
    }
  }
  console.log(`  ok   назначение залов подкреплено содержимым (${checked} залов)`);
});

check('в коридорах появляются скрытые ловушки', () => {
  const map = generateMap({
    ...DEFAULT_GEN, biome: 'dungeon', width: 56, height: 36, seed: 90210,
    rooms: 8, cryptDetail: 0.8, cryptTraps: true, cryptChasms: true,
    cryptArchetype: 'catacombs', generationEngine: 'structured',
  });
  const rooms = map.plan?.rooms ?? [];
  const outside = (map.crypt ?? []).filter((item) => item.kind === 'pressureTile'
    && !rooms.some((room) => item.x >= room.bounds.x && item.y >= room.bounds.y
      && item.x + item.w <= room.bounds.x + room.bounds.w && item.y + item.h <= room.bounds.y + room.bounds.h));
  if (outside.length < 1) throw new Error('в коридорах нет ни одной скрытой плиты');
  console.log(`  ok   скрытых плит в коридорах: ${outside.length}`);
});

check('валидатор предупреждает о POI без подхода', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 48, height: 32, seed: 4242, generationEngine: 'structured' });
  if (!map.plan?.poi?.length) throw new Error('нет POI для проверки');
  const orphan = { ...map, plan: { ...map.plan, roads: [], poi: map.plan.poi.slice(0, 1) } };
  const report = validateMap(orphan, { strictConnectivity: false });
  if (!report.warnings.length) throw new Error('нет предупреждения о POI без подхода');
  if (!report.ok) throw new Error('предупреждение не должно ломать ok');
  console.log(`  ok   предупреждение о POI: ${report.warnings[0]}`);
});

check('точка старта есть и стоит на проходимой клетке', () => {
  const biomes = ['forest', 'plains', 'swamp', 'desert', 'cave', 'dungeon', 'village'] as const;
  const walkable = new Set(['grass', 'darkGrass', 'dirt', 'mud', 'sand', 'snow', 'ice', 'rock', 'road', 'bridge', 'plaza', 'floor', 'door', 'caveFloor', 'buildingFloor', 'water']);
  for (const biome of biomes) {
    const map = generateMap({ ...DEFAULT_GEN, biome, width: 44, height: 30, seed: 5150, generationEngine: 'structured' });
    const spawn = map.plan?.spawn;
    if (!spawn) throw new Error(`${biome}: нет точки старта в плане`);
    const terrain = map.cells[spawn.y]?.[spawn.x]?.terrain;
    if (!terrain || !walkable.has(terrain)) throw new Error(`${biome}: старт на ${terrain}`);
  }
  console.log(`  ok   старт на проходимой клетке во всех ${biomes.length} биомах`);
});

check('река описана осевой линией для гладкого рендера', () => {
  for (const seed of [583921, 777001]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, river: true, generationEngine: 'structured' });
    const river = map.plan?.river ?? [];
    if (river.length < 4) throw new Error(`seed ${seed}: у реки ${river.length} точек`);
    for (const point of river) {
      if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) {
        throw new Error(`seed ${seed}: точка реки вне карты`);
      }
    }
    if ((map.plan?.riverWidth ?? 0) < 1) throw new Error(`seed ${seed}: нет ширины русла`);
  }
  console.log('  ok   река описана осевой линией и шириной русла');
});

check('улицы поселений описаны лентами', () => {
  for (const biome of ['village', 'town'] as const) {
    const map = generateMap({ ...DEFAULT_GEN, biome, width: 48, height: 34, seed: 777, generationEngine: 'structured' });
    const roads = map.plan?.roads ?? [];
    if (roads.length < 3) throw new Error(`${biome}: улиц-лент всего ${roads.length}`);
    for (const road of roads) {
      if (road.points.length < 2) throw new Error(`${biome}: пустая улица ${road.id}`);
      for (const point of road.points) {
        if (point.x < -1 || point.y < -1 || point.x > map.width + 1 || point.y > map.height + 1) {
          throw new Error(`${biome}: точка улицы вне карты`);
        }
      }
    }
    if (biome === 'town') {
      const plazaStreets = roads.filter((road) => road.surface === 'plaza');
      if (!plazaStreets.length) throw new Error('town: нет мощения площади');
    }
  }
  console.log('  ok   улицы поселений — ленты с покрытием (road/plaza)');
});

check('на лесной карте есть арена для боя и она свободна', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const arena = map.plan?.poi.find((poi) => poi.type === 'clearing');
    if (!arena) throw new Error(`seed ${seed}: нет арены (clearing)`);
    if (arena.radius < 3) throw new Error(`seed ${seed}: арена слишком мала (r=${arena.radius})`);
    const radius = arena.radius - 1;
    const intruders = [...map.trees, ...map.rocks].filter(
      (object) => Math.hypot(object.x - arena.x, object.y - arena.y) < radius,
    );
    if (intruders.length) throw new Error(`seed ${seed}: на арене ${intruders.length} объектов`);
  }
  console.log('  ok   арена существует и свободна от объектов');
});

check('лес не превращается в ковёр из крон', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const area = map.width * map.height;
    let crown = 0;
    for (const tree of map.trees) {
      if (tree.kind === 'bush' || tree.kind === 'mushroom') continue;
      const diameter = tree.r * 4.1;
      crown += (Math.PI / 4) * diameter * diameter;
    }
    const coverage = crown / area;
    if (coverage > 0.55) throw new Error(`seed ${seed}: кроны покрывают ${(coverage * 100).toFixed(0)} % карты`);
    if (map.trees.length > area * 0.12) throw new Error(`seed ${seed}: деревьев ${map.trees.length} — слишком много`);
    const report = map.plan?.report;
    if (!report?.ok) throw new Error(`seed ${seed}: проблемы — ${(report?.problems ?? []).join('; ')}`);
  }
  console.log('  ok   покрытие кронами и свободное место в норме');
});

check('сглаживание ломаной сохраняет концы линии', () => {
  const points = [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 9, y: 1 }, { x: 12, y: 4 }];
  const smooth = chaikin(points, 2);
  if (smooth.length < points.length) throw new Error('точек стало меньше');
  const first = smooth[0];
  const last = smooth[smooth.length - 1];
  if (first.x !== 0 || first.y !== 0) throw new Error('начало линии сдвинулось');
  if (last.x !== 12 || last.y !== 4) throw new Error('конец линии сдвинулся');
  for (const point of smooth) {
    if (point.x < 0 || point.x > 12) throw new Error('сглаживание вышло за границы выпуклой оболочки');
  }
  console.log(`  ok   сглаживание: ${points.length} -> ${smooth.length} точек, концы на месте`);
});


check('композиция содержит пространства, массы и переходы', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const composition = map.plan?.composition;
    if (!composition) throw new Error(`seed ${seed}: композиция не построена`);
    if (!composition.openSpaces.length) throw new Error(`seed ${seed}: нет открытых пространств`);
    if (!composition.masses.length) throw new Error(`seed ${seed}: нет масс леса`);
    if (!composition.transitions.length) throw new Error(`seed ${seed}: нет переходных полос`);
    const battle = composition.openSpaces.find((space) => space.kind === 'battle_area');
    if (!battle) throw new Error(`seed ${seed}: нет главного пространства боя`);
    if (battle.radius < 3) throw new Error(`seed ${seed}: арена слишком мала`);
    if (!composition.focal) throw new Error(`seed ${seed}: нет визуального центра`);
    const inside = battle.x > 0 && battle.y > 0 && battle.x < map.width && battle.y < map.height;
    if (!inside) throw new Error(`seed ${seed}: центр арены вне карты`);
  }

});

check('открытые пространства композиции не заставлены объектами', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const composition = map.plan?.composition;
    if (!composition) throw new Error('нет композиции');
    for (const space of composition.openSpaces) {
      const objects = [...map.trees, ...map.rocks].filter(
        (object) => Math.hypot(object.x - space.x, object.y - space.y) <= space.radius - 0.5,
      );
      if (objects.length) throw new Error(`seed ${seed}: в ${space.id} стоит ${objects.length} объектов`);
    }
  }

});

check('плотность падает от массы леса к открытому пространству', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, generationEngine: 'structured' });
  const composition = map.plan?.composition;
  if (!composition || !composition.masses.length) throw new Error('нет масс леса');
  const mass = composition.masses[0];
  // Плотность считаем по СУХОЙ площади кольца: река и скалы не являются
  // местом для деревьев, иначе кольца, пересекающие русло, ложно «разрежаются».
  // Плотность леса считаем по «лесной почве»: трава обоих оттенков. Дороги,
  // песок, грязь и вода деревьями не зарастают, поэтому в площадь не входят.
  const plantable = new Set(['grass', 'darkGrass']);
  const densityIn = (from: number, to: number) => {
    const count = map.trees.filter((tree) => {
      const distance = Math.hypot(tree.x - mass.x, tree.y - mass.y);
      return distance >= from && distance < to;
    }).length;
    let dry = 0;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const distance = Math.hypot(x + 0.5 - mass.x, y + 0.5 - mass.y);
        if (distance < from || distance >= to) continue;
        if (!plantable.has(map.cells[y][x].terrain)) continue;
        dry += 1;
      }
    }
    return count / Math.max(1, dry);
  };
  const inner = densityIn(0, mass.radius * 0.5);
  const middle = densityIn(mass.radius * 0.5, mass.radius);
  const outer = densityIn(mass.radius, mass.radius * 1.6);
  // Кольцо «середина» может пересекать коридор дороги или русло — там деревьев
  // нет по правилам (шоссе и вода), поэтому сравниваем ядро с краем и следим,
  // чтобы на краю не вырастал «вал» плотнее ядра.
  if (inner < middle * 0.85) throw new Error(`ядро разрежено: ${inner.toFixed(3)} vs ${middle.toFixed(3)}`);
  if (outer > inner * 1.05) throw new Error(`на границе плотнее ядра: ядро ${inner.toFixed(3)}, край ${outer.toFixed(3)}`);
  if (outer > inner * 1.4) throw new Error(`резкий вал на границе массива: ${inner.toFixed(3)} → ${outer.toFixed(3)}`);
  console.log(`         плотность: ядро ${inner.toFixed(3)}, середина ${middle.toFixed(3)}, край ${outer.toFixed(3)}`);
});


check('переправа проектируется вместе с дорогой', () => {
  let totalBridges = 0;
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const bridges = map.plan?.bridges ?? [];
    totalBridges += bridges.length;
    for (const bridge of bridges) {
      const road = (map.plan?.roads ?? []).find((path) => path.id === bridge.pathId);
      if (!road) throw new Error(`seed ${seed}: мост ${bridge.id} без дороги`);
      // Под настилом должна быть вода (после укладки — клетки bridge).
      for (const cell of bridge.cells) {
        const terrain = map.cells[cell.y]?.[cell.x]?.terrain;
        if (terrain !== 'bridge' && terrain !== 'water' && terrain !== 'deepWater') {
          throw new Error(`seed ${seed}: мост ${bridge.id} лежит не над водой (${terrain})`);
        }
      }
      // Ось настила совпадает с направлением дороги.
      const points = road.points;
      let nearest = 0;
      let bestDistance = Infinity;
      points.forEach((point, index) => {
        const distance = Math.hypot(point.x + 0.5 - bridge.x, point.y + 0.5 - bridge.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = index;
        }
      });
      const from = points[Math.max(0, nearest - 1)];
      const to = points[Math.min(points.length - 1, nearest + 1)];
      const tangent = Math.atan2(to.y - from.y, to.x - from.x);
      const delta = Math.abs(Math.atan2(Math.sin(bridge.angle - tangent), Math.cos(bridge.angle - tangent)));
      if (delta > (35 * Math.PI) / 180) {
        throw new Error(`seed ${seed}: мост ${bridge.id} повёрнут на ${Math.round((delta * 180) / Math.PI)}°`);
      }
      // Длина моста обязана покрывать русло: широкую реку перекрывает длинный настил.
      if (bridge.length < 1.5 || bridge.length > 14) throw new Error(`seed ${seed}: длина моста ${bridge.length}`);
      if (bridge.width < 1) throw new Error(`seed ${seed}: ширина моста ${bridge.width}`);
    }
    const report = map.plan?.report;
    if (!report?.ok) throw new Error(`seed ${seed}: проблемы — ${report?.problems.map((problem) => problem.message).join('; ')}`);
  }
  if (totalBridges === 0) throw new Error('ни одной переправы за три сида — мост не планируется');
  console.log(`         переправ: ${totalBridges}`);
});


check('осевая дороги сглажена: есть диагонали и нет резких разворотов', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const highway = map.plan?.roads?.find((path) => path.id === 'highway');
    if (!highway) throw new Error(`seed ${seed}: нет магистрали в плане`);
    const points = highway.points;
    let diagonals = 0;
    let reversals = 0;
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) throw new Error(`seed ${seed}: разрыв пути на ${index}`);
      if (dx !== 0 && dy !== 0) diagonals += 1;
    }
    for (let index = 2; index < points.length; index += 1) {
      const ax = points[index - 1].x - points[index - 2].x;
      const ay = points[index - 1].y - points[index - 2].y;
      const bx = points[index].x - points[index - 1].x;
      const by = points[index].y - points[index - 1].y;
      if (ax === -bx && ay === -by) reversals += 1;
    }
    if (reversals > 1) throw new Error(`seed ${seed}: разворотов на дороге ${reversals}`);
    const diagonalShare = diagonals / Math.max(1, points.length - 1);
    // Тракт обязан начинаться и заканчиваться у края карты. Ось может быть любой:
    // сцена вправе вести дорогу и поперёк, и вдоль полотна.
    const first = points[0];
    const last = points[points.length - 1];
    const firstAtEdge = first.x === 0 || first.y === 0;
    const lastAtEdge = last.x === map.width - 1 || last.y === map.height - 1;
    if (!firstAtEdge) throw new Error(`seed ${seed}: дорога начинается не у края (${first.x}:${first.y})`);
    if (!lastAtEdge) throw new Error(`seed ${seed}: дорога заканчивается не у края (${last.x}:${last.y})`);
    // Диагоналей может быть мало у прямого участка к мосту, но полностью
    // «лесенкой» магистраль быть не должна.
    if (diagonalShare === 0) throw new Error(`seed ${seed}: дорога без единого диагонального шага`);
  }
});

check('вдоль полотна есть сплошные обочины с двух сторон', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const terrainAt = (x: number, y: number) => map.cells[y]?.[x]?.terrain;
    const isRoad = (terrain?: string) => terrain === 'road' || terrain === 'bridge';
    let covered = 0;
    let considered = 0;
    const isWet = (terrain?: string) => terrain === 'water' || terrain === 'deepWater';
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (terrainAt(x, y) !== 'road') continue;
        const sides: (string | undefined)[] = [terrainAt(x - 1, y), terrainAt(x + 1, y), terrainAt(x, y - 1), terrainAt(x, y + 1)];
        for (const side of sides) {
          if (side === undefined || isWet(side)) continue; // край карты и вода — не считаем
          considered += 1;
          if (side === 'dirt' || side === 'road' || side === 'bridge') covered += 1;
        }
      }
    }
    const share = covered / Math.max(1, considered);
    if (share < 0.85) throw new Error(`seed ${seed}: у полотна мало обочин (${(share * 100).toFixed(0)}%)`);
  }
});

check('ответвление заканчивается расчищенной площадкой', () => {
  let checked = 0;
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const branch = map.plan?.roads?.find((path) => path.id === 'branch');
    if (!branch) continue;
    checked += 1;
    const end = branch.points[branch.points.length - 1];
    const terrainAt = (x: number, y: number) => map.cells[y]?.[x]?.terrain;
    if (terrainAt(end.x, end.y) === 'water' || terrainAt(end.x, end.y) === 'deepWater') {
      throw new Error(`seed ${seed}: ответвление упирается в воду`);
    }
    let cleared = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (terrainAt(end.x + dx, end.y + dy) === 'dirt') cleared += 1;
      }
    }
    if (cleared < 5) throw new Error(`seed ${seed}: у конца ответвления нет расчистки (${cleared})`);
  }
  if (!checked) throw new Error('ни одного ответвления не встретилось');
});


check('вокруг построек и руин есть расчищенные дворы', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 48, height: 34, seed: 909090, structures: 6, ruined: true, generationEngine: 'structured' });
  const yards = (map.plan?.composition?.openSpaces ?? []).filter((space) => space.kind === 'yard');
  if (!yards.length) throw new Error('дворов нет, хотя на карте есть постройки');
  const terrainAt = (x: number, y: number) => map.cells[y]?.[x]?.terrain;
  for (const yard of yards) {
    const inside = map.trees.filter((tree) => Math.hypot(tree.x - yard.x, tree.y - yard.y) < yard.radius - 0.8);
    if (inside.length) throw new Error(`двор ${yard.id} заставлен деревьями: ${inside.length}`);
    const onWater = inside.filter((tree) => terrainAt(Math.round(tree.x), Math.round(tree.y)) === 'water');
    if (onWater.length) throw new Error(`двор ${yard.id}: деревья в воде`);
  }
});

check('по краю двора лежат обломки кладки', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 48, height: 34, seed: 909090, structures: 6, ruined: true, generationEngine: 'structured' });
  const yards = (map.plan?.composition?.openSpaces ?? []).filter((space) => space.kind === 'yard');
  if (!yards.length) throw new Error('дворов нет');
  for (const yard of yards) {
    const debris = map.rocks.filter((rock) => {
      const distance = Math.hypot(rock.x - yard.x, rock.y - yard.y);
      return distance >= yard.radius - 0.6 && distance <= yard.radius + 2;
    });
    if (debris.length < 3) throw new Error(`двор ${yard.id}: обломков всего ${debris.length}`);
  }
});

check('двор связан с дорогой тропой', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 48, height: 34, seed: 909090, structures: 6, ruined: true, generationEngine: 'structured' });
  const yards = (map.plan?.composition?.openSpaces ?? []).filter((space) => space.kind === 'yard');
  const trails = (map.plan?.roads ?? []).filter((path) => path.type === 'trail');
  if (!yards.length) throw new Error('дворов нет');
  const linked = yards.filter((yard) =>
    trails.some((trail) => trail.points.some((point) => Math.hypot(point.x - yard.x, point.y - yard.y) <= yard.radius + 2.5)),
  );
  if (!linked.length) throw new Error('ни один двор не соединён тропой с дорогой');
});


check('морфология убирает одноклеточные вкрапления грунта', () => {
  const terrain = (value: string) => ({ terrain: value as never, height: 0.5, moisture: 0.5 });
  const cells = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => terrain('grass')));
  cells[4][4] = terrain('sand'); // одиночная песчинка посреди травы
  const before = { width: 9, height: 9, cells } as never;
  const smoothed = smoothTerrain(before, { iterations: 1 });
  if (smoothed.cells[4][4].terrain !== 'grass') {
    throw new Error(`одиночная клетка не растворена: ${smoothed.cells[4][4].terrain}`);
  }
});

check('морфология залечивает выступы воды и островки суши', () => {
  const terrain = (value: string) => ({ terrain: value as never, height: 0.5, moisture: 0.5 });
  const cells = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => terrain('grass')));
  for (let y = 1; y < 8; y += 1) for (let x = 1; x < 8; x += 1) cells[y][x] = terrain('water');
  cells[4][4] = terrain('grass'); // островок суши в воде
  cells[4][2] = terrain('grass'); // и подход, чтобы это не был шум
  const before = { width: 9, height: 9, cells } as never;
  const smoothed = smoothTerrain(before, { iterations: 1 });
  if (smoothed.cells[4][4].terrain !== 'water') {
    throw new Error(`островок суши не затоплен: ${smoothed.cells[4][4].terrain}`);
  }
});

check('сглаживание не трогает дороги, мосты и постройки', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, structures: 4, generationEngine: 'structured' });
  const count = (target: (terrain: string) => boolean) =>
    map.cells.reduce((sum, row) => sum + row.filter((cell) => target(cell.terrain)).length, 0);
  const before = {
    road: count((terrain) => terrain === 'road'),
    bridge: count((terrain) => terrain === 'bridge'),
    wall: count((terrain) => terrain === 'wall'),
    water: count((terrain) => terrain === 'water' || terrain === 'deepWater'),
  };
  const smoothed = smoothTerrain(map, { iterations: 2 });
  const after = {
    road: smoothed.cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === 'road').length, 0),
    bridge: smoothed.cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === 'bridge').length, 0),
    wall: smoothed.cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === 'wall').length, 0),
    water: smoothed.cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === 'water' || cell.terrain === 'deepWater').length, 0),
  };
  if (after.road !== before.road || after.bridge !== before.bridge || after.wall !== before.wall) {
    throw new Error(`защищённые террейны изменились: ${JSON.stringify({ before, after })}`);
  }
  // Допускаем только заливку одноклеточных выступов воды (не больше 2 %).
  if (Math.abs(after.water - before.water) > before.water * 0.02 + 2) {
    throw new Error(`воды изменилось слишком много: ${before.water} -> ${after.water}`);
  }
});


check('на карте нет одиночных вкраплений грунта и выступов воды', () => {
  const ground = new Set(['grass', 'darkGrass', 'dirt', 'sand', 'mud', 'snow', 'ice', 'rock']);
  const water = new Set(['water', 'deepWater']);
  for (const seed of [583921, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, structures: 4, generationEngine: 'structured' });
    let lonelyGround = 0;
    let lonelyWater = 0;
    for (let y = 1; y < map.height - 1; y += 1) {
      for (let x = 1; x < map.width - 1; x += 1) {
        const terrain = map.cells[y][x].terrain;
        const neighbours: string[] = [];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            neighbours.push(map.cells[y + dy][x + dx].terrain);
          }
        }
        if (ground.has(terrain) && !neighbours.includes(terrain)) lonelyGround += 1;
        if (water.has(terrain) && !neighbours.some((neighbour) => water.has(neighbour))) lonelyWater += 1;
      }
    }
    if (lonelyGround > 3) throw new Error(`seed ${seed}: одиночных клеток грунта ${lonelyGround}`);
    if (lonelyWater > 0) throw new Error(`seed ${seed}: одиночных клеток воды ${lonelyWater}`);
  }
});


check('пещера получает композицию с залом-ареной', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'cave', width: 46, height: 32, seed: 515151, generationEngine: 'structured' });
  const composition = map.plan?.composition;
  if (!composition) throw new Error('у пещеры нет композиции');
  if (!composition.openSpaces.some((space) => space.kind === 'battle_area')) throw new Error('нет зала-арены');
  if (composition.masses.length === 0) throw new Error('нет сталагмитовых масс');
  if (composition.transitions.length === 0) throw new Error('нет переходных зон у стен зала');
});

check('центр главного зала пещеры свободен от препятствий', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'cave', width: 46, height: 32, seed: 515151, generationEngine: 'structured' });
  const battle = map.plan?.composition?.openSpaces.find((space) => space.kind === 'battle_area');
  if (!battle) throw new Error('нет зала-арены');
  const inner = battle.radius * 0.6;
  const blockers =
    map.trees.filter((tree) => Math.hypot(tree.x - battle.x, tree.y - battle.y) < inner).length +
    map.rocks.filter((rock) => Math.hypot(rock.x - battle.x, rock.y - battle.y) < inner).length;
  if (blockers > 0) throw new Error(`в центре зала ${blockers} препятствий`);
});

check('поселение получает композицию с площадью-ареной и дворами', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'town', width: 56, height: 40, seed: 606060, density: 0.85, generationEngine: 'structured' });
  const composition = map.plan?.composition;
  if (!composition) throw new Error('у поселения нет композиции');
  if (!composition.openSpaces.some((space) => space.kind === 'battle_area')) throw new Error('нет площади-арены');
  const yards = composition.openSpaces.filter((space) => space.kind === 'yard').length;
  if (yards < 2) throw new Error(`дворов слишком мало: ${yards}`);
  const battles = composition.openSpaces.filter((space) => space.kind === 'battle_area' || space.kind === 'yard');
  for (const space of battles) {
    const inner = space.radius * 0.7;
    const blockers = map.trees.filter((tree) => Math.hypot(tree.x - space.x, tree.y - space.y) < inner).length;
    if (blockers > 0) throw new Error(`в пространстве ${space.id} стоят деревья: ${blockers}`);
  }
});

check('валидатор ловит заставленное открытое пространство', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, generationEngine: 'structured' });
  const battle = map.plan?.composition?.openSpaces.find((space) => space.kind === 'battle_area');
  if (!battle) throw new Error('нет арены');
  const broken: MapData = { ...map, trees: [...map.trees, { x: battle.x, y: battle.y, r: 0.5, kind: 'oak', v: 0.5 }] };
  const report = validateMap(broken);
  if (!report.problems.some((problem) => problem.kind === 'open_space_blocked')) {
    throw new Error('валидатор не заметил заставленное пространство');
  }
});

// ---- Этап A: ScenePlan (сцена до террейна) --------------------------------
check('сцена детерминирована и задаёт архетип', () => {
  const first = generateMap({ ...BASE, width: 46, height: 32, seed: 521521 });
  const second = generateMap({ ...BASE, width: 46, height: 32, seed: 521521 });
  const a = first.plan?.scene;
  const b = second.plan?.scene;
  assert.ok(a && b, 'план обязан содержать сцену');
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), 'сцена обязана быть детерминированной');
  assert.ok(a!.openSpaces.length >= 1, 'сцена должна задавать хотя бы одно открытое пространство');
  assert.ok(a!.budget.primary >= 1, 'бюджет primary обязан быть положительным');
});

check('лесная сцена даёт реку, переправу и переправу на дороге', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const scene = map.plan?.scene;
    assert.ok(scene?.river, `seed ${seed}: лесная сцена без реки`);
    assert.ok(scene?.crossing, `seed ${seed}: у сцены нет точки переправы`);
    const road = map.plan?.roads?.find((path) => path.id === 'highway');
    assert.ok(road, `seed ${seed}: нет магистрали`);
    const crossing = scene!.crossing!;
    const near = road!.points.some((point) => Math.abs(point.x - crossing.x) <= 2 && Math.abs(point.y - crossing.y) <= 2);
    assert.ok(near, `seed ${seed}: дорога не проходит через переправу ${crossing.x}:${crossing.y}`);
    // Мост именно магистрали: ответвление может пересекать воду в другом месте.
    const bridge = (map.plan?.bridges ?? []).find((item) => item.pathId === 'highway');
    if (bridge) {
      assert.ok(
        Math.abs(bridge.x - crossing.x) <= 4 && Math.abs(bridge.y - crossing.y) <= 4,
        `seed ${seed}: мост далеко от переправы`,
      );
    }
  }
});

check('покрытие реки укладывается в 8–22 % площади', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    let water = 0;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const terrain = map.cells[y][x].terrain;
        if (terrain === 'water' || terrain === 'deepWater' || terrain === 'ice') water += 1;
      }
    }
    const share = water / (map.width * map.height);
    assert.ok(share >= 0.08 && share <= 0.22, `seed ${seed}: покрытие воды ${(share * 100).toFixed(1)} %`);
  }
  console.log('  ok   покрытие реки в пределах 8–22 %');
});

check('бюджет сцены соблюдает иерархию важности', () => {
  for (const seed of [583921, 777001, 424242]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const scene = map.plan?.scene;
    assert.ok(scene, `seed ${seed}: сцена отсутствует`);
    const primary = scene!.openSpaces.filter((space) => space.importance === 'primary').length;
    const secondary = scene!.openSpaces.filter((space) => space.importance === 'secondary').length;
    assert.ok(primary <= 1, `seed ${seed}: главных пространств ${primary}`);
    assert.ok(secondary <= 2, `seed ${seed}: вторичных пространств ${secondary}`);
  }
});

check('деревья растут кластерами, а не равномерным ковром', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, generationEngine: 'structured' });
  const trees = map.trees;
  if (trees.length < 20) throw new Error(`слишком мало деревьев: ${trees.length}`);
  const nearest: number[] = [];
  for (let index = 0; index < trees.length; index += 1) {
    let best = Infinity;
    for (let other = 0; other < trees.length; other += 1) {
      if (other === index) continue;
      const distance = Math.hypot(trees[index].x - trees[other].x, trees[index].y - trees[other].y);
      if (distance < best) best = distance;
    }
    nearest.push(best);
  }
  nearest.sort((a, b) => a - b);
  const median = nearest[Math.floor(nearest.length / 2)];
  const lonely = nearest.filter((distance) => distance > 3.2).length / nearest.length;
  if (median > 3.2) throw new Error(`деревья стоят слишком редко (медиана ${median.toFixed(2)})`);
  if (lonely > 0.25) throw new Error(`слишком много одиночных деревьев: ${(lonely * 100).toFixed(0)} %`);
  console.log(`         деревьев ${trees.length}, медиана до соседа ${median.toFixed(2)}, одиночек ${(lonely * 100).toFixed(0)} %`);
});

check('крупный камень собирает вокруг мелкие обломки', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, generationEngine: 'structured' });
  const anchors = map.rocks.filter((rock) => rock.r >= 0.42);
  if (!anchors.length) throw new Error('нет крупных камней-анкоров');
  let decorated = 0;
  for (const anchor of anchors) {
    const shards = map.rocks.filter(
      (rock) => rock !== anchor && rock.r <= 0.32 && Math.hypot(rock.x - anchor.x, rock.y - anchor.y) <= 2.2,
    ).length;
    if (shards >= 2) decorated += 1;
  }
  if (decorated === 0) throw new Error('ни у одного крупного камня нет мелких обломков рядом');
  console.log(`         анкоров ${anchors.length}, с обломками ${decorated}`);
});

check('мелкий декор не попадает в открытые пространства', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 777001, generationEngine: 'structured' });
  const composition = map.plan?.composition;
  if (!composition) throw new Error('нет композиции');
  const inside = (x: number, y: number) => composition.openSpaces.some(
    (space) => Math.hypot(space.x - x, space.y - y) < space.radius * 0.8,
  );
  const strays = [
    ...map.rocks.filter((rock) => rock.r <= 0.32 && inside(rock.x, rock.y)).map((rock) => rock),
    ...map.trees.filter((tree) => (tree.kind === 'bush' || tree.kind === 'mushroom') && inside(tree.x, tree.y)).map((tree) => tree),
  ];
  if (strays.length > 1) throw new Error(`мелкий декор внутри полян: ${strays.length}`);
});

check('CompositionValidator проходит по 20 сидам лесного пресета', () => {
  const seeds = [583921, 777001, 424242, 101, 202, 303, 404, 505, 606, 707,
    808, 909, 1111, 1212, 1313, 1414, 1515, 1616, 1717, 1818];
  const maps = seeds.map((seed) => generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' }));
  const report = validateCompositionAcross(maps);
  if (!report.ok) {
    const details = report.issues.slice(0, 6).map((issue) => `${issue.category}: ${issue.message}`).join('; ');
    throw new Error(`композиционные проблемы на ${report.issues.length} из ${report.checked}: ${details}`);
  }
  if (report.checked !== seeds.length) throw new Error(`проверено ${report.checked} карт вместо ${seeds.length}`);
  console.log(`         карт ${report.checked}, пространств ${report.stats.spaces}, масс ${report.stats.masses}, деревьев ${report.stats.trees}`);
});

check('вокруг руин есть заросли, но подход оставлен открытым', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 48, height: 34, seed: 909090, structures: 6, ruined: true, generationEngine: 'structured' });
  const yards = (map.plan?.composition?.openSpaces ?? []).filter((space) => space.kind === 'yard');
  if (!yards.length) throw new Error('дворов нет');
  let bushyYards = 0;
  for (const yard of yards) {
    const overgrowth = map.trees.filter((tree) => {
      if (tree.kind !== 'bush' && tree.kind !== 'mushroom') return false;
      const distance = Math.hypot(tree.x - yard.x, tree.y - yard.y);
      return distance >= yard.radius + 0.4 && distance <= yard.radius + 3.2;
    }).length;
    if (overgrowth >= 3) bushyYards += 1;
  }
  if (bushyYards === 0) throw new Error('ни у одного двора нет зарослей по краю');
  console.log(`         дворов ${yards.length}, с зарослями ${bushyYards}`);
});

check('repair вычищает ядро боевой поляны', () => {
  const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed: 583921, generationEngine: 'structured' });
  const battle = (map.plan?.composition?.openSpaces ?? []).find((space) => space.kind === 'battle_area');
  if (!battle) throw new Error('нет боевой поляны');
  const dirty = {
    ...map,
    trees: [...map.trees, { kind: 'oak' as const, x: battle.x, y: battle.y, r: 1.6, v: 0.3, pts: [] as [number, number][] }],
  };
  const repaired = repairMap(dirty);
  const inside = repaired.map.trees.filter((tree) => Math.hypot(tree.x - battle.x, tree.y - battle.y) < battle.radius * 0.7);
  if (inside.length) throw new Error(`в ядре поляны осталось деревьев: ${inside.length}`);
});

check('на одной переправе ровно один настил', () => {
  for (const seed of [583921, 777001, 424242, 101, 202]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const bridges = map.plan?.bridges ?? [];
    for (let i = 0; i < bridges.length; i += 1) {
      for (let j = i + 1; j < bridges.length; j += 1) {
        const distance = Math.hypot(bridges[i].x - bridges[j].x, bridges[i].y - bridges[j].y);
        if (distance < 2.5) {
          throw new Error(`seed ${seed}: настилы ${bridges[i].id} и ${bridges[j].id} наложены (${distance.toFixed(1)} кл.)`);
        }
      }
    }
  }
});

check('настилы на одной переправе не накладываются полотном', () => {
  for (const seed of [583921, 777001, 424242, 101, 202]) {
    const map = generateMap({ ...DEFAULT_GEN, biome: 'forest', width: 44, height: 30, seed, generationEngine: 'structured' });
    const bridges = map.plan?.bridges ?? [];
    const segment = (b: { x: number; y: number; angle: number; length: number }) => {
      const dx = Math.cos(b.angle) * (b.length / 2);
      const dy = Math.sin(b.angle) * (b.length / 2);
      return [
        { x: b.x - dx, y: b.y - dy },
        { x: b.x + dx, y: b.y + dy },
      ] as const;
    };
    const pointSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
      return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    };
    for (let i = 0; i < bridges.length; i += 1) {
      for (let j = i + 1; j < bridges.length; j += 1) {
        const [a1, a2] = segment(bridges[i]);
        const [b1, b2] = segment(bridges[j]);
        const distance = Math.min(
          pointSegment(a1, b1, b2),
          pointSegment(a2, b1, b2),
          pointSegment(b1, a1, a2),
          pointSegment(b2, a1, a2),
        );
        const clearance = Math.max(1.4, (bridges[i].width + bridges[j].width) * 0.75);
        if (distance < clearance) {
          throw new Error(`seed ${seed}: настилы ${bridges[i].id} и ${bridges[j].id} накладываются (${distance.toFixed(2)} кл.)`);
        }
      }
    }
  }
});

console.log('Structured generation: all checks passed.');
