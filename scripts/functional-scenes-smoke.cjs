// Real UI smoke: Vite must already be running. No fixed sleeps.
// Default Playwright action timeouts are intentionally unchanged; for an
// investigative slow-machine run only, set DIAGNOSTIC_TIMEOUT_MS explicitly.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {readFile} = require('node:fs/promises');
const base=process.env.TEST_URL??'http://localhost:5173', out='artifacts/functional-scenes-test/browser';
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function save(page){const [file]=await Promise.all([page.waitForEvent('download'),button(page,'Сохранить проект').click()]);return JSON.parse(await readFile(await file.path()));}
(async()=>{const browser=await chromium.launch();const errors=[];let stage='start';try{const p=await browser.newPage({viewport:{width:1440,height:940}});if(process.env.DIAGNOSTIC_TIMEOUT_MS){const ms=Number(process.env.DIAGNOSTIC_TIMEOUT_MS);if(!Number.isFinite(ms)||ms<=0)throw new Error('Invalid diagnostic timeout');p.setDefaultTimeout(ms)}p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});p.on('requestfailed',r=>errors.push(`${r.url()} ${r.failure()?.errorText}`));
fs.mkdirSync(out,{recursive:true});await p.goto(base);await p.waitForSelector('.canvas-viewport[aria-busy=false]',{state:'attached'});
stage='select preset';await button(p,'Генерация').click();await p.getByLabel('Пресет',{exact:true}).selectOption({label:'Портовый город'});
stage='generate fixture';await p.getByLabel('Seed',{exact:true}).fill('6');await p.getByRole('slider',{name:'Плотность застройки',exact:true}).fill('100');
stage='save generated';const original=await save(p),scenes=original.map.plan?.settlement?.debug?.scenes??[];assert.ok(scenes.length>0,'Expected real functional scenes');for(const scene of scenes)for(const part of [scene.anchor,...scene.parts])assert.ok(original.map.civic.some(c=>c.kind===part.kind&&c.x===part.x&&c.y===part.y&&c.rotation===part.rotation));
stage='debug on';await p.locator('summary').filter({hasText:'Сетка и вид'}).click();await button(p,'Разметка генерации (debug)').click();await button(p,'Debug: Функциональные сцены').click();assert.equal(await button(p,'Debug: Функциональные сцены').getAttribute('aria-pressed'),'true');await p.locator('.canvas-viewport').scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/debug.png`});
stage='debug off';await button(p,'Разметка генерации (debug)').click();assert.equal(await button(p,'Разметка генерации (debug)').getAttribute('aria-pressed'),'false');await p.locator('.canvas-viewport').scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/without-debug.png`});
stage='zoom';const value=await p.locator('.zoom-value').innerText();await button(p,'Увеличить').click();assert.notEqual(await p.locator('.zoom-value').innerText(),value);
stage='load project';await p.getByLabel('Выбрать файл проекта').setInputFiles({name:'settlement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await p.getByText('Проект открыт',{exact:true}).waitFor();const loaded=await save(p);assert.deepEqual(loaded.map.civic,original.map.civic);assert.deepEqual(loaded.map.plan.settlement.debug.scenes,scenes);assert.deepEqual(errors,[]);await p.screenshot({path:`${out}/after-import.png`});fs.writeFileSync(`${out}/results.json`,JSON.stringify({seed:original.gen.seed,settings:original.gen,scenes:scenes.map(s=>({sceneId:s.sceneId,variant:s.variantId,plotId:s.plotId})),errors},null,2));console.log('UI preset, generation, scene components, debug on/off, zoom, JSON save/load passed:',scenes.length);
}catch(e){console.error('UI smoke stage:',stage,'errors:',errors);throw e}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
