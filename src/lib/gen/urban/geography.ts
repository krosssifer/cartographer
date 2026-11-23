import { Perlin } from '../../noise';
import { hash2 } from '../../random';
import type { Cell, GenSettings, Point } from '../../types';
import type { SettlementTypeDef } from '../settlementTypes';
import { N4, between, stream, waterOnly, type GeographyContext } from './types';

export function buildGeography(
  s: GenSettings,
  type: SettlementTypeDef,
  notes: string[],
): GeographyContext {
  const { width: w, height: h, seed } = s;
  const rng = stream(seed, 0x67656f);
  const ink = new Perlin(seed + 3801);
  const small = Math.min(w, h) < 24;
  const geography = type.geography;
  const wantsRiver = s.river && !small;

  // Сторона «вглубь» (берег/склон): 0 — юг, 1 — север, 2 — восток, 3 — запад.
  const side = (geography === 'coast' && wantsRiver
    ? (hash2(seed, 3, 0x51de) > .5 ? 0 : 1)
    : Math.floor(hash2(seed, 5, 0x51de) * 4)) as 0 | 1 | 2 | 3;

  const fromEdge = (x: number, y: number) =>
    side === 0 ? h - 1 - y : side === 1 ? y : side === 2 ? w - 1 - x : x;
  const along = (x: number, y: number) => (side <= 1 ? x : y);
  const span = side <= 1 ? h : w;
  const length = side <= 1 ? w : h;
  const at = (a: number, d: number): Point =>
    side === 0 ? { x: a, y: h - 1 - d }
    : side === 1 ? { x: a, y: d }
    : side === 2 ? { x: w - 1 - d, y: a }
    : { x: d, y: a };

  // Базовый рельеф: мягкие холмы на равнине, чтобы замок/храм/знать выбирали возвышенность.
  const hillX = w * (.35 + hash2(seed, 11, 0x4811) * .3);
  const hillY = h * (.35 + hash2(seed, 12, 0x4811) * .3);
  const hillR = Math.max(8, Math.min(w, h) * .34);

  const cells: Cell[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x): Cell => {
      const moisture = ink.fbm(x * .082 + 18, y * .082 + 8, 3);
      const hill = Math.max(0, 1 - Math.hypot(x - hillX, y - hillY) / hillR) * .16;
      const rolling = (ink.fbm(x * .075, y * .075, 3) - .5) * .24;
      return {
        terrain: moisture > .62 ? 'darkGrass' : moisture < .33 ? 'dirt' : 'grass',
        height: between(.46 + rolling + hill, .08, .92),
        moisture,
      };
    }),
  );

  let shoreDepth = 0;
  const terraceShelves: number[] = [];
  const retainingCells: Point[] = [];

  if (geography === 'coast') {
    // Естественная бухта: вогнутая гавань в середине и более крутые мысы по краям.
    shoreDepth = Math.max(5, Math.round(span * .22));
    const bayCenter = .46 + (hash2(seed, 17, 0xba7) - .5) * .18;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = along(x, y) / Math.max(1, length - 1);
        const bayIndent = Math.exp(-((u - bayCenter) ** 2) / .065) * span * .055;
        const headland = Math.exp(-((u - (bayCenter > .5 ? .1 : .9)) ** 2) / .022) * span * .05;
        const wave = ink.noise(along(x, y) * .085, 77) * span * .05
          + Math.sin(u * Math.PI * 2.4 + (seed % 7)) * 1.1;
        const line = Math.max(3.6, shoreDepth + bayIndent - headland + wave);
        const d = fromEdge(x, y);
        if (d < line * .62) cells[y][x].terrain = 'deepWater';
        else if (d < line) cells[y][x].terrain = 'water';
        else if (d < line + 1.25) {
          cells[y][x].terrain = headland > span * .028 && ink.noise(x * .25, y * .25) > .35 ? 'rock' : 'sand';
        }
        cells[y][x].height = between(.18 + ((d - line) / Math.max(1, span)) * .68, .02, .95);
      }
    }
  } else if (geography === 'mountain') {
    // Горный склон с естественными террасами: полки для улиц и домов, уступы со скалами.
    const steps = small ? 2 : 3;
    for (let k = 1; k <= steps; k++) terraceShelves.push(Math.round(span * (.22 + k * (.52 / steps))));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = fromEdge(x, y);
        const rise = 1 - d / Math.max(1, span - 1);
        const contourWarp = (ink.fbm(x * .065 + 40, y * .065 + 9, 3) - .5) * .22;
        const raw = between(rise + contourWarp, 0, 1);
        // Мягкая ступенчатость террас на средней части склона.
        const terraced = raw < .74
          ? (Math.floor(raw * (steps + 1.5)) + .35 * ((raw * (steps + 1.5)) % 1)) / (steps + 1.5)
          : raw;
        cells[y][x].height = between(.22 + terraced * .74, .05, .99);
        if (raw > .77) {
          cells[y][x].terrain = 'rock';
        } else if (raw > .61 && ink.noise(x * .22, y * .22 + 50) > .34) {
          cells[y][x].terrain = 'rock';
        } else if (raw > .52 && cells[y][x].terrain === 'darkGrass') {
          cells[y][x].terrain = 'grass';
        }
      }
    }
    // Кромки террас фиксируем для подпорных стен/ступеней.
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        if (cells[y][x].terrain === 'rock') continue;
        const dh = Math.max(
          ...N4.map(([dx, dy]) => Math.abs(cells[y][x].height - cells[y + dy][x + dx].height)),
        );
        if (dh > .085 && dh < .18) retainingCells.push({ x, y });
      }
    }
  }

  const river: Point[] = [];
  const crossingCandidates: Point[] = [];

  if (wantsRiver) {
    const valley = geography === 'mountain';
    const vertical = valley ? side >= 2 : geography === 'coast' ? side <= 1 : (w >= h ? true : hash2(seed, 19, 0x71) > .35);
    const n = vertical ? h : w;
    const cross = vertical ? w : h;
    const base = valley
      ? (side === 0 ? h * .22 : side === 1 ? h * .78 : side === 2 ? w * .22 : w * .78)
      : geography === 'coast'
      ? cross * (.6 + hash2(seed, 9, 0x71) * .22)
      : cross * (hash2(seed, 21, 0x71) > .5 ? .76 + (rng() - .5) * .08 : .24 + (rng() - .5) * .08);

    const baseWidth = between(cross * .082, 2.6, 6.2);
    const phase = rng() * Math.PI * 2;
    const widths: number[] = [];

    for (let t = 0; t < n; t++) {
      const u = t / Math.max(1, n - 1);
      const meander = Math.sin(u * 4.4 + phase) * Math.min(3.8, cross * .075)
        + (ink.noise(t * .07, 19) - .5) * 2.4;
      const centre = between(base + meander, 2.5, cross - 3.5);
      // Естественные сужения русла (броды / удобные переправы для мостов).
      const pinch = Math.sin(u * Math.PI * 2.1 + phase * .5) * .55;
      const width = Math.max(2.2, baseWidth + ink.noise(t * .14, 31) * .6 + pinch);
      widths.push(width);
      const pt = vertical
        ? { x: between(Math.floor(centre), 0, w - 1), y: t }
        : { x: t, y: between(Math.floor(centre), 0, h - 1) };
      river.push(pt);

      for (let c = 0; c < cross; c++) {
        const x = vertical ? c : t;
        const y = vertical ? t : c;
        if (cells[y][x].terrain === 'deepWater') continue;
        const dist = Math.abs(c + .5 - centre);
        if (dist < width / 2) {
          cells[y][x].terrain = dist < width * .22 && width > 3.1 ? 'deepWater' : 'water';
          cells[y][x].height = Math.min(cells[y][x].height, .18);
        } else if (dist < width / 2 + 1.0 && cells[y][x].terrain !== 'rock') {
          cells[y][x].terrain = 'sand';
          cells[y][x].height = Math.min(cells[y][x].height, .34);
        }
      }
    }

    // Находим 1–3 лучших места для моста (узкое русло, не у самого края карты, сухие берега).
    const margin = Math.max(3, Math.floor(n * .14));
    const scored: { pt: Point; score: number }[] = [];
    for (let t = margin; t < n - margin; t++) {
      const pt = river[t];
      if (waterOnly(cells[pt.y][pt.x].terrain) && cells[pt.y][pt.x].terrain === 'deepWater' && widths[t] > 4.8) {
        // Глубокий широкий плёс менее удобен, чем перекат/сужение.
        scored.push({ pt, score: widths[t] + 1.5 + Math.abs(t - n / 2) / n });
      } else {
        scored.push({ pt, score: widths[t] + Math.abs(t - n / 2) / n * .8 });
      }
    }
    scored.sort((a, b) => a.score - b.score);
    const minSep = Math.max(8, Math.floor(n * .26));
    for (const cand of scored) {
      if (crossingCandidates.length >= 3) break;
      if (crossingCandidates.some((p) => Math.hypot(p.x - cand.pt.x, p.y - cand.pt.y) < minSep)) continue;
      crossingCandidates.push(cand.pt);
    }
  } else if (s.river && small) {
    notes.push('река не проводится: карта меньше 24 клеток');
  }

  // ---- Поля уклона, расстояния до воды, опушки леса и влияния рельефа -----
  const slope = new Float32Array(w * h);
  const waterDist = new Uint16Array(w * h).fill(999);
  const terrainInfluence = new Float32Array(w * h);
  const forestEdge = new Float32Array(w * h);

  const wQueue: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let maxDiff = 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
          maxDiff = Math.max(maxDiff, Math.abs(cells[y][x].height - cells[ny][nx].height));
        }
      }
      slope[idx] = maxDiff;
      if (waterOnly(cells[y][x].terrain)) {
        waterDist[idx] = 0;
        wQueue.push(idx);
      }
    }
  }

  for (let head = 0; head < wQueue.length; head++) {
    const cur = wQueue[head];
    const x = cur % w, y = (cur - x) / w;
    const nextD = waterDist[cur] + 1;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (waterDist[n] <= nextD) continue;
      waterDist[n] = nextD;
      wQueue.push(n);
    }
  }

  // Лесное влияние у сухих краёв карты — плавный переход окраин в дикую природу.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const t = cells[y][x].terrain;
      const edgeD = Math.min(x, y, w - 1 - x, h - 1 - y);
      const canopy = Math.max(0, 1 - edgeD / Math.max(5, Math.min(w, h) * .22))
        * (.45 + ink.fbm(x * .09 + 91, y * .09 + 37, 2) * .75);
      forestEdge[idx] = waterOnly(t) || t === 'rock' ? 0 : between(canopy * s.vegetation, 0, 1);

      if (waterOnly(t) || t === 'rock') {
        terrainInfluence[idx] = 0;
        continue;
      }
      const flatness = between(1 - slope[idx] * 4.2, 0, 1);
      const nearWaterBonus = waterDist[idx] < 999
        ? Math.exp(-Math.max(0, waterDist[idx] - 2) / 10) * .28
        : 0;
      const elevationBonus = type.keep || type.id === 'fortified_town'
        ? cells[y][x].height * .22
        : (1 - Math.abs(cells[y][x].height - .52)) * .16;
      terrainInfluence[idx] = between(flatness * .65 + nearWaterBonus + elevationBonus, 0, 1);
    }
  }

  return {
    width: w,
    height: h,
    geography,
    side,
    shoreDepth,
    cells,
    river,
    slope,
    waterDist,
    terrainInfluence,
    forestEdge,
    crossingCandidates,
    terraceShelves,
    retainingCells,
    fromEdge,
    along,
    at,
    span,
    length,
  };
}
