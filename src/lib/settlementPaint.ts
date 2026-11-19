import { getAssets } from './assets';
import { hash2 } from './random';
import { civicArt, marketStalls, ROOF_KIT } from './settlementKit';
import { DIRECTIONS, facingOf } from './interiors';
import { drawInterior } from './interiorPaint';
import { doorStyle, drawDoor } from './doors';
import type { Building, CivicObject, FurnitureSprite, RenderSettings } from './types';

type Vertex = readonly [number, number];

function trace(ctx: CanvasRenderingContext2D, points: readonly Vertex[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

/**
 * Рисует дома, их интерьеры и городские постройки.
 * Изначально холст был двойным с приподнятыми перспективами стен, теперь всё
 * рисуется в один слой. Пример Sol Max был в плоской топографической проекции:
 * сетка, масштаб и тени остаются точными.
 */
export function settlementPainter(ctx: CanvasRenderingContext2D, settings: RenderSettings, seed: number, furnitureSprites: FurnitureSprite[] = []) {
  const cs = settings.cellSize, art = getAssets().art;
  const patterns = new Map<string, CanvasPattern | null>();
  const gallery = Object.fromEntries(furnitureSprites.map((sprite) => [sprite.id, sprite]));
  function material(name: string, scale: number, rotate = false) {
    if (!settings.texture) return null;
    const key = `${name}:${scale}:${rotate}`;
    if (patterns.has(key)) return patterns.get(key) ?? null;
    const img = art[name];
    const pat = img && ctx.createPattern(img, 'repeat');
    pat?.setTransform(new DOMMatrix().rotate(rotate ? 90 : 0).scale(scale / img.naturalWidth));
    patterns.set(key, pat || null);
    return pat || null;
  }
  function shadow(w: number, h: number, strength: number) {
    if (!settings.shading) return;
    ctx.save();
    ctx.translate(w * .55 + .095, h * .58 + .13);
    ctx.scale(w * .68, h * .69);
    const g = ctx.createRadialGradient(0, 0, .21, 0, 0, 1);
    g.addColorStop(0, `rgba(28,27,18,${strength})`);
    g.addColorStop(.68, `rgba(30,28,20,${strength * .58})`);
    g.addColorStop(1, 'rgba(28,27,18,0)');
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }

  function building(b: Building) {
    const { w, h } = b;
    const grain = hash2(b.x, b.y, seed + 31817);
    const roof = ROOF_KIT[b.roof];
    ctx.save(); ctx.translate(b.x * cs, b.y * cs); ctx.scale(cs, cs);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const out: Vertex = DIRECTIONS[facingOf(b)];
    const doorX = b.door.x - b.x + .5 + out[0] * .44, doorY = b.door.y - b.y + .5 + out[1] * .44;

    if (!settings.showRoofs) {
      shadow(w, h, .63);
      drawInterior(ctx, b, seed, material, settings.shading, gallery);
    } else {
      shadow(w, h, .64);
      ctx.save();
      const vertical = h > w;
      const length = vertical ? h : w, depth = vertical ? w : h;
      if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); }
      const x0 = .10, x1 = length - .10, y0 = .065, y1 = depth - .22;
      const mid = y0 + (y1 - y0) * .47;
      const isCross = b.shape === 'cross' && length >= 3 && depth >= 2;
      const isHip = b.shape === 'hip' || b.kind === 'tower';
      const gableEnd = Math.min((y1 - y0) * .37, (x1 - x0) * .25);
      const wingL = x0 + (x1 - x0) * .30, wingR = x0 + (x1 - x0) * .67, wing = (wingL + wingR) * .5;
      const eave = isCross ? y0 + (y1 - y0) * .68 : y1;
      const ridge = isCross ? (y0 + eave) * .5 : mid;
      const base: Vertex[] = isCross ? [[x0, y0], [x1, y0], [x1, eave], [wingR, eave], [wingR, y1], [wingL, y1], [wingL, eave], [x0, eave]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

      ctx.save(); ctx.translate(.05, .13);
      trace(ctx, base); ctx.lineWidth = .17; ctx.strokeStyle = '#352b20'; ctx.stroke();
      ctx.fillStyle = material('bedrock', 2.8) ?? '#90806b'; ctx.fill(); ctx.restore();

      const tile = material(roof.art, roof.scale);
      const roofPane = (path: Vertex[], tone: string, sideways = false) => {
        trace(ctx, path); ctx.fillStyle = (sideways ? material(roof.art, roof.scale, true) : tile) ?? roof.color; ctx.fill();
        ctx.fillStyle = tone; ctx.fill();
        ctx.lineWidth = .024; ctx.strokeStyle = '#30261993'; ctx.stroke();
      };
      if (isHip && !isCross) {
        const a: Vertex = [x0 + gableEnd, mid], z: Vertex = [x1 - gableEnd, mid];
        roofPane([[x0, y0], [x1, y0], z, a], '#fff0cd20');
        roofPane([[x0, y1], a, z, [x1, y1]], '#241d2a43');
        roofPane([[x0, y0], a, [x0, y1]], '#fff0cd2c', true);
        roofPane([[x1, y0], [x1, y1], z], '#2b222649', true);
      } else {
        roofPane([[x0, y0], [x1, y0], [x1, ridge], [x0, ridge]], '#fff2cf25');
        roofPane([[x0, ridge], [x1, ridge], [x1, eave], [x0, eave]], '#291e2440');
        if (isCross) {
          roofPane([[wingL, y1], [wingL, eave], [wing, ridge], [wing, y1]], '#f4e1be16', true);
          roofPane([[wing, ridge], [wingR, eave], [wingR, y1], [wing, y1]], '#29232853', true);
        }
      }
      trace(ctx, base); ctx.strokeStyle = '#3b2e22'; ctx.lineWidth = .055; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0 + .03, isCross ? eave : y1); ctx.lineTo(x0 + .03, y0 + .03); ctx.lineTo(x1 - .04, y0 + .03);
      ctx.strokeStyle = '#ffeecc50'; ctx.lineWidth = .035; ctx.stroke();
      const inset = isHip && !isCross ? gableEnd : .065;
      ctx.beginPath(); ctx.moveTo(x0 + inset, ridge); ctx.lineTo(x1 - inset, ridge);
      if (isCross) { ctx.moveTo(wing, ridge); ctx.lineTo(wing, y1 - .045); }
      ctx.strokeStyle = '#3b2b20b2'; ctx.lineWidth = .084; ctx.stroke();
      ctx.strokeStyle = '#ead6a96e'; ctx.lineWidth = .027; ctx.stroke();

      if (grain > .15 || b.kind === 'hall' || b.kind === 'tavern') {
        const cx = x0 + (x1 - x0) * (grain > .42 ? .73 : .22), cy = ridge - .24;
        ctx.fillStyle = '#241e17a8'; ctx.fillRect(cx + .065, cy + .073, .32, .34);
        ctx.fillStyle = b.style === 'town' ? '#928372' : '#83745b'; ctx.fillRect(cx, cy, .27, .31);
        ctx.fillStyle = '#3b3026'; ctx.fillRect(cx + .057, cy + .055, .155, .186);
        ctx.fillStyle = '#dabd9a'; ctx.fillRect(cx, cy, .27, .048);
      }
      if (b.kind === 'hall' || b.kind === 'tavern' || (b.roof === 4 && length > 3)) {
        ctx.fillStyle = '#3e3931'; ctx.fillRect(x1 - .77, ridge + .22, .40, .41);
        ctx.fillStyle = '#b89d68'; ctx.fillRect(x1 - .74, ridge + .25, .34, .35);
        ctx.fillStyle = '#675d46'; ctx.fillRect(x1 - .68, ridge + .31, .22, .23);
      }
      ctx.restore();
    }
    ctx.translate(doorX, doorY);
    if (out[0]) ctx.rotate(Math.PI / 2);
    if (settings.showRoofs) drawDoor(ctx, b.kind === 'tavern' ? 'carved' : doorStyle(b.style, b.x, b.y, seed), b.kind === 'tavern' ? .93 : .78);
    ctx.restore();
    if (b.kind === 'tavern') tavernSign(b, doorX, doorY, out);
  }

  function tavernSign(b: Building, x: number, y: number, [dx, dy]: Vertex) {
    ctx.save(); ctx.translate(b.x * cs, b.y * cs); ctx.scale(cs, cs);
    ctx.translate(x + dx * .49 - dy * .51, y + dy * .49 + dx * .51);
    ctx.beginPath(); ctx.roundRect(-.39, -.38, .89, .86, .17); ctx.fillStyle = '#241d18a0'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(-.43, -.43, .86, .84, .14);
    ctx.fillStyle = '#733f38'; ctx.fill(); ctx.lineWidth = .062; ctx.strokeStyle = '#e2b57c'; ctx.stroke();
    ctx.strokeStyle = '#edc890'; ctx.lineWidth = .061; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(.12, -.1); ctx.quadraticCurveTo(.38, -.16, .29, .06); ctx.lineTo(.12, .14); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-.22, -.18, .37, .40, .06); ctx.fillStyle = '#e6b773'; ctx.fill();
    ctx.strokeStyle = '#91603f'; ctx.lineWidth = .023; ctx.stroke();
    ctx.fillStyle = '#fff1ce'; ctx.fillRect(-.225, -.21, .38, .10);
    ctx.strokeStyle = '#a47549'; ctx.beginPath(); ctx.moveTo(-.11, -.08); ctx.lineTo(-.11, .16); ctx.moveTo(.012, -.085); ctx.lineTo(.012, .16); ctx.stroke();
    ctx.restore();
  }

  function civic(item: CivicObject) {
    const { w, h, kind } = item;
    ctx.save(); ctx.translate(item.x * cs, item.y * cs); ctx.scale(cs, cs);
    if (kind === 'square') {
      const edge = Math.min(.15, w * .075, h * .075), inset = Math.min(.14, w * .07, h * .07), stroke = Math.min(.1, w * .1, h * .1);
      const radius = Math.min(.55, w * .15, h * .15);
      ctx.beginPath(); ctx.roundRect(edge, edge, w - edge * 2, h - edge * 2, radius);
      ctx.fillStyle = material('cobbles', 4.7) ?? '#9b9078'; ctx.fill();
      ctx.fillStyle = item.variant ? '#bf97592c' : '#cbb78931'; ctx.fill();
      ctx.lineWidth = stroke; ctx.strokeStyle = '#302c208c'; ctx.stroke();
      ctx.beginPath(); ctx.roundRect(edge + inset, edge + inset, w - edge * 2 - inset * 2, h - edge * 2 - inset * 2, radius * .7);
      ctx.lineWidth = .071; ctx.strokeStyle = '#dfc79a92'; ctx.stroke();
      ctx.restore(); return;
    }
    shadow(w, h, kind === 'market' ? .70 : .61);
    ctx.translate(w / 2, h / 2); ctx.rotate(item.rotation * Math.PI / 180);
    const swap = item.rotation === 90 || item.rotation === 270;
    const logicalW = swap ? h : w, logicalH = swap ? w : h;
    const drawSprite = (name: string, x: number, y: number, spanW: number, spanH: number) => {
      const img = art[name];
      if (img) {
        const scale = Math.min(spanW / img.naturalWidth, spanH / img.naturalHeight);
        const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
        ctx.drawImage(img, x - sw / 2, y - sh / 2, sw, sh);
      } else {
        ctx.fillStyle = kind === 'well' || kind === 'fountain' ? '#4f7b72' : kind === 'garden' ? '#55613d' : '#a36b4f';
        ctx.beginPath(); ctx.roundRect(x - spanW / 2, y - spanH / 2, spanW, spanH, .25); ctx.fill();
      }
    };
    if (kind === 'market') {
      const normal = marketStalls(logicalW, logicalH, item.variant);
      const columns = logicalW >= 4 ? 2 : 1, rows = logicalH >= 4 ? 2 : 1;
      const sx = logicalW / (columns * 2), sy = logicalH / (rows * 2);
      for (const stall of normal) drawSprite(stall.art, stall.x * sx, stall.y * sy, 1.87 * sx, 1.86 * sy);
    } else {
      drawSprite(civicArt(item), 0, 0, logicalW * .96, logicalH * 1.01);
    }
    ctx.restore();
  }

  return { building, civic };
}