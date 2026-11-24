// Reproducible real-asset Canvas visual audit. Output is ignored under artifacts/.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:5174');
    await page.waitForSelector('.canvas-viewport[aria-busy=false]', { state: 'attached' });
    await page.evaluate(async () => {
      window.dungeonAudit = { gen: await import('/src/lib/generator.ts'), presets: await import('/src/lib/presets.ts'), renderer: await import('/src/lib/render.ts'), assets: await import('/src/lib/assets.ts') };
      await window.dungeonAudit.assets.loadAssets();
    });
    const cases = [
      { id:'classic-tomb-42', patch:{seed:42,cryptArchetype:'tomb',dungeonLayout:'classic',dungeonArchetype:undefined} },
      { id:'classic-temple-3', patch:{seed:3,cryptArchetype:'temple',dungeonLayout:'classic',dungeonArchetype:undefined} },
      { id:'varied-tomb-42', patch:{seed:42,cryptArchetype:'tomb',dungeonLayout:'varied',dungeonArchetype:undefined} },
      { id:'varied-archive-11', patch:{seed:11,cryptArchetype:'archive',dungeonLayout:'varied',dungeonArchetype:undefined} },
      { id:'complex-fortress-3', patch:{seed:3,dungeonArchetype:'fortress',dungeonCondition:'reclaimed'} },
      { id:'complex-tomb-42', patch:{seed:42,dungeonArchetype:'tomb',dungeonCondition:'ruined'} },
      { id:'complex-laboratory-101', patch:{seed:101,dungeonArchetype:'laboratory',dungeonCondition:'abandoned'} },
      { id:'complex-sewer-11', patch:{seed:11,dungeonArchetype:'sewer',dungeonCondition:'flooded'} },
    ];
    const summary = [];
    for (const c of cases) {
      const result = await page.evaluate(({patch}) => {
        const a = window.dungeonAudit;
        const gen = {...a.presets.DEFAULT_GEN, biome:'dungeon', width:64,height:46,rooms:8,dungeonLevels:1,...patch};
        const map = a.gen.generateMap(gen), canvas = document.createElement('canvas');
        const rs = {...a.presets.DEFAULT_RENDER,cellSize:24,showGrid:false,showDebug:false,showDungeonDressingDebug:false};
        a.renderer.renderMap(canvas,map,rs,gen.seed);
        const normal = canvas.toDataURL('image/jpeg',.84).split(',')[1];
        a.renderer.renderMap(canvas,map,{...rs,showDungeonDressingDebug:true},gen.seed);
        const debug = canvas.toDataURL('image/jpeg',.8).split(',')[1];
        const quality=map.plan?.report?.dungeonDressing;
        return { normal,debug, rooms:map.plan?.rooms?.length ?? map.structures.length, objects:map.crypt?.length ?? 0,
          scenes:new Set((map.crypt??[]).filter(o=>o.dungeonScene).map(o=>o.dungeonScene.groupId)).size,
          clusters:new Set((map.crypt??[]).filter(o=>o.dungeonCluster).map(o=>o.dungeonCluster.id)).size,
          errors:quality?.errors ?? [], warnings:quality?.warnings ?? [], gen };
      },c);
      for (const mode of ['normal','debug']) {fs.writeFileSync(path.join('artifacts/dungeon-dressing',`${c.id}-${mode}.jpg`),Buffer.from(result[mode],'base64'));delete result[mode];}
      summary.push({id:c.id,...result}); console.log(c.id, result.rooms, result.objects, result.scenes, result.clusters, result.errors.length);
    }
    fs.writeFileSync('artifacts/dungeon-dressing/summary.json', JSON.stringify(summary,null,2));
    if(errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1});
