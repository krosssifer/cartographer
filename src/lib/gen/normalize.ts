import type { GenSettings, MapData, Terrain } from '../types';

/** Базовый грунт биома — во что превращать случайный мусор. */
function baseGround(settings: GenSettings): Terrain {
  switch (settings.biome) {
    case 'desert':
      return 'sand';
    case 'snow':
      return 'snow';
    case 'swamp':
      return 'mud';
    case 'cave':
    case 'dungeon':
      return 'caveFloor';
    default:
      return 'grass';
  }
}

/** Собирает компоненты связности клеток, подходящих под match (4-связность). */
function components(map: MapData, match: (terrain: Terrain) => boolean): number[][] {
  const { width, height } = map;
  const seen = new Uint8Array(width * height);
  const result: number[][] = [];
  const stack: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (seen[start] || !match(map.cells[y][x].terrain)) continue;
      const cells: number[] = [];
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const index = stack.pop()!;
        cells.push(index);
        const cx = index % width;
        const cy = (index - cx) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !match(map.cells[ny][nx].terrain)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      result.push(cells);
    }
  }
  return result;
}

/**
 * Нормализация террейна: убирает визуальный «мусор», который читается как баг.
 * - оставляет только крупные водоёмы (лужи-одиночки превращаются в грунт/грязь);
 * - мост без воды под ним снова становится дорогой;
 * - одиночные пятна утоптанной земли вдали от дорог и воды убираются;
 * - дорога, оторванная от основной сети, тоже убирается.
 * Функция детерминирована и меняет только клетки, не трогая plan.
 */
export function normalizeTerrain(source: MapData, settings: GenSettings): MapData {
  // Копируем клетки: генератор поселений кэширует план с общим массивом cells,
  // и мутация исходного массива ломала детерминизм следующей генерации.
  const map: MapData = { ...source, cells: source.cells.map((row) => row.map((cell) => ({ ...cell }))) };
  const ground = baseGround(settings);
  const isWater = (terrain: Terrain): boolean => terrain === 'water' || terrain === 'deepWater';
  const isRoad = (terrain: Terrain): boolean => terrain === 'road' || terrain === 'bridge';

  // Клетки, отмеченные в плане как переправа: вода под ними неприкосновенна,
  // иначе нормализация осушит пруд и мост останется без реки.
  const bridgeCells = new Set<number>();
  for (const bridge of source.plan?.bridges ?? []) {
    for (const cell of bridge.cells) bridgeCells.add(cell.y * source.width + cell.x);
  }
  const bridgeNeighbourhood = new Set<number>();
  for (const cell of bridgeCells) {
    const x = cell % source.width;
    const y = (cell - x) / source.width;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= source.width || ny >= source.height) continue;
        bridgeNeighbourhood.add(ny * source.width + nx);
      }
    }
  }

  // 1) Вода: остаются крупные водоёмы и водоёмы С ПРИЧИНОЙ.
  // Причина — это либо переправа (мост пересекает водоём), либо родник/пруд у
  // массива леса и у метки-ориентира из композиции. Остальные лужи затягиваем
  // грунтом: безымянные пятна воды — визуальный шум.
  const composition = source.plan?.composition;
  const reasonedWater = (cell: number): boolean => {
    if (!composition) return false;
    const x = cell % map.width;
    const y = (cell - x) / map.width;
    for (const mass of composition.masses) {
      if (Math.hypot(mass.x - x, mass.y - y) <= mass.radius * 0.8) return true;
    }
    for (const space of composition.openSpaces) {
      if (space.kind !== 'landmark' && space.kind !== 'clearing') continue;
      if (Math.hypot(space.x - x, space.y - y) <= space.radius + 1.5) return true;
    }
    return false;
  };
  const waterParts = components(map, isWater).sort((a, b) => b.length - a.length);
  const keepWater = new Set<number>();
  for (let index = 0; index < waterParts.length; index += 1) {
    const part = waterParts[index];
    // Водоём сохраняем, если мост пересекает его берега рядом (в пределах 2 клеток),
    // даже когда сам настил полностью накрывает узкую протоку.
    const underBridge = part.some((cell) => bridgeCells.has(cell) || bridgeNeighbourhood.has(cell));
    const spring = part.length >= 4 && part.some((cell) => reasonedWater(cell));
    if (index === 0 || part.length >= 40 || underBridge || spring) part.forEach((cell) => keepWater.add(cell));
  }
  const replaceWater = settings.biome === 'swamp' ? 'mud' : ground;
  for (const part of waterParts) {
    for (const cell of part) {
      if (keepWater.has(cell)) continue;
      const x = cell % map.width;
      const y = (cell - x) / map.width;
      map.cells[y][x] = { ...map.cells[y][x], terrain: replaceWater };
    }
  }

  // 2) Мост без воды рядом — это просто дорога.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.cells[y][x].terrain !== 'bridge') continue;
      // Настил из плана — это спроектированная переправа: его не «разжаловаем»
      // в дорогу, даже если вода полностью накрыта настилом.
      if (bridgeCells.has(y * map.width + x)) continue;
      let wet = false;
      // Настил может примыкать к другому настилу (сложная переправа): такой
      // мост валиден, даже если вода формально дальше двух клеток.
      for (let dy = -2; dy <= 2 && !wet; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const terrain = map.cells[y + dy]?.[x + dx]?.terrain;
          if (terrain && (isWater(terrain) || terrain === 'bridge')) {
            if (terrain === 'bridge' && dx === 0 && dy === 0) continue;
            wet = true;
            break;
          }
        }
      }
      if (!wet) map.cells[y][x] = { ...map.cells[y][x], terrain: 'road' };
    }
  }

  // Клетки, которые планировщик дорог намеренно проложил (включая короткие
  // тропы к дворам/концам ответвлений): их нельзя «отрывать» как фрагменты,
  // иначе благоустроенный конец пути исчезает из-за локальной проверки.
  const plannedPaths = new Set<number>();
  for (const path of source.plan?.roads ?? []) {
    for (const point of path.points) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = point.x + dx;
          const ny = point.y + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          plannedPaths.add(ny * map.width + nx);
        }
      }
    }
  }

  // 3) Дорога: убираем оторванные фрагменты (оставляем самую большую сеть).
  const roadParts = components(map, isRoad).sort((a, b) => b.length - a.length);
  for (let index = 1; index < roadParts.length; index += 1) {
    const part = roadParts[index];
    // Фрагмент, который планировщик специально проложил, оставляем полотном.
    if (part.some((cell) => plannedPaths.has(cell))) continue;
    for (const cell of part) {
      const x = cell % map.width;
      const y = (cell - x) / map.width;
      map.cells[y][x] = { ...map.cells[y][x], terrain: 'dirt' };
    }
  }

  // 4) Пятна утоптанной земли: мелкие (до 6 клеток) и без дороги/воды рядом — грунт.
  const dirtParts = components(map, (terrain) => terrain === 'dirt' || terrain === 'mud');
  for (const part of dirtParts) {
    if (part.length > 6) continue;
    let touchesRoad = false;
    let touchesWater = false;
    for (const cell of part) {
      const x = cell % map.width;
      const y = (cell - x) / map.width;
      // Радиус 2: обочина может лежать через одну клетку от полотна.
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const terrain = map.cells[y + dy]?.[x + dx]?.terrain;
          if (!terrain) continue;
          if (isRoad(terrain)) touchesRoad = true;
          if (isWater(terrain)) touchesWater = true;
        }
      }
    }
    if (touchesRoad || touchesWater) continue;
    for (const cell of part) {
      const x = cell % map.width;
      const y = (cell - x) / map.width;
      map.cells[y][x] = { ...map.cells[y][x], terrain: ground };
    }
  }

  // 5) Песчаный пояс у воды убираем в зелёных биомах: на боевых картах берег —
  // это просто кромка воды, а не широкая полоса песка с клеточной лестницей.
  if (settings.biome === 'forest' || settings.biome === 'plains' || settings.biome === 'village' || settings.biome === 'town') {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const terrain = map.cells[y][x].terrain;
        if (terrain !== 'sand' && terrain !== 'dirt') continue;
        let wet = false;
        for (let dy = -1; dy <= 1 && !wet; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (isWater(map.cells[y + dy]?.[x + dx]?.terrain as Terrain)) {
              wet = true;
              break;
            }
          }
        }
        if (!wet) continue;
        const hash = (x * 73856093) ^ (y * 19349663);
        map.cells[y][x] = { ...map.cells[y][x], terrain: Math.abs(hash) % 3 === 0 ? 'darkGrass' : 'grass' };
      }
    }
  }

  return map;
}
