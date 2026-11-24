// Browser raster-cache regression. Run against Vite, e.g. npm run dev, then
// node scripts/canvas-cache-test.cjs. TEST_URL may select another Vite host.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
    await page.waitForSelector('.canvas-viewport[aria-busy=false]', { state: 'attached' });
    const results = await page.evaluate(async () => {
      const { renderMap, clearRenderCaches } = await import('/src/lib/render.ts');
      const { generateMap } = await import('/src/lib/generator.ts');
      const { DEFAULT_GEN, DEFAULT_RENDER } = await import('/src/lib/presets.ts');
      const { loadAssets, loadMarketAssets } = await import('/src/lib/assets.ts');
      await Promise.all([loadAssets(), loadMarketAssets()]);
      const map = generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', settlementType: 'trade_town', width: 48, height: 32, seed: 1337, density: .58, urbanDressing: 1 });
      const settings = { ...DEFAULT_RENDER, cellSize: 16 };
      const canvas = document.createElement('canvas');
      const pixels = (m, rs = settings) => {
        renderMap(canvas, m, rs, 1337);
        return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
      const verify = (name, m, rs, previous) => {
        const cached = pixels(m, rs);
        const changed = previous ? diff(previous, cached) : 0;
        clearRenderCaches();
        const fresh = pixels(m, rs);
        return { name, changed, cacheDifference: diff(cached, fresh), pixels: fresh };
      };
      clearRenderCaches();
      const first = pixels(map);
      let rows = [];
      let same = verify('unchanged', map, settings, first); rows.push({ name: same.name, changed: same.changed, cacheDifference: same.cacheDifference });
      const cells = map.cells.map((row) => row.map((cell) => ({ ...cell })));
      let target;
      outer: for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
        if (!['grass', 'darkGrass'].includes(cells[y][x].terrain)) continue;
        if (map.buildings?.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
        target = { x, y }; break outer;
      }
      if (!target) throw new Error('No suitable terrain cell');
      cells[target.y][target.x].terrain = 'sand';
      const sand = { ...map, cells };
      const sandPixels = pixels(sand);
      const snowCells = cells.map((row) => row.map((cell) => ({ ...cell })));
      snowCells[target.y][target.x].terrain = 'snow';
      const snow = { ...map, cells: snowCells };
      const terrain = verify('sand-to-snow', snow, settings, sandPixels); rows.push({ name: terrain.name, changed: terrain.changed, cacheDifference: terrain.cacheDifference });
      // The raster cache must not rely on the cells array identity: tools can
      // edit an existing grid in place.
      const beforeMutation = pixels(snow);
      snow.cells[target.y][target.x].terrain = 'sand';
      const mutation = verify('in-place-terrain', snow, settings, beforeMutation); rows.push({ name: mutation.name, changed: mutation.changed, cacheDifference: mutation.cacheDifference });
      const structures = verify('structures-toggle', map, { ...settings, showStructures: !settings.showStructures }, pixels(map)); rows.push({ name: structures.name, changed: structures.changed, cacheDifference: structures.cacheDifference });
      const item = map.civic.find((c) => c.kind !== 'square');
      if (!item) throw new Error('No civic object to move');
      const original = pixels(map);
      const moved = { ...map, civic: map.civic.map((c) => c === item ? { ...c, x: c.x + 2 } : c) };
      const move = verify('move', moved, settings, original); rows.push({ name: move.name, changed: move.changed, cacheDifference: move.cacheDifference });
      const turned = { ...map, civic: map.civic.map((c) => c === item ? { ...c, rotation: (c.rotation + 90) % 360, w: c.h, h: c.w } : c) };
      const turn = verify('rotate', turned, settings, original); rows.push({ name: turn.name, changed: turn.changed, cacheDifference: turn.cacheDifference });
      const texture = verify('texture-toggle', map, { ...settings, texture: !settings.texture }, original); rows.push({ name: texture.name, changed: texture.changed, cacheDifference: texture.cacheDifference });
      clearRenderCaches();
      const exportPixels = pixels(map);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const bitmap = await createImageBitmap(png);
      const decoded = document.createElement('canvas'); decoded.width = canvas.width; decoded.height = canvas.height;
      decoded.getContext('2d').drawImage(bitmap, 0, 0);
      rows.push({ name: 'png-export', changed: 0, cacheDifference: diff(exportPixels, decoded.getContext('2d').getImageData(0, 0, decoded.width, decoded.height).data) });
      return rows;
    });
    for (const row of results) {
      assert.equal(row.cacheDifference, 0, `${row.name}: cached and fresh pixels differ`);
      if (row.name === 'unchanged') assert.equal(row.changed, 0, 'repeat rendering must not leak canvas state');
      else if (row.name !== 'png-export') assert.ok(row.changed > 0, `${row.name}: edit did not affect any pixels`);
    }
    console.log('Canvas cache, terrain/texture invalidation, movement, rotation and PNG:', results);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
