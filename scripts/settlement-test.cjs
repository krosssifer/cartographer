const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, mkdir } = require('node:fs/promises');

const base = process.env.TEST_URL ?? 'http://localhost:5173';
const button = (p, name) => p.getByRole('button', { name, exact: true });
const slider = (p, name) => p.getByRole('slider', { name, exact: true });
const art = (p) => p.locator('canvas[aria-label]').evaluate((node) => node.toDataURL());
// The mobile map is intentionally hidden while the settings panel is open.
const waitReady = (p) => p.waitForSelector('.canvas-viewport[aria-busy=false]', { state: 'attached' });

async function download(page, label) {
  const [file] = await Promise.all([page.waitForEvent('download'), button(page, label).click()]);
  return readFile(await file.path());
}
const save = async (page) => JSON.parse(await download(page, 'Сохранить проект'));

async function open(page, value) {
  await page.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'settlement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByText('Проект открыт', { exact: true }).waitFor();
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function free(map, w, h, includeSquare = false) {
  for (let y = 2; y + h < map.height - 2; y++) for (let x = 2; x + w < map.width - 2; x++) {
    const area = { x, y, w, h };
    if ([...(map.buildings ?? []), ...(map.structures ?? []), ...(map.civic ?? []).filter((p) => !includeSquare || p.kind !== 'square')].some((r) => overlaps(r, area))) continue;
    if ((map.chests ?? []).some((c) => c.x >= area.x && c.x < area.x + area.w && c.y >= area.y && c.y < area.y + area.h)) continue;
    if (map.cells.slice(y, y + h).every((row) => row.slice(x, x + w).every((cell) => ['grass', 'darkGrass', 'plaza', 'road', 'dirt'].includes(cell.terrain)))) {
      return { x: x + Math.floor((w - 1) / 2), y: y + Math.floor((h - 1) / 2) };
    }
  }
  throw new Error('No room for stamp');
}

async function screen(page, map, { x, y }) {
  await page.locator('canvas[aria-label]').scrollIntoViewIfNeeded();
  const box = await page.locator('canvas[aria-label]').boundingBox();
  return [box.x + (x + .5) / map.width * box.width, box.y + (y + .5) / map.height * box.height];
}

async function main() {
  const browser = await chromium.launch();
  let p, mobile;
  const errors = [];
  try {
    p = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    p.on('dialog', (dialog) => dialog.accept());
    p.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    p.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    p.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    p.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await p.goto(base); await waitReady(p); await startTown(p);
    const regular = await save(p);
    assert.equal(regular.gen.biome, 'town');
    assert.ok(regular.map.buildings.length >= 4);
    // Typed settlements contain small secondary/landmark buildings. Validate
    // their actual geometry, boundaries and mutual separation instead of a
    // legacy minimum area or a tavern guaranteed only on larger maps.
    for (const [i, house] of regular.map.buildings.entries()) {
      assert.ok([house.x, house.y, house.w, house.h].every(Number.isInteger));
      assert.ok(house.w >= 3 && house.h >= 3 && house.x >= 0 && house.y >= 0);
      assert.ok(house.x + house.w <= regular.map.width && house.y + house.h <= regular.map.height);
      assert.ok(house.door.x >= house.x && house.door.x < house.x + house.w && house.door.y >= house.y && house.door.y < house.y + house.h);
      assert.ok(regular.map.buildings.slice(i + 1).every((other) => !overlaps(house, other)));
    }
    const market = regular.map.plan.market;
    assert.ok(market && market.valid && market.issues.length === 0);
    assert.ok(market.entrances > 0 && market.aisleCells > 0 && market.placed > 0);
    assert.equal(market.mandatoryObjects.placed, market.mandatoryObjects.planned);
    const marketItems = regular.map.civic.filter((item) => item.kind.startsWith('market') && overlaps(item, market.bounds));
    assert.equal(marketItems.length, market.objects);
    assert.ok(marketItems.every((item) => regular.map.buildings.every((house) => !overlaps(item, house))));
    for (const [i, item] of marketItems.entries()) assert.ok(marketItems.slice(i + 1).every((other) => !overlaps(item, other)));
    await button(p, 'Поселение').click();
    assert.equal(await p.locator('.roof-swatches button').count(), 8);

    const density = slider(p, 'Плотность застройки'), apply = button(p, 'Применить планировку');
    await density.press('Home'); await apply.click();
    let empty = await save(p);
    assert.equal(empty.gen.density, 0);
    assert.equal(empty.map.buildings.length, 0);
    assert.deepEqual(empty.map.cells, regular.map.cells);
    // Density filters rank-owned courtyard decorations, not the protected market.
    const inMarket = (item) => item.kind === 'square' || (item.kind.startsWith('market') && overlaps(item, market.bounds));
    assert.deepEqual(empty.map.civic.filter(inMarket), regular.map.civic.filter(inMarket));
    assert.deepEqual(empty.map.plan.market, regular.map.plan.market);
    await density.fill('5'); await apply.click();
    const sparse = await save(p);
    assert.ok(sparse.map.buildings.length >= 1 && sparse.map.buildings.length <= 2);
    await density.press('End'); await apply.click();
    const crowded = await save(p);
    assert.ok(crowded.map.buildings.length > regular.map.buildings.length);
    assert.deepEqual(crowded.map.road, regular.map.road);
    await button(p, 'Отменить').click();
    assert.equal(await density.inputValue(), '5');
    await button(p, 'Повторить').click();
    assert.equal(await density.inputValue(), '100');
    // Typed settlements change village/city via their generation type selector;
    // the old editor's Деревня button is available only to classic settlements.
    await button(p, 'Генерация').click();
    await p.getByLabel('Тип поселения', { exact: true }).selectOption('large_village');
    await waitReady(p);
    const village = await save(p);
    assert.equal(village.gen.biome, 'village');
    assert.equal(village.gen.settlementType, 'large_village');
    assert.ok(village.map.buildings.every((b) => Number.isInteger(b.roof) && b.roof >= 0 && b.roof < 8));
    await open(p, crowded);
    assert.equal(await p.getByRole('heading', { level: 1 }).textContent(), 'Торговый квартал');
    await button(p, 'Редактор').click();
    await button(p, 'Поселение').click();
    await density.press('Home'); await apply.click();
    empty = await save(p);

    await p.getByTitle('Поставить дом (N)').click();
    const houseSpot = free(empty.map, 7, 5);
    const house = await screen(p, empty.map, houseSpot);
    await p.mouse.move(...house);
    await p.locator('[data-stamp=ready]').waitFor({ state: 'attached' });
    assert.equal(await p.locator('[data-stamp=ready]').count(), 1);
    await p.mouse.click(...house);
    const planted = await save(p);
    assert.equal(planted.map.buildings.length, 1);
    assert.equal(planted.map.buildings[0].source, 'manual');
    await p.keyboard.press('KeyJ');
    await button(p, 'Медь').click();
    await p.getByLabel('Форма крыши').selectOption('hip');
    if (await button(p, 'Крыши').getAttribute('aria-pressed') === 'false') await button(p, 'Крыши').click();
    const oldRoof = await art(p);
    await p.mouse.click(...house);
    let decorated = await save(p);
    assert.equal(decorated.map.buildings[0].roof, 4);
    assert.equal(decorated.map.buildings[0].shape, 'hip');
    const newRoof = await art(p);
    assert.notEqual(newRoof, oldRoof);
    await button(p, 'Крыши').click();
    assert.notEqual(await art(p), newRoof);
    await button(p, 'Крыши').click();
    assert.equal(await art(p), newRoof);

    for (const [label, w, h] of [['Колодец', 1, 1], ['Рынок', 2, 4], ['Площадь', 5, 7], ['Огород', 2, 3], ['Фонтан', 2, 2], ['Телега', 1, 2]]) {
      await p.locator('[data-civic]').filter({ hasText: label }).click();
      if (label === 'Рынок') { await p.getByLabel('Размер рынка').selectOption('1'); await p.keyboard.press('KeyQ'); }
      if (label === 'Площадь') await p.getByLabel('Размер площади').selectOption('1');
      const spot = free(decorated.map, w, h);
      const point = await screen(p, decorated.map, spot);
      await p.mouse.move(...point);
      await p.locator('[data-stamp=ready]').waitFor({ state: 'attached' });
      assert.equal(await p.locator('[data-stamp=ready]').count(), 1, label);
      if (label === 'Рынок') assert.equal(await p.locator('[data-stamp=ready] image').count(), 2);
      const before = decorated.map.civic.length;
      await p.mouse.click(...point);
      decorated = await save(p);
      assert.equal(decorated.map.civic.length, before + 1, label);
      assert.equal(decorated.map.civic.at(-1).source, 'manual');
      if (label === 'Телега') {
        await p.mouse.click(...await screen(p, decorated.map, spot), { button: 'right' });
        assert.equal((await save(p)).map.civic.length, before);
        await button(p, 'Отменить').click();
      }
    }
    const manual = decorated.map.civic.filter((p) => p.source === 'manual');
    assert.equal(manual.length, 6);
    await density.press('End'); await apply.click();
    const merged = await save(p);
    assert.deepEqual(merged.map.civic.filter((p) => p.source === 'manual'), manual);
    assert.deepEqual(merged.map.buildings.find((b) => b.source === 'manual'), decorated.map.buildings[0]);
    await button(p, 'Площади и городские детали').click(); await apply.click();
    const noAuto = await save(p);
    assert.deepEqual(noAuto.map.civic, manual);
    await button(p, 'Инструменты').click();
    const visible = await art(p);
    await button(p, 'Скрыть слой «Городские объекты»').click();
    assert.notEqual(await art(p), visible);
    await button(p, 'Показать слой «Городские объекты»').click();
    assert.equal(await art(p), visible);
    await button(p, 'Заблокировать слой «Городские объекты»').click();
    await button(p, 'Поселение').click();
    assert.ok(await apply.isDisabled());
    await button(p, 'Инструменты').click();
    await button(p, 'Разблокировать слой «Городские объекты»').click();

    await p.reload(); await waitReady(p);
    assert.deepEqual((await save(p)).map.civic, manual);
    await open(p, merged);
    assert.deepEqual((await save(p)).map, merged.map);
    console.log('Settlement editor: zero-to-full density, undo, roofs and interiors, six stamps, manual preservation, visibility and JSON passed');

    await button(p, 'Генерация').click();
    await slider(p, 'Ширина (клеток)').fill('100');
    await slider(p, 'Высота (клеток)').fill('80');
    const large = await save(p);
    assert.deepEqual([large.gen.width, large.gen.height], [100, 80]);
    const scenes = large.map.plan?.settlement?.debug?.scenes ?? [];
    assert.ok(scenes.length > 0, '100x80 fixture must exercise functional scenes');
    assert.equal(scenes.length, large.map.plan.settlement.dressing.scenesPlaced);
    for (const scene of scenes) {
      const parts = [scene.anchor, ...scene.parts];
      assert.ok(parts.length >= 2 && scene.access.length > 0);
      for (const part of parts) {
        assert.ok(large.map.civic.some((item) => item.kind === part.kind && item.x === part.x && item.y === part.y && item.w === part.w && item.h === part.h));
        assert.ok(large.map.buildings.every((house) => !overlaps(part, house)));
      }
      for (const area of scene.access) {
        assert.ok(large.map.buildings.every((house) => !overlaps(area, house)));
        assert.ok(large.map.civic.filter((item) => item.kind !== 'square').every((item) => !overlaps(area, item)));
      }
    }
    console.log(`Functional scenes: ${scenes.length} complete groups with unobstructed access`);
    const png = await download(p, 'Экспорт PNG');
    const exportCellSize = Math.max(12, Math.min(Math.round(large.render.cellSize * 2), Math.floor(Math.sqrt(64_000_000 / (large.map.width * large.map.height)))));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [large.map.width * exportCellSize, large.map.height * exportCellSize]);
    await open(p, large);
    assert.deepEqual((await save(p)).map.road, large.map.road);
    assert.deepEqual(errors, []);
    console.log('Standard 100x80 project: full PNG export and import passed');

    mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (err) => errors.push(`mobile pageerror: ${err.message}`));
    mobile.on('console', (msg) => { if (msg.type() === 'error') errors.push(`mobile console: ${msg.text()}`); });
    mobile.on('requestfailed', (request) => errors.push(`mobile requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    mobile.on('response', (response) => { if (response.status() >= 400) errors.push(`mobile HTTP ${response.status()}: ${response.url()}`); });
    await mobile.goto(base); await waitReady(mobile); await startTown(mobile);
    await mobile.locator('.mobile-object-tools').getByRole('button', { name: 'Поселение', exact: true }).tap();
    await button(mobile, 'Колодец').tap();
    const point = await screen(mobile, regular.map, free(regular.map, 1, 1));
    await mobile.touchscreen.tap(...point);
    await mobile.waitForFunction(() => JSON.parse(localStorage.getItem('battlemap-studio-project-v1'))?.map?.civic?.some((p) => p.source === 'manual'));
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('Mobile: settlement palette and touch placement passed');
  } catch (err) {
    console.error('Browser diagnostics:', errors);
    if (p) {
      await mkdir('artifacts/scene-stage6', { recursive: true });
      await (mobile ?? p).screenshot({ path: 'artifacts/scene-stage6/settlement-smoke-failure.png', timeout: 5000 }).catch(() => {});
    }
    throw err;
  } finally {
    await browser.close();
  }
}

async function startTown(page) {
  await button(page, 'Генерация').click();
  const preset = page.getByLabel('Пресет', { exact: true });
  await preset.waitFor({ state: 'visible' });
  assert.equal(await preset.isEnabled(), true);
  await preset.selectOption({ label: 'Торговый город' });
  assert.equal(await page.getByLabel('Биом', { exact: true }).inputValue(), 'town');
  assert.equal(await slider(page, 'Ширина (клеток)').inputValue(), '100');
  assert.equal(await slider(page, 'Высота (клеток)').inputValue(), '80');
  await waitReady(page);
  await page.getByLabel('Seed', { exact: true }).fill('1337');
  await slider(page, 'Ширина (клеток)').fill('48');
  await slider(page, 'Высота (клеток)').fill('32');
  await slider(page, 'Плотность застройки').fill('58');
  await button(page, 'Редактор').click();
  if (await page.locator('.mobile-workspace-toggle').isVisible()) return;
  await button(page, 'Поселение').click();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
