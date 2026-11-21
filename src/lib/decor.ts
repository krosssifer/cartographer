import { getAssets } from './assets';
import { hash2 } from './random';
import type { MapData, RenderSettings, Terrain } from './types';

/**
 * Слой мелкого декора: пучки травы, цветы, листья, камешки, веточки, мох,
 * трещины, снежные пятна. Рисуется процедурно поверх земли, но под объектами,
 * и не меняет данные карты — поэтому генерация и сохранения остаются прежними.
 *
 * Если в наборе есть картинки `decor-<name>.webp`, используются они; иначе
 * рисуется векторный запасной вариант, так что слой работает уже сейчас.
 */
type DecorKind = 'tuft' | 'flower' | 'leaf' | 'pebble' | 'twig' | 'moss' | 'crack' | 'snow' | 'litter' | 'shroom';

interface DecorRule {
  /** Среднее число объектов на клетку. */
  density: number;
  kinds: DecorKind[];
  /** Минимальный и максимальный размер в долях клетки. */
  size: [number, number];
}

const RULES: Partial<Record<Terrain, DecorRule>> = {
  grass: { density: 1.35, kinds: ['tuft', 'tuft', 'tuft', 'flower', 'leaf'], size: [0.11, 0.27] },
  darkGrass: { density: 0.95, kinds: ['tuft', 'leaf', 'moss'], size: [0.1, 0.24] },
  dirt: { density: 0.36, kinds: ['pebble', 'twig', 'leaf'], size: [0.06, 0.15] },
  road: { density: 0.3, kinds: ['pebble', 'twig'], size: [0.05, 0.13] },
  mud: { density: 0.5, kinds: ['moss', 'twig', 'pebble'], size: [0.09, 0.2] },
  sand: { density: 0.28, kinds: ['pebble', 'leaf'], size: [0.05, 0.12] },
  snow: { density: 0.45, kinds: ['snow', 'twig'], size: [0.12, 0.3] },
  ice: { density: 0.14, kinds: ['snow'], size: [0.1, 0.2] },
  rock: { density: 0.55, kinds: ['pebble', 'moss', 'crack'], size: [0.06, 0.17] },
  caveFloor: { density: 0.32, kinds: ['pebble', 'moss', 'shroom', 'crack'], size: [0.06, 0.16] },
  caveWall: { density: 0.18, kinds: ['moss', 'crack'], size: [0.07, 0.16] },
  floor: { density: 0.13, kinds: ['pebble', 'twig'], size: [0.045, 0.1] },
  plaza: { density: 0.18, kinds: ['pebble', 'crack'], size: [0.045, 0.1] },
  buildingFloor: { density: 0.1, kinds: ['pebble', 'twig'], size: [0.045, 0.09] },
};

const ART: Record<DecorKind, string> = {
  tuft: 'decor-tuft',
  flower: 'decor-flower',
  leaf: 'decor-leaf',
  pebble: 'decor-pebble',
  twig: 'decor-twig',
  moss: 'decor-moss',
  crack: 'decor-crack',
  snow: 'decor-snow',
  litter: 'decor-litter',
  shroom: 'decor-shroom',
};

/** Биомные поправки: где цветы уместны, а где только сухостой и снег. */
function flavour(biome: MapData['biome'], kind: DecorKind): DecorKind | null {
  if (biome === 'desert' && (kind === 'flower' || kind === 'moss' || kind === 'shroom')) return 'pebble';
  if (biome === 'snow' && (kind === 'flower' || kind === 'shroom')) return 'twig';
  if (biome === 'dungeon' && kind === 'flower') return 'pebble';
  if (biome === 'swamp' && kind === 'flower') return 'moss';
  return kind;
}

/** Векторный запасной вариант, пока нет нарисованных `decor-*` картинок. */
function drawVector(ctx: CanvasRenderingContext2D, kind: DecorKind, size: number) {
  const s = size / 2;
  switch (kind) {
    case 'tuft': {
      ctx.strokeStyle = '#5d6b3c';
      ctx.lineWidth = Math.max(0.6, size * 0.07);
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.36;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.5);
        ctx.quadraticCurveTo(Math.cos(a) * s * 0.5, 0, Math.cos(a) * s, -s);
        ctx.stroke();
      }
      break;
    }
    case 'flower': {
      ctx.strokeStyle = '#5d6b3c';
      ctx.lineWidth = Math.max(0.6, size * 0.06);
      ctx.beginPath(); ctx.moveTo(0, s * 0.6); ctx.lineTo(0, -s * 0.15); ctx.stroke();
      ctx.fillStyle = '#e8d9a4';
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.34, -s * 0.4 + Math.sin(a) * s * 0.34, s * 0.26, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#c9a14a';
      ctx.beginPath(); ctx.arc(0, -s * 0.4, s * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.fillStyle = 'rgba(150,120,60,.75)';
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.48, 0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pebble': {
      ctx.fillStyle = 'rgba(60,55,45,.22)';
      ctx.beginPath(); ctx.ellipse(s * 0.16, s * 0.2, s * 0.9, s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a9484';
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.55, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,245,.32)';
      ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * 0.2, s * 0.3, s * 0.2, 0.3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'twig': {
      ctx.strokeStyle = 'rgba(92,70,45,.8)';
      ctx.lineWidth = Math.max(0.5, size * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-s, s * 0.3); ctx.lineTo(s * 0.8, -s * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.05); ctx.lineTo(s * 0.35, s * 0.85); ctx.stroke();
      break;
    }
    case 'moss': {
      ctx.fillStyle = 'rgba(88,104,58,.55)';
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.28, s * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'crack': {
      ctx.strokeStyle = 'rgba(48,42,34,.42)';
      ctx.lineWidth = Math.max(0.4, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.4);
      ctx.lineTo(-s * 0.2, -s * 0.1);
      ctx.lineTo(s * 0.15, s * 0.25);
      ctx.lineTo(s * 0.9, s * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.1);
      ctx.lineTo(-s * 0.05, -s * 0.85);
      ctx.stroke();
      break;
    }
    case 'snow': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
      g.addColorStop(0, 'rgba(248,250,255,.62)');
      g.addColorStop(0.7, 'rgba(238,244,252,.32)');
      g.addColorStop(1, 'rgba(238,244,252,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'litter': {
      ctx.fillStyle = 'rgba(70,60,42,.45)';
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7, d = (i + 1) / 5 * s;
        ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, s * 0.14, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'shroom': {
      ctx.fillStyle = 'rgba(210,225,215,.7)';
      ctx.fillRect(-s * 0.09, -s * 0.1, s * 0.18, s * 0.7);
      ctx.fillStyle = 'rgba(120,190,180,.85)';
      ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.55, s * 0.38, 0, Math.PI, Math.PI * 2); ctx.fill();
      break;
    }
  }
}

/**
 * Рисует мелкий декор по всей карте. Количество деталей зависит от типа земли,
 * а вид — от биома: в пустыне вместо цветов камешки, в снегу — сухие веточки.
 */
export function paintDecor(ctx: CanvasRenderingContext2D, map: MapData, rs: RenderSettings) {
  if (rs.showDecor === false) return;
  const cs = rs.cellSize;
  const art = getAssets().art;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const rule = RULES[map.cells[y][x].terrain];
    if (!rule) continue;
    const whole = Math.floor(rule.density);
    const extra = hash2(x, y, 977) < rule.density - whole ? 1 : 0;
    const count = whole + extra;
    if (!count) continue;
    for (let i = 0; i < count; i++) {
      const pickHash = hash2(x + i * 13.7, y - i * 7.3, 881 + i * 37);
      const raw = rule.kinds[Math.min(rule.kinds.length - 1, Math.floor(pickHash * rule.kinds.length))];
      const kind = flavour(map.biome, raw);
      if (!kind) continue;
      const size = rule.size[0] + hash2(x, y, 173 + i * 11) * (rule.size[1] - rule.size[0]);
      const px = (x + 0.1 + hash2(x, y, 4211 + i * 29) * 0.8) * cs;
      const py = (y + 0.1 + hash2(x, y, 733 + i * 5) * 0.8) * cs;
      const rotate = (hash2(x, y, 319 + i * 3) - 0.5) * 1.6;
      const alpha = 0.5 + hash2(x, y, 911 + i * 17) * 0.45;
      const img = art[ART[kind]];
      const width = size * cs * (0.75 + pickHash * 0.5);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rotate);
      ctx.globalAlpha = alpha;
      if (img) ctx.drawImage(img, -width / 2, -width / 2, width, width);
      else drawVector(ctx, kind, width);
      ctx.restore();
    }
  }
}
