import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { drawObjectGhost, excludeObject, highResSettings, objectGhostBounds, renderMap, renderPixelRatio } from '../lib/render';
import { artUrl } from '../lib/assets';
import { cloneMap, eraseArea, floodFill, getChestStamp, normalizeSelection, paintCells, pasteArea, placeChest, placeObject, placeStructure, pruneCrypt } from '../lib/edits';
import { addBuilding, addCivic, addFurnishing, buildingAt, buildingStamp, canPlaceBuilding, canPlaceCivic, changeRoof, civicStamp, furnishingAt, removeFurnishing } from '../lib/settlementEdits';
import { civicArt, marketStalls, ROOF_KIT } from '../lib/settlementKit';
import { canFurnish, furnishItem } from '../lib/interiors';
import { FURNITURE, FURNITURE_FINISHES, furnitureArt, furnitureBounds } from '../lib/furnitureKit';
import { CRYPT, cryptArt, isSecret } from '../lib/cryptKit';
import { addCryptObject, canPlaceCrypt, cryptStamp, eraseCrypt } from '../lib/cryptLayout';
import { contains } from '../lib/settlementKit';
import { CHESTS, chestArt, chestBounds, chestDimensions } from '../lib/chests';
import { objectKey, stampDimensions } from '../lib/objectGeometry';
import { moveObject, nextObjectSize, objectAt, objectInfo, resizeObject } from '../lib/objectSizing';
import type { Building, CryptRoom, EditorSettings, EditorTool, FurnitureSprite, LayerId, MapData, ObjectTarget, Point, RenderSettings, Selection, Terrain } from '../lib/types';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  map: MapData;
  displayMap?: MapData;
  render: RenderSettings;
  settings: EditorSettings;
  seed: number;
  assetsReady: boolean;
  scale: number;
  selection: Selection | null;
  highlight?: Selection;
  selectedTarget?: ObjectTarget | null;
  clipboard: MapData | null;
  locked: boolean;
  lockedLayers: LayerId[];
  spacePan: boolean;
  layer: LayerId;
  onSelect: (s: Selection | null) => void;
  onCommit: (m: MapData) => void;
  onPick: (t: Terrain) => void;
  onCursor: (p: Point | null) => void;
  onBuilding: (b: Building) => void;
  onRoom: (room: CryptRoom) => void;
  onObject: (target: ObjectTarget | null) => void;
}

interface Gesture {
  pointer: number;
  start: Point;
  last: Point;
  tool: EditorTool;
  draft: MapData;
  client: Point;
  left: number;
  top: number;
}

const cell = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
const sameTarget = (a: ObjectTarget | null, b: ObjectTarget | null | undefined) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

export default function CanvasEditor(p: Props) {
  const { map, render, settings, locked } = p;
  const ref = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<MapData | null>(null);
  const [dragMap, setDragMap] = useState<MapData | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [panning, setPanning] = useState(false);
  // Перетаскивание объектов и движение курсора идут через requestAnimationFrame:
  // без этого каждый pointermove запускал полную перерисовку карты.
  const frameRef = useRef<number | null>(null);
  const queueRef = useRef<Point | null>(null);
  const objects = useRef<{ target: ObjectTarget; origin: Point; moved: number } | null>(null);
  const pending = useRef<MapData | null>(null);
  // Кэш одного перетаскивания: отрисован ли статичный слой (карта без объекта)
  // прямо на основном холсте и готов ли спрайт-призрак в overlay-канве.
  // Никаких промежуточных полноразмерных холстов: копирование 4400×3000
  // offscreen → DOM стоило секунды из-за отложенной растеризации.
  const staticDrawnRef = useRef(false);
  const ghostReadyRef = useRef(false);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const ghostLayerRef = useRef<HTMLCanvasElement | null>(null);
  // Последняя клетка, о которой сообщили родителю: App перерисовывается только при смене клетки.
  const lastCellRef = useRef<Point | null>(null);

  function reportCell(next: Point | null) {
    const prev = lastCellRef.current;
    if (prev === next || (prev && next && prev.x === next.x && prev.y === next.y)) return;
    lastCellRef.current = next;
    p.onCursor(next);
  }

  // Сброс кэшей перетаскивания: статичный слой и призрак живут один драг.
  function resetDragCache() {
    staticDrawnRef.current = false;
    ghostReadyRef.current = false;
    offsetRef.current = { x: 0, y: 0 };
    const overlay = ghostLayerRef.current;
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.transform = '';
    }
  }
  const cs = render.cellSize;
  const W = map.width * cs, H = map.height * cs;
  const custom: FurnitureSprite | undefined = map.furnitureSprites?.find((item) => item.id === settings.furnitureSprite);
  const overrideSize = settings.objectSizes[objectKey(settings)];
  const furnitureStyle = { ...(settings.furnitureFinish === 'oak' ? {} : { finish: settings.furnitureFinish }), ...(custom ? { sprite: custom.id } : {}), ...(overrideSize ? { size: overrideSize } : {}) };
  const chestOptions = { kind: settings.chestKind, size: stampDimensions(settings, CHESTS[settings.chestKind]) };

  useLayoutEffect(() => {
    if (!p.assetsReady || !ref.current) return;
    // Пока тащат объект, карту целиком не перерисовываем: React-рендер мог
    // случиться из-за состояния родителя и «дёрнул» бы объект назад.
    if (objects.current) {
      paintDragLayer();
      return;
    }
    renderMap(ref.current, draft ?? dragMap ?? p.displayMap ?? map, highResSettings(map, render), p.seed);
  }, [map, p.displayMap, draft, dragMap, render, p.seed, p.assetsReady]);

  function ensureDragAssets(target: ObjectTarget) {
    if (staticDrawnRef.current && ghostReadyRef.current) return;
    const canvas = ref.current;
    if (!canvas) return;
    const grid = highResSettings(map, render);
    // 1) Один раз за перетаскивание: карта без этого объекта — сразу на основной холст.
    if (!staticDrawnRef.current) {
      renderMap(canvas, excludeObject(draft ?? p.displayMap ?? map, target), grid, p.seed);
      staticDrawnRef.current = true;
    }
    // 2) Один раз: сам объект со всеми тенями — в маленький overlay-canvas над холстом,
    //    во время драга он двигается CSS-трансформом.
    const overlay = ghostLayerRef.current;
    if (!overlay) return;
    const bounds = objectGhostBounds(map, grid, target);
    overlay.width = Math.max(1, Math.ceil(bounds.w));
    overlay.height = Math.max(1, Math.ceil(bounds.h));
    const octx = overlay.getContext('2d');
    if (octx) {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.translate(-bounds.x, -bounds.y);
      drawObjectGhost(octx, map, grid, p.seed, target, 0, 0);
      octx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const pxPerCss = canvas.width / Math.max(1, canvas.clientWidth);
    overlay.style.width = `${overlay.width / pxPerCss}px`;
    overlay.style.height = `${overlay.height / pxPerCss}px`;
    overlay.style.left = `${bounds.x / pxPerCss}px`;
    overlay.style.top = `${bounds.y / pxPerCss}px`;
    overlay.style.transform = 'translate3d(0, 0, 0)';
    overlay.style.display = 'block';
    ghostReadyRef.current = true;
  }

  // Кадр перетаскивания: ни одной операции с основным холстом — только CSS-трансформ overlay.
  function paintDragLayer() {
    const target = objects.current;
    if (!target) return;
    ensureDragAssets(target.target);
    const overlay = ghostLayerRef.current, canvas = ref.current;
    if (!overlay || !canvas) return;
    const grid = highResSettings(map, render);
    const pxPerCss = canvas.width / Math.max(1, canvas.clientWidth);
    const dx = (offsetRef.current.x * grid.cellSize) / pxPerCss;
    const dy = (offsetRef.current.y * grid.cellSize) / pxPerCss;
    overlay.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }

  function scheduleFrame() {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pos = queueRef.current;
      if (!pos) return;
      const target = objects.current;
      if (!target) {
        setCursor(pos);
        reportCell(cell(pos));
        return;
      }
      // Перетаскивание объекта: никакого setState — рисуем слой напрямую,
      // иначе React перерисовывает всю карту на каждый кадр.
      const dx = pos.x - target.origin.x;
      const dy = pos.y - target.origin.y;
      target.moved = Math.max(target.moved, Math.hypot(dx, dy));
      const result = moveObject(map, target.target, dx, dy);
      if (!result.error) {
        pending.current = result.map;
        offsetRef.current = { x: dx, y: dy };
      }
      paintDragLayer();
    });
  }

  function cancelFrame() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    queueRef.current = null;
  }

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(map.width - 0.0001, Math.max(0, (e.clientX - box.left) / box.width * map.width)),
      y: Math.min(map.height - 0.0001, Math.max(0, (e.clientY - box.top) / box.height * map.height)),
    };
  };

  function stamp(m: MapData, position: Point, tool: EditorTool) {
    const { x, y } = cell(position);
    const size = settings.brushSize;
    const startX = x - Math.floor((size - 1) / 2), startY = y - Math.floor((size - 1) / 2);
    const area = { x: startX, y: startY, w: size, h: size };
    if (tool === 'eraser') return eraseArea(m, p.layer === 'chests' ? { x, y, w: 1, h: 1 } : area, p.layer);
    if (tool === 'brush') {
      const midX = startX + (size - 1) / 2, midY = startY + (size - 1) / 2;
      let next = m;
      for (let row = Math.max(0, startY); row < Math.min(m.height, startY + size); row++) {
        for (let col = Math.max(0, startX); col < Math.min(m.width, startX + size); col++) {
          if (settings.brushShape === 'round' && Math.hypot(col - midX, row - midY) > size / 2) continue;
          if (next.cells[row][col].terrain === settings.terrain) continue;
          if (next === m) next = cloneMap(m);
          next.cells[row][col].terrain = settings.terrain;
        }
      }
      return next === m || p.lockedLayers.includes('crypt') ? next : pruneCrypt(next);
    }
    if (tool === 'tree' || tool === 'rock') {
      const next = placeObject(m, position.x, position.y, size, tool === 'tree' ? settings.treeKind : 'rock', settings.snap);
      const dimensions = nextObjectSize(settings);
      if (next === m || !dimensions) return next;
      const target: ObjectTarget = tool === 'tree' ? { type: 'tree', index: next.trees.length - 1 } : { type: 'rock', index: next.rocks.length - 1 };
      const result = resizeObject(next, target, dimensions);
      return result.error ? m : result.map;
    }
    if (tool === 'structure') return placeStructure(m, startX, startY, size, true);
    return m;
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
    const pos = point(e), grid = cell(pos);
    if (e.button === 0 && !p.spacePan && settings.tool !== 'hand') {
      const hit = objectAt(map, pos, render);
      const active = settings.tool === 'select' || sameTarget(hit, p.selectedTarget);
      if (hit && active && !p.lockedLayers.includes(objectInfo(map, hit)?.layer ?? 'terrain')) {
        p.onObject(hit);
        objects.current = { target: hit, origin: pos, moved: 0 };
        pending.current = null;
        resetDragCache();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setCursor(pos);
        return;
      }
    }
    const tool = e.button === 1 || p.spacePan || settings.tool === 'hand' ? 'hand' : e.button === 2 ? 'eraser' : settings.tool;
    e.preventDefault();
    if (tool !== 'hand' && (e.altKey || tool === 'pick')) { p.onPick(map.cells[grid.y][grid.x].terrain); return; }
    if (locked && tool !== 'hand' && tool !== 'select') return;
    if (tool === 'crypt' || tool === 'eraser' && p.layer === 'crypt') {
      if (!render.showCrypt) return;
      const removing = tool === 'eraser' || settings.cryptErase;
      const next = removing ? eraseCrypt(map, { ...grid, w: 1, h: 1 }, render.showSecrets) : addCryptObject(map, cryptStamp(grid, settings.cryptKind, settings.stampRotation, settings.cryptConceal, (map.crypt?.length ?? 0) % 4, overrideSize));
      if (next !== map) { p.onCommit(next); setCursor(null); }
      return;
    }
    if (settings.tool === 'furniture' && (tool === 'furniture' || tool === 'eraser')) {
      const house = buildingAt(map, grid);
      if (!house || render.showRoofs || !render.showStructures) return;
      p.onBuilding(house);
      const removing = tool === 'eraser' || settings.furnitureErase;
      const item = removing ? furnishingAt(house, pos) : { ...furnishItem(settings.furnitureKind, pos, house, settings.stampRotation, settings.snap), ...furnitureStyle };
      if (item) p.onCommit(removing ? removeFurnishing(map, house, item) : addFurnishing(map, house, item));
      setCursor(null);
      return;
    }
    if (tool === 'chest') {
      const chest = getChestStamp(map, pos.x, pos.y, settings.snap, settings.chestRotation, chestOptions);
      if (chest && render.showChests && (!render.showRoofs || !render.showStructures || !buildingAt(map, grid))) p.onCommit(placeChest(map, chest));
      return;
    }
    if (tool === 'building') {
      const next = render.showStructures ? addBuilding(map, buildingStamp(map, grid, settings)) : map;
      if (next !== map) { p.onCommit(next); setCursor(null); }
      return;
    }
    if (tool === 'roof') {
      const building = buildingAt(map, grid);
      if (building && render.showStructures) p.onCommit(changeRoof(map, building, settings));
      return;
    }
    if (tool === 'civic') {
      const next = render.showCivic ? addCivic(map, civicStamp(map, grid, settings)) : map;
      if (next !== map) { p.onCommit(next); setCursor(null); }
      return;
    }
    if (tool === 'eraser' && (p.layer === 'chests' || p.layer === 'civic' || p.layer === 'structures' && (buildingAt(map, grid) || settings.tool === 'building' || settings.tool === 'roof'))) {
      p.onCommit(eraseArea(map, { ...grid, w: 1, h: 1 }, p.layer));
      setCursor(null);
      return;
    }
    if (tool === 'fill') { p.onCommit(floodFill(map, grid.x, grid.y, settings.terrain)); return; }
    if (tool === 'paste') {
      if (p.clipboard) p.onCommit(pasteArea(map, p.clipboard, grid.x, grid.y, p.lockedLayers));
      return;
    }
    const drawing = ['brush', 'eraser', 'tree', 'rock', 'structure'].includes(tool);
    gesture.current = {
      pointer: e.pointerId, start: pos, last: pos, tool,
      draft: drawing ? stamp(map, pos, tool) : map,
      client: { x: e.clientX, y: e.clientY }, left: p.scrollRef.current?.scrollLeft ?? 0, top: p.scrollRef.current?.scrollTop ?? 0,
    };
    if (drawing) setDraft(gesture.current.draft);
    if (tool === 'select' || tool === 'rect') { setAnchor(grid); setCursor(pos); }
    if (tool === 'hand') setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const pos = point(e), g = gesture.current;
    if (!g || g.pointer !== e.pointerId) {
      queueRef.current = pos;
      scheduleFrame();
      return;
    }
    setCursor(pos); reportCell(cell(pos));
    if (g.tool === 'hand') {
      p.scrollRef.current?.scrollTo(g.left - e.clientX + g.client.x, g.top - e.clientY + g.client.y);
      return;
    }
    if (g.tool === 'select' || g.tool === 'rect') { g.last = pos; return; }
    const from = cell(g.last), to = cell(pos);
    const dx = to.x - from.x, dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (!steps) return;
    for (let i = 1; i <= steps; i++) {
      const mid = i === steps ? pos : { x: Math.round(from.x + dx * i / steps) + .5, y: Math.round(from.y + dy * i / steps) + .5 };
      g.draft = stamp(g.draft, mid, g.tool);
    }
    g.last = pos;
    setDraft(g.draft);
  }

  function finish(e: PointerEvent<HTMLCanvasElement>, cancel = false) {
    cancelFrame();
    if (objects.current) {
      // Финальная позиция берётся из события: между последним кадром и pointerup
      // могло не хватить одного rAF, и объект иначе «отставал» бы на несколько пикселей.
      if (!cancel) {
        const pos = point(e);
        const dx = pos.x - objects.current.origin.x;
        const dy = pos.y - objects.current.origin.y;
        if (Math.hypot(dx, dy) > 0.02) {
          const last = moveObject(map, objects.current.target, dx, dy);
          if (!last.error) {
            pending.current = last.map;
            offsetRef.current = { x: dx, y: dy };
          }
        }
        objects.current.moved = Math.max(objects.current.moved, Math.hypot(dx, dy));
      }
      const moved = objects.current.moved;
      const target = objects.current.target;
      const movedMap = cancel ? null : pending.current;
      const committing = !!movedMap && moved > 0.02 && !cancel;
      objects.current = null; pending.current = null; setPanning(false); setDragMap(null);
      resetDragCache();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (committing) {
        // Карту с новым положением нарисует layout-эффект после коммита —
        // второй синхронный renderMap здесь только удваивал стоимость отпускания.
        p.onCommit(movedMap!);
        // Коммит сбрасывает выделение в App; возвращаем объект, чтобы инспектор не закрывался.
        p.onObject(target);
      } else if (ref.current) {
        renderMap(ref.current, draft ?? p.displayMap ?? map, highResSettings(map, render), p.seed);
      }
      return;
    }
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    gesture.current = null; setDraft(null); setAnchor(null); setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancel) return;
    if (g.tool === 'select') {
      const selection = normalizeSelection(cell(g.start), cell(point(e)));
      const target = selection.w === 1 && selection.h === 1 ? objectAt(map, point(e), render) : null;
      p.onObject(target);
      const house = selection.w === 1 && selection.h === 1 ? buildingAt(map, selection) : undefined;
      if (house) p.onBuilding(house);
      const room = selection.w === 1 && selection.h === 1 ? map.cryptRooms?.find((item) => contains(item, selection.x, selection.y)) : undefined;
      if (room) p.onRoom(room);
      p.onSelect(target ? null : selection);
    }
    else if (g.tool === 'rect') p.onCommit(paintCells(map, normalizeSelection(cell(g.start), cell(point(e))), settings.terrain));
    else if (g.tool !== 'hand' && g.draft !== map) p.onCommit(g.draft);
  }

  let preview: Selection | null = null;
  const grid = cursor && cell(cursor);
  const isHand = p.spacePan || settings.tool === 'hand';
  const placing = Boolean(cursor && settings.tool === 'chest' && !isHand);
  const chest = placing && cursor && grid && !locked && render.showChests && (!render.showRoofs || !render.showStructures || !buildingAt(map, grid)) ? getChestStamp(map, cursor.x, cursor.y, settings.snap, settings.chestRotation, chestOptions) : null;
  const drawPreview = chest && !map.chests.some((c) => c.x === chest.x && c.y === chest.y && c.rotation === chest.rotation && c.kind === chest.kind && chestDimensions(c).w === chestDimensions(chest).w && chestDimensions(c).h === chestDimensions(chest).h);
  const building = grid && !isHand ? settings.tool === 'building' ? buildingStamp(map, grid, settings) : settings.tool === 'roof' ? buildingAt(map, grid) : undefined : undefined;
  const civic = grid && !isHand && settings.tool === 'civic' ? civicStamp(map, grid, settings) : undefined;
  const crypt = grid && !isHand && settings.tool === 'crypt' ? settings.cryptErase
    ? (map.crypt ?? []).filter((item) => contains(item, grid.x, grid.y) && (render.showSecrets || !isSecret(item))).at(-1)
    : cryptStamp(grid, settings.cryptKind, settings.stampRotation, settings.cryptConceal, 0, overrideSize) : undefined;
  const footprint = building ?? civic ?? crypt;
  const valid = !locked && (building ? render.showStructures && (settings.tool === 'roof' || canPlaceBuilding(map, building)) : civic ? render.showCivic && canPlaceCivic(map, civic) : crypt ? render.showCrypt && (settings.cryptErase || canPlaceCrypt(map, crypt)) : false);
  const interior = grid && !isHand && settings.tool === 'furniture' && !render.showRoofs && render.showStructures ? buildingAt(map, grid) : undefined;
  const item = interior && cursor ? settings.furnitureErase ? furnishingAt(interior, cursor) : { ...furnishItem(settings.furnitureKind, cursor, interior, settings.stampRotation, settings.snap), ...furnitureStyle } : undefined;
  const itemValid = interior && item && !locked && (settings.furnitureErase || canFurnish(interior, item));
  const itemBox = item && furnitureBounds(item);
  if (grid && !isHand && !locked) {
    if (anchor) preview = normalizeSelection(anchor, grid);
    else if (settings.tool === 'brush' || settings.tool === 'eraser') {
      const size = ['chests', 'civic', 'crypt'].includes(p.layer) ? 1 : settings.brushSize;
      const shift = Math.floor((size - 1) / 2);
      preview = { x: grid.x - shift, y: grid.y - shift, w: size, h: size };
    } else if (settings.tool === 'paste' && p.clipboard) preview = { ...grid, w: p.clipboard.width, h: p.clipboard.height };
    else if (settings.tool === 'structure') {
      const shift = Math.floor((settings.brushSize - 1) / 2);
      preview = { x: grid.x - shift, y: grid.y - shift, w: settings.brushSize + 2, h: Math.max(3, settings.brushSize + 1) };
    } else if (['pick', 'tree', 'rock', 'fill'].includes(settings.tool)) preview = { ...grid, w: 1, h: 1 };
  }

  const hoverTarget = cursor && !isHand ? objectAt(map, cursor, render) : null;
  const canDrag = !!hoverTarget && (settings.tool === 'select' || sameTarget(hoverTarget, p.selectedTarget))
    && !p.lockedLayers.includes(objectInfo(map, hoverTarget)?.layer ?? 'terrain');
  return <div className="canvas-stage" style={{ width: W * p.scale, height: H * p.scale }}>
    <canvas ref={ref} aria-label={`Редактируемая карта ${map.width} на ${map.height} клеток`} width={Math.round(W * renderPixelRatio(map, render))} height={Math.round(H * renderPixelRatio(map, render))}
      style={{ cursor: panning || objects.current ? 'grabbing' : canDrag ? 'grab' : isHand ? 'grab' : locked || (placing && !chest) || (footprint && !valid) || (settings.tool === 'furniture' && !itemValid) ? 'not-allowed' : 'crosshair', touchAction: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)}
      onPointerLeave={() => { if (!gesture.current) { setCursor(null); reportCell(null); } }} onContextMenu={(e) => e.preventDefault()} />
    <canvas ref={ghostLayerRef} aria-hidden="true" className="pointer-events-none absolute" style={{ display: 'none', zIndex: 1 }} />
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`}>
      {p.highlight && <rect className="house-highlight" x={p.highlight.x * cs} y={p.highlight.y * cs} width={p.highlight.w * cs} height={p.highlight.h * cs} fill="none" stroke="#f5c384" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      {p.selection && <rect x={p.selection.x * cs} y={p.selection.y * cs} width={p.selection.w * cs} height={p.selection.h * cs} fill="#d7a76722" stroke="#ffd893" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      {preview && <rect x={preview.x * cs} y={preview.y * cs} width={preview.w * cs} height={preview.h * cs} rx={settings.tool === 'brush' && settings.brushShape === 'round' && preview.w > 1 ? preview.w * cs / 2 : 0} fill="#eee0ba17" stroke="#fff0c4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      {placing && grid && (() => { const bounds = chest ? chestBounds(chest) : { ...grid, w: 1, h: 1 }; return <rect x={bounds.x * cs} y={bounds.y * cs} width={bounds.w * cs} height={bounds.h * cs} fill={chest ? '#dca25b20' : '#ea736d26'} stroke={chest ? '#ffd694' : '#ed8f78'} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />; })()}
      {drawPreview && <image href={artUrl(chestArt(chest))} x={(chest.x - chestDimensions(chest).w / 2) * cs} y={(chest.y - chestDimensions(chest).h / 2) * cs} width={chestDimensions(chest).w * cs} height={chestDimensions(chest).h * cs}
        transform={`rotate(${chest.rotation} ${chest.x * cs} ${chest.y * cs})`} opacity="0.79" />}
      {footprint && <g data-stamp={valid ? 'ready' : 'blocked'}>
        <rect x={footprint.x * cs} y={footprint.y * cs} width={footprint.w * cs} height={footprint.h * cs} fill={valid && !(crypt && settings.cryptErase) ? '#dca25b22' : '#ea736d37'} stroke={valid && !(crypt && settings.cryptErase) ? '#f7d59b' : '#e58a72'} strokeWidth="1.6" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
        {valid && building && <image href={artUrl(ROOF_KIT[settings.roofMaterial].art)} x={(building.x + .08) * cs} y={(building.y + .08) * cs} width={(building.w - .16) * cs} height={(building.h - .16) * cs} preserveAspectRatio="none" opacity="0.65" />}
        {valid && civic && (() => {
          const rotate = civic.kind !== 'square' && civic.rotation % 180 !== 0;
          const w = (rotate ? civic.h : civic.w) - .12, h = (rotate ? civic.w : civic.h) - .12;
          const x = civic.x + civic.w / 2, y = civic.y + civic.h / 2;
          if (civic.kind === 'market') return <g transform={`rotate(${civic.rotation} ${x * cs} ${y * cs})`} opacity="0.8">
            {marketStalls(w + .12, h + .12, civic.variant).map((stall) => { const sx = (w + .12) / ((w + .12 >= 4 ? 2 : 1) * 2), sy = (h + .12) / ((h + .12 >= 4 ? 2 : 1) * 2); return <image key={`${stall.x}:${stall.y}`} href={artUrl(stall.art)} x={(x + (stall.x - .93) * sx) * cs} y={(y + (stall.y - .93) * sy) * cs} width={1.86 * sx * cs} height={1.86 * sy * cs} />; })}
          </g>;
          return <image href={artUrl(civicArt(civic))} x={(x - w / 2) * cs} y={(y - h / 2) * cs} width={w * cs} height={h * cs} preserveAspectRatio={civic.kind === 'square' ? 'none' : 'xMidYMid meet'} transform={`rotate(${civic.kind === 'square' ? 0 : civic.rotation} ${x * cs} ${y * cs})`} opacity="0.8" />;
        })()}
        {valid && crypt && !settings.cryptErase && (() => {
          const rotate = crypt.rotation % 180 !== 0, w = (rotate ? crypt.h : crypt.w) - .13, h = (rotate ? crypt.w : crypt.h) - .13;
          const x = crypt.x + crypt.w / 2, y = crypt.y + crypt.h / 2;
          return <image href={artUrl(cryptArt(crypt.kind))} x={(x - w / 2) * cs} y={(y - h / 2) * cs} width={w * cs} height={h * cs} preserveAspectRatio={CRYPT[crypt.kind].flat || crypt.kind === 'chasm' ? 'none' : 'xMidYMid meet'} transform={`rotate(${crypt.rotation} ${x * cs} ${y * cs})`} opacity=".82" />;
        })()}
      </g>}
      {interior && item && itemBox && <g data-furniture-preview={itemValid ? 'ready' : 'blocked'}>
        <rect x={(interior.x + itemBox.x) * cs} y={(interior.y + itemBox.y) * cs} width={itemBox.w * cs} height={itemBox.h * cs} fill={itemValid && !settings.furnitureErase ? '#dca25b29' : '#ea736d40'} stroke={itemValid && !settings.furnitureErase ? '#f7d59b' : '#ed927b'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {itemValid && !settings.furnitureErase && <image href={custom?.data ?? artUrl(furnitureArt(item.kind))} style={{ filter: FURNITURE_FINISHES[item.finish ?? 'oak'].filter }} x={(interior.x + item.x - (item.size?.w ?? FURNITURE[item.kind].w) / 2) * cs} y={(interior.y + item.y - (item.size?.h ?? FURNITURE[item.kind].h) / 2) * cs} width={(item.size?.w ?? FURNITURE[item.kind].w) * cs} height={(item.size?.h ?? FURNITURE[item.kind].h) * cs} preserveAspectRatio={custom ? 'xMidYMid meet' : 'none'} transform={`rotate(${item.rotation} ${(interior.x + item.x) * cs} ${(interior.y + item.y) * cs})`} opacity="0.77" />}
      </g>}
    </svg>
  </div>;
}