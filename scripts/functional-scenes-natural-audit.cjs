// Natural 8-scenario x 3-seed browser audit. Start Vite first.
// No placement probabilities or production generation rules are modified.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const root = 'artifacts/functional-scenes-test/natural';
const cases = [
  {name:'small_village',type:'small_village'}, {name:'medium_village',type:'large_village'},
  {name:'large_city',type:'large_city'}, {name:'port',type:'port'}, {name:'craft',type:'craft_town'},
  {name:'noble',type:'small_city',character:'noble'}, {name:'poor',type:'small_city',character:'poor'},
  {name:'mixed',type:'large_city',character:'mixed'},
];
const save = (name,data) => { const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.from(data,'base64')); };
(async()=>{const b=await chromium.launch();try{const page=await b.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.TEST_URL??'http://localhost:5173');await page.waitForSelector('.canvas-viewport[aria-busy=false]',{state:'attached'});
await page.evaluate(async()=>{window.audit={scenes:await import('/src/lib/gen/urban/scenes.ts'),placement:await import('/src/lib/gen/urban/scenePlacement.ts'),planner:await import('/src/lib/gen/settlementPlanner.ts'),gen:await import('/src/lib/generator.ts'),presets:await import('/src/lib/presets.ts'),types:await import('/src/lib/gen/settlementTypes.ts'),render:await import('/src/lib/render.ts'),paint:await import('/src/lib/settlementPaint.ts'),assets:await import('/src/lib/assets.ts'),debug:await import('/src/lib/gen/urban/debug.ts'),project:await import('/src/lib/project.ts')};await Promise.all([window.audit.assets.loadAssets(),window.audit.assets.loadMarketAssets()]);});
const results=[];fs.mkdirSync(root,{recursive:true});
const selectedCases = process.env.EXTRA_ONLY ? [{ name: 'port-extra', type: 'port' }] : cases;
const seeds = process.env.EXTRA_ONLY ? [1, 6] : [11, 42, 87];
for(const scenario of selectedCases) for(const seed of seeds) {
  console.log('Natural',scenario.name,seed);
  const r=await page.evaluate(async({scenario,seed})=>{const a=window.audit, style=a.types.SETTLEMENT_TYPES.find(t=>t.id===scenario.type).style;
    const settings={...a.presets.DEFAULT_GEN,biome:style,settlement:style,settlementType:scenario.type,settlementCharacter:scenario.character??'auto',width:100,height:80,seed,density:1,urbanDressing:1,river:true,publicSpaces:true};
    let t=performance.now(),plan=a.planner.buildTypedPlan(settings,style,true),planMs=performance.now()-t;t=performance.now();const map=a.gen.generateMap(settings),generationMs=performance.now()-t;
    const active=map.plan?.settlement?.debug?.scenes??[];const eligible=plan.placedPlots.map((p,i)=>({plot:p,building:plan.plots[i],secondary:plan.secondaryFlags[i]})).filter(x=>x.plot?.yardRect&&!x.secondary);
    const stats=a.scenes.FUNCTIONAL_SCENES.map(s=>({id:s.id,eligible:eligible.filter(p=>a.placement.functionalSceneApplies(p.plot,p.building,s)).length, afterRepair:plan.functionalScenes.filter(g=>g.placement.sceneId===s.id).length, mapData:active.filter(p=>p.sceneId===s.id).length}));
    const canvas=document.createElement('canvas'),rs={...a.presets.DEFAULT_RENDER,cellSize:12,showGrid:false,showDebug:false};t=performance.now();a.render.renderMap(canvas,map,rs,seed);const renderMs=performance.now()-t;
    const ctx=canvas.getContext('2d'),full=ctx.getImageData(0,0,canvas.width,canvas.height).data,diag=a.paint.getCivicRenderDiagnostics(map);const image=canvas.toDataURL('image/jpeg',.67).split(',')[1];
    const scenes=[];
    for(const scene of active){const parts=[scene.anchor,...scene.parts];const matches=parts.map(p=>map.civic.findIndex(c=>c.kind===p.kind&&c.x===p.x&&c.y===p.y&&c.w===p.w&&c.h===p.h&&c.rotation===p.rotation));let visible=[];
      for(let i=0;i<parts.length;i++){const part=parts[i],index=matches[i];if(index<0){visible.push({kind:part.kind,required:part.required,found:false,pixelDiff:0});continue}
        const without={...map,civic:map.civic.filter((_,j)=>j!==index)};a.render.renderMap(canvas,without,rs,seed);const x=part.x*12,y=part.y*12,w=part.w*12,h=part.h*12,small=ctx.getImageData(x,y,w,h).data;let changed=0;
        for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const p=(yy*w+xx)*4,q=((y+yy)*canvas.width+x+xx)*4;if(small[p]!==full[q]||small[p+1]!==full[q+1]||small[p+2]!==full[q+2]||small[p+3]!==full[q+3])changed++}visible.push({kind:part.kind,required:part.required,found:true,pixelDiff:changed});
      }
      scenes.push({sceneId:scene.sceneId,variant:scene.variantId,plotId:scene.plotId,bounds:scene.bounds,components:visible,allRequiredVisible:visible.filter(v=>v.required).every(v=>v.found&&v.pixelDiff>0)});
    }
    a.render.renderMap(canvas,map,rs,seed);const flags=Object.fromEntries(Object.keys(a.debug.DEFAULT_SETTLEMENT_DEBUG).map(k=>[k,false]));flags.scenes=true;a.debug.drawSettlementDebugOverlay(ctx,map,12,flags);const debug=canvas.toDataURL('image/jpeg',.67).split(',')[1];
    const parsed=a.project.parseProject(JSON.parse(JSON.stringify({version:1,gen:settings,render:{...rs,cellSize:16},map})));const roundtrip=!!parsed && JSON.stringify(parsed.map.civic)===JSON.stringify(map.civic);
    return {scenario:scenario.name,settings,planMs,generationMs,renderMs,diag,stats,scenes,roundtrip,repairFailures:plan.report.debug?.sceneFailures?.filter(f=>f.reason==='repair').length??0,image,debug};
  },{scenario,seed});
  save(`${scenario.name}-${seed}.jpg`,r.image);save(`${scenario.name}-${seed}-debug.jpg`,r.debug);delete r.image;delete r.debug;results.push(r);fs.writeFileSync(path.join(root,process.env.EXTRA_ONLY ? 'results-extra.json' : 'results.json'),JSON.stringify(results,null,2));console.log('scenes',r.scenes.length,'visible',r.scenes.filter(s=>s.allRequiredVisible).length,'ms',r.renderMs.toFixed(0));
}
if(errors.length)throw new Error(JSON.stringify(errors));console.log('Natural cases',results.length,'roundtrip failures',results.filter(r=>!r.roundtrip).length);if(results.some(r=>!r.roundtrip || r.diag.skippedMissingAsset || r.scenes.some(s=>!s.allRequiredVisible)))process.exitCode=1;
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
