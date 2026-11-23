import { hash2 } from './random';
import type { TownFortification } from './gen/settlementPlanner';
import type { MapData, Terrain } from './types';

/**
 * Укрепления поселения по типу (plan.settlement.fortification).
 *
 * Клетки стены остаются клетками 'wall' (непроходимы, правятся кистью), но
 * рисуются не квадратами, а гладкой лентой вдоль кольца: каменная кладка с
 * зубцами или частокол. Лента идёт только там, где клетки стены ещё есть, —
 * проёмы ворот, реки и стёртые редактором участки остаются разрывами.
 */
export function fortificationOf(map: MapData): TownFortification | undefined {
  return map.plan?.settlement?.fortification;
}

const OPEN: ReadonlySet<Terrain> = new Set<Terrain>(['road', 'plaza', 'bridge', 'water', 'deepWater']);

function terrainAt(map: MapData, x: number, y: number): Terrain | undefined {
  return map.cells[y]?.[x]?.terrain;
}

/** Точка кольца лежит на стене: в клетке стены или рядом с ней, но не в проёме. */
function solidAt(map: MapData, px: number, py: number): boolean {
  const x = Math.floor(px), y = Math.floor(py);
  const here = terrainAt(map, x, y);
  if (here === 'wall') return true;
  if (here === undefined || OPEN.has(here)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terrainAt(map, x + dx, y + dy) === 'wall') return true;
  return false;
}

type Run = [number, number][];

/** Разбивает кольцо на сплошные участки стены. */
function wallRuns(map: MapData, ring: TownFortification['rings'][number]): Run[] {
  const steps = Math.max(96, Math.ceil((ring.rx + ring.ry) * 7));
  const point = (i: number): [number, number] => {
    const a = (i / steps) * Math.PI * 2;
    return [ring.cx + Math.cos(a) * ring.rx, ring.cy + Math.sin(a) * ring.ry];
  };
  const solid = Array.from({ length: steps }, (_, i) => solidAt(map, ...point(i)));
  const runs: Run[] = [];
  // Начинаем с проёма, чтобы участок через угол 0 не распался на два.
  const start = solid.indexOf(false);
  if (start < 0) return [[...Array.from({ length: steps + 1 }, (_, i) => point(i % steps))]];
  let current: Run | undefined;
  for (let k = 1; k <= steps; k++) {
    const i = (start + k) % steps;
    if (solid[i]) (current ??= []).push(point(i));
    else if (current) { runs.push(current); current = undefined; }
  }
  if (current) runs.push(current);
  return runs.filter((run) => run.length >= 2);
}

function strokeRun(ctx: CanvasRenderingContext2D, run: Run) {
  ctx.beginPath();
  run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function stoneWall(ctx: CanvasRenderingContext2D, runs: Run[]) {
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(.07, .12);
  ctx.strokeStyle = 'rgba(20,16,12,.34)';
  ctx.lineWidth = 1.02;
  runs.forEach((run) => strokeRun(ctx, run));
  ctx.restore();
  ctx.strokeStyle = '#3b352b';
  ctx.lineWidth = 1;
  runs.forEach((run) => strokeRun(ctx, run));
  ctx.strokeStyle = '#968d78';
  ctx.lineWidth = .84;
  runs.forEach((run) => strokeRun(ctx, run));
  // Боевой ход и зубцы парапета.
  ctx.strokeStyle = '#b3aa92';
  ctx.lineWidth = .36;
  runs.forEach((run) => strokeRun(ctx, run));
  ctx.setLineDash([.2, .16]);
  ctx.strokeStyle = '#6f6754';
  ctx.lineWidth = .7;
  ctx.globalAlpha = .55;
  runs.forEach((run) => strokeRun(ctx, run));
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function palisade(ctx: CanvasRenderingContext2D, runs: Run[], seed: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(.06, .1);
  ctx.strokeStyle = 'rgba(20,14,8,.32)';
  ctx.lineWidth = .62;
  runs.forEach((run) => strokeRun(ctx, run));
  ctx.restore();
  ctx.strokeStyle = '#4a3420';
  ctx.lineWidth = .54;
  runs.forEach((run) => strokeRun(ctx, run));
  // Брёвна частокола: заострённые торцы через равный шаг вдоль ленты.
  for (const run of runs) {
    let carry = 0;
    for (let i = 1; i < run.length; i++) {
      const [ax, ay] = run[i - 1], [bx, by] = run[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (let t = carry; t < len; t += .26) {
        const x = ax + (bx - ax) * (t / len), y = ay + (by - ay) * (t / len);
        const v = hash2(Math.round(x * 13), Math.round(y * 13), seed + 4111);
        ctx.fillStyle = `rgb(${118 + v * 34},${84 + v * 22},${50 + v * 14})`;
        ctx.beginPath();
        ctx.arc(x, y, .14 + v * .03, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,228,180,.28)';
        ctx.beginPath();
        ctx.arc(x - .04, y - .04, .06, 0, Math.PI * 2);
        ctx.fill();
        carry = t + .26 - len;
      }
      if (len < .26) carry -= len;
    }
  }
}

function stoneTower(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgba(20,16,12,.36)';
  ctx.beginPath(); ctx.arc(x + .1, y + .14, .66, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3b352b';
  ctx.beginPath(); ctx.arc(x, y, .66, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - .2, y - .22, .05, x, y, .62);
  g.addColorStop(0, '#c2b9a2');
  g.addColorStop(1, '#857c68');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, .6, 0, Math.PI * 2); ctx.fill();
  // Зубцы по кругу и площадка.
  ctx.fillStyle = '#6a6250';
  for (let k = 0; k < 10; k += 2) {
    const a = (k / 10) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * .48, y + Math.sin(a) * .48, .09, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#a69d86';
  ctx.beginPath(); ctx.arc(x, y, .3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(40,34,26,.5)';
  ctx.lineWidth = .04;
  ctx.stroke();
}

function woodTower(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgba(20,14,8,.34)';
  ctx.fillRect(x - .44, y - .38, .96, .96);
  ctx.fillStyle = '#3f2c1a';
  ctx.fillRect(x - .5, y - .5, 1, 1);
  ctx.fillStyle = '#8a6440';
  ctx.fillRect(x - .44, y - .44, .88, .88);
  ctx.strokeStyle = 'rgba(52,34,18,.7)';
  ctx.lineWidth = .04;
  for (let k = 1; k < 4; k++) {
    ctx.beginPath(); ctx.moveTo(x - .44, y - .44 + k * .22); ctx.lineTo(x + .44, y - .44 + k * .22); ctx.stroke();
  }
  ctx.fillStyle = '#5b3f25';
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(x + dx * .36 - .08, y + dy * .36 - .08, .16, .16);
}

/** Рисует стены и башни поселения; ctx — в пикселях, cs — размер клетки. */
export function drawFortification(ctx: CanvasRenderingContext2D, map: MapData, cs: number, seed: number) {
  const fort = fortificationOf(map);
  if (!fort) return;
  ctx.save();
  ctx.scale(cs, cs);
  const runs = fort.rings.flatMap((ring) => wallRuns(map, ring));
  if (fort.kind === 'stone') stoneWall(ctx, runs);
  else palisade(ctx, runs, seed);
  for (const tower of fort.towers) {
    // Башня, клетку которой стёрли в редакторе, не рисуется.
    if (terrainAt(map, tower.x, tower.y) !== 'wall') continue;
    if (fort.kind === 'stone') stoneTower(ctx, tower.x + .5, tower.y + .5);
    else woodTower(ctx, tower.x + .5, tower.y + .5);
  }
  ctx.restore();
}
