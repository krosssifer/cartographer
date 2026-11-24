import { describe, expect, it } from 'vitest';
import { buildTypedPlan } from '../src/lib/gen/settlementPlanner';
import { generateMap } from '../src/lib/generator';
import { DEFAULT_GEN } from '../src/lib/presets';
import { SETTLEMENT_TYPES } from '../src/lib/gen/settlementTypes';
import type { SettlementTypeId } from '../src/lib/gen/settlementTypes';
import { intersects } from '../src/lib/settlementKit';
import { doorStepCells, coversCell } from '../src/lib/gen/urban/dressing';

const settings = { ...DEFAULT_GEN, biome: 'town' as const, settlement: 'town' as const, settlementType: 'craft_town' as const, width: 100, height: 80, seed: 11, urbanDressing: 1, density: 1, publicSpaces: true };

describe('functional scenes in typed settlements', () => {
  it('preserves complete groups, real footprints, access and the owner rank after repair', () => {
    const plan = buildTypedPlan(settings, 'town');
    expect(plan.functionalScenes.length).toBeGreaterThan(0);
    expect(plan.report.dressing?.scenesPlaced).toBe(plan.functionalScenes.length);
    const steps = doorStepCells(plan.plots, settings.width, settings.height);
    for (const group of plan.functionalScenes) {
      const { placement, items } = group;
      expect(items).toHaveLength(1 + placement.parts.length);
      const ranks = items.map((item) => plan.rankedCivic.find((rc) => rc.item === item)?.plotRank);
      expect(ranks[0]).toBeGreaterThanOrEqual(0);
      expect(ranks.every((rank) => rank === ranks[0])).toBe(true);
      expect(plan.placedPlots[ranks[0]!]!.id).toBe(placement.plotId);
      for (const item of items) {
        expect(coversCell(item, steps, settings.width)).toBe(false);
        expect(plan.plots.some((house) => intersects(house, item))).toBe(false);
        expect(plan.rankedCivic.some((other) => other.item !== item && other.item.kind !== 'square' && intersects(other.item, item))).toBe(false);
        for (let y = item.y; y < item.y + item.h; y++) for (let x = item.x; x < item.x + item.w; x++) expect(['road', 'plaza', 'bridge', 'wall', 'water', 'deepWater', 'rock']).not.toContain(plan.cells[y][x].terrain);
      }
      for (const area of placement.access) {
        expect(coversCell(area, steps, settings.width)).toBe(false);
        expect(plan.plots.some((b) => intersects(b, area))).toBe(false);
        expect(plan.rankedCivic.some((rc) => rc.item.kind !== 'square' && intersects(rc.item, area))).toBe(false);
      }
    }
  });

  it('does not modify the market plan or place scenes on market cells', () => {
    const without = buildTypedPlan({ ...settings, urbanDressing: 0, marketArchetype: 'city' }, 'town');
    const withScenes = buildTypedPlan({ ...settings, urbanDressing: 1, marketArchetype: 'city' }, 'town');
    expect(withScenes.market).toBeDefined();
    expect(withScenes.market?.plan).toEqual(without.market?.plan);
    const market = withScenes.market!.plan;
    for (const group of withScenes.functionalScenes) for (const rect of [...group.items, ...group.placement.access]) {
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
        expect(market.area[y * settings.width + x]).toBe(0);
      }
    }
  });

  it('reports the density-filtered scene count and remains deterministic', () => {
    const first = generateMap(settings);
    const second = generateMap(settings);
    expect(first.civic).toEqual(second.civic);
    expect(first.plan?.settlement?.dressing).toEqual(second.plan?.settlement?.dressing);
    const empty = generateMap({ ...settings, density: 0 });
    expect(empty.plan?.settlement?.dressing?.scenesPlaced).toBe(0);
    expect(empty.plan?.settlement?.dressing?.sceneVariants).toEqual({});
  });

  it('keeps groups and their working areas valid across eight settlement types and several seeds', () => {
    const types: SettlementTypeId[] = ['large_village', 'craft_town', 'trade_town', 'small_city', 'large_city', 'port', 'fortified_town', 'mountain'];
    let groups = 0;
    for (const type of types) for (const seed of [11, 42, 87]) {
      const style = SETTLEMENT_TYPES.find((t) => t.id === type)!.style;
      const options = { ...settings, biome: style, settlement: style, settlementType: type, seed };
      const plan = buildTypedPlan(options, style);
      const map = generateMap(options);
      const actualItems = new Set(map.civic);
      expect(map.plan?.settlement?.dressing?.scenesPlaced).toBe(plan.functionalScenes.length);
      for (const group of plan.functionalScenes) {
        groups++;
        expect(group.items.every((item) => actualItems.has(item))).toBe(true);
        for (const item of group.items) {
          expect(map.buildings?.some((building) => intersects(building, item))).toBe(false);
          expect(map.civic.some((other) => other !== item && other.kind !== 'square' && intersects(other, item))).toBe(false);
        }
        for (const rect of [...group.items, ...group.placement.access]) {
          for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
            expect(['road', 'plaza', 'bridge', 'wall', 'water', 'deepWater', 'rock']).not.toContain(map.cells[y][x].terrain);
          }
        }
        for (const area of group.placement.access) {
          expect(plan.plots.some((building) => intersects(building, area))).toBe(false);
          expect(plan.rankedCivic.some(({ item }) => item.kind !== 'square' && intersects(item, area))).toBe(false);
          expect(map.trees.some((tree) => tree.x >= area.x && tree.x < area.x + area.w && tree.y >= area.y && tree.y < area.y + area.h)).toBe(false);
          expect(map.rocks.some((rock) => rock.x >= area.x && rock.x < area.x + area.w && rock.y >= area.y && rock.y < area.y + area.h)).toBe(false);
        }
      }
    }
    expect(groups).toBeGreaterThan(10);
  }, 30000);

});

describe('scene lifecycle after repair', () => {
  it('removes every part when a single part or access is lost', async () => {
    const { reconcileFunctionalScenes } = await import('../src/lib/gen/urban/sceneLifecycle');
    const plan = buildTypedPlan(settings, 'town');
    const group = plan.functionalScenes[0];
    expect(group.items.length).toBeGreaterThan(1);
    const complete = new Set(group.items);
    expect(reconcileFunctionalScenes([group], complete, () => true).surviving).toEqual([group]);
    complete.delete(group.items[0]);
    const removed = reconcileFunctionalScenes([group], complete, () => true);
    expect(removed.surviving).toEqual([]);
    expect(removed.discarded).toEqual(new Set(group.items));
    const blocked = reconcileFunctionalScenes([group], new Set(group.items), () => false);
    expect(blocked.surviving).toEqual([]);
    expect(blocked.discarded).toEqual(new Set(group.items));
  });
});

describe('scene debug layer', () => {
  it('renders scene bounds, parts, access and rejection labels independently and round-trips', async () => {
    const { DEFAULT_SETTLEMENT_DEBUG, drawSettlementDebugOverlay } = await import('../src/lib/gen/urban/debug');
    const { DEFAULT_RENDER } = await import('../src/lib/presets');
    const { parseProject } = await import('../src/lib/project');
    const map = generateMap(settings);
    const debug = map.plan?.settlement?.debug;
    expect(debug?.scenes?.length).toBeGreaterThan(0);
    expect(debug?.sceneFailures?.length).toBeGreaterThan(0);
    expect(generateMap({ ...settings, density: 0 }).plan?.settlement?.debug?.scenes).toEqual([]);
    let rectangles = 0;
    const labels: string[] = [];
    const context = {
      save() {}, restore() {}, setLineDash() {},
      strokeRect() { rectangles++; }, fillRect() { rectangles++; },
      measureText(text: string) { return { width: text.length * 6 }; },
      fillText(text: string) { labels.push(text); },
    } as unknown as CanvasRenderingContext2D;
    const allOff = Object.fromEntries(Object.keys(DEFAULT_SETTLEMENT_DEBUG).map((key) => [key, false]));
    drawSettlementDebugOverlay(context, map, 32, allOff);
    expect(rectangles).toBe(0);
    drawSettlementDebugOverlay(context, map, 32, { ...allOff, scenes: true });
    expect(rectangles).toBeGreaterThan(debug!.scenes!.length * 2);
    expect(labels.some((label) => label.includes(debug!.scenes![0].sceneId))).toBe(true);
    expect(labels.some((label) => label.includes(debug!.sceneFailures![0].reason))).toBe(true);
    const raw = JSON.parse(JSON.stringify({ version: 1, gen: settings, render: { ...DEFAULT_RENDER, settlementDebug: { scenes: true } }, map }));
    const parsed = parseProject(raw);
    expect(parsed?.render.settlementDebug?.scenes).toBe(true);
    expect(parsed?.map?.plan?.settlement?.debug?.scenes?.length).toBe(debug!.scenes!.length);
  });
});

describe('typed settlement civic toggle', () => {
  it('removes automatic civic objects and scenes when the public-spaces switch is off', () => {
    const enabled = generateMap(settings);
    const disabled = generateMap({ ...settings, publicSpaces: false });
    expect(enabled.civic.length).toBeGreaterThan(0);
    expect(disabled.civic).toEqual([]);
    expect(disabled.plan?.settlement?.dressing?.scenesPlaced).toBe(0);
    expect(disabled.plan?.settlement?.debug?.scenes).toEqual([]);
    expect(disabled.lights?.some((light) => light.kind === 'brazier' || light.kind === 'street_lantern') ?? false).toBe(false);
    for (const light of enabled.lights ?? []) if (light.kind === 'brazier' || light.kind === 'street_lantern') {
      expect(enabled.civic.some((item) => item.kind === (light.kind === 'brazier' ? 'urbanForge' : 'urbanLamp') && item.x + item.w / 2 === light.x && item.y + item.h / 2 === light.y)).toBe(true);
    }
    expect(disabled.buildings?.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= disabled.width && b.y + b.h <= disabled.height)).toBe(true);
  });
});
