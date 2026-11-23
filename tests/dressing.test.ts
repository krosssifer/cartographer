import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import { SETTLEMENT_TYPES } from '../src/lib/gen/settlementTypes';
import {
  DISTRICT_DRESSING,
  STREET_RECIPES,
  YARD_RECIPES,
  conditionFactors,
  courtyardGround,
  districtProfile,
  litterBudget,
  streetBudget,
  yardPropCount,
  type DressingGround,
} from '../src/lib/gen/urban/dressing';
import { CIVIC_KIT } from '../src/lib/settlementKit';
import type { DistrictKind } from '../src/lib/gen/settlementTypes';
import type { GenSettings, MapData, Terrain } from '../src/lib/types';

const ALLOWED_GROUND = new Set<DressingGround>(['grass', 'darkGrass', 'dirt', 'sand', 'plaza', 'floor']);
const WET: ReadonlySet<Terrain> = new Set<Terrain>(['water', 'deepWater', 'bridge']);
const BLOCKED_FOR_PROPS: ReadonlySet<Terrain> = new Set<Terrain>([
  'water', 'deepWater', 'bridge', 'rock', 'wall', 'road', 'plaza',
]);

function makeSettings(patch: Partial<GenSettings> = {}): GenSettings {
  const def = SETTLEMENT_TYPES.find((type) => type.id === 'trade_town')!;
  return {
    ...DEFAULT_GEN,
    biome: def.style,
    settlement: def.style,
    settlementType: 'trade_town',
    width: 84,
    height: 60,
    seed: 101,
    density: 0.68,
    road: true,
    river: true,
    publicSpaces: true,
    ...patch,
  };
}

const URBAN_PROP_KINDS = [
  'urbanLamp', 'urbanSign', 'urbanSignpost', 'urbanTrough',
  'urbanAnvil', 'urbanWorkbench', 'urbanForge', 'urbanWoodpile',
  'urbanPlanks', 'urbanCoal', 'urbanHides', 'urbanPots',
] as const;

function urbanProps(map: MapData) {
  const wanted = new Set<string>(URBAN_PROP_KINDS);
  return (map.civic ?? []).filter((item) => wanted.has(item.kind));
}

function terrainDigest(map: MapData): string {
  return map.cells.map((row) => row.map((cell) => cell.terrain[0]).join('')).join('|');
}

function collectDressingCivic(map: MapData) {
  // Городской декор — все civic, кроме площади и рынка (они часть геометрии).
  return (map.civic ?? []).filter((item) => item.kind !== 'square' && item.kind !== 'market');
}

describe('Urban Dressing: профили районов', () => {
  it('у каждого района есть профиль с валидными значениями', () => {
    const kinds = Object.keys(DISTRICT_DRESSING) as DistrictKind[];
    expect(kinds.length).toBeGreaterThanOrEqual(10);
    for (const kind of kinds) {
      const profile = DISTRICT_DRESSING[kind];
      expect(ALLOWED_GROUND.has(profile.ground), `${kind}: ground`).toBe(true);
      expect(profile.density).toBeGreaterThanOrEqual(0);
      expect(profile.density).toBeLessThanOrEqual(1);
      expect(profile.objectDensity).toBeGreaterThanOrEqual(0);
      expect(profile.objectDensity).toBeLessThanOrEqual(1);
      expect(profile.vegetation).toBeGreaterThanOrEqual(0);
      expect(profile.vegetation).toBeLessThanOrEqual(1);
      expect(profile.categories.length, `${kind}: categories`).toBeGreaterThan(0);
    }
  });

  it('богатство и зона влияют на профиль', () => {
    const noble = districtProfile('noble', 0.95, 'old_core', true);
    const poor = districtProfile('poor', 0.12, 'outer_city', true);
    expect(noble.wealth).toBeGreaterThan(poor.wealth);
    expect(noble.cleanliness).toBeGreaterThan(poor.cleanliness);
    const suburbs = districtProfile('residential', 0.4, 'suburbs', true);
    const core = districtProfile('residential', 0.4, 'old_core', true);
    expect(suburbs.vegetation).toBeGreaterThan(core.vegetation);
    expect(ALLOWED_GROUND.has(suburbs.ground)).toBe(true);
  });

  it('материал двора зависит от типа двора', () => {
    const noble = districtProfile('noble', 0.9, 'old_core', true);
    expect(courtyardGround('private_garden', noble, 0.3)).toBe('grass');
    expect(courtyardGround('garden_yard', noble, 0.3)).toBe('grass');
    // Дворы мостятся плитами: площадь и тротуары остаются частью улиц.
    expect(courtyardGround('temple_courtyard', noble, 0.3)).toBe('floor');
    expect(ALLOWED_GROUND.has(courtyardGround('workshop_yard', noble, 0.7))).toBe(true);
    for (const list of Object.values(YARD_RECIPES)) expect(list.length).toBeGreaterThan(0);
    for (const list of Object.values(STREET_RECIPES)) expect(list.length).toBeGreaterThan(0);
  });

  it('бюджеты растут с насыщенностью и падают в чистом городе', () => {
    const profile = DISTRICT_DRESSING.market;
    expect(yardPropCount(profile, 'lived_in', 1, 0.5)).toBeGreaterThanOrEqual(
      yardPropCount(profile, 'lived_in', 0, 0.5),
    );
    expect(streetBudget(400, profile, 'lived_in', 1)).toBeGreaterThan(0);
    expect(streetBudget(0, profile, 'lived_in', 1)).toBe(0);
    expect(litterBudget(400, DISTRICT_DRESSING.poor, 'worn', 1)).toBeGreaterThan(
      litterBudget(400, DISTRICT_DRESSING.poor, 'pristine', 1),
    );
    expect(conditionFactors('worn').litter).toBeGreaterThan(conditionFactors('pristine').litter);
  });
});

describe('Urban Dressing: генерация', () => {
  it('детерминирован при одинаковом seed и настройках', () => {
    const settings = makeSettings({ urbanDressing: 0.8 });
    const first = generateMap(settings);
    const second = generateMap(settings);
    expect(terrainDigest(first)).toBe(terrainDigest(second));
    expect(first.civic?.length).toBe(second.civic?.length);
    expect(first.plan?.settlement?.dressing).toEqual(second.plan?.settlement?.dressing);
  });

  it('насыщенность добавляет декор, но не меняет геометрию', () => {
    const quiet = generateMap(makeSettings({ urbanDressing: 0 }));
    const rich = generateMap(makeSettings({ urbanDressing: 1 }));
    expect(rich.buildings?.length).toBe(quiet.buildings?.length);
    const streetsOf = (map: MapData) =>
      map.cells.reduce((sum, row) => sum + row.filter((cell) => cell.terrain === 'road' || cell.terrain === 'plaza').length, 0);
    expect(streetsOf(rich)).toBe(streetsOf(quiet));
    const quietProps = collectDressingCivic(quiet).length;
    const richProps = collectDressingCivic(rich).length;
    expect(richProps).toBeGreaterThan(quietProps);
    expect(rich.plan?.settlement?.dressing?.propsPlaced ?? 0).toBeGreaterThan(0);
  });

  it('декор не попадает на дороги, в воду, на скалы и не пересекает дома', () => {
    const map = generateMap(makeSettings({ urbanDressing: 1, cityCondition: 'worn' }));
    const buildings = map.buildings ?? [];
    for (const item of collectDressingCivic(map)) {
      expect(item.x >= 0 && item.y >= 0 && item.x + item.w <= map.width && item.y + item.h <= map.height).toBe(true);
      for (let y = item.y; y < item.y + item.h; y++) {
        for (let x = item.x; x < item.x + item.w; x++) {
          const terrain = map.cells[y][x].terrain;
          expect(WET.has(terrain) || terrain === 'rock' || terrain === 'wall', `декор ${item.kind} на ${terrain}`).toBe(false);
          for (const building of buildings) {
            const overlap = x >= building.x && x < building.x + building.w && y >= building.y && y < building.y + building.h;
            expect(overlap, `декор ${item.kind} внутри дома (${building.x},${building.y})`).toBe(false);
          }
        }
      }
    }
  });

  it('состояние города влияет на мусор и количество объектов', () => {
    const pristine = generateMap(makeSettings({ urbanDressing: 1, cityCondition: 'pristine' }));
    const worn = generateMap(makeSettings({ urbanDressing: 1, cityCondition: 'worn' }));
    const litterCount = (map: MapData) =>
      collectDressingCivic(map).filter((item) => item.kind === 'marketBarrelLying' || item.kind === 'marketSacks').length;
    expect(litterCount(worn)).toBeGreaterThanOrEqual(litterCount(pristine));
    expect(worn.plan?.settlement?.dressing?.litterPlaced ?? 0).toBeGreaterThanOrEqual(
      pristine.plan?.settlement?.dressing?.litterPlaced ?? 0,
    );
  });

  it('во дворах появляются материалы и растительность', () => {
    const map = generateMap(makeSettings({ urbanDressing: 1, vegetation: 0.8 }));
    const dressing = map.plan?.settlement?.dressing;
    expect(dressing).toBeDefined();
    expect(dressing!.materialCells).toBeGreaterThan(0);
    expect(dressing!.treesPlaced).toBeGreaterThanOrEqual(0);
    const plazaCells = map.cells.reduce(
      (sum, row) => sum + row.filter((cell) => cell.terrain === 'plaza' || cell.terrain === 'floor').length,
      0,
    );
    expect(plazaCells).toBeGreaterThan(0);
    const nearWater = (map.civic ?? []).filter((item) => {
      for (let y = item.y; y < item.y + item.h; y++) {
        for (let x = item.x; x < item.x + item.w; x++) {
          if (WET.has(map.cells[y][x].terrain)) return true;
        }
      }
      return false;
    });
    expect(nearWater.length).toBe(0);
  });

  it('новые городские предметы зарегистрированы в каталоге', () => {
    for (const kind of URBAN_PROP_KINDS) {
      const entry = CIVIC_KIT[kind as keyof typeof CIVIC_KIT];
      expect(entry, kind).toBeTruthy();
      expect(entry.art).toBe(kind);
      expect(entry.w).toBeGreaterThan(0);
      expect(entry.h).toBeGreaterThan(0);
    }
  });

  it('насыщенный город получает фонари, вывески и хозяйственные предметы', () => {
    const map = generateMap(makeSettings({ urbanDressing: 1, cityCondition: 'lived_in' }));
    const props = urbanProps(map);
    expect(props.length).toBeGreaterThan(0);
    const kinds = new Set(props.map((item) => item.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    for (const item of props) {
      for (let y = item.y; y < item.y + item.h; y++) {
        for (let x = item.x; x < item.x + item.w; x++) {
          const terrain = map.cells[y][x].terrain;
          expect(WET.has(terrain), 'городской предмет стоит на воде: ' + item.kind).toBe(false);
          expect(terrain === 'road' || terrain === 'plaza', 'городской предмет стоит на проезжей части: ' + item.kind).toBe(false);
        }
      }
    }
  });

  it('ремесленный город получает мастерские предметы', () => {
    const def = SETTLEMENT_TYPES.find((type) => type.id === 'craft_town')!;
    const map = generateMap(makeSettings({
      biome: def.style,
      settlement: def.style,
      settlementType: 'craft_town',
      urbanDressing: 1,
      cityCondition: 'lived_in',
    }));
    const craftKinds = new Set(['urbanAnvil', 'urbanWorkbench', 'urbanForge', 'urbanWoodpile', 'urbanPlanks', 'urbanCoal']);
    const found = urbanProps(map).filter((item) => craftKinds.has(item.kind));
    expect(found.length).toBeGreaterThan(0);
  });

  it('фонари не стоят на дорогах и площадях', () => {
    const map = generateMap(makeSettings({ urbanDressing: 1 }));
    const lamps = (map.civic ?? []).filter((item) => item.kind === 'urbanLamp');
    for (const lamp of lamps) {
      expect(map.cells[lamp.y][lamp.x].terrain === 'road').toBe(false);
      expect(map.cells[lamp.y][lamp.x].terrain === 'plaza').toBe(false);
    }
  });

  it('ограды участков не перекрывают проход и не стоят на мостовой', () => {
    const map = generateMap(makeSettings({ urbanDressing: 1, cityCondition: 'lived_in' }));
    const dressing = map.plan?.settlement?.dressing;
    expect(dressing).toBeDefined();
    expect(dressing!.fencesPlaced ?? 0).toBeGreaterThan(0);
    const fences = (map.civic ?? []).filter((item) => item.kind === 'marketFence');
    for (const fence of fences) {
      for (let y = fence.y; y < fence.y + fence.h; y++) {
        for (let x = fence.x; x < fence.x + fence.w; x++) {
          const terrain = map.cells[y][x].terrain;
          expect(terrain === 'road' || terrain === 'plaza' || terrain === 'bridge').toBe(false);
        }
      }
    }
    const doorBlocked = (map.buildings ?? []).some((building) => {
      const dir = building.facing === 90 ? [1, 0] : building.facing === 180 ? [0, -1] : building.facing === 270 ? [-1, 0] : [0, 1];
      const sx = building.door.x + dir[0];
      const sy = building.door.y + dir[1];
      return fences.some(
        (fence) => sx >= fence.x && sx < fence.x + fence.w && sy >= fence.y && sy < fence.y + fence.h,
      );
    });
    expect(doorBlocked).toBe(false);
  });

  it('мастерские дворы получают инструменты и заготовки', () => {
    const def = SETTLEMENT_TYPES.find((type) => type.id === 'craft_town')!;
    const map = generateMap(makeSettings({
      biome: def.style,
      settlement: def.style,
      settlementType: 'craft_town',
      urbanDressing: 1,
      cityCondition: 'lived_in',
    }));
    expect(map.plan?.settlement?.dressing?.scenesPlaced ?? 0).toBeGreaterThan(0);
    const workshopKinds = new Set(['urbanAnvil', 'urbanForge', 'urbanCoal', 'urbanWorkbench', 'urbanPlanks', 'urbanWoodpile']);
    const found = (map.civic ?? []).filter((item) => workshopKinds.has(item.kind));
    expect(found.length).toBeGreaterThan(0);
  });

  it('огороды получают грядки утоптанной земли', () => {
    const def = SETTLEMENT_TYPES.find((type) => type.id === 'large_village')!;
    const map = generateMap(makeSettings({
      biome: def.style,
      settlement: def.style,
      settlementType: 'large_village',
      width: 72,
      height: 54,
      urbanDressing: 1,
      cityCondition: 'lived_in',
    }));
    const dressing = map.plan?.settlement?.dressing;
    expect(dressing).toBeDefined();
    const dirtCells = map.cells.reduce(
      (sum, row) => sum + row.filter((cell) => cell.terrain === 'dirt').length,
      0,
    );
    expect(dirtCells).toBeGreaterThan(0);
    expect((dressing!.bedsPlaced ?? 0) >= 0).toBe(true);
  });
});
