import { DISTRICTS, type DistrictKind } from '../settlementTypes';
import type { MapData, Point, SettlementDebugLayers } from '../../types';
import type { DistrictLayoutResult } from './districts';
import type { UrbanSkeleton } from './nodes';
import type { UrbanRoadResult } from './roads';
import {
  facingVector,
  type CourtyardKind,
  type SettlementDebugData,
  type UrbanContext,
  type UrbanPlot,
} from './types';

export const DEFAULT_SETTLEMENT_DEBUG: Required<SettlementDebugLayers> = {
  footprint: true,
  density: false,
  districts: true,
  blocks: true,
  plots: false,
  roadHierarchy: true,
  frontage: false,
  courtyards: false,
  emptyAreas: false,
  accessibility: false,
  riverInfluence: false,
  terrainInfluence: false,
  districtLabels: true,
  primaryRoads: false,
  secondaryRoads: false,
  footprints: false,
  landmarks: true,
  urbanAge: false,
  market: false,
  activity: false,
  anchors: false,
  lighting: false,
  scenes: false,
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

const ZONE_COLORS: readonly string[] = [
  'rgba(220, 48, 68, 0.28)',   // 0: old_core
  'rgba(246, 138, 52, 0.24)',  // 1: inner_city
  'rgba(245, 208, 76, 0.20)',  // 2: residential
  'rgba(104, 198, 132, 0.18)', // 3: outer_city
  'rgba(92, 168, 232, 0.16)',  // 4: suburbs
  'rgba(0, 0, 0, 0)',          // 5: wilderness
];

const AGE_COLORS: readonly string[] = [
  'rgba(220, 56, 72, 0.30)',
  'rgba(244, 124, 56, 0.26)',
  'rgba(246, 196, 69, 0.24)',
  'rgba(114, 200, 120, 0.22)',
  'rgba(78, 168, 222, 0.22)',
  'rgba(155, 135, 245, 0.20)',
];

const COURTYARD_COLORS: Record<CourtyardKind, string> = {
  enclosed_courtyard: 'rgba(235, 192, 122, 0.42)',
  garden_yard: 'rgba(116, 214, 112, 0.42)',
  workshop_yard: 'rgba(244, 140, 82, 0.44)',
  inn_yard: 'rgba(255, 186, 73, 0.46)',
  trade_courtyard: 'rgba(92, 204, 236, 0.44)',
  private_garden: 'rgba(182, 128, 255, 0.42)',
  temple_courtyard: 'rgba(255, 244, 168, 0.46)',
};

// 1=street, 2=plaza, 3=courtyard, 4=garden, 5=vegetable_garden, 6=park, 7=empty_plot, 8=nature
const EMPTY_AREA_COLORS: readonly string[] = [
  'rgba(0, 0, 0, 0)',
  'rgba(180, 174, 162, 0.28)', // 1: street
  'rgba(255, 212, 96, 0.34)',  // 2: plaza
  'rgba(224, 172, 112, 0.36)', // 3: courtyard
  'rgba(164, 122, 246, 0.34)', // 4: garden
  'rgba(124, 212, 92, 0.36)',  // 5: vegetable_garden
  'rgba(64, 214, 172, 0.38)',  // 6: park
  'rgba(255, 76, 98, 0.44)',   // 7: empty_plot (подсветка незанятых пятен!)
  'rgba(58, 128, 76, 0.16)',   // 8: nature
];

export function buildSettlementDebugData(
  ctx: UrbanContext,
  skel: UrbanSkeleton,
  distLayout: DistrictLayoutResult,
  roadNet: UrbanRoadResult,
  plots: UrbanPlot[],
  emptyFullGrid: Uint8Array,
  extra?: {
    activityIntensity?: Float32Array;
    intersections?: Point[];
    anchors?: readonly { x: number; y: number; kind: string }[];
    scenes?: readonly import('./scenePlacement').FunctionalPlacement[];
    sceneFailures?: readonly import('./sceneLifecycle').FunctionalSceneFailure[];
  },
): SettlementDebugData {
  const { width: w, height: h, geo } = ctx;
  const step = Math.max(1, Math.ceil(Math.max(w, h) / 64));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const total = gw * gh;

  const districtGrid = new Array<number>(total);
  const zoneGrid = new Array<number>(total);
  const densityGrid = new Array<number>(total);
  const blockGrid = new Array<number>(total);
  const emptyGrid = new Array<number>(total);
  const riverGrid = new Array<number>(total);
  const ageGrid = new Array<number>(total);
  const terrainGrid = new Array<number>(total);
  const activityGrid = extra?.activityIntensity ? new Array<number>(total) : undefined;

  for (let gy = 0; gy < gh; gy++) {
    const y = Math.min(h - 1, gy * step);
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(w - 1, gx * step);
      const idx = y * w + x;
      const gi = gy * gw + gx;
      districtGrid[gi] = distLayout.districtAt[idx];
      zoneGrid[gi] = skel.urbanZoneAt[idx];
      densityGrid[gi] = Math.round(skel.densityField[idx] * 100);
      blockGrid[gi] = distLayout.blockAt[idx];
      emptyGrid[gi] = emptyFullGrid[idx];
      const wd = geo.waterDist[idx];
      riverGrid[gi] = wd >= 20 ? 0 : Math.round(((20 - wd) / 20) * 100);
      ageGrid[gi] = distLayout.growthStageAt[idx];
      terrainGrid[gi] = Math.round(geo.terrainInfluence[idx] * 100);
      if (activityGrid && extra?.activityIntensity) {
        activityGrid[gi] = Math.round(extra.activityIntensity[idx] * 100);
      }
    }
  }

  return {
    step,
    gw,
    gh,
    districtGrid,
    zoneGrid,
    densityGrid,
    blockGrid,
    emptyGrid,
    riverGrid,
    ageGrid,
    terrainGrid,
    blocks: distLayout.blocks.slice(0, 180).map((b) => ({
      id: b.id,
      x: b.bounds.x,
      y: b.bounds.y,
      w: b.bounds.w,
      h: b.bounds.h,
      zone: b.zone,
      shape: b.shape,
      district: b.districtKind,
    })),
    lanes: roadNet.lanes.map((l) => ({ level: l.level, width: l.width, pts: l.points })),
    plots: plots.slice(0, 320).map((p) => ({
      x: p.bounds.x,
      y: p.bounds.y,
      w: p.bounds.w,
      h: p.bounds.h,
      fn: p.fn,
      zone: p.zone,
      wealth: Math.round(p.wealth * 100) / 100,
      roadAccess: p.roadAccess,
      orientation: p.orientation,
      ...(p.courtyardKind ? { courtyardKind: p.courtyardKind } : {}),
      ...(p.yardRect ? { yard: p.yardRect } : {}),
      ...(p.secondaryRect ? { secondary: p.secondaryRect } : {}),
    })),
    ...(activityGrid ? { activityGrid } : {}),
    ...(extra?.intersections ? { intersections: extra.intersections.slice(0, 240) } : {}),
    ...(extra?.anchors ? { anchors: extra.anchors.slice(0, 480).map((a) => ({ x: a.x, y: a.y, kind: a.kind })) } : {}),
    ...(extra?.scenes ? { scenes: [...extra.scenes] } : {}),
    ...(extra?.sceneFailures ? { sceneFailures: [...extra.sceneFailures] } : {}),
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

  // 1. City Footprint (граница пятна города и зоны old_core -> suburbs).
  if (cfg.footprint && dbg.zoneGrid?.length) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const gi = gy * dbg.gw + gx;
        const z = dbg.zoneGrid[gi] ?? 5;
        if (z >= 5) continue;
        ctx.fillStyle = ZONE_COLORS[z] ?? ZONE_COLORS[2];
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);

        // Контур границы компактного города (между outer_city<=3 и suburbs/wilderness>=4).
        if (z <= 3) {
          ctx.fillStyle = 'rgba(255, 240, 150, 0.88)';
          if (gx + 1 < dbg.gw && (dbg.zoneGrid[gi + 1] ?? 5) >= 4) {
            ctx.fillRect((gx + 1) * cellPx - 1.5, gy * cellPx, 2, cellPx);
          }
          if (gx > 0 && (dbg.zoneGrid[gi - 1] ?? 5) >= 4) {
            ctx.fillRect(gx * cellPx - 0.5, gy * cellPx, 2, cellPx);
          }
          if (gy + 1 < dbg.gh && (dbg.zoneGrid[gi + dbg.gw] ?? 5) >= 4) {
            ctx.fillRect(gx * cellPx, (gy + 1) * cellPx - 1.5, cellPx, 2);
          }
          if (gy > 0 && (dbg.zoneGrid[gi - dbg.gw] ?? 5) >= 4) {
            ctx.fillRect(gx * cellPx, gy * cellPx - 0.5, cellPx, 2);
          }
        }
      }
    }
  }

  // 2. Urban Density (непрерывный градиент плотности 0..100).
  if (cfg.density && dbg.densityGrid?.length) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const val = dbg.densityGrid[gy * dbg.gw + gx] ?? 0;
        if (val <= 4) continue;
        const hue = Math.round((1 - val / 100) * 210); // 0=горячий красный центр -> 210=синяя периферия
        ctx.fillStyle = `hsla(${hue}, 88%, 52%, 0.28)`;
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // 11. River Influence (гидрологическое влияние реки/берега).
  if (cfg.riverInfluence && dbg.riverGrid?.length) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const val = dbg.riverGrid[gy * dbg.gw + gx] ?? 0;
        if (val <= 0) continue;
        ctx.fillStyle = `rgba(56, 189, 248, ${(val / 100) * 0.36})`;
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // Доп.: Terrain Influence / Urban Age (обратная совместимость).
  if (cfg.terrainInfluence) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const val = dbg.terrainGrid[gy * dbg.gw + gx];
        if (val <= 2) continue;
        const hue = Math.round((val / 100) * 120);
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.24)`;
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }
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

  // 9. Empty Areas (классификация открытых пространств — Section 17).
  if (cfg.emptyAreas && dbg.emptyGrid?.length) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const ek = dbg.emptyGrid[gy * dbg.gw + gx] ?? 0;
        if (ek <= 0 || ek >= EMPTY_AREA_COLORS.length) continue;
        ctx.fillStyle = EMPTY_AREA_COLORS[ek];
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);
      }
    }
  }

  // 4. Blocks (контуры городских кварталов между улицами — Section 6).
  if (cfg.blocks && dbg.blockGrid?.length) {
    for (let gy = 0; gy < dbg.gh; gy++) {
      for (let gx = 0; gx < dbg.gw; gx++) {
        const gi = gy * dbg.gw + gx;
        const bId = dbg.blockGrid[gi] ?? -1;
        if (bId < 0) continue;
        const hue = (bId * 47) % 360;
        ctx.fillStyle = `hsla(${hue}, 65%, 58%, 0.14)`;
        ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx);

        ctx.fillStyle = `hsla(${hue}, 85%, 68%, 0.78)`;
        if (gx + 1 < dbg.gw && dbg.blockGrid[gi + 1] !== bId) {
          ctx.fillRect((gx + 1) * cellPx - 1, gy * cellPx, 1.4, cellPx);
        }
        if (gy + 1 < dbg.gh && dbg.blockGrid[gi + dbg.gw] !== bId) {
          ctx.fillRect(gx * cellPx, (gy + 1) * cellPx - 1, cellPx, 1.4);
        }
      }
    }
  }

  // 8. Courtyards (типизированные дворы и вторичные пятна застройки — Section 8 & 9).
  if (cfg.courtyards) {
    for (const p of dbg.plots) {
      if (!p.yard) continue;
      const ck = p.courtyardKind ?? 'enclosed_courtyard';
      ctx.fillStyle = COURTYARD_COLORS[ck] ?? COURTYARD_COLORS.enclosed_courtyard;
      ctx.fillRect(p.yard.x * tile, p.yard.y * tile, p.yard.w * tile, p.yard.h * tile);
      ctx.strokeStyle = 'rgba(255, 245, 200, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.yard.x * tile + 0.5, p.yard.y * tile + 0.5, p.yard.w * tile - 1, p.yard.h * tile - 1);

      if (p.secondary) {
        ctx.strokeStyle = 'rgba(86, 226, 255, 0.92)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(
          p.secondary.x * tile + 1,
          p.secondary.y * tile + 1,
          p.secondary.w * tile - 2,
          p.secondary.h * tile - 2,
        );
      }
    }
  }

  // 5. Plots (границы земельных участков).
  if (cfg.plots) {
    for (const p of dbg.plots) {
      ctx.strokeStyle = p.roadAccess ? 'rgba(255, 232, 140, 0.65)' : 'rgba(180, 220, 155, 0.58)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x * tile + 0.5, p.y * tile + 0.5, p.w * tile - 1, p.h * tile - 1);
      if (p.yard) {
        ctx.strokeStyle = 'rgba(130, 235, 165, 0.68)';
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(p.yard.x * tile + 1, p.yard.y * tile + 1, p.yard.w * tile - 2, p.yard.h * tile - 2);
        ctx.setLineDash([]);
      }
    }
  }

  // 6. Road Hierarchy (4 уровня: PRIMARY=1, SECONDARY=2, ALLEY=3, FOOTPATH=4).
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
        ? 'rgba(255, 158, 44, 0.94)'
        : lane.level === 2
        ? 'rgba(255, 218, 102, 0.88)'
        : lane.level === 3
        ? 'rgba(98, 206, 255, 0.84)'
        : 'rgba(204, 150, 255, 0.84)';
      if (lane.level >= 4) ctx.setLineDash([3, 3]);
      ctx.lineWidth = Math.max(1.4, (5 - Math.min(4, lane.level)) * 1.15);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (cfg.roadHierarchy && report.nodes) {
      if (report.routeEdges) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
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

  // 7. Building Frontage (линии уличного фронта + стрелки входов + флигели).
  if (cfg.frontage || cfg.footprints) {
    for (const b of map.buildings ?? []) {
      const isSec = b.role === 'shed' || b.role === 'barn' || (b.w <= 4 && b.h <= 4 && (b.role === 'stable' || b.role === 'workshop' || b.role === 'warehouse'));
      ctx.strokeStyle = isSec ? 'rgba(92, 225, 230, 0.85)' : 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(b.x * tile, b.y * tile, b.w * tile, b.h * tile);

      // Выделяем фасадную грань здания яркой полосой!
      const facing = b.facing ?? 0;
      ctx.strokeStyle = isSec ? '#48cae4' : '#ff9f1c';
      ctx.lineWidth = Math.max(2.2, tile * 0.16);
      ctx.beginPath();
      if (facing === 0) {
        ctx.moveTo(b.x * tile, (b.y + b.h) * tile);
        ctx.lineTo((b.x + b.w) * tile, (b.y + b.h) * tile);
      } else if (facing === 180) {
        ctx.moveTo(b.x * tile, b.y * tile);
        ctx.lineTo((b.x + b.w) * tile, b.y * tile);
      } else if (facing === 90) {
        ctx.moveTo(b.x * tile, b.y * tile);
        ctx.lineTo(b.x * tile, (b.y + b.h) * tile);
      } else {
        ctx.moveTo((b.x + b.w) * tile, b.y * tile);
        ctx.lineTo((b.x + b.w) * tile, (b.y + b.h) * tile);
      }
      ctx.stroke();

      const [fx, fy] = facingVector(facing);
      const dx = (b.door.x + 0.5) * tile;
      const dy = (b.door.y + 0.5) * tile;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx + fx * tile * 0.85, dy + fy * tile * 0.85);
      ctx.stroke();
    }
  }

  // Landmarks & D&D Adventure Chains.
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

  // Отдельный слой микросцен: граница, якорь, детали, рабочие зоны и отказы.
  if (cfg.scenes) {
    const rect = (r: { x: number; y: number; w: number; h: number }) => ctx.strokeRect(r.x * tile, r.y * tile, r.w * tile, r.h * tile);
    for (const scene of dbg.scenes ?? []) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffcf50';
      ctx.setLineDash([5, 3]);
      rect(scene.bounds);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff774f';
      rect(scene.anchor);
      ctx.strokeStyle = '#83e3ff';
      for (const part of scene.parts) rect(part);
      ctx.fillStyle = 'rgba(60, 235, 150, 0.35)';
      for (const area of scene.access) ctx.fillRect(area.x * tile, area.y * tile, area.w * tile, area.h * tile);
      drawPillLabel(ctx, `${scene.sceneId}/${scene.variantId} #${scene.plotId}`, scene.bounds.x * tile, scene.bounds.y * tile - 4, 'rgba(28, 22, 12, 0.88)', '#fff1bc', true);
    }
    for (const failure of dbg.sceneFailures ?? []) {
      ctx.strokeStyle = 'rgba(255, 76, 104, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      rect(failure.zone);
      ctx.setLineDash([]);
      drawPillLabel(ctx, `#${failure.plotId}: ${failure.reason}`, failure.zone.x * tile, (failure.zone.y + failure.zone.h) * tile, 'rgba(55, 15, 24, 0.8)', '#ffd4dc', true);
    }
  }

  // 10. Accessibility (пешая доступность дверей и сводка качества).
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
      const hud = `Качество: ${q.score}/100 | Ядро: ${Math.round(q.coreDensity * 100)}% | Дороги: ${Math.round(q.connectivity * 100)}% | Доступ: ${Math.round(q.accessibility * 100)}%`;
      drawPillLabel(ctx, hud, 12, 18, 'rgba(14, 18, 24, 0.88)', '#a8f0c6', true);
    }
  }

  // 11. Activity Field (тепловая карта трафика и перекрёстки графа улиц).
  if (cfg.activity && dbg?.activityGrid) {
    const { step, gw, gh } = dbg;
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const val = (dbg.activityGrid[gy * gw + gx] ?? 0) / 100;
        if (val < 0.08) continue;
        const r = Math.round(255 * Math.min(1, val * 1.35));
        const g = Math.round(180 * Math.max(0, 1 - Math.abs(val - 0.55) * 1.8));
        const b = Math.round(220 * Math.max(0, 1 - val * 1.4));
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.12 + val * 0.34).toFixed(2)})`;
        ctx.fillRect(gx * step * tile, gy * step * tile, step * tile, step * tile);
      }
    }
    for (const pt of dbg.intersections ?? []) {
      ctx.fillStyle = 'rgba(255, 232, 102, 0.9)';
      ctx.beginPath();
      ctx.arc((pt.x + 0.5) * tile, (pt.y + 0.5) * tile, Math.max(3, tile * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 12. Market Diagnostics (рамка рынка, зоны, статус fallback и счётчик отказов).
  if (cfg.market && map.plan?.market) {
    const mr = map.plan.market;
    const b = mr.bounds;
    ctx.strokeStyle = mr.valid ? 'rgba(255, 214, 70, 0.95)' : 'rgba(255, 70, 90, 0.95)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.x * tile, b.y * tile, b.w * tile, b.h * tile);
    ctx.setLineDash([]);
    for (const z of mr.zones) {
      drawPillLabel(ctx, `${z.kind} (${z.cells})`, (z.x + 0.5) * tile, (z.y + 0.5) * tile, 'rgba(32, 24, 12, 0.82)', '#ffd166');
    }
    const mHud = `Рынок [${mr.archetype}/${mr.fallbackStep ?? 'full'}]: мест ${mr.placed}/${mr.clusters} | объ. ${mr.objects} | откл. ${mr.rejectedCount ?? 0}`;
    drawPillLabel(ctx, mHud, 12, 38, 'rgba(28, 22, 12, 0.9)', '#ffe082', true);
  }

  // 13. Anchors & Reservations (пространственные резервы, якоря декора и фасадные элементы).
  if (cfg.anchors) {
    for (const res of report.reservations ?? []) {
      ctx.strokeStyle = 'rgba(114, 224, 255, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(res.bounds.x * tile, res.bounds.y * tile, res.bounds.w * tile, res.bounds.h * tile);
      ctx.setLineDash([]);
    }
    for (const anc of dbg.anchors ?? []) {
      ctx.fillStyle =
        anc.kind === 'intersection'
          ? '#ffd166'
          : anc.kind === 'quayside'
            ? '#4cc9f0'
            : anc.kind === 'gate_zone'
              ? '#ef476f'
              : '#95d5b2';
      ctx.fillRect((anc.x + 0.3) * tile, (anc.y + 0.3) * tile, tile * 0.4, tile * 0.4);
    }
    for (const b of map.buildings ?? []) {
      if (!b.attachments?.length) continue;
      ctx.strokeStyle = 'rgba(255, 166, 76, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((b.x + 0.08) * tile, (b.y + 0.08) * tile, (b.w - 0.16) * tile, (b.h - 0.16) * tile);
    }
  }

  // 14. Lighting Coverage (радиусы источников света и тёмные зоны).
  if (cfg.lighting && map.lights?.length) {
    for (const lt of map.lights) {
      ctx.strokeStyle = lt.kind === 'window_glow' ? 'rgba(255, 213, 153, 0.35)' : 'rgba(255, 184, 92, 0.72)';
      ctx.fillStyle = 'rgba(255, 184, 92, 0.10)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(lt.x * tile, lt.y * tile, lt.radius * tile, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = lt.color;
      ctx.beginPath();
      ctx.arc(lt.x * tile, lt.y * tile, Math.max(2.5, tile * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    drawPillLabel(ctx, `Свет: ${map.lights.length} ист.`, 12, 58, 'rgba(20, 18, 28, 0.9)', '#ffc978', true);
  }

  // Подписи районов.
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
