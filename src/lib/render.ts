import { getAssets } from './assets';
import { cryptPainter } from './cryptPaint';
import { settlementPainter } from './settlementPaint';
import { hash2 } from './random';
import { paintTerrain } from './terrainPaint';
import { chestArt, chestDimensions } from './chests';
import { doorAxis, doorStyle, drawDoor } from './doors';
import { treeDimensions, rockDimensions } from './objectSizing';
import { drawWalls } from './wallPaint';
import type { Chest, MapData, RenderSettings, Rock, Terrain, Tree } from './types';

export { TERRAIN_COLORS, TERRAIN_LABELS } from './palette';

const TAU = 2 * Math.PI;
const at = (map: MapData, x: number, y: number) => map.cells[y]?.[x]?.terrain;

function contour(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
}

/** Стены как в примере Sol Max: плоская топографическая проекция. Сетка и масштаб остаются точными, без приподнятой перспективы. */
export function renderMap(canvas: HTMLCanvasElement, map: MapData, rs: RenderSettings, seed: number) {
  const cs = rs.cellSize;
  const W = map.width * cs, H = map.height * cs;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.putImageData(paintTerrain(map, rs, seed), 0, 0);
  const crypt = cryptPainter(ctx, map, rs, seed);
  crypt.depth();
  if (rs.showCrypt) { crypt.floorProps(); crypt.lights(); }

  if (rs.showStructures) {
    const spriteWalls = drawWalls(ctx, map, cs, seed, rs.shading);
    if (!spriteWalls && rs.shading) eachStructure(map, (terrain, x, y) => {
      if (terrain === 'wall') {
        ctx.save();
        ctx.translate((x + 0.08) * cs, (y + 0.16) * cs);
        ctx.scale(cs, cs);
        const parts = wallParts(map, x, y);
        ctx.fillStyle = 'rgba(28,23,17,.39)';
        ctx.beginPath();
        for (const [px, py, w, h] of parts) ctx.rect(px, py, w + 0.03, h + 0.035);
        ctx.fill();
        ctx.restore();
      }
    });
    eachStructure(map, (terrain, x, y) => {
      if (terrain === 'wall') {
        if (!spriteWalls) drawWall(ctx, map, x, y, cs, seed);
        return;
      }
      if (terrain === 'bridge') drawWoodwork(ctx, map, terrain, x, y, cs, seed, rs.texture);
      if (terrain === 'door') {
        ctx.save(); ctx.translate((x + .5) * cs, (y + .5) * cs); ctx.scale(cs, cs);
        if (doorAxis(map, x, y) === 'vertical') ctx.rotate(Math.PI / 2);
        drawDoor(ctx, doorStyle(map.biome, x, y, seed), .96, map.biome === 'dungeon' && hash2(x, y, seed + 19) > .62);
        ctx.restore();
      }
    });
  }

  const city = settlementPainter(ctx, rs, seed, map.furnitureSprites);
  if (rs.showCivic) for (const item of map.civic ?? []) if (item.kind === 'square') city.civic(item);
  if (rs.showStructures) for (const building of map.buildings ?? []) city.building(building);

  const objects: { y: number; paint: () => void }[] = [];
  if (rs.showCrypt) for (const item of crypt.upright) objects.push({ y: item.y * cs + item.h * cs, paint: () => crypt.prop(item) });
  if (rs.showRocks) for (const rock of map.rocks) objects.push({ y: rock.y * cs, paint: () => drawRock(ctx, rock, cs) });
  if (rs.showTrees) for (const tree of map.trees) objects.push({ y: (tree.y + tree.r) * cs, paint: () => drawTree(ctx, tree, cs, map.biome) });
  if (rs.shading) {
    if (rs.showTrees) for (const tree of map.trees) {
      if (tree.kind === 'mushroom' || tree.kind === 'reed') continue;
      const dims = treeDimensions(tree), radius = tree.r * cs;
      groundShadow(ctx, tree.x * cs + radius * 0.6, tree.y * cs + radius * 0.66, dims.w * cs * .53, dims.h * cs * .48, 0.56);
    }
    if (rs.showRocks) for (const rock of map.rocks) {
      const dims = rockDimensions(rock);
      groundShadow(ctx, (rock.x + rock.r * 0.24) * cs, (rock.y + rock.r * 0.33) * cs, dims.w * cs * .60, dims.h * cs * .53, 0.53);
    }
  }
  if (rs.showCivic) for (const item of map.civic ?? []) if (item.kind !== 'square') {
    objects.push({ y: (item.y + item.h) * cs, paint: () => city.civic(item) });
  }
  objects.sort((a, b) => a.y - b.y).forEach((item) => item.paint());
  if (rs.showChests) for (const chest of map.chests) drawChest(ctx, chest, cs, rs.shading);

  if (rs.vignette) {
    const edge = ctx.createRadialGradient(W * 0.43, H * 0.42, Math.min(W, H) * 0.34, W * 0.49, H * 0.48, Math.hypot(W, H) * 0.54);
    edge.addColorStop(0, 'rgba(35,32,21,0)');
    edge.addColorStop(1, 'rgba(29,26,20,.33)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }

  if (rs.showGrid) {
    ctx.save();
    const dungeon = map.biome === 'dungeon';
    if (dungeon) {
      ctx.beginPath();
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const terrain = map.cells[y][x].terrain;
        if (terrain !== 'void' && terrain !== 'wall') ctx.rect(x * cs, y * cs, cs, cs);
      }
      ctx.clip();
    }
    ctx.globalAlpha = rs.gridOpacity * (dungeon ? .82 : 1);
    ctx.strokeStyle = rs.gridColor;
    ctx.lineWidth = Math.max(0.65, cs * 0.018);
    ctx.beginPath();
    if (rs.gridType === 'square') {
      for (let x = 1; x < map.width; x++) { ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, H); }
      for (let y = 1; y < map.height; y++) { ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(W, y * cs + 0.5); }
    } else {
      const radius = cs / Math.sqrt(3);
      for (let row = -1; row * radius * 1.5 < H + cs; row++) for (let col = -1; col * cs < W + cs; col++) {
        const x = col * cs + (row % 2 ? cs / 2 : 0), y = row * radius * 1.5;
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const sx = x + Math.cos(a) * radius, sy = y + Math.sin(a) * radius;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

function eachStructure(map: MapData, draw: (terrain: Terrain, x: number, y: number) => void) {
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const terrain = map.cells[y][x].terrain;
    if (terrain === 'wall' || terrain === 'bridge' || terrain === 'door') draw(terrain, x, y);
  }
}

function wallParts(map: MapData, x: number, y: number): [number, number, number, number][] {
  // Как в предыдущем варианте Sol Max: полоса строится от стороны с полом
  // и продолжается в соседние клетки стены без разрывов.
  const floorLike = (t?: Terrain) => t === 'floor' || t === 'door' || t === 'caveFloor' || t === 'buildingFloor';
  const n = floorLike(at(map, x, y - 1)), e = floorLike(at(map, x + 1, y));
  const s = floorLike(at(map, x, y + 1)), w = floorLike(at(map, x - 1, y));
  const edge = 0.1, inner = 0.25;
  const parts: [number, number, number, number][] = [];
  if (n || s) {
    const across = n && s;
    const x0 = across ? inner : edge, x1 = across ? 1 - inner : 1 - edge;
    const y0 = n ? 0 : 0.48, y1 = s ? 1 : 0.52;
    parts.push([x0, y0, x1 - x0, y1 - y0]);
  }
  if (e || w) {
    const along = e && w;
    const y0 = along ? inner : edge, y1 = along ? 1 - inner : 1 - edge;
    const x0 = w ? 0 : 0.48, x1 = e ? 1 : 0.52;
    parts.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return parts;
}

function drawWall(ctx: CanvasRenderingContext2D, map: MapData, x: number, y: number, cs: number, seed: number) {
  const parts = wallParts(map, x, y);
  if (!parts.length) return;
  ctx.save();
  ctx.translate(x * cs, y * cs);
  ctx.scale(cs, cs);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [px, py, w, h] of parts) ctx.rect(px, py, w, h);
  ctx.lineWidth = 0.071;
  ctx.strokeStyle = '#3c3629';
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = '#39382f';
  ctx.fillRect(-0.02, -0.02, 1.04, 1.04);

  for (let row = -1; row < 4; row++) for (let col = -1; col < 4; col++) {
    const v = hash2(x * 8 + col, y * 8 + row, seed + 91021);
    const j = (v - 0.5) * 0.073;
    const px = col * 0.376 + (row % 2 ? 0.185 : 0) + j;
    const py = row * 0.26 + j * 0.43;
    const w = 0.359 - j * 0.44, h = 0.239 + j * 0.1;
    const lit = 137 + 42 * v;
    const rock = ctx.createLinearGradient(px, py, px + w * 0.45, py + h);
    rock.addColorStop(0, `rgb(${lit + 15},${lit + 12},${lit - 1})`);
    rock.addColorStop(0.24, `rgb(${lit},${lit - 3},${lit - 12})`);
    rock.addColorStop(0.82, `rgb(${lit - 21},${lit - 24},${lit - 31})`);
    rock.addColorStop(1, `rgb(${lit - 42},${lit - 44},${lit - 48})`);
    contour(ctx, [[px + .03, py], [px + w - .05, py + j * .25], [px + w, py + .037], [px + w - .017, py + h - .035], [px + w - .06, py + h], [px + .03, py + h + j * .14], [px, py + h - .038], [px + .009, py + .052]]);
    ctx.fillStyle = rock;
    ctx.fill();
    if (v < 0.35) {
      ctx.strokeStyle = '#49473b91';
      ctx.lineWidth = 0.012;
      ctx.beginPath(); ctx.moveTo(px + w * .36, py + .013); ctx.lineTo(px + w * .55, py + h * .48); ctx.lineTo(px + w * .49, py + h * .64); ctx.stroke();
    } else if (v > 0.63) {
      ctx.fillStyle = '#5c664a68';
      ctx.fillRect(px + w * v * 0.5, py + h * .63, w * 0.3, h * 0.17);
    }
  }
  const light = ctx.createLinearGradient(0, 0, 0.85, 1);
  light.addColorStop(0, 'rgba(255,238,200,.16)');
  light.addColorStop(0.4, 'rgba(255,238,200,0)');
  light.addColorStop(1, 'rgba(18,17,16,.30)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function drawWoodwork(ctx: CanvasRenderingContext2D, map: MapData, kind: 'bridge' | 'door', x: number, y: number, cs: number, seed: number, textured: boolean) {
  const neighbours = [at(map, x - 1, y), at(map, x + 1, y), at(map, x, y - 1), at(map, x, y + 1)];
  const orientations = neighbours.map((t) => kind === 'door' ? Number(t === 'wall' || t === 'void') : t === 'road' || t === 'plaza' ? 2 : Number(t === 'bridge'));
  const horizontal = orientations[0] + orientations[1] >= orientations[2] + orientations[3];
  ctx.save();
  ctx.translate((x + 0.5) * cs, (y + 0.5) * cs);
  ctx.scale(cs, cs);
  if (!horizontal) ctx.rotate(Math.PI / 2);
  const bridge = kind === 'bridge';
  const halfX = bridge ? 0.524 : 0.409, halfY = bridge ? 0.397 : 0.134;
  ctx.fillStyle = '#1a241f9e';
  ctx.fillRect(-halfX + .052, -halfY + .078, halfX * 2.01, halfY * 2 + .094);
  ctx.fillStyle = '#39291c';
  ctx.fillRect(-halfX, -halfY, halfX * 2, halfY * 2);
  const n = bridge ? 6 : 5;
  const plank = halfX * 2 / n;
  const timber = textured ? getAssets().art.timber : undefined;
  for (let i = 0; i < n; i++) {
    const v = hash2(x + i * 821, y, seed + 424), j = (v - 0.5) * 41;
    const px = -halfX + i * plank;
    const stain = ctx.createLinearGradient(px, 0, px + plank, 0);
    stain.addColorStop(0, `rgb(${172 + j},${132 + j},${89 + j})`);
    stain.addColorStop(0.32, `rgb(${145 + j},${103 + j},${61 + j})`);
    stain.addColorStop(1, `rgb(${105 + j},${72 + j},${42 + j})`);
    ctx.fillStyle = stain;
    ctx.fillRect(px + .009, -halfY + .011, plank - .016, halfY * 2 - .022);
    if (timber) {
      ctx.globalAlpha = 0.48;
      ctx.drawImage(timber, v * timber.naturalWidth * 0.67, timber.naturalHeight * 0.14, timber.naturalWidth * 0.25, timber.naturalHeight * 0.71,
        px + .009, -halfY + .011, plank - .016, halfY * 2 - .022);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = v > 0.5 ? '#dbb47e75' : '#53382093';
    ctx.lineWidth = .014;
    ctx.beginPath();
    ctx.moveTo(px + plank * (.38 + v * .21), -halfY * .7);
    ctx.bezierCurveTo(px + plank * .22, -.09, px + plank * .71, .05, px + plank * .53, halfY * .79);
    ctx.stroke();
    if (bridge && i % 2 === 0) {
      ctx.fillStyle = '#3d2f25';
      for (const py of [-halfY * .75, halfY * .75]) { ctx.beginPath(); ctx.arc(px + plank * .55, py, .021, 0, TAU); ctx.fill(); }
    }
  }
  if (bridge) for (const edge of [-halfY, halfY - .055]) {
    ctx.fillStyle = '#4a3624'; ctx.fillRect(-halfX, edge, halfX * 2, .072);
    ctx.fillStyle = '#b08b5a'; ctx.fillRect(-halfX, edge - .005, halfX * 2, .039);
    ctx.fillStyle = '#69563d'; ctx.fillRect(.31, edge - .025, .084, .112);
  } else {
    ctx.fillStyle = '#c3995e'; ctx.fillRect(.18, -.055, .082, .09);
    ctx.fillStyle = '#30271b'; ctx.fillRect(.216, -.03, .016, .036);
  }
  ctx.restore();
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const shadow = ctx.createRadialGradient(0, 0, 0.12, 0, 0, 1);
  shadow.addColorStop(0, `rgba(22,27,17,${alpha})`);
  shadow.addColorStop(0.62, `rgba(22,27,17,${alpha * 0.65})`);
  shadow.addColorStop(1, 'rgba(22,27,17,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function drawSprite(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, width: number, angle: number, height?: number) {
  const h = height ?? width * img.naturalHeight / img.naturalWidth;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(img, -width / 2, -h / 2, width, h);
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D, tree: Tree, cs: number, biome: MapData['biome']) {
  const { kind, v, r } = tree;
  const name = kind === 'oak' && v > 0.61 ? 'oakGold' : kind;
  const img = getAssets().art[name];
  const size = tree.size ? tree.size.w * cs : r * cs * (kind === 'oak' ? 4.1 : kind === 'pine' ? 4.08 : kind === 'bush' ? 3.54 : 2.85);
  if (img) {
    ctx.save();
    if ('filter' in ctx) {
      if (biome === 'snow' && kind === 'pine') ctx.filter = 'saturate(.67) brightness(1.25)';
      else if (kind === 'pine') ctx.filter = 'saturate(.76) hue-rotate(-19deg)';
      else if (kind === 'bush' || kind === 'mushroom') ctx.filter = 'saturate(.66)';
    }
    drawSprite(ctx, img, tree.x * cs, tree.y * cs, size, tree.size ? 0 : (v - 0.5) * 0.89, tree.size ? tree.size.h * cs : undefined);
    ctx.restore();
  } else {
    ctx.fillStyle = '#34442a';
    ctx.strokeStyle = '#566744';
    ctx.lineWidth = r * cs * .12;
    ctx.beginPath();
    for (let i = 0; i < 21; i++) {
      const a = i / 21 * TAU;
      const rr = size * (0.32 + hash2(i, 19, Math.floor(v * 201)) * 0.15);
      const x = tree.x * cs + Math.cos(a) * rr, y = tree.y * cs + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, cs: number) {
  const img = getAssets().art[rock.v > 0.68 ? 'smallRock' : 'rock'];
  if (img) drawSprite(ctx, img, rock.x * cs, rock.y * cs, (rock.size?.w ?? rock.r * 3.05) * cs, rock.size ? 0 : (rock.v - 0.5) * 1.1, rock.size ? rock.size.h * cs : undefined);
  else {
    contour(ctx, rock.pts.map(([x, y]) => [(rock.x + x) * cs, (rock.y + y) * cs]));
    ctx.fillStyle = '#817c6f'; ctx.fill();
    ctx.strokeStyle = '#463f35'; ctx.lineWidth = cs * 0.035; ctx.stroke();
  }
}

export const CHEST_WIDTH = 0.93;

function drawChest(ctx: CanvasRenderingContext2D, chest: Chest, cs: number, shaded: boolean) {
  const x = chest.x * cs, y = chest.y * cs;
  const size = chestDimensions(chest);
  if (shaded) groundShadow(ctx, x + cs * 0.064, y + cs * 0.098, cs * size.w * .54, cs * size.h * .63, 0.67);
  const img = getAssets().art[chestArt(chest)];
  const angle = chest.rotation / 180 * Math.PI;
  if (img) drawSprite(ctx, img, x, y, cs * size.w, angle, cs * size.h);
  else {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(cs, cs);
    ctx.fillStyle = '#37261b'; ctx.fillRect(-.45, -.29, .9, .58);
    ctx.fillStyle = '#976136'; ctx.fillRect(-.41, -.26, .82, .45);
    ctx.fillStyle = '#cfa266';
    for (const i of [-.33, .24]) ctx.fillRect(i, -.265, .079, .527);
    ctx.fillRect(-.075, .015, .15, .16);
    ctx.fillStyle = '#392715'; ctx.fillRect(-.02, .054, .04, .078);
    ctx.restore();
  }
}