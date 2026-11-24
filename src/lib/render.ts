import { drawDungeonDressingDebug } from './gen/complex/debug';
import { getAssets } from './assets';
import { paintDecor } from './decor';
import { drawLooked, spriteLook } from './spriteLook';
import { cryptPainter } from './cryptPaint';
import { setCivicRenderDiagnostics, settlementPainter } from './settlementPaint';
import { hash2 } from './random';
import { paintTerrain } from './terrainPaint';
import { chaikin } from './pathSmooth';
import { chestArt, chestDimensions } from './chests';
import { doorAxis, doorKindAt, doorStyle, drawDoor, drawDoorKind } from './doors';
import { treeDimensions, rockDimensions } from './objectSizing';
import { drawWalls } from './wallPaint';
import { paintFloorLayer } from './floorPaint';
import { drawFortification, fortificationOf } from './townWallPaint';
import { ROAD_MATERIAL_IDS, resolveLaneRoadMaterial, selectCellRoadMaterial, type RoadMaterialId } from './roadMaterials';
import { drawSettlementDebugOverlay } from './gen/urban/debug';
import { drawFurnishing } from './interiorPaint';
import { interiorOf } from './interiors';
import { furnitureBounds } from './furnitureKit';
import type { Chest, MapData, ObjectTarget, RenderSettings, Rock, Terrain, Tree } from './types';

export { TERRAIN_COLORS, TERRAIN_LABELS } from './palette';

const TAU = 2 * Math.PI;
const at = (map: MapData, x: number, y: number) => map.cells[y]?.[x]?.terrain;

function contour(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
}

/**
 * Во сколько раз рисуем карту плотнее её CSS-размера.
 *
 * Превью и редактор показывают канвас через CSS-масштаб (зум до 300 %), поэтому
 * при плотности 1 пиксель/клетка зум сразу «мылит». Увеличиваем внутреннее
 * разрешение с запасом, но ограничиваем общий размер буфера, чтобы большие
 * карты (100×80) не съедали сотни мегабайт.
 */
export function renderPixelRatio(map: MapData, rs: RenderSettings, budget = PIXEL_BUDGET) {
  const pixels = map.width * rs.cellSize * map.height * rs.cellSize;
  if (!pixels) return 1;
  if (pixels >= budget) return 1;
  const ratio = Math.min(MAX_PIXEL_RATIO, Math.sqrt(budget / pixels));
  return Math.max(1, Math.floor(ratio * 2) / 2);
}

/**
 * Бюджет буфера редактора. Раньше было 16 Мпкс и ×2.5: карта 44×30 рисовалась
 * в холст 4400×3000 (13 Мпкс) при экранных 900×600. Стоимость каждой полной
 * перерисовки пропорциональна площади, поэтому держим ~6 Мпкс и ×2 — этого
 * хватает для зума 150–200 % на Retina. Экспорт PNG задаёт cellSize отдельно.
 */
const PIXEL_BUDGET = 6_000_000;
const MAX_PIXEL_RATIO = 2;

/** Настройки рендера в повышенной плотности (cellSize умножается на ratio). */
export const highResSettings = (map: MapData, rs: RenderSettings, ratio = renderPixelRatio(map, rs)): RenderSettings =>
  ratio === 1 ? rs : { ...rs, cellSize: rs.cellSize * ratio };

/** Стены как в примере Sol Max: плоская топографическая проекция. Сетка и масштаб остаются точными, без приподнятой перспективы. */

/**
 * Гладкое полотно дорог и троп поверх клеточного террейна.
 * Терраин остаётся клеточным под капотом, но игрок видит ленту с
 * округлыми стыками — без «лестницы» по краям поворотов.
 * Рисуем три прохода: тень-обочина, обочина, само полотно с текстурой земли.
 */

/**
 * Гладкая лента реки по осевой линии: берега остаются клеточными, а вода
 * получает скруглённые изгибы вместо «лестницы».
 */

/**
 * Дощатые настилы на пересечении дороги с водой: деревянный пол поверх
 * клеток bridge + поперечные доски. Мост читается как мост, а не как
 * коричневая клетка.
 */
/**
 * Настилы мостов.
 *
 * Если план содержит спроектированные мосты (`plan.bridges`), рисуем настил
 * прямоугольником, повёрнутым по оси дороги — мост выглядит как инженерное
 * сооружение, а не как пятно поверх клеток. Для старых проектов остаётся
 * прежний режим по клеткам `bridge`.
 */
/** Обводит кругами все клетки, подходящие под match, в один путь (скруглённое русло/дорога). */
function traceCellBlobs(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  cs: number,
  match: (terrain: Terrain, x: number, y: number) => boolean,
  radius: number,
  fresh = true,
) {
  if (fresh) ctx.beginPath();
  for (let y = 0; y < map.height; y += 1) {
    const row = map.cells[y];
    for (let x = 0; x < map.width; x += 1) {
      if (!match(row[x].terrain, x, y)) continue;
      const cx = (x + 0.5) * cs;
      const cy = (y + 0.5) * cs;
      ctx.roundRect(cx - radius, cy - radius, radius * 2, radius * 2, radius * 0.45);
    }
  }
}

function drawBridgeDecks(ctx: CanvasRenderingContext2D, map: MapData, cs: number) {
  const timber = getAssets().art["timber"];
  const deckFill = (): string | CanvasPattern => {
    if (!timber) return "#7a5a3c";
    const pattern = ctx.createPattern(timber, "repeat");
    if (!pattern) return "#7a5a3c";
    pattern.setTransform(new DOMMatrix([cs / 150, 0, 0, cs / 150, 0, 0]));
    return pattern;
  };

  const bridges = map.plan?.bridges ?? [];
  if (bridges.length) {
    ctx.save();
    for (const bridge of bridges) {
      // Настил шире полотна и длиннее пробега: он накрывает клеточные обрезки
      // и читается как одна цельная доска от берега до берега.
      const width = (Math.max(1, bridge.width) + 0.4) * cs;
      const length = bridge.length * cs;
      ctx.save();
      ctx.translate(bridge.x * cs, bridge.y * cs);
      const road = (map.plan?.roads ?? []).find((item) => item.id === bridge.pathId);
      let angle = bridge.angle;
      if (road && road.points.length > 1) {
        let nearest = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        road.points.forEach((point, index) => {
          const dx = (point.x + 0.5) * cs - bridge.x * cs;
          const dy = (point.y + 0.5) * cs - bridge.y * cs;
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
        });
        const before = road.points[Math.max(0, nearest - 2)];
        const after = road.points[Math.min(road.points.length - 1, nearest + 2)];
        if (before !== after) angle = Math.atan2(after.y - before.y, after.x - before.x);
      }
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(30, 22, 14, 0.35)";
      ctx.beginPath();
      ctx.roundRect(-length / 2 - 2, -width / 2 - 2, length + 4, width + 4, 3);
      ctx.fill();
      ctx.fillStyle = deckFill();
      ctx.beginPath();
      ctx.roundRect(-length / 2, -width / 2, length, width, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(48, 32, 20, 0.45)";
      ctx.lineWidth = Math.max(1, cs * 0.05);
      const plank = Math.max(4, cs * 0.28);
      for (let px = -length / 2 + plank; px < length / 2; px += plank) {
        ctx.beginPath();
        ctx.moveTo(px, -width / 2);
        ctx.lineTo(px, width / 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(44, 30, 18, 0.55)";
      ctx.lineWidth = Math.max(1, cs * 0.06);
      ctx.beginPath();
      ctx.roundRect(-length / 2, -width / 2, length, width, 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(60, 44, 30, 0.85)";
      ctx.lineWidth = Math.max(1, cs * 0.07);
      ctx.beginPath();
      ctx.moveTo(-length / 2, -width / 2);
      ctx.lineTo(length / 2, -width / 2);
      ctx.moveTo(-length / 2, width / 2);
      ctx.lineTo(length / 2, width / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  // Legacy: проект без плана мостов — рисуем по клеткам bridge.
  const roads = map.plan?.roads ?? [];
  if (!roads.length) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  for (const road of roads) {
    if (!road.bridges) continue;
    const bridgeCells = road.points.filter((point) => map.cells[point.y]?.[point.x]?.terrain === "bridge");
    if (!bridgeCells.length) continue;
    const deck = chaikin(bridgeCells.length >= 2 ? bridgeCells : [...bridgeCells, bridgeCells[0]], 1);
    const width = Math.max(1, road.width) * cs;
    const trace = () => {
      ctx.beginPath();
      deck.forEach((point, index) => {
        const px = (point.x + 0.5) * cs;
        const py = (point.y + 0.5) * cs;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
    };
    trace();
    ctx.strokeStyle = "rgba(30, 22, 14, 0.35)";
    ctx.lineWidth = width + Math.max(2, cs * 0.22);
    ctx.stroke();
    trace();
    ctx.strokeStyle = deckFill();
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = "rgba(48, 32, 20, 0.45)";
    ctx.lineWidth = Math.max(1, cs * 0.05);
    for (let index = 0; index < deck.length - 1; index += 1) {
      const a = deck[index];
      const mx = (a.x + 0.5) * cs;
      const my = (a.y + 0.5) * cs;
      ctx.beginPath();
      ctx.moveTo(mx, my - width / 2);
      ctx.lineTo(mx, my + width / 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRiverRibbon(ctx: CanvasRenderingContext2D, map: MapData, cs: number) {
  const isWater = (terrain: Terrain): boolean => terrain === "water" || terrain === "deepWater";
  const W = Math.max(1, Math.round(map.width * cs));
  const H = Math.max(1, Math.round(map.height * cs));
  const make = (): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    return canvas;
  };

  // Клеточная маска воды. Контур получаем размытием + накоплением альфы:
  // силуэт выходит органично плавным, но тело воды остаётся плотным (без «тумана»).
  const mask = make();
  const maskCtx = mask.getContext("2d");
  if (!maskCtx) return;
  maskCtx.fillStyle = "#ffffff";
  let hasWater = false;
  const cell = Math.ceil(cs);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!isWater(map.cells[y][x].terrain)) continue;
      hasWater = true;
      maskCtx.fillRect(Math.floor(x * cs), Math.floor(y * cs), cell, cell);
    }
  }
  if (!hasWater) return;

  const assets = getAssets();
  const pattern = (
    target: CanvasRenderingContext2D,
    image: CanvasImageSource | undefined,
    tile: number,
    fallback: string,
  ): string | CanvasPattern => {
    if (!image) return fallback;
    const created = target.createPattern(image, "repeat");
    if (!created) return fallback;
    created.setTransform(new DOMMatrix([cs / tile, 0, 0, cs / tile, 0, 0]));
    return created;
  };

  const blurOf = (radius: number): HTMLCanvasElement | null => {
    const canvas = make();
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.filter = `blur(${Math.max(0.6, radius).toFixed(2)}px)`;
    context.drawImage(mask, 0, 0);
    context.filter = "none";
    return canvas;
  };

  // Плотная маска воды: три слоя размытой маски, сложенные аддитивно,
  // дают насыщенную середину и узкий мягкий край.
  const grain = blurOf(cs * 0.42);
  if (!grain) return;
  const body = make();
  const bodyCtx = body.getContext("2d");
  if (!bodyCtx) return;
  bodyCtx.globalCompositeOperation = "lighter";
  bodyCtx.drawImage(grain, 0, 0);
  bodyCtx.drawImage(grain, 0, 0);
  bodyCtx.drawImage(grain, 0, 0);
  bodyCtx.globalCompositeOperation = "source-over";

  const water = make();
  const waterCtx = water.getContext("2d");
  if (!waterCtx) return;
  waterCtx.fillStyle = pattern(waterCtx, assets.art["water"], 260, "#5b86ab");
  waterCtx.fillRect(0, 0, W, H);
  waterCtx.globalCompositeOperation = "destination-in";
  waterCtx.drawImage(body, 0, 0);

  // Береговая полоса: расширенный силуэт минус сами клетки воды (только снаружи).
  const ring = make();
  const ringCtx = ring.getContext("2d");
  if (!ringCtx) return;
  ringCtx.filter = `blur(${Math.max(2, cs * 0.95).toFixed(2)}px)`;
  ringCtx.drawImage(mask, 0, 0);
  ringCtx.filter = "none";
  ringCtx.globalCompositeOperation = "destination-out";
  ringCtx.drawImage(mask, 0, 0);
  ringCtx.globalCompositeOperation = "source-in";
  ringCtx.fillStyle = pattern(ringCtx, assets.art["bank"], 190, "#c6b480");
  ringCtx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(ring, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(water, 0, 0);
  ctx.restore();
}

const ROAD_PATTERN_TILE: Record<RoadMaterialId, number> = {
  road_packed_dirt: 135,
  road_gravel: 142,
  road_old_cobblestone: 164,
  road_worn_cobblestone: 156,
  road_noble_paving: 158,
  road_damaged_stone: 156,
};

const ROAD_PATTERN_FALLBACK: Record<RoadMaterialId, string> = {
  road_packed_dirt: "#94714c",
  road_gravel: "#987e5e",
  road_old_cobblestone: "#8a8579",
  road_worn_cobblestone: "#848076",
  road_noble_paving: "#b8ad98",
  road_damaged_stone: "#847b6c",
};

function splitRoadPoints(
  map: MapData,
  points: { x: number; y: number }[],
  allowBridges: boolean,
  isPlazaLane: boolean,
): { x: number; y: number }[][] {
  const spans: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const pt of points) {
    const tr = map.cells[pt.y]?.[pt.x]?.terrain;
    const isWater = tr === "water" || tr === "deepWater";
    const skipWater = isWater && !allowBridges;
    // Сохраняем собственное покрытие рыночных и гражданских площадей (§2.6):
    // дорожная лента плавно доходит до кромки площади, но не закрашивает саму площадь.
    const skipPlaza = !isPlazaLane && tr === "plaza";
    if (skipWater || skipPlaza) {
      if (cur.length > 0) {
        // Добавляем граничную точку для бесшовного стыка у кромки площади/берега:
        if (skipPlaza) cur.push(pt);
        if (cur.length >= 2) spans.push(cur);
        cur = skipPlaza ? [pt] : [];
      }
      continue;
    }
    cur.push(pt);
  }
  if (cur.length >= 2) spans.push(cur);
  return spans;
}

function drawRoadRibbons(ctx: CanvasRenderingContext2D, map: MapData, cs: number, rs: RenderSettings) {
  const roads = map.plan?.roads ?? [];
  if (!roads.length) return;
  const assets = getAssets();
  const textured = rs.texture;
  const style = (image: CanvasImageSource | undefined, tile: number, fallback: string): string | CanvasPattern => {
    if (!textured || !image) return fallback;
    const pattern = ctx.createPattern(image, "repeat");
    if (!pattern) return fallback;
    // Единое мировое начало координат (0, 0): бесшовное повторение без сброса по клеткам или сегментам.
    pattern.setTransform(new DOMMatrix([cs / tile, 0, 0, cs / tile, 0, 0]));
    return pattern;
  };

  const roadStyles = Object.fromEntries(
    ROAD_MATERIAL_IDS.map((id) => [
      id,
      style(assets.art[id], ROAD_PATTERN_TILE[id], ROAD_PATTERN_FALLBACK[id]),
    ]),
  ) as Record<RoadMaterialId, string | CanvasPattern>;
  const earthStyle = roadStyles.road_packed_dirt;
  const plazaStyle = style(assets.art["flagstone"] ?? assets.art["cobbles"], 165, "#afa695");

  const isRoad = (terrain: Terrain): boolean => terrain === "road" || terrain === "bridge";
  const nearRoad = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const terrain = map.cells[y + dy]?.[x + dx]?.terrain;
        if (terrain === "road" || terrain === "bridge") return true;
      }
    }
    return false;
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Мягкое пятно по клеткам дороги и обочины: органично сглаживает переход в траву/землю.
  const centerMat = selectCellRoadMaterial(map, Math.floor(map.width / 2), Math.floor(map.height / 2), rs.roadMaterial);
  const baseShoulderStyle = centerMat === "road_packed_dirt" ? earthStyle : roadStyles.road_gravel;
  traceCellBlobs(ctx, map, cs, (terrain, x, y) => isRoad(terrain) || (terrain === "dirt" && nearRoad(x, y)), cs * 0.7);
  ctx.filter = "blur(" + Math.max(1, cs * 0.3).toFixed(1) + "px)";
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = baseShoulderStyle;
  ctx.fill();
  ctx.filter = "none";
  ctx.globalAlpha = 1;

  for (const road of roads) {
    const isPlazaLane = road.surface === "plaza";
    const { surface, shoulder, paved } = resolveLaneRoadMaterial(map, road, rs.roadMaterial);
    const bodyStyle = isPlazaLane ? plazaStyle : roadStyles[surface];
    const shoulderStyle = roadStyles[shoulder];
    const base = Math.max(1, road.width) * cs;
    const hLvl = road.hierarchy;

    const spans = splitRoadPoints(map, road.points, Boolean(road.bridges), isPlazaLane);
    for (const rawSpan of spans) {
      const points = chaikin(rawSpan, 3);
      if (points.length < 2) continue;
      const trace = () => {
        ctx.beginPath();
        points.forEach((point, index) => {
          const px = (point.x + 0.5) * cs;
          const py = (point.y + 0.5) * cs;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
      };
      const stroke = (lineWidth: number, strokeStyle: string | CanvasPattern, alpha: number, blur: number) => {
        trace();
        ctx.filter = blur > 0 ? "blur(" + blur.toFixed(1) + "px)" : "none";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
        ctx.filter = "none";
        ctx.globalAlpha = 1;
      };

      if (hLvl !== undefined) {
        if (hLvl === 1) {
          // Уровень 1 (магистраль): мягкая обочина, деликатная кромка и чёткая бесшовная текстура.
          stroke(base + cs * 0.98, earthStyle, 0.2, cs * 0.42);
          stroke(base + cs * 0.38, shoulderStyle, 0.44, cs * 0.13);
          if (paved) stroke(base + cs * 0.14, "rgba(44, 38, 30, 0.42)", 0.48, cs * 0.02);
          stroke(base + cs * 0.04, bodyStyle, 0.96, paved ? 0 : cs * 0.02);
        } else if (hLvl === 2) {
          // Уровень 2 (районная улица): мягкий переход в прилегающий квартал и чёткая кладка.
          stroke(base + cs * 0.84, earthStyle, 0.18, cs * 0.38);
          stroke(base + cs * 0.3, shoulderStyle, 0.42, cs * 0.12);
          if (paved) stroke(base + cs * 0.1, "rgba(44, 38, 30, 0.3)", 0.38, cs * 0.02);
          stroke(base, bodyStyle, 0.93, paved ? 0 : cs * 0.03);
        } else if (hLvl === 3) {
          // Уровень 3 (местная жилая улочка): чуть уже и мягче по краям.
          const w3 = base * 0.82;
          stroke(w3 + cs * 0.56, earthStyle, 0.22, cs * 0.26);
          stroke(w3 + cs * 0.18, shoulderStyle, 0.46, cs * 0.08);
          stroke(w3 - cs * 0.06, bodyStyle, 0.88, paved ? 0 : cs * 0.03);
        } else {
          // Уровень 4–5 (переулок / дворовый проход): узкая тропа с контекстным покрытием.
          const w4 = Math.max(cs * 0.46, base * 0.58);
          stroke(w4 + cs * 0.3, earthStyle, 0.32, cs * 0.14);
          stroke(w4, bodyStyle, 0.82, paved ? 0 : cs * 0.03);
        }
      } else {
        // Сельские дороги и классические поселения: плавная многослойная обочина + бесшовное полотно.
        stroke(base + cs * 1.12, earthStyle, 0.18, cs * 0.45);
        stroke(base + cs * 0.54, shoulderStyle, 0.38, cs * 0.18);
        stroke(base + cs * 0.24, shoulderStyle, 0.52, cs * 0.07);
        if (paved) stroke(base + cs * 0.08, "rgba(44, 38, 30, 0.3)", 0.36, cs * 0.02);
        stroke(base - cs * 0.04, bodyStyle, 0.94, paved ? 0 : cs * 0.02);
      }
    }
  }
  ctx.restore();
}
// Растровый слой террейна перерисовывается только когда меняются клетки или
// настройки отрисовки. При перетаскивании объектов террейн остаётся прежним,
// поэтому берём готовый канвас из кэша — иначе каждый кадр считался бы заново.
let terrainLayerCache: { key: string; canvas: HTMLCanvasElement } | null = null;

export function terrainLayerKey(map: MapData, rs: RenderSettings, seed: number, W: number, H: number): string {
  let hash = 2166136261 >>> 0;
  const cells = map.cells;
  const elevationView = new DataView(new ArrayBuffer(8));
  for (let y = 0; y < cells.length; y += 1) {
    const row = cells[y];
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x];
      const terrain = cell.terrain;
      // The complete terrain identifier is needed: e.g. sand and snow have
      // the same first letter and length but very different textures.
      for (let i = 0; i < terrain.length; i++) {
        hash = Math.imul(hash ^ terrain.charCodeAt(i), 16777619) >>> 0;
      }
      hash = Math.imul(hash ^ terrain.length, 16777619) >>> 0;
      // Shading depends on full elevation precision, not 8-bit rounding.
      elevationView.setFloat64(0, cell.height ?? 0.5);
      hash = Math.imul(hash ^ elevationView.getUint32(0), 16777619) >>> 0;
      hash = Math.imul(hash ^ elevationView.getUint32(4), 16777619) >>> 0;
    }
  }
  return [
    W,
    H,
    map.width,
    map.height,
    rs.cellSize,
    seed,
    map.biome,
    map.dungeonWallsOnly ? 1 : 0,
    rs.texture ? 1 : 0,
    rs.shading ? 1 : 0,
    rs.showStructures ? 1 : 0,
    getAssets().ready ? 1 : 0,
    rs.roadMaterial ?? 'auto',
    map.plan?.settlement?.type ?? '',
    map.plan?.settlement?.character ?? '',
    // Road material can depend on district geometry, ruin state and condition.
    JSON.stringify(map.plan?.settlement?.districts ?? []),
    JSON.stringify(map.plan?.settlement?.materialProfile ?? null),
    map.plan?.settlement?.fortification === undefined ? 0 : 1,
    JSON.stringify((map.structures ?? []).map(({ x, y, w, h, ruin }) => [x, y, w, h, ruin])),
    map.buildings?.[0]?.cityCondition ?? '',
    hash >>> 0,
  ].join('|');
}

function terrainLayer(map: MapData, rs: RenderSettings, seed: number, key: string): HTMLCanvasElement {
  if (terrainLayerCache && terrainLayerCache.key === key) return terrainLayerCache.canvas;
  const terrain = paintTerrain(map, rs, seed);
  const layer = document.createElement('canvas');
  layer.width = terrain.width;
  layer.height = terrain.height;
  const layerCtx = layer.getContext('2d');
  if (layerCtx) layerCtx.putImageData(terrain, 0, 0);
  terrainLayerCache = { key, canvas: layer };
  return layer;
}


/**
 * Карта без одного объекта — статичный слой для перетаскивания. Полная
 * отрисовка делается один раз при захвате, дальше двигается только объект.
 */
export function excludeObject(map: MapData, target: ObjectTarget): MapData {
  switch (target.type) {
    case 'tree':
      return { ...map, trees: map.trees.filter((_, index) => index !== target.index) };
    case 'rock':
      return { ...map, rocks: map.rocks.filter((_, index) => index !== target.index) };
    case 'chest':
      return { ...map, chests: map.chests.filter((_, index) => index !== target.index) };
    case 'crypt':
      return { ...map, crypt: (map.crypt ?? []).filter((_, index) => index !== target.index) };
    case 'civic':
      return { ...map, civic: (map.civic ?? []).filter((_, index) => index !== target.index) };
    case 'building':
      return { ...map, buildings: (map.buildings ?? []).filter((_, index) => index !== target.index) };
    case 'furniture': {
      const house = map.buildings?.[target.building];
      if (!house) return map;
      const items = interiorOf(house).furnishings.filter((_, index) => index !== target.index);
      return { ...map, buildings: map.buildings!.map((b, index) => index === target.building ? { ...b, source: 'manual' as const, furniture: items } : b) };
    }
    default:
      return map;
  }
}

/**
 * Рисует ОДИН объект поверх заранее отрисованного статичного слоя.
 * Используется при перетаскивании: та же геометрия и тени, что в renderMap.
 */
/**
 * Прямоугольник «призрака» объекта на холсте (в пикселях канвы) с запасом
 * под мягкую тень. Нужен, чтобы при перетаскивании восстанавливать из
 * статичного слоя только небольшой участок, а не всю карту.
 */
export function objectGhostBounds(
  map: MapData,
  rs: RenderSettings,
  target: ObjectTarget,
): { x: number; y: number; w: number; h: number } {
  const cs = rs.cellSize;
  let x = 0;
  let y = 0;
  let w = cs * 2;
  let h = cs * 2;
  if (target.type === 'tree') {
    const tree = map.trees[target.index];
    if (tree) {
      const dims = treeDimensions(tree);
      x = tree.x * cs;
      y = tree.y * cs;
      w = (tree.size?.w ?? dims.w) * cs;
      h = (tree.size?.h ?? dims.h) * cs;
    }
  } else if (target.type === 'rock') {
    const rock = map.rocks[target.index];
    if (rock) {
      const dims = rockDimensions(rock);
      x = rock.x * cs;
      y = rock.y * cs;
      w = (rock.size?.w ?? dims.w) * cs;
      h = (rock.size?.h ?? dims.h) * cs;
    }
  } else if (target.type === 'chest') {
    const chest = map.chests[target.index];
    if (chest) {
      const dims = chestDimensions(chest);
      x = chest.x * cs;
      y = chest.y * cs;
      w = dims.w * cs;
      h = dims.h * cs;
    }
  } else if (target.type === 'crypt') {
    // Рамка по реальному размеру предмета (раньше было фиксированные 3×3 клетки,
    // и длинные предметы вроде ряда саркофагов обрезались при перетаскивании).
    const item = map.crypt?.[target.index];
    if (item) {
      const side = Math.max(item.w, item.h) * cs;
      const cx = (item.x + item.w / 2) * cs, cy = (item.y + item.h / 2) * cs;
      x = cx - side / 2 - cs * 0.3;
      y = cy - side / 2 - cs * 0.3;
      w = side + cs * 0.6;
      h = side + cs * 0.6;
    }
  } else if (target.type === 'civic') {
    const item = map.civic?.[target.index];
    if (item) {
      const side = Math.max(item.w, item.h) * cs;
      const cx = (item.x + item.w / 2) * cs, cy = (item.y + item.h / 2) * cs;
      x = cx - side / 2; y = cy - side / 2; w = side; h = side;
    }
  } else if (target.type === 'building') {
    const item = map.buildings?.[target.index];
    if (item) {
      x = item.x * cs; y = item.y * cs; w = item.w * cs; h = item.h * cs;
    }
  } else if (target.type === 'furniture') {
    const house = map.buildings?.[target.building];
    const item = house && interiorOf(house).furnishings[target.index];
    if (house && item) {
      const box = furnitureBounds(item);
      const side = Math.max(box.w, box.h) * cs;
      const cx = (house.x + item.x) * cs, cy = (house.y + item.y) * cs;
      x = cx - side / 2; y = cy - side / 2; w = side; h = side;
    }
  }
  const pad = cs * 1.1;
  return { x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 };
}

export function drawObjectGhost(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  rs: RenderSettings,
  seed: number,
  target: ObjectTarget,
  dx: number,
  dy: number,
) {
  const cs = rs.cellSize;
  ctx.save();
  ctx.translate(dx, dy);
  if (target.type === 'tree') {
    const tree = map.trees[target.index];
    if (tree) {
      if (rs.shading && tree.kind !== 'mushroom' && tree.kind !== 'reed') {
        const dims = treeDimensions(tree);
        const radius = tree.r * cs;
        groundShadow(ctx, tree.x * cs + radius * 0.6, tree.y * cs + radius * 0.66, dims.w * cs * 0.53, dims.h * cs * 0.48, 0.56);
      }
      drawTree(ctx, tree, cs, map.biome);
    }
  } else if (target.type === 'rock') {
    const rock = map.rocks[target.index];
    if (rock) {
      if (rs.shading) {
        const dims = rockDimensions(rock);
        groundShadow(ctx, (rock.x + rock.r * 0.24) * cs, (rock.y + rock.r * 0.33) * cs, dims.w * cs * 0.6, dims.h * cs * 0.53, 0.53);
      }
      drawRock(ctx, rock, cs);
    }
  } else if (target.type === 'chest') {
    const chest = map.chests[target.index];
    if (chest) drawChest(ctx, chest, cs, rs.shading);
  } else if (target.type === 'crypt') {
    const item = map.crypt?.[target.index];
    // Только сам предмет: подложка depth() закрашивала клетки пола внутри рамки
    // призрака и «ездила» вместе с объектом тёмным квадратом.
    if (item) cryptPainter(ctx, map, rs, seed).prop(item);
  } else if (target.type === 'civic') {
    const item = map.civic?.[target.index];
    if (item) settlementPainter(ctx, rs, seed, map.furnitureSprites).civic(item);
  } else if (target.type === 'building') {
    const item = map.buildings?.[target.index];
    if (item) settlementPainter(ctx, rs, seed, map.furnitureSprites).building(item);
  } else if (target.type === 'furniture') {
    const house = map.buildings?.[target.building];
    const item = house && interiorOf(house).furnishings[target.index];
    if (house && item) {
      ctx.save();
      ctx.translate(house.x * cs, house.y * cs);
      ctx.scale(cs, cs);
      drawFurnishing(ctx, item, rs.shading, map.furnitureSprites);
      ctx.restore();
    }
  }
  ctx.restore();
}

interface StaticLayer { key: string; plan: unknown; rooms: unknown; floor?: unknown; canvas: HTMLCanvasElement }
let groundCache: StaticLayer | null = null;
let structureCache: StaticLayer | null = null;

/** Clear only raster caches; rendering after this produces a fresh reference. */
export function clearRenderCaches(): void {
  terrainLayerCache = null;
  groundCache = null;
  structureCache = null;
}

function layerCanvas(W: number, H: number) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  return { canvas, ctx };
}

/** Крупнее этого слои не кэшируем (экспорт PNG в 2× и т. п.): рисуем прямо в целевой контекст. */
const CACHE_LIMIT = 14_000_000;

function paintGround(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings, seed: number, W: number, H: number, cellKey: string) {
  const cs = rs.cellSize;
  ctx.drawImage(terrainLayer(map, rs, seed, cellKey), 0, 0, W, H);
  // Покрытие пола архитектурного комплекса: материалы, бордюры, орнаменты.
  if (map.floorLayer) paintFloorLayer(ctx, map, cs, seed);
  if (map.plan?.river?.length) drawRiverRibbon(ctx, map, cs);
  if (map.plan?.roads?.length) drawRoadRibbons(ctx, map, cs, rs);
  if (map.plan?.roads?.length) drawBridgeDecks(ctx, map, cs);
  cryptPainter(ctx, map, rs, seed).depth();
}

/** Террейн + реки/дороги/мосты + подложка склепа. Перерисовывается только при изменении клеток или плана. */
function drawGround(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings, seed: number, W: number, H: number, cellKey: string) {
  if (W * H > CACHE_LIMIT) { paintGround(ctx, map, rs, seed, W, H, cellKey); return; }
  if (!groundCache || groundCache.key !== cellKey || groundCache.plan !== map.plan || groundCache.rooms !== map.cryptRooms || groundCache.floor !== map.floorLayer) {
    const layer = layerCanvas(W, H);
    if (!layer.ctx) { paintGround(ctx, map, rs, seed, W, H, cellKey); return; }
    paintGround(layer.ctx, map, rs, seed, W, H, cellKey);
    groundCache = { key: cellKey, plan: map.plan, rooms: map.cryptRooms, floor: map.floorLayer, canvas: layer.canvas };
  }
  ctx.drawImage(groundCache.canvas, 0, 0);
}

/** Стены, двери, клеточные мосты — прозрачный слой поверх земли. */
function paintStructures(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings, seed: number) {
  const cs = rs.cellSize;
  // Укрепления поселения по типу рисуются лентой вдоль кольца, а не клетками.
  const fortified = fortificationOf(map) !== undefined;
  const spriteWalls = fortified || drawWalls(ctx, map, cs, seed, rs.shading, rs.wallThickness);
  if (fortified && rs.showStructures) drawFortification(ctx, map, cs, seed, rs);
  if (!spriteWalls && rs.shading) {
    eachStructure(map, (terrainKind, x, y) => {
      if (terrainKind !== "wall") return;
      ctx.save();
      ctx.translate((x + 0.08) * cs, (y + 0.16) * cs);
      ctx.scale(cs, cs);
      const parts = wallParts(map, x, y);
      ctx.fillStyle = "rgba(28,23,17,.39)";
      ctx.beginPath();
      for (const [px, py, w, h] of parts) ctx.rect(px, py, w + 0.03, h + 0.035);
      ctx.fill();
      ctx.restore();
    });
  }
  const plannedDecks = (map.plan?.bridges?.length ?? 0) > 0;
  eachStructure(map, (terrainKind, x, y) => {
    if (terrainKind === "wall") {
      if (!spriteWalls) drawWall(ctx, map, x, y, cs, seed);
      return;
    }
    if (terrainKind === "bridge" && !plannedDecks) drawWoodwork(ctx, map, "bridge", x, y, cs, seed, rs.texture);
    if (terrainKind === "door") {
      ctx.save();
      ctx.translate((x + 0.5) * cs, (y + 0.5) * cs);
      ctx.scale(cs, cs);
      if (doorAxis(map, x, y) === "vertical") ctx.rotate(Math.PI / 2);
      const style = doorStyle(map.biome, x, y, seed);
      const opened = map.biome === "dungeon" && hash2(x, y, seed + 19) > 0.62;
      if (map.doors) drawDoorKind(ctx, doorKindAt(map, x, y), style, opened, rs.showSecrets);
      else drawDoor(ctx, style, 0.96, opened);
      ctx.restore();
    }
  });
}

function drawStructures(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings, seed: number, W: number, H: number, cellKey: string) {
  if (W * H > CACHE_LIMIT) { paintStructures(ctx, map, rs, seed); return; }
  // Виды дверей и видимость потайных меняют слой построек.
  const doorKey = map.doors ? `|${rs.showSecrets ? 1 : 0}|${map.doors.map((door) => `${door.x},${door.y},${door.kind}`).join(";")}` : "";
  const key = `${cellKey}|${rs.wallThickness}|${rs.castleWallMaterial ?? 'auto'}|${rs.texture ? 1 : 0}|${rs.shading ? 1 : 0}${doorKey}`;
  if (!structureCache || structureCache.key !== key || structureCache.plan !== map.plan) {
    const layer = layerCanvas(W, H);
    if (!layer.ctx) { paintStructures(ctx, map, rs, seed); return; }
    paintStructures(layer.ctx, map, rs, seed);
    structureCache = { key, plan: map.plan, rooms: null, canvas: layer.canvas };
  }
  ctx.drawImage(structureCache.canvas, 0, 0);
}


export function renderMap(canvas: HTMLCanvasElement, map: MapData, rs: RenderSettings, seed: number) {
  const cs = rs.cellSize;
  const W = map.width * cs;
  const H = map.height * cs;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // A render must not leak paint state into the next frame on the same canvas.
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Хэш клеток считаем один раз: он ключ для всех статичных слоёв ниже.
  const cellKey = terrainLayerKey(map, rs, seed, W, H);

  // «Земля»: террейн, ленты рек и дорог (с blur-фильтрами), настилы мостов и
  // подложка склепа. Всё это зависит только от клеток и плана, поэтому живёт в
  // кэше и при перемещении объектов просто копируется одним drawImage.
  drawGround(ctx, map, rs, seed, W, H, cellKey);

  const crypt = cryptPainter(ctx, map, rs, seed);
  if (rs.showCrypt) {
    crypt.floorProps();
    crypt.lights();
  }

  // Стены, двери и клеточные мосты — тоже статичный слой: обводка с shadowBlur
  // стоила ~0,5 с на каждую перерисовку.
  if (rs.showStructures) drawStructures(ctx, map, rs, seed, W, H, cellKey);

  const city = settlementPainter(ctx, rs, seed, map.furnitureSprites);
  const civicDiag = {
    reachedRender: map.civic?.length ?? 0,
    renderedSprite: 0,
    renderedProcedural: 0,
    skippedMissingAsset: 0,
    skippedByLayerToggle: !rs.showCivic,
  };
  if (rs.showCivic) {
    for (const item of map.civic ?? []) {
      if (item.kind === "square") {
        city.civic(item);
        civicDiag.renderedProcedural++;
      }
    }
  }
  if (rs.showStructures) for (const building of map.buildings ?? []) city.building(building);

  paintDecor(ctx, map, rs);

  const objects: { y: number; paint: () => void }[] = [];
  if (rs.showCrypt) for (const item of crypt.upright) objects.push({ y: item.y * cs + item.h * cs, paint: () => crypt.prop(item) });
  if (rs.showRocks) for (const rock of map.rocks) objects.push({ y: rock.y * cs, paint: () => drawRock(ctx, rock, cs) });
  if (rs.showTrees) for (const tree of map.trees) objects.push({ y: (tree.y + tree.r) * cs, paint: () => drawTree(ctx, tree, cs, map.biome) });

  if (rs.shading) {
    if (rs.showTrees) for (const tree of map.trees) {
      if (tree.kind === "mushroom" || tree.kind === "reed") continue;
      const dims = treeDimensions(tree);
      const radius = tree.r * cs;
      groundShadow(ctx, tree.x * cs + radius * 0.6, tree.y * cs + radius * 0.66, dims.w * cs * 0.53, dims.h * cs * 0.48, 0.56);
    }
    if (rs.showRocks) for (const rock of map.rocks) {
      const dims = rockDimensions(rock);
      groundShadow(ctx, (rock.x + rock.r * 0.24) * cs, (rock.y + rock.r * 0.33) * cs, dims.w * cs * 0.6, dims.h * cs * 0.53, 0.53);
    }
  }

  if (rs.showCivic) {
    for (const item of map.civic ?? []) {
      if (item.kind !== "square") {
        objects.push({
          y: (item.y + item.h) * cs,
          paint: () => {
            const out = city.civic(item);
            if (out === 'sprite') civicDiag.renderedSprite++;
            else if (out === 'procedural') civicDiag.renderedProcedural++;
            else civicDiag.skippedMissingAsset++;
          },
        });
      }
    }
    // На классических картах деревень и городов (без settlementType) добавляем при отрисовке
    // ненавязчивые дворовые и уличные детали вокруг домов, не меняя данные карты (golden seeds неизменны):
    if (!map.plan?.settlement && rs.showDecor !== false && (map.biome === 'village' || map.biome === 'town')) {
      const villagePool = [
        'yardWaterPail', 'yardChoppingBlock', 'yardBeehive', 'yardWashTub',
        'yardFlowerPots', 'urbanHandPump', 'yardBroomRake', 'urbanHitchingPost',
      ] as const;
      const townPool = [
        'lampStreetIron', 'yardWaterPail', 'greenStonePlanterRound', 'greenFlowerUrn',
        'urbanHandPump', 'urbanHitchingPost', 'yardFlowerPots', 'urbanStonePlanter',
      ] as const;
      const pool = map.biome === 'town' ? townPool : villagePool;
      const occupied = new Set<number>();
      for (const b of map.buildings ?? []) {
        for (let yy = b.y; yy < b.y + b.h; yy++) {
          for (let xx = b.x; xx < b.x + b.w; xx++) occupied.add(yy * map.width + xx);
        }
        occupied.add(b.door.y * map.width + b.door.x);
      }
      for (const c of map.civic ?? []) {
        for (let yy = Math.floor(c.y); yy < Math.ceil(c.y + c.h); yy++) {
          for (let xx = Math.floor(c.x); xx < Math.ceil(c.x + c.w); xx++) occupied.add(yy * map.width + xx);
        }
      }
      for (const b of map.buildings ?? []) {
        const hRoll = hash2(b.x, b.y, seed + 51803);
        if (hRoll > 0.68) continue;
        const candidates: [number, number][] = [
          [b.x - 1, b.y + Math.floor(b.h / 2)],
          [b.x + b.w, b.y + Math.floor(b.h / 2)],
          [b.x + Math.floor(b.w / 2), b.y - 1],
        ];
        for (const [cx, cy] of candidates) {
          if (cx < 1 || cy < 1 || cx >= map.width - 1 || cy >= map.height - 1) continue;
          const idx = cy * map.width + cx;
          if (occupied.has(idx)) continue;
          const tr = map.cells[cy][cx].terrain;
          if (tr !== 'grass' && tr !== 'dirt' && tr !== 'sand' && tr !== 'plaza') continue;
          if (Math.abs(cx - b.door.x) <= 1 && Math.abs(cy - b.door.y) <= 1) continue;
          occupied.add(idx);
          const pick = pool[Math.floor(hash2(cx, cy, seed + 7717) * pool.length)];
          objects.push({
            y: (cy + 1) * cs,
            paint: () => {
              city.civic({
                x: cx,
                y: cy,
                w: 1,
                h: 1,
                kind: pick,
                rotation: 0,
                variant: (cx + cy) % 4,
                source: 'layout',
              });
            },
          });
          break;
        }
      }
    }
  }
  objects.sort((a, b) => a.y - b.y).forEach((item) => item.paint());
  setCivicRenderDiagnostics(map, civicDiag);

  if (rs.showChests) for (const chest of map.chests) drawChest(ctx, chest, cs, rs.shading);

  if (rs.timeOfDay === 'dusk' || rs.timeOfDay === 'night') {
    drawUrbanLightingPass(ctx, map, rs.timeOfDay, cs, W, H);
  }

  if (rs.vignette) {
    const edge = ctx.createRadialGradient(W * 0.43, H * 0.42, Math.min(W, H) * 0.34, W * 0.49, H * 0.48, Math.hypot(W, H) * 0.54);
    edge.addColorStop(0, "rgba(35,32,21,0)");
    edge.addColorStop(1, "rgba(29,26,20,.33)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }

  if (rs.showDebug) drawDebugOverlay(ctx, map, rs);
  if (rs.showDungeonDressingDebug && map.biome === 'dungeon') drawDungeonDressingDebug(ctx, map, cs);

  if (rs.showGrid) {
    ctx.save();
    const dungeon = map.biome === "dungeon";
    if (dungeon) {
      ctx.beginPath();
      for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
        const terrainKind = map.cells[y][x].terrain;
        if (terrainKind !== "void" && terrainKind !== "wall") ctx.rect(x * cs, y * cs, cs, cs);
      }
      ctx.clip();
    }
    ctx.globalAlpha = rs.gridOpacity * (dungeon ? 0.82 : 1);
    ctx.strokeStyle = rs.gridColor;
    ctx.lineWidth = Math.max(0.65, cs * 0.018);
    ctx.beginPath();
    if (rs.gridType === "square") {
      for (let x = 1; x < map.width; x += 1) { ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, H); }
      for (let y = 1; y < map.height; y += 1) { ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(W, y * cs + 0.5); }
    } else {
      const radius = cs / Math.sqrt(3);
      for (let row = -1; row * radius * 1.5 < H + cs; row += 1) for (let col = -1; col * cs < W + cs; col += 1) {
        const x = col * cs + (row % 2 ? cs / 2 : 0);
        const y = row * radius * 1.5;
        for (let i = 0; i < 4; i += 1) {
          const angle = Math.PI / 6 + i * Math.PI / 3;
          const sx = x + Math.cos(angle) * radius;
          const sy = y + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
const DEBUG_ZONE_FILL: Record<string, string> = {
  dense_forest: "rgba(20, 92, 44, 0.34)",
  medium_forest: "rgba(44, 122, 62, 0.26)",
  sparse_forest: "rgba(96, 152, 74, 0.18)",
  clearing: "rgba(206, 196, 96, 0.16)",
  meadow: "rgba(142, 192, 84, 0.14)",
  forest_edge: "rgba(124, 82, 168, 0.20)",
  wetland: "rgba(44, 124, 154, 0.22)",
  rocky: "rgba(124, 124, 136, 0.24)",
  roadside: "rgba(196, 146, 64, 0.24)",
  riverbank: "rgba(64, 146, 196, 0.22)",
  chamber: "rgba(154, 134, 94, 0.20)",
  tunnel: "rgba(122, 112, 92, 0.16)",
  shore: "rgba(74, 146, 196, 0.22)",
  rubble: "rgba(112, 102, 92, 0.20)",
};

function drawDebugOverlay(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings) {
  const plan = map.plan;
  if (!plan) return;
  const cs = rs.cellSize;
  ctx.save();

  for (const zone of plan.zones) {
    ctx.fillStyle = DEBUG_ZONE_FILL[zone.type] ?? "rgba(120, 120, 120, 0.12)";
    ctx.fillRect(zone.bounds.x * cs, zone.bounds.y * cs, zone.bounds.w * cs, zone.bounds.h * cs);
  }

  ctx.lineWidth = Math.max(1.5, cs * 0.05);
  for (const road of plan.roads ?? []) {
    if (road.points.length < 2) continue;
    ctx.strokeStyle = road.type === "main" ? "rgba(255, 196, 64, 0.85)" : "rgba(255, 226, 140, 0.7)";
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = (point.x + 0.5) * cs;
      const py = (point.y + 0.5) * cs;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Коридор вокруг полотна: BFS-расстояние от клеток дороги.
  {
    const w = map.width;
    const h = map.height;
    const distance = new Int16Array(w * h).fill(99);
    const queue: number[] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const terrain = map.cells[y][x].terrain;
        if (terrain === "road" || terrain === "bridge") {
          distance[y * w + x] = 0;
          queue.push(y * w + x);
        }
      }
    }
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index];
      const level = distance[cell];
      if (level >= 4) continue;
      const cx = cell % w;
      const cy = Math.floor(cell / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (distance[next] <= level + 1) continue;
        distance[next] = level + 1;
        queue.push(next);
      }
    }
    ctx.fillStyle = "rgba(255, 210, 110, 0.07)";
    for (let cell = 0; cell < distance.length; cell += 1) {
      if (distance[cell] === 0 || distance[cell] > 3) continue;
      ctx.fillRect((cell % w) * cs, Math.floor(cell / w) * cs, cs, cs);
    }
  }

  ctx.strokeStyle = "rgba(18, 22, 16, 0.22)";
  ctx.lineWidth = Math.max(1, cs * 0.03);
  for (const tree of map.trees) {
    const inset = cs * 0.3;
    ctx.strokeRect(Math.floor(tree.x) * cs + inset, Math.floor(tree.y) * cs + inset, cs - inset * 2, cs - inset * 2);
  }
  for (const rock of map.rocks) ctx.strokeRect(Math.floor(rock.x) * cs, Math.floor(rock.y) * cs, cs, cs);

  const spawn = map.plan?.spawn;
  if (spawn) {
    const px = (spawn.x + 0.5) * cs;
    const py = (spawn.y + 0.5) * cs;
    ctx.save();
    ctx.strokeStyle = "rgba(120, 240, 255, 0.95)";
    ctx.lineWidth = Math.max(1.5, cs * 0.07);
    ctx.beginPath();
    ctx.arc(px, py, cs * 0.55, 0, Math.PI * 2);
    ctx.moveTo(px - cs * 0.8, py);
    ctx.lineTo(px + cs * 0.8, py);
    ctx.moveTo(px, py - cs * 0.8);
    ctx.lineTo(px, py + cs * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  const roomColors: Record<string, string> = {
    entrance: "#ffd166", hall: "#f2c894", guard: "#ff9a9a",
    crypt: "#c8aaff", treasury: "#ffe066", storage: "#a9d3a9",
  };
  const roomLabels: Record<string, string> = {
    entrance: "ВХ", hall: "ЗЛ", guard: "СТ", crypt: "КР", treasury: "СОК", storage: "СКЛ",
  };
  const rooms = plan.rooms ?? [];
  if (rooms.length) {
    ctx.font = Math.max(9, Math.round(cs * 0.5)) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const room of rooms) {
      ctx.strokeStyle = roomColors[room.purpose] ?? "#ffffff";
      ctx.lineWidth = Math.max(1.5, cs * 0.06);
      ctx.strokeRect(room.bounds.x * cs, room.bounds.y * cs, room.bounds.w * cs, room.bounds.h * cs);
      const label = roomLabels[room.purpose] ?? "?";
      const cx = (room.bounds.x + room.bounds.w / 2) * cs;
      const cy = (room.bounds.y + room.bounds.h / 2) * cs;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillText(label, cx, cy);
      ctx.fillStyle = roomColors[room.purpose] ?? "#ffffff";
      ctx.fillText(label, cx, cy);
    }
  }

  for (const group of plan.groups) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.arc(group.x * cs, group.y * cs, Math.max(2, cs * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  const poiColors: Record<string, string> = {
    entrance: "#ffd166", grove: "#7ef29a", clearing: "#ffe066", camp: "#ff9a6b",
    boulder_field: "#b9c2ff", pool: "#63c8ff", chamber: "#f2c894",
  };
  for (const poi of plan.poi) {
    ctx.strokeStyle = poiColors[poi.type] ?? "#ffffff";
    ctx.lineWidth = Math.max(1.5, cs * 0.06);
    ctx.beginPath();
    ctx.arc(poi.x * cs, poi.y * cs, Math.max(4, (poi.radius ?? 2) * cs), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (plan.settlement) {
    drawSettlementDebugOverlay(ctx, map, cs, rs.settlementDebug);
  }
  ctx.restore();
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

function drawTree(ctx: CanvasRenderingContext2D, tree: Tree, cs: number, biome: MapData['biome']) {
  const { kind, v, r } = tree;
  const name = kind === 'oak' && v > 0.61 ? 'oakGold' : kind;
  const look = spriteLook(tree.x, tree.y, 11);
  const base = tree.size ? tree.size.w * cs : r * cs * (kind === 'oak' ? 4.1 : kind === 'pine' ? 4.08 : kind === 'bush' ? 3.54 : 2.85);
  const size = tree.size ? base : base * look.scale;
  // Сезонная и биомная коррекция цвета — как раньше, но теперь совмещается с
  // вариацией оттенка конкретного дерева.
  let season = '';
  if (biome === 'snow' && kind === 'pine') season = 'saturate(.67) brightness(1.25)';
  else if (kind === 'pine') season = 'saturate(.76) hue-rotate(-19deg)';
  else if (kind === 'bush' || kind === 'mushroom') season = 'saturate(.66)';
  const drawn = drawLooked(ctx, name, look, tree.x * cs, tree.y * cs, size,
    tree.size ? tree.size.h * cs : undefined,
    tree.size ? 0 : (v - 0.5) * 0.89, season);
  if (!drawn) {
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
  const look = spriteLook(rock.x, rock.y, 23);
  const width = (rock.size?.w ?? rock.r * 3.05) * cs * (rock.size ? 1 : look.scale);
  const drawn = drawLooked(ctx, rock.v > 0.68 ? 'smallRock' : 'rock', look, rock.x * cs, rock.y * cs,
    width, rock.size ? rock.size.h * cs : undefined, rock.size ? 0 : (rock.v - 0.5) * 1.1);
  if (!drawn) {
    contour(ctx, rock.pts.map(([x, y]) => [(rock.x + x) * cs, (rock.y + y) * cs]));
    ctx.fillStyle = '#817c6f'; ctx.fill();
    ctx.strokeStyle = '#463f35'; ctx.lineWidth = cs * 0.035; ctx.stroke();
  }
}

function drawUrbanLightingPass(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  mode: 'dusk' | 'night',
  cs: number,
  W: number,
  H: number,
) {
  const lights = map.lights ?? [];
  const veilAlpha = mode === 'night' ? 0.68 : 0.36;
  const veilColor = mode === 'night' ? `rgba(10, 14, 30, ${veilAlpha})` : `rgba(26, 24, 48, ${veilAlpha})`;

  let drewOffscreenVeil = false;
  if (typeof document !== 'undefined') {
    const mask = document.createElement('canvas');
    // Рисуем маску освещения в половинном разрешении для высокой скорости даже на картах 200×160!
    const scale = 0.5;
    mask.width = Math.max(1, Math.round(W * scale));
    mask.height = Math.max(1, Math.round(H * scale));
    const mctx = mask.getContext('2d');
    if (mctx) {
      mctx.fillStyle = veilColor;
      mctx.fillRect(0, 0, mask.width, mask.height);
      mctx.globalCompositeOperation = 'destination-out';
      for (const lt of lights) {
        const lx = lt.x * cs * scale;
        const ly = lt.y * cs * scale;
        const lr = Math.max(4, lt.radius * cs * scale);
        const punch = Math.min(0.96, lt.intensity * (mode === 'night' ? 0.94 : 0.82));
        const g = mctx.createRadialGradient(lx, ly, lr * 0.08, lx, ly, lr);
        g.addColorStop(0, `rgba(0,0,0,${punch.toFixed(3)})`);
        g.addColorStop(0.55, `rgba(0,0,0,${(punch * 0.48).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mctx.fillStyle = g;
        mctx.beginPath();
        mctx.arc(lx, ly, lr, 0, Math.PI * 2);
        mctx.fill();
      }
      ctx.save();
      ctx.drawImage(mask, 0, 0, W, H);
      ctx.restore();
      drewOffscreenVeil = true;
    }
  }

  if (!drewOffscreenVeil) {
    ctx.save();
    ctx.fillStyle = veilColor;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Тёплые ореолы вокруг фонарей, факелов, жаровен и жилых окон:
  if (lights.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowScale = mode === 'night' ? 0.28 : 0.18;
    for (const lt of lights) {
      const lx = lt.x * cs;
      const ly = lt.y * cs;
      const lr = Math.max(4, lt.radius * cs * 0.72);
      const alpha = Math.min(0.45, lt.intensity * glowScale);
      const g = ctx.createRadialGradient(lx, ly, lr * 0.04, lx, ly, lr);
      g.addColorStop(0, `rgba(255, 214, 138, ${alpha.toFixed(3)})`);
      g.addColorStop(0.45, `rgba(255, 162, 74, ${(alpha * 0.42).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255, 140, 50, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const CHEST_WIDTH = 0.93;

function drawChest(ctx: CanvasRenderingContext2D, chest: Chest, cs: number, shaded: boolean) {
  const x = chest.x * cs, y = chest.y * cs;
  const size = chestDimensions(chest);
  if (shaded) groundShadow(ctx, x + cs * 0.064, y + cs * 0.098, cs * size.w * .54, cs * size.h * .63, 0.67);
  const angle = chest.rotation / 180 * Math.PI;
  const look = spriteLook(chest.x, chest.y, 31, false);
  const drawn = drawLooked(ctx, chestArt(chest), look, x, y, cs * size.w, cs * size.h, angle);
  if (!drawn) {
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