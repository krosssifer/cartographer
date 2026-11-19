const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const base = process.env.TEST_URL ?? 'http://localhost:5173';
const counter = (page) => page.locator('[data-layer=chests] .layer-count');
const canvas = (page) => page.locator('canvas');
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('battlemap-studio-project-v1')));
const picture = (page) => canvas(page).evaluate((node) => node.toDataURL('image/png'));
const getTitle = (page, title) => page.locator(`[title="${title}"]`);
const ready = (page) => page.waitForSelector('.canvas-viewport[aria-busy="false"]');

async function waitSaved(page, count) {
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem('battlemap-studio-project-v1'))?.map?.chests?.length === n, count);
  return saved(page);
}

async function position(page, x, y, dimensions, dx = 0.5, dy = 0.5) {
  await canvas(page).scrollIntoViewIfNeeded();
  const box = await canvas(page).boundingBox();
  return { x: box.x + (x + dx) / dimensions.width * box.width, y: box.y + (y + dy) / dimensions.height * box.height };
}

async function clickCell(page, tile, dimensions, options, dx, dy) {
  const point = await position(page, tile.x, tile.y, dimensions, dx, dy);
  await page.mouse.click(point.x, point.y, options);
}

async function download(page, click) {
  const [result] = await Promise.all([page.waitForEvent('download'), click()]);
  return fs.readFile(await result.path());
}

async function upload(page, value) {
  await page.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

async function openForest(page) {
  await page.goto(base);
  await ready(page);
  await page.getByRole('button', { name: 'Генерация', exact: true }).click();
  await page.getByLabel('Биом', { exact: true }).selectOption('forest');
  await page.getByRole('slider', { name: 'Ширина (клеток)' }).fill('36');
  await page.getByRole('slider', { name: 'Высота (клеток)' }).fill('22');
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('battlemap-studio-project-v1'))?.gen?.biome === 'forest');
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await openForest(page);
    const generated = await saved(page);
    const dim = generated.gen;
    assert.deepEqual(await page.locator('.prop-art img').evaluate((img) => [img.naturalWidth, img.naturalHeight]), [260, 180]);
    const defaultPaint = await picture(page);
    assert.ok(defaultPaint.length > 300000, 'The artwork must reach the actual canvas');
    assert.ok(!(await page.evaluate(() => [...document.images].slice(0, 3).some((img) => !img.naturalWidth))), 'Sprites decode');

    const lands = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }];
    await page.getByText('Материалы', { exact: true }).click();
    await page.getByRole('button', { name: 'Земля', exact: true }).click();
    for (const land of lands) await clickCell(page, land, dim);
    const empty = await waitSaved(page, 0);
    assert.equal(empty.map.cells[lands[0].y][lands[0].x].terrain, 'dirt');
    const baseImage = await picture(page);
    assert.notEqual(baseImage, defaultPaint);
    const water = empty.map.cells.flatMap((row, y) => row.flatMap((tile, x) => tile.terrain === 'water' ? [{ x, y }] : []))[0];
    await page.getByText('Материалы', { exact: true }).click();

    await getTitle(page, 'Сундук (C)').click();
    const hover = await position(page, lands[0].x, lands[0].y, dim);
    await page.mouse.move(hover.x, hover.y);
    assert.equal(await page.locator('.canvas-stage svg image').count(), 1, 'Placement ghost');
    await clickCell(page, water, dim);
    assert.equal(await counter(page).textContent(), '0', 'Water rejects placement');
    await clickCell(page, lands[0], dim);
    assert.equal(await counter(page).textContent(), '1');
    const placedImage = await picture(page);
    assert.notEqual(placedImage, baseImage);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.equal(await counter(page).textContent(), '0');
    assert.equal(await picture(page), baseImage);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    assert.equal(await counter(page).textContent(), '1');
    assert.equal(await picture(page), placedImage);
    await page.keyboard.press('KeyQ');
    await clickCell(page, lands[1], dim);
    let session = await waitSaved(page, 2);
    assert.deepEqual(session.map.chests.map(({ x, y, rotation }) => ({ x, y, rotation })), [
      { x: 3.5, y: 4.5, rotation: 0 }, { x: 4.5, y: 4.5, rotation: 90 },
    ]);
    assert.ok(session.map.chests.every((c) => c.kind === 'wooden' && c.size));
    assert.equal(JSON.stringify(session.map.cells), JSON.stringify(empty.map.cells), 'Props do not paint terrain');

    const chestLayer = page.locator('[data-layer=chests]');
    await chestLayer.getByRole('button', { name: 'Заблокировать слой «Сундуки»', exact: true }).click();
    await clickCell(page, lands[2], dim);
    assert.equal(await counter(page).textContent(), '2');
    await clickCell(page, lands[0], dim, { button: 'right' });
    assert.equal(await counter(page).textContent(), '2');
    await chestLayer.getByRole('button', { name: 'Разблокировать слой «Сундуки»', exact: true }).click();
    const visible = await picture(page);
    await chestLayer.getByRole('button', { name: 'Скрыть слой «Сундуки»', exact: true }).click();
    assert.equal(await picture(page), baseImage);
    await chestLayer.getByRole('button', { name: 'Показать слой «Сундуки»', exact: true }).click();
    assert.equal(await picture(page), visible);

    await page.getByRole('button', { name: 'Привязка к сетке', exact: true }).click();
    await clickCell(page, lands[2], dim, undefined, 0.23, 0.76);
    session = await waitSaved(page, 3);
    assert.ok(Math.abs(session.map.chests[2].x - 5.23) < 0.06 && Math.abs(session.map.chests[2].y - 4.76) < 0.06);
    await clickCell(page, lands[2], dim, { button: 'right' });
    await waitSaved(page, 2);

    await page.getByText('Материалы', { exact: true }).click();
    await page.getByRole('button', { name: 'Песок / отмель', exact: true }).click();
    await getTitle(page, 'Заливка (F)').click();
    await clickCell(page, lands[0], dim);
    await page.waitForFunction(({ x, y }) => JSON.parse(localStorage.getItem('battlemap-studio-project-v1')).map.cells[y][x].terrain === 'sand', lands[0]);
    assert.equal((await saved(page)).map.cells[lands[3].y][lands[3].x].terrain, 'sand');
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await getTitle(page, 'Область (R)').click();
    const corner = await position(page, lands[0].x, lands[0].y, dim);
    const farCorner = await position(page, lands[2].x, lands[2].y + 1, dim);
    await page.mouse.move(corner.x, corner.y); await page.mouse.down();
    await page.mouse.move(farCorner.x, farCorner.y, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(({ x, y }) => JSON.parse(localStorage.getItem('battlemap-studio-project-v1')).map.cells[y + 1][x].terrain === 'sand', lands[2]);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.equal(await picture(page), visible, 'Fill and rectangle can be undone independently');
    await page.getByText('Материалы', { exact: true }).click();

    await getTitle(page, 'Выбор (V)').click();
    await clickCell(page, lands[1], dim);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await clickCell(page, lands[3], dim);
    session = await waitSaved(page, 3);
    const last = session.map.chests.at(-1);
    assert.deepEqual({ x: last.x, y: last.y, rotation: last.rotation }, { x: 6.5, y: 4.5, rotation: 90 });
    console.log('Chest placement, preview, rotate, lock, visibility, undo and clipboard passed');

    const png = await download(page, () => page.getByRole('button', { name: 'Экспорт PNG' }).click());
    assert.equal(png.readUInt32BE(16), dim.width * generated.render.cellSize);
    assert.equal(png.readUInt32BE(20), dim.height * generated.render.cellSize);
    const currentPng = Buffer.from((await picture(page)).split(',')[1], 'base64');
    assert.deepEqual(png, currentPng, 'Native PNG matches the painted canvas including chests');

    const json = JSON.parse(await download(page, () => page.getByRole('button', { name: 'Сохранить проект' }).click()));
    assert.deepEqual(json.map.chests, session.map.chests);
    await page.reload(); await ready(page);
    assert.equal(await counter(page).textContent(), '3');
    const legacy = JSON.parse(JSON.stringify(json));
    delete legacy.map.chests; delete legacy.render.showChests; delete legacy.editor.chestRotation;
    for (const field of ['showCivic', 'showRoofs']) delete legacy.render[field];
    for (const field of ['roofMaterial', 'roofShape', 'civicKind', 'civicSize', 'stampRotation', 'buildingSize']) delete legacy.editor[field];
    delete legacy.gen.publicSpaces;
    await upload(page, legacy);
    await page.getByText('Проект открыт', { exact: true }).waitFor();
    assert.equal(await counter(page).textContent(), '0');
    await upload(page, json);
    await counter(page).filter({ hasText: '3' }).waitFor();
    const opened = JSON.parse(await download(page, () => page.getByRole('button', { name: 'Сохранить проект' }).click()));
    assert.deepEqual(opened.map, json.map);
    const deviation = await canvas(page).evaluate(async (node, pngData) => {
      const reference = new Image(); reference.src = pngData; await reference.decode();
      const buffer = document.createElement('canvas'); buffer.width = node.width; buffer.height = node.height;
      const context = buffer.getContext('2d'); context.drawImage(reference, 0, 0);
      const a = context.getImageData(0, 0, node.width, node.height).data;
      const b = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
      let total = 0, changed = 0;
      for (let i = 0; i < a.length; i++) { const difference = Math.abs(a[i] - b[i]); total += difference; if (difference > 10) changed++; }
      return { mean: total / a.length, changed: changed / a.length };
    }, `data:image/png;base64,${currentPng.toString('base64')}`);
    assert.ok(deviation.mean < .22 && deviation.changed < .002, `Opened map matches the saved canvas (${JSON.stringify(deviation)})`);

    const malformed = JSON.parse(JSON.stringify(json));
    malformed.map.chests[0].rotation = 17;
    await upload(page, malformed);
    await page.getByText('Неверный формат проекта. Выберите JSON из Картографа.', { exact: true }).waitFor();
    assert.equal(await counter(page).textContent(), '3');
    console.log('Native PNG, JSON, legacy import and autosave passed');

    await page.getByRole('button', { name: 'Сбросить ручные правки' }).click();
    await page.getByRole('button', { name: 'Генерация', exact: true }).click();
    for (const biome of ['cave', 'dungeon', 'desert', 'swamp', 'snow', 'plains', 'village', 'town', 'forest']) {
      await page.getByLabel('Биом', { exact: true }).selectOption(biome);
      assert.ok((await picture(page)).length > 100000, biome);
    }
    await page.getByText('Сетка и вид', { exact: true }).click();
    const forest = await picture(page);
    await page.getByRole('button', { name: 'Живописные текстуры' }).click();
    assert.notEqual(await picture(page), forest);
    await page.getByRole('button', { name: 'Живописные текстуры' }).click();
    assert.equal(await picture(page), forest);
    await page.getByLabel('Тип сетки', { exact: true }).selectOption('hex');
    assert.notEqual(await picture(page), forest);
    console.log('All biomes, textures, and hex grid passed');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await openForest(mobile);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.getByRole('button', { name: 'Сундук', exact: true }).tap();
    const touch = await position(mobile, lands[0].x, lands[0].y, dim);
    await mobile.touchscreen.tap(touch.x, touch.y);
    await waitSaved(mobile, 1);
    await mobile.getByRole('button', { name: 'Удалить сундук', exact: true }).tap();
    await mobile.touchscreen.tap(touch.x, touch.y);
    await waitSaved(mobile, 0);

    await page.getByRole('button', { name: 'Редактор', exact: true }).click();
    const main = page.locator('.canvas-viewport');
    await getTitle(page, 'Масштаб 100%').click();
    await getTitle(page, 'Рука (H)').click();
    const frame = await main.boundingBox();
    await page.mouse.move(frame.x + 340, frame.y + 270); await page.mouse.down();
    await page.mouse.move(frame.x + 130, frame.y + 140, { steps: 6 }); await page.mouse.up();
    assert.ok(await main.evaluate((div) => div.scrollLeft > 120 && div.scrollTop > 70), 'Panning scrolls the oversized map');
    await page.getByRole('button', { name: 'Вписать в окно', exact: true }).click();
    assert.ok(await main.evaluate((div) => div.scrollWidth <= div.clientWidth && div.scrollHeight <= div.clientHeight));
    assert.deepEqual(errors, []);
    console.log('Brush, fill, rectangle, panning and mobile placement passed, no browser errors');
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });