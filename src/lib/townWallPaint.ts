import { getAssets } from './assets';
import { hash2 } from './random';
import { resolveCastleWallMaterial, type CastleWallMaterialId } from './roadMaterials';
import type { TownFortification } from './gen/settlementPlanner';
import type { MapData, RenderSettings, Terrain } from './types';

/**
 * Укрепления поселения по типу (plan.settlement.fortification).
 *
 * Клетки стены остаются клетками 'wall' (непроходимы, правятся кистью), но
 * рисуются гладкой оборонительной лентой вдоль кольца: продольная каменная
 * кладка (castle_wall_*) с боевым ходом и аккуратной тенью кромок или частокол.
 * Геометрия проёмов ворот, рек, башен и скруглённых углов полностью сохранена.
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
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (terrainAt(map, x + dx, y + dy) === 'wall') return true;
    }
  }
  return false;
}

type Run = [number, number][];

/** Разбивает кольцо на сплошные участки стены. */
function wallRuns(map: MapData, ring: TownFortification['rings'][number]): Run[] {
  const steps = Math.max(120, Math.ceil((ring.rx + ring.ry) * 8));
  const point = (i: number): [number, number] => {
    const a = (i / steps) * Math.PI * 2;
    return [ring.cx + Math.cos(a) * ring.rx, ring.cy + Math.sin(a) * ring.ry];
  };
  const solid = Array.from({ length: steps }, (_, i) => solidAt(map, ...point(i)));
  const runs: Run[] = [];
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

function strokeRunPx(ctx: CanvasRenderingContext2D, run: Run, cs: number) {
  ctx.beginPath();
  run.forEach(([x, y], i) => (i ? ctx.lineTo(x * cs, y * cs) : ctx.moveTo(x * cs, y * cs)));
  ctx.stroke();
}

function strokeRunCells(ctx: CanvasRenderingContext2D, run: Run) {
  ctx.beginPath();
  run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

const WALL_FALLBACK: Record<CastleWallMaterialId, { body: string; walk: string; edge: string }> = {
  castle_wall_stone: { body: '#8e887c', walk: '#a8a193', edge: '#332e27' },
  castle_wall_dressed_stone: { body: '#aba28f', walk: '#c2b9a5', edge: '#3a342a' },
  castle_wall_weathered: { body: '#7c786d', walk: '#948f82', edge: '#2d2922' },
};

/**
 * Продольная каменная кладка крепостной стены в пиксельных координатах:
 * курсы камня ориентируются вдоль локальной касательной стены без растяжения,
 * скругляются на поворотах и чётко обрываются у воротных проёмов.
 */
function stoneWall(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  runs: Run[],
  cs: number,
  wallW: number,
  wallMatId: CastleWallMaterialId,
  textured: boolean,
  shaded: boolean,
) {
  if (!runs.length) return;
  const palette = WALL_FALLBACK[wallMatId];
  const img = textured ? getAssets().art[wallMatId] : undefined;
  const bandPx = wallW * cs;
  const outerPx = (wallW + 0.11) * cs;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  // 1. Мягкая контактная тень у подножия стены:
  if (shaded) {
    ctx.save();
    ctx.translate(0.08 * cs, 0.13 * cs);
    ctx.strokeStyle = 'rgba(18, 15, 11, 0.34)';
    ctx.lineWidth = (wallW + 0.16) * cs;
    runs.forEach((run) => strokeRunPx(ctx, run, cs));
    ctx.restore();
  }

  // 2. Тёмная цокольная окантовка внешней и внутренней грани стены:
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = outerPx;
  runs.forEach((run) => strokeRunPx(ctx, run, cs));

  // 3. Основное тело каменной кладки:
  let drewMasonry = false;
  if (img && img.naturalWidth > 0 && typeof document !== 'undefined') {
    const W = Math.max(1, Math.round(map.width * cs));
    const H = Math.max(1, Math.round(map.height * cs));
    // Защита от гигантских буферов при сверхвысоком экспорте (>36 Мпкс):
    if (W * H <= 36_000_000) {
      const mask = document.createElement('canvas');
      mask.width = W;
      mask.height = H;
      const maskCtx = mask.getContext('2d');

      const masonry = document.createElement('canvas');
      masonry.width = W;
      masonry.height = H;
      const mCtx = masonry.getContext('2d');

      const pat = mCtx?.createPattern(img, 'repeat');
      if (maskCtx && mCtx && pat) {
        maskCtx.lineCap = 'butt';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = '#ffffff';
        maskCtx.lineWidth = bandPx;
        runs.forEach((run) => strokeRunPx(maskCtx, run, cs));

        // 1 повтор тайла (640px) = 3.1 клетки вдоль стены: естественный размер блоков при любой длине и толщине.
        const repeatPx = 3.1 * cs;
        const scale = repeatPx / img.naturalWidth;
        const halfBand = bandPx * 0.68;

        for (const run of runs) {
          let arcPx = 0;
          for (let i = 1; i < run.length; i++) {
            const ax = run[i - 1][0] * cs, ay = run[i - 1][1] * cs;
            const bx = run[i][0] * cs, by = run[i][1] * cs;
            const dx = bx - ax, dy = by - ay;
            const segLen = Math.hypot(dx, dy);
            if (segLen < 0.25) continue;
            const angle = Math.atan2(dy, dx);
            const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
            const midArc = arcPx + segLen * 0.5;
            const pad = Math.max(segLen * 0.65, bandPx * 0.58);

            mCtx.save();
            mCtx.translate(mx, my);
            mCtx.rotate(angle);
            mCtx.translate(-midArc, -bandPx * 0.5);
            mCtx.scale(scale, scale);
            mCtx.fillStyle = pat;
            mCtx.fillRect(
              (midArc - pad) / scale,
              (bandPx * 0.5 - halfBand) / scale,
              (pad * 2) / scale,
              (halfBand * 2) / scale,
            );
            mCtx.restore();
            arcPx += segLen;
          }
        }

        // Обрезаем касательную кладку точным гладким силуэтом стены с округлыми углами и прямыми торцами ворот:
        mCtx.globalCompositeOperation = 'destination-in';
        mCtx.drawImage(mask, 0, 0);
        mCtx.globalCompositeOperation = 'source-over';
        ctx.drawImage(masonry, 0, 0);
        drewMasonry = true;
      }
    }
  }

  if (!drewMasonry) {
    ctx.strokeStyle = palette.body;
    ctx.lineWidth = bandPx;
    runs.forEach((run) => strokeRunPx(ctx, run, cs));
  }

  // 4. Светотеневая фаска внешних и внутренних граней + боевой ход парапета (§3.6):
  if (shaded) {
    // Верхне-западный солнечный блик по гребню:
    ctx.save();
    ctx.translate(-0.03 * cs, -0.03 * cs);
    ctx.strokeStyle = 'rgba(244, 236, 218, 0.22)';
    ctx.lineWidth = Math.max(1, bandPx * 0.84);
    runs.forEach((run) => strokeRunPx(ctx, run, cs));
    ctx.restore();
  }

  // Тонкие линии парапета вдоль внешней и внутренней кромок (отделяют боевой ход от откосов без запечённых зубцов):
  const walkW = Math.max(2, bandPx * 0.56);
  ctx.strokeStyle = 'rgba(34, 29, 23, 0.34)';
  ctx.lineWidth = walkW + Math.max(1.5, cs * 0.08);
  runs.forEach((run) => strokeRunPx(ctx, run, cs));

  ctx.strokeStyle = drewMasonry ? 'rgba(235, 228, 212, 0.14)' : palette.walk;
  ctx.lineWidth = walkW;
  runs.forEach((run) => strokeRunPx(ctx, run, cs));

  // Каменные притолоки (торцевые пилоны) на открытых концах у воротных и речных проёмов:
  for (const run of runs) {
    const first = run[0], lastPt = run[run.length - 1];
    if (Math.hypot(first[0] - lastPt[0], first[1] - lastPt[1]) < 0.35) continue;
    const ends: [[number, number], [number, number]][] = [
      [run[0], run[Math.min(2, run.length - 1)]],
      [run[run.length - 1], run[Math.max(0, run.length - 3)]],
    ];
    for (const [tip, inner] of ends) {
      const ang = Math.atan2(tip[1] - inner[1], tip[0] - inner[0]);
      ctx.save();
      ctx.translate(tip[0] * cs, tip[1] * cs);
      ctx.rotate(ang);
      const capL = Math.max(2, cs * 0.16);
      const capW = bandPx * 1.06;
      ctx.fillStyle = palette.edge;
      ctx.fillRect(-capL * 0.8, -capW * 0.54, capL * 1.1, capW * 1.08);
      ctx.fillStyle = palette.walk;
      ctx.fillRect(-capL * 0.65, -capW * 0.46, capL * 0.8, capW * 0.92);
      ctx.restore();
    }
  }

  ctx.restore();
}

function palisade(ctx: CanvasRenderingContext2D, runs: Run[], seed: number, wallScale: number, shaded: boolean) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = 0.54 * wallScale;
  if (shaded) {
    ctx.save();
    ctx.translate(0.06, 0.1);
    ctx.strokeStyle = 'rgba(20,14,8,.32)';
    ctx.lineWidth = w + 0.08;
    runs.forEach((run) => strokeRunCells(ctx, run));
    ctx.restore();
  }
  ctx.strokeStyle = '#4a3420';
  ctx.lineWidth = w;
  runs.forEach((run) => strokeRunCells(ctx, run));
  const postR = Math.max(0.11, 0.14 * wallScale);
  const step = Math.max(0.22, 0.26 * wallScale);
  for (const run of runs) {
    let carry = 0;
    for (let i = 1; i < run.length; i++) {
      const [ax, ay] = run[i - 1], [bx, by] = run[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (let t = carry; t < len; t += step) {
        const x = ax + (bx - ax) * (t / len), y = ay + (by - ay) * (t / len);
        const v = hash2(Math.round(x * 13), Math.round(y * 13), seed + 4111);
        ctx.fillStyle = `rgb(${118 + v * 34},${84 + v * 22},${50 + v * 14})`;
        ctx.beginPath();
        ctx.arc(x, y, postR + v * 0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,228,180,.28)';
        ctx.beginPath();
        ctx.arc(x - 0.04, y - 0.04, postR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        carry = t + step - len;
      }
      if (len < step) carry -= len;
    }
  }
  ctx.restore();
}

function stoneTower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cs: number,
  wallW: number,
  wallMatId: CastleWallMaterialId,
  textured: boolean,
  shaded: boolean,
) {
  const palette = WALL_FALLBACK[wallMatId];
  const img = textured ? getAssets().art[wallMatId] : undefined;
  const rOuter = Math.max(0.58, Math.min(1.08, wallW * 0.74)) * cs;
  const rBody = rOuter * 0.91;
  const rInner = rOuter * 0.56;
  const cx = x * cs, cy = y * cs;

  ctx.save();
  if (shaded) {
    ctx.fillStyle = 'rgba(18, 15, 11, 0.38)';
    ctx.beginPath();
    ctx.arc(cx + 0.1 * cs, cy + 0.14 * cs, rOuter * 1.02, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = palette.edge;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.fill();

  let drewTex = false;
  if (img && img.naturalWidth > 0) {
    const pat = ctx.createPattern(img, 'repeat');
    if (pat) {
      const scale = (2.8 * cs) / img.naturalWidth;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rBody, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(cx - rBody, cy - rBody);
      ctx.scale(scale, scale);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, (rBody * 2) / scale, (rBody * 2) / scale);
      ctx.restore();
      drewTex = true;
    }
  }

  if (!drewTex) {
    const g = ctx.createRadialGradient(cx - rBody * 0.3, cy - rBody * 0.32, rBody * 0.08, cx, cy, rBody);
    g.addColorStop(0, palette.walk);
    g.addColorStop(1, palette.body);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rBody, 0, Math.PI * 2);
    ctx.fill();
  } else if (shaded) {
    const g = ctx.createRadialGradient(cx - rBody * 0.32, cy - rBody * 0.32, rBody * 0.08, cx, cy, rBody);
    g.addColorStop(0, 'rgba(250, 242, 224, 0.24)');
    g.addColorStop(0.65, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(18, 15, 11, 0.34)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rBody, 0, Math.PI * 2);
    ctx.fill();
  }

  // Зубчатое кольцо парапета и внутренняя площадка башни:
  ctx.strokeStyle = 'rgba(34, 29, 23, 0.58)';
  ctx.lineWidth = Math.max(1.2, cs * 0.045);
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(42, 36, 28, 0.45)';
  const crenelR = (rBody + rInner) * 0.5;
  const crenelDot = Math.max(1.4, (rBody - rInner) * 0.36);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * crenelR, cy + Math.sin(a) * crenelR, crenelDot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function woodTower(ctx: CanvasRenderingContext2D, x: number, y: number, wallScale: number, shaded: boolean) {
  const half = Math.max(0.42, Math.min(0.68, 0.5 * wallScale));
  const inner = half * 0.88;
  if (shaded) {
    ctx.fillStyle = 'rgba(20,14,8,.34)';
    ctx.fillRect(x - half + 0.06, y - half + 0.12, half * 1.96, half * 1.96);
  }
  ctx.fillStyle = '#3f2c1a';
  ctx.fillRect(x - half, y - half, half * 2, half * 2);
  ctx.fillStyle = '#8a6440';
  ctx.fillRect(x - inner, y - inner, inner * 2, inner * 2);
  ctx.strokeStyle = 'rgba(52,34,18,.7)';
  ctx.lineWidth = 0.04;
  for (let k = 1; k < 4; k++) {
    const yy = y - inner + (k * inner * 2) / 4;
    ctx.beginPath();
    ctx.moveTo(x - inner, yy);
    ctx.lineTo(x + inner, yy);
    ctx.stroke();
  }
  ctx.fillStyle = '#5b3f25';
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.fillRect(x + dx * inner * 0.82 - 0.08, y + dy * inner * 0.82 - 0.08, 0.16, 0.16);
  }
}

/** Рисует стены и башни поселения; ctx — в пикселях, cs — размер клетки. */
export function drawFortification(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  cs: number,
  seed: number,
  rs?: Pick<RenderSettings, 'wallThickness' | 'shading' | 'texture' | 'castleWallMaterial'>,
) {
  const fort = fortificationOf(map);
  if (!fort) return;
  const wallThickness = rs?.wallThickness ?? 0.34;
  const shaded = rs?.shading ?? true;
  const textured = rs?.texture ?? true;
  const wallW = Math.max(0.54, Math.min(1.48, 0.42 + wallThickness * 1.42));
  const wallScale = wallW / 0.9;
  const runs = fort.rings.flatMap((ring) => wallRuns(map, ring));

  if (fort.kind === 'stone') {
    const wallMatId = resolveCastleWallMaterial(map, rs?.castleWallMaterial);
    stoneWall(ctx, map, runs, cs, wallW, wallMatId, textured, shaded);
    for (const tower of fort.towers) {
      if (terrainAt(map, tower.x, tower.y) !== 'wall') continue;
      stoneTower(ctx, tower.x + 0.5, tower.y + 0.5, cs, wallW, wallMatId, textured, shaded);
    }
    return;
  }

  ctx.save();
  ctx.scale(cs, cs);
  palisade(ctx, runs, seed, wallScale, shaded);
  for (const tower of fort.towers) {
    if (terrainAt(map, tower.x, tower.y) !== 'wall') continue;
    woodTower(ctx, tower.x + 0.5, tower.y + 0.5, wallScale, shaded);
  }
  ctx.restore();
}
