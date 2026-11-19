import { getAssets } from './assets';
import type { MapData } from './types';

const floorLike = (map: MapData, x: number, y: number) => {
  const t = map.cells[y]?.[x]?.terrain;
  return t === 'floor' || t === 'door';
};
const wallEdge = (map: MapData, x: number, y: number) => {
  const t = map.cells[y]?.[x]?.terrain;
  return t === 'wall' || t === 'void' || t === undefined;
};

/**
 * РЎС‚РµРЅРЅРѕР№ СЂРµРЅРґРµСЂ В«РїРѕР»РѕСЃР°РјРё РїРѕ РєРѕРЅС‚СѓСЂСѓВ».
 *
 * Р’РјРµСЃС‚Рѕ СЂР°СЃРєР»Р°РґРєРё РєРІР°РґСЂР°С‚РЅС‹С… СЃРїСЂР°Р№С‚РѕРІ РїРѕ РєР»РµС‚РєР°Рј РѕР±С…РѕРґРёРј РіСЂР°РЅРёС†Сѓ РїРѕР»Р° Рё
 * СЂРёСЃСѓРµРј С‚РѕР»СЃС‚СѓСЋ РєР°РјРµРЅРЅСѓСЋ Р»РµРЅС‚Сѓ СЃ РєСЂСѓРіР»С‹РјРё СЃС‚С‹РєР°РјРё. РЈРіР»С‹ РєРѕРјРЅР°С‚ РїРѕР»СѓС‡Р°СЋС‚СЃСЏ
 * СЃРєСЂСѓРіР»С‘РЅРЅС‹РјРё, Р° РЅРµ РєРІР°РґСЂР°С‚РЅС‹РјРё; С‰РµР»РµР№ РјРµР¶РґСѓ РєР»РµС‚РєР°РјРё РЅРµС‚ РїРѕ РїРѕСЃС‚СЂРѕРµРЅРёСЋ.
 */
export function drawWalls(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  cs: number,
  _seed: number,
  shading: boolean,
): boolean {
  const art = getAssets().art;
  const wall = art['wall-straight'];
  if (!wall) return false;

  const offset = cs * 0.5;
  const segments: [number, number, number, number][] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!floorLike(map, x, y)) continue;
    const left = x * cs, right = (x + 1) * cs;
    const top = y * cs, bottom = (y + 1) * cs;
    if (wallEdge(map, x, y - 1)) segments.push([left, top - offset, right, top - offset]);
    if (wallEdge(map, x, y + 1)) segments.push([left, bottom + offset, right, bottom + offset]);
    if (wallEdge(map, x - 1, y)) segments.push([left - offset, top, left - offset, bottom]);
    if (wallEdge(map, x + 1, y)) segments.push([right + offset, top, right + offset, bottom]);
  }
  if (!segments.length) return true;

  const band = cs * 1.05;
  const path = () => {
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of segments) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // РўС‘РјРЅРѕРµ РѕСЃРЅРѕРІР°РЅРёРµ: РѕРЅРѕ Р¶Рµ РєРѕРЅС‚СѓСЂ Рё В«СЂР°СЃС‚РІРѕСЂВ» РјРµР¶РґСѓ РєР°РјРЅСЏРјРё.
  if (shading) {
    ctx.shadowColor = 'rgba(16,13,9,.55)';
    ctx.shadowBlur = cs * 0.22;
    ctx.shadowOffsetX = cs * 0.08;
    ctx.shadowOffsetY = cs * 0.14;
  }
  ctx.strokeStyle = '#37352b';
  ctx.lineWidth = band;
  path();
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  const pattern = ctx.createPattern(wall, 'repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix([cs / 210, 0, 0, cs / 210, 0, 0]));
    ctx.strokeStyle = pattern;
    ctx.lineWidth = band * 0.92;
    path();
    ctx.stroke();
  }

  // РЎРІРµС‚Р»Р°СЏ РєСЂРѕРјРєР° СЃРІРµСЂС…Сѓ: С‡РёС‚Р°РµС‚СЃСЏ РєР°Рє РІРµСЂС… РєР»Р°РґРєРё.
  ctx.strokeStyle = 'rgba(184,176,146,.22)';
  ctx.lineWidth = Math.max(1, cs * 0.05);
  ctx.translate(0, -cs * 0.18);
  path();
  ctx.stroke();
  ctx.translate(0, cs * 0.18);
  ctx.restore();
  return true;
}

