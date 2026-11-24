// Diagnostic only: profile the real preset selection without a Playwright
// action deadline. This does not change the application's or smoke test's timeout.
const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
    await page.waitForSelector('.canvas-viewport[aria-busy=false]', { state: 'attached' });
    await page.getByRole('button', { name: 'Генерация', exact: true }).click();
    await page.evaluate(() => { Math.random = () => 1337 / 99999; });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    const start = Date.now();
    await page.getByLabel('Пресет', { exact: true }).selectOption({ label: 'Торговый город' }, { timeout: 0 });
    await page.getByRole('slider', { name: 'Ширина (клеток)', exact: true }).waitFor({ state: 'attached', timeout: 0 });
    const ms = Date.now() - start;
    const { profile } = await cdp.send('Profiler.stop');
    const counts = {};
    for (const id of profile.samples ?? []) counts[id] = (counts[id] ?? 0) + 1;
    const index = new Map(profile.nodes.map(node => [node.id, node]));
    const parents = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
    const stack = id => { const result = []; while (id && result.length < 12) { const node = index.get(id); if (!node) break; result.push(`${node.callFrame.functionName || '(anonymous)'}:${node.callFrame.lineNumber + 1}`); id = parents.get(id); } return result; };
    const nodes = profile.nodes.filter(n => counts[n.id]).map(n => ({ samples: counts[n.id], fn: n.callFrame.functionName, url: n.callFrame.url, line: n.callFrame.lineNumber + 1, stack: stack(n.id) })).sort((a, b) => b.samples - a.samples).slice(0, 25);
    fs.mkdirSync('artifacts/functional-scenes-test/browser', { recursive: true });
    fs.writeFileSync('artifacts/functional-scenes-test/browser/preset-profile-summary.json', JSON.stringify({ ms, samples: profile.samples?.length, nodes }, null, 2));
    console.log(JSON.stringify({ ms, nodes: nodes.slice(0, 8) }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
