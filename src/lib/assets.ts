import type { Terrain } from './types';
import { furnitureVectors } from './furnitureVectors';
import { cryptVectors } from './cryptVectors';
import { chestVectors } from './chests';
import { cryptArtSvg } from './cryptArt';
import { CRYPT_KINDS } from './cryptKit';
import chest from '../assets/cartography/chest.webp?inline';

const files = import.meta.glob('../assets/cartography/*.webp', {
  eager: true,
  import: 'default',
  query: '?inline',
}) as Record<string, string>;

// Procedural fallback for every catalogue entry without a painted bitmap.
const synthesized: Record<string, string> = {};
for (const kind of CRYPT_KINDS) {
  const name = `crypt-${kind}`;
  if (!files[`../assets/cartography/${name}.webp`] && !cryptVectors[name]) synthesized[name] = cryptArtSvg(kind);
}

export const artUrl = (name: string) => files[`../assets/cartography/${name}.webp`] ?? furnitureVectors[name] ?? cryptVectors[name] ?? chestVectors[name] ?? synthesized[name];
export const CHEST_ART = chest;

export const MATERIALS = ['grass', 'earth', 'bank', 'water', 'waterDeep', 'waterRapids', 'flagstone', 'bedrock', 'snow', 'peat', 'caveSoil', 'dunes', 'hatching', 'cobbles', 'thatch', 'shingles', 'terracotta', 'slate'] as const;
export type Material = typeof MATERIALS[number];

export const ROOFS = ['thatch', 'shingles', 'terracotta', 'slate'] as const;

export const TILE_ART: Partial<Record<Terrain, Material>> = {
  grass: 'grass', darkGrass: 'grass', dirt: 'earth', road: 'bank', sand: 'bank', mud: 'peat',
  rock: 'bedrock', caveFloor: 'caveSoil', caveWall: 'bedrock', floor: 'flagstone', wall: 'bedrock', void: undefined,
  plaza: 'cobbles', buildingFloor: 'flagstone', buildingWall: 'bedrock', roof: 'thatch',
  water: 'water', deepWater: 'waterDeep', ice: 'snow', snow: 'snow',
};

export const ART_SCALE: Record<Material, number> = {
  grass: 5.9, earth: 3.6, bank: 6.8, water: 7.5, waterDeep: 6.2, waterRapids: 7.0,
  flagstone: 4.4, bedrock: 6.0, snow: 7.5, peat: 5.9,
  caveSoil: 5.8, dunes: 6.7, hatching: 8.1, cobbles: 4.1, thatch: 2.8, shingles: 2.2, terracotta: 2.6, slate: 2.4,
};

/**
 * Дополнительные варианты одного объекта: `oak.webp`, `oak-2.webp`, `oak-3.webp`.
 * Базовый файл без числового суффикса считается первым вариантом.
 * Вариант выбирается стабильным хэшем инстанса (см. artPick), поэтому один и
 * тот же объект не «перескакивает» между картинками при перерисовке.
 */
const VARIANTS: Record<string, string[]> = {};
const variantIndex = (name: string) => parseInt(name.slice(name.lastIndexOf('-') + 1), 10) || 1;
for (const path of Object.keys(files)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -5);
  const extra = /^(.+)-(\d+)$/.exec(name);
  (VARIANTS[extra ? extra[1] : name] ??= []).push(name);
}
for (const list of Object.values(VARIANTS)) list.sort((a, b) => variantIndex(a) - variantIndex(b));

/** Имена всех вариантов объекта (включая базовый). */
export const artVariants = (name: string): string[] => VARIANTS[name] ?? [];

interface MapAssets {
  art: Record<string, HTMLImageElement>;
  materials: Partial<Record<Material, ImageData>>;
  ready: boolean;
}

const assets: MapAssets = { art: {}, materials: {}, ready: false };
let loading: Promise<MapAssets> | undefined;
let marketLoading: Promise<void> | undefined;
export const getAssets = () => assets;

/** Загруженная картинка объекта без учёта вариантов. */
export const artImage = (name: string) => assets.art[name];

/** Картинка объекта с учётом варианта; `hash` в диапазоне 0…1. */
export function artPick(name: string, hash: number): HTMLImageElement | undefined {
  const list = VARIANTS[name];
  if (!list || list.length < 2) return assets.art[name];
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(hash * list.length)));
  return assets.art[list[index]] ?? assets.art[name];
}

const isMarketAsset = (path: string) => /\/market[A-Z][^/]*\.webp$/.test(path);

async function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch (error) {
    // decode() при десятках одновременных загрузок иногда отклоняется, хотя
    // картинка грузится: тогда ждём обычного onload, а не теряем спрайт.
    if (!img.complete || !img.naturalWidth) {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(error);
      });
    }
  }
  return img;
}

/** Фоново догружает 40 рыночных спрайтов: они нужны только поселениям. */
export function loadMarketAssets(): Promise<void> {
  if (marketLoading) return marketLoading;
  marketLoading = (async () => {
    const entries = Object.entries(files).filter(([path]) => isMarketAsset(path));
    await Promise.allSettled(entries.map(async ([path, src]) => {
      const name = path.slice(path.lastIndexOf('/') + 1, -5);
      assets.art[name] = await loadImage(src);
    }));
  })();
  return marketLoading;
}

export function loadAssets(): Promise<MapAssets> {
  if (loading) return loading;
  loading = (async () => {
    await Promise.allSettled(Object.entries(files).filter(([path]) => !isMarketAsset(path)).map(async ([path, src]) => {
      const name = path.slice(path.lastIndexOf('/') + 1, -5);
      assets.art[name] = await loadImage(src);
    }));
    await Promise.allSettled(Object.entries({ ...furnitureVectors, ...cryptVectors, ...chestVectors, ...synthesized }).map(async ([name, src]) => { assets.art[name] = await loadImage(src); }));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) for (const material of MATERIALS) {
      const img = assets.art[material];
      if (!img) continue;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      assets.materials[material] = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    assets.ready = true;
    return assets;
  })();
  return loading;
}