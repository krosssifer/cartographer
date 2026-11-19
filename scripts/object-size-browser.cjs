const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

const url = process.env.TEST_URL ?? 'http://localhost:5173';
const button = (p, name) => p.getByRole('button', { name, exact: true });
const canvas = (p) => p.locator('canvas');
async function download(p, name) { const [file] = await Promise.all([p.waitForEvent('download'), button(p, name).click()]); return readFile(await file.path()); }
const save = async (p) => JSON.parse(await download(p, 'Сохранить проект'));
async function load(p, data) {
  await p.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'objects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await p.getByText('Проект открыт', { exact: true }).waitFor();
}
async function click(p, map, x, y) {
  await canvas(p).scrollIntoViewIfNeeded();
  const rect = await canvas(p).boundingBox();
  await p.mouse.click(rect.x + x / map.width * rect.width, rect.y + y / map.height * rect.height);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 940 } }), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(url); await p.waitForSelector('.canvas-viewport[aria-busy=false]');
    const fixture = await save(p);
    Object.assign(fixture.gen, { biome: 'dungeon', width: 36, height: 24, seed: 1337 });
    fixture.map = { width: 36, height: 24, biome: 'dungeon', cells: Array.from({ length: 24 }, () => Array.from({ length: 36 }, () => ({ terrain: 'floor', height: .5, moisture: .5 }))), chests: [], trees: [], rocks: [], structures: [], crypt: [], river: [], road: [] };
    Object.assign(fixture.editor, { tool: 'chest', chestKind: 'wooden', chestRotation: 0, objectSizes: {}, sizeLock: true, sizeUnit: 'cells' });
    await load(p, fixture);
    await p.keyboard.press('KeyC');
    await p.locator('.chest-variant-grid').waitFor();
    assert.equal(await p.locator('.chest-variant-grid button').count(), 3);
    await button(p, 'Сохранять пропорции').click();
    await p.getByLabel('Ширина объекта', { exact: true }).fill('2');
    await p.getByLabel('Высота объекта', { exact: true }).fill('1');
    await button(p, 'Использовать размер').click();
    await click(p, fixture.map, 5.5, 6.5);
    let project = await save(p);
    assert.deepEqual(project.map.chests[0].size, { w: 2, h: 1 });
    assert.equal(project.map.chests[0].kind, 'wooden');
    await button(p, 'Каменный сундук').click();
    await click(p, fixture.map, 10.5, 6.5);
    await button(p, 'Роскошный сундук').click();
    await click(p, fixture.map, 15.5, 6.5);
    project = await save(p);
    assert.deepEqual(project.map.chests.map((c) => c.kind), ['wooden', 'stone', 'ornate']);
    await p.keyboard.press('KeyV');
    await click(p, fixture.map, 15.5, 6.5);
    await p.locator('.object-size-panel').scrollIntoViewIfNeeded();
    await p.getByLabel('Единицы размера').selectOption('feet');
    assert.equal(Number(await p.getByLabel('Ширина объекта', { exact: true }).inputValue()), 5.5);
    await p.getByLabel('Ширина объекта', { exact: true }).fill('15');
    await p.getByLabel('Высота объекта', { exact: true }).fill('7.5');
    assert.equal((await save(p)).map.chests[2].size.w, 1.1, 'Preview has not changed the stored map');
    await button(p, 'Применить к объекту').click();
    project = await save(p);
    assert.deepEqual(project.map.chests[2].size, { w: 3, h: 1.5 });
    await button(p, 'Отменить').click();
    assert.deepEqual((await save(p)).map.chests[2].size, { w: 1.1, h: .76 });
    await button(p, 'Повторить').click();
    assert.deepEqual((await save(p)).map.chests[2].size, { w: 3, h: 1.5 });
    await p.keyboard.press('KeyV'); await click(p, fixture.map, 15.5, 6.5);
    await p.locator('.object-size-panel').scrollIntoViewIfNeeded();
    await button(p, 'Каменный сундук').click();
    await button(p, 'Применить к объекту').click();
    assert.equal((await save(p)).map.chests[2].kind, 'stone');
    console.log('Chests: 3 types, new and existing dimensions, feet/cells, preview and undo/redo passed');

    await p.keyboard.press('KeyD');
    await button(p, 'Погребение').click(); await button(p, 'Саркофаг').click();
    await p.getByLabel('Единицы размера').selectOption('cells');
    await p.getByLabel('Ширина объекта', { exact: true }).fill('4');
    await p.getByLabel('Высота объекта', { exact: true }).fill('1.5');
    await button(p, 'Использовать размер').click();
    await p.keyboard.press('KeyQ');
    await click(p, fixture.map, 23.5, 7.5);
    project = await save(p);
    assert.deepEqual([project.map.crypt.at(-1).w, project.map.crypt.at(-1).h], [1.5, 4]);
    await p.keyboard.press('KeyV'); await click(p, fixture.map, 24, 8);
    await p.locator('.object-size-panel').scrollIntoViewIfNeeded();
    await p.getByLabel('Ширина объекта', { exact: true }).fill('5');
    await p.getByLabel('Высота объекта', { exact: true }).fill('2');
    await button(p, 'Применить к объекту').click();
    assert.deepEqual([(await save(p)).map.crypt.at(-1).w, (await save(p)).map.crypt.at(-1).h], [2, 5]);
    console.log('Crypt props: arbitrary fractional dimensions, rotated stamps and resized placed geometry passed');

    const snapshot = await save(p);
    const png = await download(p, 'Экспорт PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1440, 960]);
    await p.reload(); await p.waitForSelector('.canvas-viewport[aria-busy=false]');
    assert.deepEqual((await save(p)).map, snapshot.map);
    await load(p, snapshot);
    assert.deepEqual((await save(p)).map, snapshot.map);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    for (const c of legacy.map.chests) { delete c.size; delete c.kind; }
    for (const field of ['objectSizes', 'chestKind', 'sizeLock', 'sizeUnit']) delete legacy.editor[field];
    await load(p, legacy);
    assert.equal((await save(p)).editor.chestKind, 'wooden');
    assert.deepEqual(errors, []);
    console.log('Project roundtrip: dimensioned JSON, PNG, autosave and legacy import passed');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(url); await mobile.waitForSelector('.canvas-viewport[aria-busy=false]');
    const mobileFixture = { ...snapshot, editor: { ...snapshot.editor, tool: 'select' } };
    await load(mobile, mobileFixture);
    await click(mobile, fixture.map, 5.5, 6.5);
    await mobile.getByLabel('Ширина объекта', { exact: true }).waitFor({ state: 'visible' });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('Mobile: tapping a placed object opens its size inspector without horizontal overflow');
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });