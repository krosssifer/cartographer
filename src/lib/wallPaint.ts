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
 * Стены «лентой по контуру».
 *
 * Вместо раскладки квадратных спрайтов по клеткам обходим границу пола и
 * рисуем каменную ленту с круглыми стыками. Углы комнат получаются
 * скруглёнными, а не квадратными; щелей между клетками нет по построению.
 * Толщина ленты меньше клетки — внутренняя кромка прижата к полу.
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

  const offset = cs * 0.39;
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

  const band = cs * 0.78;
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

  // Тёмное основание: контур и «раствор» между камнями.
  if (shading) {
    ctx.shadowColor = 'rgba(16,13,9,.55)';
    ctx.shadowBlur = cs * 0.18;
    ctx.shadowOffsetX = cs * 0.06;
    ctx.shadowOffsetY = cs * 0.11;
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

  // Светлая кромка сверху: читается как верх кладки.
  ctx.strokeStyle = 'rgba(184,176,146,.22)';
  ctx.lineWidth = Math.max(1, cs * 0.04);
  ctx.translate(0, -cs * 0.13);
  path();
  ctx.stroke();
  ctx.translate(0, cs * 0.13);
  ctx.restore();
  return true;
}
