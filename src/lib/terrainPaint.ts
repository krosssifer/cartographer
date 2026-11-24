import { ART_SCALE, getAssets, TILE_ART, type Material } from './assets';
import { Perlin } from './noise';
import { TERRAIN_COLORS, type RGB } from './palette';
import { ROAD_MATERIAL_IDS, selectCellRoadMaterial, type RoadMaterialId } from './roadMaterials';
import type { MapData, RenderSettings, Terrain } from './types';

const names = Object.keys(TERRAIN_COLORS) as Terrain[];
const index = Object.fromEntries(names.map((t, i) => [t, i])) as Record<Terrain, number>;
const materials = names.map((name) => TILE_ART[name]);
const baseCount = names.length;
const roadSlotIndex = Object.fromEntries(
  ROAD_MATERIAL_IDS.map((id, i) => [id, baseCount + i]),
) as Record<RoadMaterialId, number>;

const ROAD_FALLBACK_RGB: Record<RoadMaterialId, RGB> = {
  road_packed_dirt: [148, 113, 76],
  road_gravel: [152, 126, 94],
  road_old_cobblestone: [138, 133, 121],
  road_worn_cobblestone: [132, 128, 118],
  road_noble_paving: [184, 173, 152],
  road_damaged_stone: [132, 123, 108],
};

const rigid = [
  ...names.map((name) => ['floor', 'wall', 'door', 'void', 'buildingFloor', 'buildingWall', 'roof'].includes(name)),
  ...ROAD_MATERIAL_IDS.map(() => false),
];
const wet = [
  ...names.map((name) => name === 'water' || name === 'deepWater' || name === 'bridge'),
  ...ROAD_MATERIAL_IDS.map(() => false),
];
const tint: Partial<Record<Terrain, RGB>> = {
  grass: [0.89, 1.015, 0.91], darkGrass: [0.66, 0.84, 0.76],
  dirt: [1.04, 0.99, 0.93], road: [1.0, 1.0, 1.0], sand: [1.07, 1.00, 0.84],
  water: [0.84, 1.02, 1.00], deepWater: [0.61, 0.79, 0.86], ice: [0.74, 0.93, 1.02],
  caveFloor: [1.13, 1.055, 0.96], caveWall: [0.43, 0.41, 0.38], floor: [1.14, 1.12, 1.01],
  wall: [0.61, 0.57, 0.51], door: [1.12, 1.08, 0.96], void: [0.61, 0.57, 0.51],
  plaza: [1.06, 1.04, 0.99], buildingFloor: [1.05, 1.0, 0.92], buildingWall: [1.06, 1.02, 0.94], roof: [1.1, 1.04, 0.96],
};

const limit = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const smooth = (a: number, b: number, v: number) => {
  const t = limit((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function field(width: number, height: number, seed: number) {
  const stride = width * 4 + 1;
  const drift = new Float32Array(stride * (height * 4 + 1) * 3);
  const noise = new Perlin(seed + 1547);
  for (let y = 0; y <= height * 4; y++) for (let x = 0; x <= width * 4; x++) {
    const u = x / 4, v = y / 4;
    const i = (y * stride + x) * 3;
    drift[i] = noise.noise(u * 0.69 + 100, v * 0.62 + 8) * 0.25 + noise.noise(u * 1.42 + 13, v * 1.43) * 0.08;
    drift[i + 1] = noise.noise(u * 0.58 + 48, v * 0.65 + 18) * 0.25 + noise.noise(u * 1.5, v * 1.42 + 5) * 0.08;
    drift[i + 2] = noise.noise(u * 0.177 + 9.6, v * 0.21 + 64) * 0.66 + noise.noise(u * 0.86, v * 0.87) * 0.34;
  }
  return { stride, drift };
}

interface Paint {
  rgb: RGB;
  tint: RGB;
  source?: Uint8ClampedArray;
  stepX?: number;
  stepY?: number;
  offset?: number;
  tileWidth?: number;
  tileHeight?: number;
  pavedRoad?: boolean;
}

function bakeMaterial(
  kind: Material,
  samples: number,
  seed: number,
  cache: Map<Material, Pick<Paint, 'source' | 'stepX' | 'stepY' | 'offset' | 'tileWidth' | 'tileHeight'>>,
) {
  if (cache.has(kind)) return cache.get(kind);
  const art = getAssets().materials[kind];
  if (!art) return undefined;
  const span = ART_SCALE[kind] * samples;
  const factor = Math.max(1, Math.round(art.width / span));
  const baked = factor > 1 ? downsample(art, factor) : art;
  const stepX = baked.width / span, stepY = baked.height / span;
  const offset = ((seed >>> 0) % 97) * 11;
  const entry = {
    source: baked.data,
    stepX,
    stepY,
    offset,
    tileWidth: baked.width,
    tileHeight: baked.height,
  };
  cache.set(kind, entry);
  return entry;
}

function buildPaint(samples: number, textured: boolean, seed: number, biome: MapData['biome']): Paint[] {
  const materialSamples = new Map<Material, Pick<Paint, 'source' | 'stepX' | 'stepY' | 'offset' | 'tileWidth' | 'tileHeight'>>();
  const basePaints: Paint[] = names.map((name, i) => {
    const kind = name === 'bridge' ? 'water'
      : name === 'door' ? 'flagstone'
      : name === 'sand' && biome === 'desert' ? 'dunes'
      : name === 'water' && (biome === 'cave' || biome === 'dungeon') ? 'waterRapids'
      : materials[i];
    const info: Paint = {
      rgb: TERRAIN_COLORS[name === 'bridge' ? 'water' : name === 'door' ? 'floor' : name],
      tint: tint[name] ?? [1, 1, 1],
    };
    if (!kind || !textured) return info;
    const sample = bakeMaterial(kind, samples, seed, materialSamples);
    return sample ? { ...info, ...sample } : info;
  });

  const roadPaints: Paint[] = ROAD_MATERIAL_IDS.map((roadMat) => {
    const pavedRoad = roadMat !== 'road_packed_dirt' && roadMat !== 'road_gravel';
    const info: Paint = {
      rgb: ROAD_FALLBACK_RGB[roadMat],
      tint: [1, 1, 1],
      pavedRoad,
    };
    if (!textured) return info;
    const sample = bakeMaterial(roadMat, samples, seed, materialSamples);
    return sample ? { ...info, ...sample } : info;
  });

  return [...basePaints, ...roadPaints];
}

/** Усреднение блоков factor×factor — один раз на материал, чтобы убрать алиасинг. */
function downsample(art: { width: number; height: number; data: Uint8ClampedArray }, factor: number) {
  const w = Math.floor(art.width / factor), h = Math.floor(art.height / factor);
  const out = new Uint8ClampedArray(w * h * 4);
  const total = factor * factor;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < factor; dy++) {
      const row = ((y * factor + dy) * art.width + x * factor) * 4;
      for (let dx = 0; dx < factor; dx++) {
        const o = row + dx * 4;
        r += art.data[o]; g += art.data[o + 1]; b += art.data[o + 2];
      }
    }
    const o = (y * w + x) * 4;
    out[o] = r / total; out[o + 1] = g / total; out[o + 2] = b / total; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

let last: { cells: MapData['cells']; key: string; image: ImageData } | undefined;

export function paintTerrain(map: MapData, settings: RenderSettings, seed: number): ImageData {
  const { width, height } = map;
  const samples = Math.max(14, Math.min(settings.cellSize, Math.floor(Math.sqrt(22_000_000 / (width * height)))));
  const sMeta = map.plan?.settlement;
  const key = [
    seed,
    samples,
    settings.texture,
    settings.shading,
    settings.showStructures,
    settings.roadMaterial ?? 'auto',
    getAssets().ready,
    sMeta?.fortification ? 1 : 0,
    sMeta?.type ?? '',
    sMeta?.character ?? '',
    sMeta?.districts?.length ?? 0,
  ].join(':');
  if (last?.cells === map.cells && last.key === key) return last.image;

  const w = width * samples, h = height * samples;
  const raster = new ImageData(w, h), pixels = raster.data;
  const paint = buildPaint(samples, settings.texture, seed, map.biome);
  const tiles = new Uint8Array(width * height);
  const light = new Float32Array(width * height);
  const fallbackLand = index[map.biome === 'cave' ? 'caveFloor' : map.biome === 'dungeon' ? 'floor' : map.biome === 'snow' ? 'snow' : map.biome === 'swamp' ? 'mud' : map.biome === 'village' || map.biome === 'town' ? 'plaza' : 'sand'];
  const fortified = sMeta?.fortification !== undefined;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * width + x;
    const { terrain, height: elevation } = map.cells[y][x];
    const underground = map.biome === 'dungeon' || map.biome === 'cave';
    const shown = terrain === 'wall' && fortified ? 'grass'
      : !settings.showStructures && (terrain === 'wall' || terrain === 'door')
      ? 'floor'
      : terrain === 'wall' ? (underground ? 'caveWall' : 'wall') : terrain;
    if (shown === 'road') {
      const roadMat = selectCellRoadMaterial(map, x, y, settings.roadMaterial);
      tiles[at] = roadSlotIndex[roadMat];
    } else {
      tiles[at] = index[shown];
    }
    if (settings.shading && !rigid[tiles[at]]) {
      const nw = map.cells[Math.max(0, y - 1)][Math.max(0, x - 1)].height;
      const se = map.cells[Math.min(height - 1, y + 1)][Math.min(width - 1, x + 1)].height;
      light[at] = limit((nw - se) * 0.37 + (elevation - 0.5) * 0.14, -0.18, 0.18);
    }
  }

  const { stride, drift } = field(width, height, seed);
  const dxIndex = Int32Array.from({ length: w }, (_, x) => Math.floor(x * 4 / samples) * 3);
  const dxFrac = Float32Array.from({ length: w }, (_, x) => x * 4 / samples - dxIndex[x] / 3);
  const slots = new Int32Array(4), weights = new Float32Array(4);

  // Непрерывная выборка в мировых координатах: ни один дорожный материал не сбрасывает UV по клеткам.
  for (let py = 0; py < h; py++) {
    const vy = py / samples;
    const dy = Math.floor(vy * 4), dyFrac = vy * 4 - dy;
    const pRow = dy * stride * 3, nRow = pRow + stride * 3;
    const nearestRow = Math.floor(vy) * width;
    for (let px = 0; px < w; px++) {
      const vx = px / samples;
      const at = nearestRow + Math.floor(vx);
      const here = tiles[at];
      const ix = dxIndex[px], fx = dxFrac[px];
      const nw = pRow + ix, sw = nRow + ix;
      let p0 = (1 - dyFrac) * (1 - fx), p1 = (1 - dyFrac) * fx, p2 = dyFrac * (1 - fx), p3 = dyFrac * fx;
      const sumSq = p0 * p0 + p1 * p1 + p2 * p2 + p3 * p3;
      if (sumSq > 0) { const inv = 1 / sumSq; p0 *= p0 * inv; p1 *= p1 * inv; p2 *= p2 * inv; p3 *= p3 * inv; }
      const wash = drift[nw + 2] * p0 + drift[nw + 5] * p1 + drift[sw + 2] * p2 + drift[sw + 5] * p3;
      const washX = (drift[nw] * p0 + drift[nw + 3] * p1 + drift[sw] * p2 + drift[sw + 3] * p3) * 0.65;
      const washY = (drift[nw + 1] * p0 + drift[nw + 4] * p1 + drift[sw + 1] * p2 + drift[sw + 4] * p3) * 0.65;
      let r = 0, g = 0, b = 0, wetR = 0, wetG = 0, wetB = 0, water = 0, land = 0, shade = light[at];
      let count = 1;
      slots[0] = at;
      weights[0] = 1;
      if (!rigid[here]) {
        const sx = limit(vx - 0.5 + drift[nw] * p0 + drift[nw + 3] * p1 + drift[sw] * p2 + drift[sw + 3] * p3, 0, width - 1);
        const sy = limit(vy - 0.5 + drift[nw + 1] * p0 + drift[nw + 4] * p1 + drift[sw + 1] * p2 + drift[sw + 4] * p3, 0, height - 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        const fx1 = sx - x0, fy1 = sy - y0;
        slots[0] = y0 * width + x0; slots[1] = y0 * width + x1;
        slots[2] = y1 * width + x0; slots[3] = y1 * width + x1;
        weights[0] = (1 - fx1) * (1 - fy1); weights[1] = fx1 * (1 - fy1);
        weights[2] = (1 - fx1) * fy1; weights[3] = fx1 * fy1;
        shade = light[slots[0]] * weights[0] + light[slots[1]] * weights[1] + light[slots[2]] * weights[2] + light[slots[3]] * weights[3];
        if (tiles[slots[0]] === tiles[slots[1]] && tiles[slots[0]] === tiles[slots[2]] && tiles[slots[0]] === tiles[slots[3]]) weights[0] = 1;
        else count = 4;
      }

      let cavern = 0;
      for (let i = 0; i < count; i++) {
        const weight = weights[i];
        if (weight < 0.0001) continue;
        let tile = tiles[slots[i]];
        if (rigid[tile] && !rigid[here]) {
          tile = wet[here] && here !== index.bridge ? fallbackLand : here;
        }
        const mat = paint[tile];
        let a: number, c: number, d: number;
        if (mat.source && mat.stepX !== undefined && mat.stepY !== undefined) {
          // Для каменной мостовой используем минимальное смещение геометрии швов, чтобы камни не «плыли».
          const uvJitter = rigid[tile] ? 0 : mat.pavedRoad ? 0.12 : 1;
          const ux = px + washX * samples * uvJitter;
          const uy = py + washY * samples * uvJitter;
          const tw = mat.tileWidth!;
          const th = mat.tileHeight!;
          let tx = Math.floor(ux * mat.stepX) + mat.offset!;
          let ty = Math.floor(uy * mat.stepY) + mat.offset!;
          tx = ((tx % tw) + tw) % tw;
          ty = ((ty % th) + th) % th;
          const offset = (ty * tw + tx) * 4;
          a = mat.source[offset] * mat.tint[0]; c = mat.source[offset + 1] * mat.tint[1]; d = mat.source[offset + 2] * mat.tint[2];
        } else [a, c, d] = mat.rgb;
        if (wet[tile]) {
          water += weight;
          wetR += a * weight; wetG += c * weight; wetB += d * weight;
        } else {
          if (tile === index.caveWall) cavern += weight;
          const ink = weight * weight;
          land += ink;
          r += a * ink; g += c * ink; b += d * ink;
        }
      }

      const herePaved = paint[here]?.pavedRoad ?? false;
      const lighting = 1 + shade + (settings.texture ? wash * (rigid[here] || herePaved ? 0.11 : 0.27) : 0);
      const out = (py * w + px) * 4;
      const dry = land > 0.0001 ? lighting / land : 0;
      r *= dry; g *= dry; b *= dry;
      if (cavern > 0.06 && cavern < 0.86) {
        const ink = Math.max(0, 1 - Math.abs(cavern - 0.49) / 0.37) * 0.42;
        r *= 1 - ink; g *= 1 - ink; b *= 1 - ink;
      }

      if (water > 0.01) {
        const alpha = smooth(0.44, 0.56, water);
        const shelf = (1 - smooth(0.52, 0.98, water)) * 0.59;
        const silt = smooth(0.16, 0.43, water) * (1 - alpha) * 0.52;
        const edge = Math.max(0, 1 - Math.abs(water - 0.448) / 0.044) * 0.31;
        r = (r * (1 - silt) + 163 * silt) * (1 - edge);
        g = (g * (1 - silt) + 148 * silt) * (1 - edge);
        b = (b * (1 - silt) + 103 * silt) * (1 - edge);
        const sheen = settings.texture ? Math.max(0, 1 - Math.abs(water - (0.59 + wash * 0.049)) / 0.052) * limit(0.27 + wash * 0.80, 0.04, 0.56) : 0;
        const ripple = (1 + wash * 0.25) / water;
        r = r * (1 - alpha) + alpha * (wetR * ripple * (1 - shelf) + 107 * shelf + 68 * sheen);
        g = g * (1 - alpha) + alpha * (wetG * ripple * (1 - shelf) + 143 * shelf + 56 * sheen);
        b = b * (1 - alpha) + alpha * (wetB * ripple * (1 - shelf) + 120 * shelf + 53 * sheen);
      }
      pixels[out] = r; pixels[out + 1] = g; pixels[out + 2] = b; pixels[out + 3] = 255;
    }
  }
  last = { cells: map.cells, key, image: raster };
  return raster;
}
