/**
 * Превью террейна без браузера: вызывает paintTerrain с подставными текстурами
 * и кодирует результат в PNG. Нужно, чтобы проверять рендер глазами.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { getAssets } from '../src/lib/assets';
import { paintTerrain } from '../src/lib/terrainPaint';
import type { MapData, RenderSettings, Terrain } from '../src/lib/types';

const dump = JSON.parse(fs.readFileSync('.tmp/scene.json', 'utf8')) as Record<string, any>;
const seed = process.argv[2] ?? '583921';
const sample = process.argv[3] ?? 'frame';
const scene = dump[seed];
const index = JSON.parse(fs.readFileSync('.tmp/tex/index.json', 'utf8')) as Record<string, { width: number; height: number }>;

class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
(globalThis as any).ImageData = FakeImageData;

const assets = getAssets();
for (const [name, meta] of Object.entries(index)) {
  const bytes = fs.readFileSync(`.tmp/tex/${name}.rgba`);
  (assets.materials as any)[name] = {
    width: meta.width,
    height: meta.height,
    data: new Uint8ClampedArray(bytes),
  };
}
assets.ready = true;

const rows: Terrain[][] = scene.rows;
const map = {
  width: scene.width,
  height: scene.height,
  biome: 'snow',
  cells: rows.map((row: Terrain[]) => row.map((terrain) => ({ terrain, height: 0.5 }))),
  trees: [],
  rocks: [],
  chests: [],
  crypt: { columns: [] },
  settlements: [],
  furnitureSprites: [],
  plan: scene.plan,
} as unknown as MapData;

const settings = {
  cellSize: 32,
  texture: true,
  shading: true,
  showStructures: true,
  showGrid: false,
} as unknown as RenderSettings;

const started = Date.now();
const image = paintTerrain(map, settings, Number(seed) || 583921);
console.log(`painted ${image.width}x${image.height} in ${Date.now() - started}ms`);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const width = image.width;
const height = image.height;
const stride = width * 4;
const raw = Buffer.alloc((stride + 1) * height);
for (let y = 0; y < height; y += 1) {
  raw[y * (stride + 1)] = 0;
  Buffer.from(image.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', (() => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return header;
  })()),
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = `C:/AbsoluteDND/preview-terrain-${seed}-${sample}.png`;
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
