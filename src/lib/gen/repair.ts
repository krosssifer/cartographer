import type { MapData } from '../types';
import { CRYPT } from '../cryptKit';
import { isWalkable, reachableFloor, validateMap, type MapReport } from './validate';

/**
 * Починка карты после генерации.
 *
 * Валидатор (`validateMap`) описывает, что именно сломано; этот модуль
 * старается исправить проблемы минимальным вмешательством, не пересоздавая
 * карту. Все правки детерминированы и идемпотентны: повторный прогон на уже
 * исправленной карте ничего не меняет.
 */

export interface RepairResult {
  map: MapData;
  actions: string[];
  report: MapReport;
}

const ADJACENT: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function repairMap(map: MapData): RepairResult {
  const actions: string[] = [];
  const terrainAt = (x: number, y: number) => map.cells[y]?.[x]?.terrain;
  const width = map.width;
  const height = map.height;

  // Карту меняем копией: исходные массивы генератора не трогаем.
  let cells = map.cells;
  let cellsChanged = false;
  const setTerrain = (x: number, y: number, terrain: NonNullable<ReturnType<typeof terrainAt>>) => {
    if (!cellsChanged) {
      cells = cells.map((row) => row.map((cell) => ({ ...cell })));
      cellsChanged = true;
    }
    cells[y][x] = { ...cells[y][x], terrain };
  };

  // 1. Объекты, оказавшиеся в воде/стене/пустоте, просто убираем.
  const badProp = (x: number, y: number) => {
    const terrain = terrainAt(Math.round(x), Math.round(y));
    return terrain === undefined || terrain === 'water' || terrain === 'deepWater' || terrain === 'wall'
      || terrain === 'void' || terrain === 'roof' || terrain === 'caveWall' || terrain === 'buildingWall';
  };
  // Ядро открытого пространства должно быть проходимым и свободным: это
  // локальная починка композиции, а не перестройка карты.
  const composition = map.plan?.composition;
  const openCore = (x: number, y: number): boolean => {
    if (!composition) return false;
    for (const space of composition.openSpaces) {
      if (space.kind !== 'battle_area' && space.kind !== 'clearing' && space.kind !== 'yard') continue;
      if (Math.hypot(space.x - x, space.y - y) <= space.radius * 0.7) return true;
    }
    return false;
  };
  const trees = map.trees.filter((tree) => !badProp(tree.x, tree.y) && !openCore(tree.x, tree.y));
  const rocks = map.rocks.filter((rock) => !badProp(rock.x, rock.y) && !openCore(rock.x, rock.y));
  if (trees.length !== map.trees.length) actions.push(`убрано деревьев вне земли: ${map.trees.length - trees.length}`);
  if (rocks.length !== map.rocks.length) actions.push(`убрано камней вне земли: ${map.rocks.length - rocks.length}`);

  // Центр боевой поляны обязан быть сухим и проходимым.
  if (composition) {
    const groundForBiome = map.biome === 'desert' ? 'sand'
      : map.biome === 'snow' ? 'snow'
      : map.biome === 'swamp' ? 'mud'
      : 'grass';
    for (const space of composition.openSpaces) {
      if (space.kind !== 'battle_area') continue;
      const cx = Math.round(space.x);
      const cy = Math.round(space.y);
      const terrain = terrainAt(cx, cy);
      if (terrain === 'water' || terrain === 'deepWater') {
        setTerrain(cx, cy, groundForBiome);
        actions.push(`боевая поляна ${space.id}: центр осушен`);
      }
    }
  }

  // 2. Дверь, которая ведёт в стену, превращаем в стену: иначе она выглядит
  //    как проход, которого нет.
  const doors: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrainAt(x, y) !== 'door') continue;
      const sides = ADJACENT.filter(([dx, dy]) => {
        const terrain = terrainAt(x + dx, y + dy);
        return terrain !== undefined && isWalkable(terrain);
      }).length;
      if (sides < 2) {
        setTerrain(x, y, 'wall');
        actions.push(`дверь ${x}:${y} замурована (прохода нет)`);
      } else {
        doors.push({ x, y });
      }
    }
  }

  // 3. Предметы склепа: убираем те, что перекрывают дверь или стоят не на полу.
  const crypt = (map.crypt ?? []).filter((item) => {
    const spec = CRYPT[item.kind];
    if (!spec?.blocks) return true;
    for (let y = item.y; y < item.y + item.h; y += 1) {
      for (let x = item.x; x < item.x + item.w; x += 1) {
        const terrain = terrainAt(x, y);
        if (terrain === 'door') {
          actions.push(`${item.kind} перекрывал дверь ${x}:${y} — убран`);
          return false;
        }
        if (terrain !== undefined && !isWalkable(terrain) && terrain !== 'wall' && terrain !== 'void') {
          actions.push(`${item.kind} стоял на ${terrain} (${x}:${y}) — убран`);
          return false;
        }
      }
    }
    return true;
  });

  // 4. Осиротевшие клетки дороги (без соседей-дорог) превращаем в утоптанную
  //    землю: одиночная полоска асфальта посреди луга выглядит как баг.
  const roadAt = (x: number, y: number) => {
    const terrain = terrainAt(x, y);
    return terrain === 'road' || terrain === 'bridge';
  };
  let orphanRoads = 0;
  if (map.road.length) {
    for (const p of map.road) {
      if (!roadAt(p.x, p.y)) continue;
      const neighbours = ADJACENT.filter(([dx, dy]) => roadAt(p.x + dx, p.y + dy)).length;
      if (neighbours === 0) {
        setTerrain(p.x, p.y, 'dirt');
        orphanRoads += 1;
      }
    }
  }
  if (orphanRoads) actions.push(`изолированных клеток дороги убрано: ${orphanRoads}`);

  // 5. Запечатанные залы: если центр зала недостижим от входа, прорубаем к нему
  //    проход от ближайшей достижимой клетки. Лучше короткий «технический»
  //    коридор, чем комната, в которую нельзя попасть.
  if ((map.biome === 'dungeon' || map.biome === 'cave') ) {
    const rooms = map.plan?.rooms ?? [];
    if (rooms.length) {
      const startPoi = (map.plan?.poi ?? []).find((poi) => poi.type === 'entrance' && isWalkable(terrainAt(poi.x, poi.y) ?? 'void'));
      const start = startPoi ? { x: startPoi.x, y: startPoi.y } : rooms[0]
        ? { x: rooms[0].bounds.x + Math.floor(rooms[0].bounds.w / 2), y: rooms[0].bounds.y + Math.floor(rooms[0].bounds.h / 2) }
        : undefined;
      if (start && isWalkable(terrainAt(start.x, start.y) ?? 'void')) {
        const seen = reachableFloor({ ...map, cells: cellsChanged ? cells : map.cells } as MapData, start);
        // Опорная клетка зала — центр рамки; у фигурных залов (Г, Т, пещера) центр
        // может быть стеной, тогда берём ближайшую к центру проходимую клетку рамки.
        // Для прямоугольных залов это всегда сам центр — поведение прежнее.
        const probe = (room: (typeof rooms)[number]) => {
          const cx = room.bounds.x + Math.floor(room.bounds.w / 2);
          const cy = room.bounds.y + Math.floor(room.bounds.h / 2);
          if (isWalkable(terrainAt(cx, cy) ?? 'void')) return { cx, cy };
          let found = { cx, cy }, bestD = Infinity;
          for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h; y += 1) for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x += 1) {
            const d = Math.abs(x - cx) + Math.abs(y - cy);
            if (d < bestD && isWalkable(terrainAt(x, y) ?? 'void')) { bestD = d; found = { cx: x, cy: y }; }
          }
          return found;
        };
        const roomsToFix = rooms.filter((room) => {
          const { cx, cy } = probe(room);
          return !seen.has(cy * width + cx);
        });
        for (const room of roomsToFix) {
          const { cx, cy } = probe(room);
          // Ближайшая достижимая клетка — по манхэттену, детерминированно.
          let best: { x: number; y: number } | undefined;
          let bestDistance = Infinity;
          for (let i = 0; i < width * height; i += 1) {
            if (!seen.has(i)) continue;
            const x = i % width;
            const y = Math.floor(i / width);
            const distance = Math.abs(x - cx) + Math.abs(y - cy);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = { x, y };
            }
          }
          if (!best) continue;
          // Г-образный проход: сначала по X, затем по Y.
          let x = cx;
          let y = cy;
          while (x !== best.x) {
            if (!isWalkable(terrainAt(x, y) ?? 'void')) setTerrain(x, y, 'floor');
            x += Math.sign(best.x - x);
          }
          while (y !== best.y) {
            if (!isWalkable(terrainAt(x, y) ?? 'void')) setTerrain(x, y, 'floor');
            y += Math.sign(best.y - y);
          }
          if (!isWalkable(terrainAt(x, y) ?? 'void')) setTerrain(x, y, 'floor');
          actions.push(`зал ${room.id} был отрезан — прорублен проход (${bestDistance} клеток)`);
        }
      }
    }
  }

  const repaired: MapData = {
    ...map,
    cells: cellsChanged ? cells : map.cells,
    trees,
    rocks,
    crypt,
  };

  const report = validateMap(repaired, { strictConnectivity: repaired.biome === 'cave' || repaired.biome === 'dungeon' });
  return { map: repaired, actions, report };
}
