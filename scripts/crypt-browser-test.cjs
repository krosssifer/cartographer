const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

const base = process.env.TEST_URL ?? 'http://localhost:5173';
const button = (p, name) => p.getByRole('button', { name, exact: true });
const canvas = (p) => p.locator('canvas');
const png = (p) => canvas(p).evaluate((node) => node.toDataURL());
const ready = (p) => p.waitForSelector('.canvas-viewport[aria-busy=false]');
async function download(p, name) {
  const [file] = await Promise.all([p.waitForEvent('download'), button(p, name).click()]);
  return readFile(await file.path());
}
const save = async (p) => JSON.parse(await download(p, 'Сохранить проект'));
async function screen(p, data, x, y) {
  await canvas(p).scrollIntoViewIfNeeded();
  const box = await canvas(p).boundingBox();
  return [box.x + x / data.width * box.width, box.y + y / data.height * box.height];
}
const overlap = (p, x, y, w, h) => p.x < x + w && p.x + p.w > x && p.y < y + h && p.y + p.h > y;

function free(map, w, h) {
  for (let y = 0; y + h < map.height; y++) for (let x = 0; x + w < map.width; x++) {
    if (!map.cells.slice(y, y + h).every((r) => r.slice(x, x + w).every((c) => c.terrain === 'floor'))) continue;
    if (map.crypt.some((p) => overlap(p, x, y, w, h))) continue;
    return { x: x + Math.floor((w - 1) / 2), y: y + Math.floor((h - 1) / 2) };
  }
  throw new Error('No free floor for test stamp');
}

async function main() {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 920 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(base); await ready(p);
    const initial = await save(p);
    assert.equal(initial.gen.biome, 'dungeon');
    assert.ok(initial.map.crypt.length > 25);
    assert.ok(initial.map.crypt.some((item) => item.hidden));
    assert.ok(initial.map.crypt.some((item) => item.kind === 'chasm'));
    assert.ok(initial.map.cryptRooms.some((item) => item.theme === 'sanctum'));
    const titles = new Set();
    const perGroup = [];
    for (const group of ['Опасности', 'Погребение', 'Реликвии', 'Обстановка']) {
      await button(p, group).click();
      await p.waitForFunction(() => [...document.querySelectorAll('.crypt-grid img')].every((img) => img.complete && img.naturalWidth > 0));
      const groupTitles = await p.locator('.crypt-grid button').evaluateAll((tags) => tags.map((x) => x.title));
      perGroup.push(groupTitles.length);
      groupTitles.forEach((title) => titles.add(title));
    }
    for (const count of perGroup) assert.ok(count >= 20, `В категории только ${count} предметов`);
    assert.ok(titles.size >= 80, `Всего ${titles.size} предметов`);
    const masters = await png(p);
    await button(p, 'Метки ведущего').click();
    const players = await png(p);
    assert.ok(masters !== players);
    assert.equal((await save(p)).render.showSecrets, false);
    const exported = await download(p, 'Экспорт PNG');
    const coverage = await canvas(p).evaluate(async (node, data) => {
      const img = new Image(); img.src = data; await img.decode();
      const scratch = document.createElement('canvas'); scratch.width = node.width; scratch.height = node.height;
      const ctx = scratch.getContext('2d'); ctx.drawImage(img, 0, 0);
      const a = ctx.getImageData(0, 0, node.width, node.height).data, b = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
      let changes = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 9) changes++;
      return changes / a.length;
    }, `data:image/png;base64,${exported.toString('base64')}`);
    assert.ok(coverage < .0005, `Player export matches the hidden-marker preview (${coverage})`);
    await button(p, 'Метки ведущего').click();
    const shownAgain = await png(p);
    assert.ok(shownAgain !== players);
    assert.equal((await save(p)).render.showSecrets, true);
    await button(p, 'Найти').click();
    await p.locator('.house-highlight').waitFor();
    await button(p, 'Вписать в окно').click();

    await button(p, 'Погребение').click();
    await button(p, 'Скелет').click(); await p.keyboard.press('KeyQ');
    const skeleton = free(initial.map, 1, 1);
    const spot = await screen(p, initial.map, skeleton.x + .5, skeleton.y + .5);
    await p.mouse.move(...spot);
    assert.equal(await p.locator('[data-stamp=ready]').count(), 1);
    await p.mouse.click(...spot);
    const placed = (await save(p)).map.crypt.at(-1);
    assert.deepEqual(placed, { ...skeleton, kind: 'skeleton', rotation: 90, w: 1, h: 1, variant: initial.map.crypt.length % 4, source: 'manual' });
    await p.mouse.click(...spot, { button: 'right' });
    assert.equal((await save(p)).map.crypt.length, initial.map.crypt.length);
    await button(p, 'Отменить').click();
    await button(p, 'Опасности').click();
    await button(p, 'Нажимная плита').click();
    const trapCell = free((await save(p)).map, 1, 1);
    await p.mouse.click(...await screen(p, initial.map, trapCell.x + .5, trapCell.y + .5));
    const withTrap = await save(p);
    assert.equal(withTrap.map.crypt.at(-1).hidden, true);

    await p.getByText('Авторасстановка', { exact: true }).click();
    await p.getByRole('slider', { name: 'Насыщенность деталями' }).fill('0');
    await button(p, 'Автоматические ловушки').click();
    await button(p, 'Пропасти и провалы').click();
    await button(p, 'Обставить склеп заново').click();
    const onlyManual = await save(p);
    assert.deepEqual(onlyManual.map.crypt.slice(0, 2), [placed, withTrap.map.crypt.at(-1)]);
    assert.ok(onlyManual.map.crypt.length > 2, 'Базовый набор остаётся при детализации 0');
    assert.ok(onlyManual.map.crypt.slice(2).every((item) => item.source === 'layout'));
    assert.deepEqual(onlyManual.map.cells, withTrap.map.cells);
    await button(p, 'Отменить').click();
    assert.deepEqual((await save(p)).map.crypt, withTrap.map.crypt);
    await p.reload(); await ready(p);
    assert.deepEqual((await save(p)).map.crypt, withTrap.map.crypt);
    await p.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'crypt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(onlyManual)) });
    await p.getByText('Проект открыт', { exact: true }).waitFor();
    assert.deepEqual((await save(p)).map, onlyManual.map);
    console.log('Crypt: 32 loaded assets, GM/player PNG, room focus, stamping, eraser, undo, restyling and JSON passed');

    await openTown(p);
    const town = await save(p);
    const inn = town.map.buildings.find((item) => item.kind === 'tavern');
    assert.ok(inn);
    await p.getByText('Свои спрайты', { exact: true }).click();
    await p.getByLabel('Тип импортируемой мебели').selectOption('stool');
    const file = await p.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#458279'; ctx.beginPath(); ctx.arc(40, 40, 37, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d2a75e'; ctx.fillRect(31, 18, 17, 44); return canvas.toDataURL().split(',')[1];
    });
    await p.getByLabel('Выбрать спрайт мебели').setInputFiles({ name: 'Мой бирюзовый табурет.png', mimeType: 'image/png', buffer: Buffer.from(file, 'base64') });
    await p.getByText('Спрайт добавлен в проект', { exact: true }).waitFor();
    const imported = await save(p);
    assert.equal(imported.map.furnitureSprites.length, 1);
    assert.equal(imported.map.furnitureSprites[0].kind, 'stool');
    assert.match(imported.map.furnitureSprites[0].data, /^data:image\/(?:webp|png);base64,/);
    await button(p, 'Светлый ясень').click();
    let placement;
    for (const [x, y] of [[1.5, 6.5], [4.5, 6.5], [7, 6], [9, 6], [2, 4.5], [5, 4.5], [6, 4]]) {
      const pos = await screen(p, town.map, inn.x + x, inn.y + y);
      await p.mouse.move(...pos);
      if (await p.locator('[data-furniture-preview=ready]').count()) { placement = pos; break; }
    }
    assert.ok(placement);
    await p.mouse.click(...placement);
    const furniture = await save(p);
    assert.equal(furniture.map.buildings.find((item) => item.kind === 'tavern').furniture.at(-1).finish, 'ash');
    assert.equal(furniture.map.buildings.find((item) => item.kind === 'tavern').furniture.at(-1).sprite, imported.map.furnitureSprites[0].id);
    await p.reload(); await ready(p);
    assert.deepEqual((await save(p)).map.furnitureSprites, furniture.map.furnitureSprites);
    await p.getByLabel('Выбрать файл проекта').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(furniture)) });
    await p.getByText('Проект открыт', { exact: true }).waitFor();
    assert.deepEqual((await save(p)).map, furniture.map);
    assert.deepEqual(errors, []);
    console.log('Furniture: transparent PNG import, finish, placement, local persistence and independent JSON passed');

    const mobile = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(base); await ready(mobile);
    await mobile.locator('.mobile-object-tools').getByRole('button', { name: 'Склеп', exact: true }).tap();
    await button(mobile, 'Скелет').tap();
    const point = await screen(mobile, initial.map, skeleton.x + .5, skeleton.y + .5);
    await mobile.touchscreen.tap(...point);
    await mobile.waitForFunction(() => JSON.parse(localStorage.getItem('battlemap-studio-project-v1'))?.map?.crypt?.some((p) => p.source === 'manual'));
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('Mobile: crypt palette opens and places objects by touch');
  } finally { await b.close(); }
}

async function openTown(p) {
  p.once('dialog', (d) => d.accept());
  await button(p, 'Генерация').click();
  await p.getByLabel('Пресет', { exact: true }).selectOption({ label: 'Торговый город' });
  await p.getByLabel('Seed', { exact: true }).fill('1337');
  await p.getByRole('slider', { name: 'Ширина (клеток)' }).fill('48');
  await p.getByRole('slider', { name: 'Высота (клеток)' }).fill('32');
  await p.getByRole('slider', { name: 'Плотность застройки' }).fill('58');
  await button(p, 'Редактор').click();
  await button(p, 'Интерьеры').click();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });