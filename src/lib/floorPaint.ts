/**
 * Покрытие пола архитектурного комплекса (MapData.floorLayer).
 *
 * Код клетки — одна буква (см. gen/complex/styles.ts): строчная — поле зала,
 * заглавная — бордюр у стен, '.' — без покрытия, 'n' — природная порода.
 * Материалы рисуются полупрозрачно поверх базовой текстуры пола, поэтому
 * сохраняют общий стиль карты. Слой живёт в кэше «земли» и перерисовывается
 * только при смене карты — на перемещение объектов не влияет.
 */
import { hash2 } from './random';
import type { FloorOrnament, MapData } from './types';

type Ctx = CanvasRenderingContext2D;

const lineCell = (ctx: Ctx, x0: number, y0: number, x1: number, y1: number) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };

function material(ctx: Ctx, code: string, x: number, y: number, seed: number) {
  const h = hash2(x, y, seed);
  switch (code) {
    case 'n': {
      // Природная порода: неровные пятна грунта без швов кладки.
      // Плотная подложка закрывает швы плит базовой текстуры.
      ctx.fillStyle = `rgb(${94 + Math.round(h * 12)},${85 + Math.round(h * 9)},${70 + Math.round(h * 7)})`;
      ctx.globalAlpha = .9;
      ctx.fillRect(x - .01, y - .01, 1.02, 1.02);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(58,50,40,.28)';
      ctx.beginPath();
      ctx.ellipse(x + .3 + h * .4, y + .35 + hash2(y, x, seed) * .3, .18 + h * .14, .1 + h * .08, h * 3, 0, Math.PI * 2);
      ctx.fill();
      if (h > .6) { ctx.fillStyle = 'rgba(150,138,116,.45)'; ctx.beginPath(); ctx.arc(x + .7, y + .25 + h * .5, .045, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    case 'r': {
      ctx.fillStyle = `rgba(62,56,48,${.14 + h * .1})`;
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(38,32,26,.35)'; ctx.lineWidth = .035;
      ctx.beginPath();
      lineCell(ctx, x + h * .5, y, x + .2 + h * .4, y + 1);
      lineCell(ctx, x, y + .3 + h * .4, x + 1, y + .5 + hash2(y, x, seed) * .3);
      ctx.stroke();
      return;
    }
    case 'd': {
      ctx.fillStyle = h > .5 ? 'rgba(196,186,160,.13)' : 'rgba(70,62,50,.1)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(40,34,27,.42)'; ctx.lineWidth = .04;
      ctx.strokeRect(x + .02, y + .02, .96, .96);
      return;
    }
    case 'm': {
      ctx.fillStyle = h > .5 ? 'rgba(232,226,210,.55)' : 'rgba(214,208,194,.55)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(128,118,104,.34)'; ctx.lineWidth = .025;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.bezierCurveTo(x + .3, y + h * .4, x + .6, y + 1 - h * .6, x + 1, y + hash2(y, x, seed));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110,100,86,.38)'; ctx.lineWidth = .03;
      ctx.beginPath();
      if (x % 2 === 0) lineCell(ctx, x, y, x, y + 1);
      if (y % 2 === 0) lineCell(ctx, x, y, x + 1, y);
      ctx.stroke();
      return;
    }
    case 'b': {
      ctx.fillStyle = 'rgba(146,82,56,.36)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(62,36,26,.45)'; ctx.lineWidth = .03;
      ctx.beginPath();
      for (let r = 0; r < 4; r += 1) {
        const yy = y + r * .25;
        lineCell(ctx, x, yy, x + 1, yy);
        const off = (r + y * 4) % 2 ? .25 : .75;
        lineCell(ctx, x + off, yy, x + off, yy + .25);
      }
      ctx.stroke();
      return;
    }
    case 'o': {
      // Мозаика: ромбический узор из тессер в три цвета.
      ctx.fillStyle = 'rgba(176,150,108,.3)';
      ctx.fillRect(x, y, 1, 1);
      const palette = ['rgba(176,120,64,.45)', 'rgba(64,118,112,.42)', 'rgba(220,206,170,.45)', 'rgba(136,62,46,.4)'];
      for (let j = 0; j < 3; j += 1) for (let i = 0; i < 3; i += 1) {
        const gx = x * 3 + i, gy = y * 3 + j;
        const ring = (Math.abs(((gx + gy) % 8) - 4) + Math.abs(((gx - gy + 800) % 8) - 4)) % 4;
        ctx.fillStyle = palette[ring];
        ctx.fillRect(x + i / 3 + .02, y + j / 3 + .02, 1 / 3 - .04, 1 / 3 - .04);
      }
      return;
    }
    case 't': {
      for (let j = 0; j < 2; j += 1) for (let i = 0; i < 2; i += 1) {
        ctx.fillStyle = (x * 2 + i + y * 2 + j) % 2 ? 'rgba(222,214,192,.2)' : 'rgba(52,48,46,.15)';
        ctx.fillRect(x + i / 2, y + j / 2, .5, .5);
      }
      ctx.strokeStyle = 'rgba(40,36,30,.3)'; ctx.lineWidth = .02;
      ctx.strokeRect(x, y, 1, 1);
      return;
    }
    case 'w': {
      ctx.fillStyle = `rgba(${118 + Math.round(h * 20)},78,44,.58)`;
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(52,30,16,.5)'; ctx.lineWidth = .03;
      ctx.beginPath();
      for (let r = 0; r < 3; r += 1) {
        const yy = y + r / 3;
        lineCell(ctx, x, yy, x + 1, yy);
        const end = hash2(x, y * 3 + r, seed);
        if (end > .55) lineCell(ctx, x + end, yy, x + end, yy + 1 / 3);
      }
      ctx.stroke();
      return;
    }
    case 'i': {
      ctx.fillStyle = 'rgba(112,116,122,.5)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(40,42,46,.55)'; ctx.lineWidth = .04;
      ctx.strokeRect(x + .03, y + .03, .94, .94);
      ctx.fillStyle = 'rgba(190,192,196,.6)';
      for (const [dx, dy] of [[.14, .14], [.86, .14], [.14, .86], [.86, .86]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, .04, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    case 'x': {
      ctx.fillStyle = `rgba(70,62,52,${.22 + h * .12})`;
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(30,26,22,.45)'; ctx.lineWidth = .03;
      ctx.beginPath();
      ctx.moveTo(x + h, y);
      ctx.lineTo(x + .5, y + .5 + (h - .5) * .3);
      ctx.lineTo(x + hash2(y, x, seed), y + 1);
      ctx.stroke();
      return;
    }
    default:
  }
}

function ornament(ctx: Ctx, o: FloorOrnament) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = 'rgba(214,202,168,.28)';
  ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,118,62,.7)'; ctx.lineWidth = .09;
  ctx.beginPath(); ctx.arc(0, 0, o.r - .05, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = .05;
  ctx.beginPath(); ctx.arc(0, 0, o.r * .78, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(96,74,40,.62)';
  ctx.beginPath();
  if (o.kind === 'star') {
    const n = 8;
    for (let k = 0; k <= n * 2; k += 1) {
      const a = (k / (n * 2)) * Math.PI * 2, r = k % 2 ? o.r * .3 : o.r * .74;
      if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  } else if (o.kind === 'rosette') {
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a - .4) * o.r * .6, Math.sin(a - .4) * o.r * .6, Math.cos(a) * o.r * .74, Math.sin(a) * o.r * .74);
      ctx.quadraticCurveTo(Math.cos(a + .4) * o.r * .6, Math.sin(a + .4) * o.r * .6, 0, 0);
    }
  } else if (o.kind === 'sun') {
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * o.r * .3, Math.sin(a) * o.r * .3);
      ctx.lineTo(Math.cos(a) * o.r * (k % 2 ? .55 : .74), Math.sin(a) * o.r * (k % 2 ? .55 : .74));
    }
    ctx.moveTo(o.r * .3, 0); ctx.arc(0, 0, o.r * .3, 0, Math.PI * 2);
  } else {
    ctx.arc(0, 0, o.r * .5, 0, Math.PI * 2);
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.moveTo(Math.cos(a) * o.r * .62 + .07, Math.sin(a) * o.r * .62);
      ctx.arc(Math.cos(a) * o.r * .62, Math.sin(a) * o.r * .62, .07, 0, Math.PI * 2);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Рисует покрытие пола в слое «земли». */
export function paintFloorLayer(ctx: Ctx, map: MapData, cs: number, seed: number) {
  const layer = map.floorLayer;
  if (!layer || layer.codes.length !== map.width * map.height) return;
  ctx.save();
  ctx.scale(cs, cs);
  const codes = layer.codes;
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const raw = codes[y * map.width + x];
    if (raw === '.') continue;
    const t = map.cells[y]?.[x]?.terrain;
    if (t !== 'floor' && t !== 'door') continue;
    const code = raw.toLowerCase();
    material(ctx, code, x, y, seed);
    if (raw !== code) {
      // Бордюр: тёмная полоса и светлая кромка со стороны поля зала.
      ctx.fillStyle = 'rgba(48,38,28,.24)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(214,190,130,.32)'; ctx.lineWidth = .05;
      ctx.beginPath();
      const inner = (dx: number, dy: number) => { const c = codes[(y + dy) * map.width + x + dx]; return c !== undefined && c !== '.' && c === c.toLowerCase() && c !== 'n'; };
      if (inner(1, 0)) lineCell(ctx, x + .94, y, x + .94, y + 1);
      if (inner(-1, 0)) lineCell(ctx, x + .06, y, x + .06, y + 1);
      if (inner(0, 1)) lineCell(ctx, x, y + .94, x + 1, y + .94);
      if (inner(0, -1)) lineCell(ctx, x, y + .06, x + 1, y + .06);
      ctx.stroke();
    }
  }
  for (const o of layer.ornaments) ornament(ctx, o);
  ctx.restore();
}

/** Клетка пола — природная порода (для лент стен: скала вместо кладки). */
export function naturalFloor(map: MapData, x: number, y: number): boolean {
  const layer = map.floorLayer;
  if (!layer) return false;
  return layer.codes[y * map.width + x] === 'n';
}
