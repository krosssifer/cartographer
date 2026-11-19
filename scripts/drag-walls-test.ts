import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateMap } from '../src/lib/generator';
import type { GenSettings, MapData } from '../src/lib/types';

const url = process.env.TEST_URL ?? 'http://localhost:5173';
const KEY = 'battlemap-studio-project-v1';
const wait = (p: { waitForTimeout: (ms: number) => unknown }, ms = 600) => p.waitForTimeout(ms);
const storage = (p: { evaluate: (fn: (key: string) => unknown, arg: string) => Promise<unknown> }) =>
  p.evaluate((key: string) => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY) as Promise<{
    gen: GenSettings;
    map: MapData | null;
  }>;
const canvas = (p: { locator: (selector: string) => { first: () => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } } }) => p.locator('canvas').first();

async function main() {
  fs.mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.canvas-viewport[aria-busy="false"]');
    await page.waitForFunction((key: string) => !!localStorage.getItem(key), KEY);
    await wait(page, 350);

    const session = await storage(page);
    const generated = generateMap(session.gen);
    let doubles = 0;
    for (let y = 0; y < generated.height; y++) for (let x = 0; x < generated.width; x++) {
      if (generated.cells[y][x].terrain !== 'wall') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= generated.width || ny >= generated.height) continue;
        if (generated.cells[ny][nx].terrain !== 'wall') continue;
        const a = generated.cells[y - dy]?.[x - dx]?.terrain;
        const b = generated.cells[ny - dy]?.[nx - dx]?.terrain;
        if ((a === 'floor' || a === 'door') && (b === 'floor' || b === 'door')) { doubles++; break; }
      }
    }
    assert.equal(doubles, 0, `Найдено ${doubles} двойных участков стены`);
    await canvas(page).screenshot({ path: 'artifacts/walls.jpg' });

    let spot: { x: number; y: number } | null = null;
    for (let y = 2; y < generated.height - 2 && !spot; y++) for (let x = 2; x < generated.width - 3; x++) {
      if (generated.cells[y][x].terrain === 'floor' && generated.cells[y][x + 1]?.terrain === 'floor'
        && !(generated.crypt ?? []).some((o) => o.x <= x && o.x + o.w > x && o.y <= y && o.y + o.h > y)) {
        spot = { x, y }; break;
      }
    }
    assert.ok(spot, 'Нет свободной клетки пола');
    const box = (await canvas(page).boundingBox())!;
    const xy = (tx: number, ty: number) => [box.x + (tx + 0.5) / generated.width * box.width, box.y + (ty + 0.5) / generated.height * box.height] as const;

    await page.keyboard.press('c');
    await page.mouse.click(...xy(spot.x, spot.y));
    await page.waitForFunction((key: string) => (JSON.parse(localStorage.getItem(key) ?? 'null')?.map?.chests?.length ?? 0) === 1, KEY);
    let data = await storage(page);
    assert.equal(data.map!.chests.length, 1, 'Сундук не создан');
    const start = { ...data.map!.chests[0] };

    await page.keyboard.press('v');
    await page.mouse.click(...xy(Math.floor(start.x), Math.floor(start.y)));
    await wait(page, 350);
    assert.ok(await page.locator('.object-size-panel').count(), 'Панель выделенного объекта не открылась');

    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await wait(page);
    data = await storage(page);
    assert.deepEqual(data.map!.chests[0], start, 'Стрелки изменили положение объекта');

    await page.keyboard.press('b');
    const before = { ...data.map!.chests[0] };
    const [cx, cy] = xy(Math.floor(before.x), Math.floor(before.y));
    const stepX = box.width / generated.width;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + stepX * 1.7, cy, { steps: 8 });
    await wait(page, 120);
    await page.screenshot({ path: 'artifacts/drag-preview.jpg' });
    await page.mouse.up({ button: 'left' });
    await wait(page);
    data = await storage(page);
    assert.ok(data.map!.chests[0].x > before.x + 0.8, `Сундук не переместился: ${before.x} → ${data.map!.chests[0].x}`);
    assert.equal(data.map!.chests[0].y, before.y);
    assert.deepEqual(errors, []);
    console.log('Single-row walls, no arrow movement, LMB drag with another tool passed');
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
