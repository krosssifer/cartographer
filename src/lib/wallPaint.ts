import { getAssets } from './assets';
import { hash2 } from './random';
import type { MapData } from './types';

/** РљР»РµС‚РєР° вЂ” СЃС‚РµРЅР°? */
const isWall = (map: MapData, x: number, y: number) => map.cells[y]?.[x]?.terrain === 'wall';

interface Piece {
  kind: 'h' | 'v' | 'junction' | 'single' | 'corner';
  x: number;
  y: number;
  len: number;
  img: HTMLImageElement;
  center?: [number, number];
}

/**
 * Р РёСЃСѓРµС‚ СЃС‚РµРЅС‹ СЃРїСЂР°Р№С‚Р°РјРё РёР· Р»РёСЃС‚Р°: РґР»РёРЅРЅС‹Рµ РїРѕР»РѕСЃС‹, РїРѕРІРѕСЂРѕС‚С‹ Рё СЃС‚РѕР»Р±С‹.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ false, РµСЃР»Рё СЃРїСЂР°Р№С‚С‹ РµС‰С‘ РЅРµ Р·Р°РіСЂСѓР¶РµРЅС‹ (С‚РѕРіРґР° РІС‹Р·С‹РІР°СЋС‰РёР№ РєРѕРґ
 * РёСЃРїРѕР»СЊР·СѓРµС‚ СЃС‚Р°СЂС‹Р№ РїСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЂРµРЅРґРµСЂ).
 */
export function drawWalls(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  cs: number,
  seed: number,
  shading: boolean,
): boolean {
  const art = getAssets().art;
  const straight = art['wall-straight'];
  const ivy = art['wall-straightIvy'];
  const short = art['wall-straightShort'];
  const pillar = art['wall-pillar'];
  const column = art['wall-column'];
  const end = art['wall-end'];
  if (!straight || !pillar) return false;

  const W = map.width;
  const H = map.height;
  const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && isWall(map, x, y);
  const horizontal = (x: number, y: number) => wall(x - 1, y) || wall(x + 1, y);
  const vertical = (x: number, y: number) => wall(x, y - 1) || wall(x, y + 1);
  const flatH = (x: number, y: number) => wall(x, y) && horizontal(x, y) && !vertical(x, y);
  const flatV = (x: number, y: number) => wall(x, y) && vertical(x, y) && !horizontal(x, y);

  const pieces: Piece[] = [];
  const seen = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const pick = (x: number, y: number, salt: number) => hash2(x, y, seed + salt);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!wall(x, y)) continue;
    const h = horizontal(x, y);
    const v = vertical(x, y);
    if (h && v) {
      const v2 = pick(x, y, 7101);
      pieces.push({ kind: 'junction', x, y, len: 1, img: v2 > .72 && column ? column : pillar });
      continue;
    }
    if (!h && !v) {
      if (end) pieces.push({ kind: 'single', x, y, len: 1, img: end });
      continue;
    }
    if (h) {
      if (seen.has(key(x, y))) continue;
      let x0 = x;
      while (flatH(x0 - 1, y)) x0--;
      let x1 = x;
      while (flatH(x1 + 1, y)) x1++;
      for (let i = x0; i <= x1; i++) seen.add(key(i, y));
      const len = x1 - x0 + 1;
      const v = pick(x0, y, 9101);
      const img = len <= 1 && end ? end : len <= 2 && short && v > .55 ? short : v > .78 && ivy ? ivy : straight;
      pieces.push({ kind: 'h', x: x0, y, len, img });
    } else {
      if (seen.has(key(x, y))) continue;
      let y0 = y;
      while (flatV(x, y0 - 1)) y0--;
      let y1 = y;
      while (flatV(x, y1 + 1)) y1++;
      for (let i = y0; i <= y1; i++) seen.add(key(x, i));
      const len = y1 - y0 + 1;
      const v = pick(x, y0, 9201);
      const img = len <= 1 && end ? end : len <= 2 && short && v > .55 ? short : v > .78 && ivy ? ivy : straight;
      pieces.push({ kind: 'v', x, y: y0, len, img });
    }
  }

  // РЈ РєРѕРјРЅР°С‚ СЌС‚РѕР№ РёРіСЂС‹ СѓРіР»С‹ С‡Р°СЃС‚Рѕ В«СЃРєРѕС€РµРЅС‹В»: РіРѕСЂРёР·РѕРЅС‚Р°Р»СЊРЅР°СЏ СЃС‚РµРЅР° Рё
  // РІРµСЂС‚РёРєР°Р»СЊРЅР°СЏ РІСЃС‚СЂРµС‡Р°СЋС‚СЃСЏ РїРѕ РґРёР°РіРѕРЅР°Р»Рё, Р±РµР· РѕР±С‰РµР№ СѓРіР»РѕРІРѕР№ РєР»РµС‚РєРё.
  // Р—Р°РєСЂС‹РІР°РµРј С‚Р°РєРёРµ СЃС‚С‹РєРё СЃС‚РѕР»Р±РѕРј РІ РїСѓСЃС‚РѕР№ РєР»РµС‚РєРµ, РёРЅР°С‡Рµ РІРёРґРµРЅ С‚С‘РјРЅС‹Р№ СЂР°Р·СЂС‹РІ.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (wall(x, y)) continue;
    if (map.cells[y]?.[x]?.terrain !== 'void') continue;
    const n = wall(x, y - 1), s = wall(x, y + 1), e = wall(x + 1, y), w = wall(x - 1, y);
    let center: [number, number] | undefined;
    if (n && w) center = [x, y];
    else if (n && e) center = [x + 1, y];
    else if (s && w) center = [x, y + 1];
    else if (s && e) center = [x + 1, y + 1];
    if (center) pieces.push({ kind: 'corner', x, y, len: 1, img: pillar, center });
  }

  if (!pieces.length) return true;

  const overlap = cs * 0.22;
  const thickness = cs * 1.28;
  const runs = pieces.filter((p) => p.kind === 'h' || p.kind === 'v');
  const posts = pieces.filter((p) => p.kind !== 'h' && p.kind !== 'v');

  const paintPiece = (p: Piece) => {
    if (p.kind === 'h') {
      const w = p.len * cs + overlap * 2;
      ctx.drawImage(p.img, p.x * cs - overlap, p.y * cs - cs * 0.10, w, thickness);
    } else if (p.kind === 'v') {
      const len = p.len * cs + overlap * 2;
      ctx.save();
      ctx.translate((p.x + .5) * cs, (p.y + p.len / 2) * cs);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(p.img, -len / 2, -thickness / 2, len, thickness);
      ctx.restore();
    } else {
      const s = cs * (p.kind === 'single' ? 1.08 : p.kind === 'corner' ? 1.34 : 1.30);
      const cx = (p.center?.[0] ?? p.x + .5) * cs;
      const cy = (p.center?.[1] ?? p.y + .5) * cs;
      ctx.drawImage(p.img, cx - s / 2, cy - s / 2 - cs * .04, s, s);
    }
  };

  const paint = (withShadow: boolean) => {
    ctx.save();
    if (withShadow) {
      ctx.shadowColor = 'rgba(18,14,10,.44)';
      ctx.shadowBlur = cs * 0.16;
      ctx.shadowOffsetX = cs * 0.07;
      ctx.shadowOffsetY = cs * 0.10;
    }
    runs.forEach(paintPiece);
    posts.forEach(paintPiece);
    ctx.restore();
  };

  if (shading) paint(true);
  paint(false);
  return true;
}


