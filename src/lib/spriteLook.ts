import { artPick } from './assets';
import { hash2 } from './random';
import { tinted } from './tintCache';

/**
 * «Внешность» отдельного объекта на карте: какой вариант картинки взять, на
 * сколько сдвинуть цвет, отразить и увеличить.
 *
 * Всё считается детерминированно из координат и соли, поэтому:
 * — данные карты не меняются (карта остаётся прежней, тесты и сохранения целы);
 * — при перерисовке объект выглядит так же;
 * — соседние объекты почти никогда не совпадают по варианту и отражению.
 */
export interface SpriteLook {
  /** 0…1 — выбирает файл-вариант (`oak`, `oak-2`, …). */
  variant: number;
  /** Лёгкая цветовая вариация; пустая строка — без изменений. */
  filter: string;
  flipX: boolean;
  flipY: boolean;
  /** Множитель размера, 0.9…1.1. */
  scale: number;
}

/** Приглушённые сдвиги цвета — чтобы не превращать лес в «радугу». */
const TINTS = [
  '',
  'saturate(1.16) brightness(1.04)',
  'saturate(.85) brightness(.96) hue-rotate(-6deg)',
  'saturate(1.07) brightness(.93) hue-rotate(9deg)',
  'saturate(.94) brightness(1.08) hue-rotate(-14deg)',
];

export function spriteLook(x: number, y: number, salt = 0, tinted = true): SpriteLook {
  const tint = Math.floor(hash2(x * 1.7, y * 2.3, 5501 + salt) * TINTS.length) % TINTS.length;
  return {
    variant: hash2(x, y, 9173 + salt),
    filter: tinted ? TINTS[tint] : '',
    flipX: hash2(x, y, 3313 + salt) > 0.5,
    flipY: hash2(x, y, 7727 + salt) > 0.5,
    scale: 0.9 + hash2(x, y, 1201 + salt) * 0.2,
  };
}

/** Объединяет внешний фильтр (например, сезонный) с вариацией оттенка. */
export function lookFilter(look: SpriteLook, extra?: string): string {
  return [extra ?? '', look.filter].filter(Boolean).join(' ');
}

/**
 * Рисует картинку объекта: центр в (x, y), размер width×height.
 * Возвращает false, если картинки нет — тогда вызывающий рисует запасной вектор.
 */
export function drawLooked(
  ctx: CanvasRenderingContext2D,
  name: string,
  look: SpriteLook,
  x: number,
  y: number,
  width: number,
  height?: number,
  angle = 0,
  extraFilter?: string,
): boolean {
  const img = artPick(name, look.variant);
  if (!img) return false;
  const h = height ?? width * img.naturalHeight / img.naturalWidth;
  const filter = lookFilter(look, extraFilter);
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (look.flipX || look.flipY) ctx.scale(look.flipX ? -1 : 1, look.flipY ? -1 : 1);
  // Тонировка берётся из кэша: ctx.filter на каждом drawImage стоил полноэкранного saveLayer.
  ctx.drawImage(tinted(img, filter), -width / 2, -h / 2, width, h);
  ctx.restore();
  return true;
}

export interface CenteredLookOptions {
  /** Сохранять исходные пропорции картинки (важно для высоких предметов). */
  keepAspect?: boolean;
  angle?: number;
  extraFilter?: string;
}

/** Рисует картинку по центру, вписывая её в рамку width×height. */
export function drawLookedFit(
  ctx: CanvasRenderingContext2D,
  name: string,
  look: SpriteLook,
  x: number,
  y: number,
  width: number,
  height: number,
  options: CenteredLookOptions = {},
): boolean {
  const img = artPick(name, look.variant);
  if (!img) return false;
  let w = width, h = height;
  if (options.keepAspect) {
    const k = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    w = img.naturalWidth * k;
    h = img.naturalHeight * k;
  }
  return drawLooked(ctx, name, look, x, y, w, h, options.angle ?? 0, options.extraFilter);
}
