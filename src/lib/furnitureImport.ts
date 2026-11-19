import type { FurnitureKind, FurnitureSprite } from './types';

export const MAX_SPRITES = 16;
export const MAX_SPRITE_DATA = 240_000;
export const SPRITE_DATA_PATTERN = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const decoded = new Map<string, HTMLImageElement>();

export const spriteImage = (sprite: FurnitureSprite) => decoded.get(sprite.data);

async function remember(data: string) {
  if (decoded.has(data)) return;
  const img = new Image(); img.src = data;
  await img.decode();
  decoded.set(data, img);
  while (decoded.size > 40) decoded.delete(decoded.keys().next().value!);
}

export async function loadFurnitureSprites(entries: FurnitureSprite[]) {
  await Promise.allSettled(entries.map(({ data }) => remember(data)));
}

export async function importFurnitureSprite(file: File, kind: FurnitureKind): Promise<FurnitureSprite> {
  if (file.size > 6 * 1024 * 1024) throw new Error('Изображение должно быть меньше 6 МБ.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => header[i] === value);
  const riff = String.fromCharCode(...header);
  if (!png && !(riff.startsWith('RIFF') && riff.endsWith('WEBP'))) throw new Error('Выберите прозрачный PNG или WebP.');
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  try {
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 20_000_000) throw new Error('Изображение слишком большое.');
    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio < .12 || ratio > 8) throw new Error('Выберите спрайт с пропорциями от 1:8 до 8:1.');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не поддерживает загрузку спрайтов.');
    let edge = Math.min(384, Math.max(img.naturalWidth, img.naturalHeight)), data = '';
    for (let i = 0; i < 5; i++) {
      canvas.width = Math.max(1, Math.round(ratio > 1 ? edge : edge * ratio));
      canvas.height = Math.max(1, Math.round(ratio > 1 ? edge / ratio : edge));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL('image/webp', .88);
      if (data.length <= MAX_SPRITE_DATA) break;
      edge *= .74;
    }
    if (!SPRITE_DATA_PATTERN.test(data) || data.length > MAX_SPRITE_DATA) throw new Error('Спрайт не удалось сжать.');
    const label = file.name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, '').slice(0, 60).trim() || 'Мой спрайт';
    const id = `asset-${Array.from(crypto.getRandomValues(new Uint32Array(3)), (v) => v.toString(36)).join('-')}`;
    const sprite = { id, label, data, kind, ratio };
    await remember(data);
    return sprite;
  } finally { URL.revokeObjectURL(url); }
}