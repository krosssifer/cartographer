// Real Chromium / real Vite modules / real image assets. TEST_URL may select a Vite host.
// Writes ignored, reproducible evidence under artifacts/functional-scenes-test/.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = 'artifacts/functional-scenes-test';
const save = (name, base64) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(base64, 'base64')); };
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
    await page.waitForSelector('.canvas-viewport[aria-busy=false]', { state: 'attached' });
    const catalogue = await page.evaluate(async () => {
      window.sceneAudit = {
        scenes: await import('/src/lib/gen/urban/scenes.ts'),
        placement: await import('/src/lib/gen/urban/scenePlacement.ts'),
        kit: await import('/src/lib/settlementKit.ts'),
        renderer: await import('/src/lib/render.ts'),
        painter: await import('/src/lib/settlementPaint.ts'),
        assets: await import('/src/lib/assets.ts'),
        looks: await import('/src/lib/spriteLook.ts'),
        gen: await import('/src/lib/generator.ts'),
        presets: await import('/src/lib/presets.ts'),
        debug: await import('/src/lib/gen/urban/debug.ts'),
        project: await import('/src/lib/project.ts'),
      };
      const a = window.sceneAudit;
      await Promise.all([a.assets.loadAssets(), a.assets.loadMarketAssets()]);
      return a.scenes.FUNCTIONAL_SCENES.map(s => ({ id: s.id, label: s.label, plotFunctions: s.plotFunctions, courtyardKinds: s.courtyardKinds, districts: s.districts,
        variants: s.variants.map(v => ({ id: v.id, anchor: v.anchor, parts: v.parts, access: v.access, bounds: a.scenes.functionalVariantBounds(v) })),
        assets: [...new Set(s.variants.flatMap(v => [v.anchor, ...v.parts].map(p => p.kind)))].map(kind => { const spec = a.kit.CIVIC_KIT[kind], image = a.assets.getAssets().art[spec.art]; return { kind, art: spec.art, width: spec.w, height: spec.h, loaded: !!image?.naturalWidth }; }),
      }));
    });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'catalogue.json'), JSON.stringify(catalogue, null, 2));
    const results = [];
    for (const { id } of catalogue) {
      console.log('Forced scene', id);
      const r = await page.evaluate(async (id) => {
        const a = window.sceneAudit, scene = a.scenes.FUNCTIONAL_SCENES.find(s => s.id === id);
        const yard = { x: 2, y: 2, w: 24, h: 24 };
        const plot = { id: 17, polygon: [{x:0,y:0},{x:32,y:0},{x:32,y:32},{x:0,y:32}], bounds: {x:0,y:0,w:32,h:32}, yardRect: yard,
          courtyardKind: scene.courtyardKinds[0], districtIndex: 0, districtType: scene.districts[0], zone: 'residential', size: 1024, frontage: 32, depth: 32, orientation: 0, roadLevel: 2, wealth: .5, age: 'inner_city', fn: scene.plotFunctions[0] };
        const building = { x: 27, y: 4, w: 3, h: 4, style: 'town', kind: 'house', roof: 0, door: {x:27,y:6}, facing: 270 };
        const board = new a.placement.FunctionalSceneBoard(32, 32);
        const search = board.place({ seed:42, plot, building, zone:yard, scenes:[scene], trace:true, check: rect => a.kit.intersects(rect,building) ? 'collision' : null });
        if (!search.placement) return { id, error: 'placement failed', search };
        const placement = search.placement;
        const civic = [placement.anchor,...placement.parts].map(p => ({ kind:p.kind,x:p.x,y:p.y,w:p.w,h:p.h,rotation:p.rotation,variant:0,source:'layout' }));
        const settings = {...a.presets.DEFAULT_GEN, biome:'town',settlement:'town',settlementType:'trade_town',width:32,height:32,seed:42,density:1,publicSpaces:true};
        const base = a.gen.generateMap(settings);
        const map = { ...base, cells:base.cells.map(row => row.map(cell => ({...cell,terrain:'grass',height:.5}))), buildings:[building], civic, trees:[], rocks:[], structures:[], chests:[], lights:[],
          plan: { ...base.plan, roads:[],river:[],bridges:[],settlement: { ...base.plan.settlement, debug: { ...base.plan.settlement.debug, scenes:[placement],sceneFailures:[] } } } };
        const rs = { ...a.presets.DEFAULT_RENDER,cellSize:32,showGrid:false,showDebug:false,showDecor:false,showTrees:false,showRocks:false,timeOfDay:'day' };
        const canvas=document.createElement('canvas'); const draw = m => { a.renderer.renderMap(canvas,m,rs,42); return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; };
        const full=draw(map), diag=a.painter.getCivicRenderDiagnostics(map), pngNoDebug=canvas.toDataURL('image/jpeg',.82).split(',')[1];
        const parts=[];
        for (let i=0;i<civic.length;i++) {
          const item=civic[i], without={...map,civic:civic.filter((_,j)=>i!==j)}; const baseline=draw(without);
          let changed=0, within=0; let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
          for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++){const k=(y*canvas.width+x)*4;if(full[k]!==baseline[k]||full[k+1]!==baseline[k+1]||full[k+2]!==baseline[k+2]||full[k+3]!==baseline[k+3]){changed++; if(x>=item.x*32&&x<(item.x+item.w)*32&&y>=item.y*32&&y<(item.y+item.h)*32)within++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}
          const art=a.kit.civicArt(item), look=a.looks.spriteLook(item.x*.05+7.3,item.y*.05+2.9,47), image=a.assets.artPick(art,look.variant);
          let opaque=0;if(image){const tmp=document.createElement('canvas');tmp.width=image.naturalWidth;tmp.height=image.naturalHeight;const c=tmp.getContext('2d');c.drawImage(image,0,0);const data=c.getImageData(0,0,tmp.width,tmp.height).data;for(let j=3;j<data.length;j+=4)if(data[j])opaque++;}
          parts.push({kind:item.kind,required:i===0||placement.parts[i-1].required,rotation:item.rotation,rect:{x:item.x,y:item.y,w:item.w,h:item.h},art,assetLoaded:!!image?.naturalWidth,assetNontransparentPixels:opaque,changedPixels:changed,changedInsideFootprint:within,diffBounds:{minX,minY,maxX,maxY}});
        }
        draw(map);
        const sx=Math.max(0,Math.floor((placement.bounds.x-2)*32)),sy=Math.max(0,Math.floor((placement.bounds.y-2)*32));
        const sw=Math.min(canvas.width-sx,Math.ceil((placement.bounds.w+4)*32)),sh=Math.min(canvas.height-sy,Math.ceil((placement.bounds.h+4)*32));
        const crop=document.createElement('canvas');crop.width=sw;crop.height=sh;crop.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
        const cropNoDebug=crop.toDataURL('image/jpeg',.88).split(',')[1];
        const flags=Object.fromEntries(Object.keys(a.debug.DEFAULT_SETTLEMENT_DEBUG).map(k=>[k,false]));flags.scenes=true;
        a.debug.drawSettlementDebugOverlay(canvas.getContext('2d'),map,32,flags);
        const debug=canvas.toDataURL('image/jpeg',.82).split(',')[1];crop.getContext('2d').clearRect(0,0,sw,sh);crop.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
        const cropDebug=crop.toDataURL('image/jpeg',.88).split(',')[1];
        const project=a.project.parseProject(JSON.parse(JSON.stringify({version:1,gen:settings,render:rs,map})));
        return {id,plot,building,placement,diag,parts,serialization:!!project && JSON.stringify(project.map.civic)===JSON.stringify(map.civic),pngNoDebug,cropNoDebug,debug,cropDebug};
      }, id);
      if (r.error) { results.push(r); continue; }
      for (const [field, dir] of [['pngNoDebug','without-debug'],['cropNoDebug','rendered'],['debug','placement'],['cropDebug','catalog']]) {save(`${dir}/${id}.jpg`,r[field]);delete r[field];}
      results.push(r);
      fs.writeFileSync(path.join(root,'forced-results.json'), JSON.stringify(results,null,2));
    }
    assert.deepEqual(errors, []);
    const failed=results.filter(r=>r.error || !r.serialization || r.diag.skippedMissingAsset || r.diag.renderedSprite !== r.parts.length || r.parts.some(p=>!p.assetLoaded||!p.assetNontransparentPixels||!p.changedInsideFootprint));
    console.log(`Forced real Canvas: ${results.length-failed.length}/${results.length} with sprite diagnostics, JSON and per-component changed pixels`);
    if (failed.length) { console.error('Failures:', failed.map(r=>r.id)); process.exitCode=1; }
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1});
