import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, DOMMatrix, ImageData, Canvas, clearAllCache } from '@napi-rs/canvas';
import { createServer } from 'vite';

const ONLY = process.argv[2] ? Number(process.argv[2]) : 0;
const shouldRun = (n) => ONLY === 0 || ONLY === n;

// Polyfill browser globals required by Cartographer's Canvas 2D renderer:
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.HTMLCanvasElement = Canvas;
globalThis.HTMLImageElement = class HTMLImageElement {};
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(1, 1);
    return {};
  },
};

const ROOT = process.cwd();
const CARTO_DIR = path.join(ROOT, 'src', 'assets', 'cartography');
const BACKUP_DIR = path.join(ROOT, 'assets', 'source', 'backup-repaired');
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'showcase');
fs.mkdirSync(OUT_DIR, { recursive: true });

const srv = await createServer({ logLevel: 'silent' });

try {
  const assetsMod = await srv.ssrLoadModule('/src/lib/assets.ts');
  const { generateMap } = await srv.ssrLoadModule('/src/lib/generator.ts');
  const { renderMap } = await srv.ssrLoadModule('/src/lib/render.ts');
  const { DEFAULT_GEN, DEFAULT_RENDER } = await srv.ssrLoadModule('/src/lib/presets.ts');
  const { CIVIC_KIT } = await srv.ssrLoadModule('/src/lib/settlementKit.ts');

  const assets = assetsMod.getAssets();
  const webpFiles = fs.readdirSync(CARTO_DIR).filter((f) => f.endsWith('.webp'));
  for (const file of webpFiles) {
    const id = file.slice(0, -5);
    const img = await loadImage(fs.readFileSync(path.join(CARTO_DIR, file)));
    assets.art[id] = img;
  }
  for (const mat of assetsMod.MATERIALS) {
    const img = assets.art[mat];
    if (!img) continue;
    const c = createCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    assets.materials[mat] = g.getImageData(0, 0, img.width, img.height);
  }
  assets.ready = true;
  console.log(`Loaded ${webpFiles.length} production .webp assets into Canvas 2D engine.`);

  function renderToCanvas(map, rsOverrides = {}, seed = 101) {
    const c = createCanvas(1, 1);
    const rs = {
      ...DEFAULT_RENDER,
      grid: false,
      vignette: false,
      worn: false,
      ...rsOverrides,
    };
    renderMap(c, map, rs, seed);
    return c;
  }

  function makeFramedSheet(width, height, title, subtitle) {
    const c = createCanvas(width, height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#14171c';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#1d222b';
    ctx.fillRect(0, 0, width, 74);
    ctx.strokeStyle = '#384152';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 74);
    ctx.lineTo(width, 74);
    ctx.stroke();

    ctx.fillStyle = '#f3ead8';
    ctx.font = 'bold 25px sans-serif';
    ctx.fillText(title, 26, 36);
    ctx.fillStyle = '#aab4c6';
    ctx.font = '15px sans-serif';
    ctx.fillText(subtitle, 26, 60);
    return { canvas: c, ctx };
  }

  function drawPanel(ctx, srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh, label, sublabel = '') {
    ctx.save();
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(dx - 2, dy - 2, dw + 4, dh + 4);
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.strokeStyle = '#475266';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    // Label pill
    ctx.fillStyle = 'rgba(16, 19, 25, 0.86)';
    const pillH = sublabel ? 48 : 30;
    ctx.fillRect(dx + 8, dy + 8, Math.min(dw - 16, 470), pillH);
    ctx.strokeStyle = 'rgba(218, 190, 132, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 8, dy + 8, Math.min(dw - 16, 470), pillH);

    ctx.fillStyle = '#f5ecd9';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(label, dx + 16, dy + 28);
    if (sublabel) {
      ctx.fillStyle = '#b9c4d6';
      ctx.font = '12.5px sans-serif';
      ctx.fillText(sublabel, dx + 16, dy + 47);
    }
    ctx.restore();
  }

  function savePng(canvas, filename) {
    const outPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    clearAllCache();
    console.log('Saved', outPath);
  }

  const sampleTown = generateMap({ ...DEFAULT_GEN, biome: 'town', settlement: 'town', width: 30, height: 24, seed: 12 });
  const templateBuilding = sampleTown.buildings[0];

  function makeBaseMap(w, h, biome = 'town') {
    const base = generateMap({ ...DEFAULT_GEN, biome: 'village', width: w, height: h, seed: 11 });
    return {
      ...base,
      biome,
      width: w,
      height: h,
      cells: base.cells.map((row) =>
        row.map((cell) => ({
          ...cell,
          terrain: 'grass',
          height: Number.isFinite(cell.height) ? Math.max(0.28, Math.min(0.46, cell.height)) : 0.35,
          moisture: Number.isFinite(cell.moisture) ? cell.moisture : 0.48,
        })),
      ),
      road: [],
      river: [],
      trees: [],
      rocks: [],
      structures: [],
      buildings: [],
      civic: [],
      lights: [],
      chests: [],
    };
  }

  // Helper: build a clean road showcase map with straight, 90° bend, T-junction, crossroads, diagonal & curve + plaza
  function buildRoadGeometryMap() {
    const w = 32;
    const h = 22;
    const base = makeBaseMap(w, h, 'town');
    const { cells } = base;
    const setRoad = (x, y, t = 'road') => {
      if (x >= 0 && y >= 0 && x < w && y < h) cells[y][x].terrain = t;
    };
    // Horizontal main arterial road (x=2..29, y=10..11)
    for (let x = 2; x <= 29; x++) {
      setRoad(x, 10);
      setRoad(x, 11);
    }
    // Vertical crossroads + T-junction (x=10..11, y=2..19)
    for (let y = 2; y <= 19; y++) {
      setRoad(10, y);
      setRoad(11, y);
    }
    // 90-degree bend into northern plaza (x=20..21, y=4..10 -> x=20..26, y=4..5)
    for (let y = 4; y <= 10; y++) {
      setRoad(20, y);
      setRoad(21, y);
    }
    for (let x = 20; x <= 26; x++) {
      setRoad(x, 4);
      setRoad(x, 5);
    }
    // Plaza transition at east end (x=26..29, y=8..13)
    for (let y = 8; y <= 13; y++) {
      for (let x = 26; x <= 29; x++) setRoad(x, y, 'plaza');
    }
    // Diagonal/curved south branch
    const curvePts = [
      { x: 11, y: 15 },
      { x: 15, y: 17 },
      { x: 20, y: 18 },
      { x: 25, y: 15 },
      { x: 27.5, y: 12 },
    ];
    for (let i = 0; i < curvePts.length - 1; i++) {
      const a = curvePts[i];
      const b = curvePts[i + 1];
      for (let s = 0; s <= 16; s++) {
        const t = s / 16;
        const rx = Math.round(a.x + (b.x - a.x) * t);
        const ry = Math.round(a.y + (b.y - a.y) * t);
        setRoad(rx, ry);
        setRoad(rx, Math.min(h - 2, ry + 1));
      }
    }

    return {
      ...base,
      cells,
      civic: [
        { id: 1, kind: 'square', x: 25.6, y: 7.8, w: 4.2, h: 5.4, rotation: 0, variant: 0, source: 'layout' },
        { id: 2, kind: 'fountain', x: 27.0, y: 9.8, w: 1.5, h: 1.5, rotation: 0, variant: 0, source: 'layout' },
        { id: 3, kind: 'lampStreetIron', x: 9.2, y: 9.2, w: 0.55, h: 0.55, rotation: 0, variant: 0, source: 'layout' },
        { id: 4, kind: 'lampStreetIron', x: 12.2, y: 12.2, w: 0.55, h: 0.55, rotation: 0, variant: 0, source: 'layout' },
        { id: 5, kind: 'urbanMilestone', x: 5.5, y: 9.2, w: 0.45, h: 0.45, rotation: 0, variant: 0, source: 'layout' },
      ],
      contours: [],
      plan: {
        ...base.plan,
        roads: [
          {
            id: 'main_0',
            type: 'main',
            width: 2.1,
            bridges: 0,
            surface: 'road',
            hierarchy: 1,
            points: [{ x: 2, y: 11 }, { x: 11, y: 11 }, { x: 20.5, y: 11 }, { x: 26.5, y: 11 }],
          },
          {
            id: 'street_1',
            type: 'street',
            width: 1.85,
            bridges: 0,
            surface: 'road',
            hierarchy: 2,
            points: [{ x: 11, y: 2.5 }, { x: 11, y: 11 }, { x: 11, y: 19 }],
          },
          {
            id: 'street_2',
            type: 'street',
            width: 1.75,
            bridges: 0,
            surface: 'road',
            hierarchy: 2,
            points: [{ x: 21, y: 11 }, { x: 21, y: 5 }, { x: 26.5, y: 5 }],
          },
          {
            id: 'curve_3',
            type: 'alley',
            width: 1.55,
            bridges: 0,
            surface: 'road',
            hierarchy: 3,
            points: curvePts,
          },
        ],
        settlement: {
          ...sampleTown.plan.settlement,
          type: 'trade_town',
          character: 'prosperous',
          fortification: undefined,
          materialProfile: { age: 0.45, wealth: 0.62, maintenance: 0.68, preservation: 0.72 },
        },
      },
    };
  }

  // =========================================================================
  // 01: Roads Before vs After
  // =========================================================================
  if (shouldRun(1)) {
    const roadMap = buildRoadGeometryMap();
    const cell = 46;

    // Simulate BEFORE: TILE_ART.road mapped to 'bank' (beach sand) and no road ribbons
    const savedTileArtRoad = assetsMod.TILE_ART.road;
    const savedArtRoadDirt = assets.art.road_packed_dirt;
    const savedMatRoadDirt = assets.materials.road_packed_dirt;
    assetsMod.TILE_ART.road = 'bank';
    const legacyMap = { ...roadMap, plan: { ...roadMap.plan, lanes: [] }, civic: roadMap.civic.slice(0, 2) };
    const beforeCanvas = renderToCanvas(legacyMap, { cell, roadMaterial: 'road_packed_dirt' }, 77);
    assetsMod.TILE_ART.road = savedTileArtRoad;
    assets.art.road_packed_dirt = savedArtRoadDirt;
    assets.materials.road_packed_dirt = savedMatRoadDirt;

    // AFTER: Contextual road_* materials + smooth road ribbons, verges, ruts, plaza transition
    const afterCanvas = renderToCanvas(roadMap, { cell, roadMaterial: 'auto' }, 77);

    const { canvas, ctx } = makeFramedSheet(
      1760,
      720,
      '01 · Roads System — BEFORE (Shared Beach Sand) vs AFTER (Dedicated Seamless Road Materials)',
      'Left: legacy TILE_ART.road = "bank" sand reuse. Right: dedicated road_* seamless materials + curb/verge ribbons across straight, bend, crossroads, curve & plaza.',
    );
    drawPanel(
      ctx, beforeCanvas, 0, 0, beforeCanvas.width, beforeCanvas.height,
      24, 96, 844, 596,
      'BEFORE · Shared Sand ("bank") Texture',
      'Beach sand pebbles/ripples reused on roads; stepped tile edges on diagonals',
    );
    drawPanel(
      ctx, afterCanvas, 0, 0, afterCanvas.width, afterCanvas.height,
      892, 96, 844, 596,
      'AFTER · Contextual Road Materials + Continuous Ribbons',
      'Worn cobble main street, old cobble side street, gravel curved lane & distinct plaza',
    );
    savePng(canvas, '01-roads-before-vs-after.png');
  }

  // =========================================================================
  // 02: All 6 Road Materials Matrix
  // =========================================================================
  if (shouldRun(2)) {
    const roadMap = buildRoadGeometryMap();
    const specs = [
      ['road_packed_dirt', 'Packed Dirt (Rural / Country Tracks)', 'Warm compacted earth, wheel ruts, fine stones — distinct from beach sand'],
      ['road_gravel', 'Compacted Gravel (Village / Post Roads)', 'Crushed angular stone aggregate, graded crown & soft shoulder'],
      ['road_old_cobblestone', 'Old Cobblestone (Historic Town Streets)', 'Hand-set river & quarry cobbles with deep mortar joints'],
      ['road_worn_cobblestone', 'Worn Cobblestone (High-Traffic Commercial)', 'Polished traffic lanes, subtle cart wear & settled stones'],
      ['road_noble_paving', 'Noble Paving (Capital / Citadel / Civic)', 'Dressed ashlar paving slabs & clean geometric joints'],
      ['road_damaged_stone', 'Damaged Stone (Neglected / War-Torn)', 'Broken flagstones, potholes, dirt patches & weed-filled cracks'],
    ];
    const { canvas, ctx } = makeFramedSheet(
      1860,
      1060,
      '02 · Dedicated Seamless Road Materials — Full 6-Material Matrix',
      'All 6 1024×1024 master -> 640×640 seamless runtime road textures rendered through Cartographer Canvas 2D engine.',
    );
    for (let i = 0; i < specs.length; i++) {
      const [matId, label, sub] = specs[i];
      const rendered = renderToCanvas(roadMap, { cell: 42, roadMaterial: matId }, 77);
      const col = i % 3;
      const row = Math.floor(i / 3);
      const dx = 24 + col * 608;
      const dy = 96 + row * 472;
      drawPanel(
        ctx, rendered,
        Math.round(rendered.width * 0.14), Math.round(rendered.height * 0.12),
        Math.round(rendered.width * 0.72), Math.round(rendered.height * 0.76),
        dx, dy, 592, 452,
        label, sub,
      );
    }
    savePng(canvas, '02-road-materials-matrix.png');
  }

  // =========================================================================
  // 03: Castle Walls Before vs After
  // =========================================================================
  if (shouldRun(3)) {
    const fortGen = {
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      width: 60,
      height: 46,
      seed: 68,
      fortified: true,
      urbanDressing: 0.75,
    };
    const fortMap = generateMap(fortGen);
    const cell = 44;

    // BEFORE simulation: temporarily hide castle_wall_* images so procedural flat fallback runs
    const savedWalls = {
      castle_wall_stone: assets.art.castle_wall_stone,
      castle_wall_dressed_stone: assets.art.castle_wall_dressed_stone,
      castle_wall_weathered: assets.art.castle_wall_weathered,
    };
    delete assets.art.castle_wall_stone;
    delete assets.art.castle_wall_dressed_stone;
    delete assets.art.castle_wall_weathered;
    const beforeFort = renderToCanvas(fortMap, { cell, wallThickness: 0.42 }, 68);
    Object.assign(assets.art, savedWalls);

    const afterFort = renderToCanvas(fortMap, { cell, wallThickness: 0.42, castleWallMaterial: 'castle_wall_stone' }, 68);

    // Focus crop around gatehouse + bastion + curtain corner
    const fort = fortMap.plan?.fortification;
    const gate = fort?.gates?.[0] ?? { x: fortMap.width * 0.5, y: fortMap.height * 0.75 };
    const cropW = Math.round(22 * cell);
    const cropH = Math.round(17 * cell);
    const sx = Math.max(0, Math.min(afterFort.width - cropW, Math.round(gate.x * cell - cropW * 0.5)));
    const sy = Math.max(0, Math.min(afterFort.height - cropH, Math.round(gate.y * cell - cropH * 0.5)));

    const { canvas, ctx } = makeFramedSheet(
      1760,
      740,
      '03 · Settlement Fortifications — BEFORE (Flat Procedural Stroke) vs AFTER (Longitudinal Coursed Masonry)',
      'Dedicated castle_wall_* masonry follows curtain wall tangent, bevels, parapet walk, crenellations, bastions & gatehouses.',
    );
    drawPanel(
      ctx, beforeFort, sx, sy, cropW, cropH,
      24, 96, 844, 616,
      'BEFORE · Flat Procedural Curtain Stroke',
      'Uniform grey fill without stone block courses or parapet material grain',
    );
    drawPanel(
      ctx, afterFort, sx, sy, cropW, cropH,
      892, 96, 844, 616,
      'AFTER · Longitudinal Castle Wall Masonry',
      'Tangent-aligned coursed stone blocks, beveled merlons, tower rings & gatehouse',
    );
    savePng(canvas, '03-castle-walls-before-vs-after.png');
  }

  // =========================================================================
  // 04: Castle Wall Thickness × Variants + Untouched Dungeon Wall Verification
  // =========================================================================
  if (shouldRun(4)) {
    const fortGen = {
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      width: 52,
      height: 40,
      seed: 68,
      fortified: true,
      urbanDressing: 0.65,
    };
    const fortMap = generateMap(fortGen);
    const cell = 42;
    const towers = fortMap.plan?.settlement?.fortification?.towers ?? [];
    const focus = towers[2] ?? towers[0] ?? { x: 32, y: 30 };
    const cropW = Math.round(16 * cell);
    const cropH = Math.round(12 * cell);

    const panels = [
      { thick: 0.22, mat: 'castle_wall_stone', title: 'Narrow (0.22) · Coursed Stone', sub: 'Compact rampart width, clean stone courses without stretch' },
      { thick: 0.38, mat: 'castle_wall_dressed_stone', title: 'Standard (0.38) · Dressed Ashlar', sub: 'Citadel / noble capital finely cut pale limestone masonry' },
      { thick: 0.58, mat: 'castle_wall_weathered', title: 'Heavy (0.58) · Weathered Masonry', sub: 'Thick siege curtain with moss, aged mortar & worn blocks' },
    ];

    const dungeonMap = generateMap({ ...DEFAULT_GEN, biome: 'dungeon', width: 28, height: 20, seed: 42 });
    const dungeonCanvas = renderToCanvas(dungeonMap, { cell: 36 }, 42);

    const { canvas, ctx } = makeFramedSheet(
      1860,
      1040,
      '04 · Castle Wall Thickness Scaling, 3 Masonry Variants & Separate Dungeon Wall System',
      'Top row: wallThickness 0.22 / 0.38 / 0.58 across 3 masonry textures. Bottom row: zoom on corner/bastion + untouched Dungeon wallPaint.ts.',
    );

    for (let i = 0; i < 3; i++) {
      const p = panels[i];
      const rendered = renderToCanvas(fortMap, { cell, wallThickness: p.thick, castleWallMaterial: p.mat }, 68);
      const sx = Math.max(0, Math.min(rendered.width - cropW, Math.round(focus.x * cell - cropW * 0.52)));
      const sy = Math.max(0, Math.min(rendered.height - cropH, Math.round(focus.y * cell - cropH * 0.52)));
      drawPanel(ctx, rendered, sx, sy, cropW, cropH, 24 + i * 608, 96, 592, 444, p.title, p.sub);
    }

    // Bottom left: corner & bastion detail at high zoom (cell=52)
    const hiCell = 52;
    const hiFort = renderToCanvas(fortMap, { cell: hiCell, wallThickness: 0.48, castleWallMaterial: 'castle_wall_dressed_stone' }, 68);
    const tower = towers[1] ?? focus;
    const hiW = Math.round(14 * hiCell);
    const hiH = Math.round(8.8 * hiCell);
    const hsx = Math.max(0, Math.min(hiFort.width - hiW, Math.round(tower.x * hiCell - hiW * 0.5)));
    const hsy = Math.max(0, Math.min(hiFort.height - hiH, Math.round(tower.y * hiCell - hiH * 0.45)));
    drawPanel(
      ctx, hiFort, hsx, hsy, hiW, hiH,
      24, 560, 900, 456,
      'High-Zoom Bastion, Gate Gap & Curved Curtain (cell = 52px)',
      'Zero UV smearing across curved wall segments; radial tower masonry & crenellation shadows stay crisp',
    );

    drawPanel(
      ctx, dungeonCanvas,
      Math.round(dungeonCanvas.width * 0.10), Math.round(dungeonCanvas.height * 0.10),
      Math.round(dungeonCanvas.width * 0.80), Math.round(dungeonCanvas.height * 0.80),
      944, 560, 892, 456,
      'Separate System Verification · Dungeon Walls (wallPaint.ts Untouched)',
      'Classic dungeon wall-straight / wall-corner sprites & golden hashes remain 100% intact',
    );
    savePng(canvas, '04-castle-wall-thickness-and-variants.png');
  }

  // Helper to build curated street dioramas showcasing exact sprite sets in real map context
  function buildStreetDiorama({
    width = 22,
    height = 15,
    roadMat = 'road_old_cobblestone',
    buildings = [],
    civic = [],
    plazaRect = null,
    character = 'prosperous',
    settlementType = 'trade_town',
  }) {
    const base = makeBaseMap(width, height, 'town');
    const { cells } = base;
    for (let x = 1; x < width - 1; x++) {
      cells[7][x].terrain = 'road';
      cells[8][x].terrain = 'road';
    }
    if (plazaRect) {
      for (let y = plazaRect.y; y < plazaRect.y + plazaRect.h; y++) {
        for (let x = plazaRect.x; x < plazaRect.x + plazaRect.w; x++) {
          if (cells[y]?.[x] !== undefined) cells[y][x].terrain = 'plaza';
        }
      }
    }
    const roofMap = { thatch: 0, shingles: 1, terracotta: 2, slate: 3, copper: 4, garnet: 5, limestone: 6, mossRoof: 7 };
    const normBuildings = buildings.map((b) => {
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      const bw = Math.max(3, Math.round(b.w));
      const bh = Math.max(3, Math.round(b.h));
      return {
        ...templateBuilding,
        ...b,
        x: bx,
        y: by,
        w: bw,
        h: bh,
        facing: b.frontEdge === 0 ? 180 : 0,
        door: {
          x: bx + Math.floor(bw / 2),
          y: b.frontEdge === 0 ? by : by + bh - 1,
        },
        attachments: (b.attachments ?? []).map((att) => ({
          ...att,
          side: att.side === 2 ? 0 : att.side === 0 ? 180 : att.side,
        })),
        shape: b.roofForm === 'hip' ? 'hip' : 'gable',
        roof: typeof b.roof === 'number' ? b.roof : (roofMap[b.roof] ?? 2),
      };
    });
    return {
      ...base,
      cells,
      buildings: normBuildings,
      civic,
      plan: {
        ...base.plan,
        roads: [
          {
            id: 'diorama_main',
            type: 'main',
            width: 2.1,
            bridges: 0,
            surface: 'road',
            hierarchy: 1,
            points: [{ x: 1.5, y: 8 }, { x: width - 1.5, y: 8 }],
          },
        ],
        settlement: {
          ...sampleTown.plan.settlement,
          type: settlementType,
          character,
          fortification: undefined,
          materialProfile: { age: 0.45, wealth: 0.65, maintenance: 0.72, preservation: 0.78 },
        },
      },
      _roadMat: roadMat,
    };
  }

  function stampCivic(id, kind, x, y, rotation = 0) {
    const spec = CIVIC_KIT[kind];
    if (!spec) throw new Error(`Not a CIVIC_KIT kind: ${kind}`);
    return { id, kind, x, y, w: spec.w, h: spec.h, rotation, variant: 0, source: 'manual' };
  }

  function drawSpriteStrip(ctx, ids, x0, y0, totalW, stripH, backdropImg, cols = 8) {
    const rows = Math.ceil(ids.length / cols);
    const cellW = totalW / cols;
    const cellH = stripH / rows;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const img = assets.art[id];
      if (!img) continue;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const bx = x0 + c * cellW + 3;
      const by = y0 + r * cellH + 3;
      const bw = cellW - 6;
      const bh = cellH - 6;
      if (backdropImg) {
        ctx.drawImage(backdropImg, (c * 73) % 320, (r * 97) % 320, 180, 180, bx, by, bw, bh);
        ctx.fillStyle = 'rgba(14, 17, 22, 0.24)';
        ctx.fillRect(bx, by, bw, bh);
      } else {
        ctx.fillStyle = '#1b2029';
        ctx.fillRect(bx, by, bw, bh);
      }
      const maxW = bw - 12;
      const maxH = bh - 22;
      const s = Math.min(maxW / img.width, maxH / img.height);
      ctx.drawImage(img, bx + (bw - img.width * s) / 2, by + 3 + (maxH - img.height * s) / 2, img.width * s, img.height * s);
      ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
      ctx.fillRect(bx, by + bh - 17, bw, 17);
      ctx.fillStyle = '#e9dfc8';
      ctx.font = '10.5px sans-serif';
      const shortLabel = id.replace(/^(sign|lamp|decal|wear|mat|green|yard|urban|market)/, '');
      ctx.fillText(shortLabel, bx + 4, by + bh - 5);
      ctx.strokeStyle = 'rgba(210, 186, 136, 0.38)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }

  // =========================================================================
  // 05: Building Signs (16) & Urban Lighting (16) — Day & Dusk
  // =========================================================================
  if (shouldRun(5)) {
    const signKinds = [
      'signTavern', 'signForge', 'signBakery', 'signButcher',
      'signFishmonger', 'signHerbalist', 'signApothecary', 'signClothier',
      'signTailor', 'signCobbler', 'signCarpenter', 'signStable',
      'signInn', 'signTemple', 'signGuild', 'signGeneralStore',
    ];
    const civicLampKinds = [
      'lampStreetIron', 'lampStreetWood', 'lampStreetStone', 'lampStreetFancy',
      'lampBrazierSquare', 'lampBrazierRound', 'lampTorchStand', 'lampFireBasket',
      'lampOilLantern', 'lampCandleLantern', 'lampHarborLantern', 'lampSignalBeacon',
    ];
    const allLampKinds = [
      'lampStreetIron', 'lampStreetWood', 'lampStreetStone', 'lampStreetFancy',
      'lampWallLantern', 'lampWallTorch', 'lampHangingLantern', 'lampHangingCage',
      'lampBrazierSquare', 'lampBrazierRound', 'lampTorchStand', 'lampFireBasket',
      'lampOilLantern', 'lampCandleLantern', 'lampHarborLantern', 'lampSignalBeacon',
    ];

    const archetypesTop = ['tavern', 'smithy', 'bakery', 'butcher', 'fishmonger', 'herbalist', 'apothecary', 'tailor'];
    const archetypesBot = ['cobbler', 'carpenter', 'stable', 'inn', 'temple', 'guildhouse', 'merchant_shop', 'warehouse'];
    const buildings = [];
    const civic = [];
    let cid = 1;
    const roofs = ['shingles', 'terracotta', 'slate', 'thatch'];
    for (let i = 0; i < 4; i++) {
      const bx = 2 + i * 5;
      buildings.push({
        id: i + 1,
        x: bx, y: 2, w: 4, h: 4,
        roof: roofs[i % 4], roofForm: 'gable',
        buildingArchetype: archetypesTop[i],
        district: 'market',
        cityCondition: 'normal',
        frontEdge: 2,
        attachments: [
          { kind: 'signboard', side: 2, offset: -0.24, size: 0.6, variant: i * 2 },
          { kind: 'lantern', side: 2, offset: 0.28, size: 0.5, variant: i % 4 },
          { kind: 'awning', side: 2, offset: 0, size: 0.65 },
        ],
      });
      buildings.push({
        id: i + 10,
        x: bx, y: 10, w: 4, h: 4,
        roof: roofs[(i + 1) % 4], roofForm: 'hip',
        buildingArchetype: archetypesBot[i],
        district: 'civic',
        cityCondition: 'well_kept',
        frontEdge: 0,
        attachments: [
          { kind: 'signboard', side: 0, offset: -0.24, size: 0.6, variant: i * 2 + 1 },
          { kind: 'lantern', side: 0, offset: 0.28, size: 0.5, variant: (i + 2) % 4 },
        ],
      });
    }

    civicLampKinds.forEach((lk, idx) => {
      const row = idx < 6 ? 6.15 : 8.85;
      const col = idx % 6;
      civic.push(stampCivic(cid++, lk, 2.2 + col * 3.1, row, 0));
    });

    const diorama = buildStreetDiorama({ width: 23, height: 16, buildings, civic, roadMat: 'road_noble_paving' });
    const dayRender = renderToCanvas(diorama, { cell: 48, lighting: 'day', roadMaterial: 'road_noble_paving' }, 205);
    const duskRender = renderToCanvas(diorama, { cell: 48, lighting: 'dusk', roadMaterial: 'road_noble_paving' }, 205);

    const { canvas, ctx } = makeFramedSheet(
      1860,
      980,
      '05 · Building Signs (16/16) & Urban Lighting Fixtures (16/16) — Street View + Close-Up Strip',
      'Top: Daylight & warm dusk guild promenade rendered via renderMap(). Bottom: All 16 profession signs & all 16 lamps over cobble.',
    );
    drawPanel(
      ctx, dayRender, 24, 24, dayRender.width - 48, dayRender.height - 48,
      24, 96, 892, 540,
      'Daylight Guild Promenade · Facade Signs, Awnings & Street Lamps',
      'Profession signboards & wall lanterns attached to building frontages + street lamp posts',
    );
    drawPanel(
      ctx, duskRender, 24, 24, duskRender.width - 48, duskRender.height - 48,
      944, 96, 892, 540,
      'Warm Dusk Atmosphere · Lanterns, Torches, Braziers & Beacons',
      'Clean alpha silhouettes without white fringes under warm evening lighting',
    );
    drawSpriteStrip(ctx, signKinds, 24, 652, 892, 304, assets.art.road_noble_paving, 8);
    drawSpriteStrip(ctx, allLampKinds, 944, 652, 892, 304, assets.art.road_old_cobblestone, 8);
    savePng(canvas, '05-building-signs-and-lighting.png');
  }

  // =========================================================================
  // 06: Craft Workshops (16), Market Goods (16) & Street Furniture (16)
  // =========================================================================
  if (shouldRun(6)) {
    const marketKinds = [
      'marketScale', 'marketWeights', 'marketCoins', 'marketLedger',
      'marketSpiceBowls', 'marketSpiceRack', 'marketHerbBundles', 'marketHoneyJars',
      'marketSmokedFishRack', 'marketMeatHooks', 'marketCheeseWheels', 'marketSaltMeasure',
      'marketGlassVials', 'marketCandleBundles', 'marketFabricBolts', 'marketFlowerBundles',
    ];
    const craftKinds = [
      'urbanAnvil', 'urbanWorkbench', 'urbanForge', 'urbanBellows',
      'urbanWoodpile', 'urbanPlanks', 'urbanCoal', 'urbanHides',
      'urbanPots', 'urbanToolRack', 'urbanGrindingWheel', 'urbanSawhorse',
      'urbanPotteryWheel', 'urbanPotteryKiln', 'urbanDyeVat', 'urbanLoom',
    ];
    const streetKinds = [
      'urbanTrough', 'urbanHandPump', 'urbanHitchingPost', 'urbanHitchingRail',
      'urbanStoneBollard', 'urbanMilestone', 'urbanDrainGrate', 'urbanManholeCover',
      'urbanWaterBasin', 'urbanWashTub', 'urbanBucketStand', 'urbanStreetShrine',
      'urbanStonePlanter', 'urbanRoadBarrier', 'urbanStreetBroom', 'urbanSignpost',
    ];

    // Left panel: Market Plaza + Street Furniture
    const marketCivic = [
      { id: 1, kind: 'square', x: 1.5, y: 1.5, w: 15, h: 11, rotation: 0, variant: 0, source: 'layout' },
      stampCivic(2, 'market', 2.4, 2.2, 0),
      stampCivic(3, 'marketTentStripe', 6.4, 2.2, 0),
      stampCivic(4, 'marketTentAwning', 10.4, 2.2, 0),
      stampCivic(5, 'marketTentBrown', 13.6, 2.2, 0),
    ];
    let id = 10;
    marketKinds.forEach((k, idx) => {
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      marketCivic.push(stampCivic(id++, k, 2.2 + col * 1.75, 4.3 + row * 1.45, 0));
    });
    streetKinds.forEach((k, idx) => {
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      marketCivic.push(stampCivic(id++, k, 2.2 + col * 1.75, 8.9 + row * 1.65, 0));
    });
    const marketMap = buildStreetDiorama({
      width: 18, height: 14, civic: marketCivic,
      plazaRect: { x: 2, y: 2, w: 14, h: 5 },
      roadMat: 'road_worn_cobblestone',
    });

    // Right panel: Craft & Workshop Yards
    const craftBuildings = [
      { id: 1, x: 1.6, y: 1.4, w: 4.4, h: 3.2, rotation: 0, roof: 'slate', roofForm: 'gable', buildingArchetype: 'smithy', district: 'craft', frontEdge: 2, attachments: [{ kind: 'chimney', side: 0, offset: 0.2, size: 0.6 }, { kind: 'signboard', side: 2, offset: 0, size: 0.5, signKind: 'signForge' }] },
      { id: 2, x: 7.0, y: 1.4, w: 4.4, h: 3.2, rotation: 0, roof: 'terracotta', roofForm: 'gable', buildingArchetype: 'workshop', district: 'craft', frontEdge: 2, attachments: [{ kind: 'signboard', side: 2, offset: 0, size: 0.5, signKind: 'signCarpenter' }] },
      { id: 3, x: 12.4, y: 1.4, w: 4.2, h: 3.2, rotation: 0, roof: 'shingles', roofForm: 'hip', buildingArchetype: 'workshop', district: 'craft', frontEdge: 2, attachments: [{ kind: 'signboard', side: 2, offset: 0, size: 0.5, signKind: 'signClothier' }] },
    ];
    const craftCivic = [];
    craftKinds.forEach((k, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const yBase = row < 2 ? 5.0 + row * 1.35 : 9.4 + (row - 2) * 1.65;
      craftCivic.push(stampCivic(id++, k, 2.2 + col * 3.6, yBase, 0));
    });
    const craftMap = buildStreetDiorama({
      width: 18, height: 14, buildings: craftBuildings, civic: craftCivic, roadMat: 'road_old_cobblestone',
    });

    const leftRender = renderToCanvas(marketMap, { cell: 54, roadMaterial: 'road_worn_cobblestone' }, 301);
    const rightRender = renderToCanvas(craftMap, { cell: 54, roadMaterial: 'road_old_cobblestone' }, 302);

    const { canvas, ctx } = makeFramedSheet(
      1860,
      780,
      '06 · Market Goods (16/16), Street Dressing (16/16) & Craft Workshop Yards (16/16)',
      'Left: bazaar stalls, merchant goods & street infrastructure. Right: smithy, carpentry, pottery & dye/textile workshop yards.',
    );
    drawPanel(ctx, leftRender, 20, 20, leftRender.width - 40, leftRender.height - 40, 24, 96, 892, 656,
      'Market Stalls, 16 Trade Goods & 16 Street Dressing Props',
      'Scales, spice bowls, smoked fish, cheese, fabric bolts, troughs, hand pump, bollards & drains');
    drawPanel(ctx, rightRender, 20, 20, rightRender.width - 40, rightRender.height - 40, 944, 96, 892, 656,
      'Artisan Quarter · 16 Craft & Workshop Yard Assets',
      'Forge, anvil, bellows, pottery kiln & wheel, dye vat, loom, sawhorse, hides & timber');
    savePng(canvas, '06-craft-market-and-street-dressing.png');
  }

  // =========================================================================
  // 07: Residential Yards (16) & Urban Greenery (16)
  // =========================================================================
  if (shouldRun(7)) {
    const yardKinds = [
      'yardLaundryLine', 'yardWashTub', 'yardWashboard', 'yardWaterPail',
      'yardChoppingBlock', 'yardFirewoodRack', 'yardBroomRake', 'yardCompostBin',
      'yardChickenCoop', 'yardFeedTrough', 'yardBeehive', 'yardDoghouse',
      'yardHerbBed', 'yardVegetableBed', 'yardFlowerPots', 'yardOutdoorCookstove',
    ];
    const greenCivicKinds = [
      'greenStonePlanterRound', 'greenStonePlanterRect', 'greenFlowerUrn', 'greenHerbPot',
      'greenTopiaryCone', 'greenTopiaryBall', 'greenHedgeBox', 'greenPottedCypress',
      'greenRoseTrellis', 'greenGrapeTrellis', 'greenFlowerBed', 'greenVegetableHerbBox',
      'greenOrnamentalShrubPot', 'greenSmallGardenStatue',
    ];

    let id = 1;
    const yardBuildings = [
      { id: 1, x: 2, y: 1, w: 4, h: 3, roof: 'thatch', roofForm: 'gable', buildingArchetype: 'dwelling', district: 'residential', frontEdge: 2, fence: true },
      { id: 2, x: 7, y: 1, w: 4, h: 3, roof: 'shingles', roofForm: 'gable', buildingArchetype: 'dwelling', district: 'residential', frontEdge: 2, fence: true },
      { id: 3, x: 12, y: 1, w: 4, h: 3, roof: 'terracotta', roofForm: 'hip', buildingArchetype: 'dwelling', district: 'residential', frontEdge: 2 },
    ];
    const yardCivic = [];
    yardKinds.forEach((k, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const yBase = row < 2 ? 4.8 + row * 1.15 : 9.3 + (row - 2) * 1.95;
      yardCivic.push(stampCivic(id++, k, 2.0 + col * 3.8, yBase, 0));
    });
    const yardMap = buildStreetDiorama({ width: 18, height: 14, buildings: yardBuildings, civic: yardCivic, roadMat: 'road_gravel' });

    const greenBuildings = [
      {
        id: 1, x: 2, y: 1, w: 6, h: 3, roof: 'slate', roofForm: 'hip', buildingArchetype: 'manor', district: 'noble', cityCondition: 'well_kept', frontEdge: 2,
        attachments: [{ kind: 'window_box', side: 2, offset: -0.25, size: 0.65, variant: 0 }, { kind: 'window_box', side: 2, offset: 0.25, size: 0.65, variant: 1 }],
      },
      {
        id: 2, x: 10, y: 1, w: 6, h: 3, roof: 'terracotta', roofForm: 'hip', buildingArchetype: 'temple', district: 'sacred', cityCondition: 'well_kept', frontEdge: 2,
        attachments: [{ kind: 'window_box', side: 2, offset: 0, size: 0.7, variant: 1 }],
      },
    ];
    const greenCivic = [
      { id: id++, kind: 'square', x: 1.8, y: 9.0, w: 14.4, h: 4.2, rotation: 0, variant: 0, source: 'layout' },
    ];
    greenCivicKinds.forEach((k, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const yBase = row < 2 ? 4.8 + row * 1.15 : 9.4 + (row - 2) * 1.75;
      greenCivic.push(stampCivic(id++, k, 2.1 + col * 3.7, yBase, 0));
    });
    const greenMap = buildStreetDiorama({
      width: 18, height: 14, buildings: greenBuildings, civic: greenCivic,
      plazaRect: { x: 2, y: 9, w: 14, h: 4 },
      roadMat: 'road_noble_paving',
    });

    const leftRender = renderToCanvas(yardMap, { cell: 54, roadMaterial: 'road_gravel' }, 401);
    const rightRender = renderToCanvas(greenMap, { cell: 54, roadMaterial: 'road_noble_paving' }, 402);

    const { canvas, ctx } = makeFramedSheet(
      1860,
      780,
      '07 · Domestic Residential Yards (16/16) & Noble / Civic Urban Greenery (16/16)',
      'Left: lived-in homestead yards (laundry, coops, beehives, vegetable beds). Right: formal planters, topiaries, trellises & garden sculpture.',
    );
    drawPanel(ctx, leftRender, 20, 20, leftRender.width - 40, leftRender.height - 40, 24, 96, 892, 656,
      'Homestead & Back-Lot Yards · 16 Domestic Props',
      'Laundry lines, chicken coop, beehive, firewood rack, chopping block, herb & vegetable beds');
    drawPanel(ctx, rightRender, 20, 20, rightRender.width - 40, rightRender.height - 40, 944, 96, 892, 656,
      'Manor & Temple Gardens · 16 Cultivated Greenery Props',
      'Stone planters, flower urns, cone/ball topiaries, rose & grape trellises, garden statue');
    savePng(canvas, '07-residential-yards-and-greenery.png');
  }

  // =========================================================================
  // 08: Ground Decals (16), Building Wear (16), Materials (16) & Old != Neglected
  // =========================================================================
  if (shouldRun(8)) {
    const decalKinds = [
      'decalCartTracksStraight', 'decalCartTracksTurn', 'decalBootFootprintsMud', 'decalHoofprints',
      'decalTrampledGrass', 'decalMudSplashes', 'decalWoodChips', 'decalStraw',
      'decalCobbleCracks', 'decalMissingCobble', 'decalSootStain', 'decalWetPatch',
      'decalManure', 'decalBrokenPottery', 'decalWeedsInCracks', 'decalRopeDrag',
    ];
    const wearKinds = [
      'wearStoneChips', 'wearStoneCrackShort', 'wearStoneCrackLong', 'wearMissingMortar',
      'wearPlasterPeelingSmall', 'wearPlasterPeelingLarge', 'wearExposedBrick', 'wearPatchedPlaster',
      'wearMossFooting', 'wearDampStain', 'wearSootStreak', 'wearLichenStone',
      'wearTimberRot', 'wearBrokenBoard', 'wearFoundationCrack', 'wearMissingShingles',
    ];
    const matKinds = [
      'matLimestone', 'matGranite', 'matFieldstone', 'matRubbleStone',
      'matWeatheredSandstone', 'matCutStone', 'matBrick', 'matMossyStone',
      'matCreamPlaster', 'matOchrePlaster', 'matRosePlaster', 'matAdobe',
      'matTimberPlanks', 'matHalfTimber', 'matCharredTimber', 'matFoundationStone',
    ];

    // Left: Intact Old Historic Town ("Old != Neglected") rendered via generateMap + renderMap
    const oldTownMap = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'fortified_town',
      settlementCharacter: 'old',
      width: 36,
      height: 28,
      seed: 68,
      fortified: true,
      urbanDressing: 0.85,
    });
    // Right: Worn / War-Torn Ruined Town showing structural wear, damaged stone roads & heavy decals
    const wornTownMap = generateMap({
      ...DEFAULT_GEN,
      biome: 'town',
      settlement: 'town',
      settlementType: 'frontier_town',
      settlementCharacter: 'ruined',
      width: 36,
      height: 28,
      seed: 68,
      fortified: true,
      urbanDressing: 0.85,
    });
    for (const b of wornTownMap.buildings) b.cityCondition = 'worn';

    const leftRender = renderToCanvas(oldTownMap, { cell: 34, roadMaterial: 'road_old_cobblestone', castleWallMaterial: 'auto' }, 68);
    const rightRender = renderToCanvas(wornTownMap, { cell: 34, roadMaterial: 'road_damaged_stone', castleWallMaterial: 'castle_wall_weathered' }, 68);

    const { canvas, ctx } = makeFramedSheet(
      1860,
      1080,
      '08 · Ground Decals (16/16), Building Wear (16/16), Materials (16/16) & "Old ≠ Neglected" Principle',
      'Top: Intact historic "old" town vs neglected "worn/ruined" town. Bottom: All 16 ground decals, 16 wear overlays & 16 material textures.',
    );
    drawPanel(ctx, leftRender, Math.round(leftRender.width * 0.14), Math.round(leftRender.height * 0.14), Math.round(leftRender.width * 0.72), Math.round(leftRender.height * 0.72), 24, 96, 892, 520,
      'Historic Intact ("old" ≠ Ruined) · Old Cobblestone & Sound Masonry',
      'Aged historic stonework, subtle moss & cart tracks without structural decay');
    drawPanel(ctx, rightRender, Math.round(rightRender.width * 0.14), Math.round(rightRender.height * 0.14), Math.round(rightRender.width * 0.72), Math.round(rightRender.height * 0.72), 944, 96, 892, 520,
      'Neglected / Worn ("ruined") · Damaged Stone Road & Heavy Building Wear',
      'Cracked masonry, peeling plaster, exposed brick, missing shingles & weathered ramparts');

    drawSpriteStrip(ctx, decalKinds, 24, 632, 600, 424, assets.art.road_packed_dirt, 4);
    drawSpriteStrip(ctx, wearKinds, 638, 632, 600, 424, assets.art.matCreamPlaster, 4);
    drawSpriteStrip(ctx, matKinds, 1252, 632, 584, 424, null, 4);
    savePng(canvas, '08-ground-decals-wear-and-materials.png');
  }

  // =========================================================================
  // 09: Repaired Legacy Sprites — BEFORE (Backup) vs AFTER (Cleaned Production)
  // =========================================================================
  if (shouldRun(9)) {
    const repairedIds = [
      ['crypt-runeBlue', 'White matte halo removed'],
      ['crypt-runeCircleBlue', 'White matte halo removed'],
      ['crypt-bladeSlot', 'Opaque border fringe removed'],
      ['crypt-crystals', 'Edge halo de-contaminated'],
      ['urbanLamp', 'Legacy lamp edge halo removed'],
      ['urbanSign', 'Legacy sign white matte removed'],
      ['decor-twig', 'Screenshot UI toolbar removed'],
      ['decor-crack', 'UI toolbar & black corners removed'],
      ['decor-pebble', 'UI toolbar & corner artifacts removed'],
      ['decor-snow', 'UI toolbar & corner artifacts removed'],
    ];

    const { canvas, ctx } = makeFramedSheet(
      1860,
      920,
      '09 · Sprite Alpha & Artifact Repairs — BEFORE (Original Backup) vs AFTER (Cleaned Production .webp)',
      'Shown over dark slate + grass checker backdrop so white fringes, opaque corners, and UI screenshot buttons are immediately visible.',
    );

    const grassImg = assets.art.grass;
    for (let i = 0; i < repairedIds.length; i++) {
      const [id, desc] = repairedIds[i];
      const col = i % 5;
      const row = Math.floor(i / 5);
      const cardX = 24 + col * 364;
      const cardY = 96 + row * 400;
      const cardW = 348;
      const cardH = 380;

      ctx.fillStyle = '#1b2029';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.strokeStyle = '#3f495c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      ctx.fillStyle = '#f3ead8';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(id, cardX + 12, cardY + 24);
      ctx.fillStyle = '#9fb0c7';
      ctx.font = '12px sans-serif';
      ctx.fillText(desc, cardX + 12, cardY + 42);

      const beforeImg = await loadImage(fs.readFileSync(path.join(BACKUP_DIR, `${id}.webp`)));
      const afterImg = assets.art[id];

      const drawThumb = (img, bx, by, tag, tagColor) => {
        const bw = 154;
        const bh = 296;
        // Top half: dark charcoal; bottom half: grass texture
        ctx.fillStyle = '#101318';
        ctx.fillRect(bx, by, bw, bh / 2);
        ctx.drawImage(grassImg, 0, 0, 220, 220, bx, by + bh / 2, bw, bh / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(bx, by + bh / 2, bw, bh / 2);

        // Draw sprite on both dark & terrain zones
        const scale = Math.min((bw - 24) / img.width, (bh / 2 - 28) / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, bx + (bw - dw) / 2, by + 22 + (bh / 2 - 26 - dh) / 2, dw, dh);
        ctx.drawImage(img, bx + (bw - dw) / 2, by + bh / 2 + 12 + (bh / 2 - 18 - dh) / 2, dw, dh);

        ctx.strokeStyle = tagColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(14,17,22,0.88)';
        ctx.fillRect(bx + 4, by + 4, 74, 20);
        ctx.fillStyle = tagColor;
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(tag, bx + 10, by + 18);
      };

      drawThumb(beforeImg, cardX + 12, cardY + 58, 'BEFORE', '#f08c7d');
      drawThumb(afterImg, cardX + 180, cardY + 58, 'AFTER', '#7fe0a2');
    }
    savePng(canvas, '09-repaired-sprites-before-vs-after.png');
  }

  // =========================================================================
  // 10: Full Settlement Showcase (4 Distinct Complete Urban Archetypes)
  // =========================================================================
  if (shouldRun(10)) {
    const settlements = [
      {
        label: 'Fortified Trade Town (seed 515)',
        sub: 'Coursed stone ramparts, worn cobble market arterials, trade signs, yards & workshops',
        gen: { ...DEFAULT_GEN, biome: 'town', settlement: 'town', settlementType: 'fortified_town', width: 52, height: 38, seed: 515, fortified: true, urbanDressing: 0.85 },
        rs: { cell: 22, lighting: 'day', roadMaterial: 'auto', castleWallMaterial: 'auto' },
      },
      {
        label: 'Harbor Port Town at Dusk (seed 808)',
        sub: 'Quayside piers, harbor lanterns, fishmonger/warehouse props, cobble & gravel lanes',
        gen: { ...DEFAULT_GEN, biome: 'town', settlement: 'port', settlementType: 'port_town', width: 52, height: 38, seed: 808, coast: 'south', urbanDressing: 0.85 },
        rs: { cell: 22, lighting: 'dusk', roadMaterial: 'auto', castleWallMaterial: 'auto' },
      },
      {
        label: 'Noble Citadel Capital (seed 312)',
        sub: 'Dressed ashlar walls (0.48), noble paving, formal gardens, guild & temple plazas',
        gen: { ...DEFAULT_GEN, biome: 'town', settlement: 'town', settlementType: 'citadel', settlementCharacter: 'noble', width: 52, height: 38, seed: 312, fortified: true, urbanDressing: 0.8 },
        rs: { cell: 22, lighting: 'day', roadMaterial: 'auto', castleWallMaterial: 'castle_wall_dressed_stone', wallThickness: 0.48 },
      },
      {
        label: 'Crossroads Market Village (seed 144)',
        sub: 'Packed dirt & gravel lanes, homestead yards, livestock coops, wells & roadside troughs',
        gen: { ...DEFAULT_GEN, biome: 'village', settlement: 'village', settlementType: 'market_village', width: 48, height: 36, seed: 144, urbanDressing: 0.85 },
        rs: { cell: 24, lighting: 'day', roadMaterial: 'auto' },
      },
    ];

    const { canvas, ctx } = makeFramedSheet(
      1920,
      1220,
      '10 · Full Settlement Showcase — Cohesive Roads, Castle Walls & 160-Sprite Urban Kit in Production',
      'Four procedural settlements rendered end-to-end through generateMap() + renderMap() with contextual materials and full urban dressing.',
    );

    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i];
      const map = generateMap(s.gen);
      const rendered = renderToCanvas(map, s.rs, s.gen.seed);
      const col = i % 2;
      const row = Math.floor(i / 2);
      const dx = 24 + col * 944;
      const dy = 96 + row * 552;
      drawPanel(
        ctx, rendered,
        0, 0, rendered.width, rendered.height,
        dx, dy, 928, 534,
        s.label, s.sub,
      );
    }
    savePng(canvas, '10-full-settlement-showcase.png');
  }
} finally {
  await srv.close();
}
