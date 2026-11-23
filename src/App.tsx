import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from 'react';
import ControlPanel from './components/ControlPanel';
import EditorPanel, { SHORTCUTS, TOOL_LABELS } from './components/EditorPanel';
import CanvasEditor from './components/CanvasEditor';
import SettlementPanel, { type LayoutSettings } from './components/SettlementPanel';
import InteriorPanel from './components/InteriorPanel';
import CryptPanel, { type CryptSettings } from './components/CryptPanel';
import ObjectSizePanel from './components/ObjectSizePanel';
import Icon from './components/Icon';
import { generateMap } from './lib/generator';
import { EMPTY_LEVEL_EDITS, isLevelSwitch, recallLevel, stashLevel } from './lib/levelEdits';
import { highResSettings, renderMap, renderPixelRatio } from './lib/render';
import { TERRAIN_COLORS, TERRAIN_LABELS } from './lib/palette';
import { loadAssets, loadMarketAssets } from './lib/assets';
import { CHEST_ROTATIONS, copyArea, eraseArea } from './lib/edits';
import { BIOME_LABELS, DEFAULT_RENDER, STARTER_CRYPT } from './lib/presets';
import { CORRUPT_SESSION_KEY, downloadJson, parseProject, readSession, saveSession, sessionWasQuarantined } from './lib/project';
import { CIVIC_KIT, contains, DEFAULT_EDITOR, isSettlement } from './lib/settlementKit';
import { buildingAt, replanSettlement } from './lib/settlementEdits';
import { FURNITURE } from './lib/furnitureKit';
import { CRYPT, CRYPT_THEMES } from './lib/cryptKit';
import { redecorateCrypt } from './lib/cryptLayout';
import { loadFurnitureSprites, importFurnitureSprite, MAX_SPRITES } from './lib/furnitureImport';
import { objectKey, stampDimensions } from './lib/objectGeometry';
import { objectInfo, removeObject, resizeObject, rotateObject, stampDefaults } from './lib/objectSizing';
import { extractDoors, extractWalls } from './lib/bridge';
import type { Biome, Building, ChestKind, CryptRoom, EditorSettings, EditorTool, FurnitureKind, GenSettings, LayerId, MapData, ObjectDimensions, ObjectTarget, Point, RenderSettings, Selection } from './lib/types';
import { cn } from './utils/cn';

const MAP_TITLES: Record<Biome, string> = {
  forest: 'Лесная переправа', plains: 'Старый тракт', swamp: 'Гиблая топь', desert: 'Забытый оазис',
  snow: 'Зимний перевал', cave: 'Глубокие пещеры', dungeon: 'Каменный склеп',
  village: 'Деревня у большой дороги', town: 'Торговый квартал',
};
const TOOL_LAYERS: Partial<Record<EditorTool, LayerId>> = { brush: 'terrain', fill: 'terrain', rect: 'terrain', pick: 'terrain', tree: 'trees', rock: 'rocks', structure: 'structures', chest: 'chests', paste: 'terrain', building: 'structures', roof: 'structures', civic: 'civic', furniture: 'structures', crypt: 'crypt' };
const LAYER_TOOLS: Record<LayerId, EditorTool> = { terrain: 'brush', trees: 'tree', rocks: 'rock', structures: 'structure', chests: 'chest', civic: 'civic', crypt: 'crypt' };
const VISIBILITY_KEYS = { trees: 'showTrees', rocks: 'showRocks', structures: 'showStructures', chests: 'showChests', civic: 'showCivic', crypt: 'showCrypt' } as const;
const CITY_TOOLS = ['civic', 'building', 'roof'];

type Mode = 'generate' | 'edit';
type Inspector = 'settlement' | 'interior' | 'tools' | 'crypt';
function inspectorFor(biome: Biome, tool: EditorTool): Inspector {
  if (tool === 'crypt' || biome === 'dungeon') return 'crypt';
  if (tool === 'furniture') return 'interior';
  return isSettlement(biome) || CITY_TOOLS.includes(tool) ? 'settlement' : 'tools';
}
type Snapshot = { gen: GenSettings; edit: MapData | null };
type UndoState = { current: Snapshot; past: Snapshot[]; future: Snapshot[] };
const historyFor = (gen: GenSettings, edit: MapData | null = null): UndoState => ({ current: { gen, edit }, past: [], future: [] });
const keyboardTools = Object.fromEntries(Object.entries(SHORTCUTS).map(([tool, key]) => [`Key${key}`, tool as EditorTool]));

export default function App() {
  const [initial] = useState(readSession);
  const [render, setRender] = useState<RenderSettings>(initial?.render ?? { ...DEFAULT_RENDER, showRoofs: false });
  const [editor, setEditor] = useState<EditorSettings>(initial?.editor ?? (initial ? DEFAULT_EDITOR : { ...DEFAULT_EDITOR, tool: 'select' }));
  const [history, setHistory] = useState(() => historyFor(initial?.gen ?? STARTER_CRYPT, initial?.map));
  const { gen, edit } = history.current;
  // Правки уровней подземелья: переход между уровнями их не теряет.
  const levelEdits = useRef(EMPTY_LEVEL_EDITS);
  const [mode, setMode] = useState<Mode>('edit');
  const [inspector, setInspector] = useState<Inspector>(() => inspectorFor(gen.biome, editor.tool));
  const [settlementTab, setSettlementTab] = useState<'settlement' | 'crypt'>(() => gen.biome === 'dungeon' || editor.tool === 'crypt' ? 'crypt' : 'settlement');
  const [focusedHouse, setFocusedHouse] = useState<Point | null>(null);
  const [focusedRoom, setFocusedRoom] = useState<Point | null>(null);
  const [seedHistory, setSeedHistory] = useState<number[]>([]);
  const [zoom, setZoom] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedObject, setSelectedObject] = useState<ObjectTarget | null>(null);
  const [sizePreview, setSizePreview] = useState<{ size: ObjectDimensions; kind?: ChestKind } | null>(null);
  const [hiddenSize, setHiddenSize] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<MapData | null>(null);
  const [lockedLayers, setLockedLayers] = useState<LayerId[]>([]);
  const [activeLayer, setActiveLayer] = useState<LayerId>(TOOL_LAYERS[editor.tool] ?? 'terrain');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);
  const [spritesReady, setSpritesReady] = useState(!initial?.map?.furnitureSprites?.length);
  const [marketReady, setMarketReady] = useState(!isSettlement(gen.biome) && !initial?.map?.civic?.length);
  const [spacePan, setSpacePan] = useState(false);
  const [toast, setToast] = useState(() => sessionWasQuarantined() ? `Автосохранение повреждено: копия отложена в localStorage («${CORRUPT_SESSION_KEY}»)` : '');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [viewSize, setViewSize] = useState({ width: 1000, height: 590 });
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const currentContext = useRef({ gen, edit });
  currentContext.current = { gen, edit };

  const generated = useMemo(() => generateMap(gen), [gen]);
  const map = edit ?? generated;
  const chosenHouse = focusedHouse ? buildingAt(map, focusedHouse) : undefined;
  const chosenRoom = focusedRoom ? map.cryptRooms?.find((r) => contains(r, focusedRoom.x, focusedRoom.y)) : undefined;
  const tavern = map.buildings?.find((b) => b.kind === 'tavern');
  const width = map.width * render.cellSize, height = map.height * render.cellSize;
  const fit = Math.min(1, Math.max(0.025, (viewSize.width - 20) / width), Math.max(0.025, (viewSize.height - 20) / height));
  const scale = zoom ?? fit;
  const visibility = { terrain: true, trees: render.showTrees, rocks: render.showRocks, structures: render.showStructures, chests: render.showChests, civic: render.showCivic, crypt: render.showCrypt };
  const chestLocked = lockedLayers.includes('chests');
  const selectedInfo = selectedObject ? objectInfo(map, selectedObject) : null;
  const newObject = stampDefaults(editor);
  const sizeInfo = selectedInfo ?? newObject;
  const sizeContext = selectedObject ? `selected:${selectedObject.type}:${selectedObject.index}:${selectedObject.type === 'furniture' ? selectedObject.building : ''}` : `stamp:${objectKey(editor)}`;
  const shownSize = selectedInfo?.size ?? (newObject ? stampDimensions(editor, newObject.size) : null);
  const resizedPreview = useMemo(() => selectedObject && sizePreview && !lockedLayers.includes(selectedInfo?.layer ?? 'terrain')
    ? resizeObject(map, selectedObject, sizePreview.size, sizePreview.kind) : null, [map, selectedObject, sizePreview, lockedLayers, selectedInfo?.layer]);
  const renderMapData = resizedPreview?.map ?? map;
  const placingSettings = sizePreview && !selectedObject ? { ...editor, objectSizes: { ...editor.objectSizes, [objectKey(editor)]: sizePreview.size } } : editor;

  const legend = useMemo(() => {
    const types = new Map<keyof typeof TERRAIN_COLORS, number>();
    for (const row of map.cells) for (const entry of row) types.set(entry.terrain, (types.get(entry.terrain) ?? 0) + 1);
    return [...types].filter(([terrain]) => terrain !== 'void').sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type]) => type);
  }, [map.cells]);

  useEffect(() => {
    let stopped = false;
    Promise.all([loadAssets(), loadFurnitureSprites(initial?.map?.furnitureSprites ?? [])]).then(() => {
      if (!stopped) { setAssetsReady(true); setSpritesReady(true); }
    });
    return () => { stopped = true; };
  }, [initial]);

  // Рыночные спрайты нужны поселениям и сценам с городскими объектами
  // (торговый пост, лагерь): остальным картам их не декодируем.
  const needsMarket = isSettlement(gen.biome) || (map.civic?.length ?? 0) > 0;
  useEffect(() => {
    if (!needsMarket) { setMarketReady(true); return; }
    let stopped = false;
    setMarketReady(false);
    loadMarketAssets().then(() => { if (!stopped) setMarketReady(true); });
    return () => { stopped = true; };
  }, [needsMarket]);

  useEffect(() => {
    if (assetsReady && spritesReady && marketReady && mode === 'generate' && canvasRef.current) renderMap(canvasRef.current, map, highResSettings(map, render), gen.seed);
  }, [map, render, mode, gen.seed, assetsReady, spritesReady, marketReady]);

  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setViewSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // JSON.stringify всей карты (8000 клеток + встроенные спрайты) и localStorage.setItem —
    // синхронные и заметные. Пишем не раньше чем через секунду тишины и в простое
    // главного потока, чтобы автосохранение не попадало в середину серии правок.
    let idle: number | null = null;
    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      try { saveSession({ version: 1, gen, render, map: edit, editor }); } catch { /* JSON download stays available. */ }
    };
    const schedule = () => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(write, { timeout: 2000 });
      else write();
    };
    const timer = setTimeout(schedule, 1000);
    window.addEventListener('pagehide', write);
    return () => {
      clearTimeout(timer);
      if (idle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle);
      window.removeEventListener('pagehide', write);
    };
  }, [gen, render, editor, edit]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const changeRender = useCallback((patch: Partial<RenderSettings>) => setRender((state) => ({ ...state, ...patch })), []);
  const changeEditor = useCallback((patch: Partial<EditorSettings>) => {
    if (['chestKind', 'cryptKind', 'civicKind', 'civicSize', 'buildingSize', 'treeKind', 'furnitureKind', 'furnitureSprite'].some((key) => key in patch)) {
      setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
    }
    setEditor((state) => ({ ...state, ...patch }));
  }, []);

  function onGen(patch: Partial<GenSettings>) {
    if (isLevelSwitch(gen, patch)) {
      // Другой уровень того же подземелья: правки текущего уходят в хранилище, правки нового возвращаются.
      levelEdits.current = stashLevel(levelEdits.current, gen, edit);
      const next = { ...gen, ...patch };
      setHistory(historyFor(next, recallLevel(levelEdits.current, next)));
      setZoom(null); setSelection(null); setCursor(null); setFocusedRoom(null);
      setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
      return;
    }
    const stored = Object.keys(levelEdits.current.maps).length > 0;
    if ((edit || stored) && !window.confirm('Создать новую карту? Ручные правки текущей карты будут сброшены.')) return;
    levelEdits.current = EMPTY_LEVEL_EDITS;
    const biome = patch.biome ?? gen.biome;
    setHistory(historyFor({ ...gen, ...patch, settlement: isSettlement(biome) ? biome : gen.settlement }));
    setZoom(null); setSelection(null); setCursor(null); setFocusedHouse(null); setFocusedRoom(null);
    setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
    if (biome === 'dungeon') setSettlementTab('crypt');
    else if (isSettlement(biome)) setSettlementTab('settlement');
  }

  function randomSeed() {
    const seed = (gen.seed + 1 + Math.floor(Math.random() * 99999)) % 4294967296;
    if ((edit || Object.keys(levelEdits.current.maps).length > 0) && !window.confirm('Создать новую карту? Ручные правки текущей карты будут сброшены.')) return;
    levelEdits.current = EMPTY_LEVEL_EDITS;
    setSeedHistory((seeds) => [gen.seed, ...seeds.filter((n) => n !== gen.seed)].slice(0, 8));
    setHistory(historyFor({ ...gen, seed })); setZoom(null); setSelection(null); setCursor(null); setFocusedHouse(null);
    setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
  }

  function keepSnapshot(next: Snapshot) {
    setHistory((old) => ({ current: next, past: [...old.past, old.current].slice(-30), future: [] }));
    setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
  }

  function commit(next: MapData) {
    if (next === map) return;
    keepSnapshot({ gen, edit: next === generated ? null : next });
    setSelection(null);
  }

  function applyLayout(layout: LayoutSettings) {
    if (lockedLayers.length) return;
    const next = { ...gen, biome: layout.style, settlement: layout.style, density: layout.density, publicSpaces: layout.publicSpaces, marketStyle: layout.marketStyle, marketRichness: layout.marketRichness, marketArchetype: layout.marketArchetype };
    const merged = edit && gen.biome === layout.style ? replanSettlement(map, generated, generateMap(next)) : null;
    if (merged || next.biome !== gen.biome || next.density !== gen.density || next.publicSpaces !== gen.publicSpaces
      || next.marketStyle !== gen.marketStyle || next.marketRichness !== gen.marketRichness || next.marketArchetype !== gen.marketArchetype) keepSnapshot({ gen: next, edit: merged });
    setSettlementTab('settlement'); setInspector('settlement'); setFocusedRoom(null);
    setSelection(null); setCursor(null); setMobileSidebar(false);
    setToast(merged && next.density > 0 && !merged.buildings?.some((b) => b.kind === 'tavern') ? 'Таверна не помещается среди ручных построек. Освободите участок.' : 'Планировка применена');
  }

  function undo() {
    setHistory((current) => current.past.length ? { current: current.past[current.past.length - 1], past: current.past.slice(0, -1), future: [current.current, ...current.future] } : current);
    setSelection(null);
    setSelectedObject(null); setSizePreview(null);
  }

  function redo() {
    setHistory((current) => current.future.length ? { current: current.future[0], past: [...current.past, current.current], future: current.future.slice(1) } : current);
    setSelection(null);
    setSelectedObject(null); setSizePreview(null);
  }

  function pickObject(target: ObjectTarget | null) {
    setSelectedObject(target); setSizePreview(null); setHiddenSize(null);
    const info = target && objectInfo(map, target);
    if (info) {
      setActiveLayer(info.layer); setSelection(null);
      setMobileSidebar(true);
      if (target?.type === 'furniture') setFocusedHouse({ x: map.buildings![target.building].x, y: map.buildings![target.building].y });
    }
  }

  function previewObjectSize(size: ObjectDimensions, kind?: ChestKind) {
    if (selectedObject) {
      const result = resizeObject(map, selectedObject, size, kind);
      setSizePreview(result.error ? null : { size, kind });
      return result.error;
    }
    setSizePreview({ size, kind });
  }

  function spinObject(degrees: number) {
    if (!selectedObject || !selectedInfo) return 'Сначала выберите предмет на карте.';
    if (lockedLayers.includes(selectedInfo.layer)) return 'Сначала разблокируйте слой объекта.';
    const result = rotateObject(map, selectedObject, degrees);
    if (result.error) return result.error;
    keepSnapshot({ gen, edit: result.map });
    return undefined;
  }

  function applyObjectSize(size: ObjectDimensions, kind?: ChestKind) {
    if (!sizeInfo || lockedLayers.includes(sizeInfo.layer)) return;
    size = { w: size.w, h: size.h };
    if (selectedObject) {
      const result = resizeObject(map, selectedObject, size, kind);
      if (result.error) { setToast(result.error); return; }
      const target = selectedObject;
      keepSnapshot({ gen, edit: result.map }); setSelectedObject(target);
      setToast('Размер объекта изменён');
    } else {
      changeEditor({ objectSizes: { ...editor.objectSizes, [objectKey(editor)]: size } });
      setSizePreview(null); setToast('Размер для следующих объектов сохранён');
    }
  }

  function onTool(tool: EditorTool) {
    if (tool === 'paste' && !clipboard) return;
    changeEditor({ tool });
    const layer = TOOL_LAYERS[tool];
    if (layer) setActiveLayer(layer);
    if (CITY_TOOLS.includes(tool)) { setInspector('settlement'); setSettlementTab('settlement'); }
    if (tool === 'crypt') { setInspector('crypt'); setSettlementTab('crypt'); changeRender({ showCrypt: true }); }
    if (tool === 'furniture') {
      setInspector('interior');
      changeRender({ showRoofs: false, showStructures: true });
    }
    if (tool === 'chest') setInspector('tools');
    if (tool === 'paste') setSelection(null);
    if (tool === 'chest' || tool === 'paste' || tool === 'civic' || tool === 'furniture' || tool === 'crypt') setMobileSidebar(false);
  }

  function stageCrypt() {
    keepSnapshot({ gen: { ...STARTER_CRYPT, seed: gen.seed }, edit: null });
    setMode('edit'); setInspector('crypt'); setSettlementTab('crypt'); setMobileSidebar(false);
    setZoom(null); setCursor(null); setSelection(null); setFocusedRoom(null); setLockedLayers([]);
    setActiveLayer('crypt'); changeEditor({ tool: 'select', cryptErase: false });
    changeRender({ showCrypt: true, showSecrets: true, showStructures: true });
    setToast('Склеп создан');
  }

  function applyCrypt(settings: CryptSettings) {
    if (lockedLayers.includes('crypt') || gen.biome !== 'dungeon') return;
    const next = { ...gen, ...settings };
    keepSnapshot({ gen: next, edit: redecorateCrypt(map, next) });
    setSelection(null); setMobileSidebar(false); setToast('Обстановка склепа обновлена');
  }

  function viewCryptRoom(room: CryptRoom) {
    const viewport = viewportRef.current;
    const w = viewport?.clientWidth || viewSize.width, h = viewport?.clientHeight || viewSize.height;
    const factor = Math.min(1.24, Math.max(fit, Math.min(w / ((room.w + 5) * render.cellSize), h / ((room.h + 5) * render.cellSize))));
    setFocusedRoom({ x: room.x, y: room.y }); setMode('edit'); setInspector('crypt'); setSettlementTab('crypt');
    setMobileSidebar(false); setZoom(factor); setSelection(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const view = viewportRef.current;
      view?.scrollTo((room.x + room.w / 2) * render.cellSize * factor - view.clientWidth / 2, (room.y + room.h / 2) * render.cellSize * factor - view.clientHeight / 2);
    }));
  }

  async function importFurniture(file: File, kind: FurnitureKind) {
    const before = currentContext.current;
    if (lockedLayers.includes('structures')) { setToast('Разблокируйте слой построек.'); return; }
    if ((map.furnitureSprites?.length ?? 0) >= MAX_SPRITES) { setToast(`В проекте помещается до ${MAX_SPRITES} спрайтов.`); return; }
    try {
      const sprite = await importFurnitureSprite(file, kind);
      if (currentContext.current.gen !== before.gen || currentContext.current.edit !== before.edit) { setToast('Карта изменилась. Выберите файл ещё раз.'); return; }
      commit({ ...map, furnitureSprites: [...(map.furnitureSprites ?? []), sprite] });
      changeEditor({ furnitureKind: kind, furnitureSprite: sprite.id, furnitureFinish: 'oak', furnitureErase: false });
      onTool('furniture'); setToast('Спрайт добавлен в проект');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Не удалось открыть изображение.'); }
  }

  function showInterior(house: Building) {
    setFocusedHouse({ x: house.x, y: house.y });
    setInspector('interior'); setMode('edit'); setMobileSidebar(false);
    changeRender({ showRoofs: false, showStructures: true });
    const focusScale = Math.min(1.18, Math.max(fit, Math.min(viewSize.width / ((house.w + 4) * render.cellSize), viewSize.height / ((house.h + 4) * render.cellSize))));
    setZoom(focusScale); setSelection(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const view = viewportRef.current;
      view?.scrollTo((house.x + house.w / 2) * render.cellSize * focusScale - view.clientWidth / 2, (house.y + house.h / 2) * render.cellSize * focusScale - view.clientHeight / 2);
    }));
  }

  function onLayer(layer: LayerId) {
    if (editor.tool !== 'eraser') onTool(LAYER_TOOLS[layer]);
    else setActiveLayer(layer);
  }

  function rotateStamp() {
    const key = editor.tool === 'chest' ? 'chestRotation' : 'stampRotation';
    setEditor((current) => ({ ...current, [key]: CHEST_ROTATIONS[(CHEST_ROTATIONS.indexOf(current[key]) + 1) % 4] }));
  }

  function deleteSelection() {
    if (selectedObject && selectedInfo) {
      if (lockedLayers.includes(selectedInfo.layer)) { setToast('Сначала разблокируйте слой объекта.'); return; }
      commit(removeObject(map, selectedObject)); return;
    }
    if (!selection) return;
    const layer = activeLayer;
    if (lockedLayers.includes(layer)) { setToast('Сначала разблокируйте выбранный слой.'); return; }
    commit(eraseArea(map, selection, layer));
  }

  function copySelection(cut: boolean) {
    const bounds = selectedInfo?.bounds;
    const area = bounds ? {
      x: Math.max(0, Math.floor(bounds.x)), y: Math.max(0, Math.floor(bounds.y)),
      w: Math.ceil(bounds.x + bounds.w) - Math.max(0, Math.floor(bounds.x)), h: Math.ceil(bounds.y + bounds.h) - Math.max(0, Math.floor(bounds.y)),
    } : selection;
    if (!area) return;
    setClipboard(copyArea(map, area));
    if (cut) {
      if (lockedLayers.length) { setToast('Разблокируйте слои, чтобы вырезать область.'); return; }
      commit(selectedObject ? removeObject(map, selectedObject) : eraseArea(map, area));
      changeEditor({ tool: 'paste' }); setActiveLayer('terrain'); setMobileSidebar(false);
    } else setToast('Область скопирована');
  }

  function save() {
    downloadJson({ version: 1, gen, render, map, editor });
    setToast('Проект сохранён в JSON');
  }

  async function exportPng() {
    try {
      await Promise.all([loadAssets(), loadFurnitureSprites(map.furnitureSprites ?? [])]);
      const canvas = document.createElement('canvas');
      renderMap(canvas, map, { ...highResSettings(map, render), cellSize: render.cellSize * 2 }, gen.seed);
      canvas.toBlob((blob) => {
        if (!blob) { setToast('Не удалось создать PNG'); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `battlemap-${gen.biome}-${gen.seed}-${map.width}x${map.height}.png`;
        link.href = url;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setToast('Карта экспортирована в PNG');
      }, 'image/png');
    } catch { setToast('Не удалось создать PNG'); }
  }

  async function sendToTable() {
    try {
      await Promise.all([loadAssets(), loadFurnitureSprites(map.furnitureSprites ?? [])]);
      const canvas = document.createElement('canvas');
      // В стол уходит «игровой» вид: без сетки (сетку рисует сам стол),
      // без скрытых меток ведущего и без крыш (интерьеры должны быть проходимы).
      renderMap(canvas, map, { ...highResSettings(map, render), cellSize: render.cellSize * 2, showGrid: false, showSecrets: false, showRoofs: false }, gen.seed);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) { setToast('Не удалось создать PNG'); return; }
      const walls = extractWalls(map, render.cellSize);
      const doors = extractDoors(map, render.cellSize);
      const form = new FormData();
      form.append('file', blob, `map-${gen.biome}-${gen.seed}.png`);
      form.append('data', JSON.stringify({
        name: `${gen.biome}-${gen.seed}`,
        width: map.width * render.cellSize,
        height: map.height * render.cellSize,
        grid: { size: render.cellSize, feet_per_cell: 5 },
        // Стартовая зона карты: стол покажет её ГМу и поставит туда партию.
        spawn: map.plan?.spawn ?? null,
        walls,
        doors,
      }));
      const res = await fetch('/api/import_map', { method: 'POST', body: form });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setToast(result.error || `Ошибка отправки (${res.status})`); return; }
      setToast(`Сцена «${result.scene}» создана: ${result.walls} стен, ${result.doors} дверей`);
    } catch { setToast('Не удалось отправить карту в стол'); }
  }

  async function importFile(file: File) {
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
      const project = parseProject(JSON.parse(await file.text()));
      if (!project) throw new Error('Неверный формат проекта. Выберите JSON из Картографа.');
      if (project.map?.furnitureSprites?.length) { setSpritesReady(false); await loadFurnitureSprites(project.map.furnitureSprites); setSpritesReady(true); }
      setRender(project.render); levelEdits.current = EMPTY_LEVEL_EDITS; setHistory(historyFor(project.gen, project.map));
      setEditor(project.editor ?? DEFAULT_EDITOR); setActiveLayer(TOOL_LAYERS[project.editor?.tool ?? 'brush'] ?? 'terrain');
      setInspector(inspectorFor(project.gen.biome, project.editor?.tool ?? 'brush'));
      setSettlementTab(project.gen.biome === 'dungeon' || project.editor?.tool === 'crypt' ? 'crypt' : 'settlement');
      setFocusedHouse(null); setFocusedRoom(null);
      setSelectedObject(null); setSizePreview(null); setHiddenSize(null);
      setMode('edit'); setSelection(null); setClipboard(null); setCursor(null); setLockedLayers([]); setZoom(null); setMobileSidebar(false);
      setToast('Проект открыт');
    } catch (error) { setToast(error instanceof SyntaxError ? 'Файл не содержит корректный JSON' : error instanceof Error ? error.message : 'Не удалось открыть проект'); }
  }

  function switchMode(next: Mode) {
    setMode(next); setCursor(null); setSpacePan(false); setMobileSidebar(next === 'generate');
    setSelectedObject(null); setSizePreview(null);
    if (next === 'edit') {
      const section = inspectorFor(gen.biome, editor.tool);
      setInspector(section);
      if (section === 'settlement' || section === 'crypt') setSettlementTab(section);
    }
    viewportRef.current?.scrollTo(0, 0);
  }

  const shortcuts = useEffectEvent((e: KeyboardEvent) => {
    if (helpRef.current?.open) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (e.key === 'Escape') { setSelection(null); setSelectedObject(null); setSizePreview(null); if (['chest', 'paste', 'furniture', 'crypt', ...CITY_TOOLS].includes(editor.tool)) onTool('brush'); return; }
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const { code } = e;
    if (e.ctrlKey || e.metaKey) {
      if (code === 'KeyS') { e.preventDefault(); save(); }
      if (mode !== 'edit') return;
      if (code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (code === 'KeyY') { e.preventDefault(); redo(); }
      if (code === 'KeyC' && (selection || selectedObject)) { e.preventDefault(); copySelection(false); }
      if (code === 'KeyX' && (selection || selectedObject)) { e.preventDefault(); copySelection(true); }
      if (code === 'KeyV' && clipboard) { e.preventDefault(); onTool('paste'); }
      return;
    }
    if (e.altKey) return;
    if (code === 'KeyG') { e.preventDefault(); changeRender({ showGrid: !render.showGrid }); }
    if (code === 'Space' && !target?.closest('button, summary, a')) {
      e.preventDefault();
      if (mode === 'edit') setSpacePan(true);
      else if (!e.repeat) randomSeed();
      return;
    }
    if (mode === 'generate') { if (code === 'KeyR' && !e.repeat) randomSeed(); return; }
    if (code === 'KeyQ' && ['chest', 'building', 'civic', 'furniture', 'crypt'].includes(editor.tool) && !e.repeat) { e.preventDefault(); rotateStamp(); }    if (keyboardTools[code]) { e.preventDefault(); onTool(keyboardTools[code]); }
    if (code === 'Delete' || code === 'Backspace') { e.preventDefault(); deleteSelection(); }
    if (code === 'BracketRight' || code === 'BracketLeft') setEditor((state) => ({ ...state, brushSize: Math.max(1, Math.min(12, state.brushSize + (code === 'BracketRight' ? 1 : -1))) }));
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => shortcuts(e);
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpacePan(false); };
    const blur = () => setSpacePan(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  function zoomBy(multiplier: number) {
    setZoom(Math.min(3, Math.max(0.025, Math.round(scale * multiplier * 100) / 100)));
  }

  const toolName = mode === 'edit' ? spacePan ? 'Рука' : editor.tool === 'civic' ? CIVIC_KIT[editor.civicKind].label : editor.tool === 'crypt' ? editor.cryptErase ? 'Убрать объект' : CRYPT[editor.cryptKind].label : editor.tool === 'furniture' ? editor.furnitureErase ? 'Убрать мебель' : FURNITURE[editor.furnitureKind].label : TOOL_LABELS[editor.tool] : 'Просмотр';
  const placingCity = mode === 'edit' && CITY_TOOLS.includes(editor.tool);
  const placingChest = mode === 'edit' && editor.tool === 'chest';
  const placingFurniture = mode === 'edit' && editor.tool === 'furniture';
  const placingCrypt = mode === 'edit' && editor.tool === 'crypt';
  const ready = assetsReady && spritesReady && marketReady;
  const cryptMap = gen.biome === 'dungeon';

  return <div className="studio-shell">
    <header className="studio-header">
      <div className="header-inner">
        <div className="studio-brand"><div className="brand-icon"><Icon name="compass" size={28} /></div><div><div className="brand-word">Картограф</div><div className="brand-sub">D&D BATTLEMAP STUDIO</div></div></div>
        <nav className="mode-nav" aria-label="Режим работы">
          <button type="button" className={cn(mode === 'generate' && 'is-active')} aria-pressed={mode === 'generate'} onClick={() => switchMode('generate')}><Icon name="sparkles" size={16} /> Генерация</button>
          <button type="button" className={cn(mode === 'edit' && 'is-active')} aria-pressed={mode === 'edit'} onClick={() => switchMode('edit')}><Icon name="brush" size={16} /> Редактор</button>
        </nav>
        <div className="file-actions">
          <button type="button" className="action-btn secondary-btn" title="Вернуться к игровому столу" aria-label="К столу" onClick={() => { window.location.href = '/'; }}><Icon name="arrowLeft" size={17} /><span>К столу</span></button>
          <button type="button" className="action-btn secondary-btn" title="Открыть проект" aria-label="Открыть проект" onClick={() => fileRef.current?.click()}><Icon name="folder" size={17} /><span>Открыть</span></button>
          <button type="button" className="action-btn secondary-btn" title="Сохранить проект" aria-label="Сохранить проект" onClick={save}><Icon name="save" size={17} /><span>Сохранить</span></button>
          <button type="button" className="action-btn primary-btn" title="Экспорт PNG" onClick={() => void exportPng()}><Icon name="download" size={17} /><span>Экспорт PNG</span></button>
          <button type="button" className="action-btn primary-btn" title="Отправить карту в игровой стол" onClick={() => void sendToTable()}><Icon name="upload" size={17} /><span>Отправить в стол</span></button>
        </div>
      </div>
    </header>

    <main className="studio-main">
      <div className="project-heading">
        <div><div className="section-kicker"><i aria-hidden="true" /> Мастерская боевых карт</div><h1>{map.plan?.archetype?.label ?? MAP_TITLES[gen.biome]}</h1></div>
        <div className="project-details"><span><Icon name={gen.biome === 'forest' ? 'tree' : cryptMap ? 'crypt' : isSettlement(gen.biome) ? 'structure' : 'mountain'} size={16} /> {cryptMap ? 'Склеп' : BIOME_LABELS[gen.biome]}</span><span className="detail-rule" /><span className="project-seed">SEED <b>{gen.seed}</b></span></div>
      </div>

      <div className="mobile-workspace-toggle" aria-label="Панель">
        <button type="button" aria-pressed={!mobileSidebar} onClick={() => setMobileSidebar(false)}><Icon name="map" size={16} /> Карта</button>
        <button type="button" aria-pressed={mobileSidebar} onClick={() => setMobileSidebar(true)}><Icon name="settings" size={16} /> {mode === 'edit' ? 'Инструменты' : 'Настройки'}</button>
      </div>

      <div className="workspace-layout">
        <section className={cn('map-workspace', mobileSidebar && 'mobile-hidden')} aria-label="Рабочее поле">
          <div className="canvas-frame">
            <div className="canvas-toolbar">
              <div className="canvas-caption"><Icon name="map" size={17} /><span>Карта</span><span className="toolbar-divider" /><span className="canvas-tool-name">{toolName}</span></div>
              <div className="canvas-actions">
                {mode === 'edit' && <>
                  <button type="button" className="icon-btn" title="Отменить (Ctrl+Z)" aria-label="Отменить" disabled={!history.past.length} onClick={undo}><Icon name="undo" size={17} /></button>
                  <button type="button" className="icon-btn" title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" disabled={!history.future.length} onClick={redo}><Icon name="redo" size={17} /></button>
                  <span className="toolbar-divider" />
                </>}
                {!!map.buildings?.length && <button type="button" className="map-switch" title="Показать / скрыть крыши" aria-label="Крыши" aria-pressed={render.showRoofs} onClick={() => changeRender({ showRoofs: !render.showRoofs })}><Icon name="roof" size={16} /> <span>Крыши</span></button>}
                {(cryptMap || !!map.crypt?.length) && <button type="button" className="map-switch secret-switch" title="Показать скрытые метки для ведущего" aria-label="Метки ведущего" aria-pressed={render.showSecrets} onClick={() => changeRender({ showSecrets: !render.showSecrets })}><Icon name={render.showSecrets ? 'eye' : 'eyeOff'} size={16} /> <span>Метки</span></button>}
                <button type="button" className="map-switch" title="Сетка (G)" aria-pressed={render.showGrid} onClick={() => changeRender({ showGrid: !render.showGrid })}><Icon name="grid" size={16} /> <span>Сетка</span></button>
                {mode === 'edit' && <button type="button" className="icon-btn snap-button" aria-label="Привязка к сетке" title="Привязка к сетке" aria-pressed={editor.snap} onClick={() => changeEditor({ snap: !editor.snap })}><Icon name="target" size={16} /></button>}
              </div>
            </div>

            <div ref={viewportRef} className="canvas-viewport" aria-busy={!ready} style={{ '--map-ratio': `${map.width} / ${map.height}` } as CSSProperties}>
              {!ready && <span className="paint-loading" role="status">Загрузка текстур…</span>}
              {mode === 'edit' ? <CanvasEditor key={`${gen.seed}:${gen.biome}:${map.width}:${map.height}`} scrollRef={viewportRef} map={map} displayMap={renderMapData} render={render} settings={placingSettings} seed={gen.seed}
                assetsReady={ready} scale={scale} selection={selection} highlight={selectedObject ? objectInfo(renderMapData, selectedObject)?.bounds : inspector === 'interior' ? chosenHouse : inspector === 'crypt' ? chosenRoom : undefined} selectedTarget={selectedObject} clipboard={clipboard} locked={lockedLayers.includes(activeLayer)} lockedLayers={lockedLayers} spacePan={spacePan} layer={activeLayer}
                onObject={pickObject}
                onSelect={setSelection} onCommit={commit} onPick={(terrain) => { changeEditor({ terrain }); onTool('brush'); }} onCursor={setCursor} onBuilding={(house) => setFocusedHouse({ x: house.x, y: house.y })} onRoom={(room) => setFocusedRoom({ x: room.x, y: room.y })}
              /> : <div className="canvas-stage" style={{ width: width * scale, height: height * scale }}><canvas ref={canvasRef} width={Math.round(width * renderPixelRatio(map, render))} height={Math.round(height * renderPixelRatio(map, render))} aria-label={`Тактическая карта: ${BIOME_LABELS[gen.biome]}`} /></div>}
            </div>

            <div className="canvas-status">
              <div className="map-dimensions"><span>{map.width} × {map.height} клеток</span><span className="detail-rule" /><span className="distance">1 клетка = 5 футов</span>{cursor && map.cells[cursor.y]?.[cursor.x] && <span className="cursor-coordinates">X {cursor.x + 1} · Y {cursor.y + 1}</span>}</div>
              <div className="zoom-actions">
                <button type="button" className="icon-btn" aria-label="Уменьшить" title="Уменьшить" onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" size={16} /></button>
                <button type="button" className="zoom-value" title="Масштаб 100%" onClick={() => setZoom(1)}>{Math.round(scale * 100)}%</button>
                <button type="button" className="icon-btn" aria-label="Увеличить" title="Увеличить" onClick={() => zoomBy(1.25)}><Icon name="plus" size={16} /></button>
                <span className="toolbar-divider" />
                <button type="button" className="icon-btn" title="Вписать в окно" aria-label="Вписать в окно" onClick={() => { setZoom(null); viewportRef.current?.scrollTo(0, 0); }}><Icon name="fit" size={17} /></button>
              </div>
            </div>
          </div>
          {mode === 'edit' && <div className="mobile-object-tools">
            <button type="button" className="map-switch" onClick={() => { setInspector(cryptMap ? 'crypt' : 'settlement'); setMobileSidebar(true); }}><Icon name={cryptMap ? 'crypt' : 'structure'} size={16} /> {cryptMap ? 'Склеп' : 'Поселение'}</button>
            <button type="button" className="map-switch" aria-pressed={editor.tool === 'chest'} onClick={() => onTool('chest')}><Icon name="chest" size={16} /> Сундук</button>
            {['chests', 'structures', 'civic', 'crypt'].includes(activeLayer) && <button type="button" className="map-switch" aria-pressed={editor.tool === 'eraser'} onClick={() => onTool('eraser')}><Icon name="eraser" size={16} /> {activeLayer === 'chests' ? 'Удалить сундук' : 'Удалить объект'}</button>}
          </div>}
          {placingChest && <div className="placement-status" aria-live="polite"><Icon name="chest" size={16} /> <span>{chestLocked || !render.showChests ? 'Включите и разблокируйте слой сундуков' : 'Выберите клетку для сундука'}</span><button type="button" className="quiet-btn" onClick={rotateStamp}><Icon name="rotate" size={14} /> Поворот {editor.chestRotation}°</button></div>}
          {placingCity && <div className="placement-status" aria-live="polite"><Icon name={editor.tool === 'civic' ? CIVIC_KIT[editor.civicKind].icon : 'roof'} size={16} /><span>{lockedLayers.includes(activeLayer) || !visibility[activeLayer] ? 'Включите и разблокируйте слой' : editor.tool === 'roof' ? 'Нажмите на дом, чтобы заменить кровлю' : 'Выберите место на карте. ПКМ удаляет объект.'}</span>
            {editor.tool !== 'roof' && <button type="button" className="quiet-btn" onClick={rotateStamp}><Icon name="rotate" size={15} /> Поворот {editor.stampRotation}°</button>}</div>}
          {placingFurniture && <div className="placement-status" aria-live="polite"><Icon name="chair" size={16} /><span>{lockedLayers.includes('structures') ? 'Разблокируйте слой построек' : render.showRoofs ? 'Скройте крыши для расстановки мебели' : editor.furnitureErase ? 'Выберите предмет для удаления' : 'Разместите мебель в свободной части комнаты'}</span></div>}
          {placingCrypt && <div className="placement-status" aria-live="polite"><Icon name="crypt" size={16} /><span>{lockedLayers.includes('crypt') ? 'Разблокируйте слой склепа' : !render.showCrypt ? 'Включите слой объектов' : editor.cryptErase ? 'Кликните по объекту, чтобы убрать его' : 'Выберите клетку пола. Правый клик удаляет объект.'}</span></div>}
          {!placingChest && !placingCity && !placingFurniture && !placingCrypt && <div className="map-legend" aria-label="Легенда карты"><span className="legend-label">Легенда</span>{legend.map((terrain) => <span key={terrain}><i style={{ background: `rgb(${TERRAIN_COLORS[terrain].join(',')})` }} />{gen.biome === 'town' && terrain === 'plaza' ? 'Брусчатка' : TERRAIN_LABELS[terrain]}</span>)}
            {cryptMap && chosenRoom && <span className="crypt-legend-room"><Icon name="target" size={14} />{CRYPT_THEMES[chosenRoom.theme]}</span>}
            {tavern && render.showStructures && <button type="button" className="legend-tavern" title="Открыть таверну" onClick={() => showInterior(tavern)}><Icon name="mug" size={14} /> Таверна</button>}</div>}
        </section>

        <aside className={cn('studio-sidebar', !mobileSidebar && 'mobile-hidden')} aria-label={mode === 'edit' ? 'Инструменты редактора' : 'Настройки генерации'}>
          {mode === 'generate' ? <ControlPanel gen={gen} map={map} render={render} onGen={onGen} onRender={changeRender} onRandomSeed={randomSeed} history={seedHistory} /> : <>
            <div className="inspector-nav" role="group" aria-label="Панель редактора">
              <button type="button" aria-pressed={inspector === settlementTab} onClick={() => setInspector(settlementTab)}><Icon name={settlementTab === 'crypt' ? 'crypt' : 'structure'} size={16} /> {settlementTab === 'crypt' ? 'Склеп' : 'Поселение'}</button>
              <button type="button" aria-pressed={inspector === 'interior'} onClick={() => { setInspector('interior'); changeRender({ showRoofs: false, showStructures: true }); }}><Icon name="interior" size={16} /> Интерьеры</button>
              <button type="button" aria-pressed={inspector === 'tools'} onClick={() => setInspector('tools')}><Icon name="brush" size={16} /> Инструменты</button>
            </div>
            {sizeInfo && shownSize && hiddenSize !== sizeContext && <ObjectSizePanel
              key={`${sizeContext}:${shownSize.w}:${shownSize.h}:${selectedInfo?.label ?? ''}`}
              label={sizeInfo.label} size={shownSize} defaultSize={selectedInfo?.size ?? newObject!.size} selected={!!selectedInfo} integer={'integer' in sizeInfo && !!sizeInfo.integer}
              locked={lockedLayers.includes(sizeInfo.layer)} settings={editor} kind={selectedObject?.type === 'chest' ? map.chests[selectedObject.index]?.kind ?? 'wooden' : undefined}
              onSettings={changeEditor} onPreview={previewObjectSize} onApply={applyObjectSize} onRotate={spinObject}
              onReset={() => { setSizePreview(null); if (!selectedObject) { const sizes = { ...editor.objectSizes }; delete sizes[objectKey(editor)]; changeEditor({ objectSizes: sizes }); } }}
              onClose={() => { setHiddenSize(sizeContext); setSelectedObject(null); setSizePreview(null); }} />}
            {inspector === 'crypt' ? <CryptPanel map={map} gen={gen} settings={editor} render={render} room={chosenRoom} locked={lockedLayers.includes('crypt')}
              onApply={applyCrypt} onCreate={stageCrypt} onView={viewCryptRoom} onSettings={changeEditor} onRender={changeRender} onTool={(patch) => { changeEditor(patch); onTool('crypt'); }} onChest={(kind) => { changeEditor({ chestKind: kind }); onTool('chest'); }} onRotate={rotateStamp} /> : inspector === 'settlement' ? <SettlementPanel gen={gen} map={map} settings={editor} layoutLocked={!!lockedLayers.length} onApply={applyLayout} onTool={onTool} onSettings={changeEditor} onRotate={rotateStamp} /> : inspector === 'interior' ? <InteriorPanel map={map} seed={gen.seed} selected={chosenHouse} settings={editor} roofs={render.showRoofs}
              onPick={(patch) => { changeEditor(patch); onTool('furniture'); }} onSettings={changeEditor} onImport={(file, kind) => void importFurniture(file, kind)} onInspect={() => { onTool('select'); setMobileSidebar(false); }} onView={showInterior} onRoofs={() => changeRender({ showRoofs: !render.showRoofs, showStructures: true })} onRotate={rotateStamp} /> : <EditorPanel
            settings={editor} activeLayer={activeLayer} onSettings={changeEditor} onTool={onTool} map={map} selection={selection} clipboard={clipboard} onSelect={setSelection}
            onCopy={copySelection} onDelete={deleteSelection} lockedLayers={lockedLayers} visibility={visibility}
            onVisibility={(layer) => { if (layer !== 'terrain') changeRender({ [VISIBILITY_KEYS[layer]]: !visibility[layer] }); }}
            onLayer={onLayer} onLock={(layer) => setLockedLayers((state) => state.includes(layer) ? state.filter((item) => item !== layer) : [...state, layer])}
            onRotate={rotateStamp} canReset={!!edit} onReset={() => { commit(generated); setToast('Ручные правки сброшены. Действие можно отменить.'); }} onHelp={() => helpRef.current?.showModal()}
          />}
          </>}
        </aside>
      </div>
    </main>

    <input ref={fileRef} type="file" accept=".json,application/json" aria-label="Выбрать файл проекта" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }} />
      {toast && <div className="studio-toast" role="status"><Icon name="check" size={18} /><span>{toast}</span><button type="button" className="icon-btn" aria-label="Закрыть сообщение" onClick={() => setToast('')}><Icon name="x" size={16} /></button></div>}
    <dialog ref={helpRef} className="shortcut-dialog" aria-labelledby="shortcuts-title" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="shortcut-content">
        <div className="section-heading"><h2 id="shortcuts-title">Горячие клавиши</h2><button type="button" autoFocus className="icon-btn" aria-label="Закрыть" onClick={() => helpRef.current?.close()}><Icon name="x" size={18} /></button></div>
        <dl>{Object.entries(SHORTCUTS).map(([tool, key]) => <div key={tool}><dt>{TOOL_LABELS[tool as EditorTool]}</dt><dd><kbd>{key}</kbd></dd></div>)}
          {[['Повернуть объект', 'Q'], ['Перетащить холст', 'Space'], ['Размер кисти', '[ / ]'], ['Сетка', 'G'], ['Отмена / повтор', 'Ctrl Z / Ctrl Shift Z'], ['Копировать / вставить', 'Ctrl C / Ctrl V'], ['Вырезать', 'Ctrl X'], ['Сохранить', 'Ctrl S']].map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}
        </dl>
      </div>
    </dialog>
  </div>;
}
