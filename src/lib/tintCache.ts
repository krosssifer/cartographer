/**
 * Кэш тонированных спрайтов.
 *
 * `ctx.filter = 'saturate(...) hue-rotate(...)'` перед каждым `drawImage` —
 * самая дорогая операция в рендере: Skia оборачивает каждый такой вызов в
 * полноэкранный saveLayer с image-filter, поэтому 150 предметов склепа на
 * холсте 13 Мпкс растеризовались ~12 секунд. Вместо этого фильтр применяется
 * один раз к маленькому offscreen-холсту размера самой картинки, результат
 * запоминается, и дальше объект рисуется обычным блитом.
 */
type Source = HTMLImageElement | HTMLCanvasElement;

const cache = new Map<string, HTMLCanvasElement>();
const ids = new WeakMap<Source, number>();
let nextId = 1;
const MAX_ENTRIES = 600;

const sourceId = (image: Source) => {
  let id = ids.get(image);
  if (!id) { id = nextId++; ids.set(image, id); }
  return id;
};

const widthOf = (image: Source) => image instanceof HTMLImageElement ? image.naturalWidth : image.width;
const heightOf = (image: Source) => image instanceof HTMLImageElement ? image.naturalHeight : image.height;

/**
 * Возвращает картинку с уже применённым CSS-фильтром. Пустой фильтр или
 * `none` — исходная картинка без копирования.
 */
export function tinted(image: Source, filter: string | undefined): Source {
  if (!filter || filter === 'none') return image;
  const w = widthOf(image), h = heightOf(image);
  if (!w || !h) return image;
  const key = `${sourceId(image)}|${filter}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || !('filter' in ctx)) return image;
  ctx.filter = filter;
  ctx.drawImage(image, 0, 0);
  ctx.filter = 'none';
  if (cache.size >= MAX_ENTRIES) {
    // Простое вытеснение: убираем самую старую запись.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Сброс кэша (например, после замены спрайтов проекта). */
export function clearTintCache() {
  cache.clear();
}
