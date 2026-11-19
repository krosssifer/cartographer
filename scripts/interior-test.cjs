const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

const url = process.env.TEST_URL ?? 'http://localhost:5173';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const canvas = (page) => page.locator('canvas');
const ready = (page) => page.waitForSelector('.canvas-viewport[aria-busy=false]');
const pixels = (page) => canvas(page).evaluate((node) => node.toDataURL());

async function downloaded(page, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), button(page, name).click()]);
  return readFile(await file.path());
}

const project = async (page) => JSON.parse(await downloaded(page, 'Сохранить проект'));

async function openTown(page) {
  await page.goto(url); await ready(page);
  await button(page, 'Генерация').click();
  await page.getByLabel('Пресет', { exact: true }).selectOption({ label: 'Торговый город' });
  await page.getByLabel('Seed', { exact: true }).fill('1337');
  await page.getByRole('slider', { name: 'Ширина (клеток)' }).fill('48');
  await page.getByRole('slider', { name: 'Высота (клеток)' }).fill('32');
  await page.getByRole('slider', { name: 'Плотность застройки' }).fill('58');
  await button(page, 'Редактор').click();
  const controls = page.locator('.mobile-workspace-toggle');
  if (await controls.isVisible()) await controls.getByRole('button', { name: 'Инструменты' }).click();
  await button(page, 'Интерьеры').click();
  if (await controls.isVisible()) await controls.getByRole('button', { name: 'Карта' }).click();
}

async function position(page, map, x, y) {
  await canvas(page).scrollIntoViewIfNeeded();
  const box = await canvas(page).boundingBox();
  return [box.x + x / map.width * box.width, box.y + y / map.height * box.height];
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openTown(page);
    const original = await project(page);
    const inn = original.map.buildings.find((b) => b.kind === 'tavern');
    assert.ok(inn && inn.w * inn.h >= 48);
    assert.equal(await page.locator('.room-list li').count(), 4);
    await page.getByText('Общий зал', { exact: true }).waitFor();
    await page.getByText('Кладовая', { exact: true }).waitFor();

    const palette = new Set();
    for (const group of ['Зал', 'Жильё', 'Кухня и склад']) {
      await button(page, group).click();
      for (const title of await page.locator('.furniture-grid button').evaluateAll((items) => items.map((x) => x.title))) palette.add(title);
      await page.waitForFunction(() => [...document.querySelectorAll('.furniture-grid img')].every((img) => img.complete && img.naturalWidth > 0));
    }
    assert.equal(palette.size, 24);
    await button(page, 'Найти таверну').click();
    await page.waitForFunction(() => document.querySelector('.canvas-viewport').scrollTop > 0);
    assert.equal(await page.locator('.house-highlight').count(), 1);
    const floor = await pixels(page);
    await button(page, 'Крыши').click();
    assert.ok((await pixels(page)) !== floor, 'Roof toggle affects the map');
    await button(page, 'Крыши').click();
    await button(page, 'Вписать в окно').click();

    await button(page, 'Зал').click();
    await button(page, 'Красный ковёр').click();
    await button(page, 'Тёмный орех').click();
    await page.keyboard.press('KeyQ');
    let point;
    for (const [x, y] of [[1.5, 6.5], [4.5, 6.5], [7, 6], [9, 6], [2, 4.5], [5, 4.5]]) {
      const pos = await position(page, original.map, inn.x + x, inn.y + y);
      await page.mouse.move(...pos);
      if (await page.locator('[data-furniture-preview=ready]').count()) { point = pos; break; }
    }
    assert.ok(point, 'A carpet can be placed in the common room');
    await page.mouse.click(...point);
    const furnished = await project(page);
    const house = furnished.map.buildings.find((b) => b.kind === 'tavern');
    assert.equal(house.source, 'manual');
    assert.equal(house.furniture.at(-1).kind, 'rug');
    assert.equal(house.furniture.at(-1).rotation, 90);
    assert.equal(house.furniture.at(-1).finish, 'walnut');
    assert.ok(house.furniture.filter((f) => f.kind === 'table').length >= 2);
    assert.ok(house.furniture.filter((f) => f.kind === 'chair').length >= 4);
    assert.ok(house.furniture.some((f) => f.kind === 'bar'));
    await button(page, 'Отменить').click();
    assert.equal((await project(page)).map.buildings.find((b) => b.kind === 'tavern').furniture, undefined);
    await button(page, 'Повторить').click();
    assert.deepEqual((await project(page)).map.buildings.find((b) => b.kind === 'tavern').furniture, house.furniture);

    await button(page, 'Удалить мебель').click();
    let removePoint;
    for (const item of house.furniture.filter((f) => f.kind === 'chair')) {
      const pos = await position(page, original.map, inn.x + item.x, inn.y + item.y);
      await page.mouse.move(...pos);
      if (await page.locator('[data-furniture-preview=ready]').count()) { removePoint = pos; break; }
    }
    assert.ok(removePoint);
    await page.mouse.click(...removePoint);
    assert.equal((await project(page)).map.buildings.find((b) => b.kind === 'tavern').furniture.length, house.furniture.length - 1);
    await button(page, 'Отменить').click();

    await page.reload(); await ready(page);
    const restored = await project(page);
    assert.deepEqual(restored.map.buildings.find((b) => b.kind === 'tavern').furniture, house.furniture);
    await page.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'tavern.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(furnished)) });
    await page.getByText('Проект открыт', { exact: true }).waitFor();
    assert.deepEqual((await project(page)).map, restored.map);
    const png = await downloaded(page, 'Экспорт PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [original.gen.width * 40, original.gen.height * 40]);
    assert.deepEqual(errors, []);
    console.log('Interiors: four-room tavern, 24 furniture assets, placement, rotation, erasing, undo, reload, JSON and PNG passed');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await openTown(mobile);
    await mobile.getByTitle('Открыть таверну').tap();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.locator('.mobile-workspace-toggle').getByRole('button', { name: 'Инструменты', exact: true }).tap();
    await mobile.getByText('Общий зал', { exact: true }).waitFor();
    console.log('Mobile: find tavern and room inspector passed');
  } finally { await browser.close(); }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });