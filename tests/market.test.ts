import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN, DEFAULT_RENDER } from '../src/lib/presets';
import { parseProject } from '../src/lib/project';
import { settlementMarket } from '../src/lib/settlement';
import { CIVIC_KIT } from '../src/lib/settlementKit';
import { spriteLook } from '../src/lib/spriteLook';
import {
  MARKET_ARCHETYPES,
  MARKET_ARCHETYPE_IDS,
  MARKET_ARCHETYPE_OPTIONS,
  MARKET_SPECIALITIES,
  isMarketArchetypeSetting,
  modernMarket,
  resolveMarketArchetype,
} from '../src/lib/gen/marketArchetypes';
import { FACING_ROTATION, LANE, type MarketOutcome } from '../src/lib/gen/marketLayout';
import type { GenSettings } from '../src/lib/types';

const WET = new Set(['water', 'deepWater']);

const settlement = (style: 'village' | 'town', patch: Partial<GenSettings> = {}): GenSettings => ({
  ...DEFAULT_GEN, biome: style, settlement: style, density: .8, river: true, road: true, publicSpaces: true, ...patch,
});

/** Независимая проверка плана поверх validateMarket: границы, наложения, проходы, центр. */
function checkPlan(out: MarketOutcome, where: string) {
  const { plan, validation, report } = out;
  expect(validation.issues, where).toEqual([]);
  expect(report.valid, where).toBe(true);
  const W = plan.width;
  const taken = new Map<number, string>();
  for (const it of plan.items) for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) {
    const i = y * W + x;
    expect(plan.area[i], `${where}: ${it.kind} вне площади (${x},${y})`).toBe(1);
    expect(taken.get(i), `${where}: наложение ${it.kind} на ${taken.get(i)} (${x},${y})`).toBeUndefined();
    taken.set(i, it.kind);
    // Предметы не стоят на главных проходах, входах и в свободной зоне центра.
    const code = plan.lanes[i];
    if (it.role !== 'centre') expect([LANE.main, LANE.entry, LANE.centre, LANE.open].includes(code as never), `${where}: ${it.kind} на проходе ${code}`).toBe(false);
  }
  expect(plan.entrances.length, where).toBeGreaterThanOrEqual(1);
  expect(validation.checks.entrances, where).toBe(true);
  expect(validation.checks.access, where).toBe(true);
}

describe('market archetypes: registry', () => {
  it('six archetypes with unique ids, existing sprites and valid fallbacks', () => {
    expect(MARKET_ARCHETYPE_IDS).toEqual(['village', 'city', 'port', 'caravan', 'bazaar', 'fair']);
    expect(new Set(MARKET_ARCHETYPE_IDS).size).toBe(MARKET_ARCHETYPE_IDS.length);
    for (const a of MARKET_ARCHETYPES) {
      expect(MARKET_ARCHETYPE_IDS).toContain(a.fallback);
      expect(a.fallback).not.toBe(a.id);
      for (const spec of Object.keys(a.specialities)) expect(MARKET_SPECIALITIES[spec as keyof typeof MARKET_SPECIALITIES], `${a.id}: ${spec}`).toBeDefined();
      expect(a.entrances[0]).toBeLessThanOrEqual(a.entrances[1]);
    }
    for (const spec of Object.values(MARKET_SPECIALITIES)) {
      for (const kind of [...spec.stalls, ...spec.stock22, ...spec.stock21, ...spec.stock11]) expect(CIVIC_KIT[kind], `${spec.id}: ${kind}`).toBeDefined();
    }
    expect(MARKET_ARCHETYPE_OPTIONS.map((o) => o.id)).toEqual(['auto', ...MARKET_ARCHETYPE_IDS, 'classic']);
    expect(MARKET_ARCHETYPE_OPTIONS.map((o) => o.label).slice(0, 7)).toEqual(['Автоматически', 'Деревенский', 'Городской', 'Портовый', 'Караванный', 'Крытый базар', 'Ярмарка']);
  });

  it('settings: classic and absent keep the old market, auto and ids enable the new one', () => {
    expect(modernMarket(undefined)).toBe(false);
    expect(modernMarket('classic')).toBe(false);
    expect(modernMarket('auto')).toBe(true);
    for (const id of MARKET_ARCHETYPE_IDS) expect(modernMarket(id)).toBe(true);
    expect(isMarketArchetypeSetting('mall')).toBe(false);
  });

  it('fallback chain: incompatible choices are replaced deterministically', () => {
    const base = { width: 60, height: 44, seed: 3 };
    const bazaarVillage = resolveMarketArchetype('bazaar', { ...base, style: 'village', water: 'none' });
    expect(bazaarVillage.archetype.id).toBe('village');
    expect(bazaarVillage.requested).toBe('bazaar');
    expect(bazaarVillage.chain).toEqual(['bazaar', 'city', 'village']);
    const dryPort = resolveMarketArchetype('port', { ...base, style: 'town', water: 'none' });
    expect(dryPort.archetype.id).toBe('city');
    expect(dryPort.reason).toContain('нет воды');
    const wetPort = resolveMarketArchetype('port', { ...base, style: 'town', water: 'river' });
    expect(wetPort.archetype.id).toBe('port');
    expect(wetPort.requested).toBeUndefined();
    // Авто: город — городской/портовый/базар…, деревня — деревенский/ярмарка…
    const autoTown = resolveMarketArchetype('auto', { ...base, style: 'town', water: 'none' });
    expect(['city', 'bazaar', 'caravan', 'fair']).toContain(autoTown.archetype.id);
    expect(resolveMarketArchetype('auto', { ...base, style: 'town', water: 'coast' }).archetype.id).toMatch(/port|city/);
    expect(resolveMarketArchetype('auto', { ...base, style: 'village', water: 'none' })).toEqual(resolveMarketArchetype('auto', { ...base, style: 'village', water: 'none' }));
  });

  it('render guard: market sprites are drawn with flipY, so a front facing south is 180°', () => {
    // FACING_ROTATION опирается на постоянную «внешность» спрайтов рынка в settlementPaint.civic.
    expect(spriteLook(7.3, 2.9, 47).flipY).toBe(true);
    expect(FACING_ROTATION[2]).toBe(180);
    expect(FACING_ROTATION[0]).toBe(0);
  });
});

describe('market plans: every archetype, every case', () => {
  // Малая и большая деревня, малый и большой город; с рекой и без; бедный и богатый рынок.
  const cases: [string, GenSettings][] = [
    ['small village', settlement('village', { width: 36, height: 28, seed: 11 })],
    ['large village', settlement('village', { width: 80, height: 60, seed: 12, river: false })],
    ['small town', settlement('town', { width: 48, height: 34, seed: 13 })],
    ['large town', settlement('town', { width: 100, height: 80, seed: 14, river: false })],
  ];
  for (const id of MARKET_ARCHETYPE_IDS) {
    it(`${id}: valid plan, objects of the archetype, low and high richness`, () => {
      for (const [name, base] of cases) for (const richness of [.15, 1]) {
        const out = settlementMarket({ ...base, marketArchetype: id, marketRichness: richness });
        const where = `${id} / ${name} / ${richness}`;
        expect(out, where).toBeDefined();
        checkPlan(out!, where);
        // Заменённый архетип объявлен в отчёте вместе с цепочкой.
        if (out!.report.archetype !== id) expect(out!.report.requested, where).toBe(id);
        const archetype = MARKET_ARCHETYPES.find((a) => a.id === out!.report.archetype)!;
        for (const spec of Object.keys(out!.report.specialities)) expect(archetype.specialities[spec as keyof typeof archetype.specialities], `${where}: ${spec}`).toBeGreaterThan(0);
        // Площадь соразмерна карте.
        expect(out!.plan.bounds.w * out!.plan.bounds.h, where).toBeLessThanOrEqual(base.width * base.height * .2);
      }
    });
  }

  it('skeleton is stable across richness: centre, entrances, aisles and skeleton stalls do not move', () => {
    for (const id of MARKET_ARCHETYPE_IDS) {
      const base = settlement('town', { width: 60, height: 44, seed: 1337, marketArchetype: id });
      const poor = settlementMarket({ ...base, marketRichness: .3 })!;
      const rich = settlementMarket({ ...base, marketRichness: .9 })!;
      const none = settlementMarket({ ...base, marketRichness: 0 })!;
      expect(rich.plan.centre).toEqual(poor.plan.centre);
      expect(rich.plan.entrances).toEqual(poor.plan.entrances);
      expect(Array.from(rich.plan.lanes)).toEqual(Array.from(poor.plan.lanes));
      const key = (it: { kind: string; x: number; y: number }) => `${it.kind}@${it.x},${it.y}`;
      const richItems = new Set(rich.plan.items.map(key));
      for (const it of poor.plan.items) expect(richItems.has(key(it)), `${id}: ${key(it)} пропал при большей насыщенности`).toBe(true);
      expect(rich.plan.items.length).toBeGreaterThan(poor.plan.items.length);
      // Скелет — при нулевой насыщенности: центр и основные места.
      const skeleton = none.plan.clusters.filter((c) => c.skeleton).length;
      expect(skeleton, id).toBeGreaterThanOrEqual(2);
      expect(new Set(none.plan.items.map((it) => it.cluster)).size, id).toBeGreaterThanOrEqual(skeleton);
    }
  });

  it('deterministic for a seed; different seeds and archetypes give different compositions', () => {
    const base = settlement('town', { width: 60, height: 44, seed: 77 });
    const signature = (out: MarketOutcome | undefined) => JSON.stringify(out?.plan.clusters.map((c) => [c.speciality, c.rect.x, c.rect.y, c.rect.w, c.rect.h]));
    for (const id of MARKET_ARCHETYPE_IDS) {
      const a = generateMap({ ...base, marketArchetype: id });
      const b = generateMap({ ...base, marketArchetype: id });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    const city = [1, 2, 3, 4].map((seed) => signature(settlementMarket({ ...base, seed, marketArchetype: 'city' })));
    expect(new Set(city).size).toBe(4);
    const byArchetype = MARKET_ARCHETYPE_IDS.map((id) => settlementMarket({ ...base, marketArchetype: id })!);
    expect(new Set(byArchetype.map((o) => signature(o))).size).toBe(MARKET_ARCHETYPE_IDS.length);
    // Архетипы различаются составом, а не только расстановкой.
    const mix = byArchetype.map((o) => Object.keys(o.report.specialities).sort().join(','));
    expect(new Set(mix).size).toBeGreaterThanOrEqual(5);
  });

  it('port: oriented to the water, nothing in water, cargo on the quay; without water it falls back', () => {
    const river = settlement('town', { width: 60, height: 44, seed: 1337, river: true, marketArchetype: 'port' });
    const out = settlementMarket(river)!;
    checkPlan(out, 'port river');
    expect(out.report.archetype).toBe('port');
    expect(out.plan.shore).toBeDefined();
    const map = generateMap(river);
    for (const item of map.civic ?? []) for (let y = item.y; y < item.y + item.h; y++) for (let x = item.x; x < item.x + item.w; x++) {
      expect(WET.has(map.cells[y][x].terrain), `${item.kind} в воде (${x},${y})`).toBe(false);
    }
    expect(out.report.specialities.fish ?? 0).toBeGreaterThanOrEqual(1);
    const dry = settlementMarket({ ...river, river: false })!;
    expect(dry.report.archetype).toBe('city');
    expect(dry.report.requested).toBe('port');
  });

  it('flat dry site: the market avoids water and steep ground', () => {
    for (const id of MARKET_ARCHETYPE_IDS) {
      const base = settlement('town', { width: 60, height: 44, seed: 5, marketArchetype: id });
      const out = settlementMarket(base)!;
      const map = generateMap(base);
      const { bounds } = out.plan;
      let lo = 1, hi = 0;
      for (let y = bounds.y; y < bounds.y + bounds.h; y++) for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        if (!out.plan.area[y * map.width + x]) continue;
        expect(WET.has(map.cells[y][x].terrain), `${id}: вода на рынке`).toBe(false);
        lo = Math.min(lo, map.cells[y][x].height); hi = Math.max(hi, map.cells[y][x].height);
      }
      expect(hi - lo, `${id}: перепад высот`).toBeLessThanOrEqual(.3);
    }
  });

  it('houses on the square face it; the frontage follows the archetype', () => {
    const configs: Partial<GenSettings>[] = [
      { biome: 'town', settlement: 'town', width: 90, height: 70, marketArchetype: 'bazaar' },
      { biome: 'town', settlement: 'town', width: 64, height: 48, settlementType: 'trade_town', marketArchetype: 'bazaar' },
      { biome: 'town', settlement: 'town', width: 64, height: 48, settlementType: 'craft_town', marketArchetype: 'city' },
      { biome: 'town', settlement: 'town', width: 90, height: 70, settlementType: 'large_city', marketArchetype: 'city' },
    ];
    const kinds: string[] = [];
    for (const patch of configs) {
      const base = settlement('town', { seed: 1337, density: 1, ...patch });
      const map = generateMap(base);
      const out = settlementMarket(base)!;
      const W = map.width;
      const near = (x: number, y: number, reach: number) => {
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= reach && out.plan.area[(y + dy) * W + x + dx] === 1) return true;
        }
        return false;
      };
      for (const b of map.buildings ?? []) {
        const step = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[b.facing ?? 0]!;
        const x = b.door.x + step[0], y = b.door.y + step[1];
        // Двери не упираются в предметы рынка.
        expect((map.civic ?? []).some((c) => c.kind !== 'square' && x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h), `дверь ${b.kind} в предмет`).toBe(false);
        if (b.kind !== 'tavern' && b.kind !== 'tower' && near(x, y, 3)) kinds.push(b.kind);
      }
    }
    expect(kinds.length).toBeGreaterThanOrEqual(6);
    // Базар и городской рынок окружены лавками и залами, а не жилыми домами.
    expect(kinds.filter((k) => k === 'shop' || k === 'hall').length / kinds.length).toBeGreaterThan(.6);
  });

  it('typed settlements: market sits inside the plan and stays valid', () => {
    const types = ['large_village', 'trade_town', 'fortified_town', 'large_city', 'port'];
    for (const settlementType of types) {
      const style = settlementType === 'large_village' ? 'village' : 'town';
      const base = settlement(style, { width: 64, height: 48, seed: 21, settlementType, marketArchetype: 'auto' });
      const out = settlementMarket(base);
      expect(out, settlementType).toBeDefined();
      checkPlan(out!, settlementType);
      const map = generateMap(base);
      expect(map.plan?.market?.archetype, settlementType).toBe(out!.report.archetype);
      expect(map.plan?.settlement?.type).toBe(settlementType);
    }
    // Хутор без площади и крепость с двором цитадели рынка не получают.
    for (const settlementType of ['small_village', 'fortress']) {
      const style = settlementType === 'small_village' ? 'village' : 'town';
      expect(settlementMarket(settlement(style, { width: 64, height: 48, seed: 21, settlementType, marketArchetype: 'auto' })), settlementType).toBeUndefined();
    }
  });
});

describe('market: compatibility', () => {
  it('projects without marketArchetype keep the old market; the field round-trips; bad values are rejected', () => {
    const legacyGen: Partial<GenSettings> = { ...settlement('town', { width: 60, height: 44, seed: 42 }) };
    delete legacyGen.marketArchetype;
    const legacy = parseProject({ version: 1, gen: legacyGen, render: DEFAULT_RENDER, map: null });
    expect(legacy?.gen.marketArchetype).toBeUndefined();
    const old = generateMap(legacy!.gen);
    expect(old.plan?.market).toBeUndefined();
    expect(JSON.stringify(old)).toBe(JSON.stringify(generateMap({ ...legacy!.gen, marketArchetype: 'classic' })));
    const modern = settlement('town', { width: 60, height: 44, seed: 42, marketArchetype: 'caravan' });
    const map = generateMap(modern);
    const parsed = parseProject(JSON.parse(JSON.stringify({ version: 1, gen: modern, render: DEFAULT_RENDER, map })));
    expect(parsed?.gen.marketArchetype).toBe('caravan');
    expect(parsed?.map).toEqual(JSON.parse(JSON.stringify(map)));
    expect(parseProject({ version: 1, gen: { ...modern, marketArchetype: 'mall' }, render: DEFAULT_RENDER, map })).toBeNull();
  });

  it('market objects are ordinary editable civic objects of the shared kit', () => {
    const map = generateMap(settlement('town', { width: 60, height: 44, seed: 9, marketArchetype: 'fair' }));
    expect(map.plan?.market).toBeDefined();
    for (const item of map.civic ?? []) {
      expect(CIVIC_KIT[item.kind], item.kind).toBeDefined();
      expect(item.source).toBe('layout');
      expect([0, 90, 180, 270]).toContain(item.rotation);
    }
  });
});
