import { pruneDoors } from './doors';
import { hash2, mulberry32 } from './random';
import { contains, encloses, intersects } from './settlementKit';
import { addBuilding, addCivic } from './settlementEdits';
import { addCryptObject, eraseCrypt } from './cryptLayout';
import { CRYPT, cryptGround } from './cryptKit';
import { MAX_SPRITES } from './furnitureImport';
import { canPlaceChest, chestBounds } from './chests';
import { footprintCells } from './objectGeometry';
import type { Chest, ChestKind, ChestRotation, LayerId, MapData, ObjectDimensions, Selection, Terrain, TreeKind, Rock } from './types';

const isConstruction = (terrain: Terrain) => terrain === 'wall' || terrain === 'door' || terrain === 'floor' || terrain === 'bridge' || terrain === 'buildingWall' || terrain === 'buildingFloor';

export function cloneMap(m: MapData): MapData {
  return {
    ...m,
    cells: m.cells.map((r) => r.map((c) => ({ ...c }))),
    trees: m.trees.map((t) => ({ ...t })),
    rocks: m.rocks.map((r) => ({ ...r, pts: r.pts.map((p) => [...p] as [number, number]) })),
    structures: m.structures.map((s) => ({ ...s })),
    buildings: m.buildings?.map((b) => ({ ...b, door: { ...b.door } })),
    civic: m.civic?.slice(),
    crypt: m.crypt?.slice(),
    chests: m.chests.slice(),
    river: m.river.map((p) => ({ ...p })),
    road: m.road.map((p) => ({ ...p })),
  };
}

export function normalizeSelection(a: { x: number; y: number }, b: { x: number; y: number }): Selection {
  return { x: Math.floor(Math.min(a.x, b.x)), y: Math.floor(Math.min(a.y, b.y)), w: Math.floor(Math.abs(a.x - b.x)) + 1, h: Math.floor(Math.abs(a.y - b.y)) + 1 };
}

export function baseTerrain(m: MapData): Terrain {
  return m.biome === 'dungeon' ? 'floor' : m.biome === 'cave' ? 'caveFloor' : m.biome === 'snow' ? 'snow' : m.biome === 'desert' ? 'sand' : 'grass';
}

function removeEditedStructures(next: MapData, original: MapData, sel: Selection): MapData {
  next.structures = next.structures.filter((s) => {
    if (s.x >= sel.x + sel.w || s.x + s.w <= sel.x || s.y >= sel.y + sel.h || s.y + s.h <= sel.y) return true;
    for (let y = Math.max(sel.y, s.y); y < Math.min(sel.y + sel.h, s.y + s.h); y++) {
      for (let x = Math.max(sel.x, s.x); x < Math.min(sel.x + sel.w, s.x + s.w); x++) {
        const terrain = original.cells[y][x].terrain;
        if (isConstruction(terrain) && terrain !== next.cells[y][x].terrain) return false;
      }
    }
    return true;
  });
  return next;
}

export function paintCells(m: MapData, sel: Selection, terrain: Terrain): MapData {
  const next = cloneMap(m);
  for (let y = Math.max(0, sel.y); y < Math.min(m.height, sel.y + sel.h); y++) {
    for (let x = Math.max(0, sel.x); x < Math.min(m.width, sel.x + sel.w); x++) next.cells[y][x].terrain = terrain;
  }
  return pruneDoors(pruneCrypt(removeEditedStructures(next, m, sel)));
}

export function pruneCrypt(map: MapData): MapData {
  if (!map.crypt?.length) return map;
  const props = map.crypt.filter((item) => {
    const mounted = CRYPT[item.kind].placement === 'wallFace';
    return footprintCells(item, (x, y) => mounted ? map.cells[y]?.[x]?.terrain === 'wall' : cryptGround(map.biome, map.cells[y]?.[x]?.terrain));
  });
  const rests = props.filter((item) => (item.kind !== 'bridge' && item.kind !== 'grate') || props.some((pit) => (pit.kind === 'chasm' || pit.kind === 'pit') && intersects(pit, item)));
  return rests.length !== map.crypt.length ? { ...map, crypt: rests } : map;
}

export function floodFill(m: MapData, x: number, y: number, terrain: Terrain): MapData {
  const target = m.cells[y]?.[x]?.terrain;
  if (!target || target === terrain) return m;
  const next = cloneMap(m);
  const stack = [{ x, y }];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height || next.cells[p.y][p.x].terrain !== target) continue;
    next.cells[p.y][p.x].terrain = terrain;
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return pruneDoors(pruneCrypt(next));
}

export function eraseArea(m: MapData, sel: Selection, layer?: LayerId): MapData {
  const outside = (x: number, y: number) => x < sel.x || x >= sel.x + sel.w || y < sel.y || y >= sel.y + sel.h;
  if (layer === 'chests') {
    const chests = m.chests.filter((chest) => !intersects(chestBounds(chest), sel));
    return chests.length !== m.chests.length ? { ...m, chests } : m;
  }
  if (layer === 'crypt') return eraseCrypt(m, sel);
  if (layer === 'civic') {
    const items = m.civic ?? [];
    const selected = items.filter((p) => intersects(p, sel));
    if (!selected.length) return m;
    if (sel.w === 1 && sel.h === 1) {
      const target = selected.find((p) => p.kind !== 'square') ?? selected[0];
      return { ...m, civic: items.filter((p) => p !== target) };
    }
    return { ...m, civic: items.filter((p) => !intersects(p, sel)) };
  }
  if (layer === 'trees') return { ...m, trees: m.trees.filter((t) => outside(t.x, t.y)) };
  if (layer === 'rocks') return { ...m, rocks: m.rocks.filter((r) => outside(r.x, r.y)) };
  if (layer === 'structures') {
    const removed = m.buildings?.filter((b) => intersects(b, sel)) ?? [];
    const next = cloneMap(m);
    for (let y = Math.max(0, sel.y); y < Math.min(m.height, sel.y + sel.h); y++) for (let x = Math.max(0, sel.x); x < Math.min(m.width, sel.x + sel.w); x++) {
      const terrain = m.cells[y][x].terrain;
      if (isConstruction(terrain)) next.cells[y][x].terrain = terrain === 'bridge' ? 'water' : baseTerrain(m);
    }
    for (const b of removed) if (m.structures.some((s) => s.x === b.x && s.y === b.y && s.w === b.w && s.h === b.h)) {
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (isConstruction(m.cells[y][x].terrain)) next.cells[y][x].terrain = baseTerrain(m);
      }
    }
    next.buildings = m.buildings?.filter((b) => !intersects(b, sel));
    next.structures = next.structures.filter((s) => !removed.some((b) => s.x === b.x && s.y === b.y && s.w === b.w && s.h === b.h));
    if (!removed.length && next.cells.every((row, y) => row.every((cell, x) => cell.terrain === m.cells[y][x].terrain))) return m;
    return pruneDoors(pruneCrypt(removeEditedStructures(next, m, sel)));
  }
  const next = paintCells(m, sel, baseTerrain(m));
  if (layer === 'terrain') return next;
  next.trees = next.trees.filter((t) => outside(t.x, t.y));
  next.rocks = next.rocks.filter((r) => outside(r.x, r.y));
  next.chests = next.chests.filter((chest) => outside(chest.x, chest.y));
  next.civic = next.civic?.filter((item) => !intersects(item, sel));
  next.crypt = next.crypt?.filter((item) => !intersects(item, sel));
  next.buildings = next.buildings?.filter((b) => !intersects(b, sel));
  return next;
}

export const CHEST_ROTATIONS: ChestRotation[] = [0, 90, 180, 270];

export function getChestStamp(map: MapData, x: number, y: number, snap: boolean, rotation: ChestRotation, options?: { kind: ChestKind; size?: ObjectDimensions }): Chest | null {
  const cx = Math.floor(x), cy = Math.floor(y);
  const terrain = map.cells[cy]?.[cx]?.terrain;
  if (!terrain || ['void', 'wall', 'caveWall', 'water', 'deepWater', 'door', 'buildingWall'].includes(terrain)) return null;
  if (map.crypt?.some((p) => CRYPT[p.kind].blocks && contains(p, cx, cy))) return null;
  const chest: Chest = { x: snap ? cx + 0.5 : x, y: snap ? cy + 0.5 : y, rotation, ...options };
  const existing = map.chests.findIndex((c) => Math.floor(c.x) === Math.floor(chest.x) && Math.floor(c.y) === Math.floor(chest.y));
  return canPlaceChest(map, chest, existing) ? chest : null;
}

export function placeChest(map: MapData, chest: Chest): MapData {
  const at = map.chests.findIndex((c) => Math.floor(c.x) === Math.floor(chest.x) && Math.floor(c.y) === Math.floor(chest.y));
  const current = map.chests[at];
  if (current?.x === chest.x && current.y === chest.y && current.rotation === chest.rotation && current.kind === chest.kind && current.size?.w === chest.size?.w && current.size?.h === chest.size?.h) return map;
  if (!canPlaceChest(map, chest, at)) return map;
  const chests = map.chests.slice();
  if (at >= 0) chests[at] = chest;
  else chests.push(chest);
  return { ...map, chests };
}

export function placeObject(m: MapData, x: number, y: number, size: number, kind: TreeKind | 'rock', snap = true): MapData {
  const cx = Math.floor(x), cy = Math.floor(y);
  const terrain = m.cells[cy]?.[cx]?.terrain;
  if (!terrain || terrain === 'void' || terrain === 'wall' || terrain === 'water' || terrain === 'deepWater' || terrain === 'caveWall') return m;
  const next = cloneMap(m);
  const r = Math.max(0.15, size * 0.3);
  const v = hash2(cx, cy, m.cells[cy][cx].height * 10000);
  const centerX = snap ? cx + 0.5 : x, centerY = snap ? cy + 0.5 : y;
  if (kind === 'rock') {
    const rng = mulberry32(Math.floor(v * 100000));
    const pts: [number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.3);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]);
    }
    const rock: Rock = { x: centerX, y: centerY, r, pts, v };
    next.rocks.push(rock);
  } else next.trees.push({ x: centerX, y: centerY, r, kind, v });
  return next;
}

export function placeStructure(m: MapData, x: number, y: number, size: number, ruined: boolean): MapData {
  const w = Math.max(3, size + 2), h = Math.max(3, size + 1);
  if (x < 1 || y < 1 || x + w >= m.width || y + h >= m.height) return m;
  const overlaps = (s: { x: number; y: number; w: number; h: number }) => s.x + s.w > x && s.x < x + w && s.y + s.h > y && s.y < y + h;
  if (m.structures.some(overlaps) || m.buildings?.some(overlaps) || m.civic?.some(overlaps)) return m;
  const next = cloneMap(m);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const border = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
      next.cells[yy][xx].terrain = border ? 'wall' : 'floor';
      next.trees = next.trees.filter((t) => t.x < xx || t.x >= xx + 1 || t.y < yy || t.y >= yy + 1);
      next.rocks = next.rocks.filter((r) => r.x < xx || r.x >= xx + 1 || r.y < yy || r.y >= yy + 1);
    }
  }
  const doorX = x + Math.floor(w / 2);
  next.cells[y + h - 1][doorX].terrain = 'door';
  if (ruined) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const border = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
      if (border && hash2(xx, yy, next.cells[yy][xx].height * 10000) < 0.3 && next.cells[yy][xx].terrain === 'wall') next.cells[yy][xx].terrain = 'floor';
    }
  }
  next.structures.push({ x, y, w, h, ruin: ruined });
  return next;
}

export function copyArea(m: MapData, sel: Selection): MapData {
  const w = Math.min(sel.w, m.width - sel.x), h = Math.min(sel.h, m.height - sel.y);
  return {
    width: w, height: h, biome: m.biome,
    cells: m.cells.slice(sel.y, sel.y + h).map((r) => r.slice(sel.x, sel.x + w).map((c) => ({ ...c }))),
    trees: m.trees.filter((t) => t.x >= sel.x && t.x < sel.x + w && t.y >= sel.y && t.y < sel.y + h).map((t) => ({ ...t, x: t.x - sel.x, y: t.y - sel.y })),
    rocks: m.rocks.filter((r) => r.x >= sel.x && r.x < sel.x + w && r.y >= sel.y && r.y < sel.y + h).map((r) => ({ ...r, x: r.x - sel.x, y: r.y - sel.y })),
    chests: m.chests.filter((c) => encloses({ ...sel, w, h }, chestBounds(c))).map((c) => ({ ...c, x: c.x - sel.x, y: c.y - sel.y })),
    buildings: (m.buildings ?? []).filter((b) => encloses({ ...sel, w, h }, b))
      .map((b) => ({ ...b, x: b.x - sel.x, y: b.y - sel.y, door: { x: b.door.x - sel.x, y: b.door.y - sel.y } })),
    civic: m.civic?.filter((item) => encloses({ ...sel, w, h }, item)).map((item) => ({ ...item, x: item.x - sel.x, y: item.y - sel.y })),
    crypt: m.crypt?.filter((item) => encloses({ ...sel, w, h }, item)).map((item) => ({ ...item, x: item.x - sel.x, y: item.y - sel.y })),
    doors: m.doors?.filter((door) => contains({ ...sel, w, h }, door.x, door.y)).map((door) => ({ ...door, x: door.x - sel.x, y: door.y - sel.y })),
    furnitureSprites: m.furnitureSprites?.filter((p) => m.buildings?.some((b) => encloses({ ...sel, w, h }, b) && b.furniture?.some((f) => f.sprite === p.id))),
    structures: [], river: [], road: [],
  };
}

export function pasteArea(target: MapData, source: MapData, x: number, y: number, locks: readonly LayerId[] = []): MapData {
  let next = cloneMap(target);
  if (!locks.includes('terrain')) for (let yy = 0; yy < source.height; yy++) for (let xx = 0; xx < source.width; xx++) {
    const tx = x + xx, ty = y + yy;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    if (locks.includes('structures') && (isConstruction(target.cells[ty][tx].terrain) || isConstruction(source.cells[yy][xx].terrain))) continue;
    next.cells[ty][tx] = { ...source.cells[yy][xx] };
  }
  const merge = <T extends { x: number; y: number }>(current: T[], additions: T[]) => [
    ...current.filter((item) => item.x < x || item.x >= x + source.width || item.y < y || item.y >= y + source.height),
    ...additions.map((item) => ({ ...item, x: item.x + x, y: item.y + y }))
      .filter((item) => item.x >= 0 && item.y >= 0 && item.x < target.width && item.y < target.height),
  ];
  if (!locks.includes('trees')) next.trees = merge(target.trees, source.trees);
  if (!locks.includes('rocks')) next.rocks = merge(target.rocks, source.rocks);
  if (!locks.includes('chests')) {
    next.chests = target.chests.filter((chest) => !encloses({ x, y, w: source.width, h: source.height }, chestBounds(chest)));
    for (const chest of source.chests) {
      const shifted = { ...chest, x: chest.x + x, y: chest.y + y };
      if (canPlaceChest(next, shifted)) next.chests.push(shifted);
    }
  }
  const bounds = { x, y, w: source.width, h: source.height };
  if (!locks.includes('structures')) {
    next.buildings = target.buildings?.filter((b) => !encloses(bounds, b));
    for (const b of source.buildings ?? []) {
      if (contains({ x: 0, y: 0, w: target.width, h: target.height }, b.x + x, b.y + y)) {
        const cells = source.cells[b.y]?.[b.x]?.terrain;
        const stamp = { ...b, x: b.x + x, y: b.y + y, door: { x: b.door.x + x, y: b.door.y + y }, source: 'manual' as const };
        if (cells === 'buildingWall' && encloses({ x: 0, y: 0, w: target.width, h: target.height }, stamp)) {
          if (!next.buildings?.some((obj) => intersects(obj, stamp))) next.buildings = [...(next.buildings ?? []), stamp];
        } else next = addBuilding(next, stamp);
      }
    }
    if (source.furnitureSprites?.length) {
      const gallery = [...(target.furnitureSprites ?? [])];
      for (const p of source.furnitureSprites) if (!gallery.some((a) => a.id === p.id) && gallery.length < MAX_SPRITES) gallery.push(p);
      next.furnitureSprites = gallery;
      const ids = new Set(gallery.map((p) => p.id));
      next.buildings = next.buildings?.map((b) => b.furniture?.some((f) => f.sprite && !ids.has(f.sprite))
        ? { ...b, furniture: b.furniture.map((f) => f.sprite && !ids.has(f.sprite) ? { ...f, sprite: undefined } : f) } : b);
    }
  }
  if (!locks.includes('civic')) {
    next.civic = target.civic?.filter((item) => !encloses(bounds, item));
    for (const item of source.civic ?? []) next = addCivic(next, { ...item, x: item.x + x, y: item.y + y, source: 'manual' });
  }
  if (!locks.includes('crypt') && (target.crypt?.length || source.crypt?.length)) {
    next.crypt = target.crypt?.filter((item) => !encloses(bounds, item));
    for (const item of source.crypt ?? []) next = addCryptObject(next, { ...item, x: item.x + x, y: item.y + y, source: 'manual' });
  }
  if (!locks.includes('terrain') && (target.doors?.length || source.doors?.length)) {
    // Виды дверей едут вместе с клетками: в области вставки остаются метки источника.
    const marks = [
      ...(target.doors ?? []).filter((door) => !contains(bounds, door.x, door.y)),
      ...(source.doors ?? []).map((door) => ({ ...door, x: door.x + x, y: door.y + y })),
    ];
    next.doors = marks.length ? marks : undefined;
  }
  return pruneDoors(pruneCrypt(removeEditedStructures(next, target, bounds)));
}
