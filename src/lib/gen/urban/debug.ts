import { DISTRICTS, type DistrictKind } from '../settlementTypes';
import type { MapData, SettlementDebugLayers } from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { UrbanRoadResult } from './roads';
import {
  facingVector,
  type SettlementDebugData,
  type UrbanContext,
  type UrbanPlot,
} from './types';

export const DEFAULT_SETTLEMENT_DEBUG: Required<SettlementDebugLayers> = {
  terrainInfluence: false,
  districts: true,
  districtLabels: true,
  primaryRoads: false,
  secondaryRoads: false,
  plots: false,
  footprints: false,
  landmarks: true,
  accessibility: false,
  roadHierarchy: true,
  urbanAge: false,
};

const DISTRICT_COLORS: Record<DistrictKind, string> = {
  centre: 'rgba(255, 196, 86, 0.24)',
  residential: 'rgba(116, 198, 157, 0.22)',
  noble: 'rgba(199, 125, 255, 0.25)',
  craft: 'rgba(244, 132, 95, 0.24)',
  market: 'rgba(255, 214, 102, 0.26)',
  docks: 'rgba(72, 202, 228, 0.26)',
  garrison: 'rgba(239, 71, 111, 0.25)',
  temple: 'rgba(255, 243, 176, 0.26)',
  poor: 'rgba(164, 138, 110, 0.25)',
  farms: 'rgba(167, 201, 87, 0.22)',
};

const AGE_COLORS: readonly string[] = [
  'rgba(220, 56, 72, 0.30)',   // 0: origin
  'rgba(244, 124, 56, 0.26)',  // 1: early_settlement
  'rgba(246, 196, 69, 0.24)',  // 2: market_growth
  'rgba(114, 200, 120, 0.22)', // 3: wall_expansion
  'rgba(78, 168, 222, 0.22)',  // 4: outer_city
  'rgba(155, 135, 245, 0.20)', // 5: suburbs
];

export function buildSettlementDebugData(
  ctx: UrbanContext,
  distLayout: DistrictLayoutResult,
  roadNet: UrbanRoadResult,
  plots: UrbanPlot[],
): SettlementDebugData {
  const { width: w, height: h, geo } = ctx;
  const step = Math.max(1, Math.ceil(Math.max(w, h) / 64));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const districtGrid = new Array<number>(gw * gh);
  const ageGrid = new Array<number>(gw * gh);
  const terrainGrid = new Array<number>(gw * gh);

  for (let gy = 0; gy < gh; gy++) {
    const y = Math.min(h - 1, gy * step);
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(w - 1, gx * step);
      const idx = y * w + x;
      const gi = gy * gw + gx;
      districtGrid[gi] = distLayout.districtAt[idx];
      ageGrid[gi] = distLayout.growthStageAt[idx];
      terrainGrid[gi] = Math.round(geo.terrainInfluence[idx] * 100);
    }
  }

  return {
    step,
    gw,
    gh,
    districtGrid,
    ageGrid,
    terrainGrid,
    lanes: roadNet.lanes.map((l) => ({ level: l.level, width: l.width, pts: l.points })),
    plots: plots.slice(0, 260).map((p) => ({
      x: p.bounds.x,
      y: p.bounds.y,
      w: p.bounds.w,
      h: p.bounds.h,
      fn: p.fn,
      wealth: Math.round(p.wealth * 100) / 100,
      roadAccess: p.roadAccess,
      orientation: p.orientation,
      ...(p.yardRect ? { yard: p.yardRect } : {}),
    })),
  };
}

export function drawSettlementDebugOverlay(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  tile: number,
  layers?: SettlementDebugLayers,
) {
  const report = map.plan?.settlement;
  if (!report || !report.debug) return;

  const cfg: Required<SettlementDebugLayers> = {
    ...DEFAULT_SETTLEMENT_DEBUG,
    ...(layers ?? {}),
  };
  const dbg = report.debug;
  const cellPx = dbg.step * tile;

  ctx.save();

  // 1. Terrain Influence (тепловая карта пригодности рельефа).
  if (cfg.terrainInfluence) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const val = dbg.terrainGrid[gy * dbg.gw + gx];
        if (val <= 2) continue;
        const hue = Math.round((val / 100) * 120); // 0=красный -> 120=зелёный
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.24)`;
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // 2. Urban Age (исторические кольца роста).
  if (cfg.urbanAge) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const dIdx = dbg.districtGrid[gy * dbg.gw + gx];
        if (dIdx < 0) continue;
        const age = dbg.ageGrid[gy * dbg.gw + gx] ?? 0;
        ctx.fillStyle = AGE_COLORS[Math.min(AGE_COLORS.length - 1, Math.max(0, age))];
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // 3. Districts (цветовые зоны районов).
  if (cfg.districts) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const dIdx = dbg.districtGrid[gy * dbg.gw + gx];
        if (dIdx < 0 || dIdx >= report.districts.length) continue;
        const kind = report.districts[dIdx].kind;
        ctx.fillStyle = DISTRICT_COLORS[kind] ?? 'rgba(200,200,200,0.18)';
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // 4. Plots (границы земельных участков и внутренних дворов).
  if (cfg.plots) {
    for (const p of dbg.plots) {
      ctx.strokeStyle = p.roadAccess ? 'rgba(255, 232, 140, 0.62)' : 'rgba(255, 140, 110, 0.62)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x * tile + 0.5, p.y * tile + 0.5, p.w * tile - 1, p.h * tile - 1);
      if (p.yard) {
        ctx.strokeStyle = 'rgba(130, 235, 165, 0.65)';
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(p.yard.x * tile + 1, p.yard.y * tile + 1, p.yard.w * tile - 2, p.yard.h * tile - 2);
        ctx.setLineDash([]);
      }
    }
  }

  // 5 & 6 & 10. Primary Roads / Secondary Roads / Road Hierarchy + Urban Nodes.
  if (cfg.primaryRoads || cfg.secondaryRoads || cfg.roadHierarchy) {
    for (const lane of dbg.lanes) {
      const isPrimary = lane.level <= 2;
      if (isPrimary && !cfg.primaryRoads && !cfg.roadHierarchy) continue;
      if (!isPrimary && !cfg.secondaryRoads && !cfg.roadHierarchy) continue;
      if (lane.pts.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo((lane.pts[0].x + 0.5) * tile, (lane.pts[0].y + 0.5) * tile);
      for (let i = 1; i < lane.pts.length; i++) {
        ctx.lineTo((lane.pts[i].x + 0.5) * tile, (lane.pts[i].y + 0.5) * tile);
      }
      ctx.strokeStyle = lane.level === 1
        ? 'rgba(255, 170, 55, 0.92)'
        : lane.level === 2
        ? 'rgba(255, 220, 115, 0.85)'
        : lane.level === 3
        ? 'rgba(105, 205, 255, 0.80)'
        : 'rgba(198, 145, 255, 0.82)';
      ctx.lineWidth = Math.max(1.5, (5 - lane.level) * 1.15);
      ctx.stroke();
    }

    if (cfg.roadHierarchy && report.nodes) {
      // Граф городских узлов (скелет).
      if (report.routeEdges) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        const byId = new Map(report.nodes.map((n) => [n.id, n]));
        for (const e of report.routeEdges) {
          const a = byId.get(e.from), b = byId.get(e.to);
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo((a.x + 0.5) * tile, (a.y + 0.5) * tile);
          ctx.lineTo((b.x + 0.5) * tile, (b.y + 0.5) * tile);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      for (const n of report.nodes) {
        ctx.fillStyle = n.kind === 'origin'
          ? '#ff4d6d'
          : n.kind === 'center' || n.kind === 'market'
          ? '#ffd166'
          : n.kind === 'gate'
          ? '#06d6a0'
          : '#8ecae6';
        ctx.beginPath();
        ctx.arc((n.x + 0.5) * tile, (n.y + 0.5) * tile, Math.max(3, tile * 0.24), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 7. Building Footprints + векторы фасадов.
  if (cfg.footprints) {
    for (const b of map.buildings ?? []) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(b.x * tile, b.y * tile, b.w * tile, b.h * tile);

      const [fx, fy] = facingVector(b.facing ?? 0);
      const dx = (b.door.x + 0.5) * tile;
      const dy = (b.door.y + 0.5) * tile;
      ctx.strokeStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx + fx * tile * 0.85, dy + fy * tile * 0.85);
      ctx.stroke();
    }
  }

  // 8. Landmarks & D&D Adventure Chains.
  if (cfg.landmarks && report.landmarks) {
    if (report.chains) {
      ctx.strokeStyle = 'rgba(255, 120, 180, 0.78)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 3]);
      for (const ch of report.chains) {
        if (ch.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo((ch.points[0].x + 0.5) * tile, (ch.points[0].y + 0.5) * tile);
        for (let i = 1; i < ch.points.length; i++) {
          ctx.lineTo((ch.points[i].x + 0.5) * tile, (ch.points[i].y + 0.5) * tile);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.font = `bold ${Math.max(9, Math.round(tile * 0.55))}px sans-serif`;
    for (const lm of report.landmarks) {
      const cx = (lm.x + 0.5) * tile;
      const cy = (lm.y + 0.5) * tile;
      const r = Math.max(4, tile * 0.34);
      ctx.fillStyle = lm.accessible ? 'rgba(255, 209, 102, 0.92)' : 'rgba(255, 80, 80, 0.92)';
      ctx.strokeStyle = 'rgba(20, 16, 12, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      drawPillLabel(ctx, lm.label, cx, cy - r - 5, 'rgba(24, 18, 12, 0.82)', '#ffe8a3');
    }
  }

  // 9. Accessibility (доступность дверей и плашка качества генерации).
  if (cfg.accessibility) {
    for (const b of map.buildings ?? []) {
      const [fx, fy] = facingVector(b.facing ?? 0);
      const ox = b.door.x + fx, oy = b.door.y + fy;
      const inMap = ox >= 0 && oy >= 0 && ox < map.width && oy < map.height;
      const tr = inMap ? map.cells[oy][ox].terrain : 'wall';
      const ok = inMap && tr !== 'wall' && tr !== 'water' && tr !== 'deepWater' && tr !== 'rock';
      ctx.fillStyle = ok ? '#52b788' : '#ef476f';
      ctx.beginPath();
      ctx.arc((ox + 0.5) * tile, (oy + 0.5) * tile, Math.max(2.5, tile * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }

    if (report.quality) {
      const q = report.quality;
      const hud = `Качество: ${q.score}/100 | Дороги: ${Math.round(q.connectivity * 100)}% | Доступ: ${Math.round(q.accessibility * 100)}%`;
      drawPillLabel(ctx, hud, 12, 18, 'rgba(14, 18, 24, 0.88)', '#a8f0c6', true);
    }
  }

  // 11. District Labels (подписи районов).
  if (cfg.districtLabels) {
    ctx.font = `bold ${Math.max(10, Math.round(tile * 0.62))}px sans-serif`;
    for (const d of report.districts) {
      if (d.buildings === 0 && d.area !== undefined && d.area < 12) continue;
      const label = `${DISTRICTS[d.kind].label} (${d.buildings})`;
      drawPillLabel(ctx, label, (d.x + 0.5) * tile, (d.y + 0.5) * tile, 'rgba(18, 20, 26, 0.78)', '#f4f1de');
    }
  }

  ctx.restore();
}

function drawPillLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  alignLeft = false,
) {
  const metrics = ctx.measureText(text);
  const padX = 5;
  const h = 15;
  const w = metrics.width + padX * 2;
  const rx = alignLeft ? x : x - w / 2;
  const ry = y - h / 2;
  ctx.fillStyle = bg;
  ctx.fillRect(rx, ry, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = alignLeft ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, alignLeft ? rx + padX : x, y + 0.5);
}
